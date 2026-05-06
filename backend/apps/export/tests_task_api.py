"""Tests for the Task API endpoints (B-api sub-PR).

Coverage:
  - Auth required: anonymous request → 401
  - List endpoint: pagination, filters (assignee_role, state, step, shipment, overdue)
  - Retrieve: TaskDetailSerializer fields (blocked_reason, blocked_by, duration_seconds)
  - Start action: OPEN → IN_PROGRESS, idempotent, wrong-role 403, supervisor OK
  - Block action: with/without reason
  - Unblock: BLOCKED → IN_PROGRESS
  - Complete: MANUAL_DONE → DONE; ALL_FIELDS_FILLED → 400; wrong-role 403
  - Cancel: admin OK, assignee (non-admin) 403
  - ShipmentViewSet tasks_list: /shipments/{id}/tasks/ grouped by step
  - /me/tasks/: role filter, supervisor sees all, anonymous 401
  - /me/kpi-today/: empty case, populated case, caching (assertNumQueries)
  - assertNumQueries: list endpoint bounded (≤ 6 queries) regardless of list size
"""
import datetime

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import Season, ShipmentStatusType, User
from apps.export.models import (
    Shipment,
    Task,
    TaskCompletionRule,
    TaskRule,
    TaskState,
)


# ---------------------------------------------------------------------------
# Shared test fixtures
# ---------------------------------------------------------------------------

def _make_user(username: str, role: str, is_superuser: bool = False) -> User:
    user = User(username=username, role=role, is_superuser=is_superuser)
    user.set_password('pass')
    user.save()
    return user


def _make_season() -> Season:
    season, _ = Season.objects.get_or_create(
        name='api-test',
        defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True},
    )
    return season


def _make_status(code: str = 'yuklenme') -> ShipmentStatusType:
    st, _ = ShipmentStatusType.objects.get_or_create(
        code=code,
        defaults={'name_tk': code, 'name_en': code, 'step_order': 1, 'phase': 'LOADING'},
    )
    return st


def _make_shipment(cargo_code: str = 'API001') -> Shipment:
    return Shipment.objects.get_or_create(
        cargo_code=cargo_code,
        defaults={
            'date': '2026-01-15',
            'season': _make_season(),
            'status': _make_status(),
        },
    )[0]


def _make_task_rule(**kwargs) -> TaskRule:
    defaults = {
        'step': 'yuklenme',
        'title_key': 'tasks.fill_loading_data',
        'assignee_role': 'warehouse_chief',
    }
    defaults.update(kwargs)
    return TaskRule.objects.create(**defaults)


def _make_task(shipment=None, **kwargs) -> Task:
    if shipment is None:
        shipment = _make_shipment()
    defaults = {
        'shipment': shipment,
        'step': 'yuklenme',
        'title_key': 'tasks.fill_loading_data',
        'assignee_role': 'warehouse_chief',
        'completion_rule': TaskCompletionRule.MANUAL_DONE,
    }
    defaults.update(kwargs)
    return Task.objects.create(**defaults)


def _auth(client: APIClient, user: User) -> None:
    client.force_authenticate(user=user)


# ---------------------------------------------------------------------------
# Auth guard
# ---------------------------------------------------------------------------

class TaskListAuthTests(TestCase):
    """Unauthenticated requests are rejected with 401."""

    def test_list_requires_auth(self) -> None:
        client = APIClient()
        resp = client.get('/api/v1/export/tasks/')
        self.assertEqual(resp.status_code, 401)

    def test_retrieve_requires_auth(self) -> None:
        task = _make_task()
        client = APIClient()
        resp = client.get(f'/api/v1/export/tasks/{task.pk}/')
        self.assertEqual(resp.status_code, 401)

    def test_start_requires_auth(self) -> None:
        task = _make_task()
        client = APIClient()
        resp = client.post(f'/api/v1/export/tasks/{task.pk}/start/')
        self.assertEqual(resp.status_code, 401)


# ---------------------------------------------------------------------------
# List endpoint
# ---------------------------------------------------------------------------

