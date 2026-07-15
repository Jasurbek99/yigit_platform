"""Management command: daily weekly-plan setup (initialize weeks + generate tasks).

Runs once a day (not on the 5-minute dispatcher cadence — week setup only needs
to happen ~daily). Each invocation, for the current and next ISO week of the
active season:

1. initialize_upcoming_weeks() — ensures every active top-level block has its
   WeeklyHarvestPlan container + Mon–Sun HarvestDayEntry cells, so a block
   manager always opens a complete grid instead of an empty/partial one.
2. generate_weekly_plan_tasks() — creates the "fill weekly plan" task per
   (active manager, block) for each of those weeks.

Both steps are idempotent (only insert what's missing), so this is safe to run
repeatedly. The manual buttons ("Initialize Week", "Generate plan tasks") remain
for ad-hoc back-fills; this command just makes the common case automatic.

This command lives in `export` (not `greenhouse`) because it calls
generate_weekly_plan_tasks (an export service) alongside initialize_upcoming_weeks
(a greenhouse service) — export may import greenhouse, the reverse is forbidden.

Usage (Ubuntu cron, once a day at 06:00 local):
    0 6 * * * cd /opt/ygt/backend && venv/bin/python manage.py run_weekly_plan_setup
"""
from zoneinfo import ZoneInfo

from django.core.management.base import BaseCommand
from django.utils import timezone


class Command(BaseCommand):
    help = 'Daily: initialize current+next weekly-plan weeks and generate plan tasks'

    def handle(self, *args, **options) -> None:
        from apps.core.models import GreenhouseConfig
        from apps.export.services import generate_weekly_plan_tasks
        from apps.greenhouse.services import initialize_upcoming_weeks

        config = GreenhouseConfig.get_solo()
        tz = ZoneInfo(config.timezone_name)
        today_local = timezone.now().astimezone(tz).date()

        weeks = initialize_upcoming_weeks(today_local)
        tasks_created = 0
        for year, week in weeks:
            tasks_created += len(generate_weekly_plan_tasks(year, week))

        self.stdout.write(
            self.style.SUCCESS(
                f'Weekly-plan setup: ensured weeks {weeks}, '
                f'created {tasks_created} new plan tasks ({today_local}).'
            )
        )
