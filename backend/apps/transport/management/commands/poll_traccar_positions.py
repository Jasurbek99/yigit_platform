from django.core.management.base import BaseCommand

from apps.transport.services.sync import sync_positions
from apps.transport.services.traccar_client import TraccarUnavailable


class Command(BaseCommand):
    help = (
        'Poll Traccar and upsert the latest position per device.\n\n'
        'Schedule every 1 min (last-known positions survive a missed poll):\n'
        '  Linux cron:   * * * * * cd /app/backend && python manage.py poll_traccar_positions\n'
        '  Windows Task Scheduler: run `python manage.py poll_traccar_positions` every 1 minute.'
    )

    def handle(self, *args, **options):
        try:
            count = sync_positions()
        except TraccarUnavailable as exc:
            # Non-fatal: existing rows remain; the scheduler retries next minute.
            self.stdout.write(self.style.WARNING(f'Traccar unavailable, kept last-known: {exc}'))
            return
        self.stdout.write(self.style.SUCCESS(f'Updated {count} positions.'))
