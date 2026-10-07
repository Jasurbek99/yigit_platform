"""Backfill: every shipment with no product becomes tomato (pepper spec 2026-10-05).

Reads of a NULL product already mean tomato; this just makes it explicit so the
`?product_type=` filter and the Sheet row show a value. Reversible as a no-op
(we cannot tell backfilled rows from deliberate tomato ones).
"""
from django.db import migrations


def backfill(apps, schema_editor):
    ProductType = apps.get_model('core', 'ProductType')
    Shipment = apps.get_model('export', 'Shipment')
    tomato = ProductType.objects.filter(code='tomato').first()
    if tomato is not None:
        Shipment.objects.filter(product_type__isnull=True).update(product_type=tomato)


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0096_seed_export_date_row'),
        ('core', '0074_seed_pepper_products'),
    ]

    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
