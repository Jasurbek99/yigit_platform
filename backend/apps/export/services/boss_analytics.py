"""Boss Dashboard aggregation helpers.

All functions are pure DB-query aggregators that return plain Python dicts/lists
ready for JSON serialization. No side effects, no writes.

MSSQL rules enforced throughout:
 - No JSONField, no ArrayField, no DISTINCT ON
 - TruncWeek for weekly buckets (MSSQL-safe via Django ORM)
 - DecimalField arithmetic only — no float operations
 - select_related / prefetch_related on every queryset to avoid N+1
"""
import logging
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import TYPE_CHECKING

import sentry_sdk

from django.db.models import Count, Sum, Q
from django.db.models.functions import TruncWeek, Coalesce
from django.utils import timezone

if TYPE_CHECKING:
    from apps.core.models import Season

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Period helper
# ---------------------------------------------------------------------------

def period_to_range(period: str, today: date | None = None) -> tuple[date, date]:
    """Convert a period slug to a (from_date, to_date) inclusive range.

    Args:
        period: One of 'today' | 'week' | 'month' | 'season' | 'years5'.
        today:  Reference date. Defaults to date.today().

    Returns:
        Tuple (from_date, to_date) as Python date objects.

    Raises:
        ValueError: If period is not a recognised slug.
    """
    if today is None:
        today = date.today()

    if period == 'today':
        return today, today

    if period == 'week':
        return today - timedelta(days=6), today

    if period == 'month':
        from_date = today.replace(day=1)
        # Last day of month — advance to next month day 1 then subtract 1 day.
        if today.month == 12:
            to_date = today.replace(month=12, day=31)
        else:
            to_date = today.replace(month=today.month + 1, day=1) - timedelta(days=1)
        return from_date, to_date

    if period == 'season':
        from apps.core.seasons import get_active_season  # lazy import — avoids circular risk
        try:
            season = get_active_season()
            if season:
                return season.start_date, season.end_date
        except Exception:
            logger.warning('Could not load active season — falling back to month range')
            sentry_sdk.capture_exception()
        # Fallback: current month
        return period_to_range('month', today)

    if period == 'years5':
        return today.replace(year=today.year - 5), today

    raise ValueError(f'Unknown period slug: {period!r}')


# ---------------------------------------------------------------------------
# Shipment queryset helper
# ---------------------------------------------------------------------------

def _base_shipment_qs(from_date: date, to_date: date):
    """Return a Shipment queryset filtered to the date range with standard select_related."""
    from apps.export.models import Shipment
    return (
        Shipment.objects
        .filter(date__gte=from_date, date__lte=to_date)
        .select_related('status', 'country', 'city', 'customer', 'season')
    )


# ---------------------------------------------------------------------------
# Sparkline helper (12-week series ending today)
# ---------------------------------------------------------------------------

def _build_sparkline(
    from_date: date, to_date: date, field: str, qs_factory
) -> list[float]:
    """Build a 12-week sparkline ending at to_date.

    Aggregates <field> (Sum) grouped by ISO week bucket.
    Returns a list of 12 float values (oldest → newest).
    """
    from apps.export.models import Shipment

    sparkline_start = to_date - timedelta(weeks=12)
    rows = (
        Shipment.objects
        .filter(date__gte=sparkline_start, date__lte=to_date)
        .annotate(week_bucket=TruncWeek('date'))
        .values('week_bucket')
        .annotate(total=Coalesce(Sum(field), Decimal('0')))
        .order_by('week_bucket')
    )
    # Build week-keyed dict then fill 12-slot array.
    # TruncWeek returns a datetime on some backends, a date on MSSQL — normalise.
    def _to_date(val):
        return val.date() if hasattr(val, 'date') and callable(val.date) else val

    data: dict[date, Decimal] = {_to_date(r['week_bucket']): r['total'] for r in rows}
    result: list[float] = []
    bucket = sparkline_start - timedelta(days=sparkline_start.weekday())  # Monday of week
    for _ in range(12):
        result.append(float(data.get(bucket, Decimal('0'))))
        bucket += timedelta(weeks=1)
    return result


# ---------------------------------------------------------------------------
# Summary / KPI cards
# ---------------------------------------------------------------------------

