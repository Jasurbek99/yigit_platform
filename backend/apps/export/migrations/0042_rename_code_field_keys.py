"""Migrate persisted field_key strings to the renamed code fields.

The Sheet anchors every cell, comment and permission to a ``field_key`` string
that mirrors the model attribute name. Migration 0041 renamed the attributes, so
the stored strings must follow or the Sheet renders blank cells and existing
comments orphan:

  - 'cargo_code'           -> 'shipment_code'
  - 'official_export_code' -> 'export_code'

Tables touched:
  - SheetRowSetting.field_key   (row anchors)
  - ShipmentComment.field_key   (per-cell comment anchors)
  - ShipmentComment.content     (#cell:<key> mention tokens embedded in text)
  - Notification.link           (?row=<key> deep-link param into the Sheet)

AuditLog.field_name is intentionally NOT rewritten — it is historical record.
Reversible: the reverse simply flips the strings back.
"""

from django.db import migrations

FORWARD = [('cargo_code', 'shipment_code'), ('official_export_code', 'export_code')]
BACKWARD = [(new, old) for old, new in FORWARD]


def _remap(apps, pairs):
    SheetRowSetting = apps.get_model('export', 'SheetRowSetting')
    ShipmentComment = apps.get_model('export', 'ShipmentComment')
    Notification = apps.get_model('export', 'Notification')

    for old, new in pairs:
        SheetRowSetting.objects.filter(field_key=old).update(field_key=new)
        ShipmentComment.objects.filter(field_key=old).update(field_key=new)
        # #cell:<key> tokens stored verbatim inside comment text.
        for comment in ShipmentComment.objects.filter(content__contains=f'#cell:{old}'):
            comment.content = comment.content.replace(f'#cell:{old}', f'#cell:{new}')
            comment.save(update_fields=['content'])
        # ?row=<key> deep-link param in mention/task notification links.
        for note in Notification.objects.filter(link__contains=f'row={old}'):
            note.link = note.link.replace(f'row={old}', f'row={new}')
            note.save(update_fields=['link'])


def forwards(apps, schema_editor):
    _remap(apps, FORWARD)


def backwards(apps, schema_editor):
    _remap(apps, BACKWARD)


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0041_rename_shipment_export_codes'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
