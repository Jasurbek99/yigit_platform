"""Tests for the Saturday weekly-plan summary and the truck_allocation Task.

Covers:
  - plan_fill_by_manager: per-manager Mon–Sat fill %, denominator from the
    manager's assigned blocks (a never-initialized week is 0%, not complete),
    Sunday ignored, incomplete blocks listed.
  - build_summary_message: total %, worst manager first, capped at 500 chars.
  - send_weekly_plan_summary: export_manager + boss + director only, idempotent.
  - generate_truck_allocation_task: one role-wide export_manager task per week.
  - resolution: closes when every Mon–Sat day that needs a truck has one.
  - run_saturday_plan_summary (the Celery entry point) targets NEXT week.
  - /me/tasks/ read auto-resolves the task.
"""
import datetime
import unittest
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

try:
    from apps.core.models import GreenhouseBlock, Season, TruckDestination, User
    from apps.export.models import (
        Notification,
        Task,
        TaskKind,
        TaskState,
        TruckDestinationSplit,
        WeeklyTruckAllocation,
    )
    from apps.export.services.truck_allocation_tasks import (
        NOTIFICATION_KIND,
        build_summary_message,
        generate_truck_allocation_task,
        plan_fill_by_manager,
        resolve_truck_allocation_tasks,
        run_saturday_plan_summary,
        send_weekly_plan_summary,
        ManagerFill,
    )
    from apps.greenhouse.models import (
        BlockManagerAssignment,
        HarvestDayEntry,
        WeeklyHarvestPlan,
    )
    DB_AVAILABLE = True
except Exception:  # pragma: no cover
    DB_AVAILABLE = False


# ISO week 2026-W39 → Mon 2026-09-21 .. Sun 2026-09-27; Saturday before = 09-19
YEAR = 2026
WEEK = 39
MONDAY = datetime.date(2026, 9, 21)


def _make_user(username: str, role: str, **extra) -> "User":
    user = User(username=username, role=role, **extra)
    user.set_password('pass')
    user.save()
    return user


