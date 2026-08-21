"""Pomidor Dükany — production analysis: planned vs achieved per greenhouse block.

Ports the analysis the office ran in `Pomidor Dükany 2025-2026.xlsx` (sheets
`Hepdelik planlama`, `Gunluk babatynda`, `Aylyk we mowsumluk babatynda`,
`Ekilen meydana gora`) and that `sera-butce-web` shows on its own
"Pomidor Dükany" screen. Every figure is computed from data the platform
already stores — nothing is imported from the workbook.

Per block, over an inclusive date range:
  - Meýilleşdirilen (planned)   ← HarvestDayEntry.plan_value
  - Daşarky (export)            ← ShipmentBlockSource.weight_kg
  - Içerki (domestic)           ← DomesticSale.weight_kg
  - Ýerine ýetirilen (achieved) = export + domestic
  - Tapawut (variance) and achievement %, against that achieved figure
  - kg/m² for planned and achieved, using GreenhouseBlock.area_m2
  - rollup_kg / rollup_days     ← HarvestDayEntry.actual_value, DIAGNOSTIC ONLY

**Achieved is the sum of real dispositions, not `HarvestDayEntry.actual_value`.**
Three reasons, all load-bearing:

1. `plan_value` is a *harvest* plan. `actual_value` is written by the nightly
   `rollup_actuals`, which sums `ShipmentBlockSource` alone — it never looks at
   `DomesticSale`. Measuring a harvest plan against export-only understates
   every block that sold at home.
2. `actual_value` and an export sum are the *same underlying rows*, so showing
   both as separate figures was duplication dressed as corroboration.
3. The rollup is a cron that is not in `CELERY_BEAT_SCHEDULE` and must be
   installed per server. Where it has not run, `actual_value` is NULL — a block
   with millions of exported kg would read 0% achievement.

`rollup_kg` is still returned, as a **diagnostic**: when it diverges from
`actual_kg`, either the rollup is stale for those days or an admin overrode a
cell. `rollup_days` counts the days that actually carry a rollup value, so a
consumer can tell "computed as zero" from "never computed" — a distinction a
plain SUM of NULLs erases.

Grain: TOP-LEVEL blocks only (`parent__isnull=True`). This is not a filter for
tidiness — it is the only correct grain. `HarvestDayEntry` rows are created for
top-level blocks (`initialize_harvest_week`), and `ShipmentBlockSource` writes
are normalized to the parent by `services/block_sources.py`. Including
sub-blocks would list O, OD and OG as three rows whose areas (173,184 =
86,592 + 86,592 m²) and weights double-count the same greenhouse.

Date bucketing mirrors the existing aggregates so the numbers agree with
`/boss`: harvest by `HarvestDayEntry.entry_date`, exports by `Shipment.date`,
domestic by `DomesticSale.date`. The caller supplies the range — the page
derives it from its weekly / monthly / seasonal / cumulative-to-a-day mode, so
every mode is one query shape rather than four.
"""
import logging
from datetime import date
from decimal import Decimal

from django.db.models import Count, Sum
from django.db.models.functions import Coalesce

logger = logging.getLogger(__name__)

ZERO = Decimal('0')


def _pct(numerator: Decimal, denominator: Decimal) -> float:
    """Percentage, or 0.0 when the denominator is zero (no plan → no ratio)."""
    if not denominator:
        return 0.0
    return round(float(numerator / denominator * 100), 1)


def _per_m2(kg: Decimal, area_m2: int | None) -> float:
    """kg per square metre, or 0.0 when the block has no recorded area."""
    if not area_m2:
        return 0.0
    return round(float(kg / Decimal(area_m2)), 3)


def _sum_harvest(date_from: date, date_to: date) -> dict[int, dict]:
    """{block_id: {plan_kg, rollup_kg, rollup_days}} from HarvestDayEntry."""
    from apps.greenhouse.models import HarvestDayEntry

    rows = (
        HarvestDayEntry.objects
        .filter(entry_date__gte=date_from, entry_date__lte=date_to)
        .values('block_id')
        .annotate(
            plan_kg=Coalesce(Sum('plan_value'), ZERO),
            rollup_kg=Coalesce(Sum('actual_value'), ZERO),
            # Count() skips NULLs, so this separates "the rollup ran and found
            # zero" from "the rollup never ran" — which a SUM cannot.
            rollup_days=Count('actual_value'),
        )
        .order_by()  # strip Meta.ordering so GROUP BY stays block_id only
    )
    return {
        r['block_id']: {
            'plan_kg': r['plan_kg'],
            'rollup_kg': r['rollup_kg'],
            'rollup_days': r['rollup_days'],
        }
        for r in rows
    }


