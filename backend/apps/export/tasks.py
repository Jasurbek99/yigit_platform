"""Beat-scheduled jobs for the export app (see CELERY_BEAT_SCHEDULE)."""
from celery import shared_task
from django.utils import timezone

from apps.export.services.truck_allocation_tasks import run_saturday_plan_summary


@shared_task
def send_saturday_plan_summary() -> None:
    """Saturday 09:00: next week's plan-fill summary + truck-allocation task."""
    run_saturday_plan_summary(timezone.localdate())