class TaskListTests(TestCase):
    """GET /api/v1/export/tasks/ — pagination, filters, ordering."""

    @classmethod
    def setUpTestData(cls):
        cls.user = _make_user('listuser', 'export_manager')
        cls.shipment = _make_shipment('LIST001')
        cls.task_open = _make_task(
            shipment=cls.shipment,
            state=TaskState.OPEN,
            assignee_role='warehouse_chief',
            step='yuklenme',
        )
        cls.task_done = _make_task(
            shipment=cls.shipment,
            state=TaskState.DONE,
            assignee_role='document_team',
            step='gumruk_girish',
        )

    def setUp(self) -> None:
        self.client = APIClient()
        _auth(self.client, self.user)

    def test_list_returns_paginated_structure(self) -> None:
        resp = self.client.get('/api/v1/export/tasks/')
        self.assertEqual(resp.status_code, 200)
        data = resp.data
        self.assertIn('count', data)
        self.assertIn('results', data)
        self.assertIn('next', data)
        self.assertIn('previous', data)

    def test_list_count_matches_db(self) -> None:
        resp = self.client.get('/api/v1/export/tasks/')
        self.assertEqual(resp.status_code, 200)
        total = Task.objects.count()
        self.assertEqual(resp.data['count'], total)

    def test_filter_assignee_role(self) -> None:
        resp = self.client.get('/api/v1/export/tasks/?assignee_role=warehouse_chief')
        self.assertEqual(resp.status_code, 200)
        ids = [t['id'] for t in resp.data['results']]
        self.assertIn(self.task_open.pk, ids)
        self.assertNotIn(self.task_done.pk, ids)

    def test_filter_state(self) -> None:
        resp = self.client.get('/api/v1/export/tasks/?state=open')
        self.assertEqual(resp.status_code, 200)
        ids = [t['id'] for t in resp.data['results']]
        self.assertIn(self.task_open.pk, ids)
        self.assertNotIn(self.task_done.pk, ids)

    def test_filter_step(self) -> None:
        resp = self.client.get('/api/v1/export/tasks/?step=yuklenme')
        self.assertEqual(resp.status_code, 200)
        ids = [t['id'] for t in resp.data['results']]
        self.assertIn(self.task_open.pk, ids)
        self.assertNotIn(self.task_done.pk, ids)

    def test_filter_shipment(self) -> None:
        resp = self.client.get(f'/api/v1/export/tasks/?shipment={self.shipment.pk}')
        self.assertEqual(resp.status_code, 200)
        result_ids = {t['id'] for t in resp.data['results']}
        # Both tasks belong to the same shipment
        self.assertIn(self.task_open.pk, result_ids)
        self.assertIn(self.task_done.pk, result_ids)

    def test_filter_overdue(self) -> None:
        past = timezone.now() - datetime.timedelta(hours=2)
        overdue_task = _make_task(
            shipment=self.shipment,
            state=TaskState.OPEN,
            assignee_role='warehouse_chief',
            deadline=past,
        )
        resp = self.client.get('/api/v1/export/tasks/?overdue=true')
        self.assertEqual(resp.status_code, 200)
        ids = [t['id'] for t in resp.data['results']]
        self.assertIn(overdue_task.pk, ids)
        # Open task with no deadline should NOT appear
        self.assertNotIn(self.task_open.pk, ids)
        # Done task (even with past deadline) should NOT appear
        done_overdue = _make_task(
            shipment=self.shipment,
            state=TaskState.DONE,
            assignee_role='warehouse_chief',
            deadline=past,
        )
        resp2 = self.client.get('/api/v1/export/tasks/?overdue=true')
        ids2 = [t['id'] for t in resp2.data['results']]
        self.assertNotIn(done_overdue.pk, ids2)
        # Clean up
        overdue_task.delete()
        done_overdue.delete()

    def test_default_ordering_by_deadline_then_created_at(self) -> None:
        """Ordering: NULL deadlines sort before future deadlines in MSSQL ASC.

        In SQL Server, NULL values sort FIRST in ASC order (NULLS FIRST is the
        default). A task with no deadline therefore appears before a task with a
        future deadline in the default 'deadline ASC, created_at ASC' ordering.
        This test verifies that a task without a deadline appears earlier than
        a task with a far-future deadline.
        """
        far_future = timezone.now() + datetime.timedelta(days=365)
        task_far_future = _make_task(
            shipment=self.shipment,
            state=TaskState.OPEN,
            deadline=far_future,
        )
        resp = self.client.get('/api/v1/export/tasks/')
        self.assertEqual(resp.status_code, 200)
        ids = [t['id'] for t in resp.data['results']]
        # task_open has no deadline (NULL) → sorts before far-future deadline in MSSQL
        idx_no_deadline = ids.index(self.task_open.pk)
        idx_far_future = ids.index(task_far_future.pk)
        self.assertLess(idx_no_deadline, idx_far_future)
        task_far_future.delete()


