"""Management command: generate the seller local_sell_plan Task for a week.

Creates the shared seller reminder task for the given ISO week (idempotent), then
auto-resolves it if the week is already complete. Generation also happens when a
manager initializes a week; this command is the cron backstop so the reminder
still appears if nobody initializes.

Defaults to the current ISO week. Intended for a weekly cron, e.g. (Mondays):
    0 6 * * 1 cd /opt/ygt-platform/backend && python manage.py generate_local_sell_plan_tasks

Usage:
    python manage.py generate_local_sell_plan_tasks            # current ISO week
    python manage.py generate_local_sell_plan_tasks --year 2026 --week 27
"""
from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.export.services import generate_local_sell_plan_tasks


class Command(BaseCommand):
    help = 'Generate the shared seller local_sell_plan task for an ISO week (default: current).'

    def add_arguments(self, parser):
        parser.add_argument('--year', type=int, help='ISO year (default: current).')
        parser.add_argument('--week', type=int, help='ISO week 1-53 (default: current).')

    def handle(self, *args, **options):
        today = timezone.localdate()
        iso_year, iso_week, _ = today.isocalendar()
        year = options.get('year') or iso_year
        week = options.get('week') or iso_week

        if not (1 <= week <= 53):
            self.stderr.write(self.style.ERROR('week must be between 1 and 53.'))
            return

        created = generate_local_sell_plan_tasks(year, week)
        if created:
            self.stdout.write(self.style.SUCCESS(f'Created local_sell_plan task for W{week}/{year}.'))
        else:
            self.stdout.write(f'local_sell_plan task for W{week}/{year} already exists — nothing to do.')
