"""Shipment lifecycle services: transitions, creation, and pallet manifest.

This module contains the canonical transition_to() function which is the ONLY
way to update shipment status and AD-1 denormalized timestamp fields.

State machine v2 (12 active statuses + 3 retired):
    draft → gumruk_girish → gumruk_chykysh → yuklenme → yola_chykdy →
    serhet_gechdi → dest_entry → barysh_gumrugi →
        (has_peregruz=True)  → transshipment → bardy
        (has_peregruz=False) → bardy
    → satylyar → satyldy → tamamlandy

Retired codes (kept in DB for audit reference, is_active=False):
    serhet_tm (merged into serhet_gechdi)
    yolda     (mapped to barysh_gumrugi)
    hasabat   (merged into tamamlandy)

Each status corresponds to one operator-entered field on the Sheet. When that
field is filled, auto_advance_if_ready() fires the transition automatically.
See task_rules.py for the field→step mapping (seed_task_rules.py is the
declarative source of truth).
"""
import logging
from decimal import Decimal
from typing import Callable, Optional

from django.db import transaction
from django.utils import timezone

from apps.export.models import Shipment, ShipmentStatusLog

logger = logging.getLogger(__name__)

# Status code → denormalized timestamp field name on Shipment.
# Empty in v2: every lifecycle timestamp is operator-entered on the Sheet.
# transition_to() still updates `status` + `status_changed_at`. The map is
# kept as a hook in case a future status wants a dedicated auto-set timestamp.
STATUS_TIMESTAMP_MAP: dict[str, str] = {}

# Roles that may override role restrictions and trigger any valid transition.
PRIVILEGED_ROLES = {'export_manager', 'director'}

# Roles allowed to CANCEL a shipment. Superset of PRIVILEGED_ROLES + the
# system admin. (admin is the top-tier system role per ADR-15; it isn't in the
# narrow operational PRIVILEGED_ROLES above, so it's listed explicitly here.)
# Superusers bypass the role gate entirely — see transition_to().
CANCEL_ROLES = PRIVILEGED_ROLES | {'admin'}

# Allowed transitions: from_code → list of edge tuples.
# Edge tuple shape: (to_code, allowed_roles) OR (to_code, allowed_roles, predicate)
# where predicate is Callable[[Shipment], bool] used by auto-advance to pick
# the right target when multiple edges exist. Manual transitions IGNORE
# predicates — the user explicitly picks the target.
#
# None key = shipment has no status yet (legacy fallback, unused by current flow).
# Cancel edges use list(CANCEL_ROLES) (declared above) so the set membership is
# captured at module load time.
TRANSITIONS: dict[Optional[str], list[tuple]] = {
    None:              [('draft',          ['warehouse_chief'])],
    'draft':           [('gumruk_girish',  ['document_team']),
                        ('cancelled',      list(CANCEL_ROLES))],
    'gumruk_girish':   [('gumruk_chykysh', ['document_team']),
                        ('cancelled',      list(CANCEL_ROLES))],
    'gumruk_chykysh':  [('yuklenme',       ['warehouse_chief']),
                        ('cancelled',      list(CANCEL_ROLES))],
    'yuklenme':        [('yola_chykdy',    ['document_team']),
                        ('cancelled',      list(CANCEL_ROLES))],
    'yola_chykdy':     [('serhet_gechdi',  ['transport']),
                        ('cancelled',      list(CANCEL_ROLES))],
    'serhet_gechdi':   [('dest_entry',     ['sales_rep']),
                        ('cancelled',      list(CANCEL_ROLES))],
    'dest_entry':      [('barysh_gumrugi', ['sales_rep']),
                        ('cancelled',      list(CANCEL_ROLES))],
    # Conditional fork: transshipment only on shipments with has_peregruz=True.
    'barysh_gumrugi':  [
        ('transshipment', ['sales_rep'], lambda s: bool(getattr(s, 'has_peregruz', False))),
        ('bardy',         ['sales_rep'], lambda s: not bool(getattr(s, 'has_peregruz', False))),
        ('cancelled',     list(CANCEL_ROLES)),
    ],
    'transshipment':   [('bardy',          ['sales_rep']),
                        ('cancelled',      list(CANCEL_ROLES))],
    'bardy':           [('satylyar',       ['sales_rep']),
                        ('cancelled',      list(CANCEL_ROLES))],
    'satylyar':        [('satyldy',        ['sales_rep']),
                        ('cancelled',      list(CANCEL_ROLES))],
    'satyldy':         [('tamamlandy',     ['finansist']),
                        ('cancelled',      list(CANCEL_ROLES))],
    'tamamlandy':      [],
    # 'cancelled' key intentionally absent — no outgoing edges; terminal status.
}

