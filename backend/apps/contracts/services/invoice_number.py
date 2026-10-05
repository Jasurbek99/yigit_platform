"""Invoice auto-numbering — per export firm, per calendar year (spec 2026-10-03).

A sale's invoice number is the smallest number above the firm's yearly floor
(InvoiceNumberBase.last_number, typed by an admin; 0 when no row) that no sale of
that firm/year holds. A number freed by a deleted sale is therefore reused — the
owner's provisional choice (memory project_invoice_number_gap_fill_open); switching
to "never reuse" changes only allocate_invoice_number.
"""
from __future__ import annotations

from collections.abc import Iterable

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.contracts.models import ContractSale, InvoiceNumberBase
from apps.core.seasons import freeze_season_of


def allocate_invoice_number(export_firm_id: int, year: int) -> int:
    """Next free invoice number for a seller in a year.

    Locks the firm/year floor row, so two concurrent callers for the same firm
    serialize instead of both taking the same number. Call inside
    ``transaction.atomic`` (select_for_update refuses to run outside one).
    """
    base, _ = InvoiceNumberBase.objects.get_or_create(export_firm_id=export_firm_id, year=year)
    base = InvoiceNumberBase.objects.select_for_update().get(pk=base.pk)
    used = set(
        ContractSale.objects.filter(
            contract__export_firm_id=export_firm_id,
            invoice_date__year=year,
            invoice_number__gt=base.last_number,
        )
        .order_by()
        .values_list('invoice_number', flat=True)
    )
    number = base.last_number + 1
    while number in used:
        number += 1
    return number


@transaction.atomic
def ensure_invoice_number(sale: ContractSale) -> ContractSale:
    """Give a sale its invoice number and date if it has no number yet.

    Date: the sale's own invoice_date, else the truck's date, else today. A sale
    of a closed season is left as is (write freeze D1) — its document still prints.
    """
    if sale.invoice_number is not None:
        return sale
    season = freeze_season_of(sale)
    if season is not None and season.is_closed:
        return sale
    if sale.invoice_date is None:
        truck_date = sale.shipment.date if sale.shipment_id else None
        sale.invoice_date = truck_date or timezone.localdate()
    sale.invoice_number = allocate_invoice_number(
        sale.contract.export_firm_id, sale.invoice_date.year,
    )
    sale.save(update_fields=['invoice_number', 'invoice_date', 'updated_at'])
    return sale


def mark_invoice_printed(sale_ids: Iterable[int]) -> None:
    """Stamp the first invoice download. Later downloads keep the first stamp;
    closed-season sales are not written (write freeze D1).

    Checks BOTH the contract's season and the shipment's season — matching
    `ContractSale.freeze_season`, which treats the sale as frozen if EITHER
    side is closed. Checking `contract__season` alone would still stamp a sale
    whose contract is open but whose bridged shipment's season is closed.
    """
    ContractSale.objects.filter(
        Q(contract__season__isnull=True) | Q(contract__season__closed_at__isnull=True),
        Q(shipment__isnull=True)
        | Q(shipment__season__isnull=True)
        | Q(shipment__season__closed_at__isnull=True),
        pk__in=list(sale_ids),
        invoice_printed_at__isnull=True,
    ).update(invoice_printed_at=timezone.now())
