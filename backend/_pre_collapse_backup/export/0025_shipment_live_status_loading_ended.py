"""Add Shipment.vehicle_live_status (R15) and Shipment.loading_ended_at (R20).

R15 — vehicle_live_status: free-text live status maintained by the dispatcher
(haltac role). Replaces the prior orphan `truck_capacity` placeholder; captures
where the truck is right now and ETA back to the greenhouse. Distinct from
route_note (R2 — general transport note) and vehicle_condition / _note
(R3 — mechanical state).

R20 — loading_ended_at: operator-entered timestamp for when the warehouse
finished loading the truck. NOT an AD-1 timestamp — those are advanced only
by transition_to(). Distinct from departed_at (R21, AD-1) which is set when
the truck physically leaves the greenhouse.

Cyrillic collation on the text field follows the rest of the model's
Turkmen/Russian text columns (see .claude/rules/mssql-compat.md).
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0024_truck_split_notes_cyrillic'),
    ]

    operations = [
        migrations.AddField(
            model_name='shipment',
            name='vehicle_live_status',
            field=models.CharField(
                blank=True,
                db_collation='Cyrillic_General_CI_AS',
                max_length=300,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name='shipment',
            name='loading_ended_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
