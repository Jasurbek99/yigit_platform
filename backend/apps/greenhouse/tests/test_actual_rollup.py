"""Tests for the daily HarvestDayEntry actual_value rollup.

The rollup buckets shipments by the day encoded in the numeric shipment_code
(`DDMMNNN/YY`), NOT loading_started_at. Covers:
- Block sum is written correctly when shipments' codes encode the target date.
- A shipment with NULL loading_started_at is still counted (the key fix).
- A shipment whose code encodes a DIFFERENT date is excluded.
- Sub-block (F1) sources fold into their parent block (F) entry.
- admin_override rows are skipped (overwritten only with force=True).
- Silent gap reporting for shipments with no ShipmentBlockSource rows.
- dry_run does not mutate the database.
"""
import unittest
from datetime import date
from decimal import Decimal

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
        GreenhouseConfig.get_solo()

        cls.season, _ = Season.objects.get_or_create(
            name='2025-RU',
            defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True},
        )
        cls.block_a, _ = GreenhouseBlock.objects.get_or_create(
            code='RU-A', defaults={'name': 'Block A', 'is_active': True},
        )
        cls.block_b, _ = GreenhouseBlock.objects.get_or_create(
            code='RU-B', defaults={'name': 'Block B', 'is_active': True},
        )
        # Sub-block under A — sources on it must fold into A's entry.
        cls.block_a1, _ = GreenhouseBlock.objects.get_or_create(
            code='RU-A1', defaults={'name': 'Block A1', 'is_active': True, 'parent': cls.block_a},
        )
        cls.status, _ = ShipmentStatusType.objects.get_or_create(
            code='yuklenme_ru',
            defaults={'name_tk': 'yuklenme', 'name_en': 'Loading', 'step_order': 1, 'phase': 'LOADING'},
        )

        cls.target_date = date(2026, 5, 7)  # → code prefix "0705", year "26"

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
        for entry in (self.entry_a, self.entry_b):
            entry.actual_value = None
            entry.actual_source = ''
            entry.actual_finalized_at = None
            entry.last_override_at = None
            entry.last_override_by = None
            entry.last_override_reason = ''
            entry.save()

    # ── helpers ────────────────────────────────────────────────────────

    @staticmethod
    def _code(seq: int, d: date) -> str:
        """Numeric shipment code DDMMNNN/YY encoding date d."""
        return f'{d.day:02d}{d.month:02d}{seq:03d}/{d.year % 100:02d}'

    @classmethod
    def _make_shipment(cls, seq, *, blocks=None, code_date=None, loading_started_at=None):
        """Create a Shipment (code encodes code_date, default target_date) + sources."""
        code_date = code_date or cls.target_date
        s = Shipment.objects.create(
            shipment_code=cls._code(seq, code_date),
            date=code_date,
            season=cls.season,
            status=cls.status,
            loading_started_at=loading_started_at,
        )
        for block, kg in (blocks or []):
            ShipmentBlockSource.objects.create(shipment=s, block=block, weight_kg=kg)
        return s

    # ── tests ──────────────────────────────────────────────────────────

    def test_writes_block_total_from_two_shipments(self):
        self._make_shipment(1, blocks=[(self.block_a, Decimal('5000.00'))])
        self._make_shipment(2, blocks=[(self.block_a, Decimal('3500.00'))])

        result = rollup_actuals_for_date(self.target_date)

        self.entry_a.refresh_from_db()
        self.assertEqual(self.entry_a.actual_value, Decimal('8500.00'))
        self.assertEqual(self.entry_a.actual_source, 'shipment_rollup')
        self.assertIsNotNone(self.entry_a.actual_finalized_at)
        self.assertEqual(result.entries_updated, 1)
        self.assertEqual(result.blocks_with_shipments, 1)

    def test_null_loading_started_at_still_counted(self):
        """The key fix: a shipment with NULL loading_started_at is bucketed by
        its code date and rolled up (previously it was invisible)."""
        self._make_shipment(3, blocks=[(self.block_a, Decimal('4200.00'))], loading_started_at=None)

        rollup_actuals_for_date(self.target_date)

        self.entry_a.refresh_from_db()
        self.assertEqual(self.entry_a.actual_value, Decimal('4200.00'))

    def test_wrong_date_code_excluded(self):
        """A shipment whose code encodes a different day is not counted."""
        self._make_shipment(4, blocks=[(self.block_a, Decimal('999.00'))], code_date=date(2026, 5, 6))

        result = rollup_actuals_for_date(self.target_date)

        self.entry_a.refresh_from_db()
        self.assertIsNone(self.entry_a.actual_value)
        self.assertEqual(result.blocks_with_shipments, 0)

    def test_sub_block_folds_into_parent(self):
        """A source on sub-block A1 rolls into block A's HarvestDayEntry."""
        self._make_shipment(5, blocks=[(self.block_a1, Decimal('1500.00'))])

        rollup_actuals_for_date(self.target_date)

        self.entry_a.refresh_from_db()
        self.assertEqual(self.entry_a.actual_value, Decimal('1500.00'))

    def test_skips_admin_override_row(self):
        self.entry_a.actual_value = Decimal('9999.00')
        self.entry_a.actual_source = 'admin_override'
        self.entry_a.save()
        self._make_shipment(6, blocks=[(self.block_a, Decimal('1000.00'))])

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
        self._make_shipment(7, blocks=[(self.block_a, Decimal('2000.00'))])

        result = rollup_actuals_for_date(self.target_date, force=True)

        self.entry_a.refresh_from_db()
        self.assertEqual(self.entry_a.actual_value, Decimal('2000.00'))
        self.assertEqual(self.entry_a.actual_source, 'shipment_rollup')
        self.assertEqual(result.entries_updated, 1)

    def test_reports_shipments_without_block_sources(self):
        gap = self._make_shipment(8, blocks=[])
        self._make_shipment(9, blocks=[(self.block_b, Decimal('500.00'))])

        result = rollup_actuals_for_date(self.target_date)

        gap_ids = [sid for sid, _ in result.shipments_without_blocks]
        self.assertIn(gap.id, gap_ids)
        self.entry_b.refresh_from_db()
        self.assertEqual(self.entry_b.actual_value, Decimal('500.00'))

    def test_dry_run_does_not_write(self):
        self._make_shipment(10, blocks=[(self.block_a, Decimal('7777.00'))])

        result = rollup_actuals_for_date(self.target_date, dry_run=True)

        self.entry_a.refresh_from_db()
        self.assertIsNone(self.entry_a.actual_value)
        self.assertEqual(self.entry_a.actual_source, '')
        self.assertEqual(result.entries_updated, 1)
        self.assertTrue(result.dry_run)
