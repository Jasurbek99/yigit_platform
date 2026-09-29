import logging

from celery import shared_task

from apps.transport.services.sync import sync_devices, sync_geofences, sync_positions
from apps.transport.services.traccar_client import TraccarUnavailable
from apps.transport.services.sync_user import get_sync_user
from apps.transport.services.trip_assignment import apply_trip_change, release_cancelled_shipments
from apps.transport.models import ExternalTrip
from apps.transport.services.trip_push import push_pending_corrections
from apps.transport.services.trip_sync import sync_external_trips
from apps.transport.services.trips_client import TripsApiUnavailable, get_trips_client

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
    try:
        push_pending_corrections()
    except Exception:
        logger.exception('push_pending_corrections failed')
    return {'ok': True, 'changed': len(changed)}


# Planning error codes after which a retry can never succeed.
GIVE_UP_CODES = {'TRIP_CLOSED': 'closed'}


@shared_task(bind=True, max_retries=6, time_limit=60)
def push_trip_update(self, trip_id: int, op: str, body: dict, event_id: str):
    """POST one operation to Planning. Retries keep the same event_id (= Idempotency-Key)."""
    trip = ExternalTrip.objects.get(pk=trip_id)
    try:
        status_code, payload = get_trips_client().post_op(str(trip.integration_trip_id), op, body, event_id)
    except TripsApiUnavailable as exc:
        raise self.retry(exc=exc, countdown=min(30 * 2 ** self.request.retries, 1800))
    if status_code < 300:
        trip.last_push_status, trip.last_push_error = 'ok', None
    else:
        code = payload.get('code', str(status_code))
        trip.last_push_status = GIVE_UP_CODES.get(code, 'error')
        trip.last_push_error = None if code == 'TRIP_CLOSED' else f'{op}: {code} {payload.get("detail", "")}'.strip()
        if code == 'UNAUTHORIZED':
            logger.error('Planning rejected our key on %s', op)
    trip.save(update_fields=['last_push_status', 'last_push_error'])
