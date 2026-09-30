"""Test for the run_weekly_plan_setup daily command.

The command composes two already-tested services (initialize_upcoming_weeks +
generate_weekly_plan_tasks). A single invocation initializes the current+next
week for all active blocks every day; from Friday (plan_deadline_weekday) it
also generates the managers' plan tasks for NEXT week only (owner rule
2026-09-29, docs/Tasks.md item 1). A re-run is idempotent.

Usage:
    python manage.py test apps.export.tests_weekly_plan_setup_command --verbosity=2
"""
import unittest
from datetime import date, datetime, time
from zoneinfo import ZoneInfo

from django.core.management import call_command
from django.test import TestCase

try:
    from apps.core.models import GreenhouseBlock, GreenhouseConfig, Season, User
    from apps.export.models import Task, TaskKind
    from apps.greenhouse.models import BlockManagerAssignment, WeeklyHarvestPlan
    DB_AVAILABLE = True
except Exception:  # pragma: no cover
    DB_AVAILABLE = False

FRIDAY = '2026-05-22'      # ISO 2026-W21 → the task targets W22
THURSDAY = '2026-05-21'


@unittest.skipUnless(DB_AVAILABLE, "Django models unavailable in this environment")
class RunWeeklyPlanSetupCommandTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        GreenhouseConfig.get_solo()
        Season.objects.update(is_active=False)  # deterministic active season
        cls.season = Season.objects.create(
            name='wps-cmd', start_date='2025-09-01', end_date='2026-08-31', is_active=True,
        )
        cls.block_a = GreenhouseBlock.objects.create(code='WPS-A', name='A', is_active=True)
        cls.block_b = GreenhouseBlock.objects.create(code='WPS-B', name='B', is_active=True)
        cls.mgr = User(username='wps_mgr', role='greenhouse_manager')
        cls.mgr.set_password('pass')
        cls.mgr.save()
        BlockManagerAssignment.objects.create(user=cls.mgr, block=cls.block_a)

    def test_friday_initializes_both_weeks_and_tasks_next_week_only(self):
        call_command('run_weekly_plan_setup', today=FRIDAY)

        weeks = set(
            WeeklyHarvestPlan.objects.filter(season=self.season)
            .values_list('year', 'week_number')
        )
        self.assertEqual(weeks, {(2026, 21), (2026, 22)})
        for year, week in weeks:
            codes = set(
                WeeklyHarvestPlan.objects.filter(
                    season=self.season, year=year, week_number=week,
                ).values_list('block__code', flat=True)
            )
            self.assertEqual(codes, {'WPS-A', 'WPS-B'})

        tasks = Task.objects.filter(kind=TaskKind.WEEKLY_PLAN, assignee_user=self.mgr)
        self.assertEqual(list(tasks.values_list('scope_year', 'scope_week')), [(2026, 22)])
        self.assertEqual(
            tasks.get().deadline,
            datetime.combine(date(2026, 5, 22), time(23, 59, 59), tzinfo=ZoneInfo('Asia/Ashgabat')),
        )

    def test_before_friday_initializes_weeks_but_creates_no_task(self):
        call_command('run_weekly_plan_setup', today=THURSDAY)
        self.assertEqual(WeeklyHarvestPlan.objects.filter(season=self.season).count(), 4)
        self.assertFalse(Task.objects.filter(kind=TaskKind.WEEKLY_PLAN).exists())

    def test_no_active_season_creates_nothing(self):
        Season.objects.update(is_active=False)
        call_command('run_weekly_plan_setup', today=FRIDAY)
        self.assertFalse(Task.objects.filter(kind=TaskKind.WEEKLY_PLAN).exists())

    def test_celery_task_runs_the_same_setup(self):
        """The beat entry ('apps.export.tasks.run_weekly_plan_setup') must reach
        the command — a typo'd task path fails silently in beat, which is the
        exact failure mode this schedule was added to replace. It runs on the
        real date, so only the date-independent half (the grid) is asserted."""
        from apps.export.tasks import run_weekly_plan_setup

        run_weekly_plan_setup()  # eager: CELERY_TASK_ALWAYS_EAGER under tests

        self.assertTrue(WeeklyHarvestPlan.objects.filter(season=self.season).exists())

    def test_rerun_is_idempotent(self):
        call_command('run_weekly_plan_setup', today=FRIDAY)
        call_command('run_weekly_plan_setup', today=FRIDAY)

        self.assertEqual(
            WeeklyHarvestPlan.objects.filter(season=self.season).count(), 4,  # 2 blocks × 2 weeks
        )
        self.assertEqual(
            Task.objects.filter(kind=TaskKind.WEEKLY_PLAN, assignee_user=self.mgr).count(),
            1,
        )
