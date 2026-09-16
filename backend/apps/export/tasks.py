"""Periodic export-owned jobs, run by Celery beat.

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

logger = logging.getLogger(__name__)


@shared_task
def run_weekly_plan_setup() -> None:
    """Daily: initialize the current+next plan weeks and generate plan tasks.

    Thin wrapper over the management command, which stays the manual/backfill
    entry point. Idempotent — a re-run only inserts what is missing.
    """
    call_command('run_weekly_plan_setup')
    logger.info('run_weekly_plan_setup completed')
