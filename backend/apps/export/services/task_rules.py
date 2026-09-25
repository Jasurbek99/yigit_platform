"""Task generation, resolution, and deadline computation.

The Task system rule engine. Three public entry points:
  - generate_tasks_for_status(shipment, new_status_code) — creates one Task
    per active TaskRule matching the status code and condition.
  - resolve_for_shipment(shipment) — re-checks every open/in_progress task
    and marks DONE those whose completion_rule is satisfied by current field
    values.
  - mark_started_for_changed_fields(shipment, changed_field_keys) — sets
    started_at + IN_PROGRESS on tasks whose target_fields overlap the changed
    set.

Auto-resolution is invoked by Shipment.save() override (NOT a Django signal,
per CLAUDE.md). Generation is invoked by transition_to() inside services/
shipment.py.

Deadline grammar: see parse_deadline_rule docstring.

Idempotency: generate_tasks_for_status skips (shipment, rule) pairs that
already have a Task. Re-running it is safe.

Known limit — reverse-FK targets (firm_splits, block_sources):
  A seed rule with target_fields='firm_splits' relies on Shipment.save()
  being called AFTER related rows are added. Adding a ShipmentFirmSplit row
  does NOT call Shipment.save() on the parent. Resolution will therefore
  happen on the next event that touches the shipment (e.g. a field PATCH).
  This is accepted per plan §B4: bulk operations and related-row saves bypass
  Shipment.save(); all current direct shipment-write paths go through
  serializer.save() → model.save().
"""
import logging
import re
from datetime import datetime, time, timedelta
from typing import Iterable
from zoneinfo import ZoneInfo

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.export.models import Task, TaskRule, TaskState, TaskCompletionRule

logger = logging.getLogger(__name__)

TM_TZ = ZoneInfo('Asia/Ashgabat')

# Regex for "Nh_after_status": any positive integer, then h_after_status.
_NH_PATTERN = re.compile(r'^(\d+)h_after_status$')

# Time-of-day pattern: "HH:MM_<suffix>".
_TOD_PATTERN = re.compile(r'^(\d{2}):(\d{2})_(.+)$')


def parse_deadline_rule(rule: str, reference: datetime | None = None) -> datetime | None:
    """Convert a deadline rule string to an absolute datetime, or None.

    Grammar (all times interpreted in Asia/Ashgabat timezone):
      ''                          → None (no deadline)
      'none'                      → None
      'HH:MM_same_day'            → reference's date at HH:MM in TM_TZ
      'HH:MM_next_business_day'   → next Mon–Fri at HH:MM in TM_TZ;
                                    if reference is a Sat, result is Mon;
                                    if reference is a Sun, result is Mon;
                                    if reference is Mon–Thu, result is Tue–Fri;
                                    if reference is Fri, result is Mon.
      'Nh_after_status'           → reference + N hours (any positive integer N)
      'friday_eow'                → coming Friday at 18:00 TM_TZ (end of week).
                                    "coming" means the SAME day if reference is
                                    Friday, otherwise the next Friday.

    `reference` defaults to timezone.now(). All relative computations
    (same_day, next_business_day, friday_eow) are anchored to the date of
    `reference` in Asia/Ashgabat local time. `Nh_after_status` is anchored
    to the exact `reference` moment (not its date).

    On an unrecognised rule, logs a warning and returns None — the engine
    should never crash task generation because of a bad deadline string.
    """
    if not rule or rule == 'none':
        return None

    ref = reference if reference is not None else timezone.now()

    # Convert reference to TM local date for day-based calculations.
    ref_local = ref.astimezone(TM_TZ)
    ref_date = ref_local.date()

    # --- 'Nh_after_status' ---
    match = _NH_PATTERN.match(rule)
    if match:
        hours = int(match.group(1))
        return ref + timedelta(hours=hours)

    # --- 'friday_eow' ---
    if rule == 'friday_eow':
        # 0=Mon … 4=Fri … 5=Sat … 6=Sun
        # (4 - weekday) % 7 gives 0 on Friday (same day), 3 on Tuesday, etc.
        days_until_friday = (4 - ref_date.weekday()) % 7
        target_date = ref_date + timedelta(days=days_until_friday)
        return datetime(
            target_date.year, target_date.month, target_date.day,
            18, 0, 0,
            tzinfo=TM_TZ,
        )

    # --- 'HH:MM_same_day' / 'HH:MM_next_business_day' ---
    tod_match = _TOD_PATTERN.match(rule)
    if tod_match:
        hh = int(tod_match.group(1))
        mm = int(tod_match.group(2))
        suffix = tod_match.group(3)

        if suffix == 'same_day':
            return datetime(
                ref_date.year, ref_date.month, ref_date.day,
                hh, mm, 0,
                tzinfo=TM_TZ,
            )

        if suffix == 'next_business_day':
            # Skip Saturday (5) and Sunday (6).
            weekday = ref_date.weekday()
            if weekday < 4:     # Mon–Thu → next day is Tue–Fri
                days_ahead = 1
            elif weekday == 4:  # Fri → next business day is Mon
                days_ahead = 3
            elif weekday == 5:  # Sat → next business day is Mon
                days_ahead = 2
            else:               # Sun → next business day is Mon
                days_ahead = 1
            target_date = ref_date + timedelta(days=days_ahead)
            return datetime(
                target_date.year, target_date.month, target_date.day,
                hh, mm, 0,
                tzinfo=TM_TZ,
            )

    logger.warning(
        'task_rules.parse_deadline_rule: unrecognised rule %r — returning None',
        rule,
    )
    return None