def _sum_export(date_from: date, date_to: date) -> dict[int, Decimal]:
    """{block_id: exported kg} from ShipmentBlockSource over the range.

    Rows are already at parent grain (`services/block_sources.py` normalizes
    every write site), so no folding is needed here. Soft-deleted shipments are
    excluded (`deleted_at`) — a deleted truck is not production. Archived ones
    are NOT excluded: `is_archived` only means "terminal for 21 days", which is
    exactly what a past month's analysis is made of.
    """
    from apps.export.models import ShipmentBlockSource

    rows = (
        ShipmentBlockSource.objects
        .filter(shipment__date__gte=date_from, shipment__date__lte=date_to)
        .filter(shipment__deleted_at__isnull=True)
        .values('block_id')
        .annotate(export_kg=Coalesce(Sum('weight_kg'), ZERO))
        .order_by()
    )
    return {r['block_id']: r['export_kg'] for r in rows}


def _sum_domestic(date_from: date, date_to: date) -> dict[int, Decimal]:
    """{block_id: domestically sold kg} from DomesticSale over the range."""
    from apps.greenhouse.models import DomesticSale

    rows = (
        DomesticSale.objects
        .filter(date__gte=date_from, date__lte=date_to)
        .values('block_id')
        .annotate(domestic_kg=Coalesce(Sum('weight_kg'), ZERO))
        .order_by()
    )
    return {r['block_id']: r['domestic_kg'] for r in rows}


def build_production_analysis(
    date_from: date,
    date_to: date,
    block_ids: list[int] | None = None,
) -> dict:
    """Planned vs achieved production per block for an inclusive date range.

    Args:
        date_from: Inclusive range start.
        date_to:   Inclusive range end.
        block_ids: Optional top-level block ids to restrict to. None = all
            active top-level blocks.

    Returns:
        {'rows': [...], 'totals': {...}} — one row per block plus grand totals.
        Rows are ordered by block code. A block with no data in range is still
        returned, with zeros, so the table's row set is stable as the user
        moves between months.
    """
    from apps.core.models import GreenhouseBlock

    if date_from > date_to:
        raise ValueError('date_from must not be after date_to.')

    blocks_qs = GreenhouseBlock.objects.filter(is_active=True, parent__isnull=True)
    if block_ids:
        blocks_qs = blocks_qs.filter(id__in=block_ids)
    blocks = list(blocks_qs.values('id', 'code', 'name', 'area_m2').order_by('code'))

    harvest = _sum_harvest(date_from, date_to)
    export = _sum_export(date_from, date_to)
    domestic = _sum_domestic(date_from, date_to)

    rows = []
    total_plan = total_actual = total_export = total_domestic = total_rollup = ZERO
    total_area = 0

    for block in blocks:
        bid = block['id']
        h = harvest.get(bid, {'plan_kg': ZERO, 'rollup_kg': ZERO, 'rollup_days': 0})
        plan_kg = h['plan_kg']
        export_kg = export.get(bid, ZERO)
        domestic_kg = domestic.get(bid, ZERO)
        area_m2 = block['area_m2']

        # Achieved = what the block actually shipped plus what it sold at home.
        # See the module docstring for why this is not HarvestDayEntry.actual_value.
        actual_kg = export_kg + domestic_kg

        rows.append({
            'rollup_kg': float(h['rollup_kg']),
            'rollup_days': h['rollup_days'],
            'block_id': bid,
            'block_code': block['code'],
            'block_name': block['name'],
            'plan_kg': float(plan_kg),
            'actual_kg': float(actual_kg),
            'variance_kg': float(actual_kg - plan_kg),
            'achievement_pct': _pct(actual_kg, plan_kg),
            'area_m2': area_m2,
            'plan_kg_per_m2': _per_m2(plan_kg, area_m2),
            'actual_kg_per_m2': _per_m2(actual_kg, area_m2),
            'domestic_kg': float(domestic_kg),
            'export_kg': float(export_kg),
            'domestic_pct': _pct(domestic_kg, actual_kg),
            'export_pct': _pct(export_kg, actual_kg),
        })

        total_plan += plan_kg
        total_actual += actual_kg
        total_export += export_kg
        total_domestic += domestic_kg
        total_rollup += h['rollup_kg']
        if area_m2:
            total_area += area_m2

    totals = {
        'rollup_kg': float(total_rollup),
        'plan_kg': float(total_plan),
        'actual_kg': float(total_actual),
        'variance_kg': float(total_actual - total_plan),
        'achievement_pct': _pct(total_actual, total_plan),
        'area_m2': total_area or None,
        'plan_kg_per_m2': _per_m2(total_plan, total_area),
        'actual_kg_per_m2': _per_m2(total_actual, total_area),
        'domestic_kg': float(total_domestic),
        'export_kg': float(total_export),
        'domestic_pct': _pct(total_domestic, total_actual),
        'export_pct': _pct(total_export, total_actual),
        'block_count': len(rows),
    }

    return {
        'date_from': date_from.isoformat(),
        'date_to': date_to.isoformat(),
        'rows': rows,
        'totals': totals,
    }