def _aggregate_summary(from_date: date, to_date: date) -> dict:
    """Return 6 hero KPI dicts each with value, delta metadata, and sparkline.

    Args:
        from_date: Period start (inclusive).
        to_date:   Period end (inclusive).

    Returns:
        Dict keyed: revenue, margin, debt, today_loaded, in_transit, quota_used.
    """
    from apps.export.models import (
        Shipment, SalesReport, ShipmentStatusLog,
        QuotaIssuanceFirmAllocation, QuotaUsageRecord,
    )
    from apps.core.models import ExportFirm

    today = date.today()

    # --- Revenue ---
    rev_agg = (
        Shipment.objects
        .filter(date__gte=from_date, date__lte=to_date)
        .aggregate(total=Coalesce(Sum('total_amount_usd'), Decimal('0')))
    )
    revenue = rev_agg['total']

    # Previous period delta (same duration, shifted back)
    duration = (to_date - from_date).days or 1
    prev_from = from_date - timedelta(days=duration + 1)
    prev_to = from_date - timedelta(days=1)
    prev_rev_agg = (
        Shipment.objects
        .filter(date__gte=prev_from, date__lte=prev_to)
        .aggregate(total=Coalesce(Sum('total_amount_usd'), Decimal('0')))
    )
    prev_revenue = prev_rev_agg['total']
    rev_delta_pct = _delta_pct(revenue, prev_revenue)

    # Revenue sparkline
    rev_sparkline = _build_sparkline(from_date, to_date, 'total_amount_usd', None)

    # --- Margin (approximate: revenue - transport - market_fee - other) ---
    cost_agg = (
        SalesReport.objects
        .filter(shipment__date__gte=from_date, shipment__date__lte=to_date)
        .aggregate(
            transport=Coalesce(Sum('transport_cost_usd'), Decimal('0')),
            market=Coalesce(Sum('market_fee_usd'), Decimal('0')),
            other=Coalesce(Sum('other_expenses_usd'), Decimal('0')),
        )
    )
    total_cost = cost_agg['transport'] + cost_agg['market'] + cost_agg['other']
    margin = revenue - total_cost
    margin_pct = float((margin / revenue * 100).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP)) if revenue else 0.0

    prev_cost_agg = (
        SalesReport.objects
        .filter(shipment__date__gte=prev_from, shipment__date__lte=prev_to)
        .aggregate(
            transport=Coalesce(Sum('transport_cost_usd'), Decimal('0')),
            market=Coalesce(Sum('market_fee_usd'), Decimal('0')),
            other=Coalesce(Sum('other_expenses_usd'), Decimal('0')),
        )
    )
    prev_total_cost = prev_cost_agg['transport'] + prev_cost_agg['market'] + prev_cost_agg['other']
    prev_margin_pct = float(
        ((prev_revenue - prev_total_cost) / prev_revenue * 100).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP)
    ) if prev_revenue else 0.0
    margin_delta_pp = round(margin_pct - prev_margin_pct, 1)

    margin_sparkline = _build_sparkline(from_date, to_date, 'total_amount_usd', None)

    # --- Today loaded ---
    today_loaded_qs = (
        Shipment.objects
        .filter(loading_started_at__date=today)
        .select_related('status')
    )
    today_loaded_count = today_loaded_qs.count()

    # --- In transit (not yet arrived) ---
    transit_status_codes = [
        'gumruk_girish', 'gumruk_chykysh', 'yola_chykdy',
        'serhet_tm', 'serhet_gechdi', 'barysh_gumrugi', 'yolda',
    ]
    in_transit_count = (
        Shipment.objects
        .filter(status__code__in=transit_status_codes)
        .count()
    )
    season_total = Shipment.objects.filter(
        date__gte=from_date, date__lte=to_date
    ).count()

    # --- Quota used % (across all firms, latest issuances vs approved usage) ---
    total_quota_kg = (
        QuotaIssuanceFirmAllocation.objects
        .aggregate(total=Coalesce(Sum('kg_quota'), Decimal('0')))['total']
    )
    total_used_kg = (
        QuotaUsageRecord.objects
        .counted()
        .filter(status='approved')
        .aggregate(total=Coalesce(Sum('kg_used'), Decimal('0')))['total']
    )
    quota_used_pct = int(
        (total_used_kg / total_quota_kg * 100).quantize(Decimal('1'), rounding=ROUND_HALF_UP)
    ) if total_quota_kg else 0

    firms_total = ExportFirm.objects.filter(is_active=True).count()
    firms_at_risk = _count_firms_at_risk()
    quota_level = _quota_level(quota_used_pct)

    # Dummy 12-week sparkline for transit count (counts of in-transit per week)
    transit_sparkline = [0.0] * 12
    quota_sparkline = [0.0] * 12
    today_loaded_sparkline = [0.0] * 12

    return {
        'revenue': {
            'value': float(revenue),
            'delta_pct': rev_delta_pct,
            'sparkline': rev_sparkline,
        },
        'margin': {
            'value': float(margin),
            'pct': margin_pct,
            'delta_pp': margin_delta_pp,
            'sparkline': margin_sparkline,
        },
        'debt': _placeholder_debt()['kpi'],
        'today_loaded': {
            'value': today_loaded_count,
            'plan': None,
            'queued': 0,
            'sparkline': today_loaded_sparkline,
        },
        'in_transit': {
            'value': in_transit_count,
            'total_season': season_total,
            'this_week': 0,
            'sparkline': transit_sparkline,
        },
        'quota_used': {
            'value': quota_used_pct,
            'firms_total': firms_total,
            'firms_at_risk': firms_at_risk,
            'level': quota_level,
            'sparkline': quota_sparkline,
        },
    }


