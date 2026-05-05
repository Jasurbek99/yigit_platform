"""Service layer for HarvestDayEntry: plan, forecast, and actual writes.

All write paths go through these functions. Permission checks are enforced here
(not in views), and all writes create an AuditLog entry.

Time-window notes:
- All window comparisons use **naive local datetime** (Asia/Ashgabat = UTC+5, no DST).
- Use now_local(config) to get the current naive local time.
- Never compare aware and naive datetimes — that raises TypeError at runtime.
"""
import logging
from datetime import datetime, time as dtime, timedelta

from django.utils import timezone

from apps.core.services_workflow import create_audit_entry

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Utility helpers (public — used by submit_plan and other services)
# ---------------------------------------------------------------------------

def now_local(config) -> datetime:
    """Return the current naive datetime in the config's local timezone (e.g. Asia/Ashgabat).

    All window boundary comparisons must use naive local time to avoid
    aware-vs-naive TypeError in Python's datetime module.
    """
    try:
        from zoneinfo import ZoneInfo
    except ImportError:
        from backports.zoneinfo import ZoneInfo  # Python < 3.9

    tz = ZoneInfo(config.timezone_name)
    now_aware = timezone.now().astimezone(tz)
    # Strip tzinfo to get naive local
    return now_aware.replace(tzinfo=None)


def plan_week_start(entry_date) -> datetime.date:
    """Return the Monday of the ISO week containing entry_date."""
    # weekday() returns 0 for Monday, 6 for Sunday
    return entry_date - timedelta(days=entry_date.weekday())


# ---------------------------------------------------------------------------
# Computation helpers (pure functions, testable without DB)
# ---------------------------------------------------------------------------

def compute_plan_state(submitted_at_local: datetime, plan_week_start, config) -> str:
    """Compute the timeliness state of a plan submission.

    Args:
        submitted_at_local: Naive local datetime of submission.
        plan_week_start: date — Monday of the plan week (the week the plan covers).
        config: GreenhouseConfig instance.

    Returns:
        'on_time' | 'late' | 'critical_late'

    Logic:
        on_time     → submitted by end-of-day Friday before plan week.
        late        → submitted by end-of-day Sunday before plan week.
        critical_late → submitted on/after the configured weekday+time of plan week.
    """
    # Friday of the week BEFORE plan_week_start.
    # plan_week_start is Monday (weekday=0). Days back to Friday (weekday=4) of previous
    # week: from Monday back 3 days = Friday. (7 - deadline_weekday) % 7 gives 3 for Friday(4).
    days_back_to_deadline = (7 - config.plan_deadline_weekday) % 7
    if days_back_to_deadline == 0:
        days_back_to_deadline = 7
    on_time_end = datetime.combine(
        plan_week_start - timedelta(days=days_back_to_deadline),
        dtime(23, 59, 59),
    )

    # End of Sunday before plan_week_start = plan_week_start - 1 day, EOD
    late_end = datetime.combine(plan_week_start - timedelta(days=1), dtime(23, 59, 59))

    # Critical-late starts at config time on the configured weekday of plan week
    # plan_week_start is Monday(0); plan_critical_late_at_weekday is typically 0 (Monday)
    critical_start = datetime.combine(
        plan_week_start + timedelta(days=config.plan_critical_late_at_weekday),
        config.plan_critical_late_at_time,
    )

    if submitted_at_local <= on_time_end:
        return 'on_time'
    if submitted_at_local <= late_end:
        return 'late'
    # If submitted between late_end and critical_start, treat as 'late' still.
    if submitted_at_local < critical_start:
        return 'late'
    return 'critical_late'


def compute_forecast_window(submitted_at_local: datetime, entry_date, config) -> str | None:
    """Compute which forecast window the submission falls in.

    Args:
        submitted_at_local: Naive local datetime of forecast submission.
        entry_date: date — the date the forecast is for.
        config: GreenhouseConfig instance.

    Returns:
        'primary' | 'fallback' | 'same_day_red_flag' | None (locked/outside all windows)

    Windows:
        primary         → [forecast_primary_open, forecast_primary_close) day-before
        fallback        → [forecast_primary_close, forecast_fallback_close) day-of
        same_day_red_flag → [forecast_fallback_close, forecast_same_day_close] day-of
        None            → outside all windows (locked)
    """
    day_before = entry_date - timedelta(days=1)

    primary_start = datetime.combine(day_before, config.forecast_primary_open)
    primary_end = datetime.combine(day_before, config.forecast_primary_close)
    fallback_end = datetime.combine(entry_date, config.forecast_fallback_close)
    same_day_end = datetime.combine(entry_date, config.forecast_same_day_close)

    if primary_start <= submitted_at_local < primary_end:
        return 'primary'
    if primary_end <= submitted_at_local < fallback_end:
        return 'fallback'
    if fallback_end <= submitted_at_local <= same_day_end:
        return 'same_day_red_flag'
    return None  # locked


# ---------------------------------------------------------------------------
# Write operations
# ---------------------------------------------------------------------------

