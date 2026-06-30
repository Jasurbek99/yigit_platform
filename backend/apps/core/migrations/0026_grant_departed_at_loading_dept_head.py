"""Grant `departed_at` (greenhouse-departure, Sheet row "Ýyladyşhanadan çykdy")
edit access to loading_dept_head and its deputy clone.

Background: `can_edit_sheet_field` AND-composes the SheetRowSetting trigger
config with the per-role RoleFieldPermission allowlist. loading_dept_head
(Soltanmyrat) was never granted `departed_at`, so he could not edit that cell
even when the trigger named him — while warehouse_chief (his deputies) already
had it. The seed comment and migration 0013 both state the head should have the
same fields as the deputies; `departed_at` was the one field that diverged.
Per stakeholder confirmation (2026-06-30) both Soltanmyrat and Mergen should be
able to enter greenhouse-departure.

Migration 0018 only cloned rows that existed when it ran, so the deputy role
needs the grant explicitly too.

Idempotent: get_or_create on the (role, resource_code, field_name) unique key.
Re-runnable. Also clears the permission cache so live workers pick up the new
rows immediately without a restart.
"""
import os

from django.db import migrations


ROLES = ['loading_dept_head', 'loading_dept_head_deputy']
FIELD = 'departed_at'


def grant_departed_at(apps, schema_editor):
    if os.environ.get('DJANGO_TESTING') == 'true':
        return
    RoleFieldPermission = apps.get_model('core', 'RoleFieldPermission')
    for role in ROLES:
        RoleFieldPermission.objects.get_or_create(
            role=role,
            resource_code='shipment',
            field_name=FIELD,
        )

    try:
        from django.core.cache import cache
        from apps.core.views_permissions import PERM_CACHE_PREFIX
        keys = []
        for role in ROLES:
            keys.append(f'{PERM_CACHE_PREFIX}:all_fields:{role}')
            keys.append(f'{PERM_CACHE_PREFIX}:fields:{role}:shipment')
        cache.delete_many(keys)
    except Exception:
        # Cache wipe is best-effort — a worker restart picks up the rows anyway.
        pass


def revoke_departed_at(apps, schema_editor):
    RoleFieldPermission = apps.get_model('core', 'RoleFieldPermission')
    RoleFieldPermission.objects.filter(
        role__in=ROLES,
        resource_code='shipment',
        field_name=FIELD,
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0025_seed_country_currency'),
    ]

    operations = [
        migrations.RunPython(grant_departed_at, reverse_code=revoke_departed_at),
    ]
