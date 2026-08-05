"""Boss role permission defaults (2026-08-05 boss-process-visibility).

The boss must see every registered page and hold full CRUD on every resource
so he can follow and act on the whole process from his own login. Before this
change he had 3 pages and view-only on everything.

Three carve-outs survive: `admin.permissions` (AD-15, the matrix API rejects
even GET for non-admins), `closed_season` (D1), `truck_split_default`
(Gap 7 / ADR-016) and `sale.delete` (admin-only, re-rolls Contract totals).
"""
from importlib import import_module

from django.core.management import call_command
from django.test import TestCase

from apps.core.models import (
    RoleFieldPermission,
    RolePagePermission,
    RoleResourcePermission,
)
from apps.core.permission_registry import PAGE_REGISTRY, RESOURCE_REGISTRY

_MIGRATION = import_module('apps.core.migrations.0033_boss_process_visibility_perms')

# Resources the boss is deliberately NOT given blanket CRUD on.
_NARROWED = {'closed_season', 'truck_split_default', 'sale'}


class BossPermissionDefaultsTests(TestCase):
    """The seed command's boss defaults, as applied to a fresh database."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')

    def test_boss_sees_every_registered_page_except_the_permission_matrix(self):
        visible = set(
            RolePagePermission.objects
            .filter(role='boss', is_visible=True)
            .values_list('page_code', flat=True)
        )
        self.assertEqual(visible, set(PAGE_REGISTRY.keys()) - {'admin.permissions'})

    def test_admin_permissions_page_is_hidden_from_boss(self):
        """AD-15: _AdminOnlyPermission 403s even GET, so the entry would be dead."""
        row = RolePagePermission.objects.get(role='boss', page_code='admin.permissions')
        self.assertFalse(row.is_visible)

    def test_boss_has_full_crud_on_every_unnarrowed_resource(self):
        rows = RoleResourcePermission.objects.filter(role='boss')
        self.assertEqual(rows.count(), len(RESOURCE_REGISTRY))
        for row in rows.exclude(resource_code__in=_NARROWED):
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

    def test_truck_split_default_is_read_only_for_boss(self):
        """Gap 7 / ADR-016: only the director changes the kg-per-firm constants.

        export_manager is read-only here, so the boss must not exceed him.
        """
        row = RoleResourcePermission.objects.get(role='boss', resource_code='truck_split_default')
        self.assertTrue(row.can_view)
        self.assertFalse(row.can_create)
        self.assertFalse(row.can_edit)
        self.assertFalse(row.can_delete)

    def test_boss_cannot_delete_a_sale(self):
        """Sale deletion is admin-only for director and export_manager too."""
        row = RoleResourcePermission.objects.get(role='boss', resource_code='sale')
        self.assertTrue(row.can_view)
        self.assertTrue(row.can_create)
        self.assertTrue(row.can_edit)
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


class BossPermissionMigrationTests(TestCase):
    """Migration 0033 against an EXISTING (pre-branch) permission matrix.

    The seed command uses get_or_create with `defaults`, which applies only on
    INSERT — so on a database that already holds boss rows it is a no-op and the
    widening never lands. Every assertion here starts from rows that already
    exist in the wrong state, which is exactly what the seed-based tests above
    cannot exercise (they run against a freshly created database).
    """

    def _pre_state(self):
        """Build the pre-branch boss matrix: 3 visible pages, view-only rows."""
        for page_code in PAGE_REGISTRY:
            RolePagePermission.objects.update_or_create(
                role='boss',
                page_code=page_code,
                defaults={'is_visible': page_code == 'analytics.boss'},
            )
        # admin.permissions starts VISIBLE so the test proves the migration can
        # turn a row OFF as well as on.
        RolePagePermission.objects.filter(
            role='boss', page_code='admin.permissions'
        ).update(is_visible=True)

        for resource_code in RESOURCE_REGISTRY:
            RoleResourcePermission.objects.update_or_create(
                role='boss',
                resource_code=resource_code,
                defaults={
                    'can_view': True,
                    'can_create': False,
                    'can_edit': False,
                    'can_delete': False,
                },
            )
        # truck_split_default and sale start with full CRUD so the test proves
        # the migration narrows them, not merely that it leaves them alone.
        RoleResourcePermission.objects.filter(
            role='boss', resource_code__in=['truck_split_default', 'sale']
        ).update(can_create=True, can_edit=True, can_delete=True)

    def _apply(self):
        _MIGRATION.apply_boss_permissions(
            RolePagePermission, RoleResourcePermission, RoleFieldPermission
        )

    def test_migration_flips_an_existing_view_only_page_row(self):
        self._pre_state()
        before = RolePagePermission.objects.get(role='boss', page_code='export.shipments')
        self.assertFalse(before.is_visible)

        self._apply()

        after = RolePagePermission.objects.get(role='boss', page_code='export.shipments')
        self.assertTrue(after.is_visible)

    def test_migration_hides_the_permission_matrix_page(self):
        self._pre_state()
        self._apply()
        row = RolePagePermission.objects.get(role='boss', page_code='admin.permissions')
        self.assertFalse(row.is_visible)

    def test_migration_flips_an_existing_view_only_resource_row(self):
        self._pre_state()
        before = RoleResourcePermission.objects.get(role='boss', resource_code='shipment')
        self.assertFalse(before.can_edit)

        self._apply()

        after = RoleResourcePermission.objects.get(role='boss', resource_code='shipment')
        self.assertTrue(after.can_view)
        self.assertTrue(after.can_create)
        self.assertTrue(after.can_edit)
        self.assertTrue(after.can_delete)

    def test_migration_narrows_truck_split_default_and_sale(self):
        self._pre_state()
        self._apply()

        splits = RoleResourcePermission.objects.get(role='boss', resource_code='truck_split_default')
        self.assertTrue(splits.can_view)
        self.assertFalse(splits.can_edit)
        self.assertFalse(splits.can_delete)

        sale = RoleResourcePermission.objects.get(role='boss', resource_code='sale')
        self.assertTrue(sale.can_edit)
        self.assertFalse(sale.can_delete)

    def test_migration_keeps_closed_season_read_only(self):
        self._pre_state()
        self._apply()
        row = RoleResourcePermission.objects.get(role='boss', resource_code='closed_season')
        self.assertTrue(row.can_view)
        self.assertFalse(row.can_create)
        self.assertFalse(row.can_edit)
        self.assertFalse(row.can_delete)

    def test_migration_creates_wildcard_field_rows(self):
        self._pre_state()
        self.assertFalse(RoleFieldPermission.objects.filter(role='boss').exists())

        self._apply()

        fields = set(
            RoleFieldPermission.objects
            .filter(role='boss')
            .values_list('resource_code', 'field_name')
        )
        self.assertEqual(fields, {(r, '*') for r in RESOURCE_REGISTRY})

    def test_migration_is_idempotent(self):
        self._pre_state()
        self._apply()
        self._apply()
        self.assertEqual(
            RoleFieldPermission.objects.filter(role='boss').count(),
            len(RESOURCE_REGISTRY),
        )
        self.assertEqual(
            RolePagePermission.objects.filter(role='boss', is_visible=True).count(),
            len(PAGE_REGISTRY) - 1,
        )

    def test_migration_leaves_other_roles_alone(self):
        self._pre_state()
        RolePagePermission.objects.create(
            role='sales_rep', page_code='admin.users', is_visible=False
        )
        RoleResourcePermission.objects.create(
            role='sales_rep', resource_code='shipment',
            can_view=True, can_create=False, can_edit=True, can_delete=False,
        )

        self._apply()

        self.assertFalse(
            RolePagePermission.objects.get(role='sales_rep', page_code='admin.users').is_visible
        )
        rep = RoleResourcePermission.objects.get(role='sales_rep', resource_code='shipment')
        self.assertFalse(rep.can_create)
        self.assertFalse(rep.can_delete)

    def test_reverse_restores_the_pre_widening_state(self):
        self._pre_state()
        self._apply()

        _MIGRATION.revert_boss_permissions(
            RolePagePermission, RoleResourcePermission, RoleFieldPermission
        )

        visible = set(
            RolePagePermission.objects
            .filter(role='boss', is_visible=True)
            .values_list('page_code', flat=True)
        )
        self.assertEqual(visible, set(_MIGRATION.PREVIOUS_PAGES))
        self.assertFalse(
            RoleResourcePermission.objects.filter(role='boss', can_edit=True).exists()
        )
        self.assertFalse(RoleFieldPermission.objects.filter(role='boss').exists())
