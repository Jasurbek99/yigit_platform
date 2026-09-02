"""Sheet Settings is the permission authority for Sheet-owned fields.

Covers the endpoint lock-down (Task 1), the trigger-only gate (Task 3), the
reverse delegates (Task 2/5) and the write-path parity invariant (Task 5).
"""
import os
from datetime import date
from decimal import Decimal
from importlib import import_module
from unittest import mock

from django.apps import apps as django_apps
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import (
    GreenhouseBlock, RolePagePermission, RoleResourcePermission, Season, ShipmentStatusType,
)
from apps.export.models import Shipment, SheetRowSetting

User = get_user_model()

_MIGRATION = import_module(
    'apps.core.migrations.0038_sheet_row_setting_resource'
)


def _make_user(username: str, role: str) -> 'User':
    return User.objects.create_user(username=username, password='pass', role=role)


class TestSheetRowSettingsEndpointLockdown(TestCase):
    """Only admin / director / export_manager may write Sheet row settings.

    Before this change the ViewSet gated on shipment.can_edit, which five
    non-admin roles hold — the only barrier was frontend page visibility.
    """

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.doc = _make_user('lockdown_doc', 'document_team')
        cls.mgr = _make_user('lockdown_mgr', 'export_manager')
        cls.row = SheetRowSetting.objects.create(
            field_key='country', row_number=11, display_order=11 * 1024,
        )

    def setUp(self):
        cache.clear()

    def _patch_as(self, user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client.patch(
            f'/api/v1/export/admin/sheet-rows/{self.row.id}/',
            {'version': self.row.version, 'label_en': 'Destination country'},
            format='json',
        )

    def test_document_team_cannot_patch_sheet_row(self):
        self.assertEqual(self._patch_as(self.doc).status_code, 403)

    def test_export_manager_can_patch_sheet_row(self):
        self.assertEqual(self._patch_as(self.mgr).status_code, 200)


class TestSheetRowSettingMigrationReverse(TestCase):
    """`migrate core 0037` (the reverse of 0038) must be fully symmetric with
    grant() — a `RolePagePermission` row left behind for export_manager /
    admin.shipment_settings with no `sheet_row_setting` resource grant backing
    it is a ghost admin tab, the same class of bug migration 0037 exists to
    close. grant()'s own DJANGO_TESTING guard is bypassed here (forced off)
    so the test exercises the real writes regardless of ambient env state.
    """

    def setUp(self):
        cache.clear()
        RoleResourcePermission.objects.filter(resource_code='sheet_row_setting').delete()
        RolePagePermission.objects.filter(page_code='admin.shipment_settings').delete()

    def test_revoke_removes_both_the_resource_grant_and_the_page(self):
        with mock.patch.dict(os.environ, {'DJANGO_TESTING': 'false'}):
            _MIGRATION.grant(django_apps, None)

        self.assertTrue(
            RoleResourcePermission.objects.filter(
                role='export_manager', resource_code='sheet_row_setting',
            ).exists(),
            'premise broken: grant() did not create the resource row',
        )
        self.assertTrue(
            RolePagePermission.objects.filter(
                role='export_manager', page_code='admin.shipment_settings', is_visible=True,
            ).exists(),
            'premise broken: grant() did not create the page row',
        )

        _MIGRATION.revoke(django_apps, None)

        self.assertFalse(
            RoleResourcePermission.objects.filter(
                role__in=['admin', 'director', 'export_manager'],
                resource_code='sheet_row_setting',
            ).exists(),
            'revoke() left a sheet_row_setting resource grant behind',
        )
        self.assertFalse(
            RolePagePermission.objects.filter(
                role='export_manager', page_code='admin.shipment_settings',
            ).exists(),
            'revoke() left a ghost admin.shipment_settings page for export_manager',
        )

    def test_grant_covers_every_wildcard_crud_role_including_boss(self):
        """Pins the MIGRATION's own role list, not the seeded state.

        `boss` holds `sheet_row_setting` in a *seeded* test DB only because
        `seed_permissions.RESOURCE_DEFAULTS['boss']` independently builds from
        the same `**{r: _VCRUD for r in _ALL_RESOURCES}` wildcard admin/
        director/export_manager use — a test that calls `seed_permissions`
        and then asserts `boss` can edit would pass whether or not `boss` is
        in this migration's own `ROLES`, and would have passed even with the
        2026-09-02 regression where `boss` was omitted from it (production
        runs `migrate`, never `seed_permissions`, so only `ROLES` here matters
        for a live box). This test calls `grant()` directly with no seeding,
        so it can only pass if `boss` is actually in `ROLES`.
        """
        self.assertFalse(
            RoleResourcePermission.objects.filter(
                role='boss', resource_code='sheet_row_setting',
            ).exists(),
            'premise broken: boss already had a row before grant() ran',
        )

        with mock.patch.dict(os.environ, {'DJANGO_TESTING': 'false'}):
            _MIGRATION.grant(django_apps, None)

        boss_perm = RoleResourcePermission.objects.filter(
            role='boss', resource_code='sheet_row_setting',
        ).first()
        self.assertIsNotNone(
            boss_perm,
            "grant() did not create a sheet_row_setting row for boss — "
            "on a migrated-only (non-seeded) database boss would 403 on "
            "every write despite seeing the admin.shipment_settings page "
            "(migration 0033's blanket grant).",
        )
        self.assertTrue(boss_perm.can_view)
        self.assertTrue(boss_perm.can_create)
        self.assertTrue(boss_perm.can_edit)
        self.assertTrue(boss_perm.can_delete)


class TestReverseDelegateMap(TestCase):
    """Composite Sheet cells write real columns that have no field_key.

    box_count is written by the packing cell, truck_head_id by the truck_plate
    cell, and so on. Those real fields must resolve to the owning Sheet row or
    they silently keep answering to RoleFieldPermission.
    """

    def test_every_reverse_target_is_a_real_sheet_row(self):
        from apps.core.permissions import _REVERSE_FIELD_DELEGATES
        from apps.export.sheet_rows import DEFAULT_SHEET_ROWS

        row_keys = {row['field_key'] for row in DEFAULT_SHEET_ROWS}
        for real_field, owning_row in _REVERSE_FIELD_DELEGATES.items():
            self.assertIn(
                owning_row, row_keys,
                f'{real_field} maps to {owning_row}, which is not a Sheet row',
            )

    def test_no_reverse_delegate_key_is_also_its_own_sheet_row(self):
        """can_edit_sheet_fields resolves a reverse-delegated real field
        straight to its owning row (see the method's docstring):
        `owning_row = _REVERSE_FIELD_DELEGATES.get(name, name)`. That lookup
        wins unconditionally, unlike can_edit_sheet_field (the singular
        gate), where Task 3 deliberately ordered a row's OWN settings ahead
        of the delegate fallback. If a real field in _REVERSE_FIELD_DELEGATES
        ever became a DEFAULT_SHEET_ROWS field_key in its own right, the
        batch write gate would keep answering from the delegate's row and
        silently ignore that field's own Shipment Settings row — reintroducing
        the AD-17 bug for that one field. Today's map is empty; this pins it.
        """
        from apps.core.permissions import _REVERSE_FIELD_DELEGATES
        from apps.export.sheet_rows import DEFAULT_SHEET_ROWS

        row_keys = {row['field_key'] for row in DEFAULT_SHEET_ROWS}
        shadowed = set(_REVERSE_FIELD_DELEGATES) & row_keys
        self.assertEqual(
            shadowed, set(),
            f'{shadowed} are both reverse-delegate keys AND real Sheet rows — '
            'can_edit_sheet_fields will shadow their own row with the delegate.',
        )

    def test_packing_column_delegates_stay_pinned(self):
        """Direct, unambiguous kill for 'packaging_kg' / 'pallet_weight_kg'.

        Every real role holding either of these two also holds box_count /
        pallet_count (seed_permissions.py FIELD_DEFAULTS: loading_dept_head,
        warehouse_chief, loading_dept_head_deputy) — both of which are
        SEPARATE _REVERSE_FIELD_DELEGATES entries that route to 'packing' on
        their own. Verified empirically (temporarily deleting just these two
        keys and re-running the backfill integration test in
        TestBackfillPreservesEveryRolesAccess): warehouse_chief and
        loading_dept_head_deputy keep 'packing' access regardless, because
        box_count/pallet_count carry them there independently. An
        integration-level assertion on those two roles cannot, by itself,
        prove these two dict entries exist — this direct pin is what does.
        """
        from apps.core.permissions import _REVERSE_FIELD_DELEGATES

        self.assertEqual(_REVERSE_FIELD_DELEGATES['packaging_kg'], 'packing')
        self.assertEqual(_REVERSE_FIELD_DELEGATES['pallet_weight_kg'], 'packing')

    def test_sheet_owned_fields_covers_rows_and_reverse_keys(self):
        from apps.core.permissions import _REVERSE_FIELD_DELEGATES, get_sheet_owned_fields
        from apps.export.sheet_rows import DEFAULT_SHEET_ROWS

        owned = get_sheet_owned_fields()
        for row in DEFAULT_SHEET_ROWS:
            self.assertIn(row['field_key'], owned)
        for real_field in _REVERSE_FIELD_DELEGATES:
            self.assertIn(real_field, owned)

    def test_batch_helper_agrees_with_the_single_field_gate(self):
        from apps.core.permissions import can_edit_sheet_field, can_edit_sheet_fields

        call_command('seed_permissions')
        cache.clear()
        user = _make_user('batch_probe', 'document_team')
        # box_count is deliberately absent: per AD-17, can_edit_sheet_fields
        # resolves it to the `packing` row it delegates to, while
        # can_edit_sheet_field(user, 'box_count') finds no Sheet row for the
        # literal key and falls back to a plain field-perm lookup on
        # 'box_count' itself — which document_team DOES hold
        # (seed_permissions.py FIELD_DEFAULTS), so that call returns True.
        # 'packing' is never itself a granted field name, so the batch
        # helper's delegated answer is False: on reverse-delegated keys the
        # batch helper is the STRICTER of the two, and they permanently
        # disagree by design (see ambiguity #2 in the Task 3 brief). Parity
        # is only asserted here for keys that are NOT reverse delegates.
        keys = ['documents_status', 'country', 'import_firm']

        batch = can_edit_sheet_fields(user, keys)
        for key in keys:
            self.assertEqual(
                batch[key], can_edit_sheet_field(user, key),
                f'batch and single-field gate disagree on {key}',
            )

    def test_batch_helper_resolves_a_delegated_field_to_its_owning_row(self):
        """box_count has no Sheet row of its own -- the batch helper must answer
        it from the `packing` row it delegates to, not from a plain lookup on
        its own (non-existent) key.

        No longer uses director (round-1 note below is now stale, kept as a
        record of why the switch happened). Round 1 added a 3-branch
        fallback to can_edit_sheet_fields: when the owning row has no trigger
        config, it asks can_edit_field(role, name) about the REAL field
        instead of the row key. director holds a shipment '*' wildcard
        RoleFieldPermission, so can_edit_field('director', 'box_count') is
        True regardless of whether the row lookup ran at all -- and
        get_sheet_edit_map(director) is all-True via its own Rule-1 bypass
        independently of any row's config. Both sides of the comparison were
        True unconditionally, so this test kept passing even with the
        `_REVERSE_FIELD_DELEGATES` lookup deleted outright (owning_row = name
        instead of the map lookup) -- confirmed empirically (see fix report,
        round 3).

        warehouse_chief is not privileged and holds the real box_count grant
        (seed_permissions.py FIELD_DEFAULTS), so can_edit_field('warehouse_chief',
        'box_count') is True -- but the packing row's trigger below excludes
        warehouse_chief, so the correctly-resolved edit_map['packing'] is
        False. The two values genuinely disagree unless the reverse-map
        lookup (box_count -> packing) actually runs; deleting it makes the
        batch helper answer from the wrong (True) branch and this test dies.
        Reconfirmed empirically (see fix report, round 3).
        """
        from apps.core.permissions import can_edit_sheet_fields, get_sheet_edit_map
        from apps.export.models import SheetRowRoleTrigger

        call_command('seed_permissions')
        packing_row = SheetRowSetting.objects.create(
            field_key='packing', row_number=48, display_order=48 * 1024,
        )
        SheetRowRoleTrigger.objects.create(row=packing_row, role='transport')
        cache.clear()
        user = _make_user('delegate_probe', 'warehouse_chief')

        self.assertEqual(
            can_edit_sheet_fields(user, ['box_count'])['box_count'],
            get_sheet_edit_map(user)['packing'],
        )
        self.assertFalse(
            get_sheet_edit_map(user)['packing'],
            'precondition: the packing row must exclude warehouse_chief for '
            'this comparison to be non-vacuous',
        )


class TestTriggersAreTheGrant(TestCase):
    """A role named in triggered_roles may edit the cell with no field grant.

    This is the reported bug: document_team was added to the country and
    import_firm rows in Shipment Settings and still could not edit them,
    because FIELD_DEFAULTS['document_team']['shipment'] does not list them.
    """

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.user = _make_user('trigger_doc', 'document_team')
        cls.row = SheetRowSetting.objects.create(
            field_key='country', row_number=11, display_order=11 * 1024,
        )

    def setUp(self):
        cache.clear()

    def test_no_trigger_and_no_field_grant_denies(self):
        from apps.core.permissions import can_edit_sheet_field
        self.assertFalse(can_edit_sheet_field(self.user, 'country'))

    def test_trigger_alone_grants_without_a_field_permission(self):
        from apps.core.models import RoleFieldPermission
        from apps.core.permissions import can_edit_sheet_field
        from apps.export.models import SheetRowRoleTrigger

        self.assertFalse(
            RoleFieldPermission.objects.filter(
                role='document_team', resource_code='shipment', field_name='country',
            ).exists(),
            'precondition: document_team must NOT hold the country field grant',
        )
        SheetRowRoleTrigger.objects.create(row=self.row, role='document_team')
        cache.clear()

        self.assertTrue(can_edit_sheet_field(self.user, 'country'))

    def test_edit_map_agrees_with_the_single_field_gate(self):
        from apps.core.permissions import can_edit_sheet_field, get_sheet_edit_map
        from apps.export.models import SheetRowRoleTrigger

        SheetRowRoleTrigger.objects.create(row=self.row, role='document_team')
        cache.clear()

        self.assertEqual(
            get_sheet_edit_map(self.user)['country'],
            can_edit_sheet_field(self.user, 'country'),
        )


class TestVirtualRowUsesItsOwnTriggers(TestCase):
    """A virtual row's own trigger config must gate it, not the delegate's.

    `transit_days_temp` (R26) has no column of its own — it writes transit_days
    and transport_temp_c. The delegate check used to run BEFORE the settings
    lookup, so resolving the virtual key recursed straight into `transit_days`,
    which has no SheetRowSetting, and fell through to RoleFieldPermission. The
    row's triggers were unreachable: R26 would have stayed on the old authority
    while every other row moved to Shipment Settings.
    """

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.row = SheetRowSetting.objects.create(
            field_key='transit_days_temp', row_number=26, display_order=26 * 1024,
        )

    def setUp(self):
        cache.clear()

    def test_trigger_on_the_virtual_row_grants_without_a_field_permission(self):
        from apps.core.models import RoleFieldPermission
        from apps.core.permissions import can_edit_sheet_field, get_sheet_edit_map
        from apps.export.models import SheetRowRoleTrigger

        user = _make_user('virtual_probe', 'document_team')
        self.assertFalse(
            RoleFieldPermission.objects.filter(
                role='document_team', resource_code='shipment',
                field_name='transit_days',
            ).exists(),
            'precondition: document_team must NOT hold the transit_days grant',
        )
        SheetRowRoleTrigger.objects.create(row=self.row, role='document_team')
        cache.clear()

        self.assertTrue(can_edit_sheet_field(user, 'transit_days_temp'))
        self.assertTrue(get_sheet_edit_map(user)['transit_days_temp'])

    def test_virtual_row_without_settings_still_delegates(self):
        """The old behaviour survives where there is no row to consult."""
        from apps.core.permissions import can_edit_sheet_field

        self.row.delete()
        cache.clear()
        transport = _make_user('virtual_transport', 'transport')

        # transport holds the transit_days field grant, so the delegate path
        # must still answer True once the virtual row is gone.
        self.assertTrue(can_edit_sheet_field(transport, 'transit_days_temp'))

    def test_row_present_with_zero_triggers_still_delegates(self):
        """Row exists (e.g. auto-provisioned by _provision_missing_rows) but
        nobody has configured a trigger on it yet — the unlocked no-config
        fallback must still resolve the virtual key through
        _VIRTUAL_FIELD_DELEGATES, not field-perm-check the literal virtual
        key, which no role ever holds in RoleFieldPermission (that's the
        entire premise of the delegate map). Before this fix, Step 4b's
        lookup-before-delegate inversion meant a zero-config virtual row
        denied every role, including the one that legitimately owns the real
        underlying field.
        """
        from apps.core.permissions import can_edit_sheet_field, get_sheet_edit_map

        transport = _make_user('virtual_zero_config', 'transport')
        # self.row (from setUpTestData) carries no role_triggers, no
        # triggered_user, no user_permissions — has_any_config is False.
        self.assertTrue(can_edit_sheet_field(transport, 'transit_days_temp'))
        self.assertTrue(get_sheet_edit_map(transport)['transit_days_temp'])


class TestBackfillPreservesEveryRolesAccess(TestCase):
    """Nobody loses write access when the serializer switches to the sheet gate.

    `test_every_role_that_had_field_perm_access_keeps_it_after_backfill` below
    snapshots the pre-backfill verdict for every (role, sheet field) pair using
    the OLD authority (RoleFieldPermission, resolved through the junction/
    virtual delegates the gate itself uses), runs the backfill, then asserts
    the NEW authority (the sheet gate) says yes wherever the old one did — new
    superset of old, never equality, since the backfill is allowed to widen.

    That snapshot is structurally blind to `packing` for any role WITHOUT a
    `shipment: ['*']` wildcard: nobody holds a RoleFieldPermission literally
    named 'packing', so a non-wildcard role's OLD verdict there is False and
    the property holds trivially, regardless of whether the reverse-delegate
    union is correct. It is NOT blind to it for `boss`: `can_edit_field`
    checks `'*' in allowed or field in allowed`, so `boss`'s
    `shipment: ['*']` (seed_permissions.FIELD_DEFAULTS) makes its OLD
    verdict for 'packing' True like every other field, and the general sweep
    below does cover `boss` keeping `packing` after backfill (via the
    wildcard-expansion clause in backfill_sheet_row_triggers). The other
    methods below pin the properties the snapshot genuinely can't reach for
    a NON-wildcard role: the wildcard-expansion property itself (every row,
    not just the ones a role's real fields resolve to) and `packing` for the
    three non-wildcard roles that reach it only through the reverse-delegate
    union (real access the backfill *creates* for them, not access it merely
    preserves).
    """

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')

    def setUp(self):
        cache.clear()

    def test_wildcard_roles_are_expanded_across_every_row(self):
        from apps.export.management.commands.backfill_sheet_row_triggers import backfill
        from apps.export.models import SheetRowSetting
        from apps.export.sheet_rows import DEFAULT_SHEET_ROWS

        SheetRowSetting.objects.bulk_create(
            [
                SheetRowSetting(
                    field_key=row['field_key'],
                    row_number=row['row_number'],
                    display_order=row['row_number'] * 1024,
                )
                for row in DEFAULT_SHEET_ROWS
            ],
            batch_size=500,
        )
        backfill()
        cache.clear()

        # boss holds shipment: ['*'] but is NOT in the privileged bypass set,
        # so without expansion he loses every cell the moment any other role
        # gets a trigger on it.
        boss = _make_user('backfill_boss', 'boss')
        from apps.core.permissions import get_sheet_edit_map
        edit_map = get_sheet_edit_map(boss)
        denied = [key for key, allowed in edit_map.items() if not allowed]
        self.assertEqual(denied, [], f'boss lost access to: {denied}')

    def test_every_role_that_had_field_perm_access_keeps_it_after_backfill(self):
        """New authority is a superset of the old one, computed directly.

        Every DEFAULT_SHEET_ROWS row is freshly provisioned with zero
        triggers, so before backfill() runs, can_edit_sheet_field's
        "no config" fallback IS the old authority:
        can_edit_field(role, resolved_field, resource_code), with the
        junction (_JUNCTION_FIELD_DELEGATES) and virtual
        (_VIRTUAL_FIELD_DELEGATES) delegates resolved exactly the way the
        gate itself resolves them. Snapshots that verdict for every role in
        FIELD_DEFAULTS x every active row, runs backfill(), then asserts
        can_edit_sheet_field is True wherever the snapshot was True.
        Direction only (new >= old): the backfill is allowed to widen (e.g.
        a wildcard role reaching a row it had no field grant naming), never
        narrow.

        Supersedes a WHO_TO_ROLE + `input_type == 'readonly'`-skip version of
        this test: that approach only ever checked the one role
        default_who_key names as owner, and only on rows with an inline
        editor, which is how `warehouse_chief` and `loading_dept_head_deputy`
        losing the `packing` popover almost shipped silently — neither is in
        WHO_TO_ROLE, and `packing` is readonly. Asking RoleFieldPermission
        directly needs neither table; `packing` itself is still outside its
        reach (see the class docstring) and is covered by
        test_reverse_delegate_backfills_packing_from_the_real_columns below.
        """
        from apps.core.management.commands.seed_permissions import FIELD_DEFAULTS
        from apps.core.permissions import (
            _JUNCTION_FIELD_DELEGATES,
            _VIRTUAL_FIELD_DELEGATES,
            can_edit_field,
            can_edit_sheet_field,
        )
        from apps.export.management.commands.backfill_sheet_row_triggers import backfill
        from apps.export.models import SheetRowSetting
        from apps.export.sheet_rows import DEFAULT_SHEET_ROWS

        SheetRowSetting.objects.bulk_create(
            [
                SheetRowSetting(
                    field_key=row['field_key'],
                    row_number=row['row_number'],
                    display_order=row['row_number'] * 1024,
                )
                for row in DEFAULT_SHEET_ROWS
            ],
            batch_size=500,
        )

        def _resolve(field_key: str) -> tuple[str, str]:
            if field_key in _JUNCTION_FIELD_DELEGATES:
                return _JUNCTION_FIELD_DELEGATES[field_key]
            return 'shipment', _VIRTUAL_FIELD_DELEGATES.get(field_key, field_key)

        # Snapshot the OLD verdict for every (role, row) pair BEFORE backfill
        # touches anything.
        old_verdicts: dict[tuple[str, str], bool] = {}
        for row in DEFAULT_SHEET_ROWS:
            resource_code, field_name = _resolve(row['field_key'])
            for role in FIELD_DEFAULTS:
                old_verdicts[(role, row['field_key'])] = can_edit_field(
                    role, field_name, resource_code=resource_code,
                )

        backfill()

        users_by_role: dict[str, 'User'] = {}
        failures = []
        for (role, field_key), was_true in old_verdicts.items():
            if not was_true:
                continue
            cache.clear()
            user = users_by_role.get(role)
            if user is None:
                user = _make_user(f'oldnew_{role}', role)
                users_by_role[role] = user
            if not can_edit_sheet_field(user, field_key):
                failures.append(f'{role} lost {field_key}')

        self.assertEqual(failures, [], '\n'.join(failures))

    def test_document_team_keeps_its_junction_wildcard(self):
        from apps.core.permissions import can_edit_sheet_field
        from apps.export.management.commands.backfill_sheet_row_triggers import backfill
        from apps.export.models import SheetRowSetting

        SheetRowSetting.objects.create(
            field_key='firm_splits', row_number=9, display_order=9 * 1024,
        )
        backfill()
        cache.clear()

        doc = _make_user('backfill_doc', 'document_team')
        self.assertTrue(can_edit_sheet_field(doc, 'firm_splits'))

    def test_reverse_delegate_backfills_packing_from_the_real_columns(self):
        """`packing` (R48) is the reverse-delegate row the packing columns
        write through their popover panel. It carries no field grant of its
        own — RoleFieldPermission never lists 'packing' as a field name —
        and for a role with no `shipment: ['*']` wildcard its OLD verdict is
        always False (see the class docstring; `boss` is the one exception,
        via the wildcard, and IS covered by the general sweep). For the
        three non-wildcard roles asserted below, neither the general sweep
        above nor RoleFieldPermission itself can vouch for `packing`; this
        is their only integration-level coverage.

        document_team, warehouse_chief and loading_dept_head_deputy are each
        asserted: all three reach 'packing' today (seed_permissions.py
        FIELD_DEFAULTS), and dropping any one of them would be a real,
        silent access loss for that role once Task 5 ships. None of these
        three assertions individually proves the 'packaging_kg' /
        'pallet_weight_kg' entries exist in _REVERSE_FIELD_DELEGATES,
        though: every role holding either of those two columns also holds
        box_count / pallet_count, separate entries in the same map that
        route to 'packing' on their own — confirmed empirically by
        temporarily deleting just the two 'packaging_kg'/'pallet_weight_kg'
        entries and re-running this test, which still passed.
        TestReverseDelegateMap.test_packing_column_delegates_stay_pinned is
        the direct, unambiguous kill for those two entries specifically.
        """
        from apps.core.permissions import can_edit_sheet_field
        from apps.export.management.commands.backfill_sheet_row_triggers import backfill
        from apps.export.models import SheetRowSetting

        SheetRowSetting.objects.create(
            field_key='packing', row_number=48, display_order=48 * 1024,
        )
        backfill()
        cache.clear()

        doc = _make_user('backfill_packing_doc', 'document_team')
        self.assertTrue(can_edit_sheet_field(doc, 'packing'))

        wc = _make_user('backfill_packing_wc', 'warehouse_chief')
        self.assertTrue(can_edit_sheet_field(wc, 'packing'))

        deputy = _make_user('backfill_packing_dep', 'loading_dept_head_deputy')
        self.assertTrue(can_edit_sheet_field(deputy, 'packing'))


class TestBackfillMirrorsJunctionResourceGrants(TestCase):
    """Whole-branch review Finding 2 (HIGH, 2026-09-02): the backfill must
    also carry forward a role's RoleResourcePermission.can_edit on a
    junction's OWN resource (shipment_firm_split / shipment_block_source),
    not just RoleFieldPermission.

    Before AD-17, set_firm_splits/set_block_sources were gated by
    junction_write_permission, which reads ONLY RoleResourcePermission. A
    role can hold that grant with no matching RoleFieldPermission row at
    all -- a live-DB check found `document_team` holding
    `shipment_block_source` exactly this way (resource-level can_edit, no
    field grant). can_edit_sheet_fields' no-config fallback ORs
    `_has_junction_resource_grant` in for this case, but that fallback only
    fires while the row carries ZERO trigger config -- and a real deployment
    provisions + backfills every active row, which always puts at least one
    trigger on it. `SheetJunctionEndpointResourcePermissionTests`
    (tests_shipment_sheet.py) runs with zero `SheetRowSetting` rows, so it
    only ever exercises that no-config fallback -- a path production never
    takes once migration 0065 has run. This test provisions every row (like
    a real deployment), grants document_team ONLY the resource permission
    (no field grant, matching the live-DB finding), runs backfill(), and
    asserts the trigger -- not the fallback -- is what carries the access
    afterwards.
    """

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')

    def setUp(self):
        cache.clear()

    def test_document_team_retains_block_sources_after_backfill(self):
        from apps.core.models import RoleFieldPermission, RoleResourcePermission
        from apps.core.permissions import can_edit_sheet_field
        from apps.export.management.commands.backfill_sheet_row_triggers import backfill
        from apps.export.models import SheetRowSetting
        from apps.export.sheet_rows import DEFAULT_SHEET_ROWS

        # document_team holds shipment_block_source at the RESOURCE level
        # only (matches the live-DB finding) -- seed_permissions.py's
        # RESOURCE_DEFAULTS/FIELD_DEFAULTS for document_team grant neither by
        # default, so both are set explicitly here, the same way
        # test_block_sources_also_gates_on_its_own_junction_resource
        # (tests_shipment_sheet.py) sets a resource-only grant for
        # `transport`.
        RoleResourcePermission.objects.update_or_create(
            role='document_team', resource_code='shipment_block_source',
            defaults={
                'can_view': True, 'can_create': True, 'can_edit': True, 'can_delete': False,
            },
        )
        RoleFieldPermission.objects.filter(
            role='document_team', resource_code='shipment_block_source',
        ).delete()

        # Every active row provisioned, not just the one under test -- this
        # is what flips has_any_config True for every asker on every row once
        # backfill runs, the exact condition that silences
        # _has_junction_resource_grant's no-config fallback.
        SheetRowSetting.objects.bulk_create(
            [
                SheetRowSetting(
                    field_key=row['field_key'],
                    row_number=row['row_number'],
                    display_order=row['row_number'] * 1024,
                )
                for row in DEFAULT_SHEET_ROWS
            ],
            batch_size=500,
        )

        backfill()
        cache.clear()

        row = SheetRowSetting.objects.active().get(field_key='block_sources')
        self.assertIn(
            'document_team',
            set(row.role_triggers.values_list('role', flat=True)),
            'backfill did not mirror the resource-level grant into a trigger',
        )

        doc = _make_user('backfill_doc_blocks', 'document_team')
        self.assertTrue(can_edit_sheet_field(doc, 'block_sources'))


class TestWritePathParity(TestCase):
    """The write gate and the display map must give the same answer.

    Scoped to VISIBLE rows: hidden rows are expected to disagree by design
    (the write gate ignores is_visible — visibility is presentation, not
    permission), which TestHiddenRowStillWritable covers separately.

    Delegated fields have no key of their own in the edit map (it iterates
    DEFAULT_SHEET_ROWS), so the comparison pairs the real field against its
    owning row: serializer('box_count') vs edit_map('packing').
    """

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        from apps.export.models import SheetRowSetting
        from apps.export.sheet_rows import DEFAULT_SHEET_ROWS

        SheetRowSetting.objects.bulk_create(
            [
                SheetRowSetting(
                    field_key=row['field_key'],
                    row_number=row['row_number'],
                    display_order=row['row_number'] * 1024,
                )
                for row in DEFAULT_SHEET_ROWS
            ],
            batch_size=500,
        )
        from apps.export.management.commands.backfill_sheet_row_triggers import backfill
        backfill()

    def setUp(self):
        cache.clear()

    def test_the_two_bypass_lists_still_agree(self):
        """The serializer short-circuits on PRIVILEGED_ROLES; the sheet gate
        bypasses on a literal tuple. They match today. If either is edited
        without the other, the two gates split apart again — which is the exact
        data/code drift AD-17 exists to kill. Fail loudly instead."""
        from apps.core.roles import PRIVILEGED_ROLES
        self.assertEqual(
            set(PRIVILEGED_ROLES), {'admin', 'director', 'export_manager'},
            'PRIVILEGED_ROLES changed — update can_edit_sheet_field and '
            'get_sheet_edit_map bypass tuples to match, then update this test.',
        )

    def test_serializer_verdict_matches_edit_map_for_every_role_and_field(self):
        from apps.core.permissions import (
            _REVERSE_FIELD_DELEGATES,
            can_edit_sheet_fields,
            get_sheet_edit_map,
        )
        from apps.core.roles import PRIVILEGED_ROLES
        from apps.export.models import SheetRowSetting

        visible = set(
            SheetRowSetting.objects.active()
            .filter(is_visible=True)
            .values_list('field_key', flat=True)
        )
        roles = ['document_team', 'transport', 'loading_dept_head', 'sales_rep',
                 'finansist', 'weight_master', 'boss']

        for role in roles:
            if role in PRIVILEGED_ROLES:
                continue
            user = _make_user(f'parity_{role}', role)
            cache.clear()
            edit_map = get_sheet_edit_map(user)

            probe = sorted(visible | set(_REVERSE_FIELD_DELEGATES))
            verdicts = can_edit_sheet_fields(user, probe)

            for field in probe:
                owning_row = _REVERSE_FIELD_DELEGATES.get(field, field)
                if owning_row not in visible:
                    continue
                self.assertEqual(
                    verdicts[field], edit_map[owning_row],
                    f'{role}: write gate and display map disagree on '
                    f'{field} (row {owning_row})',
                )

    def test_multi_field_patch_loads_settings_once(self):
        """A five-field PATCH must not cost five settings queries.

        The 4 queries (all fields here carry trigger config after backfill,
        so none takes the no-config can_edit_field fallback added for
        reverse delegates):
          1. SheetRowSetting.objects.active().select_related('triggered_user')
             -- the main settings load, loaded once by can_edit_sheet_fields
             itself and handed to get_sheet_edit_map via settings_by_key.
          2. role_triggers prefetch (SELECT ... WHERE row_id IN (...)).
          3. user_permissions prefetch (SELECT ... WHERE row_id IN (...)).
          4. get_all_field_permissions(role) inside get_sheet_edit_map --
             one query (or a cache hit on a warm cache).
        Proven non-scaling below with a 2-field list against the same count.
        """
        from apps.core.permissions import can_edit_sheet_fields

        user = _make_user('qcount_probe', 'document_team')
        cache.clear()
        fields = ['country', 'import_firm', 'customer', 'city', 'documents_status']
        with self.assertNumQueries(4):
            can_edit_sheet_fields(user, fields)

        cache.clear()
        with self.assertNumQueries(4):
            can_edit_sheet_fields(user, ['country', 'import_firm'])


class TestHiddenRowStillWritable(TestCase):
    """Decision A: is_visible is presentation, not permission.

    Hiding a Sheet row removes the column; it must not revoke edit rights on the
    detail page or the edit drawer.
    """

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.row = SheetRowSetting.objects.create(
            field_key='country', row_number=11, display_order=11 * 1024,
            is_visible=False,
        )

    def setUp(self):
        cache.clear()

    def test_hidden_row_is_not_editable_on_the_sheet_but_is_writable(self):
        from apps.core.permissions import can_edit_sheet_fields, get_sheet_edit_map
        from apps.export.models import SheetRowRoleTrigger

        SheetRowRoleTrigger.objects.create(row=self.row, role='document_team')
        cache.clear()
        user = _make_user('hidden_probe', 'document_team')

        self.assertFalse(get_sheet_edit_map(user)['country'])
        self.assertTrue(can_edit_sheet_fields(user, ['country'])['country'])


class TestBatchGateFallsBackWithNoSetting(TestCase):
    """Batch-gate analogue of tests_sheet_perms.TestNoSettingFallsBackToFieldPerm,
    for a reverse-delegated field.

    `weight_gross` and `box_count` delegate to the `packing` Sheet row (see
    _REVERSE_FIELD_DELEGATES). `packing` is a composite Sheet key: no role
    ever holds a literal RoleFieldPermission named 'packing', so asking the
    owning row to answer for these fields fails closed whenever that row
    carries no trigger config -- exactly the regression this class exists to
    catch (warehouse_chief's PATCH of weight_gross came back 403 in
    AuditRowCountTests.test_patch_writes_one_audit_row_per_changed_field
    before this fix).

    Deliberately does NOT provision DEFAULT_SHEET_ROWS or run backfill()
    the way TestWritePathParity / TestHiddenRowStillWritable do -- those
    only ever exercise the fully-configured state and cannot catch this.
    """

    def setUp(self):
        cache.clear()
        # Defensive, mirrors tests_sheet_perms.TestNoSettingFallsBackToFieldPerm:
        # TestCase already rolls back per test, but guard against --keepdb
        # leakage from an earlier interrupted run.
        SheetRowSetting.objects.filter(field_key='packing').delete()
        call_command('seed_permissions')
        self.user = _make_user('nosettings_wh', 'warehouse_chief')
        cache.clear()

    def test_no_packing_row_at_all_falls_back_to_field_perm(self):
        from apps.core.permissions import can_edit_sheet_fields

        self.assertEqual(SheetRowSetting.objects.filter(field_key='packing').count(), 0)
        result = can_edit_sheet_fields(self.user, ['weight_gross', 'box_count'])
        self.assertTrue(
            result['weight_gross'],
            'weight_gross must fall back to RoleFieldPermission with no packing row',
        )
        self.assertTrue(
            result['box_count'],
            'box_count must fall back to RoleFieldPermission with no packing row',
        )

    def test_packing_row_with_zero_trigger_config_still_falls_back(self):
        """A packing row EXISTS but nobody has configured a trigger on it yet
        -- the fallback must still ask about the real submitted field
        (weight_gross), not the literal 'packing' key, which no role ever
        holds in RoleFieldPermission."""
        from apps.core.permissions import can_edit_sheet_fields

        SheetRowSetting.objects.create(
            field_key='packing', row_number=48, display_order=48 * 1024,
        )
        cache.clear()

        result = can_edit_sheet_fields(self.user, ['weight_gross'])
        self.assertTrue(result['weight_gross'])

    def test_configured_packing_row_still_denies_a_role_it_excludes(self):
        """The third state must NOT be weakened by the fallback above: once
        the packing row carries ANY trigger config, that config IS the
        authority, even for a role (warehouse_chief) that separately holds
        the plain weight_gross RoleFieldPermission grant. Proves the fix
        isn't the tempting one-liner
        `edit_map[owning_row] or can_edit_field(role, name)`, which would
        resurrect access a configured row deliberately excludes."""
        from apps.core.permissions import can_edit_sheet_fields
        from apps.export.models import SheetRowRoleTrigger

        row = SheetRowSetting.objects.create(
            field_key='packing', row_number=48, display_order=48 * 1024,
        )
        SheetRowRoleTrigger.objects.create(row=row, role='transport')
        cache.clear()

        result = can_edit_sheet_fields(self.user, ['weight_gross'])
        self.assertFalse(result['weight_gross'])

    def test_locked_zero_config_packing_row_denies_both_gates(self):
        """A LOCKED packing row with zero trigger config is a deliberate
        admin 'nobody' -- an explicit lock with nobody named, not an
        unconfigured row waiting to be set up. The singular gate
        (can_edit_sheet_field) already denies here (its Rule 6); the batch
        write gate must agree, or the same row gives two different answers
        depending on which write path asked. warehouse_chief holds the real
        weight_gross RoleFieldPermission grant, so a bare can_edit_field
        fallback would wrongly grant it -- this pins that both gates say No.
        """
        from apps.core.permissions import can_edit_sheet_field, can_edit_sheet_fields

        row = SheetRowSetting.objects.create(
            field_key='packing', row_number=48, display_order=48 * 1024,
            is_locked=True,
        )
        cache.clear()

        result = can_edit_sheet_fields(self.user, ['weight_gross'])
        self.assertFalse(result['weight_gross'], 'batch gate must deny a locked, zero-config row')
        self.assertFalse(
            can_edit_sheet_field(self.user, 'packing'),
            'singular gate must deny a locked, zero-config row',
        )


class TestPatchEndpointHonoursTheBatchGate(TestCase):
    """Drives the real PATCH endpoint so a regression in
    ShipmentPatchSerializer.validate, or in can_edit_sheet_fields's
    reverse-delegate fallback, fails this suite end-to-end.

    TestWritePathParity's parity test cannot catch this class of bug: it
    compares can_edit_sheet_fields against get_sheet_edit_map directly, and
    for owned fields the former IS `edit_map.get(owning_row, False)` read
    from that same function when the row has config -- it never constructs
    the serializer and never touches the no-config fallback. No
    SheetRowSetting rows exist here at all: the state most fields are
    actually in until an admin visits Shipment Settings for them.
    """

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.status, _ = ShipmentStatusType.objects.get_or_create(
            code='yuklenme',
            defaults={
                'name_tk': 'Ýüklenme', 'name_en': 'Loading',
                'step_order': 1, 'phase': 'LOADING',
            },
        )
        cls.season, _ = Season.objects.get_or_create(
            name='2025-2026',
            defaults={
                'start_date': '2025-09-01', 'end_date': '2026-06-30',
                'is_active': True,
            },
        )
        cls.user = _make_user('endpoint_wh', 'warehouse_chief')

    def setUp(self):
        cache.clear()
        SheetRowSetting.objects.filter(field_key='packing').delete()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.shipment = Shipment.objects.create(
            shipment_code=f'AU{self.id()[-4:]}003/26',
            date=date(2026, 2, 1),
            season=self.season,
            status=self.status,
            weight_net=Decimal('18400.00'),
            weight_gross=Decimal('19100.00'),
        )

    def test_warehouse_chief_can_patch_weight_gross_with_no_packing_row(self):
        self.assertEqual(
            SheetRowSetting.objects.filter(field_key='packing').count(), 0,
            'precondition: no packing row should exist',
        )
        response = self.client.patch(
            f'/api/v1/export/shipments/{self.shipment.id}/',
            {'weight_gross': '19200.00'},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)

    def test_patch_is_denied_when_the_packing_row_excludes_the_role(self):
        """Pins that ShipmentPatchSerializer routes through the BATCH gate.

        warehouse_chief holds the literal shipment.weight_gross grant, so the
        old can_edit_field path would allow this PATCH. Only the batch gate --
        which resolves weight_gross to the `packing` row, finds trigger config
        that omits warehouse_chief, and denies -- produces a 403 here. Revert
        validate() to can_edit_field and this test returns 200 and fails.
        """
        from apps.export.models import SheetRowRoleTrigger

        packing_row = SheetRowSetting.objects.create(
            field_key='packing', row_number=48, display_order=48 * 1024,
        )
        SheetRowRoleTrigger.objects.create(row=packing_row, role='transport')
        cache.clear()

        response = self.client.patch(
            f'/api/v1/export/shipments/{self.shipment.id}/',
            {'weight_gross': '19200.00'},
            format='json',
        )
        self.assertEqual(response.status_code, 403, response.data)


class TestPackingEndpointFollowsTheSheetRow(TestCase):
    """Decision C: packing goes in whole, not half.

    box_count reaches the DB two ways — PATCH /shipments/{id}/ and
    POST /contracts/shipment-packing/. If only the first follows the packing
    row, ticking `packing` for a role still 403s from ShipmentPackingPanel.
    """

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.row = SheetRowSetting.objects.create(
            field_key='packing', row_number=48, display_order=48 * 1024,
        )

    def setUp(self):
        cache.clear()

    def test_role_without_the_packing_trigger_is_refused(self):
        from apps.export.models import SheetRowRoleTrigger

        SheetRowRoleTrigger.objects.create(row=self.row, role='transport')
        cache.clear()
        doc = _make_user('packing_doc', 'document_team')

        client = APIClient()
        client.force_authenticate(user=doc)
        response = client.post(
            '/api/v1/contracts/shipment-packing/',
            {'shipment': 1, 'scope': 'template', 'packing_template': 1},
            format='json',
        )
        self.assertEqual(response.status_code, 403)

    def test_role_with_the_packing_trigger_passes_the_permission_layer(self):
        """The positive half of the test above -- a gate hardcoded to
        `return False` would still pass the negative test but never this one.

        Asserts the permission outcome only (not 200): shipment id=1 does not
        exist in this test's DB, so a 404 from the view body is the expected,
        correct result once the permission layer lets the request through --
        the same shape the RED-evidence run in the Task 6 report used to
        prove the OLD gate was letting requests through.
        """
        from apps.export.models import SheetRowRoleTrigger

        SheetRowRoleTrigger.objects.create(row=self.row, role='transport')
        cache.clear()
        transport = _make_user('packing_transport', 'transport')

        client = APIClient()
        client.force_authenticate(user=transport)
        response = client.post(
            '/api/v1/contracts/shipment-packing/',
            {'shipment': 1, 'scope': 'template', 'packing_template': 1},
            format='json',
        )
        self.assertNotEqual(response.status_code, 403, response.data)


class TestPackingTemplateAndSwapRequireFirmSplitsAccess(TestCase):
    """Whole-branch review Finding 1 (CRITICAL, 2026-09-02): `packing` alone
    is a back door into firm composition and quota.

    scope='template' and scope='swap' both call _set_firm_weights, which
    deletes/rebuilds shipment.firm_splits and re-syncs draft quota usage —
    that is firm-split authority, not packing. scope='firm' only updates one
    ContractSale row and stays packing-only. Before this fix, a role ticked
    for `packing` but never for `firm_splits` (warehouse_chief,
    loading_dept_head, loading_dept_head_deputy all hold box_count /
    pallet_count / weight_gross / packaging_kg / pallet_weight_kg, reverse-
    delegated to `packing` — none holds shipment_firm_split at any level)
    could rewrite firm splits and quota through this panel even though
    POST /shipments/{id}/firm-splits/ correctly 403s the same role for the
    same object. ShipmentPackingView.post() now additionally requires the
    `firm_splits` Sheet row for scope in ('template', 'swap').
    """

    @classmethod
    def setUpTestData(cls):
        from apps.core.models import ExportFirm
        from apps.export.models import SheetRowRoleTrigger

        call_command('seed_permissions')
        cls.packing_row = SheetRowSetting.objects.create(
            field_key='packing', row_number=48, display_order=48 * 1024,
        )
        cls.firm_splits_row = SheetRowSetting.objects.create(
            field_key='firm_splits', row_number=9, display_order=9 * 1024,
        )
        # Both roles below need `packing` to clear get_permissions(); only
        # document_team also gets `firm_splits` — that is the split under test.
        SheetRowRoleTrigger.objects.create(row=cls.packing_row, role='warehouse_chief')
        SheetRowRoleTrigger.objects.create(row=cls.packing_row, role='document_team')
        SheetRowRoleTrigger.objects.create(row=cls.firm_splits_row, role='document_team')

        cls.season, _ = Season.objects.get_or_create(
            name='2025-2026',
            defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True},
        )
        cls.status_loading, _ = ShipmentStatusType.objects.get_or_create(
            code='yuklenme',
            defaults={'name_tk': 'yuklenme', 'name_en': 'Loading', 'step_order': 1, 'phase': 'LOADING'},
        )
        cls.firm_a, _ = ExportFirm.objects.get_or_create(
            code='PKA', defaults={'name_tk': 'PKA', 'name_en': 'PKA'},
        )
        cls.firm_b, _ = ExportFirm.objects.get_or_create(
            code='PKB', defaults={'name_tk': 'PKB', 'name_en': 'PKB'},
        )

    def setUp(self):
        cache.clear()
        from apps.export.models import PackingTemplate, PackingTemplateShare, ShipmentFirmSplit

        self.shipment = Shipment.objects.create(
            shipment_code=f'PKS{id(self) % 100000}', date='2026-02-01',
            season=self.season, status=self.status_loading,
        )
        ShipmentFirmSplit.objects.create(
            shipment=self.shipment, export_firm=self.firm_a, weight_kg=9000, split_order=1,
        )
        ShipmentFirmSplit.objects.create(
            shipment=self.shipment, export_firm=self.firm_b, weight_kg=9000, split_order=2,
        )
        self.template = PackingTemplate.objects.create(name=f'T{id(self)}', net_kg=18000)
        PackingTemplateShare.objects.create(template=self.template, share_order=1, net_kg=9000)
        PackingTemplateShare.objects.create(template=self.template, share_order=2, net_kg=9000)

    def _post(self, user, payload):
        client = APIClient()
        client.force_authenticate(user=user)
        return client.post('/api/v1/contracts/shipment-packing/', payload, format='json')

    def test_packing_without_firm_splits_is_refused_on_template(self):
        wc = _make_user('pks_wc_tpl', 'warehouse_chief')
        resp = self._post(wc, {
            'shipment': self.shipment.id, 'scope': 'template', 'packing_template': self.template.id,
        })
        self.assertEqual(resp.status_code, 403, resp.data)

    def test_packing_without_firm_splits_is_refused_on_swap(self):
        wc = _make_user('pks_wc_swap', 'warehouse_chief')
        resp = self._post(wc, {
            'shipment': self.shipment.id, 'scope': 'swap',
            'export_firm_a': self.firm_a.id, 'export_firm_b': self.firm_b.id,
        })
        self.assertEqual(resp.status_code, 403, resp.data)

    def test_packing_without_firm_splits_still_allowed_on_firm_scope(self):
        """Same user, same-shaped request, only `scope` differs from the two
        tests above: proves get_permissions() actually admitted warehouse_chief
        (via the `packing` trigger) — the 403s above come from the new
        firm_splits guard on template/swap, not from the permission class
        refusing this role outright."""
        wc = _make_user('pks_wc_firm', 'warehouse_chief')
        resp = self._post(wc, {
            'shipment': self.shipment.id, 'scope': 'firm',
            'export_firm': self.firm_a.id, 'gross_kg': 9500,
        })
        # No ContractSale linked for firm_a yet, so the view 400s inside the
        # business logic ("link a contract first") — the point here is that
        # it is NOT 403, unlike template/swap for the same role above.
        self.assertNotEqual(resp.status_code, 403, resp.data)

    def test_packing_and_firm_splits_together_allowed_on_template(self):
        doc = _make_user('pks_doc_tpl', 'document_team')
        resp = self._post(doc, {
            'shipment': self.shipment.id, 'scope': 'template', 'packing_template': self.template.id,
        })
        self.assertEqual(resp.status_code, 200, resp.data)

    def test_packing_and_firm_splits_together_allowed_on_swap(self):
        doc = _make_user('pks_doc_swap', 'document_team')
        resp = self._post(doc, {
            'shipment': self.shipment.id, 'scope': 'swap',
            'export_firm_a': self.firm_a.id, 'export_firm_b': self.firm_b.id,
        })
        self.assertEqual(resp.status_code, 200, resp.data)


