"""Join Planning trips to shipments (spec §5) and react to their changes (spec §6)."""
import logging

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction

from apps.export.models import AuditLog, Notification, Shipment, ShipmentComment
from apps.export.services.rollback import is_transport_locked, reopen_rule_task, rollback_to_draft
from apps.export.services.sheet_audit import diff_audit_rows, snapshot_fields
from apps.transport.models import ExternalTrip, Trailer, TruckHead
from apps.transport.services.matching import normalize_plate
from apps.transport.services.trip_push import enqueue_push

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
    linked = ExternalTrip.objects.select_related('shipment__loading_location').get(pk=trip.pk)
    enqueue_push(linked, 'export-code')
    enqueue_push(linked, 'loading')


def _release(trip: ExternalTrip, shipment: Shipment, user) -> None:
    trip.shipment = None
    trip.conflict_note = None
    trip.last_pushed_export_code = None
    trip.save(update_fields=['shipment', 'conflict_note', 'last_pushed_export_code'])
    write_transport_fields(shipment, dict(EMPTY_VALUES), user)


NOTIFY_ROLES = ('export_manager',)
NOTIFY_ROLES_ON_ROLLBACK = ('export_manager', 'document_team')


def _describe(values: dict) -> str:
    return f"{values.get('truck_plate') or '—'}, {values.get('driver_name') or '—'}"


def _notify(shipment: Shipment, roles: tuple[str, ...], message: str) -> None:
    users = get_user_model().objects.filter(role__in=roles, is_active=True).values_list('pk', flat=True)
    Notification.objects.bulk_create(
        [Notification(user_id=uid, kind='action_required', message=message[:500],
                      link=f'/shipments/{shipment.pk}') for uid in users],
        batch_size=500,
    )


def _record(shipment: Shipment, user, message: str, roles: tuple[str, ...]) -> None:
    ShipmentComment.objects.create(shipment=shipment, user=user, content=message[:2000], is_system=True)
    _notify(shipment, roles, f'{shipment.shipment_code}: {message}')


def _current_values(shipment: Shipment) -> dict:
    return {field: getattr(shipment, field) for field in TRANSPORT_FIELDS}


def _fresh(trip: ExternalTrip) -> ExternalTrip:
    return ExternalTrip.objects.select_related('shipment__status').get(pk=trip.pk)


def apply_trip_change(trip: ExternalTrip, user) -> str:
    """React to a real Planning change on a linked trip (spec §6 table)."""
    trip = _fresh(trip)
    shipment = trip.shipment
    if shipment is None:
        return 'unlinked'
    cancelled = trip.status == 'CANCELLED'
    old = _current_values(shipment)
    new = dict(EMPTY_VALUES) if cancelled else trip_values(trip)
    what = 'Planning cancelled the trip' if cancelled else 'Planning changed the truck'
    message = f'{what}: {_describe(old)} → {_describe(new)}'
    if is_transport_locked(shipment):
        trip.conflict_note = message
        trip.save(update_fields=['conflict_note'])
        _record(shipment, user, f'Not applied (shipment locked). {message}', NOTIFY_ROLES)
        return 'conflict'
    rolled_back = shipment.status.code != 'draft'
    with transaction.atomic():
        if rolled_back:
            rollback_to_draft(shipment, user, message)
        if cancelled:
            _release(trip, shipment, user)
            reopen_rule_task(shipment, 'tasks.choose_truck')
        else:
            write_transport_fields(shipment, new, user)
    _record(shipment, user, message, NOTIFY_ROLES_ON_ROLLBACK if rolled_back else NOTIFY_ROLES)
    if cancelled:
        return 'unlinked_rollback' if rolled_back else 'unlinked'
    return 'applied_rollback' if rolled_back else 'applied'


def accept_trip_change(trip: ExternalTrip, user) -> None:
    """Export manager overrides a conflict: take Planning's values, no status change."""
    trip = _fresh(trip)
    shipment = trip.shipment
    if shipment is None or not trip.conflict_note:
        return
    values = dict(EMPTY_VALUES) if trip.status == 'CANCELLED' else trip_values(trip)
    with transaction.atomic():
        if trip.status == 'CANCELLED':
            _release(trip, shipment, user)
        else:
            write_transport_fields(shipment, values, user)
            trip.conflict_note = None
            trip.save(update_fields=['conflict_note'])
    _record(shipment, user, f'Accepted despite lock: {_describe(values)}', NOTIFY_ROLES)


def unassign_trip(trip: ExternalTrip, user) -> None:
    trip = _fresh(trip)
    shipment = trip.shipment
    if shipment is None:
        return
    if is_transport_locked(shipment):
        raise AssignmentError('locked')
    with transaction.atomic():
        if shipment.status.code != 'draft':
            rollback_to_draft(shipment, user, f'Truck unassigned by {user.username}')
        _release(trip, shipment, user)
        reopen_rule_task(shipment, 'tasks.choose_truck')


def move_trip(trip: ExternalTrip, to_shipment: Shipment, user) -> None:
    with transaction.atomic():
        unassign_trip(trip, user)
        assign_trip(_fresh(trip), to_shipment, user)


def release_cancelled_shipments() -> int:
    """Free trips whose shipment we cancelled; Planning is not told (no such operation)."""
    return ExternalTrip.objects.filter(shipment__status__code='cancelled').update(
        shipment=None, conflict_note=None, last_pushed_export_code=None,
    )
