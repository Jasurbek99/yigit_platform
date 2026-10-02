"""Gate tasks: «TIR {plate} gelmeli» and «TIR {plate} çykmaly» for the guard.

Code-driven like weekly_plan / truck_allocation, not a TaskRule: a rule is
role-wide, so every guard would see every location's trucks, and an
ALL_FIELDS_FILLED rule would hold the document team's auto-advance until the
truck arrived. MANUAL_DONE + a non-status `step` keeps these tasks out of
resolve_for_shipment() and is_step_trigger_satisfied() entirely.

sync_gate_tasks() makes the tasks equal the gate lists. It runs on every
Shipment.save() and packing move (sync_shipment_gate_tasks), so a truck's task
opens the moment it is assigned (owner, 2026-10-01) — and still on every gate
list read, on My Tasks for a guard, and inside each gate action.

Spec: docs/superpowers/specs/2026-09-29-garawul-gate-design.md §1.4
"""
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.core.models import LoadingLocation
from apps.core.roles import GATE_GUARD_ROLE
from apps.export.models import (
    Shipment, ShipmentBlockSource, Task, TaskCancelReason, TaskCompletionRule, TaskKind,
    TaskState,
)
from apps.export.services.gate import expected, inside

STEP_ARRIVE = 'gate_arrive'
STEP_DEPART = 'gate_depart'
TITLE_KEYS = {STEP_ARRIVE: 'tasks.gate_arrive', STEP_DEPART: 'tasks.gate_depart'}
LINK = '/export/gate'
UNIQUE_GATE_TASK = 'export_task_one_gate_per_shipment_step'
_LIVE = (TaskState.OPEN, TaskState.IN_PROGRESS, TaskState.BLOCKED)


def sync_gate_tasks(location, *, shipment_id: int | None = None, actor=None) -> None:
    """Open, close or cancel gate tasks at `location` to match the lists.

    `actor` is credited as completed_by — the gate action passes the guard; a
    read-time sync passes nothing, so a close it merely discovers (a time fixed
    on the Sheet) credits nobody.
    """
    exp = expected(location)
    ins = inside(location)
    live = Task.objects.filter(kind=TaskKind.GATE, scope_location=location, state__in=_LIVE)
    if shipment_id is not None:
        exp = exp.filter(pk=shipment_id)
        ins = ins.filter(pk=shipment_id)
        live = live.filter(shipment_id=shipment_id)
    exp_ids = set(exp.values_list('pk', flat=True))
    ins_ids = set(ins.values_list('pk', flat=True))
    ids = exp_ids | ins_ids | set(live.values_list('shipment_id', flat=True))
    if not ids:
        return

    tasks = {
        (t.shipment_id, t.step): t
        for t in Task.objects.filter(kind=TaskKind.GATE, shipment_id__in=ids)
    }
    departed = set(
        Shipment.objects.filter(pk__in=ids, departed_at__isnull=False).values_list('pk', flat=True)
    )
    now = timezone.now()
    arrived = []
    for sid in ids:
        arrive_task = tasks.get((sid, STEP_ARRIVE))
        depart_task = tasks.get((sid, STEP_DEPART))
        if sid in exp_ids:
            _open(arrive_task, sid, STEP_ARRIVE, location)
            _cancel(depart_task, location)          # an undone arrival takes its exit back
        elif sid in ins_ids:
            if _done(arrive_task, sid, STEP_ARRIVE, location, actor, now):
                arrived.append(sid)
            _open(depart_task, sid, STEP_DEPART, location)
        elif sid in departed:
            _done(depart_task, sid, STEP_DEPART, location, actor, now)
            _cancel(arrive_task, location)
        else:
            _cancel(arrive_task, location)
            _cancel(depart_task, location)
    for sid in arrived:
        _open_loading_start(sid, actor)


def _open_loading_start(shipment_id: int, actor) -> None:
    """«Ýükleme başlady» waits for the arrival (its TaskRule depends_on
    tasks.gate_arrive — docs/Tasks.md 23 → 24, owner 2026-10-01). Spawn it now,
    and advance if R19 was already typed on the Sheet."""
    from apps.export.services.task_chain import after_task_done

    after_task_done(Shipment.objects.select_related('status').get(pk=shipment_id), actor, [])


def sync_shipment_gate_tasks(shipment_id: int, actor=None) -> None:
    """Sync one shipment at every gate it may be on, or have a live task at.

    `actor` is the user whose save this is (shipment.updated_by) — the same
    credit the task engine gives any task a save resolves.
    """
    location_ids = set(
        ShipmentBlockSource.objects.filter(shipment_id=shipment_id)
        .values_list('block__location_id', flat=True)
    )
    location_ids |= set(
        Task.objects.filter(kind=TaskKind.GATE, shipment_id=shipment_id, state__in=_LIVE)
        .values_list('scope_location_id', flat=True)
    )
    location_ids |= set(
        Shipment.objects.filter(pk=shipment_id).values_list('loading_location_id', flat=True)
    )
    for location in LoadingLocation.objects.filter(pk__in=location_ids - {None}):
        sync_gate_tasks(location, shipment_id=shipment_id, actor=actor)


def _create(**fields) -> None:
    try:
        with transaction.atomic():
            Task.objects.create(**fields)
    except IntegrityError as exc:
        if UNIQUE_GATE_TASK not in str(exc):
            raise


def _base(shipment_id: int, step: str, location) -> dict:
    return {
        'kind': TaskKind.GATE, 'shipment_id': shipment_id, 'step': step,
        'title_key': TITLE_KEYS[step], 'assignee_role': GATE_GUARD_ROLE,
        'scope_location': location, 'completion_rule': TaskCompletionRule.MANUAL_DONE,
        'link': LINK,
    }


def _open(task, shipment_id: int, step: str, location) -> None:
    if task is None:
        _create(**_base(shipment_id, step, location))
        return
    if task.state in _LIVE and task.scope_location_id == location.pk:
        return
    task.state = TaskState.OPEN
    task.scope_location = location
    task.cancelled_reason = ''
    task.started_at = None
    task.completed_at = None
    task.completed_by = None
    task.save(update_fields=[
        'state', 'scope_location', 'cancelled_reason', 'started_at', 'completed_at', 'completed_by',
    ])


def _done(task, shipment_id: int, step: str, location, actor, now) -> bool:
    """True when this call closed the task (or created it closed)."""
    if task is None:
        if actor is None:  # only the mark itself earns a task it never had
            return False
        _create(**_base(shipment_id, step, location), state=TaskState.DONE,
                started_at=now, completed_at=now, completed_by=actor)
        return True
    if task.state == TaskState.DONE:
        return False
    task.state = TaskState.DONE
    task.scope_location = location
    task.cancelled_reason = ''
    task.started_at = task.started_at or now
    task.completed_at = now
    task.completed_by = actor
    task.save(update_fields=[
        'state', 'scope_location', 'cancelled_reason', 'started_at', 'completed_at', 'completed_by',
    ])
    return True


def _cancel(task, location) -> None:
    if task is None or task.state not in _LIVE or task.scope_location_id != location.pk:
        return
    task.state = TaskState.CANCELLED
    task.cancelled_reason = TaskCancelReason.RULE_MISMATCH
    task.save(update_fields=['state', 'cancelled_reason'])
