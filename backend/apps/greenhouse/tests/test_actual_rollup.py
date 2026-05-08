"""Tests for the daily HarvestDayEntry actual_value rollup.

Covers:
- Block sum is written correctly when shipments load on the target date.
- admin_override rows are skipped (and overwritten only with force=True).
- Timezone correctness — shipments at the day-boundary in UTC land in the
  right local day's rollup.
- Silent gap reporting — shipments with loading_started_at but no
  ShipmentBlockSource rows are surfaced.
- dry_run does not mutate the database.
"""
import unittest
from datetime import date, datetime, timedelta, timezone as dt_timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.test import TestCase

try:
    from apps.core.models import (
        GreenhouseBlock, GreenhouseConfig, Season, ShipmentStatusType,
    )
    from apps.export.models import Shipment, ShipmentBlockSource
    from apps.greenhouse.models import HarvestDayEntry, WeeklyHarvestPlan
    from apps.greenhouse.services import rollup_actuals_for_date
    DB_AVAILABLE = True
except Exception:  # pragma: no cover — only fires if the test DB cannot import models
    DB_AVAILABLE = False


@unittest.skipUnless(DB_AVAILABLE, "Django models unavailable in this environment")
class ActualRollupTests(TestCase):
    """End-to-end DB tests for rollup_actuals_for_date."""

    @classmethod
    def setUpTestData(cls):
        # GreenhouseConfig is a singleton; ensure it exists with default tz.
        GreenhouseConfig.get_solo()

        cls.season, _ = Season.objects.get_or_create(
            name='2025-RU',
            defaults={
                'start_date': '2025-09-01',
                'end_date': '2026-06-30',
                'is_active': True,
            },
        )
        cls.block_a, _ = GreenhouseBlock.objects.get_or_create(
            code='RU-A', defaults={'name': 'Block A', 'is_active': True},
        )
        cls.block_b, _ = GreenhouseBlock.objects.get_or_create(
            code='RU-B', defaults={'name': 'Block B', 'is_active': True},
        )
        cls.status, _ = ShipmentStatusType.objects.get_or_create(
            code='yuklenme_ru',
            defaults={
                'name_tk': 'yuklenme', 'name_en': 'Loading',
                'step_order': 1, 'phase': 'LOADING',
            },
        )

        cls.target_date = date(2026, 5, 7)  # Thursday

        # WeeklyHarvestPlan + HarvestDayEntry for both blocks on target_date
        plan_a, _ = WeeklyHarvestPlan.objects.get_or_create(
            season=cls.season, block=cls.block_a, week_number=19, year=2026,
        )
        plan_b, _ = WeeklyHarvestPlan.objects.get_or_create(
            season=cls.season, block=cls.block_b, week_number=19, year=2026,
        )
        cls.entry_a, _ = HarvestDayEntry.objects.get_or_create(
            weekly_plan=plan_a, entry_date=cls.target_date,
            defaults={'season': cls.season, 'block': cls.block_a, 'weekday': 3},
        )
        cls.entry_b, _ = HarvestDayEntry.objects.get_or_create(
            weekly_plan=plan_b, entry_date=cls.target_date,
            defaults={'season': cls.season, 'block': cls.block_b, 'weekday': 3},
        )

    def setUp(self):
        # Reset entries between tests since setUpTestData is class-level.
        for entry in (self.entry_a, self.entry_b):
            entry.actual_value = None
            entry.actual_source = ''
            entry.actual_finalized_at = None
            entry.last_override_at = None
            entry.last_override_by = None
            entry.last_override_reason = ''
            entry.save()

    # ── helpers ────────────────────────────────────────────────────────

    @classmethod
    def _make_shipment(cls, cargo_code: str, loading_started_at, *, blocks=None):
        """Create a Shipment + optional ShipmentBlockSource rows."""
        s = Shipment.objects.create(
            cargo_code=cargo_code,
            date=cls.target_date,
            season=cls.season,
            status=cls.status,
            loading_started_at=loading_started_at,
        )
        for block, kg in (blocks or []):
            ShipmentBlockSource.objects.create(shipment=s, block=block, weight_kg=kg)
        return s

    @staticmethod
    def _local(d: date, hour: int, minute: int = 0) -> datetime:
        return datetime(d.year, d.month, d.day, hour, minute, tzinfo=ZoneInfo('Asia/Ashgabat'))

    # ── tests ──────────────────────────────────────────────────────────

    def test_writes_block_total_from_two_shipments(self):
        self._make_shipment(
            'ROLL-1', self._local(self.target_date, 8),
            blocks=[(self.block_a, Decimal('5000.00'))],
        )
        self._make_shipment(
            'ROLL-2', self._local(self.target_date, 14),
            blocks=[(self.block_a, Decimal('3500.00'))],
        )

        result = rollup_actuals_for_date(self.target_date)

        self.entry_a.refresh_from_db()
        self.assertEqual(self.entry_a.actual_value, Decimal('8500.00'))
        self.assertEqual(self.entry_a.actual_source, 'shipment_rollup')
        self.assertIsNotNone(self.entry_a.actual_finalized_at)
        self.assertEqual(result.entries_updated, 1)
        self.assertEqual(result.blocks_with_shipments, 1)

    def test_skips_admin_override_row(self):
        self.entry_a.actual_value = Decimal('9999.00')
        self.entry_a.actual_source = 'admin_override'
        self.entry_a.save()

        self._make_shipment(
            'ROLL-3', self._local(self.target_date, 9),
            blocks=[(self.block_a, Decimal('1000.00'))],
        )

        result = rollup_actuals_for_date(self.target_date)

        self.entry_a.refresh_from_db()
        self.assertEqual(self.entry_a.actual_value, Decimal('9999.00'))
        self.assertEqual(self.entry_a.actual_source, 'admin_override')
        self.assertEqual(result.entries_skipped_override, 1)
        self.assertEqual(result.entries_updated, 0)

    def test_force_overwrites_admin_override(self):
        self.entry_a.actual_value = Decimal('9999.00')
        self.entry_a.actual_source = 'admin_override'
        self.entry_a.save()

        self._make_shipment(
            'ROLL-4', self._local(self.target_date, 11),
            blocks=[(self.block_a, Decimal('2000.00'))],
        )

        result = rollup_actuals_for_date(self.target_date, force=True)

        self.entry_a.refresh_from_db()
        self.assertEqual(self.entry_a.actual_value, Decimal('2000.00'))
        self.assertEqual(self.entry_a.actual_source, 'shipment_rollup')
        self.assertEqual(result.entries_updated, 1)
        self.assertEqual(result.entries_skipped_override, 0)

    def test_timezone_boundary_lands_on_correct_local_day(self):
        """A shipment loaded at 22:00 UTC = 03:00 next-day Asia/Ashgabat
        (UTC+5) must roll up under the NEXT local day, not the UTC day."""
        # 22:00 UTC on May 6 = 03:00 local on May 7 (target_date).
        utc_22 = datetime(2026, 5, 6, 22, 0, tzinfo=dt_timezone.utc)
        self._make_shipment(
            'TZ-1', utc_22,
            blocks=[(self.block_a, Decimal('1234.00'))],
        )

        # Roll up the day BEFORE — should find nothing.
        prev_day = self.target_date - timedelta(days=1)
        result_prev = rollup_actuals_for_date(prev_day)
        self.assertEqual(result_prev.blocks_with_shipments, 0)

        # Roll up the target day — should find the shipment.
        result_target = rollup_actuals_for_date(self.target_date)
        self.entry_a.refresh_from_db()
        self.assertEqual(self.entry_a.actual_value, Decimal('1234.00'))
        self.assertEqual(result_target.entries_updated, 1)

    def test_reports_shipments_without_block_sources(self):
        """A shipment with loading_started_at but no block_sources must
        appear in the silent-gap list and not crash the rollup."""
        s = self._make_shipment(
            'GAP-1', self._local(self.target_date, 12), blocks=[],
        )
        # Also create a normal one so the rollup still has work to do.
        self._make_shipment(
            'GAP-OK', self._local(self.target_date, 13),
            blocks=[(self.block_b, Decimal('500.00'))],
        )

        result = rollup_actuals_for_date(self.target_date)

        gap_ids = [sid for sid, _ in result.shipments_without_blocks]
        self.assertIn(s.id, gap_ids)
        # Block B was rolled up normally despite the gap.
        self.entry_b.refresh_from_db()
        self.assertEqual(self.entry_b.actual_value, Decimal('500.00'))

    def test_dry_run_does_not_write(self):
        self._make_shipment(
            'DRY-1', self._local(self.target_date, 10),
            blocks=[(self.block_a, Decimal('7777.00'))],
        )

        result = rollup_actuals_for_date(self.target_date, dry_run=True)

        self.entry_a.refresh_from_db()
        self.assertIsNone(self.entry_a.actual_value)
        self.assertEqual(self.entry_a.actual_source, '')
        # But the result still reports what would have changed.
        self.assertEqual(result.entries_updated, 1)
        self.assertTrue(result.dry_run)
