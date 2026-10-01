"""Acknowledgement («Tanyşdym») planning tasks — docs/Tasks.md items 2b and 3.

alloc_review    export_manager   The greenhouse plan changed how many trucks a day
                                 needs, after the week's truck allocation was done.
transport_plan  transport        The week's allocation is ready (first time), or it
                                 changed since transport last acknowledged it.

Both close ONLY through acknowledge() — the «Tanyşdym» button on the page that
shows the data — which records what was seen in Task.ack_snapshot.

Baselines are written at synchronous points only (task creation, set_splits,
acknowledge), never from the lazy /me/tasks/ read: a plan edit landing between an
allocation save and the next read would otherwise be swallowed into the baseline
and never raise a review. Tasks are CREATED only here (beat + set_splits), never
on a GET; the export_task_one_open_ack_per_week constraint makes a lost race a
no-op.

Spec: docs/superpowers/specs/2026-09-29-planning-tasks-design.md §3.
"""
import logging
from datetime import date, datetime, timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.export.models import Task, TaskCompletionRule, TaskKind, TaskState
from apps.core.roles import task_roles_for
from apps.export.services.plan_task_common import (
    decode_counts, encode_baseline, encode_counts, end_of_local_day, iso_monday, local_today,
    next_iso_week,
)
from apps.export.services.truck_allocation_tasks import (
    allocation_counts, announce_next_week_if_complete, needed_trucks_by_day,
    resolve_truck_allocation_tasks,
)

logger = logging.getLogger(__name__)

ACK_KINDS = (TaskKind.ALLOC_REVIEW, TaskKind.TRANSPORT_PLAN)
OPEN_STATES = (TaskState.OPEN, TaskState.IN_PROGRESS)

REVIEW_ROLE = 'export_manager'
REVIEW_TITLE = 'tasks.review_truck_allocation'
TRANSPORT_ROLE = 'transport'
TRANSPORT_TITLE = 'tasks.transport_plan'
TRANSPORT_CHANGED_TITLE = 'tasks.transport_plan_changed'


class StaleSnapshot(Exception):
    """The data changed after the page the user acknowledged was loaded."""


# Owner, 2026-09-29: besides the assignee role, top management may acknowledge.
# export_manager is deliberately NOT here — he makes the allocation changes, so
# acknowledging transport's task himself would hide them from transport.
ACK_OVERRIDE_ROLES = frozenset({'admin', 'boss', 'director'})


def can_acknowledge(user, role: str) -> bool:
    """«Tanyşdym» is the assignee role's own act (plus admin / boss / director, and
    superusers) — any other supervisor pressing it would move the baseline past a
    change the responsible person never saw."""
    user_role = getattr(user, 'role', None)
    return (
        bool(getattr(user, 'is_superuser', False))
        or user_role in ACK_OVERRIDE_ROLES
        or user_role in task_roles_for(role)
    )


def current_snapshot(kind: str, year: int, week: int) -> str:
    """What «Tanyşdym» on a task of `kind` would record right now."""
    if kind == TaskKind.ALLOC_REVIEW:
        return encode_baseline(needed_trucks_by_day(year, week))
    if kind == TaskKind.TRANSPORT_PLAN:
        return encode_counts(allocation_counts(year, week))
    raise ValueError(f'Task kind {kind!r} is not acknowledged.')


def _week_over(year: int, week: int, today: date) -> bool:
    """Reviews stop after the week's Saturday (spec A-4)."""
    return today > iso_monday(year, week) + timedelta(days=5)


def _allocation_task(year: int, week: int) -> Task | None:
    return (
        Task.objects
        .filter(kind=TaskKind.TRUCK_ALLOCATION, scope_year=year, scope_week=week)
        .order_by('id')
        .first()
    )


