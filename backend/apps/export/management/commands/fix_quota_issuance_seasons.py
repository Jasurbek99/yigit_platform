"""Re-stamp QuotaIssuance.season to the season its own issue_date falls in.

Third sibling of `backfill_season_fks` (fills `season IS NULL` only, never
re-points) and `fix_local_sell_plan_seasons` (repairs wrong stamps on the sell
plan). This one repairs wrong stamps on quota issuances — the `QuotaIssuance`
half of docs/FINDINGS_BACKLOG.md S1, left out of the sell-plan command by an
explicit scope decision on 2026-08-23.

Why they drift: an issuance is stamped with whatever season was ACTIVE when it
was recorded, and the new season is usually opened days after the first quota
for it arrives. Issuance #35 (HG, 1,234,000 kg, 2026-08-22) was entered on
2026-08-21 while 2025-2026 was still active, so it landed there — even though
its own date sits inside 2026-2027. Since quota never crosses a season boundary
(D11), that leaves the ACTIVE season with no quota at all and the Sheet's
firm-split gate refusing every firm, while the kg sit unusable in a season
whose issuances have all expired.

A CLOSED season is never written to, in either direction: moving a row into or
out of one would rewrite frozen history behind the season write-freeze (D10).
Such rows are skipped and named in the output.

Idempotent — a second run finds nothing. `--dry-run` prints the exact
(row, from, to) list before anything is written.

    python manage.py fix_quota_issuance_seasons --dry-run
    python manage.py fix_quota_issuance_seasons
"""
import datetime

from django.core.management.base import BaseCommand

from apps.core.models import Season
from apps.export.models import QuotaIssuance
from apps.export.services.quota_sync import invalidate_quota_caches

BATCH_SIZE = 500


class Command(BaseCommand):
    help = "Re-stamp QuotaIssuance.season to the season its issue_date falls in."

    def add_arguments(self, parser) -> None:
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **options) -> None:
        dry_run = options['dry_run']
        seasons = list(Season.objects.order_by('start_date'))
        if not seasons:
            self.stdout.write(self.style.ERROR('No seasons defined — nothing to do.'))
            return

        to_update = []
        for row in QuotaIssuance.objects.select_related('season').order_by('issue_date', 'id'):
            target = _season_for(seasons, row.issue_date)
            if target is None:
                # No season covers this date — #34 on the live DB sits in the
                # July 2026 hole between two seasons (FINDINGS_BACKLOG S2).
                # Widening a season's range is an owner decision, not this
                # command's, and guessing one would corrupt a balance.
                self.stdout.write(self.style.WARNING(
                    f'  SKIPPED #{row.pk} {row.issue_date}: no season covers that date'
                ))
                continue
            if row.season_id == target.id:
                continue
            if (row.season and row.season.closed_at) or target.closed_at:
                self.stdout.write(self.style.WARNING(
                    f'  SKIPPED #{row.pk} {row.issue_date}: '
                    f'{row.season.name if row.season else "NULL"} -> {target.name} '
                    f'crosses a CLOSED season'
                ))
                continue
            self.stdout.write(
                f'  #{row.pk} {row.issue_date} {row.product_type} '
                f'({row.total_kg:,.0f} kg) '
                f'{row.season.name if row.season else "NULL"} -> {target.name}'
            )
            row.season = target
            to_update.append(row)

        if not to_update:
            self.stdout.write(self.style.SUCCESS('Nothing to re-stamp.'))
            return

        if dry_run:
            self.stdout.write(self.style.WARNING(
                f'DRY RUN — {len(to_update)} issuance(s) would be re-stamped.'
            ))
            return

        QuotaIssuance.objects.bulk_update(to_update, ['season'], batch_size=BATCH_SIZE)
        # Both the FIFO ledger and the per-firm balances are keyed by season, so
        # the two seasons this moved kg between would serve stale numbers for up
        # to their 60s TTL — long enough to look like the command did nothing.
        invalidate_quota_caches()
        self.stdout.write(self.style.SUCCESS(f'Re-stamped {len(to_update)} issuance(s).'))


def _season_for(seasons: list[Season], day: datetime.date) -> Season | None:
    """First season whose [start_date, end_date] contains ``day``, else None."""
    for season in seasons:
        if season.start_date <= day <= season.end_date:
            return season
    return None