def _condition_matches(rule: TaskRule, shipment) -> bool:
    """Return True if the rule's condition is satisfied by the shipment.

    If condition_field is blank, the rule is unconditional and always matches.
    Otherwise, str(getattr(shipment, condition_field)) is compared to
    condition_value. This coercion contract is documented on TaskRule.

    Example: condition_field='is_gapy_satys', condition_value='True'
    matches when shipment.is_gapy_satys is True.
    """
    if not rule.condition_field:
        return True
    actual = getattr(shipment, rule.condition_field, None)
    return str(actual) == rule.condition_value


UNIQUE_RULE_TASK = 'export_task_one_per_shipment_rule'


def create_rule_task(**fields) -> Task | None:
    """Create a rule's Task, or return None if it already exists.

    The generators check for an existing task and then create one; a
    concurrent request can pass the same check. The unique constraint on
    (shipment, rule) refuses the second insert, and the savepoint keeps the
    caller's transaction usable after it.
    """
    try:
        with transaction.atomic():
            return Task.objects.create(**fields)
    except IntegrityError as exc:
        if UNIQUE_RULE_TASK not in str(exc):
            raise
        return None


def generate_tasks_for_status(
    shipment,
    new_status_code: str,
    rules: Iterable[TaskRule] | None = None,
) -> list[Task]:
    """Idempotent: create one Task per active TaskRule matching the status and condition.

    Skips (shipment, rule) pairs that already have a Task — safe to call
    multiple times. Runs outside an explicit transaction; if the caller
    (transition_to) is wrapped in one, this call participates; otherwise
    each Task.objects.create() is its own implicit transaction.

    After creating tasks, calls resolve_for_shipment() once so that any new
    tasks whose target fields are already filled at status-entry time
    auto-complete immediately rather than sitting OPEN until the next save.

    Args:
        shipment: Shipment instance (must be saved with a PK).
        new_status_code: The status code the shipment just entered.
        rules: Optional pre-fetched iterable of TaskRule rows for this step.
            When provided, skips the per-call DB query — used by backfill_tasks
            to avoid an N+1 across many shipments. Callers MUST pre-filter to
            (step=new_status_code, is_active=True) themselves.

    Returns:
        List of newly created Task instances (empty if all rules were skipped).
    """
    if rules is None:
        rules = list(TaskRule.objects.filter(step=new_status_code, is_active=True))
    rule_ids = [r.id for r in rules]
    existing_rule_ids: set[int] = set(
        Task.objects.filter(shipment=shipment, rule_id__in=rule_ids)
        .values_list('rule_id', flat=True)
    )
    created: list[Task] = []
    now = timezone.now()

    for rule in rules:
        if rule.id in existing_rule_ids:
            continue
        if not _condition_matches(rule, shipment):
            continue
        deadline = parse_deadline_rule(rule.deadline_rule, reference=now)
        task = create_rule_task(
            shipment=shipment,
            step=new_status_code,
            rule=rule,
            title_key=rule.title_key,
            assignee_role=rule.assignee_role,
            target_fields=rule.target_fields,
            completion_rule=rule.completion_rule,
            target_value=rule.target_value,
            deadline=deadline,
            deadline_rule=rule.deadline_rule,
            state=TaskState.OPEN,
        )
        if task is not None:
            created.append(task)

    if created:
        logger.info(
            'Generated %d tasks for shipment %s (status=%s)',
            len(created), shipment.shipment_code, new_status_code,
        )
        # Auto-resolve any new tasks whose targets happen to be already filled.
        # Without this, those tasks sit OPEN until an unrelated save triggers
        # the resolver — e.g. tasks.confirm_destination targeting `city` on a
        # shipment that already has a destination set when entering `bardy`.
        resolve_for_shipment(shipment)

    return created


