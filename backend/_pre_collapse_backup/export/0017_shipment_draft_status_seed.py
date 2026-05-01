"""Data migration: insert the 'draft' ShipmentStatusType row (step 0, pre-lifecycle).

Forward: insert {code='draft', step_order=0} if not already present.
Reverse: delete the row (only if it still exists — no FK cascade to worry about
         because draft shipments must be cleaned up before squashing).
"""
from django.db import migrations


def insert_draft_status(apps, schema_editor):
    """Insert the draft status row at step_order=0 if it does not exist."""
    ShipmentStatusType = apps.get_model('core', 'ShipmentStatusType')
    ShipmentStatusType.objects.get_or_create(
        code='draft',
        defaults={
            'name_tk': 'Garalama',
            'name_ru': 'Черновик',
            'name_en': 'Draft',
            'step_order': 0,
            'required_role': 'warehouse_chief',
            'phase': 'DRAFT',
        },
    )


def delete_draft_status(apps, schema_editor):
    """Remove the draft status row on migration reversal."""
    ShipmentStatusType = apps.get_model('core', 'ShipmentStatusType')
    ShipmentStatusType.objects.filter(code='draft').delete()


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0016_add_cyrillic_collation_notes'),
        # core app must be applied first so ShipmentStatusType table exists.
        ('core', '0009_customer_fk_on_delete_protect'),
    ]

    operations = [
        migrations.RunPython(
            insert_draft_status,
            reverse_code=delete_draft_status,
        ),
    ]
