"""Gate guard (garawul): trucks arriving at and leaving one greenhouse location.

Two lists — Gelmeli (expected) and Ýyladyşhanada (inside) — and the marks that
move a truck between them. Every write is a plain Shipment.save(), so task
resolution and auto_advance_if_ready() run exactly as for a Sheet edit and the
status still only changes inside transition_to().

Spec: docs/superpowers/specs/2026-09-29-garawul-gate-design.md
"""
from datetime import datetime, timedelta

from django.db import transaction
from django.db.models import Q, QuerySet
from django.utils import timezone

from apps.core.seasons import SeasonClosedError, assert_season_open
from apps.export.models import Shipment, ShipmentBlockSource

PRE_DEPARTURE = ('draft', 'gumruk_girish', 'gumruk_chykysh', 'yuklenme')
DAYS_BACK = 7
DAYS_AHEAD = 1
UNDO_WINDOW = timedelta(minutes=10)


def location_q(location) -> Q:
    """Trucks at `location`: their own loading_location, else their blocks' location.

    No live shipment had loading_location on 2026-09-29, so the blocks carry the
    location until the gate stamps it at arrival.
    """
    via_blocks = (
        ShipmentBlockSource.objects
        .filter(block__location=location)
        .order_by()
        .values('shipment_id')
    )
    return Q(loading_location=location) | Q(loading_location__isnull=True, pk__in=via_blocks)


def _live() -> QuerySet:
    return (
        Shipment.objects
        .filter(is_archived=False, deleted_at__isnull=True)
        .exclude(status__code='cancelled')
        .select_related('status')
    )


def expected(location) -> QuerySet:
    """Gelmeli: plated trucks due at `location` that have not arrived or left."""
    today = timezone.localdate()
    return (
        _live()
        .filter(location_q(location))
        .filter(status__code__in=PRE_DEPARTURE)
        # A packing part (draft, no destination) is deleted by Join — a gate
        # stamp on it would vanish. It shows up once it is joined / given a
        # destination, same as its tasks (owner rule 2026-09-29).
        .exclude(status__code='draft', country__isnull=True, customer__isnull=True)
        .exclude(truck_plate__isnull=True)
        .exclude(truck_plate='')
        .filter(greenhouse_arrived_at__isnull=True, departed_at__isnull=True)
        .filter(
            date__gte=today - timedelta(days=DAYS_BACK),
            date__lte=today + timedelta(days=DAYS_AHEAD),
        )
        .order_by('date', 'id')
    )


def inside(location) -> QuerySet:
    """Ýyladyşhanada: arrived, not left. Status is ignored on purpose — a status
    move must never hide a truck that is physically inside."""
    return (
        _live()
        .filter(location_q(location))
        .filter(greenhouse_arrived_at__isnull=False, departed_at__isnull=True)
        .order_by('greenhouse_arrived_at', 'id')
    )


def recently_left(location, now: datetime | None = None) -> QuerySet:
    """Left within the undo window — shown greyed so the exit can be undone."""
    now = now or timezone.now()
    return (
        _live()
        .filter(location_q(location))
        .filter(greenhouse_arrived_at__isnull=False, departed_at__gte=now - UNDO_WINDOW)
        .order_by('-departed_at', 'id')
    )


def can_undo(shipment: Shipment, event: str, now: datetime | None = None) -> bool:
    """A mark may be undone for 10 minutes, and only while the status has not
    moved since — a transition has no way back."""
    now = now or timezone.now()
    if event == 'arrive':
        if shipment.departed_at is not None:
            return False
        mark = shipment.greenhouse_arrived_at
    else:
        mark = shipment.departed_at
    if mark is None or now - mark > UNDO_WINDOW:
        return False
    changed = shipment.status_changed_at
    return changed is None or changed < mark


def _iso(value: datetime | None) -> str | None:
    # Local time (TIME_ZONE='Asia/Ashgabat', +05:00) — the guard's screen has
    # no use for a UTC offset (final-fix review F6).
    return timezone.localtime(value).isoformat() if value is not None else None


def gate_row(shipment: Shipment, undo_event: str | None = None,
             now: datetime | None = None) -> dict:
    """The guard's view of a truck — no customer, firm, price or weight."""
    return {
        'id': shipment.pk,
        'shipment_code': shipment.shipment_code,
        'truck_plate': shipment.truck_plate,
        'truck_plate_2': shipment.truck_plate_2,
        'driver_name': shipment.driver_name,
        'driver_phone': shipment.driver_phone,
        'date': shipment.date.isoformat(),
        'is_gapy_satys': shipment.is_gapy_satys,
        'status_code': shipment.status.code,
        'greenhouse_arrived_at': _iso(shipment.greenhouse_arrived_at),
        'departed_at': _iso(shipment.departed_at),
        'can_undo': bool(undo_event) and can_undo(shipment, undo_event, now),
    }


ARRIVAL_NOTIFY_ROLES = ('loading_dept_head', 'loading_dept_head_deputy')
AUDITED_FIELDS = ['greenhouse_arrived_at', 'loading_location', 'loading_started_at', 'departed_at']


class GateError(Exception):
    """The truck is not in a state this action accepts. The view answers 409."""

    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