_ACTIVE_TASK_STATES = (TaskState.OPEN, TaskState.IN_PROGRESS, TaskState.BLOCKED)


def _empty_reconcile_result() -> dict:
    return {'created': [], 'cancelled': [], 'reopened': []}


def reconcile_shipment_tasks(
    shipment,
    changed_fields: Iterable[str] | None = None,
    steps: Iterable[str] | None = None,
    create_missing: bool = True,
    active_rules: list | None = None,
) -> dict:
    """Re-decide which Tasks should exist for this shipment, and why.

    Tasks are generated once, at step entry, from the rules whose condition
    matched the shipment at that moment. But a condition field
    (is_gapy_satys, has_peregruz) is edited on the Sheet long after step entry.
    This function closes that gap.

    **Scope is conditioned rules only, and only the ones whose condition field
    the caller actually wrote.** An unconditional rule cannot have been affected
    by a condition change, and neither can a rule keyed on a field nobody
    touched. Without that filter this function is `backfill_tasks` with no
    opt-out: it would emit a Task for every active rule with no row, which is
    exactly what the 2026-09-23 `tasks.set_border_point` decision forbids (see
    the comment in seed_task_rules.py — the 69 non-gapy drafts open when that
    gating rule shipped must stay unblocked).

    Per active rule in scope, exactly one outcome:
      - matches, no Task for (shipment, rule)              -> create
      - matches, Task CANCELLED with reason rule_mismatch  -> reopen
      - does not match, Task OPEN/IN_PROGRESS/BLOCKED      -> cancel
      - Task DONE                                          -> untouched
      - Task CANCELLED for any other reason                -> untouched

    DONE is untouched on purpose: the work really was done and the person keeps
    the KPI credit. A task a human cancelled, or one cancelled because the
    shipment was cancelled, is never resurrected — that is what
    cancelled_reason is for.

    This function NEVER calls auto_advance_if_ready(). Cancelling the last open
    auto-task at a step makes that step eligible (is_step_trigger_satisfied
    counts only OPEN/IN_PROGRESS), and advancing from here would let a checkbox
    move a truck, cascading through every pre-satisfied step in one save. The
    shipment advances on its next ordinary save instead, through the normal
    gate. It does call resolve_for_shipment() when it created or reopened
    anything, so a task whose targets are already filled closes immediately
    rather than sitting OPEN — the same courtesy generate_tasks_for_status()
    extends.

    Args:
        shipment: Shipment instance with a PK.
        changed_fields: Field keys the caller just wrote. When given, the
            function returns an empty result unless at least one active rule
            conditions on one of them — so an ordinary weight or date PATCH
            costs one small query and no writes. None means "reconcile
            regardless of what changed".
        active_rules: Pre-fetched active TaskRule rows. Supplied by the bulk
            path so the 24-row rule table is read once instead of once per
            shipment — the same N+1 escape generate_tasks_for_status offers.
            Callers MUST pre-filter to is_active=True themselves.
        create_missing: When False, never emit a Task for a matching rule that
            has no row — only cancel and reopen. The bulk repair path passes
            False by default so a routine `reconcile_tasks` run can never
            retroactively gate a shipment. Per-shipment PATCHes pass True: a
            deliberate edit to one shipment SHOULD give it the task its new
            state calls for.
        steps: Status codes whose rules to consider. None means every step that
            has a non-terminal task on this shipment, plus the shipment's
            current step. Scoping to the current step alone would miss
            long-lived earlier-step tasks (tasks.submit_sales_report is created
            at yola_chykdy and lives for days past it).

    Returns:
        {'created': [...], 'cancelled': [...], 'reopened': [...]} of Task
        instances, so the caller can build a notification without a second
        query.
    """
    from apps.export.models import TaskCancelReason

    # THE GATE COMES FIRST, and it is one small query. This function runs on
    # every Sheet cell edit — the hottest path in the product, used by people on
    # public networks — and the overwhelming majority of those edits touch no
    # condition field at all. The season check and the full rule load are paid
    # only once the gate has let us through. (When active_rules is supplied by
    # the bulk path, the gate costs nothing at all.)
    if changed_fields is not None:
        if active_rules is not None:
            condition_fields = {r.condition_field for r in active_rules if r.condition_field}
        else:
            condition_fields = set(
                TaskRule.objects
                .filter(is_active=True)
                .exclude(condition_field='')
                .values_list('condition_field', flat=True)
                .distinct()
            )
        if not condition_fields.intersection(set(changed_fields)):
            return _empty_reconcile_result()

    # Closed seasons are frozen (D1).
    if shipment.season_id and shipment.season.closed_at is not None:
        return _empty_reconcile_result()

    if active_rules is None:
        active_rules = list(TaskRule.objects.filter(is_active=True))
    if not active_rules:
        return _empty_reconcile_result()

    if steps is None:
        step_set = set(
            shipment.tasks
            .filter(state__in=_ACTIVE_TASK_STATES)
            .values_list('step', flat=True)
        )
        if shipment.status_id:
            step_set.add(shipment.status.code)
    else:
        step_set = set(steps)

    # Conditioned rules only — an unconditional rule is not a condition
    # question. And when the caller told us what changed, only the rules keyed
    # on one of those fields. See the Scope paragraph in the docstring.
    rules = [
        r for r in active_rules
        if r.step in step_set and r.condition_field
    ]
    if changed_fields is not None:
        changed = set(changed_fields)
        rules = [r for r in rules if r.condition_field in changed]
    if not rules:
        return _empty_reconcile_result()

    # At most one Task per (shipment, rule) — the export_task_one_per_shipment_rule
    # constraint enforces it (migration 0080). Order by id anyway so rows from
    # before the constraint resolve deterministically.
    tasks_by_rule: dict[int, Task] = {
        task.rule_id: task
        for task in shipment.tasks.filter(
            rule_id__in=[r.id for r in rules]
        ).order_by('id')
    }

    now = timezone.now()
    created: list[Task] = []
    cancelled: list[Task] = []
    reopened: list[Task] = []

    for rule in rules:
        task = tasks_by_rule.get(rule.id)
        matches = _condition_matches(rule, shipment)

        if matches:
            if task is None:
                if not create_missing:
                    continue
                task = create_rule_task(
                    shipment=shipment,
                    step=rule.step,
                    rule=rule,
                    title_key=rule.title_key,
                    assignee_role=rule.assignee_role,
                    target_fields=rule.target_fields,
                    completion_rule=rule.completion_rule,
                    target_value=rule.target_value,
                    deadline=parse_deadline_rule(rule.deadline_rule, reference=now),
                    deadline_rule=rule.deadline_rule,
                    state=TaskState.OPEN,
                )
                if task is not None:
                    created.append(task)
            elif (
                task.state == TaskState.CANCELLED
                and task.cancelled_reason == TaskCancelReason.RULE_MISMATCH
            ):
                # Recompute the deadline from now and clear started_at. A task
                # cancelled days ago would otherwise come back already overdue,
                # putting work nobody could have done on the overdue board and
                # the owning role's KPI. Created tasks get a fresh deadline
                # (above), so this keeps the two branches consistent.
                task.state = TaskState.OPEN
                task.cancelled_reason = ''
                task.deadline = parse_deadline_rule(task.deadline_rule, reference=now)
                task.started_at = None
                task.save(update_fields=[
                    'state', 'cancelled_reason', 'deadline', 'started_at',
                ])
                reopened.append(task)
        elif task is not None and task.state in _ACTIVE_TASK_STATES:
            task.state = TaskState.CANCELLED
            task.cancelled_reason = TaskCancelReason.RULE_MISMATCH
            task.save(update_fields=['state', 'cancelled_reason'])
            cancelled.append(task)

    # Per step, not globally: a step can lose its last open auto-task while a
    # different step gains one, and a MANUAL_DONE replacement at the SAME step
    # does not restore a gate either, because is_step_trigger_satisfied excludes
    # MANUAL_DONE. Guarding on `cancelled and not created` missed both cases.
    for step in sorted({t.step for t in cancelled}):
        still_gated = (
            shipment.tasks
            .filter(step=step, state__in=(TaskState.OPEN, TaskState.IN_PROGRESS))
            .exclude(completion_rule=TaskCompletionRule.MANUAL_DONE)
            .exists()
        )
        if not still_gated:
            logger.warning(
                'reconcile_shipment_tasks: shipment %s: step %s has no open '
                'auto-task left after this reconcile, so it may now be '
                'auto-advance eligible on the next ordinary save',
                shipment.shipment_code, step,
            )

    if created or reopened:
        # Close anything whose targets are already filled. Deliberately NOT
        # auto_advance_if_ready — see the docstring.
        resolve_for_shipment(shipment)
        for task in created + reopened:
            task.refresh_from_db()

    if created or cancelled or reopened:
        logger.info(
            'reconcile_shipment_tasks: shipment %s: created %d, cancelled %d, reopened %d',
            shipment.shipment_code, len(created), len(cancelled), len(reopened),
        )

    return {'created': created, 'cancelled': cancelled, 'reopened': reopened}