# When a shipment transitions TO this status, notify these roles to fill their fields.
STATUS_NOTIFY_ROLES: dict[str, list[str]] = {
    'draft':           ['warehouse_chief'],
    'gumruk_girish':   ['document_team'],
    'gumruk_chykysh':  ['document_team'],
    'yuklenme':        ['warehouse_chief'],
    'yola_chykdy':     ['transport'],
    'serhet_gechdi':   ['transport'],
    'dest_entry':      ['sales_rep'],
    'barysh_gumrugi':  ['sales_rep'],
    'transshipment':   ['sales_rep'],
    'bardy':           ['sales_rep'],
    'satylyar':        ['sales_rep'],
    'satyldy':         ['sales_rep'],
    'tamamlandy':      ['finansist'],
}


def _edge_to(edge: tuple) -> str:
    """Return the target status code from an edge tuple of any supported shape."""
    return edge[0]


def _edge_roles(edge: tuple) -> list[str]:
    """Return the allowed-roles list from an edge tuple of any supported shape."""
    return edge[1]


def _edge_predicate(edge: tuple) -> Optional[Callable]:
    """Return the predicate from an edge tuple, or None if absent."""
    return edge[2] if len(edge) >= 3 else None


def _resolve_next_status(shipment: Shipment, current_code: Optional[str]) -> Optional[str]:
    """Pick the next status code for auto-advance, honoring predicates.

    For edges with no predicate, returns the first edge's target.
    For edges with predicates, returns the first edge whose predicate is True
    for this shipment. If no predicate matches, returns None.
    """
    edges = TRANSITIONS.get(current_code, [])
    for edge in edges:
        predicate = _edge_predicate(edge)
        if predicate is None or predicate(shipment):
            return _edge_to(edge)
    return None


def _write_ad1_timestamp(
    shipment: Shipment, status_code: str, now, update_fields: list[str] | None = None,
) -> str | None:
    """Write the AD-1 denormalized timestamp field for a status code.

    Centralised helper used by transition_to(). loading_started_at is no longer
    written here (operator-entered on the Sheet). Returns the field name that
    was written, or None if the status has no mapping.
    """
    ts_field = STATUS_TIMESTAMP_MAP.get(status_code)
    if ts_field:
        setattr(shipment, ts_field, now)
        if update_fields is not None:
            update_fields.append(ts_field)
    return ts_field


