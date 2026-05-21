"""Main dashboard summary aggregation.

Single public function `build_dashboard_summary()` is called by DashboardViewSet.
No writes, no side-effects — pure read aggregation.

MSSQL rules:
- No JSONField/ArrayField/DISTINCT ON
- DecimalField arithmetic only; float cast only at JSON boundary
- No bulk_create (read-only module)
- select_related / values().annotate() used throughout to avoid N+1
"""
import logging
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP

from django.db.models import Count, Sum, Q
from django.db.models.functions import Coalesce

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Season resolver
# ---------------------------------------------------------------------------

def _resolve_season():
    """Return (season_or_None, start_date, end_date).

    Fetches the active season. Falls back to current-month range if none found.
    """
    from apps.core.models import Season
    from apps.export.services.boss_analytics import period_to_range

    season = Season.objects.filter(is_active=True).order_by('-start_date').first()
    if season:
        return season, season.start_date, season.end_date
    start, end = period_to_range('month')
    return None, start, end


# ---------------------------------------------------------------------------
# Stats helpers
# ---------------------------------------------------------------------------

def _build_stats(start: date, end: date) -> dict:
    """Compute all stats values.

    Season-scoped counts use date__gte/lte on the base queryset.
    LIVE counts (in_transit, selling) are not date-scoped.

    Args:
        start: Season start date (inclusive).
        end:   Season end date (inclusive).

    Returns:
        Dict matching the 'stats' key of the response contract.
    """
    from apps.export.models import Shipment

    today = date.today()
    seven_days_ago = today - timedelta(days=6)  # "last 7 days" = today-6 .. today

    # Base queryset: season-scoped, no drafts
    base_qs = (
        Shipment.objects
        .filter(date__gte=start, date__lte=end)
        .exclude(status__code='draft')
    )

    # --- total ---
    total_value = base_qs.count()
    total_delta_7d = (
        Shipment.objects
        .filter(date__gte=seven_days_ago, date__lte=today)
        .exclude(status__code='draft')
        .count()
    )

    # --- completed ---
    completed_value = base_qs.filter(status__code='tamamlandy').count()
    completed_delta_7d = (
        Shipment.objects
        .filter(status__code='tamamlandy', status_changed_at__date__gte=seven_days_ago)
        .count()
    )

    # --- in_transit: LIVE — not season-scoped ---
    in_transit_codes = [
        'yola_chykdy', 'serhet_tm', 'serhet_gechdi', 'barysh_gumrugi', 'yolda',
    ]
    in_transit_value = Shipment.objects.filter(status__code__in=in_transit_codes).count()

    # --- selling: LIVE — not season-scoped ---
    selling_codes = ['bardy', 'satylyar', 'satyldy']
    selling_value = Shipment.objects.filter(status__code__in=selling_codes).count()

    # --- no_report: reports overdue (same logic as _aggregate_compliance) ---
    # satyldy + sale_ended_at >= 7 days ago + no SalesReport row
    cutoff = today - timedelta(days=7)
    no_report_value = (
        Shipment.objects
        .filter(
            status__code='satyldy',
            sale_ended_at__date__lte=cutoff,
        )
        .exclude(sales_report__isnull=False)
        .count()
    )

    # --- quota_firms: active firms with at least one allocation row ---
    # bare .distinct() on values() is MSSQL-safe (DISTINCT ON is forbidden, not DISTINCT)
    from apps.export.models import QuotaIssuanceFirmAllocation
    quota_firms_value = (
        QuotaIssuanceFirmAllocation.objects
        .filter(export_firm__is_active=True)
        .values('export_firm_id')
        .distinct()
        .count()
    )

    return {
        'total': {'value': total_value, 'delta_7d': total_delta_7d},
        'in_transit': {'value': in_transit_value},
        'selling': {'value': selling_value},
        'completed': {'value': completed_value, 'delta_7d': completed_delta_7d},
        'no_report': {'value': no_report_value},
        'quota_firms': {'value': quota_firms_value},
    }


