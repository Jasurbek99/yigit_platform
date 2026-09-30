"""Shipments carrying a Planning trip take their transport fields from it.

Spec: docs/superpowers/specs/2026-09-29-transport-trips-design.md D10. Lives in
export (no transport import): it only reads Shipment.trip_id. The transport
services write these fields through Shipment.save(), not the PATCH endpoint,
so the guard never blocks them.
"""
from collections.abc import Iterable

from apps.export.models import Shipment

TRIP_LOCKED_FIELDS = (
    'truck_plate', 'driver_name', 'driver_phone', 'driver_passport_serial',
    'driver_passport_issue_date', 'driver_passport_expiry', 'truck_head_id', 'trailer_id', 'trip_id',
)


def trip_locked_fields(shipment: Shipment, changed: Iterable[str]) -> list[str]:
    """The submitted fields a linked Planning trip owns (none for gapy or trip-less shipments)."""
    if not shipment.trip_id or shipment.is_gapy_satys:
        return []
    return [field for field in changed if field in TRIP_LOCKED_FIELDS]
