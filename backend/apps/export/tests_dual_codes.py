"""Stream G — dual-code rename and Sheet exposure.

After Stream G, the two Shipment code fields are surfaced as:
  - shipment_code → "Export Code" — server-auto-generated, read-only
  - export_code → "Shipment Code" — operator-entered, editable

Behaviour was already correct after `78e140e`; this stream relabels the
UI and adds a Sheet row for `export_code` so Soltanmyrat can
edit it from the same screen as everything else.

These tests verify:
  - The non-patchability of shipment_code via Sheet PATCH (Export Code is read-only)
  - The patchability of export_code via Sheet PATCH (Shipment Code editable)
  - The validator still rejects bad-format input on export_code
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


def _make_shipment(shipment_code: str = '0101001/25') -> Shipment:
    season = _make_season()
    status = _make_status('yuklenme', 1)
    user = User.objects.first() or _make_user('seed_user', 'admin')
    return Shipment.objects.create(
        shipment_code=shipment_code,
        date=dt.date(2025, 1, 1),
        season=season,
        status=status,
        created_by=user,
    )


class CodeFieldKeyDataMigrationTests(TestCase):
    """Empirically exercise the 0042 / core-0021 RunPython remaps against rows
    that still carry the OLD field_key strings (the test DB is built fresh, so
    the migrations themselves only ever ran on zero rows)."""

    def _run(self, dotted_module: str) -> None:
        import importlib
        from django.apps import apps as global_apps
        mod = importlib.import_module(dotted_module)
        mod.forwards(global_apps, None)

    def test_sheet_and_comment_field_keys_remapped(self):
        from apps.core.models import RoleFieldPermission
        from apps.export.models import SheetRowSetting, ShipmentComment, Notification

        SheetRowSetting.objects.create(field_key='cargo_code', row_number=7, display_order=7)
        SheetRowSetting.objects.create(field_key='official_export_code', row_number=46, display_order=46)
        shipment = _make_shipment(shipment_code='0202002/25')
        user = _make_user('commenter_g', 'export_manager')
        ShipmentComment.objects.create(
            shipment=shipment, user=user, field_key='cargo_code',
            content='check the value on #cell:cargo_code please',
        )
        RoleFieldPermission.objects.create(
            role='warehouse_chief', resource_code='shipment', field_name='official_export_code',
        )
        note = Notification.objects.create(
            user=user, kind='mention', message='x',
            link=f'/export/shipments/sheet?shipment={shipment.pk}&row=cargo_code&comment=1',
        )

        self._run('apps.export.migrations.0042_rename_code_field_keys')
        self._run('apps.core.migrations.0021_rename_export_code_field_permission')

        self.assertFalse(
            SheetRowSetting.objects.filter(field_key__in=['cargo_code', 'official_export_code']).exists(),
            'old field_key strings must be gone from SheetRowSetting',
        )
        self.assertTrue(SheetRowSetting.objects.filter(field_key='shipment_code').exists())
        self.assertTrue(SheetRowSetting.objects.filter(field_key='export_code').exists())

        comment = ShipmentComment.objects.get(shipment=shipment)
        self.assertEqual(comment.field_key, 'shipment_code')
        self.assertIn('#cell:shipment_code', comment.content)
        self.assertNotIn('#cell:cargo_code', comment.content)

        self.assertTrue(
            RoleFieldPermission.objects.filter(field_name='export_code').exists(),
        )
        self.assertFalse(
            RoleFieldPermission.objects.filter(field_name='official_export_code').exists(),
        )

        note.refresh_from_db()
        self.assertIn('row=shipment_code', note.link)
        self.assertNotIn('row=cargo_code', note.link)


class ShipmentCodeIsReadOnlyTests(TestCase):
    """Shipment Code (shipment_code) cannot be patched via the Sheet endpoint."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.user = _make_user('soltanmyrat_g', 'warehouse_chief')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.shipment = _make_shipment(shipment_code='0101010/25')

    def test_shipment_code_patch_silently_stripped(self):
        """Sheet PATCH with shipment_code is silently dropped — DRF's ModelSerializer
        ignores fields absent from Meta.fields. shipment_code is intentionally NOT
        in _ALL_PATCHABLE_FIELDS, so the request returns 200 with the value
        unchanged.

        This contract MUST hold: if a future dev mistakenly adds shipment_code
        to _ALL_PATCHABLE_FIELDS, the value would change and this test would
        fail loudly.
        """
        resp = self.client.patch(
            f'/api/v1/export/shipments/{self.shipment.pk}/',
            {'shipment_code': '9999999/99'},
            format='json',
        )
        # 200 = silent strip (current behaviour). 400 = explicit rejection
        # (would also be acceptable, but isn't currently implemented).
        self.assertIn(resp.status_code, (200, 400))
        self.shipment.refresh_from_db()
        self.assertEqual(
            self.shipment.shipment_code, '0101010/25',
            'shipment_code MUST NOT change via Sheet PATCH — it is the auto-generated Export Code',
        )


