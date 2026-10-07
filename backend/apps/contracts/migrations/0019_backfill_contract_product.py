"""Backfill: every contract with no product becomes tomato (pepper spec 2026-10-05).

Reads of a NULL product already mean tomato; this just makes it explicit.
Reversible as a no-op (backfilled rows cannot be told from deliberate tomato ones).
"""
from django.db import migrations


def backfill(apps, schema_editor):
    ProductType = apps.get_model('core', 'ProductType')
    Contract = apps.get_model('contracts', 'Contract')
    tomato = ProductType.objects.filter(code='tomato').first()
    if tomato is not None:
        Contract.objects.filter(product_type__isnull=True).update(product_type=tomato)


class Migration(migrations.Migration):

    dependencies = [
        ('contracts', '0018_contract_product_type'),
        ('core', '0074_seed_pepper_products'),
    ]

    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
