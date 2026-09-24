"""A truck may take two batches from one block (2026-09-24)."""
from datetime import date
from decimal import Decimal

from django.test import TestCase

from apps.core.models import Country, GreenhouseBlock, Season, ShipmentStatusType
from apps.export.models import Shipment
from apps.export.services.block_sources import (
    build_block_parent_map,
    merge_to_parent,
    write_block_sources,
)


class MergeToParentBatchTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.parent = GreenhouseBlock.objects.create(code='BP', is_active=True)
        cls.child = GreenhouseBlock.objects.create(code='BP1', parent=cls.parent, is_active=True)

    def test_two_batches_from_one_block_stay_two_rows(self):
        """The old rule summed them and kept the first harvest_date, losing a batch."""
        merged = merge_to_parent(
            [
                {'block': self.parent.id, 'weight_kg': '3000', 'harvest_date': date(2026, 6, 1)},
                {'block': self.parent.id, 'weight_kg': '5000', 'harvest_date': date(2026, 6, 3)},
            ],
            build_block_parent_map(),
        )
        self.assertEqual(
            dict(merged),
            {
                (self.parent.id, date(2026, 6, 1)): {'weight_kg': Decimal('3000')},
                (self.parent.id, date(2026, 6, 3)): {'weight_kg': Decimal('5000')},
            },
        )

    def test_same_batch_twice_is_still_summed(self):
        merged = merge_to_parent(
            [
                {'block': self.parent.id, 'weight_kg': '1000', 'harvest_date': date(2026, 6, 1)},
                {'block': self.parent.id, 'weight_kg': '2000', 'harvest_date': date(2026, 6, 1)},
            ],
            build_block_parent_map(),
        )
        self.assertEqual(
            dict(merged),
            {(self.parent.id, date(2026, 6, 1)): {'weight_kg': Decimal('3000')}},
        )

    def test_sub_block_folds_to_parent_but_keeps_its_batch(self):
        """Review Focus 4 — grain normalization must not erase batch identity."""
        merged = merge_to_parent(
            [
                {'block': self.child.id, 'weight_kg': '1500', 'harvest_date': date(2026, 6, 2)},
                {'block': self.parent.id, 'weight_kg': '500', 'harvest_date': date(2026, 6, 4)},
            ],
            build_block_parent_map(),
        )
        self.assertEqual(
            dict(merged),
            {
                (self.parent.id, date(2026, 6, 2)): {'weight_kg': Decimal('1500')},
                (self.parent.id, date(2026, 6, 4)): {'weight_kg': Decimal('500')},
            },
        )

    def test_null_harvest_date_is_its_own_key(self):
        merged = merge_to_parent(
            [
                {'block': self.parent.id, 'weight_kg': '900'},
                {'block': self.parent.id, 'weight_kg': '100', 'harvest_date': date(2026, 6, 1)},
            ],
            build_block_parent_map(),
        )
        self.assertEqual(
            dict(merged),
            {
                (self.parent.id, None): {'weight_kg': Decimal('900')},
                (self.parent.id, date(2026, 6, 1)): {'weight_kg': Decimal('100')},
            },
        )


class WriteBlockSourcesBatchConstraintTests(TestCase):
    """Exercises the real (shipment, block, harvest_date) unique_together on MSSQL,
    not just the pure merge_to_parent dict shape. Proves migration 0077's widened
    constraint is what actually lets two batches from one block coexist as rows —
    under the pre-0077 (shipment, block) constraint this raises IntegrityError.
    """

    @classmethod
    def setUpTestData(cls):
        cls.block = GreenhouseBlock.objects.create(code='BQ', is_active=True)
        country, _ = Country.objects.get_or_create(code='TM', defaults={'name_en': 'TM'})
        season, _ = Season.objects.get_or_create(
            name='2026-batch', defaults={
                'is_active': True, 'start_date': '2026-01-01', 'end_date': '2026-12-31',
            },
        )
        status, _ = ShipmentStatusType.objects.get_or_create(
            code='draft',
            defaults={'name_en': 'D', 'name_tk': 'D', 'name_ru': 'D', 'step_order': 0, 'phase': 'LOADING'},
        )
        cls.shipment = Shipment.objects.create(
            shipment_code='24SP001/26', date='2026-09-24', season=season,
            country=country, status=status,
        )

    def test_two_batches_from_one_block_write_two_rows(self):
        n = write_block_sources(self.shipment, [
            {'block': self.block.id, 'weight_kg': Decimal('3000'), 'harvest_date': date(2026, 6, 1)},
            {'block': self.block.id, 'weight_kg': Decimal('5000'), 'harvest_date': date(2026, 6, 3)},
        ])
        self.assertEqual(n, 2)
        rows = {
            bs.harvest_date: bs.weight_kg
            for bs in self.shipment.block_sources.filter(block=self.block)
        }
        self.assertEqual(rows, {
            date(2026, 6, 1): Decimal('3000'),
            date(2026, 6, 3): Decimal('5000'),
        })
