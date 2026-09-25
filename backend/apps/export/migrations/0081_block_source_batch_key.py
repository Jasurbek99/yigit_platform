"""Widen the block-source key to (shipment, block, harvest_date).

No backfill. `mssql-django` renders this `unique_together` as a FILTERED unique
index — `CREATE UNIQUE INDEX ... WHERE [shipment_id] IS NOT NULL AND [block_id]
IS NOT NULL AND [harvest_date] IS NOT NULL` (confirmed via `sqlmigrate export
0081`) — which excludes any row with a null `harvest_date` from the index
entirely. Any number of `(shipment, block, NULL)` rows can coexist; the "MSSQL
permits exactly ONE null row per unique key combination" rule (true in general —
see `.claude/rules/mssql-compat.md` — and true of a plain unique constraint/index)
does not apply to a *filtered* index like this one, so there is nothing for a
backfill to protect against here.

A backfill was tried and rejected (owner-confirmed): `Shipment.harvest_date` is
a free-text `CharField` (Sheet R39 operator entry — ranges, notes, non-ISO
formats like "13-15.06.2026"), not a parseable date, so filling
`ShipmentBlockSource.harvest_date` from it would abort on non-ISO rows and would
also overwrite an operator's deliberate blank on the rows that did parse. A null
`harvest_date` stays legal after this migration and is consumed FIFO by the
Gaplama board's fallback (Task 4), so leaving it null is the correct behavior,
not a gap.
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("export", "0080_task_one_per_shipment_rule"),
    ]

    operations = [
        migrations.AlterUniqueTogether(
            name="shipmentblocksource",
            unique_together={("shipment", "block", "harvest_date")},
        ),
    ]
