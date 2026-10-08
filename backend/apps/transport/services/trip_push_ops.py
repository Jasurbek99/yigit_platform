"""The Planning operations we push: body builders, signatures, and the PUSH_OPS table.

Contract: planning-integration-api.v1.yaml. Sending and queueing live in trip_push.py.
"""
from collections.abc import Callable
from typing import NamedTuple

from apps.export.models import Shipment

PLACE_NAME_MAX = 256  # contract: place.name maxLength
REJECTION_OP = 'rejection'  # one-shot TripRejection push; not a PUSH_OPS entry


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


def customs_body(shipment: Shipment) -> dict | None:
    """CustomsUpdate body once the truck has passed destination-country customs.

    customs_entry_at is «Таможня пройдена» (sales_rep, step barysh_gumrugi);
    customs_exit_at is the Turkmen export customs and is not Planning's concern.
    """
    return {'cleared': True} if shipment.customs_entry_at else None


def export_code_signature(shipment: Shipment) -> str | None:
    """What an `export-code` push would say, as one comparable string."""
    return shipment.export_code or None


def loading_signature(shipment: Shipment) -> str | None:
    """What a `loading` push would say, as one comparable string."""
    body = loading_body(shipment)
    return f"{body['city']}|{body['place']['name']}" if body else None


def destination_city_signature(shipment: Shipment) -> str | None:
    """What a `destination-city` push would say, as one comparable string."""
    body = destination_city_body(shipment)
    return body['city'] if body else None


def cargo_signature(shipment: Shipment) -> str | None:
    """What a `cargo` push would say, as one comparable string."""
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


def _iso_time(field: str) -> Callable[[Shipment], str | None]:
    """Signature of a timestamp op: the operator-entered time itself, as ISO text."""
    def read(shipment: Shipment) -> str | None:
        value = getattr(shipment, field)
        return value.isoformat() if value else None
    return read


class PushOp(NamedTuple):
    build_body: Callable[[Shipment], dict | None]
    signature: Callable[[Shipment], str | None]
    sent_column: str  # ExternalTrip column holding the last enqueued signature
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
                            _iso_time('greenhouse_arrived_at'), 'last_pushed_arrived', 'events',
                            'greenhouse_arrived_at'),
    'event-loaded': PushOp(_event_body('LOADED', 'loading_ended_at'),
                           _iso_time('loading_ended_at'), 'last_pushed_loaded', 'events', 'loading_ended_at'),
    'event-departed': PushOp(_event_body('DEPARTED_FROM_PLACE', 'departed_at'),
                             _iso_time('departed_at'), 'last_pushed_departed', 'events', 'departed_at'),
    'customs': PushOp(customs_body, _iso_time('customs_entry_at'), 'last_pushed_customs', 'customs',
                      'customs_entry_at'),
}


def push_path(op: str) -> str:
    """URL segment under /trips/{id}/ for an op: the table path, or the op itself (rejection)."""
    return PUSH_OPS[op].path if op in PUSH_OPS else op


def is_rejection_error(error: str | None) -> bool:
    """True when a trip's last_push_error came from a failed rejection push."""
    return bool(error) and error.startswith(f'{REJECTION_OP}:')
