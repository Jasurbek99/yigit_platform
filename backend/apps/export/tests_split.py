"""Tests for POST /api/v1/export/shipments/{id}/split/.

Coverage (matching the plan spec):
  1.  Atomicity — failure during truck k rolls back all trucks; draft stays 'draft'.
  2.  Per-block sum invariant — single-block exact: one block_source per truck == truck weight.
  3.  Per-block sum invariant — multi-block straddle: truck draws across two blocks.
  4.  Weight ≤18500 per truck enforced (serializer-level 400).
  5.  Σ truck weights ≤ draft_total enforced (view-level 400).
  6.  Draft finalized: status cancelled, block_sources deleted, firm_splits deleted,
      draft quota_usage deleted, draft tasks cancelled.
  7.  Per truck: status gumruk_girish after split.
  8.  Per truck: unique cargo_code.
  9.  Per truck: shares official_export_code with draft.
  10. Per truck: firm_splits created + draft QuotaUsageRecord created (with official kg).
  11. Freshly split truck stays gumruk_girish — no auto-advance fires.
  12. 403 for non-privileged role.
  13. 400 if shipment is not a draft.
  14. Leftover kg is discarded; AuditLog row created.

Run:
    python manage.py test apps.export.tests_split --verbosity=2
"""
import datetime as dt
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import (
    Country,
    Customer,
    ExportFirm,
    GreenhouseBlock,
    ImportFirm,
    Season,
    ShipmentStatusType,
    User,
)
from apps.export.models import (
    AuditLog,
    QuotaUsageRecord,
    Shipment,
    ShipmentBlockSource,
    ShipmentFirmSplit,
    ShipmentStatusLog,
    Task,
    TaskCompletionRule,
    TaskState,
)

# ---------------------------------------------------------------------------
# Test status set — minimum needed for split tests.
# Seed draft, gumruk_girish, cancelled; that's all transitions used here.
# ---------------------------------------------------------------------------

STATUS_SPECS = [
    ('draft',         0,  'DRAFT',     'Draft'),
    ('gumruk_girish', 1,  'CUSTOMS',   'Customs Entry'),
    ('cancelled',     99, 'CANCELLED', 'Cancelled'),
]


def _ensure_statuses() -> None:
    for code, order, phase, name_en in STATUS_SPECS:
        ShipmentStatusType.objects.get_or_create(
            code=code,
            defaults={
                'name_tk': code,
                'name_en': name_en,
                'name_ru': name_en,
                'step_order': order,
                'phase': phase,
                'is_active': True,
            },
        )


def _make_user(username: str, role: str) -> User:
    return User.objects.create_user(username=username, password='pw', role=role)


def _make_season() -> Season:
    season, _ = Season.objects.get_or_create(
        name='2025-split',
        defaults={'start_date': '2025-01-01', 'end_date': '2025-12-31', 'is_active': True},
    )
    return season


def _make_draft(
    cargo_code: str,
    season: Season,
    user: User,
    date=None,
    official_export_code: str = '',
) -> Shipment:
    if date is None:
        date = dt.date(2025, 5, 1)
    status_obj = ShipmentStatusType.objects.get(code='draft')
    return Shipment.objects.create(
        cargo_code=cargo_code,
        date=date,
        season=season,
        status=status_obj,
        created_by=user,
        official_export_code=official_export_code,
    )


def _add_block_source(
    shipment: Shipment,
    block: GreenhouseBlock,
    weight_kg: Decimal,
    harvest_date=None,
) -> ShipmentBlockSource:
    return ShipmentBlockSource.objects.create(
        shipment=shipment,
        block=block,
        weight_kg=weight_kg,
        harvest_date=harvest_date,
    )


# ---------------------------------------------------------------------------
# Base class — shared setUpTestData
# ---------------------------------------------------------------------------

