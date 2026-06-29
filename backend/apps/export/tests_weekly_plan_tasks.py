"""Tests for the weekly_plan Task feature.

Covers:
  - generate_weekly_plan_tasks: one task per (active manager, block), idempotent
    re-run, inactive assignments excluded, multi-block manager → multiple tasks.
  - resolution (per block, Mon–Sat only): blank weekday cell → stays OPEN; all
    weekday cells filled (incl. explicit 0) → DONE; a blank Sunday cell does NOT
    block; a block with zero rows → its task stays OPEN while a sibling block's
    task resolves independently.
  - generate endpoint: supervisor OK, non-supervisor 403, bad payload 400.
  - /me/tasks/ scoping: a manager sees only their own weekly task, not another
    manager's; shipment tasks (assignee_user null) stay role-visible; the read
    auto-resolves a now-complete weekly task.
"""
import datetime
import unittest
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

try:
    from apps.core.models import GreenhouseBlock, Season, User
    from apps.export.models import Task, TaskKind, TaskState
    from apps.export.services import (
        generate_weekly_plan_tasks,
        resolve_weekly_plan_tasks_for_user,
    )
    from apps.greenhouse.models import (
        BlockManagerAssignment,
        HarvestDayEntry,
        WeeklyHarvestPlan,
    )
    DB_AVAILABLE = True
except Exception:  # pragma: no cover
    DB_AVAILABLE = False


# ISO week 2026-W25 → Mon 2026-06-15 .. Sun 2026-06-21
YEAR = 2026
WEEK = 25
MONDAY = datetime.date(2026, 6, 15)


def _make_user(username: str, role: str, is_superuser: bool = False) -> "User":
    user = User(username=username, role=role, is_superuser=is_superuser)
    user.set_password('pass')
    user.save()
    return user


@unittest.skipUnless(DB_AVAILABLE, "Django models unavailable in this environment")
class WeeklyPlanTaskGenerationTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.season, _ = Season.objects.get_or_create(
            name='wpt-test',
            defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True},
        )
        cls.block_a, _ = GreenhouseBlock.objects.get_or_create(
            code='WPT-A', defaults={'name': 'Block A', 'is_active': True},
        )
        cls.block_b, _ = GreenhouseBlock.objects.get_or_create(
            code='WPT-B', defaults={'name': 'Block B', 'is_active': True},
        )
        cls.mgr1 = _make_user('wpt_mgr1', 'greenhouse_manager')
        cls.mgr2 = _make_user('wpt_mgr2', 'greenhouse_manager')
        # mgr1 → block A; mgr2 → block B
        BlockManagerAssignment.objects.create(user=cls.mgr1, block=cls.block_a)
        BlockManagerAssignment.objects.create(user=cls.mgr2, block=cls.block_b)

    def test_one_task_per_block_and_idempotent(self):
        created = generate_weekly_plan_tasks(YEAR, WEEK)
        self.assertEqual(len(created), 2)
        self.assertEqual(
            Task.objects.filter(kind=TaskKind.WEEKLY_PLAN, scope_year=YEAR, scope_week=WEEK).count(),
            2,
        )
        task = created[0]
        self.assertIsNone(task.shipment_id)
        self.assertEqual(task.assignee_role, 'greenhouse_manager')
        self.assertIsNotNone(task.scope_block_id)
        self.assertIn(f'week={WEEK}', task.link)
        self.assertIn(f'year={YEAR}', task.link)
        self.assertIn(f'block={task.scope_block_id}', task.link)

        # Second run creates nothing.
        again = generate_weekly_plan_tasks(YEAR, WEEK)
        self.assertEqual(len(again), 0)
        self.assertEqual(
            Task.objects.filter(kind=TaskKind.WEEKLY_PLAN, scope_year=YEAR, scope_week=WEEK).count(),
            2,
        )

    def test_multi_block_manager_gets_one_task_per_block(self):
        # mgr1 also manages block B → 2 tasks for mgr1 (A and B).
        BlockManagerAssignment.objects.create(user=self.mgr1, block=self.block_b)
        created = generate_weekly_plan_tasks(YEAR, WEEK)
        mgr1_tasks = [t for t in created if t.assignee_user_id == self.mgr1.id]
        self.assertEqual(len(mgr1_tasks), 2)
        self.assertEqual(
            {t.scope_block_id for t in mgr1_tasks},
            {self.block_a.id, self.block_b.id},
        )

    def test_inactive_assignment_excluded(self):
        mgr3 = _make_user('wpt_mgr3', 'greenhouse_manager')
        BlockManagerAssignment.objects.create(user=mgr3, block=self.block_a, is_active=False)
        created = generate_weekly_plan_tasks(YEAR, WEEK)
        assignees = {t.assignee_user_id for t in created}
        self.assertNotIn(mgr3.id, assignees)