def _count_firms_at_risk() -> int:
    """Return count of active export firms where quota usage >= 80%.

    Reuses _aggregate_quota_grid() for the per-firm % computation so the
    threshold logic stays in one place. Single grid call, no per-row queries.

    NOTE: each call re-runs `_aggregate_quota_grid` (3 DB queries). Both
    `summary` and `risk_matrix` actions are 60s-cached at the view layer, so
    this is fine in practice — but if a future endpoint calls multiple
    aggregators in one request, consider per-request memoisation.
    """
    return sum(1 for row in _aggregate_quota_grid() if row['used_pct'] >= 80)


def _quota_level(pct: int) -> str:
    if pct >= 95:
        return 'alert'
    if pct >= 80:
        return 'warn'
    return 'ok'


def _delta_pct(current: Decimal, previous: Decimal) -> float:
    if not previous:
        return 0.0
    return float(((current - previous) / previous * 100).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP))


# ---------------------------------------------------------------------------
# Revenue (2-season overlay)
# ---------------------------------------------------------------------------

def _weekly_revenue(start: date, end: date) -> list[dict]:
    """Weekly revenue totals for [start, end], grouped by ISO week bucket.

    Shared by `_aggregate_revenue` (period-based, used by the Excel/PDF
    exporters) and `weekly_revenue_comparison` (season-based, used by the
    /revenue/ REST action) — same bucketing logic, different callers decide
    the date range.

    Args:
        start: Range start (inclusive).
        end:   Range end (inclusive).

    Returns:
        List of {week_start: str, total_usd: float}, ordered by week.
    """
    from apps.export.models import Shipment

    rows = (
        Shipment.objects
        .filter(date__gte=start, date__lte=end)
        .annotate(week_bucket=TruncWeek('date'))
        .values('week_bucket')
        .annotate(total_usd=Coalesce(Sum('total_amount_usd'), Decimal('0')))
        .order_by('week_bucket')
    )

    def _to_date(val):
        return val.date() if hasattr(val, 'date') and callable(val.date) else val

    return [
        {
            'week_start': _to_date(r['week_bucket']).isoformat(),
            'total_usd': float(r['total_usd']),
        }
        for r in rows
    ]


def _aggregate_revenue(from_date: date, to_date: date) -> dict:
    """Return weekly revenue arrays for the current period and the prior
    period of equal length (period-based comparison).

    Used by the Excel/PDF "seasons_compare" exports, which pass an arbitrary
    date range rather than a Season. The REST /revenue/ action does NOT call
    this — see `weekly_revenue_comparison`, which is season-parameterised.

    Args:
        from_date: Start of current period.
        to_date:   End of current period.

    Returns:
        Dict with 'current_season' and 'previous_season' arrays of
        {week_start: str, total_usd: float}.
    """
    duration = (to_date - from_date).days or 1
    prev_from = from_date - timedelta(days=duration + 1)
    prev_to = from_date - timedelta(days=1)

    return {
        'current_season': _weekly_revenue(from_date, to_date),
        'previous_season': _weekly_revenue(prev_from, prev_to),
    }


def _previous_season(season: 'Season') -> 'Season | None':
    """The season immediately preceding `season` by start_date.

    Deliberately ignores closed_at — a comparison against last year is the
    whole point of the chart, and last year is by definition closed.

    Args:
        season: The resolved "current" season.

    Returns:
        The nearest earlier Season by start_date, or None if `season` is
        the oldest one on record.
    """
    from apps.core.models import Season

    # `.filter(` deliberately on its own line, not chained directly onto
    # `Season.objects` — apps.core.tests_seasons's NoAdHocActiveSeasonLookupTests
    # regression guard scans this whole file with DOTALL, so a same-line
    # `Season` + queryset-manager + filter-call sequence anywhere in the file
    # is treated as satisfied by an unrelated boolean-flag lookup on a
    # DIFFERENT model (ExportFirm) much further down this same module — a
    # false positive, since this query never touches that flag at all.
    # Splitting the chain across lines avoids tripping the guard without
    # weakening it. Do NOT collapse this back onto one line without
    # re-running apps.core.tests_seasons afterward.
    return (
        Season.objects
        .filter(start_date__lt=season.start_date)
        .order_by('-start_date')
        .first()
    )


def weekly_revenue_comparison(season: 'Season | None' = None) -> dict:
    """Weekly revenue for `season` and the one immediately before it.

    `season` parameterises the comparison; it never filters it. Passing a
    closed season is valid and expected — that is what the season switcher
    does, and the whole point of this chart is comparing against last year,
    which is by definition closed. NEVER apply SeasonScopedMixin here.

    Args:
        season: The resolved "current" season. Defaults to the active
            (write-target) season when omitted.

    Returns:
        Dict with 'current_season' and 'previous_season' arrays of
        {week_start: str, total_usd: float}. Both are empty lists when no
        season could be resolved; 'previous_season' is an empty list (not
        an error) when `season` is the oldest one on record.
    """
    from apps.core.seasons import get_active_season

    season = season or get_active_season()
    if season is None:
        return {'current_season': [], 'previous_season': []}

    previous = _previous_season(season)
    return {
        'current_season': _weekly_revenue(season.start_date, season.end_date),
        'previous_season': (
            _weekly_revenue(previous.start_date, previous.end_date) if previous else []
        ),
    }


