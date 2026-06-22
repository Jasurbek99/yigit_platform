"""Rename the export_code field permission to match the model field rename.

Shipment.official_export_code was renamed to Shipment.export_code
(export migration 0041). RoleFieldPermission stores the field name verbatim,
so existing grants for 'official_export_code' must follow or operators lose
edit access to the Export Code cell.

The system code (cargo_code -> shipment_code) has no stored field permission
(it is server-auto-generated / intentionally absent from the registry), so
only the manual code is remapped here. Reversible.
"""

from django.db import migrations


def forwards(apps, schema_editor):
    RoleFieldPermission = apps.get_model('core', 'RoleFieldPermission')
    RoleFieldPermission.objects.filter(field_name='official_export_code').update(
        field_name='export_code'
    )


def backwards(apps, schema_editor):
    RoleFieldPermission = apps.get_model('core', 'RoleFieldPermission')
    RoleFieldPermission.objects.filter(field_name='export_code').update(
        field_name='official_export_code'
    )


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0020_loading_dept_head_user_admin_pages'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
