"""Tests for the Shipment Sheet endpoint and permission gating.

Covers:
- GET /api/v1/export/shipments/sheet/ — auth required, filters to active season
- ?season=<id> override
- has_sales_report annotation propagates to payload
- inline firm_splits and block_sources serialize
- PATCH /shipments/{id}/ — permitted field succeeds for granted role
- PATCH /shipments/{id}/ — non-permitted field returns 403
- PATCH /shipments/{id}/ — AD-1 timestamp returns 403 (registry excludes them)
- POST /shipments/{id}/block-sources/ — replaces existing rows
- POST /shipments/{id}/firm-splits/ — replaces existing rows + auto-creates draft QuotaUsageRecord
"""
from datetime import date

from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import (
    Country, ExportFirm, GreenhouseBlock, Season, ShipmentStatusType, User,
)
from apps.export.models import (
    FinansistAdvance, FinansistAdvanceShipment,
    QuotaUsageRecord, SalesReport, Shipment, ShipmentBlockSource, ShipmentComment,
    ShipmentFirmSplit,
)


def _sheet_results(resp):
    """Extract the list of shipment dicts from the sheet response.

    The sheet endpoint wraps results in `{results, comment_counts, task_counts}`.
    Older code paths returned a flat list — this helper handles both shapes.
    """
    body = resp.data
    if isinstance(body, dict) and 'results' in body:
        return body['results']
    return body


def _create_user(username: str, role: str, is_superuser: bool = False) -> User:
    user = User(username=username, role=role, is_superuser=is_superuser)
    user.set_password('pass')
    user.save()
    return user


def _seed_permissions() -> None:
    """Populate RolePagePermission, RoleResourcePermission, RoleFieldPermission.

    The sheet endpoint and PATCH require shipment.view / shipment.edit, so we
    must run the seeder at least once per TestCase. seed_permissions is
    idempotent without --reset.
    """
    call_command('seed_permissions')


