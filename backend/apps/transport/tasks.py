import logging

from celery import shared_task

from apps.transport.services.sync import sync_devices, sync_geofences, sync_positions
from apps.transport.services.traccar_client import TraccarUnavailable
from apps.transport.services.sync_user import get_sync_user
from apps.transport.services.trip_assignment import apply_trip_change, release_cancelled_shipments
from apps.transport.services.trip_sync import sync_external_trips
from apps.transport.services.trips_client import TripsApiUnavailable

logger = logging.getLogger(__name__)


@shared_task(time_limit=110, soft_time_limit=100)
def poll_traccar():
    """Beat-scheduled: refresh devices, geofence names + latest positions from Traccar.

    time_limit/soft_time_limit are scoped to this task (not global settings)
    and kept under the 120s beat interval so a hung run is killed before the
    next tick fires — two overlapping runs would hit the same
    update_or_create rows on MSSQL and risk deadlocks/IntegrityError.

    Caveat: this overlap guard relies on Celery's prefork/billiard supervisor
    (hard `time_limit`) and SIGUSR1 (`soft_time_limit`), which only work under
    the Linux prefork pool used in production. The Windows `-P solo` dev pool
    does not enforce either limit, so avoid overlapping runs there by not
    lowering the beat interval.
    """
    try:
        devices = sync_devices()
        geofences = sync_geofences()  # before positions: they reference geofence rows
        positions = sync_positions()
    except TraccarUnavailable as exc:
        logger.warning('Traccar unavailable, kept last-known: %s', exc)
        return {'devices': 0, 'geofences': 0, 'positions': 0, 'ok': False}
    return {'devices': devices, 'geofences': geofences, 'positions': positions, 'ok': True}


@shared_task(time_limit=110, soft_time_limit=100)
def poll_external_trips():
    """Pull changed Planning trips and react to real changes (spec §4, §6).

    Trips of shipments we cancelled are freed first; then every linked trip
    whose truck/driver changed or that Planning cancelled goes through
    apply_trip_change. One bad shipment must not stop the rest.
    """
    try:
        changed = sync_external_trips()
    except TripsApiUnavailable as exc:
        logger.warning('Planning trips poll failed: %s', exc)
        return {'ok': False, 'changed': 0}
    release_cancelled_shipments()
    user = get_sync_user()
    for trip in changed:
        try:
            apply_trip_change(trip, user)
        except Exception:
            logger.exception('apply_trip_change failed for trip %s', trip.integration_trip_id)
    return {'ok': True, 'changed': len(changed)}
