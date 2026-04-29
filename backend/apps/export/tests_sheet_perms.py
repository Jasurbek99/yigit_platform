"""Tests for can_edit_sheet_field and get_sheet_edit_map permission helpers.

Tests the trigger-gate logic (plan D3/D4):
  - Director and superuser bypass all gates.
  - No SheetRowSetting → falls back to RoleFieldPermission.
  - triggered_role set: role match AND field perm required.
  - triggered_user set: user match AND field perm required.
  - Inactive triggered_user → row locked for everyone.
  - get_sheet_edit_map returns {field_key: bool} for every DEFAULT_SHEET_ROWS entry
    in at most 2 DB queries.

Run with:
    python manage.py test apps.export.tests_sheet_perms --verbosity=2
"""
from django.core.cache import cache
from django.test import TestCase

from apps.core.models import RoleFieldPermission, User
from apps.core.permissions import can_edit_sheet_field, get_sheet_edit_map
from apps.export.models import SheetRowSetting
from apps.export.sheet_rows import DEFAULT_SHEET_ROWS

# A field_key that exists in DEFAULT_SHEET_ROWS — use a stable one.
_FIELD = 'weight_net'
_ALT_FIELD = 'route_note'


def _make_user(username: str, role: str = 'export_manager', is_active: bool = True) -> User:
    return User.objects.create_user(
        username=username, password='pass', role=role, is_active=is_active,
    )


def _grant_field(role: str, field: str) -> RoleFieldPermission:
    """Create a RoleFieldPermission granting 'role' edit access on 'field' for 'shipment'."""
    return RoleFieldPermission.objects.create(
        role=role, resource_code='shipment', field_name=field,
    )


def _grant_wildcard(role: str) -> RoleFieldPermission:
    """Grant all fields via wildcard."""
    return RoleFieldPermission.objects.create(
        role=role, resource_code='shipment', field_name='*',
    )


def _make_setting(field_key: str = _FIELD, **kwargs) -> SheetRowSetting:
    row = next((r for r in DEFAULT_SHEET_ROWS if r['field_key'] == field_key), None)
    row_number = row['row_number'] if row else 37
    return SheetRowSetting.objects.create(
        field_key=field_key, row_number=row_number, **kwargs,
    )


class TestDirectorBypassesAll(TestCase):
    """Director always sees every field as editable — no DB trigger check needed."""

    def setUp(self):
        cache.clear()
        self.director = _make_user('director_user', role='director')
        # Create a setting that would normally block access
        _make_setting(triggered_role='transport')

    def test_director_bypasses_all(self):
        result = can_edit_sheet_field(self.director, _FIELD)
        self.assertTrue(result, 'Director must always get True from can_edit_sheet_field')

    def test_get_sheet_edit_map_all_true_for_director(self):
        edit_map = get_sheet_edit_map(self.director)
        for field_key, can_edit in edit_map.items():
            self.assertTrue(can_edit, f'Director should be able to edit {field_key}')


class TestSuperuserBypassesAll(TestCase):
    """is_superuser bypasses all gates regardless of role."""

    def setUp(self):
        cache.clear()
        # Superuser with a non-director role to confirm it's is_superuser, not role, that gates
        self.superuser = User.objects.create_superuser(
            username='admin', password='pass', role='finansist',
        )
        _make_setting(triggered_role='transport')

    def test_superuser_bypasses_all(self):
        result = can_edit_sheet_field(self.superuser, _FIELD)
        self.assertTrue(result)

    def test_get_sheet_edit_map_all_true_for_superuser(self):
        edit_map = get_sheet_edit_map(self.superuser)
        for field_key, can_edit in edit_map.items():
            self.assertTrue(can_edit, f'Superuser should be able to edit {field_key}')


class TestNoSettingFallsBackToFieldPerm(TestCase):
    """When no SheetRowSetting exists for a field, result equals can_edit_field outcome."""

    def setUp(self):
        cache.clear()
        self.user = _make_user('em_user', role='export_manager')
        # No SheetRowSetting for _FIELD — intentionally absent

    def test_no_setting_falls_back_when_field_perm_granted(self):
        _grant_field('export_manager', _FIELD)
        cache.clear()  # invalidate after creating perm row
        result = can_edit_sheet_field(self.user, _FIELD)
        self.assertTrue(result)

    def test_no_setting_falls_back_when_field_perm_absent(self):
        # No RoleFieldPermission row for this role+field
        result = can_edit_sheet_field(self.user, _FIELD)
        self.assertFalse(result)


class TestTriggeredRoleMatchPassesFieldCheck(TestCase):
    """triggered_role match + field perm → True."""

    def setUp(self):
        cache.clear()
        self.user = _make_user('transport_user', role='transport')
        _make_setting(triggered_role='transport')
        _grant_field('transport', _FIELD)
        cache.clear()

    def test_triggered_role_match_passes_field_check(self):
        result = can_edit_sheet_field(self.user, _FIELD)
        self.assertTrue(result)


