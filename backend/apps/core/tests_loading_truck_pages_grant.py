"""Migration 0071: loading department gets Truck Board + Transport Plan; Tır Takip reopens."""
import importlib

from django.test import TestCase

from apps.core.models import RolePagePermission, RoleResourcePermission

migration = importlib.import_module('apps.core.migrations.0071_loading_dept_truck_pages_and_tir_takip')


class LoadingTruckPagesGrantTests(TestCase):
    def test_flips_hidden_loading_pages_and_adds_view_grant(self):
        for page_code in migration.LOADING_PAGES:
            RolePagePermission.objects.create(role='loading_dept_head', page_code=page_code, is_visible=False)

        migration.grant_pages(RolePagePermission, RoleResourcePermission)

        for role in migration.LOADING_ROLES:
            for page_code in migration.LOADING_PAGES:
                self.assertTrue(RolePagePermission.objects.get(role=role, page_code=page_code).is_visible)
            grant = RoleResourcePermission.objects.get(role=role, resource_code='truck_allocation')
            self.assertEqual((grant.can_view, grant.can_edit), (True, False))

    def test_reopens_tir_takip_for_every_role_but_garawul(self):
        RolePagePermission.objects.create(role='sales_rep', page_code='tir_takip.gaplama', is_visible=False)
        RolePagePermission.objects.create(role='garawul', page_code='tir_takip', is_visible=False)

        migration.grant_pages(RolePagePermission, RoleResourcePermission)

        self.assertTrue(RolePagePermission.objects.get(role='sales_rep', page_code='tir_takip.gaplama').is_visible)
        self.assertEqual(
            RolePagePermission.objects.filter(page_code='tir_takip', is_visible=True).count(),
            len(migration.TIR_TAKIP_ROLES),
        )
        self.assertFalse(RolePagePermission.objects.get(role='garawul', page_code='tir_takip').is_visible)

    def test_seed_defaults_match_for_head_and_deputy(self):
        from apps.core.management.commands.seed_permissions import PAGE_DEFAULTS, RESOURCE_DEFAULTS

        for role in migration.LOADING_ROLES:
            self.assertTrue(set(migration.LOADING_PAGES) <= PAGE_DEFAULTS[role])
            self.assertEqual(RESOURCE_DEFAULTS[role]['truck_allocation'], (True, False, False, False))
