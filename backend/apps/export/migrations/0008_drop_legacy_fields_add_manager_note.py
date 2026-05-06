"""Migration A1: drop route_note + customs_clearance, add export_manager_note.

Data migration:
  - Deletes SheetRowSetting rows for route_note, customs_clearance, cmr_status.
    Cascade on SheetRowRoleTrigger, SheetRowUserPermission, and UserSheetRowPref
    handles child-row cleanup automatically (all have on_delete=CASCADE to SheetRowSetting).
  - Nullifies field_key on ShipmentComment rows that referenced the dropped keys,
    so existing comment threads are preserved as shipment-level comments.

Reverse is intentionally a no-op. Rolling back the schema portion (RemoveField/AddField)
will not re-create the deleted SheetRowSetting rows or restore nullified comment
field_keys; those are gone for good. If a rollback is ever needed, run seed_data
to re-create the SheetRowSetting rows for the legacy field_keys.
"""

from django.db import migrations, models


def _drop_legacy_sheet_rows(apps, schema_editor):
    """Delete SheetRowSetting rows for removed field keys and demote comments."""
    SheetRowSetting = apps.get_model('export', 'SheetRowSetting')
    ShipmentComment = apps.get_model('export', 'ShipmentComment')

    dead_keys = ['route_note', 'customs_clearance', 'cmr_status']

    # Hard-delete the SheetRowSetting rows. The FK cascade in
    # SheetRowRoleTrigger / SheetRowUserPermission / UserSheetRowPref
    # (all on_delete=CASCADE) handles child cleanup automatically.
    SheetRowSetting.objects.filter(field_key__in=dead_keys).delete()

    # Preserve existing comment threads: demote cell-anchored comments to
    # shipment-level by clearing field_key (NULL = shipment-level comment).
    ShipmentComment.objects.filter(field_key__in=dead_keys).update(field_key=None)


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0007_custom_rows'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='shipment',
            name='route_note',
        ),
        migrations.RemoveField(
            model_name='shipment',
            name='customs_clearance',
        ),
        migrations.AddField(
            model_name='shipment',
            name='export_manager_note',
            field=models.TextField(
                blank=True,
                default='',
                db_collation='Cyrillic_General_CI_AS',
            ),
        ),
        migrations.RunPython(
            _drop_legacy_sheet_rows,
            reverse_code=migrations.RunPython.noop,
        ),
    ]
