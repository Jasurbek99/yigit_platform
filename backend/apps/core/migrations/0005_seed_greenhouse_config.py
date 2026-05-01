"""Seed the singleton GreenhouseConfig row (pk=1) with production defaults.

Re-emitted after the schema collapse refactor. Idempotent via get_or_create.
Skipped when DJANGO_TESTING=true.
"""
import datetime
import os
from decimal import Decimal

from django.db import migrations


def seed_greenhouse_config(apps, schema_editor):
    if os.environ.get('DJANGO_TESTING') == 'true':
        return
    GreenhouseConfig = apps.get_model('core', 'GreenhouseConfig')
    GreenhouseConfig.objects.get_or_create(
        pk=1,
        defaults={
            'plan_deadline_weekday': 4,
            'plan_late_until_weekday': 6,
            'plan_critical_late_at_weekday': 0,
            'plan_critical_late_at_time': datetime.time(0, 0),
            'forecast_primary_open': datetime.time(17, 0),
            'forecast_primary_close': datetime.time(18, 0),
            'forecast_fallback_close': datetime.time(9, 0),
            'forecast_same_day_close': datetime.time(23, 59),
            'notification_lead_minutes': 60,
            'truck_capacity_kg': Decimal('18500'),
            'operating_days_bitmask': 0b0111111,
            'timezone_name': 'Asia/Ashgabat',
        },
    )


def reverse_seed_greenhouse_config(apps, schema_editor):
    GreenhouseConfig = apps.get_model('core', 'GreenhouseConfig')
    GreenhouseConfig.objects.filter(pk=1).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0004_seed_crate_types'),
    ]

    operations = [
        migrations.RunPython(seed_greenhouse_config, reverse_seed_greenhouse_config),
    ]
