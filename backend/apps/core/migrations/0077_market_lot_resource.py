"""Seed the `market_lot` resource (agent-market lots, sales, spoilage, expenses).

seed_permissions only runs on a fresh DB; production runs `migrate`. The grants
mirror seed_permissions.RESOURCE_DEFAULTS role for role (asserted by
core/tests_agent_perms.py). Who may do what on a lot beyond these flags is
decided in apps/market/services. Snapshot frozen so the migration replays identically.
"""
from django.db import migrations

RESOURCE = 'market_lot'

VCRUD = (True, True, True, True)
VIEW = (True, False, False, False)
GRANTS = {
    'agent': VCRUD,
    'agent_seller': VCRUD,
    'admin': VCRUD,
    # boss is read-only on the market (agent-market spec §3).
    'boss': VIEW,
    'director': VIEW,
    'export_manager': VIEW,
    'document_team': VIEW,
    'sales_rep': VIEW,
}


def seed(apps, schema_editor):
    # Skip on a TEST database only, by DB-name prefix (the 0033 / 0067 / 0076 pattern).
    if schema_editor.connection.settings_dict['NAME'].startswith('test_'):
        return
    Res = apps.get_model('core', 'RoleResourcePermission')
    Field = apps.get_model('core', 'RoleFieldPermission')
    for role, flags in GRANTS.items():
        _grant(Res, role, RESOURCE, flags)
    Field.objects.get_or_create(role='boss', resource_code=RESOURCE, field_name='*')
    _wipe_perm_cache()


def unseed(apps, schema_editor):
    apps.get_model('core', 'RoleResourcePermission').objects.filter(resource_code=RESOURCE).delete()
    apps.get_model('core', 'RoleFieldPermission').objects.filter(resource_code=RESOURCE).delete()
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
        ('core', '0076_seed_agent_market_perms'),
    ]

    operations = [migrations.RunPython(seed, reverse_code=unseed)]