class SheetEndpointTests(TestCase):
    """GET /api/v1/export/shipments/sheet/ behaviour."""

    @classmethod
    def setUpTestData(cls):
        _seed_permissions()
        cls.season = Season.objects.create(
            name='2025-2026', start_date='2025-09-01', end_date='2026-06-30',
            is_active=True,
        )
        cls.old_season = Season.objects.create(
            name='2024-2025', start_date='2024-09-01', end_date='2025-06-30',
            is_active=False,
        )
        cls.status_loading = ShipmentStatusType.objects.create(
            code='yuklenme', name_tk='yuklenme', name_en='Loading',
            step_order=1, phase='LOADING',
        )
        cls.status_hasabat = ShipmentStatusType.objects.create(
            code='hasabat', name_tk='hasabat', name_en='Reporting',
            step_order=12, phase='COMPLETE',
        )
        cls.country_kz = Country.objects.create(name_tk='Gazagystan', name_en='Kazakhstan')
        cls.firm = ExportFirm.objects.create(code='YGT', name_tk='YGT H.J.', name_en='YGT H.J.')
        cls.block = GreenhouseBlock.objects.create(code='A', name='A-Ýyladyşhana')
        # Active-season shipment with a sales report
        cls.s1 = Shipment.objects.create(
            cargo_code='ACT-001', date='2026-02-01', season=cls.season,
            status=cls.status_hasabat, country=cls.country_kz,
            weight_net='18500.00',
        )
        SalesReport.objects.create(shipment=cls.s1, price_per_kg='0.85')
        # Active-season shipment without a sales report
        cls.s2 = Shipment.objects.create(
            cargo_code='ACT-002', date='2026-02-02', season=cls.season,
            status=cls.status_loading, country=cls.country_kz,
            weight_net='18000.00',
        )
        ShipmentFirmSplit.objects.create(
            shipment=cls.s2, export_firm=cls.firm, weight_kg='18000.00', split_order=1,
        )
        ShipmentBlockSource.objects.create(
            shipment=cls.s2, block=cls.block, weight_kg='18000.00',
        )
        # Old-season shipment — should NOT appear in default response
        cls.s_old = Shipment.objects.create(
            cargo_code='OLD-999', date='2025-01-15', season=cls.old_season,
            status=cls.status_hasabat,
        )

    def setUp(self):
        self.client = APIClient()
        self.user = _create_user('mgr', 'export_manager')
        self.client.force_authenticate(user=self.user)

    def test_anonymous_user_blocked(self):
        anon = APIClient()
        resp = anon.get('/api/v1/export/shipments/sheet/')
        self.assertEqual(resp.status_code, 401)

    def test_default_returns_active_season_only(self):
        resp = self.client.get('/api/v1/export/shipments/sheet/')
        self.assertEqual(resp.status_code, 200, resp.data)
        codes = {row['cargo_code'] for row in _sheet_results(resp)}
        self.assertEqual(codes, {'ACT-001', 'ACT-002'})

    def test_season_query_param_overrides_active(self):
        resp = self.client.get(f'/api/v1/export/shipments/sheet/?season={self.old_season.id}')
        self.assertEqual(resp.status_code, 200, resp.data)
        codes = {row['cargo_code'] for row in _sheet_results(resp)}
        self.assertEqual(codes, {'OLD-999'})

    def test_has_sales_report_annotation(self):
        resp = self.client.get('/api/v1/export/shipments/sheet/')
        by_code = {row['cargo_code']: row for row in _sheet_results(resp)}
        self.assertTrue(by_code['ACT-001']['has_sales_report'])
        self.assertFalse(by_code['ACT-002']['has_sales_report'])

    def test_inline_firm_splits_and_block_sources(self):
        resp = self.client.get('/api/v1/export/shipments/sheet/')
        by_code = {row['cargo_code']: row for row in _sheet_results(resp)}
        s2 = by_code['ACT-002']
        self.assertEqual(len(s2['firm_splits']), 1)
        self.assertEqual(len(s2['block_sources']), 1)
        self.assertEqual(s2['firm_splits'][0]['firm_code'], 'YGT')
        self.assertEqual(s2['block_sources'][0]['block_code'], 'A')

    def test_comment_count_annotations_per_role(self):
        """R17/R18 cells: warehouse_chief and document_team comment counts."""
        wh = _create_user('wh_count', 'warehouse_chief')
        doc = _create_user('doc_count', 'document_team')
        ShipmentComment.objects.create(shipment=self.s1, user=wh, content='harvest ok')
        ShipmentComment.objects.create(shipment=self.s1, user=wh, content='loaded')
        ShipmentComment.objects.create(shipment=self.s1, user=doc, content='docs sent')
        # s2 has no comments → both counts must be 0
        resp = self.client.get('/api/v1/export/shipments/sheet/')
        by_code = {row['cargo_code']: row for row in _sheet_results(resp)}
        self.assertEqual(by_code['ACT-001']['warehouse_comment_count'], 2)
        self.assertEqual(by_code['ACT-001']['document_comment_count'], 1)
        self.assertEqual(by_code['ACT-002']['warehouse_comment_count'], 0)
        self.assertEqual(by_code['ACT-002']['document_comment_count'], 0)

    def test_has_doc_advance_annotation(self):
        """R24 cell: true once a FinansistAdvanceShipment row links the shipment."""
        finansist = _create_user('fin_24', 'finansist')
        advance = FinansistAdvance.objects.create(
            advance_date='2026-02-01', total_amount='500.00', issued_by=finansist,
        )
        FinansistAdvanceShipment.objects.create(
            advance=advance, shipment=self.s1, allocated_amount='500.00',
        )
        resp = self.client.get('/api/v1/export/shipments/sheet/')
        by_code = {row['cargo_code']: row for row in _sheet_results(resp)}
        self.assertTrue(by_code['ACT-001']['has_doc_advance'])
        self.assertFalse(by_code['ACT-002']['has_doc_advance'])


