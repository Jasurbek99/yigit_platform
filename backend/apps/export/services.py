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
