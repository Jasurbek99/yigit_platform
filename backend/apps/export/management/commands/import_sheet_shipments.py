"""Management command: import shipments from the operational "YGT" Sheet export.

Source: docs/shipments/shipments.xlsx → sheet ``YGT``.

Unlike ``import_shipments`` (which reads the older Hasabat + Export_contracts
files), this source is **transposed**: each *column* (index 3+) is one shipment
and each *row* (1-47) is a field. Column index 2 holds the Turkmen field label,
column index 1 the responsible role.

This command imports ONLY May shipments — cargo codes whose month abbreviation
is ``MY``. May 2026 is the current month, so the data ranges from fully
completed trucks (sale + report dates filled) to in-flight trucks (only loading
filled). Status is **derived** from how far the timestamp chain is filled.

Field → model map (row index → Shipment field):
    r6  documents_status        r28 transit_days / transport_temp_c
    r7  cargo_code              r29 driver_name
    r8  block label (fallback)  r30 driver_phone
    r9  export firm split(s)    r31 border_point
    r10 country                 r32 border_crossed_at
    r11 customer                r33 dest_entry_at
    r14 city                    r34 customs_entry_at (dest customs)
    r15 import_firm             r35 has_peregruz / peregruz_city
    r16 harvest_status          r36 peregruz_date
    r17 vehicle_live_status     r37 arrived_at
    r21 loading_started_at      r39 weight_net  (h = hakyky/actual)
    r22 loading_ended_at        r40 block source(s) — preferred
    r23 departed_at             r41 variety
    r24 vehicle_responsible     r42 harvest_date
    r25 truck_plate             r44 sale_started_at
    r27 customs_exit_at (TM)    r45 sale_ended_at
    r2  notes (transport)       r46 sales_report_date
    r4  export_manager_note     r47 additional_notes_arap
    r18 warehouse_note

Architecture decision note (for reviewer): status is set DIRECTLY on the model
(not via transition_to()). transition_to() is the only path for *live* status
changes; for a historical bulk import it would create spurious ShipmentStatusLog
rows and reject legitimate end-states whose intermediate steps were never
clicked. bulk_create() also intentionally bypasses Shipment.save() (and thus the
task auto-resolution / auto-advance engine) — correct for historical data.

Usage:
    python manage.py import_sheet_shipments --dry-run
    python manage.py import_sheet_shipments
    python manage.py import_sheet_shipments --excel-path /path/to/shipments.xlsx
    python manage.py import_sheet_shipments --limit 20 --dry-run
"""
import datetime
import logging
import os
import re
from collections import Counter
from decimal import Decimal, InvalidOperation

import openpyxl
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.core.models import (
    BorderPoint,
    City,
    Country,
    Customer,
    ExportFirm,
    GreenhouseBlock,
    ImportFirm,
    Season,
    ShipmentStatusType,
    TomatoVariety,
    User,
)
from apps.export.models import (
    Shipment,
    ShipmentBlockSource,
    ShipmentComment,
    ShipmentFirmSplit,
)

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

BATCH_SIZE = 500
SHEET_NAME = 'YGT'
FIRST_DATA_COL = 3            # columns 0-2 are blank / role / label
LABEL_COL = 2
MAX_FIELD_ROW = 47

# Cargo code: DD + 2-letter month + 3-digit seq + slash + 2-digit year
CARGO_CODE_RE = re.compile(r'^\d{2}[A-Z]{2}\d{3}/\d{2}$')

MONTH_ABBREV = {
    'SP': 9, 'OC': 10, 'NV': 11, 'DC': 12, 'JA': 1, 'FB': 2,
    'MR': 3, 'AP': 4, 'MY': 5, 'JN': 6, 'JL': 7, 'AG': 8,
}

# Country label variants → DB Country.code
COUNTRY_LABEL_TO_CODE = {
    'GAZAGYSTAN': 'KZ', 'GAZAKSTAN': 'KZ', 'KAZAKSTAN': 'KZ', 'KZ': 'KZ',
    'ROSSIYA': 'RU', 'RUSSIA': 'RU', 'RU': 'RU',
    'OZBEGISTAN': 'UZ', 'OZBEKYSTAN': 'UZ', 'OZBEKISTAN': 'UZ', 'UZ': 'UZ',
    'GYRGYSYZTAN': 'KG', 'GYRGYZYSTAN': 'KG', 'GYRGYZSTAN': 'KG', 'KG': 'KG',
    'TAJIGISTAN': 'TJ', 'TJ': 'TJ',
    'BELARUS': 'BY', 'BY': 'BY',
    'OWGANYSTAN': 'AF', 'AF': 'AF',
}

