"""Permission defaults for the `quality_inspector` role (2026-09-22).

The role was split out of `transport`: the three transit/quality readings and
the quality-certificate record belong to Hil Gözegçi, not to Malik and Haltac.
Both halves of that are pinned here — what the inspector gained AND what
transport lost — because a half-applied split is the failure mode. If a later
change re-adds `transit_days` to transport's defaults, the second test fails.

The migration that carries the same split onto the live database
(`core/0054_seed_quality_inspector_perms`) is checked against these seed
defaults so the two cannot drift: the seeded matrix IS the migration's target.
"""
from importlib import import_module

from django.core.management import call_command
from django.test import TestCase

from apps.core.models import (
    RoleFieldPermission,
    RolePagePermission,
    RoleResourcePermission,
)
from apps.core.models.user import ROLE_CHOICES
from apps.core.permission_registry import PAGE_REGISTRY

_MIGRATION = import_module('apps.core.migrations.0054_seed_quality_inspector_perms')

ROLE = 'quality_inspector'
QUALITY_FIELDS = {'transit_days', 'transport_temp_c', 'shelf_life_days'}


class QualityInspectorRoleTests(TestCase):
    """The seed command's quality_inspector defaults on a fresh database."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')

    def test_role_is_a_valid_choice(self):
        self.assertIn(ROLE, {code for code, _label in ROLE_CHOICES})

    def test_inspector_edits_the_three_quality_fields_on_shipment(self):
        fields = set(
            RoleFieldPermission.objects
            .filter(role=ROLE, resource_code='shipment')
            .values_list('field_name', flat=True)
        )
        self.assertEqual(fields, QUALITY_FIELDS)

    def test_transport_no_longer_holds_the_quality_fields(self):
        """The other half of the split — a grant moved, not copied."""
        leftovers = set(
            RoleFieldPermission.objects
            .filter(role='transport', resource_code='shipment',
                    field_name__in=QUALITY_FIELDS)
            .values_list('field_name', flat=True)
        )
        self.assertEqual(leftovers, set())

    def test_transport_keeps_its_own_fields(self):
        """Guards against the split over-reaching into the border/vehicle block."""
        fields = set(
            RoleFieldPermission.objects
            .filter(role='transport', resource_code='shipment')
            .values_list('field_name', flat=True)
        )
        self.assertTrue({'border_point', 'vehicle_condition', 'driver_id'} <= fields)

    def test_inspector_owns_the_quality_document_resource(self):
        perm = RoleResourcePermission.objects.get(role=ROLE, resource_code='quality_document')
        self.assertTrue(perm.can_view)
        self.assertTrue(perm.can_create)
        self.assertTrue(perm.can_edit)
        self.assertFalse(perm.can_delete)

    def test_inspector_cannot_delete_or_create_shipments(self):
        perm = RoleResourcePermission.objects.get(role=ROLE, resource_code='shipment')
        self.assertTrue(perm.can_view)
        self.assertTrue(perm.can_edit)
        self.assertFalse(perm.can_create)
        self.assertFalse(perm.can_delete)

    def test_inspector_holds_no_other_resources(self):
        resources = set(
            RoleResourcePermission.objects
            .filter(role=ROLE)
            .values_list('resource_code', flat=True)
        )
        self.assertEqual(resources, {'shipment', 'quality_document', 'shipment_comment'})

    def test_inspector_sees_no_admin_page(self):
        """AD-15: an operational role never holds an admin.* page."""
        visible = set(
            RolePagePermission.objects
            .filter(role=ROLE, is_visible=True)
            .values_list('page_code', flat=True)
        )
        self.assertEqual({p for p in visible if p.startswith('admin.')}, set())

    def test_inspector_does_not_see_the_harvest_board(self):
        """He works the truck, not the greenhouse plan."""
        self.assertFalse(
            RolePagePermission.objects
            .filter(role=ROLE, page_code='export.harvest_board', is_visible=True)
            .exists()
        )

    def test_migration_page_snapshot_still_covers_the_registry(self):
        """The migration hardcodes the 49 codes registered on 2026-09-22.

        A page added later is seeded by `seed_permissions`, not by the frozen
        migration — but a page *renamed* or removed would leave the migration
        writing a row for a code that no longer exists, which
        `/admin/permissions` then deletes on the next Save. Fail loudly here so
        the snapshot is re-checked rather than silently rotting.
        """
        stale = set(_MIGRATION.ALL_PAGES) - set(PAGE_REGISTRY.keys())
        self.assertEqual(stale, set(), f'migration names unregistered pages: {sorted(stale)}')

    def test_migration_visible_set_matches_the_seeded_matrix(self):
        """Live DB and fresh install must land on the same visible pages."""
        seeded = set(
            RolePagePermission.objects
            .filter(role=ROLE, is_visible=True)
            .values_list('page_code', flat=True)
        )
        self.assertEqual(seeded, _MIGRATION.VISIBLE_PAGES)

    def test_migration_field_map_matches_the_seeded_matrix(self):
        """Only for resources that still HAVE grantable fields.

        `0054` also seeded `quality_document: ['*']`, correct when it was
        written. The four certificate flags became derived columns later the
        same day (file uploads replaced the checkboxes), so
        `RESOURCE_FIELDS['quality_document']` is now `[]` and `core/0055`
        deletes those rows. The migration is left as the historical record;
        the invariant worth pinning is the one below.
        """
        superseded = {'quality_document'}
        for resource_code, field_names in _MIGRATION.FIELDS.items():
            if resource_code in superseded:
                continue
            seeded = set(
                RoleFieldPermission.objects
                .filter(role=ROLE, resource_code=resource_code)
                .values_list('field_name', flat=True)
            )
            self.assertEqual(seeded, set(field_names), f'drift on {resource_code}')

    def test_the_derived_quality_flags_are_not_grantable_fields(self):
        """No role can be granted edit on a derived column.

        The invariant is that the four flags are not *nameable* in a field
        grant: `RESOURCE_FIELDS['quality_document']` is empty, so
        `get_editable_fields` resolves to nothing for this resource and
        `/admin/permissions` offers no tickboxes. `boss` still carries a
        blanket `(resource, '*')` row for every registered resource — that is
        the shape `tests_boss_access` pins, and it grants nothing here because
        '*' resolves against the same empty list. What must NOT exist is a row
        naming one of the flags; core/0055 removed those.
        """
        from apps.core.permission_registry import RESOURCE_FIELDS

        self.assertEqual(RESOURCE_FIELDS['quality_document'], [])
        named = set(
            RoleFieldPermission.objects
            .filter(resource_code='quality_document')
            .exclude(field_name='*')
            .values_list('role', 'field_name')
        )
        self.assertEqual(named, set())

    def test_the_inspector_still_owns_the_quality_resource_itself(self):
        """Access moved to the RESOURCE level, it did not go away."""
        perm = RoleResourcePermission.objects.get(role=ROLE, resource_code='quality_document')
        self.assertTrue(perm.can_edit)
