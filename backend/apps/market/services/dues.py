"""What a sale still owes: debt sales minus the payments allocated to them (spec Part C).

The due is never stored: it is the sale's total minus the sum of its
PaymentAllocation rows, so deleting a payment gives the debt back by itself.
"""
from decimal import Decimal

from django.db.models import DecimalField, F, QuerySet, Sum, Value
from django.db.models.functions import Coalesce

from apps.market.models import Sale

CENT = Decimal('0.01')
ZERO = Decimal('0')
_MONEY_FIELD = DecimalField(max_digits=12, decimal_places=2)


def _allocated(sale: Sale) -> Decimal:
    """Σ allocations of `sale`; uses the prefetched `allocations` when present."""
    return sum((a.amount for a in sale.allocations.all()), ZERO)


def sale_paid(sale: Sale) -> Decimal:
    """Money received for `sale`: its total when paid on the spot, else the allocated payments."""
    paid = sale.total if sale.paid_on_spot else _allocated(sale)
    return paid.quantize(CENT)


def sale_due(sale: Sale) -> Decimal:
    """Money `sale` still owes: 0 when paid on the spot, else total − allocations (never negative)."""
    if sale.paid_on_spot:
        return ZERO.quantize(CENT)
    return max(ZERO, sale.total - _allocated(sale)).quantize(CENT)


def with_allocated(qs: QuerySet) -> QuerySet:
    """The debt sales of `qs`, each annotated with `allocated` = Σ its allocations (0 when none)."""
    return qs.filter(paid_on_spot=False).annotate(
        allocated=Coalesce(Sum('allocations__amount'), Value(Decimal('0.00'), output_field=_MONEY_FIELD),
                           output_field=_MONEY_FIELD),
    )


def debt_sales(qs: QuerySet) -> QuerySet:
    """The debt sales of `qs` that still owe something, annotated with `allocated`."""
    return with_allocated(qs).filter(total__gt=F('allocated'))
