"""Sheet Settings is the permission authority for Sheet-owned fields.

Covers the endpoint lock-down (Task 1), the trigger-only gate (Task 3), the
reverse delegates (Task 2/5) and the write-path parity invariant (Task 5).
"""
import os
from importlib import import_module
from unittest import mock

from django.apps import apps as django_apps
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import RolePagePermission, RoleResourcePermission
from apps.export.models import SheetRowSetting

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

        Uses director, not document_team: for document_team, `packing`
        resolves to False on both the correct path (edit_map['packing']) and
        the broken path (edit_map.get('box_count', False), a missing key that
        defaults to False) -- no SheetRowSetting row exists for `packing` in a
        fresh DB and 'packing' is never itself a granted RoleFieldPermission
        field name, so the two coincidentally agree regardless of whether the
        reverse-map lookup runs. Verified this empirically before writing the
        test (see fix report). Director's Rule-1 bypass makes every
        DEFAULT_SHEET_ROWS field_key, including `packing`, resolve True, while
        `box_count` -- not itself a field_key -- still defaults to False if the
        `_REVERSE_FIELD_DELEGATES` lookup is skipped. Only the correct
        resolution (box_count -> packing -> True) makes this pass.
        """
        from apps.core.permissions import can_edit_sheet_fields, get_sheet_edit_map

        call_command('seed_permissions')
        cache.clear()
        user = _make_user('delegate_probe', 'director')

        self.assertEqual(
            can_edit_sheet_fields(user, ['box_count'])['box_count'],
            get_sheet_edit_map(user)['packing'],
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

    That snapshot is structurally blind to `packing`: nobody has ever held a
    RoleFieldPermission literally named 'packing', so its OLD verdict is
    always False and the property holds trivially there regardless of
    whether the reverse-delegate union is correct. The other methods below
    pin the properties the snapshot can't reach: the wildcard-expansion
    property (every row, not just the ones a role's real fields resolve to)
    and `packing` specifically (real access the backfill *creates*, not
    access it merely preserves).
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
        and its OLD verdict is always False (see the class docstring), so
        neither the general sweep above nor RoleFieldPermission itself can
        vouch for it; this is its only integration-level coverage.

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
        """A five-field PATCH must not cost five settings queries."""
        from apps.core.permissions import can_edit_sheet_fields

        user = _make_user('qcount_probe', 'document_team')
        cache.clear()
        fields = ['country', 'import_firm', 'customer', 'city', 'documents_status']
        with self.assertNumQueries(4):
            can_edit_sheet_fields(user, fields)


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
