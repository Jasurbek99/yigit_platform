"""What a lot has sold, written off and spent, and what is left (spec §4)."""
from decimal import Decimal

from django.db.models import Q, Sum
from django.utils import timezone

from apps.market.models import Lot

CENT = Decimal('0.01')
ZERO = Decimal('0')


def _money(value) -> Decimal:
    """A Sum result (None on no rows) as a Decimal with two places."""
    return (value or ZERO).quantize(CENT)


def lot_totals(lot: Lot) -> dict:
    """Box counts, kg and money of `lot`, read fresh from the DB.

    Box counts are ints; kg and money are Decimals with two places.
    `avg_price_kg` is None while nothing is sold. `debt_total` counts the sales
    not paid on the spot (Part C replaces it with the allocated due).
    """
    sales = lot.sales.aggregate(
        sum_boxes=Sum('boxes'), sum_kg=Sum('net_kg'), sum_total=Sum('total'),
        sum_paid=Sum('total', filter=Q(paid_on_spot=True)), sum_debt=Sum('total', filter=Q(paid_on_spot=False)),
    )
    spoiled = lot.spoilage.aggregate(sum_boxes=Sum('boxes'), sum_kg=Sum('net_kg'))
    expenses = _money(lot.expenses.aggregate(sum_amount=Sum('amount'))['sum_amount'])
    sold_boxes, spoiled_boxes = sales['sum_boxes'] or 0, spoiled['sum_boxes'] or 0
    sold_kg, sales_total = _money(sales['sum_kg']), _money(sales['sum_total'])
    used = sold_boxes + spoiled_boxes
    return {
        'sold_boxes': sold_boxes,
        'sold_kg': sold_kg,
        'spoiled_boxes': spoiled_boxes,
        'spoiled_kg': _money(spoiled['sum_kg']),
        'used': used,
        'left': lot.boxes_received - used,
        'sales_total': sales_total,
        'paid_total': _money(sales['sum_paid']),
        'debt_total': _money(sales['sum_debt']),
        'expenses_total': expenses,
        'after_expenses': sales_total - expenses,
        'avg_price_kg': (sales_total / sold_kg).quantize(CENT) if sold_kg else None,
    }


def needs_receipt(lot: Lot) -> bool:
    """True while the agent still has to confirm the receipt.

    The shipment had no box or pallet count, so the lot opened with a
    placeholder of 1 box or 1 box per pallet (receipt_confirmed=False); until
    the agent sets boxes_received or boxes_per_pallet, a sale would count the
    truck wrong.
    """
    return not lot.receipt_confirmed


def refresh_closed(lot: Lot) -> bool:
    """Close `lot` when nothing is left, reopen it when boxes free up.

    Saves `closed_at` only when it changes. Returns whether it changed.
    """
    is_empty = lot_totals(lot)['left'] <= 0
    if is_empty == (lot.closed_at is not None):
        return False
    lot.closed_at = timezone.now() if is_empty else None
    lot.save(update_fields=['closed_at'])
    return True