def transition_to(
    shipment: Shipment,
    new_status_code: str,
    user,
    comment: str = '',
    is_auto: bool = False,
) -> None:
    """Execute a validated status transition with role enforcement.

    This is the ONLY function that may update shipment.status. Never update
    that field directly. AD-1 timestamps are no longer set here in v2 — they
    are operator-entered on the Sheet.

    Args:
        shipment: The Shipment instance to transition.
        new_status_code: Target status code string (e.g. 'gumruk_girish').
        user: User performing the transition (core.User instance).
        comment: Optional audit comment stored in ShipmentStatusLog.
        is_auto: True when the transition was fired by auto-advance rather
                 than an explicit user action. When True: the role check is
                 skipped (the editing user may not own the next role) and
                 the resulting ShipmentStatusLog row is flagged is_auto=True.

    Raises:
        ValueError: If the transition is not allowed from the current status,
                    or if new_status_code does not exist in ShipmentStatusType.
        PermissionError: If the user's role is not allowed to trigger this
                         transition AND is_auto=False.
    """
    from apps.core.models import ShipmentStatusType

    current_code = shipment.status.code if shipment.status_id else None
    edges = TRANSITIONS.get(current_code, [])
    allowed_codes = [_edge_to(edge) for edge in edges]

    if new_status_code not in allowed_codes:
        raise ValueError(
            f'Cannot transition from {current_code!r} to {new_status_code!r}. '
            f'Allowed: {allowed_codes}'
        )

    # Role check — privileged roles bypass per-transition restrictions. Auto-
    # advance bypasses too: the editing user may be sales_rep filling a field
    # that fires a transition whose canonical role is warehouse_chief; that's
    # fine, the audit row is flagged is_auto=True. Superusers also bypass: the
    # system admin/developer account can drive any transition (matches the
    # is_superuser allow used across the viewsets).
    if not is_auto and not getattr(user, 'is_superuser', False):
        user_role = getattr(user, 'role', None)
        if user_role not in PRIVILEGED_ROLES:
            allowed_roles = next(
                _edge_roles(edge) for edge in edges
                if _edge_to(edge) == new_status_code
            )
            if user_role not in allowed_roles:
                raise PermissionError(
                    f'Role {user_role!r} cannot trigger transition to {new_status_code!r}. '
                    f'Allowed roles: {allowed_roles}'
                )

    try:
        new_status = ShipmentStatusType.objects.get(code=new_status_code)
    except ShipmentStatusType.DoesNotExist:
        raise ValueError(f'Unknown status code: {new_status_code!r}')

    now = timezone.now()
    # updated_at must be listed explicitly: auto_now=True is ignored when update_fields is passed.
    update_fields = ['status', 'updated_by', 'updated_at', 'status_changed_at']

    # Reserved hook — STATUS_TIMESTAMP_MAP is currently empty in v2.
    _write_ad1_timestamp(shipment, new_status_code, now, update_fields)

    shipment.status = new_status
    shipment.updated_by = user
    shipment.updated_at = now  # explicit assignment so intent is clear if update_fields changes
    shipment.status_changed_at = now
    shipment.save(update_fields=update_fields)

    ShipmentStatusLog.objects.create(
        shipment=shipment,
        status=new_status,
        changed_by=user,
        comment=comment,
        is_auto=is_auto,
    )

    # Generate structural tasks for the new status. Placed AFTER the status
    # log so the task engine can read the log if needed and BEFORE AuditLog
    # so notifications can reference tasks. Runs outside an explicit atomic
    # block — if task generation fails, the transition has already committed;
    # the failure is logged and does not roll back the status change.
    from apps.export.services.task_rules import generate_tasks_for_status
    generate_tasks_for_status(shipment, new_status_code)

    # Write immutable audit trail entry for this transition.
    from apps.export.models import AuditLog
    detail = f'{current_code} → {new_status_code}'
    if is_auto:
        detail += ' (auto)'
    AuditLog.objects.create(
        user=user,
        action='transition',
        model_name='Shipment',
        object_id=shipment.id,
        object_repr=shipment.cargo_code,
        detail=detail,
    )

    logger.info(
        'Shipment %s transitioned %s → %s by %s%s',
        shipment.cargo_code,
        current_code,
        new_status_code,
        user.username,
        ' (auto)' if is_auto else '',
    )

    # Notify roles that need to act in the new phase.
    _notify_action_required(shipment, new_status_code)


def _cancel_open_tasks(shipment: Shipment) -> int:
    """Mark every OPEN/IN_PROGRESS/BLOCKED task on the shipment as CANCELLED.

    Idempotent. Mirrors the per-task cancel action in views.py which writes
    only the `state` column. BLOCKED tasks are included because a blocked task
    on a cancelled shipment is also stale.

    Uses a single SQL UPDATE — no per-row save(), no Shipment.save() re-entry.

    Returns:
        Number of Task rows updated.
    """
    from apps.export.models import Task, TaskState
    return Task.objects.filter(
        shipment=shipment,
        state__in=[TaskState.OPEN, TaskState.IN_PROGRESS, TaskState.BLOCKED],
    ).update(state=TaskState.CANCELLED)


