"""Create the TruckSplitDefault model + seed (1, 18100), (2, 9000), (3, 6000).

The values are the OFFICIAL kg-per-firm written on export documents — the
legal cap is 18,100 kg total per truck. Trucks really carry 20,000–21,000 kg
but documents always use the cap. The director can change these values from
/admin/shipment-settings.

Forward: create the table + seed three rows.
Reverse: drop the table.
"""
from decimal import Decimal

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion

from apps.core.db_utils import schema_table


def seed_defaults(apps, schema_editor):
    """Seed the legacy DEFAULT_TRUCK_WEIGHTS values."""
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
        ('export', '0022_fix_varieties_dominant_db_table'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='TruckSplitDefault',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('num_firms', models.PositiveSmallIntegerField(unique=True)),
                ('kg_per_firm', models.DecimalField(decimal_places=2, max_digits=10)),
                ('notes', models.CharField(blank=True, db_collation='Cyrillic_General_CI_AS', max_length=200, null=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('updated_by', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='truck_split_updates',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'db_table': schema_table('export', 'truck_split_defaults'),
                'ordering': ['num_firms'],
            },
        ),
        migrations.RunPython(seed_defaults, reverse_code=unseed),
    ]