# Export firm token (normalized: upper, no dots, single spaces, Ç→C) → DB code.
# Standalone 'MA' historically meant Miweli Atyz (matches the legacy importer);
# the data also carries the full name 'Miweli Atyz H.J'. Both → MIWELIATY.
FIRM_ALIAS = {
    'YIGIT HJ': 'YGT', 'YGT': 'YGT', 'YIGIT': 'YGT',
    'HEMSAYA HJ': 'HMS', 'HMS': 'HMS', 'HEMSAYA': 'HMS',
    'DATLY MIWE HJ': 'DM', 'DM': 'DM', 'DATLY MIWE': 'DM',
    'MIWELI ATYZ HJ': 'MIWELIATY', 'MIWELI ATYZ': 'MIWELIATY', 'MA': 'MIWELIATY',
    'GOKBULUT HJ': 'GOKBOLUT', 'GOK BULUT HJ': 'GOKBOLUT',
    'GOKBULUT': 'GOKBOLUT', 'GOK BULUT': 'GOKBOLUT',
    'GB': 'GB', 'GULBAHAR HJ': 'GB', 'GULBAHAR': 'GB',
    'YUMAK HJ': 'YUMAK', 'YUMAK': 'YUMAK', 'YMK': 'YUMAK',
    'AK BULUT HJ': 'AKBULUT', 'AKBULUT HJ': 'AKBULUT',
    'AKBULUT': 'AKBULUT', 'AK BULUT': 'AKBULUT', 'AB': 'AKBULUT',
    'YE': 'YGTYBARLY', 'YGTYBARLY': 'YGTYBARLY', 'YGTYBARLY ENJAMLAR': 'YGTYBARLY',
    'ISG': 'ISGARHJ', 'ISGAR HJ': 'ISGARHJ', 'ISGARHJ': 'ISGARHJ', 'ISGAR': 'ISGARHJ',
    'TEL DOWRANOW J': 'TELDOWRAN', 'TEL DOW J': 'TELDOWRAN',
    'TEL DOWRANOW E': 'TELDOWRA16', 'TEL DOW E': 'TELDOWRA16',
    'TEL HEMIDOW C': 'TELHEMIDO', 'TEL HEM C': 'TELHEMIDO',
    'TEL HEMIDOW P': 'TELHEMID10', 'TEL HEM P': 'TELHEMID10',
    'TEL GUWANC A': 'TELGUWANC', 'TEL GUWANC': 'TELGUWANC',
    'TEL JUMAMYRADOW G': 'TELJUMAMY', 'TEL JUMAMYRADOW': 'TELJUMAMY',
    'TEL GURBAN J': 'TELGURBAN', 'TEL GURBAN': 'TELGURBAN',
    'TEL AMANGELDIYEW G': 'TELAMANG', 'TEL AMANGELDIYEW': 'TELAMANG',
}

# Active 'Tel' export firms present in the May data but missing from the DB.
# Auto-created on a real run (confirmed with the user). code → name_tk.
EXTRA_EXPORT_FIRMS = {
    'TELGURBAN': 'Tel Gurban J',
    'TELAMANG': 'Tel Amangeldiyew G',
}

# Variety shorthand token (normalized: upper, no spaces) → DB TomatoVariety.name.
# Operators write multi-variety trucks as e.g. 'DEF-RUN', 'MARW-MID-SORT1'.
VARIETY_ALIAS = {
    'MID': 'Midelice', 'DEF': 'Defensiosa', 'DFEN': 'Defensiosa', 'DEFE': 'Defensiosa',
    'RUN': 'Runtino', 'RUNTINO': 'Runtino', 'RED': 'Redity', 'REDITY': 'Redity',
    'SORT1': 'Sort-1', 'SORT2': 'Sort-2', 'MARW': 'Marvelans', 'MARWE': 'Marvelans',
    'FUJIMARO': 'Fujimaro', 'MIX': 'MIX', 'MIKS': 'MIX',
}
VARIETY_SEPARATORS = re.compile(r'[,/\-\s]+')

# Firm field separators (single firm names never contain these).
FIRM_SEPARATORS = re.compile(r'[-+/]')

# Block source separators in r40 / r8.
BLOCK_SEPARATORS = re.compile(r'[,/\-\s]+')

# Multi-character block codes must be matched before single-letter tokenizing.
MULTI_CHAR_BLOCKS = ['M15', 'M5', 'OD', 'OG', 'O']

# Status derivation chain: (model field holding the parsed datetime, status code).
# Walked top-to-bottom; the FIRST filled field wins (most-advanced state).
STATUS_CHAIN = [
    ('sales_report_date', 'tamamlandy'),
    ('sale_ended_at', 'satyldy'),
    ('sale_started_at', 'satylyar'),
    ('arrived_at', 'bardy'),
    ('dest_entry_at', 'dest_entry'),
    ('customs_entry_at', 'gumruk_girish'),
    ('border_crossed_at', 'serhet_gechdi'),
    ('customs_exit_at', 'gumruk_chykysh'),
    ('departed_at', 'yola_chykdy'),
    ('loading_ended_at', 'yuklenme'),
]
DEFAULT_STATUS_CODE = 'yuklenme'

# Timestamp fields used to compute status_changed_at (latest wins).
TIMESTAMP_FIELDS = [
    'loading_started_at', 'loading_ended_at', 'departed_at', 'customs_exit_at',
    'border_crossed_at', 'dest_entry_at', 'customs_entry_at', 'peregruz_date',
    'arrived_at', 'sale_started_at', 'sale_ended_at',
]


# ── Parsing helpers ─────────────────────────────────────────────────────────────

def _norm_str(value) -> str:
    return '' if value is None else str(value).strip()


def _normalize_cargo_code(raw: str) -> str:
    """Replace Cyrillic С (U+0421) with Latin C and strip whitespace."""
    return raw.strip().replace('С', 'C')


