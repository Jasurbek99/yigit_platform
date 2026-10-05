"""TaskRule assignees: model, PUT /assignees/, GET /assignee-candidates/,
and the My tasks visibility they drive (mine vs colleagues)."""
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import RolePagePermission, User
from apps.export.models import AuditLog, TaskRule, TaskRuleAssignee


def _make_user(username, role, is_superuser=False, is_active=True, first_name=''):
    user = User(username=username, role=role, is_superuser=is_superuser,
                is_active=is_active, first_name=first_name)
    user.set_password('pass')
    user.save()
    return user


class TaskRuleAssigneesApiTests(TestCase):
    def setUp(self):
        cache.clear()
        for role in ('admin', 'director', 'warehouse_chief'):
            RolePagePermission.objects.update_or_create(
                role=role, page_code='export.task_rules', defaults={'is_visible': True},
            )
        cache.clear()
        self.client = APIClient()
        self.rule = TaskRule.objects.create(
            step='yuklenme', title_key='tasks.fill_loading_data',
            assignee_role='loading_dept_head',
        )
        self.admin = _make_user('ta_admin', 'admin')
        self.head1 = _make_user('ta_head1', 'loading_dept_head', first_name='Ahmed')
        self.head2 = _make_user('ta_head2', 'loading_dept_head')
        self.deputy = _make_user('ta_dep', 'loading_dept_head_deputy')
        self.other = _make_user('ta_wh', 'warehouse_chief')
        self.url = f'/api/v1/export/task-rules/{self.rule.pk}/assignees/'

    def test_list_includes_empty_assignees(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get('/api/v1/export/task-rules/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data[0]['assignees'], [])

    def test_admin_sets_assignees(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.put(self.url, {'user_ids': [self.head1.pk, self.deputy.pk]}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(
            set(TaskRuleAssignee.objects.filter(rule=self.rule).values_list('user_id', flat=True)),
            {self.head1.pk, self.deputy.pk},
        )
        self.assertEqual({a['id'] for a in resp.data['assignees']}, {self.head1.pk, self.deputy.pk})
        self.assertTrue(AuditLog.objects.filter(model_name='TaskRule', object_id=self.rule.pk).exists())

    def test_put_replaces_list(self):
        TaskRuleAssignee.objects.create(rule=self.rule, user=self.head1)
        self.client.force_authenticate(self.admin)
        self.client.put(self.url, {'user_ids': [self.head2.pk]}, format='json')
        self.assertEqual(
            list(TaskRuleAssignee.objects.filter(rule=self.rule).values_list('user_id', flat=True)),
            [self.head2.pk],
        )

    def test_put_empty_list_clears(self):
        TaskRuleAssignee.objects.create(rule=self.rule, user=self.head1)
        self.client.force_authenticate(self.admin)
        resp = self.client.put(self.url, {'user_ids': []}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(TaskRuleAssignee.objects.filter(rule=self.rule).exists())

    def test_rejects_user_of_other_role(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.put(self.url, {'user_ids': [self.other.pk]}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn(str(self.other.pk), str(resp.data))
        self.assertFalse(TaskRuleAssignee.objects.exists())

    def test_rejects_boolean_ids(self):
        # isinstance(True, int) is True in Python: [true] must not become user id 1.
        self.client.force_authenticate(self.admin)
        resp = self.client.put(self.url, {'user_ids': [True]}, format='json')
        self.assertEqual(resp.status_code, 400)
        # Rejected as malformed input, not as "user 1 is not allowed" — user 1
        # could be a valid candidate on a real database.
        self.assertIn('list of integers', str(resp.data))
        self.assertFalse(TaskRuleAssignee.objects.exists())

    def test_rejects_inactive_user(self):
        gone = _make_user('ta_gone', 'loading_dept_head', is_active=False)
        self.client.force_authenticate(self.admin)
        resp = self.client.put(self.url, {'user_ids': [gone.pk]}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_non_admin_forbidden(self):
        self.client.force_authenticate(self.other)
        resp = self.client.put(self.url, {'user_ids': []}, format='json')
        self.assertEqual(resp.status_code, 403)

    def test_director_allowed(self):
        self.client.force_authenticate(_make_user('ta_dir', 'director'))
        resp = self.client.put(self.url, {'user_ids': [self.head1.pk]}, format='json')
        self.assertEqual(resp.status_code, 200)

    def test_candidates_are_active_role_users_incl_deputy(self):
        _make_user('ta_gone2', 'loading_dept_head', is_active=False)
        self.client.force_authenticate(self.admin)
        resp = self.client.get(f'/api/v1/export/task-rules/{self.rule.pk}/assignee-candidates/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            {c['id'] for c in resp.data},
            {self.head1.pk, self.head2.pk, self.deputy.pk},
        )
        ahmed = next(c for c in resp.data if c['id'] == self.head1.pk)
        self.assertEqual(ahmed['full_name'], 'Ahmed')


# ---------------------------------------------------------------------------
# My tasks visibility: mine vs colleagues
# ---------------------------------------------------------------------------
from apps.core.models import LoadingLocation, Season, ShipmentStatusType  # noqa: E402
from apps.export.models import Shipment, Task, TaskCompletionRule, TaskState  # noqa: E402


def _shipment(code='TA001'):
    season, _ = Season.objects.get_or_create(
        name='ta-season',
        defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True},
    )
    status, _ = ShipmentStatusType.objects.get_or_create(
        code='yuklenme',
        defaults={'name_tk': 'y', 'name_en': 'y', 'step_order': 1, 'phase': 'LOADING'},
    )
    return Shipment.objects.get_or_create(
        shipment_code=code, defaults={'date': '2026-01-15', 'season': season, 'status': status},
    )[0]


def _task(rule, role='loading_dept_head', shipment=None, **kw):
    # export_task_one_per_shipment_rule: one task per (shipment, rule), so a test
    # needing two tasks of one rule passes a second shipment.
    return Task.objects.create(
        shipment=shipment or _shipment(), step='yuklenme', title_key=rule.title_key if rule else 'x',
        rule=rule, assignee_role=role, completion_rule=TaskCompletionRule.MANUAL_DONE,
        state=TaskState.OPEN, **kw,
    )


class MeTasksAssigneeVisibilityTests(TestCase):
    URL = '/api/v1/me/tasks/'

    def setUp(self):
        cache.clear()
        self.head1 = _make_user('tv_head1', 'loading_dept_head')
        self.head2 = _make_user('tv_head2', 'loading_dept_head')
        self.deputy = _make_user('tv_dep', 'loading_dept_head_deputy')
        self.boss = _make_user('tv_boss', 'boss')
        self.rule_a = TaskRule.objects.create(step='yuklenme', title_key='tasks.a',
                                              assignee_role='loading_dept_head')
        self.rule_b = TaskRule.objects.create(step='yuklenme', title_key='tasks.b',
                                              assignee_role='loading_dept_head')
        self.rule_open = TaskRule.objects.create(step='yuklenme', title_key='tasks.c',
                                                 assignee_role='loading_dept_head')
        TaskRuleAssignee.objects.create(rule=self.rule_a, user=self.head1)
        TaskRuleAssignee.objects.create(rule=self.rule_b, user=self.head2)
        self.task_a = _task(self.rule_a)
        self.task_b = _task(self.rule_b)
        self.task_open = _task(self.rule_open)
        self.task_norule = _task(None)

    def _ids(self, user, scope=None):
        client = APIClient()
        client.force_authenticate(user)
        params = {'page_size': 500}
        if scope:
            params['scope'] = scope
        resp = client.get(self.URL, params)
        self.assertEqual(resp.status_code, 200)
        return {t['id'] for t in resp.data['results']}

    def test_mine_shows_own_assigned_and_unassigned(self):
        ids = self._ids(self.head1)
        self.assertIn(self.task_a.pk, ids)
        self.assertIn(self.task_open.pk, ids)
        self.assertIn(self.task_norule.pk, ids)
        self.assertNotIn(self.task_b.pk, ids)

    def test_colleagues_shows_only_others_assigned(self):
        self.assertEqual(self._ids(self.head1, 'colleagues'), {self.task_b.pk})

    def test_mine_and_colleagues_partition(self):
        mine = self._ids(self.head2)
        colleagues = self._ids(self.head2, 'colleagues')
        self.assertFalse(mine & colleagues)
        self.assertEqual(
            mine | colleagues,
            {self.task_a.pk, self.task_b.pk, self.task_open.pk, self.task_norule.pk},
        )

    def test_deputy_assigned_to_head_rule(self):
        TaskRuleAssignee.objects.create(rule=self.rule_a, user=self.deputy)
        self.assertIn(self.task_a.pk, self._ids(self.deputy))
        self.assertIn(self.task_b.pk, self._ids(self.deputy, 'colleagues'))

    def test_inactive_assignee_falls_back_to_role(self):
        self.head2.is_active = False
        self.head2.save()
        self.assertIn(self.task_b.pk, self._ids(self.head1))
        self.assertNotIn(self.task_b.pk, self._ids(self.head1, 'colleagues'))

    def test_role_changed_assignee_falls_back_to_role(self):
        self.head2.role = 'warehouse_chief'
        self.head2.save()
        self.assertIn(self.task_b.pk, self._ids(self.head1))
        self.assertNotIn(self.task_b.pk, self._ids(self.head1, 'colleagues'))

    def test_colleagues_never_other_roles(self):
        other_rule = TaskRule.objects.create(step='yuklenme', title_key='tasks.d',
                                             assignee_role='warehouse_chief')
        wh = _make_user('tv_wh', 'warehouse_chief')
        TaskRuleAssignee.objects.create(rule=other_rule, user=wh)
        other_task = _task(other_rule, role='warehouse_chief')
        self.assertNotIn(other_task.pk, self._ids(self.head1, 'colleagues'))

    def test_supervisor_unchanged_and_scope_ignored(self):
        all_ids = {self.task_a.pk, self.task_b.pk, self.task_open.pk, self.task_norule.pk}
        self.assertTrue(all_ids <= self._ids(self.boss))
        self.assertTrue(all_ids <= self._ids(self.boss, 'colleagues'))

    def test_colleague_can_complete_others_task(self):
        client = APIClient()
        client.force_authenticate(self.head1)
        resp = client.post(f'/api/v1/export/tasks/{self.task_b.pk}/complete/')
        self.assertIn(resp.status_code, (200, 204), resp.data)
        self.task_b.refresh_from_db()
        self.assertEqual(self.task_b.state, TaskState.DONE)
        self.assertEqual(self.task_b.completed_by_id, self.head1.pk)

    def test_colleagues_scope_keeps_gate_filter(self):
        loc1 = LoadingLocation.objects.create(name='Gate1')
        loc2 = LoadingLocation.objects.create(name='Gate2')
        g1 = _make_user('tv_g1', 'garawul')
        g1.loading_location = loc1
        g1.save()
        g2 = _make_user('tv_g2', 'garawul')
        rule = TaskRule.objects.create(step='yuklenme', title_key='tasks.gate_x',
                                       assignee_role='garawul')
        TaskRuleAssignee.objects.create(rule=rule, user=g2)
        here = _task(rule, role='garawul', scope_location=loc1)
        there = _task(rule, role='garawul', shipment=_shipment('TA002'), scope_location=loc2)
        ids = self._ids(g1, 'colleagues')
        self.assertIn(here.pk, ids)
        self.assertNotIn(there.pk, ids)
