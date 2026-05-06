"""Tests for the phase grouping module (Stream C).

Coverage:
  - get_phase() with known codes, unknown codes, None, and empty string
  - All 14 documented status codes have a PHASE_MAP entry
  - PHASE_ORDER contains exactly the 7 phase codes used by PHASE_MAP plus 'PLAN'
  - PHASE_LABELS has exactly the 7 keys matching PHASE_ORDER
  - Integration: serialize Shipment in 5 states and assert phase field is present/correct
"""
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import Season, ShipmentStatusType, User
from apps.export.models import Shipment
from apps.export.services.phases import PHASE_MAP, PHASE_ORDER, PHASE_LABELS, get_phase


# ---------------------------------------------------------------------------
# Unit tests — pure function
# ---------------------------------------------------------------------------

class GetPhaseUnitTests(TestCase):
    """Direct tests for get_phase()."""

    def test_draft_returns_prep(self) -> None:
        self.assertEqual(get_phase('draft'), 'PREP')

    def test_yuklenme_returns_load(self) -> None:
        self.assertEqual(get_phase('yuklenme'), 'LOAD')

    def test_gumruk_girish_returns_docs(self) -> None:
        self.assertEqual(get_phase('gumruk_girish'), 'DOCS')

    def test_gumruk_chykysh_returns_docs(self) -> None:
        self.assertEqual(get_phase('gumruk_chykysh'), 'DOCS')

    def test_yola_chykdy_returns_transit(self) -> None:
        self.assertEqual(get_phase('yola_chykdy'), 'TRANSIT')

    def test_serhet_tm_returns_transit(self) -> None:
        self.assertEqual(get_phase('serhet_tm'), 'TRANSIT')

    def test_serhet_gechdi_returns_transit(self) -> None:
        self.assertEqual(get_phase('serhet_gechdi'), 'TRANSIT')

    def test_barysh_gumrugi_returns_transit(self) -> None:
        self.assertEqual(get_phase('barysh_gumrugi'), 'TRANSIT')

    def test_yolda_returns_transit(self) -> None:
        self.assertEqual(get_phase('yolda'), 'TRANSIT')

    def test_bardy_returns_dest(self) -> None:
        self.assertEqual(get_phase('bardy'), 'DEST')

    def test_satylyar_returns_dest(self) -> None:
        self.assertEqual(get_phase('satylyar'), 'DEST')

    def test_satyldy_returns_dest(self) -> None:
        self.assertEqual(get_phase('satyldy'), 'DEST')

    def test_hasabat_returns_dest(self) -> None:
        self.assertEqual(get_phase('hasabat'), 'DEST')

    def test_tamamlandy_returns_close(self) -> None:
        self.assertEqual(get_phase('tamamlandy'), 'CLOSE')

    def test_unknown_code_returns_close(self) -> None:
        self.assertEqual(get_phase('unknown_code'), 'CLOSE')

    def test_none_returns_close(self) -> None:
        self.assertEqual(get_phase(None), 'CLOSE')

    def test_empty_string_returns_close(self) -> None:
        self.assertEqual(get_phase(''), 'CLOSE')