class SplitTestBase(TestCase):
    """Provides common fixtures for all split-related test classes."""

    @classmethod
    def setUpTestData(cls):
        _ensure_statuses()
        cls.manager = _make_user('split_mgr', 'export_manager')
        cls.sales_rep = _make_user('split_rep', 'sales_rep')
        cls.season = _make_season()
        cls.block_a = GreenhouseBlock.objects.create(code='SA', name='Split Block A')
        cls.block_b = GreenhouseBlock.objects.create(code='SB', name='Split Block B')
        cls.country = Country.objects.create(
            name_tk='Gazagystan', name_en='Kazakhstan', name_ru='Казахстан', code='KZ-SP',
        )
        cls.customer = Customer.objects.create(name='SplitCustomer')
        cls.import_firm = ImportFirm.objects.create(name_company='SplitImportFirm')
        cls.export_firm_1 = ExportFirm.objects.create(
            code='SXF1', name_tk='Split Firm 1', name_en='Split Firm 1',
        )
        cls.export_firm_2 = ExportFirm.objects.create(
            code='SXF2', name_tk='Split Firm 2', name_en='Split Firm 2',
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.manager)

    def _split_url(self, shipment_id: int) -> str:
        return f'/api/v1/export/shipments/{shipment_id}/split/'


# ---------------------------------------------------------------------------
# Test 1 — Atomicity
# ---------------------------------------------------------------------------

class AtomicityTests(SplitTestBase):
    """Failure mid-split rolls back all created trucks; draft stays 'draft'."""

    def test_failure_on_invalid_truck_rolls_back_all(self):
        """If the second truck has weight > 18500, the whole request is rejected
        and no truck shipment is created (serializer validation catches it before
        the transaction even starts)."""
        draft = _make_draft('ATOM001/25', self.season, self.manager)
        _add_block_source(draft, self.block_a, Decimal('30000'))

        before_count = Shipment.objects.count()

        resp = self.client.post(self._split_url(draft.id), {
            'trucks': [
                {'weight_kg': '15000'},
                {'weight_kg': '99999'},   # over 18500 — serializer rejects
            ],
        }, format='json')

        self.assertEqual(resp.status_code, 400, resp.data)

        # No new shipments created.
        self.assertEqual(Shipment.objects.count(), before_count)

        # Draft must remain in 'draft'.
        draft.refresh_from_db()
        self.assertEqual(draft.status.code, 'draft')

    def test_non_draft_status_returns_400_no_side_effects(self):
        """A shipment already at gumruk_girish returns 400 with no side effects."""
        gg_status = ShipmentStatusType.objects.get(code='gumruk_girish')
        non_draft = Shipment.objects.create(
            cargo_code='ATOM002/25',
            date=dt.date(2025, 5, 1),
            season=self.season,
            status=gg_status,
            created_by=self.manager,
        )

        before_count = Shipment.objects.count()

        resp = self.client.post(self._split_url(non_draft.id), {
            'trucks': [{'weight_kg': '5000'}],
        }, format='json')

        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertEqual(Shipment.objects.count(), before_count)


# ---------------------------------------------------------------------------
# Test 2 — Per-block sum invariant: single-block exact
# ---------------------------------------------------------------------------