def set_plan_value(entry, value, user, reason: str = '') -> None:
    """Set the plan_value on a HarvestDayEntry.

    Permissions:
    - admin: always allowed; reason required only when overriding an existing
      plan_value (writes last_override_* snapshot in that case).
    - greenhouse_manager: own blocks only (checked via active BlockManagerAssignment).
    - warehouse_chief: NOT allowed to set plan (only forecast/actual).

    Args:
        entry: HarvestDayEntry instance.
        value: New plan kg value (Decimal or None).
        user: User performing the write.
        reason: Required for admin overrides; passed through to AuditLog.

    Raises:
        PermissionError: If the user's role is not permitted.
        ValueError: If admin override has no reason.
    """
    from apps.core.models import GreenhouseConfig
    from apps.greenhouse.models import BlockManagerAssignment

    role = getattr(user, 'role', None)
    config = GreenhouseConfig.get_solo()
    now_l = now_local(config)
    now_utc = timezone.now()

    if role == 'admin':
        is_override = entry.plan_value is not None
        if is_override:
            if not reason or not reason.strip():
                raise ValueError("Admin override requires a non-empty reason.")
            _write_override_snapshot(entry, user, reason.strip(), now_utc)
    elif role == 'greenhouse_manager':
        if not BlockManagerAssignment.objects.filter(
            user=user, block=entry.block, is_active=True,
        ).exists():
            raise PermissionError(
                f"greenhouse_manager '{user.username}' is not assigned to block {entry.block_id}."
            )
    else:
        raise PermissionError(
            f"Role '{role}' is not allowed to set plan values."
        )

    old_value = entry.plan_value
    week_start = plan_week_start(entry.entry_date)

    entry.plan_value = value
    entry.plan_submitted_at = now_utc
    entry.plan_submitted_by = user
    entry.plan_state = compute_plan_state(now_l, week_start, config)
    entry.save(update_fields=[
        'plan_value', 'plan_submitted_at', 'plan_submitted_by', 'plan_state',
        'last_override_at', 'last_override_by', 'last_override_reason', 'updated_at',
    ])

    detail = f"plan_value: {old_value!r} → {value!r}"
    if reason:
        detail = f"OVERRIDE: {reason} | {detail}"
    create_audit_entry(
        user, 'plan_value_set', 'HarvestDayEntry',
        entry.id, str(entry), detail,
    )
    logger.info('HarvestDayEntry %d plan_value set to %s by %s', entry.id, value, user.username)

    if role == 'greenhouse_manager' and entry.plan_state in ('late', 'critical_late'):
        _notify_late_plan_submission(entry, user)


def _notify_late_plan_submission(entry, submitter) -> None:
    """Fan out plan_late / plan_critical_late notifications to admin + director users."""
    from apps.core.models import User
    from apps.export.models import Notification

    iso_year, iso_week, _ = entry.entry_date.isocalendar()
    submitter_name = (
        f'{submitter.first_name} {submitter.last_name}'.strip() or submitter.username
    )
    block_code = getattr(entry.block, 'code', f'#{entry.block_id}')
    state_label = 'critical-late' if entry.plan_state == 'critical_late' else 'late'

    message = (
        f'{submitter_name} submitted a {state_label} plan for block {block_code} '
        f'on {entry.entry_date.isoformat()} — {entry.plan_value} kg.'
    )
    link = f'/export/plan?week={iso_week}&year={iso_year}'
    kind = 'plan_critical_late' if entry.plan_state == 'critical_late' else 'plan_late'

    target_user_ids = list(
        User.objects.filter(role__in=('admin', 'director'), is_active=True)
        .values_list('id', flat=True)
    )
    if not target_user_ids:
        return

    Notification.objects.bulk_create(
        [
            Notification(user_id=uid, kind=kind, message=message, link=link)
            for uid in target_user_ids
        ],
        batch_size=500,
    )