def is_step_trigger_satisfied(shipment: Shipment, status_code: Optional[str]) -> bool:
    """True iff the trigger field(s) for `status_code` are satisfied on `shipment`.

    Backed by the Task Engine: returns True when at least one active
    non-MANUAL_DONE TaskRule exists for this step AND every matching Task
    on the shipment is DONE/CANCELLED. A step with no auto-resolving rules
    is never eligible for auto-advance — it stays manual.

    Mirrors the predicate used by ShipmentDetailSerializer's
    get_can_promote_from_draft (now refactored to delegate here).
    """
    if not status_code:
        return False

    from apps.export.models import TaskRule, TaskCompletionRule, TaskState

    auto_rules_exist = TaskRule.objects.filter(
        step=status_code,
        is_active=True,
    ).exclude(completion_rule=TaskCompletionRule.MANUAL_DONE).exists()
    if not auto_rules_exist:
        return False

    open_auto_tasks_exist = (
        shipment.tasks
        .filter(step=status_code, state__in=[TaskState.OPEN, TaskState.IN_PROGRESS])
        .exclude(completion_rule=TaskCompletionRule.MANUAL_DONE)
        .exists()
    )
    return not open_auto_tasks_exist


def auto_advance_if_ready(shipment: Shipment, resolved_tasks) -> bool:
    """Auto-fire transition_to() to the next step if the current step's
    trigger field is satisfied.

    Guards:
      - resolved_tasks must be non-empty (something changed this save).
        Without this, a step with zero TaskRules would falsely test as
        "complete" and cause an infinite auto-advance loop.
      - current status must have a single resolvable next step (via
        _resolve_next_status, which honors predicates).
      - shipment.updated_by must be set (skip silently for admin-shell /
        import-script saves with no user context).

    Returns True if a transition fired.
    """
    if not resolved_tasks:
        return False

    current_code = shipment.status.code if shipment.status_id else None
    if not is_step_trigger_satisfied(shipment, current_code):
        return False

    next_code = _resolve_next_status(shipment, current_code)
    if not next_code:
        return False

    user = getattr(shipment, 'updated_by', None)
    if not user:
        return False

    try:
        transition_to(
            shipment, next_code, user=user,
            comment='Auto-advanced: trigger field filled',
            is_auto=True,
        )
    except ValueError:
        # Lost a race — another concurrent save already advanced past
        # `current_code`. Acceptable; log and move on.
        logger.info(
            'auto_advance race lost on %s (current=%s, target=%s)',
            shipment.cargo_code, current_code, next_code,
        )
        return False
    return True


def _notify_action_required(shipment: Shipment, new_status_code: str) -> None:
    """Create action_required notifications for roles that need to fill fields.

    Called by transition_to() after each status change. Only creates notifications
    for statuses listed in STATUS_NOTIFY_ROLES.
    """
    from apps.core.models import User
    from apps.export.models import Notification

    roles = STATUS_NOTIFY_ROLES.get(new_status_code, [])
    if not roles:
        return

    user_ids = list(
        User.objects.filter(role__in=roles, is_active=True)
        .values_list('id', flat=True)
    )
    if not user_ids:
        return

    notifications = [
        Notification(
            user_id=uid,
            kind='action_required',
            message=shipment.cargo_code,
            link=f'/shipments/{shipment.id}',
        )
        for uid in user_ids
    ]
    Notification.objects.bulk_create(notifications, batch_size=500)
    logger.info(
        'Created %d action_required notifications for %s (roles: %s)',
        len(notifications), shipment.cargo_code, roles,
    )


def generate_cargo_codes(n: int, today=None) -> list[str]:
    """Generate N unique cargo_codes in DDMMNNN/YY format with a single DB scan.

    Performs one DB query to load all existing codes for the date, then picks N
    consecutive free slots from the sequence. Adding each emitted code to the
    local set prevents intra-batch collisions without extra round-trips.

    Args:
        n: Number of distinct codes to generate (must be >= 1).
        today: Optional date — used by tests to make output deterministic.
            Defaults to timezone.now().date() in the active TM timezone.

    Returns:
        Ordered list of n unique cargo code strings.

    Raises:
        ValueError: If n < 1, or if the sequence is exhausted for the date.
    """
    if n < 1:
        raise ValueError('n must be >= 1')
    if today is None:
        today = timezone.now().date()
    dd = f'{today.day:02d}'
    mm = f'{today.month:02d}'
    yy = f'{today.year % 100:02d}'
    prefix = f'{dd}{mm}'
    # Single scan — load all codes for this date into a set.
    existing: set[str] = set(
        Shipment.objects
        .filter(cargo_code__startswith=prefix, cargo_code__endswith=f'/{yy}')
        .values_list('cargo_code', flat=True)
    )
    codes: list[str] = []
    for seq in range(1, 1000):
        candidate = f'{prefix}{seq:03d}/{yy}'
        if candidate not in existing:
            # Add to local set so the next iteration skips this slot even
            # before the DB row is created (intra-batch collision guard).
            existing.add(candidate)
            codes.append(candidate)
            if len(codes) == n:
                return codes
    raise ValueError(
        f'Cargo code sequence exhausted for {today} (needed {n} codes). '
        'Need to extend format.'
    )


