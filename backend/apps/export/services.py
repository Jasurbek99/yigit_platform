import logging
from decimal import Decimal

from django.db.models import Sum
from django.db.models.functions import Coalesce
from django.utils import timezone

from apps.export.models import Shipment, ShipmentStatusLog

logger = logging.getLogger(__name__)

# Status code → AD-1 denormalized timestamp field name on Shipment.
# Only statuses that have a dedicated lifecycle timestamp are listed here.
# serhet_tm, barysh_gumrugi, yolda: transit waypoints with no dedicated AD-1 field.
# hasabat, tamamlandy: report and completed statuses have no dedicated AD-1 timestamp.
STATUS_TIMESTAMP_MAP = {
    'yuklenme': 'loading_started_at',
    'gumruk_girish': 'customs_entry_at',
    'gumruk_chykysh': 'customs_exit_at',
    'yola_chykdy': 'departed_at',
    'serhet_gechdi': 'border_crossed_at',
    'bardy': 'arrived_at',
    'satylyar': 'sale_started_at',
    'satyldy': 'sale_ended_at',
}

# Allowed transitions: from_code → list of (to_code, allowed_roles)
# None key = shipment has no status yet (initial creation edge case).
# Roles export_manager and director are always privileged — they can trigger any transition.
TRANSITIONS = {
    None:             [('yuklenme',       ['warehouse_chief'])],
    'yuklenme':       [('gumruk_girish',  ['warehouse_chief'])],
    'gumruk_girish':  [('gumruk_chykysh', ['document_team'])],
    'gumruk_chykysh': [('yola_chykdy',    ['document_team'])],
    'yola_chykdy':    [('serhet_tm',      ['transport'])],
    'serhet_tm':      [('serhet_gechdi',  ['transport'])],
    'serhet_gechdi':  [('barysh_gumrugi', ['sales_rep'])],
    'barysh_gumrugi': [('yolda',          ['sales_rep'])],
    'yolda':          [('bardy',          ['sales_rep'])],
    'bardy':          [('satylyar',       ['sales_rep'])],
    'satylyar':       [('satyldy',        ['sales_rep'])],
    'satyldy':        [('hasabat',        ['sales_rep'])],
    'hasabat':        [('tamamlandy',     ['finansist'])],
    'tamamlandy':     [],
}

# Roles that may override role restrictions and trigger any valid transition.
PRIVILEGED_ROLES = {'export_manager', 'director'}


def _send_quota_notifications(quota_obj: 'QuotaAllocation') -> None:
    """Create Notification rows for export_manager and director users when
    quota usage crosses a warning threshold for the first time.

    Uses the warning_*_sent flags on QuotaAllocation to prevent duplicate
    notifications. Saves the updated flags back to the DB.

    Args:
        quota_obj: A freshly-fetched QuotaAllocation instance with updated used_kg.
    """
    from apps.core.models import User
    from apps.export.models import Notification, QuotaAllocation

    if quota_obj.granted_kg <= 0:
        return

    pct = int(quota_obj.used_kg / quota_obj.granted_kg * 100)
    firm_name = getattr(quota_obj.export_firm, 'name_en', None) or f'firm#{quota_obj.export_firm_id}'

    thresholds = [
        (80, 'quota_80', 'warning_80_sent'),
        (90, 'quota_90', 'warning_90_sent'),
        (95, 'quota_95', 'warning_95_sent'),
    ]

    # Fetch target user IDs once — avoids N+1 if multiple thresholds trigger.
    target_user_ids = list(
        User.objects.filter(
            role__in=['export_manager', 'director'],
            is_active=True,
        ).values_list('id', flat=True)
    )

    flags_to_update = []
    notifications_to_create = []

    for threshold, kind, flag in thresholds:
        if pct >= threshold and not getattr(quota_obj, flag):
            message = (
                f'{firm_name} quota at {pct}% '
                f'({quota_obj.used_kg} / {quota_obj.granted_kg} kg)'
            )
            link = f'/export/quotas/?firm={quota_obj.export_firm_id}'

            for user_id in target_user_ids:
                notifications_to_create.append(
                    Notification(
                        user_id=user_id,
                        kind=kind,
                        message=message,
                        link=link,
                    )
                )

            setattr(quota_obj, flag, True)
            flags_to_update.append(flag)

    if notifications_to_create:
        Notification.objects.bulk_create(notifications_to_create, batch_size=500)

    if flags_to_update:
        QuotaAllocation.objects.filter(pk=quota_obj.pk).update(
            **{f: True for f in flags_to_update}
        )
        logger.info(
            'Quota warning flags set for firm=%s season=%s: %s',
            quota_obj.export_firm_id,
            quota_obj.season_id,
            flags_to_update,
        )


