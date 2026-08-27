"""Quota dashboard analytics — business logic extracted from views.

All functions are pure computation or DB queries; no HTTP/request handling.
"""

__all__ = [
    'build_quota_dashboard',
    'compute_fifo_usage',
    'compute_firm_quota_balances',
    'compute_firm_quota_summary',
    'fetch_plan_rows',
    'fetch_issuances',
    'aggregate_local_sales',
    'aggregate_quota_issued',
    'aggregate_quota_used',
    'aggregate_quota_expired',
    'assert_usage_batch_seasons_open',
    'quota_expiry_date',
    'season_of_usage',
    'usage_season_q',
]
import calendar
import datetime
from decimal import Decimal

from django.core.cache import cache
from django.db.models import Q, QuerySet, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone
from django.utils import timezone

from collections import defaultdict

from apps.core.models import ExportFirm, Season
from apps.core.seasons import SeasonClosedError
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


def usage_season_q(season) -> Q:
    """Which `QuotaUsageRecord` rows belong to `season` (D11, spec §4.7).

    `QuotaUsageRecord` has **no** `season` FK and **no** `issuance` FK — the spec
    text assumed the latter, but the model carries only `usage_date` (non-null)
    and a nullable `shipment`. So the anchor is derived from the two signals that
    do exist, in order of authority:

      1. `shipment.season` when the row is linked. D11 says a shipment draws on
         *its own* season's quota, so the shipment is authoritative even when the
         row's `usage_date` falls outside that season's calendar range — which
         happens for real: 7 rows on the dev DB are dated July 2026 against
         shipments in a season that ended 2026-06-30.
      2. `usage_date` inside `[season.start_date, season.end_date]` for the 575
         unlinked rows (historical Excel imports), which reach a season through
         nothing else.

    Deliberately NOT a stored `season` FK. A column would be the more auditable
    anchor and the backfill is 100% resolvable on today's data (711/711 → the
    2025-2026 season), but it would require migrating and rewriting the live
    database this ruling was raised against, and every one of the three creation
    sites would have to stamp it or `freeze_season_of()` — which reads
    `obj.season` *before* `obj.shipment.season` — would silently read an unstamped
    closed-season row as open, loosening the write freeze. Deriving it keeps the
    freeze anchor exactly where it is.

    Known gap, accepted: an unlinked row whose `usage_date` falls in the gap
    between two seasons belongs to no season and is invisible. Zero such rows
    exist today (verified against the dev DB); the same gap is what makes
    QuotaIssuance#34 invisible.
    """
    return (
        Q(shipment__season=season)
        | Q(
            shipment__isnull=True,
            usage_date__gte=season.start_date,
            usage_date__lte=season.end_date,
        )
    )


def assert_usage_batch_seasons_open(queryset: QuerySet) -> None:
    """Guard for a bulk usage write that selects rows by a raw id list (D1).

    The generic `assert_bulk_seasons_open(qs, 'shipment__season')` cannot hold
    here: `shipment` is NULL on 575 of 711 rows, so that subquery matches no
    Season and every unlinked row — including one inside a closed season —
    passed. This applies `usage_season_q()`, the same predicate the read scope
    and the FIFO ledger use, so a row a closed season lists is a row it freezes.

    It SUBSUMES the generic call rather than supplementing it: `usage_season_q()`
    already contains `Q(shipment__season=season)`.

    One query per closed season, not one overall. Closed seasons are a handful
    (one per year) and the alternative — a correlated `Exists` over the date
    range — would be a second expression of the anchor rule, which is the exact
    drift `usage_season_q()`/`season_of_usage()` exist to prevent.

    Args:
        queryset: The usage rows about to be mutated.

    Raises:
        SeasonClosedError: If any row belongs to a closed season. The whole
            batch is rejected — a partially-applied bulk write against a frozen
            season is worse than a rejected one.
    """
    # Ordered by pk so the 409 body names the same season every time when more
    # than one closed season holds a row from the batch.
    for season in Season.objects.filter(closed_at__isnull=False).order_by('pk'):
        # .order_by() strips Meta.ordering — MSSQL rejects ORDER BY inside the
        # EXISTS subquery this compiles to (see .claude/rules/mssql-compat.md).
        if queryset.order_by().filter(usage_season_q(season)).exists():
            raise SeasonClosedError(season)


