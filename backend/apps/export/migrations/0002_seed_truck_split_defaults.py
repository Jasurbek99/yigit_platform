"""Seed the legacy DEFAULT_TRUCK_WEIGHTS values for TruckSplitDefault:

(1, 18100), (2, 9000), (3, 6000)

The values are the OFFICIAL kg-per-firm written on export documents — the
legal cap is 18,100 kg total per truck. Trucks really carry 20,000-21,000 kg
but documents always use the cap. Director can change values from
/admin/shipment-settings.

Re-emitted after the schema collapse refactor. Idempotent via get_or_create.
Skipped when DJANGO_TESTING=true.
"""
import os
from decimal import Decimal

from django.db import migrations


def seed_defaults(apps, schema_editor):
    if os.environ.get('DJANGO_TESTING') == 'true':
        return
    TruckSplitDefault = apps.get_model('export', 'TruckSplitDefault')
    for num_firms, kg in [(1, '18100'), (2, '9000'), (3, '6000')]:
        TruckSplitDefault.objects.get_or_create(
            num_firms=num_firms,
            defaults={'kg_per_firm': Decimal(kg)},
        )


def unseed(apps, schema_editor):
    TruckSplitDefault = apps.get_model('export', 'TruckSplitDefault')
    TruckSplitDefault.objects.filter(num_firms__in=[1, 2, 3]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(seed_defaults, reverse_code=unseed),
    ]
