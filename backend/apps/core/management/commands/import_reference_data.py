"""Management command: import reference data from Excel source files.

Extracts ExportFirms, ImportFirms, Customers, and Cities from the production
Excel workbooks and seeds them into the DDL v5.1 database.

Sources:
  - Export_contracts_20252026_1.xlsx  → ExportFirms (sellers sheet), ImportFirms (Buyers sheet)
  - Hasabat_202526.xlsx               → Customers (Saher sheet), additional Cities
  - Baha_Grafigi.xlsx                 → Cities (Sayfa1 header)

Usage:
    python manage.py import_reference_data
    python manage.py import_reference_data --dry-run
    python manage.py import_reference_data --excel-dir /path/to/data
"""
import re

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.core.models import Country, City, ExportFirm, ImportFirm, Customer


# ── Country code lookup (matches seed_data.py COUNTRIES) ──────────────────────
# Maps the country label variants found in CMR graphs sheet → DB code field
_COUNTRY_LABEL_TO_CODE = {
    # Kazakh variants
    'Kazakistan': 'KZ',
    'Kazakstan': 'KZ',
    'Kazahstan': 'KZ',
    'Gazagystan': 'KZ',
    'KZ': 'KZ',
    'Республика Казахстан': 'KZ',
    # Russian variants
    'Rusya Federasyonu': 'RU',
    'Rusya Federasyonu (Tirkish)': 'RU',
    'Russiya': 'RU',
    'Rossia': 'RU',
    'RU': 'RU',
    'Rossiya': 'RU',
    'Россия': 'RU',
    # Uzbek variants
    'Özbekistan': 'UZ',
    'Özbegistan': 'UZ',
    'Ozbekystan': 'UZ',
    'UZ': 'UZ',
    # Kyrgyz variants
    'Kırgızistan': 'KG',
    'Kyrgyzstan': 'KG',
    'Gyrgysyztan': 'KG',
    'Gyrgyzystan': 'KG',
    'KRGZ': 'KG',
    'KG': 'KG',
    # Tajik variants
    'TJK': 'TJ',
    'Tajigistan': 'TJ',
    'Tadjikistan': 'TJ',
    # Belarus variants
    'Belarus': 'BY',
    'Belarusiya': 'BY',
    'BY': 'BY',
    # Afghanistan
    'Owganystan': 'AF',
    'Afganistan': 'AF',
    'AF': 'AF',
    # Azerbaijan (not in seed but may appear)
    'Azerbaycan': 'AZ',
    'AZ': 'AZ',
}