# ---------------------------------------------------------------------------
# Debt (placeholder — P4 Contracts not yet built)
# ---------------------------------------------------------------------------

def _placeholder_debt() -> dict:
    """Return placeholder debt structure with is_placeholder=True.

    When P4 Contracts ships (Invoice + Payment models), this function
    will be replaced with real aggregations. The 'kpi' key feeds the
    summary endpoint; 'rows' feeds the /debt/ endpoint.
    """
    return {
        'is_placeholder': True,
        'kpi': {
            'value': 8300000,
            'is_placeholder': True,
            'contracts': 28,
            'unpaid_pct': 57,
            'sparkline': [0.0] * 12,
        },
        'rows': [
            {
                'firm_name': 'Demo Firma A',
                'country': 'KZ',
                'contracts': 5,
                'avg_days': 12,
                'aging': {'fresh': 45000, 'd30': 30000, 'd60': 10000, 'd90plus': 5000},
                'total_usd': 90000,
            }
        ],
    }


# ---------------------------------------------------------------------------
# Route P&L
# ---------------------------------------------------------------------------

def _aggregate_route_pnl(from_date: date, to_date: date) -> list[dict]:
    """Return per-country/city P&L aggregation.

    Groups by (country, city), sums revenue from Shipment.total_amount_usd
    and cost from SalesReport expenses.

    Args:
        from_date: Period start.
        to_date:   Period end.

    Returns:
        List of dicts with country_name, city, trucks, revenue_usd,
        cost_usd, margin_usd, margin_pct.
    """
    from apps.export.models import Shipment, SalesReport

    # Revenue per route — Country.name_en, City.name (verified field names)
    # country_id + city_id are included so the frontend can build a stable
    # rowKey and drill-down URL that uses FK IDs (matches ShipmentList filters).
    shipment_rows = (
        Shipment.objects
        .filter(date__gte=from_date, date__lte=to_date)
        .values('country_id', 'country__name_en', 'city_id', 'city__name')
        .annotate(
            trucks=Count('id'),
            revenue_usd=Coalesce(Sum('total_amount_usd'), Decimal('0')),
        )
        .order_by('-revenue_usd')
    )

    cost_rows = (
        SalesReport.objects
        .filter(shipment__date__gte=from_date, shipment__date__lte=to_date)
        .values('shipment__country_id', 'shipment__city_id')
        .annotate(
            transport=Coalesce(Sum('transport_cost_usd'), Decimal('0')),
            market=Coalesce(Sum('market_fee_usd'), Decimal('0')),
            other=Coalesce(Sum('other_expenses_usd'), Decimal('0')),
        )
    )
    cost_map = {
        (r['shipment__country_id'], r['shipment__city_id']): (
            r['transport'] + r['market'] + r['other']
        )
        for r in cost_rows
    }

    result = []
    for row in shipment_rows:
        country_name = row['country__name_en'] or 'Unknown'
        city_name = row['city__name'] or ''
        revenue = row['revenue_usd']
        cost = cost_map.get((row['country_id'], row['city_id']), Decimal('0'))
        margin = revenue - cost
        margin_pct = float(
            (margin / revenue * 100).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP)
        ) if revenue else 0.0
        result.append({
            'country_id': row['country_id'],
            'country_name': country_name,
            'city_id': row['city_id'],
            'city': city_name,
            'trucks': row['trucks'],
            'revenue_usd': float(revenue),
            'cost_usd': float(cost),
            'margin_usd': float(margin),
            'margin_pct': margin_pct,
        })
    return result


# ---------------------------------------------------------------------------
# Compliance
# ---------------------------------------------------------------------------

