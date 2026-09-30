"""Task chain for PREP / DOCS — docs/Tasks.md items 5b–22.

Deferred creation ("task after N"): a rule with depends_on is created only once
the shipment is at its step AND every prerequisite is satisfied. A prerequisite D
is satisfied when (1) no task titled D is still active, and (2) if there is no
task titled D at all, no applicable + effective rule D of the CURRENT step
exists (it would still be created). A D-rule of an earlier step with no task —
a shipment that crossed the deploy, or a variant that does not apply — counts
as satisfied, so nothing deadlocks.

effective_from: a rule applies only to shipments that entered its step at or
after it (step entry = status_changed_at, else created_at), so shipments
already inside a step at deploy finish on their old tasks.

Spec: docs/superpowers/specs/2026-09-30-prep-docs-tasks-design.md.
"""
import logging
from datetime import datetime

from django.utils import timezone

from apps.export.models import Task, TaskRule, TaskState

logger = logging.getLogger(__name__)

ACTIVE_STATES = (TaskState.OPEN, TaskState.IN_PROGRESS, TaskState.BLOCKED)
MAX_SPAWN_PASSES = 25


def dep_keys(rule: TaskRule) -> list[str]:
    return [k.strip() for k in (rule.depends_on or '').split(',') if k.strip()]


def step_entered_at(shipment) -> datetime:
    """status_changed_at (written only by transition_to / create_shipment),
    else created_at. Not the status log: join / swap / unjoin append
    same-status rows to it, which would make new rules effective on a truck
    that was already inside its step at deploy."""
    return shipment.status_changed_at or shipment.created_at


def rule_effective(rule: TaskRule, entered_at: datetime | None) -> bool:
    return rule.effective_from is None or (entered_at is not None and entered_at >= rule.effective_from)


def _step_rules(shipment) -> list[TaskRule]:
    if not shipment.status_id:
        return []
    return list(TaskRule.objects.filter(step=shipment.status.code, is_active=True))


def _deps_satisfied(rule, shipment, step_rules, tasks, entered_at) -> bool:
    from apps.export.services.task_rules import _rule_applies

    for key in dep_keys(rule):
        titled = [t for t in tasks if t.title_key == key]
        if any(t.state in ACTIVE_STATES for t in titled):
            return False
        if not titled and any(
            r.title_key == key and _rule_applies(r, shipment) and rule_effective(r, entered_at)
            for r in step_rules
        ):
            return False
    return True


def _pending_rules(shipment, step_rules, tasks, entered_at) -> list[TaskRule]:
    """Applicable, effective rules of this step with depends_on and no task yet."""
    from apps.export.services.task_rules import _rule_applies

    have = {t.rule_id for t in tasks if t.rule_id}
    return [
        r for r in step_rules
        if dep_keys(r) and r.id not in have
        and _rule_applies(r, shipment) and rule_effective(r, entered_at)
    ]


def has_pending_dependents(shipment) -> bool:
    """E3: a gating dependent of the current step not created yet holds the
    step. Non-gating rules (gates_step=False) never hold it, pending or not."""
    step_rules = _step_rules(shipment)
    if not any(dep_keys(r) and r.gates_step for r in step_rules):
        return False
    # Task.objects.filter, not shipment.tasks.all(): a prefetched `tasks`
    # cache on `shipment` would otherwise hide a task created since the fetch.
    tasks = list(Task.objects.filter(shipment_id=shipment.pk))
    return any(r.gates_step for r in _pending_rules(shipment, step_rules, tasks, step_entered_at(shipment)))


