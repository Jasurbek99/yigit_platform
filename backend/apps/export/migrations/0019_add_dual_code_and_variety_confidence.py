"""Add official_export_code, previous_platform_id, variety_confidence, varieties_dominant to Shipment."""

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0010_add_variety_codes_and_seed'),
        ('export', '0018_alter_notification_kind'),
    ]

    operations = [
        migrations.AddField(
            model_name='shipment',
            name='official_export_code',
            field=models.CharField(blank=True, db_index=True, max_length=30, null=True),
        ),
        migrations.AddField(
            model_name='shipment',
            name='previous_platform_id',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='reroutes',
                to='export.shipment',
            ),
        ),
        migrations.AddField(
            model_name='shipment',
            name='variety_confidence',
            field=models.CharField(
                choices=[
                    ('high', 'From pallet data'),
                    ('low', 'Manually estimated'),
                    ('none', 'Pending packaging'),
                ],
                default='none',
                max_length=10,
            ),
        ),
        migrations.AddField(
            model_name='shipment',
            name='varieties_dominant',
            field=models.ManyToManyField(
                blank=True,
                related_name='shipments_dominant_in',
                to='core.tomatovariety',
            ),
        ),
    ]