class TestJunctionFallbackDelegatesToItsOwnResource(TestCase):
    """Task 6 Fix 2: the no-config fallback in can_edit_sheet_fields must
    resolve firm_splits/block_sources to their OWN resource_code, not
    'shipment' -- mirroring _can_edit_sheet_row_field, which get_sheet_edit_map
    and can_edit_sheet_field (singular) already use for this exact purpose.

    warehouse_chief holds `'shipment_block_source': ['*']` (seed_permissions,
    "R8: same junction grant as loading_dept_head") but has no literal
    'block_sources' string in its 'shipment' field list. With no
    SheetRowSetting row for 'block_sources' -- the default state, before an
    admin ever visits Shipment Settings for this row -- routing set_block_sources
    through sheet_field_write_permission('block_sources') must still honour
    that grant. This is the business-visible half of AD-17: a role ticked
    (here, granted by default) still 403ing from a write path the Sheet
    itself would allow.
    """

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.status, _ = ShipmentStatusType.objects.get_or_create(
            code='yuklenme',
            defaults={
                'name_tk': 'Ýüklenme', 'name_en': 'Loading',
                'step_order': 1, 'phase': 'LOADING',
            },
        )
        cls.season, _ = Season.objects.get_or_create(
            name='2025-2026',
            defaults={
                'start_date': '2025-09-01', 'end_date': '2026-06-30',
                'is_active': True,
            },
        )
        cls.block = GreenhouseBlock.objects.create(code='JF', name='JF')
        cls.wh = _make_user('junction_wh', 'warehouse_chief')

    def setUp(self):
        cache.clear()
        SheetRowSetting.objects.filter(field_key='block_sources').delete()
        self.shipment = Shipment.objects.create(
            shipment_code=f'AU{self.id()[-4:]}004/26',
            date=date(2026, 2, 1),
            season=self.season,
            status=self.status,
        )

    def test_warehouse_chief_can_post_block_sources_with_no_sheet_row(self):
        self.assertEqual(
            SheetRowSetting.objects.filter(field_key='block_sources').count(), 0,
            'precondition: no block_sources row should exist',
        )
        client = APIClient()
        client.force_authenticate(user=self.wh)
        response = client.post(
            f'/api/v1/export/shipments/{self.shipment.id}/block-sources/',
            {'blocks': [{'block_id': self.block.id, 'weight_kg': '9000'}]},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)

    def test_role_with_a_configured_block_sources_trigger_passes_the_permission_layer(self):
        """Coverage for the OTHER state a production DB is actually in: an
        admin HAS visited Shipment Settings for this row (unlike the no-row
        state the sibling test above covers). The prior version of this test
        deleted the row in setUp, so the configured-row branch of
        can_edit_sheet_fields (the `else`: edit_map.get(...) or
        _trigger_matches(...)) had no coverage under this permission class at
        all -- only the no-config fallback did.
        """
        from apps.export.models import SheetRowRoleTrigger

        row = SheetRowSetting.objects.create(
            field_key='block_sources', row_number=91, display_order=91 * 1024,
        )
        SheetRowRoleTrigger.objects.create(row=row, role='transport')
        cache.clear()
        transport = _make_user('block_sources_transport', 'transport')

        client = APIClient()
        client.force_authenticate(user=transport)
        response = client.post(
            f'/api/v1/export/shipments/{self.shipment.id}/block-sources/',
            {'blocks': [{'block_id': self.block.id, 'weight_kg': '9000'}]},
            format='json',
        )
        self.assertNotEqual(response.status_code, 403, response.data)


