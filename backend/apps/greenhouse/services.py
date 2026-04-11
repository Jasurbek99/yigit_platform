import logging

from apps.core.roles import PLAN_APPROVE
from apps.core.services_workflow import apply_status_change, create_audit_entry, validate_transition
from apps.greenhouse.models import (
    BlockManagerAssignment,
    PLAN_TRANSITIONS,
    WeeklyHarvestPlan,
)

logger = logging.getLogger(__name__)

_PLAN_APPROVE_ROLES = PLAN_APPROVE
_PLAN_DAYS = ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday')


def _notify_plan_event(
    kind: str,
    plan: WeeklyHarvestPlan,
    target_user_ids: list[int],
    message: str,
) -> None:
    """Create Notification rows for the given users about a harvest plan event."""
    from apps.export.models import Notification

    link = f'/greenhouse/plan?week={plan.week_number}&year={plan.year}'
    notifications = [
        Notification(user_id=uid, kind=kind, message=message, link=link)
        for uid in target_user_ids
    ]
    if notifications:
        Notification.objects.bulk_create(notifications, batch_size=500)


def _check_block_permission(user: 'User', block_id: int) -> None:
    """Verify greenhouse_manager has an active assignment for the block.

    Directors and export_managers are always allowed (checked by caller).

    Raises:
        PermissionError: If the user cannot write to this block.
    """
    role = getattr(user, 'role', None)
    if role == 'greenhouse_manager':
        has_assignment = BlockManagerAssignment.objects.filter(
            user=user, block_id=block_id, is_active=True,
        ).exists()
        if not has_assignment:
            raise PermissionError(f"greenhouse_manager is not assigned to block {block_id}.")
    elif role not in _PLAN_APPROVE_ROLES:
        raise PermissionError(f"Role '{role}' is not allowed to submit harvest plans.")


def _notify_approvers(plan: WeeklyHarvestPlan, user: 'User') -> None:
    """Notify export_manager + director users about a plan submission."""
    from apps.core.models import User as UserModel
    target_ids = list(
        UserModel.objects.filter(role__in=_PLAN_APPROVE_ROLES, is_active=True)
        .values_list('id', flat=True)
    )
    _notify_plan_event(
        'plan_submitted', plan, target_ids,
        f'Block {plan.block.code} W{plan.week_number} plan submitted by {user.username}',
    )


def _notify_block_managers(plan: WeeklyHarvestPlan, user: 'User', action: str) -> None:
    """Notify the block's greenhouse managers about approval/rejection."""
    target_ids = list(
        BlockManagerAssignment.objects.filter(
            block_id=plan.block_id, is_active=True,
        ).values_list('user_id', flat=True)
    )
    verb = 'approved' if action == 'plan_approved' else 'rejected'
    _notify_plan_event(
        action, plan, target_ids,
        f'Your Block {plan.block.code} W{plan.week_number} plan {verb} by {user.username}',
    )


def submit_harvest_plan(plan: WeeklyHarvestPlan, user: 'User') -> None:
    """Submit a harvest plan for approval.

    Args:
        plan: WeeklyHarvestPlan instance.
        user: User performing the submission.

    Raises:
        ValueError: If the plan cannot be submitted from its current status.
        PermissionError: If the user is not allowed to write this block's plan.
    """
    validate_transition(plan.status, 'submitted', PLAN_TRANSITIONS)

    has_plan = any(getattr(plan, f'{d}_plan_kg', 0) > 0 for d in _PLAN_DAYS)
    if not has_plan:
        raise ValueError('Plan must have at least one day with a positive plan_kg.')

    _check_block_permission(user, plan.block_id)

    update_fields = apply_status_change(
        plan, 'submitted', user,
        timestamp_field='submitted_at', user_field='submitted_by',
        clear_fields=['rejected_at', 'rejected_by', 'rejection_note'],
    )
    plan.save(update_fields=update_fields)

    create_audit_entry(
        user, 'plan_submitted', 'WeeklyHarvestPlan',
        plan.id, str(plan),
        f'Block {plan.block.code} W{plan.week_number}/{plan.year} submitted',
    )
    _notify_approvers(plan, user)
    logger.info('HarvestPlan %s submitted by %s', plan, user.username)


def approve_harvest_plan(plan: WeeklyHarvestPlan, user: 'User') -> None:
    """Approve a submitted harvest plan.

    Args:
        plan: WeeklyHarvestPlan instance in 'submitted' status.
        user: User performing the approval (must be export_manager or director).

    Raises:
        ValueError: If the plan is not in 'submitted' status.
        PermissionError: If the user's role cannot approve.
    """
    validate_transition(plan.status, 'approved', PLAN_TRANSITIONS)

    role = getattr(user, 'role', None)
    if role not in _PLAN_APPROVE_ROLES:
        raise PermissionError(f"Role '{role}' is not allowed to approve harvest plans.")

    update_fields = apply_status_change(
        plan, 'approved', user,
        timestamp_field='approved_at', user_field='approved_by',
    )
    plan.save(update_fields=update_fields)

    create_audit_entry(
        user, 'plan_approved', 'WeeklyHarvestPlan',
        plan.id, str(plan),
        f'Block {plan.block.code} W{plan.week_number}/{plan.year} approved',
    )
    _notify_block_managers(plan, user, 'plan_approved')
    logger.info('HarvestPlan %s approved by %s', plan, user.username)