def generate_cargo_code(today=None) -> str:
    """Generate a single unique cargo_code in DDMMNNN/YY format.

    Delegates to generate_cargo_codes(1) so the scan logic lives in one place.

    Args:
        today: Optional date — used by tests to make output deterministic.
            Defaults to timezone.now().date() in the active TM timezone.
    """
    return generate_cargo_codes(1, today=today)[0]


def create_shipment(
    cargo_code: str,
    date,
    user,
    country=None,
    customer=None,
    season=None,
) -> Shipment:
    """Create a new shipment at step 0 (draft) and write the initial audit trail.

    In state machine v2 every shipment starts in `draft`. From there, filling
    `documents_status='in_progress'` on the Sheet auto-advances to
    `gumruk_girish` via the task engine.

    Args:
        cargo_code: Validated cargo code string in DDMM###/YY format.
        date: Shipment date (datetime.date instance).
        user: User performing the creation (core.User instance).
        country: Optional core.Country FK instance.
        customer: Optional core.Customer FK instance.
        season: Optional core.Season FK instance. If None, the active season is resolved.

    Returns:
        The newly created Shipment instance in `draft` status.

    Raises:
        ValueError: If no active season exists and none was provided, or if
                    the draft status is not configured in the DB.
    """
    from apps.core.models import Season, ShipmentStatusType

    # Resolve season from the active season when the caller did not supply one.
    resolved_season: Optional[object] = season
    if resolved_season is None:
        resolved_season = Season.objects.filter(is_active=True).first()
        if resolved_season is None:
            raise ValueError('No active season found. Provide a season in the request.')

    try:
        draft_status = ShipmentStatusType.objects.get(code='draft')
    except ShipmentStatusType.DoesNotExist:
        raise ValueError('Draft status not configured. Run migrate first.')

    shipment = Shipment.objects.create(
        cargo_code=cargo_code,
        date=date,
        country=country,
        customer=customer,
        season=resolved_season,
        status=draft_status,
        created_by=user,
    )

    shipment.status_changed_at = timezone.now()
    shipment.save(update_fields=['status_changed_at'])

    ShipmentStatusLog.objects.create(
        shipment=shipment,
        status=draft_status,
        changed_by=user,
        comment='Shipment created',
    )

    logger.info('Shipment %s created by %s', shipment.cargo_code, user.username)

    _notify_action_required(shipment, 'draft')

    return shipment


# ---------------------------------------------------------------------------
# Weekly Local Sell Plan — workflow
# ---------------------------------------------------------------------------

_SELL_PLAN_DAYS = ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday')


def submit_local_sell_plan(plan: 'WeeklyLocalSellPlan', user: 'User') -> None:
    """Submit a local sell plan for approval."""
    from apps.export.models import LOCAL_SELL_TRANSITIONS
    from apps.core.services_workflow import validate_transition, apply_status_change, create_audit_entry

    validate_transition(plan.status, 'submitted', LOCAL_SELL_TRANSITIONS)

    has_plan = any(getattr(plan, f'{d}_plan_kg', 0) > 0 for d in _SELL_PLAN_DAYS)
    if not has_plan:
        raise ValueError('Plan must have at least one day with a positive plan_kg.')

    update_fields = apply_status_change(
        plan, 'submitted', user,
        timestamp_field='submitted_at', user_field='submitted_by',
        clear_fields=['rejected_at', 'rejected_by', 'rejection_note'],
    )
    plan.save(update_fields=update_fields)

    create_audit_entry(
        user, 'local_sell_submitted', 'WeeklyLocalSellPlan',
        plan.id, str(plan), f'W{plan.week_number}/{plan.year} submitted',
    )
    logger.info('LocalSellPlan %s submitted by %s', plan, user.username)