def arrive(shipment_id: int, location, user) -> Shipment:
    """«Ýyladyşhana geldi»: stamp arrival, start loading if nobody has, notify.

    A truck with no packing joined yet (needs_packing_for_loading) still gets
    stamped and notified — the guard saw it arrive — but loading_started_at is
    left null: there is nothing to load, and filling it would advance the
    status past a truck with no block_sources (final-fix review F5).
    """
    from apps.export.services.packaging import needs_packing_for_loading

    with transaction.atomic():
        shipment = _lock(shipment_id)
        if not expected(location).filter(pk=shipment_id).exists():
            raise GateError('not_expected')
        _assert_open(shipment)
        before = _snapshot(shipment)
        now = timezone.now()
        shipment.greenhouse_arrived_at = now
        if shipment.loading_location_id is None:
            shipment.loading_location = location
        if shipment.loading_started_at is None and not needs_packing_for_loading(shipment):
            shipment.loading_started_at = now
        _save_audited(shipment, user, before)
        _notify_arrival(shipment, location)
        _sync_tasks(location, shipment_id, user)
    return _fresh(shipment_id)


def depart(shipment_id: int, location, user) -> Shipment:
    """«Ýyladyşhanadan çykdy»: fill R21 departed_at; auto-advance does the rest."""
    with transaction.atomic():
        shipment = _lock(shipment_id)
        if not inside(location).filter(pk=shipment_id).exists():
            raise GateError('not_inside')
        _assert_open(shipment)
        before = _snapshot(shipment)
        shipment.departed_at = timezone.now()
        _save_audited(shipment, user, before)
        _sync_tasks(location, shipment_id, user)
    return _fresh(shipment_id)


def undo(shipment_id: int, location, user, event: str) -> Shipment:
    """Take back the last mark, within UNDO_WINDOW and before any status move."""
    if event not in ('arrive', 'depart'):
        raise GateError('bad_event')
    with transaction.atomic():
        shipment = _lock(shipment_id)
        if not _live().filter(location_q(location)).filter(pk=shipment_id).exists():
            raise GateError('not_here')
        if not can_undo(shipment, event):
            raise GateError('undo_closed')
        _assert_open(shipment)
        before = _snapshot(shipment)
        if event == 'depart':
            _reopen_tasks_closed_by(shipment, 'departed_at', shipment.departed_at)
            shipment.departed_at = None
        else:
            mark = shipment.greenhouse_arrived_at
            shipment.greenhouse_arrived_at = None
            if shipment.loading_started_at == mark:
                _reopen_tasks_closed_by(shipment, 'loading_started_at', mark)
                shipment.loading_started_at = None
        _save_audited(shipment, user, before)
        _sync_tasks(location, shipment_id, user)
    return _fresh(shipment_id)


def _lock(shipment_id: int) -> Shipment:
    return Shipment.objects.select_for_update().get(pk=shipment_id)


def _fresh(shipment_id: int) -> Shipment:
    return Shipment.objects.select_related('status', 'loading_location').get(pk=shipment_id)


def _assert_open(shipment: Shipment) -> None:
    try:
        assert_season_open(shipment.season)
    except SeasonClosedError as exc:
        raise GateError('season_closed') from exc


def _snapshot(shipment: Shipment) -> dict[str, str]:
    from apps.export.services.sheet_audit import snapshot_fields
    return snapshot_fields(shipment, AUDITED_FIELDS)


def _save_audited(shipment: Shipment, user, before: dict[str, str]) -> None:
    """Save through the normal pipeline (task resolution + auto-advance) and
    write one AuditLog row per changed field, credited to the guard."""
    from apps.export.models.audit import AuditLog
    from apps.export.services.sheet_audit import diff_audit_rows, snapshot_fields

    shipment.updated_by = user
    try:
        shipment.save()
    except SeasonClosedError as exc:
        raise GateError('season_closed') from exc
    rows = diff_audit_rows(shipment, before, snapshot_fields(shipment, AUDITED_FIELDS), user)
    if rows:
        AuditLog.objects.bulk_create(rows, batch_size=500)


def _reopen_tasks_closed_by(shipment: Shipment, field: str, since: datetime | None) -> None:
    """A status task this mark closed must come back when the mark is undone —
    the resolver never reopens DONE tasks, and a DONE trigger over an empty
    field would let the next save auto-advance the truck anyway.

    `target_fields__contains=field` is a substring match — a candidate
    pre-filter only, cheap on the DB. A field whose name contains `field` as a
    substring (e.g. a future `departed_at_note` against `departed_at`) would
    pass it without actually listing `field` as one of its CSV tokens, so the
    exact match is done in Python against `Task.target_field_list`, the
    model's own CSV-token parser.
    """
    from apps.export.models import Task, TaskState

    if since is None:
        return
    candidates = Task.objects.filter(
        shipment=shipment,
        state=TaskState.DONE,
        completed_at__gte=since,
        target_fields__contains=field,
    )
    matching_ids = [task.pk for task in candidates if field in task.target_field_list]
    if not matching_ids:
        return
    Task.objects.filter(pk__in=matching_ids).update(
        state=TaskState.OPEN, completed_at=None, completed_by=None,
    )


def _sync_tasks(location, shipment_id: int, user) -> None:
    from apps.export.services.gate_tasks import sync_gate_tasks
    sync_gate_tasks(location, shipment_id=shipment_id, actor=user)


def _notify_arrival(shipment: Shipment, location) -> None:
    from apps.core.models import User
    from apps.export.models import Notification

    message = f'{shipment.truck_plate} — {location.name}'[:500]
    link = f'/shipments/{shipment.pk}'
    recipients = User.objects.filter(is_active=True, role__in=ARRIVAL_NOTIFY_ROLES)
    Notification.objects.bulk_create(
        [Notification(user=u, kind='gate_arrival', message=message, link=link) for u in recipients],
        batch_size=500,
    )
