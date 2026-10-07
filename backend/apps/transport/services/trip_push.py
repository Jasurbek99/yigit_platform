"""What we tell Planning — spec §7 and docs/superpowers/specs/2026-10-07-planning-write-ops-design.md.

Contract: planning-integration-api.v1.yaml. Every body extends EventEnvelope
(eventId, occurredAt, source=EXTERNAL).
"""
import logging
from collections.abc import Callable
from datetime import datetime, timezone as dt_tz
from typing import NamedTuple

from django.db import transaction

from apps.export.models import Shipment
from apps.transport.models import ExternalTrip

logger = logging.getLogger(__name__)

PLACE_NAME_MAX = 256  # contract: place.name maxLength


def build_event(trip: ExternalTrip, op: str, now_ms: int) -> tuple[str, str]:
    """eventId doubles as Idempotency-Key; a new enqueue gets a new key, a retry reuses it."""
    occurred = datetime.fromtimestamp(now_ms / 1000, tz=dt_tz.utc).isoformat()
    return f'ygt-{trip.integration_trip_id}-{op}-{now_ms}', occurred


def _place(shipment: Shipment) -> dict | None:
    """The blocks as one loading place: names joined, first code as ref."""
    # .all() + sort in Python so a prefetch (push_pending_corrections) is reused.
    sources = sorted(shipment.block_sources.all(), key=lambda source: source.id)
    if not sources:
        return None
    names = [s.block.name or s.block.code for s in sources]
    return {'ref': sources[0].block.code, 'name': ', '.join(names)[:PLACE_NAME_MAX]}


def export_code_body(shipment: Shipment) -> dict | None:
    """ExportCodeUpdate body, or None while the shipment has no export code."""
    if not shipment.export_code:
        return None
    return {'exportCode': shipment.export_code}


def loading_body(shipment: Shipment) -> dict | None:
    """LoadingUpdate body: city = our loading location; place = the blocks."""
    place = _place(shipment)
    if place is None or not shipment.loading_location_id:
        return None
    return {'city': shipment.loading_location.name, 'place': place}


def destination_city_body(shipment: Shipment) -> dict | None:
    """DestinationCityUpdate body; Planning checks the city is in the trip's country."""
    if not shipment.city_id:
        return None
    return {'city': shipment.city.name}


def cargo_body(shipment: Shipment) -> dict | None:
    """CargoUpdate body: the product's Russian name, our code as cargoRef."""
    product = shipment.product_type
    if product is None:
        return None
    body = {'cargoName': product.name_ru or product.name}
    if product.code:
        body['cargoRef'] = product.code
    return body


def export_code_signature(shipment: Shipment) -> str | None:
    return shipment.export_code or None


def loading_signature(shipment: Shipment) -> str | None:
    """What a `loading` push would say, as one comparable string."""
    body = loading_body(shipment)
    return f"{body['city']}|{body['place']['name']}" if body else None


def destination_city_signature(shipment: Shipment) -> str | None:
    body = destination_city_body(shipment)
    return body['city'] if body else None


def cargo_signature(shipment: Shipment) -> str | None:
    body = cargo_body(shipment)
    return f"{body['cargoName']}|{body.get('cargoRef', '')}" if body else None


def _event_body(event_type: str, field: str) -> Callable[[Shipment], dict | None]:
    """LoadingPlaceEvent body for one operator-entered time on the shipment."""
    def build(shipment: Shipment) -> dict | None:
        if getattr(shipment, field) is None:
            return None
        body = {'type': event_type}
        place = _place(shipment)
        if place:
            body['place'] = place
        return body
    return build


def _stamp(field: str) -> Callable[[Shipment], str | None]:
    """Signature of a timestamp op: the operator-entered time itself."""
    def read(shipment: Shipment) -> str | None:
        value = getattr(shipment, field)
        return value.isoformat() if value else None
    return read