def season_of_usage(shipment, usage_date):
    """The single season a usage row belongs to — the row-level inverse of
    `usage_season_q()`.

    The two MUST stay in step: `usage_season_q()` decides which rows a season's
    queries return, and this decides which season a row is about to be written
    into. If they disagree, a write can be accepted into a season whose list
    then refuses to show it.

    Args:
        shipment: The row's `Shipment`, or None for an unlinked row.
        usage_date: The row's `usage_date`.

    Returns:
        The Season, or None when the row would belong to none — which is only
        reachable for an unlinked row whose date falls outside every season
        (`Shipment.season` is non-null, so a linked row always resolves).
        Callers must reject a None: such a row is invisible on every list and
        counted in no ledger.
    """
    from apps.core.models import Season

    if shipment is not None:
        return shipment.season
    if usage_date is None:
        return None
    return Season.objects.filter(
        start_date__lte=usage_date, end_date__gte=usage_date,
    ).order_by('start_date').first()


def aggregate_quota_used(
    date_from: datetime.date,
    date_to: datetime.date,
    product_type: str | None = None,
) -> dict[int, Decimal]:
    """Sum approved quota usage per firm in the date range.

    Source: QuotaUsageRecord with status='approved'.
    Only approved records count — draft records are pending review.
    counted() drops rows tied to soft-deleted / cancelled shipments — the kg
    is released back to the firm until the shipment is restored.

    `product_type` is OPTIONAL and defaults to no filter, which is what the
    `used_kg` KPI has always published — tomato and pepper usage summed
    together. Narrowing that KPI would change a published number and needs its
    own ruling. Pass it wherever the total is consumed *against* product-scoped
    allocations (`aggregate_quota_expired`), or one product's usage draws down
    the other's quota.
    """
    usage_rows = (
        QuotaUsageRecord.objects
        .counted()
        .filter(usage_date__gte=date_from, usage_date__lte=date_to, status='approved')
    )
    if product_type is not None:
        usage_rows = usage_rows.filter(product_type=product_type)
    usage_rows = (
        usage_rows
        .values('export_firm_id')
        .annotate(total=Coalesce(Sum('kg_used'), Decimal('0')))
    )
    return {row['export_firm_id']: row['total'] for row in usage_rows}


def quota_expiry_date(
    issue_date: datetime.date, validity: str,
) -> datetime.date:
    """Last day an issuance's quota may still be used.

    Port of `computeExpiry()` in `QuotaIssuancesList.helpers.ts` — the two MUST
    stay in step, or the issuance list and the dashboard disagree about which
    quota has lapsed. `next_month` and `this_and_next` share an expiry (end of
    the following month); they differ only in when the quota *starts*.
    """
    months_ahead = 1 if validity in ('this_and_next', 'next_month') else 0
    year, month = issue_date.year, issue_date.month + months_ahead
    if month > 12:
        year, month = year + 1, month - 12
    return datetime.date(year, month, calendar.monthrange(year, month)[1])


def _fifo_consume(
    firm_allocs: dict[int, list[tuple[int, Decimal]]],
    firm_usage: dict[int, Decimal],
) -> dict[int, Decimal]:
    """Walk each firm's usage across its own allocations, oldest first.

    The single FIFO implementation: `compute_fifo_usage()` runs it season-scoped
    for the issuance ledger, `aggregate_quota_expired()` runs it window-scoped
    for the firm breakdown. Two separate walks would let the Issuances tab and
    the dashboard disagree about which allocation a kg was spent from — and the
    expired remainder is exactly that disagreement made visible.

    Args:
        firm_allocs: firm_id → [(allocation_id, kg_quota)], OLDEST FIRST.
        firm_usage: firm_id → kg that firm consumed in the same scope.

    Returns:
        allocation_id → kg consumed from it (Decimal('0') when untouched).
    """
    consumed_per_alloc: dict[int, Decimal] = {}
    for firm_id, ordered_allocs in firm_allocs.items():
        remaining = firm_usage.get(firm_id, Decimal('0'))
        for alloc_id, kg_quota in ordered_allocs:
            consumed = min(kg_quota, remaining)
            consumed_per_alloc[alloc_id] = consumed
            remaining -= consumed
    return consumed_per_alloc


