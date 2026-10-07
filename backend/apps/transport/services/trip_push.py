"""What we tell Planning — spec §7 and docs/superpowers/specs/2026-10-07-planning-write-ops-design.md.

Contract: planning-integration-api.v1.yaml. Every body extends EventEnvelope
(eventId, occurredAt, source=EXTERNAL). Bodies and the op table: trip_push_ops.py.
"""
import logging
from datetime import datetime, timezone as dt_tz

from django.db import transaction

from apps.transport.models import ExternalTrip
from apps.transport.services.trip_push_ops import PUSH_OPS, REJECTION_OP, PushOp

logger = logging.getLogger(__name__)


def build_event(trip: ExternalTrip, op: str, now_ms: int) -> tuple[str, str]:
    """eventId doubles as Idempotency-Key; a new enqueue gets a new key, a retry reuses it."""
    occurred = datetime.fromtimestamp(now_ms / 1000, tz=dt_tz.utc).isoformat()
    return f'ygt-{trip.integration_trip_id}-{op}-{now_ms}', occurred


def _envelope(trip: ExternalTrip, op: str, occurred_at: str | None = None) -> tuple[str, dict]:
    """(eventId, EventEnvelope fields) for a new enqueue; occurred_at defaults to now."""
    now_ms = int(datetime.now(tz=dt_tz.utc).timestamp() * 1000)
    event_id, now_iso = build_event(trip, op, now_ms)
    return event_id, {'eventId': event_id, 'occurredAt': occurred_at or now_iso, 'source': 'EXTERNAL'}


def _queue_after_commit(trip_id: int, op: str, body: dict, event_id: str, sent_column: str | None = None) -> None:
    """POST after the caller's commit; a broker outage must not fail the request."""
    from apps.transport.tasks import push_trip_update

    def send() -> None:
        try:
            push_trip_update.delay(trip_id, op, body, event_id)
        except Exception:  # kombu/redis raise different types; any failure means "not queued"
            logger.warning('Could not queue Planning %s push for trip %s', op, trip_id, exc_info=True)
            if sent_column:
                # Forget what we "sent" — the next poll tick enqueues it again.
                ExternalTrip.objects.filter(pk=trip_id).update(**{sent_column: None})
            else:
                # One-shot op: nothing re-sends it, so show it on the board.
                ExternalTrip.objects.filter(pk=trip_id).update(
                    last_push_status='error', last_push_error=f'{op}: PLANNING_UNAVAILABLE')

    transaction.on_commit(send)


def _value_for(trip: ExternalTrip, push: PushOp) -> tuple[dict | None, str | None]:
    """(body, signature) of one op for a linked trip; (None, None) when there is nothing to send.

    A time stamped before the trip joined its shipment belongs to an earlier
    truck (e.g. the gate arrival of the truck this one replaced), so it is not
    sent. linked_at NULL (links older than the column) filters nothing.
    """
    shipment = trip.shipment
    if push.stamp_field and trip.linked_at:
        stamp = getattr(shipment, push.stamp_field)
        if stamp and stamp < trip.linked_at:
            return None, None
    return push.build_body(shipment), push.signature(shipment)


def enqueue_push(trip: ExternalTrip, op: str) -> None:
    """Build the body now (frozen occurredAt/eventId), remember what was sent, POST after commit."""
    push = PUSH_OPS[op]
    body, signature = _value_for(trip, push)
    if body is None:
        return
    occurred_at = getattr(trip.shipment, push.stamp_field).isoformat() if push.stamp_field else None
    event_id, envelope = _envelope(trip, op, occurred_at)
    setattr(trip, push.sent_column, signature)
    trip.save(update_fields=[push.sent_column])
    _queue_after_commit(trip.pk, op, {**envelope, **body}, event_id, push.sent_column)


def push_pending_corrections() -> int:
    """Linked trips whose pushed values changed since our last push get one new push per op.

    Runs every poll tick, so an edit on the Sheet reaches Planning within ~2
    minutes without export importing transport. Compares against what we last
    enqueued (last_pushed_*), NOT against Planning's echo: mock never echoes and
    live echoes late — that comparison would re-push forever. A refused push
    recovers by itself once the manager fixes the value.
    """
    pushed = 0
    trips = ExternalTrip.objects.filter(shipment__isnull=False).exclude(
        status__in=ExternalTrip.CLOSED_STATUSES,
    ).select_related(
        'shipment__loading_location', 'shipment__city', 'shipment__product_type',
    ).prefetch_related('shipment__block_sources__block')
    for trip in trips:
        for op, push in PUSH_OPS.items():
            _, current = _value_for(trip, push)
            if current and current != getattr(trip, push.sent_column):
                enqueue_push(trip, op)
                pushed += 1
    return pushed


def enqueue_rejection(trip: ExternalTrip, reason: str) -> None:
    """One-shot TripRejection push: not in the correction loop, so no sent_column."""
    event_id, envelope = _envelope(trip, REJECTION_OP)
    _queue_after_commit(trip.pk, REJECTION_OP, {**envelope, 'reason': reason}, event_id)