# ---------------------------------------------------------------------------
# Alerts helpers
# ---------------------------------------------------------------------------

def _build_alerts(no_report_count: int, start: date, end: date) -> dict:
    """Compute alert values.

    Args:
        no_report_count: Pre-computed overdue report count (reuse from stats).
        start: Season start date.
        end:   Season end date.

    Returns:
        Dict matching the 'alerts' key of the response contract.
    """
    from apps.export.models import QualityDocument
    from apps.export.services.boss_analytics import _aggregate_quota_grid

    # --- quota_exceeded_count: firms with used_pct >= 100 ---
    quota_grid = _aggregate_quota_grid()
    quota_exceeded_count = sum(1 for row in quota_grid if row['used_pct'] >= 100)

    # --- docs_pending_count: QualityDocument rows not fully complete ---
    total_docs = QualityDocument.objects.filter(
        shipment__date__gte=start,
        shipment__date__lte=end,
    ).count()
    ready_docs = QualityDocument.objects.filter(
        shipment__date__gte=start,
        shipment__date__lte=end,
        azyk_maglumatnama=True,
        suriji_gozukdiriji=True,
        hil_sertifikaty=True,
        kalibrowka_analiz=True,
    ).count()
    docs_pending_count = total_docs - ready_docs

    # --- weekly_plan: current ISO week from HarvestDayEntry ---
    weekly_plan = _build_weekly_plan_alert()

    return {
        'no_report_count': no_report_count,
        'quota_exceeded_count': quota_exceeded_count,
        'docs_pending_count': docs_pending_count,
        'weekly_plan': weekly_plan,
    }


def _build_weekly_plan_alert() -> 'dict | None':
    """Return weekly plan summary for the current ISO week or None if no data.

    Uses HarvestDayEntry.plan_value (the replacement for the dropped
    WeeklyHarvestPlan wide columns). Groups by weekly_plan to find distinct
    blocks that have a plan row for the current ISO week.

    Returns:
        Dict with week, tons, blocks or None if no plan entries found.
    """
    from apps.greenhouse.models import HarvestDayEntry, WeeklyHarvestPlan

    today = date.today()
    iso_cal = today.isocalendar()
    iso_year = iso_cal[0]
    iso_week = iso_cal[1]

    # Aggregate plan kg for the current ISO week
    agg = (
        HarvestDayEntry.objects
        .filter(
            weekly_plan__year=iso_year,
            weekly_plan__week_number=iso_week,
        )
        .aggregate(
            plan_kg=Coalesce(Sum('plan_value'), Decimal('0')),
        )
    )
    plan_kg = agg['plan_kg']

    # Count distinct blocks that have a plan row for this week
    block_count = (
        HarvestDayEntry.objects
        .filter(
            weekly_plan__year=iso_year,
            weekly_plan__week_number=iso_week,
            plan_value__isnull=False,
        )
        .values('block_id')
        .distinct()
        .count()
    )

    if block_count == 0:
        return None

    tons = round(float(plan_kg / 1000), 1)
    return {
        'week': iso_week,
        'tons': tons,
        'blocks': block_count,
    }


# ---------------------------------------------------------------------------
# Routes helpers
# ---------------------------------------------------------------------------