def _allocs_by_firm(
    issuances: list, today: datetime.date,
) -> tuple[dict[int, list[tuple[int, Decimal]]], set[int]]:
    """Flatten issuances into per-firm allocation lists plus the lapsed ids.

    `fetch_issuances()` already orders by issue_date, which IS the FIFO order;
    ties break on allocation id so the walk is deterministic across requests.
    """
    firm_allocs: dict[int, list[tuple[int, Decimal]]] = defaultdict(list)
    lapsed: set[int] = set()
    for issuance in issuances:
        has_lapsed = quota_expiry_date(issuance.issue_date, issuance.validity) < today
        for alloc in sorted(issuance.allocations.all(), key=lambda a: a.id):
            firm_allocs[alloc.export_firm_id].append((alloc.id, alloc.kg_quota))
            if has_lapsed:
                lapsed.add(alloc.id)
    return firm_allocs, lapsed


def aggregate_quota_expired(
    issuances: list, today: datetime.date, firm_usage: dict[int, Decimal],
) -> dict[int, Decimal]:
    """Sum the UNUSED remainder per firm from issuances that have lapsed.

    Reads the SAME `issuances` list `build_weekly_flow` consumes, so the expiry
    column shares one anchor — the season-clamped date window — with sales /
    issued / used. Until 2026-08-23 the browser computed this from its own
    `/quota-issuances/` fetch scoped to the **global** season switcher while the
    rest of the row followed the page's own season dropdown, so the two halves
    of a row could describe different seasons.

    **Remainder, not the full allocation (2026-08-23).** The column is labelled
    *expired unused*; until this change it summed every kg of a lapsed
    allocation, used or not, so quota that had done its job counted as waste.
    WHICH kg were used is a FIFO question — a firm's usage draws down its oldest
    allocation first — so the remainder comes from `_fifo_consume()`, the same
    walk behind the Issuances tab's `used_kg`. The published figure therefore
    DROPS wherever quota was consumed before lapsing; that is the fix, not
    missing data.

    `firm_usage` MUST be scoped like the allocations it is consumed against —
    same date window AND same product_type — or pepper usage eats tomato quota.
    """
    firm_allocs, lapsed = _allocs_by_firm(issuances, today)
    consumed = _fifo_consume(firm_allocs, firm_usage)

    totals: dict[int, Decimal] = {}
    for firm_id, allocs in firm_allocs.items():
        for alloc_id, kg_quota in allocs:
            if alloc_id not in lapsed:
                continue
            unused = kg_quota - consumed.get(alloc_id, Decimal('0'))
            if unused > 0:
                totals[firm_id] = totals.get(firm_id, Decimal('0')) + unused
    return totals


# ---------------------------------------------------------------------------
# KPI computation
# ---------------------------------------------------------------------------

def _compute_kpis(
    local_sales: dict[int, Decimal],
    quota_issued: dict[int, Decimal],
    quota_used: dict[int, Decimal],
    quota_expired: dict[int, Decimal] | None = None,
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
        'expired_kg': sum((quota_expired or {}).values(), Decimal('0')),
    }


def _build_per_firm(
    all_firm_ids: set[int],
    local_sales: dict[int, Decimal],
    quota_issued: dict[int, Decimal],
    quota_used: dict[int, Decimal],
    firm_names: dict[int, str],
    quota_expired: dict[int, Decimal] | None = None,
) -> list[dict]:
    """Build per-firm breakdown rows."""
    quota_expired = quota_expired or {}
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
            'expired_kg': quota_expired.get(firm_id, Decimal('0')),
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
    today: datetime.date | None = None,
) -> dict:
    """Build the full quota dashboard response.

    Every figure here — sales, issued, used AND expired — is anchored on the
    same `[date_from, date_to]` window, which `QuotaDashboardView` clamps to the
    resolved season. That single anchor is what keeps one season's numbers out
    of another's breakdown; do not add a second one.

    Args:
        date_from: Start of analysis period.
        date_to: End of analysis period.
        product_type: Product type filter (e.g. 'tomato').
        today: Reference date for expiry, defaults to the local date. A
            parameter so tests can pin it — expiry is the one figure that moves
            on its own with the calendar.

    Returns:
        Dict with keys: kpis, per_firm, weekly_flow.
    """

    plan_rows = fetch_plan_rows(date_from, date_to)
    local_sales = aggregate_local_sales(plan_rows)
    quota_issued = aggregate_quota_issued(date_from, date_to, product_type)
    quota_used = aggregate_quota_used(date_from, date_to)
    issuances = fetch_issuances(date_from, date_to, product_type)
    # Second, product-scoped usage read: the expiry FIFO consumes these kg
    # against THIS product's allocations, while `quota_used` above keeps the
    # KPI's historical product-agnostic definition (see aggregate_quota_used).
    quota_expired = aggregate_quota_expired(
        issuances,
        today or timezone.localdate(),
        aggregate_quota_used(date_from, date_to, product_type=product_type),
    )

    all_firm_ids = set(local_sales.keys()) | set(quota_issued.keys()) | set(quota_used.keys())

    firm_names: dict[int, str] = {
        f.id: (f.name_en or f.name_tk or str(f.id))
        for f in ExportFirm.objects.filter(id__in=all_firm_ids).only('id', 'name_en', 'name_tk')
    }

    return {
        'kpis': _compute_kpis(local_sales, quota_issued, quota_used, quota_expired),
        'per_firm': _build_per_firm(
            all_firm_ids, local_sales, quota_issued, quota_used, firm_names, quota_expired,
        ),
        'weekly_flow': build_weekly_flow(plan_rows, issuances, firm_names),
    }


