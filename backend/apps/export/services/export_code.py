"""Parse the real date out of an operator-typed export code.

The Export Code (`Shipment.export_code`) is free text, but operators type it in
a compact dated form: ``DD`` + ``MM`` (2-letter month) + ``NNN`` (sequence) +
``/YY``, e.g. ``12JN121/26`` = 12 June 2026. This date is the *real* loading
date the operation tracks — unlike ``Shipment.date``, which defaults to the day
the row was created/imported.

Month codes are the English 2-letter abbreviations operators use (note
NOVEMBER = ``NV``, not ``NO``). This is NOT the Turkmen scheme in
``validators.py`` (which is a different, now-disabled strict format).

Defensive by design: any code that doesn't match the dated pattern, uses an
unknown month, or encodes an impossible day returns ``None`` — callers fall
back to ``Shipment.date``.
"""
from __future__ import annotations

import re
from datetime import date

# Operator English 2-letter month codes (NOVEMBER = NV).
MONTH_CODES = {
    'JA': 1, 'FB': 2, 'MR': 3, 'AP': 4, 'MY': 5, 'JN': 6,
    'JL': 7, 'AG': 8, 'SP': 9, 'OC': 10, 'NV': 11, 'DC': 12,
}

_EXPORT_CODE_RE = re.compile(r'^(\d{2})([A-Za-z]{2})(\d+)/(\d{2})$')


def parse_export_code_date(export_code: str | None) -> date | None:
    """Extract the date encoded in an export code, or None if unparseable.

    Args:
        export_code: Raw export code, e.g. ``12JN121/26``. None/blank → None.

    Returns:
        The encoded date (``date(2026, 6, 12)`` for ``12JN121/26``), or None
        when the code is blank, malformed, uses an unknown month, or encodes an
        invalid calendar day.
    """
    if not export_code:
        return None
    match = _EXPORT_CODE_RE.match(export_code.strip())
    if not match:
        return None
    dd, mm, _seq, yy = match.groups()
    month = MONTH_CODES.get(mm.upper())
    if month is None:
        return None
    try:
        return date(2000 + int(yy), month, int(dd))
    except ValueError:
        return None
