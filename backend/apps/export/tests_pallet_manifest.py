"""Tests for pallet manifest service functions and Pallet model properties.

Uses Django TestCase with a real (test) database. These tests verify:
- Pallet.net_weight_kg property arithmetic
- compute_dominant_varieties: single-variety and multi-variety (top-4 rule)
- close_pallet_manifest: aggregates written to shipment, variety roll-up, AuditLog entry
- close_pallet_manifest: raises ValueError when no pallets exist
- override_dominant_varieties: sets M2M, updates shipment.variety, writes AuditLog

Pattern: flat test file, no sub-packages — matches tests_official_code_validator.py from Phase 1.
"""
from decimal import Decimal

from django.test import TestCase

from apps.core.models import (
    Country, CrateType, GreenhouseBlock, Season, ShipmentStatusType, TomatoVariety, User,
)
from apps.export.models import AuditLog, Pallet, Shipment
from apps.export.services import (
    close_pallet_manifest,
    compute_dominant_varieties,
    override_dominant_varieties,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_user(username: str = 'artykow') -> User:
    """Create a minimal weight_master user."""
    return User.objects.create_user(
        username=username, password='testpass', role='weight_master',
    )


def _make_shipment(user: User) -> Shipment:
    """Create a minimal shipment fixture in draft status."""
    country, _ = Country.objects.get_or_create(code='TM', defaults={'name_en': 'Turkmenistan'})
    season, _ = Season.objects.get_or_create(
        year=2025, defaults={'is_active': True, 'name': '2025'},
    )
    draft_status, _ = ShipmentStatusType.objects.get_or_create(
        code='draft',
        defaults={
            'name_en': 'Draft', 'name_tk': 'Draft', 'name_ru': 'Draft',
            'step_order': 0, 'phase': 'LOADING',
        },
    )
    return Shipment.objects.create(
        cargo_code='1001001/25',
        date='2025-01-10',
        season=season,
        country=country,
        status=draft_status,
        created_by=user,
    )


def _make_crate_type(name: str = 'LEBIZ PLAST 18', weight_kg: str = '0.543') -> CrateType:
    ct, _ = CrateType.objects.get_or_create(
        name=name, defaults={'weight_kg': Decimal(weight_kg), 'is_active': True},
    )
    return ct


def _make_variety(code: str, name: str) -> TomatoVariety:
    v, _ = TomatoVariety.objects.get_or_create(code=code, defaults={'name': name})
    return v


def _make_block(code: str = 'F') -> GreenhouseBlock:
    b, _ = GreenhouseBlock.objects.get_or_create(code=code, defaults={'name': f'Block {code}'})
    return b


def _make_pallet(
    shipment: Shipment,
    user: User,
    pallet_number: int = 1,
    crate_type: CrateType = None,
    crate_count: int = 18,
    gross_weight_kg: str = '615.00',
    pallet_weight_kg: str = '22.00',
    additions_kg: str = '4.00',
    variety: TomatoVariety = None,
    sub_block: GreenhouseBlock = None,
) -> Pallet:
    if crate_type is None:
        crate_type = _make_crate_type()
    if variety is None:
        variety = _make_variety('02', 'Midelice')
    if sub_block is None:
        sub_block = _make_block('F')
    return Pallet.objects.create(
        shipment=shipment,
        pallet_number=pallet_number,
        crate_type=crate_type,
        crate_count=crate_count,
        gross_weight_kg=Decimal(gross_weight_kg),
        pallet_weight_kg=Decimal(pallet_weight_kg),
        additions_kg=Decimal(additions_kg),
        variety=variety,
        sub_block=sub_block,
        created_by=user,
    )


# ---------------------------------------------------------------------------
# 1. Pallet.net_weight_kg property
# ---------------------------------------------------------------------------

class TestPalletNetWeightProperty(TestCase):
    """Verify the net weight arithmetic matches the CEKIM_GAPAN formula."""

    def setUp(self):
        self.user = _make_user()
        self.shipment = _make_shipment(self.user)

    def test_net_weight_formula(self):
        """gross - (crate_weight * count) - pallet - additions = net."""
        crate_type = _make_crate_type('LEBIZ PLAST 18', '0.543')
        pallet = _make_pallet(
            self.shipment, self.user,
            pallet_number=1,
            crate_type=crate_type,
            crate_count=18,
            gross_weight_kg='615.00',
            pallet_weight_kg='22.00',
            additions_kg='4.00',
        )
        # Expected: 615.00 - (0.543 * 18) - 22.00 - 4.00 = 615.00 - 9.774 - 22.00 - 4.00 = 579.226
        expected = Decimal('615.00') - (Decimal('0.543') * 18) - Decimal('22.00') - Decimal('4.00')
        self.assertAlmostEqual(float(pallet.net_weight_kg), float(expected), places=3)

    def test_net_weight_zero_additions(self):
        """additions_kg defaults to 0 — net should account for crate + pallet only."""
        crate_type = _make_crate_type('LEBIZ PLAST 18', '0.543')
        pallet = _make_pallet(
            self.shipment, self.user,
            pallet_number=2,
            crate_type=crate_type,
            crate_count=10,
            gross_weight_kg='400.00',
            pallet_weight_kg='20.00',
            additions_kg='0.00',
        )
        expected = Decimal('400.00') - (Decimal('0.543') * 10) - Decimal('20.00')
        self.assertAlmostEqual(float(pallet.net_weight_kg), float(expected), places=3)


# ---------------------------------------------------------------------------
# 2. compute_dominant_varieties
# ---------------------------------------------------------------------------

class TestComputeDominantVarieties(TestCase):
    """Dominant variety aggregation rules."""

    def setUp(self):
        self.user = _make_user('soltanmyrat')
        self.shipment = _make_shipment(self.user)
        self.crate_type = _make_crate_type()
        self.block = _make_block('F')

    def test_single_variety_returns_one(self):
        """All pallets with the same variety → dominant list has exactly one entry."""
        v = _make_variety('02', 'Midelice')
        for i in range(1, 4):
            _make_pallet(
                self.shipment, self.user, pallet_number=i,
                variety=v, sub_block=self.block, crate_type=self.crate_type,
            )
        dominant = compute_dominant_varieties(self.shipment)
        self.assertEqual(len(dominant), 1)
        self.assertEqual(dominant[0][0], v.id)

    def test_two_varieties_returns_both(self):
        """Two varieties → both returned."""
        v1 = _make_variety('02', 'Midelice')
        v2 = _make_variety('08', 'Redity')
        _make_pallet(self.shipment, self.user, pallet_number=1, variety=v1, sub_block=self.block)
        _make_pallet(self.shipment, self.user, pallet_number=2, variety=v2, sub_block=self.block)
        dominant = compute_dominant_varieties(self.shipment)
        self.assertEqual(len(dominant), 2)

    def test_top_4_rule_with_five_varieties(self):
        """5 distinct varieties → top 4 by kg returned (ordered desc by kg)."""
        varieties = [_make_variety(f'0{i}', f'Var{i}') for i in range(1, 6)]
        # Give each variety a distinct number of pallets so totals are distinct.
        # Variety 0 gets 5 pallets (highest), variety 4 gets 1 pallet (lowest).
        pallet_num = 1
        for idx, v in enumerate(varieties):
            count = 5 - idx  # 5, 4, 3, 2, 1 pallets respectively
            for _ in range(count):
                _make_pallet(
                    self.shipment, self.user, pallet_number=pallet_num,
                    variety=v, sub_block=self.block,
                )
                pallet_num += 1

        dominant = compute_dominant_varieties(self.shipment)
        # Rule: 4+ distinct varieties → return top 4
        self.assertEqual(len(dominant), 4)
        # Sorted descending by total kg
        totals = [kg for _, kg in dominant]
        self.assertEqual(totals, sorted(totals, reverse=True))
        # Variety with least pallets (varieties[4]) must not be in top 4
        dominant_ids = {vid for vid, _ in dominant}
        self.assertNotIn(varieties[4].id, dominant_ids)


# ---------------------------------------------------------------------------
# 3. close_pallet_manifest
# ---------------------------------------------------------------------------

class TestClosePalletManifest(TestCase):
    """Manifest close writes aggregates, variety roll-up, and AuditLog."""

    def setUp(self):
        self.user = _make_user('artykow2')
        self.shipment = _make_shipment(self.user)
        self.crate_type = _make_crate_type('LEBIZ PLAST 18', '0.543')
        self.v1 = _make_variety('02', 'Midelice')
        self.v2 = _make_variety('08', 'Redity')
        self.block = _make_block('F')

    def test_close_writes_correct_aggregates(self):
        """After close: weight_net and weight_gross match pallet sums."""
        _make_pallet(
            self.shipment, self.user, pallet_number=1,
            crate_type=self.crate_type, crate_count=18,
            gross_weight_kg='615.00', pallet_weight_kg='22.00', additions_kg='4.00',
            variety=self.v1, sub_block=self.block,
        )
        _make_pallet(
            self.shipment, self.user, pallet_number=2,
            crate_type=self.crate_type, crate_count=18,
            gross_weight_kg='610.00', pallet_weight_kg='22.00', additions_kg='4.00',
            variety=self.v2, sub_block=self.block,
        )

        close_pallet_manifest(self.shipment, self.user)
        self.shipment.refresh_from_db()

        expected_gross = Decimal('615.00') + Decimal('610.00')
        crate_total = Decimal('0.543') * 18 * 2
        expected_net = expected_gross - crate_total - (Decimal('22.00') * 2) - (Decimal('4.00') * 2)

        self.assertAlmostEqual(float(self.shipment.weight_gross), float(expected_gross), places=2)
        self.assertAlmostEqual(float(self.shipment.weight_net), float(expected_net), places=2)
        self.assertEqual(self.shipment.pallet_count, 2)

    def test_close_sets_variety_confidence_high(self):
        """variety_confidence must be 'high' after manifest close."""
        _make_pallet(self.shipment, self.user, variety=self.v1, sub_block=self.block)
        close_pallet_manifest(self.shipment, self.user)
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.variety_confidence, 'high')

    def test_close_sets_varieties_dominant_m2m(self):
        """varieties_dominant M2M contains correct variety ids after close."""
        _make_pallet(self.shipment, self.user, pallet_number=1, variety=self.v1, sub_block=self.block)
        _make_pallet(self.shipment, self.user, pallet_number=2, variety=self.v2, sub_block=self.block)
        close_pallet_manifest(self.shipment, self.user)
        dominant_ids = set(self.shipment.varieties_dominant.values_list('id', flat=True))
        self.assertIn(self.v1.id, dominant_ids)
        self.assertIn(self.v2.id, dominant_ids)

    def test_close_sets_variety_fk_to_top_dominant(self):
        """shipment.variety FK must point to the #1 dominant variety."""
        # v2 gets more pallets so it becomes dominant
        _make_pallet(self.shipment, self.user, pallet_number=1, variety=self.v1, sub_block=self.block)
        _make_pallet(
            self.shipment, self.user, pallet_number=2,
            variety=self.v2, sub_block=self.block,
            gross_weight_kg='700.00',  # heavier → dominant
        )
        _make_pallet(
            self.shipment, self.user, pallet_number=3,
            variety=self.v2, sub_block=self.block,
            gross_weight_kg='700.00',
        )
        close_pallet_manifest(self.shipment, self.user)
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.variety_id, self.v2.id)

    def test_close_creates_audit_log_entry(self):
        """An AuditLog entry with action='manifest_close' must be created."""
        _make_pallet(self.shipment, self.user, variety=self.v1, sub_block=self.block)
        close_pallet_manifest(self.shipment, self.user)
        entry = AuditLog.objects.filter(
            action='manifest_close',
            model_name='Shipment',
            object_id=self.shipment.id,
        ).first()
        self.assertIsNotNone(entry)
        self.assertIn('net=', entry.detail)

    def test_close_empty_pallets_raises(self):
        """Calling close with no pallets must raise ValueError."""
        with self.assertRaises(ValueError) as ctx:
            close_pallet_manifest(self.shipment, self.user)
        self.assertIn('no pallets', str(ctx.exception).lower())


