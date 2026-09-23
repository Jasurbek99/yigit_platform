"""Gaplama board — the Weekly Plan minus opened trucks, with carry-over.

The single place that computes what "available to pack" means. The Gaplama screen
renders this verbatim (D1/D2/D8, see the design spec); Plan 2's over-load task and
notification call the same function so the two can never disagree about a number.

Carry-over rule (design spec §4): a positive day remainder is spendable for
GreenhouseConfig.gaplama_carry_days days after the day it was left over on, oldest
bucket first (FIFO). A negative remainder (over-loaded day) never carries — it is
clamped to 0 for display and reported separately as over_kg.
"""
from collections import deque
from datetime import date, timedelta
from decimal import Decimal

from django.db.models import Sum

from apps.core.models import GreenhouseBlock, GreenhouseConfig
from apps.export.models import Shipment, ShipmentBlockSource
from apps.greenhouse.models import HarvestDayEntry


def build_gaplama_board(from_date: date, to_date: date, season) -> dict:
    """Return {'days': [...], 'trucks': [...], 'week_totals': [...]} for the window.

    days[i] = {date, block_id, block_code, location, plan_kg, loaded_kg,
               carried_in_kg, carry_in_breakdown, available_kg, over_kg, carried_out_kg}
    trucks[i] = {id, shipment_code, export_code, date, status, status_code,
                 status_display, country, customer,
                 block_sources: [{block_id, block_code, weight_kg}]}
    week_totals[i] = {block_id, block_code, location, plan_kg, loaded_kg, over_kg,
                       available_kg}

    carry_in_breakdown is the live buckets making up carried_in_kg, oldest first —
    [{origin_date, kg}, ...], captured BEFORE this day's own consumption (so it shows
    what the day started with, not what survives it). carried_out_kg is the fresh
    remainder this day contributes to tomorrow's carry-in pool (0 if none) — together
    these answer "where did a carry-in number come from" and "where is an unclaimed
    number going", which the day/available_kg/over_kg fields alone don't show.

    week_totals fixes a real bug (2026-09-23 final-review finding I1): summing
    available_kg across days double/triple-counts a remainder that stays live for
    several days (it appears in available_kg on EVERY day it's still unclaimed). This
    violates D8 ("the frontend renders and sums; it does not own the rule") if left to
    the frontend, so the correct week total lives here: plan_kg/loaded_kg/over_kg are
    real sums (each day's figure is an independent event, safe to add), but
    available_kg is the LAST day's value in [from_date, to_date] for that block — the
    FIFO walk's conservation invariant (proven in Task 2's review: Σ buckets leaving a
    day == that day's available_kg) guarantees this is the correct "still claimable,
    right now, as of the end of this window" figure, with no double-count and expired
    buckets already excluded.

    Every active top-level block gets a day-row even when it has zero plan/loaded activity
    in the walked window — a block-day with nothing planned still needs to report
    carried_in_kg/available_kg (e.g. a carry-in bucket expiring with no new plan). Sub-blocks
    never get their own day-row, but their kg is folded into their parent's loaded_kg and
    trucks[].block_sources (see below) — they're excluded from days[], not from the data.

    5 queries regardless of data volume: config lookup, a block roster (ALL blocks, active
    and inactive, top-level and sub — see the parent-map note below — one query), one
    grouped HarvestDayEntry read, one grouped ShipmentBlockSource read, one flat
    Shipment+block_sources read (no prefetch_related, so it doesn't fan out per truck).

    Sub-block grain: HarvestDayEntry is always written at top-level (parent) grain, and
    write_block_sources() normalizes new ShipmentBlockSource writes to parent grain too
    (services/block_sources.py) — but legacy/bypass rows targeting a sub-block directly do
    exist (observed on the live DB, though zero today per a direct query — kept as a
    defensive fold, not a hypothetical). Both loaded_kg and trucks[].block_sources fold any
    sub-block id through `parent_of` to its top-level ancestor, so a sub-block-targeted row
    still counts toward the right block instead of silently vanishing from loaded_kg (which
    would over-state available_kg and under-state over_kg) or reporting the wrong block.
    `code_by_id`/`parent_of` are built from EVERY block (not just active ones) precisely so
    this fold still resolves a block_code for a ShipmentBlockSource row that targets an
    inactive block or a sub-block whose parent has since been deactivated — `days[]` itself
    stays active-top-level-only via the explicit `b.is_active` check in `block_meta` below.
    """
    config = GreenhouseConfig.get_solo()
    carry_days = config.gaplama_carry_days
    walk_start = from_date - timedelta(days=carry_days)

    # ALL blocks — active and inactive, top-level and sub — in one query. code_by_id/
    # parent_of must cover inactive blocks too, so a ShipmentBlockSource row still resolves
    # to a real code/parent even when it targets a block (or a block whose parent) has since
    # been deactivated; block_meta below is what actually restricts days[] to active
    # top-level blocks.
    all_blocks = list(
        GreenhouseBlock.objects
        .select_related('location')
        .order_by('code')
    )
    code_by_id: dict[int, str] = {b.id: b.code for b in all_blocks}
    parent_of: dict[int, int] = {b.id: (b.parent_id or b.id) for b in all_blocks}
    # Active top-level blocks only — matches the is_active + parent__isnull=True filter
    # used by views_daily_board.py and pomidor_dukany.py for the same reason (plan/board
    # grain). Filtered here in Python (not in the query above) since the query above must
    # stay unfiltered for the parent-map fold to work for inactive blocks.
    block_meta: dict[int, tuple[str, str | None]] = {
        b.id: (b.code, b.location.name if b.location_id else None)
        for b in all_blocks if b.parent_id is None and b.is_active
    }

    plan_rows = (
        HarvestDayEntry.objects
        .filter(season=season, block_id__in=block_meta, entry_date__range=(walk_start, to_date))
        .values('block_id', 'entry_date')
        .annotate(plan_kg=Sum('plan_value'))
        .order_by()
    )
    plan_map: dict[tuple[int, date], Decimal] = {
        (row['block_id'], row['entry_date']): (row['plan_kg'] or Decimal(0)) for row in plan_rows
    }

    loaded_rows = (
        ShipmentBlockSource.objects
        .filter(
            block_id__in=parent_of,
            shipment__date__range=(walk_start, to_date),
            shipment__season=season,
            weight_kg__isnull=False,
        )
        .exclude(shipment__status__code='cancelled')
        .values('block_id', 'shipment__date')
        .annotate(loaded_kg=Sum('weight_kg'))
        .order_by()
    )
    loaded_map: dict[tuple[int, date], Decimal] = {}
    for row in loaded_rows:
        key = (parent_of.get(row['block_id'], row['block_id']), row['shipment__date'])
        loaded_map[key] = loaded_map.get(key, Decimal(0)) + (row['loaded_kg'] or Decimal(0))

    block_ids = list(block_meta)
    all_days = [walk_start + timedelta(days=i) for i in range((to_date - walk_start).days + 1)]

    days_out: list[dict] = []
    for block_id in block_ids:
        block_code, location = block_meta[block_id]
        # FIFO bucket queue: each entry is [remaining_kg, day_created].
        buckets: deque[list] = deque()
        for d in all_days:
            # Expire buckets older than carry_days.
            while buckets and (d - buckets[0][1]).days > carry_days:
                buckets.popleft()

            carried_in_kg = sum((b[0] for b in buckets), Decimal(0))
            # Snapshot BEFORE today's consumption loop below touches the buckets —
            # this is what the day started with, which is what a "where did this
            # carry-in come from" tooltip should show.
            carry_in_breakdown = [{'origin_date': b[1], 'kg': b[0]} for b in buckets]
            plan_kg = plan_map.get((block_id, d), Decimal(0))
            loaded_kg = loaded_map.get((block_id, d), Decimal(0))

            # Consume oldest bucket first, then today's plan.
            to_consume = loaded_kg
            for bucket in buckets:
                if to_consume <= 0:
                    break
                take = min(bucket[0], to_consume)
                bucket[0] -= take
                to_consume -= take

            available_kg = max(Decimal(0), carried_in_kg + plan_kg - loaded_kg)
            over_kg = max(Decimal(0), to_consume - plan_kg)

            # What's left of TODAY's own plan after today's loads eat through it,
            # once carry-in is exhausted first — this seeds tomorrow's bucket.
            remainder_today = max(Decimal(0), plan_kg - max(Decimal(0), loaded_kg - carried_in_kg))
            buckets = deque(b for b in buckets if b[0] > 0)
            if remainder_today > 0:
                buckets.append([remainder_today, d])

            if from_date <= d <= to_date:
                days_out.append({
                    'date': d,
                    'block_id': block_id,
                    'block_code': block_code,
                    'location': location,
                    'plan_kg': plan_kg,
                    'loaded_kg': loaded_kg,
                    'carried_in_kg': carried_in_kg,
                    'carry_in_breakdown': carry_in_breakdown,
                    'available_kg': available_kg,
                    'over_kg': over_kg,
                    'carried_out_kg': remainder_today,
                })

    # Week totals — pure post-processing of days_out already in memory, no new query.
    # available_kg is the LAST day's value per block (see docstring); plan/loaded/over
    # are real sums. Blocks with no days_out (no plan, no truck) are skipped, matching
    # what the grid would show — nothing to total.
    week_totals: list[dict] = []
    days_by_block: dict[int, list[dict]] = {}
    for row in days_out:
        days_by_block.setdefault(row['block_id'], []).append(row)
    for block_id in block_ids:
        rows = days_by_block.get(block_id)
        if not rows:
            continue
        block_code, location = block_meta[block_id]
        last_row = max(rows, key=lambda r: r['date'])
        week_totals.append({
            'block_id': block_id,
            'block_code': block_code,
            'location': location,
            'plan_kg': sum((r['plan_kg'] for r in rows), Decimal(0)),
            'loaded_kg': sum((r['loaded_kg'] for r in rows), Decimal(0)),
            'over_kg': sum((r['over_kg'] for r in rows), Decimal(0)),
            'available_kg': last_row['available_kg'],
        })

    truck_rows = (
        Shipment.objects
        .filter(date__range=(from_date, to_date), season=season)
        .exclude(status__code='cancelled')
        .filter(block_sources__weight_kg__isnull=False)
        .values(
            'id', 'shipment_code', 'export_code', 'date',
            'status_id', 'status__code', 'status__name_en',
            'country_id', 'customer_id',
            'block_sources__block_id', 'block_sources__weight_kg',
        )
        .order_by('-date', '-id')
    )
    trucks_by_id: dict[int, dict] = {}
    trucks_out: list[dict] = []
    for row in truck_rows:
        truck = trucks_by_id.get(row['id'])
        if truck is None:
            truck = {
                'id': row['id'],
                'shipment_code': row['shipment_code'],
                'export_code': row['export_code'],
                'date': row['date'],
                'status': row['status_id'],
                'status_code': row['status__code'],
                'status_display': row['status__name_en'],
                'country': row['country_id'],
                'customer': row['customer_id'],
                'block_sources': [],
            }
            trucks_by_id[row['id']] = truck
            trucks_out.append(truck)

        raw_block_id = row['block_sources__block_id']
        parent_id = parent_of.get(raw_block_id, raw_block_id)
        parent_code = code_by_id.get(parent_id, code_by_id.get(raw_block_id))
        weight_kg = row['block_sources__weight_kg']
        existing_source = next(
            (bs for bs in truck['block_sources'] if bs['block_id'] == parent_id), None,
        )
        if existing_source is not None:
            # Same truck had both a parent-grain row and a sub-block row (or two
            # different sub-blocks under the same parent) — fold into one entry.
            existing_source['weight_kg'] += weight_kg
        else:
            truck['block_sources'].append({
                'block_id': parent_id,
                'block_code': parent_code,
                'weight_kg': weight_kg,
            })

    return {'days': days_out, 'trucks': trucks_out, 'week_totals': week_totals}
