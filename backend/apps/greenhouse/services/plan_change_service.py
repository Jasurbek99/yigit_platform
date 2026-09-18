"""In-week plan revisions: request, approve, reject (ADR-024).

Once a plan week has started (Monday 00:00 local), a greenhouse manager's plan
edit no longer writes `plan_value`. It becomes a PlanChangeRequest that an
export manager (or admin/boss) approves or rejects. `set_plan_value()` stays the
single entry point and routes here; this module never bypasses it for writes
that originate from a manager.
"""
import logging
from datetime import date, datetime, time as dtime, timezone as dt_timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.db import transaction
from django.utils import timezone

from apps.greenhouse.models import PlanChangeRequest

logger = logging.getLogger(__name__)

# Who, besides admin-like users, may approve or reject. document_team is in
# EXPORT_MANAGER_LIKE elsewhere, but the owner named the export manager only.
APPROVER_ROLES = frozenset({'export_manager'})


def _config():
    from apps.core.models import GreenhouseConfig
    return GreenhouseConfig.get_solo()


def _kg(value) -> str:
    return '—' if value is None else f'{value:,.0f}'


def _display_name(user) -> str:
    if user is None:
        return '—'
    return f'{user.first_name} {user.last_name}'.strip() or user.username


def plan_week_start_utc(weekly_plan, tz) -> datetime:
    """Monday 00:00 local of the plan week, as aware UTC."""
    monday = date.fromisocalendar(weekly_plan.year, weekly_plan.week_number, 1)
    return datetime.combine(monday, dtime(0, 0)).replace(tzinfo=tz).astimezone(dt_timezone.utc)


def plan_week_started(weekly_plan, now_utc: datetime) -> bool:
    """True once the plan week has begun — manager edits switch to request mode.

    A mode switch, not a lock: `_plan_edit_window_closed()` still decides whether
    the week may be edited at all.
    """
    tz = ZoneInfo(_config().timezone_name)
    return now_utc >= plan_week_start_utc(weekly_plan, tz)


def supersede_pending(entry, user) -> int:
    """Move the cell's pending request (if any) to `superseded`. Returns rows updated."""
    return PlanChangeRequest.objects.filter(
        entry=entry, status=PlanChangeRequest.STATUS_PENDING,
    ).update(
        status=PlanChangeRequest.STATUS_SUPERSEDED, decided_by=user, decided_at=timezone.now(),
    )


def _bounded_change_pct(baseline, requested: Decimal) -> Decimal | None:
    """Return the % change vs the baseline, or None when the cell has no bound.

    Raises:
        ValueError: when |change| exceeds GreenhouseConfig.plan_change_max_pct.
    """
    if baseline is None or baseline == 0:
        return None
    max_pct = _config().plan_change_max_pct
    delta = requested - baseline
    if abs(delta) * 100 > max_pct * baseline:
        low = baseline * (100 - max_pct) / 100
        high = baseline * (100 + max_pct) / 100
        raise ValueError(
            f'Change exceeds ±{max_pct}% of the week-start plan. '
            f'Allowed range: {low:,.0f}–{high:,.0f} kg.'
        )
    return (delta * 100 / baseline).quantize(Decimal('0.01'))


def request_plan_change(entry, value, user, reason: str = '') -> PlanChangeRequest | None:
    """Record a greenhouse manager's in-week plan revision as a pending request.

    Freezes the cell's baseline on the first in-week request, enforces the
    ±plan_change_max_pct bound against it, and supersedes any earlier pending
    request. Setting the value back to the approved one withdraws instead.

    Returns:
        The new pending request, or None when the call was a withdrawal.

    Raises:
        ValueError: value is None, or outside the allowed range.
    """
    if value is None:
        raise ValueError('The plan cannot be cleared after the week has started.')
    requested = Decimal(str(value))
    if entry.plan_value is not None and requested == entry.plan_value:
        supersede_pending(entry, user)
        return None
    baseline = entry.plan_baseline_value if entry.plan_baseline_value is not None else entry.plan_value
    change_pct = _bounded_change_pct(baseline, requested)
    with transaction.atomic():
        change = _create_request(entry, user, baseline, requested, change_pct, reason)
    _notify_approvers(change)
    return change


def _create_request(entry, user, baseline, requested, change_pct, reason) -> PlanChangeRequest:
    """Freeze the baseline if needed, supersede the old pending row, insert the new one.

    The baseline is frozen only when it actually bounds the request
    (`change_pct is not None`). A zero plan would otherwise freeze as 0 and leave
    the cell unbounded forever; left NULL, it re-derives from the next approved value.
    """
    if entry.plan_baseline_value is None and change_pct is not None:
        entry.plan_baseline_value = baseline
        entry.save(update_fields=['plan_baseline_value', 'updated_at'])
    supersede_pending(entry, user)
    return PlanChangeRequest.objects.create(
        entry=entry,
        baseline_value=baseline,
        current_value=entry.plan_value,
        requested_value=requested,
        change_pct=change_pct,
        reason=(reason or '').strip(),
        requested_by=user,
    )


def _plan_link(entry) -> str:
    iso_year, iso_week, _ = entry.entry_date.isocalendar()
    return f'/export/plan?week={iso_week}&year={iso_year}&block={entry.block_id}&changes=1'


def _notify_approvers(change: PlanChangeRequest) -> None:
    """In-app notification to every active export manager."""
    from apps.core.models import User
    from apps.export.models import Notification

    entry = change.entry
    pct = f' ({change.change_pct:+}%)' if change.change_pct is not None else ''
    message = (
        f'{_display_name(change.requested_by)} requested a plan change for block '
        f'{entry.block.code} on {entry.entry_date.isoformat()}: '
        f'{_kg(change.current_value)} → {_kg(change.requested_value)} kg{pct}.'
    )
    user_ids = User.objects.filter(role__in=APPROVER_ROLES, is_active=True).values_list('id', flat=True)
    Notification.objects.bulk_create(
        [
            Notification(user_id=uid, kind='plan_change_requested', message=message, link=_plan_link(entry))
            for uid in user_ids
        ],
        batch_size=500,
    )
