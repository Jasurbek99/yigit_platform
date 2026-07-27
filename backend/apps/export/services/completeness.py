"""Per-shipment data completeness, derived from TaskRule.

Answers one question for the Detail page: which fields SHOULD be filled by
now, and which of those are still empty.

Source of truth is TaskRule.target_fields, read LIVE. We deliberately do not
read Task rows: editing a TaskRule leaves already-generated Tasks holding a
stale snapshot until `reconcile_tasks` runs, which would make the highlight
disagree with the rules an admin just edited. Task rows ARE used for the
manual-task list, because rules with an empty target_fields have no field to
check and only exist as Task instances.

Read-only. Never writes. No new model.
"""
from apps.core.models import ShipmentStatusType
from apps.export.models import Task, TaskRule, TaskState
from apps.export.services.task_rules import (
    _condition_matches,
    _is_filled,
    _resolve_value,
)

# A cancelled shipment owes nothing — no field on it is "overdue".
_CANCELLED = 'cancelled'


def _split_fields(csv_value: str) -> list[str]:
    """Parse TaskRule.target_fields (CSV CharField, not JSON — see CLAUDE.md)."""
    return [f.strip() for f in csv_value.split(',') if f.strip()]


def compute_completeness(shipment) -> dict:
    """Return the completeness block for one shipment.

    Keys:
        required_total:  count of distinct fields owed by now
        filled_count:    how many of those are filled
        missing_fields:  [{key, title_key, step, role}] for the unfilled ones
        manual_tasks:    [{id, title_key, role, is_overdue}] for open tasks
                         whose rule has no target_fields

    Ordering is stable: missing_fields follows the lifecycle step order, then
    the field's position within the rule, so the UI does not reshuffle chips
    between renders.
    """
    empty = {
        'required_total': 0,
        'filled_count': 0,
        'missing_fields': [],
        'manual_tasks': [],
    }

    if not shipment.status_id:
        return empty

    current_code = shipment.status.code
    if current_code == _CANCELLED:
        return empty

    current_order = shipment.status.step_order

    # Every status the shipment is at or has already passed. Using step_order
    # (rather than walking status_log) deliberately also covers steps skipped
    # by the auto-advance cascade — their fields are still owed.
    passed_codes = list(
        ShipmentStatusType.objects
        .filter(step_order__lte=current_order, is_active=True)
        .exclude(code=_CANCELLED)
        .order_by('step_order')
        .values_list('code', flat=True)
    )
    order_by_code = {code: i for i, code in enumerate(passed_codes)}

    rules = (
        TaskRule.objects
        .filter(is_active=True, step__in=passed_codes)
        .order_by('id')
    )

    seen: set[str] = set()
    required: list[dict] = []

    for rule in rules:
        if not _condition_matches(rule, shipment):
            continue
        for field_key in _split_fields(rule.target_fields):
            if field_key in seen:
                continue
            seen.add(field_key)
            required.append({
                'key': field_key,
                'title_key': rule.title_key,
                'step': rule.step,
                'role': rule.assignee_role,
                '_sort': (order_by_code.get(rule.step, 0), rule.id),
            })

    required.sort(key=lambda item: item['_sort'])

    missing = []
    filled_count = 0
    for item in required:
        if _is_filled(_resolve_value(shipment, item['key'])):
            filled_count += 1
        else:
            missing.append({
                'key': item['key'],
                'title_key': item['title_key'],
                'step': item['step'],
                'role': item['role'],
            })

    manual_tasks = [
        {
            'id': task.id,
            'title_key': task.title_key,
            'role': task.assignee_role,
            'is_overdue': task.is_overdue,
        }
        for task in (
            Task.objects
            .filter(
                shipment=shipment,
                state__in=[TaskState.OPEN, TaskState.IN_PROGRESS],
                rule__target_fields='',
            )
            .select_related('rule')
            .order_by('id')
        )
    ]

    return {
        'required_total': len(required),
        'filled_count': filled_count,
        'missing_fields': missing,
        'manual_tasks': manual_tasks,
    }