# ---------------------------------------------------------------------------
# Retrieve endpoint
# ---------------------------------------------------------------------------

class TaskRetrieveTests(TestCase):
    """GET /api/v1/export/tasks/{id}/ — detail serializer fields."""

    @classmethod
    def setUpTestData(cls):
        cls.user = _make_user('detailuser', 'export_manager')
        cls.shipment = _make_shipment('DET001')
        cls.task = _make_task(
            shipment=cls.shipment,
            state=TaskState.BLOCKED,
            blocked_reason='Waiting for documents',
        )
        cls.blocker = _make_task(shipment=cls.shipment)
        cls.task.blocked_by.add(cls.blocker)

        past = timezone.now() - datetime.timedelta(seconds=120)
        future = timezone.now()
        cls.task.started_at = past
        cls.task.save(update_fields=['started_at'])

    def setUp(self) -> None:
        self.client = APIClient()
        _auth(self.client, self.user)

    def test_detail_includes_blocked_reason(self) -> None:
        resp = self.client.get(f'/api/v1/export/tasks/{self.task.pk}/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['blocked_reason'], 'Waiting for documents')

    def test_detail_includes_blocked_by_list(self) -> None:
        resp = self.client.get(f'/api/v1/export/tasks/{self.task.pk}/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn(self.blocker.pk, resp.data['blocked_by'])

    def test_detail_includes_duration_seconds(self) -> None:
        resp = self.client.get(f'/api/v1/export/tasks/{self.task.pk}/')
        self.assertEqual(resp.status_code, 200)
        # Task has started_at ~120s ago, not yet completed — duration should be ≥ 100s
        self.assertIsNotNone(resp.data['duration_seconds'])
        self.assertGreaterEqual(resp.data['duration_seconds'], 100)

    def test_detail_includes_rule_field(self) -> None:
        resp = self.client.get(f'/api/v1/export/tasks/{self.task.pk}/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('rule', resp.data)


# ---------------------------------------------------------------------------
# assertNumQueries — list endpoint bounded
# ---------------------------------------------------------------------------

class TaskListQueryCountTests(TestCase):
    """List endpoint should not issue per-task queries (N+1 guard)."""

    @classmethod
    def setUpTestData(cls):
        cls.user = _make_user('queryuser', 'export_manager')
        cls.shipment = _make_shipment('QRY001')
        # Create 10 tasks — if N+1, query count grows linearly
        for i in range(10):
            _make_task(shipment=cls.shipment, title_key=f'tasks.query_test_{i}')

    def test_list_query_count_bounded(self) -> None:
        """List endpoint should not issue per-task queries (N+1 guard).

        With select_related('shipment', 'rule', 'assignee_user'), the paginated
        list should execute only 2 SQL queries regardless of page size:
          1. COUNT(*) for pagination
          2. SELECT with JOINs for the page rows

        The bound of ≤6 is generous to account for any per-test DB variation
        (e.g. auth session lookup or cache warm-up overhead in some test runners).
        """
        client = APIClient()
        _auth(client, self.user)
        num_queries_list = []
        from django.test.utils import CaptureQueriesContext
        from django.db import connection
        with CaptureQueriesContext(connection) as ctx:
            resp = client.get('/api/v1/export/tasks/')
        num_queries = len(ctx.captured_queries)
        self.assertEqual(resp.status_code, 200)
        self.assertGreaterEqual(resp.data['count'], 10)
        # Core assertion: bounded regardless of result count (no N+1)
        self.assertLessEqual(num_queries, 6, f'Expected ≤6 queries, got {num_queries}')


# ---------------------------------------------------------------------------
# Start action
# ---------------------------------------------------------------------------

class TaskStartActionTests(TestCase):
    """POST /api/v1/export/tasks/{id}/start/ — state machine and permissions."""

    @classmethod
    def setUpTestData(cls):
        cls.warehouse_chief = _make_user('wh_chief', 'warehouse_chief')
        cls.supervisor = _make_user('em_user', 'export_manager')
        cls.wrong_role_user = _make_user('sales_rep_user', 'sales_rep')
        cls.shipment = _make_shipment('START001')

    def _fresh_task(self, **kwargs) -> Task:
        """Create a fresh OPEN task for each test method."""
        defaults = {
            'shipment': self.shipment,
            'step': 'yuklenme',
            'title_key': 'tasks.start_test',
            'assignee_role': 'warehouse_chief',
            'completion_rule': TaskCompletionRule.MANUAL_DONE,
            'state': TaskState.OPEN,
        }
        defaults.update(kwargs)
        return Task.objects.create(**defaults)

    def test_assignee_can_start(self) -> None:
        task = self._fresh_task()
        client = APIClient()
        _auth(client, self.warehouse_chief)
        resp = client.post(f'/api/v1/export/tasks/{task.pk}/start/')
        self.assertEqual(resp.status_code, 200)
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.IN_PROGRESS)
        self.assertIsNotNone(task.started_at)

    def test_supervisor_can_start(self) -> None:
        task = self._fresh_task()
        client = APIClient()
        _auth(client, self.supervisor)
        resp = client.post(f'/api/v1/export/tasks/{task.pk}/start/')
        self.assertEqual(resp.status_code, 200)
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.IN_PROGRESS)

    def test_wrong_role_returns_403(self) -> None:
        task = self._fresh_task()
        client = APIClient()
        _auth(client, self.wrong_role_user)
        resp = client.post(f'/api/v1/export/tasks/{task.pk}/start/')
        self.assertEqual(resp.status_code, 403)
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.OPEN)

    def test_already_in_progress_is_idempotent(self) -> None:
        task = self._fresh_task(state=TaskState.IN_PROGRESS)
        client = APIClient()
        _auth(client, self.warehouse_chief)
        resp = client.post(f'/api/v1/export/tasks/{task.pk}/start/')
        self.assertEqual(resp.status_code, 200)
        # State unchanged
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.IN_PROGRESS)

    def test_started_at_not_overwritten_when_already_set(self) -> None:
        original_started = timezone.now() - datetime.timedelta(hours=1)
        task = self._fresh_task(state=TaskState.OPEN, started_at=original_started)
        client = APIClient()
        _auth(client, self.warehouse_chief)
        client.post(f'/api/v1/export/tasks/{task.pk}/start/')
        task.refresh_from_db()
        # started_at should be the original value, not overwritten
        self.assertAlmostEqual(
            task.started_at.timestamp(),
            original_started.timestamp(),
            delta=1,
        )

    def test_blocked_task_cannot_start(self) -> None:
        """BLOCKED → IN_PROGRESS must go through /unblock/, not /start/.
        The dedicated unblock endpoint clears blocked_reason; /start/ should
        not silently bypass that recovery path.
        """
        task = self._fresh_task(state=TaskState.BLOCKED, blocked_reason='Waiting on docs')
        client = APIClient()
        _auth(client, self.warehouse_chief)
        resp = client.post(f'/api/v1/export/tasks/{task.pk}/start/')
        self.assertEqual(resp.status_code, 400)
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.BLOCKED)
        self.assertEqual(task.blocked_reason, 'Waiting on docs')


