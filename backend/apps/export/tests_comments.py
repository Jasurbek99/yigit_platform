"""Tests for the comment & task system (services/comments.py + CommentViewSet).

Run with:
    python manage.py test apps.export.tests_comments --verbosity=2
"""
from unittest.mock import patch, call

from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from apps.core.models import Season, User
from apps.export.models import Notification, Shipment, ShipmentComment
from apps.export.services.comments import create_comment, mark_task_done, reopen_task


# ── Shared helpers ───────────────────────────────────────────────────────────

def _make_user(username: str, role: str = 'export_manager') -> User:
    return User.objects.create_user(username=username, password='pass', role=role)


def _make_shipment(author: User) -> Shipment:
    from apps.core.models import Season
    season, _ = Season.objects.get_or_create(
        name='2025',
        defaults={'start_date': '2025-01-01', 'end_date': '2025-12-31'},
    )
    return Shipment.objects.create(
        cargo_code='0101001/25',
        date='2025-01-01',
        season=season,
        created_by=author,
    )


# ── Test: user mention creates Notification ──────────────────────────────────

class TestCreateCommentUserMention(TestCase):
    """test_create_comment_with_user_mention"""

    def setUp(self):
        self.author = _make_user('author')
        self.mentioned = _make_user('mentioned_user', role='document_team')
        self.shipment = _make_shipment(self.author)

    def test_mention_creates_notification_for_mentioned_not_author(self):
        create_comment(
            self.shipment, self.author,
            content='Hello @user:mentioned',
            mentions=[self.mentioned.id],
        )
        notifs = Notification.objects.filter(user=self.mentioned, kind='mention')
        self.assertEqual(notifs.count(), 1)

        # Author must NOT receive a self-notification
        self_notifs = Notification.objects.filter(user=self.author)
        self.assertEqual(self_notifs.count(), 0)


# ── Test: role mention deduplication ─────────────────────────────────────────

class TestCreateCommentRoleMentionDedupes(TestCase):
    """test_create_comment_with_role_mention_dedupes"""

    def setUp(self):
        self.author = _make_user('author_dedup')
        # Create 4 warehouse_chief users
        self.wc_users = [
            _make_user(f'wc_{i}', role='warehouse_chief') for i in range(4)
        ]
        # One of the wc_users also gets an explicit @user mention — should dedupe to 4 total
        self.shipment = _make_shipment(self.author)

    def test_role_and_user_mention_deduplicates(self):
        explicit_user = self.wc_users[0]
        create_comment(
            self.shipment, self.author,
            content='@role:warehouse_chief and @user:explicit',
            mentions=[explicit_user.id],
            role_mentions=['warehouse_chief'],
        )
        all_notifs = Notification.objects.filter(kind='mention')
        # 4 warehouse_chief users → exactly 4 notifications (explicit one deduped)
        self.assertEqual(all_notifs.count(), 4)
        # No duplicate for the user who was in both explicit + role
        user_notif_count = all_notifs.filter(user=explicit_user).count()
        self.assertEqual(user_notif_count, 1)


# ── Test: assignee gets task_assigned only, not double-notified ───────────────

class TestCreateCommentAssignee(TestCase):
    """test_create_comment_with_assignee"""

    def setUp(self):
        self.author = _make_user('author_task')
        self.assignee = _make_user('assignee_user', role='sales_rep')
        self.shipment = _make_shipment(self.author)

    def test_assignee_gets_task_assigned_only(self):
        create_comment(
            self.shipment, self.author,
            content='Please handle @user:assignee',
            mentions=[self.assignee.id],
            assignee=self.assignee,
        )
        all_notifs = Notification.objects.filter(user=self.assignee)
        # Only ONE notification — task_assigned, NOT both task_assigned + mention
        self.assertEqual(all_notifs.count(), 1)
        self.assertEqual(all_notifs.first().kind, 'task_assigned')


# ── Test: reply inherits parent field_key, cannot have assignee ──────────────

class TestReplyInheritsFieldKey(TestCase):
    """test_reply_inherits_field_key"""

    def setUp(self):
        self.author = _make_user('author_reply')
        self.replier = _make_user('replier', role='transport')
        self.shipment = _make_shipment(self.author)

    def test_reply_overrides_mismatched_field_key_to_parent(self):
        parent = create_comment(
            self.shipment, self.author,
            content='Root comment',
            field_key='weight_net',
        )
        # Reply provides a different field_key — should be silently overridden
        reply = create_comment(
            self.shipment, self.replier,
            content='Reply text',
            field_key='vehicle_condition',  # mismatched — should be overridden
            parent_comment=parent,
        )
        self.assertEqual(reply.field_key, 'weight_net')

    def test_reply_with_assignee_raises_value_error(self):
        parent = create_comment(
            self.shipment, self.author,
            content='Root comment',
        )
        other_user = _make_user('target_user')
        with self.assertRaises(ValueError):
            create_comment(
                self.shipment, self.replier,
                content='Reply with task — should fail',
                parent_comment=parent,
                assignee=other_user,
            )


