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

    Snapshots the pre-migration verdict for every (role, sheet field) pair using
    the OLD authority (RoleFieldPermission), runs the backfill, then asserts the
    NEW authority (the sheet gate) says yes wherever the old one did.
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

    def test_every_owning_role_can_still_edit_its_row_with_settings_present(self):
        """The settings-present twin of TestEveryRoleCanEditItsOwnSheetRow.

        That sweep deletes every SheetRowSetting in its own setUp, so it only
        ever exercises the `setting is None` fallback. Once this backfill seeds
        triggers on every row, `has_any_config` is True everywhere in
        production and that fallback becomes dead code — the old sweep would
        keep passing while measuring a path production no longer takes. This
        one provisions every row, runs the backfill, and then asserts the same
        property the old sweep asserts, against the branch that now runs.
        """
        from apps.core.permissions import can_edit_sheet_field
        from apps.export.management.commands.backfill_sheet_row_defaults import WHO_TO_ROLE
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

        failures = []
        for row in DEFAULT_SHEET_ROWS:
            # Mirrors the readonly skip in TestEveryRoleCanEditItsOwnSheetRow
            # (tests_sheet_perms.py): readonly rows (e.g. shipment_code,
            # has_doc_advance) show a "Who" label for information only — no
            # RoleFieldPermission grant has ever existed for them, under
            # either authority, so they are not part of the "still editable"
            # property this sweep checks. `packing` is the one readonly row
            # that IS write-gated (via the reverse-delegate columns written
            # through its popover panel); it has its own dedicated test below.
            if row['input_type'] == 'readonly':
                continue
            who_key = row.get('default_who_key')
            if not who_key:
                continue
            owner = who_key.rsplit('.', 1)[-1]
            for role in WHO_TO_ROLE.get(owner, []):
                cache.clear()
                # row_number alone is not unique (e.g. R47 has both
                # firm_contracts and is_gapy_satys) — key on field_key too so
                # two rows sharing a row_number don't collide on username.
                user = _make_user(f'sweep_{role}_{row["row_number"]}_{row["field_key"]}', role)
                if not can_edit_sheet_field(user, row['field_key']):
                    failures.append(f"{role} lost {row['field_key']} (R{row['row_number']})")

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
        """`packing` (R48) is the reverse-delegate row the four packing
        columns (box_count, pallet_count, weight_gross, packaging_kg, ...)
        write through their popover panel. It carries no field grant of its
        own — RoleFieldPermission never lists 'packing' as a field name — and
        its readonly input_type excludes it from the general ownership sweep
        above, so this is its only coverage. document_team holds box_count /
        pallet_count / weight_gross directly (seed_permissions.py
        FIELD_DEFAULTS); without the reverse-delegate clause in backfill()
        those grants never reach the 'packing' row's triggers and
        document_team loses the popover the moment the sheet gate goes live.
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
