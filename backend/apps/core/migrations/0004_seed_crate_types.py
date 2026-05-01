"""Seed CrateType rows.

LEBIZ PLAST 18: 0.543 kg (verified from 10AP116_CEKIM_GAPAN.xlsx)
AGAÇ:           2.000 kg (placeholder, is_active=False — pending Soltanmyrat confirmation)
PLASMAS:        0.700 kg (placeholder, is_active=False — pending Soltanmyrat confirmation)

Re-emitted after the schema collapse refactor. Idempotent via update_or_create.
Skipped when DJANGO_TESTING=true.
"""
import os

from django.db import migrations


_CRATE_TYPES = [
    # (name, weight_kg, is_active)
    ('LEBIZ PLAST 18', '0.543', True),
    ('AGAÇ',           '2.000', False),
    ('PLASMAS',        '0.700', False),
]


def seed_crate_types(apps, schema_editor):
    if os.environ.get('DJANGO_TESTING') == 'true':
        return
    CrateType = apps.get_model('core', 'CrateType')
    for name, weight_kg, is_active in _CRATE_TYPES:
        CrateType.objects.update_or_create(
            name=name,
            defaults={'weight_kg': weight_kg, 'is_active': is_active},
        )


def reverse_crate_types(apps, schema_editor):
    CrateType = apps.get_model('core', 'CrateType')
    names = [row[0] for row in _CRATE_TYPES]
    CrateType.objects.filter(name__in=names).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0003_seed_tomato_varieties'),
    ]

    operations = [
        migrations.RunPython(seed_crate_types, reverse_crate_types),
    ]
