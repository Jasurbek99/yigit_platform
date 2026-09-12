"""Seed the Russian spelling of each border point.

The TIR carnet prints the crossing in Russian; `BorderPoint.name` holds the Latin
Turkmen form, which a Russian customs document cannot use.

Three of these are taken from the office's own workbook (`data/tir_carnet.xlsx`
prints `Гарабогаз`, and its second sheet lists `Фарап` and `Дашогуз`). The other
two are transliterations and are the reason the field is editable from
*Admin → Shipment settings → Border points* — the team corrects them there rather
than waiting on a migration.

Only fills a blank `name_ru`, so re-running never overwrites a hand-corrected value.
"""
from django.db import migrations

RU_NAMES = {
    'Garabogaz': 'Гарабогаз',   # from the sample carnet
    'Farap': 'Фарап',           # from the workbook's second sheet
    'Dasoguz': 'Дашогуз',       # from the workbook's second sheet
    'Bekdas': 'Бекдаш',         # transliteration — confirm on the admin screen
    'Sarahs': 'Серахс',         # transliteration — confirm on the admin screen
}


def seed(apps, schema_editor):
    BorderPoint = apps.get_model('core', 'BorderPoint')
    for name, name_ru in RU_NAMES.items():
        BorderPoint.objects.filter(name=name, name_ru='').update(name_ru=name_ru)


def unseed(apps, schema_editor):
    BorderPoint = apps.get_model('core', 'BorderPoint')
    BorderPoint.objects.filter(name__in=RU_NAMES, name_ru__in=RU_NAMES.values()).update(name_ru='')


class Migration(migrations.Migration):

    dependencies = [('core', '0049_borderpoint_name_ru')]

    operations = [migrations.RunPython(seed, unseed)]
