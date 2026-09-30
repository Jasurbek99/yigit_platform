"""Join Planning trips to shipments and release them (spec §5).

Reacting to Planning's own changes lives in trip_changes.py (spec §6).
"""
from django.db import IntegrityError, transaction

from apps.core.models import User
from apps.export.models import AuditLog, Shipment
from apps.export.services.rollback import is_transport_locked, reopen_rule_task, rollback_to_draft
from apps.export.services.sheet_audit import diff_audit_rows, snapshot_fields
from apps.export.services.trip_lock import TRIP_LOCKED_FIELDS
from apps.transport.models import ExternalTrip, Trailer, TruckHead
from apps.transport.services.matching import normalize_plate
from apps.transport.services.trip_push import enqueue_push

# What a trip writes on its shipment: the locked set minus the gapy-only issue date.
TRANSPORT_FIELDS = tuple(f for f in TRIP_LOCKED_FIELDS if f != 'driver_passport_issue_date')
EMPTY_VALUES = {field: None for field in TRANSPORT_FIELDS}
# Our own columns cleared whenever a trip leaves its shipment.
RELEASED_TRIP_COLUMNS = {
    'shipment': None, 'conflict_note': None, 'conflict_kind': None, 'conflict_from': None,
    'conflict_to': None, 'last_pushed_export_code': None, 'last_pushed_loading': None,
}


class AssignmentError(ValueError):
    """A refused assignment; `code` is the API error key (frontend translates it)."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _match_id(model: type[TruckHead] | type[Trailer], plate: str) -> int | None:
    wanted = normalize_plate(plate)
    for pk, candidate in model.objects.values_list('pk', 'plate_number'):
        if normalize_plate(candidate) == wanted:
            return pk
    return None


def trip_values(trip: ExternalTrip) -> dict:
    """Shipment field values a trip stands for; fleet ids matched by plate keep GPS working."""
    return {
        'truck_plate': f'{trip.tractor_plate}/{trip.trailer_plate}',
        'driver_name': trip.driver_full_name,
        'driver_phone': trip.driver_phone,
        'driver_passport_serial': trip.driver_passport_number,
        'driver_passport_expiry': trip.driver_passport_expiry,
        'truck_head_id': _match_id(TruckHead, trip.tractor_plate),
        'trailer_id': _match_id(Trailer, trip.trailer_plate),
        'trip_id': trip.pk,
    }


def write_transport_fields(shipment: Shipment, values: dict, user: User) -> None:
    """Save like a Sheet edit: tasks resolve, auto-advance runs, AuditLog rows written."""
    fields = list(values)
    before = snapshot_fields(shipment, fields)
    for name, value in values.items():
        setattr(shipment, name, value)
    shipment.updated_by = user
    shipment.save()
    shipment.refresh_from_db()
    rows = diff_audit_rows(shipment, before, snapshot_fields(shipment, fields), user)
    if rows:
        AuditLog.objects.bulk_create(rows, batch_size=500)


def _check_shipment(shipment: Shipment) -> None:
    if shipment.is_gapy_satys:
        raise AssignmentError('gapy')
    if shipment.status.code != 'draft':
        raise AssignmentError('not_draft')
    if shipment.trip_id:
        raise AssignmentError('has_trip')


def _check_trip(trip: ExternalTrip, shipment: Shipment, confirm_unknown_country: bool) -> None:
    if trip.status in ExternalTrip.CLOSED_STATUSES:
        raise AssignmentError('trip_closed')
    if trip.shipment_id:
        raise AssignmentError('trip_taken')
    if trip.destination_country_code is None:
        if not confirm_unknown_country:
            raise AssignmentError('country_unknown')
    elif not shipment.country_id or shipment.country.code != trip.destination_country_code:
        raise AssignmentError('country_mismatch')


def assign_trip(trip: ExternalTrip, shipment: Shipment, user: User, *, confirm_unknown_country: bool = False) -> None:
    """Join a free trip to a Preparation shipment and tell Planning the code and loading place."""
    try:
        with transaction.atomic():
            trip = ExternalTrip.objects.select_for_update().get(pk=trip.pk)
            _check_shipment(shipment)
            _check_trip(trip, shipment, confirm_unknown_country)
            trip.shipment = shipment
            trip.save(update_fields=['shipment'])
            write_transport_fields(shipment, trip_values(trip), user)
    except IntegrityError as exc:  # OneToOne race: another assign won
        raise AssignmentError('trip_taken') from exc
    linked = ExternalTrip.objects.select_related('shipment__loading_location').get(pk=trip.pk)
    enqueue_push(linked, 'export-code')
    enqueue_push(linked, 'loading')


def release_trip(trip: ExternalTrip, shipment: Shipment, user: User) -> None:
    """Break the link: trip back to the free pool, shipment transport fields emptied."""
    for column, value in RELEASED_TRIP_COLUMNS.items():
        setattr(trip, column, value)
    trip.save(update_fields=list(RELEASED_TRIP_COLUMNS))
    write_transport_fields(shipment, dict(EMPTY_VALUES), user)
    # Only a Preparation shipment can get a new truck (the board lists drafts only);
    # on a departed one a reopened task could never be done.
    if shipment.status.code == 'draft':
        reopen_rule_task(shipment, 'tasks.choose_truck')


def fresh_trip(trip: ExternalTrip) -> ExternalTrip:
    """Re-read the trip and its shipment: callers may hold a stale copy."""
    return ExternalTrip.objects.select_related('shipment__status').get(pk=trip.pk)


def unassign_trip(trip: ExternalTrip, user: User) -> None:
    """Unlink by hand; a shipment past Preparation rolls back, a locked one refuses."""
    trip = fresh_trip(trip)
    shipment = trip.shipment
    if shipment is None:
        return
    if is_transport_locked(shipment):
        raise AssignmentError('locked')
    with transaction.atomic():
        if shipment.status.code != 'draft':
            rollback_to_draft(shipment, user, f'Truck unassigned by {user.username}')
        release_trip(trip, shipment, user)


def move_trip(trip: ExternalTrip, to_shipment: Shipment, user: User, *, confirm_unknown_country: bool = False) -> None:
    """Unassign from the current shipment and assign to another, as one transaction."""
    with transaction.atomic():
        unassign_trip(trip, user)
        assign_trip(fresh_trip(trip), to_shipment, user, confirm_unknown_country=confirm_unknown_country)


def release_cancelled_shipments() -> int:
    """Free trips whose shipment we cancelled; Planning is not told (no such operation).

    Both sides of the link are cleared with queryset updates: a cancelled
    shipment is terminal, so there are no tasks to resolve on it.
    """
    trips = ExternalTrip.objects.filter(shipment__status__code='cancelled')
    shipment_ids = list(trips.values_list('shipment_id', flat=True))
    Shipment.objects.filter(pk__in=shipment_ids).update(trip_id=None)
    return trips.update(**RELEASED_TRIP_COLUMNS)
