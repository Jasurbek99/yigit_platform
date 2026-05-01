"""Seed TomatoVariety rows: 10 official + 3 experimental varieties.

Re-emitted after the schema collapse refactor. Idempotent via update_or_create.
Skipped when DJANGO_TESTING=true.
"""
import os

from django.db import migrations


_VARIETIES = [
    # (code, name, type, is_experimental, scientific_name)
    ('01', 'Marvelans',   None,              False, ''),
    ('02', 'Midelice',    None,              False, ''),
    ('03', 'Sort-1',      'salkym/gulpakly', False, ''),
    ('04', 'Juanita',     None,              False, ''),
    ('05', 'MIX',         None,              False, ''),
    ('06', 'Fujimaro',    None,              False, ''),
    ('07', 'Defensiosa',  None,              False, 'DRTH0072'),
    ('08', 'Redity',      None,              False, 'DRTH1050'),
    ('09', 'Runtino',     None,              False, ''),
    ('10', 'Sort-2',      None,              False, ''),
    ('E1', 'Dakota',      None,              True,  ''),
    ('E2', 'Martinique',  None,              True,  ''),
    ('E3', 'Perimos',     None,              True,  ''),
]


def seed_varieties(apps, schema_editor):
    if os.environ.get('DJANGO_TESTING') == 'true':
        return
    TomatoVariety = apps.get_model('core', 'TomatoVariety')
    for code, name, variety_type, is_experimental, scientific_name in _VARIETIES:
        TomatoVariety.objects.update_or_create(
            name=name,
            defaults={
                'code': code,
                'is_experimental': is_experimental,
                'scientific_name': scientific_name,
                'type': variety_type,
            },
        )


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0002_seed_shipment_option_types'),
    ]

    operations = [
        migrations.RunPython(seed_varieties, noop),
    ]
