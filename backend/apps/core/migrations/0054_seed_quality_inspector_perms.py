"""Seed the permission matrix for the new ``quality_inspector`` role and take
the quality fields off ``transport``.

``seed_permissions`` uses get_or_create and only writes rows for roles that
exist in its defaults dicts at seed time — it will never retro-fit a live
database, and it never *removes* a grant. On the beta DB the matrix is live
data, so without this migration the inspector would have zero access and
transport would keep the three fields the inspector is meant to own.

Page rows are written for EVERY page code, including the hidden ones as
``is_visible=False``. A partially-populated matrix is not equivalent to an
absent one: ``/admin/permissions`` Save deletes every page row and recreates
only the codes the running PAGE_REGISTRY knows, so a role whose matrix relies
on default fall-through silently loses access on the next Save (this is how
Copy_Gadams_UI's 150 tir_takip rows were wiped, 2026-09-16).

The 49 page codes are snapshotted here rather than imported from
``permission_registry`` so the migration replays identically forever. Codes
registered after 2026-09-22 are picked up by the next ``seed_permissions`` run,
exactly as they are for every other role.

Idempotent: get_or_create per unique key, re-runnable. Clears the dynamic
permission cache so live workers see the rows without a restart.
"""
import os

from django.db import migrations

ROLE = 'quality_inspector'

# Snapshot of PAGE_REGISTRY as of 2026-09-22.
ALL_PAGES = [
    'dashboard', 'export.shipments', 'export.shipments_sheet',
    'export.shipments_dashboard', 'export.shipments.board', 'export.overdue',
    'export.advances', 'export.plan', 'export.harvest_board', 'export.quota',
    'export.quota.local_sell', 'export.prices', 'export.trucks',
    'export.blocks', 'export.pomidor_dukany', 'export.domestic_sales',
    'export.drafts', 'export.assign', 'export.pallet_manifest', 'me.board',
    'analytics.boss', 'analytics.clients', 'director.stuck_shipments',
    'audit_log', 'worklog', 'team_kpi', 'feedback.submit',
    'feedback.my_tickets', 'feedback.public', 'feedback.admin_inbox',
    'contracts.list', 'contracts.sales', 'contracts.documents', 'transport.map',
    'transport.fleet', 'export.sales_reports', 'export.sales_rep_coverage',
    'export.expense_template', 'export.packing_presets', 'admin.users',
    'admin.staff_access', 'admin.seasons', 'admin.firms', 'admin.import_firms',
    'admin.permissions', 'admin.blocks', 'admin.customers', 'admin.truck_dest',
    'admin.shipment_settings',
]

# Transport's shipment surfaces minus the harvest board — the inspector works
# the truck, not the greenhouse plan. Mirrors PAGE_DEFAULTS in seed_permissions.
VISIBLE_PAGES = {
    'dashboard', 'export.shipments', 'export.shipments_sheet',
    'export.shipments_dashboard', 'export.shipments.board',
    'me.board', 'feedback.submit', 'feedback.my_tickets', 'feedback.public',
    'worklog', 'team_kpi',
    # Fleet Map is granted to EVERY role except `seller` by a loop at the end
    # of seed_permissions (owner request 2026-08-23), so it is not part of the
    # block above and is easy to miss when snapshotting a role's page set —
    # which is exactly what happened here, caught by
    # tests_quality_inspector.test_migration_visible_set_matches_the_seeded_matrix.
    'transport.map',
}

# (can_view, can_create, can_edit, can_delete)
RESOURCES = {
    'shipment': (True, False, True, False),           # _VE
    'quality_document': (True, True, True, False),    # _VCE
    'shipment_comment': (True, True, True, False),    # _VCE
}

FIELDS = {
    'shipment': ['transit_days', 'transport_temp_c', 'shelf_life_days'],
    'quality_document': ['*'],
}

# Moved off transport by the same stakeholder decision that created the role.
TRANSPORT_FIELDS_REVOKED = ['transit_days', 'transport_temp_c', 'shelf_life_days']


def seed_quality_inspector(apps, schema_editor):
    if os.environ.get('DJANGO_TESTING') == 'true':
        return

    RolePagePermission = apps.get_model('core', 'RolePagePermission')
    RoleResourcePermission = apps.get_model('core', 'RoleResourcePermission')
    RoleFieldPermission = apps.get_model('core', 'RoleFieldPermission')

    for page_code in ALL_PAGES:
        RolePagePermission.objects.get_or_create(
            role=ROLE,
            page_code=page_code,
            defaults={'is_visible': page_code in VISIBLE_PAGES},
        )

    for resource_code, (view, create, edit, delete) in RESOURCES.items():
        RoleResourcePermission.objects.get_or_create(
            role=ROLE,
            resource_code=resource_code,
            defaults={
                'can_view': view,
                'can_create': create,
                'can_edit': edit,
                'can_delete': delete,
            },
        )

    for resource_code, field_names in FIELDS.items():
        for field_name in field_names:
            RoleFieldPermission.objects.get_or_create(
                role=ROLE,
                resource_code=resource_code,
                field_name=field_name,
            )

    RoleFieldPermission.objects.filter(
        role='transport',
        resource_code='shipment',
        field_name__in=TRANSPORT_FIELDS_REVOKED,
    ).delete()

    _wipe_perm_cache()


def unseed_quality_inspector(apps, schema_editor):
    RolePagePermission = apps.get_model('core', 'RolePagePermission')
    RoleResourcePermission = apps.get_model('core', 'RoleResourcePermission')
    RoleFieldPermission = apps.get_model('core', 'RoleFieldPermission')

    RolePagePermission.objects.filter(role=ROLE).delete()
    RoleResourcePermission.objects.filter(role=ROLE).delete()
    RoleFieldPermission.objects.filter(role=ROLE).delete()

    # Give transport its fields back — the forward pass took them away.
    for field_name in TRANSPORT_FIELDS_REVOKED:
        RoleFieldPermission.objects.get_or_create(
            role='transport',
            resource_code='shipment',
            field_name=field_name,
        )

    _wipe_perm_cache()


def _wipe_perm_cache():
    # Best-effort, same as 0018: never fail a migration over a cache miss —
    # a restart picks up the rows either way.
    try:
        from apps.core.views_permissions import _invalidate_perm_cache
        _invalidate_perm_cache()
    except Exception:
        pass


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0053_add_quality_inspector_role'),
    ]

    operations = [
        migrations.RunPython(seed_quality_inspector, reverse_code=unseed_quality_inspector),
    ]