def _parse_date_from_cargo_code(code: str) -> datetime.date | None:
    """Derive shipment date from a normalized cargo code DDCC###/YY."""
    if len(code) < 10:
        return None
    month = MONTH_ABBREV.get(code[2:4].upper())
    if month is None:
        return None
    try:
        return datetime.date(int(code[8:10]) + 2000, month, int(code[:2]))
    except (ValueError, OverflowError):
        return None


def _parse_tm_datetime(value) -> datetime.datetime | None:
    """Parse a 'DD.MM.YYYY HH:MM' / 'DD.MM.YYYY' / native datetime cell.

    Returns a timezone-aware datetime, or None for free text ('1 gun ishlenyar').
    """
    if value is None:
        return None
    if isinstance(value, datetime.datetime):
        return _make_aware(value)
    if isinstance(value, datetime.date):
        return _make_aware(datetime.datetime(value.year, value.month, value.day))
    text = _norm_str(value)
    if not text:
        return None
    for fmt in ('%d.%m.%Y %H:%M', '%d.%m.%Y %H.%M', '%d.%m.%Y'):
        try:
            return _make_aware(datetime.datetime.strptime(text, fmt))
        except ValueError:
            continue
    return None


def _parse_tm_date(value) -> datetime.date | None:
    """Parse a date-only cell (sale report / harvest fallback)."""
    dt = _parse_tm_datetime(value)
    return dt.date() if dt else None


def _parse_harvest_date(value) -> datetime.date | None:
    """Best-effort: take the LAST full DD.MM.YYYY found in a messy range string.

    Handles '27-29.09.2025', '30.04-01.05.2026', '15-16.05.2026',
    '29-30.09.2025, 01.10.2025' → end date.
    """
    if isinstance(value, (datetime.datetime, datetime.date)):
        return value.date() if isinstance(value, datetime.datetime) else value
    text = _norm_str(value)
    if not text:
        return None
    matches = re.findall(r'(\d{1,2})\.(\d{1,2})\.(\d{4})', text)
    if not matches:
        return None
    d, m, y = matches[-1]
    try:
        return datetime.date(int(y), int(m), int(d))
    except ValueError:
        return None


def _parse_transit(value) -> tuple[int | None, Decimal | None]:
    """Parse 'N gün T' → (transit_days, transport_temp_c). Best-effort."""
    text = _norm_str(value)
    if not text:
        return None, None
    match = re.search(r'(\d+)\s*g[üu]n\s*(\d+(?:[.,]\d+)?)', text, re.IGNORECASE)
    if not match:
        nums = re.findall(r'\d+', text)
        return (int(nums[0]) if nums else None), None
    days = int(match.group(1))
    temp = _safe_decimal(match.group(2).replace(',', '.'))
    return days, temp


def _safe_decimal(value) -> Decimal | None:
    if value is None or value == '':
        return None
    try:
        return Decimal(str(value).replace(',', '.'))
    except (InvalidOperation, ValueError):
        return None


def _normalize_firm_token(token: str) -> str:
    """Upper, drop dots, Ç→C, collapse whitespace."""
    t = token.strip().upper().replace('Ç', 'C').replace('.', '')
    return re.sub(r'\s+', ' ', t).strip()


def _normalize_block_token(token: str) -> str:
    # Latinize Turkmen Ç and Cyrillic С/с that operators mix into block codes.
    return token.strip().upper().replace('Ç', 'C').replace('С', 'C')


# Turkmen → ASCII fold for country-label matching.
_TM_FOLD = str.maketrans({
    'Ö': 'O', 'Ç': 'C', 'Ý': 'Y', 'Ş': 'S', 'Ň': 'N', 'Ü': 'U', 'Ä': 'A',
})


def _fold_country(raw: str) -> str:
    return raw.upper().translate(_TM_FOLD).strip()


def _parse_variety_tokens(raw: str) -> list[str]:
    """Map a variety shorthand string to an ordered, deduped list of DB names."""
    raw = _norm_str(raw)
    if not raw:
        return []
    folded = raw.upper().replace('SROT', 'SORT')
    folded = re.sub(r'SORT[\s\-]*(\d)', r'SORT\1', folded)
    names: list[str] = []
    for part in VARIETY_SEPARATORS.split(folded):
        token = part.strip().replace(' ', '')
        name = VARIETY_ALIAS.get(token)
        if name and name not in names:
            names.append(name)
    return names


# ── Reference cache ──────────────────────────────────────────────────────────────