class SingleBlockDrawdownTests(SplitTestBase):
    """Single-block draft: each truck gets exactly one block_source == truck weight."""

    def test_single_block_two_trucks(self):
        """Draft with 30000 kg on block_a splits into two trucks of 15000 each."""
        draft = _make_draft('SB001/25', self.season, self.manager)
        _add_block_source(draft, self.block_a, Decimal('30000'))

        resp = self.client.post(self._split_url(draft.id), {
            'trucks': [
                {'weight_kg': '15000'},
                {'weight_kg': '15000'},
            ],
        }, format='json')

        self.assertEqual(resp.status_code, 200, resp.data)
        ids = resp.data['created_truck_ids']
        self.assertEqual(len(ids), 2)

        for truck_id in ids:
            sources = ShipmentBlockSource.objects.filter(shipment_id=truck_id)
            self.assertEqual(sources.count(), 1, 'Single-block: exactly one source per truck')
            self.assertEqual(sources.first().block_id, self.block_a.id)
            self.assertEqual(sources.first().weight_kg, Decimal('15000'))

        # Per-block sum invariant: total drawn from block_a == 30000.
        total = ShipmentBlockSource.objects.filter(
            shipment_id__in=ids
        ).aggregate(s=__import__('django.db.models', fromlist=['Sum']).Sum('weight_kg'))['s']
        self.assertEqual(total, Decimal('30000'))

    def test_single_block_three_trucks_uneven(self):
        """Uneven weights from a single block: 10000 + 8000 + 5000 = 23000."""
        draft = _make_draft('SB002/25', self.season, self.manager)
        _add_block_source(draft, self.block_a, Decimal('23000'))

        resp = self.client.post(self._split_url(draft.id), {
            'trucks': [
                {'weight_kg': '10000'},
                {'weight_kg': '8000'},
                {'weight_kg': '5000'},
            ],
        }, format='json')

        self.assertEqual(resp.status_code, 200, resp.data)
        ids = resp.data['created_truck_ids']
        from django.db.models import Sum
        total = ShipmentBlockSource.objects.filter(shipment_id__in=ids).aggregate(
            s=Sum('weight_kg')
        )['s']
        self.assertEqual(total, Decimal('23000'))


# ---------------------------------------------------------------------------
# Test 3 — Per-block sum invariant: multi-block straddle
# ---------------------------------------------------------------------------

class MultiBlockStraddle(SplitTestBase):
    """Multi-block draft: truck may draw across blocks; per-block totals preserved."""

    def test_two_blocks_one_truck_straddles(self):
        """Draft: block_a=10000, block_b=8000. Truck1=12000 straddles both blocks."""
        draft = _make_draft('MB001/25', self.season, self.manager)
        _add_block_source(draft, self.block_a, Decimal('10000'))
        _add_block_source(draft, self.block_b, Decimal('8000'))

        resp = self.client.post(self._split_url(draft.id), {
            'trucks': [
                {'weight_kg': '12000'},
                {'weight_kg': '6000'},
            ],
        }, format='json')

        self.assertEqual(resp.status_code, 200, resp.data)
        ids = resp.data['created_truck_ids']
        self.assertEqual(len(ids), 2)

        from django.db.models import Sum
        # First truck should have drawn 10000 from block_a and 2000 from block_b.
        truck1_id = ids[0]
        sources_t1 = {
            s.block_id: s.weight_kg
            for s in ShipmentBlockSource.objects.filter(shipment_id=truck1_id)
        }
        self.assertEqual(sources_t1.get(self.block_a.id), Decimal('10000'))
        self.assertEqual(sources_t1.get(self.block_b.id), Decimal('2000'))

        # Second truck should have drawn remaining 6000 from block_b.
        truck2_id = ids[1]
        sources_t2 = {
            s.block_id: s.weight_kg
            for s in ShipmentBlockSource.objects.filter(shipment_id=truck2_id)
        }
        self.assertNotIn(self.block_a.id, sources_t2)
        self.assertEqual(sources_t2.get(self.block_b.id), Decimal('6000'))

        # Per-block invariant: total from block_a == 10000, block_b == 8000.
        block_a_total = ShipmentBlockSource.objects.filter(
            shipment_id__in=ids, block_id=self.block_a.id
        ).aggregate(s=Sum('weight_kg'))['s'] or Decimal('0')
        block_b_total = ShipmentBlockSource.objects.filter(
            shipment_id__in=ids, block_id=self.block_b.id
        ).aggregate(s=Sum('weight_kg'))['s'] or Decimal('0')

        self.assertEqual(block_a_total, Decimal('10000'))
        self.assertEqual(block_b_total, Decimal('8000'))


# ---------------------------------------------------------------------------
# Test 4 — Weight ≤18500 enforced (serializer-level)
# ---------------------------------------------------------------------------