def reject_harvest_plan(plan: WeeklyHarvestPlan, user: 'User', rejection_note: str) -> None:
    """Reject a submitted harvest plan.

    Args:
        plan: WeeklyHarvestPlan instance in 'submitted' status.
        user: User performing the rejection (must be export_manager or director).
        rejection_note: Mandatory reason for rejection.

    Raises:
        ValueError: If the plan is not in 'submitted' status or note is empty.
        PermissionError: If the user's role cannot reject.
    """
    validate_transition(plan.status, 'rejected', PLAN_TRANSITIONS)

    if not rejection_note or not rejection_note.strip():
        raise ValueError('Rejection note is required.')

    role = getattr(user, 'role', None)
    if role not in _PLAN_APPROVE_ROLES:
        raise PermissionError(f"Role '{role}' is not allowed to reject harvest plans.")

    update_fields = apply_status_change(
        plan, 'rejected', user,
        timestamp_field='rejected_at', user_field='rejected_by',
    )
    plan.rejection_note = rejection_note.strip()
    update_fields.append('rejection_note')
    plan.save(update_fields=update_fields)

    create_audit_entry(
        user, 'plan_rejected', 'WeeklyHarvestPlan',
        plan.id, str(plan),
        f'Block {plan.block.code} W{plan.week_number}/{plan.year} rejected: {rejection_note}',
    )
    _notify_block_managers(plan, user, 'plan_rejected')
    logger.info('HarvestPlan %s rejected by %s: %s', plan, user.username, rejection_note)


# ---------------------------------------------------------------------------
# Block summary & week initialization
# ---------------------------------------------------------------------------

def initialize_harvest_week(
    season_id: int, week_number: int, year: int, user: 'User',
) -> list['WeeklyHarvestPlan']:
    """Create draft WeeklyHarvestPlan rows for all active blocks missing a plan.

    Returns all plans for the given (season, week, year) — including pre-existing ones.
    """
    from apps.core.models import GreenhouseBlock

    active_blocks = GreenhouseBlock.objects.filter(is_active=True)
    existing_block_ids = set(
        WeeklyHarvestPlan.objects.filter(
            season_id=season_id, week_number=week_number, year=year,
        ).values_list('block_id', flat=True)
    )

    new_plans = [
        WeeklyHarvestPlan(
            season_id=season_id, block=block,
            week_number=week_number, year=year, entered_by=user,
        )
        for block in active_blocks
        if block.id not in existing_block_ids
    ]
    if new_plans:
        WeeklyHarvestPlan.objects.bulk_create(new_plans, batch_size=500)

    return list(
        WeeklyHarvestPlan.objects.filter(
            season_id=season_id, week_number=week_number, year=year,
        ).select_related('season', 'block', 'entered_by', 'submitted_by', 'approved_by', 'rejected_by')
    )


def get_block_summary(
    year: int, week: int, season_id: int | None = None,
) -> list[dict]:
    """Compute per-block aggregate totals for a given week.

    Returns sorted list of dicts with block_id, block_code, total_plan_kg,
    total_actual_kg, and deficit_kg.
    """
    from decimal import Decimal

    qs = WeeklyHarvestPlan.objects.select_related('block')
    if season_id:
        qs = qs.filter(season_id=season_id)
    qs = qs.filter(year=year, week_number=week)

    DAYS = ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday')
    block_data: dict = {}

    for plan in qs:
        bid = plan.block_id
        if bid not in block_data:
            block_data[bid] = {
                'block_id': bid,
                'block_code': plan.block.code,
                'block_name': plan.block.name,
                'total_plan_kg': Decimal('0'),
                'total_actual_kg': None,
                '_has_actual': False,
            }
        for d in DAYS:
            block_data[bid]['total_plan_kg'] += getattr(plan, f'{d}_plan_kg') or Decimal('0')
            actual = getattr(plan, f'{d}_actual_kg')
            if actual is not None:
                if not block_data[bid]['_has_actual']:
                    block_data[bid]['total_actual_kg'] = Decimal('0')
                    block_data[bid]['_has_actual'] = True
                block_data[bid]['total_actual_kg'] += actual

    results = sorted(block_data.values(), key=lambda x: x['block_code'])
    for r in results:
        r.pop('_has_actual')
        r['deficit_kg'] = (
            r['total_actual_kg'] - r['total_plan_kg']
            if r['total_actual_kg'] is not None
            else None
        )
    return results