class _ReferenceCache:
    """Loads and caches core reference objects for fast lookup during import."""

    def __init__(self, stdout):
        self._stdout = stdout
        self._countries: dict[str, Country] = {}
        self._customers: dict[str, Customer] = {}
        self._import_firms: dict[str, ImportFirm] = {}
        self._export_firms: dict[str, ExportFirm] = {}
        self._blocks: dict[str, GreenhouseBlock] = {}
        self._varieties: dict[str, TomatoVariety] = {}
        self._border_points: dict[str, BorderPoint] = {}
        self._cities: dict[tuple, City] = {}
        self._statuses: dict[str, ShipmentStatusType] = {}
        self._season: Season | None = None
        self._admin_user: User | None = None

        self._created_customers = 0
        self._created_import_firms = 0
        self._created_cities = 0

    def load(self) -> None:
        for c in Country.objects.all():
            self._countries[c.code] = c
        for c in Customer.objects.all():
            self._customers[c.name.upper()] = c
        for f in ImportFirm.objects.all():
            if f.name_company:
                self._import_firms[f.name_company.upper()] = f
            if f.name_short:
                self._import_firms[f.name_short.upper()] = f
        for f in ExportFirm.objects.all():
            self._export_firms[f.code] = f
        for b in GreenhouseBlock.objects.all():
            self._blocks[b.code.upper()] = b
        for v in TomatoVariety.objects.all():
            if v.code:
                self._varieties[v.code.upper()] = v
            if v.name:
                self._varieties[v.name.upper()] = v
        for bp in BorderPoint.objects.all():
            self._border_points[bp.name.upper()] = bp
        for city in City.objects.select_related('country').all():
            self._cities[(city.country.code, city.name.upper())] = city

        self._season = (
            Season.objects.filter(is_active=True).first()
            or Season.objects.order_by('-start_date').first()
        )
        for s in ShipmentStatusType.objects.all():
            self._statuses[s.code] = s
        self._admin_user = (
            User.objects.filter(is_superuser=True).order_by('id').first()
            or User.objects.order_by('id').first()
        )
        self._stdout.write(
            f'  Reference cache: {len(self._countries)} countries, '
            f'{len(self._export_firms)} export firms, {len(self._blocks)} blocks, '
            f'{len(self._border_points)} border points, {len(self._varieties)} varieties'
        )

    def get_country(self, raw: str) -> Country | None:
        code = COUNTRY_LABEL_TO_CODE.get(_fold_country(raw))
        return self._countries.get(code) if code else None

    def get_or_create_customer(self, name: str) -> Customer | None:
        if not name:
            return None
        key = name.upper()
        if key in self._customers:
            return self._customers[key]
        obj = Customer.objects.create(name=name, default_country=self._countries.get('KZ'))
        self._customers[key] = obj
        self._created_customers += 1
        return obj

    def get_or_create_import_firm(self, name: str, country: Country | None) -> ImportFirm | None:
        if not name:
            return None
        key = name.upper()
        if key in self._import_firms:
            return self._import_firms[key]
        obj = ImportFirm.objects.create(name_company=name, country=country)
        self._import_firms[key] = obj
        self._created_import_firms += 1
        return obj

    def get_or_create_city(self, name: str, country: Country | None) -> City | None:
        if not name or country is None:
            return None
        key = (country.code, name.upper())
        if key in self._cities:
            return self._cities[key]
        obj, _ = City.objects.get_or_create(country=country, name=name)
        self._cities[key] = obj
        self._created_cities += 1
        return obj

    def ensure_extra_firms(self, dry_run: bool) -> int:
        """Make sure the confirmed missing 'Tel' export firms are resolvable.

        On a real run they're persisted; on a dry run an unsaved stub keeps
        firm resolution (and the planned-split count) accurate without writing.
        """
        created = 0
        for code, name in EXTRA_EXPORT_FIRMS.items():
            if code in self._export_firms:
                continue
            if dry_run:
                self._export_firms[code] = ExportFirm(code=code, name_tk=name)
            else:
                obj, was_created = ExportFirm.objects.get_or_create(
                    code=code, defaults={'name_tk': name}
                )
                self._export_firms[code] = obj
                created += int(was_created)
        return created

    def get_export_firm(self, code: str) -> ExportFirm | None:
        return self._export_firms.get(code)

    def get_block(self, code: str) -> GreenhouseBlock | None:
        return self._blocks.get(code.upper())

    def get_variety(self, raw: str) -> TomatoVariety | None:
        return self._varieties.get(raw.upper().strip()) if raw else None

    def get_border_point(self, raw: str) -> BorderPoint | None:
        return self._border_points.get(raw.upper().strip()) if raw else None

    def status(self, code: str) -> ShipmentStatusType | None:
        return self._statuses.get(code)

    @property
    def season(self) -> Season | None:
        return self._season

    @property
    def admin_user(self) -> User | None:
        return self._admin_user

    @property
    def stats(self) -> dict:
        return {
            'customers_created': self._created_customers,
            'import_firms_created': self._created_import_firms,
            'cities_created': self._created_cities,
        }


# ── Firm / block resolution ──────────────────────────────────────────────────────

def _resolve_firm_codes(raw: str) -> tuple[list[str], list[str]]:
    """Resolve a raw firm field into (resolved_codes, unresolved_tokens)."""
    raw = _norm_str(raw)
    if not raw:
        return [], []
    whole = FIRM_ALIAS.get(_normalize_firm_token(raw))
    if whole:
        return [whole], []
    resolved: list[str] = []
    unresolved: list[str] = []
    for part in FIRM_SEPARATORS.split(raw):
        token = _normalize_firm_token(part)
        if not token:
            continue
        code = FIRM_ALIAS.get(token)
        if code:
            resolved.append(code)
        else:
            unresolved.append(part.strip())
    return resolved, unresolved