class WeightValidationTests(SplitTestBase):
    """Per-truck weight > 18500 returns 400 before any DB write."""

    def test_truck_over_18500_returns_400(self):
        draft = _make_draft('WV001/25', self.season, self.manager)
        _add_block_source(draft, self.block_a, Decimal('20000'))

        resp = self.client.post(self._split_url(draft.id), {
            'trucks': [{'weight_kg': '18501'}],
        }, format='json')

        self.assertEqual(resp.status_code, 400, resp.data)
        draft.refresh_from_db()
        self.assertEqual(draft.status.code, 'draft')

    def test_exactly_18500_is_allowed(self):
        """18500 is the boundary — should succeed."""
        draft = _make_draft('WV002/25', self.season, self.manager)
        _add_block_source(draft, self.block_a, Decimal('18500'))

        resp = self.client.post(self._split_url(draft.id), {
            'trucks': [{'weight_kg': '18500'}],
        }, format='json')

        self.assertEqual(resp.status_code, 200, resp.data)


# ---------------------------------------------------------------------------
# Test 5 — Σ truck weights ≤ draft_total (view-level)
# ---------------------------------------------------------------------------

class SumWeightValidationTests(SplitTestBase):
    """Σ truck weights > draft total returns 400 at view level."""

    def test_sum_exceeds_draft_total_returns_400(self):
        draft = _make_draft('SW001/25', self.season, self.manager)
        _add_block_source(draft, self.block_a, Decimal('10000'))

        resp = self.client.post(self._split_url(draft.id), {
            'trucks': [
                {'weight_kg': '6000'},
                {'weight_kg': '6000'},  # total = 12000 > 10000
            ],
        }, format='json')

        self.assertEqual(resp.status_code, 400, resp.data)
        draft.refresh_from_db()
        self.assertEqual(draft.status.code, 'draft')

    def test_sum_exactly_equals_draft_total(self):
        """Σ == draft_total is allowed (no leftover)."""
        draft = _make_draft('SW002/25', self.season, self.manager)
        _add_block_source(draft, self.block_a, Decimal('18000'))

        resp = self.client.post(self._split_url(draft.id), {
            'trucks': [
                {'weight_kg': '9000'},
                {'weight_kg': '9000'},
            ],
        }, format='json')

        self.assertEqual(resp.status_code, 200, resp.data)


# ---------------------------------------------------------------------------
# Test 6 — Draft finalized correctly
# ---------------------------------------------------------------------------

class DraftFinalizationTests(SplitTestBase):
    """After split: draft is cancelled, its block_sources deleted, tasks cancelled."""

    def test_draft_cancelled_and_cleaned_up(self):
        draft = _make_draft('DF001/25', self.season, self.manager)
        bs = _add_block_source(draft, self.block_a, Decimal('20000'))

        # Add an open task on the draft.
        gg_status = ShipmentStatusType.objects.get(code='gumruk_girish')
        task = Task.objects.create(
            shipment=draft,
            step='draft',
            title_key='tasks.test_split_task',
            assignee_role='export_manager',
            completion_rule=TaskCompletionRule.MANUAL_DONE,
            state=TaskState.OPEN,
        )

        resp = self.client.post(self._split_url(draft.id), {
            'trucks': [
                {'weight_kg': '10000'},
                {'weight_kg': '10000'},
            ],
        }, format='json')

        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['cancelled_draft_id'], draft.id)

        draft.refresh_from_db()
        self.assertEqual(draft.status.code, 'cancelled', 'Draft must be cancelled')

        # Block sources on the draft must be deleted.
        self.assertFalse(
            ShipmentBlockSource.objects.filter(shipment=draft).exists(),
            'Draft block_sources must be deleted after split',
        )

        # Open task must be cancelled.
        task.refresh_from_db()
        self.assertEqual(
            task.state, TaskState.CANCELLED,
            'Open tasks on draft must be cancelled after split',
        )

    def test_draft_firm_splits_and_quota_usage_deleted(self):
        """Draft's own firm_splits and draft quota_usage are deleted (redistributed)."""
        draft = _make_draft('DF002/25', self.season, self.manager)
        _add_block_source(draft, self.block_a, Decimal('18000'))

        # Pre-create firm splits and quota usage on the draft.
        ShipmentFirmSplit.objects.create(
            shipment=draft, export_firm=self.export_firm_1,
            weight_kg=Decimal('9000'), split_order=1,
        )
        QuotaUsageRecord.objects.create(
            shipment=draft, export_firm=self.export_firm_1,
            usage_date=draft.date, kg_used=Decimal('9000'),
            product_type='tomato', status='draft',
        )

        resp = self.client.post(self._split_url(draft.id), {
            'trucks': [{'weight_kg': '18000'}],
        }, format='json')

        self.assertEqual(resp.status_code, 200, resp.data)

        self.assertFalse(
            ShipmentFirmSplit.objects.filter(shipment=draft).exists(),
            'Draft firm_splits must be deleted',
        )
        self.assertFalse(
            QuotaUsageRecord.objects.filter(shipment=draft, status='draft').exists(),
            'Draft QuotaUsageRecords on the draft must be deleted',
        )


