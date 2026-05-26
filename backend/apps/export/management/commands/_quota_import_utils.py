"""Shared helpers for the quota.xlsx importers.

Underscore-prefixed so Django's command loader ignores it. Used by
``import_quotas`` (issued), ``import_quota_usage`` (used) and
``import_local_sales`` (domestic sales) to resolve firm names and parse
the file's mixed date formats consistently.
"""
import logging
import re
from datetime import date, datetime

from apps.core.models import ExportFirm

logger = logging.getLogger(__name__)

# Excel firm label (UPPER, whitespace-collapsed) → canonical ExportFirm.name_en.
# Covers both naming styles in the file: the Kwota-2 sheet spells the
# Telekeci firms out ("Tel Dowranow E"), while the domestic-sales sheet uses
# initials ("Tel ED"). The initials map was verified against existing data:
# "Tel ED" total (71 278 kg) matches Tel Dowranow E exactly.
FIRM_NAME_MAP = {
    'YIGIT': 'YGT HJ',
    'YIGIT H.J.': 'YGT HJ',
    'HEMSAYA': 'Hemsaya HJ',
    'GOK BOLUT': 'GOK BOLUT',
    'GOK BULUT': 'GOK BOLUT',
    'MIWELI ATYZ': 'MIWELI ATYZ',
    'DATLY MIWE': 'Durli Miweler HJ',
    'YGTYBARLY': 'YGTYBARLY',
    'YGTYBARLY ENJAM': 'YGTYBARLY',
    'ISGAR HJ': 'ISGAR HJ',
    'AKBULUT': 'AKBULUT',
    'AK BULUT': 'AKBULUT',
    'YUMAK': 'YUMAK',
    'YUMAK H J': 'YUMAK',
    'TEL DOWRANOW E': 'Tel Dowranow E',
    'TEL DOWRANOW J': 'Tel Dowranow J',
    'TEL HEMIDOW P': 'Tel Hemidow P',
    'TEL HEMIDOW C': 'Tel Hemidow C',
    'TEL GUWANC A.': 'Tel Guwanc A.',
    'TEL JUMAMYRADOW G': 'Tel Jumamyradow G',
    # Domestic-sales sheet abbreviations ([first initial][surname initial]):
    'TEL JD': 'Tel Dowranow J',
    'TEL ED': 'Tel Dowranow E',
    'TEL CH': 'Tel Hemidow C',
    'TEL PH': 'Tel Hemidow P',
    'TEL GJ': 'Tel Gurban J',
    'TEL G AMANGELDIYEW': 'Tel Amangeldiyew G',
}


def _norm(name: str) -> str:
    """Uppercase and collapse internal whitespace for stable map lookups."""
    return re.sub(r'\s+', ' ', str(name).strip().upper())


def parse_quota_date(raw, *, fix_out_of_season: bool = False) -> date | None:
    """Parse the file's mixed date formats.

    Handles real datetimes, ``dd.mm.yyyy`` / ``dd.mm.yy`` strings, and trailing
    Turkmen notes like ``"(kwota berildi)"`` or ``"10.05.2026 mart astatok"``.

    Args:
        raw: cell value (datetime, date, or string).
        fix_out_of_season: when True, a 2025 date in Jan–Jun (before the
            2025-2026 season starts in September) is treated as a year typo
            and bumped to 2026. Used only for the Kwota-2 quota sections,
            whose events are all 2026.
    """
    if raw is None:
        return None
    if isinstance(raw, datetime):
        return raw.date()
    if isinstance(raw, date):
        return raw

    # Normalise separators ('/' → '.'), collapse stray repeats ('18/.04' →
    # '18.04'), then keep the leading dd.mm.yyyy token and drop trailing notes
    # like "(kwota berildi)" or "10.05.2026 mart astatok".
    s = re.sub(r'\.{2,}', '.', str(raw).strip().replace('/', '.'))
    m = re.match(r'(\d{1,2}\.\d{1,2}\.\d{2,4})', s)
    if m:
        s = m.group(1)
    if not s:
        return None

    parsed = None
    for fmt in ('%d.%m.%Y', '%d.%m.%y'):
        try:
            parsed = datetime.strptime(s, fmt).date()
            break
        except ValueError:
            continue
    if parsed is None:
        logger.warning('Cannot parse date: %r', raw)
        return None

    if fix_out_of_season and parsed.year == 2025 and parsed.month <= 6:
        parsed = parsed.replace(year=2026)
    return parsed


def resolve_firm(name: str, cache: dict) -> ExportFirm | None:
    """Resolve an Excel firm label to an ExportFirm, or None if not found.

    Lookup order: explicit FIRM_NAME_MAP → name_en iexact → name_tk iexact →
    name_tk icontains. Does not create firms (all are expected to exist).
    """
    key = _norm(name)
    if key in cache:
        return cache[key]

    mapped = FIRM_NAME_MAP.get(key)
    firm = None
    if mapped:
        # The canonical name may live in either name_en or name_tk (some
        # Telekeci firms have name_en=None, only name_tk).
        firm = (
            ExportFirm.objects.filter(name_en__iexact=mapped).first()
            or ExportFirm.objects.filter(name_tk__iexact=mapped).first()
        )
    if not firm:
        firm = ExportFirm.objects.filter(name_en__iexact=name.strip()).first()
    if not firm:
        firm = ExportFirm.objects.filter(name_tk__iexact=name.strip()).first()
    if not firm:
        firm = ExportFirm.objects.filter(name_tk__icontains=name.strip()).first()

    if not firm:
        logger.warning('SKIPPED: ExportFirm not found for %r — import this firm first.', name)
        return None

    cache[key] = firm
    return firm