def _refresh_quota_usage(shipment: 'Shipment') -> None:
    """Recalculate used_kg for all QuotaAllocation rows affected by this shipment.

    Called after a shipment enters yuklenme (loading committed). Sums all firm
    split weights for the affected firms in the same season.
    """
    from apps.export.models import ShipmentFirmSplit, QuotaAllocation

    if not shipment.season_id:
        return

    firm_ids = list(
        ShipmentFirmSplit.objects.filter(shipment=shipment)
        .values_list('export_firm_id', flat=True)
        .distinct()
    )
    if not firm_ids:
        return

    for firm_id in firm_ids:
        total = ShipmentFirmSplit.objects.filter(
            shipment__season_id=shipment.season_id,
            export_firm_id=firm_id,
        ).aggregate(total=Coalesce(Sum('weight_kg'), Decimal('0')))['total']

        QuotaAllocation.objects.filter(
            season_id=shipment.season_id,
            export_firm_id=firm_id,
        ).update(used_kg=total)

        # Re-fetch with select_related to get firm name for the notification message.
        quota_obj = (
            QuotaAllocation.objects
            .select_related('export_firm')
            .filter(season_id=shipment.season_id, export_firm_id=firm_id)
            .first()
        )
        if quota_obj:
            _send_quota_notifications(quota_obj)


def transition_to(shipment: Shipment, new_status_code: str, user, comment: str = '') -> None:
    """Execute a validated status transition with role enforcement.

    This is the ONLY function that may update shipment.status and the AD-1
    denormalized timestamp fields. Never update those fields directly.

    Args:
        shipment: The Shipment instance to transition.
        new_status_code: Target status code string (e.g. 'gumruk_girish').
        user: User performing the transition (core.User instance).
        comment: Optional audit comment stored in ShipmentStatusLog.

    Raises:
        ValueError: If the transition is not allowed from the current status,
                    or if new_status_code does not exist in ShipmentStatusType.
        PermissionError: If the user's role is not allowed to trigger this transition.
    """
    from apps.core.models import ShipmentStatusType

    current_code = shipment.status.code if shipment.status_id else None
    edges = TRANSITIONS.get(current_code, [])
    allowed_codes = [to_code for to_code, _roles in edges]

    if new_status_code not in allowed_codes:
        raise ValueError(
            f'Cannot transition from {current_code!r} to {new_status_code!r}. '
            f'Allowed: {allowed_codes}'
        )

    # Role check — privileged roles bypass per-transition restrictions.
    user_role = getattr(user, 'role', None)
    if user_role not in PRIVILEGED_ROLES:
        allowed_roles = next(roles for to_code, roles in edges if to_code == new_status_code)
        if user_role not in allowed_roles:
            raise PermissionError(
                f'Role {user_role!r} cannot trigger transition to {new_status_code!r}. '
                f'Allowed roles: {allowed_roles}'
            )

    try:
        new_status = ShipmentStatusType.objects.get(code=new_status_code)
    except ShipmentStatusType.DoesNotExist:
        raise ValueError(f'Unknown status code: {new_status_code!r}')

    now = timezone.now()
    # updated_at must be listed explicitly: auto_now=True is ignored when update_fields is passed.
    update_fields = ['status', 'updated_by', 'updated_at']

    # AD-1: set the denormalized timestamp for this status
    ts_field = STATUS_TIMESTAMP_MAP.get(new_status_code)
    if ts_field:
        setattr(shipment, ts_field, now)
        update_fields.append(ts_field)

    shipment.status = new_status
    shipment.updated_by = user
    shipment.updated_at = now  # explicit assignment so intent is clear if update_fields changes
    shipment.save(update_fields=update_fields)

    ShipmentStatusLog.objects.create(
        shipment=shipment,
        status=new_status,
        changed_by=user,
        comment=comment,
    )

    # Write immutable audit trail entry for this transition.
    from apps.export.models import AuditLog
    AuditLog.objects.create(
        user=user,
        action='transition',
        model_name='Shipment',
        object_id=shipment.id,
        object_repr=shipment.cargo_code,
        detail=f'{current_code} → {new_status_code}',
    )

    logger.info(
        'Shipment %s transitioned %s → %s by %s',
        shipment.cargo_code,
        current_code,
        new_status_code,
        user.username,
    )

    # Refresh quota usage when a shipment commits to loading
    if new_status_code == 'yuklenme':
        _refresh_quota_usage(shipment)