def _create_ack_task(kind, year, week, role, title_key, link, deadline: datetime | None) -> Task | None:
    try:
        with transaction.atomic():
            task = Task.objects.create(
                shipment=None, kind=kind, step=kind, rule=None, title_key=title_key,
                assignee_role=role, assignee_user=None,
                completion_rule=TaskCompletionRule.MANUAL_DONE,
                link=link, scope_year=year, scope_week=week,
                deadline=deadline, state=TaskState.OPEN,
            )
    except IntegrityError:
        # A concurrent sync created the open task first.
        return None
    logger.info('Opened %s task for W%d/%d', kind, week, year)
    return task


def set_allocation_baseline(year: int, week: int) -> None:
    """Record what the plan needs now as the alloc_review baseline."""
    Task.objects.filter(
        kind=TaskKind.TRUCK_ALLOCATION, scope_year=year, scope_week=week,
    ).update(ack_snapshot=encode_baseline(needed_trucks_by_day(year, week)))


def review_changes(year: int, week: int) -> list[dict]:
    """Days whose needed-truck count differs from the baseline."""
    alloc = _allocation_task(year, week)
    if alloc is None or not alloc.ack_snapshot:
        return []
    was = decode_counts(alloc.ack_snapshot)
    now = needed_trucks_by_day(year, week)
    days = sorted({key[0] for key in was} | {key[0] for key in now})
    return [
        {'day_of_week': d, 'was': was.get((d,), 0), 'now': now.get((d,), 0)}
        for d in days
        if was.get((d,), 0) != now.get((d,), 0)
    ]


def sync_alloc_review(year: int, week: int, today: date) -> Task | None:
    alloc = _allocation_task(year, week)
    if alloc is None or alloc.state != TaskState.DONE or _week_over(year, week, today):
        return None
    if not alloc.ack_snapshot:
        # A task from before this feature: adopt today's plan as the baseline
        # instead of raising a review for a change nobody can see.
        set_allocation_baseline(year, week)
        return None
    if Task.objects.filter(
        kind=TaskKind.ALLOC_REVIEW, scope_year=year, scope_week=week, state__in=OPEN_STATES,
    ).exists():
        return None
    if not review_changes(year, week):
        return None
    return _create_ack_task(
        TaskKind.ALLOC_REVIEW, year, week, REVIEW_ROLE, REVIEW_TITLE,
        f'/export/plan?week={week}&year={year}', deadline=None,
    )


def sync_transport_plan(year: int, week: int, today: date) -> Task | None:
    alloc = _allocation_task(year, week)
    if alloc is None or alloc.state != TaskState.DONE or _week_over(year, week, today):
        return None
    tasks = Task.objects.filter(kind=TaskKind.TRANSPORT_PLAN, scope_year=year, scope_week=week)
    if tasks.filter(state__in=OPEN_STATES).exists():
        return None
    last_done = tasks.filter(state=TaskState.DONE).order_by('-completed_at', '-id').first()
    if last_done is None:
        if tasks.exists():
            return None          # only cancelled ones — someone stood it down on purpose
        title = TRANSPORT_TITLE
    elif decode_counts(last_done.ack_snapshot) == allocation_counts(year, week):
        return None
    else:
        title = TRANSPORT_CHANGED_TITLE
    return _create_ack_task(
        TaskKind.TRANSPORT_PLAN, year, week, TRANSPORT_ROLE, title,
        f'/transport/plan?week={week}&year={year}',
        deadline=end_of_local_day(today),          # spec A-3
    )


def build_review(year: int, week: int, user) -> dict:
    """Payload of GET /truck-allocations/review/ — see the api-contract skill.

    `snapshot` is what the banner shows; the client posts it back on «Tanyşdym»
    so a change landing after the page loaded is refused, not swallowed.
    """
    open_task = (
        Task.objects
        .filter(kind=TaskKind.ALLOC_REVIEW, scope_year=year, scope_week=week, state__in=OPEN_STATES)
        .order_by('id')
        .first()
    )
    return {
        'year': year,
        'week': week,
        'open_task_id': open_task.id if open_task else None,
        'changes': review_changes(year, week),
        'snapshot': current_snapshot(TaskKind.ALLOC_REVIEW, year, week),
        'can_acknowledge': can_acknowledge(user, REVIEW_ROLE),
    }


