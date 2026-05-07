"""Stream G — dual-code rename and Sheet exposure.

After Stream G, the two Shipment code fields are surfaced as:
  - cargo_code → "Export Code" — server-auto-generated, read-only
  - official_export_code → "Shipment Code" — operator-entered, editable

Behaviour was already correct after `78e140e`; this stream relabels the
UI and adds a Sheet row for `official_export_code` so Soltanmyrat can
edit it from the same screen as everything else.

These tests verify:
  - The non-patchability of cargo_code via Sheet PATCH (Export Code is read-only)
  - The patchability of official_export_code via Sheet PATCH (Shipment Code editable)
  - The validator still rejects bad-format input on official_export_code
  - The /sheet/ payload exposes both fields per shipment
  - The Sheet row config includes both rows after seeding

Run:
    python manage.py test apps.export.tests_dual_codes --keepdb
"""
import datetime as dt

from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import Season, ShipmentStatusType, User
from apps.export.models import Shipment, SheetRowSetting


def _make_user(username: str, role: str) -> User:
    return User.objects.create_user(username=username, password='pw', role=role)


def _make_season() -> Season:
    season, _ = Season.objects.get_or_create(
        name='2025',
        defaults={'start_date': '2025-01-01', 'end_date': '2025-12-31', 'is_active': True},
    )
    return season


def _make_status(code: str, step_order: int) -> ShipmentStatusType:
    obj, _ = ShipmentStatusType.objects.get_or_create(
        code=code,
        defaults={
            'name_tk': code, 'name_en': code.title(), 'name_ru': code.title(),
            'step_order': step_order, 'phase': 'LOADING',
        },
    )
    return obj


def _make_shipment(cargo_code: str = '0101001/25') -> Shipment:
    season = _make_season()
    status = _make_status('yuklenme', 1)
    user = User.objects.first() or _make_user('seed_user', 'admin')
    return Shipment.objects.create(
        cargo_code=cargo_code,
        date=dt.date(2025, 1, 1),
        season=season,
        status=status,
        created_by=user,
    )