# ── ExportFirm data (extracted from sellers sheet) ────────────────────────────
# 20 firms with confirmed codes; 4 firms (rows 17-20) lack a code and are skipped
EXPORT_FIRMS_DATA = [
    {
        'code': 'GB',
        'name_tk': '"Gök bulut" HJ',
        'name_ru': 'Х.О"Гок булут"',
        'name_en': 'Economic society "Gok bulut"',
        'address_tk': 'Türkmenistan, Aşgabat şäher, Köpetdag etrabynyň, Oguzhan köçesiniň, 41-njy jaýy.',
        'address_ru': 'Адрес: Туркменистан, г. Ашгабат, этрап Копетдаг, ул. Огузхан, дом №41',
        'address_en': 'Legal address: Oguzhan street, 41, Kopetdag district, Ashgabat city, Turkmenistan.',
        'director': 'Хемидов П.А.',
        'swift_code': 'INVATM2X',
    },
    {
        'code': 'HMS',
        'name_tk': '"Hemsaýa" HJ',
        'name_ru': 'Х.О"Хемсая"',
        'name_en': 'Economic society "Hemsaya"',
        'address_tk': 'Türkmenistan, Aşgabat şäher, Büzmeýin etrabynyň, Senagat köçesiniň, 2-nji jaýy.',
        'address_ru': 'Адрес: Туркменистан, г.Ашгабат, Бузмейинский этрап, ул.Сенагат, дом №2',
        'address_en': None,
        'director': 'Худайназаров Ы.',
        'swift_code': 'BDAYTM22',
    },
    {
        'code': 'MA',
        'name_tk': '"Miweli atyz" HJ',
        'name_ru': 'Х.О"Мивели атыз"',
        'name_en': 'Economic society "Miweli atyz"',
        'address_tk': 'Türkmenistan, Ahal welaýaty, Kaka etraby.',
        'address_ru': 'Адрес: Туркменистан, Ахалский велаят, Какинский этрап',
        'address_en': None,
        'director': 'Аллабердыев Ш.К.',
        'swift_code': 'INVATM2X',
    },
    {
        'code': 'DM',
        'name_tk': '"Datly miwe" HJ',
        'name_ru': 'Х.О «Датлы миве»',
        'name_en': 'Economic society "Datly miwe"',
        'address_tk': 'Türkmenistan, Ahal welaýaty, Kaka etraby.',
        'address_ru': 'Адрес: Туркменистан, Ахалский велаят, Какинский этрап',
        'address_en': None,
        'director': 'Маммедов А.А.',
        'swift_code': 'INVATM2X',
    },
    {
        'code': 'AB',
        'name_tk': '"Ak Bulut" HJ',
        'name_ru': 'Х.О"Ак Булут"',
        'name_en': None,
        'address_tk': None,
        'address_ru': None,
        'address_en': None,
        'director': 'Овезмурадов А.',
        'swift_code': 'INVATM2X',
    },
    {
        'code': 'DD',
        'name_tk': '"Döwletli-Döwran" HJ',
        'name_ru': 'Х.О "Довлетли-Довран"',
        'name_en': None,
        'address_tk': None,
        'address_ru': None,
        'address_en': None,
        'director': 'Хошвагтов Г.',
        'swift_code': 'INVATM2X',
    },
    {
        'code': 'YGT',
        'name_tk': '"Ýigit" HJ',
        'name_ru': 'Х.О "Йигит"',
        'name_en': 'Economic society "Yigit"',
        'address_tk': 'Türkmenistan, Ahal welaýaty, Kaka etraby.',
        'address_ru': 'Адрес: Туркменистан, Ахалский велаят, Какинский этрап',
        'address_en': None,
        'director': 'Чарыев А.',
        'swift_code': 'INVATM2X',
    },
    {
        'code': 'YE',
        'name_tk': '"Ygtybarly enjamlar" JH',
        'name_ru': 'ИП "Ыгтыбарлы энджамлар"',
        'name_en': 'Individual Enterprise "Ygtybarly enjamlar"',
        'address_tk': None,
        'address_ru': None,
        'address_en': None,
        'director': 'Худайбердиев А.А.',
        'swift_code': 'SBFETM22',
    },
    {
        'code': 'Eziz Doganlar',
        'name_tk': '"Eziz doganlar" HJ',
        'name_ru': 'Х.О «Эзиз доганлар»',
        'name_en': None,
        'address_tk': None,
        'address_ru': None,
        'address_en': None,
        'director': 'Акыев В.',
        'swift_code': 'INVATM2X',
    },
    {
        'code': 'Tel JD',
        'name_tk': 'Hususy Telekeçi Döwranow J.A.',
        'name_ru': 'И.П Довранов Дж.А.',
        'name_en': 'Individual entrepreneur Dovranov J.A.',
        'address_tk': None,
        'address_ru': None,
        'address_en': None,
        'director': 'Довранов Дж.А.',
        'swift_code': 'TUTCTM2X',
    },
    {
        'code': 'Tel ED',
        'name_tk': 'Hususy Telekeçi Döwranow E.A.',
        'name_ru': 'И.П Довранов Э.А.',
        'name_en': 'Individual entrepreneur Dovranov E.A.',
        'address_tk': None,
        'address_ru': None,
        'address_en': None,
        'director': 'Довранов Э.А.',
        'swift_code': 'TUTCTM2X',
    },
    {
        'code': 'Tel PH',
        'name_tk': 'Hususy Telekeçi Hemidow P.',
        'name_ru': 'И.П. Хемидов П.',
        'name_en': 'Individual entrepreneur Hemidov P.',
        'address_tk': None,
        'address_ru': None,
        'address_en': None,
        'director': 'Хемидов П.',
        'swift_code': 'TUTCTM2X',
    },
    {
        'code': 'Tel CH',
        'name_tk': 'Hususy Telekeçi Hemidow Ç.A.',
        'name_ru': 'И.П. Хемидов Ч.А.',
        'name_en': 'Individual entrepreneur Hemidov Ch.A.',
        'address_tk': None,
        'address_ru': None,
        'address_en': None,
        'director': 'Хемидов Ч.А.',
        'swift_code': 'TUTCTM2X',
    },
    {
        'code': 'ISH',
        'name_tk': '"Işgär" HJ',
        'name_ru': 'ХО "Ишгар"',
        'name_en': 'Economic society "Ishgar"',
        'address_tk': None,
        'address_ru': None,
        'address_en': None,
        'director': 'Бекмырадов Мялик.',
        'swift_code': 'INVATM2X',
    },
    {
        'code': 'HG',
        'name_tk': '"Höwesli gurluşyk" HJ',
        'name_ru': 'ХО «Ховесли гурлушык»',
        'name_en': None,
        'address_tk': None,
        'address_ru': None,
        'address_en': None,
        'director': 'Тяшлиева Д.',
        'swift_code': None,
    },
    {
        'code': 'Tel GA',
        'name_tk': 'Telekeçi Amangeldiýew G.',
        'name_ru': 'И.П. Амангельдиев Г.',
        'name_en': 'Individual Entrepreneur Amanageldiyev G.A.',
        'address_tk': None,
        'address_ru': None,
        'address_en': None,
        'director': 'Амангельдиев Г.',
        'swift_code': None,
    },
    {
        'code': 'TAM',
        'name_tk': 'Hususy Telekeçi Ataýew M.A.',
        'name_ru': 'ИП Атаев Максат Амангельдиевич',
        'name_en': None,
        'address_tk': None,
        'address_ru': 'Адрес: Туркменистан, г. Ашгабат, Копетдагский этр. пос.Берзенги, д 48.',
        'address_en': None,
        'director': 'Атаев Максат Амангельдиевич',
        'swift_code': 'TUTCTM2X',
    },
    {
        'code': 'THM',
        'name_tk': 'Hususy Telekeçi Hojamgulýew M.D.',
        'name_ru': 'ИП Ходжамгулыев Мекангулы Дортгулыевич',
        'name_en': None,
        'address_tk': None,
        'address_ru': 'Адрес: 744025, Туркменистан, Ашхабад, Беркарарлыкский этрап, ул. К.Тангрыгулыев дом 59.',
        'address_en': None,
        'director': 'Ходжамгулыев Мекангулы Дортгулыевич',
        'swift_code': None,
    },
    {
        'code': 'KIHK',
        'name_tk': '"Kerwenli Iller" HJ',
        'name_ru': 'ИП «Кервенли иллер»',
        'name_en': None,
        'address_tk': None,
        'address_ru': None,
        'address_en': None,
        'director': 'Begliýewa A.S.',
        'swift_code': None,
    },
    {
        'code': 'BKHK',
        'name_tk': '"Bereketli Kerwensaraý" HJ',
        'name_ru': 'ИП «Берекетли кервенсарай»',
        'name_en': None,
        'address_tk': None,
        'address_ru': None,
        'address_en': None,
        'director': 'Aşyrow R.',
        'swift_code': None,
    },
]