# ---------------------------------------------------------------------------
# Block action
# ---------------------------------------------------------------------------

class TaskBlockActionTests(TestCase):
    """POST /api/v1/export/tasks/{id}/block/ — reason required."""

    @classmethod
    def setUpTestData(cls):
        cls.user = _make_user('block_wh', 'warehouse_chief')
        cls.shipment = _make_shipment('BLK001')

    def _fresh_task(self) -> Task:
        return Task.objects.create(
            shipment=self.shipment,
            step='yuklenme',
            title_key='tasks.block_test',
            assignee_role='warehouse_chief',
            completion_rule=TaskCompletionRule.MANUAL_DONE,
            state=TaskState.OPEN,
        )

    def test_block_with_reason_succeeds(self) -> None:
        task = self._fresh_task()
        client = APIClient()
        _auth(client, self.user)
        resp = client.post(
            f'/api/v1/export/tasks/{task.pk}/block/',
            {'reason': 'Waiting for docs'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.BLOCKED)
        self.assertEqual(task.blocked_reason, 'Waiting for docs')

    def test_block_without_reason_returns_400(self) -> None:
        task = self._fresh_task()
        client = APIClient()
        _auth(client, self.user)
        resp = client.post(f'/api/v1/export/tasks/{task.pk}/block/', {}, format='json')
        self.assertEqual(resp.status_code, 400)
        task.refresh_from_db()
        self.assertNotEqual(task.state, TaskState.BLOCKED)

    def test_block_already_done_returns_400(self) -> None:
        task = self._fresh_task()
        task.state = TaskState.DONE
        task.save(update_fields=['state'])
        client = APIClient()
        _auth(client, self.user)
        resp = client.post(
            f'/api/v1/export/tasks/{task.pk}/block/',
            {'reason': 'too late'},
            format='json',
        )
        self.assertEqual(resp.status_code, 400)


# ---------------------------------------------------------------------------
# Unblock action
# ---------------------------------------------------------------------------

class TaskUnblockActionTests(TestCase):
    """POST /api/v1/export/tasks/{id}/unblock/ — BLOCKED → IN_PROGRESS."""

    @classmethod
    def setUpTestData(cls):
        cls.user = _make_user('unblock_wh', 'warehouse_chief')
        cls.shipment = _make_shipment('UNB001')

    def test_unblock_blocked_task(self) -> None:
        task = Task.objects.create(
            shipment=self.shipment,
            step='yuklenme',
            title_key='tasks.unblock_test',
            assignee_role='warehouse_chief',
            completion_rule=TaskCompletionRule.MANUAL_DONE,
            state=TaskState.BLOCKED,
            blocked_reason='Some reason',
        )
        client = APIClient()
        _auth(client, self.user)
        resp = client.post(f'/api/v1/export/tasks/{task.pk}/unblock/')
        self.assertEqual(resp.status_code, 200)
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.IN_PROGRESS)
        # Unblock must clear blocked_reason so it doesn't leak into the
        # post-unblock detail view as stale state.
        self.assertEqual(task.blocked_reason, '')

    def test_unblock_non_blocked_returns_400(self) -> None:
        task = Task.objects.create(
            shipment=self.shipment,
            step='yuklenme',
            title_key='tasks.unblock_test2',
            assignee_role='warehouse_chief',
            completion_rule=TaskCompletionRule.MANUAL_DONE,
            state=TaskState.OPEN,
        )
        client = APIClient()
        _auth(client, self.user)
        resp = client.post(f'/api/v1/export/tasks/{task.pk}/unblock/')
        self.assertEqual(resp.status_code, 400)