def _tokenize_concatenated_blocks(token: str, known_single: set[str]) -> list[str] | None:
    """Split a separator-free block token like 'ABC' into ['A','B','C']."""
    if all(ch in known_single for ch in token):
        return list(token)
    return None


def _resolve_block_codes(raw: str, known_codes: set[str]) -> tuple[list[str], list[str]]:
    """Resolve r40/r8 block text into (resolved_codes, unresolved_tokens)."""
    raw = _normalize_block_token(_norm_str(raw))
    if not raw:
        return [], []
    raw = re.sub(r'\bBLOK\b', '', raw).strip()
    known_single = {c for c in known_codes if len(c) == 1}
    resolved: list[str] = []
    unresolved: list[str] = []
    for part in BLOCK_SEPARATORS.split(raw):
        part = part.strip()
        if not part:
            continue
        if part in known_codes:
            resolved.append(part)
            continue
        # try multi-char prefixes inside a concatenated chunk (e.g. 'LM15')
        chunk = part
        matched_chunk: list[str] = []
        ok = True
        while chunk:
            for mc in MULTI_CHAR_BLOCKS:
                if chunk.startswith(mc) and mc in known_codes:
                    matched_chunk.append(mc)
                    chunk = chunk[len(mc):]
                    break
            else:
                if chunk[0] in known_single:
                    matched_chunk.append(chunk[0])
                    chunk = chunk[1:]
                else:
                    ok = False
                    break
        if ok and matched_chunk:
            resolved.extend(matched_chunk)
        else:
            unresolved.append(part)
    # dedupe, preserve order
    seen: set[str] = set()
    deduped = [c for c in resolved if not (c in seen or seen.add(c))]
    return deduped, unresolved


# ── Sheet reader ─────────────────────────────────────────────────────────────────

def _read_sheet(path: str, month_filter: str) -> list[dict]:
    """Read the transposed YGT sheet → one dict per column matching month_filter."""
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[SHEET_NAME]
    grid = list(ws.iter_rows(min_row=1, max_row=MAX_FIELD_ROW, values_only=True))
    wb.close()

    def cell(row_idx: int, col_idx: int):
        row = grid[row_idx - 1]
        return row[col_idx] if col_idx < len(row) else None

    n_cols = max(len(r) for r in grid)
    records: list[dict] = []
    for col in range(FIRST_DATA_COL, n_cols):
        raw_code = cell(7, col)
        if not isinstance(raw_code, str):
            continue
        code = _normalize_cargo_code(raw_code)
        if not CARGO_CODE_RE.match(code):
            continue
        if code[2:4].upper() != month_filter:
            continue
        records.append({
            'col': col,
            'cargo_code': code,
            'documents_status': _norm_str(cell(6, col)),
            'block_r8': _norm_str(cell(8, col)),
            'firm_raw': _norm_str(cell(9, col)),
            'country_raw': _norm_str(cell(10, col)),
            'customer_raw': _norm_str(cell(11, col)),
            'city_raw': _norm_str(cell(14, col)),
            'import_firm_raw': _norm_str(cell(15, col)),
            'harvest_status': _norm_str(cell(16, col)),
            'vehicle_live_status': _norm_str(cell(17, col)),
            'transport_note': _norm_str(cell(2, col)),
            'extra_note': _norm_str(cell(4, col)),
            'warehouse_note': _norm_str(cell(18, col)),
            'loading_started_at': _parse_tm_datetime(cell(21, col)),
            'loading_ended_at': _parse_tm_datetime(cell(22, col)),
            'departed_at': _parse_tm_datetime(cell(23, col)),
            'vehicle_responsible': _norm_str(cell(24, col))[:50],
            'truck_plate': _norm_str(cell(25, col))[:50],
            'customs_exit_at': _parse_tm_datetime(cell(27, col)),
            'transit_raw': cell(28, col),
            'driver_name': _norm_str(cell(29, col))[:100],
            'driver_phone': _norm_str(cell(30, col))[:30],
            'border_raw': _norm_str(cell(31, col)),
            'border_crossed_at': _parse_tm_datetime(cell(32, col)),
            'dest_entry_at': _parse_tm_datetime(cell(33, col)),
            'customs_entry_at': _parse_tm_datetime(cell(34, col)),
            'peregruz_raw': _norm_str(cell(35, col)),
            'peregruz_date': _parse_tm_datetime(cell(36, col)),
            'arrived_at': _parse_tm_datetime(cell(37, col)),
            'weight_net': _safe_decimal(cell(39, col)),
            'block_r40': _norm_str(cell(40, col)),
            'variety_raw': _norm_str(cell(41, col)),
            'harvest_date': _parse_harvest_date(cell(42, col)),
            'sale_started_at': _parse_tm_datetime(cell(44, col)),
            'sale_ended_at': _parse_tm_datetime(cell(45, col)),
            'sales_report_date': _parse_tm_date(cell(46, col)),
            'additional_notes_arap': _norm_str(cell(47, col)),
        })
    return records


def _make_aware(dt: datetime.datetime) -> datetime.datetime:
    if timezone.is_naive(dt):
        return timezone.make_aware(dt, timezone.get_current_timezone())
    return dt


