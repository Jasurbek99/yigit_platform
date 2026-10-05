"""Request-letter numbers — per export firm × letter type × calendar year (spec 2026-10-05).

Same rule as invoice numbers (services/invoice_number.py): the smallest number
above the admin floor (LetterNumberBase) that no sale of that firm/year holds in
that letter's field, so a freed number is reused.
"""
from __future__ import annotations

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.contracts.models import ContractSale, LetterNumberBase
from apps.core.seasons import freeze_season_of

SALE_FIELD = {'ct1': 'ct1_number', 'fito': 'fito_number', 'customs': 'customs_number'}
LETTER_TYPE_FOR_KEY = {'ct1_ru': 'ct1', 'fito_ru': 'fito', 'customs_tk': 'customs'}


def letter_year(sale: ContractSale) -> int:
    """The numbering year: invoice date, else the truck's date, else when the sale
    was created (a manual sale may have neither)."""
    if sale.invoice_date is not None:
        return sale.invoice_date.year
    if sale.shipment_id and sale.shipment.date is not None:
        return sale.shipment.date.year
    if sale.created_at is not None:
        return timezone.localtime(sale.created_at).year
    return timezone.localdate().year


def _firm_year_sales(export_firm_id: int, year: int):
    """A firm's sales in a numbering year, by the same fallbacks letter_year uses
    (invoice date → truck date → creation year), so every held number is seen."""
    return ContractSale.objects.filter(
        Q(invoice_date__year=year)
        | Q(invoice_date__isnull=True, shipment__date__year=year)
        | Q(invoice_date__isnull=True, shipment__date__isnull=True, created_at__year=year),
        contract__export_firm_id=export_firm_id,
    ).order_by()


def allocate_letter_number(export_firm_id: int, letter_type: str, year: int) -> int:
    """Next free number. Locks the floor row so concurrent callers for one firm
    serialize. Call inside ``transaction.atomic``."""
    base, _ = LetterNumberBase.objects.get_or_create(
        export_firm_id=export_firm_id, letter_type=letter_type, year=year,
    )
    base = LetterNumberBase.objects.select_for_update().get(pk=base.pk)
    field = SALE_FIELD[letter_type]
    used = set(
        _firm_year_sales(export_firm_id, year)
        .filter(**{f'{field}__gt': base.last_number})
        .values_list(field, flat=True)
    )
    number = base.last_number + 1
    while number in used:
        number += 1
    return number


def number_taken(sale: ContractSale, letter_type: str, number: int) -> bool:
    """Whether another sale of the same firm and year holds ``number`` for this letter."""
    return (
        _firm_year_sales(sale.contract.export_firm_id, letter_year(sale))
        .filter(**{SALE_FIELD[letter_type]: number})
        .exclude(pk=sale.pk)
        .exists()
    )


@transaction.atomic
def ensure_letter_numbers(sale: ContractSale) -> ContractSale:
    """Fill whichever of the three letter numbers the sale lacks.

    A sale of a closed season is left as is (write freeze D1) — its letters
    still print, with the «№ ___» blank. The row is re-read under a lock: two
    downloads of one bare sale must not both number it (the second would
    overwrite the number the first already printed).
    """
    if all(getattr(sale, f) is not None for f in SALE_FIELD.values()):
        return sale
    locked = ContractSale.objects.select_for_update().get(pk=sale.pk)
    for field in SALE_FIELD.values():
        if getattr(locked, field) is not None:
            setattr(sale, field, getattr(locked, field))
    missing = [t for t, f in SALE_FIELD.items() if getattr(sale, f) is None]
    if not missing:
        return sale
    season = freeze_season_of(sale)
    if season is not None and season.is_closed:
        return sale
    year = letter_year(sale)
    firm_id = sale.contract.export_firm_id
    for letter_type in missing:
        setattr(sale, SALE_FIELD[letter_type], allocate_letter_number(firm_id, letter_type, year))
    sale.save(update_fields=[SALE_FIELD[t] for t in missing] + ['updated_at'])
    return sale