# ---------------------------------------------------------------------------
# Test 7 — Per truck: status is gumruk_girish
# ---------------------------------------------------------------------------

class TruckStatusTests(SplitTestBase):
    """Every created truck lands at gumruk_girish."""

    def test_each_truck_in_gumruk_girish(self):
        draft = _make_draft('TS001/25', self.season, self.manager)
        _add_block_source(draft, self.block_a, Decimal('30000'))

        resp = self.client.post(self._split_url(draft.id), {
            'trucks': [
                {'weight_kg': '15000'},
                {'weight_kg': '15000'},
            ],
        }, format='json')

        self.assertEqual(resp.status_code, 200, resp.data)
        for truck_id in resp.data['created_truck_ids']:
            ship = Shipment.objects.get(pk=truck_id)
            self.assertEqual(
                ship.status.code, 'gumruk_girish',
                f'Truck {truck_id} expected gumruk_girish, got {ship.status.code}',
            )


# ---------------------------------------------------------------------------
# Test 8 — Per truck: unique cargo_code
# ---------------------------------------------------------------------------

class UniqueCargoCodes(SplitTestBase):
    """Each truck in the split gets a different cargo_code."""

    def test_cargo_codes_are_unique(self):
        draft = _make_draft('UC001/25', self.season, self.manager)
        _add_block_source(draft, self.block_a, Decimal('40000'))

        resp = self.client.post(self._split_url(draft.id), {
            'trucks': [
                {'weight_kg': '10000'},
                {'weight_kg': '10000'},
                {'weight_kg': '10000'},
                {'weight_kg': '10000'},
            ],
        }, format='json')

        self.assertEqual(resp.status_code, 200, resp.data)
        codes = list(
            Shipment.objects.filter(
                pk__in=resp.data['created_truck_ids']
            ).values_list('cargo_code', flat=True)
        )
        self.assertEqual(len(codes), len(set(codes)), f'Codes must be unique: {codes}')

    def test_truck_code_does_not_equal_draft_code(self):
        """Truck cargo_codes must differ from the draft's code."""
        draft = _make_draft('UC002/25', self.season, self.manager)
        _add_block_source(draft, self.block_a, Decimal('18000'))

        resp = self.client.post(self._split_url(draft.id), {
            'trucks': [{'weight_kg': '18000'}],
        }, format='json')

        self.assertEqual(resp.status_code, 200, resp.data)
        truck = Shipment.objects.get(pk=resp.data['created_truck_ids'][0])
        self.assertNotEqual(truck.cargo_code, draft.cargo_code)


# ---------------------------------------------------------------------------
# Test 9 — Per truck: shares official_export_code with draft
# ---------------------------------------------------------------------------

