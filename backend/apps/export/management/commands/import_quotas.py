"""Import government export quotas from quota.xlsx into QuotaIssuance.

Reads sheet Kwota-2: quota grant events (rows 9-16, cols B-P for tomato, X-AB for pepper).
Groups per-firm amounts by issue date into QuotaIssuance + QuotaIssuanceFirmAllocation.

Usage:
    python manage.py import_quotas                  # dry-run (default)
    python manage.py import_quotas --commit         # write to DB
    python manage.py import_quotas /path/to/file    # custom path
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
from apps.export.models import QuotaIssuance, QuotaIssuanceFirmAllocation

logger = logging.getLogger(__name__)

DEFAULT_PATH = Path(__file__).parents[5] / 'data' / 'quota.xlsx'

# Excel firm name → DB firm name_en (for existing firms)
FIRM_NAME_MAP = {
    'YIGIT': 'YGT HJ',
    'HEMSAYA': 'Hemsaya HJ',
    'DATLY MIWE': 'Durli Miweler HJ',
}

# Tomato section: row 8 headers in cols B(2) through P(16)
TOMATO_FIRM_COLS = list(range(2, 17))
TOMATO_DATA_ROWS = list(range(9, 17))

# Pepper section: row 8 headers in cols X(24) through AB(28)
PEPPER_FIRM_COLS = list(range(24, 29))
PEPPER_DATA_ROWS = list(range(9, 17))

SHEET_QUOTA = 'Kwota-2'


def _parse_date(raw) -> date | None:
    """Parse mixed date formats from the Excel file."""
    if raw is None:
        return None
    if isinstance(raw, datetime):
        return raw.date()
    if isinstance(raw, date):
        return raw

    s = str(raw).strip()
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


def _get_or_create_firm(name: str, firm_cache: dict) -> ExportFirm:
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
        code = key[:10].replace(' ', '').replace('.', '')
        if ExportFirm.objects.filter(code=code).exists():
            code = code[:8] + str(ExportFirm.objects.count())
        firm = ExportFirm.objects.create(
            code=code, name_en=name.strip(), name_tk=name.strip(), is_active=True,
        )
        logger.info('Created ExportFirm: %s (code=%s, id=%d)', firm.name_en, firm.code, firm.id)

    firm_cache[key] = firm
    return firm


class Command(BaseCommand):
    help = 'Import quota issuances from quota.xlsx'

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
        ws1 = wb[SHEET_QUOTA]
        firm_cache: dict[str, ExportFirm] = {}

        # Structure: {(issue_date, product_type): [(firm_name, kg)]}
        issuance_data: dict[tuple[date, str], list[tuple[str, Decimal]]] = defaultdict(list)

        def _read_section(firm_cols: list[int], data_rows: list[int], product: str):
            col_firms: dict[int, str] = {}
            for col in firm_cols:
                name = ws1.cell(row=8, column=col).value
                if name and str(name).strip():
                    col_firms[col] = str(name).strip()

            self.stdout.write(f'  {product.title()} section: {len(col_firms)} firms')

            for row_idx in data_rows:
                grant_date = _parse_date(ws1.cell(row=row_idx, column=1).value)
                if not grant_date:
                    continue

                for col, firm_name in col_firms.items():
                    val = ws1.cell(row=row_idx, column=col).value
                    if not val:
                        continue
                    try:
                        kg = Decimal(str(val))
                    except Exception:
                        continue
                    if kg <= 0:
                        continue

                    issuance_data[(grant_date, product)].append((firm_name, kg))

        _read_section(TOMATO_FIRM_COLS, TOMATO_DATA_ROWS, 'tomato')
        _read_section(PEPPER_FIRM_COLS, PEPPER_DATA_ROWS, 'pepper')

        self.stdout.write(f'\n  Issuance events: {len(issuance_data)}')
        total_allocs = sum(len(v) for v in issuance_data.values())
        self.stdout.write(f'  Total firm allocations: {total_allocs}')

        for (d, p), allocs in sorted(issuance_data.items())[:5]:
            total = sum(kg for _, kg in allocs)
            self.stdout.write(f'    {d} | {p} | {len(allocs)} firms | {total:,.0f} kg')
        if len(issuance_data) > 5:
            self.stdout.write(f'    ... and {len(issuance_data) - 5} more')

        if not commit:
            self.stdout.write('\n  DRY RUN — use --commit to write to DB')
            return

        with transaction.atomic():
            deleted_i, _ = QuotaIssuance.objects.filter(notes='Imported from quota.xlsx').delete()
            if deleted_i:
                self.stdout.write(f'  Deleted {deleted_i} previously imported issuances')

            created_issuances = 0
            created_allocs = 0

            for (issue_date, product_type), allocs in sorted(issuance_data.items()):
                iso = issue_date.isocalendar()
                issuance = QuotaIssuance.objects.create(
                    issue_date=issue_date,
                    product_type=product_type,
                    matched_week=iso[1],
                    matched_year=iso[0],
                    notes='Imported from quota.xlsx',
                )
                created_issuances += 1

                alloc_objs = []
                for firm_name, kg in allocs:
                    firm = _get_or_create_firm(firm_name, firm_cache)
                    alloc_objs.append(
                        QuotaIssuanceFirmAllocation(
                            issuance=issuance,
                            export_firm=firm,
                            kg_quota=kg,
                        )
                    )
                QuotaIssuanceFirmAllocation.objects.bulk_create(alloc_objs, batch_size=500)
                created_allocs += len(alloc_objs)

            self.stdout.write(self.style.SUCCESS(
                f'\n  Done: {created_issuances} issuances, {created_allocs} firm allocations, '
                f'{len(firm_cache)} firms resolved/created.'
            ))
