"""Tests for initialize_upcoming_weeks — the cron-driven weekly grid backfill.

initialize_upcoming_weeks() guarantees block managers always open a complete
weekly-plan grid (every active top-level block present, with its seven Mon–Sun
day-entry cells) for the current and next ISO week, without waiting for an admin
to click "Initialize Week". It is idempotent so it can run on a cron cadence.

Usage:
    python manage.py test apps.greenhouse.tests.test_initialize_upcoming_weeks --verbosity=2
"""
import datetime
import unittest

try:
    from django.test import TestCase

    from apps.core.models import GreenhouseBlock, GreenhouseConfig, Season
    from apps.greenhouse.models import HarvestDayEntry, WeeklyHarvestPlan
    from apps.greenhouse.services import initialize_upcoming_weeks

    DB_AVAILABLE = True
except Exception:  # pragma: no cover
    DB_AVAILABLE = False


@unittest.skipUnless(DB_AVAILABLE, "Django test DB unavailable in this environment")
class TestInitializeUpcomingWeeks(TestCase):
    """DB-backed tests for the current + next week auto-initialize."""

    TODAY = datetime.date(2026, 7, 13)  # ISO 2026-W29, a Monday

    @classmethod
    def setUpTestData(cls):
        GreenhouseConfig.get_solo()

        # Ensure exactly one active season so get_active_season() is deterministic.
        Season.objects.update(is_active=False)
        cls.season = Season.objects.create(
            name='2026-UP',
            start_date='2025-09-01',
            end_date='2026-08-31',
            is_active=True,
        )
        cls.block_a = GreenhouseBlock.objects.create(
            code='UP-A', name='Up A', is_active=True,
        )
        cls.block_b = GreenhouseBlock.objects.create(
            code='UP-B', name='Up B', is_active=True,
        )
        # An inactive block must be excluded from the backfill.
        cls.block_inactive = GreenhouseBlock.objects.create(
            code='UP-X', name='Up X', is_active=False,
        )

    def _weeks(self):
        this_iso = self.TODAY.isocalendar()
        next_iso = (self.TODAY + datetime.timedelta(days=7)).isocalendar()
        return [(this_iso.year, this_iso.week), (next_iso.year, next_iso.week)]

    def test_creates_both_weeks_for_all_active_blocks(self):
        result = initialize_upcoming_weeks(self.TODAY)
        self.assertEqual(result, self._weeks())

        for year, week in self._weeks():
            plans = WeeklyHarvestPlan.objects.filter(
                season=self.season, year=year, week_number=week,
            )
            # Both active blocks present, inactive one excluded.
            self.assertEqual(
                set(plans.values_list('block__code', flat=True)), {'UP-A', 'UP-B'},
            )
            # Seven Mon–Sun day-entry cells per plan.
            for plan in plans:
                self.assertEqual(
                    HarvestDayEntry.objects.filter(weekly_plan=plan).count(), 7,
                )

    def test_idempotent(self):
        initialize_upcoming_weeks(self.TODAY)
        initialize_upcoming_weeks(self.TODAY)  # second run must not duplicate

        year, week = self._weeks()[0]
        self.assertEqual(
            WeeklyHarvestPlan.objects.filter(
                season=self.season, year=year, week_number=week,
            ).count(),
            2,
        )
        plan = WeeklyHarvestPlan.objects.get(
            season=self.season, year=year, week_number=week, block=self.block_a,
        )
        self.assertEqual(HarvestDayEntry.objects.filter(weekly_plan=plan).count(), 7)

    def test_no_active_season_is_noop(self):
        Season.objects.update(is_active=False)
        result = initialize_upcoming_weeks(self.TODAY)
        self.assertEqual(result, [])
        self.assertEqual(WeeklyHarvestPlan.objects.count(), 0)