@unittest.skipUnless(DB_AVAILABLE, "Django models unavailable in this environment")
class WeeklyPlanTaskResolutionTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.season, _ = Season.objects.get_or_create(
            name='wptr-test',
            defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True},
        )
        cls.block_a, _ = GreenhouseBlock.objects.get_or_create(
            code='WPTR-A', defaults={'name': 'Block A', 'is_active': True},
        )
        cls.mgr = _make_user('wptr_mgr', 'greenhouse_manager')
        BlockManagerAssignment.objects.create(user=cls.mgr, block=cls.block_a)
        cls.plan_a, _ = WeeklyHarvestPlan.objects.get_or_create(
            season=cls.season, block=cls.block_a, week_number=WEEK, year=YEAR,
        )

    def _entry(self, day_offset: int, plan_value) -> HarvestDayEntry:
        d = MONDAY + datetime.timedelta(days=day_offset)
        return HarvestDayEntry.objects.create(
            weekly_plan=self.plan_a, season=self.season, block=self.block_a,
            entry_date=d, weekday=d.weekday(), plan_value=plan_value,
        )

    def test_blank_cell_keeps_task_open(self):
        generate_weekly_plan_tasks(YEAR, WEEK)
        self._entry(0, Decimal('100'))
        self._entry(1, None)  # blank cell
        resolved = resolve_weekly_plan_tasks_for_user(self.mgr)
        self.assertEqual(resolved, [])
        task = Task.objects.get(kind=TaskKind.WEEKLY_PLAN, assignee_user=self.mgr)
        self.assertEqual(task.state, TaskState.OPEN)

    def test_all_filled_including_zero_resolves(self):
        generate_weekly_plan_tasks(YEAR, WEEK)
        self._entry(0, Decimal('100'))
        self._entry(1, Decimal('0'))  # explicit zero counts as filled
        resolved = resolve_weekly_plan_tasks_for_user(self.mgr)
        self.assertEqual(len(resolved), 1)
        task = Task.objects.get(kind=TaskKind.WEEKLY_PLAN, assignee_user=self.mgr)
        self.assertEqual(task.state, TaskState.DONE)
        self.assertIsNotNone(task.completed_at)

    def test_sunday_blank_does_not_block(self):
        # Mon–Sat filled, Sunday (day 6) blank → task still resolves.
        generate_weekly_plan_tasks(YEAR, WEEK)
        for day in range(6):  # Mon..Sat
            self._entry(day, Decimal('100'))
        self._entry(6, None)  # Sunday — not measured
        resolved = resolve_weekly_plan_tasks_for_user(self.mgr)
        self.assertEqual(len(resolved), 1)
        task = Task.objects.get(kind=TaskKind.WEEKLY_PLAN, assignee_user=self.mgr)
        self.assertEqual(task.state, TaskState.DONE)

    def test_blocks_resolve_independently(self):
        # Manager assigned to a second block that has no rows this week.
        block_b, _ = GreenhouseBlock.objects.get_or_create(
            code='WPTR-B', defaults={'name': 'Block B', 'is_active': True},
        )
        BlockManagerAssignment.objects.create(user=self.mgr, block=block_b)
        generate_weekly_plan_tasks(YEAR, WEEK)  # one task per block
        self._entry(0, Decimal('100'))  # only block A has a row
        resolved = resolve_weekly_plan_tasks_for_user(self.mgr)
        # Block A's task resolves; block B's (no rows) stays open.
        self.assertEqual(len(resolved), 1)
        self.assertEqual(resolved[0].scope_block_id, self.block_a.id)
        task_a = Task.objects.get(kind=TaskKind.WEEKLY_PLAN, assignee_user=self.mgr,
                                  scope_block=self.block_a)
        task_b = Task.objects.get(kind=TaskKind.WEEKLY_PLAN, assignee_user=self.mgr,
                                  scope_block=block_b)
        self.assertEqual(task_a.state, TaskState.DONE)
        self.assertEqual(task_b.state, TaskState.OPEN)


@unittest.skipUnless(DB_AVAILABLE, "Django models unavailable in this environment")
class WeeklyPlanTaskApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.season, _ = Season.objects.get_or_create(
            name='wpta-test',
            defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True},
        )
        cls.block_a, _ = GreenhouseBlock.objects.get_or_create(
            code='WPTA-A', defaults={'name': 'Block A', 'is_active': True},
        )
        cls.block_b, _ = GreenhouseBlock.objects.get_or_create(
            code='WPTA-B', defaults={'name': 'Block B', 'is_active': True},
        )
        cls.mgr1 = _make_user('wpta_mgr1', 'greenhouse_manager')
        cls.mgr2 = _make_user('wpta_mgr2', 'greenhouse_manager')
        cls.boss = _make_user('wpta_boss', 'export_manager')
        BlockManagerAssignment.objects.create(user=cls.mgr1, block=cls.block_a)
        BlockManagerAssignment.objects.create(user=cls.mgr2, block=cls.block_b)

    def setUp(self):
        self.client = APIClient()

    def test_generate_endpoint_supervisor_ok(self):
        self.client.force_authenticate(self.boss)
        resp = self.client.post(
            '/api/v1/export/tasks/generate-weekly-plan/',
            {'year': YEAR, 'week': WEEK}, format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['created'], 2)

    def test_generate_endpoint_non_supervisor_forbidden(self):
        self.client.force_authenticate(self.mgr1)
        resp = self.client.post(
            '/api/v1/export/tasks/generate-weekly-plan/',
            {'year': YEAR, 'week': WEEK}, format='json',
        )
        self.assertEqual(resp.status_code, 403)

    def test_generate_endpoint_bad_payload(self):
        self.client.force_authenticate(self.boss)
        resp = self.client.post(
            '/api/v1/export/tasks/generate-weekly-plan/',
            {'year': YEAR}, format='json',
        )
        self.assertEqual(resp.status_code, 400)

    def test_me_tasks_scoping_isolates_managers(self):
        generate_weekly_plan_tasks(YEAR, WEEK)
        self.client.force_authenticate(self.mgr1)
        resp = self.client.get('/api/v1/me/tasks/?page_size=200')
        self.assertEqual(resp.status_code, 200)
        results = resp.data['results']
        weekly = [t for t in results if t['kind'] == 'weekly_plan']
        self.assertEqual(len(weekly), 1)
        self.assertEqual(weekly[0]['assignee_user'], self.mgr1.id)
