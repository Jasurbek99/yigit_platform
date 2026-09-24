"""Loads drain the batch the operator picked, not the oldest one (2026-09-24)."""
from datetime import date, timedelta
from decimal import Decimal

from django.test import TestCase

from apps.core.models import GreenhouseBlock, Season, ShipmentStatusType
from apps.export.models import Shipment, ShipmentBlockSource
from apps.export.services.gaplama import build_gaplama_board
from apps.greenhouse.models import HarvestDayEntry, WeeklyHarvestPlan


class BatchConsumptionTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.mon = date(2026, 6, 1)
        cls.wed = cls.mon + timedelta(days=2)
        Season.objects.update(is_active=False)
        cls.season = Season.objects.create(
            name='BC-season',
            start_date=cls.mon - timedelta(days=200),
            end_date=cls.mon + timedelta(days=200),
            is_active=True,
        )
        cls.block = GreenhouseBlock.objects.create(code='BC', carry_days=7, is_active=True)
        plan = WeeklyHarvestPlan.objects.create(
            season=cls.season, block=cls.block,
            week_number=cls.mon.isocalendar().week, year=cls.mon.isocalendar().year,
        )
        for offset, kg in ((0, '4000'), (2, '9000')):
            HarvestDayEntry.objects.create(
                weekly_plan=plan, season=cls.season, block=cls.block,
                entry_date=cls.mon + timedelta(days=offset), weekday=offset,
                plan_value=Decimal(kg),
            )
        # DJANGO_TESTING=true skips the seeding migration for the 'draft' status
        # (apps/core/migrations/0006_seed_shipment_draft_status.py) — create it
        # directly, matching tests_draft_promote.py / tests_gaplama_board.py.
        cls.status, _ = ShipmentStatusType.objects.get_or_create(
            code='draft',
            defaults={
                'name_tk': 'draft', 'name_en': 'Draft', 'name_ru': 'Draft',
                'step_order': 0, 'phase': 'PREP',
            },
        )

    def _truck(self, harvest_date, kg):
        # Shipment has no is_draft field (draft-ness lives entirely in
        # status.code == 'draft', see status seeding above); shipment_code is
        # unique=True with no auto-default, so it must be set explicitly, same
        # as the _truck helper in tests_gaplama_board.py.
        shipment = Shipment.objects.create(
            shipment_code=f'BC{Shipment.objects.count()}',
            season=self.season, date=self.wed, status=self.status,
        )
        ShipmentBlockSource.objects.create(
            shipment=shipment, block=self.block,
            weight_kg=Decimal(kg), harvest_date=harvest_date,
        )
        return shipment

    def _breakdown(self, day):
        board = build_gaplama_board(day, day, self.season)
        row = next(r for r in board['days'] if r['block_id'] == self.block.id)
        return {b['origin_date']: b['kg'] for b in row['carry_in_breakdown']}

    def test_picking_the_fresh_batch_leaves_the_old_one_alone(self):
        """4 000 from Monday stays whole; Wednesday's own 9 000 takes the hit."""
        self._truck(self.wed, '9000')
        thursday = self.mon + timedelta(days=3)
        board = build_gaplama_board(thursday, thursday, self.season)
        row = next(r for r in board['days'] if r['block_id'] == self.block.id)
        breakdown = {b['origin_date']: b['kg'] for b in row['carry_in_breakdown']}
        self.assertEqual(breakdown.get(self.mon), Decimal('4000'))
        # Cheap proof the totals still balance on the named path, not just the
        # per-bucket breakdown: 4000 is the only kg live anywhere for this block.
        self.assertEqual(row['available_kg'], Decimal('4000'))

    def test_picking_the_old_batch_drains_it(self):
        self._truck(self.mon, '4000')
        thursday = self.mon + timedelta(days=3)
        self.assertNotIn(self.mon, self._breakdown(thursday))

    def test_null_harvest_date_falls_back_to_fifo(self):
        """Review Focus 1 — every pre-2026-09-24 row has a null harvest_date."""
        self._truck(None, '4000')
        thursday = self.mon + timedelta(days=3)
        self.assertNotIn(self.mon, self._breakdown(thursday))

    def test_expired_batch_date_falls_back_to_fifo(self):
        """Review Focus 2 — an edit days later can name a bucket that is gone.

        long_ago (60 days back) is outside the walk window entirely (walk_start
        is Thursday - 14), so this load can never match a live bucket — its
        4000 kg must rejoin the FIFO pool and drain Monday's carry-in, same as
        an unnamed (null harvest_date) load would. Asserting the exact
        breakdown (not just "Monday absent" + "available_kg >= 0", both of
        which hold trivially even if this weight silently vanished instead of
        draining anything) is what makes this test bite: {Wed: 9000} only
        holds if Monday's bucket was actually drained, not merely never
        rendered old/dropped.
        """
        self._truck(self.mon - timedelta(days=60), '4000')
        thursday = self.mon + timedelta(days=3)
        self.assertEqual(self._breakdown(thursday), {self.wed: Decimal('9000')})