# ── Test: mark_task_done notifies author (but not if author == assignee) ──────

class TestMarkTaskDone(TestCase):
    """test_mark_done_notifies_author"""

    def setUp(self):
        self.author = _make_user('task_author')
        self.assignee = _make_user('task_assignee', role='sales_rep')
        self.shipment = _make_shipment(self.author)

    def test_done_notifies_author_when_different_user(self):
        comment = create_comment(
            self.shipment, self.author,
            content='Task',
            assignee=self.assignee,
        )
        # Clear setup notifications
        Notification.objects.all().delete()

        mark_task_done(comment, self.assignee)

        done_notifs = Notification.objects.filter(user=self.author, kind='task_done')
        self.assertEqual(done_notifs.count(), 1)

    def test_done_no_notification_when_author_is_assignee(self):
        comment = create_comment(
            self.shipment, self.author,
            content='Self-assigned task',
            assignee=self.author,
        )
        Notification.objects.all().delete()

        mark_task_done(comment, self.author)

        # No task_done notification — author IS the assignee
        done_notifs = Notification.objects.filter(kind='task_done')
        self.assertEqual(done_notifs.count(), 0)


# ── Test: mark_task_done is idempotent ────────────────────────────────────────

class TestMarkTaskDoneIdempotent(TestCase):
    """test_mark_done_idempotent"""

    def setUp(self):
        self.author = _make_user('idem_author')
        self.assignee = _make_user('idem_assignee', role='transport')
        self.shipment = _make_shipment(self.author)

    def test_calling_twice_does_not_create_duplicate_notifications(self):
        comment = create_comment(
            self.shipment, self.author,
            content='Idempotent task',
            assignee=self.assignee,
        )
        Notification.objects.all().delete()

        mark_task_done(comment, self.assignee)
        mark_task_done(comment, self.assignee)  # second call — idempotent

        # Exactly 1 task_done notification to author — not 2
        done_notifs = Notification.objects.filter(user=self.author, kind='task_done')
        self.assertEqual(done_notifs.count(), 1)


# ── Test: bulk_create uses batch_size=500 ────────────────────────────────────

class TestBulkCreateBatchSize(TestCase):
    """test_bulk_create_uses_batch_size_500"""

    def setUp(self):
        self.author = _make_user('batch_author')
        self.mentioned = _make_user('batch_mentioned', role='document_team')
        self.shipment = _make_shipment(self.author)

    def test_bulk_create_called_with_batch_size_500(self):
        with patch.object(Notification.objects, 'bulk_create', wraps=Notification.objects.bulk_create) as mock_bc:
            create_comment(
                self.shipment, self.author,
                content='@mention test',
                mentions=[self.mentioned.id],
            )
            # bulk_create must have been called with batch_size=500
            self.assertTrue(mock_bc.called)
            _, kwargs = mock_bc.call_args
            self.assertEqual(kwargs.get('batch_size'), 500)


# ── Test: backward-compat shipment comment endpoint ──────────────────────────

class TestLegacyCommentEndpoint(TestCase):
    """test_existing_shipment_comment_endpoint_still_works"""

    def setUp(self):
        self.author = _make_user('legacy_author')
        # is_superuser bypasses DynamicResourcePermission for this integration test
        self.author.is_superuser = True
        self.author.save()
        self.mentioned = _make_user('legacy_mentioned', role='transport')
        self.shipment = _make_shipment(self.author)
        self.client = APIClient()
        self.client.force_authenticate(user=self.author)

    def test_post_creates_comment_and_returns_detail(self):
        url = f'/api/v1/export/shipments/{self.shipment.id}/comment/'
        resp = self.client.post(url, {'content': 'Legacy comment'}, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(ShipmentComment.objects.filter(shipment=self.shipment).count(), 1)

    def test_empty_content_returns_400(self):
        url = f'/api/v1/export/shipments/{self.shipment.id}/comment/'
        resp = self.client.post(url, {'content': ''}, format='json')
        self.assertEqual(resp.status_code, 400)