def approve_local_sell_plan(plan: 'WeeklyLocalSellPlan', user: 'User') -> None:
    """Approve a submitted local sell plan."""
    from apps.export.models import LOCAL_SELL_TRANSITIONS
    from apps.core.services_workflow import validate_transition, apply_status_change, create_audit_entry

    validate_transition(plan.status, 'approved', LOCAL_SELL_TRANSITIONS)

    update_fields = apply_status_change(
        plan, 'approved', user,
        timestamp_field='approved_at', user_field='approved_by',
    )
    plan.save(update_fields=update_fields)

    create_audit_entry(
        user, 'local_sell_approved', 'WeeklyLocalSellPlan',
        plan.id, str(plan), f'W{plan.week_number}/{plan.year} approved',
    )
    logger.info('LocalSellPlan %s approved by %s', plan, user.username)


# ---------------------------------------------------------------------------
# Pallet manifest — variety roll-up and weight aggregation
# ---------------------------------------------------------------------------


def compute_dominant_varieties(shipment: Shipment) -> list[tuple]:
    """Compute top 3-4 varieties by total net kg from a shipment's pallets.

    Net weight is calculated per pallet in Python (not stored in the DB column)
    using the same formula as Pallet.net_weight_kg so results are consistent.
    We use select_related('crate_type') to avoid N+1 queries.

    Returns list of (variety_id, total_net_kg) tuples sorted by total_net_kg desc.

    Dominant-variety rule (Finding #3):
        1 variety  → return that one
        2-3        → return all
        4+         → return top 4 by weight
    """
    pallets = list(
        shipment.pallets.select_related('crate_type').values(
            'variety_id',
            'gross_weight_kg',
            'pallet_weight_kg',
            'additions_kg',
            'crate_count',
            'crate_type__weight_kg',
        )
    )

    # Aggregate net kg per variety in Python — avoids raw SQL and is MSSQL-safe.
    variety_totals: dict[int, Decimal] = {}
    for p in pallets:
        net = (
            p['gross_weight_kg']
            - (p['crate_type__weight_kg'] * p['crate_count'])
            - p['pallet_weight_kg']
            - p['additions_kg']
        )
        variety_totals[p['variety_id']] = variety_totals.get(p['variety_id'], Decimal('0')) + net

    sorted_totals = sorted(variety_totals.items(), key=lambda pair: pair[1], reverse=True)

    variety_count = len(sorted_totals)
    if variety_count <= 3:
        return sorted_totals
    # 4+: return top 4
    return sorted_totals[:4]


def close_pallet_manifest(shipment: Shipment, user) -> None:
    """Aggregate pallets into shipment-level weight totals and set variety roll-up.

    Validates that pallets exist, then writes:
        - shipment.weight_gross  (sum of pallet.gross_weight_kg)
        - shipment.weight_net    (sum of pallet net weights via formula)
        - shipment.pallet_count  (count of pallets)
        - shipment.pallet_weight_kg (sum of pallet_weight_kg across all pallets)
        - shipment.varieties_dominant (top 3-4 variety ids)
        - shipment.variety  (#1 dominant, back-compat FK)
        - shipment.variety_confidence = 'high'

    Writes an AuditLog entry detailing the dominant varieties and totals.
    Does NOT change shipment.status — caller may follow up with transition_to().
    Wrapped in transaction.atomic to prevent partial writes.

    Args:
        shipment: The Shipment instance whose pallets are being closed.
        user: The User performing the close (for audit trail).

    Raises:
        ValueError: If the shipment has no pallet entries.
    """
    if not shipment.pallets.exists():
        raise ValueError(
            f'Shipment {shipment.cargo_code} has no pallets. '
            'Enter pallet data before closing the manifest.'
        )

    from apps.export.models import AuditLog

    with transaction.atomic():
        pallets = list(
            shipment.pallets.select_related('crate_type').values(
                'gross_weight_kg',
                'pallet_weight_kg',
                'additions_kg',
                'crate_count',
                'crate_type__weight_kg',
            )
        )

        total_gross = sum(p['gross_weight_kg'] for p in pallets)
        total_pallet_weight = sum(p['pallet_weight_kg'] for p in pallets)
        total_net = sum(
            p['gross_weight_kg']
            - (p['crate_type__weight_kg'] * p['crate_count'])
            - p['pallet_weight_kg']
            - p['additions_kg']
            for p in pallets
        )

        dominant = compute_dominant_varieties(shipment)
        if not dominant:
            raise ValueError(
                f'Shipment {shipment.cargo_code}: could not determine dominant varieties. '
                'Check pallet variety assignments.'
            )

        dominant_ids = [variety_id for variety_id, _kg in dominant]
        top_variety_id = dominant_ids[0]

        # Write aggregates to shipment
        shipment.weight_gross = total_gross
        shipment.weight_net = total_net
        shipment.pallet_count = len(pallets)
        shipment.pallet_weight_kg = total_pallet_weight
        shipment.variety_id = top_variety_id
        shipment.variety_confidence = 'high'
        shipment.save(update_fields=[
            'weight_gross', 'weight_net', 'pallet_count',
            'pallet_weight_kg', 'variety', 'variety_confidence',
        ])

        # M2M set — replaces any previously set dominant varieties
        shipment.varieties_dominant.set(dominant_ids)

        dominant_summary = ', '.join(
            f'variety_id={vid} ({kg:.2f} kg)' for vid, kg in dominant
        )
        AuditLog.objects.create(
            user=user,
            action='manifest_close',
            model_name='Shipment',
            object_id=shipment.id,
            object_repr=shipment.cargo_code,
            detail=(
                f'Manifest closed: gross={total_gross:.2f} kg, net={total_net:.2f} kg, '
                f'{len(pallets)} pallets. Dominant varieties: {dominant_summary}'
            ),
        )

    logger.info(
        'Pallet manifest closed for %s by %s: gross=%.2f net=%.2f pallets=%d',
        shipment.cargo_code, user.username, total_gross, total_net, len(pallets),
    )


