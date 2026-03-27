import logging
from django.utils import timezone

from apps.export.models import Shipment, ShipmentStatusLog

logger = logging.getLogger(__name__)

# Status code → AD-1 denormalized timestamp field name on Shipment
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

# Allowed transitions: from_code → list of valid to_codes
# None key = shipment has no status yet (initial creation edge case)
TRANSITIONS = {
    None: ['yuklenme'],
    'yuklenme': ['gumruk_girish'],
    'gumruk_girish': ['gumruk_chykysh'],
    'gumruk_chykysh': ['yola_chykdy'],
    'yola_chykdy': ['serhet_tm'],
    'serhet_tm': ['serhet_gechdi'],
    'serhet_gechdi': ['barysh_gumrugi'],
    'barysh_gumrugi': ['yolda'],
    'yolda': ['bardy'],
    'bardy': ['satylyar'],
    'satylyar': ['satyldy'],
    'satyldy': ['hasabat'],
    'hasabat': ['tamamlandy'],
    'tamamlandy': [],
}


def transition_to(shipment: Shipment, new_status_code: str, user, comment: str = '') -> None:
    """Execute a validated status transition.

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
    """
    from apps.core.models import ShipmentStatusType

    current_code = shipment.status.code if shipment.status_id else None
    allowed = TRANSITIONS.get(current_code, [])

    if new_status_code not in allowed:
        raise ValueError(
            f'Cannot transition from {current_code!r} to {new_status_code!r}. '
            f'Allowed: {allowed}'
        )

    try:
        new_status = ShipmentStatusType.objects.get(code=new_status_code)
    except ShipmentStatusType.DoesNotExist:
        raise ValueError(f'Unknown status code: {new_status_code!r}')

    now = timezone.now()
    # updated_at uses auto_now=True — Django sets it automatically; do not include in update_fields
    update_fields = ['status', 'updated_by']

    # AD-1: set the denormalized timestamp for this status
    ts_field = STATUS_TIMESTAMP_MAP.get(new_status_code)
    if ts_field:
        setattr(shipment, ts_field, now)
        update_fields.append(ts_field)

    shipment.status = new_status
    shipment.updated_by = user
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