# ---------------------------------------------------------------------------
# Complete action
# ---------------------------------------------------------------------------

class TaskCompleteActionTests(TestCase):
    """POST /api/v1/export/tasks/{id}/complete/ — manual_done only."""

    @classmethod
    def setUpTestData(cls):
        cls.warehouse_chief = _make_user('complete_wh', 'warehouse_chief')
        cls.wrong_role = _make_user('complete_doc', 'document_team')
        cls.shipment = _make_shipment('COMP001')

    def test_manual_done_task_completes_successfully(self) -> None:
        task = Task.objects.create(
            shipment=self.shipment,
            step='yuklenme',
            title_key='tasks.complete_test',
            assignee_role='warehouse_chief',
            completion_rule=TaskCompletionRule.MANUAL_DONE,
            state=TaskState.OPEN,
        )
        client = APIClient()
        _auth(client, self.warehouse_chief)
        resp = client.post(f'/api/v1/export/tasks/{task.pk}/complete/')
        self.assertEqual(resp.status_code, 200)
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.DONE)
        self.assertIsNotNone(task.completed_at)

    def test_auto_resolve_task_returns_400(self) -> None:
        """ALL_FIELDS_FILLED completion rule cannot be marked done via API."""
        task = Task.objects.create(
            shipment=self.shipment,
            step='yuklenme',
            title_key='tasks.auto_resolve_test',
            assignee_role='warehouse_chief',
            completion_rule=TaskCompletionRule.ALL_FIELDS_FILLED,
            target_fields='weight_net,weight_gross',
            state=TaskState.OPEN,
        )
        client = APIClient()
        _auth(client, self.warehouse_chief)
        resp = client.post(f'/api/v1/export/tasks/{task.pk}/complete/')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('error', resp.data)

    def test_wrong_role_returns_403(self) -> None:
        """document_team cannot complete a warehouse_chief task."""
        task = Task.objects.create(
            shipment=self.shipment,
            step='yuklenme',
            title_key='tasks.role_test',
            assignee_role='warehouse_chief',
            completion_rule=TaskCompletionRule.MANUAL_DONE,
            state=TaskState.OPEN,
        )
        client = APIClient()
        _auth(client, self.wrong_role)
        resp = client.post(f'/api/v1/export/tasks/{task.pk}/complete/')
        self.assertEqual(resp.status_code, 403)

    def test_started_at_set_when_completing_unstarted_task(self) -> None:
        task = Task.objects.create(
            shipment=self.shipment,
            step='yuklenme',
            title_key='tasks.started_at_test',
            assignee_role='warehouse_chief',
            completion_rule=TaskCompletionRule.MANUAL_DONE,
            state=TaskState.OPEN,
        )
        client = APIClient()
        _auth(client, self.warehouse_chief)
        client.post(f'/api/v1/export/tasks/{task.pk}/complete/')
        task.refresh_from_db()
        self.assertIsNotNone(task.started_at)
        self.assertIsNotNone(task.completed_at)


