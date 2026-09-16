"""Tır Takip Hasabat — live port of the sera-butce-web "📊 Hasabat" tab.

The source app (`data/sera-butce-web/client/src/App.jsx:15319`) groups its
local truck list in the browser. Here the same panels are aggregated from
`export.shipments` in the database, so the payload carries totals only — never
a truck's customer or firm row by row.

Which trucks count: the season's shipments (by FK, the same scope as the Tırlar
tab's Sheet) minus drafts, cancelled, soft-deleted and archived rows.

Each grouping reads kg from the table it groups on, so the totals differ on
purpose: country / customer / variety / month sum `Shipment.weight_net` (as the
Clients Report does), export firm sums `ShipmentFirmSplit.weight_kg`, block sums
`ShipmentBlockSource.weight_kg`. Every grouping therefore returns its own
`total_kg` for the frontend to compute shares against.

MSSQL: every `.values().annotate()` strips `Meta.ordering` with `.order_by()`,
and the truck subquery is order-free (`.claude/rules/mssql-compat.md`).
"""
from decimal import Decimal

from django.db.models import Count, F, Q, Sum, Value
from django.db.models.functions import Coalesce, NullIf, TruncMonth

# `bardy` (Arrived). Cancelled (99) is excluded from the base queryset, so
# everything at or past this step is an arrived truck.
ARRIVED_STEP_ORDER = 9
EXCLUDED_STATUS_CODES = ('draft', 'cancelled')

_ZERO = Decimal('0')


def _empty_group() -> dict:
    return {'rows': [], 'total_kg': 0.0}


def _empty_payload() -> dict:
    return {
        'season': None,
        'kpis': {'total_trucks': 0, 'total_kg': 0.0, 'avg_kg': 0.0, 'open_trucks': 0, 'arrived_trucks': 0},
        'by_month': [],
        'by_country': _empty_group(),
        'by_customer': _empty_group(),
        'by_variety': _empty_group(),
        'by_firm': _empty_group(),
        'by_block': _empty_group(),
    }


def build_tir_hasabat(season) -> dict:
    """Build the Hasabat payload for a season.

    Args:
        season: A `core.Season`, or None during the close→open gap.

    Returns:
        Dict with `season`, `kpis`, `by_month` and six `by_*` groupings of
        `{rows: [{name, trucks, kg}], total_kg}`. `name` is None for trucks
        with no value in that dimension. Empty-but-valid when `season` is None.
    """
    if season is None:
        return _empty_payload()

    from apps.export.models import Shipment, ShipmentBlockSource, ShipmentFirmSplit

    trucks = (
        Shipment.objects.filter(season=season, deleted_at__isnull=True, is_archived=False)
        .exclude(status__code__in=EXCLUDED_STATUS_CODES)
    )
    truck_ids = trucks.order_by().values('pk')
    firm_splits = ShipmentFirmSplit.objects.filter(shipment__in=truck_ids)
    block_sources = ShipmentBlockSource.objects.filter(shipment__in=truck_ids)

    return {
        'season': {'id': season.id, 'name': season.name},
        'kpis': _kpis(trucks),
        'by_month': _by_month(trucks),
        'by_country': _group(
            trucks, 'id', 'weight_net',
            gid=F('country_id'), name=Coalesce('country__name_en', 'country__name_tk'),
        ),
        'by_customer': _group(
            trucks, 'id', 'weight_net', gid=F('customer_id'), name=F('customer__name'),
        ),
        'by_variety': _group(
            trucks, 'id', 'weight_net', gid=F('variety_id'), name=F('variety__name'),
        ),
        # name_short falls back to code, as on the Sheet's export_firms_display.
        'by_firm': _group(
            firm_splits, 'shipment_id', 'weight_kg',
            gid=F('export_firm_id'),
            name=Coalesce(NullIf('export_firm__name_short', Value('')), 'export_firm__code'),
        ),
        'by_block': _group(
            block_sources, 'shipment_id', 'weight_kg', gid=F('block_id'), name=F('block__code'),
        ),
    }


def _kpis(trucks) -> dict:
    agg = trucks.aggregate(
        total=Count('id'),
        kg=Coalesce(Sum('weight_net'), _ZERO),
        arrived=Count('id', filter=Q(status__step_order__gte=ARRIVED_STEP_ORDER)),
    )
    total = agg['total']
    return {
        'total_trucks': total,
        'total_kg': float(agg['kg']),
        'avg_kg': float(round(agg['kg'] / total)) if total else 0.0,
        'open_trucks': total - agg['arrived'],
        'arrived_trucks': agg['arrived'],
    }


def _by_month(trucks) -> list[dict]:
    """Trucks and net kg per calendar month of `Shipment.date`, oldest first."""
    rows = (
        trucks.order_by()
        .annotate(month=TruncMonth('date'))
        .values('month')
        .annotate(trucks=Count('id'), kg=Coalesce(Sum('weight_net'), _ZERO))
        .order_by('month')
    )
    return [
        {'month': f"{r['month'].year:04d}-{r['month'].month:02d}", 'trucks': r['trucks'], 'kg': float(r['kg'])}
        for r in rows
    ]


def _group(qs, truck_field: str, kg_field: str, **keys) -> dict:
    """Group `qs` on `keys` (`gid` + `name`) into rows sorted by kg, heaviest first.

    `truck_field` is counted distinct, so a truck appears once per group even
    when the grouped table holds several of its rows.
    """
    rows = [
        {'name': r['name'], 'trucks': r['trucks'], 'kg': float(r['kg'])}
        for r in qs.order_by()
        .values(**keys)
        .annotate(trucks=Count(truck_field, distinct=True), kg=Coalesce(Sum(kg_field), _ZERO))
    ]
    rows.sort(key=lambda r: (-r['kg'], r['name'] is None, r['name'] or ''))
    return {'rows': rows, 'total_kg': sum(r['kg'] for r in rows)}
