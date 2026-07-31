import logging

from celery import shared_task

from apps.transport.services.sync import sync_devices, sync_positions
from apps.transport.services.traccar_client import TraccarUnavailable

logger = logging.getLogger(__name__)


@shared_task
def poll_traccar():
    """Beat-scheduled: refresh device metadata + latest positions from Traccar."""
    try:
        devices = sync_devices()
        positions = sync_positions()
    except TraccarUnavailable as exc:
        logger.warning('Traccar unavailable, kept last-known: %s', exc)
        return {'devices': 0, 'positions': 0, 'ok': False}
    return {'devices': devices, 'positions': positions, 'ok': True}