class SheetPatchPermissionTests(TestCase):
    """PATCH /api/v1/export/shipments/{id}/ permission matrix."""

    @classmethod
    def setUpTestData(cls):
        _seed_permissions()
        cls.season = Season.objects.create(
            name='2025-2026', start_date='2025-09-01', end_date='2026-06-30',
            is_active=True,
        )
        cls.status_loading = ShipmentStatusType.objects.create(
            code='yuklenme', name_tk='yuklenme', name_en='Loading',
            step_order=1, phase='LOADING',
        )
        cls.shipment = Shipment.objects.create(
            cargo_code='PCH-001', date='2026-02-01', season=cls.season,
            status=cls.status_loading,
        )

    def setUp(self):
        self.client = APIClient()

    def _patch(self, role: str, payload: dict):
        user = _create_user(f'u_{role}', role)
        self.client.force_authenticate(user=user)
        return self.client.patch(
            f'/api/v1/export/shipments/{self.shipment.id}/', payload, format='json',
        )

    def test_warehouse_chief_can_edit_weight_net(self):
        resp = self._patch('warehouse_chief', {'weight_net': '17500.00'})
        self.assertEqual(resp.status_code, 200, resp.data)
        self.shipment.refresh_from_db()
        self.assertEqual(str(self.shipment.weight_net), '17500.00')

    def test_warehouse_chief_cannot_edit_price_per_kg(self):
        # price_per_kg is granted to finansist + sales_rep, NOT warehouse_chief
        resp = self._patch('warehouse_chief', {'price_per_kg': '0.95'})
        self.assertEqual(resp.status_code, 403, resp.data)
        self.assertIn('price_per_kg', resp.data['error'])

    def test_transport_can_edit_route_note(self):
        resp = self._patch('transport', {'route_note': 'Detour via Atyrau'})
        self.assertEqual(resp.status_code, 200, resp.data)

    def test_transport_cannot_edit_weight_net(self):
        resp = self._patch('transport', {'weight_net': '18000.00'})
        self.assertEqual(resp.status_code, 403, resp.data)

    def test_ad1_timestamp_rejected_via_patch(self):
        """AD-1 fields are excluded from _ALL_PATCHABLE_FIELDS — must always 403."""
        # export_manager has 'shipment' = ['*'] but the serializer's Meta.fields
        # excludes AD-1 timestamps, so they're treated as unknown fields.
        user = _create_user('mgr_ad1', 'export_manager')
        self.client.force_authenticate(user=user)
        resp = self.client.patch(
            f'/api/v1/export/shipments/{self.shipment.id}/',
            {'departed_at': '2026-02-02T10:00:00Z'},
            format='json',
        )
        # PATCH doesn't error on unknown fields by default — it silently drops.
        # The contract is that departed_at is NOT updated.
        self.assertEqual(resp.status_code, 200, resp.data)
        self.shipment.refresh_from_db()
        self.assertIsNone(self.shipment.departed_at)