def customs_body(shipment: Shipment) -> dict | None:
    """CustomsUpdate body once the truck has passed destination-country customs.

    customs_entry_at is «Таможня пройдена» (sales_rep, step barysh_gumrugi);
    customs_exit_at is the Turkmen export customs and is not Planning's concern.
    """
    return {'cleared': True} if shipment.customs_entry_at else None


class PushOp(NamedTuple):
    build_body: Callable[[Shipment], dict | None]
    signature: Callable[[Shipment], str | None]
    marker: str  # ExternalTrip column holding the last enqueued signature
    path: str  # URL segment under /trips/{id}/
    # Operator-entered time this op reports: it is the occurredAt (None → time of
    # enqueue) and an op whose time is older than trip.linked_at is not sent.
    stamp_field: str | None = None


PUSH_OPS: dict[str, PushOp] = {
    'export-code': PushOp(export_code_body, export_code_signature, 'last_pushed_export_code', 'export-code'),
    'loading': PushOp(loading_body, loading_signature, 'last_pushed_loading', 'loading'),
    'destination-city': PushOp(
        destination_city_body, destination_city_signature, 'last_pushed_destination_city', 'destination-city',
    ),
    'cargo': PushOp(cargo_body, cargo_signature, 'last_pushed_cargo', 'cargo'),
    # Events and customs carry the operator's own time as occurredAt; Planning orders
    # its history by it. Clearing a time sends nothing (the contract cannot retract).
    'event-arrived': PushOp(_event_body('ARRIVED_AT_PLACE', 'greenhouse_arrived_at'),
                            _stamp('greenhouse_arrived_at'), 'last_pushed_arrived', 'events',
                            'greenhouse_arrived_at'),
    'event-loaded': PushOp(_event_body('LOADED', 'loading_ended_at'),
                           _stamp('loading_ended_at'), 'last_pushed_loaded', 'events', 'loading_ended_at'),
    'event-departed': PushOp(_event_body('DEPARTED_FROM_PLACE', 'departed_at'),
                             _stamp('departed_at'), 'last_pushed_departed', 'events', 'departed_at'),
    'customs': PushOp(customs_body, _stamp('customs_entry_at'), 'last_pushed_customs', 'customs',
                      'customs_entry_at'),
}


def _queue_after_commit(trip_id: int, op: str, body: dict, event_id: str, marker: str | None = None) -> None:
    """POST after the caller's commit; a broker outage must not fail the request."""
    from apps.transport.tasks import push_trip_update

    def send() -> None:
        try:
            push_trip_update.delay(trip_id, op, body, event_id)
        except Exception:  # kombu/redis raise different types; any failure means "not queued"
            logger.warning('Could not queue Planning %s push for trip %s', op, trip_id, exc_info=True)
            if marker:
                # Forget the marker — the next poll tick enqueues it again.
                ExternalTrip.objects.filter(pk=trip_id).update(**{marker: None})
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
    now_ms = int(datetime.now(tz=dt_tz.utc).timestamp() * 1000)
    event_id, occurred_at = build_event(trip, op, now_ms)
    if push.stamp_field:
        occurred_at = getattr(trip.shipment, push.stamp_field).isoformat()
    body = {'eventId': event_id, 'occurredAt': occurred_at, 'source': 'EXTERNAL', **body}
    setattr(trip, push.marker, signature)
    trip.save(update_fields=[push.marker])
    _queue_after_commit(trip.pk, op, body, event_id, push.marker)


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
            if current and current != getattr(trip, push.marker):
                enqueue_push(trip, op)
                pushed += 1
    return pushed


def enqueue_rejection(trip: ExternalTrip, reason: str) -> None:
    """One-shot TripRejection push: not in the correction loop, so no marker."""
    now_ms = int(datetime.now(tz=dt_tz.utc).timestamp() * 1000)
    event_id, occurred_at = build_event(trip, 'rejection', now_ms)
    body = {'eventId': event_id, 'occurredAt': occurred_at, 'source': 'EXTERNAL', 'reason': reason}
    _queue_after_commit(trip.pk, 'rejection', body, event_id)
