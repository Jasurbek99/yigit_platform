"""Quota dashboard analytics — business logic extracted from views.

All functions are pure computation or DB queries; no HTTP/request handling.
"""

__all__ = [
    'build_quota_dashboard',
    'compute_fifo_usage',
    'fetch_plan_rows',
    'fetch_issuances',
    'aggregate_local_sales',
    'aggregate_quota_issued',
    'aggregate_quota_used',
]
import datetime
from decimal import Decimal

from django.core.cache import cache
from django.db.models import Sum
from django.db.models.functions import Coalesce

from collections import defaultdict

from apps.core.models import ExportFirm
from apps.export.models import (
    QuotaIssuance,
    QuotaIssuanceFirmAllocation,
    QuotaUsageRecord,
    WeeklyLocalSellPlan,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _week_monday(iso_year: int, iso_week: int) -> datetime.date:
    """Return the Monday date for a given ISO year + week."""
    jan4 = datetime.date(iso_year, 1, 4)
    monday_of_week1 = jan4 - datetime.timedelta(days=jan4.weekday())
    return monday_of_week1 + datetime.timedelta(weeks=iso_week - 1)


def _week_in_range(
    iso_year: int,
    iso_week: int,
    date_from: datetime.date,
    date_to: datetime.date,
) -> bool:
    """Return True if the Monday of the given ISO week falls within [date_from, date_to]."""
    monday = _week_monday(iso_year, iso_week)
    return date_from <= monday <= date_to


DAY_COLS = (
    'monday_plan_kg', 'tuesday_plan_kg', 'wednesday_plan_kg',
    'thursday_plan_kg', 'friday_plan_kg', 'saturday_plan_kg',
)


# ---------------------------------------------------------------------------
# Data fetching
# ---------------------------------------------------------------------------

def fetch_plan_rows(date_from: datetime.date, date_to: datetime.date) -> list[dict]:
    """Fetch WeeklyLocalSellPlan rows for weeks whose Monday falls in range."""
    rows = list(
        WeeklyLocalSellPlan.objects.filter(
            year__gte=date_from.year - 1,
            year__lte=date_to.year + 1,
        ).values('export_firm_id', 'week_number', 'year', *DAY_COLS)
    )
    return [r for r in rows if _week_in_range(r['year'], r['week_number'], date_from, date_to)]


def fetch_issuances(
    date_from: datetime.date,
    date_to: datetime.date,
    product_type: str,
) -> list:
    """Fetch QuotaIssuance objects in range with prefetched allocations."""
    return list(
        QuotaIssuance.objects
        .filter(
            issue_date__gte=date_from,
            issue_date__lte=date_to,
            product_type=product_type,
        )
        .prefetch_related('allocations')
        .order_by('issue_date')
    )


# ---------------------------------------------------------------------------
# Aggregations
# ---------------------------------------------------------------------------

def aggregate_local_sales(plan_rows: list[dict]) -> dict[int, Decimal]:
    """Sum Mon-Sat plan_kg per firm from pre-fetched plan rows."""
    totals: dict[int, Decimal] = {}
    for row in plan_rows:
        week_kg = sum((row[col] or Decimal('0')) for col in DAY_COLS)
        firm_id = row['export_firm_id']
        totals[firm_id] = totals.get(firm_id, Decimal('0')) + week_kg
    return totals


def aggregate_quota_issued(
    date_from: datetime.date,
    date_to: datetime.date,
    product_type: str,
) -> dict[int, Decimal]:
    """Sum kg_quota per firm from allocations whose issuance.issue_date is in range."""
    rows = (
        QuotaIssuanceFirmAllocation.objects
        .filter(
            issuance__issue_date__gte=date_from,
            issuance__issue_date__lte=date_to,
            issuance__product_type=product_type,
        )
        .values('export_firm_id')
        .annotate(total=Coalesce(Sum('kg_quota'), Decimal('0')))
    )
    return {row['export_firm_id']: row['total'] for row in rows}


def aggregate_quota_used(
    date_from: datetime.date, date_to: datetime.date,
) -> dict[int, Decimal]:
    """Sum approved quota usage per firm in the date range.

    Source: QuotaUsageRecord with status='approved'.
    Only approved records count — draft records are pending review.
    """
    usage_rows = (
        QuotaUsageRecord.objects
        .filter(usage_date__gte=date_from, usage_date__lte=date_to, status='approved')
        .values('export_firm_id')
        .annotate(total=Coalesce(Sum('kg_used'), Decimal('0')))
    )
    return {row['export_firm_id']: row['total'] for row in usage_rows}


# ---------------------------------------------------------------------------
# KPI computation
# ---------------------------------------------------------------------------

def _compute_kpis(
    local_sales: dict[int, Decimal],
    quota_issued: dict[int, Decimal],
    quota_used: dict[int, Decimal],
) -> dict:
    """Compute top-level KPI summary from aggregated data."""
    total_sales_kg = sum(local_sales.values(), Decimal('0'))
    total_expected_kg = total_sales_kg * 10
    total_issued_kg = sum(quota_issued.values(), Decimal('0'))
    total_used_kg = sum(quota_used.values(), Decimal('0'))
    total_not_given_kg = total_expected_kg - total_issued_kg
    total_not_given_pct = (
        (total_not_given_kg / total_expected_kg * 100) if total_expected_kg > 0 else Decimal('0')
    )
    total_unused_kg = max(total_issued_kg - total_used_kg, Decimal('0'))
    total_unused_pct = (
        (total_unused_kg / total_issued_kg * 100) if total_issued_kg > 0 else Decimal('0')
    )
    return {
        'local_sales_kg': total_sales_kg,
        'expected_kg': total_expected_kg,
        'issued_kg': total_issued_kg,
        'not_given_kg': total_not_given_kg,
        'not_given_pct': round(total_not_given_pct, 1),
        'used_kg': total_used_kg,
        'unused_kg': total_unused_kg,
        'unused_pct': round(total_unused_pct, 1),
    }


def _build_per_firm(
    all_firm_ids: set[int],
    local_sales: dict[int, Decimal],
    quota_issued: dict[int, Decimal],
    quota_used: dict[int, Decimal],
    firm_names: dict[int, str],
) -> list[dict]:
    """Build per-firm breakdown rows."""
    per_firm = []
    for firm_id in sorted(all_firm_ids):
        sales_kg = local_sales.get(firm_id, Decimal('0'))
        expected_kg = sales_kg * 10
        issued_kg = quota_issued.get(firm_id, Decimal('0'))
        used_kg = quota_used.get(firm_id, Decimal('0'))
        not_given_kg = expected_kg - issued_kg
        not_given_pct = (
            round(not_given_kg / expected_kg * 100, 1) if expected_kg > 0 else Decimal('0')
        )
        unused_kg = max(issued_kg - used_kg, Decimal('0'))

        if sales_kg == 0 and issued_kg == 0 and used_kg == 0:
            continue

        per_firm.append({
            'export_firm': firm_id,
            'export_firm_name': firm_names.get(firm_id, str(firm_id)),
            'sales_kg': sales_kg,
            'expected_kg': expected_kg,
            'issued_kg': issued_kg,
            'used_kg': used_kg,
            'not_given_kg': not_given_kg,
            'not_given_pct': not_given_pct,
            'unused_kg': unused_kg,
            'is_blocked': sales_kg > 0 and issued_kg == 0,
        })
    return per_firm


# ---------------------------------------------------------------------------
# Weekly flow
# ---------------------------------------------------------------------------

def _group_sales_by_week(plan_rows: list[dict]) -> dict[tuple, dict[int, Decimal]]:
    """Group plan rows into week_key → firm_id → sales_kg."""
    week_firm_sales: dict[tuple, dict[int, Decimal]] = {}
    for row in plan_rows:
        key = (row['year'], row['week_number'])
        week_kg = sum((row[col] or Decimal('0')) for col in DAY_COLS)
        if key not in week_firm_sales:
            week_firm_sales[key] = {}
        firm_id = row['export_firm_id']
        week_firm_sales[key][firm_id] = week_firm_sales[key].get(firm_id, Decimal('0')) + week_kg
    return week_firm_sales


def _group_issuances_by_week(issuances: list) -> tuple[dict[tuple, list], dict[tuple, dict[int, Decimal]]]:
    """Group issuances by matched week. Returns (week_issuances, week_firm_issued)."""
    week_issuances: dict[tuple, list] = {}
    week_firm_issued: dict[tuple, dict[int, Decimal]] = {}

    for issuance in issuances:
        key = (issuance.matched_year, issuance.matched_week)
        week_issuances.setdefault(key, []).append(issuance)
        if key not in week_firm_issued:
            week_firm_issued[key] = {}
        for alloc in issuance.allocations.all():
            firm_id = alloc.export_firm_id
            week_firm_issued[key][firm_id] = (
                week_firm_issued[key].get(firm_id, Decimal('0')) + alloc.kg_quota
            )

    return week_issuances, week_firm_issued


def _build_week_entry(
    year: int,
    week: int,
    firm_sales_map: dict[int, Decimal],
    firm_issued_map: dict[int, Decimal],
    week_issuances_list: list,
    firm_names: dict[int, str],
) -> dict:
    """Build a single week entry for the weekly flow response."""
    monday = _week_monday(year, week)
    saturday = monday + datetime.timedelta(days=5)

    week_sales_kg = sum(firm_sales_map.values(), Decimal('0'))
    week_expected_kg = week_sales_kg * 10
    week_issued_kg = sum(firm_issued_map.values(), Decimal('0'))

    coverage_pct = (
        round(week_issued_kg / week_expected_kg * 100, 1) if week_expected_kg > 0 else Decimal('0')
    )

    all_week_firm_ids = set(firm_sales_map.keys()) | set(firm_issued_map.keys())
    firms_breakdown = [
        {
            'firm_name': firm_names.get(fid, str(fid)),
            'sold_kg': firm_sales_map.get(fid, Decimal('0')),
            'expected_kg': firm_sales_map.get(fid, Decimal('0')) * 10,
            'got_kg': firm_issued_map.get(fid, Decimal('0')),
            'diff_kg': firm_issued_map.get(fid, Decimal('0')) - firm_sales_map.get(fid, Decimal('0')) * 10,
        }
        for fid in sorted(all_week_firm_ids)
    ]

    issuance_summaries = [
        {
            'id': iss.id,
            'issue_date': str(iss.issue_date),
            'total_kg': iss.total_kg,
            'is_manually_reassigned': iss.is_manually_reassigned,
        }
        for iss in week_issuances_list
    ]

    return {
        'week': week,
        'year': year,
        'date_from': str(monday),
        'date_to': str(saturday),
        'sales_kg': week_sales_kg,
        'expected_kg': week_expected_kg,
        'issued_kg': week_issued_kg,
        'gap_kg': week_expected_kg - week_issued_kg,
        'coverage_pct': coverage_pct,
        'issuances': issuance_summaries,
        'firms': firms_breakdown,
    }


def build_weekly_flow(
    plan_rows: list[dict],
    issuances: list,
    firm_names: dict[int, str],
) -> list[dict]:
    """Build weekly flow data from plan rows and issuances."""
    week_firm_sales = _group_sales_by_week(plan_rows)
    week_issuances, week_firm_issued = _group_issuances_by_week(issuances)

    all_week_keys = sorted(set(week_firm_sales.keys()) | set(week_issuances.keys()))

    return [
        _build_week_entry(
            year, week,
            week_firm_sales.get((year, week), {}),
            week_firm_issued.get((year, week), {}),
            week_issuances.get((year, week), []),
            firm_names,
        )
        for year, week in all_week_keys
    ]


# ---------------------------------------------------------------------------
# Main dashboard builder
# ---------------------------------------------------------------------------

def build_quota_dashboard(
    date_from: datetime.date,
    date_to: datetime.date,
    product_type: str,
) -> dict:
    """Build the full quota dashboard response.

    Args:
        date_from: Start of analysis period.
        date_to: End of analysis period.
        product_type: Product type filter (e.g. 'tomato').

    Returns:
        Dict with keys: kpis, per_firm, weekly_flow.
    """

    plan_rows = fetch_plan_rows(date_from, date_to)
    local_sales = aggregate_local_sales(plan_rows)
    quota_issued = aggregate_quota_issued(date_from, date_to, product_type)
    quota_used = aggregate_quota_used(date_from, date_to)
    issuances = fetch_issuances(date_from, date_to, product_type)

    all_firm_ids = set(local_sales.keys()) | set(quota_issued.keys()) | set(quota_used.keys())

    firm_names: dict[int, str] = {
        f.id: (f.name_en or f.name_tk or str(f.id))
        for f in ExportFirm.objects.filter(id__in=all_firm_ids).only('id', 'name_en', 'name_tk')
    }

    return {
        'kpis': _compute_kpis(local_sales, quota_issued, quota_used),
        'per_firm': _build_per_firm(all_firm_ids, local_sales, quota_issued, quota_used, firm_names),
        'weekly_flow': build_weekly_flow(plan_rows, issuances, firm_names),
    }


# ---------------------------------------------------------------------------
# FIFO per-allocation consumption
# ---------------------------------------------------------------------------

FIFO_CACHE_TTL = 60  # seconds — short TTL to avoid stale reads after approvals

def compute_fifo_usage(product_type: str) -> dict[int, Decimal]:
    """Compute FIFO per-firm quota consumption per allocation.

    For each firm: sort allocations by issue_date ASC (oldest first),
    then consume that firm's total usage starting from the oldest allocation.
    Each firm's usage only consumes that firm's own allocations.

    Results are cached for FIFO_CACHE_TTL seconds to avoid recomputing on
    every GET request in the QuotaIssuanceViewSet list view.

    Args:
        product_type: 'tomato' or 'pepper'.

    Returns:
        Dict mapping allocation_id → used_kg.
    """
    cache_key = f'fifo_usage:{product_type}'
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    # 1. Get all allocations with issue_date, grouped by firm
    allocs = list(
        QuotaIssuanceFirmAllocation.objects
        .filter(issuance__product_type=product_type)
        .select_related('issuance')
        .order_by('issuance__issue_date', 'id')
        .values_list('id', 'export_firm_id', 'kg_quota', 'issuance__issue_date')
    )

    firm_allocs: dict[int, list[tuple[int, Decimal]]] = defaultdict(list)
    for alloc_id, firm_id, kg_quota, _issue_date in allocs:
        firm_allocs[firm_id].append((alloc_id, kg_quota))

    # 2. Get total usage per firm (approved records only)
    usage_rows = (
        QuotaUsageRecord.objects
        .filter(product_type=product_type, status='approved')
        .values('export_firm_id')
        .annotate(total=Coalesce(Sum('kg_used'), Decimal('0')))
    )
    firm_usage: dict[int, Decimal] = {r['export_firm_id']: r['total'] for r in usage_rows}

    # 3. FIFO walk: oldest allocation consumed first
    result: dict[int, Decimal] = {}
    for firm_id, ordered_allocs in firm_allocs.items():
        remaining = firm_usage.get(firm_id, Decimal('0'))
        for alloc_id, kg_quota in ordered_allocs:
            consumed = min(kg_quota, remaining)
            result[alloc_id] = consumed
            remaining -= consumed

    cache.set(cache_key, result, FIFO_CACHE_TTL)
    return result
