"""Add warehouse_note and document_note text fields on Shipment.

Replaces the legacy comment-count cells (R17/R18) with first-class freeform
notes owned by Soltanmyrat (loading_dept_head + warehouse_chief) and Şirin
(document_team) respectively. See sheet_rows.py R17/R18 entries.

Data migration:
  - Nullifies field_key on ShipmentComment rows that pointed at the dropped
    'warehouse_comment_count' / 'document_comment_count' field keys, so any
    existing comment threads are preserved as shipment-level comments.
"""

from django.db import migrations, models


def _demote_legacy_comment_keys(apps, schema_editor):
    """Drop the dead field_key references so comments survive as shipment-level."""
    ShipmentComment = apps.get_model('export', 'ShipmentComment')
    dead_keys = ['warehouse_comment_count', 'document_comment_count']
    ShipmentComment.objects.filter(field_key__in=dead_keys).update(field_key=None)


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0012_add_loading_ended_at'),
    ]

    operations = [
        migrations.AddField(
            model_name='shipment',
            name='warehouse_note',
            field=models.TextField(
                blank=True,
                default='',
                db_collation='Cyrillic_General_CI_AS',
            ),
        ),
        migrations.AddField(
            model_name='shipment',
            name='document_note',
            field=models.TextField(
                blank=True,
                default='',
                db_collation='Cyrillic_General_CI_AS',
            ),
        ),
        migrations.RunPython(
            _demote_legacy_comment_keys,
            reverse_code=migrations.RunPython.noop,
        ),
    ]
