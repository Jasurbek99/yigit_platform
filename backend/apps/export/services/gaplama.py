"""Gaplama board — the Weekly Plan minus opened trucks, with carry-over.

The single place that computes what "available to pack" means. The Gaplama screen
renders this verbatim (D1/D2/D8, see the design spec); Plan 2's over-load task and
notification call the same function so the two can never disagree about a number.

Carry-over rule (design spec §4): a positive day remainder is spendable for
GreenhouseBlock.carry_days days after the day it was left over on — each block
expires on its own schedule (2026-09-24; replaces the single
GreenhouseConfig.gaplama_carry_days that used to apply to every block). A load
drains the bucket the operator named via ShipmentBlockSource.harvest_date when
that bucket is still live; only an unattributed load (no harvest_date, or one
naming a bucket that has since expired) falls back to oldest-bucket-first (FIFO)
(2026-09-24, batch selection). A negative remainder (over-loaded day) never
carries — it is clamped to 0 for display and reported separately as over_kg.
"""
from collections import deque
from datetime import date, timedelta
from decimal import Decimal

from django.db.models import Sum

from apps.core.models import GreenhouseBlock
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
    [{origin_date, kg, age_days}, ...] (age_days added 2026-09-24, Task 2 of the batch
    selection work — how many days old this bucket is as of the day being walked),
    captured BEFORE this day's own consumption (so it shows what the day started with,
    not what survives it). carried_out_kg is the fresh
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

    5 queries regardless of data volume: a per-block carry_days map (id, carry_days for
    every block — replaces the old single config lookup, 2026-09-24), a block roster (ALL
    blocks, active and inactive, top-level and sub — see the parent-map note below — one
    query), one grouped HarvestDayEntry read, one grouped ShipmentBlockSource read, one
    flat Shipment+block_sources read (no prefetch_related, so it doesn't fan out per
    truck). week_totals is pure post-processing of days_out already in memory — no query.

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
    # Per block since 2026-09-24: a block with cold storage holds a leftover for
    # days, one without does not. The walk window is sized by the WIDEST block so
    # a single pass serves them all; each block then expires on its own schedule
    # inside that window, so a short block is not kept alive by a long neighbour.
    carry_days_by_block: dict[int, int] = dict(
        GreenhouseBlock.objects.values_list('id', 'carry_days')
    )
    max_carry_days = max(carry_days_by_block.values(), default=2)
    # 2x max_carry_days, not 1x (2026-09-23 fix). The walk's first computed day
    # (walk_start) always starts with zero carry-in — that day's OWN
    # remainder_today can therefore be wrong if a REAL bucket should have
    # fed it, which then propagates forward through every later day that
    # bucket would have reached. A single carry_days of lookback only
    # protects `from_date` from ITS OWN zero-seed error; it does nothing for
    # an error already baked into walk_start's own remainder_today, which
    # needed its own carry_days of visibility to be right. Doubling the
    # lookback closes exactly that one hop of the chain: `from_date -
    # carry_days` (the day that would have been walk_start under the old
    # 1x rule) is now itself seeded from real data.
    #
    # This is a BOUNDED APPROXIMATION, not a proof for arbitrarily long
    # chains — the same kind of accepted bound the original 1x rule always
    # was, one hop deeper. A chain of understated remainders spanning 3+
    # hops (e.g. an unconsumed plan on day X, then day X+carry_days also
    # under-loaded against day X's bucket, then that day's OWN remainder
    # feeding forward again) can still leave a residual error inside
    # `carry_days` days of from_date. Restores the exact effective depth
    # the frontend used to provide by accident before 2026-09-23 removed
    # its own redundant client-side widening — see GaplamaTab.tsx and the
    # design spec §4 Window note, which carries the same caveat.
    walk_start = from_date - timedelta(days=max_carry_days * 2)

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
        .values('block_id', 'shipment__date', 'harvest_date')
        .annotate(loaded_kg=Sum('weight_kg'))
        .order_by()
    )
    loaded_map: dict[tuple[int, date], Decimal] = {}
    # Which batch each load named, so the walk can drain that bucket instead of the
    # oldest one (2026-09-24). None groups every unattributed row — rows written
    # before batches existed, and rows naming a bucket that has since expired.
    loaded_by_batch: dict[tuple[int, date], dict] = {}
    for row in loaded_rows:
        key = (parent_of.get(row['block_id'], row['block_id']), row['shipment__date'])
        kg = row['loaded_kg'] or Decimal(0)
        loaded_map[key] = loaded_map.get(key, Decimal(0)) + kg
        batches = loaded_by_batch.setdefault(key, {})
        origin = row['harvest_date']
        batches[origin] = batches.get(origin, Decimal(0)) + kg

    block_ids = list(block_meta)
    all_days = [walk_start + timedelta(days=i) for i in range((to_date - walk_start).days + 1)]

    days_out: list[dict] = []
    for block_id in block_ids:
        block_code, location = block_meta[block_id]
        block_carry_days = carry_days_by_block.get(block_id, max_carry_days)
        # FIFO bucket queue: each entry is [remaining_kg, day_created].
        buckets: deque[list] = deque()
        for d in all_days:
            # Expire buckets older than this block's own carry_days.
            while buckets and (d - buckets[0][1]).days > block_carry_days:
                buckets.popleft()

            carried_in_kg = sum((b[0] for b in buckets), Decimal(0))
            # Snapshot BEFORE today's consumption loop below touches the buckets —
            # this is what the day started with, which is what a "where did this
            # carry-in come from" tooltip should show.
            carry_in_breakdown = [
                {'origin_date': b[1], 'kg': b[0], 'age_days': (d - b[1]).days} for b in buckets
            ]
            plan_kg = plan_map.get((block_id, d), Decimal(0))
            loaded_kg = loaded_map.get((block_id, d), Decimal(0))

            # Today's own plan joins the queue as a same-day bucket (2026-09-24) —
            # appended AFTER the carry_in_breakdown snapshot above (so that snapshot
            # still reports only pre-existing carry-in, not today's fresh plan) and
            # at the tail (so the FIFO fallback below still drains older buckets
            # first). Without this, a load naming TODAY's own harvest_date could
            # never match anything in `buckets` — today's bucket wouldn't exist yet
            # until the old post-loop append — and would wrongly fall back to
            # draining an older carry-in bucket instead.
            today_bucket = [plan_kg, d]
            buckets.append(today_bucket)

            # Drain the bucket each load NAMED (2026-09-24). An operator who picked
            # the fresh batch must not have the four-day-old one drained instead.
            by_batch = dict(loaded_by_batch.get((block_id, d), {}))
            unattributed = by_batch.pop(None, Decimal(0))
            for bucket in buckets:
                want = by_batch.get(bucket[1])
                # want <= 0 guards against a negative weight_kg (no DB check
                # constraint, no serializer min_value today) reaching this loop —
                # `min(bucket[0], want)` would otherwise return the negative and
                # `bucket[0] -= take` would INFLATE the bucket instead of draining
                # it. The old pure-FIFO loop couldn't hit this: it only ever
                # subtracted `min(bucket[0], to_consume)` against loaded_kg totals
                # that summed away individual negative rows; naming a specific
                # batch exposes the single negative row directly.
                if not want or want <= 0:
                    continue
                take = min(bucket[0], want)
                bucket[0] -= take
                by_batch[bucket[1]] = want - take
            # A named batch with no live bucket left — a row written before batches
            # existed, or one naming a bucket that has since expired — rejoins the
            # FIFO pool rather than vanishing, so loaded_kg still balances.
            to_consume = unattributed + sum(by_batch.values(), Decimal(0))
            for bucket in buckets:
                if to_consume <= 0:
                    break
                take = min(bucket[0], to_consume)
                bucket[0] -= take
                to_consume -= take

            available_kg = max(Decimal(0), carried_in_kg + plan_kg - loaded_kg)
            # today_bucket's capacity (plan_kg) is now part of the pool the two loops
            # above just drained, so any leftover `to_consume` is genuinely beyond
            # carried_in_kg + plan_kg combined — no separate "- plan_kg" needed here
            # (that was only correct back when today's plan wasn't in the pool yet).
            over_kg = max(Decimal(0), to_consume)

            # What's left of TODAY's own plan after this day's loads (named first,
            # then FIFO) ate through it — this seeds tomorrow's bucket. Reads
            # straight off today_bucket since it's the same object still sitting in
            # `buckets` (appended above, not re-appended below).
            remainder_today = today_bucket[0]
            buckets = deque(b for b in buckets if b[0] > 0)

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
    # are real sums. Every active top-level block gets a days_out row for every day in
    # a non-empty window (see the class docstring), so `rows` is never actually empty
    # here — the guard below is defensive only, for an inverted/empty window slipping
    # through some future caller that bypasses the view's own from_date>to_date check.
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