def build_transport_plan(year: int, week: int, user) -> dict:
    """Payload of GET /truck-allocations/transport-plan/ — see the api-contract skill."""
    from apps.core.models import TruckDestination

    current = allocation_counts(year, week)
    tasks = Task.objects.filter(kind=TaskKind.TRANSPORT_PLAN, scope_year=year, scope_week=week)
    last_ack = tasks.filter(state=TaskState.DONE).order_by('-completed_at', '-id').first()
    acked = decode_counts(last_ack.ack_snapshot) if last_ack else None
    open_task = tasks.filter(state__in=OPEN_STATES).order_by('id').first()

    keys = set(current) | set(acked or {})
    destinations = list(
        TruckDestination.objects
        .filter(id__in={dest for _dow, dest in keys})
        .order_by('sort_order', 'name')
        .values('id', 'name')
    )
    monday = iso_monday(year, week)
    return {
        'year': year,
        'week': week,
        'days': [
            {'day_of_week': dow, 'date': (monday + timedelta(days=dow - 1)).isoformat()}
            for dow in range(1, 7)
        ],
        'destinations': destinations,
        'cells': [
            {
                'day_of_week': dow,
                'destination_id': dest,
                'truck_count': current.get((dow, dest), 0),
                'acknowledged_count': None if acked is None else acked.get((dow, dest), 0),
            }
            for dow, dest in sorted(keys)
        ],
        'open_task_id': open_task.id if open_task else None,
        # Local offset (+05:00), per the api-contract timestamp rule.
        'acknowledged_at': timezone.localtime(last_ack.completed_at).isoformat() if last_ack else None,
        'snapshot': encode_counts(current),
        'can_acknowledge': can_acknowledge(user, TRANSPORT_ROLE),
    }


def acknowledge(task: Task, user, seen_snapshot: str | None = None) -> Task:
    """«Tanyşdym»: store what the user saw, then close. Caller holds the row lock.

    `seen_snapshot` is the `snapshot` of the page the user acknowledged (the API
    always passes it). If the data moved since that page loaded, StaleSnapshot
    is raised and nothing changes — the user must look again.
    """
    snapshot = current_snapshot(task.kind, task.scope_year, task.scope_week)
    if seen_snapshot is not None and decode_counts(seen_snapshot) != decode_counts(snapshot):
        raise StaleSnapshot
    if task.kind == TaskKind.ALLOC_REVIEW:
        Task.objects.filter(
            kind=TaskKind.TRUCK_ALLOCATION,
            scope_year=task.scope_year, scope_week=task.scope_week,
        ).update(ack_snapshot=snapshot)

    now = timezone.now()
    task.ack_snapshot = snapshot
    task.state = TaskState.DONE
    task.completed_at = now
    task.started_at = task.started_at or now
    task.completed_by = user
    task.save(update_fields=['ack_snapshot', 'state', 'completed_at', 'started_at', 'completed_by'])
    return task


def on_allocation_saved(year: int, week: int, today: date | None = None) -> None:
    """set_splits hook, synchronous: refresh the review baseline, close the
    allocation task if the week is now covered, and open/refresh transport's
    task. `today` pins the clock for tests."""
    set_allocation_baseline(year, week)
    resolve_truck_allocation_tasks()
    sync_transport_plan(year, week, today or local_today())


def sync_plan_ack_tasks(today: date | None = None) -> list[Task]:
    """Beat entry (every 30 min) for the current and the next ISO week."""
    today = today or local_today()
    resolve_truck_allocation_tasks()
    # Backstop for announce_if_plan_complete: the /me/tasks/ read path catches
    # the common case (the grid refetches it after each cell save), this covers
    # a last cell written from somewhere else.
    announce_next_week_if_complete(today)
    this_year, this_week, _ = today.isocalendar()
    created = []
    for year, week in ((this_year, this_week), next_iso_week(today)):
        for task in (sync_alloc_review(year, week, today), sync_transport_plan(year, week, today)):
            if task is not None:
                created.append(task)
    return created
