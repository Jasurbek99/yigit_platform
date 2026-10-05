"""Put Sheet row «Дата экспорта» (export_date) on the live DB.

Production runs `migrate` only, never seed_permissions, so the grants and the
SheetRowSetting row + triggers are written here (pattern of 0087). Once a row has
any trigger the triggers ARE the permission (AD-17), so every role that edits
export_code gets one, boss included (shipment:* but not in SHEET_BYPASS_ROLES).
display_order = midpoint between the export_code row and the next row, read at
migrate time (admins may have reordered). Idempotent, reversible. Does NOT call
backfill(): that would re-copy grants across every row.
"""
from django.db import migrations

FIELD_KEY = 'export_date'
AFTER_KEY = 'export_code'
GRANT_ROLES = ['loading_dept_head', 'loading_dept_head_deputy', 'warehouse_chief']
# Mirrors the live triggers on the export_code row (checked 2026-10-05).
TRIGGER_ROLES = ['admin', 'boss', 'director', 'export_manager'] + GRANT_ROLES


def seed(apps, schema_editor):
    # Skip test databases by name (core/0033 pattern): `manage.py test` never
    # sets DJANGO_TESTING, and a leaked env var would no-op a real migrate.
    if schema_editor.connection.settings_dict['NAME'].startswith('test_'):
        return
    RoleFieldPermission = apps.get_model('core', 'RoleFieldPermission')
    SheetRowSetting = apps.get_model('export', 'SheetRowSetting')
    SheetRowRoleTrigger = apps.get_model('export', 'SheetRowRoleTrigger')

    for role in GRANT_ROLES:
        RoleFieldPermission.objects.get_or_create(
            role=role, resource_code='shipment', field_name=FIELD_KEY,
        )

    anchor = SheetRowSetting.objects.filter(field_key=AFTER_KEY).first()
    if anchor is None:
        display_order, is_locked = 50 * 1024, False
    else:
        after = (
            SheetRowSetting.objects.filter(display_order__gt=anchor.display_order)
            .order_by('display_order').values_list('display_order', flat=True).first()
        )
        upper = after if after is not None else anchor.display_order + 1024
        display_order = (anchor.display_order + upper) // 2
        is_locked = anchor.is_locked
    row, _ = SheetRowSetting.objects.get_or_create(
        field_key=FIELD_KEY,
        defaults={'row_number': 50, 'display_order': display_order, 'is_locked': is_locked},
    )
    for role in TRIGGER_ROLES:
        SheetRowRoleTrigger.objects.get_or_create(row=row, role=role)
    _wipe_perm_cache()


def unseed(apps, schema_editor):
    apps.get_model('export', 'SheetRowSetting').objects.filter(field_key=FIELD_KEY).delete()
    apps.get_model('core', 'RoleFieldPermission').objects.filter(field_name=FIELD_KEY).delete()
    _wipe_perm_cache()


def _wipe_perm_cache():
    try:
        from apps.core.views_permissions import _invalidate_perm_cache
        _invalidate_perm_cache()
    except Exception:
        pass


class Migration(migrations.Migration):

    dependencies = [
        ("export", "0095_shipment_export_date"),
        ("core", "0072_exportfirm_letterhead"),
    ]

    operations = [migrations.RunPython(seed, reverse_code=unseed)]