def reconcile_conditions_for_shipments(
    shipments=None,
    dry_run: bool = False,
    create_missing: bool = False,
) -> dict:
    """Run the condition pass across many shipments, with a dry-run mode.

    The bulk counterpart to reconcile_shipment_tasks, used by the
    reconcile_tasks command to repair shipments whose condition fields were
    edited before that function existed. Deliberately an explicit operator
    action: cancelling a stale task can leave a step auto-advance eligible, so
    this is something a human runs after reading a dry run, not something a
    Sheet edit triggers en masse.

    dry_run computes the plan by reading the same rule/task state through
    _plan_condition_changes and never calling the mutator.

    Args:
        shipments: Optional iterable of Shipment instances. None means every
            shipment in an open season that has at least one non-terminal task.
            A shipment with no tasks at all is only reconciled when passed
            explicitly — a full-table sweep creating tasks for every historical
            row is not what an operator asked for.
        dry_run: When True, report what would change and write nothing.
        create_missing: **Defaults to False.** A routine repair run cancels the
            tasks a condition change stranded but never emits new ones — that is
            what keeps `reconcile_tasks` a mutator, as the 2026-09-23
            `tasks.set_border_point` decision requires (emitting would gate the
            69 legacy non-gapy drafts on a rule they were deliberately exempted
            from). Pass True, or `--create-missing` on the command, to opt in.

    Returns:
        {'created': int, 'cancelled': int, 'reopened': int,
         'shipments_scanned': int, 'changes': list[dict]} where each change is
        {'shipment_code': str, 'title_key': str, 'action': str}.
    """
    from apps.export.models import Shipment

    if shipments is None:
        shipment_ids = (
            Task.objects
            .filter(state__in=_ACTIVE_TASK_STATES, rule__isnull=False)
            .filter(shipment__season__closed_at__isnull=True)
            .values_list('shipment_id', flat=True)
            .distinct()
        )
        # NOT list(shipment_ids): a materialised list becomes one IN parameter
        # per shipment, and mssql-django caps a statement at 2100. Passing the
        # queryset makes Django emit a subquery instead. Task has no
        # Meta.ordering, so no derived-table ORDER BY is inherited.
        candidates = list(
            Shipment.objects
            .filter(pk__in=shipment_ids)
            .select_related('status', 'season')
        )
    else:
        candidates = [s for s in shipments if s.season.closed_at is None]

    totals = {'created': 0, 'cancelled': 0, 'reopened': 0}
    changes: list[dict] = []

    # Load the (24-row) rule table ONCE. Without this every iteration re-ran
    # list(TaskRule.objects.filter(is_active=True)) — the same N+1
    # generate_tasks_for_status already solved with its `rules=` parameter.
    active_rules = list(TaskRule.objects.filter(is_active=True))

    for shipment in candidates:
        if dry_run:
            plan = _plan_condition_changes(
                shipment, active_rules=active_rules, create_missing=create_missing,
            )
        else:
            result = reconcile_shipment_tasks(
                shipment, active_rules=active_rules, create_missing=create_missing,
            )
            plan = {
                key: [(t.title_key, key) for t in result[key]]
                for key in ('created', 'cancelled', 'reopened')
            }

        for action in ('created', 'cancelled', 'reopened'):
            entries = plan.get(action, [])
            totals[action] += len(entries)
            for title_key, _action in entries:
                changes.append({
                    'shipment_code': shipment.shipment_code,
                    'title_key': title_key,
                    'action': action,
                })

    logger.info(
        'reconcile_conditions_for_shipments: scanned %d shipment(s): '
        'created %d, cancelled %d, reopened %d%s',
        len(candidates), totals['created'], totals['cancelled'],
        totals['reopened'], ' (dry run)' if dry_run else '',
    )
    return {**totals, 'shipments_scanned': len(candidates), 'changes': changes}