def empty_quota_dashboard() -> dict:
    """The dashboard payload for "no season resolved" (D7 fail-closed).

    Returned during the close→open gap, when there is no season to report on
    and returning the last one's numbers would hand every authenticated user
    the aggregates the close just hid. The response *shape* is identical to
    `build_quota_dashboard()`'s so the page renders its normal empty states
    rather than an error banner — the same call `dashboard_summary` makes with
    `_empty_summary()`.

    Touches no table: `_compute_kpis` is pure arithmetic over three empty maps.
    """
    return {
        'kpis': _compute_kpis({}, {}, {}),
        'per_firm': [],
        'weekly_flow': [],
    }


# ---------------------------------------------------------------------------
# Per-firm balance (firm-split editor no-quota gate)
# ---------------------------------------------------------------------------

def compute_firm_quota_balances(
    product_type: str, season, today: datetime.date | None = None,
) -> dict[int, dict]:
    """Per-firm quota that is still LIVE today (unexpired issued − committed).

    Powers the firm-split editor's "no quota" gate: a firm whose
    ``remaining_kg`` is <= 0 (including firms absent from the result, which have
    no allocation at all) cannot be added to a split. The gate is a **hard
    block**, not a warning — `SheetCellEditor` disables the option and
    `ShipmentViewSet.firm_splits` 400s on a newly-added firm (firms already on
    the split are exempt there, so existing splits stay editable).

    **Expiry IS applied (2026-08-23).** Until this change the balance was every
    kg issued in the season minus every kg committed, so a firm kept "having
    quota" months after its issuance's ``validity`` window lapsed — the sheet
    offered ~20 firms when only one held live quota. Lapsed allocations are now
    dropped from both ``issued_kg`` and ``used_kg`` via the same
    `quota_expiry_date` / `_allocs_by_firm` pair the dashboard's expired column
    uses; keeping two expiry rules would let the two screens disagree.

    **FIFO charges usage to the OLDEST allocation, lapsed ones included.**
    `_fifo_consume` walks every allocation the firm holds this season, so kg
    spent in August are drawn from a June allocation first and the live August
    quota reads as untouched — ``remaining_kg`` is optimistic by that much.
    That is deliberate: the alternative (walking live allocations only) would
    count the same kg twice, once as consuming live quota here and once as
    expired-unused in `aggregate_quota_expired`.

    ``used_kg`` here is **committed** quota = draft + approved usage, NOT
    approved-only. This is deliberate and differs from the dashboard (which
    reports *approved* consumption): assigning firm splits auto-creates *draft*
    QuotaUsageRecord rows that stay draft until document_team approves, so at
    assignment time the drafts are the live commitment. Counting approved-only
    would let a firm be over-committed across many trucks without warning until
    approval — i.e. after the assignment decisions are already made. We still
    drop rows tied to soft-deleted / cancelled shipments via ``.counted()``.

    Scope (D11): quota never crosses a season boundary. The issuance side
    anchors on ``QuotaIssuance.season`` and the usage side on
    ``usage_season_q()`` — both FK-driven where an FK exists, rather than the
    date ranges this used before. The two differ in practice: an issuance dated
    outside its own season's calendar range still counts for the season it was
    stamped with, and a usage row whose ``usage_date`` sits outside its
    shipment's season still counts for that shipment's season.

    Callers pass the season explicitly rather than this reaching for
    ``get_active_season()``: the read scope is per-request (``?season=``), so a
    user browsing a prior season must see that season's balances, not the write
    target's. ``None`` is the close→open gap and returns ``{}`` (fail closed).

    Args:
        product_type: 'tomato' or 'pepper'.
        season: The resolved season, or None.
        today: Reference date for expiry, defaults to the local date — same
            source as `build_quota_dashboard`, so the sheet gate and the
            dashboard's expired column flip on the same day.

    Returns:
        Dict mapping export_firm_id → {issued_kg, used_kg, remaining_kg,
        active_issuance_count, nearest_expiry}. The three kg figures and the
        count all consider live (unexpired) allocations only; `nearest_expiry`
        is the earliest expiry (ISO date string) among the allocations the firm
        can still spend from, or None when it holds none. Empty dict when
        `season` is None.

        `active_issuance_count` and `nearest_expiry` were added for the
        dashboard's Firm Quota tab and also surface on
        `GET /quota-firm-balances/`; that endpoint's consumer, the firm-split
        gate, reads `remaining_kg` only and ignores them.
    """
    if not season:
        return {}

    today = today or timezone.localdate()

    # `id` in the ordering, not just `issue_date`: several issuances may share a
    # date (three do on 2026-06-02), and without the tie-break the FIFO order is
    # whatever the database happens to return.
    issuances = list(
        QuotaIssuance.objects
        .filter(product_type=product_type, season=season)
        .order_by('issue_date', 'id')
        .prefetch_related('allocations')
    )
    firm_allocs, lapsed = _allocs_by_firm(issuances, today)

    # Per-allocation expiry, from the SAME `quota_expiry_date()` call
    # `_allocs_by_firm` makes to decide `lapsed` — one expiry rule, so the
    # "nearest expiry" a firm shows can never contradict the live/lapsed split
    # its own row is built from.
    expiry_by_alloc: dict[int, datetime.date] = {
        alloc.id: quota_expiry_date(issuance.issue_date, issuance.validity)
        for issuance in issuances
        for alloc in issuance.allocations.all()
    }

    # Committed = draft + approved (no status filter) — see docstring.
    used_rows = (
        QuotaUsageRecord.objects
        .counted()
        .filter(usage_season_q(season), product_type=product_type)
        .values('export_firm_id')
        .annotate(total=Coalesce(Sum('kg_used'), Decimal('0')))
    )
    used = {row['export_firm_id']: row['total'] for row in used_rows}
    consumed = _fifo_consume(firm_allocs, used)

    balances: dict[int, dict] = {}
    for firm_id in set(firm_allocs) | set(used):
        issued_kg = Decimal('0')
        used_kg = Decimal('0')
        active_count = 0
        nearest_expiry: datetime.date | None = None
        for alloc_id, kg_quota in firm_allocs.get(firm_id, []):
            if alloc_id in lapsed:
                continue
            issued_kg += kg_quota
            alloc_used = consumed.get(alloc_id, Decimal('0'))
            used_kg += alloc_used
            # "Active" = live AND not yet fully drawn down. An allocation the
            # FIFO walk has already emptied is not quota the firm can still
            # spend, so counting it would inflate the count and — worse — let
            # an exhausted allocation raise an expiry warning about kg that no
            # longer exist.
            if kg_quota - alloc_used > 0:
                active_count += 1
                expiry = expiry_by_alloc[alloc_id]
                if nearest_expiry is None or expiry < nearest_expiry:
                    nearest_expiry = expiry
        balances[firm_id] = {
            'issued_kg': issued_kg,
            'used_kg': used_kg,
            'remaining_kg': issued_kg - used_kg,
            'active_issuance_count': active_count,
            'nearest_expiry': nearest_expiry.isoformat() if nearest_expiry else None,
        }
    return balances


