"""What we tell Planning (MVP: export-code, loading) — spec §7.

Contract: planning-integration-api.v1.yaml, ExportCodeUpdate / LoadingUpdate
(both extend EventEnvelope: eventId, occurredAt, source=EXTERNAL).
"""
from datetime import datetime, timezone as dt_tz

from django.db import transaction

from apps.export.models import Shipment
from apps.transport.models import ExternalTrip


def build_event(trip: ExternalTrip, op: str, now_ms: int) -> tuple[str, str]:
    """eventId doubles as Idempotency-Key; a new enqueue gets a new key, a retry reuses it."""
    occurred = datetime.fromtimestamp(now_ms / 1000, tz=dt_tz.utc).isoformat()
    return f'ygt-{trip.integration_trip_id}-{op}-{now_ms}', occurred


def export_code_body(shipment: Shipment) -> dict | None:
    if not shipment.export_code:
        return None
    return {'exportCode': shipment.export_code}


def loading_body(shipment: Shipment) -> dict | None:
    """City = our loading location; place = the shipment's blocks, first one as ref."""
    sources = list(shipment.block_sources.select_related('block').order_by('id'))
    if not sources or not shipment.loading_location_id:
        return None
    codes = [s.block.code for s in sources]
    return {'city': shipment.loading_location.name, 'place': {'ref': codes[0], 'name': ', '.join(codes)}}


BODY_BUILDERS = {'export-code': export_code_body, 'loading': loading_body}


def enqueue_push(trip: ExternalTrip, op: str) -> None:
    """Build the body now (frozen occurredAt/eventId) and send after commit."""
    from apps.transport.tasks import push_trip_update

    body = BODY_BUILDERS[op](trip.shipment)
    if body is None:
        return
    now_ms = int(datetime.now(tz=dt_tz.utc).timestamp() * 1000)
    event_id, occurred_at = build_event(trip, op, now_ms)
    body = {'eventId': event_id, 'occurredAt': occurred_at, 'source': 'EXTERNAL', **body}
    if op == 'export-code':
        trip.last_pushed_export_code = trip.shipment.export_code
        trip.save(update_fields=['last_pushed_export_code'])
    trip_id = trip.pk
    transaction.on_commit(lambda: push_trip_update.delay(trip_id, op, body, event_id))


def push_pending_corrections() -> int:
    """Linked trips whose export code changed since our last push get one new push.

    Runs every poll tick, so an export-code edit on the Sheet reaches Planning
    within ~2 minutes without export importing transport. Compares against
    last_pushed_export_code (set by enqueue_push), NOT trip_number: mock never
    echoes, and live echoes late — comparing to trip_number would re-push forever.
    A DUPLICATE_EXPORT_CODE error recovers by itself once the manager fixes the code.
    """
    pushed = 0
    trips = ExternalTrip.objects.filter(shipment__isnull=False).exclude(
        status__in=ExternalTrip.CLOSED_STATUSES).select_related('shipment')
    for trip in trips:
        code = trip.shipment.export_code
        if code and code != trip.last_pushed_export_code:
            enqueue_push(trip, 'export-code')
            pushed += 1
    return pushed