class _Fixture(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.season, _ = Season.objects.get_or_create(
            name='tat-test',
            defaults={'start_date': '2026-08-01', 'end_date': '2027-06-30', 'is_active': True},
        )
        cls.block_a = GreenhouseBlock.objects.create(code='TAT-A', name='Block A', is_active=True)
        cls.block_b = GreenhouseBlock.objects.create(code='TAT-B', name='Block B', is_active=True)
        cls.block_c = GreenhouseBlock.objects.create(code='TAT-C', name='Block C', is_active=True)
        cls.mgr1 = _make_user('tat_mgr1', 'greenhouse_manager', first_name='Toyly')
        cls.mgr2 = _make_user('tat_mgr2', 'greenhouse_manager')
        BlockManagerAssignment.objects.create(user=cls.mgr1, block=cls.block_a)
        BlockManagerAssignment.objects.create(user=cls.mgr2, block=cls.block_b)
        BlockManagerAssignment.objects.create(user=cls.mgr2, block=cls.block_c)

    def _fill(self, block, days, value=Decimal('100')):
        """Create plan cells for `block` on the given weekday offsets (0=Mon)."""
        plan, _ = WeeklyHarvestPlan.objects.get_or_create(
            season=self.season, block=block, week_number=WEEK, year=YEAR,
        )
        for offset in days:
            d = MONDAY + datetime.timedelta(days=offset)
            HarvestDayEntry.objects.update_or_create(
                weekly_plan=plan, entry_date=d,
                defaults={
                    'season': self.season, 'block': block,
                    'weekday': d.weekday(), 'plan_value': value,
                },
            )


@unittest.skipUnless(DB_AVAILABLE, "Django models unavailable in this environment")
class PlanFillTests(_Fixture):
    def test_per_manager_percent_and_incomplete_blocks(self):
        self._fill(self.block_a, range(6))       # mgr1: 6/6
        self._fill(self.block_b, range(3))       # mgr2: 3 of 12 (B half, C none)
        fills = {f.user_id: f for f in plan_fill_by_manager(YEAR, WEEK)}

        self.assertEqual((fills[self.mgr1.id].filled, fills[self.mgr1.id].total), (6, 6))
        self.assertEqual(fills[self.mgr1.id].percent, 100)
        self.assertEqual(fills[self.mgr1.id].incomplete_blocks, [])

        self.assertEqual((fills[self.mgr2.id].filled, fills[self.mgr2.id].total), (3, 12))
        self.assertEqual(fills[self.mgr2.id].percent, 25)
        self.assertEqual(fills[self.mgr2.id].incomplete_blocks, ['TAT-B', 'TAT-C'])

    def test_uninitialized_week_is_zero_not_complete(self):
        fills = plan_fill_by_manager(YEAR, WEEK)
        self.assertEqual({f.percent for f in fills}, {0})
        self.assertTrue(all(f.total > 0 for f in fills))

    def test_sunday_and_blank_cells_not_counted(self):
        self._fill(self.block_a, range(5))               # Mon–Fri
        self._fill(self.block_a, [5], value=None)        # Sat blank
        self._fill(self.block_a, [6])                    # Sun filled — ignored
        fill = next(f for f in plan_fill_by_manager(YEAR, WEEK) if f.user_id == self.mgr1.id)
        self.assertEqual((fill.filled, fill.total), (5, 6))

    def test_explicit_zero_counts_as_filled(self):
        self._fill(self.block_a, range(6), value=Decimal('0'))
        fill = next(f for f in plan_fill_by_manager(YEAR, WEEK) if f.user_id == self.mgr1.id)
        self.assertEqual(fill.percent, 100)

    def test_inactive_assignment_excluded(self):
        mgr3 = _make_user('tat_mgr3', 'greenhouse_manager')
        BlockManagerAssignment.objects.create(user=mgr3, block=self.block_a, is_active=False)
        self.assertNotIn(mgr3.id, {f.user_id for f in plan_fill_by_manager(YEAR, WEEK)})


@unittest.skipUnless(DB_AVAILABLE, "Django models unavailable in this environment")
class SummaryMessageTests(TestCase):
    def test_total_and_worst_first(self):
        fills = [
            ManagerFill(user_id=1, name='Toyly', filled=6, total=6, incomplete_blocks=[]),
            ManagerFill(user_id=2, name='Maral', filled=3, total=12, incomplete_blocks=['B', 'C']),
        ]
        msg = build_summary_message(YEAR, WEEK, fills)
        self.assertTrue(msg.startswith('W39/2026: 50%'), msg)
        self.assertLess(msg.index('Maral 25% (B, C)'), msg.index('Toyly 100%'))

    def test_capped_at_500_chars_with_remainder_count(self):
        fills = [
            ManagerFill(user_id=i, name=f'Manager number {i}', filled=0, total=6,
                        incomplete_blocks=[f'BLOCK-{i}-X', f'BLOCK-{i}-Y'])
            for i in range(40)
        ]
        msg = build_summary_message(YEAR, WEEK, fills)
        self.assertLessEqual(len(msg), 500)
        self.assertRegex(msg, r'\+\d+$')

    def test_no_managers(self):
        self.assertEqual(build_summary_message(YEAR, WEEK, []), 'W39/2026: 0%')


@unittest.skipUnless(DB_AVAILABLE, "Django models unavailable in this environment")
class SummaryNotificationTests(_Fixture):
    def test_recipients_are_export_manager_boss_director(self):
        em = _make_user('tat_em', 'export_manager')
        boss = _make_user('tat_boss', 'boss')
        director = _make_user('tat_dir', 'director')
        _make_user('tat_doc', 'document_team')
        _make_user('tat_em_off', 'export_manager', is_active=False)

        send_weekly_plan_summary(YEAR, WEEK)

        notified = set(
            Notification.objects.filter(kind=NOTIFICATION_KIND).values_list('user_id', flat=True)
        )
        self.assertEqual(notified, {em.id, boss.id, director.id})
        note = Notification.objects.filter(kind=NOTIFICATION_KIND).first()
        self.assertEqual(note.link, f'/export/plan?week={WEEK}&year={YEAR}')

    def test_rerun_does_not_duplicate(self):
        _make_user('tat_em', 'export_manager')
        self.assertEqual(send_weekly_plan_summary(YEAR, WEEK), 1)
        self.assertEqual(send_weekly_plan_summary(YEAR, WEEK), 0)
        self.assertEqual(Notification.objects.filter(kind=NOTIFICATION_KIND).count(), 1)


@unittest.skipUnless(DB_AVAILABLE, "Django models unavailable in this environment")
class TruckAllocationTaskTests(_Fixture):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.dest_ru = TruckDestination.objects.create(name='TAT Russia', sort_order=1)
        cls.dest_kz = TruckDestination.objects.create(name='TAT Kazakhstan', sort_order=2)

    def _trucks(self, day_of_week, count, dest=None):
        alloc, _ = WeeklyTruckAllocation.objects.get_or_create(
            season=self.season, week_number=WEEK, year=YEAR, day_of_week=day_of_week,
        )
        TruckDestinationSplit.objects.update_or_create(
            truck_allocation=alloc, destination=dest or self.dest_ru,
            defaults={'truck_count': count},
        )

    def _task(self):
        return Task.objects.get(kind=TaskKind.TRUCK_ALLOCATION, scope_year=YEAR, scope_week=WEEK)

    def test_one_role_wide_task_idempotent(self):
        created = generate_truck_allocation_task(YEAR, WEEK)
        self.assertEqual(len(created), 1)
        task = created[0]
        self.assertIsNone(task.shipment_id)
        self.assertIsNone(task.assignee_user_id)
        self.assertEqual(task.assignee_role, 'export_manager')
        self.assertEqual(task.title_key, 'tasks.fill_truck_allocation')
        self.assertEqual(task.link, f'/export/plan?week={WEEK}&year={YEAR}')
        self.assertEqual(task.state, TaskState.OPEN)
        self.assertEqual(generate_truck_allocation_task(YEAR, WEEK), [])

    def test_open_until_every_planned_day_has_trucks(self):
        self._fill(self.block_a, range(6), value=Decimal('20000'))   # every day needs ≥1 truck
        generate_truck_allocation_task(YEAR, WEEK)
        for dow in range(1, 6):                                       # Mon–Fri only
            self._trucks(dow, 1)
        resolve_truck_allocation_tasks()
        self.assertEqual(self._task().state, TaskState.OPEN)

        self._trucks(6, 1, dest=self.dest_kz)                         # Saturday
        resolve_truck_allocation_tasks()
        self.assertEqual(self._task().state, TaskState.DONE)

    def test_zero_truck_split_does_not_count(self):
        self._fill(self.block_a, [0], value=Decimal('20000'))
        generate_truck_allocation_task(YEAR, WEEK)
        self._trucks(1, 0)
        resolve_truck_allocation_tasks()
        self.assertEqual(self._task().state, TaskState.OPEN)

    def test_day_below_one_truck_of_plan_does_not_block(self):
        # Monday 20 t needs a truck; Tuesday 5 t rounds to 0 trucks in the table.
        self._fill(self.block_a, [0], value=Decimal('20000'))
        self._fill(self.block_a, [1], value=Decimal('5000'))
        generate_truck_allocation_task(YEAR, WEEK)
        self._trucks(1, 1)
        resolve_truck_allocation_tasks()
        self.assertEqual(self._task().state, TaskState.DONE)

    def test_empty_week_with_no_trucks_stays_open(self):
        generate_truck_allocation_task(YEAR, WEEK)
        resolve_truck_allocation_tasks()
        self.assertEqual(self._task().state, TaskState.OPEN)

    def test_run_saturday_targets_next_week(self):
        _make_user('tat_em', 'export_manager')
        run_saturday_plan_summary(datetime.date(2026, 9, 19))   # Saturday of W38
        self.assertTrue(
            Task.objects.filter(kind=TaskKind.TRUCK_ALLOCATION, scope_year=YEAR, scope_week=WEEK).exists()
        )
        self.assertEqual(Notification.objects.filter(kind=NOTIFICATION_KIND).count(), 1)

    def test_celery_task_runs(self):
        from apps.export.tasks import send_saturday_plan_summary

        send_saturday_plan_summary.delay()   # CELERY_TASK_ALWAYS_EAGER under tests
        self.assertTrue(Task.objects.filter(kind=TaskKind.TRUCK_ALLOCATION).exists())

    def test_me_tasks_shows_and_resolves_for_export_manager(self):
        em = _make_user('tat_em', 'export_manager')
        self._fill(self.block_a, [0], value=Decimal('20000'))
        generate_truck_allocation_task(YEAR, WEEK)
        self._trucks(1, 2)

        client = APIClient()
        client.force_authenticate(em)
        resp = client.get('/api/v1/me/tasks/')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(self._task().state, TaskState.DONE)
        rows = resp.data['results'] if isinstance(resp.data, dict) else resp.data
        self.assertIn(self._task().id, [r['id'] for r in rows])

    def test_beat_entry_names_a_registered_task(self):
        from django.conf import settings

        from config.celery import app

        app.loader.import_default_modules()
        name = settings.CELERY_BEAT_SCHEDULE['saturday-plan-summary']['task']
        self.assertIn(name, app.tasks)