class PhaseMapCompletenessTests(TestCase):
    """Structural tests — PHASE_MAP, PHASE_ORDER, and PHASE_LABELS are internally consistent."""

    # The 14 status codes documented in the plan.
    EXPECTED_CODES = {
        'draft', 'yuklenme', 'gumruk_girish', 'gumruk_chykysh',
        'yola_chykdy', 'serhet_tm', 'serhet_gechdi', 'barysh_gumrugi',
        'yolda', 'bardy', 'satylyar', 'satyldy', 'hasabat', 'tamamlandy',
    }

    def test_all_14_status_codes_are_mapped(self) -> None:
        missing = self.EXPECTED_CODES - set(PHASE_MAP.keys())
        self.assertEqual(missing, set(), f"Missing from PHASE_MAP: {missing}")

    def test_phase_order_contains_exactly_7_named_phases_plus_plan(self) -> None:
        # PLAN is virtual; the other 6 come from PHASE_MAP values.
        phases_from_map = set(PHASE_MAP.values())
        expected = phases_from_map | {'PLAN'}
        self.assertEqual(set(PHASE_ORDER), expected)

    def test_phase_order_has_no_duplicates(self) -> None:
        self.assertEqual(len(PHASE_ORDER), len(set(PHASE_ORDER)))

    def test_phase_order_length_is_7(self) -> None:
        self.assertEqual(len(PHASE_ORDER), 7)

    def test_phase_labels_keys_match_phase_order(self) -> None:
        self.assertEqual(set(PHASE_LABELS.keys()), set(PHASE_ORDER))

    def test_phase_labels_values_are_i18n_keys(self) -> None:
        for code, label in PHASE_LABELS.items():
            self.assertTrue(
                label.startswith('phase.'),
                f"PHASE_LABELS[{code}] = {label!r} should start with 'phase.'",
            )

    def test_all_phase_map_values_are_in_phase_order(self) -> None:
        unknown = set(PHASE_MAP.values()) - set(PHASE_ORDER)
        self.assertEqual(unknown, set(), f"PHASE_MAP values not in PHASE_ORDER: {unknown}")


# ---------------------------------------------------------------------------
# Integration tests — phase field appears in serialized Shipment responses
# ---------------------------------------------------------------------------

def _make_user(username: str, role: str) -> User:
    user = User(username=username, role=role)
    user.set_password('pass')
    user.save()
    return user


def _make_season() -> Season:
    # max_length=10 on Season.name — keep the test name short.
    season, _ = Season.objects.get_or_create(
        name='ph-test',
        defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True},
    )
    return season


def _make_status(code: str, step_order: int = 1) -> ShipmentStatusType:
    st, _ = ShipmentStatusType.objects.get_or_create(
        code=code,
        defaults={
            'name_tk': code,
            'name_en': code,
            'step_order': step_order,
            'phase': 'LOADING',  # DB phase column — not the PHASE_MAP phase
        },
    )
    return st


def _make_shipment(cargo_code: str, status_code: str, step_order: int = 1) -> Shipment:
    status = _make_status(status_code, step_order)
    shipment, _ = Shipment.objects.get_or_create(
        cargo_code=cargo_code,
        defaults={
            'date': '2026-01-15',
            'season': _make_season(),
            'status': status,
        },
    )
    # Ensure status is what we specified (get_or_create may return existing row).
    if shipment.status_id != status.pk:
        shipment.status = status
        shipment.save(update_fields=['status'])
    return shipment


