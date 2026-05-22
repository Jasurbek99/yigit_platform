"""Harvest forecast pool: remaining-kg computation for draft drawdown.

Architectural note — dependency direction:
  export MAY import greenhouse (lazily, inside functions).
  greenhouse MUST NOT import export.

All greenhouse model/service imports are therefore placed INSIDE function
bodies, never at module level.  This mirrors the pattern established in
apps/greenhouse/services/actual_rollup.py lines 69-71.
"""
import logging
from decimal import Decimal

logger = logging.getLogger(__name__)

# Maximum kg one truck may carry. Used as an upper bound in validation.
MAX_TRUCK_WEIGHT_KG = Decimal('18500')


def get_remaining_for_date(target_date) -> list[dict]:
    """Compute remaining harvest pool per block for a given date.

    The pool for a block is:
        remaining = max(0, HarvestDayEntry.forecast_value − allocated_kg)

    where allocated_kg = Σ ShipmentBlockSource.weight_kg for that block where
    the parent shipment's date == target_date and status != 'cancelled'.

    Only blocks that have a non-null forecast_value on target_date are included.

    Args:
        target_date: datetime.date — the date to query.

    Returns:
        List of dicts, one per block that has a forecast entry:
            {
                'block_id':     int,
                'block_code':   str,
                'forecast_kg':  Decimal,
                'allocated_kg': Decimal,
                'remaining_kg': Decimal,   # max(0, forecast − allocated)
            }
        Sorted by block_code.
    """
    # Lazy greenhouse import — must not happen at module load time.
    from apps.greenhouse.models import HarvestDayEntry
    from apps.export.models.shipment import ShipmentBlockSource
    from django.db.models import Sum

    # Fetch all entries that have a forecast for this date.
    entries = (
        HarvestDayEntry.objects
        .filter(entry_date=target_date, forecast_value__isnull=False)
        .select_related('block')
        .values('block_id', 'block__code', 'forecast_value')
    )

    if not entries:
        return []

    block_ids = [row['block_id'] for row in entries]

    # Single grouped query for allocated kg — avoids N+1.
    # Exclude cancelled shipments so they don't count against the pool.
    allocated_rows = (
        ShipmentBlockSource.objects
        .filter(
            block_id__in=block_ids,
            shipment__date=target_date,
        )
        .exclude(shipment__status__code='cancelled')
        .values('block_id')
        .annotate(total_allocated=Sum('weight_kg'))
        .order_by()  # strip any model Meta.ordering to avoid MSSQL subquery issues
    )
    allocated_map: dict[int, Decimal] = {
        row['block_id']: Decimal(str(row['total_allocated'] or 0))
        for row in allocated_rows
    }

    results = []
    for entry in entries:
        block_id = entry['block_id']
        forecast_kg = Decimal(str(entry['forecast_value']))
        allocated_kg = allocated_map.get(block_id, Decimal('0'))
        remaining_kg = max(Decimal('0'), forecast_kg - allocated_kg)
        results.append({
            'block_id':     block_id,
            'block_code':   entry['block__code'],
            'forecast_kg':  forecast_kg,
            'allocated_kg': allocated_kg,
            'remaining_kg': remaining_kg,
        })

    results.sort(key=lambda x: x['block_code'])
    return results


def get_remaining_for_block(block_id: int, target_date) -> Decimal:
    """Return the remaining harvest kg for a single block on a given date.

    Convenience wrapper around get_remaining_for_date() used by draft-create
    validation.  Returns Decimal('0') if the block has no forecast entry for
    the date.

    Args:
        block_id: GreenhouseBlock primary key.
        target_date: datetime.date.

    Returns:
        Remaining kg (Decimal, always >= 0).
    """
    rows = get_remaining_for_date(target_date)
    for row in rows:
        if row['block_id'] == block_id:
            return row['remaining_kg']
    return Decimal('0')


def assert_draw_within_pool(block_weights: dict, target_date) -> None:
    """Race-safe drawdown check — MUST be called inside a ``transaction.atomic()``.

    Locks the relevant ``HarvestDayEntry`` forecast rows with
    ``select_for_update`` so concurrent draft creations for the same block/date
    serialize and cannot together over-allocate the pool. (The serializer's
    upfront ``validate()`` check is unlocked and only catches the common case;
    this is the authoritative guard.)

    Args:
        block_weights: ``{block_id: weight_kg}`` for the draft being created.
        target_date: the shipment date.

    Raises:
        ValueError: if a block has no forecast, or its weight exceeds the
            remaining pool or the 18,500 kg truck cap. The raise rolls back the
            enclosing transaction; the create view maps it to HTTP 400.
    """
    from apps.greenhouse.models import HarvestDayEntry
    from apps.export.models.shipment import ShipmentBlockSource
    from django.db.models import Sum

    block_ids = list(block_weights.keys())
    if not block_ids:
        return

    # Lock the forecast rows (mutex for concurrent creates on these blocks/date).
    locked_forecast: dict[int, Decimal] = {
        e.block_id: Decimal(str(e.forecast_value))
        for e in (
            HarvestDayEntry.objects
            .select_for_update()
            .filter(entry_date=target_date, block_id__in=block_ids, forecast_value__isnull=False)
        )
    }

    # Allocated so far (excludes cancelled). Holding the forecast-row lock means
    # we observe committed allocations of any concurrent create that ran first.
    allocated_rows = (
        ShipmentBlockSource.objects
        .filter(block_id__in=block_ids, shipment__date=target_date)
        .exclude(shipment__status__code='cancelled')
        .values('block_id')
        .annotate(total=Sum('weight_kg'))
        .order_by()  # strip Meta.ordering — MSSQL subquery safety
    )
    allocated: dict[int, Decimal] = {
        row['block_id']: Decimal(str(row['total'] or 0)) for row in allocated_rows
    }

    for block_id, weight in block_weights.items():
        w = Decimal(str(weight))
        if w > MAX_TRUCK_WEIGHT_KG:
            raise ValueError(
                f'Block {block_id}: weight {w} kg exceeds the 18,500 kg truck capacity.'
            )
        forecast = locked_forecast.get(block_id)
        if forecast is None:
            raise ValueError(
                f'Block {block_id}: no forecast entered for {target_date}. '
                f'Submit a forecast before creating a draft.'
            )
        remaining = max(Decimal('0'), forecast - allocated.get(block_id, Decimal('0')))
        if w > remaining:
            raise ValueError(
                f'Block {block_id}: only {remaining} kg of forecast remaining on '
                f'{target_date} (requested {w} kg).'
            )
