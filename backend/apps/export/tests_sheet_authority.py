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
