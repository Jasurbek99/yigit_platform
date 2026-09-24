"""Widen the block-source key to (shipment, block, harvest_date).

MSSQL permits exactly ONE null row per unique key combination, unlike Postgres, so
every null harvest_date must be filled before the constraint is applied or the
migration fails on the first shipment/block pair with two null rows.

Backfill rule (owner-confirmed): the shipment's own harvest_date when set, else the
shipment date. This writes a date onto rows an operator left blank, which is visible
on Sheet R39.
"""
from django.db import migrations, models


def backfill_harvest_dates(apps, schema_editor):
    ShipmentBlockSource = apps.get_model('export', 'ShipmentBlockSource')
    rows = ShipmentBlockSource.objects.filter(harvest_date__isnull=True).select_related('shipment')
    to_update = []
    for row in rows:
        row.harvest_date = row.shipment.harvest_date or row.shipment.date
        to_update.append(row)
    if to_update:
        ShipmentBlockSource.objects.bulk_update(to_update, ['harvest_date'], batch_size=500)


def noop_reverse(apps, schema_editor):
    """Not reversible in data: which dates were originally blank is not recorded."""


class Migration(migrations.Migration):

    dependencies = [
        ("export", "0076_quality_certificate_filename_collation"),
    ]

    operations = [
        migrations.RunPython(backfill_harvest_dates, noop_reverse),
        migrations.AlterUniqueTogether(
            name="shipmentblocksource",
            unique_together={("shipment", "block", "harvest_date")},
        ),
    ]
