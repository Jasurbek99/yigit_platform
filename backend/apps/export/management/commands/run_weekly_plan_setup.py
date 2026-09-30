"""Management command: daily weekly-plan setup (initialize weeks + generate tasks).

Runs once a day (not on the 5-minute dispatcher cadence — week setup only needs
to happen ~daily). Each invocation:

1. initialize_upcoming_weeks() — for the current and next ISO week of the active
   season, ensures every active top-level block has its WeeklyHarvestPlan
   container + Mon–Sun HarvestDayEntry cells, so a block manager always opens a
   complete grid instead of an empty/partial one.
2. generate_weekly_plan_tasks() — from the plan-deadline weekday (Friday) on,
   creates the "fill weekly plan" task per (active manager, block) for NEXT week
   only (owner rule 2026-09-29, docs/Tasks.md item 1). Fri/Sat/Sun re-runs catch
   a manager assigned late.

Both steps are idempotent (only insert what's missing), so this is safe to run
repeatedly. The manual buttons ("Initialize Week", "Generate plan tasks") remain
for ad-hoc back-fills; this command just makes the common case automatic.

This command lives in `export` (not `greenhouse`) because it calls
generate_weekly_plan_tasks (an export service) alongside initialize_upcoming_weeks
(a greenhouse service) — export may import greenhouse, the reverse is forbidden.

Scheduled by Celery beat ('weekly-plan-setup', 06:00 local). Manual / backfill:
    python manage.py run_weekly_plan_setup [--today YYYY-MM-DD]
"""
from datetime import date

from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Daily: initialize current+next weekly-plan weeks; from Friday, generate next week's plan tasks"

    def add_arguments(self, parser):
        parser.add_argument('--today', help='Local date YYYY-MM-DD to run as (tests / backfill).')

    def handle(self, *args, **options) -> None:
        from apps.core.models import GreenhouseConfig
        from apps.export.services import generate_weekly_plan_tasks
        from apps.export.services.plan_task_common import local_today, next_iso_week
        from apps.greenhouse.services import initialize_upcoming_weeks

        config = GreenhouseConfig.get_solo()
        today_local = date.fromisoformat(options['today']) if options.get('today') else local_today()

        weeks = initialize_upcoming_weeks(today_local)
        tasks_created = 0
        # No active season → `weeks` is empty → no tasks.
        if weeks and today_local.weekday() >= config.plan_deadline_weekday:
            year, week = next_iso_week(today_local)
            tasks_created = len(generate_weekly_plan_tasks(year, week))

        self.stdout.write(
            self.style.SUCCESS(
                f'Weekly-plan setup: ensured weeks {weeks}, '
                f'created {tasks_created} new plan tasks ({today_local}).'
            )
        )
