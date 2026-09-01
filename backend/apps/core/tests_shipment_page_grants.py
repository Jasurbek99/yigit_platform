"""A visible Shipments page must come with `shipment.can_view` (F6).

`greenhouse_manager` held `export.shipments`, `export.shipments_sheet` and
`export.shipments_dashboard` in the live matrix while holding **no**
`RoleResourcePermission` row for `shipment` at all, so all three sidebar entries
led to 403s. Migration `core/0037` switches those rows off; this suite pins both
halves of the fix — the invariant, and the migration that restores it.

Usage:
    python manage.py test apps.core.tests_shipment_page_grants --verbosity=2
"""
import unittest
from importlib import import_module

try:
    from django.core.management import call_command
    from django.test import TestCase

    from apps.core.models import RolePagePermission, RoleResourcePermission

    DB_AVAILABLE = True
except Exception:  # pragma: no cover
    DB_AVAILABLE = False

_MIGRATION = import_module(
    'apps.core.migrations.0037_hide_dead_shipment_pages_greenhouse_manager'
)


@unittest.skipUnless(DB_AVAILABLE, "Django test DB unavailable in this environment")
class ShipmentPageGrantsTests(TestCase):
    """Seeded defaults, and the migration that drags a drifted DB back to them."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')

    def _roles_with_shipment_view(self):
        return set(
            RoleResourcePermission.objects
            .filter(resource_code='shipment', can_view=True)
            .values_list('role', flat=True)
        )

    def test_no_role_sees_a_shipments_page_it_cannot_use(self):
        """The invariant F6 broke. Scoped to the three shipment pages on
        purpose: six other page/resource mismatches are known and separately
        tracked as F11, and widening this test would fail on those instead."""
        allowed = self._roles_with_shipment_view()
        offenders = sorted(
            RolePagePermission.objects
            .filter(page_code__in=_MIGRATION.DEAD_PAGES, is_visible=True)
            .exclude(role__in=allowed)
            .values_list('role', 'page_code')
        )
        self.assertEqual(offenders, [], 'page granted without shipment.can_view')

    def test_greenhouse_manager_is_not_seeded_with_shipments(self):
        """Two docs say so — `seed_permissions.PAGE_DEFAULTS` and
        `docs/obsidian/roles/greenhouse-manager.md`. Pin it, so re-adding the
        pages to the seed has to be a deliberate edit."""
        visible = set(
            RolePagePermission.objects
            .filter(role='greenhouse_manager', is_visible=True)
            .values_list('page_code', flat=True)
        )
        self.assertEqual(visible & set(_MIGRATION.DEAD_PAGES), set())

    def test_the_migration_hides_a_drifted_grant(self):
        """The live state the migration exists for: rows switched on by hand."""
        for page_code in _MIGRATION.DEAD_PAGES:
            RolePagePermission.objects.update_or_create(
                role='greenhouse_manager', page_code=page_code,
                defaults={'is_visible': True},
            )
        self.assertFalse(
            RoleResourcePermission.objects.filter(
                role='greenhouse_manager', resource_code='shipment',
            ).exists(),
            'premise broken: greenhouse_manager now has a shipment resource row',
        )

        changed = _MIGRATION._set_visibility(RolePagePermission, False)

        self.assertEqual(changed, 3)
        self.assertFalse(
            RolePagePermission.objects
            .filter(role='greenhouse_manager', page_code__in=_MIGRATION.DEAD_PAGES,
                    is_visible=True)
            .exists()
        )

    def test_the_migration_keeps_the_rows_so_the_matrix_still_shows_them(self):
        """Hidden, not deleted — an owner must be able to switch them back on
        from the permission matrix rather than needing another migration."""
        _MIGRATION._set_visibility(RolePagePermission, False)
        self.assertEqual(
            RolePagePermission.objects.filter(
                role='greenhouse_manager', page_code__in=_MIGRATION.DEAD_PAGES,
            ).count(),
            3,
        )

    def test_the_migration_is_idempotent(self):
        _MIGRATION._set_visibility(RolePagePermission, False)
        self.assertEqual(_MIGRATION._set_visibility(RolePagePermission, False), 0)

    def test_other_roles_are_untouched(self):
        """It names one role; a stray `page_code__in` without the role filter
        would blank the Shipments sidebar for the whole company."""
        before = set(
            RolePagePermission.objects
            .filter(page_code__in=_MIGRATION.DEAD_PAGES, is_visible=True)
            .exclude(role='greenhouse_manager')
            .values_list('role', 'page_code')
        )
        self.assertTrue(before, 'premise broken: no other role holds these pages')

        _MIGRATION._set_visibility(RolePagePermission, False)

        after = set(
            RolePagePermission.objects
            .filter(page_code__in=_MIGRATION.DEAD_PAGES, is_visible=True)
            .exclude(role='greenhouse_manager')
            .values_list('role', 'page_code')
        )
        self.assertEqual(before, after)