def _derive_status_code(rec: dict) -> str:
    for field, code in STATUS_CHAIN:
        if rec.get(field):
            return code
    return DEFAULT_STATUS_CODE


def _derive_status_changed_at(rec: dict, fallback_date: datetime.date) -> datetime.datetime:
    stamps = [rec[f] for f in TIMESTAMP_FIELDS if rec.get(f)]
    if rec.get('sales_report_date'):
        stamps.append(_make_aware(datetime.datetime.combine(
            rec['sales_report_date'], datetime.time.min)))
    if stamps:
        return max(stamps)
    return _make_aware(datetime.datetime.combine(fallback_date, datetime.time.min))


# ── Command ──────────────────────────────────────────────────────────────────────

class Command(BaseCommand):
    help = 'Import May shipments from docs/shipments/shipments.xlsx (transposed YGT sheet).'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', default=False,
                            help='Parse and validate but do not write to the database.')
        parser.add_argument('--excel-path', default=None,
                            help='Path to shipments.xlsx. Defaults to docs/shipments/shipments.xlsx')
        parser.add_argument('--month', default='MY',
                            help='2-letter month abbreviation to import (default: MY = May).')
        parser.add_argument('--limit', type=int, default=None,
                            help='Import at most N shipments (for testing).')

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        month = options['month'].upper()
        limit = options['limit']

        path = options['excel_path']
        if path is None:
            backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(
                os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))
            project_root = os.path.dirname(backend_dir)
            path = os.path.join(project_root, 'docs', 'shipments', 'shipments.xlsx')
        if not os.path.exists(path):
            raise CommandError(f'Excel file not found: {path}')

        if dry_run:
            self.stdout.write(self.style.WARNING('DRY RUN — no data will be written.\n'))

        self.stdout.write(f'Reading {SHEET_NAME} sheet (month={month})...')
        records = _read_sheet(path, month)
        self.stdout.write(f'  {len(records)} {month} shipment columns found')
        if limit:
            records = records[:limit]
            self.stdout.write(f'  limited to {len(records)}')

        self.stdout.write('Loading reference data...')
        cache = _ReferenceCache(self.stdout)
        cache.load()
        if cache.season is None:
            raise CommandError('No Season found. Run: python manage.py seed_data')
        if cache.admin_user is None:
            raise CommandError('No User found. Run: python manage.py seed_data')
        firms_created = cache.ensure_extra_firms(dry_run)
        if firms_created:
            self.stdout.write(f'  Created {firms_created} missing export firm(s)')
        known_block_codes = set(cache._blocks.keys())

        # Counters / diagnostics
        cnt = Counter()
        self._bad_rows: list[tuple[str, str]] = []
        warnings: list[str] = []
        status_dist: Counter = Counter()
        unresolved_firms: Counter = Counter()
        unresolved_blocks: Counter = Counter()

        # Build in-memory objects keyed by cargo_code for the flush stage.
        shipments: list[Shipment] = []
        pending_firm_splits: dict[str, list[str]] = {}
        pending_block_sources: dict[str, list[str]] = {}
        pending_varieties: dict[str, list] = {}
        pending_comments: dict[str, list[str]] = {}

        existing_codes = set(
            Shipment.objects.filter(
                cargo_code__in=[r['cargo_code'] for r in records]
            ).values_list('cargo_code', flat=True)
        )
        seen: set[str] = set()

        for rec in records:
            code = rec['cargo_code']
            if code in seen:
                warnings.append(f'{code}: duplicate cargo code within sheet — skipped')
                cnt['skipped_dup'] += 1
                continue
            seen.add(code)
            if code in existing_codes:
                cnt['skipped_existing'] += 1
                continue

            ship_date = _parse_date_from_cargo_code(code)
            if ship_date is None:
                warnings.append(f'{code}: cannot derive date from cargo code — skipped')
                cnt['skipped_bad_date'] += 1
                continue

            country = cache.get_country(rec['country_raw']) if rec['country_raw'] else None
            if rec['country_raw'] and not country:
                warnings.append(f'{code}: unknown country {rec["country_raw"]!r}')

            is_gapy = 'gapy' in rec['customer_raw'].lower() or 'gapy' in rec['city_raw'].lower()
            customer_name = 'ÝGT Gapy Satyş' if is_gapy and rec['customer_raw'] else rec['customer_raw']
            customer = cache.get_or_create_customer(customer_name) if customer_name else None

            city = None
            if rec['city_raw'] and 'gapy' not in rec['city_raw'].lower() and rec['city_raw'] != '-':
                city = cache.get_or_create_city(rec['city_raw'], country)

            import_firm = (
                cache.get_or_create_import_firm(rec['import_firm_raw'], country)
                if rec['import_firm_raw'] else None
            )

            variety_names = _parse_variety_tokens(rec['variety_raw'])
            variety_objs = [v for v in (cache.get_variety(n) for n in variety_names) if v]
            variety = variety_objs[0] if variety_objs else None
            if rec['variety_raw'] and not variety:
                cnt['variety_unmatched'] += 1

            border_point = cache.get_border_point(rec['border_raw'])
            transit_days, temp_c = _parse_transit(rec['transit_raw'])

            peregruz_raw = rec['peregruz_raw']
            has_peregruz = bool(peregruz_raw) and peregruz_raw not in ('-', '—')
            peregruz_city = peregruz_raw[:100] if has_peregruz else None

            status_code = _derive_status_code(rec)
            status_obj = cache.status(status_code) or cache.status(DEFAULT_STATUS_CODE)
            status_dist[status_code] += 1

            notes = ' | '.join(p for p in (rec['transport_note'], rec['extra_note']) if p) or None

            shipment = Shipment(
                cargo_code=code,
                # The source's only code IS the platform code; mirror it into the
                # operator-facing "Shipment Code" row so that visible Sheet row is
                # filled (operators can later overwrite with the real pallet code).
                official_export_code=code,
                date=ship_date,
                season=cache.season,
                status=status_obj,
                status_changed_at=_derive_status_changed_at(rec, ship_date),
                country=country,
                city=city,
                customer=customer,
                import_firm=import_firm,
                border_point=border_point,
                variety=variety,
                variety_confidence='low' if variety else 'none',
                is_gapy_satys=is_gapy,
                documents_status=rec['documents_status'][:20] or None,
                harvest_status=rec['harvest_status'][:20] or None,
                vehicle_live_status=rec['vehicle_live_status'][:200] or None,
                vehicle_responsible=rec['vehicle_responsible'] or None,
                truck_plate=rec['truck_plate'] or None,
                driver_name=rec['driver_name'] or None,
                driver_phone=rec['driver_phone'] or None,
                transit_days=transit_days,
                transport_temp_c=temp_c,
                has_peregruz=has_peregruz,
                peregruz_city=peregruz_city,
                peregruz_date=rec['peregruz_date'],
                weight_net=rec['weight_net'],
                loading_started_at=rec['loading_started_at'],
                loading_ended_at=rec['loading_ended_at'],
                departed_at=rec['departed_at'],
                customs_exit_at=rec['customs_exit_at'],
                border_crossed_at=rec['border_crossed_at'],
                dest_entry_at=rec['dest_entry_at'],
                customs_entry_at=rec['customs_entry_at'],
                arrived_at=rec['arrived_at'],
                sale_started_at=rec['sale_started_at'],
                sale_ended_at=rec['sale_ended_at'],
                sales_report_date=rec['sales_report_date'],
                harvest_date=rec['harvest_date'],
                notes=notes,
                warehouse_note=rec['warehouse_note'],
                additional_notes_arap=rec['additional_notes_arap'],
                created_by=cache.admin_user,
            )
            shipments.append(shipment)
            cnt['imported'] += 1
            if len(variety_objs) > 1:
                pending_varieties[code] = variety_objs

            # Firm splits
            firm_codes, firm_unresolved = _resolve_firm_codes(rec['firm_raw'])
            valid_firm_codes = []
            for fc in firm_codes:
                if cache.get_export_firm(fc):
                    valid_firm_codes.append(fc)
                else:
                    firm_unresolved.append(fc)
            for u in firm_unresolved:
                unresolved_firms[u] += 1
            if valid_firm_codes:
                pending_firm_splits[code] = valid_firm_codes
                cnt['firm_splits_planned'] += len(valid_firm_codes)
            elif rec['firm_raw']:
                warnings.append(f'{code}: no export firm resolved from {rec["firm_raw"]!r}')

            # Block sources — prefer r40, fall back to r8
            block_src = rec['block_r40'] or rec['block_r8']
            block_codes, block_unresolved = _resolve_block_codes(block_src, known_block_codes)
            for u in block_unresolved:
                unresolved_blocks[u] += 1
            if block_codes:
                pending_block_sources[code] = block_codes
                cnt['block_sources_planned'] += len(block_codes)
            elif block_src:
                cnt['block_unmatched'] += 1

            if len(shipments) >= BATCH_SIZE and not dry_run:
                self._flush(shipments, pending_firm_splits, pending_block_sources,
                            pending_varieties, cache, cnt)
                shipments.clear()

        if not dry_run and shipments:
            self._flush(shipments, pending_firm_splits, pending_block_sources,
                        pending_varieties, cache, cnt)
            shipments.clear()

        self._report(dry_run, cnt, status_dist, unresolved_firms,
                     unresolved_blocks, warnings, cache)

    def _flush(self, shipments, pending_firm_splits, pending_block_sources,
               pending_varieties, cache, cnt) -> None:
        """Bulk-create a batch of shipments plus their firm splits and block sources."""
        if not shipments:
            return
        existing = set(
            Shipment.objects.filter(
                cargo_code__in=[s.cargo_code for s in shipments]
            ).values_list('cargo_code', flat=True)
        )
        to_insert = [s for s in shipments if s.cargo_code not in existing]
        if not to_insert:
            return

        # Fast path: one bulk insert. If a single row trips an MSSQL constraint
        # (e.g. a numeric overflow), fall back to per-row inserts so one bad row
        # doesn't sink the whole batch — bad rows are skipped and reported.
        try:
            with transaction.atomic():
                Shipment.objects.bulk_create(to_insert, batch_size=BATCH_SIZE)
        except Exception:
            for obj in to_insert:
                try:
                    with transaction.atomic():
                        Shipment.objects.bulk_create([obj])
                except Exception as exc:  # noqa: BLE001 — record and continue
                    cnt['insert_errors'] += 1
                    self._bad_rows.append((obj.cargo_code, str(exc)[:140]))

        with transaction.atomic():
            # MSSQL doesn't return PKs from bulk_create — re-fetch by cargo_code so
            # the child rows (splits / block sources / M2M) get valid FK ids.
            created = list(
                Shipment.objects.filter(
                    cargo_code__in=[s.cargo_code for s in to_insert]
                )
            )

            splits: list[ShipmentFirmSplit] = []
            sources: list[ShipmentBlockSource] = []
            for ship in created:
                firm_codes = pending_firm_splits.pop(ship.cargo_code, [])
                per_firm = (
                    (ship.weight_net / len(firm_codes))
                    if ship.weight_net and firm_codes else Decimal('0.00')
                )
                for order, fc in enumerate(firm_codes, start=1):
                    firm = cache.get_export_firm(fc)
                    if firm is None:
                        continue
                    splits.append(ShipmentFirmSplit(
                        shipment=ship, export_firm=firm,
                        weight_kg=per_firm, amount_usd=None, split_order=order,
                    ))

                block_codes = pending_block_sources.pop(ship.cargo_code, [])
                per_block = (
                    (ship.weight_net / len(block_codes))
                    if ship.weight_net and block_codes else Decimal('0.00')
                )
                for bc in block_codes:
                    block = cache.get_block(bc)
                    if block is None:
                        continue
                    sources.append(ShipmentBlockSource(
                        shipment=ship, block=block,
                        weight_kg=per_block, harvest_date=ship.harvest_date,
                    ))

            if splits:
                ShipmentFirmSplit.objects.bulk_create(splits, batch_size=BATCH_SIZE)
                cnt['firm_splits'] += len(splits)
            if sources:
                ShipmentBlockSource.objects.bulk_create(sources, batch_size=BATCH_SIZE)
                cnt['block_sources'] += len(sources)

            # varieties_dominant M2M (only for multi-variety trucks) via through model.
            through = Shipment.varieties_dominant.through
            links = []
            for ship in created:
                for variety in pending_varieties.pop(ship.cargo_code, []):
                    links.append(through(shipment_id=ship.id, tomatovariety_id=variety.id))
            if links:
                through.objects.bulk_create(links, batch_size=BATCH_SIZE)
                cnt['variety_links'] += len(links)

    def _report(self, dry_run, cnt, status_dist, unresolved_firms,
                unresolved_blocks, warnings, cache) -> None:
        self.stdout.write('')
        self.stdout.write('=== Import Summary ===')
        if dry_run:
            self.stdout.write(self.style.WARNING('(DRY RUN — nothing was written)'))
        self.stdout.write(self.style.SUCCESS(f'Imported:            {cnt["imported"]:,} shipments'))
        self.stdout.write(f'Firm splits:         {cnt["firm_splits"]:,} '
                          f'(planned {cnt["firm_splits_planned"]:,})')
        self.stdout.write(f'Block sources:       {cnt["block_sources"]:,} '
                          f'(planned {cnt["block_sources_planned"]:,})')
        self.stdout.write(f'Variety M2M links:   {cnt["variety_links"]:,}')
        self.stdout.write(f'Skipped (existing):  {cnt["skipped_existing"]:,}')
        self.stdout.write(f'Skipped (dup):       {cnt["skipped_dup"]:,}')
        self.stdout.write(f'Skipped (bad date):  {cnt["skipped_bad_date"]:,}')
        self.stdout.write(f'Insert errors:       {cnt["insert_errors"]:,}')
        self.stdout.write(f'Block unmatched:     {cnt["block_unmatched"]:,}')
        self.stdout.write(f'Variety unmatched:   {cnt["variety_unmatched"]:,}')
        self.stdout.write(f'Customers created:   {cache.stats["customers_created"]:,}')
        self.stdout.write(f'Import firms created:{cache.stats["import_firms_created"]:,}')
        self.stdout.write(f'Cities created:      {cache.stats["cities_created"]:,}')

        self.stdout.write('')
        self.stdout.write('--- Status distribution ---')
        for code, n in status_dist.most_common():
            self.stdout.write(f'  {code:18} {n:,}')

        if unresolved_firms:
            self.stdout.write('')
            self.stdout.write('--- Unresolved firm tokens (not in DB) ---')
            for tok, n in unresolved_firms.most_common():
                self.stdout.write(self.style.WARNING(f'  {n:3} {tok!r}'))
        if unresolved_blocks:
            self.stdout.write('')
            self.stdout.write('--- Unresolved block tokens ---')
            for tok, n in unresolved_blocks.most_common(20):
                self.stdout.write(self.style.WARNING(f'  {n:3} {tok!r}'))
        if self._bad_rows:
            self.stdout.write('')
            self.stdout.write(self.style.ERROR(f'--- Insert errors ({len(self._bad_rows)}) ---'))
            for code, reason in self._bad_rows:
                self.stdout.write(self.style.ERROR(f'  {code}: {reason}'))

        if warnings:
            self.stdout.write('')
            self.stdout.write(f'--- Warnings ({len(warnings)}, first 25) ---')
            for w in warnings[:25]:
                self.stdout.write(self.style.WARNING(f'  {w}'))
