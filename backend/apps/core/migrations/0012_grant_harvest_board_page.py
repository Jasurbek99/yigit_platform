"""Seed RolePagePermission rows for the new export.harvest_board page.

The page is brand new, so no rows exist yet for its page_code. The
seed_permissions command uses get_or_create and would create them on the next
run, but creating them here keeps existing deployments in sync without an ops
`seed_permissions` run. Visible to the same operational roles that already see
the Shipment Board, plus greenhouse_manager; hidden for seller/boss.
"""
import os

from django.db import migrations

PAGE_CODE = 'export.harvest_board'

# Roles that should see the daily harvest board by default. admin/director/
# export_manager are handled via the catch-all below (they see every page).
_VISIBLE_ROLES = {
    'admin', 'director', 'export_manager',
    'loading_dept_head', 'warehouse_chief', 'weight_master',
    'document_team', 'transport', 'sales_rep', 'finansist',
    'accountant', 'greenhouse_manager',
}


def grant_harvest_board(apps, schema_editor):
    if os.environ.get('DJANGO_TESTING') == 'true':
        return
    RolePagePermission = apps.get_model('core', 'RolePagePermission')
    try:
        from apps.core.models.user import ROLE_CHOICES
        all_roles = [r[0] for r in ROLE_CHOICES]
    except Exception:
        all_roles = sorted(_VISIBLE_ROLES | {'seller', 'boss'})

    for role in all_roles:
        RolePagePermission.objects.get_or_create(
            role=role,
            page_code=PAGE_CODE,
            defaults={'is_visible': role in _VISIBLE_ROLES},
        )


def revoke_harvest_board(apps, schema_editor):
    RolePagePermission = apps.get_model('core', 'RolePagePermission')
    RolePagePermission.objects.filter(page_code=PAGE_CODE).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0011_add_cancelled_status'),
    ]

    operations = [
        migrations.RunPython(grant_harvest_board, reverse_code=revoke_harvest_board),
    ]
