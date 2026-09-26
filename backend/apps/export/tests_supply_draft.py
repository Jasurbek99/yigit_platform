"""Tests for Phase C — supply draft creation (nullable block weights)."""
from datetime import date
from decimal import Decimal
from io import StringIO

from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import (
    Country,
    Customer,
    GreenhouseBlock,
    Season,
    ShipmentStatusType,
    TomatoVariety,
    User,
)
from apps.export.models import Shipment, ShipmentBlockSource
from apps.export.serializers import ShipmentCreateSerializer


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
        # And must skip for the RIGHT reason — an unweighed block source —
        # not silently no-op for some other reason (e.g. parent_map miss).
        self.assertIn('skipped (unweighed block source)', out.getvalue())

    def test_apply_does_not_delete_unweighed_block_source(self):
        # write_block_sources(replace=True) deletes all existing rows then
        # rewrites from `entries`. A null-weight row must never be silently
        # erased just because it has nothing to normalize yet.
        out = StringIO()
        call_command('normalize_block_sources', '--apply', stdout=out)
        self.assertTrue(
            ShipmentBlockSource.objects.filter(pk=self.source.pk).exists()
        )


class SupplySerializerFieldTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.block = GreenhouseBlock.objects.create(code='JC', name='JC')

    def test_accepts_block_ids_weight_net_harvest_status(self):
        ser = ShipmentCreateSerializer(data={
            'is_draft': True,
            'skip_forecast_check': True,
            'weight_net': '22000.00',
            'block_ids': [self.block.pk],
            'harvest_status': 'ok',
        })
        self.assertTrue(ser.is_valid(), ser.errors)
        self.assertEqual(ser.validated_data['weight_net'], Decimal('22000.00'))
        self.assertEqual(ser.validated_data['harvest_status'], 'ok')
        self.assertEqual(list(ser.validated_data['block_ids']), [self.block])


class SupplyDraftCreateTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        # DynamicResourcePermission reads RoleResourcePermission from the DB;
        # the test DB starts empty, so every API call 403s without this
        # (same pattern as tests_shipment_sheet.py / tests_shipment_join.py).
        call_command('seed_permissions')
        cls.season = Season.objects.create(
            name='2025-2026', is_active=True,
            start_date='2025-09-01', end_date='2026-06-30',
        )
        cls.draft = ShipmentStatusType.objects.create(
            code='draft', name_tk='Garalama', step_order=0,
        )
        cls.block_a = GreenhouseBlock.objects.create(code='JD', name='JD')
        cls.block_b = GreenhouseBlock.objects.create(code='JE', name='JE')
        cls.variety = TomatoVariety.objects.create(name='Pink', code='PK')
        cls.loader = User.objects.create_user(
            username='solt', password='pw', role='loading_dept_head',
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.loader)

    def _payload(self, **over):
        base = {
            'is_draft': True,
            'skip_forecast_check': True,
            'weight_net': '22000.00',
            'block_ids': [self.block_a.pk, self.block_b.pk],
            'varieties': [self.variety.pk],
            'harvest_status': 'ok',
        }
        base.update(over)
        return base

    def test_creates_supply_draft_with_null_weight_blocks(self):
        resp = self.client.post('/api/v1/export/shipments/', self._payload(), format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        s = Shipment.objects.get(pk=resp.data['id'])
        self.assertEqual(s.status.code, 'draft')
        self.assertEqual(s.weight_net, Decimal('22000.00'))
        self.assertEqual(s.harvest_status, 'ok')
        self.assertEqual(s.variety_id, self.variety.pk)
        self.assertEqual(set(s.varieties_dominant.values_list('pk', flat=True)), {self.variety.pk})
        self.assertEqual(s.block_sources.count(), 2)
        self.assertTrue(all(bs.weight_kg is None for bs in s.block_sources.all()))

    def test_block_ids_supply_draft_not_capped(self):
        # The 18,500 kg one-truck cap in ShipmentCreateSerializer.validate() is
        # gated on `enforce_caps = is_draft and block_sources and not
        # skip_forecast_check` — it only ever looks at the weighted
        # `block_sources` field. A `block_ids` payload never populates
        # `block_sources`, so the cap is never reached for this path at all
        # (not "bypassed" — simply not applicable). This asserts what's
        # actually true: a block_ids supply draft with weight_net above the
        # cap (25,000 kg) is accepted.
        resp = self.client.post(
            '/api/v1/export/shipments/',
            self._payload(weight_net='25000.00'),
            format='json',
        )
        self.assertEqual(resp.status_code, 201, resp.data)

    def test_duplicate_block_ids_rejected_with_400(self):
        # A repeated block id must be caught by serializer validation, not
        # surface as an unhandled IntegrityError (unique_together=('shipment',
        # 'block')) from the view's bulk_create.
        resp = self.client.post(
            '/api/v1/export/shipments/',
            self._payload(block_ids=[self.block_a.pk, self.block_a.pk]),
            format='json',
        )
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertIn('block_ids', resp.data)

    def test_weighted_block_sources_path_still_works(self):
        # Regression guard (fix round 2): the block_ids dedup check in
        # validate() must not shadow the pre-existing loop-local `block_ids`
        # name used by the weighted block_sources dedup check just above it.
        # A request carrying block_sources (the normal forecast-composer /
        # weighted-draft path used across the app) must not 500.
        resp = self.client.post(
            '/api/v1/export/shipments/',
            {
                'is_draft': True,
                'skip_forecast_check': True,
                'block_sources': [
                    {'block_id': self.block_a.pk, 'weight_kg': '5000.00'},
                ],
            },
            format='json',
        )
        self.assertEqual(resp.status_code, 201, resp.data)

    def test_role_gate_blocks_disallowed_role(self):
        sales = User.objects.create_user(username='srep', password='pw', role='sales_rep')
        self.client.force_authenticate(user=sales)
        resp = self.client.post('/api/v1/export/shipments/', self._payload(), format='json')
        self.assertEqual(resp.status_code, 403, resp.data)


class BlockSourceBatchCreateTests(TestCase):
    """Create-path coverage for Gaplama batch selection (2026-09-24).

    A truck may carry two batches (harvest days) from the same block. The
    create path had two defects fixed here:
      - ShipmentCreateSerializer.validate() rejected ANY repeated block_id,
        which also rejected two legitimate batches of one block.
      - BlockSourceInputSerializer never declared harvest_date, so DRP
        silently dropped it and every created draft lost its batch date.
    """

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.season = Season.objects.create(
            name='26-jibatch', is_active=True,
            start_date='2025-09-01', end_date='2026-06-30',
        )
        cls.draft = ShipmentStatusType.objects.create(
            code='draft', name_tk='Garalama', step_order=0,
        )
        cls.block_a = GreenhouseBlock.objects.create(code='JH', name='JH')
        cls.block_b = GreenhouseBlock.objects.create(code='JI', name='JI')
        cls.loader = User.objects.create_user(
            username='solt_batch', password='pw', role='loading_dept_head',
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.loader)

    def _post(self, block_sources, **over):
        payload = {
            'is_draft': True,
            'skip_forecast_check': True,
            'block_sources': block_sources,
        }
        payload.update(over)
        return self.client.post('/api/v1/export/shipments/', payload, format='json')

    def test_two_batches_from_one_block_creates_two_rows(self):
        """3,000 kg picked the 21st + 5,000 kg picked the 24th, both block A."""
        resp = self._post([
            {'block_id': self.block_a.pk, 'weight_kg': '3000.00', 'harvest_date': '2026-01-21'},
            {'block_id': self.block_a.pk, 'weight_kg': '5000.00', 'harvest_date': '2026-01-24'},
        ])
        self.assertEqual(resp.status_code, 201, resp.data)
        s = Shipment.objects.get(pk=resp.data['id'])
        self.assertEqual(s.block_sources.count(), 2)
        rows = {
            bs.harvest_date: bs.weight_kg
            for bs in s.block_sources.filter(block=self.block_a)
        }
        self.assertEqual(rows, {
            date(2026, 1, 21): Decimal('3000.00'),
            date(2026, 1, 24): Decimal('5000.00'),
        })

    def test_same_block_same_harvest_date_still_rejected(self):
        """Two rows for one block on the SAME date are a genuine duplicate."""
        resp = self._post([
            {'block_id': self.block_a.pk, 'weight_kg': '3000.00', 'harvest_date': '2026-01-21'},
            {'block_id': self.block_a.pk, 'weight_kg': '5000.00', 'harvest_date': '2026-01-21'},
        ])
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertIn('block_sources', resp.data)

    def test_single_batch_create_persists_harvest_date(self):
        """A single-batch create must not lose its harvest_date to null."""
        resp = self._post([
            {'block_id': self.block_a.pk, 'weight_kg': '18000.00', 'harvest_date': '2026-01-22'},
        ])
        self.assertEqual(resp.status_code, 201, resp.data)
        s = Shipment.objects.get(pk=resp.data['id'])
        bs = s.block_sources.get(block=self.block_a)
        self.assertEqual(bs.harvest_date, date(2026, 1, 22))

    def test_two_bare_entries_for_one_block_rejected(self):
        """Two entries for one block with NO harvest_date on either are still
        rejected as a duplicate. Both key on (block, None): with no date to
        tell the batches apart they're indistinguishable from an accidental
        double-submit, and write_block_sources would silently sum them into
        one row rather than keeping two — the DB's unique index doesn't catch
        this pair either, since NULL != NULL there."""
        resp = self._post([
            {'block_id': self.block_a.pk, 'weight_kg': '3000.00'},
            {'block_id': self.block_a.pk, 'weight_kg': '5000.00'},
        ])
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertIn('block_sources', resp.data)

    def test_dated_and_undated_batch_for_one_block_allowed(self):
        """A dated batch plus an undated batch of the same block ARE distinct
        keys — (block, date) vs (block, None) — and both are legal."""
        resp = self._post([
            {'block_id': self.block_a.pk, 'weight_kg': '3000.00', 'harvest_date': '2026-01-21'},
            {'block_id': self.block_a.pk, 'weight_kg': '5000.00'},
        ])
        self.assertEqual(resp.status_code, 201, resp.data)
        s = Shipment.objects.get(pk=resp.data['id'])
        rows = {
            bs.harvest_date: bs.weight_kg
            for bs in s.block_sources.filter(block=self.block_a)
        }
        self.assertEqual(rows, {
            date(2026, 1, 21): Decimal('3000.00'),
            None: Decimal('5000.00'),
        })

    def test_two_batches_of_one_block_alongside_another_block(self):
        """Two batches of block A plus one row of block B — the common
        Gaplama shape — all three rows persist."""
        resp = self._post([
            {'block_id': self.block_a.pk, 'weight_kg': '3000.00', 'harvest_date': '2026-01-21'},
            {'block_id': self.block_a.pk, 'weight_kg': '5000.00', 'harvest_date': '2026-01-24'},
            {'block_id': self.block_b.pk, 'weight_kg': '2000.00', 'harvest_date': '2026-01-21'},
        ])
        self.assertEqual(resp.status_code, 201, resp.data)
        s = Shipment.objects.get(pk=resp.data['id'])
        self.assertEqual(s.block_sources.count(), 3)


class JoinNullWeightTests(TestCase):
    """_execute_join's weight_net recompute must not lose the declared total.

    A supply draft (Task 4) carries weight_net (the operator's declared
    truck total) plus block_sources whose weight_kg may be null until the
    weighmaster fills them in. Joining that draft into a destination must
    not silently zero/understate weight_net just because the block Sum is
    incomplete — it should fall back to the source's declared total.
    """

    @classmethod
    def setUpTestData(cls):
        # DynamicResourcePermission reads RoleResourcePermission from the DB;
        # force_authenticate does not bypass it (same pattern as
        # SupplyDraftCreateTests above / tests_shipment_join.py).
        call_command('seed_permissions')
        cls.season = Season.objects.create(
            name='2025-2026', is_active=True,
            start_date='2025-09-01', end_date='2026-06-30',
        )
        cls.draft = ShipmentStatusType.objects.create(
            code='draft', name_tk='Garalama', step_order=0,
        )
        cls.country = Country.objects.create(code='JQ', name_tk='Gazagystan', name_en='KZ')
        cls.customer = Customer.objects.create(name='Begjan')
        cls.block_a = GreenhouseBlock.objects.create(code='JF', name='JF')
        cls.block_b = GreenhouseBlock.objects.create(code='JG', name='JG')
        cls.mgr = User.objects.create_user(username='gadam', password='pw', role='export_manager')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.mgr)

    def _supply(self, weights):
        s = Shipment.objects.create(
            shipment_code='0201001/26', status=self.draft, season=self.season,
            date='2026-01-01', weight_net=Decimal('22000.00'),
        )
        blocks = [self.block_a, self.block_b]
        # Per-row .create() rather than bulk_create: a mixed None/Decimal
        # batch in one parameterized INSERT trips a pyodbc/MSSQL type-
        # inference quirk ("Arithmetic overflow error converting nvarchar
        # to data type numeric"). It also matches production reality — a
        # supply draft's blocks start all-null (bulk_create, views.py) and
        # get individually weighed later, one row at a time.
        for block, weight in zip(blocks, weights):
            ShipmentBlockSource.objects.create(shipment=s, block=block, weight_kg=weight)
        return s

    def _dest(self):
        return Shipment.objects.create(
            shipment_code='0201002/26', status=self.draft, season=self.season,
            date='2026-01-01', country=self.country, customer=self.customer,
        )

    def test_all_null_blocks_use_source_declared_total(self):
        supply = self._supply([None, None])
        dest = self._dest()
        resp = self.client.post(f'/api/v1/export/shipments/{dest.pk}/join/',
                                {'source_id': supply.pk}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        dest.refresh_from_db()
        self.assertEqual(dest.weight_net, Decimal('22000.00'))

    def test_mixed_null_blocks_use_source_declared_total(self):
        supply = self._supply([Decimal('5000.00'), None])
        dest = self._dest()
        resp = self.client.post(f'/api/v1/export/shipments/{dest.pk}/join/',
                                {'source_id': supply.pk}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        dest.refresh_from_db()
        self.assertEqual(dest.weight_net, Decimal('22000.00'))

    def test_all_weighted_blocks_recompute_from_sum(self):
        supply = self._supply([Decimal('9000.00'), Decimal('9500.00')])
        dest = self._dest()
        resp = self.client.post(f'/api/v1/export/shipments/{dest.pk}/join/',
                                {'source_id': supply.pk}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        dest.refresh_from_db()
        self.assertEqual(dest.weight_net, Decimal('18500.00'))
