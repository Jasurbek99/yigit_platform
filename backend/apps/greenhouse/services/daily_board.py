"""Daily harvest board service — backs the *Ýük plan we galyndy* page.

Each board row is a HarvestDayEntry for one block on a given date. The page
writes three values directly, **without** the role/window gates that govern
the Weekly Plan grid (any authenticated user with page access may edit):

- ``forecast_value``        — Bu günki meýilleşdirilýän ýygym (today's plan).
- ``yesterday_rest_value``  — Düýnki galyndy (carried-over remainder).
- ``daily_note``            — Bellik (freeform note).

Parent ``WeeklyHarvestPlan`` and ``HarvestDayEntry`` rows are created on demand
the first time a block/date cell is written, so the board works even for weeks
that were never initialised through the weekly grid.
"""
import logging
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.utils import timezone

from apps.core.models import GreenhouseBlock, Season
from apps.core.services_workflow import create_audit_entry
from apps.greenhouse.models import HarvestDayEntry, WeeklyHarvestPlan

logger = logging.getLogger(__name__)

# Sentinel distinguishing "field absent from payload" (leave as-is) from an
# explicit ``None`` (clear the value).
UNSET = object()


def get_active_season() -> Season | None:
    """Return the currently active season, or None if none is configured."""
    return Season.objects.filter(is_active=True).first()


def parse_kg(value) -> Decimal | None:
    """Coerce a board kg value to a non-negative Decimal (or None).

    Raises:
        ValueError: If the value is not a number or is negative.
    """
    if value is None or value == '':
        return None
    try:
        dec = Decimal(str(value))
    except (InvalidOperation, TypeError) as exc:
        raise ValueError('Must be a number.') from exc
    if dec < 0:
        raise ValueError('Must not be negative.')
    return dec


def _get_or_create_entry(block: GreenhouseBlock, entry_date, season: Season, user) -> HarvestDayEntry:
    """Get or create the HarvestDayEntry (and its parent plan) for block/date."""
    iso_year, iso_week, iso_weekday = entry_date.isocalendar()
    weekday = iso_weekday - 1  # isocalendar() is 1=Mon..7=Sun; model is 0=Mon..6=Sun.

    plan, _ = WeeklyHarvestPlan.objects.get_or_create(
        season=season,
        block=block,
        week_number=iso_week,
        year=iso_year,
        defaults={'entered_by': user},
    )
    entry, _ = HarvestDayEntry.objects.get_or_create(
        weekly_plan=plan,
        entry_date=entry_date,
        defaults={'season': season, 'block': block, 'weekday': weekday},
    )
    return entry


def upsert_daily_board(
    *,
    block_id: int,
    entry_date,
    today_plan=UNSET,
    yesterday_rest=UNSET,
    note=UNSET,
    user,
) -> tuple[HarvestDayEntry, GreenhouseBlock]:
    """Create or update one daily-board cell.

    Only the keys passed (not UNSET) — and only those whose value actually
    changed — are written. Returns ``(entry, block)`` so the caller can build a
    response row without re-querying the block FK.

    Raises:
        ValueError: If no active season exists, the block is unknown, or a kg
            value is invalid/negative.
    """
    season = get_active_season()
    if season is None:
        raise ValueError('No active season configured.')

    try:
        block = GreenhouseBlock.objects.get(pk=block_id, is_active=True)
    except GreenhouseBlock.DoesNotExist as exc:
        raise ValueError(f'Unknown or inactive block id {block_id}.') from exc

    now = timezone.now()
    changes: list[str] = []
    update_fields: list[str] = []

    with transaction.atomic():
        entry = _get_or_create_entry(block, entry_date, season, user)

        if today_plan is not UNSET:
            new_plan = parse_kg(today_plan)
            if new_plan != entry.forecast_value:
                old = entry.forecast_value
                # forecast_value is shared with the Weekly Plan grid — keep its
                # revision metadata correct: count a revision when an existing
                # forecast value is changed (mirrors set_forecast_value).
                if entry.forecast_value is not None and entry.forecast_submitted_at is not None:
                    entry.forecast_revision_count = (entry.forecast_revision_count or 0) + 1
                    update_fields.append('forecast_revision_count')
                entry.forecast_value = new_plan
                entry.forecast_submitted_at = now
                entry.forecast_submitted_by = user
                update_fields += ['forecast_value', 'forecast_submitted_at', 'forecast_submitted_by']
                changes.append(f'today_plan: {old!r} → {new_plan!r}')

        if yesterday_rest is not UNSET:
            new_rest = parse_kg(yesterday_rest)
            if new_rest != entry.yesterday_rest_value:
                old = entry.yesterday_rest_value
                entry.yesterday_rest_value = new_rest
                update_fields.append('yesterday_rest_value')
                changes.append(f'yesterday_rest: {old!r} → {new_rest!r}')

        if note is not UNSET:
            new_note = (note or '').strip()
            if new_note != entry.daily_note:
                entry.daily_note = new_note
                update_fields.append('daily_note')
                changes.append('note updated')

        if not update_fields:
            # Nothing actually changed — idempotent no-op, no audit stamp.
            return entry, block

        entry.daily_entered_at = now
        entry.daily_entered_by = user
        update_fields += ['daily_entered_at', 'daily_entered_by']
        entry.save(update_fields=update_fields)

        create_audit_entry(
            user, 'daily_board_set', 'HarvestDayEntry',
            entry.id, str(entry), ' | '.join(changes),
        )

    logger.info(
        'Daily board entry %d (block=%s date=%s) updated by %s: %s',
        entry.id, block.code, entry_date, user.username, ' | '.join(changes),
    )
    return entry, block
