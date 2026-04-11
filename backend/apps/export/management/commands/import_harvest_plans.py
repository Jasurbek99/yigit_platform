"""Import weekly harvest plans from Pomidor_Dükany__20252026.xlsx → WeeklyHarvestPlan.

Source: Pomidor_Dükany__20252026.xlsx → sheet 'Hepdelik planlama'

Structure: The sheet is divided into week blocks, each starting with a 'XX-NJY HEPDE' header.
Each week block contains:
  - Header row: Jogapkar | Yyladyshanalar | Mon | Tue | Wed | Thu | Fri | Sat | Jemi | Actual
  - 15 data rows: one per greenhouse block (A-L, M15, M5, O)
  - Total/summary rows (Jemi, truck counts) — skipped

Each block row maps to one WeeklyHarvestPlan record:
  (season, block, week_number, year) → Mon-Sat plan kg + actual total

Skip rows:
  - Block names not matching known GreenhouseBlock codes
  - Rows where ALL plan values are None or 0
  - Aggregate rows (Jemi, Masyn Sany, etc.)
"""
import datetime
import logging
import re
from decimal import Decimal
from pathlib import Path

import openpyxl
from django.core.management.base import BaseCommand
from django.db import transaction

logger = logging.getLogger(__name__)

DEFAULT_PATH = Path(__file__).parents[6] / 'data' / 'p3-export' / 'Pomidor_Dükany__20252026.xlsx'
SHEET_NAME = 'Hepdelik planlama'

# Block name patterns in col 1 → GreenhouseBlock.code
BLOCK_NAME_PATTERNS = {
    'A-Ýyladyşhana': 'A',
    'B-Ýyladyşhana': 'B',
    'C-Ýyladyşhana': 'C',
    'D-Ýyladyşhana': 'D',
    'E-Ýyladyşhana': 'E',
    'F-Ýyladyşhana': 'F',
    'G-Ýyladyşhana': 'G',
    'H-Ýyladyşhana': 'H',
    'I-Ýyladyşhana': 'I',
    'J-Ýyladyşhana': 'J',
    'K-Ýyladyşhana': 'K',
    'L-Ýyladyşhana': 'L',
    'M15-Ýyladyşhana': 'M15',
    'M5-Ýyladyşhana': 'M5',
    'O-Ýyladyşhana': 'O',
}

# Rows to skip by name in col 1
SKIP_ROW_NAMES = {
    'Jemi  (KG)', 'Jemi Masyn Sany', 'Rossiya Masyn Sany', 'Gazak Masyn Sany',
    'Gapy Satys Masyn Sany', 'Yyladyshanalar', 'Jogapkar',
}


def _to_decimal_or_zero(val):
    """Convert numeric value to Decimal; return Decimal(0) if None/zero."""
    if val is None:
        return Decimal('0')
    try:
        d = Decimal(str(val))
        return d if d >= 0 else Decimal('0')
    except Exception:
        return Decimal('0')


def _parse_week_number(header: str):
    """Parse week number from strings like '40-NJY HEPDE' → 40."""
    m = re.match(r'(\d+)', header.strip())
    if m:
        return int(m.group(1))
    return None


