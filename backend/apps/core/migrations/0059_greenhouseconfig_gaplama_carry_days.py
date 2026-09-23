# Generated migration for gaplama_carry_days field

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0058_quality_inspector_tir_takip_pages"),
    ]

    operations = [
        migrations.AddField(
            model_name="greenhouseconfig",
            name="gaplama_carry_days",
            field=models.PositiveSmallIntegerField(default=2),
        ),
    ]
