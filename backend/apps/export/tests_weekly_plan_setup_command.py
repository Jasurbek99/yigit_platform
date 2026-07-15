"""Test for the run_weekly_plan_setup daily command.

The command composes two already-tested services (initialize_upcoming_weeks +
generate_weekly_plan_tasks); this is a smoke test that a single invocation both
initializes the current+next week for all active blocks AND generates the
manager's plan tasks for those weeks, and that a re-run is idempotent.

Usage:
    python manage.py test apps.export.tests_weekly_plan_setup_command --verbosity=2
"""
import unittest

from django.core.management import call_command
from django.test import TestCase

try:
    from apps.core.models import GreenhouseBlock, GreenhouseConfig, Season, User
    from apps.export.models import Task, TaskKind
    from apps.greenhouse.models import BlockManagerAssignment, WeeklyHarvestPlan
    DB_AVAILABLE = True
except Exception:  # pragma: no cover
    DB_AVAILABLE = False


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

    def test_command_initializes_weeks_and_generates_tasks(self):
        call_command('run_weekly_plan_setup')

        # Two ISO weeks (current + next) initialized, each with both active blocks.
        weeks = set(
            WeeklyHarvestPlan.objects.filter(season=self.season)
            .values_list('year', 'week_number')
        )
        self.assertEqual(len(weeks), 2)
        for year, week in weeks:
            codes = set(
                WeeklyHarvestPlan.objects.filter(
                    season=self.season, year=year, week_number=week,
                ).values_list('block__code', flat=True)
            )
            self.assertEqual(codes, {'WPS-A', 'WPS-B'})

        # One plan task per week for the manager's assigned block (2 total).
        tasks = Task.objects.filter(
            kind=TaskKind.WEEKLY_PLAN, assignee_user=self.mgr, scope_block=self.block_a,
        )
        self.assertEqual(tasks.count(), 2)

    def test_rerun_is_idempotent(self):
        call_command('run_weekly_plan_setup')
        call_command('run_weekly_plan_setup')

        self.assertEqual(
            WeeklyHarvestPlan.objects.filter(season=self.season).count(), 4,  # 2 blocks × 2 weeks
        )
        self.assertEqual(
            Task.objects.filter(
                kind=TaskKind.WEEKLY_PLAN, assignee_user=self.mgr, scope_block=self.block_a,
            ).count(),
            2,
        )
