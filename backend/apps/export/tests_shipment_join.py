"""Tests for the two-column Join shipment-creation flow.

Coverage:
  (a) loading_dept_head can create a supply draft with skip_forecast_check=True
  (b) join merges blocks + recomputes weight + deletes source + writes audit log
  (c) join rejected when target has no destination
  (d) join rejected when source has no blocks
  (e) join rejected for non-privileged caller (warehouse_chief and loading_dept_head)

All tests run against the SQLite test DB so no MSSQL instance is needed.
"""
import datetime
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import (
    Country,
    Customer,
    GreenhouseBlock,
    Season,
    ShipmentStatusType,
    User,
)
from apps.export.models import (
    Shipment,
    ShipmentBlockSource,
    ShipmentFirmSplit,
    ShipmentStatusLog,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_user(username: str, role: str) -> User:
    """Create a User with the given role."""
    user = User(username=username, role=role)
    user.set_password('pass')
    user.save()
    return user


def _make_season() -> Season:
    season, _ = Season.objects.get_or_create(
        name='jn-test',
        defaults={
            'start_date': '2025-09-01',
            'end_date': '2026-06-30',
            'is_active': True,
        },
    )
    return season


def _make_status(code: str, step_order: int = 0, phase: str = 'DRAFT') -> ShipmentStatusType:
    st, _ = ShipmentStatusType.objects.get_or_create(
        code=code,
        defaults={
            'name_tk': code,
            'name_en': code,
            'step_order': step_order,
            'phase': phase,
        },
    )
    return st


def _make_country() -> Country:
    country, _ = Country.objects.get_or_create(
        code='JT',
        defaults={'name_tk': 'Jtest', 'name_en': 'Jtest', 'name_ru': 'Jtest'},
    )
    return country


def _make_customer() -> Customer:
    customer, _ = Customer.objects.get_or_create(name='JoinTestCustomer')
    return customer


def _make_block(code: str = 'JB') -> GreenhouseBlock:
    block, _ = GreenhouseBlock.objects.get_or_create(code=code)
    return block


def _make_draft(
    cargo_code: str,
    country: Country | None = None,
    customer: Customer | None = None,
    user: User | None = None,
) -> Shipment:
    """Create a bare draft Shipment."""
    draft_status = _make_status('draft', step_order=0, phase='DRAFT')
    season = _make_season()
    return Shipment.objects.create(
        cargo_code=cargo_code,
        date=datetime.date(2026, 5, 25),
        season=season,
        status=draft_status,
        country=country,
        customer=customer,
        created_by=user,
    )


def _auth(client: APIClient, user: User) -> None:
    client.force_authenticate(user=user)


# ---------------------------------------------------------------------------
# (a) loading_dept_head can create a supply draft with skip_forecast_check
# ---------------------------------------------------------------------------

class LoadingDeptHeadDraftCreateTests(TestCase):
    """loading_dept_head is now in allowed_draft_roles and can bypass forecast check."""

    def setUp(self):
        self.client = APIClient()
        self.user = _make_user('soltanmyrat', 'loading_dept_head')
        _auth(self.client, self.user)
        _make_season()
        _make_status('draft', step_order=0, phase='DRAFT')

    def test_loading_dept_head_can_create_supply_draft_with_skip_forecast(self):
        """loading_dept_head can POST is_draft=True + skip_forecast_check=True
        without a HarvestDayEntry forecast existing for the block/date.
        """
        block = _make_block('JA')
        payload = {
            'is_draft': True,
            'skip_forecast_check': True,
            'block_sources': [
                {'block_id': block.pk, 'weight_kg': '12000.00'}
            ],
        }
        resp = self.client.post('/api/v1/export/shipments/', payload, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)

        data = resp.data
        self.assertEqual(data['status_code'], 'draft')
        # The block source should have been created
        shipment = Shipment.objects.get(pk=data['id'])
        self.assertEqual(shipment.block_sources.count(), 1)
        self.assertEqual(shipment.block_sources.first().weight_kg, Decimal('12000.00'))

    def test_loading_dept_head_draft_persists_variety_and_import_firm(self):
        """variety and import_firm accepted and stored on the draft."""
        from apps.core.models import TomatoVariety, ImportFirm

        variety, _ = TomatoVariety.objects.get_or_create(
            code='V01',
            defaults={'name': 'TestVariety', 'type': 'standard'},
        )
        import_firm, _ = ImportFirm.objects.get_or_create(
            name_company='JoinTestImportFirm',
        )
        payload = {
            'is_draft': True,
            'skip_forecast_check': True,
            'variety': variety.pk,
            'import_firm': import_firm.pk,
        }
        resp = self.client.post('/api/v1/export/shipments/', payload, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        shipment = Shipment.objects.get(pk=resp.data['id'])
        self.assertEqual(shipment.variety_id, variety.pk)
        self.assertEqual(shipment.import_firm_id, import_firm.pk)

    def test_loading_dept_head_draft_persists_firm_splits(self):
        """firm_splits accepted and stored on the draft."""
        from apps.core.models import ExportFirm

        firm, _ = ExportFirm.objects.get_or_create(
            code='EF01',
            defaults={'name_en': 'JoinTestExportFirm', 'name_tk': 'JoinTestExportFirm'},
        )
        payload = {
            'is_draft': True,
            'skip_forecast_check': True,
            'firm_splits': [
                {'export_firm': firm.pk, 'weight_kg': '10000.00'}
            ],
        }
        resp = self.client.post('/api/v1/export/shipments/', payload, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        shipment = Shipment.objects.get(pk=resp.data['id'])
        self.assertEqual(shipment.firm_splits.count(), 1)

    def test_warehouse_chief_still_allowed_to_create_draft(self):
        """Existing warehouse_chief draft-create permission is not broken."""
        wh_user = _make_user('wh_chief_jn', 'warehouse_chief')
        _auth(self.client, wh_user)
        payload = {'is_draft': True, 'skip_forecast_check': True}
        resp = self.client.post('/api/v1/export/shipments/', payload, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)

    def test_non_draft_role_cannot_create_draft(self):
        """A sales_rep (not in allowed_draft_roles) gets 403."""
        sales_user = _make_user('sales_jn', 'sales_rep')
        _auth(self.client, sales_user)
        payload = {'is_draft': True}
        resp = self.client.post('/api/v1/export/shipments/', payload, format='json')
        self.assertEqual(resp.status_code, 403)


# ---------------------------------------------------------------------------
# Weight-cap tests: supply-column draft vs. normal one-truck draft
# ---------------------------------------------------------------------------

class SupplyDraftWeightCapTests(TestCase):
    """Verify that the 18,500 kg truck-capacity cap is skipped for supply-column
    drafts (skip_forecast_check=True) but remains enforced for normal one-truck
    drafts (skip_forecast_check=False / omitted).
    """

    def setUp(self):
        self.client = APIClient()
        self.user = _make_user('soltanmyrat_wc', 'loading_dept_head')
        _auth(self.client, self.user)
        _make_season()
        _make_status('draft', step_order=0, phase='DRAFT')
        self.block = _make_block('JW')

    def test_supply_draft_with_25000_kg_block_is_accepted(self):
        """supply draft (skip_forecast_check=True) with 25,000 kg block → 201.

        A supply-column draft aggregates an entire day's harvest across multiple
        trucks and is split downstream, so neither the truck-capacity cap nor the
        forecast-pool cap must fire.
        """
        payload = {
            'is_draft': True,
            'skip_forecast_check': True,
            'block_sources': [
                {'block_id': self.block.pk, 'weight_kg': '25000.00'}
            ],
        }
        resp = self.client.post('/api/v1/export/shipments/', payload, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        shipment = Shipment.objects.get(pk=resp.data['id'])
        self.assertEqual(
            shipment.block_sources.first().weight_kg,
            Decimal('25000.00'),
        )

    def test_regular_draft_with_25000_kg_block_gets_400(self):
        """Normal one-truck draft (no skip_forecast_check) with 25,000 kg → 400.

        The 18,500 kg truck-capacity cap must still be enforced for the
        forecast-first draft path.
        """
        payload = {
            'is_draft': True,
            'block_sources': [
                {'block_id': self.block.pk, 'weight_kg': '25000.00'}
            ],
        }
        resp = self.client.post('/api/v1/export/shipments/', payload, format='json')
        self.assertEqual(resp.status_code, 400, resp.data)
        # Error must mention the truck-capacity limit
        error_text = str(resp.data)
        self.assertIn('18,500', error_text)


# ---------------------------------------------------------------------------
# (b) join: merges blocks + recomputes weight + deletes source + audit log
# ---------------------------------------------------------------------------

class JoinSuccessTests(TestCase):
    """Happy-path join merges supply draft into destination draft."""

    def setUp(self):
        self.client = APIClient()
        self.manager = _make_user('gadam_jn', 'export_manager')
        self.supply_user = _make_user('solt_jn', 'loading_dept_head')
        _auth(self.client, self.manager)

        self.country = _make_country()
        self.customer = _make_customer()
        self.block = _make_block('JC')

        # Target: destination draft (has country+customer, no blocks)
        self.target = _make_draft(
            '0101001/25',
            country=self.country,
            customer=self.customer,
            user=self.manager,
        )
        # Source: supply draft (has blocks, no destination)
        self.source = _make_draft('0101002/25', user=self.supply_user)
        ShipmentBlockSource.objects.create(
            shipment=self.source,
            block=self.block,
            weight_kg=Decimal('12500.00'),
        )

    def _join_url(self, target_pk: int) -> str:
        return f'/api/v1/export/shipments/{target_pk}/join/'

    def test_join_moves_block_sources_to_target(self):
        """Block sources from source end up on target after join."""
        resp = self.client.post(
            self._join_url(self.target.pk),
            {'source_id': self.source.pk},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)

        self.target.refresh_from_db()
        self.assertEqual(self.target.block_sources.count(), 1)
        bs = self.target.block_sources.first()
        self.assertEqual(bs.block_id, self.block.pk)
        self.assertEqual(bs.weight_kg, Decimal('12500.00'))

    def test_join_recomputes_weight_net(self):
        """target.weight_net is set to sum of its block_sources after join."""
        resp = self.client.post(
            self._join_url(self.target.pk),
            {'source_id': self.source.pk},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)

        self.target.refresh_from_db()
        self.assertEqual(self.target.weight_net, Decimal('12500.00'))

    def test_join_hard_deletes_source(self):
        """Source shipment is deleted after join."""
        source_pk = self.source.pk
        resp = self.client.post(
            self._join_url(self.target.pk),
            {'source_id': self.source.pk},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertFalse(Shipment.objects.filter(pk=source_pk).exists())

    def test_join_writes_audit_log_on_target(self):
        """A ShipmentStatusLog row is written on target after join."""
        resp = self.client.post(
            self._join_url(self.target.pk),
            {'source_id': self.source.pk},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)

        # Filter by prefix so the assertion is robust regardless of how many
        # other log rows exist on the target (e.g. from the task engine).
        join_logs = ShipmentStatusLog.objects.filter(
            shipment=self.target,
            comment__startswith='Joined',
        )
        self.assertEqual(join_logs.count(), 1, 'Expected exactly one "Joined" audit log row')
        join_log = join_logs.get()
        self.assertIn('0101002/25', join_log.comment)
        self.assertIn('solt_jn', join_log.comment)
        self.assertEqual(join_log.changed_by_id, self.manager.pk)

    def test_join_copies_variety_when_target_has_none(self):
        """variety is copied from source to target when target.variety is null."""
        from apps.core.models import TomatoVariety

        variety, _ = TomatoVariety.objects.get_or_create(
            code='V02',
            defaults={'name': 'TestV2', 'type': 'standard'},
        )
        self.source.variety = variety
        self.source.save(update_fields=['variety_id'])

        resp = self.client.post(
            self._join_url(self.target.pk),
            {'source_id': self.source.pk},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.target.refresh_from_db()
        self.assertEqual(self.target.variety_id, variety.pk)

    def test_join_moves_firm_splits_when_target_has_none(self):
        """Firm splits from source move to target when target has none."""
        from apps.core.models import ExportFirm

        firm, _ = ExportFirm.objects.get_or_create(
            code='EF02',
            defaults={'name_en': 'JoinTestFirm2', 'name_tk': 'JoinTestFirm2'},
        )
        ShipmentFirmSplit.objects.create(
            shipment=self.source,
            export_firm=firm,
            weight_kg=Decimal('12500.00'),
        )

        resp = self.client.post(
            self._join_url(self.target.pk),
            {'source_id': self.source.pk},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(self.target.firm_splits.count(), 1)
        self.assertEqual(self.target.firm_splits.first().export_firm_id, firm.pk)

    def test_join_target_stays_draft(self):
        """Target remains in draft status after join."""
        resp = self.client.post(
            self._join_url(self.target.pk),
            {'source_id': self.source.pk},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.target.refresh_from_db()
        self.assertEqual(self.target.status.code, 'draft')

    def test_join_returns_detail_serializer_shape(self):
        """Response is the full ShipmentDetailSerializer shape with cargo_code."""
        resp = self.client.post(
            self._join_url(self.target.pk),
            {'source_id': self.source.pk},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertIn('cargo_code', resp.data)
        self.assertEqual(resp.data['cargo_code'], '0101001/25')


# ---------------------------------------------------------------------------
# (c) join rejected when target has no destination
# ---------------------------------------------------------------------------

class JoinTargetNoDestinationTests(TestCase):
    """Join fails with 400 when target has no country/customer."""

    def setUp(self):
        self.client = APIClient()
        self.manager = _make_user('gadam_nd', 'export_manager')
        _auth(self.client, self.manager)
        self.block = _make_block('JD')

    def _join_url(self, target_pk: int) -> str:
        return f'/api/v1/export/shipments/{target_pk}/join/'

    def test_join_rejected_when_target_has_no_country_or_customer(self):
        """Target without country+customer returns 400."""
        target = _make_draft('0101010/25')
        source = _make_draft('0101011/25')
        ShipmentBlockSource.objects.create(
            shipment=source, block=self.block, weight_kg=Decimal('10000.00')
        )

        resp = self.client.post(
            self._join_url(target.pk),
            {'source_id': source.pk},
            format='json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn('destination', resp.data['error'])

    def test_join_rejected_when_target_has_country_but_no_customer(self):
        """Target with only country (no customer) also returns 400."""
        country = _make_country()
        target = _make_draft('0101012/25', country=country)
        source = _make_draft('0101013/25')
        ShipmentBlockSource.objects.create(
            shipment=source, block=self.block, weight_kg=Decimal('10000.00')
        )

        resp = self.client.post(
            self._join_url(target.pk),
            {'source_id': source.pk},
            format='json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn('destination', resp.data['error'])


# ---------------------------------------------------------------------------
# (d) join rejected when source has no blocks
# ---------------------------------------------------------------------------

class JoinSourceNoBlocksTests(TestCase):
    """Join fails with 400 when source has no block_sources rows."""

    def setUp(self):
        self.client = APIClient()
        self.manager = _make_user('gadam_nb', 'export_manager')
        _auth(self.client, self.manager)
        self.country = _make_country()
        self.customer = _make_customer()

    def _join_url(self, target_pk: int) -> str:
        return f'/api/v1/export/shipments/{target_pk}/join/'

    def test_join_rejected_when_source_has_no_blocks(self):
        """Source with no block_sources returns 400."""
        target = _make_draft('0101020/25', country=self.country, customer=self.customer)
        source = _make_draft('0101021/25')  # no blocks

        resp = self.client.post(
            self._join_url(target.pk),
            {'source_id': source.pk},
            format='json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn('supply blocks', resp.data['error'])


# ---------------------------------------------------------------------------
# (e) join rejected for non-privileged callers
# ---------------------------------------------------------------------------

class JoinPermissionTests(TestCase):
    """Join endpoint requires PRIVILEGED_ROLES (export_manager/director/admin)."""

    def setUp(self):
        self.client = APIClient()
        self.country = _make_country()
        self.customer = _make_customer()
        self.block = _make_block('JE')

        # Create a valid join pair
        self.target = _make_draft('0101030/25', country=self.country, customer=self.customer)
        self.source = _make_draft('0101031/25')
        ShipmentBlockSource.objects.create(
            shipment=self.source, block=self.block, weight_kg=Decimal('10000.00')
        )

    def _join_url(self, target_pk: int) -> str:
        return f'/api/v1/export/shipments/{target_pk}/join/'

    def _assert_join_forbidden(self, role: str):
        user = _make_user(f'user_{role}_jn', role)
        _auth(self.client, user)
        resp = self.client.post(
            self._join_url(self.target.pk),
            {'source_id': self.source.pk},
            format='json',
        )
        self.assertEqual(
            resp.status_code, 403,
            f'Expected 403 for role={role}, got {resp.status_code}: {resp.data}',
        )

    def test_warehouse_chief_cannot_join(self):
        """warehouse_chief is allowed to create supply drafts but NOT to join."""
        self._assert_join_forbidden('warehouse_chief')

    def test_loading_dept_head_cannot_join(self):
        """loading_dept_head can create supply drafts but NOT to join."""
        self._assert_join_forbidden('loading_dept_head')

    def test_sales_rep_cannot_join(self):
        self._assert_join_forbidden('sales_rep')

    def test_document_team_cannot_join(self):
        self._assert_join_forbidden('document_team')

    def test_export_manager_can_join(self):
        """export_manager IS in PRIVILEGED_ROLES and may join."""
        manager = _make_user('gadam_perm_jn', 'export_manager')
        _auth(self.client, manager)
        resp = self.client.post(
            self._join_url(self.target.pk),
            {'source_id': self.source.pk},
            format='json',
        )
        self.assertEqual(
            resp.status_code, 200,
            f'export_manager should be allowed; got {resp.status_code}: {resp.data}',
        )

    def test_anonymous_cannot_join(self):
        """Unauthenticated request returns 401."""
        self.client.force_authenticate(user=None)
        resp = self.client.post(
            self._join_url(self.target.pk),
            {'source_id': self.source.pk},
            format='json',
        )
        self.assertEqual(resp.status_code, 401)


# ---------------------------------------------------------------------------
# (bonus) ShipmentSheetSerializer.created_by_role
# ---------------------------------------------------------------------------

class SheetCreatedByRoleTests(TestCase):
    """created_by_role is included in the sheet endpoint response."""

    def setUp(self):
        self.client = APIClient()
        self.manager = _make_user('gadam_shr', 'export_manager')
        _auth(self.client, self.manager)
        _make_season()
        _make_status('draft', step_order=0, phase='DRAFT')

    def test_sheet_returns_created_by_role(self):
        """GET /sheet/ includes created_by_role for each shipment."""
        solt = _make_user('solt_shr', 'loading_dept_head')
        _make_draft('0101040/25', user=solt)

        resp = self.client.get('/api/v1/export/shipments/sheet/')
        self.assertEqual(resp.status_code, 200)
        results = resp.data.get('results', resp.data)
        # Find our draft in the results
        matches = [s for s in results if s['cargo_code'] == '0101040/25']
        self.assertTrue(matches, 'Draft not found in sheet response')
        self.assertEqual(matches[0]['created_by_role'], 'loading_dept_head')


# ---------------------------------------------------------------------------
# Multi-variety draft + join tests
# ---------------------------------------------------------------------------

def _make_variety(code: str, name: str = None) -> 'TomatoVariety':
    """Create or retrieve a TomatoVariety by code."""
    from apps.core.models import TomatoVariety
    v, _ = TomatoVariety.objects.get_or_create(
        code=code,
        defaults={'name': name or code, 'type': 'standard'},
    )
    return v


class DraftCreateMultiVarietyTests(TestCase):
    """(a) Draft create with varieties=[v1,v2,v3] populates M2M + back-compat FK."""

    def setUp(self):
        self.client = APIClient()
        self.user = _make_user('solt_mv', 'loading_dept_head')
        _auth(self.client, self.user)
        _make_season()
        _make_status('draft', step_order=0, phase='DRAFT')

    def test_varieties_list_sets_dominant_m2m_and_primary_fk(self):
        """POST with varieties=[v1,v2,v3] sets varieties_dominant to all three
        and variety FK to v1, with confidence='low'.
        """
        v1 = _make_variety('MV01', 'Multi1')
        v2 = _make_variety('MV02', 'Multi2')
        v3 = _make_variety('MV03', 'Multi3')

        payload = {
            'is_draft': True,
            'skip_forecast_check': True,
            'varieties': [v1.pk, v2.pk, v3.pk],
        }
        resp = self.client.post('/api/v1/export/shipments/', payload, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)

        shipment = Shipment.objects.get(pk=resp.data['id'])

        # Back-compat FK: first variety
        self.assertEqual(shipment.variety_id, v1.pk)

        # Confidence must be 'low' (manually estimated)
        self.assertEqual(shipment.variety_confidence, 'low')

        # M2M: all three varieties present (order-agnostic)
        dominant_ids = set(shipment.varieties_dominant.values_list('id', flat=True))
        self.assertEqual(dominant_ids, {v1.pk, v2.pk, v3.pk})

    def test_varieties_list_exactly_four_accepted(self):
        """Boundary: four varieties is valid."""
        vs = [_make_variety(f'MV{10+i}') for i in range(4)]
        payload = {
            'is_draft': True,
            'skip_forecast_check': True,
            'varieties': [v.pk for v in vs],
        }
        resp = self.client.post('/api/v1/export/shipments/', payload, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        shipment = Shipment.objects.get(pk=resp.data['id'])
        self.assertEqual(shipment.varieties_dominant.count(), 4)

    def test_varieties_list_sets_dominant_m2m_status_stays_draft(self):
        """Draft with varieties stays in draft status after creation (auto-advance guard)."""
        v1 = _make_variety('MVS1', 'StatusCheck1')
        v2 = _make_variety('MVS2', 'StatusCheck2')
        payload = {
            'is_draft': True,
            'skip_forecast_check': True,
            'varieties': [v1.pk, v2.pk],
        }
        resp = self.client.post('/api/v1/export/shipments/', payload, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        shipment = Shipment.objects.get(pk=resp.data['id'])
        self.assertEqual(shipment.status.code, 'draft')

    def test_varieties_list_five_rejected(self):
        """Validation: five varieties is rejected with 400."""
        vs = [_make_variety(f'MV{20+i}') for i in range(5)]
        payload = {
            'is_draft': True,
            'skip_forecast_check': True,
            'varieties': [v.pk for v in vs],
        }
        resp = self.client.post('/api/v1/export/shipments/', payload, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_varieties_duplicate_ids_rejected(self):
        """Validation: duplicate variety IDs in the list are rejected with 400."""
        v = _make_variety('MVDUP', 'DupVariety')
        payload = {
            'is_draft': True,
            'skip_forecast_check': True,
            'varieties': [v.pk, v.pk],
        }
        resp = self.client.post('/api/v1/export/shipments/', payload, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_single_variety_field_without_varieties_does_not_populate_m2m(self):
        """Back-compat: passing only `variety` (single FK) leaves varieties_dominant empty.

        Callers who want the M2M populated must pass the `varieties` list explicitly.
        """
        v = _make_variety('MV30', 'SingleOnly')
        payload = {
            'is_draft': True,
            'skip_forecast_check': True,
            'variety': v.pk,
        }
        resp = self.client.post('/api/v1/export/shipments/', payload, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        shipment = Shipment.objects.get(pk=resp.data['id'])
        self.assertEqual(shipment.variety_id, v.pk)
        self.assertEqual(shipment.varieties_dominant.count(), 0)


class JoinMultiVarietyTests(TestCase):
    """(b/c) Join copies source.varieties_dominant → target when target has none;
    does NOT overwrite when target already has varieties.
    """

    def setUp(self):
        self.client = APIClient()
        self.manager = _make_user('gadam_mv', 'export_manager')
        self.supply_user = _make_user('solt_mv2', 'loading_dept_head')
        _auth(self.client, self.manager)

        self.country = _make_country()
        self.customer = _make_customer()
        self.block = _make_block('JF')

        self.v1 = _make_variety('JV01', 'JVar1')
        self.v2 = _make_variety('JV02', 'JVar2')
        self.vx = _make_variety('JVX0', 'JVarX')  # pre-existing on target

    def _make_supply_draft(self, cargo_code: str) -> 'Shipment':
        """Supply draft with one block source and two dominant varieties."""
        source = _make_draft(cargo_code, user=self.supply_user)
        ShipmentBlockSource.objects.create(
            shipment=source, block=self.block, weight_kg=Decimal('11000.00')
        )
        source.varieties_dominant.set([self.v1, self.v2])
        source.variety = self.v1
        source.save(update_fields=['variety_id'])
        return source

    def _join_url(self, target_pk: int) -> str:
        return f'/api/v1/export/shipments/{target_pk}/join/'

    def test_join_copies_varieties_dominant_when_target_has_none(self):
        """(b) Join copies source.varieties_dominant to target that has no varieties."""
        target = _make_draft(
            '0202001/25', country=self.country, customer=self.customer, user=self.manager
        )
        source = self._make_supply_draft('0202002/25')

        resp = self.client.post(
            self._join_url(target.pk), {'source_id': source.pk}, format='json'
        )
        self.assertEqual(resp.status_code, 200, resp.data)

        target.refresh_from_db()
        dominant_ids = set(target.varieties_dominant.values_list('id', flat=True))
        self.assertEqual(dominant_ids, {self.v1.pk, self.v2.pk})

    def test_join_does_not_overwrite_target_varieties_when_target_has_some(self):
        """(c) Join does NOT overwrite target.varieties_dominant when target already
        has at least one variety set.
        """
        target = _make_draft(
            '0202010/25', country=self.country, customer=self.customer, user=self.manager
        )
        # Pre-populate target with its own variety
        target.varieties_dominant.set([self.vx])
        target.variety = self.vx
        target.save(update_fields=['variety_id'])

        source = self._make_supply_draft('0202011/25')

        resp = self.client.post(
            self._join_url(target.pk), {'source_id': source.pk}, format='json'
        )
        self.assertEqual(resp.status_code, 200, resp.data)

        target.refresh_from_db()
        # Still only vx — source varieties must not have been applied
        dominant_ids = set(target.varieties_dominant.values_list('id', flat=True))
        self.assertEqual(dominant_ids, {self.vx.pk})

    def test_join_source_with_no_varieties_leaves_target_empty(self):
        """Join from source with no varieties_dominant leaves target with empty M2M
        (when target also has none).
        """
        target = _make_draft(
            '0202020/25', country=self.country, customer=self.customer, user=self.manager
        )
        source = _make_draft('0202021/25', user=self.supply_user)
        ShipmentBlockSource.objects.create(
            shipment=source, block=self.block, weight_kg=Decimal('9000.00')
        )
        # source has no varieties_dominant set

        resp = self.client.post(
            self._join_url(target.pk), {'source_id': source.pk}, format='json'
        )
        self.assertEqual(resp.status_code, 200, resp.data)

        target.refresh_from_db()
        self.assertEqual(target.varieties_dominant.count(), 0)