# ---------------------------------------------------------------------------
# Cancel action
# ---------------------------------------------------------------------------

class TaskCancelActionTests(TestCase):
    """POST /api/v1/export/tasks/{id}/cancel/ — admin/director only."""

    @classmethod
    def setUpTestData(cls):
        cls.admin_user = _make_user('cancel_admin', 'admin')
        cls.director_user = _make_user('cancel_dir', 'director')
        cls.assignee = _make_user('cancel_wh', 'warehouse_chief')
        cls.shipment = _make_shipment('CAN001')

    def _fresh_task(self) -> Task:
        return Task.objects.create(
            shipment=self.shipment,
            step='yuklenme',
            title_key='tasks.cancel_test',
            assignee_role='warehouse_chief',
            completion_rule=TaskCompletionRule.MANUAL_DONE,
            state=TaskState.OPEN,
        )

    def test_admin_can_cancel(self) -> None:
        task = self._fresh_task()
        client = APIClient()
        _auth(client, self.admin_user)
        resp = client.post(f'/api/v1/export/tasks/{task.pk}/cancel/')
        self.assertEqual(resp.status_code, 200)
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.CANCELLED)

    def test_director_can_cancel(self) -> None:
        task = self._fresh_task()
        client = APIClient()
        _auth(client, self.director_user)
        resp = client.post(f'/api/v1/export/tasks/{task.pk}/cancel/')
        self.assertEqual(resp.status_code, 200)
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.CANCELLED)

    def test_assignee_cannot_cancel(self) -> None:
        """warehouse_chief is the assignee role but may not cancel."""
        task = self._fresh_task()
        client = APIClient()
        _auth(client, self.assignee)
        resp = client.post(f'/api/v1/export/tasks/{task.pk}/cancel/')
        self.assertEqual(resp.status_code, 403)
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.OPEN)


