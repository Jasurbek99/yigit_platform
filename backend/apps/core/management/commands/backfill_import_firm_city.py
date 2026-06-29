"""Backfill ImportFirm.city by inferring the city from the address text.

Companion to ``backfill_import_firm_short_and_country``: that command fills the
``country`` FK; this one fills ``city`` (creating missing ``City`` reference
rows on the way).

Strategy mirrors the country backfill:

1. The firm must already have a ``country`` (run the country backfill first).
   We only consider cities that belong to that country, so a correspondent-bank
   city in another country can't leak in.
2. Within the firm's country, we pick the city whose earliest keyword
   occurrence in the address has the smallest index. The firm's own legal
   address comes first in the text, before any consignee / warehouse / bank
   lines — so "earliest wins" resolves rows like a Baku firm whose warehouse
   is also named, or an Azerbaijani firm whose Kazakh consignee appears lower.
3. Missing ``City`` rows are created (``name`` Latin/transliterated to match the
   existing convention, ``name_local`` Cyrillic). Existing rows are reused.

Only rows with ``city IS NULL`` are touched by default; ``--reevaluate``
re-checks every row. Region-only addresses ("Туркестанская область" with no
city) are left null on purpose — we never guess a city from a region.

Usage:
    python manage.py backfill_import_firm_city
    python manage.py backfill_import_firm_city --dry-run
    python manage.py backfill_import_firm_city --reevaluate
"""
from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.core.models import City, Country, ImportFirm


# City rules grouped by Country.code. Each entry maps a canonical city name
# (the City.name we create/reuse) to its match keywords plus a Cyrillic
# name_local. Keyword order within a city does not matter; across cities we
# resolve by earliest occurrence in the address (see infer_city_name).
CITY_RULES: dict[str, dict[str, tuple[list[str], str | None]]] = {
    'KZ': {
        'Şimkent': (['шымкент'], 'Шымкент'),
        'Astana': (['астана'], 'Астана'),
        'Almaty': (['г. алматы', 'г.алматы', 'город алматы', ' алматы'], 'Алматы'),
        'Konaev': (['қонаев', 'конаев'], 'Қонаев'),
        'Saryagash': (['сарыагаш'], 'Сарыагаш'),
        'Aktau': (['актау'], 'Актау'),
        'Karaganda': (['караганда'], 'Караганда'),
    },
    'RU': {
        'Moskwa': (['москва'], 'Москва'),
        'Orenburg': (['оренбург'], 'Оренбург'),
        'Ufa': (['уфа'], 'Уфа'),
        'Chelyabinsk': (['челябинск'], 'Челябинск'),
        'Sankt-Peterburg': (['санкт-петербург'], 'Санкт-Петербург'),
        'Novosibirsk': (['новосибирск'], 'Новосибирск'),
        'Balashikha': (['балашиха'], 'Балашиха'),
    },
    'KG': {
        'Bishkek': (['бишкек'], 'Бишкек'),
        'Osh': ([' ош ', 'г ош', 'гош', 'ош,', 'ошская'], 'Ош'),
    },
    'TJ': {
        'Dushanbe': (['душанбе', 'dushanbe'], 'Душанбе'),
    },
    'UZ': {
        'Ташкент': (['ташкент'], None),
        'Fergana': (['фергана', 'ферганск', 'алтыарык'], 'Фергана'),
        'Andijan': (['андижан', 'муллабой'], 'Андижан'),
        'Jizzakh': (['джизак'], 'Джизак'),
    },
    'AZ': {
        'Baku': (['баку', 'baku'], 'Баку'),
        'Astara': (['астара', 'арчиван'], 'Астара'),
    },
    'AF': {
        'Herat': (['gerat', 'herat'], None),
    },
    'RO': {
        'Cluj-Napoca': (['cluj'], None),
    },
    'BY': {
        'Minsk': (['минск', 'minsk'], 'Минск'),
        'Polotsk': (['полоцк'], 'Полоцк'),
    },
    'UA': {
        'Brovary': (['бровар'], 'Бровары'),
    },
}


