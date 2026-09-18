"""In-week plan revisions: request, approve, reject (ADR-024).

Once a plan week has started (Monday 00:00 local), a greenhouse manager's plan
edit no longer writes `plan_value`. It becomes a PlanChangeRequest that an
export manager (or admin/boss) approves or rejects. `set_plan_value()` stays the
single entry point and routes here; this module never bypasses it for writes
that originate from a manager.
"""
import logging
from datetime import date, datetime, time as dtime, timezone as dt_timezone
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

from django.db import transaction
from django.utils import timezone

from apps.core.roles import is_admin_like
from apps.core.services_workflow import create_audit_entry
from apps.greenhouse.models import HarvestDayEntry, PlanChangeRequest

logger = logging.getLogger(__name__)

# Who, besides admin-like users, may approve or reject. document_team is in
# EXPORT_MANAGER_LIKE elsewhere, but the owner named the export manager only.
APPROVER_ROLES = frozenset({'export_manager'})

# requested_value is DecimalField(max_digits=10, decimal_places=2).
MAX_PLAN_VALUE = Decimal('100000000')
# reason / decision_note are CharField(max_length=500).
TEXT_MAX_LEN = 500


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
        ValueError: value is None, not a valid kg amount, or outside the allowed
            range; or the reason is over TEXT_MAX_LEN characters.
    """
    requested = _parse_requested_value(value)
    reason = _clean_text(reason, 'Reason')
    with transaction.atomic():
        # Lock the cell first so concurrent requests on it serialise here rather
        # than racing into uq_pcr_one_pending. Lock order is entry → request
        # everywhere (approve_plan_change, the admin direct-edit tail).
        locked = HarvestDayEntry.objects.select_for_update().get(pk=entry.pk)
        change = _request_on_locked_entry(locked, requested, user, reason)
    if change is not None:
        _notify_approvers(change)
    return change


def _parse_requested_value(value) -> Decimal:
    """Turn raw request input into a kg Decimal, or raise ValueError (→ 400, never 500)."""
    if value is None:
        raise ValueError('The plan cannot be cleared after the week has started.')
    try:
        requested = Decimal(str(value))
    except InvalidOperation:
        raise ValueError('Invalid plan value.') from None
    if not requested.is_finite() or requested < 0 or requested >= MAX_PLAN_VALUE:
        raise ValueError('Plan value must be between 0 and 99,999,999.99 kg.')
    return requested


def _clean_text(value, label: str) -> str:
    text = str(value or '').strip()
    if len(text) > TEXT_MAX_LEN:
        raise ValueError(f'{label} is too long: max {TEXT_MAX_LEN} characters.')
    return text


def _request_on_locked_entry(entry, requested: Decimal, user, reason) -> PlanChangeRequest | None:
    """Withdraw, or bound-check and record the request, against the freshly locked row."""
    if entry.plan_value is not None and requested == entry.plan_value:
        supersede_pending(entry, user)
        return None
    baseline = entry.plan_baseline_value if entry.plan_baseline_value is not None else entry.plan_value
    change_pct = _bounded_change_pct(baseline, requested)
    return _create_request(entry, user, baseline, requested, change_pct, reason)


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
        reason=reason,
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


def can_decide_plan_change(user) -> bool:
    """export_manager, admin, boss and superusers may approve or reject."""
    return is_admin_like(user) or getattr(user, 'role', None) in APPROVER_ROLES


def _claim(change: PlanChangeRequest, user, new_status: str, note: str) -> None:
    """Atomically move a pending request to `new_status`.

    The conditional UPDATE is the race guard: two approvers clicking at once
    cannot both claim the same row.

    Raises:
        PermissionError: user may not decide plan changes.
        ValueError: the note is over TEXT_MAX_LEN characters, or the request is
            no longer pending.
    """
    if not can_decide_plan_change(user):
        raise PermissionError(f"Role '{getattr(user, 'role', None)}' cannot decide plan changes.")
    # Validated before the UPDATE: reject_plan_change has no atomic block to undo a claim.
    note = _clean_text(note, 'Note')
    claimed = PlanChangeRequest.objects.filter(
        pk=change.pk, status=PlanChangeRequest.STATUS_PENDING,
    ).update(status=new_status, decided_by=user, decided_at=timezone.now(), decision_note=note)
    if not claimed:
        raise ValueError('Request is no longer pending.')
    change.refresh_from_db()


def approve_plan_change(change: PlanChangeRequest, user, note: str = '') -> PlanChangeRequest:
    """Approve a pending request: write its value into plan_value and notify the requester."""
    with transaction.atomic():
        # Entry before request — the same lock order as request_plan_change and
        # the admin direct-edit tail, so the three paths cannot deadlock.
        entry = HarvestDayEntry.objects.select_for_update().get(pk=change.entry_id)
        _claim(change, user, PlanChangeRequest.STATUS_APPROVED, note)
        _apply_approved_value(entry, change, user)
    _notify_requester(change, 'plan_change_approved')
    return change


def reject_plan_change(change: PlanChangeRequest, user, note: str = '') -> PlanChangeRequest:
    """Reject a pending request; plan_value is untouched."""
    _claim(change, user, PlanChangeRequest.STATUS_REJECTED, note)
    _notify_requester(change, 'plan_change_rejected')
    return change


def _plan_state_at(entry, submitted_at_utc: datetime) -> str:
    from apps.greenhouse.services.harvest_day_service import compute_plan_state, plan_week_start
    config = _config()
    local = submitted_at_utc.astimezone(ZoneInfo(config.timezone_name)).replace(tzinfo=None)
    return compute_plan_state(local, plan_week_start(entry.entry_date), config)


def _apply_approved_value(entry, change: PlanChangeRequest, approver) -> None:
    """Write the approved value, crediting the requester as its author.

    plan_state (timeliness) is computed only for a first entry; a revision of an
    already-planned cell keeps the timeliness of the original submission.
    """
    old_value = entry.plan_value
    entry.plan_value = change.requested_value
    entry.plan_submitted_at = change.requested_at
    entry.plan_submitted_by_id = change.requested_by_id
    fields = ['plan_value', 'plan_submitted_at', 'plan_submitted_by', 'updated_at']
    if old_value is None:
        entry.plan_state = _plan_state_at(entry, change.requested_at)
        fields.append('plan_state')
    entry.save(update_fields=fields)
    pct = f' ({change.change_pct:+}%)' if change.change_pct is not None else ''
    create_audit_entry(
        approver, 'plan_value_set', 'HarvestDayEntry', entry.id, str(entry),
        f'APPROVED change #{change.pk}{pct} | plan_value: {old_value!r} → {change.requested_value!r}',
    )


def _notify_requester(change: PlanChangeRequest, kind: str) -> None:
    from apps.export.models import Notification

    if change.requested_by_id is None:
        return
    entry = change.entry
    verb = 'approved' if kind == 'plan_change_approved' else 'rejected'
    note = f' Note: {change.decision_note}' if change.decision_note else ''
    Notification.objects.create(
        user_id=change.requested_by_id,
        kind=kind,
        message=(
            f'Your plan change for block {entry.block.code} on {entry.entry_date.isoformat()} '
            f'({_kg(change.requested_value)} kg) was {verb} by {_display_name(change.decided_by)}.{note}'
        ),
        link=_plan_link(entry),
    )


def reset_baseline_after_direct_edit(entry, value, user, now_utc: datetime) -> None:
    """Admin/boss direct in-week edit: its value becomes the new baseline and any
    pending manager request on the cell is superseded. No-op before the week starts.

    A zero (or cleared) value stores NULL, not 0: a 0 baseline bounds nothing and
    would never re-derive, leaving the cell unbounded for the rest of the week."""
    if not plan_week_started(entry.weekly_plan, now_utc):
        return
    baseline = None if value is None else Decimal(str(value))
    entry.plan_baseline_value = baseline or None
    entry.save(update_fields=['plan_baseline_value', 'updated_at'])
    supersede_pending(entry, user)
