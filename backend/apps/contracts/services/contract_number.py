"""Per-seller, per-year contract-number generation.

A contract number is `{seq}/{YY}-{SELLER}-EXP, {DD.MM.YYYY}` where SELLER is the
export firm's `code`. `seq` is a running counter scoped to (export_firm,
calendar year) — NOT to the buyer pair; the buyer (import firm) does not appear
in the string. Confirmed against the 1-Contracts sheet (a seller with two buyers
in a year keeps one continuous sequence). See ADR-023.

The seq scale is shared across both contract kinds (framework + one_time), so
``next_contract_seq`` counts every Contract row of that seller/year.
"""
import re
from datetime import date

from apps.contracts.models import Contract
from apps.core.models import ExportFirm

# Standard contract-number format. Group 1 = seq, 2 = YY, 3 = seller code.
CONTRACT_NO_RE = re.compile(r'^\s*(\d+)/(\d{2})-([A-Za-z]+)-EXP')


def parse_contract_number(raw: str | None) -> tuple[int, int] | None:
    """Parse a standard contract number into (seq, contract_year).

    Returns None for non-standard numbers (-P pepper, TAT-, garbage), which are
    excluded from the per-seller/year counter.
    """
    if not raw:
        return None
    match = CONTRACT_NO_RE.match(str(raw))
    if not match:
        return None
    return int(match.group(1)), 2000 + int(match.group(2))


def next_contract_seq(export_firm_id: int, contract_year: int) -> int:
    """Return the next sequence number for a seller within a calendar year."""
    last = (
        Contract.objects.filter(
            export_firm_id=export_firm_id, contract_year=contract_year
        )
        .order_by('-seq')
        .values_list('seq', flat=True)
        .first()
    )
    return (last or 0) + 1


def build_contract_number(firm_code: str, seq: int, contract_date: date) -> str:
    """Format the human contract-number string."""
    return f'{seq}/{contract_date:%y}-{firm_code}-EXP, {contract_date:%d.%m.%Y}'


def next_contract_no(
    export_firm: ExportFirm, contract_date: date
) -> tuple[int, int, str]:
    """Allocate the next (seq, contract_year, contract_number) for a seller.

    Call inside ``transaction.atomic()``. The filtered unique constraint on
    (export_firm, contract_year, seq) is the race backstop — a concurrent caller
    that grabs the same seq fails the insert and must retry.
    """
    year = contract_date.year
    seq = next_contract_seq(export_firm.id, year)
    number = build_contract_number(export_firm.code, seq, contract_date)
    return seq, year, number