class Command(BaseCommand):
    help = 'Import weekly harvest plans from Pomidor_Dükany__20252026.xlsx → WeeklyHarvestPlan'

    def add_arguments(self, parser):
        parser.add_argument('file', nargs='?', default=str(DEFAULT_PATH))
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **options):
        from apps.greenhouse.models import WeeklyHarvestPlan
        from apps.core.models import GreenhouseBlock, Season

        path = Path(options['file'])
        if not path.exists():
            self.stderr.write(f'File not found: {path}')
            return

        dry_run = options['dry_run']

        # Get active season
        season = Season.objects.filter(is_active=True).first()
        if not season:
            self.stderr.write('No active season found — cannot import harvest plans.')
            return
        self.stdout.write(f'Using season: {season.name} (id={season.id})')

        # Pre-load GreenhouseBlock cache
        block_map = {b.code: b for b in GreenhouseBlock.objects.all()}
        self.stdout.write(f'Loaded {len(block_map)} greenhouse blocks: {sorted(block_map.keys())}')

        wb = openpyxl.load_workbook(str(path), read_only=True, data_only=True)
        if SHEET_NAME not in wb.sheetnames:
            self.stderr.write(f'Sheet "{SHEET_NAME}" not found in workbook.')
            wb.close()
            return

        ws = wb[SHEET_NAME]

        entries = []
        skipped = 0
        warnings = []

        # State machine for parsing week blocks
        current_week_number = None
        current_year = None
        current_week_dates = []  # [Mon, Tue, Wed, Thu, Fri, Sat]
        in_week_block = False

        for row in ws.iter_rows(min_row=6, values_only=True):
            pad = list(row)
            while len(pad) < 11:
                pad.append(None)

            col0 = str(pad[0]).strip() if pad[0] else ''
            col1 = str(pad[1]).strip() if pad[1] else ''

            # --- Detect week header ---
            if 'HEPDE' in col0:
                week_num = _parse_week_number(col0)
                if week_num is not None:
                    current_week_number = week_num
                    in_week_block = True
                    current_week_dates = []
                    # Year determined from dates in header row (next non-empty row)
                    current_year = None
                continue

            # --- Detect header row with dates ---
            if in_week_block and col1 == 'Yyladyshanalar':
                # cols 2-7 are the week dates (Mon-Sat)
                current_week_dates = []
                for di in range(2, 8):
                    dval = pad[di]
                    if isinstance(dval, datetime.datetime):
                        current_week_dates.append(dval.date())
                        if current_year is None:
                            current_year = dval.year
                    else:
                        current_week_dates.append(None)
                continue

            # --- Skip aggregate/summary rows ---
            if col1 in SKIP_ROW_NAMES:
                continue

            if not in_week_block or current_week_number is None:
                continue

            # --- Try to match a block name ---
            block_code = None
            for pattern, code in BLOCK_NAME_PATTERNS.items():
                if col1.startswith(pattern.split('-')[0] + '-') or col1.strip() == pattern.strip():
                    block_code = code
                    break
            if block_code is None:
                # Try simpler prefix match
                for pattern, code in BLOCK_NAME_PATTERNS.items():
                    if col1.startswith(code + '-'):
                        block_code = code
                        break

            if block_code is None:
                continue

            block = block_map.get(block_code)
            if block is None:
                warnings.append(f'Week {current_week_number}: block code {block_code!r} not in DB — skipped')
                skipped += 1
                continue

            if current_year is None:
                warnings.append(f'Week {current_week_number}: no year detected — skipped block {block_code}')
                skipped += 1
                continue

            # Extract plan values (cols 2-7)
            plan_vals = [_to_decimal_or_zero(pad[i]) for i in range(2, 8)]

            # Extract actual total (col 9) — stored but model has per-day actuals
            # We only have the weekly total actual, not per-day — store as Monday actual
            actual_total = pad[9]

            # Skip rows where all plan values are 0
            if all(v == Decimal('0') for v in plan_vals):
                skipped += 1
                continue

            entries.append(WeeklyHarvestPlan(
                season=season,
                block=block,
                week_number=current_week_number,
                year=current_year,
                monday_plan_kg=plan_vals[0],
                tuesday_plan_kg=plan_vals[1],
                wednesday_plan_kg=plan_vals[2],
                thursday_plan_kg=plan_vals[3],
                friday_plan_kg=plan_vals[4],
                saturday_plan_kg=plan_vals[5],
                # Actual total stored as monday_actual (only column available)
                monday_actual_kg=_to_decimal_or_zero(actual_total) if actual_total else None,
                entered_by=None,
            ))

        wb.close()

        for w in warnings:
            self.stderr.write(f'WARNING: {w}')

        if dry_run:
            self.stdout.write(
                f'[dry-run] Would import {len(entries)} WeeklyHarvestPlan rows '
                f'({skipped} skipped) | Warnings: {len(warnings)}'
            )
            return

        created = 0
        with transaction.atomic():
            for i in range(0, len(entries), 500):
                batch = entries[i:i + 500]
                result = WeeklyHarvestPlan.objects.bulk_create(
                    batch, batch_size=500, ignore_conflicts=True
                )
                created += len(result)

        self.stdout.write(self.style.SUCCESS(
            f'Imported: {created} | Skipped: {skipped} | Warnings: {len(warnings)}'
        ))
