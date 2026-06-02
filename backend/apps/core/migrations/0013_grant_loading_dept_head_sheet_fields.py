"""Grant loading_dept_head edit access to his Sheet rows that were missing
from RoleFieldPermission.

Background: `can_edit_sheet_field` AND-composes two gates — the SheetRowSetting
trigger config and the per-role RoleFieldPermission allowlist. A prior fix
(commit b71f746) seeded `role_triggers` but left `RoleFieldPermission` alone,
so Soltanmyrat (loading_dept_head) still couldn't write to the cells whose
``default_who_key='sheet.who.soltanmyrat'`` in ``DEFAULT_SHEET_ROWS``:

  - block_sources       (R8,  which blocks supplied the truck)
  - loading_started_at  (R19, loading-start time)
  - loading_ended_at    (R20, loading-end time)
  - rejected_weight_kg  (R34, post-loading adjustment)
  - harvest_date        (R39, harvest day)

These match the fields warehouse_chief (his deputies) already has, plus the
block-sources / rejected-weight rows whose role_triggers explicitly grant
loading_dept_head.

Idempotent: uses get_or_create on the (role, resource_code, field_name) unique
key. Re-runnable. Also clears the permission cache so live workers pick up the
new rows immediately without a restart.
"""
import os

from django.db import migrations


NEW_FIELDS = [
    'block_sources',
    'loading_started_at',
    'loading_ended_at',
    'rejected_weight_kg',
    'harvest_date',
]


def grant_loading_dept_head_fields(apps, schema_editor):
    if os.environ.get('DJANGO_TESTING') == 'true':
        return
    RoleFieldPermission = apps.get_model('core', 'RoleFieldPermission')
    for field_name in NEW_FIELDS:
        RoleFieldPermission.objects.get_or_create(
            role='loading_dept_head',
            resource_code='shipment',
            field_name=field_name,
        )

    # Invalidate the dynamic-permission cache so a running worker doesn't keep
    # serving the old (empty) field list for loading_dept_head. Imported
    # lazily because the cache module is part of the live app code, not the
    # frozen migration apps registry.
    try:
        from django.core.cache import cache
        from apps.core.views_permissions import PERM_CACHE_PREFIX
        cache.delete_many([
            f'{PERM_CACHE_PREFIX}:all_fields:loading_dept_head',
            f'{PERM_CACHE_PREFIX}:fields:loading_dept_head:shipment',
        ])
    except Exception:
        # Cache wipe is best-effort — a worker restart will pick up the new
        # rows regardless. Never fail the migration on cache issues.
        pass


def revoke_loading_dept_head_fields(apps, schema_editor):
    RoleFieldPermission = apps.get_model('core', 'RoleFieldPermission')
    RoleFieldPermission.objects.filter(
        role='loading_dept_head',
        resource_code='shipment',
        field_name__in=NEW_FIELDS,
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0012_grant_harvest_board_page'),
    ]

    operations = [
        migrations.RunPython(
            grant_loading_dept_head_fields,
            reverse_code=revoke_loading_dept_head_fields,
        ),
    ]
