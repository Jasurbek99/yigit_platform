"""Generic approval workflow utilities.

Shared transition mechanics for plan-like models with status workflows
(draft → submitted → approved / rejected). Each domain service calls
these helpers for the common parts (status update, audit, timestamps)
and handles domain-specific logic itself.
"""
import logging
from typing import Any

from django.utils import timezone

logger = logging.getLogger(__name__)


def validate_transition(
    current_status: str,
    target_status: str,
    transitions: dict[str, list[str]],
) -> None:
    """Validate that a status transition is allowed.

    Raises:
        ValueError: If the transition is not in the allowed map.
    """
    allowed = transitions.get(current_status, [])
    if target_status not in allowed:
        raise ValueError(
            f"Cannot transition from '{current_status}' to '{target_status}'. "
            f"Allowed: {allowed}"
        )


def apply_status_change(
    plan: Any,
    target_status: str,
    user: 'User',
    *,
    timestamp_field: str,
    user_field: str,
    clear_fields: list[str] | None = None,
) -> list[str]:
    """Apply status change fields to a plan-like model instance.

    Sets status, the target timestamp/user fields, updated_at,
    and optionally clears other fields (e.g., rejection fields on resubmit).

    Args:
        plan: Model instance with status, updated_at, and workflow fields.
        target_status: New status value.
        user: User performing the action.
        timestamp_field: Field name for the action timestamp (e.g., 'submitted_at').
        user_field: Field name for the acting user FK (e.g., 'submitted_by').
        clear_fields: Optional field names to set to None (e.g., rejection fields).

    Returns:
        List of field names that were updated (for save(update_fields=...)).
    """
    now = timezone.now()
    plan.status = target_status
    setattr(plan, timestamp_field, now)
    setattr(plan, user_field, user)
    plan.updated_at = now

    update_fields = ['status', timestamp_field, user_field, 'updated_at']

    for field in (clear_fields or []):
        setattr(plan, field, None)
        update_fields.append(field)

    return update_fields


def create_audit_entry(
    user: 'User',
    action: str,
    model_name: str,
    object_id: int,
    object_repr: str,
    detail: str,
) -> None:
    """Create an AuditLog entry for a workflow action.

    Uses lazy import to avoid circular dependency (AuditLog is in export).
    """
    from apps.export.models import AuditLog

    AuditLog.objects.create(
        user=user,
        action=action,
        model_name=model_name,
        object_id=object_id,
        object_repr=object_repr,
        detail=detail,
    )
