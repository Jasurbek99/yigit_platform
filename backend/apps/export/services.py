import logging
from typing import Optional

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

    # Quota usage is now computed on-the-fly in the quota dashboard analytics endpoint.
    # No per-quota used_kg tracking needed.


def create_shipment(
    cargo_code: str,
    date,
    user,
    country=None,
    customer=None,
    season=None,
) -> Shipment:
    """Create a new shipment at step 1 (yuklenme) and write the initial audit trail.

    Resolves the active season when none is provided. Writes the loading_started_at
    AD-1 denormalized timestamp directly — transition_to() cannot be used here because
    the shipment is created with status already set to step 1.

    Args:
        cargo_code: Validated cargo code string in DDMM###/YY format.
        date: Shipment date (datetime.date instance).
        user: User performing the creation (core.User instance).
        country: Optional core.Country FK instance.
        customer: Optional core.Customer FK instance.
        season: Optional core.Season FK instance. If None, the active season is resolved.

    Returns:
        The newly created Shipment instance with loading_started_at set.

    Raises:
        ValueError: If no active season exists and none was provided, or if no
                    yuklenme status (step_order=1) is configured in the DB.
    """
    from apps.core.models import Season, ShipmentStatusType

    # Resolve season from the active season when the caller did not supply one.
    resolved_season: Optional[object] = season
    if resolved_season is None:
        resolved_season = Season.objects.filter(is_active=True).first()
        if resolved_season is None:
            raise ValueError('No active season found. Provide a season in the request.')

    first_status = ShipmentStatusType.objects.filter(step_order=1).first()
    if first_status is None:
        raise ValueError('No yuklenme status configured. Run seed_data first.')

    shipment = Shipment.objects.create(
        cargo_code=cargo_code,
        date=date,
        country=country,
        customer=customer,
        season=resolved_season,
        status=first_status,
        created_by=user,
    )

    # AD-1: write loading_started_at directly on creation — this is the creation
    # equivalent of the first transition. Only transition_to() may update this field
    # after initial creation.
    shipment.loading_started_at = timezone.now()
    shipment.save(update_fields=['loading_started_at'])

    ShipmentStatusLog.objects.create(
        shipment=shipment,
        status=first_status,
        changed_by=user,
        comment='Shipment created',
    )

    logger.info('Shipment %s created by %s', shipment.cargo_code, user.username)
    return shipment


# ---------------------------------------------------------------------------
# Weekly Local Sell Plan — workflow
# ---------------------------------------------------------------------------

_SELL_PLAN_DAYS = ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday')


def submit_local_sell_plan(plan: 'WeeklyLocalSellPlan', user: 'User') -> None:
    """Submit a local sell plan for approval."""
    from apps.export.models import LOCAL_SELL_TRANSITIONS
    from apps.core.services_workflow import validate_transition, apply_status_change, create_audit_entry

    validate_transition(plan.status, 'submitted', LOCAL_SELL_TRANSITIONS)

    has_plan = any(getattr(plan, f'{d}_plan_kg', 0) > 0 for d in _SELL_PLAN_DAYS)
    if not has_plan:
        raise ValueError('Plan must have at least one day with a positive plan_kg.')

    update_fields = apply_status_change(
        plan, 'submitted', user,
        timestamp_field='submitted_at', user_field='submitted_by',
        clear_fields=['rejected_at', 'rejected_by', 'rejection_note'],
    )
    plan.save(update_fields=update_fields)

    create_audit_entry(
        user, 'local_sell_submitted', 'WeeklyLocalSellPlan',
        plan.id, str(plan), f'W{plan.week_number}/{plan.year} submitted',
    )
    logger.info('LocalSellPlan %s submitted by %s', plan, user.username)


def approve_local_sell_plan(plan: 'WeeklyLocalSellPlan', user: 'User') -> None:
    """Approve a submitted local sell plan."""
    from apps.export.models import LOCAL_SELL_TRANSITIONS
    from apps.core.services_workflow import validate_transition, apply_status_change, create_audit_entry

    validate_transition(plan.status, 'approved', LOCAL_SELL_TRANSITIONS)

    update_fields = apply_status_change(
        plan, 'approved', user,
        timestamp_field='approved_at', user_field='approved_by',
    )
    plan.save(update_fields=update_fields)

    create_audit_entry(
        user, 'local_sell_approved', 'WeeklyLocalSellPlan',
        plan.id, str(plan), f'W{plan.week_number}/{plan.year} approved',
    )
    logger.info('LocalSellPlan %s approved by %s', plan, user.username)


def reject_local_sell_plan(plan: 'WeeklyLocalSellPlan', user: 'User', rejection_note: str) -> None:
    """Reject a submitted local sell plan."""
    from apps.export.models import LOCAL_SELL_TRANSITIONS
    from apps.core.services_workflow import validate_transition, apply_status_change, create_audit_entry

    validate_transition(plan.status, 'rejected', LOCAL_SELL_TRANSITIONS)

    if not rejection_note or not rejection_note.strip():
        raise ValueError('Rejection note is required.')

    update_fields = apply_status_change(
        plan, 'rejected', user,
        timestamp_field='rejected_at', user_field='rejected_by',
    )
    plan.rejection_note = rejection_note.strip()
    update_fields.append('rejection_note')
    plan.save(update_fields=update_fields)

    create_audit_entry(
        user, 'local_sell_rejected', 'WeeklyLocalSellPlan',
        plan.id, str(plan), f'W{plan.week_number}/{plan.year} rejected: {rejection_note}',
    )
    logger.info('LocalSellPlan %s rejected by %s: %s', plan, user.username, rejection_note)
