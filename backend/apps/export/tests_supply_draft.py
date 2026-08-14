"""Tests for Phase C — supply draft creation (nullable block weights)."""
from decimal import Decimal
from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from apps.core.models import GreenhouseBlock, Season, ShipmentStatusType
from apps.export.models import Shipment, ShipmentBlockSource


class BlockSourceNullableWeightTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.season = Season.objects.create(
            name='2025-2026', is_active=True,
            start_date='2025-09-01', end_date='2026-06-30',
        )
        cls.draft = ShipmentStatusType.objects.create(
            code='draft', name_tk='Garalama', step_order=0,
        )
        cls.block = GreenhouseBlock.objects.create(code='JA', name='JA')
        cls.shipment = Shipment.objects.create(
            shipment_code='0101001/26', status=cls.draft, season=cls.season,
            date='2026-01-01',
        )

    def test_block_source_allows_null_weight(self):
        bs = ShipmentBlockSource.objects.create(
            shipment=self.shipment, block=self.block, weight_kg=None,
        )
        bs.refresh_from_db()
        self.assertIsNone(bs.weight_kg)


class NormalizeBlockSourcesNullTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.season = Season.objects.create(
            name='2025-2026', is_active=True,
            start_date='2025-09-01', end_date='2026-06-30',
        )
        cls.draft = ShipmentStatusType.objects.create(
            code='draft', name_tk='Garalama', step_order=0,
        )
        # 'JB' must be a genuine sub-block (parent set) — the command only
        # touches shipments whose block_sources include a sub-block id.
        cls.parent_block = GreenhouseBlock.objects.create(code='J', name='J')
        cls.block = GreenhouseBlock.objects.create(
            code='JB', name='JB', parent=cls.parent_block,
        )
        cls.shipment = Shipment.objects.create(
            shipment_code='0101002/26', status=cls.draft, season=cls.season,
            date='2026-01-01',
        )
        cls.source = ShipmentBlockSource.objects.create(
            shipment=cls.shipment, block=cls.block, weight_kg=None,
        )

    def test_normalize_skips_null_weight_rows(self):
        out = StringIO()
        # Must not raise decimal.InvalidOperation.
        call_command('normalize_block_sources', stdout=out)

    def test_apply_does_not_delete_unweighed_block_source(self):
        # write_block_sources(replace=True) deletes all existing rows then
        # rewrites from `entries`. A null-weight row must never be silently
        # erased just because it has nothing to normalize yet.
        out = StringIO()
        call_command('normalize_block_sources', '--apply', stdout=out)
        self.assertTrue(
            ShipmentBlockSource.objects.filter(pk=self.source.pk).exists()
        )