class TestSheetFieldWritePermissionSuperuserBypass(TestCase):
    """Task 6 Fix 1: sheet_field_write_permission must bypass for
    is_superuser, mirroring resource_edit_permission / write_permission --
    can_edit_field (which the no-config fallback reduces to) is a pure
    role-string lookup with no superuser semantics of its own.

    'seller' holds no grant on 'shipment_block_source' or 'shipment' at all
    (seed_permissions), so this only passes if the bypass fires before
    can_edit_sheet_fields is asked anything.
    """

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.status, _ = ShipmentStatusType.objects.get_or_create(
            code='yuklenme',
            defaults={
                'name_tk': 'Ýüklenme', 'name_en': 'Loading',
                'step_order': 1, 'phase': 'LOADING',
            },
        )
        cls.season, _ = Season.objects.get_or_create(
            name='2025-2026',
            defaults={
                'start_date': '2025-09-01', 'end_date': '2026-06-30',
                'is_active': True,
            },
        )
        cls.block = GreenhouseBlock.objects.create(code='SU', name='SU')
        cls.superuser = User.objects.create_superuser(
            username='junction_super', password='pass', role='seller',
        )

    def setUp(self):
        cache.clear()
        SheetRowSetting.objects.filter(field_key='block_sources').delete()
        self.shipment = Shipment.objects.create(
            shipment_code=f'AU{self.id()[-4:]}005/26',
            date=date(2026, 2, 1),
            season=self.season,
            status=self.status,
        )

    def test_superuser_bypasses_the_junction_gate_with_no_sheet_row(self):
        client = APIClient()
        client.force_authenticate(user=self.superuser)
        response = client.post(
            f'/api/v1/export/shipments/{self.shipment.id}/block-sources/',
            {'blocks': [{'block_id': self.block.id, 'weight_kg': '9000'}]},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)


