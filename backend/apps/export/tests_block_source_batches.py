"""A truck may take two batches from one block (2026-09-24)."""
from datetime import date
from decimal import Decimal

from django.test import TestCase

from apps.core.models import Country, GreenhouseBlock, Season, ShipmentStatusType, User
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


class SetBlockSourcesPreservesBatchesTests(TestCase):
    """POST /block-sources/ must not collapse a multi-batch block down to one
    arbitrary-dated row when the caller omits harvest_date — R8's multiselect
    block editor only ever ships {block_id}. Fix: 2026-09-24.
    """

    @classmethod
    def setUpTestData(cls):
        cls.block_a = GreenhouseBlock.objects.create(code='BR', is_active=True)
        cls.block_b = GreenhouseBlock.objects.create(code='BS', is_active=True)
        cls.block_c = GreenhouseBlock.objects.create(code='BT', is_active=True)
        cls.country, _ = Country.objects.get_or_create(code='TM', defaults={'name_en': 'TM'})
        cls.season, _ = Season.objects.get_or_create(
            name='26-batch3', defaults={
                'is_active': True, 'start_date': '2026-01-01', 'end_date': '2026-12-31',
            },
        )
        cls.status_draft, _ = ShipmentStatusType.objects.get_or_create(
            code='draft',
            defaults={'name_en': 'D', 'name_tk': 'D', 'name_ru': 'D', 'step_order': 0, 'phase': 'LOADING'},
        )
        cls.boss = User.objects.create_superuser(username='boss_batch_sources', password='p')

    def setUp(self):
        self._counter = getattr(SetBlockSourcesPreservesBatchesTests, '_shipment_seq', 0) + 1
        SetBlockSourcesPreservesBatchesTests._shipment_seq = self._counter
        self.shipment = Shipment.objects.create(
            shipment_code=f'24SP{self._counter:03d}/26', date='2026-09-24',
            season=self.season, country=self.country, status=self.status_draft,
            weight_net=Decimal('8000'),
        )
        from apps.export.models import ShipmentBlockSource
        # Two pre-existing batches on block_a: 2026-06-01/3000 and 2026-06-03/5000.
        ShipmentBlockSource.objects.create(
            shipment=self.shipment, block=self.block_a,
            weight_kg=Decimal('3000'), harvest_date=date(2026, 6, 1),
        )
        ShipmentBlockSource.objects.create(
            shipment=self.shipment, block=self.block_a,
            weight_kg=Decimal('5000'), harvest_date=date(2026, 6, 3),
        )
        from rest_framework.test import APIClient
        self.client = APIClient()
        self.client.force_authenticate(self.boss)
        self.url = f'/api/v1/export/shipments/{self.shipment.id}/block-sources/'

    def _rows(self):
        return {
            bs.harvest_date: bs.weight_kg
            for bs in self.shipment.block_sources.filter(block=self.block_a)
        }

    def test_omitted_harvest_date_preserves_both_batches(self):
        """Requirement 1 — payload with only block_id must not lose a batch."""
        resp = self.client.post(self.url, {'blocks': [{'block_id': self.block_a.id}]}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(self._rows(), {
            date(2026, 6, 1): Decimal('3000'),
            date(2026, 6, 3): Decimal('5000'),
        })

    def test_explicit_harvest_date_still_overrides(self):
        """Requirement 2 — an explicit harvest_date collapses to one row, as before."""
        resp = self.client.post(self.url, {'blocks': [
            {'block_id': self.block_a.id, 'harvest_date': '2026-06-05'},
        ]}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        rows = self._rows()
        self.assertEqual(set(rows), {date(2026, 6, 5)})
        self.assertEqual(rows[date(2026, 6, 5)], Decimal('8000.00'))

    def test_dropped_block_loses_all_its_rows(self):
        """Requirement 3 — a block absent from the payload is fully removed,
        even though it has two batches."""
        resp = self.client.post(self.url, {'blocks': [
            {'block_id': self.block_b.id, 'weight_kg': '1000', 'harvest_date': '2026-07-01'},
        ]}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(self._rows(), {})
        self.assertEqual(
            self.shipment.block_sources.filter(block=self.block_b).count(), 1,
        )

    def test_single_batch_reorder_still_preserves_date(self):
        """Requirement 4 — the original one-batch case the comment protects."""
        self.shipment.block_sources.filter(harvest_date=date(2026, 6, 3)).delete()
        resp = self.client.post(self.url, {'blocks': [
            {'block_id': self.block_a.id, 'weight_kg': '9500'},
        ]}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(self._rows(), {date(2026, 6, 1): Decimal('9500.00')})

    def test_multi_batch_weight_override_splits_proportionally(self):
        """Weight judgement: an explicit total for a multi-batch block with no
        harvest_date is spread across the preserved batches in their existing
        weight ratio (3000:5000 here), not dumped on one arbitrary row and not
        left untouched (which would silently break the auto-split total)."""
        resp = self.client.post(self.url, {'blocks': [
            {'block_id': self.block_a.id, 'weight_kg': '4000'},
        ]}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(self._rows(), {
            date(2026, 6, 1): Decimal('1500.00'),
            date(2026, 6, 3): Decimal('2500.00'),
        })

    def test_two_entries_for_same_block_recombine_to_original_weights(self):
        """R8's block list includes sub-blocks alongside parents, so a bare
        payload can reference the same parent twice (e.g. two sub-blocks of
        block_a). Proportional splitting per entry, then merge_to_parent's
        sum-by-(block,date), must reconstruct the original per-batch split
        rather than double it."""
        resp = self.client.post(self.url, {'blocks': [
            {'block_id': self.block_a.id},
            {'block_id': self.block_a.id},
        ]}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(self._rows(), {
            date(2026, 6, 1): Decimal('3000.00'),
            date(2026, 6, 3): Decimal('5000.00'),
        })

    def test_multi_batch_block_alongside_another_block_rescales_by_current_share(self):
        """Weight judgement, uneven case: R8's realistic trigger is adding a
        sibling block to the payload (its unchanged-check suppresses a POST
        when the selection doesn't change). That shrinks block_a's auto-split
        share from the full 8000 kg truck total down to its 1-of-2 share
        (4000 kg), and its two preserved batches rescale with it — same
        allocation behaviour a single-batch block already has today. The 3:5
        ratio and both dates survive; only the absolute kg move."""
        resp = self.client.post(self.url, {'blocks': [
            {'block_id': self.block_a.id},
            {'block_id': self.block_b.id},
        ]}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(self._rows(), {
            date(2026, 6, 1): Decimal('1500.00'),
            date(2026, 6, 3): Decimal('2500.00'),
        })
        b_rows = {
            bs.harvest_date: bs.weight_kg
            for bs in self.shipment.block_sources.filter(block=self.block_b)
        }
        self.assertEqual(b_rows, {None: Decimal('4000.00')})

    def test_explicit_harvest_date_null_collapses_multi_batch_to_one_row(self):
        """Requirement 2 (round 2) — an explicit harvest_date: null still
        overrides, even for a block with multiple existing batches: both
        batches must collapse into one dateless row, not two."""
        resp = self.client.post(self.url, {'blocks': [
            {'block_id': self.block_a.id, 'harvest_date': None},
        ]}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        rows = self._rows()
        self.assertEqual(set(rows), {None})
        self.assertEqual(rows[None], Decimal('8000.00'))

    def _c_rows(self):
        return {
            bs.harvest_date: bs.weight_kg
            for bs in self.shipment.block_sources.filter(block=self.block_c)
        }

    def test_three_batch_split_never_goes_negative_reviewer_case(self):
        """Round-1 review finding: three batches 1000/1000/0 splitting an
        entry weight of 2666.67 — rounding each share independently and
        dumping the drift on the last row gives the last row -0.01. No row
        may be negative and the rows must sum exactly to the entry weight."""
        from apps.export.models import ShipmentBlockSource
        ShipmentBlockSource.objects.create(
            shipment=self.shipment, block=self.block_c,
            weight_kg=Decimal('1000'), harvest_date=date(2026, 7, 1),
        )
        ShipmentBlockSource.objects.create(
            shipment=self.shipment, block=self.block_c,
            weight_kg=Decimal('1000'), harvest_date=date(2026, 7, 2),
        )
        ShipmentBlockSource.objects.create(
            shipment=self.shipment, block=self.block_c,
            weight_kg=Decimal('0'), harvest_date=date(2026, 7, 3),
        )
        resp = self.client.post(self.url, {'blocks': [
            {'block_id': self.block_c.id, 'weight_kg': '2666.67'},
        ]}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        rows = self._c_rows()
        self.assertEqual(len(rows), 3)
        for weight in rows.values():
            self.assertGreaterEqual(weight, Decimal('0'), rows)
        self.assertEqual(sum(rows.values()), Decimal('2666.67'))

    def test_three_batch_uneven_split_never_goes_negative(self):
        """A second, differently-shaped three-batch case — an uneven 205:2173
        ratio (not the reviewer's equal 1000:1000 pair) with a 0 kg last
        batch, splitting 18173.43. Found by brute-force search to also go
        negative (-0.01) under the old per-share-rounding algorithm: same
        two properties required, no negative row and an exact sum."""
        from apps.export.models import ShipmentBlockSource
        ShipmentBlockSource.objects.create(
            shipment=self.shipment, block=self.block_c,
            weight_kg=Decimal('205'), harvest_date=date(2026, 7, 1),
        )
        ShipmentBlockSource.objects.create(
            shipment=self.shipment, block=self.block_c,
            weight_kg=Decimal('2173'), harvest_date=date(2026, 7, 2),
        )
        ShipmentBlockSource.objects.create(
            shipment=self.shipment, block=self.block_c,
            weight_kg=Decimal('0'), harvest_date=date(2026, 7, 3),
        )
        resp = self.client.post(self.url, {'blocks': [
            {'block_id': self.block_c.id, 'weight_kg': '18173.43'},
        ]}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        rows = self._c_rows()
        self.assertEqual(len(rows), 3)
        for weight in rows.values():
            self.assertGreaterEqual(weight, Decimal('0'), rows)
        self.assertEqual(sum(rows.values()), Decimal('18173.43'))