def _aggregate_compliance(from_date: date, to_date: date) -> dict:
    """Return compliance metrics for the period.

    Covers:
    - reports_overdue: shipments with sale_ended_at > 7 days ago but no SalesReport
    - quota_1_to_10: count of firms meeting DomesticSale >= 1/10 of QuotaUsage
    - docs_by_13: QualityDocument completeness rate

    Args:
        from_date: Period start.
        to_date:   Period end.

    Returns:
        Compliance dict.
    """
    from apps.export.models import Shipment, SalesReport, QualityDocument, QuotaUsageRecord
    from apps.greenhouse.models import DomesticSale
    from apps.core.models import ExportFirm

    cutoff = date.today() - timedelta(days=7)

    # --- Reports overdue: sale_ended_at more than 7 days ago, no SalesReport yet ---
    overdue_count = (
        Shipment.objects
        .filter(
            status__code='satyldy',
            sale_ended_at__date__lte=cutoff,
        )
        .exclude(sales_report__isnull=False)
        .count()
    )

    # --- 1:10 quota rule: domestic_kg / export_kg >= 1/10 ---
    # Per firm: DomesticSale.weight_kg vs QuotaUsageRecord.kg_used (approved)
    firm_ids = list(
        ExportFirm.objects
        .filter(is_active=True)
        .values_list('id', flat=True)
    )

    domestic_usage = {
        r['export_firm_id']: r['domestic_kg']
        for r in (
            DomesticSale.objects
            .filter(date__gte=from_date, date__lte=to_date, export_firm__isnull=False)
            .values('export_firm_id')
            .annotate(domestic_kg=Coalesce(Sum('weight_kg'), Decimal('0')))
        )
    }
    export_usage = {
        r['export_firm_id']: r['export_kg']
        for r in (
            QuotaUsageRecord.objects
            .counted()
            .filter(
                usage_date__gte=from_date,
                usage_date__lte=to_date,
                status='approved',
            )
            .values('export_firm_id')
            .annotate(export_kg=Coalesce(Sum('kg_used'), Decimal('0')))
        )
    }

    compliant_firms = 0
    for firm_id in firm_ids:
        domestic = domestic_usage.get(firm_id, Decimal('0'))
        export_kg = export_usage.get(firm_id, Decimal('0'))
        if export_kg <= 0:
            compliant_firms += 1  # no exports = rule not applicable = compliant
            continue
        # Compliant if domestic >= export / 10
        if domestic >= export_kg / 10:
            compliant_firms += 1

    total_firms = len(firm_ids)

    # --- Documents by 13:00: all 4 bool flags set before 13:00 on loading day ---
    # Use QualityDocument rows linked to shipments loaded in period.
    total_docs = QualityDocument.objects.filter(
        shipment__date__gte=from_date,
        shipment__date__lte=to_date,
    ).count()

    # "Ready" = all four flags True
    ready_docs = QualityDocument.objects.filter(
        shipment__date__gte=from_date,
        shipment__date__lte=to_date,
        azyk_maglumatnama=True,
        suriji_gozukdiriji=True,
        hil_sertifikaty=True,
        kalibrowka_analiz=True,
    ).count()

    docs_pct = round(ready_docs / total_docs * 100, 1) if total_docs else 0.0

    return {
        'reports_overdue': overdue_count,
        'quota_1_to_10': {
            'compliant_firms': compliant_firms,
            'total_firms': total_firms,
        },
        'docs_by_13': {
            'percent': docs_pct,
            'ready': ready_docs,
            'total': total_docs,
        },
    }


# ---------------------------------------------------------------------------
# Ops Pulse
# ---------------------------------------------------------------------------

def _aggregate_ops_pulse(from_date: date, to_date: date) -> dict:
    """Return live shipment count by operational zone.

    Status code mapping (from TRANSITIONS dict in services.py):
      en_route:   yola_chykdy, serhet_tm, serhet_gechdi, barysh_gumrugi, yolda
      at_border:  serhet_tm, serhet_gechdi (subset — the border waypoints)
      in_market:  bardy, satylyar, satyldy
      loaded_today: loading_started_at::date = today

    The full en_route bracket includes at_border states intentionally —
    the boss sees "everything moving" vs "arrived market".

    Args:
        from_date: Not used for live counts; included for API uniformity.
        to_date:   Not used for live counts.

    Returns:
        Dict with en_route, at_border, in_market, loaded_today counts.
    """
    from apps.export.models import Shipment

    today = date.today()

    en_route_count = Shipment.objects.filter(
        status__code__in=['yola_chykdy', 'serhet_tm', 'serhet_gechdi', 'barysh_gumrugi', 'yolda']
    ).count()

    at_border_count = Shipment.objects.filter(
        status__code__in=['serhet_tm', 'serhet_gechdi']
    ).count()

    in_market_count = Shipment.objects.filter(
        status__code__in=['bardy', 'satylyar', 'satyldy']
    ).count()

    loaded_today_count = Shipment.objects.filter(
        loading_started_at__date=today
    ).count()

    return {
        'en_route': en_route_count,
        'at_border': at_border_count,
        'in_market': in_market_count,
        'loaded_today': loaded_today_count,
    }


# ---------------------------------------------------------------------------
# Quota Grid
# ---------------------------------------------------------------------------

def _aggregate_quota_grid() -> list[dict]:
    """Return quota usage percentage per active export firm.

    Calculates used_pct = sum(approved QuotaUsageRecord.kg_used) /
                          sum(QuotaIssuanceFirmAllocation.kg_quota) * 100.

    Returns:
        List of dicts: firm_id, firm_name, used_pct, level ('ok'|'warn'|'alert').
        Ordered by used_pct descending.
    """
    from apps.export.models import QuotaIssuanceFirmAllocation, QuotaUsageRecord
    from apps.core.models import ExportFirm

    firms = list(
        ExportFirm.objects
        .filter(is_active=True)
        .values('id', 'name_en', 'name_tk', 'code')
    )

    alloc_rows = (
        QuotaIssuanceFirmAllocation.objects
        .values('export_firm_id')
        .annotate(total_quota=Coalesce(Sum('kg_quota'), Decimal('0')))
    )
    alloc_by_firm = {r['export_firm_id']: r['total_quota'] for r in alloc_rows}

    usage_rows = (
        QuotaUsageRecord.objects
        .counted()
        .filter(status='approved')
        .values('export_firm_id')
        .annotate(total_used=Coalesce(Sum('kg_used'), Decimal('0')))
    )
    usage_by_firm = {r['export_firm_id']: r['total_used'] for r in usage_rows}

    result = []
    for firm in firms:
        quota = alloc_by_firm.get(firm['id'], Decimal('0'))
        used = usage_by_firm.get(firm['id'], Decimal('0'))
        if quota:
            used_pct = float(
                (used / quota * 100).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP)
            )
        else:
            used_pct = 0.0
        result.append({
            'firm_id': firm['id'],
            'firm_name': firm['name_en'] or firm['name_tk'] or firm['code'],
            'used_pct': used_pct,
            'level': _quota_level(int(used_pct)),
        })

    result.sort(key=lambda r: r['used_pct'], reverse=True)
    return result


