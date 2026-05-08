"""Daily cron: roll up HarvestDayEntry.actual_value from shipment loading data.

For each shipment whose loading_started_at falls on the target local date,
sum its ShipmentBlockSource weights per block and write the result to the
matching HarvestDayEntry row. Replaces the manual warehouse_chief actual
entry path that was removed in May 2026.

Selection rule:
  - target_date defaults to yesterday in Asia/Ashgabat (configurable via
    GreenhouseConfig.timezone_name).
  - Rows with actual_source='admin_override' are skipped unless --force.

Idempotent: re-running for the same date produces the same result, since
SUM is deterministic and admin_override rows are protected.

Usage:
    python manage.py rollup_actuals                  # default: yesterday local
    python manage.py rollup_actuals --date 2026-05-07
    python manage.py rollup_actuals --force          # overwrite admin_override rows
    python manage.py rollup_actuals --dry-run        # report only

Cron entry (Linux, daily at 02:30 server time):
    30 2 * * * cd /opt/ygt-platform/backend && python manage.py rollup_actuals

Cron entry (Windows Task Scheduler):
    Trigger: daily 02:30
    Action:  python.exe manage.py rollup_actuals
    Start in: D:\\ygt-platform\\backend
"""
from datetime import date, datetime

from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = 'Roll up HarvestDayEntry.actual_value from shipment loading data for one local date.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--date',
            help='Target local date YYYY-MM-DD (default: yesterday in Asia/Ashgabat).',
        )
        parser.add_argument(
            '--force',
            action='store_true',
            help='Overwrite even rows with actual_source=admin_override.',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Compute and report without writing.',
        )

    def handle(self, *args, **options):
        # Lazy import — services package pulls in models.
        from apps.greenhouse.services import rollup_actuals_for_date, yesterday_local

        target_date = self._parse_date(options.get('date')) or yesterday_local()
        force = options['force']
        dry_run = options['dry_run']

        result = rollup_actuals_for_date(target_date, force=force, dry_run=dry_run)

        prefix = '[DRY-RUN] ' if dry_run else ''
        self.stdout.write(self.style.SUCCESS(
            f'{prefix}Rollup for {result.target_date}: '
            f'{result.entries_updated} entries updated, '
            f'{result.entries_skipped_override} skipped (admin_override), '
            f'{result.entries_missing} block(s) missing HarvestDayEntry, '
            f'{len(result.shipments_without_blocks)} shipment(s) loaded with no '
            f'block_sources, total {result.total_kg} kg.'
        ))

        if result.shipments_without_blocks:
            self.stdout.write(self.style.WARNING(
                'Shipments loaded on this date with no ShipmentBlockSource rows '
                '(silent under-reporting):'
            ))
            for ship_id, cargo_code in result.shipments_without_blocks:
                self.stdout.write(f'  - id={ship_id} cargo_code={cargo_code}')

    @staticmethod
    def _parse_date(value: str | None) -> date | None:
        if not value:
            return None
        try:
            return datetime.strptime(value, '%Y-%m-%d').date()
        except ValueError as exc:
            raise CommandError(f"--date must be YYYY-MM-DD (got: {value!r}).") from exc
