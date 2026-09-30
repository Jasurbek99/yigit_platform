"""Put a shipment back into Preparation when its truck changes.

Spec: docs/superpowers/specs/2026-09-29-transport-trips-design.md §6.1.

Order matters: the re-gate (documents_status, cleared trigger fields, reopened
tasks) is written with queryset.update() BEFORE transition_to(). transition_to
saves the shipment, Shipment.save() runs auto-advance, and without the re-gate
every task of the steps already passed is still DONE — the cascade would walk
straight back to where the shipment was.
"""
from django.utils import timezone

from apps.core.models import User
from apps.export.models import AuditLog, Shipment, Task, TaskState
from apps.export.services.sheet_audit import diff_audit_rows, snapshot_fields
from apps.export.services.shipment import transition_to
from apps.export.services.task_rules import parse_deadline_rule

LOCKED_STATUSES = frozenset({
    'yola_chykdy', 'serhet_gechdi', 'dest_entry', 'barysh_gumrugi', 'transshipment',
    'bardy', 'satylyar', 'satyldy', 'tamamlandy', 'cancelled',
})
# The lifecycle up to loading, and the auto-rule that gates leaving each step
# (seed_task_rules.py). Rolling back from S re-opens the gate of every step the
# shipment already passed after draft and clears its trigger field — otherwise
# generate_tasks_for_status (which skips rules that already have a Task) leaves
# them DONE and the cascade replays straight through them.
PRE_LOADING_ORDER = ('draft', 'gumruk_girish', 'gumruk_chykysh', 'yuklenme')
STEP_GATES = {
    'gumruk_girish': ('tasks.trigger_customs_exit', 'customs_exit_at'),
    'gumruk_chykysh': ('tasks.trigger_loading_start', 'loading_started_at'),
}
# PREP/DOCS chain (owner, 2026-09-30): the truck is printed on the transport
# documents (11) and everything built on them, so a truck change redoes 11–21b,
# 22 and the advance (a second one — the first stays linked). The contract (9)
# and gross/net (10) do not depend on the truck.
REDO_TASKS = (
    'tasks.prepare_transport_docs', 'tasks.print_cmr', 'tasks.print_tir', 'tasks.print_ct1',
    'tasks.print_phyto', 'tasks.ct1_phyto_sent', 'tasks.print_customs_request',
    'tasks.docs_to_stamp', 'tasks.docs_from_stamp', 'tasks.give_advance',
    'tasks.prepare_declaration', 'tasks.docs_to_customs', 'tasks.docs_from_customs',
)


def is_transport_locked(shipment: Shipment) -> bool:
    """True when the truck may no longer change on this shipment (spec D6)."""
    code = shipment.status.code
    if code in LOCKED_STATUSES:
        return True
    return code == 'yuklenme' and bool(shipment.loading_started_at or shipment.loading_ended_at)


def reopen_rule_task(shipment: Shipment, title_key: str) -> bool:
    """Reopen the DONE task of one rule with a fresh deadline. False if none."""
    now = timezone.now()
    tasks = list(Task.objects.filter(shipment=shipment, rule__title_key=title_key, state=TaskState.DONE))
    for task in tasks:
        task.state = TaskState.OPEN
        task.deadline = parse_deadline_rule(task.deadline_rule, reference=now)
        task.started_at = None
        task.completed_at = None
        task.completed_by = None
        task.save(update_fields=['state', 'deadline', 'started_at', 'completed_at', 'completed_by'])
    return bool(tasks)


def rollback_to_draft(shipment: Shipment, user: User, reason: str) -> None:
    """Send a shipment back to Preparation, re-gating every step it already passed."""
    code = shipment.status.code
    if code == 'draft':
        return
    passed = PRE_LOADING_ORDER[1:PRE_LOADING_ORDER.index(code)]
    regate = {'documents_status': 'in_progress', 'documents_reset_at': timezone.now()}
    for step in passed:
        regate[STEP_GATES[step][1]] = None
    before = snapshot_fields(shipment, list(regate))
    Shipment.objects.filter(pk=shipment.pk).update(**regate)
    for name, value in regate.items():
        setattr(shipment, name, value)
    # queryset.update() skips the save-time audit; record the cleared values here.
    rows = diff_audit_rows(shipment, before, snapshot_fields(shipment, list(regate)), user)
    if rows:
        AuditLog.objects.bulk_create(rows, batch_size=500)
    reopen_rule_task(shipment, 'tasks.start_documents_prep')
    for title_key in REDO_TASKS:
        reopen_rule_task(shipment, title_key)
    for step in passed:
        reopen_rule_task(shipment, STEP_GATES[step][0])
    transition_to(shipment, 'draft', user, comment=reason, is_auto=True, notify=False, rollback=True)