def _plan_condition_changes(
    shipment,
    active_rules: list | None = None,
    create_missing: bool = False,
) -> dict:
    """Read-only twin of reconcile_shipment_tasks's decision loop.

    Returns the same shape the mutating path reports, as
    {action: [(title_key, action), ...]}, without writing. Kept next to
    reconcile_shipment_tasks so the two decision loops stay in step;
    test_dry_run_plan_matches_the_real_run asserts they agree.
    """
    from apps.export.models import TaskCancelReason

    if shipment.season_id and shipment.season.closed_at is not None:
        return {'created': [], 'cancelled': [], 'reopened': []}

    if active_rules is None:
        active_rules = list(TaskRule.objects.filter(is_active=True))
    step_set = set(
        shipment.tasks
        .filter(state__in=_ACTIVE_TASK_STATES)
        .values_list('step', flat=True)
    )
    if shipment.status_id:
        step_set.add(shipment.status.code)
    # Same scope as reconcile_shipment_tasks: conditioned rules only.
    rules = [r for r in active_rules if r.step in step_set and r.condition_field]

    tasks_by_rule = {
        task.rule_id: task
        for task in shipment.tasks.filter(
            rule_id__in=[r.id for r in rules]
        ).order_by('id')
    }

    plan: dict = {'created': [], 'cancelled': [], 'reopened': []}
    for rule in rules:
        task = tasks_by_rule.get(rule.id)
        matches = _condition_matches(rule, shipment)
        if matches:
            if task is None:
                if create_missing:
                    plan['created'].append((rule.title_key, 'created'))
            elif (
                task.state == TaskState.CANCELLED
                and task.cancelled_reason == TaskCancelReason.RULE_MISMATCH
            ):
                plan['reopened'].append((task.title_key, 'reopened'))
        elif task is not None and task.state in _ACTIVE_TASK_STATES:
            plan['cancelled'].append((task.title_key, 'cancelled'))
    return plan


