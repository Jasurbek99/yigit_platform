"""Rename the 'draft' shipment status label to «Подготовка» (2026-09-24).

Management objected to the word "draft" (Черновик / Garalama). Only the three
display names change: the status code stays 'draft', so transitions, task
rules, filters and the API are untouched.

Numbered 0064: feat/gaplama-batches merged into main first (PR #20) and took
0060-0063 (0062 was itself a merge migration reconciling two branches' 0059s;
0063 is an unrelated fix that landed on top of it), so this depends on that
chain's head rather than the pre-merge 0059 it was originally written against.

No-op on a database without the row (a DJANGO_TESTING database seeds none,
see 0006).
"""
from django.db import migrations

NEW_NAMES = {'name_tk': 'Taýýarlyk', 'name_en': 'Preparation', 'name_ru': 'Подготовка'}
OLD_NAMES = {'name_tk': 'Garalama', 'name_en': 'Draft', 'name_ru': 'Черновик'}


def rename_draft_label(apps, schema_editor):
    ShipmentStatusType = apps.get_model('core', 'ShipmentStatusType')
    ShipmentStatusType.objects.filter(code='draft').update(**NEW_NAMES)


def restore_draft_label(apps, schema_editor):
    ShipmentStatusType = apps.get_model('core', 'ShipmentStatusType')
    ShipmentStatusType.objects.filter(code='draft').update(**OLD_NAMES)


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0063_greenhouseblock_carry_days_min'),
    ]

    operations = [
        migrations.RunPython(rename_draft_label, reverse_code=restore_draft_label),
    ]
