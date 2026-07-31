import logging

from celery import shared_task

from apps.transport.services.sync import sync_devices, sync_positions
from apps.transport.services.traccar_client import TraccarUnavailable

logger = logging.getLogger(__name__)


@shared_task(time_limit=110, soft_time_limit=100)
def poll_traccar():
    """Beat-scheduled: refresh device metadata + latest positions from Traccar.

    time_limit/soft_time_limit are scoped to this task (not global settings)
    and kept under the 120s beat interval so a hung run is killed before the
    next tick fires — two overlapping runs would hit the same
    update_or_create rows on MSSQL and risk deadlocks/IntegrityError.
    """
    try:
        devices = sync_devices()
        positions = sync_positions()
    except TraccarUnavailable as exc:
        logger.warning('Traccar unavailable, kept last-known: %s', exc)
        return {'devices': 0, 'positions': 0, 'ok': False}
    return {'devices': devices, 'positions': positions, 'ok': True}
