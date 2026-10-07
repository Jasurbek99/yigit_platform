"""Put Sheet row «Продукт» (product_type) on the live DB.

Production runs `migrate` only, never seed_permissions, so the grants and the
SheetRowSetting row + triggers are written here (pattern of 0087). Once a row has
any trigger the triggers ARE the permission (AD-17), so every role that edits
product_type gets one, boss included (shipment:* but not in SHEET_BYPASS_ROLES).
display_order = midpoint between the variety row and the next row, read at
migrate time (admins may have reordered). Idempotent, reversible. Does NOT call
backfill(): that would re-copy grants across every row.
"""
from django.db import migrations

FIELD_KEY = 'product_type'
AFTER_KEY = 'variety'
GRANT_ROLES = ['loading_dept_head', 'loading_dept_head_deputy', 'warehouse_chief']
# Mirrors the live triggers on the variety row; document_team edits the product
# on the destination side (it already holds shipment.product_type).
TRIGGER_ROLES = ['admin', 'boss', 'director', 'export_manager', 'document_team'] + GRANT_ROLES


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
        display_order, is_locked = 51 * 1024, False
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
        defaults={'row_number': 51, 'display_order': display_order, 'is_locked': is_locked},
    )
    for role in TRIGGER_ROLES:
        SheetRowRoleTrigger.objects.get_or_create(row=row, role=role)
    _wipe_perm_cache()


def unseed(apps, schema_editor):
    # Grants are left alone: shipment.product_type grants predate this migration
    # (seed_permissions) and other resources also have a `product_type` field.
    apps.get_model('export', 'SheetRowSetting').objects.filter(field_key=FIELD_KEY).delete()
    _wipe_perm_cache()


def _wipe_perm_cache():
    try:
        from apps.core.views_permissions import _invalidate_perm_cache
        _invalidate_perm_cache()
    except Exception:
        pass


class Migration(migrations.Migration):

    dependencies = [
        ("export", "0097_backfill_shipment_product"),
        ("core", "0074_seed_pepper_products"),
    ]

    operations = [migrations.RunPython(seed, reverse_code=unseed)]