class SharedOfficialExportCode(SplitTestBase):
    """Trucks inherit the draft's official_export_code."""

    def test_official_code_shared(self):
        draft = _make_draft(
            'OEC001/25', self.season, self.manager,
            official_export_code='010501A25AA',
        )
        _add_block_source(draft, self.block_a, Decimal('30000'))

        resp = self.client.post(self._split_url(draft.id), {
            'trucks': [
                {'weight_kg': '15000'},
                {'weight_kg': '15000'},
            ],
        }, format='json')

        self.assertEqual(resp.status_code, 200, resp.data)
        for truck_id in resp.data['created_truck_ids']:
            ship = Shipment.objects.get(pk=truck_id)
            self.assertEqual(
                ship.official_export_code, '010501A25AA',
                f'Truck {truck_id} must share the draft official_export_code',
            )
            self.assertEqual(
                ship.previous_platform_id_id, draft.id,
                f'Truck {truck_id} must link back to the draft batch',
            )

    def test_harvest_date_propagated_to_truck_block_sources(self):
        """The draw-down carries each draft block's harvest_date onto the truck."""
        import datetime
        hd = datetime.date(2026, 5, 18)
        draft = _make_draft('OEC003/25', self.season, self.manager)
        _add_block_source(draft, self.block_a, Decimal('18000'), harvest_date=hd)

        resp = self.client.post(self._split_url(draft.id), {
            'trucks': [{'weight_kg': '18000'}],
        }, format='json')

        self.assertEqual(resp.status_code, 200, resp.data)
        truck = Shipment.objects.get(pk=resp.data['created_truck_ids'][0])
        block_source = truck.block_sources.first()
        self.assertIsNotNone(block_source)
        self.assertEqual(block_source.harvest_date, hd)

    def test_official_code_null_propagated(self):
        """When draft has no official_export_code, trucks also have null."""
        draft = _make_draft('OEC002/25', self.season, self.manager)
        _add_block_source(draft, self.block_a, Decimal('18000'))

        resp = self.client.post(self._split_url(draft.id), {
            'trucks': [{'weight_kg': '18000'}],
        }, format='json')

        self.assertEqual(resp.status_code, 200, resp.data)
        truck = Shipment.objects.get(pk=resp.data['created_truck_ids'][0])
        # official_export_code is '' or None when not set on draft.
        self.assertFalse(
            bool(truck.official_export_code),
            f'Expected falsy official_export_code, got {truck.official_export_code!r}',
        )


# ---------------------------------------------------------------------------
# Test 10 — Firm splits + draft QuotaUsageRecord created per truck
# ---------------------------------------------------------------------------

