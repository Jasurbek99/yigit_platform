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
    plus the seven Mon–Sun HarvestDayEntry rows under each plan.

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
        ).select_related('season', 'block', 'entered_by')
    )

    # Backfill Mon–Sun day-entries for any plan missing them.
    plan_ids = [p.id for p in plans]
    existing_entry_keys = set(
        HarvestDayEntry.objects.filter(weekly_plan_id__in=plan_ids)
        .values_list('weekly_plan_id', 'entry_date')
    )
    monday = datetime.date.fromisocalendar(year, week_number, 1)
    week_dates = [(monday + datetime.timedelta(days=i), i) for i in range(7)]  # Mon..Sun

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


def get_or_create_day_entry(block_id: int, entry_date: datetime.date) -> HarvestDayEntry:
    """Get or create the (WeeklyHarvestPlan, HarvestDayEntry) container for one
    block/date, always targeting the ACTIVE season — never a browsed one.

    Backs the create-on-write grid: the first value someone types into a cell
    that has no row yet creates its container here, then the caller dispatches
    the actual value write to set_plan_value/set_forecast_value/set_actual_value
    exactly as a PATCH on an existing row would. A row created this way is
    indistinguishable from one `initialize_harvest_week` (the cron backfill)
    would have created — same weekday derivation, same season, same
    `entered_by=NULL` "system-created" container semantics; only the eventual
    HarvestDayEntry value writes carry a real user's attribution.

    Args:
        block_id: PK of an active, top-level GreenhouseBlock (sub-blocks are
            not part of the weekly grid, matching initialize_harvest_week's
            own block universe).
        entry_date: Local calendar date the cell covers.

    Returns:
        The existing or newly created HarvestDayEntry.

    Raises:
        SeasonClosedError: entry_date falls within a season that is closed.
        ValueError: no active season is configured; entry_date falls outside
            the active season's date range (and inside no closed season
            either); or block_id does not resolve to an active top-level block.
    """
    from apps.core.models import GreenhouseBlock, Season
    from apps.core.seasons import assert_season_open, get_active_season

    season = get_active_season()
    if season is None:
        raise ValueError('No active season configured.')

    if not (season.start_date <= entry_date <= season.end_date):
        # entry_date doesn't belong to the write target — if it belongs to a
        # CLOSED season instead, surface the real write-freeze error (409)
        # rather than silently stamping a cross-season row under the active
        # season's key.
        owning_season = Season.objects.filter(
            start_date__lte=entry_date, end_date__gte=entry_date,
        ).first()
        if owning_season is not None:
            assert_season_open(owning_season)
        raise ValueError(
            f'entry_date {entry_date.isoformat()} does not fall within the '
            f"active season {season.name!r} ({season.start_date}..{season.end_date})."
        )

    try:
        block = GreenhouseBlock.objects.get(
            pk=block_id, is_active=True, parent__isnull=True,
        )
    except (GreenhouseBlock.DoesNotExist, ValueError, TypeError) as exc:
        raise ValueError(f'Unknown or inactive block id {block_id!r}.') from exc

    iso_year, iso_week, iso_weekday = entry_date.isocalendar()
    weekday = iso_weekday - 1  # isocalendar(): 1=Mon..7=Sun; model: 0=Mon..6=Sun

    with transaction.atomic():
        plan, _ = WeeklyHarvestPlan.objects.get_or_create(
            season=season, block=block, week_number=iso_week, year=iso_year,
            defaults={'entered_by': None},
        )
        entry, _ = HarvestDayEntry.objects.get_or_create(
            weekly_plan=plan, entry_date=entry_date,
            defaults={'season': season, 'block': block, 'weekday': weekday},
        )
    return entry


def initialize_upcoming_weeks(today=None, user=None) -> list[tuple[int, int]]:
    """Idempotently initialize the current and next ISO week for the active season.

    Ensures every active top-level block has a WeeklyHarvestPlan plus its seven
    Mon–Sun HarvestDayEntry rows for both weeks, so block managers always open a
    complete grid instead of one missing the blocks an admin never initialized.
    Designed to run on a cron cadence — initialize_harvest_week only inserts the
    rows that are missing, so this is a cheap no-op once a week is set up.

    Args:
        today: Local date used to derive the current ISO week. Defaults to
            datetime.date.today(); cron callers should pass the greenhouse local
            date so the week boundary matches the operators' timezone.
        user: Actor stamped as entered_by on newly created plans (None = system).

    Returns:
        The (iso_year, iso_week) pairs processed — empty if no active season.
    """
    from apps.greenhouse.services.daily_board import get_active_season

    season = get_active_season()
    if season is None:
        logger.info('initialize_upcoming_weeks: no active season — skipped.')
        return []

    if today is None:
        today = datetime.date.today()

    this_iso = today.isocalendar()
    next_iso = (today + datetime.timedelta(days=7)).isocalendar()
    weeks = [(this_iso.year, this_iso.week), (next_iso.year, next_iso.week)]

    for iso_year, iso_week in weeks:
        initialize_harvest_week(season.id, iso_week, iso_year, user)

    logger.info(
        'initialize_upcoming_weeks: ensured weeks %s for season %s.',
        weeks, season.id,
    )
    return weeks


def get_block_summary(year: int, week: int, season_id: int | None = None) -> list[dict]:
    """Compute per-block aggregate totals for a given week from HarvestDayEntry.

    Returns sorted list of dicts with block_id, block_code, block_name,
    total_plan_kg, total_actual_kg, deficit_kg, and on_time/late/critical_late counts.
    """
    # Derive the Monday of the target ISO week
    try:
        week_start = datetime.date.fromisocalendar(year, week, 1)
        week_end = datetime.date.fromisocalendar(year, week, 7)  # Sunday
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
