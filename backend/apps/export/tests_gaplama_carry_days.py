"""Each block expires its own buckets; the walk window is shared (2026-09-24)."""
from datetime import date, timedelta
from decimal import Decimal

from django.test import TestCase

from apps.core.models import GreenhouseBlock, Season
from apps.export.services.gaplama import build_gaplama_board
from apps.greenhouse.models import HarvestDayEntry, WeeklyHarvestPlan


class PerBlockCarryDaysTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.monday = date(2026, 6, 1)
        Season.objects.update(is_active=False)
        cls.season = Season.objects.create(
            name='CD-season',
            start_date=cls.monday - timedelta(days=200),
            end_date=cls.monday + timedelta(days=200),
            is_active=True,
        )
        # Short keeps a leftover for 2 days, long for 7. Same plan, same day.
        cls.short = GreenhouseBlock.objects.create(code='SHORT', carry_days=2, is_active=True)
        cls.long = GreenhouseBlock.objects.create(code='LONG', carry_days=7, is_active=True)
        for block in (cls.short, cls.long):
            plan = WeeklyHarvestPlan.objects.create(
                season=cls.season, block=block,
                week_number=cls.monday.isocalendar().week, year=cls.monday.isocalendar().year,
            )
            HarvestDayEntry.objects.create(
                weekly_plan=plan, season=cls.season, block=block,
                entry_date=cls.monday, weekday=0, plan_value=Decimal('10000'),
            )

    def _available_on(self, day, block_id):
        board = build_gaplama_board(day, day, self.season)
        row = next(r for r in board['days'] if r['block_id'] == block_id)
        return row['available_kg']

    def test_short_block_expires_before_the_long_one(self):
        """Monday's 10 000 is still live on Thursday for LONG, gone for SHORT."""
        thursday = self.monday + timedelta(days=3)
        self.assertEqual(self._available_on(thursday, self.long.id), Decimal('10000'))
        self.assertEqual(self._available_on(thursday, self.short.id), Decimal('0'))

    def test_breakdown_carries_the_age_in_days(self):
        wednesday = self.monday + timedelta(days=2)
        board = build_gaplama_board(wednesday, wednesday, self.season)
        row = next(r for r in board['days'] if r['block_id'] == self.long.id)
        self.assertEqual(
            row['carry_in_breakdown'],
            [{'origin_date': self.monday, 'kg': Decimal('10000'), 'age_days': 2}],
        )
