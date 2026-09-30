"""Beat-scheduled jobs for the export app (see CELERY_BEAT_SCHEDULE).

`run_weekly_plan_setup` used to be documented as a host crontab line
(`docs/operations/cron.md`). On the beta server that line pointed at a host
virtualenv path that does not exist under the Docker deploy, so it silently
never ran and weekly-plan tasks only appeared when a supervisor pressed
"Generate plan tasks". Beat already runs as its own container and ships with
the code, so the schedule lives here instead of per-server crontabs.
"""
import logging

from celery import shared_task
from django.core.management import call_command
from django.utils import timezone

from apps.export.services.truck_allocation_tasks import run_saturday_plan_summary

logger = logging.getLogger(__name__)


@shared_task
def send_saturday_plan_summary() -> None:
    """Saturday 09:00: next week's plan-fill summary + truck-allocation task."""
    run_saturday_plan_summary(timezone.localdate())


@shared_task
def sync_plan_ack_tasks() -> None:
    """Every 30 min: open alloc_review / transport_plan tasks the plan or allocation now needs."""
    from apps.export.services.plan_ack_tasks import sync_plan_ack_tasks as run

    run()


@shared_task
def run_daily_plan_tasks() -> None:
    """Daily 06:05: close done daily tasks, mark yesterday's leftovers missed, open today's."""
    from apps.export.services.daily_plan_tasks import run_daily_plan_tasks as run

    run()


@shared_task
def run_weekly_plan_setup() -> None:
    """Daily: initialize the current+next plan weeks and generate plan tasks.

    Thin wrapper over the management command, which stays the manual/backfill
    entry point. Idempotent — a re-run only inserts what is missing.
    """
    call_command('run_weekly_plan_setup')
    logger.info('run_weekly_plan_setup completed')
