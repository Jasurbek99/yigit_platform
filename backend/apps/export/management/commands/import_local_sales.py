"""Import historical local market sales from quota.xlsx Sheet 2 into WeeklyLocalSellPlan.

Reads sheet "Kwota ucin icerki bazara berlen": daily per-firm domestic sales,
aggregates into weekly (Mon-Sat) plan_kg, and creates WeeklyLocalSellPlan rows.

Usage:
    python manage.py import_local_sales                  # dry-run
    python manage.py import_local_sales --commit         # write to DB
"""
import logging
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

import openpyxl
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.core.models import ExportFirm, Season
from apps.export.models import WeeklyLocalSellPlan

logger = logging.getLogger(__name__)

DEFAULT_PATH = Path(__file__).parents[5] / 'data' / 'quota.xlsx'
SHEET_NAME = 'Kwota ucin icerki bazara berlen'

# Excel firm name → DB name_en mapping
FIRM_NAME_MAP = {
    'Yigit H.J.': 'YGT HJ',
    'Hemsaya': 'Hemsaya HJ',
    'Datly Miwe': 'Durli Miweler HJ',
    'Gok Bulut': 'GOK BOLUT',
    'Miweli Atyz': 'MIWELI ATYZ',
    'Ygtybarly Enjam': 'YGTYBARLY',
    'Isgar HJ': 'ISGAR HJ',
    'Ak Bulut': 'AKBULUT',
    'Tel JD': 'Tel Dowranow J',
    'Tel ED': 'Tel Dowranow E',
    'Tel G Amangeldiyew': 'Tel Guwanc A.',
    'Tel CH': 'Tel Hemidow C',
    'Tel PH': 'Tel Hemidow P',
    'Yumak H J': 'YUMAK',
    'Tel GJ': 'Tel Jumamyradow G',
}


def _auto_create_firm(name: str) -> ExportFirm:
    """Create a missing ExportFirm from the Excel name."""
    db_name = FIRM_NAME_MAP.get(name, name)
    code = db_name[:10].upper().replace(' ', '').replace('.', '')
    if ExportFirm.objects.filter(code=code).exists():
        code = code[:8] + str(ExportFirm.objects.count())
    return ExportFirm.objects.create(
        code=code, name_en=db_name, name_tk=db_name, is_active=True,
    )

DAY_FIELDS = {
    1: 'monday_plan_kg',
    2: 'tuesday_plan_kg',
    3: 'wednesday_plan_kg',
    4: 'thursday_plan_kg',
    5: 'friday_plan_kg',
    6: 'saturday_plan_kg',
}


def _resolve_firm(name: str, cache: dict) -> ExportFirm | None:
    """Resolve Excel firm name to ExportFirm."""
    if name in cache:
        return cache[name]

    db_name = FIRM_NAME_MAP.get(name, name)
    firm = ExportFirm.objects.filter(name_en__iexact=db_name).first()
    if not firm:
        firm = ExportFirm.objects.filter(name_en__icontains=name).first()
    if not firm:
        firm = ExportFirm.objects.filter(name_tk__icontains=name).first()

    cache[name] = firm
    return firm


class Command(BaseCommand):
    help = 'Import historical local sales from quota.xlsx into WeeklyLocalSellPlan'

    def add_arguments(self, parser):
        parser.add_argument('path', nargs='?', default=str(DEFAULT_PATH))
        parser.add_argument('--commit', action='store_true')

    def handle(self, *args, **options):
        path = Path(options['path'])
        commit = options['commit']

        if not path.exists():
            self.stderr.write(f'File not found: {path}')
            return

        self.stdout.write(f'Loading {path} ...')
        wb = openpyxl.load_workbook(path, data_only=True)

        if SHEET_NAME not in wb.sheetnames:
            self.stderr.write(f'Sheet "{SHEET_NAME}" not found')
            return

        ws = wb[SHEET_NAME]

        # Read dates from row 3
        dates: dict[int, date] = {}
        for col in range(3, ws.max_column + 1):
            val = ws.cell(row=3, column=col).value
            if isinstance(val, datetime):
                dates[col] = val.date()
            elif isinstance(val, date):
                dates[col] = val

        self.stdout.write(f'  Dates: {len(dates)} (from {min(dates.values())} to {max(dates.values())})')

        # Read per-firm daily data (rows 4-18)
        firm_cache: dict[str, ExportFirm | None] = {}

        # Structure: {(year, week, firm_id): {day_field: Decimal}}
        weekly_data: dict[tuple, dict[str, Decimal]] = defaultdict(lambda: {f: Decimal('0') for f in DAY_FIELDS.values()})

        firms_found = 0
        firms_missing = []
        total_kg = Decimal('0')

        for row_idx in range(4, 19):
            name = ws.cell(row=row_idx, column=1).value
            if not name:
                continue
            name = str(name).strip()

            firm = _resolve_firm(name, firm_cache)
            if not firm:
                if commit:
                    firm = _auto_create_firm(name)
                    firm_cache[name] = firm
                    self.stdout.write(f'    Created firm: {firm.name_en} (id={firm.id})')
                else:
                    firms_missing.append(name)
                    continue

            firms_found += 1

            for col, d in dates.items():
                val = ws.cell(row=row_idx, column=col).value
                if not val or not isinstance(val, (int, float)) or val <= 0:
                    continue

                iso = d.isocalendar()
                weekday = iso[2]  # 1=Mon, 7=Sun
                if weekday > 6:  # Skip Sunday
                    continue

                day_field = DAY_FIELDS.get(weekday)
                if not day_field:
                    continue

                key = (iso[0], iso[1], firm.id)
                weekly_data[key][day_field] += Decimal(str(int(val)))
                total_kg += Decimal(str(int(val)))

        self.stdout.write(f'  Firms resolved: {firms_found}')
        if firms_missing:
            self.stdout.write(f'  Firms NOT found in DB: {firms_missing}')
        self.stdout.write(f'  Weekly plan rows to create: {len(weekly_data)}')
        self.stdout.write(f'  Total kg: {total_kg:,.0f}')

        # Preview
        for (year, week, firm_id), days in sorted(weekly_data.items())[:5]:
            total = sum(days.values())
            self.stdout.write(f'    W{week}/{year} firm#{firm_id}: {total:,.0f} kg')
        if len(weekly_data) > 5:
            self.stdout.write(f'    ... and {len(weekly_data) - 5} more')

        if not commit:
            self.stdout.write('\n  DRY RUN — use --commit to write to DB')
            return

        # Get active season
        season = Season.objects.filter(is_active=True).first()

        with transaction.atomic():
            # Delete previously imported rows (notes-based or by excluding W15 current week)
            deleted, _ = WeeklyLocalSellPlan.objects.exclude(
                week_number=15, year=2026,  # Keep current week's manual entries
            ).delete()
            if deleted:
                self.stdout.write(f'  Deleted {deleted} old plan rows')

            created = 0
            for (year, week, firm_id), days in weekly_data.items():
                # Skip if already exists (W15 current week manual data)
                if WeeklyLocalSellPlan.objects.filter(
                    export_firm_id=firm_id, week_number=week, year=year
                ).exists():
                    continue

                WeeklyLocalSellPlan.objects.create(
                    export_firm_id=firm_id,
                    week_number=week,
                    year=year,
                    season=season,
                    status='approved',  # Historical data = already approved
                    **days,
                )
                created += 1

            self.stdout.write(self.style.SUCCESS(
                f'\n  Done: {created} WeeklyLocalSellPlan rows created.'
            ))
