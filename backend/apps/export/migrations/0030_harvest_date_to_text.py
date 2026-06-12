"""Convert Shipment.harvest_date from DateField to free-text CharField.

Operators asked for the Sheet R39 harvest-day cell to accept free text (single
days, ranges like "5-10 oktýabr", notes) instead of a calendar picker. The
column changes type via add → populate → remove → rename so no data is lost and
the migration runs identically on MSSQL (prod) and SQLite (tests).

The populate step preserves what operators *currently see* in the Sheet cell:
the old getCellValue rendered the min–max range of per-block
ShipmentBlockSource.harvest_date values, falling back to Shipment.harvest_date,
all formatted DD.MM.YYYY.
"""

from django.db import migrations, models


def populate_text(apps, schema_editor):
    Shipment = apps.get_model('export', 'Shipment')
    for shipment in Shipment.objects.all().iterator():
        block_dates = sorted(
            b.harvest_date
            for b in shipment.block_sources.all()
            if b.harvest_date is not None
        )
        if block_dates:
            first = block_dates[0].strftime('%d.%m.%Y')
            last = block_dates[-1].strftime('%d.%m.%Y')
            text = first if first == last else f'{first}–{last}'
        elif shipment.harvest_date is not None:
            text = shipment.harvest_date.strftime('%d.%m.%Y')
        else:
            text = None
        if text is not None:
            shipment.harvest_date_text = text
            shipment.save(update_fields=['harvest_date_text'])


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0029_rename_style_label_color_to_font_color'),
    ]

    operations = [
        migrations.AddField(
            model_name='shipment',
            name='harvest_date_text',
            field=models.CharField(
                blank=True,
                db_collation='Cyrillic_General_CI_AS',
                max_length=100,
                null=True,
            ),
        ),
        migrations.RunPython(populate_text, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name='shipment',
            name='harvest_date',
        ),
        migrations.RenameField(
            model_name='shipment',
            old_name='harvest_date_text',
            new_name='harvest_date',
        ),
    ]
