"""Tests for can_edit_sheet_field and get_sheet_edit_map permission helpers.

Tests the trigger-gate logic (Sheet Control v2 — ADR-0001, ADR-0010):
  - Director and superuser bypass all gates.
  - No SheetRowSetting → falls back to RoleFieldPermission.
  - role_triggers set: role match AND field perm required.
  - triggered_user set: user match AND field perm required.
  - Inactive triggered_user → treated as no-trigger (only user-specific match fails).
  - is_locked=True: only matching triggers AND field perm grants access.
  - extra_users (SheetRowUserPermission): can grant edit exception to lock.
  - Soft-deleted extra_user entry is ignored.
  - get_sheet_edit_map returns {field_key: bool} for every DEFAULT_SHEET_ROWS entry
    in at most 4 DB queries (settings + 2 prefetch SELECTs + field perms).

Run with:
    python manage.py test apps.export.tests_sheet_perms --verbosity=2
"""
from django.core.cache import cache
from django.test import TestCase

from apps.core.models import RoleFieldPermission, User
from apps.core.permissions import can_edit_sheet_field, get_sheet_edit_map
from apps.export.models import SheetRowSetting, SheetRowRoleTrigger, SheetRowUserPermission
from apps.export.sheet_rows import DEFAULT_SHEET_ROWS

# A field_key that exists in DEFAULT_SHEET_ROWS — use a stable one.
_FIELD = 'weight_net'
_ALT_FIELD = 'export_manager_note'


def _make_user(username: str, role: str = 'export_manager', is_active: bool = True) -> User:
    return User.objects.create_user(
        username=username, password='pass', role=role, is_active=is_active,
    )


def _grant_field(role: str, field: str) -> RoleFieldPermission:
    """Create a RoleFieldPermission granting 'role' edit access on 'field' for 'shipment'."""
    obj, _ = RoleFieldPermission.objects.get_or_create(
        role=role, resource_code='shipment', field_name=field,
    )
    return obj


def _grant_wildcard(role: str) -> RoleFieldPermission:
    """Grant all fields via wildcard."""
    obj, _ = RoleFieldPermission.objects.get_or_create(
        role=role, resource_code='shipment', field_name='*',
    )
    return obj


def _make_setting(field_key: str = _FIELD, roles: list[str] | None = None, **kwargs) -> SheetRowSetting:
    """Create or update a SheetRowSetting. Accepts ``roles=[]`` for SheetRowRoleTrigger creation."""
    row = next((r for r in DEFAULT_SHEET_ROWS if r['field_key'] == field_key), None)
    row_number = row['row_number'] if row else 37
    # Use get_or_create to be safe with --keepdb
    setting, _ = SheetRowSetting.objects.update_or_create(
        field_key=field_key,
        defaults={'row_number': row_number, **kwargs},
    )
    # Replace role triggers
    SheetRowRoleTrigger.objects.filter(row=setting).delete()
    if roles:
        SheetRowRoleTrigger.objects.bulk_create(
            [SheetRowRoleTrigger(row=setting, role=r) for r in roles],
            batch_size=500,
        )
    return setting


class TestDirectorBypassesAll(TestCase):
    """Director always sees every field as editable — no DB trigger check needed."""

    def setUp(self):
        cache.clear()
        self.director = _make_user('director_user', role='director')
        # Create a setting with a role trigger that would normally block access
        _make_setting(roles=['transport'])

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
            username='admin_bypass', password='pass', role='finansist',
        )
        _make_setting(roles=['transport'])

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
        # Ensure no SheetRowSetting for _FIELD
        SheetRowSetting.objects.filter(field_key=_FIELD).delete()
        # Clean any wildcard perm from --keepdb leakage
        RoleFieldPermission.objects.filter(role='export_manager', resource_code='shipment').delete()
        cache.clear()

    def test_no_setting_falls_back_when_field_perm_granted(self):
        _grant_field('export_manager', _FIELD)
        cache.clear()
        result = can_edit_sheet_field(self.user, _FIELD)
        self.assertTrue(result)

    def test_no_setting_falls_back_when_field_perm_absent(self):
        # No RoleFieldPermission row for this role+field
        result = can_edit_sheet_field(self.user, _FIELD)
        self.assertFalse(result)