# ── ImportFirm data (extracted from Buyers sheet + CMR graphs country mapping) ─
# code → (name_ru, name_tk, country_code)
# Firms without a code (rows 63-72, 78) are omitted — they lack a join key.
IMPORT_FIRMS_DATA = [
    ('Nur-Alem', 'ТОО "Нур-Алем"', '"Nur-alem" JÇJ', 'KZ'),
    ('Aranşy KZ', 'TОО «Араншы-KZ»', '"Aranshy" JÇJ', 'KZ'),
    ('Qazfruit', 'ТОО "Qazfruit"', '"Qazfruit" JÇJ', 'KZ'),
    ('ABSOLYUT', "ООО ''АБСОЛЮТ''", None, 'RU'),
    ('SAH FRUT', 'ООО "ШАХ ФРУКТ"', '"SHAHFRUKT" JÇJ', 'RU'),
    ('SAH FRUT-Ahmet', 'ООО "ШАХ ФРУКТ"', None, 'RU'),
    ('MAXIFRUT LLC', 'ООО «МАКСИФРУТ»', '«Maksifruit» JÇJ', 'RU'),
    ('Eks for Den', 'ТОО "Экс Фор Ден"', None, 'KZ'),
    ('bg', 'ИП "BARIS GROUP"', None, 'RU'),
    ('Laym Yug', 'ИП «Лайм-Юг»', None, 'KZ'),
    ('Agrocity', 'ООО «АГРО СИТИ ТРЕЙД»', None, 'RU'),
    ('SHARIYEW R', 'ИП «Шариев Р»', None, 'RU'),
    ('Viktoriya', 'ООО «Виктория»', None, 'RU'),
    ('AGRO-GOLD', 'ИП «AGRO-GOLD»', None, 'KZ'),
    ('Frut Pro', 'ООО «ФРУТ ПРО»', None, 'RU'),
    ('ТОО Apple Star', 'ТОО "Apple Star"', None, 'KZ'),
    ('LZ SERVICE SRL', 'LZ SERVICE SRL', None, None),
    ('FRUIT ORIGIN', 'OOO "FRUIT ORIGIN"', None, 'AZ'),
    ('ОсОО «Арчи и Ко»', 'ОсОО «Арчи и Ко»', None, 'KG'),
    ('SHAPAGAT LOGISTIC', 'TOO SHAPAGAT LOGISTIC', None, 'KZ'),
    ('LLC Berekete Limited', 'ОсОО "Берекете Лимитед"', None, 'KG'),
    ('LLC DARGOH88', 'LLC DARGOH88', None, 'KG'),
    ('АГРО НУР КОМПАНИ', 'ОсОО "АГРО НУР КОМПАНИ"', None, 'KG'),
    ('JÇJ Wektor', 'ООО «Вектор»', None, 'RU'),
    ('SAM LOGISTICS', 'ТОО «SAM LOGISTICS»', None, 'KZ'),
    ('ООО Аспект', 'ООО "Аспект"', None, 'RU'),
    ('TOO PRO SERVICE 2023', 'ИП «Pro Service 2023»', None, 'KZ'),
    ('Archie Traind', 'ОсОО «Арчи Трейнд»', None, 'KG'),
    ('ОсОО ЖалТрек', 'ОсОО «Жал трек»', None, 'KG'),
    ('ООО Хан', 'ООО Логистическая компания "ХАН"', None, 'KG'),
    ('MTLK ISHENIM', 'ОсОО «МТЛК Ишеним»', 'JÇJ "MTLK ISHENIM"', 'KG'),
    ('Sayhun grupp', 'ОсОО «Сайхун групп»', None, 'KG'),
    ('ОсОО Насип Жол', 'ОсОО "Насип Жол"', None, 'KG'),
    ('ОсОО Аманат плюс ЛТД', 'ОсОО «Аманат Плюс ЛТД»', None, 'KG'),
    ('ATLAS', 'ООО "АТЛАС"', '"Atlas" JÇJ', 'RU'),
    ('ARCHIE INVEST', 'ОсОО «Арчи Инвест»', None, 'KG'),
    ('GREEN IMPORT GROUP', 'ООО "GREEN IMPORT GROUP"', None, 'UZ'),
    ('Merkuriy', 'ООО «МЕРКУРИЙ»', None, 'RU'),
    ('OОО «Havvo Group»', 'OОО «Havvo Group»', '"Havvo Group" JÇJ', 'UZ'),
    ('ООО Гарден Экспорт Новосибирск', 'ООО «Гарден Экспорт Новосибирск»', None, 'RU'),
    ('SUNNATILLA', 'ООО «SUNNATILLA-BARAKA-BUSINESS»', None, 'UZ'),
    ('ООО «HAVVO PRIME»', 'ООО «HAVVO PRIME»', None, 'UZ'),
    ('ALGA-BAS LTD', 'ОсОО "Алга-Бас ЛТД"', None, 'KG'),
    ('DILEVER BUSSNES', 'OОО «DILEVER BUSSNES»', None, 'UZ'),
    ('Torginwest', 'ООО «ТОРГИНВЕСТ»', None, 'RU'),
    ('TRUST INDUSTRY', 'ООО"TRUST INDUSTRY"', '"Trust Industry" JÇJ', 'UZ'),
    ('EDMART GROUP', 'ТОО  EDMART GROUP', None, 'KZ'),
    ('Durakhshi Osiyo', '"DURAKHSHI OSIYO" LLC', None, 'UZ'),
    ('Yusuf Diyor', 'Фермерское хозяйство "Yusuf-Diyor"', None, 'UZ'),
    ('J.D.MM. Dargo-88', '"J.D.MM. Dargo-88"', None, 'TJ'),
    ('FADAK-1974 MMC', "ООО ''FADAK-1974\"", None, 'AZ'),
    ('Bukhorzoda', 'LLC "Bukhorzoda"', None, 'TJ'),
    ('Bukhorzoda Begenc', 'LLC "Bukhorzoda"', '"Bukhorzoda" JÇJ', 'TJ'),
    ('koinot', 'ООО "KOINOT"', None, 'KZ'),
    ('Turkmenfrukt (dowran)', 'ООО "ТУРКМЕНФРУКТ"', '"Turkmenfrukt" JÇJ', 'RU'),
    ('Turkmenfrukt', 'ООО "ТУРКМЕНФРУКТ"', '"Turkmenfrukt" JÇJ', 'RU'),
    ('URALISKIY LUC', 'ООО «Уральский Луч»', '"URALISKIY LUC" JÇJ', 'RU'),
    ('Perspektiwa', 'ООО «Перспектива»', None, 'RU'),
    ('Boston Beget', 'ООО "Бостон-Бегет"', None, 'KG'),
    ('Krasnyy Apelsin', 'ОсОО «КРАСНЫЙ АПЕЛЬСИН»', 'JÇJ "Krasnyý Apelsin"', 'KG'),
    ('Global Harvest bek', 'ТОО "Global Harvest bek"', '"Global Harvest Bek" JÇJ', 'KZ'),
    ('NOWYY MIR 111', 'ТОО «НОВЫЙ МИР 111»', None, 'KZ'),
    ('Khazar-fruit', 'ТОО "Khazar-fruit"', None, 'KZ'),
    ('Прогресс', 'ООО "Прогресс"', None, 'RU'),
    ('DauRus Group', 'ТОО «DauRus Group»', None, 'KZ'),
    ('DOMINO', 'ООО «ДОМИНО»', None, 'RU'),
    ('Frutreal', 'ООО «Фрутреал»', '"Frutreal" JÇJ', 'BY'),
    ('Tosmur OOO', 'ООО "ТОСМУР"', '"Tosmur" JÇJ', 'RU'),
    ('OOO Akwanur', 'ООО «АКВАНУР»', None, 'RU'),
    ('OOO AVANGARD', 'ООО «АВАНГАРД»', None, 'RU'),
    ('IP Tursynbayew', 'ИП "ТУРСЫНБАЕВ"', None, 'UZ'),
    ('ОсОО"АОМ Экотрейд"', 'ОсОО"АОМ Экотрейд"', '"AOM Ekotreýd" JÇJ', 'KZ'),
    ('IP Tursynbayew (Nurbek)', 'ИП "ТУРСЫНБАЕВ" (Нурбек)', None, 'UZ'),
    ('IP Tursynbayew (Adybek)', 'ИП "ТУРСЫНБАЕВ" (Адыбек)', None, 'UZ'),
    ('IP Tursynbayew (Azamat)', 'ИП "ТУРСЫНБАЕВ" (Азамат)', None, 'UZ'),
    ('ТОО TransAsia Trade', 'ТОО "TransAsia Trade"', None, 'KZ'),
    ('ТОО TransAsia Trade (Bagtyyar)', 'ТОО "TransAsia Trade" (Bagtyyar)', None, 'KZ'),
    ('ATM HOLDING', 'ОсОО "АТМ Холдинг"', None, 'KG'),
    ('Boli Zarrin', 'LLC "Boli Zarrin"', None, 'TJ'),
    ('Alyans', 'ООО «Альянс»', '«Alyans» JÇJ', 'RU'),
    ('Arsen i K', 'ТОО "Арсен и К"', None, 'KZ'),
    ('WINTA PLUS', 'ОсОО "Винта плюс"', None, 'KG'),
    ('LLC «Glavryba»', 'ОсОО Главрыба', 'JÇJ «Glawryba»', 'KG'),
    ('Eko Agro Produkt', 'ОсОО Эко Агро Продукт', None, 'KG'),
    ('OOO "Sunday Team"', 'OOO "Sunday Team"', None, 'UZ'),
    ('OcOO "Town Express Company"', 'ОсОО "Таун Экспресс Компани"', None, 'KG'),
    ('LLC «Tauminoti Aulo»', 'LLC «Tauminoti Aulo»', '"Tauminoti Aulo" JÇJ', 'TJ'),
    ('Manufaktura', 'ООО ТД «Мануфактура»', '"Manufaktura" JÇJ', 'RU'),
    ('ОсОО"АОМ Экотрейд".', 'ОсОО"АОМ Экотрейд"', '"AOM Ekotreýd" JÇJ', 'KZ'),
    ('Fortuna lyukos', 'ООО "ФОРТУНА-ЛЮКС"', 'JÇJ "Fortuna-Luks"', 'RU'),
    ('Smart Moushn Link', 'ООО «Сармант-ЮГ»', None, 'RU'),
    ('LLC MTLK ISHENIM', 'LLC "MTLK ISHENIM"', 'JÇJ "MTLK ISHENIM"', 'KG'),
    ('OОО ASBB BUILDING COMPLEX', 'OОО «ASBB BUILDING COMPLEX»', 'JÇJ "ASBB BUILDING COMPLEX"', 'UZ'),
    ('GREENPUT', 'OОО «ГРИНПУТ»', 'JÇJ "Grinput"', 'RU'),
    ('FRESHWORLD TRADE', 'ООО «FRESHWORLD TRADE»', 'JÇJ "Freshworld Trade"', 'UZ'),
    ('Eko-Bay Keyji', 'ООО «Эко-Бай Кейджи»', 'JÇJ "EKO BAY KEYJI"', 'KG'),
    ('Gold Lemon Sterelis', 'МЧЖ «GOLD LEMON STERELIS»', 'JÇJ "Gold Lemon Sterelis"', 'UZ'),
    ('Exportlink', 'OOO "EXPORTLINK"', 'JÇJ "Exportlink"', 'UZ'),
]


