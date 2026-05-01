"""Seed the 'draft' ShipmentStatusType row (step_order=0, pre-lifecycle).

Re-emitted after the schema collapse refactor. Was previously in
export.0017 but the model lives in core, so it now belongs in core
migrations. Idempotent via get_or_create.

Note: only the 'draft' row is seeded here. The other 12 lifecycle rows
come from data import (docs/IMPORT_TASKS.md) or from the legacy DB copy
(step 7.5 of the schema collapse plan). Skipped when DJANGO_TESTING=true.
"""
import os

from django.db import migrations


def insert_draft_status(apps, schema_editor):
    if os.environ.get('DJANGO_TESTING') == 'true':
        return
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
    ShipmentStatusType = apps.get_model('core', 'ShipmentStatusType')
    ShipmentStatusType.objects.filter(code='draft').delete()


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0005_seed_greenhouse_config'),
    ]

    operations = [
        migrations.RunPython(
            insert_draft_status,
            reverse_code=delete_draft_status,
        ),
    ]