class ShipmentListPhaseIntegrationTests(TestCase):
    """GET /api/v1/export/shipments/ returns phase for each item."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.user = _make_user('list_phase_user', 'export_manager')
        # One shipment in each of the 5 representative statuses.
        cls.cases = [
            ('PHLIST001', 'draft',       'PREP'),
            ('PHLIST002', 'yuklenme',    'LOAD'),
            ('PHLIST003', 'yola_chykdy', 'TRANSIT'),
            ('PHLIST004', 'bardy',       'DEST'),
            ('PHLIST005', 'tamamlandy',  'CLOSE'),
        ]
        for cargo_code, status_code, _ in cls.cases:
            _make_shipment(cargo_code, status_code)

    def setUp(self) -> None:
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_list_includes_phase_field(self) -> None:
        resp = self.client.get('/api/v1/export/shipments/')
        self.assertEqual(resp.status_code, 200)
        # At least one result should have the phase field.
        results = resp.json().get('results', [])
        self.assertTrue(len(results) > 0, "Expected at least one shipment in list")
        self.assertIn('phase', results[0], "'phase' key missing from list response")

    def test_list_phase_values_correct(self) -> None:
        resp = self.client.get('/api/v1/export/shipments/')
        self.assertEqual(resp.status_code, 200)
        results = resp.json().get('results', [])
        result_map = {r['cargo_code']: r for r in results}
        for cargo_code, _status_code, expected_phase in self.cases:
            self.assertIn(
                cargo_code, result_map,
                f"{cargo_code} missing from list response — fixture not visible",
            )
            actual = result_map[cargo_code].get('phase')
            self.assertEqual(
                actual,
                expected_phase,
                f"{cargo_code}: expected phase={expected_phase}, got {actual}",
            )


class ShipmentDetailPhaseIntegrationTests(TestCase):
    """GET /api/v1/export/shipments/{id}/ returns correct phase."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.user = _make_user('detail_phase_user', 'export_manager')
        cls.cases = [
            ('PHDET001', 'draft',       'PREP'),
            ('PHDET002', 'yuklenme',    'LOAD'),
            ('PHDET003', 'yola_chykdy', 'TRANSIT'),
            ('PHDET004', 'bardy',       'DEST'),
            ('PHDET005', 'tamamlandy',  'CLOSE'),
        ]
        cls.shipments = {}
        for cargo_code, status_code, _ in cls.cases:
            cls.shipments[cargo_code] = _make_shipment(cargo_code, status_code)

    def setUp(self) -> None:
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_detail_phase_correct_for_each_state(self) -> None:
        for cargo_code, _status_code, expected_phase in self.cases:
            shipment = self.shipments[cargo_code]
            resp = self.client.get(f'/api/v1/export/shipments/{shipment.pk}/')
            self.assertEqual(resp.status_code, 200, f"Detail 404 for {cargo_code}")
            data = resp.json()
            self.assertIn('phase', data, f"'phase' missing from detail for {cargo_code}")
            self.assertEqual(
                data['phase'],
                expected_phase,
                f"{cargo_code}: expected phase={expected_phase}, got {data.get('phase')}",
            )


class ShipmentSheetPhaseIntegrationTests(TestCase):
    """GET /api/v1/export/shipments/sheet/ returns phase for each item."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.user = _make_user('sheet_phase_user', 'export_manager')
        cls.cases = [
            ('PHSHT001', 'draft',       'PREP'),
            ('PHSHT002', 'yuklenme',    'LOAD'),
            ('PHSHT003', 'yola_chykdy', 'TRANSIT'),
            ('PHSHT004', 'bardy',       'DEST'),
            ('PHSHT005', 'tamamlandy',  'CLOSE'),
        ]
        # All must be in the active season so the sheet endpoint picks them up.
        season = _make_season()
        season.is_active = True
        season.save(update_fields=['is_active'])
        for cargo_code, status_code, _ in cls.cases:
            _make_shipment(cargo_code, status_code)

    def setUp(self) -> None:
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_sheet_items_include_phase_field(self) -> None:
        resp = self.client.get('/api/v1/export/shipments/sheet/')
        self.assertEqual(resp.status_code, 200)
        results = resp.json().get('results', [])
        self.assertGreater(
            len(results), 0,
            "sheet returned no rows — check active season fixture wiring",
        )
        self.assertIn('phase', results[0], "'phase' missing from sheet item")

    def test_sheet_phase_values_correct(self) -> None:
        resp = self.client.get('/api/v1/export/shipments/sheet/')
        self.assertEqual(resp.status_code, 200)
        results = resp.json().get('results', [])
        result_map = {r['cargo_code']: r for r in results}
        for cargo_code, _status_code, expected_phase in self.cases:
            self.assertIn(
                cargo_code, result_map,
                f"{cargo_code} missing from sheet response — fixture not visible",
            )
            actual = result_map[cargo_code].get('phase')
            self.assertEqual(
                actual,
                expected_phase,
                f"{cargo_code}: expected phase={expected_phase}, got {actual}",
            )