def _resolve_value(shipment, dotted_path: str):
    """Walk a dotted attribute path on shipment.

    'quality.azyk_maglumatnama' → getattr(getattr(shipment, 'quality'),
    'azyk_maglumatnama').

    Handles:
    - OneToOne related (e.g. quality) — returns None when the related row
      does not exist yet. The RelatedObjectDoesNotExist exception is caught
      intentionally here (not lazy error swallowing — the model raises this
      specific exception when the 1:1 has no row, which is a valid "not
      filled yet" state rather than a programming error).
    - Reverse-FK / M2M managers at leaf position — returns True if
      .exists() else False. This covers target_fields like 'firm_splits'
      or 'block_sources'.
    - Any other AttributeError / exception — returns None (treated as
      "not filled").
    """
    obj = shipment
    parts = dotted_path.split('.')
    for i, part in enumerate(parts):
        if obj is None:
            return None
        try:
            obj = getattr(obj, part)
        except Exception:
            # Covers RelatedObjectDoesNotExist (OneToOne missing row),
            # AttributeError (field does not exist on model), and any
            # other unexpected access error — all mean "not filled".
            return None
        # Detect a related-manager (reverse FK / M2M) at the leaf position.
        if hasattr(obj, 'exists') and callable(getattr(obj, 'exists', None)) and hasattr(obj, 'all'):
            if i == len(parts) - 1:
                return obj.exists()
            # Manager in the middle of a path — not navigable.
            return None
    return obj


def _is_filled(value) -> bool:
    """Return True if `value` counts as "filled" for completion purposes.

    Filled = not None, not empty string, not False.
    Numeric 0 IS considered filled (a weight of 0.00 kg is a valid entry;
    refusing to resolve a weight-task just because the value happens to be 0
    would be surprising).
    True (from a related-manager .exists() call) counts as filled.
    """
    if value is None:
        return False
    if value is False:
        return False
    if isinstance(value, str) and value == '':
        return False
    return True


def _completion_satisfied(task: Task, shipment) -> bool:
    """Return True if the task's completion_rule is met by current shipment state.

    MANUAL_DONE tasks are never auto-resolved — they require an explicit
    /complete/ API call.
    """
    if task.completion_rule == TaskCompletionRule.MANUAL_DONE:
        return False

    targets = task.target_field_list
    if not targets:
        # No target fields — cannot auto-resolve (treat as MANUAL_DONE semantics
        # even if the rule is not MANUAL_DONE; guard against misconfigured rules).
        return False

    if task.completion_rule == TaskCompletionRule.FIELD_EQUALS:
        # Single-field value-equality check. Compares as strings to make
        # the rule agnostic to choice-field internal representations.
        if len(targets) != 1:
            return False
        actual = _resolve_value(shipment, targets[0])
        if actual is None:
            return False
        return str(actual) == task.target_value

    values = [_resolve_value(shipment, t) for t in targets]

    if task.completion_rule == TaskCompletionRule.ALL_FIELDS_FILLED:
        return all(_is_filled(v) for v in values)

    if task.completion_rule == TaskCompletionRule.ANY_FIELD_FILLED:
        return any(_is_filled(v) for v in values)

    return False