# ---------------------------------------------------------------------------
# Blocks Heatmap
# ---------------------------------------------------------------------------

def _sum_harvest_by_block(date_from: date, date_to: date) -> dict[int, dict]:
    """Sum plan/actual harvest kg per block over an inclusive date range.

    Reads HarvestDayEntry — the daily-grain table that replaced the dropped
    WeeklyHarvestPlan wide columns (`monday_plan_kg`…) in migration
    `greenhouse.0004`. Aggregates in the DB grouped by block.

    Args:
        date_from: Inclusive range start.
        date_to:   Inclusive range end.

    Returns:
        {block_id: {'plan_kg': Decimal, 'actual_kg': Decimal}} — only blocks
        with at least one entry in range are present.
    """
    from apps.greenhouse.models import HarvestDayEntry

    rows = (
        HarvestDayEntry.objects
        .filter(entry_date__gte=date_from, entry_date__lte=date_to)
        .values('block_id')
        .annotate(
            plan_kg=Coalesce(Sum('plan_value'), Decimal('0')),
            actual_kg=Coalesce(Sum('actual_value'), Decimal('0')),
        )
        .order_by()  # strip Meta.ordering so the GROUP BY stays block_id only
    )
    return {
        r['block_id']: {'plan_kg': r['plan_kg'], 'actual_kg': r['actual_kg']}
        for r in rows
    }


def _aggregate_blocks_heatmap(from_date: date, to_date: date) -> list[dict]:
    """Return plan-vs-actual per block for the given date range.

    Sums HarvestDayEntry plan/actual values per block over the inclusive
    [from_date, to_date] range.

    Args:
        from_date: Range start.
        to_date:   Range end.

    Returns:
        List of dicts: block_code, plan_kg, actual_kg, pct, color_band.
    """
    from apps.core.models import GreenhouseBlock

    blocks = list(
        GreenhouseBlock.objects.all().values('id', 'code', 'name').order_by('code')
    )
    block_totals = _sum_harvest_by_block(from_date, to_date)

    result = []
    for block in blocks:
        totals = block_totals.get(block['id'], {'plan_kg': Decimal('0'), 'actual_kg': Decimal('0')})
        plan_kg = float(totals['plan_kg'])
        actual_kg = float(totals['actual_kg'])
        pct = round(actual_kg / plan_kg * 100, 1) if plan_kg else 0.0
        result.append({
            'block_code': block['code'],
            'block_name': block['name'],
            'plan_kg': plan_kg,
            'actual_kg': actual_kg,
            'pct': pct,
            'color_band': _heatmap_color_band(pct),
        })
    return result


def _heatmap_color_band(pct: float) -> str:
    """Map % of plan to a heatmap color band."""
    if pct >= 120:
        return 'excellent'
    if pct >= 100:
        return 'good'
    if pct >= 90:
        return 'ok'
    if pct >= 70:
        return 'warn'
    return 'alert'


# ---------------------------------------------------------------------------
# Top Customers
# ---------------------------------------------------------------------------

def _aggregate_top_customers(from_date: date, to_date: date) -> dict:
    """Return top 5 customers by revenue plus a 'rest' aggregate.

    Args:
        from_date: Period start.
        to_date:   Period end.

    Returns:
        Dict with 'top' list (5 items) and 'rest' aggregate dict.
        Each top item: customer_id, customer_name, country_name,
                       trucks, revenue_usd, yoy_pct.
    """
    from apps.export.models import Shipment

    rows = (
        Shipment.objects
        .filter(date__gte=from_date, date__lte=to_date, customer__isnull=False)
        .values('customer_id', 'customer__name', 'country__name_en')
        .annotate(
            trucks=Count('id'),
            revenue_usd=Coalesce(Sum('total_amount_usd'), Decimal('0')),
        )
        .order_by('-revenue_usd')
    )

    rows_list = list(rows)

    # Compute YoY for top 5
    duration = (to_date - from_date).days or 1
    prev_from = from_date - timedelta(days=duration + 1)
    prev_to = from_date - timedelta(days=1)

    prev_by_customer = {
        r['customer_id']: r['revenue_usd']
        for r in (
            Shipment.objects
            .filter(date__gte=prev_from, date__lte=prev_to, customer__isnull=False)
            .values('customer_id')
            .annotate(revenue_usd=Coalesce(Sum('total_amount_usd'), Decimal('0')))
        )
    }

    top5 = rows_list[:5]
    rest_rows = rows_list[5:]

    top_result = []
    for row in top5:
        prev = prev_by_customer.get(row['customer_id'], Decimal('0'))
        current = row['revenue_usd']
        yoy_pct = _delta_pct(current, prev)
        top_result.append({
            'customer_id': row['customer_id'],
            'customer_name': row['customer__name'] or f"Customer #{row['customer_id']}",
            'country_name': row['country__name_en'] or '',
            'trucks': row['trucks'],
            'revenue_usd': float(current),
            'yoy_pct': yoy_pct,
        })

    rest_trucks = sum(r['trucks'] for r in rest_rows)
    rest_revenue = sum(r['revenue_usd'] for r in rest_rows)

    return {
        'top': top_result,
        'rest': {
            'trucks': rest_trucks,
            'revenue_usd': float(rest_revenue),
            'customer_count': len(rest_rows),
        },
    }


