import logging
from datetime import timedelta

from celery import shared_task
from django.contrib.auth import get_user_model
from django.utils import timezone

from apps.export.models import Notification
from apps.transport.models import ExternalTrip, ExternalTripSyncState
from apps.transport.services.sync import sync_devices, sync_geofences, sync_positions
from apps.transport.services.sync_user import get_sync_user
from apps.transport.services.traccar_client import TraccarUnavailable
from apps.transport.services.trip_assignment import (
    apply_trip_change, find_pending_changes, release_cancelled_shipments,
)
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


AUTH_ALERT_EVERY = timedelta(hours=1)


def _notify_roles(roles: tuple[str, ...], message: str, link: str | None = None) -> None:
    users = get_user_model().objects.filter(role__in=roles, is_active=True).values_list('pk', flat=True)
    Notification.objects.bulk_create(
        [Notification(user_id=uid, kind='action_required', message=message[:500], link=link) for uid in users],
        batch_size=500,
    )


def _alert_auth_failure() -> None:
    """Planning refused our key: tell admins, at most once an hour."""
    state = ExternalTripSyncState.load()
    now = timezone.now()
    if state.last_auth_alert_at and now - state.last_auth_alert_at < AUTH_ALERT_EVERY:
        return
    state.last_auth_alert_at = now
    state.save(update_fields=['last_auth_alert_at'])
    _notify_roles(('admin',), 'Planning API rejected TRANSPORT_API_KEY (401) — trips are not syncing.', '/export/truck-board')


@shared_task(time_limit=110, soft_time_limit=100)
def poll_external_trips():
    """Pull Planning trips and bring every linked shipment in line (spec §4, §6).

    Trips of shipments we cancelled are freed first; then every linked trip
    whose Planning state is not yet on its shipment goes through
    apply_trip_change. That list is computed from state, not from this run's
    diff, so a reaction that failed last tick is retried. One bad shipment must
    not stop the rest.
    """
    try:
        sync_external_trips()
    except TripsApiUnavailable as exc:
        logger.warning('Planning trips poll failed: %s', exc)
        if exc.status_code == 401:
            _alert_auth_failure()
        return {'ok': False, 'changed': 0}
    release_cancelled_shipments()
    user = get_sync_user()
    pending = find_pending_changes()
    for trip in pending:
        try:
            apply_trip_change(trip, user)
        except Exception:
            logger.exception('apply_trip_change failed for trip %s', trip.integration_trip_id)
    try:
        push_pending_corrections()
    except Exception:
        logger.exception('push_pending_corrections failed')
    return {'ok': True, 'changed': len(pending)}


# Planning error codes after which a retry can never succeed.
GIVE_UP_CODES = {'TRIP_CLOSED': 'closed'}


def _record_push(trip: ExternalTrip, op: str, error: str | None, status: str) -> None:
    """One trip carries two ops; an ok on one must not wipe the other's error."""
    if error:
        trip.last_push_status, trip.last_push_error = status, error
    elif not trip.last_push_error or trip.last_push_error.startswith(f'{op}:'):
        trip.last_push_status, trip.last_push_error = status, None
    fields = ['last_push_status', 'last_push_error']
    if op == 'export-code' and status == 'error':
        # Forget what we "sent" so the next poll tick enqueues it again.
        trip.last_pushed_export_code = None
        fields.append('last_pushed_export_code')
    trip.save(update_fields=fields)


@shared_task(bind=True, max_retries=6, time_limit=60)
def push_trip_update(self, trip_id: int, op: str, body: dict, event_id: str):
    """POST one operation to Planning. Retries keep the same event_id (= Idempotency-Key)."""
    trip = ExternalTrip.objects.select_related('shipment').get(pk=trip_id)
    try:
        status_code, payload = get_trips_client().post_op(str(trip.integration_trip_id), op, body, event_id)
    except TripsApiUnavailable as exc:
        # Checked by hand: with exc= given, Celery re-raises exc itself (not
        # MaxRetriesExceededError) once retries run out.
        if self.request.retries >= self.max_retries:
            _record_push(trip, op, f'{op}: Planning unavailable ({exc})', 'error')
            return
        raise self.retry(exc=exc, countdown=min(30 * 2 ** self.request.retries, 1800))
    if status_code < 300:
        _record_push(trip, op, None, 'ok')
        return
    code = payload.get('code', str(status_code))
    if code == 'TRIP_CLOSED':
        _record_push(trip, op, None, GIVE_UP_CODES[code])
        return
    _record_push(trip, op, f'{op}: {code} {payload.get("detail", "")}'.strip(), 'error')
    if code == 'UNAUTHORIZED':
        _alert_auth_failure()
        return
    where = trip.shipment.shipment_code if trip.shipment else trip.tractor_plate
    link = f'/shipments/{trip.shipment_id}' if trip.shipment_id else '/export/truck-board'
    _notify_roles(('export_manager',), f'{where}: Planning refused {op} ({code})', link)
