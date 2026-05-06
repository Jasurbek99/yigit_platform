"""Shipment lifecycle services: transitions, creation, and pallet manifest.

This module contains the canonical transition_to() function which is the ONLY
way to update shipment status and AD-1 denormalized timestamp fields.
"""
import logging
from decimal import Decimal
from typing import Optional

from django.db import transaction
from django.utils import timezone

from apps.export.models import Shipment, ShipmentStatusLog

logger = logging.getLogger(__name__)

# Status code → AD-1 denormalized timestamp field name on Shipment.
# Only statuses that have a dedicated lifecycle timestamp are listed here.
# serhet_tm, barysh_gumrugi, yolda: transit waypoints with no dedicated AD-1 field.
# hasabat, tamamlandy: report and completed statuses have no dedicated AD-1 timestamp.
STATUS_TIMESTAMP_MAP = {
    'yuklenme': 'loading_started_at',
    'gumruk_girish': 'customs_entry_at',
    'gumruk_chykysh': 'customs_exit_at',
    'yola_chykdy': 'departed_at',
    'serhet_gechdi': 'border_crossed_at',
    'bardy': 'arrived_at',
    'satylyar': 'sale_started_at',
    'satyldy': 'sale_ended_at',
}

# Allowed transitions: from_code → list of (to_code, allowed_roles)
# None key = shipment has no status yet (legacy fallback, unused by two-phase flow).
# 'draft' is step 0 — created by warehouse_chief; promoted to yuklenme by export_manager.
# Roles export_manager and director are always privileged — they can trigger any transition.
TRANSITIONS = {
    None:             [('draft',          ['warehouse_chief'])],
    'draft':          [('yuklenme',       ['export_manager'])],
    'yuklenme':       [('gumruk_girish',  ['warehouse_chief'])],
    'gumruk_girish':  [('gumruk_chykysh', ['document_team'])],
    'gumruk_chykysh': [('yola_chykdy',    ['document_team'])],
    'yola_chykdy':    [('serhet_tm',      ['transport'])],
    'serhet_tm':      [('serhet_gechdi',  ['transport'])],
    'serhet_gechdi':  [('barysh_gumrugi', ['sales_rep'])],
    'barysh_gumrugi': [('yolda',          ['sales_rep'])],
    'yolda':          [('bardy',          ['sales_rep'])],
    'bardy':          [('satylyar',       ['sales_rep'])],
    'satylyar':       [('satyldy',        ['sales_rep'])],
    'satyldy':        [('hasabat',        ['sales_rep'])],
    'hasabat':        [('tamamlandy',     ['finansist'])],
    'tamamlandy':     [],
}

# Roles that may override role restrictions and trigger any valid transition.
PRIVILEGED_ROLES = {'export_manager', 'director'}

# When a shipment transitions TO this status, notify these roles to fill their fields.
STATUS_NOTIFY_ROLES: dict[str, list[str]] = {
    'yuklenme':       ['warehouse_chief'],
    'gumruk_girish':  ['document_team'],
    'yola_chykdy':    ['transport'],
    'serhet_gechdi':  ['sales_rep'],
    'hasabat':        ['finansist'],
}


def _write_ad1_timestamp(
    shipment: Shipment, status_code: str, now, update_fields: list[str] | None = None,
) -> str | None:
    """Write the AD-1 denormalized timestamp field for a status code.

    Centralised helper used by both transition_to() and create_shipment().
    Returns the field name that was written, or None if the status has no mapping.
    """
    ts_field = STATUS_TIMESTAMP_MAP.get(status_code)
    if ts_field:
        setattr(shipment, ts_field, now)
        if update_fields is not None:
            update_fields.append(ts_field)
    return ts_field


