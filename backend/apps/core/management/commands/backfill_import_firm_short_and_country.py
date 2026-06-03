"""Backfill ImportFirm.name_short from code, and infer country from address.

Two backfills in one pass:

1. ``name_short := code`` for every ImportFirm whose ``code`` is populated.
   The Excel source-of-truth treats ``code`` as the canonical short label, but
   historical rows have either no name_short or a stale long form. We overwrite
   so the field matches the code one-for-one.

2. ``country`` is filled in by scanning the ``address`` text for country
   keywords (multilingual: TM/RU/EN/native). Only rows with ``country IS NULL``
   are touched — we never override an existing FK. If no keyword matches, the
   row is reported and left alone.

Usage:
    python manage.py backfill_import_firm_short_and_country
    python manage.py backfill_import_firm_short_and_country --dry-run
"""
from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.core.models import Country, ImportFirm


# Country keyword table. Order within a list does not matter: we pick the
# country whose earliest keyword occurrence in the address has the smallest
# index. Keywords are matched case-insensitively except where the casing is
# distinctive (e.g. all-caps headers).
COUNTRY_KEYWORDS: dict[str, list[str]] = {
    'AF': [
        'afghanistan',
        'афганистан',
        'owganystan',
    ],
    'KZ': [
        'казахстан',
        'казакстан',
        'казахстана',
        'gazagystan',
        'рк,',
        'рк ',
        'рк.',
        ' рк ',
        'шымкент',
        'сарыагаш',
        'туркестанская',
        'туркестан',
        'алматы',
        'мангистау',
        'конаев',
        'қонаев',
        'семей',
        'астана',
        'актау',
        'kazakhstan',
        'абайский район',
    ],
    'RU': [
        'россия',
        'российская',
        'российской',
        'российскaя',
        'российская федерация',
        'рф,',
        'рф ',
        'рф.',
        'москва',
        'санкт-петербург',
        'новосибирск',
        'челябинск',
        'башкортостан',
        'оренбург',
        'балашиха',
        'уфа',
        'russia',
    ],
    'UZ': [
        'узбекистан',
        'узбекистон',
        'ташкент',
        'ферганская',
        'фергана',
        'андижан',
        'сурхандарь',
        'сухандарья',
        'джизак',
        'самарканд',
        'зангиатин',
        'зарбдор',
        'ozbekystan',
        'uzbekistan',
    ],
    'KG': [
        'кыргызстан',
        'кыргызская',
        'кыргызкая',
        'киргизская',
        'кыргызская республика',
        'бишкек',
        'кара-суу',
        'кара-сууй',
        'сокулук',
        'чуйск',
        'чүй',
        'ошская',
        'г. ош',
        'г.ош',
        'г ош',
        'kyrgyz',
        'gyrgysystan',
    ],
    'TJ': [
        'tajikistan',
        'таджикистан',
        'душанбе',
        'dushanbe',
        'khatlon',
        'khalton',
        'хатлон',
        'tajigistan',
    ],
    'BY': [
        'беларусь',
        'belarus',
        'полоцк',
        'минск',
    ],
    'AZ': [
        'азербайджан',
        'азербаджан',  # typo seen in the data
        'azerbaijan',
        'azerbaýjan',
        'azerbaycan',
        'баку',
        'baku',
        'астара',
        'арчиван',
        'az1010',
    ],
    'RO': [
        'romania',
        'румыния',
        'cluj napoca',
        'cluj-napoca',
        'bucharest',
        'bucuresti',
        ' ro ',
        'ro,',
        'ro ',
    ],
    'UA': [
        'украина',
        'україна',
        'ukraine',
        'киевская',
        'київська',
        'kyiv',
        'киев',
        'бровары',
        'одесса',
        'одеська',
        'lviv',
        'львов',
    ],
    'AE': [
        'u.a.e',
        'uae',
        'dubai',
        'дубай',
        'abu dhabi',
        'абу-даби',
        'оаэ',
        'al awir',
        'emirates',
        'эмират',
    ],
}


def infer_country_code(address: str | None) -> str | None:
    """Return the 2-letter Country.code that best matches the address, or None.

    Strategy: lowercase the address, find each country's earliest keyword hit,
    return the country with the smallest hit index. Ties (rare) go to whichever
    iterates first in the dict — order matters only in those ties.
    """
    if not address:
        return None
    haystack = address.lower()

    best_code: str | None = None
    best_pos: int = len(haystack) + 1

    for code, keywords in COUNTRY_KEYWORDS.items():
        for kw in keywords:
            idx = haystack.find(kw)
            if idx == -1:
                continue
            if idx < best_pos:
                best_pos = idx
                best_code = code
                break  # earliest hit for this country is enough

    return best_code