# ── Customer data (from Hasabat Saher col4 — unique, deduplicated) ────────────
# country_code = most common country seen for that customer in Saher sheet
CUSTOMERS_DATA = [
    # name, default_country_code
    ('Berik', 'KZ'),
    ('Begjan', 'KZ'),
    ('Eldar', 'RU'),
    ('Arap', 'KZ'),
    ('Solmaz', 'UZ'),
    ('ÝGT Gapy Satyş', None),   # internal gapy satys — no single country
]


# ── City data (from Baha_Grafigi Sayfa1 header + Hasabat Saher) ───────────────
# (city_name, country_code, name_local)
# Real price-market cities from Baha_Grafigi row 2:
#   Şimkent, Almaty, Astana, Karaganda (KZ)
#   Orenburg, Moskwa (RU)
#   Minsk (BY)
#   Bishkek (KG)
# Additional from Hasabat Saher cities column:
#   Şimkent appears as "Şimkent" in Saher
CITIES_DATA = [
    # Kazakhstan
    ('Şimkent', 'KZ', 'Шымкент'),
    ('Almaty', 'KZ', 'Алматы'),
    ('Astana', 'KZ', 'Астана'),
    ('Karaganda', 'KZ', 'Карагандa'),
    # Russia
    ('Orenburg', 'RU', 'Оренбург'),
    ('Moskwa', 'RU', 'Москва'),
    # Belarus
    ('Minsk', 'BY', 'Минск'),
    # Kyrgyzstan
    ('Bishkek', 'KG', 'Бишкек'),
    # Turkmenistan domestic markets (from Baha_Grafigi TM columns)
    ('Tolkuçka', 'TM', None),
    ('Teke bazar', 'TM', None),
    ('Mir Bazar', 'TM', None),
    ('Rus Bazar', 'TM', None),
    ('Dz Bazar', 'TM', None),
]


