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


class WalkWindowSizedByWidestBlockTests(TestCase):
    """Neither fixture above proves the walk WINDOW (walk_start) is sized by the
    widest block's carry_days — both sit inside a 4-day lookback that a window
    sized by the SHORT block (2) or the pre-2026-09-24 global constant (also 2)
    would satisfy just as well. If walk_start were ever narrowed off the widest
    block, a long-carry block's older bucket would silently vanish from the
    board and nothing above would catch it.
    """

    @classmethod
    def setUpTestData(cls):
        cls.query_day = date(2026, 6, 20)
        Season.objects.update(is_active=False)
        cls.season = Season.objects.create(
            name='WW-season',
            start_date=cls.query_day - timedelta(days=200),
            end_date=cls.query_day + timedelta(days=200),
            is_active=True,
        )
        cls.short = GreenhouseBlock.objects.create(code='WWSHORT', carry_days=2, is_active=True)
        cls.long = GreenhouseBlock.objects.create(code='WWLONG', carry_days=7, is_active=True)

        # walk_start = from_date - 2 * max_carry_days (gaplama.py). max_carry_days
        # here must be 7 (LONG) for the entry below to be seen at all — a walk
        # sized by SHORT (2) or a constant 2 computes walk_start = query_day - 4
        # and the DB query for plan_rows never even fetches this entry_date.
        #
        # entry_date = query_day - 7 sits in the one narrow band that proves it:
        #   >= query_day - 14  (inside the correct/wide window -> must be seen)
        #   <  query_day - 4   (outside a narrow window sized by 2 -> must be missed)
        # and its age at query_day is exactly 7 — equal to LONG's own carry_days,
        # so LONG's per-block bucket expiry (`age > carry_days`) has not evicted it
        # either. Only a window-sizing regression can make this bucket disappear.
        cls.entry_date = cls.query_day - timedelta(days=7)
        plan = WeeklyHarvestPlan.objects.create(
            season=cls.season, block=cls.long,
            week_number=cls.entry_date.isocalendar().week,
            year=cls.entry_date.isocalendar().year,
        )
        HarvestDayEntry.objects.create(
            weekly_plan=plan, season=cls.season, block=cls.long,
            entry_date=cls.entry_date, weekday=cls.entry_date.weekday(),
            plan_value=Decimal('5000'),
        )

    def test_long_block_bucket_survives_only_if_window_uses_the_widest_carry_days(self):
        board = build_gaplama_board(self.query_day, self.query_day, self.season)
        row = next(r for r in board['days'] if r['block_id'] == self.long.id)
        origins = {b['origin_date'] for b in row['carry_in_breakdown']}
        self.assertIn(self.entry_date, origins)
