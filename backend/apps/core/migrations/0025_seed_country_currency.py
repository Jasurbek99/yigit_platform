# Data migration: seed currency codes for known countries.
# Keyed on Country.code (case-insensitive). Others are left null.

from django.db import migrations


_COUNTRY_CURRENCIES = {
    'KZ': 'KZT',
    'RU': 'RUB',
}


def seed_currency(apps, schema_editor):
    Country = apps.get_model('core', 'Country')
    for code, currency in _COUNTRY_CURRENCIES.items():
        Country.objects.filter(code__iexact=code).update(currency=currency)


def unseed_currency(apps, schema_editor):
    Country = apps.get_model('core', 'Country')
    for code in _COUNTRY_CURRENCIES:
        Country.objects.filter(code__iexact=code).update(currency=None)


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0024_add_country_currency'),
    ]

    operations = [
        migrations.RunPython(seed_currency, reverse_code=unseed_currency),
    ]
