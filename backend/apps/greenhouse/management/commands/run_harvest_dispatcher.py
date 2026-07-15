"""Management command: evaluate and fire harvest forecast/plan notifications.

Designed to run on a 5-minute cron cadence. Each invocation:
1. Reads GreenhouseConfig to get the local timezone and trigger thresholds.
2. Converts UTC now → local naive datetime.
3. Calls evaluate_triggers() to determine which events are due.
4. Calls fire() for each event — idempotent via HarvestDispatchLog UNIQUE constraint.
5. Ensures the current + next ISO week are initialized for all active blocks so
   block managers always open a complete plan grid (initialize_upcoming_weeks is
   idempotent — a cheap no-op once the weeks exist).

Usage:
    python manage.py run_harvest_dispatcher
"""
import logging
from zoneinfo import ZoneInfo

from django.core.management.base import BaseCommand
from django.utils import timezone

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Evaluate and fire harvest forecast/plan time-based notifications'

    def handle(self, *args, **options) -> None:
        from apps.core.models import GreenhouseConfig
        from apps.greenhouse.dispatcher import evaluate_triggers, fire
        from apps.greenhouse.services import initialize_upcoming_weeks

        config = GreenhouseConfig.get_solo()
        tz = ZoneInfo(config.timezone_name)
        # Convert UTC now to local naive datetime for window comparisons
        now_local = timezone.now().astimezone(tz).replace(tzinfo=None)

        events = evaluate_triggers(now_local, config)
        fired = 0
        skipped = 0
        for event in events:
            if fire(event):
                fired += 1
            else:
                skipped += 1

        # Keep the plan grid complete for the weeks managers are actively filling.
        # Isolated in try/except so a setup hiccup never blocks notifications.
        try:
            weeks = initialize_upcoming_weeks(now_local.date())
        except Exception:
            logger.exception('run_harvest_dispatcher: week auto-initialize failed')
            weeks = []

        self.stdout.write(
            self.style.SUCCESS(
                f'Dispatched {fired} new notifications '
                f'({skipped} already-fired), ensured weeks {weeks} at {now_local}'
            )
        )
