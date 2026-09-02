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
        # box_count is deliberately absent: the batch helper resolves it to the
        # `packing` row, and `packing` is not a grantable RoleFieldPermission
        # field name, so get_sheet_edit_map's surviving `AND _has_field_perm`
        # pins it to False until Task 3 removes that AND. Parity for reverse
        # delegates is asserted there, not here.
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