class FirmSplitsAndQuotaTests(SplitTestBase):
    """Trucks with firm_splits get ShipmentFirmSplit + QuotaUsageRecord rows."""

    def test_firm_splits_created_with_official_kg(self):
        """Firm split weight_kg == get_default_truck_weight(1) (official, not truck weight)."""
        from apps.export.models import get_default_truck_weight
        draft = _make_draft('FSQ001/25', self.season, self.manager)
        _add_block_source(draft, self.block_a, Decimal('18000'))

        resp = self.client.post(self._split_url(draft.id), {
            'trucks': [{
                'weight_kg': '18000',
                'firm_splits': [{'export_firm_id': self.export_firm_1.id}],
            }],
        }, format='json')

        self.assertEqual(resp.status_code, 200, resp.data)
        truck_id = resp.data['created_truck_ids'][0]

        splits = ShipmentFirmSplit.objects.filter(shipment_id=truck_id)
        self.assertEqual(splits.count(), 1)
        self.assertEqual(splits.first().export_firm_id, self.export_firm_1.id)

        # Weight must be the official kg for 1 firm, NOT the truck's real 18000.
        expected_official = get_default_truck_weight(1)
        self.assertEqual(splits.first().weight_kg, expected_official)

        # QuotaUsageRecord created with official kg and status=draft.
        qur = QuotaUsageRecord.objects.filter(shipment_id=truck_id, status='draft')
        self.assertEqual(qur.count(), 1)
        self.assertEqual(qur.first().kg_used, expected_official)
        self.assertEqual(qur.first().export_firm_id, self.export_firm_1.id)

    def test_two_firms_per_truck(self):
        """Two-firm truck creates two split rows and two quota records."""
        from apps.export.models import get_default_truck_weight
        draft = _make_draft('FSQ002/25', self.season, self.manager)
        _add_block_source(draft, self.block_a, Decimal('18000'))

        resp = self.client.post(self._split_url(draft.id), {
            'trucks': [{
                'weight_kg': '18000',
                'firm_splits': [
                    {'export_firm_id': self.export_firm_1.id},
                    {'export_firm_id': self.export_firm_2.id},
                ],
            }],
        }, format='json')

        self.assertEqual(resp.status_code, 200, resp.data)
        truck_id = resp.data['created_truck_ids'][0]

        splits = ShipmentFirmSplit.objects.filter(shipment_id=truck_id).order_by('split_order')
        self.assertEqual(splits.count(), 2)

        expected_official = get_default_truck_weight(2)
        for split in splits:
            self.assertEqual(split.weight_kg, expected_official)

        qur_count = QuotaUsageRecord.objects.filter(shipment_id=truck_id, status='draft').count()
        self.assertEqual(qur_count, 2)

    def test_zero_firm_truck_no_quota_usage(self):
        """A truck without firm_splits creates no QuotaUsageRecord."""
        draft = _make_draft('FSQ003/25', self.season, self.manager)
        _add_block_source(draft, self.block_a, Decimal('18000'))

        resp = self.client.post(self._split_url(draft.id), {
            'trucks': [{'weight_kg': '18000'}],
        }, format='json')

        self.assertEqual(resp.status_code, 200, resp.data)
        truck_id = resp.data['created_truck_ids'][0]

        self.assertFalse(
            QuotaUsageRecord.objects.filter(shipment_id=truck_id).exists(),
            'Zero-firm truck must not create any QuotaUsageRecord',
        )
        self.assertFalse(
            ShipmentFirmSplit.objects.filter(shipment_id=truck_id).exists(),
        )

    def test_per_firm_weight_override_applied_to_split_only(self):
        """Explicit per-firm weight override flows to ShipmentFirmSplit.weight_kg
        but NOT to QuotaUsageRecord (mirrors /firm-splits/ exact behaviour)."""
        from apps.export.models import get_default_truck_weight
        draft = _make_draft('FSQ004/25', self.season, self.manager)
        _add_block_source(draft, self.block_a, Decimal('18000'))

        resp = self.client.post(self._split_url(draft.id), {
            'trucks': [{
                'weight_kg': '18000',
                'firm_splits': [{'export_firm_id': self.export_firm_1.id, 'weight_kg': '7500'}],
            }],
        }, format='json')

        self.assertEqual(resp.status_code, 200, resp.data)
        truck_id = resp.data['created_truck_ids'][0]

        split = ShipmentFirmSplit.objects.get(shipment_id=truck_id)
        self.assertEqual(split.weight_kg, Decimal('7500'), 'Override must reach the split')

        qur = QuotaUsageRecord.objects.get(shipment_id=truck_id, status='draft')
        expected_official = get_default_truck_weight(1)
        self.assertEqual(
            qur.kg_used, expected_official,
            'QuotaUsageRecord must use official kg, ignoring per-firm override',
        )


# ---------------------------------------------------------------------------
# Test 11 — Freshly split truck stays gumruk_girish (no auto-advance)
# ---------------------------------------------------------------------------

class NoAutoAdvanceTests(SplitTestBase):
    """No TaskRule seeded → auto_advance bails → truck stays at gumruk_girish."""

    def test_no_auto_advance_after_split(self):
        """After split, each truck is at gumruk_girish and has exactly one
        ShipmentStatusLog row for gumruk_girish (no further advance)."""
        draft = _make_draft('NAA001/25', self.season, self.manager)
        _add_block_source(draft, self.block_a, Decimal('30000'))

        resp = self.client.post(self._split_url(draft.id), {
            'trucks': [
                {'weight_kg': '15000'},
                {'weight_kg': '15000'},
            ],
        }, format='json')

        self.assertEqual(resp.status_code, 200, resp.data)

        for truck_id in resp.data['created_truck_ids']:
            ship = Shipment.objects.get(pk=truck_id)
            self.assertEqual(ship.status.code, 'gumruk_girish')

            # There should be exactly 2 log rows: draft → gumruk_girish
            # (create_shipment writes the 'draft' row; transition_to writes 'gumruk_girish').
            gg_logs = ShipmentStatusLog.objects.filter(
                shipment=ship, status__code='gumruk_girish'
            )
            self.assertEqual(
                gg_logs.count(), 1,
                f'Truck {truck_id} should have exactly 1 gumruk_girish log row',
            )