class TestTriggeredRoleMatchLacksFieldPerm(TestCase):
    """triggered_role matches but RoleFieldPermission denies → False.

    The trigger gate is AND-composed with field perm — never OR.
    """

    def setUp(self):
        cache.clear()
        self.user = _make_user('transport_user2', role='transport')
        _make_setting(triggered_role='transport')
        # Deliberately no RoleFieldPermission for transport + _FIELD

    def test_triggered_role_match_lacks_field_perm(self):
        result = can_edit_sheet_field(self.user, _FIELD)
        self.assertFalse(result)


class TestTriggeredRoleMismatch(TestCase):
    """User role doesn't match triggered_role → False even with field perm."""

    def setUp(self):
        cache.clear()
        self.user = _make_user('em_user2', role='export_manager')
        _make_setting(triggered_role='transport')
        _grant_field('export_manager', _FIELD)  # has field perm but wrong role
        cache.clear()

    def test_triggered_role_mismatch(self):
        result = can_edit_sheet_field(self.user, _FIELD)
        self.assertFalse(result)


class TestTriggeredUserMatch(TestCase):
    """request.user.id == triggered_user_id AND has field perm → True."""

    def setUp(self):
        cache.clear()
        self.user = _make_user('bahar', role='warehouse_chief')
        _make_setting(triggered_user=self.user)
        _grant_field('warehouse_chief', _FIELD)
        cache.clear()

    def test_triggered_user_match(self):
        result = can_edit_sheet_field(self.user, _FIELD)
        self.assertTrue(result)


class TestTriggeredUserMismatch(TestCase):
    """Different user than triggered_user → False."""

    def setUp(self):
        cache.clear()
        self.triggered_user = _make_user('bahar2', role='warehouse_chief')
        self.other_user = _make_user('other2', role='warehouse_chief')
        _make_setting(triggered_user=self.triggered_user)
        _grant_field('warehouse_chief', _FIELD)
        cache.clear()

    def test_triggered_user_mismatch(self):
        result = can_edit_sheet_field(self.other_user, _FIELD)
        self.assertFalse(result)


class TestTriggeredUserInactive(TestCase):
    """Inactive triggered_user → False for everyone except director/superuser.

    An inactive user in triggered_user position locks the row entirely.
    """

    def setUp(self):
        cache.clear()
        # The inactive user who used to be the trigger
        self.inactive_user = _make_user('ex_employee', role='transport', is_active=False)
        # Another active user with the same role and field perm
        self.active_user = _make_user('active_transport', role='transport')
        _make_setting(triggered_user=self.inactive_user)
        _grant_wildcard('transport')
        cache.clear()

    def test_triggered_user_inactive_blocks_all(self):
        # The triggered_user themselves (inactive — would normally be self-match)
        result_inactive = can_edit_sheet_field(self.inactive_user, _FIELD)
        self.assertFalse(result_inactive, 'Inactive triggered_user must not be able to edit')

    def test_triggered_user_inactive_blocks_other_active_user(self):
        result_other = can_edit_sheet_field(self.active_user, _FIELD)
        self.assertFalse(result_other, 'Active user should not edit when triggered_user is inactive')


class TestGetSheetEditMapShape(TestCase):
    """get_sheet_edit_map returns {field_key: bool} with one key per DEFAULT_SHEET_ROWS entry."""

    def setUp(self):
        cache.clear()
        self.user = _make_user('shape_user', role='export_manager')

    def test_get_sheet_edit_map_shape(self):
        edit_map = get_sheet_edit_map(self.user)
        expected_keys = {row['field_key'] for row in DEFAULT_SHEET_ROWS}
        self.assertEqual(set(edit_map.keys()), expected_keys)
        for field_key, value in edit_map.items():
            self.assertIsInstance(value, bool, f'Value for {field_key} must be bool')

    def test_get_sheet_edit_map_has_correct_count(self):
        edit_map = get_sheet_edit_map(self.user)
        self.assertEqual(len(edit_map), len(DEFAULT_SHEET_ROWS))


class TestGetSheetEditMapQueryCount(TestCase):
    """get_sheet_edit_map uses at most 2 DB queries total (one for settings, one for perms)."""

    def setUp(self):
        cache.clear()
        self.user = _make_user('qcount_user', role='sales_rep')
        # Seed a few settings to make the query non-trivial
        _make_setting(_FIELD, triggered_role='transport')
        _make_setting(_ALT_FIELD, triggered_role='sales_rep')
        _grant_field('sales_rep', _ALT_FIELD)
        cache.clear()  # ensure no cache from setUp

    def test_get_sheet_edit_map_query_count(self):
        # Confirm at most 2 queries:
        #   1. SheetRowSetting.objects.select_related('triggered_user').all()
        #   2. RoleFieldPermission.objects.filter(role=...).values_list(...)
        # (The cache miss for the second query counts as 1 query.)
        with self.assertNumQueries(2):
            edit_map = get_sheet_edit_map(self.user)

        # Sanity checks on result
        self.assertIsInstance(edit_map, dict)
        self.assertEqual(len(edit_map), len(DEFAULT_SHEET_ROWS))

    def test_get_sheet_edit_map_director_zero_queries(self):
        """Director short-circuits before any DB query."""
        director = _make_user('director_qc', role='director')
        cache.clear()
        with self.assertNumQueries(0):
            edit_map = get_sheet_edit_map(director)
        self.assertTrue(all(edit_map.values()))