# ---------------------------------------------------------------------------
# Weekly Harvest Plan — approval workflow
# ---------------------------------------------------------------------------

_PLAN_APPROVE_ROLES = frozenset({'export_manager', 'director'})
_PLAN_DAYS = ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday')


def _notify_plan_event(
    kind: str,
    plan: 'WeeklyHarvestPlan',
    target_user_ids: list[int],
    message: str,
) -> None:
    """Create Notification rows for the given users about a harvest plan event."""
    from apps.export.models import Notification

    link = f'/export/plan?week={plan.week_number}&year={plan.year}'
    notifications = [
        Notification(user_id=uid, kind=kind, message=message, link=link)
        for uid in target_user_ids
    ]
    if notifications:
        Notification.objects.bulk_create(notifications, batch_size=500)


def submit_harvest_plan(plan: 'WeeklyHarvestPlan', user) -> None:
    """Submit a harvest plan for approval.

    Validates the plan is in draft or rejected status, has at least one
    non-zero plan_kg day, and the user has block permission.

    Args:
        plan: WeeklyHarvestPlan instance.
        user: User performing the submission.

    Raises:
        ValueError: If the plan cannot be submitted from its current status.
        PermissionError: If the user is not allowed to write this block's plan.
    """
    from apps.export.models import PLAN_TRANSITIONS, AuditLog, BlockManagerAssignment

    allowed = PLAN_TRANSITIONS.get(plan.status, [])
    if 'submitted' not in allowed:
        raise ValueError(
            f"Cannot submit plan from status '{plan.status}'. "
            f"Allowed transitions: {allowed}"
        )

    # Validate at least one day has a positive plan value.
    has_plan = any(getattr(plan, f'{d}_plan_kg', 0) > 0 for d in _PLAN_DAYS)
    if not has_plan:
        raise ValueError('Plan must have at least one day with a positive plan_kg.')

    # Check block permission.
    role = getattr(user, 'role', None)
    if role not in _PLAN_APPROVE_ROLES:
        if role == 'greenhouse_manager':
            has_assignment = BlockManagerAssignment.objects.filter(
                user=user, block_id=plan.block_id, is_active=True,
            ).exists()
            if not has_assignment:
                raise PermissionError(
                    f"greenhouse_manager is not assigned to block {plan.block_id}."
                )
        else:
            raise PermissionError(
                f"Role '{role}' is not allowed to submit harvest plans."
            )

    now = timezone.now()
    plan.status = 'submitted'
    plan.submitted_at = now
    plan.submitted_by = user
    # Clear rejection fields on resubmit.
    plan.rejected_at = None
    plan.rejected_by = None
    plan.rejection_note = None
    plan.save(update_fields=[
        'status', 'submitted_at', 'submitted_by',
        'rejected_at', 'rejected_by', 'rejection_note', 'updated_at',
    ])

    AuditLog.objects.create(
        user=user,
        action='plan_submitted',
        model_name='WeeklyHarvestPlan',
        object_id=plan.id,
        object_repr=str(plan),
        detail=f'Block {plan.block.code} W{plan.week_number}/{plan.year} submitted',
    )

    # Notify export_manager + director users.
    from apps.core.models import User
    target_ids = list(
        User.objects.filter(role__in=_PLAN_APPROVE_ROLES, is_active=True)
        .values_list('id', flat=True)
    )
    block_code = plan.block.code
    _notify_plan_event(
        'plan_submitted', plan, target_ids,
        f'Block {block_code} W{plan.week_number} plan submitted by {user.username}',
    )

    logger.info(
        'HarvestPlan %s submitted by %s', plan, user.username,
    )


