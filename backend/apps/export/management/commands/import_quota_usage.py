"""Import quota usage (Islenen Kwota) from quota.xlsx into QuotaUsageRecord.

Reads sheet Kwota-2:
  - Tomato usage: rows 23-55, cols A-P (date + 15 firms)
  - Pepper usage: rows 22-23 (cols X-Y, 2 firms)

Usage:
    python manage.py import_quota_usage                  # dry-run
    python manage.py import_quota_usage --commit         # write to DB
    python manage.py import_quota_usage /path/to/file    # custom path
"""
import logging
import re
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

import openpyxl
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.core.models import ExportFirm
from apps.export.models import QuotaUsageRecord

logger = logging.getLogger(__name__)

DEFAULT_PATH = Path(__file__).parents[5] / 'data' / 'quota.xlsx'
SHEET_QUOTA = 'Kwota-2'

# Reuse firm name mapping from import_quotas
FIRM_NAME_MAP = {
    'YIGIT': 'YGT HJ',
    'HEMSAYA': 'Hemsaya HJ',
    'DATLY MIWE': 'Durli Miweler HJ',
}

# Tomato: firm headers at row 8, cols B(2)-P(16). Usage data rows 23-55.
TOMATO_HEADER_ROW = 8
TOMATO_FIRM_COLS = list(range(2, 17))
TOMATO_USAGE_ROWS = list(range(23, 56))

# Pepper: firm headers at row 8 in cols Y(25)-Z(26). Usage data rows 22-23.
PEPPER_HEADER_ROW = 8
PEPPER_FIRM_COLS = list(range(25, 27))
PEPPER_USAGE_ROWS = list(range(22, 24))
PEPPER_DATE_COL = 24  # col X


def _parse_date(raw) -> date | None:
    """Parse mixed date formats from the Excel file."""
    if raw is None:
        return None
    if isinstance(raw, datetime):
        return raw.date()
    if isinstance(raw, date):
        return raw

    s = str(raw).strip()
    # Strip parenthetical notes like "(kwota berildi)" or "(mas goşlanok)"
    s = re.sub(r'\(.*$', '', s).strip()
    if not s:
        return None

    for fmt in ('%d.%m.%Y', '%d.%m.%y'):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    logger.warning('Cannot parse date: %r', raw)
    return None


def _get_or_create_firm(name: str, firm_cache: dict) -> ExportFirm | None:
    """Look up or create an ExportFirm by Excel name."""
    key = name.strip().upper()
    if key in firm_cache:
        return firm_cache[key]

    mapped_name = FIRM_NAME_MAP.get(key, name.strip())

    firm = ExportFirm.objects.filter(name_en__iexact=mapped_name).first()
    if not firm:
        firm = ExportFirm.objects.filter(name_en__iexact=name.strip()).first()
    if not firm:
        firm = ExportFirm.objects.filter(name_tk__icontains=name.strip()).first()

    if not firm:
        logger.warning('SKIPPED: ExportFirm not found for name=%r — import this firm first.', name)
        return None

    firm_cache[key] = firm
    return firm


class Command(BaseCommand):
    help = 'Import quota usage (Islenen Kwota) from quota.xlsx'

    def add_arguments(self, parser):
        parser.add_argument('path', nargs='?', default=str(DEFAULT_PATH))
        parser.add_argument('--commit', action='store_true', help='Write to DB (default: dry-run)')

    def handle(self, *args, **options):
        path = Path(options['path'])
        commit = options['commit']

        if not path.exists():
            self.stderr.write(f'File not found: {path}')
            return

        self.stdout.write(f'Loading {path} ...')
        wb = openpyxl.load_workbook(path, data_only=True)
        ws = wb[SHEET_QUOTA]
        firm_cache: dict[str, ExportFirm] = {}

        # Collect: [(usage_date, product_type, firm_name, kg)]
        records: list[tuple[date, str, str, Decimal]] = []

        def _read_section(
            firm_cols: list[int],
            data_rows: list[int],
            product: str,
            header_row: int = TOMATO_HEADER_ROW,
            date_col: int = 1,
        ):
            # Read firm headers
            col_firms: dict[int, str] = {}
            for col in firm_cols:
                name = ws.cell(row=header_row, column=col).value
                if name and str(name).strip():
                    col_firms[col] = str(name).strip()

            self.stdout.write(f'  {product.title()} usage: {len(col_firms)} firms, rows {data_rows[0]}-{data_rows[-1]}')

            for row_idx in data_rows:
                usage_date = _parse_date(ws.cell(row=row_idx, column=date_col).value)
                if not usage_date:
                    continue

                for col, firm_name in col_firms.items():
                    val = ws.cell(row=row_idx, column=col).value
                    if not val:
                        continue
                    try:
                        kg = Decimal(str(val))
                    except Exception:
                        continue
                    if kg <= 0:
                        continue

                    records.append((usage_date, product, firm_name, kg))

        _read_section(TOMATO_FIRM_COLS, TOMATO_USAGE_ROWS, 'tomato')
        _read_section(
            PEPPER_FIRM_COLS, PEPPER_USAGE_ROWS, 'pepper',
            header_row=PEPPER_HEADER_ROW, date_col=PEPPER_DATE_COL,
        )

        # Aggregate: same (date, firm, product) might appear twice (e.g. row 37 = 19.03.2026 duplicate)
        agg: dict[tuple, Decimal] = defaultdict(Decimal)
        for usage_date, product, firm_name, kg in records:
            agg[(usage_date, product, firm_name)] += kg

        self.stdout.write(f'\n  Total raw records: {len(records)}')
        self.stdout.write(f'  Unique (date, product, firm): {len(agg)}')

        # Summary by product
        for product in ('tomato', 'pepper'):
            total = sum(v for (_, p, _), v in agg.items() if p == product)
            count = sum(1 for (_, p, _) in agg if p == product)
            self.stdout.write(f'  {product.title()}: {count} records, {total:,.0f} kg total')

        # Sample
        for (d, p, f), kg in sorted(agg.items())[:5]:
            self.stdout.write(f'    {d} | {p} | {f} | {kg:,.0f} kg')
        if len(agg) > 5:
            self.stdout.write(f'    ... and {len(agg) - 5} more')

        if not commit:
            self.stdout.write('\n  DRY RUN — use --commit to write to DB')
            return

        with transaction.atomic():
            # Delete existing usage records imported from this file
            deleted, _ = QuotaUsageRecord.objects.filter(
                notes='Imported from quota.xlsx',
            ).delete()
            if deleted:
                self.stdout.write(f'  Deleted {deleted} previously imported usage records')

            objs = []
            skipped = 0
            for (usage_date, product, firm_name), kg in sorted(agg.items()):
                firm = _get_or_create_firm(firm_name, firm_cache)
                if firm is None:
                    skipped += 1
                    continue
                objs.append(QuotaUsageRecord(
                    usage_date=usage_date,
                    export_firm=firm,
                    kg_used=kg,
                    product_type=product,
                    notes='Imported from quota.xlsx',
                ))

            QuotaUsageRecord.objects.bulk_create(objs, batch_size=500)

            self.stdout.write(self.style.SUCCESS(
                f'\n  Done: {len(objs)} usage records created, '
                f'{len(firm_cache)} firms resolved, {skipped} skipped (firm not found).'
            ))
