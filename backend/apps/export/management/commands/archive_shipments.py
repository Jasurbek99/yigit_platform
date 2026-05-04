"""Daily cron: flip terminal-status shipments older than N days to is_archived=True.

Operational ↔ Archive split per ADR-0005. The ShipmentList default view
filters ``is_archived=False``; once flipped, the row drops out of operational
and shows up only when the user explicitly opens the Archive view.

Selection rule (default 21 days, override with --older-than):
  - status.phase = 'COMPLETE'    (covers hasabat + tamamlandy)
  - is_archived = False
  - updated_at <= now - <older_than> days

Open shipments (any non-COMPLETE phase) are NEVER auto-archived. If they
sit unmoved for ≥60 days that's a separate signal — the stuck-shipments
dashboard (Phase 4) flags them for manual intervention.

Idempotent: re-running the command on the same data is a no-op (rows
already at is_archived=True are excluded by the filter).

Usage:
    python manage.py archive_shipments
    python manage.py archive_shipments --older-than 14   # tighter window
    python manage.py archive_shipments --dry-run         # report only

Cron entry (Linux, daily at 03:00 server time):
    0 3 * * * cd /opt/ygt-platform/backend && python manage.py archive_shipments

Cron entry (Windows Task Scheduler):
    Trigger: daily 03:00
    Action:  python.exe manage.py archive_shipments
    Start in: D:\\ygt-platform\\backend
"""
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.export.models import Shipment


DEFAULT_AGE_DAYS = 21
TERMINAL_PHASE = 'COMPLETE'


class Command(BaseCommand):
    help = 'Archive shipments in terminal phase that have not been touched in N days.'

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            '--older-than',
            type=int,
            default=DEFAULT_AGE_DAYS,
            help=f'Only archive shipments not touched in the last N days (default {DEFAULT_AGE_DAYS}).',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Report which shipments would be archived without writing anything.',
        )

    def handle(self, *args, older_than: int, dry_run: bool, **opts) -> None:
        if older_than < 1:
            self.stderr.write(self.style.ERROR('--older-than must be ≥ 1'))
            return

        now = timezone.now()
        threshold = now - timedelta(days=older_than)

        qs = Shipment.objects.filter(
            status__phase=TERMINAL_PHASE,
            is_archived=False,
            updated_at__lte=threshold,
        )
        count = qs.count()

        if count == 0:
            self.stdout.write(self.style.SUCCESS(
                f'No shipments to archive (phase={TERMINAL_PHASE}, age ≥ {older_than}d).'
            ))
            return

        if dry_run:
            self.stdout.write(self.style.WARNING(
                f'[DRY RUN] Would archive {count} shipments older than {older_than} days:'
            ))
            for s in qs.values('id', 'cargo_code', 'updated_at')[:20]:
                self.stdout.write(
                    f'  - id={s["id"]:5d}  {s["cargo_code"]}  updated_at={s["updated_at"]:%Y-%m-%d}'
                )
            if count > 20:
                self.stdout.write(f'  ... and {count - 20} more')
            return

        # Direct UPDATE — bypass save() so updated_at stays fixed at the
        # original "last touched" value. The archive event is captured by
        # archived_at.
        updated = qs.update(is_archived=True, archived_at=now)
        self.stdout.write(self.style.SUCCESS(
            f'Archived {updated} shipments (phase={TERMINAL_PHASE}, age ≥ {older_than}d).'
        ))
