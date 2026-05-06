"""Comment and task service for the Sheet comment system.

Business logic for creating comments, fanning out notifications, and
managing task lifecycle (mark done / reopen).

Dependency direction: imports only from core/ and export/ (no contracts/finance).
All mutating functions are wrapped in transaction.atomic() — partial state on
failure is never persisted.
"""
import logging
from typing import Optional

from django.db import transaction
from django.utils import timezone

logger = logging.getLogger(__name__)

# ── Allowed field_key values ────────────────────────────────────────────────
# Derived from frontend/src/constants/sheetRowConfig.ts fieldKey values.
# Update here whenever sheetRowConfig.ts changes.
SHEET_FIELD_KEYS: frozenset[str] = frozenset([
    'vehicle_condition',
    'notes',
    'export_manager_note',
    'documents_status',
    'cargo_code',
    'block_sources',
    'firm_splits',
    'country',
    'customer',
    'city',
    'import_firm',
    'harvest_status',
    'truck_capacity',
    'product_date',
    'warehouse_comment_count',
    'document_comment_count',
    'loading_started_at',
    'loading_ended_at',
    'departed_at',
    'vehicle_responsible',
    'truck_plate',
    'customs_exit_at',
    'transit_days_temp',
    'driver_name',
    'driver_phone',
    'border_point',
    'border_crossed_at',
    'dest_entry_at',
    'customs_entry_at',
    'has_peregruz',
    'peregruz_date',
    'arrived_at',
    'rejected_weight_kg',
    'weight_net',
    'variety',
    'harvest_date',
    'sale_started_at',
    'sale_ended_at',
    'has_sales_report',
    'additional_notes_arap',
])

# Valid role codes — mirrors ROLE_CHOICES from apps.core.models.user
# (Note: 'loading_dept_head' is intentionally absent — pre-existing inconsistency tracked separately.)
_VALID_ROLES: frozenset[str] = frozenset([
    'admin',
    'export_manager',
    'warehouse_chief',
    'weight_master',
    'document_team',
    'transport',
    'sales_rep',
    'finansist',
    'director',
    'accountant',
    'greenhouse_manager',
    'seller',
    'boss',
])


def _build_link(comment) -> str:
    """Build a deep-link URL for a comment notification."""
    field = comment.field_key or ''
    return f'/export/shipments/sheet?shipment={comment.shipment_id}&row={field}&comment={comment.id}'


@transaction.atomic
def create_comment(
    shipment,
    user,
    *,
    content: str,
    field_key: Optional[str] = None,
    mentions: Optional[list[int]] = None,
    role_mentions: Optional[list[str]] = None,
    parent_comment=None,
    assignee=None,
) -> 'ShipmentComment':
    """Create a comment (or reply) and fan out notifications.

    Args:
        shipment: Shipment instance this comment belongs to.
        user: User authoring the comment.
        content: Comment body text.
        field_key: Cell anchor from SHEET_FIELD_KEYS; None = shipment-level.
        mentions: List of user IDs for @user mentions.
        role_mentions: List of role codes for @role mentions.
        parent_comment: Parent ShipmentComment for replies; None = root comment.
        assignee: User instance to assign as task; None = plain comment.

    Returns:
        The newly created ShipmentComment instance.

    Raises:
        ValueError: On invalid field_key, role code, assignee on reply, or unknown user IDs.
    """
    from apps.core.models import User
    from apps.export.models import ShipmentComment

    mentions = mentions or []
    role_mentions = role_mentions or []

    # --- Validation ---
    if parent_comment is not None:
        # Replies inherit parent's field_key silently (plan spec).
        field_key = parent_comment.field_key
        # Tasks must live on root comments only.
        if assignee is not None:
            raise ValueError('Tasks live on root comments only. Remove assignee for a reply.')

    if field_key is not None and field_key not in SHEET_FIELD_KEYS:
        raise ValueError(
            f'Invalid field_key: {field_key!r}. Must be None or one of the SHEET_FIELD_KEYS.'
        )

    invalid_roles = [r for r in role_mentions if r not in _VALID_ROLES]
    if invalid_roles:
        raise ValueError(f'Invalid role codes: {invalid_roles}. Check ROLE_CHOICES.')

    if mentions:
        found = User.objects.filter(id__in=mentions).count()
        if found != len(mentions):
            raise ValueError(
                f'One or more mentioned user IDs do not exist. '
                f'Provided: {mentions}, found: {found}.'
            )

    mentions_csv = ','.join(str(uid) for uid in mentions) if mentions else ''
    role_mentions_csv = ','.join(role_mentions) if role_mentions else ''

    comment = ShipmentComment.objects.create(
        shipment=shipment,
        user=user,
        content=content,
        field_key=field_key,
        mentions=mentions_csv or None,  # preserve nullable semantic of existing column
        role_mentions=role_mentions_csv,
        parent_comment=parent_comment,
        assignee=assignee,
        is_system=False,
    )

    _fan_out_notifications(comment)
    return comment