def transition_to(shipment: Shipment, new_status_code: str, user, comment: str = '') -> None:
    """Execute a validated status transition with role enforcement.

    This is the ONLY function that may update shipment.status and the AD-1
    denormalized timestamp fields. Never update those fields directly.

    Args:
        shipment: The Shipment instance to transition.
        new_status_code: Target status code string (e.g. 'gumruk_girish').
        user: User performing the transition (core.User instance).
        comment: Optional audit comment stored in ShipmentStatusLog.

    Raises:
        ValueError: If the transition is not allowed from the current status,
                    or if new_status_code does not exist in ShipmentStatusType.
        PermissionError: If the user's role is not allowed to trigger this transition.
    """
    from apps.core.models import ShipmentStatusType

    current_code = shipment.status.code if shipment.status_id else None
    edges = TRANSITIONS.get(current_code, [])
    allowed_codes = [to_code for to_code, _roles in edges]

    if new_status_code not in allowed_codes:
        raise ValueError(
            f'Cannot transition from {current_code!r} to {new_status_code!r}. '
            f'Allowed: {allowed_codes}'
        )

    # Role check — privileged roles bypass per-transition restrictions.
    user_role = getattr(user, 'role', None)
    if user_role not in PRIVILEGED_ROLES:
        allowed_roles = next(roles for to_code, roles in edges if to_code == new_status_code)
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
    update_fields = ['status', 'updated_by', 'updated_at']

    # AD-1: set the denormalized timestamp for this status
    _write_ad1_timestamp(shipment, new_status_code, now, update_fields)

    shipment.status = new_status
    shipment.updated_by = user
    shipment.updated_at = now  # explicit assignment so intent is clear if update_fields changes
    shipment.save(update_fields=update_fields)

    ShipmentStatusLog.objects.create(
        shipment=shipment,
        status=new_status,
        changed_by=user,
        comment=comment,
    )

    # Generate structural tasks for the new status (B-engine, plan §B3).
    # Placed AFTER the status log so the task engine can read the log if needed
    # and BEFORE AuditLog so notifications can reference tasks in a future
    # iteration. Runs outside an explicit atomic block — transition_to() has no
    # transaction.atomic() wrapper and ATOMIC_REQUESTS is not enabled in this
    # project. If task generation fails, the transition has already committed;
    # the failure is logged and does not roll back the status change.
    from apps.export.services.task_rules import generate_tasks_for_status
    generate_tasks_for_status(shipment, new_status_code)

    # Write immutable audit trail entry for this transition.
    from apps.export.models import AuditLog
    AuditLog.objects.create(
        user=user,
        action='transition',
        model_name='Shipment',
        object_id=shipment.id,
        object_repr=shipment.cargo_code,
        detail=f'{current_code} → {new_status_code}',
    )

    logger.info(
        'Shipment %s transitioned %s → %s by %s',
        shipment.cargo_code,
        current_code,
        new_status_code,
        user.username,
    )

    # Notify roles that need to act in the new phase.
    _notify_action_required(shipment, new_status_code)

    # Quota usage is now computed on-the-fly in the quota dashboard analytics endpoint.
    # No per-quota used_kg tracking needed.


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


def create_shipment(
    cargo_code: str,
    date,
    user,
    country=None,
    customer=None,
    season=None,
) -> Shipment:
    """Create a new shipment at step 1 (yuklenme) and write the initial audit trail.

    Resolves the active season when none is provided. Writes the loading_started_at
    AD-1 denormalized timestamp directly — transition_to() cannot be used here because
    the shipment is created with status already set to step 1.

    Args:
        cargo_code: Validated cargo code string in DDMM###/YY format.
        date: Shipment date (datetime.date instance).
        user: User performing the creation (core.User instance).
        country: Optional core.Country FK instance.
        customer: Optional core.Customer FK instance.
        season: Optional core.Season FK instance. If None, the active season is resolved.

    Returns:
        The newly created Shipment instance with loading_started_at set.

    Raises:
        ValueError: If no active season exists and none was provided, or if no
                    yuklenme status (step_order=1) is configured in the DB.
    """
    from apps.core.models import Season, ShipmentStatusType

    # Resolve season from the active season when the caller did not supply one.
    resolved_season: Optional[object] = season
    if resolved_season is None:
        resolved_season = Season.objects.filter(is_active=True).first()
        if resolved_season is None:
            raise ValueError('No active season found. Provide a season in the request.')

    first_status = ShipmentStatusType.objects.filter(step_order=1).first()
    if first_status is None:
        raise ValueError('No yuklenme status configured. Run seed_data first.')

    shipment = Shipment.objects.create(
        cargo_code=cargo_code,
        date=date,
        country=country,
        customer=customer,
        season=resolved_season,
        status=first_status,
        created_by=user,
    )

    # AD-1: write loading_started_at via the centralised helper — the same
    # function transition_to() uses, keeping all AD-1 writes in one place.
    _write_ad1_timestamp(shipment, first_status.code, timezone.now())
    shipment.save(update_fields=['loading_started_at'])

    ShipmentStatusLog.objects.create(
        shipment=shipment,
        status=first_status,
        changed_by=user,
        comment='Shipment created',
    )

    logger.info('Shipment %s created by %s', shipment.cargo_code, user.username)

    # Notify warehouse_chief users that a new shipment needs their fields filled.
    _notify_action_required(shipment, 'yuklenme')

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
