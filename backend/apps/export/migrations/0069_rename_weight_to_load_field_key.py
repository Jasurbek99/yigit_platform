"""Carry the rejected_weight_kg → weight_to_load_kg rename into the data.

The column rename (0068) only moves the Shipment field. The same string is
stored as data in six places, and a Sheet row whose SheetRowSetting.field_key no
longer matches DEFAULT_SHEET_ROWS is dropped from the /sheet/ payload entirely —
so without this migration the row disappears from the Sheet.
"""
from django.db import migrations

OLD = 'rejected_weight_kg'
NEW = 'weight_to_load_kg'


def _swap(apps, old, new):
    apps.get_model('export', 'SheetRowSetting').objects.filter(
        field_key=old,
    ).update(field_key=new)
    apps.get_model('export', 'SheetCellColor').objects.filter(
        field_key=old,
    ).update(field_key=new)
    apps.get_model('export', 'ShipmentComment').objects.filter(
        field_key=old,
    ).update(field_key=new)
    apps.get_model('export', 'AuditLog').objects.filter(
        field_name=old,
    ).update(field_name=new)
    apps.get_model('core', 'RoleFieldPermission').objects.filter(
        field_name=old,
    ).update(field_name=new)
    # target_fields is a CSV CharField (MSSQL — no ArrayField), so the token is
    # swapped in place per row rather than by a column-wide UPDATE.
    for model_name in ('TaskRule', 'Task'):
        model = apps.get_model('export', model_name)
        for row in model.objects.filter(target_fields__contains=old):
            row.target_fields = ','.join(
                new if f.strip() == old else f.strip()
                for f in row.target_fields.split(',')
            )
            row.save(update_fields=['target_fields'])


def forwards(apps, schema_editor):
    _swap(apps, OLD, NEW)


def backwards(apps, schema_editor):
    _swap(apps, NEW, OLD)


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0068_rename_rejected_weight_to_weight_to_load'),
        ('core', '0050_seed_border_point_ru_names'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
