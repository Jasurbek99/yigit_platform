"""Assign Season to rows whose season FK is nullable and NULL.

Contract.season, WeeklyLocalSellPlan.season, and QuotaIssuance.season are
null=True. `filter(season=X)` silently drops NULLs, so an unassigned row would
disappear from every view once season scoping lands (Contract,
WeeklyLocalSellPlan) or stay unfrozen after a close (QuotaIssuance — D10; its
FK is write-freeze-only, never a read-scope filter, but the freeze needs it
populated the same way). This assigns them by date and *reports* — never
silently drops — the rows it cannot match.

    python manage.py backfill_season_fks --dry-run
    python manage.py backfill_season_fks
"""
import datetime

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.core.models import Season

BATCH_SIZE = 500


def _iso_week_monday(year: int, week: int) -> datetime.date:
    """Monday of ISO week `week` in `year`."""
    return datetime.date.fromisocalendar(year, week, 1)


class Command(BaseCommand):
    help = 'Backfill NULL season FKs on Contract, WeeklyLocalSellPlan, and QuotaIssuance.'

    def add_arguments(self, parser) -> None:
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **options) -> None:
        dry_run: bool = options['dry_run']
        seasons = list(Season.objects.order_by('start_date'))

        total_updated = 0
        unmatched: list[str] = []

        total_updated += self._backfill_local_sell_plans(seasons, dry_run, unmatched)
        total_updated += self._backfill_contracts(seasons, dry_run, unmatched)
        total_updated += self._backfill_quota_issuances(seasons, dry_run, unmatched)

        prefix = '[dry-run] ' if dry_run else ''
        self.stdout.write(f'{prefix}{total_updated} updated')
        if unmatched:
            self.stdout.write(
                self.style.WARNING(
                    f'{len(unmatched)} unmatched rows need manual assignment: '
                    + ', '.join(unmatched)
                )
            )

    @staticmethod
    def _season_for(seasons: list[Season], day: datetime.date | None) -> Season | None:
        if day is None:
            return None
        for season in seasons:
            if season.start_date <= day <= season.end_date:
                return season
        return None

    def _backfill_local_sell_plans(
        self, seasons: list[Season], dry_run: bool, unmatched: list[str]
    ) -> int:
        from apps.export.models import WeeklyLocalSellPlan

        rows = list(WeeklyLocalSellPlan.objects.filter(season__isnull=True))
        to_update = []
        for row in rows:
            try:
                day = _iso_week_monday(row.year, row.week_number)
            except ValueError:
                day = None
            season = self._season_for(seasons, day)
            if season is None:
                unmatched.append(f'WeeklyLocalSellPlan#{row.pk}')
                continue
            row.season = season
            to_update.append(row)

        if to_update and not dry_run:
            with transaction.atomic():
                WeeklyLocalSellPlan.objects.bulk_update(
                    to_update, ['season'], batch_size=BATCH_SIZE
                )
        return len(to_update)

    def _backfill_contracts(
        self, seasons: list[Season], dry_run: bool, unmatched: list[str]
    ) -> int:
        # Function-local import: export/ may not import contracts/ at module
        # level (dependency direction is export -> contracts). This keeps the
        # module-level import graph of export/ clean while still letting this
        # management command touch Contract.
        from apps.contracts.models import Contract

        rows = list(Contract.objects.filter(season__isnull=True))
        to_update = []
        for row in rows:
            # Contract has no `contract_date` field. `start_date` is the only
            # populated date field (`end_date` is always NULL in production
            # data) and matches the season every already-assigned Contract
            # row falls into. See task-4-report.md for the verification query.
            season = self._season_for(seasons, row.start_date)
            if season is None:
                unmatched.append(f'Contract#{row.pk}')
                continue
            row.season = season
            to_update.append(row)

        if to_update and not dry_run:
            with transaction.atomic():
                Contract.objects.bulk_update(
                    to_update, ['season'], batch_size=BATCH_SIZE
                )
        return len(to_update)

    def _backfill_quota_issuances(
        self, seasons: list[Season], dry_run: bool, unmatched: list[str]
    ) -> int:
        """Backfill QuotaIssuance.season by issue_date (D10 — freeze anchor only)."""
        from apps.export.models import QuotaIssuance

        rows = list(QuotaIssuance.objects.filter(season__isnull=True))
        to_update = []
        for row in rows:
            season = self._season_for(seasons, row.issue_date)
            if season is None:
                unmatched.append(f'QuotaIssuance#{row.pk}')
                continue
            row.season = season
            to_update.append(row)

        if to_update and not dry_run:
            with transaction.atomic():
                QuotaIssuance.objects.bulk_update(
                    to_update, ['season'], batch_size=BATCH_SIZE
                )
        return len(to_update)
