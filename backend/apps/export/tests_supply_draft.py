"""Tests for Phase C — supply draft creation (nullable block weights)."""
from decimal import Decimal
from io import StringIO

from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import GreenhouseBlock, Season, ShipmentStatusType, TomatoVariety, User
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

    def test_role_gate_blocks_disallowed_role(self):
        sales = User.objects.create_user(username='srep', password='pw', role='sales_rep')
        self.client.force_authenticate(user=sales)
        resp = self.client.post('/api/v1/export/shipments/', self._payload(), format='json')
        self.assertEqual(resp.status_code, 403, resp.data)
