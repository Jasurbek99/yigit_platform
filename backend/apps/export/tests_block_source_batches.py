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


class SetBlockSourcesDateStringVsDateObjectTests(TestCase):
    """POST /block-sources/ must not 500 when one entry's harvest_date is an
    explicit request STRING and a sibling entry's is a preserved `date`
    OBJECT read back from the DB, even when the two name the same calendar
    day. `merge_to_parent` keys on `harvest_date` — a str and a date for the
    same day are different dict keys, so pre-fix they never merge, both get
    written, and the (shipment, block, harvest_date) unique index rejects
    the pair as an IntegrityError (2026-09-25 fix).

    Reachable with sub-blocks BV1 (explicit date) and BV2 (bare, preserves
    its parent's existing batch), both folding to parent BV.
    """

    @classmethod
    def setUpTestData(cls):
        cls.parent = GreenhouseBlock.objects.create(code='BV', is_active=True)
        cls.child_1 = GreenhouseBlock.objects.create(code='BV1', parent=cls.parent, is_active=True)
        cls.child_2 = GreenhouseBlock.objects.create(code='BV2', parent=cls.parent, is_active=True)
        cls.country, _ = Country.objects.get_or_create(code='TM', defaults={'name_en': 'TM'})
        cls.season, _ = Season.objects.get_or_create(
            name='26-batch4', defaults={
                'is_active': True, 'start_date': '2026-01-01', 'end_date': '2026-12-31',
            },
        )
        cls.status_draft, _ = ShipmentStatusType.objects.get_or_create(
            code='draft',
            defaults={'name_en': 'D', 'name_tk': 'D', 'name_ru': 'D', 'step_order': 0, 'phase': 'LOADING'},
        )
        cls.boss = User.objects.create_superuser(username='boss_batch_datetypes', password='p')

    def setUp(self):
        self._counter = getattr(SetBlockSourcesDateStringVsDateObjectTests, '_shipment_seq', 0) + 1
        SetBlockSourcesDateStringVsDateObjectTests._shipment_seq = self._counter
        self.shipment = Shipment.objects.create(
            shipment_code=f'24SP7{self._counter:02d}/26', date='2026-09-25',
            season=self.season, country=self.country, status=self.status_draft,
            weight_net=Decimal('10000'),
        )
        from apps.export.models import ShipmentBlockSource
        # A preserved batch already on the PARENT (block_sources are always
        # stored at parent grain), dated 2026-06-01 — read back by the view
        # as a real `date` object.
        ShipmentBlockSource.objects.create(
            shipment=self.shipment, block=self.parent,
            weight_kg=Decimal('4000'), harvest_date=date(2026, 6, 1),
        )
        from rest_framework.test import APIClient
        self.client = APIClient()
        self.client.force_authenticate(self.boss)
        self.url = f'/api/v1/export/shipments/{self.shipment.id}/block-sources/'

    def test_explicit_string_date_merges_with_preserved_date_object_same_day(self):
        resp = self.client.post(self.url, {'blocks': [
            {'block_id': self.child_1.id, 'weight_kg': '3000', 'harvest_date': '2026-06-01'},
            {'block_id': self.child_2.id},
        ]}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        rows = {
            bs.harvest_date: bs.weight_kg
            for bs in self.shipment.block_sources.filter(block=self.parent)
        }
        self.assertEqual(set(rows), {date(2026, 6, 1)}, rows)

    def test_unparseable_harvest_date_string_is_a_400_naming_the_field(self):
        resp = self.client.post(self.url, {'blocks': [
            {'block_id': self.child_1.id, 'weight_kg': '3000', 'harvest_date': 'not-a-date'},
        ]}, format='json')
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn('harvest_date', str(resp.data))

    def test_impossible_calendar_date_string_is_a_400(self):
        """Well-formed but nonexistent (Feb 30) — parse_date raises ValueError,
        not just returning None, so this exercises a different code path
        than the plain-garbage-string case above."""
        resp = self.client.post(self.url, {'blocks': [
            {'block_id': self.child_1.id, 'weight_kg': '3000', 'harvest_date': '2026-02-30'},
        ]}, format='json')
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn('harvest_date', str(resp.data))

    def test_non_string_harvest_date_is_a_400(self):
        """A JSON number for harvest_date — parse_date raises TypeError, not
        ValueError, for a non-str input."""
        resp = self.client.post(self.url, {'blocks': [
            {'block_id': self.child_1.id, 'weight_kg': '3000', 'harvest_date': 12345},
        ]}, format='json')
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn('harvest_date', str(resp.data))

    def test_null_harvest_date_still_clears_explicitly(self):
        """Explicit null must keep meaning 'clear to a dateless row' — not
        be caught by the new parsing/validation path."""
        resp = self.client.post(self.url, {'blocks': [
            {'block_id': self.child_1.id, 'weight_kg': '3000', 'harvest_date': None},
        ]}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        rows = {
            bs.harvest_date: bs.weight_kg
            for bs in self.shipment.block_sources.filter(block=self.parent)
        }
        self.assertIn(None, rows, rows)


class SheetChipGroupingTests(TestCase):
    """A two-batch truck is still ONE block chip on the Sheet.

    `ShipmentSheetSerializer.block_sources` is one entry per
    ShipmentBlockSource ROW. Since harvest_date joined the unique key
    (2026-09-24), a block can now have two legitimate batch rows on the same
    shipment. Without grouping, the Sheet chip for that block renders twice.
    """

    @classmethod
    def setUpTestData(cls):
        from apps.export.models import ShipmentBlockSource
        cls.block = GreenhouseBlock.objects.create(code='SC', is_active=True)
        cls.country, _ = Country.objects.get_or_create(code='TM', defaults={'name_en': 'TM'})
        cls.season, _ = Season.objects.get_or_create(
            name='SC-season', defaults={
                'is_active': True, 'start_date': '2026-01-01', 'end_date': '2026-12-31',
            },
        )
        cls.status, _ = ShipmentStatusType.objects.get_or_create(
            code='draft',
            defaults={'name_en': 'D', 'name_tk': 'D', 'name_ru': 'D', 'step_order': 0, 'phase': 'LOADING'},
        )
        cls.shipment = Shipment.objects.create(
            shipment_code='24SP901/26', date=date(2026, 6, 3),
            season=cls.season, country=cls.country, status=cls.status,
        )
        for harvest_date, kg in ((date(2026, 6, 1), '3000'), (date(2026, 6, 3), '5000')):
            ShipmentBlockSource.objects.create(
                shipment=cls.shipment, block=cls.block,
                weight_kg=Decimal(kg), harvest_date=harvest_date,
            )

    def test_two_batches_render_one_chip_per_block(self):
        from apps.export.serializers import ShipmentSheetSerializer
        shipment = self.shipment
        # Sheet endpoint annotates these via Exists(...) on the queryset;
        # a bare model instance has neither, so fill them in like the
        # queryset would for a shipment with no sales report / advance yet.
        shipment.has_sales_report = False
        shipment.has_doc_advance = False
        chips = ShipmentSheetSerializer(shipment).data['block_sources']
        self.assertEqual(
            [c['block_id'] for c in chips], [self.block.id],
            f'block rendered {len(chips)} times, expected once: {chips}',
        )
        self.assertEqual(Decimal(str(chips[0]['weight_kg'])), Decimal('8000'))


class NormalizeBlockSourcesBatchPreviewTests(TestCase):
    """The dry-run preview must show WHICH batch each figure belongs to.

    Before the fix, the preview line discarded harvest_date from the merged
    (parent_id, harvest_date) key, so two batches of one sub-block printed as
    the same code twice with nothing to tell them apart (`ND=3000, ND=5000`).
    """

    @classmethod
    def setUpTestData(cls):
        from apps.export.models import ShipmentBlockSource
        cls.parent = GreenhouseBlock.objects.create(code='ND', is_active=True)
        cls.child = GreenhouseBlock.objects.create(code='ND1', parent=cls.parent, is_active=True)
        cls.season, _ = Season.objects.get_or_create(
            name='ND-season', defaults={
                'is_active': True, 'start_date': '2026-01-01', 'end_date': '2026-12-31',
            },
        )
        cls.status, _ = ShipmentStatusType.objects.get_or_create(
            code='draft',
            defaults={'name_en': 'D', 'name_tk': 'D', 'name_ru': 'D', 'step_order': 0, 'phase': 'LOADING'},
        )
        cls.shipment = Shipment.objects.create(
            shipment_code='24SP902/26', date=date(2026, 6, 3),
            season=cls.season, status=cls.status,
        )
        for harvest_date, kg in ((date(2026, 6, 1), '3000'), (date(2026, 6, 3), '5000')):
            ShipmentBlockSource.objects.create(
                shipment=cls.shipment, block=cls.child,
                weight_kg=Decimal(kg), harvest_date=harvest_date,
            )

    def test_dry_run_preview_pairs_each_weight_with_its_own_date_in_after(self):
        """Round-1 review: assertIn against the whole blob was vacuous — the
        `before` segment already contained both dates/weights pre-fix, so the
        old assertions passed whether or not `after` ever learned about
        batches. Assert the PAIRED form (weight bound to its own date) and
        restrict the check to the `after` segment specifically, so `before`
        can't satisfy it.
        """
        from io import StringIO
        from django.core.management import call_command
        out = StringIO()
        call_command('normalize_block_sources', stdout=out)
        output = out.getvalue()
        line = next(l for l in output.splitlines() if '24SP902/26' in l)
        before_part, after_part = line.split(' -> ', 1)
        self.assertIn('ND=3000.00@2026-06-01', after_part, after_part)
        self.assertIn('ND=5000.00@2026-06-03', after_part, after_part)


class NormalizeBlockSourcesNullHarvestDateTests(TestCase):
    """A batch's harvest_date is legal to leave null — the Gaplama board
    still consumes such a load FIFO by design. The preview must not print
    the noise of '@None' for it; the suffix is omitted instead.
    """

    @classmethod
    def setUpTestData(cls):
        from apps.export.models import ShipmentBlockSource
        cls.parent = GreenhouseBlock.objects.create(code='NE', is_active=True)
        cls.child = GreenhouseBlock.objects.create(code='NE1', parent=cls.parent, is_active=True)
        cls.season, _ = Season.objects.get_or_create(
            name='NE-season', defaults={
                'is_active': True, 'start_date': '2026-01-01', 'end_date': '2026-12-31',
            },
        )
        cls.status, _ = ShipmentStatusType.objects.get_or_create(
            code='draft',
            defaults={'name_en': 'D', 'name_tk': 'D', 'name_ru': 'D', 'step_order': 0, 'phase': 'LOADING'},
        )
        cls.shipment = Shipment.objects.create(
            shipment_code='24SP903/26', date=date(2026, 6, 3),
            season=cls.season, status=cls.status,
        )
        ShipmentBlockSource.objects.create(
            shipment=cls.shipment, block=cls.child,
            weight_kg=Decimal('4000'), harvest_date=None,
        )

    def test_dry_run_preview_omits_at_suffix_for_null_harvest_date(self):
        from io import StringIO
        from django.core.management import call_command
        out = StringIO()
        call_command('normalize_block_sources', stdout=out)
        output = out.getvalue()
        line = next(l for l in output.splitlines() if '24SP903/26' in l)
        before_part, after_part = line.split(' -> ', 1)
        self.assertIn('NE1=4000.00', before_part, before_part)
        self.assertIn('NE=4000.00', after_part, after_part)
        self.assertNotIn('@', before_part, before_part)
        self.assertNotIn('@', after_part, after_part)


class SetBlockSourcesRejectsNegativeWeightTests(TestCase):
    """POST /block-sources/ must refuse a negative weight_kg, not write it.

    set_block_sources() computed `weight = Decimal(str(override))` straight
    from the request with no positivity check — unlike ShipmentCreateSerializer
    (min_value=0.01) on the create path. A negative override feeds `loaded_kg`
    in the gaplama carry-day math (`available = plan + carry - loaded`), so it
    silently INFLATES the block's remaining stock instead of shrinking it
    (2026-09-25, reviewer finding).
    """

    @classmethod
    def setUpTestData(cls):
        cls.block = GreenhouseBlock.objects.create(code='NW', is_active=True)
        cls.country, _ = Country.objects.get_or_create(code='TM', defaults={'name_en': 'TM'})
        cls.season, _ = Season.objects.get_or_create(
            name='26-negwt', defaults={
                'is_active': True, 'start_date': '2026-01-01', 'end_date': '2026-12-31',
            },
        )
        cls.status_draft, _ = ShipmentStatusType.objects.get_or_create(
            code='draft',
            defaults={'name_en': 'D', 'name_tk': 'D', 'name_ru': 'D', 'step_order': 0, 'phase': 'LOADING'},
        )
        cls.boss = User.objects.create_superuser(username='boss_negwt', password='p')

    def setUp(self):
        self.shipment = Shipment.objects.create(
            shipment_code='24SP7NW/26', date='2026-09-25',
            season=self.season, country=self.country, status=self.status_draft,
            weight_net=Decimal('10000'),
        )
        from rest_framework.test import APIClient
        self.client = APIClient()
        self.client.force_authenticate(self.boss)
        self.url = f'/api/v1/export/shipments/{self.shipment.id}/block-sources/'

    def test_negative_weight_kg_is_a_400_and_writes_nothing(self):
        resp = self.client.post(self.url, {'blocks': [
            {'block_id': self.block.id, 'weight_kg': '-500'},
        ]}, format='json')
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn('weight_kg', str(resp.data))
        self.assertFalse(self.shipment.block_sources.exists())

    def test_negative_numeric_weight_kg_is_also_rejected(self):
        """The override can arrive as a JSON number, not just a string."""
        resp = self.client.post(self.url, {'blocks': [
            {'block_id': self.block.id, 'weight_kg': -1},
        ]}, format='json')
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertFalse(self.shipment.block_sources.exists())

    def test_zero_weight_kg_still_means_auto_split_not_rejected(self):
        """0 is the auto-split sentinel, not a weight — must stay legal."""
        resp = self.client.post(self.url, {'blocks': [
            {'block_id': self.block.id, 'weight_kg': 0},
        ]}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(self.shipment.block_sources.filter(block=self.block).exists())

    def test_positive_weight_kg_is_unaffected(self):
        resp = self.client.post(self.url, {'blocks': [
            {'block_id': self.block.id, 'weight_kg': '2500'},
        ]}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        row = self.shipment.block_sources.get(block=self.block)
        self.assertEqual(row.weight_kg, Decimal('2500.00'))


class SetBlockSourcesSyncWeightNetTests(TestCase):
    """POST /block-sources/ with sync_weight_net: true writes the split and the
    new weight_net total in ONE server-side transaction.

    Before this, the Gaplama edit form (Üýtget) sent two separate requests —
    POST block-sources, then PATCH weight_net — each behind its own gate. A
    403/500/dropped connection on the second call left the split rewritten
    with the total still stale (2026-09-25 fix, reviewer finding P1).
    """

    @classmethod
    def setUpTestData(cls):
        cls.block_a = GreenhouseBlock.objects.create(code='SW', is_active=True)
        cls.block_b = GreenhouseBlock.objects.create(code='SX', is_active=True)
        cls.country, _ = Country.objects.get_or_create(code='TM', defaults={'name_en': 'TM'})
        cls.season, _ = Season.objects.get_or_create(
            name='26-syncwn', defaults={
                'is_active': True, 'start_date': '2026-01-01', 'end_date': '2026-12-31',
            },
        )
        cls.status_draft, _ = ShipmentStatusType.objects.get_or_create(
            code='draft',
            defaults={'name_en': 'D', 'name_tk': 'D', 'name_ru': 'D', 'step_order': 0, 'phase': 'LOADING'},
        )
        cls.boss = User.objects.create_superuser(username='boss_syncwn', password='p')

    def setUp(self):
        self._counter = getattr(SetBlockSourcesSyncWeightNetTests, '_shipment_seq', 0) + 1
        SetBlockSourcesSyncWeightNetTests._shipment_seq = self._counter
        self.shipment = Shipment.objects.create(
            shipment_code=f'24SP8{self._counter:02d}/26', date='2026-09-25',
            season=self.season, country=self.country, status=self.status_draft,
            weight_net=Decimal('999'),
        )
        from rest_framework.test import APIClient
        self.client = APIClient()
        self.client.force_authenticate(self.boss)
        self.url = f'/api/v1/export/shipments/{self.shipment.id}/block-sources/'

    def test_sync_weight_net_sets_total_from_the_written_rows(self):
        resp = self.client.post(self.url, {
            'blocks': [
                {'block_id': self.block_a.id, 'weight_kg': '4000'},
                {'block_id': self.block_b.id, 'weight_kg': '6000'},
            ],
            'sync_weight_net': True,
        }, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.weight_net, Decimal('10000'))

    def test_weight_net_ignores_the_request_body_value(self):
        """The total is computed server-side from the written rows — a
        mismatched client-sent number must not win."""
        resp = self.client.post(self.url, {
            'blocks': [{'block_id': self.block_a.id, 'weight_kg': '4000'}],
            'weight_net': '999999',
            'sync_weight_net': True,
        }, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.weight_net, Decimal('4000'))

    def test_omitted_sync_weight_net_leaves_weight_net_untouched(self):
        """Backward compatible: every OTHER caller of this endpoint (Sheet R8,
        undo) never sends the flag and must keep working exactly as before."""
        resp = self.client.post(self.url, {
            'blocks': [{'block_id': self.block_a.id, 'weight_kg': '4000'}],
        }, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.weight_net, Decimal('999'))

    def test_sync_weight_net_writes_an_audit_row(self):
        from apps.export.models import AuditLog

        self.client.post(self.url, {
            'blocks': [{'block_id': self.block_a.id, 'weight_kg': '4000'}],
            'sync_weight_net': True,
        }, format='json')

        self.assertTrue(
            AuditLog.objects.filter(
                object_id=self.shipment.id, field_name='weight_net',
            ).exists()
        )

    def test_permission_denied_writes_neither_the_split_nor_the_total(self):
        """A caller without the weight_net field grant gets a clean 403 and
        NOTHING is written — not the split either. Before the combined
        endpoint, the split write had no way to know the second call would
        403 and had already committed by the time it did."""
        from unittest import mock

        with mock.patch('apps.export.views.can_edit_sheet_field', return_value=False):
            resp = self.client.post(self.url, {
                'blocks': [{'block_id': self.block_a.id, 'weight_kg': '4000'}],
                'sync_weight_net': True,
            }, format='json')

        self.assertEqual(resp.status_code, 403, resp.content)
        self.assertIn('weight_net', str(resp.data))
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.weight_net, Decimal('999'))
        self.assertFalse(self.shipment.block_sources.exists())