def compute_firm_quota_summary(
    product_type: str, season, today: datetime.date | None = None,
) -> list[dict]:
    """Which firm holds how much quota right now — one row per export firm.

    A thin naming layer over `compute_firm_quota_balances()`: same season, same
    expiry rule, same FIFO walk, so the dashboard's Firm Quota tab and the
    firm-split hard block can never contradict each other. Anything that would
    change a number here belongs in the balance service, not in this function.

    Deliberately NOT date-windowed. Every other quota read on the dashboard is
    period-filtered; this one must not be, because quota lives roughly a month
    and a week- or month-scoped filter would hide the live balance the question
    is actually about.

    Rows are kept even when everything is zero — a firm whose allocations have
    all lapsed still belongs on the list, reading as "held quota this season,
    holds none now". Firms with neither an allocation nor a usage record this
    season never enter the map and are absent.

    Args:
        product_type: 'tomato' or 'pepper'.
        season: The resolved season, or None.
        today: Reference date for expiry; defaults to the local date.

    Returns:
        List of {export_firm, export_firm_name, issued_kg, used_kg,
        remaining_kg, active_issuance_count, nearest_expiry}, sorted by
        remaining_kg descending then firm name. Empty list when `season` is
        None (D7 fail-closed).
    """
    balances = compute_firm_quota_balances(product_type, season, today=today)
    if not balances:
        return []

    firm_names: dict[int, str] = {
        f.id: (f.name_en or f.name_tk or str(f.id))
        for f in ExportFirm.objects.filter(id__in=list(balances)).only('id', 'name_en', 'name_tk')
    }

    rows = [
        {
            'export_firm': firm_id,
            'export_firm_name': firm_names.get(firm_id, str(firm_id)),
            **vals,
        }
        for firm_id, vals in balances.items()
    ]
    rows.sort(key=lambda r: (-r['remaining_kg'], r['export_firm_name']))
    return rows