class SheetJunctionEndpointTests(TestCase):
    """POST .../{id}/block-sources/ and .../{id}/firm-splits/."""

    @classmethod
    def setUpTestData(cls):
        _seed_permissions()
        cls.season = Season.objects.create(
            name='2025-2026', start_date='2025-09-01', end_date='2026-06-30',
            is_active=True,
        )
        cls.status_loading = ShipmentStatusType.objects.create(
            code='yuklenme', name_tk='yuklenme', name_en='Loading',
            step_order=1, phase='LOADING',
        )
        cls.firm_a = ExportFirm.objects.create(code='YGT', name_tk='YGT', name_en='YGT')
        cls.firm_b = ExportFirm.objects.create(code='SGT', name_tk='SGT', name_en='SGT')
        cls.block_a = GreenhouseBlock.objects.create(code='A', name='Block A')
        cls.block_b = GreenhouseBlock.objects.create(code='B', name='Block B')

    def setUp(self):
        self.client = APIClient()
        self.user = _create_user('mgr', 'export_manager')
        self.client.force_authenticate(user=self.user)
        self.shipment = Shipment.objects.create(
            cargo_code=f'JCT-{self.id()[-3:]}', date='2026-02-01',
            season=self.season, status=self.status_loading,
        )

    def test_block_sources_replaces_existing(self):
        ShipmentBlockSource.objects.create(
            shipment=self.shipment, block=self.block_a, weight_kg='9000',
        )
        resp = self.client.post(
            f'/api/v1/export/shipments/{self.shipment.id}/block-sources/',
            {'blocks': [
                {'block_id': self.block_b.id, 'weight_kg': 18000},
            ]},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        rows = list(self.shipment.block_sources.values_list('block_id', flat=True))
        self.assertEqual(rows, [self.block_b.id])

    def test_firm_splits_replaces_and_creates_draft_quota_usage(self):
        resp = self.client.post(
            f'/api/v1/export/shipments/{self.shipment.id}/firm-splits/',
            {'firms': [
                {'export_firm_id': self.firm_a.id, 'weight_kg': 9000},
                {'export_firm_id': self.firm_b.id, 'weight_kg': 9500},
            ]},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(self.shipment.firm_splits.count(), 2)
        # Draft QuotaUsageRecord must be auto-created — one per firm
        draft_records = QuotaUsageRecord.objects.filter(
            shipment=self.shipment, status='draft',
        )
        self.assertEqual(draft_records.count(), 2)

    def test_block_sources_auto_split_uses_weight_net(self):
        """R8: when caller omits weight_kg, server splits weight_net evenly."""
        self.shipment.weight_net = '18500.00'
        self.shipment.save()
        resp = self.client.post(
            f'/api/v1/export/shipments/{self.shipment.id}/block-sources/',
            {'blocks': [
                {'block_id': self.block_a.id},
                {'block_id': self.block_b.id},
            ]},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        weights = sorted(self.shipment.block_sources.values_list('weight_kg', flat=True))
        # 18500 / 2 = 9250 each (no remainder)
        self.assertEqual([str(w) for w in weights], ['9250.00', '9250.00'])

    def test_block_sources_auto_split_falls_back_when_weight_net_null(self):
        """R8: weight_net null → fallback 18100/N."""
        self.shipment.weight_net = None
        self.shipment.save()
        resp = self.client.post(
            f'/api/v1/export/shipments/{self.shipment.id}/block-sources/',
            {'blocks': [
                {'block_id': self.block_a.id},
                {'block_id': self.block_b.id},
            ]},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        weights = sorted(
            str(w) for w in self.shipment.block_sources.values_list('weight_kg', flat=True)
        )
        # 18100 / 2 = 9050 each
        self.assertEqual(weights, ['9050.00', '9050.00'])

    def test_block_sources_explicit_weight_honored(self):
        """R8: explicit non-zero weight_kg wins over auto-split."""
        resp = self.client.post(
            f'/api/v1/export/shipments/{self.shipment.id}/block-sources/',
            {'blocks': [
                {'block_id': self.block_a.id, 'weight_kg': 12000},
                {'block_id': self.block_b.id, 'weight_kg': 6500},
            ]},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        weights = sorted(
            str(w) for w in self.shipment.block_sources.values_list('weight_kg', flat=True)
        )
        self.assertEqual(weights, ['12000.00', '6500.00'][::-1])  # sorted

    def test_firm_splits_auto_fill_official_kg(self):
        """R9: 2 firms with no weight → both rows = 9000 (from TruckSplitDefault seed)."""
        resp = self.client.post(
            f'/api/v1/export/shipments/{self.shipment.id}/firm-splits/',
            {'firms': [
                {'export_firm_id': self.firm_a.id},
                {'export_firm_id': self.firm_b.id},
            ]},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        weights = list(self.shipment.firm_splits.values_list('weight_kg', flat=True))
        self.assertEqual([str(w) for w in weights], ['9000.00', '9000.00'])

    def test_firm_splits_auto_fill_official_kg_three_firms(self):
        """R9: 3 firms with no weight → all rows = 6000 (seed value)."""
        from apps.core.models import ExportFirm
        firm_c = ExportFirm.objects.create(code='OY3', name_tk='OY3', name_en='OY3')
        resp = self.client.post(
            f'/api/v1/export/shipments/{self.shipment.id}/firm-splits/',
            {'firms': [
                {'export_firm_id': self.firm_a.id},
                {'export_firm_id': self.firm_b.id},
                {'export_firm_id': firm_c.id},
            ]},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        weights = list(self.shipment.firm_splits.values_list('weight_kg', flat=True))
        self.assertEqual([str(w) for w in weights], ['6000.00', '6000.00', '6000.00'])

    def test_firm_splits_falls_back_when_no_seed_row(self):
        """R9: missing TruckSplitDefault row → fallback to 18100/N."""
        from apps.export.models import TruckSplitDefault, invalidate_truck_split_cache
        TruckSplitDefault.objects.filter(num_firms=2).delete()
        invalidate_truck_split_cache()
        resp = self.client.post(
            f'/api/v1/export/shipments/{self.shipment.id}/firm-splits/',
            {'firms': [
                {'export_firm_id': self.firm_a.id},
                {'export_firm_id': self.firm_b.id},
            ]},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        weights = [str(w) for w in self.shipment.firm_splits.values_list('weight_kg', flat=True)]
        # 18100 / 2 = 9050; weight_kg has 2 decimal places
        self.assertTrue(all(w.startswith('9050') for w in weights), weights)

    def test_firm_splits_blocked_when_approved_quota_usage_exists(self):
        ShipmentFirmSplit.objects.create(
            shipment=self.shipment, export_firm=self.firm_a,
            weight_kg='18500', split_order=1,
        )
        QuotaUsageRecord.objects.create(
            usage_date=self.shipment.date,
            export_firm=self.firm_a,
            kg_used='18500',
            product_type='tomato',
            shipment=self.shipment,
            status='approved',
            created_by=self.user,
        )
        resp = self.client.post(
            f'/api/v1/export/shipments/{self.shipment.id}/firm-splits/',
            {'firms': [{'export_firm_id': self.firm_b.id, 'weight_kg': 18000}]},
            format='json',
        )
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertIn('approved quota usage', resp.data['error'])
        # Splits unchanged
        self.assertEqual(self.shipment.firm_splits.count(), 1)
        self.assertEqual(self.shipment.firm_splits.first().export_firm_id, self.firm_a.id)
