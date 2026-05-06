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
        task = Task.objects.create(
            shipment=shipment,
            step=new_status_code,
            rule=rule,
            title_key=rule.title_key,
            assignee_role=rule.assignee_role,
            target_fields=rule.target_fields,
            completion_rule=rule.completion_rule,
            deadline=deadline,
            deadline_rule=rule.deadline_rule,
            state=TaskState.OPEN,
        )
        created.append(task)

    if created:
        logger.info(
            'Generated %d tasks for shipment %s (status=%s)',
            len(created), shipment.cargo_code, new_status_code,
        )
        # Auto-resolve any new tasks whose targets happen to be already filled.
        # Without this, those tasks sit OPEN until an unrelated save triggers
        # the resolver — e.g. tasks.confirm_destination targeting `city` on a
        # shipment that already has a destination set when entering `bardy`.
        resolve_for_shipment(shipment)

    return created


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

    for task in open_tasks:
        if _completion_satisfied(task, shipment):
            task.state = TaskState.DONE
            task.completed_at = now
            if not task.started_at:
                task.started_at = now
            task.save(update_fields=['state', 'completed_at', 'started_at'])
            resolved.append(task)

    if resolved:
        logger.info(
            'Auto-resolved %d tasks for shipment %s',
            len(resolved), shipment.cargo_code,
        )
    return resolved


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