# ---------------------------------------------------------------------------
# FIFO per-allocation consumption
# ---------------------------------------------------------------------------

FIFO_CACHE_TTL = 60  # seconds — short TTL to avoid stale reads after approvals

def compute_fifo_usage(product_type: str, season) -> dict[int, Decimal]:
    """Compute FIFO per-firm quota consumption per allocation, within one season.

    For each firm: sort that season's allocations by issue_date ASC (oldest
    first), then consume that firm's total usage for the same season starting
    from the oldest allocation. Each firm's usage only consumes that firm's own
    allocations.

    **FIFO stops at the season boundary (D11, spec §4.7).** Before this ruling
    the walk had no season predicate at all, so a shipment could draw down an
    issuance from any prior season. It now cannot: leftover issuance expires
    with its season rather than carrying forward, and a season's ledger is
    computed from that season's rows only. Balances computed before this change
    are therefore not comparable with those computed after.

    Results are cached for FIFO_CACHE_TTL seconds to avoid recomputing on
    every GET request in the QuotaIssuanceViewSet list view. **The season is
    part of the cache key** — without it, switching seasons serves the previous
    season's ledger for up to the TTL, which looks exactly like the scoping not
    working. `invalidate_quota_caches()` busts every season's key.

    Args:
        product_type: 'tomato' or 'pepper'.
        season: The resolved season; None (the close→open gap) returns {}.

    Returns:
        Dict mapping allocation_id → used_kg, covering `season`'s allocations only.
    """
    if not season:
        return {}

    cache_key = f'fifo_usage:{product_type}:{season.pk}'
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    # 1. Get this season's allocations with issue_date, grouped by firm
    allocs = list(
        QuotaIssuanceFirmAllocation.objects
        .filter(issuance__product_type=product_type, issuance__season=season)
        .select_related('issuance')
        .order_by('issuance__issue_date', 'id')
        .values_list('id', 'export_firm_id', 'kg_quota', 'issuance__issue_date')
    )

    firm_allocs: dict[int, list[tuple[int, Decimal]]] = defaultdict(list)
    for alloc_id, firm_id, kg_quota, _issue_date in allocs:
        firm_allocs[firm_id].append((alloc_id, kg_quota))

    # 2. Get total usage per firm for the same season (approved records only;
    #    counted() drops rows tied to soft-deleted / cancelled shipments —
    #    released back).
    usage_rows = (
        QuotaUsageRecord.objects
        .counted()
        .filter(usage_season_q(season), product_type=product_type, status='approved')
        .values('export_firm_id')
        .annotate(total=Coalesce(Sum('kg_used'), Decimal('0')))
    )
    firm_usage: dict[int, Decimal] = {r['export_firm_id']: r['total'] for r in usage_rows}

    # 3. FIFO walk: oldest allocation consumed first
    result = _fifo_consume(firm_allocs, firm_usage)

    cache.set(cache_key, result, FIFO_CACHE_TTL)
    return result
