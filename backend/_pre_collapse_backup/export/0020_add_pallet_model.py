"""Create the Pallet model for per-pallet manifest entries.

Each pallet records (crate_type, crate_count, gross_weight, pallet_weight,
additions, variety, sub_block, loaded_at, created_by). Net weight is derived
at the Python property level; no stored column is needed.
"""

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0011_add_crate_type_and_weight_master_role'),
        ('export', '0019_add_dual_code_and_variety_confidence'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='Pallet',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('pallet_number', models.PositiveSmallIntegerField()),
                ('crate_count', models.PositiveSmallIntegerField()),
                ('gross_weight_kg', models.DecimalField(decimal_places=2, max_digits=8)),
                ('pallet_weight_kg', models.DecimalField(decimal_places=2, max_digits=6)),
                ('additions_kg', models.DecimalField(decimal_places=2, default=0, max_digits=6)),
                ('loaded_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('shipment', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='pallets',
                    to='export.shipment',
                )),
                ('crate_type', models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT,
                    to='core.cratetype',
                )),
                ('variety', models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT,
                    to='core.tomatovariety',
                )),
                ('sub_block', models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT,
                    to='core.greenhouseblock',
                )),
                ('created_by', models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name='+',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'db_table': '[export].[pallets]',
                'ordering': ['shipment', 'pallet_number'],
            },
        ),
        migrations.AlterUniqueTogether(
            name='pallet',
            unique_together={('shipment', 'pallet_number')},
        ),
    ]
