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
    """ExportCodeUpdate body, or None while the shipment has no export code."""
    if not shipment.export_code:
        return None
    return {'exportCode': shipment.export_code}


def loading_body(shipment: Shipment) -> dict | None:
    """LoadingUpdate body: city = our loading location; place = the blocks (names), first code as ref."""
    # .all() + sort in Python so a prefetch (push_pending_corrections) is reused.
    sources = sorted(shipment.block_sources.all(), key=lambda source: source.id)
    if not sources or not shipment.loading_location_id:
        return None
    names = [s.block.name or s.block.code for s in sources]
    return {'city': shipment.loading_location.name, 'place': {'ref': sources[0].block.code, 'name': ', '.join(names)}}


def export_code_signature(shipment: Shipment) -> str | None:
    return shipment.export_code or None


def loading_signature(shipment: Shipment) -> str | None:
    """What a `loading` push would say, as one comparable string."""
    body = loading_body(shipment)
    return f"{body['city']}|{body['place']['name']}" if body else None


# op → (body builder, signature of what was sent, ExternalTrip column holding it)
PUSH_OPS = {
    'export-code': (export_code_body, export_code_signature, 'last_pushed_export_code'),
    'loading': (loading_body, loading_signature, 'last_pushed_loading'),
}


def enqueue_push(trip: ExternalTrip, op: str) -> None:
    """Build the body now (frozen occurredAt/eventId), remember what was sent, POST after commit."""
    from apps.transport.tasks import push_trip_update

    build_body, signature, marker = PUSH_OPS[op]
    body = build_body(trip.shipment)
    if body is None:
        return
    now_ms = int(datetime.now(tz=dt_tz.utc).timestamp() * 1000)
    event_id, occurred_at = build_event(trip, op, now_ms)
    body = {'eventId': event_id, 'occurredAt': occurred_at, 'source': 'EXTERNAL', **body}
    setattr(trip, marker, signature(trip.shipment))
    trip.save(update_fields=[marker])
    trip_id = trip.pk
    transaction.on_commit(lambda: push_trip_update.delay(trip_id, op, body, event_id))


def push_pending_corrections() -> int:
    """Linked trips whose export code or loading place changed since our last push get one new push.

    Runs every poll tick, so an edit on the Sheet reaches Planning within ~2
    minutes without export importing transport. Compares against what we last
    enqueued (last_pushed_*), NOT against Planning's echo: mock never echoes and
    live echoes late — that comparison would re-push forever. A refused push
    recovers by itself once the manager fixes the value.
    """
    pushed = 0
    trips = ExternalTrip.objects.filter(shipment__isnull=False).exclude(
        status__in=ExternalTrip.CLOSED_STATUSES,
    ).select_related('shipment__loading_location').prefetch_related('shipment__block_sources__block')
    for trip in trips:
        for op, (_, signature, marker) in PUSH_OPS.items():
            current = signature(trip.shipment)
            if current and current != getattr(trip, marker):
                enqueue_push(trip, op)
                pushed += 1
    return pushed