# ---------------------------------------------------------------------------
# 4. override_dominant_varieties
# ---------------------------------------------------------------------------

class TestOverrideDominantVarieties(TestCase):
    """Manual variety override service."""

    def setUp(self):
        self.user = _make_user('soltanmyrat2')
        self.shipment = _make_shipment(self.user)
        self.v1 = _make_variety('02', 'Midelice')
        self.v2 = _make_variety('08', 'Redity')

    def test_override_sets_m2m_and_variety_fk(self):
        """Override sets varieties_dominant and shipment.variety to first entry."""
        override_dominant_varieties(self.shipment, [self.v1.id, self.v2.id], self.user)
        self.shipment.refresh_from_db()
        dominant_ids = set(self.shipment.varieties_dominant.values_list('id', flat=True))
        self.assertIn(self.v1.id, dominant_ids)
        self.assertIn(self.v2.id, dominant_ids)
        self.assertEqual(self.shipment.variety_id, self.v1.id)

    def test_override_keeps_confidence_high(self):
        """Manual override is still authoritative — confidence stays 'high'."""
        override_dominant_varieties(self.shipment, [self.v1.id], self.user)
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.variety_confidence, 'high')

    def test_override_creates_audit_log(self):
        """AuditLog entry with action='variety_override' must be created."""
        override_dominant_varieties(self.shipment, [self.v2.id], self.user)
        entry = AuditLog.objects.filter(
            action='variety_override',
            model_name='Shipment',
            object_id=self.shipment.id,
        ).first()
        self.assertIsNotNone(entry)
        self.assertIn(str(self.v2.id), entry.detail)

    def test_override_empty_ids_raises(self):
        """Passing an empty list must raise ValueError."""
        with self.assertRaises(ValueError):
            override_dominant_varieties(self.shipment, [], self.user)
