"""Re-stamp WeeklyLocalSellPlan.season to the season its own ISO week falls in.

Sibling of `backfill_season_fks`, and NOT a replacement for it: that command only
fills rows where `season IS NULL` and will never touch a row that already points
somewhere. This one repairs rows that point at the WRONG season.

Why they exist: `weekly_local_sell_plans` is UNIQUE (export_firm_id,
week_number, year) with no season in the key, so the season FK is a second,
unenforced copy of a fact the (year, week) pair already determines — and it
drifts. Rows written while an older season was the active one keep pointing at
it after a newer season opens, and the season-scoped list then hides them: on
2026-08-23 every W34/2026 row carried season 2025-2026 while the active season
was 2026-2027, so the sell-plan grid was empty and `initialize-week` could not
refill it (the unique constraint forbids a second copy of the week).

Scope is deliberately ONE model (owner decision, 2026-08-23). `QuotaIssuance`
and `WeeklyTruckAllocation` carry the same drift and are recorded in
docs/FINDINGS_BACKLOG.md instead of being swept in here.

Idempotent — a second run finds nothing. Reversible: `--dry-run` prints the
exact (row, from, to) list before anything is written.

    python manage.py fix_local_sell_plan_seasons --dry-run
    python manage.py fix_local_sell_plan_seasons
"""
import datetime
from collections import Counter

from django.core.management.base import BaseCommand

from apps.core.models import Season
from apps.export.models import WeeklyLocalSellPlan

BATCH_SIZE = 500


class Command(BaseCommand):
    help = "Re-stamp WeeklyLocalSellPlan.season to the season its ISO week falls in."

    def add_arguments(self, parser) -> None:
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **options) -> None:
        dry_run = options['dry_run']
        seasons = list(Season.objects.order_by('start_date'))
        if not seasons:
            self.stdout.write(self.style.ERROR('No seasons defined — nothing to do.'))
            return

        to_update, gaps = [], Counter()
        for row in WeeklyLocalSellPlan.objects.select_related('season'):
            monday = _iso_week_monday(row.year, row.week_number)
            target = _season_for(seasons, monday)
            if target is None:
                # No season covers this week. Widening a season's date range is
                # an owner decision, not this command's — leave it alone and
                # report it (see docs/FINDINGS_BACKLOG.md).
                gaps[(row.year, row.week_number)] += 1
                continue
            if row.season_id == target.id:
                continue
            self.stdout.write(
                f'  #{row.pk} W{row.week_number}/{row.year} ({row.status}) '
                f'{row.season.name if row.season else "NULL"} -> {target.name}'
            )
            row.season = target
            to_update.append(row)

        for (year, week), n in sorted(gaps.items()):
            self.stdout.write(self.style.WARNING(
                f'  SKIPPED W{week}/{year}: {n} row(s) — no season covers that week'
            ))

        if not to_update:
            self.stdout.write(self.style.SUCCESS('Nothing to re-stamp.'))
            return

        if dry_run:
            self.stdout.write(self.style.WARNING(
                f'DRY RUN — {len(to_update)} row(s) would be re-stamped.'
            ))
            return

        WeeklyLocalSellPlan.objects.bulk_update(to_update, ['season'], batch_size=BATCH_SIZE)
        self.stdout.write(self.style.SUCCESS(f'Re-stamped {len(to_update)} row(s).'))


def _iso_week_monday(year: int, week: int) -> datetime.date:
    """Monday of the given ISO week. Mirrors `backfill_season_fks`'s anchor."""
    return datetime.date.fromisocalendar(year, week, 1)


def _season_for(seasons: list[Season], day: datetime.date) -> Season | None:
    """First season whose [start_date, end_date] contains ``day``, else None."""
    for season in seasons:
        if season.start_date <= day <= season.end_date:
            return season
    return None
