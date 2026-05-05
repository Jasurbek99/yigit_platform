"""Rewritten initialize_harvest_week and get_block_summary using HarvestDayEntry.

These replace the wide-column implementations in the old services.py.
Both functions still return the same interface as before so callers in views.py
are unaffected.
"""
import datetime
import logging
from decimal import Decimal

from django.db import transaction

from apps.greenhouse.models import HarvestDayEntry, WeeklyHarvestPlan

logger = logging.getLogger(__name__)


@transaction.atomic
def initialize_harvest_week(
    season_id: int, week_number: int, year: int, user,
) -> list['WeeklyHarvestPlan']:
    """Create WeeklyHarvestPlan rows for all active top-level blocks missing a plan,
    plus the six Mon–Sat HarvestDayEntry rows under each plan.

    Day-entry rows are created upfront (with NULL plan/forecast/actual) so the grid
    has editable cells; the frontend PATCHes existing entries and has no flow to
    create them on demand.

    Returns all plans for the given (season, week, year) — including pre-existing ones.
    """
    from apps.core.models import GreenhouseBlock

    active_blocks = GreenhouseBlock.objects.filter(is_active=True, parent__isnull=True)
    existing_block_ids = set(
        WeeklyHarvestPlan.objects.filter(
            season_id=season_id, week_number=week_number, year=year,
        ).values_list('block_id', flat=True)
    )

    new_plans = [
        WeeklyHarvestPlan(
            season_id=season_id, block=block,
            week_number=week_number, year=year, entered_by=user,
        )
        for block in active_blocks
        if block.id not in existing_block_ids
    ]
    if new_plans:
        WeeklyHarvestPlan.objects.bulk_create(new_plans, batch_size=500)

    plans = list(
        WeeklyHarvestPlan.objects.filter(
            season_id=season_id, week_number=week_number, year=year,
        ).select_related('season', 'block', 'entered_by', 'submitted_by')
    )

    # Backfill Mon–Sat day-entries for any plan missing them.
    plan_ids = [p.id for p in plans]
    existing_entry_keys = set(
        HarvestDayEntry.objects.filter(weekly_plan_id__in=plan_ids)
        .values_list('weekly_plan_id', 'entry_date')
    )
    monday = datetime.date.fromisocalendar(year, week_number, 1)
    week_dates = [(monday + datetime.timedelta(days=i), i) for i in range(6)]  # Mon..Sat

    new_entries = [
        HarvestDayEntry(
            weekly_plan=plan,
            season_id=season_id,
            block_id=plan.block_id,
            entry_date=entry_date,
            weekday=weekday,
        )
        for plan in plans
        for entry_date, weekday in week_dates
        if (plan.id, entry_date) not in existing_entry_keys
    ]
    if new_entries:
        HarvestDayEntry.objects.bulk_create(new_entries, batch_size=500)

    return plans


def get_block_summary(year: int, week: int, season_id: int | None = None) -> list[dict]:
    """Compute per-block aggregate totals for a given week from HarvestDayEntry.

    Returns sorted list of dicts with block_id, block_code, block_name,
    total_plan_kg, total_actual_kg, deficit_kg, and on_time/late/critical_late counts.
    """
    # Derive the Monday of the target ISO week
    try:
        week_start = datetime.date.fromisocalendar(year, week, 1)
        week_end = datetime.date.fromisocalendar(year, week, 6)  # Saturday
    except ValueError:
        return []

    qs = HarvestDayEntry.objects.filter(
        entry_date__gte=week_start,
        entry_date__lte=week_end,
    ).select_related('block')

    if season_id:
        qs = qs.filter(season_id=season_id)

    block_data: dict = {}
    for entry in qs:
        bid = entry.block_id
        if bid not in block_data:
            block_data[bid] = {
                'block_id': bid,
                'block_code': entry.block.code,
                'block_name': entry.block.name,
                'total_plan_kg': Decimal('0'),
                'total_actual_kg': None,
                '_has_actual': False,
                'on_time_count': 0,
                'late_count': 0,
                'critical_late_count': 0,
            }
        if entry.plan_value is not None:
            block_data[bid]['total_plan_kg'] += entry.plan_value
        if entry.actual_value is not None:
            if not block_data[bid]['_has_actual']:
                block_data[bid]['total_actual_kg'] = Decimal('0')
                block_data[bid]['_has_actual'] = True
            block_data[bid]['total_actual_kg'] += entry.actual_value
        if entry.plan_state == 'on_time':
            block_data[bid]['on_time_count'] += 1
        elif entry.plan_state == 'late':
            block_data[bid]['late_count'] += 1
        elif entry.plan_state == 'critical_late':
            block_data[bid]['critical_late_count'] += 1

    results = sorted(block_data.values(), key=lambda x: x['block_code'])
    for r in results:
        r.pop('_has_actual')
        r['deficit_kg'] = (
            r['total_actual_kg'] - r['total_plan_kg']
            if r['total_actual_kg'] is not None
            else None
        )
    return results