def _fan_out_notifications(comment) -> None:
    """Build and persist notification records for a comment.

    Rules:
    1. All explicitly @-mentioned user IDs.
    2. All active members of each @-mentioned role.
    3. Deduplicate across both groups.
    4. Remove the comment author (no self-notify).
    5. Assignee gets task_assigned; everyone else gets mention.
       Assignee is removed from the mention pool to avoid double-notify.
    6. Single bulk_create with batch_size=500 (MSSQL rule).
    """
    from apps.core.models import User
    from apps.export.models import Notification

    recipients: set[int] = set(comment.mentions_ids)

    role_list = comment.role_mentions_list
    if role_list:
        role_user_ids = list(
            User.objects.filter(
                role__in=role_list, is_active=True
            ).values_list('id', flat=True)
        )
        recipients.update(role_user_ids)

    # Author never gets notified about their own comment.
    recipients.discard(comment.user_id)

    notifications: list[Notification] = []
    shipment_repr = comment.shipment_id
    link = _build_link(comment)

    assignee_id = comment.assignee_id
    if assignee_id and assignee_id != comment.user_id:
        notifications.append(Notification(
            user_id=assignee_id,
            kind='task_assigned',
            message=(
                f'{comment.user.username} assigned you a task on shipment #{shipment_repr}'
            ),
            link=link,
        ))
        # Dedupe: assignee already gets task_assigned; skip the mention notification.
        recipients.discard(assignee_id)

    for uid in recipients:
        notifications.append(Notification(
            user_id=uid,
            kind='mention',
            message=(
                f'{comment.user.username} mentioned you on shipment #{shipment_repr}'
            ),
            link=link,
        ))

    if notifications:
        Notification.objects.bulk_create(notifications, batch_size=500)


@transaction.atomic
def mark_task_done(comment, by_user) -> None:
    """Mark a task comment as done.

    Idempotent: no-op if already done. Sends task_done notification to the
    comment author when by_user != author.

    Args:
        comment: ShipmentComment with assignee set.
        by_user: User performing the action (permission check is caller's responsibility).

    Raises:
        ValueError: If comment has no assignee (i.e., is not a task).
    """
    from apps.export.models import Notification, ShipmentComment

    # Re-read under a row lock so two concurrent requests can't both pass the
    # idempotency guard and create duplicate task_done notifications.
    comment = ShipmentComment.objects.select_for_update().get(pk=comment.pk)

    if comment.assignee_id is None:
        raise ValueError('Not a task: this comment has no assignee.')

    if comment.is_done:
        # Idempotent — already done, nothing to do.
        return

    comment.is_done = True
    comment.done_at = timezone.now()
    comment.done_by = by_user
    comment.save(update_fields=['is_done', 'done_at', 'done_by'])

    # Notify author only when someone else marks it done.
    if by_user.id != comment.user_id:
        link = _build_link(comment)
        Notification.objects.create(
            user_id=comment.user_id,
            kind='task_done',
            message=(
                f'{by_user.username} marked your task as done on shipment #{comment.shipment_id}'
            ),
            link=link,
        )


@transaction.atomic
def reopen_task(comment, by_user) -> None:
    """Reopen a previously completed task.

    Only the original comment author or the assigned user may reopen.
    No notification is sent on reopen.

    Args:
        comment: ShipmentComment that was previously marked done.
        by_user: User performing the action.

    Raises:
        ValueError: If by_user is neither the author nor the assignee.
        ValueError: If comment has no assignee (not a task).
    """
    if comment.assignee_id is None:
        raise ValueError('Not a task: this comment has no assignee.')

    if by_user.id != comment.user_id and by_user.id != comment.assignee_id:
        raise ValueError('Only the comment author or assignee can reopen a task.')

    comment.is_done = False
    comment.done_at = None
    comment.done_by = None
    comment.save(update_fields=['is_done', 'done_at', 'done_by'])