def spawn_ready_tasks(shipment) -> list[Task]:
    """Create every dependent task whose prerequisites are now satisfied, close
    the ones already satisfied (downloads / registered checks), and repeat
    until nothing changes. Returns the tasks created."""
    from apps.export.services.task_rules import create_rule_task, parse_deadline_rule, resolve_for_shipment

    step_rules = _step_rules(shipment)
    if not any(dep_keys(r) for r in step_rules):
        return []
    entered_at = step_entered_at(shipment)
    created_all: list[Task] = []
    for _ in range(MAX_SPAWN_PASSES):
        # See has_pending_dependents: a prefetched cache must not hide a task
        # a previous pass of this same loop just created.
        tasks = list(Task.objects.filter(shipment_id=shipment.pk))
        ready = [r for r in _pending_rules(shipment, step_rules, tasks, entered_at)
                 if _deps_satisfied(r, shipment, step_rules, tasks, entered_at)]
        if not ready:
            break
        now = timezone.now()
        for rule in ready:
            task = create_rule_task(
                shipment=shipment, step=rule.step, rule=rule, title_key=rule.title_key,
                assignee_role=rule.assignee_role, target_fields=rule.target_fields,
                completion_rule=rule.completion_rule, target_value=rule.target_value,
                deadline=parse_deadline_rule(rule.deadline_rule, reference=now),
                deadline_rule=rule.deadline_rule, state=TaskState.OPEN,
            )
            if task is not None:
                created_all.append(task)
        resolve_for_shipment(shipment)
        close_auto_satisfied(shipment)
    else:
        logger.warning('spawn_ready_tasks hit MAX_SPAWN_PASSES on %s — check depends_on for a cycle',
                       shipment.shipment_code)
    return created_all


DOC_TASKS = {
    'cmr': 'tasks.print_cmr',
    'tir': 'tasks.print_tir',
    'ct1': 'tasks.print_ct1',
    'phyto': 'tasks.print_phyto',
    'customs_request': 'tasks.print_customs_request',
}
_READY_CHECKS: dict = {}          # title_key -> callable(shipment) -> bool (contracts registers)


def register_ready_check(title_key: str, check) -> None:
    _READY_CHECKS[title_key] = check


def _close(task: Task, user_id) -> None:
    now = timezone.now()
    task.state = TaskState.DONE
    task.completed_at = now
    task.started_at = task.started_at or now
    task.completed_by_id = user_id
    task.save(update_fields=['state', 'completed_at', 'started_at', 'completed_by'])


def close_auto_satisfied(shipment) -> list[Task]:
    """Close open print tasks whose document was already downloaded, and open
    tasks whose registered ready check passes."""
    from apps.export.models import ShipmentDocumentDownload

    open_tasks = list(shipment.tasks.filter(state__in=[TaskState.OPEN, TaskState.IN_PROGRESS]))
    if not open_tasks:
        return []
    downloads = {}
    rows = ShipmentDocumentDownload.objects.filter(shipment_id=shipment.pk)
    if shipment.documents_reset_at:
        # A truck change rolled the shipment back: the old truck's papers don't count.
        rows = rows.filter(downloaded_at__gte=shipment.documents_reset_at)
    for key, user_id in rows.order_by('downloaded_at', 'id').values_list('doc_key', 'downloaded_by_id'):
        downloads[DOC_TASKS.get(key)] = user_id           # latest downloader wins
    closed = []
    for task in open_tasks:
        if task.title_key in downloads:
            _close(task, downloads[task.title_key])
            closed.append(task)
        elif task.title_key in _READY_CHECKS and _READY_CHECKS[task.title_key](shipment):
            _close(task, getattr(shipment, 'updated_by_id', None))
            closed.append(task)
    for task in closed:
        apply_task_done_effects(task, shipment)
    return closed


def refresh_tasks_after_write(shipment, user) -> list[Task]:
    """Writes that bypass Shipment.save() (advance link rows): resolve field
    tasks, then spawn and advance like any other close."""
    from apps.export.models.shipment import advance_after_tasks
    from apps.export.services.task_rules import resolve_for_shipment

    shipment.updated_by = user
    resolved = resolve_for_shipment(shipment)          # applies close effects itself
    if resolved:
        spawned = spawn_ready_tasks(shipment)
        advance_after_tasks(shipment, resolved + spawned)
    return resolved


def refresh_after_packing_move(shipment, user) -> list[Task]:
    """Join / swap move packing with QuerySet.update(), and a packing move never
    moves the truck (spec 2026-09-29). So only non-gating field tasks
    (join_supply) close here, then what is due spawns. Gating tasks keep closing
    on the next ordinary save, which advances through the normal gate as before."""
    from apps.export.services.task_rules import _completion_satisfied

    closed = [
        t for t in shipment.tasks.filter(state__in=[TaskState.OPEN, TaskState.IN_PROGRESS],
                                         rule__gates_step=False)
        if _completion_satisfied(t, shipment)
    ]
    for task in closed:
        _close(task, user.pk)
        apply_task_done_effects(task, shipment)
    if closed:
        spawn_ready_tasks(shipment)
    return closed


