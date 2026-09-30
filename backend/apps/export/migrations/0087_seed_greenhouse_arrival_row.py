"""Put Sheet row «Ýyladyşhana geldi» (greenhouse_arrived_at) on the live DB.

Production runs `migrate` only, never seed_permissions, so:
  - the loading roles' RoleFieldPermission grant is written here, and
  - the SheetRowSetting row + its triggers are written here. Once a row has any
    trigger, the triggers ARE the permission (AD-17), so boss needs his own —
    he holds shipment:* but is not in SHEET_BYPASS_ROLES.
display_order = midpoint between R21 and the next row, read at migrate time
(admins may have reordered). Does NOT call backfill(): that would re-copy grants
across every row and undo triggers an admin removed. Idempotent, reversible.
"""
from django.db import migrations

FIELD_KEY = 'greenhouse_arrived_at'
EDITORS = ['loading_dept_head', 'loading_dept_head_deputy']
TRIGGER_ROLES = EDITORS + ['boss']


def seed(apps, schema_editor):
    # Skip test databases by name (core/0033 pattern): `manage.py test` never
    # sets DJANGO_TESTING, and a leaked env var would no-op a real migrate.
    if schema_editor.connection.settings_dict['NAME'].startswith('test_'):
        return
    RoleFieldPermission = apps.get_model('core', 'RoleFieldPermission')
    SheetRowSetting = apps.get_model('export', 'SheetRowSetting')
    SheetRowRoleTrigger = apps.get_model('export', 'SheetRowRoleTrigger')

    for role in EDITORS:
        RoleFieldPermission.objects.get_or_create(
            role=role, resource_code='shipment', field_name=FIELD_KEY,
        )

    departure = SheetRowSetting.objects.filter(field_key='departed_at').first()
    if departure is None:
        display_order, is_locked = 49 * 1024, False
    else:
        after = (
            SheetRowSetting.objects.filter(display_order__gt=departure.display_order)
            .order_by('display_order').values_list('display_order', flat=True).first()
        )
        upper = after if after is not None else departure.display_order + 1024
        display_order = (departure.display_order + upper) // 2
        is_locked = departure.is_locked
    row, _ = SheetRowSetting.objects.get_or_create(
        field_key=FIELD_KEY,
        defaults={'row_number': 49, 'display_order': display_order, 'is_locked': is_locked},
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
        ("export", "0086_gate_tasks"),
        ("core", "0067_seed_garawul_perms"),
    ]

    operations = [migrations.RunPython(seed, reverse_code=unseed)]