def resolve_for_shipment(shipment) -> list[Task]:
    """Re-check every open/in_progress task on this shipment and resolve met ones.

    For each task whose completion_rule is satisfied by the current shipment
    state: set state=DONE, completed_at=now(), started_at=now() if missing.

    Called from Shipment.save(). Bulk operations (QuerySet.update(),
    bulk_update()) bypass Shipment.save() and therefore bypass this function —
    that is a known limit. All current shipment-write paths (Sheet PATCH,
    Detail PATCH, transition_to, admin) go through serializer.save() →
    model.save(), so resolution fires correctly.

    Args:
        shipment: The Shipment instance (freshly saved, PK must exist).

    Returns:
        List of Task instances that were resolved in this call.
    """
    open_tasks = list(
        shipment.tasks
        .filter(state__in=[TaskState.OPEN, TaskState.IN_PROGRESS])
        .select_related('rule')
    )
    if not open_tasks:
        return []

    now = timezone.now()
    resolved: list[Task] = []
    actor = getattr(shipment, 'updated_by', None)

    for task in open_tasks:
        if _completion_satisfied(task, shipment):
            task.state = TaskState.DONE
            task.completed_at = now
            if not task.started_at:
                task.started_at = now
            task.completed_by = actor
            task.save(update_fields=['state', 'completed_at', 'started_at', 'completed_by'])
            resolved.append(task)

    if resolved:
        logger.info(
            'Auto-resolved %d tasks for shipment %s',
            len(resolved), shipment.shipment_code,
        )
    return resolved


def close_sales_report_task(shipment, user) -> int:
    """Close the step-4 sales-report reminder and re-run resolution/auto-advance.

    Called from the set_sales_report endpoint AFTER the SalesReport is saved.
    Two distinct actions (the engine handles neither on its own here because
    saving a SalesReport does not call Shipment.save()):

      1. Explicitly mark the ``tasks.submit_sales_report`` reminder DONE. That
         rule is MANUAL_DONE (non-gating, or a step-4 task would freeze the
         truck), and the engine never auto-resolves MANUAL_DONE tasks — so it
         must be closed in code when the report is filled.
      2. Call ``shipment.save()`` so the standard Shipment.save() chain
         (resolve_for_shipment → auto_advance_if_ready) fires. This resolves the
         retargeted ``satyldy`` trigger (target_fields='sales_report') and
         auto-advances to ``tamamlandy`` when the shipment is at satyldy. On the
         common early-fill path (report saved mid-transit) nothing advances now;
         the satyldy trigger instead resolves on step entry later.

    Idempotent: re-PATCHing the report finds no OPEN reminder to close and the
    save chain is a no-op advance-wise.

    Args:
        shipment: The Shipment instance (fully loaded, PK exists).
        user: The user saving the report — credited for any auto-transition.

    Returns:
        Number of reminder tasks closed by this call (0 or more).
    """
    now = timezone.now()
    reminders = list(
        shipment.tasks.filter(
            title_key='tasks.submit_sales_report',
            state__in=[TaskState.OPEN, TaskState.IN_PROGRESS],
        )
    )
    for task in reminders:
        task.state = TaskState.DONE
        task.completed_at = now
        if not task.started_at:
            task.started_at = now
        task.completed_by = user
        task.save(update_fields=['state', 'completed_at', 'started_at', 'completed_by'])

    if reminders:
        logger.info(
            'Closed %d sales-report reminder task(s) for shipment %s',
            len(reminders), shipment.shipment_code,
        )

    # Fire the standard save chain so the satyldy report-existence trigger
    # resolves and auto-advance runs (auto_advance needs updated_by set).
    shipment.updated_by = user
    shipment.save()

    return len(reminders)