def override_dominant_varieties(shipment: Shipment, variety_ids: list[int], user) -> None:
    """Manual override of dominant varieties by warehouse_chief or export_manager.

    Sets shipment.varieties_dominant to the provided list, updates shipment.variety
    to the first entry. Keeps variety_confidence='high' — manual override by
    Soltanmyrat is still considered authoritative (Finding #3 rule).

    Writes an AuditLog entry. Permission check happens in the calling view.

    Args:
        shipment: The Shipment to update.
        variety_ids: Ordered list of variety PKs (1-4 entries). First = #1 dominant.
        user: The User performing the override.

    Raises:
        ValueError: If variety_ids is empty.
    """
    if not variety_ids:
        raise ValueError('variety_ids must contain at least one variety.')

    from apps.export.models import AuditLog

    with transaction.atomic():
        shipment.variety_id = variety_ids[0]
        shipment.variety_confidence = 'high'
        shipment.save(update_fields=['variety', 'variety_confidence'])
        shipment.varieties_dominant.set(variety_ids)

        AuditLog.objects.create(
            user=user,
            action='variety_override',
            model_name='Shipment',
            object_id=shipment.id,
            object_repr=shipment.cargo_code,
            detail=f'Dominant varieties overridden to: {variety_ids}',
        )

    logger.info(
        'Dominant varieties for %s overridden to %s by %s',
        shipment.cargo_code, variety_ids, user.username,
    )


def reject_local_sell_plan(plan: 'WeeklyLocalSellPlan', user: 'User', rejection_note: str) -> None:
    """Reject a submitted local sell plan."""
    from apps.export.models import LOCAL_SELL_TRANSITIONS
    from apps.core.services_workflow import validate_transition, apply_status_change, create_audit_entry

    validate_transition(plan.status, 'rejected', LOCAL_SELL_TRANSITIONS)

    if not rejection_note or not rejection_note.strip():
        raise ValueError('Rejection note is required.')

    update_fields = apply_status_change(
        plan, 'rejected', user,
        timestamp_field='rejected_at', user_field='rejected_by',
    )
    plan.rejection_note = rejection_note.strip()
    update_fields.append('rejection_note')
    plan.save(update_fields=update_fields)

    create_audit_entry(
        user, 'local_sell_rejected', 'WeeklyLocalSellPlan',
        plan.id, str(plan), f'W{plan.week_number}/{plan.year} rejected: {rejection_note}',
    )
    logger.info('LocalSellPlan %s rejected by %s: %s', plan, user.username, rejection_note)