def set_forecast_value(entry, value, user, reason: str = '') -> None:
    """Set the forecast_value on a HarvestDayEntry.

    Permissions × window matrix:
    - admin: always; reason required only when overriding an existing forecast_value.
    - greenhouse_manager: own block + primary window only.
    - warehouse_chief: any block; fallback or same_day_red_flag windows only.

    Args:
        entry: HarvestDayEntry instance.
        value: New forecast kg (Decimal or None).
        user: User performing the write.
        reason: Required for admin overrides.

    Raises:
        PermissionError: If role × window combination is not permitted.
        ValueError: If admin override has no reason.
    """
    from apps.core.models import GreenhouseConfig
    from apps.greenhouse.models import BlockManagerAssignment

    role = getattr(user, 'role', None)
    config = GreenhouseConfig.get_solo()
    now_l = now_local(config)
    now_utc = timezone.now()

    window = compute_forecast_window(now_l, entry.entry_date, config)

    if role == 'admin':
        is_override = entry.forecast_value is not None
        if is_override:
            if not reason or not reason.strip():
                raise ValueError("Admin override requires a non-empty reason.")
            _write_override_snapshot(entry, user, reason.strip(), now_utc)
    elif role == 'greenhouse_manager':
        if not BlockManagerAssignment.objects.filter(
            user=user, block=entry.block, is_active=True,
        ).exists():
            raise PermissionError(
                f"greenhouse_manager '{user.username}' is not assigned to block {entry.block_id}."
            )
        if window != 'primary':
            raise PermissionError(
                f"greenhouse_manager can only submit forecasts during the primary window "
                f"(current window: {window!r})."
            )
    elif role == 'warehouse_chief':
        if window not in ('fallback', 'same_day_red_flag'):
            raise PermissionError(
                f"warehouse_chief can only submit forecasts in fallback or same_day_red_flag windows "
                f"(current window: {window!r})."
            )
    else:
        raise PermissionError(f"Role '{role}' is not allowed to set forecast values.")

    old_value = entry.forecast_value
    # Increment revision count if the forecast is being updated (not first entry)
    if entry.forecast_value is not None and entry.forecast_submitted_at is not None:
        entry.forecast_revision_count += 1

    entry.forecast_value = value
    entry.forecast_submitted_at = now_utc
    entry.forecast_submitted_by = user
    entry.forecast_window = window or ''
    entry.save(update_fields=[
        'forecast_value', 'forecast_submitted_at', 'forecast_submitted_by',
        'forecast_window', 'forecast_revision_count',
        'last_override_at', 'last_override_by', 'last_override_reason', 'updated_at',
    ])

    detail = f"forecast_value: {old_value!r} → {value!r} window={window}"
    if reason:
        detail = f"OVERRIDE: {reason} | {detail}"
    create_audit_entry(
        user, 'forecast_value_set', 'HarvestDayEntry',
        entry.id, str(entry), detail,
    )
    logger.info('HarvestDayEntry %d forecast_value set to %s by %s', entry.id, value, user.username)


def set_actual_value(entry, value, user, reason: str = '') -> None:
    """Set the actual_value on a HarvestDayEntry.

    Permissions:
    - admin: always; reason required only when overriding an existing actual_value.
    - warehouse_chief: always.

    Args:
        entry: HarvestDayEntry instance.
        value: Actual harvest kg (Decimal or None).
        user: User performing the write.
        reason: Required for admin overrides.

    Raises:
        PermissionError: If role is not permitted.
        ValueError: If admin override has no reason.
    """
    role = getattr(user, 'role', None)
    now_utc = timezone.now()

    if role == 'admin':
        is_override = entry.actual_value is not None
        if is_override:
            if not reason or not reason.strip():
                raise ValueError("Admin override requires a non-empty reason.")
            _write_override_snapshot(entry, user, reason.strip(), now_utc)
    elif role == 'warehouse_chief':
        pass  # always allowed
    else:
        raise PermissionError(f"Role '{role}' is not allowed to set actual values.")

    old_value = entry.actual_value
    entry.actual_value = value
    entry.actual_finalized_at = now_utc
    entry.actual_source = 'manual'
    entry.save(update_fields=[
        'actual_value', 'actual_finalized_at', 'actual_source',
        'last_override_at', 'last_override_by', 'last_override_reason', 'updated_at',
    ])

    detail = f"actual_value: {old_value!r} → {value!r}"
    if reason:
        detail = f"OVERRIDE: {reason} | {detail}"
    create_audit_entry(
        user, 'actual_value_set', 'HarvestDayEntry',
        entry.id, str(entry), detail,
    )
    logger.info('HarvestDayEntry %d actual_value set to %s by %s', entry.id, value, user.username)


def admin_override(entry, field: str, value, reason: str, user) -> None:
    """Perform an admin override on a specific field of a HarvestDayEntry.

    Args:
        entry: HarvestDayEntry instance.
        field: One of 'plan_value', 'forecast_value', 'actual_value'.
        value: New value.
        reason: Mandatory override reason (non-empty).
        user: Admin user.

    Raises:
        ValueError: If field is invalid or reason is empty.
        PermissionError: If user is not admin.
    """
    role = getattr(user, 'role', None)
    if role != 'admin':
        raise PermissionError("Only admin can perform overrides.")
    if not reason or not reason.strip():
        raise ValueError("Override reason is required.")

    dispatch = {
        'plan_value': set_plan_value,
        'forecast_value': set_forecast_value,
        'actual_value': set_actual_value,
    }
    if field not in dispatch:
        raise ValueError(f"Invalid field '{field}'. Must be one of: {list(dispatch)}")

    dispatch[field](entry, value, user, reason=reason)


# ---------------------------------------------------------------------------
# Internal snapshot helper
# ---------------------------------------------------------------------------

def _write_override_snapshot(entry, user, reason: str, now_utc) -> None:
    """Write the last_override_* fields on the entry (in memory, not saved yet)."""
    entry.last_override_at = now_utc
    entry.last_override_by = user
    entry.last_override_reason = reason