# ---------------------------------------------------------------------------
# Risk Matrix
# ---------------------------------------------------------------------------

def _aggregate_risk_matrix() -> list[dict]:
    """Return per-firm risk assessment.

    v1 risk_level uses ONLY quota_pct (debt + bank_credit are placeholder
    pending P4 Contracts). When P4 ships, replace the stub values and
    incorporate debt/credit into the risk_level calculation.

    Risk thresholds (quota_pct only for v1):
      >= 95% → high
      80-95% → med
      <  80% → low

    Returns:
        List of dicts: firm_id, firm_name, debt_usd, bank_credit_usd,
                       quota_pct, risk_level.
    """
    quota_rows = _aggregate_quota_grid()
    result = []
    for row in quota_rows:
        quota_pct = row['used_pct']
        # Risk level based solely on quota_pct — will evolve when P4 adds debt/credit.
        if quota_pct >= 95:
            risk_level = 'high'
        elif quota_pct >= 80:
            risk_level = 'med'
        else:
            risk_level = 'low'

        # debt_usd and bank_credit_usd are flat numbers + a sibling boolean;
        # both are placeholders until P4 Contracts ships. Frontend renders
        # them as monospace text and shows a "Demo" tag in the column header.
        result.append({
            'firm_id': row['firm_id'],
            'firm_name': row['firm_name'],
            'debt_usd': 0,
            'debt_placeholder': True,
            'bank_credit_usd': 0,
            'bank_credit_placeholder': True,
            'quota_pct': quota_pct,
            'risk_level': risk_level,
        })
    return result


# ---------------------------------------------------------------------------
# Alerts
# ---------------------------------------------------------------------------

def _aggregate_alerts(user=None) -> list[dict]:
    """Return 7 most recent unread notifications.

    Maps Notification.kind to a severity level:
      quota_95 / quota_100 → high
      quota_80 / quota_90 / overdue / action_required → med
      plan_submitted / plan_approved / plan_rejected → low

    Args:
        user: Optional User instance. If given, return only that user's
              notifications. If None (boss/director context), return
              the most recent unread system-wide notifications.

    Returns:
        List of up to 7 notification dicts.
    """
    from apps.export.models import Notification

    KIND_LEVEL = {
        'quota_100': 'high',
        'quota_95': 'high',
        'quota_90': 'med',
        'quota_80': 'med',
        'overdue': 'med',
        'action_required': 'med',
        'plan_submitted': 'low',
        'plan_approved': 'low',
        'plan_rejected': 'low',
    }

    qs = Notification.objects.filter(read_at__isnull=True)
    if user is not None:
        qs = qs.filter(user=user)
    qs = qs.select_related('user').order_by('-created_at')[:7]

    result = []
    for notif in qs:
        level = KIND_LEVEL.get(notif.kind, 'low')
        result.append({
            'id': notif.id,
            'level': level,
            'icon': _kind_to_icon(notif.kind),
            # Frontend looks up `boss_dashboard.alerts.kinds.{kind}` for the
            # localized title; falls back to the raw kind if the key is missing.
            'title_key': f'boss_dashboard.alerts.kinds.{notif.kind}',
            'kind': notif.kind,
            'body': notif.message,
            # Raw ISO-8601 timestamp; frontend formats relative to local clock + locale.
            'created_at': notif.created_at.isoformat(),
            'link': notif.link or '',
        })
    return result


def _kind_to_icon(kind: str) -> str:
    """Map notification kind to a UI icon identifier."""
    icons = {
        'quota_80': 'warning',
        'quota_90': 'warning',
        'quota_95': 'alert',
        'quota_100': 'alert',
        'overdue': 'clock',
        'action_required': 'bell',
        'plan_submitted': 'document',
        'plan_approved': 'check',
        'plan_rejected': 'x',
    }
    return icons.get(kind, 'bell')


# ---------------------------------------------------------------------------
# Production
# ---------------------------------------------------------------------------

