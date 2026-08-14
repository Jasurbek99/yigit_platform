"""Tests for Phase C — supply draft creation (nullable block weights)."""
from decimal import Decimal

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
