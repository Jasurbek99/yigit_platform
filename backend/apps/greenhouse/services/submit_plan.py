"""submit_weekly_plan — formal week submission without approval workflow."""
import logging

from django.utils import timezone

from apps.core.services_workflow import create_audit_entry
from apps.greenhouse.models import BlockManagerAssignment, WeeklyHarvestPlan
from apps.greenhouse.services.harvest_day_service import (
    now_local,
    plan_week_start,
    compute_plan_state,
)

logger = logging.getLogger(__name__)


def submit_weekly_plan(weekly_plan: WeeklyHarvestPlan, user) -> None:
    """Mark a WeeklyHarvestPlan as formally submitted.

    Submission is final — there is no approval step. This function:
    1. Sets WeeklyHarvestPlan.submitted_at/submitted_by if not already set.
    2. For each HarvestDayEntry linked to this plan where plan_value IS NOT NULL
       but plan_submitted_at IS NULL, fills in the submission audit fields.

    Args:
        weekly_plan: WeeklyHarvestPlan instance.
        user: User performing the submission.

    Raises:
        PermissionError: If user is not greenhouse_manager (own block) or admin.
        ValueError: If no plan values exist to submit.
    """
    from apps.core.models import GreenhouseConfig

    role = getattr(user, 'role', None)
    if role == 'admin':
        pass  # always allowed
    elif role == 'greenhouse_manager':
        if not BlockManagerAssignment.objects.filter(
            user=user, block=weekly_plan.block, is_active=True,
        ).exists():
            raise PermissionError(
                f"greenhouse_manager '{user.username}' is not assigned to block {weekly_plan.block_id}."
            )
    else:
        raise PermissionError(f"Role '{role}' is not allowed to submit harvest plans.")

    config = GreenhouseConfig.get_solo()
    now_utc = timezone.now()
    now_local_dt = now_local(config)

    # Back-fill plan_submitted_at on day entries that have a plan value but no timestamp yet.
    day_entries = list(
        weekly_plan.day_entries.filter(
            plan_value__isnull=False,
            plan_submitted_at__isnull=True,
        )
    )

    if not day_entries and weekly_plan.submitted_at is not None:
        # Already submitted and no orphan entries to back-fill
        logger.info('WeeklyHarvestPlan %s already submitted — no-op', weekly_plan)
        return

    if not day_entries and weekly_plan.submitted_at is None:
        raise ValueError("No plan values to submit for this week's plan.")

    for entry in day_entries:
        week_start = plan_week_start(entry.entry_date)
        entry.plan_submitted_at = now_utc
        entry.plan_submitted_by = user
        entry.plan_state = compute_plan_state(now_local_dt, week_start, config)

    # Bulk-save the day entries
    if day_entries:
        from apps.greenhouse.models import HarvestDayEntry
        HarvestDayEntry.objects.bulk_update(
            day_entries,
            ['plan_submitted_at', 'plan_submitted_by', 'plan_state', 'updated_at'],
            batch_size=500,
        )

    # Update the container record
    if weekly_plan.submitted_at is None:
        weekly_plan.submitted_at = now_utc
        weekly_plan.submitted_by = user
        weekly_plan.save(update_fields=['submitted_at', 'submitted_by', 'updated_at'])

    create_audit_entry(
        user, 'plan_submitted', 'WeeklyHarvestPlan',
        weekly_plan.id, str(weekly_plan),
        f'Block {weekly_plan.block.code} W{weekly_plan.week_number}/{weekly_plan.year} submitted',
    )
    logger.info('WeeklyHarvestPlan %s submitted by %s', weekly_plan, user.username)