def _normalize(text: str | None) -> str | None:
    """Strip whitespace and collapse internal runs; return None if empty."""
    if text is None:
        return None
    cleaned = re.sub(r'\s+', ' ', text).strip()
    return cleaned if cleaned else None


class Command(BaseCommand):
    help = 'Import reference data (ExportFirms, ImportFirms, Customers, Cities) from Excel sources'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Print what would be imported without writing to the database',
        )

    def handle(self, *args, **options):
        dry_run: bool = options['dry_run']

        if dry_run:
            self.stdout.write(self.style.WARNING('DRY RUN — no changes will be written\n'))

        try:
            with transaction.atomic():
                self._import_cities(dry_run)
                self._import_export_firms(dry_run)
                self._import_import_firms(dry_run)
                self._import_customers(dry_run)

                if dry_run:
                    raise _DryRunRollback('dry-run: rolling back')

        except _DryRunRollback:
            pass

        if dry_run:
            self.stdout.write(self.style.WARNING('\nDry run complete — transaction rolled back.'))
        else:
            self.stdout.write(self.style.SUCCESS('\nReference data import complete.'))

    # ── Cities ─────────────────────────────────────────────────────────────────

    def _import_cities(self, dry_run: bool) -> None:
        created = updated = skipped = 0

        for city_name, country_code, name_local in CITIES_DATA:
            city_name = _normalize(city_name)
            name_local = _normalize(name_local)

            try:
                country = Country.objects.get(code=country_code)
            except Country.DoesNotExist:
                self.stderr.write(
                    f'  [City] Country code {country_code!r} not found — '
                    f'skipping city {city_name!r}. Run seed_data first.'
                )
                skipped += 1
                continue

            defaults = {}
            if name_local:
                defaults['name_local'] = name_local

            if not dry_run:
                _, was_created = City.objects.update_or_create(
                    country=country,
                    name=city_name,
                    defaults=defaults,
                )
                if was_created:
                    created += 1
                else:
                    updated += 1
            else:
                exists = City.objects.filter(country=country, name=city_name).exists()
                if exists:
                    updated += 1
                else:
                    created += 1

        self.stdout.write(
            f'  City: {len(CITIES_DATA)} rows — {created} new, {updated} updated, {skipped} skipped'
        )

    # ── ExportFirms ────────────────────────────────────────────────────────────

    def _import_export_firms(self, dry_run: bool) -> None:
        created = updated = 0

        for firm in EXPORT_FIRMS_DATA:
            defaults = {
                'name_tk': _normalize(firm['name_tk']),
                'name_ru': _normalize(firm.get('name_ru')),
                'name_en': _normalize(firm.get('name_en')),
                'address_tk': _normalize(firm.get('address_tk')),
                'address_ru': _normalize(firm.get('address_ru')),
                'address_en': _normalize(firm.get('address_en')),
                'director': _normalize(firm.get('director')),
                'swift_code': _normalize(firm.get('swift_code')),
            }
            # Remove None values so we don't overwrite previously set fields with NULL
            defaults = {k: v for k, v in defaults.items() if v is not None}

            if not dry_run:
                _, was_created = ExportFirm.objects.update_or_create(
                    code=firm['code'],
                    defaults=defaults,
                )
                if was_created:
                    created += 1
                else:
                    updated += 1
            else:
                exists = ExportFirm.objects.filter(code=firm['code']).exists()
                if exists:
                    updated += 1
                else:
                    created += 1

        self.stdout.write(
            f'  ExportFirm: {len(EXPORT_FIRMS_DATA)} rows — {created} new, {updated} updated'
        )

    # ── ImportFirms ────────────────────────────────────────────────────────────

    def _import_import_firms(self, dry_run: bool) -> None:
        created = updated = skipped = 0

        # Build country lookup once
        country_by_code: dict = {}
        for code in set(row[3] for row in IMPORT_FIRMS_DATA if row[3]):
            try:
                country_by_code[code] = Country.objects.get(code=code)
            except Country.DoesNotExist:
                pass  # will fall through to None

        for firm_code, name_ru, name_tk, country_code in IMPORT_FIRMS_DATA:
            firm_code = _normalize(firm_code)
            if not firm_code:
                skipped += 1
                continue

            name_ru_clean = _normalize(name_ru)
            name_tk_clean = _normalize(name_tk)

            # name_tk is the primary required field on the model; fall back to name_ru
            primary_name = name_tk_clean or name_ru_clean
            if not primary_name:
                self.stderr.write(f'  [ImportFirm] No name for code {firm_code!r} — skipping')
                skipped += 1
                continue

            country = country_by_code.get(country_code) if country_code else None

            defaults = {
                'name_tk': primary_name,
                'name_ru': name_ru_clean,
                'country': country,
            }

            if not dry_run:
                _, was_created = ImportFirm.objects.update_or_create(
                    code=firm_code,
                    defaults=defaults,
                )
                if was_created:
                    created += 1
                else:
                    updated += 1
            else:
                exists = ImportFirm.objects.filter(code=firm_code).exists()
                if exists:
                    updated += 1
                else:
                    created += 1

        self.stdout.write(
            f'  ImportFirm: {len(IMPORT_FIRMS_DATA)} rows — '
            f'{created} new, {updated} updated, {skipped} skipped'
        )

    # ── Customers ──────────────────────────────────────────────────────────────

    def _import_customers(self, dry_run: bool) -> None:
        created = updated = 0

        country_by_code: dict = {}
        for _, country_code in CUSTOMERS_DATA:
            if country_code and country_code not in country_by_code:
                try:
                    country_by_code[country_code] = Country.objects.get(code=country_code)
                except Country.DoesNotExist:
                    pass

        for name, country_code in CUSTOMERS_DATA:
            name_clean = _normalize(name)
            if not name_clean:
                continue

            country = country_by_code.get(country_code) if country_code else None
            defaults: dict = {}
            if country:
                defaults['default_country'] = country

            if not dry_run:
                _, was_created = Customer.objects.update_or_create(
                    name=name_clean,
                    defaults=defaults,
                )
                if was_created:
                    created += 1
                else:
                    updated += 1
            else:
                exists = Customer.objects.filter(name=name_clean).exists()
                if exists:
                    updated += 1
                else:
                    created += 1

        self.stdout.write(
            f'  Customer: {len(CUSTOMERS_DATA)} rows — {created} new, {updated} updated'
        )


class _DryRunRollback(Exception):
    """Sentinel exception to roll back the dry-run transaction."""