def infer_city_name(address: str | None, country_code: str | None) -> str | None:
    """Return the canonical city name for the address within the given country.

    Only cities of ``country_code`` are considered. The winner is the city
    whose earliest keyword hit has the smallest index in the address.
    """
    if not address or not country_code:
        return None
    rules = CITY_RULES.get(country_code)
    if not rules:
        return None
    haystack = address.lower()

    best_name: str | None = None
    best_pos: int = len(haystack) + 1

    for name, (keywords, _local) in rules.items():
        for kw in keywords:
            idx = haystack.find(kw)
            if idx == -1:
                continue
            if idx < best_pos:
                best_pos = idx
                best_name = name
            break  # earliest hit for this city is enough

    return best_name


class Command(BaseCommand):
    help = ('Infer ImportFirm.city from address (creating missing City rows), '
            'scoped to each firm\'s existing country.')

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Show what would change without writing (no City rows created).',
        )
        parser.add_argument(
            '--reevaluate', action='store_true',
            help='Re-classify city for ALL rows, not just city IS NULL.',
        )

    def handle(self, *args, **opts):
        dry_run: bool = opts['dry_run']
        reevaluate: bool = opts['reevaluate']

        countries_by_code: dict[str, Country] = {
            c.code: c for c in Country.objects.all() if c.code
        }
        missing_codes = set(CITY_RULES) - set(countries_by_code)
        if missing_codes:
            self.stdout.write(self.style.WARNING(
                f'Country rows missing for codes (rules will skip these): '
                f'{sorted(missing_codes)}'
            ))

        # (country_code, city_name) -> City, lazily filled via get_or_create.
        city_cache: dict[tuple[str, str], City] = {
            (c.country.code, c.name): c
            for c in City.objects.select_related('country')
        }

        def resolve_city(code: str, name: str) -> City:
            key = (code, name)
            city = city_cache.get(key)
            if city is not None:
                return city
            local = CITY_RULES[code][name][1]
            city, created = City.objects.get_or_create(
                country=countries_by_code[code], name=name,
                defaults={'name_local': local},
            )
            city_cache[key] = city
            if created:
                self.stdout.write(self.style.SUCCESS(
                    f'  NEW CITY  {code} / {name}'))
            return city

        city_set = 0
        no_match = []  # (id, label, country, address head)

        firms = list(
            ImportFirm.objects.select_related('country', 'city').order_by('id')
        )

        with transaction.atomic():
            for firm in firms:
                if firm.country_id is None:
                    continue
                if firm.city_id is not None and not reevaluate:
                    continue

                code = firm.country.code
                name = infer_city_name(firm.address, code)
                if name is None:
                    no_match.append((
                        firm.id, firm.code or firm.name_company[:30], code,
                        (firm.address or '')[:80].replace('\n', ' '),
                    ))
                    continue
                if name not in CITY_RULES.get(code, {}):
                    continue

                if dry_run:
                    # Don't create rows in a dry run — just report the target.
                    if (code, name) not in city_cache:
                        self.stdout.write(
                            f'  UPDATE  ImportFirm[{firm.id}] '
                            f'{firm.code or firm.name_company[:30]} '
                            f'-> city={name} (would create City)')
                    else:
                        target = city_cache[(code, name)]
                        if firm.city_id != target.id:
                            self.stdout.write(
                                f'  UPDATE  ImportFirm[{firm.id}] '
                                f'{firm.code or firm.name_company[:30]} '
                                f'-> city={name}')
                    city_set += 1
                    continue

                target = resolve_city(code, name)
                if firm.city_id != target.id:
                    firm.city = target
                    firm.save(update_fields=['city'])
                    city_set += 1
                    self.stdout.write(
                        f'  UPDATE  ImportFirm[{firm.id}] '
                        f'{firm.code or firm.name_company[:30]} '
                        f'-> city={name}')

            if dry_run:
                self.stdout.write(self.style.WARNING(
                    'DRY RUN — rolling back transaction.'))
                transaction.set_rollback(True)

        self.stdout.write('')
        self.stdout.write(self.style.SUCCESS('=== city inference ==='))
        self.stdout.write(f'  set      : {city_set}')
        self.stdout.write(f'  no match : {len(no_match)} (region-only / no city)')

        if no_match:
            self.stdout.write('')
            self.stdout.write(self.style.WARNING(
                'Rows where no city keyword matched (left null on purpose):'))
            for fid, label, code, addr in no_match:
                self.stdout.write(f'  [{fid}] {label!r} ({code})  addr={addr!r}')