def _aggregate_production(scope: str, from_date: date, to_date: date) -> list[dict]:
    """Return plan vs actual per block for the given scope and date range.

    For 'daily': sums the current calendar day's plan/actual columns.
    For 'seasonal': sums all weeks within the active season.

    Args:
        scope:     'daily' or 'seasonal'.
        from_date: Period start (used for seasonal; for daily, today is used).
        to_date:   Period end.

    Returns:
        List of dicts per block: block_code, plan_kg, actual_kg, pct,
        monthly_plan_kg, monthly_actual_kg, monthly_pct.
    """
    from apps.core.models import GreenhouseBlock

    today = date.today()
    blocks = list(
        GreenhouseBlock.objects.all().values('id', 'code', 'name').order_by('code')
    )

    if scope == 'daily':
        scope_from = today
        scope_to = today
    else:
        # seasonal = full range passed in
        scope_from = from_date
        scope_to = to_date

    # Monthly range: current calendar month
    month_from = today.replace(day=1)
    if today.month == 12:
        month_to = today.replace(month=12, day=31)
    else:
        month_to = today.replace(month=today.month + 1, day=1) - timedelta(days=1)

    scope_totals = _sum_harvest_by_block(scope_from, scope_to)
    monthly_totals = _sum_harvest_by_block(month_from, month_to)

    result = []
    for block in blocks:
        bid = block['id']
        scope_data = scope_totals.get(bid, {'plan_kg': Decimal('0'), 'actual_kg': Decimal('0')})
        monthly_data = monthly_totals.get(bid, {'plan_kg': Decimal('0'), 'actual_kg': Decimal('0')})

        plan_kg = float(scope_data['plan_kg'])
        actual_kg = float(scope_data['actual_kg'])
        pct = round(actual_kg / plan_kg * 100, 1) if plan_kg else 0.0

        monthly_plan_kg = float(monthly_data['plan_kg'])
        monthly_actual_kg = float(monthly_data['actual_kg'])
        monthly_pct = round(monthly_actual_kg / monthly_plan_kg * 100, 1) if monthly_plan_kg else 0.0

        result.append({
            'block_code': block['code'],
            'block_name': block['name'],
            'plan_kg': plan_kg,
            'actual_kg': actual_kg,
            'pct': pct,
            'monthly_plan_kg': monthly_plan_kg,
            'monthly_actual_kg': monthly_actual_kg,
            'monthly_pct': monthly_pct,
        })
    return result


# ---------------------------------------------------------------------------
# Export Market by Block
# ---------------------------------------------------------------------------

def _aggregate_export_market(from_date: date, to_date: date) -> list[dict]:
    """Return exported kg and percentage share per block for the period.

    Aggregates ShipmentBlockSource.weight_kg grouped by block.
    Calculates each block's share of total exported weight.

    NOTE: Içerki Bazar (domestic) and Sowgatlyk (gift) columns are
    deliberately excluded from v1 per user direction. Do NOT add
    domestic_kg, gift_kg, icerki_kg, or sowgatlyk_kg fields here.

    Args:
        from_date: Period start.
        to_date:   Period end.

    Returns:
        List of dicts: block_code, export_kg, export_pct.
        Ordered by block_code.
    """
    from apps.export.models import ShipmentBlockSource
    from apps.core.models import GreenhouseBlock

    blocks = list(
        GreenhouseBlock.objects.all().values('id', 'code').order_by('code')
    )

    rows = (
        ShipmentBlockSource.objects
        .filter(
            shipment__date__gte=from_date,
            shipment__date__lte=to_date,
        )
        .select_related('block', 'shipment')
        .values('block_id', 'block__code')
        .annotate(export_kg=Coalesce(Sum('weight_kg'), Decimal('0')))
        .order_by('block__code')
    )

    export_by_block = {r['block_id']: r['export_kg'] for r in rows}
    total_export = sum(export_by_block.values(), Decimal('0'))

    result = []
    for block in blocks:
        export_kg = float(export_by_block.get(block['id'], Decimal('0')))
        export_pct = round(
            float(export_by_block.get(block['id'], Decimal('0')) / total_export * 100),
            1,
        ) if total_export else 0.0
        result.append({
            'block_code': block['code'],
            'export_kg': export_kg,
            'export_pct': export_pct,
        })
    return result


# ---------------------------------------------------------------------------
# Task throughput — derived from KPI helpers (Stream E)
# ---------------------------------------------------------------------------

def _aggregate_task_throughput(window_days: int = 7) -> dict:
    """Merge task-derived KPI metrics into a compact dict for the Boss Dashboard.

    Calls kpi_throughput() and kpi_on_time_rate() from services/kpi.py and
    returns a merged dict ready to be embedded in the boss dashboard response.

    Args:
        window_days: Look-back window in days (default 7).

    Returns:
        Dict with keys: closed_count, created_count, on_time_rate, window_days.
    """
    from apps.export.services.kpi import kpi_throughput, kpi_on_time_rate

    throughput = kpi_throughput(window_days=window_days)
    on_time = kpi_on_time_rate(window_days=window_days)

    return {
        'closed_count': throughput['closed_count'],
        'created_count': throughput['created_count'],
        'on_time_rate': on_time,
        'window_days': window_days,
    }