class Command(BaseCommand):
    help = ('Copy ImportFirm.code -> name_short, and infer country from address '
            'for firms with country IS NULL.')

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Show what would change without writing.',
        )
        parser.add_argument(
            '--reevaluate', action='store_true',
            help=('Re-classify country for ALL rows, not just country IS NULL. '
                  'Useful after adding new Country rows / new keywords so a row '
                  'whose primary address mentions a previously-unsupported '
                  'country can be flipped to the right value.'),
        )

    def handle(self, *args, **opts):
        dry_run: bool = opts['dry_run']
        reevaluate: bool = opts['reevaluate']

        countries_by_code: dict[str, Country] = {
            c.code: c for c in Country.objects.all() if c.code
        }
        missing_codes = set(COUNTRY_KEYWORDS) - set(countries_by_code)
        if missing_codes:
            self.stdout.write(self.style.WARNING(
                f'Country rows missing for codes (rules will skip these): '
                f'{sorted(missing_codes)}'
            ))

        short_updated = 0
        short_unchanged = 0
        short_skipped_no_code = 0

        country_set = 0
        country_no_match = []  # list of (id, code-or-name, address head)
        country_unknown_code = []  # matched a code we don't have a Country row for

        # Use a single fetch — table is small (<200 rows).
        firms = list(ImportFirm.objects.all().order_by('id'))

        with transaction.atomic():
            for firm in firms:
                changed_fields: list[str] = []

                # (1) name_short := code
                if firm.code:
                    new_short = firm.code
                    if firm.name_short != new_short:
                        firm.name_short = new_short
                        changed_fields.append('name_short')
                        short_updated += 1
                    else:
                        short_unchanged += 1
                else:
                    short_skipped_no_code += 1

                # (2) infer country: by default only when null; --reevaluate
                # re-checks rows that already have a country too.
                if firm.country_id is None or reevaluate:
                    inferred = infer_country_code(firm.address)
                    if inferred is None:
                        if firm.country_id is None:
                            country_no_match.append(
                                (firm.id, firm.code or firm.name_company[:30],
                                 (firm.address or '')[:80].replace('\n', ' '))
                            )
                    elif inferred not in countries_by_code:
                        country_unknown_code.append(
                            (firm.id, firm.code or firm.name_company[:30], inferred)
                        )
                    else:
                        new_country = countries_by_code[inferred]
                        if firm.country_id != new_country.id:
                            firm.country = new_country
                            changed_fields.append('country')
                            country_set += 1

                if changed_fields and not dry_run:
                    firm.save(update_fields=changed_fields)
                if changed_fields:
                    label = firm.code or firm.name_company[:30]
                    self.stdout.write(
                        f'  UPDATE  ImportFirm[{firm.id}] {label} '
                        f'-> {", ".join(changed_fields)}'
                        + (f' (country={firm.country.code})'
                           if 'country' in changed_fields else '')
                    )

            if dry_run:
                self.stdout.write(self.style.WARNING(
                    'DRY RUN — rolling back transaction.'))
                transaction.set_rollback(True)

        self.stdout.write('')
        self.stdout.write(self.style.SUCCESS('=== name_short <- code ==='))
        self.stdout.write(f'  updated         : {short_updated}')
        self.stdout.write(f'  already correct : {short_unchanged}')
        self.stdout.write(f'  no code (skipped): {short_skipped_no_code}')

        self.stdout.write(self.style.SUCCESS('=== country inference ==='))
        self.stdout.write(f'  set        : {country_set}')
        self.stdout.write(f'  no match   : {len(country_no_match)}')
        self.stdout.write(f'  unknown FK : {len(country_unknown_code)}')

        if country_no_match:
            self.stdout.write('')
            self.stdout.write(self.style.WARNING(
                'Rows where no country keyword matched (left unchanged):'))
            for fid, label, addr in country_no_match:
                self.stdout.write(f'  [{fid}] {label!r}  addr={addr!r}')

        if country_unknown_code:
            self.stdout.write('')
            self.stdout.write(self.style.WARNING(
                'Rows whose inferred country has no Country row in DB '
                '(left unchanged):'))
            for fid, label, code in country_unknown_code:
                self.stdout.write(f'  [{fid}] {label!r}  inferred={code}')
