"""Tests for migration A1: drop route_note + customs_clearance, add export_manager_note.

Validates the data-migration function directly (without running manage.py migrate),
following the project's standard test pattern.

The migration module name starts with a digit, making it an invalid Python identifier
for direct import. We load it via importlib instead.

Run with:
    python manage.py test apps.export.tests_drop_legacy_fields --verbosity=2
"""
import importlib

from django.test import TestCase

from apps.core.models import Season, User
from apps.export.models import SheetRowSetting, ShipmentComment, Shipment

# Load migration module via importlib (module name starts with a digit)
_migration = importlib.import_module(
    'apps.export.migrations.0008_drop_legacy_fields_add_manager_note'
)
_drop_legacy_sheet_rows = _migration._drop_legacy_sheet_rows


def _make_user(username: str) -> User:
    return User.objects.create_user(username=username, password='pass', role='export_manager')


def _make_shipment(author: User) -> Shipment:
    from apps.core.models import Season, ShipmentStatusType
    season, _ = Season.objects.get_or_create(
        name='2025',
        defaults={'start_date': '2025-01-01', 'end_date': '2025-12-31'},
    )
    status, _ = ShipmentStatusType.objects.get_or_create(
        code='yuklenme',
        defaults={'name_tk': 'yuklenme', 'name_en': 'Loading', 'step_order': 1, 'phase': 'LOADING'},
    )
    return Shipment.objects.create(
        cargo_code='0101099/25',
        date='2025-01-01',
        season=season,
        status=status,
        created_by=author,
    )


def _make_sheet_row(field_key: str, row_number: int) -> SheetRowSetting:
    """Create a minimal SheetRowSetting for testing."""
    setting, _ = SheetRowSetting.objects.get_or_create(
        field_key=field_key,
        defaults={'row_number': row_number},
    )
    return setting


def _fake_apps():
    """Return a minimal apps registry that resolves to the live models."""

    class _FakeApps:
        def get_model(self, app_label, model_name):
            if app_label == 'export' and model_name == 'SheetRowSetting':
                return SheetRowSetting
            if app_label == 'export' and model_name == 'ShipmentComment':
                return ShipmentComment
            raise LookupError(f'Unknown model: {app_label}.{model_name}')

    return _FakeApps()


class TestDropLegacySheetRows(TestCase):
    """_drop_legacy_sheet_rows deletes the 3 dead rows, keeps notes and weight_net."""

    def setUp(self):
        # Rows to be deleted
        self.route_note_row = _make_sheet_row('route_note', 2)
        self.customs_clearance_row = _make_sheet_row('customs_clearance', 5)
        self.cmr_status_row = _make_sheet_row('cmr_status', 40)
        # Keeper rows — must survive
        self.notes_row = _make_sheet_row('notes', 4)
        self.weight_net_row = _make_sheet_row('weight_net', 37)

    def test_dead_rows_deleted(self):
        """route_note, customs_clearance, cmr_status rows are deleted."""
        _drop_legacy_sheet_rows(_fake_apps(), schema_editor=None)

        remaining = set(
            SheetRowSetting.objects.values_list('field_key', flat=True)
        )
        self.assertNotIn('route_note', remaining)
        self.assertNotIn('customs_clearance', remaining)
        self.assertNotIn('cmr_status', remaining)

    def test_keeper_rows_survive(self):
        """notes and weight_net rows are NOT deleted."""
        _drop_legacy_sheet_rows(_fake_apps(), schema_editor=None)

        remaining = set(
            SheetRowSetting.objects.values_list('field_key', flat=True)
        )
        self.assertIn('notes', remaining)
        self.assertIn('weight_net', remaining)


class TestDropLegacyShipmentComments(TestCase):
    """_drop_legacy_sheet_rows nullifies field_key on comments for dead fields."""

    def setUp(self):
        self.author = _make_user('comment_author')
        self.shipment = _make_shipment(self.author)

        self.dead_comment = ShipmentComment.objects.create(
            shipment=self.shipment,
            user=self.author,
            content='This was anchored to route_note',
            field_key='route_note',
        )
        self.live_comment = ShipmentComment.objects.create(
            shipment=self.shipment,
            user=self.author,
            content='This is anchored to weight_net',
            field_key='weight_net',
        )

    def test_dead_field_comment_nullified(self):
        """Comments anchored to route_note get field_key=None."""
        _drop_legacy_sheet_rows(_fake_apps(), schema_editor=None)

        self.dead_comment.refresh_from_db()
        self.assertIsNone(self.dead_comment.field_key)

    def test_live_field_comment_unchanged(self):
        """Comments anchored to weight_net keep their field_key."""
        _drop_legacy_sheet_rows(_fake_apps(), schema_editor=None)

        self.live_comment.refresh_from_db()
        self.assertEqual(self.live_comment.field_key, 'weight_net')


class TestUserSheetRowPrefCascade(TestCase):
    """User prefs pointing at deleted sheet rows are cascade-deleted."""

    def setUp(self):
        from apps.export.models.sheet_settings import UserSheetRowPref
        self.UserSheetRowPref = UserSheetRowPref

        self.user = _make_user('pref_owner')
        self.dead_row = _make_sheet_row('route_note', 2)
        self.live_row = _make_sheet_row('weight_net', 37)

        self.dead_pref = UserSheetRowPref.objects.create(
            user=self.user, row=self.dead_row, is_hidden=True,
        )
        self.live_pref = UserSheetRowPref.objects.create(
            user=self.user, row=self.live_row, is_hidden=True,
        )

    def test_dead_row_pref_cascade_deleted(self):
        """Pref pointing at a deleted SheetRowSetting is removed via FK cascade."""
        _drop_legacy_sheet_rows(_fake_apps(), schema_editor=None)

        self.assertFalse(
            self.UserSheetRowPref.objects.filter(pk=self.dead_pref.pk).exists()
        )

    def test_live_row_pref_unchanged(self):
        """Pref on a surviving row is not affected."""
        _drop_legacy_sheet_rows(_fake_apps(), schema_editor=None)

        self.assertTrue(
            self.UserSheetRowPref.objects.filter(pk=self.live_pref.pk).exists()
        )
