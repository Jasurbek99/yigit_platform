"""Seed the legal-entity forms found in the live firm data.

Turkmen forms (HJ / HT / HK) come from the export firms; the rest come from the
119 import firms. Positions are taken from how each form is actually written,
not from a rule — HJ trails the name in Turkmen while HT leads it.

Genitive forms are filled only for the Turkmen and Kazakh types the export
contract's preamble names today; the rest are left blank for staff to fill from
the new settings screen when a contract for that country is first generated.
"""
from django.db import migrations

# code, abbr tk/ru/en, full tk/ru/en, gen tk/ru, pos tk/ru/en, sort, country ISO codes
LEGAL_TYPES = [
    (
        'HJ', 'HJ', 'ХО', 'HJ',
        'Hojalyk jemgyýeti', 'Хозяйственное общество', 'Economic society',
        'hojalyk jemgyýetiniň', 'Хозяйственного общества',
        'SUFFIX', 'PREFIX', 'SUFFIX', 10, ['TM'],
    ),
    (
        'HT', 'HT', 'ИП', 'IE',
        'Hususy telekeçi', 'Индивидуальный предприниматель', 'Individual entrepreneur',
        'hususy telekeçiniň', 'Индивидуального предпринимателя',
        'PREFIX', 'PREFIX', 'PREFIX', 20, ['TM'],
    ),
    (
        'HK', 'HK', 'ЧП', 'PE',
        'Hususy kärhana', 'Частное предприятие', 'Private enterprise',
        'hususy kärhananyň', 'Частного предприятия',
        'SUFFIX', 'PREFIX', 'PREFIX', 30, ['TM'],
    ),
    (
        'OOO', 'JÇJ', 'ООО', 'LLC',
        'Jogapkärçiligi çäklendirilen jemgyýet',
        'Общество с ограниченной ответственностью', 'Limited liability company',
        'jogapkärçiligi çäklendirilen jemgyýetiniň',
        'Общества с ограниченной ответственностью',
        'SUFFIX', 'PREFIX', 'PREFIX', 40, ['RU', 'UZ', 'KG', 'AZ', 'BY'],
    ),
    (
        'TOO', 'JÇB', 'ТОО', 'LLP',
        'Jogapkärçiligi çäklendirilen birleşme',
        'Товарищество с ограниченной ответственностью',
        'Limited liability partnership',
        'jogapkärçiligi çäklendirilen birleşmesiniň',
        'Товарищества с ограниченной ответственностью',
        'SUFFIX', 'PREFIX', 'PREFIX', 50, ['KZ'],
    ),
    (
        'OSOO', 'JÇJ', 'ОсОО', 'LLC',
        'Jogapkärçiligi çäklendirilen jemgyýet',
        'Общество с ограниченной ответственностью', 'Limited liability company',
        'jogapkärçiligi çäklendirilen jemgyýetiniň',
        'Общества с ограниченной ответственностью',
        'SUFFIX', 'PREFIX', 'PREFIX', 60, ['KG'],
    ),
    (
        'IP', 'HT', 'ИП', 'IE',
        'Hususy telekeçi', 'Индивидуальный предприниматель', 'Individual entrepreneur',
        'hususy telekeçiniň', 'Индивидуального предпринимателя',
        'PREFIX', 'PREFIX', 'PREFIX', 70, ['KZ', 'KG', 'RU', 'UZ'],
    ),
    (
        # abbr_ru is the Cyrillic МЧЖ the buyer names actually use; full_ru is the
        # Russian equivalent, not a transliteration of the Uzbek.
        'MCHJ', 'JÇJ', 'МЧЖ', 'LLC',
        'Jogapkärçiligi çäklendirilen jemgyýet',
        'Общество с ограниченной ответственностью', 'Limited liability company',
        '', '',
        'SUFFIX', 'PREFIX', 'PREFIX', 80, ['UZ'],
    ),
    (
        'TOV', 'JÇJ', 'ТОВ', 'LLC',
        'Jogapkärçiligi çäklendirilen jemgyýet',
        'Товариство з обмеженою відповідальністю', 'Limited liability company',
        '', '',
        'SUFFIX', 'PREFIX', 'PREFIX', 90, ['UA'],
    ),
    (
        # Written in Latin even inside Russian text ('LLC "Boli Zarrin"'), so the
        # Russian abbreviation is LLC — 'ЛЛС' is not a form anyone writes.
        'LLC', 'JÇJ', 'LLC', 'LLC',
        'Jogapkärçiligi çäklendirilen jemgyýet',
        'Общество с ограниченной ответственностью', 'Limited liability company',
        '', '',
        'SUFFIX', 'PREFIX', 'PREFIX', 100, ['TJ', 'AE', 'KG', 'AF'],
    ),
    (
        # Same: LTD stays Latin in Russian documents.
        'LTD', 'LTD', 'LTD', 'LTD',
        'Çäklendirilen jogapkärçilikli kompaniýa',
        'Компания с ограниченной ответственностью', 'Limited',
        '', '',
        'SUFFIX', 'SUFFIX', 'SUFFIX', 110, ['AE', 'AF', 'TJ'],
    ),
    (
        'FH', 'Daýhan hojalygy', 'ФХ', 'Farm',
        'Daýhan hojalygy', 'Фермерское хозяйство', 'Farming enterprise',
        '', '',
        'PREFIX', 'PREFIX', 'PREFIX', 120, ['UZ', 'KZ'],
    ),
]

FIELDS = (
    'abbr_tk', 'abbr_ru', 'abbr_en',
    'full_tk', 'full_ru', 'full_en',
    'gen_tk', 'gen_ru',
    'position_tk', 'position_ru', 'position_en',
    'sort_order',
)


def seed_legal_types(apps, schema_editor):
    CompanyLegalType = apps.get_model('core', 'CompanyLegalType')
    Country = apps.get_model('core', 'Country')
    by_iso = {c.code: c for c in Country.objects.all() if c.code}

    for row in LEGAL_TYPES:
        code, rest, iso_codes = row[0], row[1:-1], row[-1]
        obj, _ = CompanyLegalType.objects.get_or_create(
            code=code, defaults=dict(zip(FIELDS, rest)),
        )
        countries = [by_iso[iso] for iso in iso_codes if iso in by_iso]
        if countries:
            obj.countries.set(countries)


def unseed_legal_types(apps, schema_editor):
    CompanyLegalType = apps.get_model('core', 'CompanyLegalType')
    # PROTECT on the firm FKs means a type still in use blocks its own removal,
    # which is the intended safety net — reversing this migration after the
    # backfill requires reversing 0046 first.
    CompanyLegalType.objects.filter(code__in=[r[0] for r in LEGAL_TYPES]).delete()


class Migration(migrations.Migration):

    dependencies = [('core', '0044_company_legal_type')]

    operations = [migrations.RunPython(seed_legal_types, unseed_legal_types)]