# ---------------------------------------------------------------------------
# Test 12 — 403 for non-privileged role
# ---------------------------------------------------------------------------

class ForbiddenRoleTests(SplitTestBase):
    """Non-privileged role (sales_rep) gets 403."""

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.sales_rep)

    def test_sales_rep_cannot_split(self):
        draft = _make_draft('FORB001/25', self.season, self.manager)
        _add_block_source(draft, self.block_a, Decimal('18000'))

        resp = self.client.post(self._split_url(draft.id), {
            'trucks': [{'weight_kg': '18000'}],
        }, format='json')

        self.assertEqual(resp.status_code, 403, resp.data)

        draft.refresh_from_db()
        self.assertEqual(draft.status.code, 'draft', 'Draft must not be modified')


# ---------------------------------------------------------------------------
# Test 13 — 400 if shipment is not in draft status
# ---------------------------------------------------------------------------

class NonDraftRejectionTests(SplitTestBase):
    """Trying to split a non-draft shipment returns 400."""

    def test_gumruk_girish_returns_400(self):
        gg_status = ShipmentStatusType.objects.get(code='gumruk_girish')
        non_draft = Shipment.objects.create(
            cargo_code='ND001/25',
            date=dt.date(2025, 5, 1),
            season=self.season,
            status=gg_status,
            created_by=self.manager,
        )

        resp = self.client.post(self._split_url(non_draft.id), {
            'trucks': [{'weight_kg': '5000'}],
        }, format='json')

        self.assertEqual(resp.status_code, 400, resp.data)
        non_draft.refresh_from_db()
        self.assertEqual(non_draft.status.code, 'gumruk_girish')


# ---------------------------------------------------------------------------
# Test 14 — Leftover discarded with AuditLog
# ---------------------------------------------------------------------------

class LeftoverDiscardedTests(SplitTestBase):
    """When Σ truck weights < draft_total, leftover is discarded and logged."""

    def test_leftover_creates_audit_log(self):
        draft = _make_draft('LO001/25', self.season, self.manager)
        _add_block_source(draft, self.block_a, Decimal('20000'))

        resp = self.client.post(self._split_url(draft.id), {
            'trucks': [
                {'weight_kg': '9000'},
                {'weight_kg': '9000'},
                # Total = 18000, leftover = 2000
            ],
        }, format='json')

        self.assertEqual(resp.status_code, 200, resp.data)

        # An AuditLog row must document the leftover.
        log = AuditLog.objects.filter(
            action='split_leftover',
            object_id=draft.id,
        ).first()
        self.assertIsNotNone(log, 'AuditLog for leftover must exist')
        self.assertIn('2000', log.detail, 'AuditLog detail should mention 2000 kg')

    def test_no_leftover_no_audit_log(self):
        """Exact split (no leftover) must NOT create a leftover AuditLog row."""
        draft = _make_draft('LO002/25', self.season, self.manager)
        _add_block_source(draft, self.block_a, Decimal('18000'))

        resp = self.client.post(self._split_url(draft.id), {
            'trucks': [{'weight_kg': '18000'}],
        }, format='json')

        self.assertEqual(resp.status_code, 200, resp.data)

        exists = AuditLog.objects.filter(
            action='split_leftover',
            object_id=draft.id,
        ).exists()
        self.assertFalse(exists, 'No leftover AuditLog should be created when Σ == total')
