# Data migration: seed the 21 expense categories from the former TextChoices enum.
# Labels taken from frontend/src/i18n/{en,ru,tk}.json at key
# sales_report.expense.<CODE>.  get_or_create keyed on ``code`` keeps it
# idempotent (safe to re-run).

from django.db import migrations


# Ordered list mirrors the former ExpenseCategoryEnum definition.
# Fields: (code, name_en, name_ru, name_tk)
_CATEGORIES = [
    ('TOM_ROSHOD',          'Tom Roshod',              'Том рошод',                    'Tom roşod'),
    ('NAKLIYE',             'Nakliye (freight)',        'Накилие (перевозка)',           'Nakliye (ulag)'),
    ('BAZAR_ROSHOD',        'Market Expenditure',       'Базар рошод',                  'Bazar roşod'),
    ('INTERES',             'Interest',                 'Проценты',                     'Göterim (interes)'),
    ('UZBEK_FURA_AWANS',    'Uzbek Truck Advance',      'Узбекский фур аванс',          'Özbek fura awans'),
    ('DOZWOL',              'Permit (Doswol)',           'Досвол (разрешение)',           'Doswol (rugsat)'),
    ('ANALIZ',              'Analysis',                 'Анализ',                       'Analiz'),
    ('PROSTOY',             'Demurrage (Prostoy)',       'Простой',                      'Prostoy (durmaçylyk)'),
    ('PERESEPKA',           'Transshipment Fee',        'Пересепка (перегрузка)',        'Peresepka (geçiriş)'),
    ('ARAP',                'Arap Payment',             'Арап платёж',                  'Arap töleg'),
    ('KASPIY_KOMIS',        'Caspian Commission',       'Каспийская комиссия',          'Kaspi komissiýa'),
    ('UZBEK_FURA_SOLYARKA', 'Uzbek Truck Fuel',         'Узбекский фур соляра',         'Özbek fura solyarka'),
    ('NDS',                 'VAT (NDS)',                'НДС',                          'NDS (goşulan baha salgyt)'),
    ('SBOR',                'Collection Fee',           'Сбор',                         'Sbor (ýygym)'),
    ('UZB_KAZ_POST',        'Uzb-Kaz Duty',             'Узб.-Каз. пошлина',            'Özbek-Gazak posta'),
    ('UZB_KAZ_NAKLIYE',     'Uzb-Kaz Freight',          'Узб.-Каз. перевозка',          'Özbek-Gazak nakliye'),
    ('UZBEK_TAM',           'Uzbek Customs',            'Узбекская таможня',            'Özbek gümrük'),
    ('MOI',                 'MOI Payment',              'МОИ платёж',                   'MOI töleg'),
    ('DOSMOTR',             'Inspection',               'Досмотр',                      'Dosmotr (barlag)'),
    ('PEREWOT',             'Transfer',                 'Перевод',                      'Peréwot (terjime)'),
    ('OTHER',               'Other',                    'Прочее',                       'Beýleki'),
]


def seed_categories(apps, schema_editor):
    ExpenseCategory = apps.get_model('export', 'ExpenseCategory')
    for sort_order, (code, name_en, name_ru, name_tk) in enumerate(_CATEGORIES):
        ExpenseCategory.objects.get_or_create(
            code=code,
            defaults={
                'name_en': name_en,
                'name_ru': name_ru,
                'name_tk': name_tk,
                'logo_code': None,
                'sort_order': sort_order,
                'is_active': True,
            },
        )


def unseed_categories(apps, schema_editor):
    ExpenseCategory = apps.get_model('export', 'ExpenseCategory')
    codes = [row[0] for row in _CATEGORIES]
    ExpenseCategory.objects.filter(code__in=codes).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0048_add_expense_category_model_and_fk'),
    ]

    operations = [
        migrations.RunPython(seed_categories, reverse_code=unseed_categories),
    ]
