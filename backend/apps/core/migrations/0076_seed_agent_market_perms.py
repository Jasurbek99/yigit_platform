"""Seed the permission matrix for the agent market (agent, agent_seller, market.* pages).

seed_permissions only runs on a fresh DB; production runs `migrate`. Every role
gets a row for every new page code, and the two new roles get a row for every
page code — /admin/permissions Save deletes and recreates page rows, so a partial
matrix silently loses access (core/0054, the tir_takip incident 2026-09-16).
Snapshots are frozen so the migration replays identically.
"""
from django.db import migrations

NEW_PAGES = ['market.home', 'market.team', 'market.agents']

# Snapshot of PAGE_REGISTRY keys as of 2026-10-08, including the three market pages.
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
    'transport.map', 'export.truck_board', 'transport.fleet', 'transport.plan',
    'tir_takip', 'tir_takip.onumcilik', 'tir_takip.gaplama', 'tir_takip.tirlar',
    'tir_takip.export_rapor', 'tir_takip.hasabat', 'tir_takip.gumruk_ewrak',
    'tir_takip.kwota_takibi', 'tir_takip.sertnamalar', 'tir_takip.datalar',
    'export.sales_reports', 'export.sales_rep_coverage', 'export.expense_template',
    'export.packing_presets', 'market.home', 'market.team', 'market.agents',
    'admin.users', 'admin.staff_access', 'admin.seasons', 'admin.firms',
    'admin.import_firms', 'admin.permissions', 'admin.blocks', 'admin.customers',
    'admin.truck_dest', 'admin.shipment_settings',
]
# Every role code after core/0075 (snapshot of ROLE_CHOICES codes).
ALL_ROLES = [
    'admin', 'export_manager', 'loading_dept_head', 'loading_dept_head_deputy',
    'warehouse_chief', 'weight_master', 'document_team', 'transport', 'sales_rep',
    'finansist', 'director', 'accountant', 'greenhouse_manager', 'seller',
    'quality_inspector', 'garawul', 'agent', 'agent_seller', 'boss',
]
AGENT_VISIBLE = {'market.home', 'market.team'}
SELLER_VISIBLE = {'market.home'}
AGENTS_PAGE_ROLES = {'admin', 'boss', 'director', 'export_manager', 'document_team', 'sales_rep'}

VCRUD = (True, True, True, True)
VIEW = (True, False, False, False)
VCE = (True, True, True, False)
NONE = (False, False, False, False)
RESOURCE_GRANTS = {
    ('agent', 'market_team'): VCRUD,
    # All-denied row so the role shows up in the admin resource matrix (its PUT
    # rejects a matrix with a missing role).
    ('agent_seller', 'market_team'): NONE,
    ('admin', 'market_agent'): VCRUD, ('admin', 'market_team'): VCRUD,
    ('boss', 'market_agent'): VCRUD, ('boss', 'market_team'): VCRUD,
    ('sales_rep', 'market_agent'): VCE,
    **{(r, res): VIEW for r in ('director', 'export_manager', 'document_team')
       for res in ('market_agent', 'market_team')},
}


def seed(apps, schema_editor):
    # Skip on a TEST database only, by DB-name prefix (the 0033 / 0067 pattern).
    if schema_editor.connection.settings_dict['NAME'].startswith('test_'):
        return
    Page = apps.get_model('core', 'RolePagePermission')
    Res = apps.get_model('core', 'RoleResourcePermission')
    Field = apps.get_model('core', 'RoleFieldPermission')
    for page in ALL_PAGES:
        Page.objects.get_or_create(role='agent', page_code=page, defaults={'is_visible': page in AGENT_VISIBLE})
        Page.objects.get_or_create(role='agent_seller', page_code=page, defaults={'is_visible': page in SELLER_VISIBLE})
    for role in ALL_ROLES:
        if role in ('agent', 'agent_seller'):
            continue
        for page in NEW_PAGES:
            visible = page == 'market.agents' and role in AGENTS_PAGE_ROLES
            Page.objects.get_or_create(role=role, page_code=page, defaults={'is_visible': visible})
    for (role, res), flags in RESOURCE_GRANTS.items():
        _grant(Res, role, res, flags)
    for res in ('market_agent', 'market_team'):
        Field.objects.get_or_create(role='boss', resource_code=res, field_name='*')
    _wipe_perm_cache()


def unseed(apps, schema_editor):
    Page = apps.get_model('core', 'RolePagePermission')
    Res = apps.get_model('core', 'RoleResourcePermission')
    Field = apps.get_model('core', 'RoleFieldPermission')
    Page.objects.filter(role__in=('agent', 'agent_seller')).delete()
    Page.objects.filter(page_code__in=NEW_PAGES).delete()
    Res.objects.filter(resource_code__in=('market_agent', 'market_team')).delete()
    Field.objects.filter(resource_code__in=('market_agent', 'market_team')).delete()
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
        ("core", "0075_agent_roles"),
    ]

    operations = [migrations.RunPython(seed, reverse_code=unseed)]
