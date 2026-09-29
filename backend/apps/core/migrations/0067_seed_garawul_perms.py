"""Seed the permission matrix for `garawul` and add the gate to admin / boss.

seed_permissions only get_or_creates on a fresh DB; production runs `migrate`
only. Every page code gets a garawul row (hidden ones as is_visible=False) —
/admin/permissions Save deletes and recreates page rows, so a partial matrix
silently loses access (see core/0054).

Page codes are snapshotted so the migration replays identically forever.
Idempotent and reversible; clears the permission cache.
"""
from django.db import migrations

ROLE = 'garawul'

# Snapshot of PAGE_REGISTRY as of 2026-09-29, including the new 'export.gate'.
# If another session registered a page since, the Step 1 test
# `test_migration_snapshots_every_registered_page` names it — add it here.
ALL_PAGES = [
    'dashboard', 'export.shipments', 'export.shipments_sheet',
    'export.shipments_dashboard', 'export.shipments.board', 'export.overdue',
    'export.advances', 'export.plan', 'export.harvest_board', 'export.quota',
    'export.quota.local_sell', 'export.prices', 'export.trucks', 'export.blocks',
    'export.pomidor_dukany', 'export.domestic_sales', 'export.drafts', 'export.assign',
    'export.pallet_manifest', 'export.gate', 'me.board', 'export.task_rules',
    'analytics.boss', 'analytics.clients', 'director.stuck_shipments', 'audit_log',
    'worklog', 'team_kpi', 'feedback.submit', 'feedback.my_tickets', 'feedback.public',
    'feedback.admin_inbox', 'contracts.list', 'contracts.sales', 'contracts.documents',
    'transport.map', 'transport.fleet', 'tir_takip', 'tir_takip.onumcilik',
    'tir_takip.gaplama', 'tir_takip.tirlar', 'tir_takip.export_rapor', 'tir_takip.hasabat',
    'tir_takip.gumruk_ewrak', 'tir_takip.kwota_takibi', 'tir_takip.sertnamalar',
    'tir_takip.datalar', 'export.sales_reports', 'export.sales_rep_coverage',
    'export.expense_template', 'export.packing_presets', 'admin.users',
    'admin.staff_access', 'admin.seasons', 'admin.firms', 'admin.import_firms',
    'admin.permissions', 'admin.blocks', 'admin.customers', 'admin.truck_dest',
    'admin.shipment_settings',
]

VISIBLE_PAGES = {'export.gate', 'me.board'}

# (can_view, can_create, can_edit, can_delete)
GUARD_RESOURCES = {'gate': (True, False, True, False)}
FULL = (True, True, True, True)


def seed(apps, schema_editor):
    # Skip on a TEST database only, by DB-name prefix — the 0033 pattern, not
    # os.environ['DJANGO_TESTING']: `manage.py test` never sets that variable,
    # so a real `migrate` run with it left set in the shell would mark this
    # migration applied while doing nothing, permanently (already happened to
    # export.0058). See core/0033_boss_process_visibility_perms.
    if schema_editor.connection.settings_dict['NAME'].startswith('test_'):
        return
    RolePagePermission = apps.get_model('core', 'RolePagePermission')
    RoleResourcePermission = apps.get_model('core', 'RoleResourcePermission')
    RoleFieldPermission = apps.get_model('core', 'RoleFieldPermission')

    for page_code in ALL_PAGES:
        RolePagePermission.objects.get_or_create(
            role=ROLE, page_code=page_code,
            defaults={'is_visible': page_code in VISIBLE_PAGES},
        )
    for resource_code, flags in GUARD_RESOURCES.items():
        _grant(RoleResourcePermission, ROLE, resource_code, flags)

    for role in ('admin', 'boss'):
        RolePagePermission.objects.update_or_create(
            role=role, page_code='export.gate', defaults={'is_visible': True},
        )
        _grant(RoleResourcePermission, role, 'gate', FULL)
    # boss holds a '*' field row for every resource (tests_boss_access).
    RoleFieldPermission.objects.get_or_create(role='boss', resource_code='gate', field_name='*')

    for role in ('director', 'export_manager', 'document_team'):
        RolePagePermission.objects.get_or_create(
            role=role, page_code='export.gate', defaults={'is_visible': False},
        )
    _wipe_perm_cache()


def unseed(apps, schema_editor):
    RolePagePermission = apps.get_model('core', 'RolePagePermission')
    RoleResourcePermission = apps.get_model('core', 'RoleResourcePermission')
    RoleFieldPermission = apps.get_model('core', 'RoleFieldPermission')
    RolePagePermission.objects.filter(role=ROLE).delete()
    RoleResourcePermission.objects.filter(role=ROLE).delete()
    RolePagePermission.objects.filter(page_code='export.gate').delete()
    RoleResourcePermission.objects.filter(resource_code='gate').delete()
    RoleFieldPermission.objects.filter(resource_code='gate').delete()
    _wipe_perm_cache()


def _grant(model, role, resource_code, flags):
    view, create, edit, delete = flags
    model.objects.update_or_create(
        role=role, resource_code=resource_code,
        defaults={'can_view': view, 'can_create': create, 'can_edit': edit, 'can_delete': delete},
    )


def _wipe_perm_cache():
    try:
        from apps.core.views_permissions import _invalidate_perm_cache
        _invalidate_perm_cache()
    except Exception:
        pass


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0066_garawul_role_and_location"),
    ]

    operations = [migrations.RunPython(seed, reverse_code=unseed)]