def record_document_download(shipment, doc_keys, user) -> list[Task]:
    """A document was served: record it and close its print tasks (now, or when
    they are created later in the chain)."""
    from apps.export.models import ShipmentDocumentDownload

    # Closed seasons are frozen (D1): the download still succeeds, nothing is
    # recorded or closed — transition_to would refuse inside a GET.
    if shipment.season_id and shipment.season.closed_at is not None:
        return []
    ShipmentDocumentDownload.objects.bulk_create(
        [ShipmentDocumentDownload(shipment=shipment, doc_key=k, downloaded_by=user) for k in doc_keys],
        batch_size=500,
    )
    closed = close_auto_satisfied(shipment)
    if closed:
        # close_auto_satisfied already applied each task's effects (loop above).
        after_task_done(shipment, user, closed, apply_effects=False)
    return closed


DOCS_IN_PROGRESS = 'in_progress'
FROM_CUSTOMS_LABEL = 'Gümrükden geldi'


def _audit_documents_status_effect(shipment, before: dict, user) -> None:
    """Record an R6 (documents_status) effect write — see rollback.py for the
    same before/QuerySet.update()/diff_audit_rows pattern. Skipped when no user
    is in scope (an ancient close with no completed_by and no updated_by)."""
    if user is None:
        return
    from apps.export.models import AuditLog
    from apps.export.services.sheet_audit import diff_audit_rows, snapshot_fields

    rows = diff_audit_rows(shipment, before, snapshot_fields(shipment, list(before)), user)
    if rows:
        AuditLog.objects.bulk_create(rows, batch_size=500)


def apply_task_done_effects(task: Task, shipment) -> None:
    """One-shot side effects at close (spec §4). Never re-applied later, so a
    manual edit of «Resminamalar 13:00» after it stands."""
    from apps.export.models import Shipment
    from apps.export.services.sheet_audit import snapshot_fields

    user = task.completed_by or getattr(shipment, 'updated_by', None)

    if task.title_key == 'tasks.prepare_transport_docs':
        if shipment.documents_status in (None, '', 'ready'):
            before = snapshot_fields(shipment, ['documents_status'])
            Shipment.objects.filter(pk=shipment.pk).update(documents_status=DOCS_IN_PROGRESS)
            shipment.documents_status = DOCS_IN_PROGRESS
            _audit_documents_status_effect(shipment, before, user)
    elif task.title_key == 'tasks.docs_from_customs':
        from apps.core.models import ShipmentOptionType

        code = (
            ShipmentOptionType.objects
            .filter(category='documents_status', label_tk__iexact=FROM_CUSTOMS_LABEL, is_active=True)
            .order_by('id').values_list('code', flat=True).first()
        )
        if code is None:
            logger.warning('No active documents_status option «%s»; %s left unchanged',
                           FROM_CUSTOMS_LABEL, shipment.shipment_code)
            return
        before = snapshot_fields(shipment, ['documents_status'])
        Shipment.objects.filter(pk=shipment.pk).update(documents_status=code)
        shipment.documents_status = code
        _audit_documents_status_effect(shipment, before, user)
    elif task.title_key == 'tasks.docs_to_customs' and shipment.documents_reset_at:
        # The documents for the new truck are done: drop the rollback mark.
        Shipment.objects.filter(pk=shipment.pk).update(documents_reset_at=None)
        shipment.documents_reset_at = None


def after_task_done(shipment, user, done_tasks, apply_effects: bool = True) -> list[Task]:
    """A task closed outside Shipment.save() (button, download, hook): apply its
    effects, spawn what is now due, advance through the normal gate.

    apply_effects=False when the caller already ran apply_task_done_effects on
    every one of done_tasks itself (close_auto_satisfied does this) — otherwise
    each effect would run twice for that close.
    """
    if apply_effects:
        for task in done_tasks:
            apply_task_done_effects(task, shipment)
    shipment.updated_by = user
    spawned = spawn_ready_tasks(shipment)
    from apps.export.models.shipment import advance_after_tasks
    advance_after_tasks(shipment, list(done_tasks) + spawned)
    return spawned