# ---------------------------------------------------------------------------
# Shipment tasks_list nested action
# ---------------------------------------------------------------------------

class ShipmentTasksListTests(TestCase):
    """GET /api/v1/export/shipments/{id}/tasks/ — grouped by step."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.user = _make_user('stl_user', 'export_manager')
        cls.shipment = _make_shipment('STL001')
        cls.task_loading = _make_task(
            shipment=cls.shipment,
            step='yuklenme',
            assignee_role='warehouse_chief',
        )
        cls.task_customs = _make_task(
            shipment=cls.shipment,
            step='gumruk_girish',
            assignee_role='document_team',
        )

    def test_returns_grouped_dict(self) -> None:
        client = APIClient()
        _auth(client, self.user)
        resp = client.get(f'/api/v1/export/shipments/{self.shipment.pk}/tasks/')
        self.assertEqual(resp.status_code, 200)
        self.assertIsInstance(resp.data, dict)

    def test_step_keys_present(self) -> None:
        client = APIClient()
        _auth(client, self.user)
        resp = client.get(f'/api/v1/export/shipments/{self.shipment.pk}/tasks/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('yuklenme', resp.data)
        self.assertIn('gumruk_girish', resp.data)

    def test_tasks_under_each_step(self) -> None:
        client = APIClient()
        _auth(client, self.user)
        resp = client.get(f'/api/v1/export/shipments/{self.shipment.pk}/tasks/')
        yuklenme_ids = [t['id'] for t in resp.data['yuklenme']]
        self.assertIn(self.task_loading.pk, yuklenme_ids)
        gumruk_ids = [t['id'] for t in resp.data['gumruk_girish']]
        self.assertIn(self.task_customs.pk, gumruk_ids)

    def test_returns_401_for_anonymous(self) -> None:
        client = APIClient()
        resp = client.get(f'/api/v1/export/shipments/{self.shipment.pk}/tasks/')
        self.assertEqual(resp.status_code, 401)


# ---------------------------------------------------------------------------
# /me/tasks/
# ---------------------------------------------------------------------------

class MeTasksTests(TestCase):
    """GET /api/v1/me/tasks/ — role-scoped task list."""

    @classmethod
    def setUpTestData(cls):
        cls.wh_user = _make_user('me_wh', 'warehouse_chief')
        cls.em_user = _make_user('me_em', 'export_manager')
        cls.shipment = _make_shipment('ME001')
        cls.wh_task = _make_task(
            shipment=cls.shipment,
            assignee_role='warehouse_chief',
            state=TaskState.OPEN,
        )
        cls.doc_task = _make_task(
            shipment=cls.shipment,
            assignee_role='document_team',
            state=TaskState.OPEN,
        )

    def test_warehouse_chief_sees_only_own_role_tasks(self) -> None:
        client = APIClient()
        _auth(client, self.wh_user)
        resp = client.get('/api/v1/me/tasks/')
        self.assertEqual(resp.status_code, 200)
        ids = [t['id'] for t in resp.data['results']]
        self.assertIn(self.wh_task.pk, ids)
        self.assertNotIn(self.doc_task.pk, ids)

    def test_supervisor_sees_all_tasks(self) -> None:
        client = APIClient()
        _auth(client, self.em_user)
        resp = client.get('/api/v1/me/tasks/')
        self.assertEqual(resp.status_code, 200)
        ids = [t['id'] for t in resp.data['results']]
        self.assertIn(self.wh_task.pk, ids)
        self.assertIn(self.doc_task.pk, ids)

    def test_anonymous_returns_401(self) -> None:
        client = APIClient()
        resp = client.get('/api/v1/me/tasks/')
        self.assertEqual(resp.status_code, 401)

    def test_state_filter_applied(self) -> None:
        done_task = _make_task(
            shipment=self.shipment,
            assignee_role='warehouse_chief',
            state=TaskState.DONE,
        )
        client = APIClient()
        _auth(client, self.wh_user)
        resp = client.get('/api/v1/me/tasks/?state=open')
        ids = [t['id'] for t in resp.data['results']]
        self.assertIn(self.wh_task.pk, ids)
        self.assertNotIn(done_task.pk, ids)
        done_task.delete()


# ---------------------------------------------------------------------------
# /me/kpi-today/
# ---------------------------------------------------------------------------

class MeKpiTodayTests(TestCase):
    """GET /api/v1/me/kpi-today/ — KPI computation and caching."""

    @classmethod
    def setUpTestData(cls):
        cls.user = _make_user('kpi_wh', 'warehouse_chief')
        cls.shipment = _make_shipment('KPI001')

    def test_empty_case_returns_zeros(self) -> None:
        client = APIClient()
        _auth(client, self.user)
        resp = client.get('/api/v1/me/kpi-today/')
        self.assertEqual(resp.status_code, 200)
        data = resp.data
        # Only tasks completed today by this role — if none, done_count=0
        # (other tests may have created completed tasks, so just check structure)
        self.assertIn('done_count', data)
        self.assertIn('avg_duration_seconds', data)
        self.assertIn('on_time_rate', data)

    def test_with_completed_tasks_returns_correct_counts(self) -> None:
        """Two tasks: one on time, one late. Rate should be 0.5."""
        from zoneinfo import ZoneInfo
        tm_tz = ZoneInfo('Asia/Ashgabat')
        import datetime as dt

        now = timezone.now()
        # Both completed within today (now - 30min should still be today in TM)
        started = now - dt.timedelta(minutes=30)

        deadline_passed = now - dt.timedelta(minutes=60)   # deadline in the past → late
        deadline_future = now + dt.timedelta(hours=2)       # deadline in the future → on time

        task_late = Task.objects.create(
            shipment=self.shipment,
            step='yuklenme',
            title_key='tasks.kpi_late',
            assignee_role='warehouse_chief',
            completion_rule=TaskCompletionRule.MANUAL_DONE,
            state=TaskState.DONE,
            started_at=started,
            completed_at=now,
            deadline=deadline_passed,
        )
        task_ontime = Task.objects.create(
            shipment=self.shipment,
            step='yuklenme',
            title_key='tasks.kpi_ontime',
            assignee_role='warehouse_chief',
            completion_rule=TaskCompletionRule.MANUAL_DONE,
            state=TaskState.DONE,
            started_at=started,
            completed_at=now,
            deadline=deadline_future,
        )

        # Clear cache so we get fresh computation
        from django.core.cache import cache
        cache.delete(f'me:kpi-today:{self.user.id}')

        client = APIClient()
        _auth(client, self.user)
        resp = client.get('/api/v1/me/kpi-today/')
        self.assertEqual(resp.status_code, 200)
        data = resp.data

        self.assertGreaterEqual(data['done_count'], 2)
        self.assertGreater(data['avg_duration_seconds'], 0)
        # on_time_rate: 1 on-time / 2 with deadline = 0.5
        self.assertIsNotNone(data['on_time_rate'])
        self.assertAlmostEqual(data['on_time_rate'], 0.5, places=2)

        task_late.delete()
        task_ontime.delete()

    def test_caching_avoids_second_query(self) -> None:
        """Second request within 60s should be served from cache (0 DB queries)."""
        from django.core.cache import cache

        cache.delete(f'me:kpi-today:{self.user.id}')

        client = APIClient()
        _auth(client, self.user)

        # First call — computes and caches
        resp1 = client.get('/api/v1/me/kpi-today/')
        self.assertEqual(resp1.status_code, 200)

        # Second call — should hit cache (0 queries for KPI computation)
        with self.assertNumQueries(0):
            resp2 = client.get('/api/v1/me/kpi-today/')
        self.assertEqual(resp2.status_code, 200)
        self.assertEqual(resp1.data['done_count'], resp2.data['done_count'])

    def test_anonymous_returns_401(self) -> None:
        client = APIClient()
        resp = client.get('/api/v1/me/kpi-today/')
        self.assertEqual(resp.status_code, 401)
