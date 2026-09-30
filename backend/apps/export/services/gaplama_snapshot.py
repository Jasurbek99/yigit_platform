"""Midnight snapshot of Gaplama's starting leftover (spec 2026-09-30 §5).

Freezes each active block's starting carry-in into HarvestDayEntry.yesterday_rest_value,
computed by build_gaplama_board itself, so the stored number and the screen never use two
formulas. Only EMPTY fields are written: a hand-typed value is never overwritten, and a
rerun or a duplicate beat changes nothing. The last CATCH_UP_DAYS days are covered too,
oldest first (each day's carry-in depends on the day before), so a missed night heals.
Written straight to the field, not through upsert_daily_board: no person is stamped as
author and no audit entry is written — that is how the harvest-board tells an automatic
value from a hand-typed one.
"""
import logging
from datetime import date, timedelta

from apps.core.seasons import get_active_season
from apps.export.services.gaplama import build_gaplama_board
from apps.greenhouse.services import get_or_create_day_entry

logger = logging.getLogger(__name__)

CATCH_UP_DAYS = 3


def snapshot_gaplama_leftovers(today: date) -> int:
    """Store the starting leftover for today and the CATCH_UP_DAYS days before, where empty.

    Returns:
        How many HarvestDayEntry fields were written.
    """
    season = get_active_season()
    if season is None:
        logger.info('Gaplama leftover snapshot skipped: no active season.')
        return 0

    written = 0
    for offset in range(CATCH_UP_DAYS, -1, -1):
        day = today - timedelta(days=offset)
        # get_or_create_day_entry refuses dates outside the active season.
        if not (season.start_date <= day <= season.end_date):
            continue
        board = build_gaplama_board(day, day, season)
        for row in board['days']:
            entry = get_or_create_day_entry(row['block_id'], day)
            if entry.yesterday_rest_value is not None:
                continue
            entry.yesterday_rest_value = row['carried_in_kg']
            entry.save(update_fields=['yesterday_rest_value'])
            written += 1

    logger.info('Gaplama leftover snapshot for %s: %d field(s) written.', today, written)
    return written
