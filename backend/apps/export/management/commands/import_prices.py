"""Import market prices from Baha_Grafigi.xlsx into PriceEntry.

Usage:
    python manage.py import_prices                        # import from default path
    python manage.py import_prices /path/to/file.xlsx    # import from custom path
    python manage.py import_prices --dry-run              # preview without writing
"""
import logging
from decimal import Decimal, InvalidOperation
from pathlib import Path

import openpyxl
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.core.models import City
from apps.export.models import PriceEntry

logger = logging.getLogger(__name__)

# Column index (0-based) → (city_name, currency)
# Source: Baha_Grafigi.xlsx Sayfa1, header rows 1–4 skipped.
# Skipped cols: 5,6 (USD aggregates KZ), 9,10 (USD aggregates RU),
#               12,13 (USD aggregates BY/KG), 15-20 (domestic TM market prices)
COLUMN_MAP = [
    (1,  'Şimkent',   'KZT'),
    (2,  'Almaty',    'KZT'),
    (3,  'Astana',    'KZT'),
    (4,  'Karaganda', 'KZT'),
    (7,  'Orenburg',  'RUB'),
    (8,  'Moskwa',    'RUB'),
    (11, 'Minsk',     'BYN'),
    (14, 'Bishkek',   'KGS'),
]

SHEET_NAME = 'Sayfa1'
HEADER_ROWS = 4
SOURCE_TAG = 'Baha_Grafigi.xlsx'
# Five directories up from this file: commands/ → management/ → export/ → apps/ → backend/ → project root
DEFAULT_PATH = Path(__file__).parents[5] / 'data' / 'p3-export' / 'Baha_Grafigi.xlsx'


class Command(BaseCommand):
    help = 'Import market prices from Baha_Grafigi.xlsx into export.price_entries'

    def add_arguments(self, parser):
        parser.add_argument(
            'file',
            nargs='?',
            default=str(DEFAULT_PATH),
            help=f'Path to Baha_Grafigi.xlsx (default: {DEFAULT_PATH})',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Parse and count rows without writing to the database',
        )

    def handle(self, *args, **options):
        path = Path(options['file'])
        if not path.exists():
            self.stderr.write(self.style.ERROR(f'File not found: {path}'))
            return

        # Pre-load all cities once — avoids N+1 inside the row loop
        city_map = {c.name: c for c in City.objects.select_related('country').all()}

        entries = []
        skipped_empty = 0
        missing_cities: set[str] = set()
        warnings: list[str] = []

        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        ws = wb[SHEET_NAME]

        rows = list(ws.iter_rows(min_row=HEADER_ROWS + 1, values_only=True))
        self.stdout.write(f'Read {len(rows)} data rows from {SHEET_NAME}')

        for row_num, row in enumerate(rows, start=HEADER_ROWS + 1):
            raw_date = row[0] if row else None
            if not raw_date:
                continue

            # openpyxl returns datetime objects for date cells when data_only=True
            if hasattr(raw_date, 'date'):
                entry_date = raw_date.date()
            else:
                # Unexpected type — skip and warn
                warnings.append(f'Row {row_num}: unrecognised date value {raw_date!r}, skipped')
                continue

            for col_idx, city_name, currency in COLUMN_MAP:
                if col_idx >= len(row):
                    skipped_empty += 1
                    continue

                val = row[col_idx]

                # Empty cell patterns: None, dash string, empty string
                if val is None or val == '-' or val == '':
                    skipped_empty += 1
                    continue

                city = city_map.get(city_name)
                if city is None:
                    missing_cities.add(city_name)
                    continue

                try:
                    price = Decimal(str(val))
                except InvalidOperation:
                    warnings.append(
                        f'Row {row_num}: bad value {val!r} for {city_name} on {entry_date}, skipped'
                    )
                    continue

                entries.append(PriceEntry(
                    date=entry_date,
                    city=city,
                    price_local=price,
                    price_usd=None,
                    currency=currency,
                    source=SOURCE_TAG,
                    entered_by=None,
                ))

        wb.close()

        # Report any city misses — these require seed_data to be run first
        if missing_cities:
            self.stderr.write(self.style.WARNING(
                f'Cities not found in DB (rows skipped): {sorted(missing_cities)}'
            ))
        for w in warnings:
            self.stderr.write(self.style.WARNING(w))

        self.stdout.write(
            f'Parsed {len(entries)} valid price entries '
            f'({skipped_empty} empty cells skipped, {len(warnings)} bad values)'
        )

        if options['dry_run']:
            self.stdout.write(self.style.SUCCESS(
                f'[dry-run] Would import {len(entries)} price entries — no data written'
            ))
            return

        # Write to DB in batches of 500, ignoring (date, city) duplicates
        created = 0
        with transaction.atomic():
            for i in range(0, len(entries), 500):
                batch = entries[i:i + 500]
                result = PriceEntry.objects.bulk_create(
                    batch,
                    batch_size=500,
                    ignore_conflicts=True,
                )
                created += len(result)

        duplicates = len(entries) - created
        self.stdout.write(self.style.SUCCESS(
            f'Imported {created} price entries '
            f'({duplicates} skipped as duplicates, {skipped_empty} empty cells)'
        ))
