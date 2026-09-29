"""Join Planning trips to shipments (spec §5) and react to their changes (spec §6)."""
import logging

from django.db import IntegrityError, transaction

from apps.export.models import AuditLog, Shipment
from apps.export.services.sheet_audit import diff_audit_rows, snapshot_fields
from apps.transport.models import ExternalTrip, Trailer, TruckHead
from apps.transport.services.matching import normalize_plate

logger = logging.getLogger(__name__)

TRANSPORT_FIELDS = (
    'truck_plate', 'driver_name', 'driver_phone', 'driver_passport_serial',
    'driver_passport_issue_date', 'truck_head_id', 'trailer_id', 'trip_id',
)


class AssignmentError(ValueError):
    def __init__(self, code: str, message: str = ''):
        super().__init__(message or code)
        self.code = code


def _match_id(model, plate: str) -> int | None:
    wanted = normalize_plate(plate)
    for pk, candidate in model.objects.values_list('pk', 'plate_number'):
        if normalize_plate(candidate) == wanted:
            return pk
    return None


def trip_values(trip: ExternalTrip) -> dict:
    return {
        'truck_plate': f'{trip.tractor_plate}/{trip.trailer_plate}',
        'driver_name': trip.driver_full_name,
        'driver_phone': trip.driver_phone,
        'driver_passport_serial': trip.driver_passport_number,
        # Spec D3: Planning has no issue date; expiry stands in until it does.
        'driver_passport_issue_date': trip.driver_passport_expiry,
        'truck_head_id': _match_id(TruckHead, trip.tractor_plate),
        'trailer_id': _match_id(Trailer, trip.trailer_plate),
        'trip_id': trip.pk,
    }


EMPTY_VALUES = {field: None for field in TRANSPORT_FIELDS}


def write_transport_fields(shipment: Shipment, values: dict, user) -> None:
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


def _check_assignable(trip: ExternalTrip, shipment: Shipment, confirm_unknown_country: bool) -> None:
    if shipment.is_gapy_satys:
        raise AssignmentError('gapy')
    if shipment.status.code != 'draft':
        raise AssignmentError('not_draft')
    if shipment.trip_id:
        raise AssignmentError('has_trip')
    if trip.status in ExternalTrip.CLOSED_STATUSES:
        raise AssignmentError('trip_closed')
    if trip.shipment_id:
        raise AssignmentError('trip_taken')
    if trip.destination_country_code is None:
        if not confirm_unknown_country:
            raise AssignmentError('country_unknown')
    elif not shipment.country_id or shipment.country.code != trip.destination_country_code:
        raise AssignmentError('country_mismatch')


def assign_trip(trip: ExternalTrip, shipment: Shipment, user, confirm_unknown_country: bool = False) -> None:
    try:
        with transaction.atomic():
            trip = ExternalTrip.objects.select_for_update().get(pk=trip.pk)
            _check_assignable(trip, shipment, confirm_unknown_country)
            trip.shipment = shipment
            trip.save(update_fields=['shipment'])
            write_transport_fields(shipment, trip_values(trip), user)
    except IntegrityError as exc:  # OneToOne race: another assign won
        raise AssignmentError('trip_taken') from exc


def _release(trip: ExternalTrip, shipment: Shipment, user) -> None:
    trip.shipment = None
    trip.conflict_note = None
    trip.last_pushed_export_code = None
    trip.save(update_fields=['shipment', 'conflict_note', 'last_pushed_export_code'])
    write_transport_fields(shipment, dict(EMPTY_VALUES), user)


def unassign_trip(trip: ExternalTrip, user) -> None:
    trip = ExternalTrip.objects.select_related('shipment__status').get(pk=trip.pk)
    shipment = trip.shipment
    if shipment is None:
        return
    if shipment.status.code != 'draft':
        raise AssignmentError('locked')
    with transaction.atomic():
        _release(trip, shipment, user)