class TestRoleAccessBulkEndpoint(TestCase):
    """One request sets a role's access across every Sheet row."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.mgr = _make_user('roleaccess_mgr', 'export_manager')
        cls.doc = _make_user('roleaccess_doc', 'document_team')
        # warehouse_chief holds shipment.can_create=True (seed_permissions'
        # _VCE) but no sheet_row_setting grant at all -- the discriminating
        # actor for test_shipment_create_role_without_sheet_row_setting_is_refused
        # below. document_team has neither can_create on 'shipment' (_VE) nor
        # sheet_row_setting, so a regression reverting the gate's resource_code
        # back to 'shipment' would NOT be caught by a document_team actor.
        cls.wh_chief = _make_user('roleaccess_wh', 'warehouse_chief')
        for key, number in (('country', 11), ('import_firm', 14), ('city', 13)):
            SheetRowSetting.objects.create(
                field_key=key, row_number=number, display_order=number * 1024,
            )

    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def _post(self, user, payload):
        self.client.force_authenticate(user=user)
        return self.client.post(
            '/api/v1/export/admin/sheet-rows/role-access/', payload, format='json',
        )

    def test_replaces_the_roles_triggers_across_all_rows(self):
        from apps.export.models import SheetRowRoleTrigger

        response = self._post(self.mgr, {
            'role': 'document_team',
            'field_keys': ['country', 'import_firm'],
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            set(
                SheetRowRoleTrigger.objects
                .filter(role='document_team')
                .values_list('row__field_key', flat=True)
            ),
            {'country', 'import_firm'},
        )

        # A second call with a different set REPLACES, never merges.
        self._post(self.mgr, {'role': 'document_team', 'field_keys': ['city']})
        self.assertEqual(
            set(
                SheetRowRoleTrigger.objects
                .filter(role='document_team')
                .values_list('row__field_key', flat=True)
            ),
            {'city'},
        )

    def test_non_admin_role_is_refused(self):
        response = self._post(self.doc, {'role': 'document_team', 'field_keys': []})
        self.assertEqual(response.status_code, 403)

    def test_unknown_field_key_is_rejected(self):
        response = self._post(self.mgr, {
            'role': 'document_team', 'field_keys': ['not_a_row'],
        })
        self.assertEqual(response.status_code, 400)

    def test_unknown_role_is_rejected(self):
        response = self._post(self.mgr, {
            'role': 'not_a_real_role', 'field_keys': [],
        })
        self.assertEqual(response.status_code, 400)

    def test_shipment_create_role_without_sheet_row_setting_is_refused(self):
        """warehouse_chief holds shipment.can_create=True but no grant at all
        on sheet_row_setting. Unlike document_team (used by the sibling test
        above), this actor DOES discriminate: if a regression reverted the
        ViewSet's resource_code from 'sheet_row_setting' back to its pre-Task-1
        value of 'shipment', this call would flip from 403 to 200 because
        POST maps to can_create and warehouse_chief holds it on 'shipment'.
        """
        response = self._post(self.wh_chief, {'role': 'document_team', 'field_keys': []})
        self.assertEqual(response.status_code, 403)

    def test_empty_field_keys_clears_all_of_the_roles_triggers(self):
        """field_keys=[] is the most destructive call this endpoint accepts --
        it must remove every trigger the role holds, and log each removal.
        """
        from apps.export.models import AuditLog, SheetRowRoleTrigger

        country_row = SheetRowSetting.objects.get(field_key='country')
        import_firm_row = SheetRowSetting.objects.get(field_key='import_firm')
        SheetRowRoleTrigger.objects.create(row=country_row, role='transport')
        SheetRowRoleTrigger.objects.create(row=import_firm_row, role='transport')

        response = self._post(self.mgr, {'role': 'transport', 'field_keys': []})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, {'role': 'transport', 'added': 0, 'removed': 2})
        self.assertFalse(
            SheetRowRoleTrigger.objects.filter(role='transport').exists()
        )

        removal_logs = AuditLog.objects.filter(
            model_name='SheetRowSetting', field_name='triggered_roles',
            object_id__in=[country_row.id, import_firm_row.id],
        )
        self.assertEqual(removal_logs.count(), 2)
        for log in removal_logs:
            self.assertEqual(log.old_value, 'transport')
            self.assertEqual(log.new_value, '')

    def test_audit_rows_record_the_full_role_set_not_a_single_role_delta(self):
        """The bug fix 1 (coordinator review) closes: adding document_team to
        a row that already has transport must log old='transport',
        new='document_team,transport' -- the row's full role set before and
        after -- not old='', new='document_team'. A reader filtering
        field_name='triggered_roles' for one row must not be able to tell
        whether a given row was written by this endpoint or by the per-row
        PATCH path (_perform_update_with_audit), which always logs full sets.
        """
        from apps.export.models import AuditLog, SheetRowRoleTrigger

        country_row = SheetRowSetting.objects.get(field_key='country')
        SheetRowRoleTrigger.objects.create(row=country_row, role='transport')

        response = self._post(self.mgr, {
            'role': 'document_team', 'field_keys': ['country'],
        })
        self.assertEqual(response.status_code, 200)

        log = AuditLog.objects.get(
            model_name='SheetRowSetting', object_id=country_row.id,
            field_name='triggered_roles',
        )
        self.assertEqual(log.old_value, 'transport')
        self.assertEqual(log.new_value, 'document_team,transport')
        self.assertEqual(log.object_repr, str(country_row))
