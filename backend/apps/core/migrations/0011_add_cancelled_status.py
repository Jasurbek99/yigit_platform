"""Seed the 'cancelled' ShipmentStatusType row.

Cancelled is a 14th terminal status reachable from any non-terminal status.
Step_order=99 (above active steps 0-12, below retired 100+).
Phase='CANCELLED'.
trigger_field=None — auto-advance can never fire from this status.

Idempotent via update_or_create.
Skipped when DJANGO_TESTING=true (tests seed this row directly in setUp).
"""
import os

from django.db import migrations


def add_cancelled_status(apps, schema_editor):
    if os.environ.get('DJANGO_TESTING') == 'true':
        return
    ShipmentStatusType = apps.get_model('core', 'ShipmentStatusType')
    ShipmentStatusType.objects.update_or_create(
        code='cancelled',
        defaults={
            'name_tk': 'Ýatyryldy',
            'name_ru': 'Отменён',
            'name_en': 'Cancelled',
            'step_order': 99,
            'phase': 'CANCELLED',
            'is_active': True,
            'required_role': None,
        },
    )


def remove_cancelled_status(apps, schema_editor):
    ShipmentStatusType = apps.get_model('core', 'ShipmentStatusType')
    ShipmentStatusType.objects.filter(code='cancelled').delete()


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0010_state_machine_v2'),
    ]

    operations = [
        migrations.RunPython(
            add_cancelled_status,
            reverse_code=remove_cancelled_status,
        ),
    ]