def _build_routes(start: date, end: date, total_count: int) -> list:
    """Compute per-country route breakdown with top-4 cities per country.

    Two grouped queries — no N+1:
      1. Country-level truck count
      2. City-level truck count for all countries in one query

    Args:
        start:       Season start date.
        end:         Season end date.
        total_count: Season total truck count (for percent calculation).

    Returns:
        List of country-route dicts sorted by trucks desc.
    """
    from apps.export.models import Shipment

    # Country-level aggregation — skip null country_id rows
    country_rows = (
        Shipment.objects
        .filter(date__gte=start, date__lte=end, country_id__isnull=False)
        .exclude(status__code='draft')
        .values('country_id', 'country__name_en')
        .annotate(trucks=Count('id'))
        .order_by('-trucks')
    )

    # City-level aggregation in a single query (all countries)
    city_rows = (
        Shipment.objects
        .filter(
            date__gte=start, date__lte=end,
            country_id__isnull=False,
            city__name__isnull=False,
        )
        .exclude(status__code='draft')
        .exclude(city__name='')
        .values('country_id', 'city__name')
        .annotate(trucks=Count('id'))
        .order_by('-trucks')
    )

    # Build city map: country_id → sorted list of {city, trucks}
    cities_by_country: dict[int, list] = {}
    for row in city_rows:
        cid = row['country_id']
        if cid not in cities_by_country:
            cities_by_country[cid] = []
        cities_by_country[cid].append({
            'city': row['city__name'],
            'trucks': row['trucks'],
        })
    # Each inner list is already sorted desc (order_by('-trucks') above)

    route_total = sum(r['trucks'] for r in country_rows)
    denom = route_total if route_total else 1

    result = []
    for row in country_rows:
        cid = row['country_id']
        trucks = row['trucks']
        percent = round(trucks / denom * 100)
        cities = cities_by_country.get(cid, [])[:4]
        result.append({
            'country_id': cid,
            'country_name': row['country__name_en'] or 'Unknown',
            'trucks': trucks,
            'percent': percent,
            'cities': cities,
        })

    return result


# ---------------------------------------------------------------------------
# Active shipments helpers
# ---------------------------------------------------------------------------

def _build_active_shipments() -> list:
    """Return up to 5 most-recently-changed active shipments.

    Active = any status in LOAD + TRANSIT + DEST phases.
    Ordered by status_changed_at desc.

    Returns:
        List of up to 5 active-shipment dicts.
    """
    from apps.export.models import Shipment
    from apps.export.services.phases import get_phase

    active_codes = [
        # LOAD
        'yuklenme',
        # TRANSIT
        'yola_chykdy', 'serhet_tm', 'serhet_gechdi', 'barysh_gumrugi', 'yolda',
        # DEST
        'bardy', 'satylyar', 'satyldy',
    ]

    shipments = (
        Shipment.objects
        .filter(status__code__in=active_codes)
        .select_related('status', 'country', 'city', 'customer')
        .order_by('-status_changed_at')[:5]
    )

    result = []
    for s in shipments:
        country_name = s.country.name_en if s.country_id else None
        city_name = s.city.name if s.city_id else None
        customer_name = s.customer.name if s.customer_id else None
        status_display = s.status.name_en if s.status_id else None
        phase = get_phase(s.status.code if s.status_id else None)
        weight_net = float(s.weight_net) if s.weight_net is not None else None
        departed_at = s.departed_at.isoformat() if s.departed_at is not None else None
        location = s.vehicle_live_status or ''

        result.append({
            'id': s.id,
            'cargo_code': s.cargo_code,
            'customer_name': customer_name,
            'country_name': country_name,
            'city_name': city_name,
            'status_display': status_display,
            'phase': phase,
            'weight_net': weight_net,
            'departed_at': departed_at,
            'location': location,
        })

    return result


# ---------------------------------------------------------------------------
# Main public function
# ---------------------------------------------------------------------------

def build_dashboard_summary() -> dict:
    """Aggregate all data for the main dashboard landing page.

    Returns a plain dict ready for JSON serialisation. All Decimal values
    are cast to float/int at the boundary here, not inside helpers.

    Returns:
        Dict with keys: season, stats, alerts, routes, active_shipments.
    """
    season, start, end = _resolve_season()

    season_payload = (
        {'id': season.id, 'name': season.name}
        if season is not None
        else None
    )

    stats = _build_stats(start, end)
    no_report_count = stats['no_report']['value']
    alerts = _build_alerts(no_report_count, start, end)
    routes = _build_routes(start, end, stats['total']['value'])
    active_shipments = _build_active_shipments()

    return {
        'season': season_payload,
        'stats': stats,
        'alerts': alerts,
        'routes': routes,
        'active_shipments': active_shipments,
    }