class TestRoleTriggerMatchPassesFieldCheck(TestCase):
    """role_triggers match + field perm → True."""

    def setUp(self):
        cache.clear()
        self.user = _make_user('transport_user', role='transport')
        _make_setting(roles=['transport'])
        _grant_field('transport', _FIELD)
        cache.clear()

    def test_role_trigger_match_passes_field_check(self):
        result = can_edit_sheet_field(self.user, _FIELD)
        self.assertTrue(result)


class TestRoleTriggerMatchLacksFieldPerm(TestCase):
    """role_triggers matches but RoleFieldPermission denies → False.

    The trigger gate is AND-composed with field perm — never OR.
    """

    def setUp(self):
        cache.clear()
        self.user = _make_user('transport_user2', role='transport')
        _make_setting(roles=['transport'])
        # Deliberately no RoleFieldPermission for transport + _FIELD
        RoleFieldPermission.objects.filter(role='transport', resource_code='shipment').delete()
        cache.clear()

    def test_role_trigger_match_lacks_field_perm(self):
        result = can_edit_sheet_field(self.user, _FIELD)
        self.assertFalse(result)


class TestRoleTriggerMismatch(TestCase):
    """User role doesn't match any role_trigger → False even with field perm."""

    def setUp(self):
        cache.clear()
        self.user = _make_user('em_user2', role='export_manager')
        _make_setting(roles=['transport'])
        _grant_field('export_manager', _FIELD)  # has field perm but wrong role trigger
        cache.clear()

    def test_role_trigger_mismatch(self):
        result = can_edit_sheet_field(self.user, _FIELD)
        self.assertFalse(result)


class TestMultipleRoleTriggers(TestCase):
    """Multiple roles in role_triggers — any match grants access (OR)."""

    def setUp(self):
        cache.clear()
        self.transport = _make_user('trans_multi', role='transport')
        self.warehouse = _make_user('wh_multi', role='warehouse_chief')
        self.other = _make_user('other_multi', role='sales_rep')
        _make_setting(roles=['transport', 'warehouse_chief'])
        _grant_field('transport', _FIELD)
        _grant_field('warehouse_chief', _FIELD)
        _grant_field('sales_rep', _FIELD)
        cache.clear()

    def test_first_role_matches(self):
        self.assertTrue(can_edit_sheet_field(self.transport, _FIELD))

    def test_second_role_matches(self):
        self.assertTrue(can_edit_sheet_field(self.warehouse, _FIELD))

    def test_unmatched_role_denied(self):
        """sales_rep has field perm but is not in role_triggers → False."""
        self.assertFalse(can_edit_sheet_field(self.other, _FIELD))


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
    """Inactive triggered_user → treated as no-user-trigger (user-specific match fails)."""

    def setUp(self):
        cache.clear()
        self.inactive_user = _make_user('ex_employee', role='transport', is_active=False)
        self.active_user = _make_user('active_transport', role='transport')
        # Row with inactive triggered_user but no role triggers → no config effectively
        _make_setting(triggered_user=self.inactive_user)
        _grant_wildcard('transport')
        cache.clear()

    def test_triggered_user_inactive_self_blocked(self):
        """The inactive user cannot self-match (is_active check in v2)."""
        result = can_edit_sheet_field(self.inactive_user, _FIELD)
        self.assertFalse(result, 'Inactive triggered_user must not self-match')

    def test_triggered_user_inactive_other_blocked(self):
        """Active user with same role also blocked because triggered_user config exists
        but the user-match fails (inactive), and there are no role triggers."""
        result = can_edit_sheet_field(self.active_user, _FIELD)
        self.assertFalse(result)


class TestIsLockedBlocksUnconfiguredRole(TestCase):
    """is_locked=True: a user whose role is NOT in role_triggers is blocked."""

    def setUp(self):
        cache.clear()
        self.transport = _make_user('trans_locked', role='transport')
        self.other = _make_user('other_locked', role='sales_rep')
        _make_setting(roles=['transport'], is_locked=True)
        _grant_field('transport', _FIELD)
        _grant_field('sales_rep', _FIELD)
        cache.clear()

    def test_matching_role_still_allowed(self):
        self.assertTrue(can_edit_sheet_field(self.transport, _FIELD))

    def test_non_matching_role_blocked_by_lock(self):
        self.assertFalse(can_edit_sheet_field(self.other, _FIELD))


