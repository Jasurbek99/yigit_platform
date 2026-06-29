"""Tests for the local_sell_plan Task feature.

Covers:
  - generate_local_sell_plan_tasks: one shared seller task per ISO week,
    idempotent re-run, role-wide (no assignee_user).
  - completion: a week with no rows stays OPEN; a non-zero draft keeps it OPEN;
    a zero-total draft does NOT block; all rows submitted/approved → DONE; a
    rejected row keeps it OPEN.
  - initialize-week endpoint creates the task as a side effect.
  - /me/tasks/ read auto-resolves a now-complete week for the seller role.
"""
import unittest
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

try:
    from apps.core.models import ExportFirm, Season, User
    from apps.export.models import Task, TaskKind, TaskState, WeeklyLocalSellPlan
    from apps.export.services import (
        generate_local_sell_plan_tasks,
        resolve_local_sell_plan_tasks,
    )
    DB_AVAILABLE = True
except Exception:  # pragma: no cover
    DB_AVAILABLE = False


YEAR = 2099
WEEK = 7


def _make_user(username: str, role: str, is_superuser: bool = False) -> "User":
    user = User(username=username, role=role, is_superuser=is_superuser)
    user.set_password('pass')
    user.save()
    return user


@unittest.skipUnless(DB_AVAILABLE, "Django models unavailable in this environment")
class LocalSellPlanTaskTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.season, _ = Season.objects.get_or_create(
            name='lsp-test',
            defaults={'start_date': '2098-09-01', 'end_date': '2099-06-30', 'is_active': True},
        )
        cls.firm_a, _ = ExportFirm.objects.get_or_create(
            code='LSP-A', defaults={'name_tk': 'Firma A', 'is_active': True},
        )
        cls.firm_b, _ = ExportFirm.objects.get_or_create(
            code='LSP-B', defaults={'name_tk': 'Firma B', 'is_active': True},
        )
        cls.seller = _make_user('lsp_seller', 'seller')
        # Superuser bypasses the DB-seeded DynamicResourcePermission layer
        # (role permissions aren't seeded in the test DB); the inner role gate
        # still requires an APPROVE role, which export_manager satisfies.
        cls.manager = _make_user('lsp_mgr', 'export_manager', is_superuser=True)

    def setUp(self):
        Task.objects.filter(kind=TaskKind.LOCAL_SELL_PLAN, scope_year=YEAR, scope_week=WEEK).delete()
        WeeklyLocalSellPlan.objects.filter(year=YEAR, week_number=WEEK).delete()

    def _row(self, firm, status='draft', monday=0):
        return WeeklyLocalSellPlan.objects.create(
            export_firm=firm, year=YEAR, week_number=WEEK, season=self.season,
            status=status, monday_plan_kg=Decimal(str(monday)),
        )

    def test_generates_one_shared_seller_task_idempotently(self):
        created = generate_local_sell_plan_tasks(YEAR, WEEK)
        self.assertEqual(len(created), 1)
        task = created[0]
        self.assertEqual(task.kind, TaskKind.LOCAL_SELL_PLAN)
        self.assertEqual(task.assignee_role, 'seller')
        self.assertIsNone(task.assignee_user_id)
        self.assertIsNone(task.shipment_id)
        self.assertEqual(task.state, TaskState.OPEN)
        # idempotent
        self.assertEqual(generate_local_sell_plan_tasks(YEAR, WEEK), [])
        self.assertEqual(
            Task.objects.filter(kind=TaskKind.LOCAL_SELL_PLAN, scope_year=YEAR, scope_week=WEEK).count(), 1,
        )

    def test_nonzero_draft_keeps_task_open(self):
        task = generate_local_sell_plan_tasks(YEAR, WEEK)[0]
        self._row(self.firm_a, status='draft', monday=100)   # started, not submitted
        self._row(self.firm_b, status='submitted', monday=50)
        resolve_local_sell_plan_tasks()
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.OPEN)

    def test_zero_total_draft_does_not_block(self):
        task = generate_local_sell_plan_tasks(YEAR, WEEK)[0]
        self._row(self.firm_a, status='submitted', monday=50)
        self._row(self.firm_b, status='draft', monday=0)     # nothing to sell
        resolve_local_sell_plan_tasks()
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.DONE)

    def test_rejected_row_keeps_task_open(self):
        task = generate_local_sell_plan_tasks(YEAR, WEEK)[0]
        self._row(self.firm_a, status='approved', monday=50)
        self._row(self.firm_b, status='rejected', monday=50)
        resolve_local_sell_plan_tasks()
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.OPEN)

    def test_generate_on_already_complete_week_is_immediately_done(self):
        self._row(self.firm_a, status='approved', monday=50)
        task = generate_local_sell_plan_tasks(YEAR, WEEK)[0]
        self.assertEqual(task.state, TaskState.DONE)

    def test_initialize_week_endpoint_creates_task(self):
        client = APIClient()
        client.force_authenticate(self.manager)
        resp = client.post(
            '/api/v1/export/local-sell-plans/initialize-week/',
            {'week_number': WEEK, 'year': YEAR, 'season': self.season.id}, format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        # The task must be born OPEN: initialize-week seeds all-zero draft rows,
        # which must NOT count as a completed week.
        task = Task.objects.get(kind=TaskKind.LOCAL_SELL_PLAN, scope_year=YEAR, scope_week=WEEK)
        self.assertEqual(task.state, TaskState.OPEN)

    def test_me_tasks_read_resolves_complete_week(self):
        generate_local_sell_plan_tasks(YEAR, WEEK)
        self._row(self.firm_a, status='approved', monday=50)
        client = APIClient()
        client.force_authenticate(self.seller)
        resp = client.get('/api/v1/me/tasks/')
        self.assertEqual(resp.status_code, 200, resp.content)
        task = Task.objects.get(kind=TaskKind.LOCAL_SELL_PLAN, scope_year=YEAR, scope_week=WEEK)
        self.assertEqual(task.state, TaskState.DONE)
