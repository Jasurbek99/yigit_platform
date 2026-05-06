"""Migration E: add Shipment.status_changed_at and backfill from ShipmentStatusLog.

For each shipment:
  - status_changed_at = max(ShipmentStatusLog.changed_at) for that shipment
  - if no log rows exist, fall back to shipment.created_at

Uses bulk_update with batch_size=500 per CLAUDE.md.
"""

import django.utils.timezone
from django.db import migrations, models


def backfill_status_changed_at(apps, schema_editor):
    """Backfill status_changed_at from ShipmentStatusLog or created_at fallback."""
    Shipment = apps.get_model('export', 'Shipment')
    ShipmentStatusLog = apps.get_model('export', 'ShipmentStatusLog')

    # Build a dict: shipment_id → max(changed_at) from the log.
    # Values() + order_by allows us to avoid GROUP BY issues on MSSQL
    # while keeping a single query. We iterate and track max per shipment_id.
    log_rows = (
        ShipmentStatusLog.objects
        .values('shipment_id', 'changed_at')
        .order_by('shipment_id', '-changed_at')
    )
    max_changed: dict = {}
    for row in log_rows:
        sid = row['shipment_id']
        if sid not in max_changed:
            # First row (DESC order) is the max for this shipment
            max_changed[sid] = row['changed_at']

    # Fetch all shipments that need backfilling.
    shipments = list(Shipment.objects.filter(status_changed_at__isnull=True).only(
        'id', 'created_at', 'status_changed_at',
    ))

    to_update = []
    for shipment in shipments:
        ts = max_changed.get(shipment.id)
        shipment.status_changed_at = ts if ts is not None else shipment.created_at
        to_update.append(shipment)

    if to_update:
        Shipment.objects.bulk_update(to_update, ['status_changed_at'], batch_size=500)


def noop(apps, schema_editor):
    """Reverse migration is a no-op — field removal handles data loss."""
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0010_task_taskrule'),
    ]

    operations = [
        migrations.AddField(
            model_name='shipment',
            name='status_changed_at',
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.RunPython(backfill_status_changed_at, reverse_code=noop),
    ]
