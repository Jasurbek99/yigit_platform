"""React to Planning changing or cancelling a linked trip (spec §6).

Conflicts are stored structured (kind + from/to) so the frontend can word them
in the viewer's language; `conflict_note` keeps an English line for the
shipment's comment trail.
"""
from django.db import transaction

from apps.core.models import User
from apps.export.models import Shipment, ShipmentComment
from apps.export.services.rollback import is_transport_locked, rollback_to_draft
from apps.transport.models import ExternalTrip
from apps.transport.services.trip_assignment import (
    EMPTY_VALUES, fresh_trip, release_trip, trip_values, write_transport_fields,
)
from apps.transport.services.trip_notify import notify_roles

NOTIFY_ROLES = ('export_manager',)
NOTIFY_ROLES_ON_ROLLBACK = ('export_manager', 'document_team')
# What a Planning change can alter on the shipment; the matched fleet ids are
# left out so a fleet-table edit on our side never reads as a Planning change.
COMPARED_FIELDS = ('truck_plate', 'driver_name', 'driver_passport_serial')
CANCELLED = 'CANCELLED'


def _describe(values: dict) -> str:
    return f"{values.get('truck_plate') or '—'}, {values.get('driver_name') or '—'}"


def _record(shipment: Shipment, user: User, message: str, roles: tuple[str, ...] = NOTIFY_ROLES) -> None:
    ShipmentComment.objects.create(shipment=shipment, user=user, content=message[:2000], is_system=True)
    notify_roles(roles, f'{shipment.shipment_code}: {message}', f'/shipments/{shipment.pk}')


def find_pending_changes() -> list[ExternalTrip]:
    """Linked trips whose Planning state is not yet reflected on the shipment.

    Compares state, not events: a change whose reaction failed (crash, closed
    season, time limit) is still visible here on the next tick. A trip with a
    recorded conflict waits for the export manager (Accept / Unlink).
    """
    pending = []
    trips = ExternalTrip.objects.filter(shipment__isnull=False, conflict_kind__isnull=True).select_related('shipment')
    for trip in trips:
        wanted = trip_values(trip)
        if trip.status == CANCELLED or any(
            getattr(trip.shipment, field) != wanted[field] for field in COMPARED_FIELDS
        ):
            pending.append(trip)
    return pending


def _record_conflict(trip: ExternalTrip, user: User, old: dict, new: dict) -> None:
    kind = 'cancelled' if trip.status == CANCELLED else 'changed'
    trip.conflict_kind, trip.conflict_from, trip.conflict_to = kind, _describe(old), _describe(new)
    trip.conflict_note = f'Planning {kind} the trip: {trip.conflict_from} → {trip.conflict_to}'
    trip.save(update_fields=['conflict_kind', 'conflict_from', 'conflict_to', 'conflict_note'])
    _record(trip.shipment, user, f'Not applied (shipment locked). {trip.conflict_note}')


def apply_trip_change(trip: ExternalTrip, user: User) -> str:
    """React to a real Planning change on a linked trip (spec §6 table); returns the outcome."""
    trip = fresh_trip(trip)
    shipment = trip.shipment
    if shipment is None:
        return 'unlinked'
    cancelled = trip.status == CANCELLED
    old = {field: getattr(shipment, field) for field in COMPARED_FIELDS}
    new = dict(EMPTY_VALUES) if cancelled else trip_values(trip)
    if is_transport_locked(shipment):
        _record_conflict(trip, user, old, new)
        return 'conflict'
    message = f"Planning {'cancelled' if cancelled else 'changed'} the trip: {_describe(old)} → {_describe(new)}"
    rolled_back = shipment.status.code != 'draft'
    with transaction.atomic():
        if rolled_back:
            rollback_to_draft(shipment, user, message)
        if cancelled:
            release_trip(trip, shipment, user)
        else:
            write_transport_fields(shipment, new, user)
    _record(shipment, user, message, NOTIFY_ROLES_ON_ROLLBACK if rolled_back else NOTIFY_ROLES)
    outcome = 'unlinked' if cancelled else 'applied'
    return f'{outcome}_rollback' if rolled_back else outcome


def accept_trip_change(trip: ExternalTrip, user: User) -> None:
    """Export manager overrides a conflict: take Planning's values, no status change."""
    trip = fresh_trip(trip)
    shipment = trip.shipment
    if shipment is None or not trip.conflict_kind:
        return
    values = dict(EMPTY_VALUES) if trip.status == CANCELLED else trip_values(trip)
    with transaction.atomic():
        if trip.status == CANCELLED:
            release_trip(trip, shipment, user)
        else:
            write_transport_fields(shipment, values, user)
            trip.conflict_kind = trip.conflict_from = trip.conflict_to = trip.conflict_note = None
            trip.save(update_fields=['conflict_kind', 'conflict_from', 'conflict_to', 'conflict_note'])
    _record(shipment, user, f'Accepted despite lock: {_describe(values)}')
