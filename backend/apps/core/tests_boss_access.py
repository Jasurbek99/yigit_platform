"""Boss role permission defaults (2026-08-05 boss-process-visibility).

The boss must see every registered page and hold full CRUD on every resource
so he can follow and act on the whole process from his own login. Before this
change he had 3 pages and view-only on everything.
"""
from django.core.management import call_command
from django.test import TestCase

from apps.core.models import (
    RoleFieldPermission,
    RolePagePermission,
    RoleResourcePermission,
)
from apps.core.permission_registry import PAGE_REGISTRY, RESOURCE_REGISTRY


class BossPermissionDefaultsTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')

    def test_boss_sees_every_registered_page(self):
        visible = set(
            RolePagePermission.objects
            .filter(role='boss', is_visible=True)
            .values_list('page_code', flat=True)
        )
        self.assertEqual(visible, set(PAGE_REGISTRY.keys()))

    def test_boss_has_full_crud_on_every_resource_except_closed_season(self):
        rows = RoleResourcePermission.objects.filter(role='boss')
        self.assertEqual(rows.count(), len(RESOURCE_REGISTRY))
        for row in rows.exclude(resource_code='closed_season'):
            with self.subTest(resource=row.resource_code):
                self.assertTrue(row.can_view)
                self.assertTrue(row.can_create)
                self.assertTrue(row.can_edit)
                self.assertTrue(row.can_delete)

    def test_closed_season_stays_read_only_for_boss(self):
        """D1: a closed season is read-only for everyone, admin included."""
        row = RoleResourcePermission.objects.get(role='boss', resource_code='closed_season')
        self.assertTrue(row.can_view)
        self.assertFalse(row.can_create)
        self.assertFalse(row.can_edit)
        self.assertFalse(row.can_delete)

    def test_boss_has_wildcard_field_access(self):
        fields = set(
            RoleFieldPermission.objects
            .filter(role='boss')
            .values_list('resource_code', 'field_name')
        )
        expected = {(r, '*') for r in RESOURCE_REGISTRY}
        self.assertEqual(fields, expected)

    def test_other_roles_are_untouched(self):
        """Regression guard: widening boss must not widen anyone else."""
        sales_pages = set(
            RolePagePermission.objects
            .filter(role='sales_rep', is_visible=True)
            .values_list('page_code', flat=True)
        )
        self.assertNotEqual(sales_pages, set(PAGE_REGISTRY.keys()))
        self.assertFalse(
            RoleResourcePermission.objects
            .filter(role='sales_rep', resource_code='season', can_delete=True)
            .exists()
        )