class TestExtraUsersWithoutLock(TestCase):
    """SheetRowUserPermission grants edit when is_locked=False."""

    def setUp(self):
        cache.clear()
        self.granted_user = _make_user('granted_u', role='sales_rep')
        self.other_user = _make_user('other_u', role='sales_rep')
        setting = _make_setting()  # no role triggers, is_locked=False
        SheetRowUserPermission.objects.create(
            row=setting, user=self.granted_user, can_edit=True,
        )
        _grant_field('sales_rep', _FIELD)
        cache.clear()

    def test_granted_user_can_edit(self):
        self.assertTrue(can_edit_sheet_field(self.granted_user, _FIELD))

    def test_other_user_blocked(self):
        """other_user has field perm but is not in extra_users → blocked by trigger config."""
        self.assertFalse(can_edit_sheet_field(self.other_user, _FIELD))


class TestIsLockedRespectsExtraUsers(TestCase):
    """is_locked=True: SheetRowUserPermission.can_edit=True is an exception to the lock."""

    def setUp(self):
        cache.clear()
        self.exception_user = _make_user('except_u', role='sales_rep')
        self.normal_user = _make_user('normal_u', role='sales_rep')
        setting = _make_setting(is_locked=True)  # locked, no role triggers
        SheetRowUserPermission.objects.create(
            row=setting, user=self.exception_user, can_edit=True,
        )
        _grant_field('sales_rep', _FIELD)
        cache.clear()

    def test_exception_user_can_edit_despite_lock(self):
        self.assertTrue(can_edit_sheet_field(self.exception_user, _FIELD))

    def test_normal_user_blocked_by_lock(self):
        self.assertFalse(can_edit_sheet_field(self.normal_user, _FIELD))


class TestSoftDeletedExtraUserIgnored(TestCase):
    """Soft-deleted SheetRowUserPermission entries must not grant access."""

    def setUp(self):
        cache.clear()
        from django.utils import timezone
        self.user = _make_user('softdel_u', role='sales_rep')
        setting = _make_setting(is_locked=True)
        SheetRowUserPermission.objects.create(
            row=setting, user=self.user, can_edit=True,
            deleted_at=timezone.now(),  # soft-deleted immediately
        )
        _grant_field('sales_rep', _FIELD)
        cache.clear()

    def test_soft_deleted_grant_ignored(self):
        self.assertFalse(can_edit_sheet_field(self.user, _FIELD))


class TestHiddenRowDeniesAll(TestCase):
    """is_visible=False → False for everyone except superuser/director."""

    def setUp(self):
        cache.clear()
        self.user = _make_user('vis_user', role='transport')
        self.director = _make_user('vis_dir', role='director')
        _make_setting(roles=['transport'], is_visible=False)
        _grant_field('transport', _FIELD)
        cache.clear()

    def test_hidden_row_denies_matching_role(self):
        self.assertFalse(can_edit_sheet_field(self.user, _FIELD))

    def test_director_bypasses_hidden_row(self):
        """Director bypass happens BEFORE visibility check (Rule 1 in docstring)."""
        self.assertTrue(can_edit_sheet_field(self.director, _FIELD))


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
    """get_sheet_edit_map uses at most 4 DB queries total.

    Query budget (Sheet Control v2):
      1. SheetRowSetting.objects.active() with select_related('triggered_user')
      2. prefetch role_triggers
      3. prefetch user_permissions
      4. RoleFieldPermission query (or cache hit)

    Director short-circuits before any DB query.
    """

    def setUp(self):
        cache.clear()
        self.user = _make_user('qcount_user', role='sales_rep')
        # Seed a few settings to make the query non-trivial
        _make_setting(_FIELD, roles=['transport'])
        _make_setting(_ALT_FIELD, roles=['sales_rep'])
        _grant_field('sales_rep', _ALT_FIELD)
        cache.clear()  # ensure no cache from setUp

    def test_get_sheet_edit_map_query_count(self):
        # At most 4 queries:
        #   1. SheetRowSetting.objects.active() + select_related
        #   2. prefetch role_triggers
        #   3. prefetch user_permissions
        #   4. RoleFieldPermission.objects.filter(role=...).values_list(...)
        with self.assertNumQueries(4):
            edit_map = get_sheet_edit_map(self.user)

        self.assertIsInstance(edit_map, dict)
        self.assertEqual(len(edit_map), len(DEFAULT_SHEET_ROWS))

    def test_get_sheet_edit_map_director_zero_queries(self):
        """Director short-circuits before any DB query."""
        director = _make_user('director_qc', role='director')
        cache.clear()
        with self.assertNumQueries(0):
            edit_map = get_sheet_edit_map(director)
        self.assertTrue(all(edit_map.values()))