class CargoCodeIsReadOnlyTests(TestCase):
    """Export Code (cargo_code) cannot be patched via the Sheet endpoint."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.user = _make_user('soltanmyrat_g', 'warehouse_chief')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.shipment = _make_shipment(cargo_code='0101010/25')

    def test_cargo_code_patch_silently_stripped(self):
        """Sheet PATCH with cargo_code is silently dropped — DRF's ModelSerializer
        ignores fields absent from Meta.fields. cargo_code is intentionally NOT
        in _ALL_PATCHABLE_FIELDS, so the request returns 200 with the value
        unchanged.

        This contract MUST hold: if a future dev mistakenly adds cargo_code
        to _ALL_PATCHABLE_FIELDS, the value would change and this test would
        fail loudly.
        """
        resp = self.client.patch(
            f'/api/v1/export/shipments/{self.shipment.pk}/',
            {'cargo_code': '9999999/99'},
            format='json',
        )
        # 200 = silent strip (current behaviour). 400 = explicit rejection
        # (would also be acceptable, but isn't currently implemented).
        self.assertIn(resp.status_code, (200, 400))
        self.shipment.refresh_from_db()
        self.assertEqual(
            self.shipment.cargo_code, '0101010/25',
            'cargo_code MUST NOT change via Sheet PATCH — it is the auto-generated Export Code',
        )


class OfficialExportCodeIsEditableTests(TestCase):
    """Shipment Code (official_export_code) can be patched by warehouse_chief."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.user = _make_user('soltanmyrat_h', 'warehouse_chief')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.shipment = _make_shipment(cargo_code='0101011/25')

    def test_pipe_format_official_export_code_accepted(self):
        """The traditional 6-field DD|MM|NNN|BLK|YY|VV format is accepted —
        the pipe-separated convention still works, it's just no longer enforced."""
        resp = self.client.patch(
            f'/api/v1/export/shipments/{self.shipment.pk}/',
            {'official_export_code': '02|FB|005|FA|26|--'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.official_export_code, '02|FB|005|FA|26|--')

    def test_free_text_official_export_code_accepted(self):
        """Stream G follow-up: any non-blank string up to max_length is allowed.
        Soltanmyrat generates the code himself; the strict format check was
        rejecting operationally-valid codes."""
        resp = self.client.patch(
            f'/api/v1/export/shipments/{self.shipment.pk}/',
            {'official_export_code': 'PALLET-ABC-2025'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.official_export_code, 'PALLET-ABC-2025')

    def test_official_export_code_max_length_enforced(self):
        """The only constraint is max_length=30 (the model column width)."""
        too_long = 'X' * 31
        resp = self.client.patch(
            f'/api/v1/export/shipments/{self.shipment.pk}/',
            {'official_export_code': too_long},
            format='json',
        )
        self.assertEqual(resp.status_code, 400, resp.data)


class SheetRowsConfigTests(TestCase):
    """Sheet row config exposes both code fields after seeding."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')

    def test_both_code_fields_have_sheet_rows(self):
        """After seed_permissions runs, the row config dict includes both keys."""
        from apps.export.sheet_rows import DEFAULT_SHEET_ROWS
        keys = {row['field_key'] for row in DEFAULT_SHEET_ROWS}
        self.assertIn('cargo_code', keys, 'Export Code row must be in the sheet config')
        self.assertIn('official_export_code', keys, 'Shipment Code row must be in the sheet config')

    def test_export_code_row_is_readonly(self):
        """cargo_code (Export Code) row uses input_type='readonly' so the cell
        won't render an editor."""
        from apps.export.sheet_rows import DEFAULT_SHEET_ROWS
        row = next(r for r in DEFAULT_SHEET_ROWS if r['field_key'] == 'cargo_code')
        self.assertEqual(row['input_type'], 'readonly')

    def test_shipment_code_row_is_editable_text(self):
        """official_export_code (Shipment Code) row uses input_type='text' so the
        cell renders an editor."""
        from apps.export.sheet_rows import DEFAULT_SHEET_ROWS
        row = next(r for r in DEFAULT_SHEET_ROWS if r['field_key'] == 'official_export_code')
        self.assertEqual(row['input_type'], 'text')

    def test_export_code_label_renamed(self):
        """The cargo_code row now uses sheet.row.export_code label_key
        (was sheet.row.shipment_code before Stream G)."""
        from apps.export.sheet_rows import DEFAULT_SHEET_ROWS
        row = next(r for r in DEFAULT_SHEET_ROWS if r['field_key'] == 'cargo_code')
        self.assertEqual(row['label_key'], 'sheet.row.export_code')

    def test_shipment_code_uses_freed_label_key(self):
        """The official_export_code row claims sheet.row.shipment_code — the
        label_key freed up by the cargo_code row's rename."""
        from apps.export.sheet_rows import DEFAULT_SHEET_ROWS
        row = next(r for r in DEFAULT_SHEET_ROWS if r['field_key'] == 'official_export_code')
        self.assertEqual(row['label_key'], 'sheet.row.shipment_code')


class SheetPayloadIncludesBothCodesTests(TestCase):
    """The /sheet/ endpoint emits both code fields per shipment."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.user = _make_user('director_g', 'director')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.shipment = _make_shipment(cargo_code='0101012/25')
        # Block field is 1-3 alphanumeric chars (no hyphens) per validator.
        self.shipment.official_export_code = '02|FB|012|FA|25|--'
        self.shipment.save(update_fields=['official_export_code'])

    def test_sheet_response_carries_both_codes(self):
        resp = self.client.get('/api/v1/export/shipments/sheet/')
        self.assertEqual(resp.status_code, 200, resp.data)
        # Find this shipment in the response.
        results = resp.json().get('results', [])
        match = next((r for r in results if r['cargo_code'] == '0101012/25'), None)
        self.assertIsNotNone(match, 'Test shipment missing from /sheet/ response')
        self.assertEqual(match['cargo_code'], '0101012/25')
        self.assertEqual(match['official_export_code'], '02|FB|012|FA|25|--')


class WarehouseChiefHasShipmentCodePermissionTests(TestCase):
    """seed_permissions grants warehouse_chief edit access to official_export_code."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')

    def test_warehouse_chief_can_edit_shipment_code(self):
        # Signature: can_edit_field(role: str, field: str, resource_code='shipment')
        from apps.core.permissions import can_edit_field
        self.assertTrue(
            can_edit_field('warehouse_chief', 'official_export_code'),
            'warehouse_chief must have permission to edit official_export_code',
        )

    def test_warehouse_chief_cannot_edit_export_code(self):
        from apps.core.permissions import can_edit_field
        self.assertFalse(
            can_edit_field('warehouse_chief', 'cargo_code'),
            'warehouse_chief must NOT be able to edit cargo_code (Export Code is auto)',
        )