class OfficialExportCodeIsEditableTests(TestCase):
    """Shipment Code (export_code) can be patched by warehouse_chief."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.user = _make_user('soltanmyrat_h', 'warehouse_chief')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.shipment = _make_shipment(shipment_code='0101011/25')

    def test_pipe_format_export_code_accepted(self):
        """The traditional 6-field DD|MM|NNN|BLK|YY|VV format is accepted —
        the pipe-separated convention still works, it's just no longer enforced."""
        resp = self.client.patch(
            f'/api/v1/export/shipments/{self.shipment.pk}/',
            {'export_code': '02|FB|005|FA|26|--'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.export_code, '02|FB|005|FA|26|--')

    def test_free_text_export_code_accepted(self):
        """Stream G follow-up: any non-blank string up to max_length is allowed.
        Soltanmyrat generates the code himself; the strict format check was
        rejecting operationally-valid codes."""
        resp = self.client.patch(
            f'/api/v1/export/shipments/{self.shipment.pk}/',
            {'export_code': 'PALLET-ABC-2025'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.export_code, 'PALLET-ABC-2025')

    def test_export_code_max_length_enforced(self):
        """The only constraint is max_length=30 (the model column width)."""
        too_long = 'X' * 31
        resp = self.client.patch(
            f'/api/v1/export/shipments/{self.shipment.pk}/',
            {'export_code': too_long},
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
        self.assertIn('shipment_code', keys, 'Shipment Code row must be in the sheet config')
        self.assertIn('export_code', keys, 'Export Code row must be in the sheet config')

    def test_shipment_code_row_is_readonly(self):
        """shipment_code (the system Shipment Code) row uses input_type='readonly'
        so the cell won't render an editor."""
        from apps.export.sheet_rows import DEFAULT_SHEET_ROWS
        row = next(r for r in DEFAULT_SHEET_ROWS if r['field_key'] == 'shipment_code')
        self.assertEqual(row['input_type'], 'readonly')

    def test_export_code_row_is_editable_text(self):
        """export_code (the operator-typed Export Code) row uses input_type='text'
        so the cell renders an editor."""
        from apps.export.sheet_rows import DEFAULT_SHEET_ROWS
        row = next(r for r in DEFAULT_SHEET_ROWS if r['field_key'] == 'export_code')
        self.assertEqual(row['input_type'], 'text')

    def test_shipment_code_uses_matching_label_key(self):
        """The shipment_code row uses the sheet.row.shipment_code label_key
        (un-crossed: the label and the field key now agree)."""
        from apps.export.sheet_rows import DEFAULT_SHEET_ROWS
        row = next(r for r in DEFAULT_SHEET_ROWS if r['field_key'] == 'shipment_code')
        self.assertEqual(row['label_key'], 'sheet.row.shipment_code')

    def test_export_code_uses_matching_label_key(self):
        """The export_code row uses the sheet.row.export_code label_key
        (un-crossed: the label and the field key now agree)."""
        from apps.export.sheet_rows import DEFAULT_SHEET_ROWS
        row = next(r for r in DEFAULT_SHEET_ROWS if r['field_key'] == 'export_code')
        self.assertEqual(row['label_key'], 'sheet.row.export_code')


class SheetPayloadIncludesBothCodesTests(TestCase):
    """The /sheet/ endpoint emits both code fields per shipment."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.user = _make_user('director_g', 'director')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.shipment = _make_shipment(shipment_code='0101012/25')
        # Block field is 1-3 alphanumeric chars (no hyphens) per validator.
        self.shipment.export_code = '02|FB|012|FA|25|--'
        self.shipment.save(update_fields=['export_code'])

    def test_sheet_response_carries_both_codes(self):
        resp = self.client.get('/api/v1/export/shipments/sheet/')
        self.assertEqual(resp.status_code, 200, resp.data)
        # Find this shipment in the response.
        results = resp.json().get('results', [])
        match = next((r for r in results if r['shipment_code'] == '0101012/25'), None)
        self.assertIsNotNone(match, 'Test shipment missing from /sheet/ response')
        self.assertEqual(match['shipment_code'], '0101012/25')
        self.assertEqual(match['export_code'], '02|FB|012|FA|25|--')


class WarehouseChiefHasShipmentCodePermissionTests(TestCase):
    """seed_permissions grants warehouse_chief edit access to export_code."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')

    def test_warehouse_chief_can_edit_shipment_code(self):
        # Signature: can_edit_field(role: str, field: str, resource_code='shipment')
        from apps.core.permissions import can_edit_field
        self.assertTrue(
            can_edit_field('warehouse_chief', 'export_code'),
            'warehouse_chief must have permission to edit export_code',
        )

    def test_warehouse_chief_cannot_edit_export_code(self):
        from apps.core.permissions import can_edit_field
        self.assertFalse(
            can_edit_field('warehouse_chief', 'shipment_code'),
            'warehouse_chief must NOT be able to edit shipment_code (Export Code is auto)',
        )