def approve_harvest_plan(plan: 'WeeklyHarvestPlan', user) -> None:
    """Approve a submitted harvest plan.

    Args:
        plan: WeeklyHarvestPlan instance in 'submitted' status.
        user: User performing the approval (must be export_manager or director).

    Raises:
        ValueError: If the plan is not in 'submitted' status.
        PermissionError: If the user's role cannot approve.
    """
    from apps.export.models import PLAN_TRANSITIONS, AuditLog, BlockManagerAssignment

    allowed = PLAN_TRANSITIONS.get(plan.status, [])
    if 'approved' not in allowed:
        raise ValueError(
            f"Cannot approve plan from status '{plan.status}'. "
            f"Allowed transitions: {allowed}"
        )

    role = getattr(user, 'role', None)
    if role not in _PLAN_APPROVE_ROLES:
        raise PermissionError(
            f"Role '{role}' is not allowed to approve harvest plans."
        )

    now = timezone.now()
    plan.status = 'approved'
    plan.approved_at = now
    plan.approved_by = user
    plan.save(update_fields=['status', 'approved_at', 'approved_by', 'updated_at'])

    AuditLog.objects.create(
        user=user,
        action='plan_approved',
        model_name='WeeklyHarvestPlan',
        object_id=plan.id,
        object_repr=str(plan),
        detail=f'Block {plan.block.code} W{plan.week_number}/{plan.year} approved',
    )

    # Notify the block's greenhouse managers.
    target_ids = list(
        BlockManagerAssignment.objects.filter(
            block_id=plan.block_id, is_active=True,
        ).values_list('user_id', flat=True)
    )
    _notify_plan_event(
        'plan_approved', plan, target_ids,
        f'Your Block {plan.block.code} W{plan.week_number} plan approved by {user.username}',
    )

    logger.info('HarvestPlan %s approved by %s', plan, user.username)


def reject_harvest_plan(plan: 'WeeklyHarvestPlan', user, rejection_note: str) -> None:
    """Reject a submitted harvest plan.

    Args:
        plan: WeeklyHarvestPlan instance in 'submitted' status.
        user: User performing the rejection (must be export_manager or director).
        rejection_note: Mandatory reason for rejection.

    Raises:
        ValueError: If the plan is not in 'submitted' status or note is empty.
        PermissionError: If the user's role cannot reject.
    """
    from apps.export.models import PLAN_TRANSITIONS, AuditLog, BlockManagerAssignment

    allowed = PLAN_TRANSITIONS.get(plan.status, [])
    if 'rejected' not in allowed:
        raise ValueError(
            f"Cannot reject plan from status '{plan.status}'. "
            f"Allowed transitions: {allowed}"
        )

    if not rejection_note or not rejection_note.strip():
        raise ValueError('Rejection note is required.')

    role = getattr(user, 'role', None)
    if role not in _PLAN_APPROVE_ROLES:
        raise PermissionError(
            f"Role '{role}' is not allowed to reject harvest plans."
        )

    now = timezone.now()
    plan.status = 'rejected'
    plan.rejected_at = now
    plan.rejected_by = user
    plan.rejection_note = rejection_note.strip()
    plan.save(update_fields=[
        'status', 'rejected_at', 'rejected_by', 'rejection_note', 'updated_at',
    ])

    AuditLog.objects.create(
        user=user,
        action='plan_rejected',
        model_name='WeeklyHarvestPlan',
        object_id=plan.id,
        object_repr=str(plan),
        detail=f'Block {plan.block.code} W{plan.week_number}/{plan.year} rejected: {rejection_note}',
    )

    # Notify the block's greenhouse managers.
    target_ids = list(
        BlockManagerAssignment.objects.filter(
            block_id=plan.block_id, is_active=True,
        ).values_list('user_id', flat=True)
    )
    _notify_plan_event(
        'plan_rejected', plan, target_ids,
        f'Your Block {plan.block.code} W{plan.week_number} plan rejected: {rejection_note}',
    )

    logger.info('HarvestPlan %s rejected by %s: %s', plan, user.username, rejection_note)