def reconcile_open_tasks_with_rules(
    shipments=None,
    dry_run: bool = False,
) -> dict:
    """Sync stale open Task rows with their parent TaskRule, then re-resolve.

    When a TaskRule is edited after Tasks have already been generated, those
    existing open Tasks retain the old snapshotted values. This function
    detects the drift and repairs it in-place so auto-resolution uses the
    current rule definition.

    Algorithm:
      1. Select all OPEN / IN_PROGRESS / BLOCKED Tasks whose `rule` is not null.
      2. For each Task, compare the four mutable axes against the live rule:
         title_key, target_fields, completion_rule, target_value.
      3. If any axis differs, update the Task (unless dry_run=True).
      4. Collect the distinct set of affected Shipments and call
         resolve_for_shipment() on each so newly-correct Tasks that are already
         satisfiable close immediately.

    Args:
        shipments: Optional iterable of Shipment instances to scope the query.
            When None, all active-state Tasks across all Shipments are checked.
        dry_run: When True, compute and return the diff without writing anything.
            The return dict includes a ``changes`` list of per-task diffs for
            human-readable reporting.

    Returns:
        Summary dict with keys:
          - ``tasks_synced``       — number of Task rows updated (0 in dry_run)
          - ``shipments_reresolved`` — number of distinct Shipments re-checked
          - ``tasks_resolved``     — number of Tasks auto-closed after re-check
          - ``changes``            — list of dicts describing each changed Task
            (always populated, even in non-dry-run, for reporting purposes).
            Each entry: {task_id, shipment_code, rule_id, field, old, new}.
    """
    active_states = [TaskState.OPEN, TaskState.IN_PROGRESS, TaskState.BLOCKED]
    candidate_qs = (
        Task.objects
        .filter(state__in=active_states, rule__isnull=False)
        # Closed seasons are frozen (D1). This is a mutator, not an emitter —
        # it never creates a Task, only re-syncs an existing one's snapshot
        # fields to its live TaskRule — but that resync can also flip the task
        # to DONE via resolve_for_shipment() below, which is still a write to
        # a closed-season row.
        .filter(shipment__season__closed_at__isnull=True)
        .select_related('rule', 'shipment')
    )
    if shipments is not None:
        shipment_ids = [s.id for s in shipments]
        candidate_qs = candidate_qs.filter(shipment_id__in=shipment_ids)

    candidates = list(candidate_qs)
    if not candidates:
        return {'tasks_synced': 0, 'shipments_reresolved': 0, 'tasks_resolved': 0, 'changes': []}

    # assignee_role is synced too: repointing a rule at the correct role (e.g. the
    # 2026-07 warehouse_chief → loading_dept_head fix) must move the open tasks,
    # or the right team still can't see today's work. Only active tasks are
    # candidates (see active_states above), so completed history is never rewritten.
    _AXES = ('title_key', 'target_fields', 'completion_rule', 'target_value', 'assignee_role')
    tasks_synced = 0
    affected_shipment_ids: set[int] = set()
    changes: list[dict] = []

    for task in candidates:
        rule = task.rule
        task_changes_for_row: list[dict] = []

        for axis in _AXES:
            old_val = getattr(task, axis)
            new_val = getattr(rule, axis)
            if old_val != new_val:
                task_changes_for_row.append({
                    'task_id': task.pk,
                    'shipment_code': task.shipment.shipment_code,
                    'rule_id': rule.pk,
                    'field': axis,
                    'old': old_val,
                    'new': new_val,
                })

        if not task_changes_for_row:
            continue

        changes.extend(task_changes_for_row)
        affected_shipment_ids.add(task.shipment_id)

        if not dry_run:
            for axis in _AXES:
                setattr(task, axis, getattr(rule, axis))
            task.save(update_fields=list(_AXES))
            tasks_synced += 1

    tasks_resolved = 0
    if not dry_run and affected_shipment_ids:
        # Re-fetch shipments so resolve_for_shipment works with fresh instances.
        from apps.export.models import Shipment  # noqa: PLC0415 — local import
        affected_shipments = list(
            Shipment.objects.filter(pk__in=affected_shipment_ids).select_related('status')
        )
        for shipment in affected_shipments:
            resolved = resolve_for_shipment(shipment)
            tasks_resolved += len(resolved)

        logger.info(
            'reconcile_open_tasks_with_rules: synced %d tasks across %d shipments, '
            'resolved %d tasks',
            tasks_synced, len(affected_shipments), tasks_resolved,
        )

    return {
        'tasks_synced': tasks_synced,
        'shipments_reresolved': len(affected_shipment_ids),
        'tasks_resolved': tasks_resolved,
        'changes': changes,
    }


def mark_started_for_changed_fields(
    shipment, changed_field_keys: Iterable[str],
) -> None:
    """Set started_at + state=IN_PROGRESS on OPEN tasks targeting the changed fields.

    Called from the Sheet/Detail PATCH viewset AFTER serializer.save(), passing
    the set of field keys from the request payload. This provides the
    "started_at signal" that requires knowing the diff — Shipment.save()
    cannot provide this because it has no diff context.

    Idempotent: already-IN_PROGRESS or further-progressed tasks are not touched.

    Args:
        shipment: The Shipment instance (post-save).
        changed_field_keys: Iterable of field key strings (API names, matching
            the target_fields CSV convention in TaskRule / Task).
    """
    changed = set(changed_field_keys)
    if not changed:
        return

    open_tasks = list(shipment.tasks.filter(state=TaskState.OPEN))
    if not open_tasks:
        return

    now = timezone.now()
    for task in open_tasks:
        targets = set(task.target_field_list)
        if targets & changed:
            task.state = TaskState.IN_PROGRESS
            if not task.started_at:
                task.started_at = now
            task.save(update_fields=['state', 'started_at'])
