"""Migration A2: add customs_clearance_planned_day to Shipment.

Pure AddField — no data migration needed.
Sirin's planned weekday for customs clearance preparation.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0008_drop_legacy_fields_add_manager_note'),
    ]

    operations = [
        migrations.AddField(
            model_name='shipment',
            name='customs_clearance_planned_day',
            field=models.CharField(
                max_length=12,
                blank=True,
                default='',
                choices=[
                    ('mon', 'Mon'),
                    ('tue', 'Tue'),
                    ('wed', 'Wed'),
                    ('thu', 'Thu'),
                    ('fri', 'Fri'),
                    ('sat', 'Sat'),
                    ('sun', 'Sun'),
                ],
                help_text="Sirin's planned weekday for customs clearance prep",
            ),
        ),
    ]
