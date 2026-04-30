"""Time-based notification dispatcher for the Forecast Layer.

Computes which trigger windows are due "now" (in local time per
GreenhouseConfig.timezone_name), creates Notification rows, and records
firings in HarvestDispatchLog for idempotency.

Designed to be invoked from the management command on a 5-minute cron.
All trigger evaluation is pure (no DB writes in evaluate_triggers); DB writes
happen only in fire().
"""
import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta, time as dtime
from typing import Dict, List

from django.db import IntegrityError, transaction

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class TriggerEvent:
    """One notification to fire for a specific user on a specific date.

    kind maps to HarvestDispatchLog.TRIGGER_KIND_CHOICES.
    notification_kind maps to Notification.KIND_CHOICES.
    """

    kind: str                # 't1_forecast_nudge' / 't2_forecast_handoff' / etc.
    target_user_id: int
    scope_date: date
    notification_kind: str   # 'forecast_nudge' / 'forecast_handoff' / etc.
    message: str             # i18n-free seed; FE renders kind-based label
    link: str                # frontend route


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def evaluate_triggers(now_local: datetime, config) -> List[TriggerEvent]:
    """Compute which trigger events are due at this moment.

    Pure function (DB reads only, no writes). Returns a list of TriggerEvents
    to be fired by the caller.

    Args:
        now_local: Current naive local datetime (already converted by caller).
        config: GreenhouseConfig instance.

    Returns:
        List of TriggerEvent objects that are due within the current 5-minute window.
    """
    events: List[TriggerEvent] = []
    today = now_local.date()
    tomorrow = today + timedelta(days=1)

    # Skip non-operating days for forecast triggers (T1/T2/T3).
    # Plan triggers (P1/P2/P3) are calendar-day-based, not operating-day-based.
    today_is_operating = _is_operating_day(today, config)

    # T1 — forecast_nudge: fire at (forecast_primary_open - notification_lead_minutes)
    # Goal: remind block managers to submit tomorrow's forecast before the primary window opens.
    if today_is_operating:
        t1_fire_at = datetime.combine(today, config.forecast_primary_open) - timedelta(
            minutes=config.notification_lead_minutes
        )
        if _within_5min(now_local, t1_fire_at):
            events.extend(_compute_t1(tomorrow, config))

    # T2 — forecast_handoff: fire at forecast_primary_close
    # Goal: alert warehouse_chief that primary window just closed so they can fill gaps.
    if today_is_operating:
        t2_fire_at = datetime.combine(today, config.forecast_primary_close)
        if _within_5min(now_local, t2_fire_at):
            events.extend(_compute_t2(tomorrow, config))

    # T3 — forecast_escalation: fire at forecast_fallback_close (day-of)
    # Goal: escalate missing forecasts to warehouse_chief + admin + director.
    if today_is_operating:
        t3_fire_at = datetime.combine(today, config.forecast_fallback_close)
        if _within_5min(now_local, t3_fire_at):
            events.extend(_compute_t3(today, config))

    # P1/P2/P3 — plan submission discipline. Calendar-based (not operating-day gated).
    # plan_week_start = the Monday of the week being planned.
    # For P1 (Friday) and P2 (Saturday), that's the NEXT Monday.
    # For P3 (Monday of plan week itself), TODAY is that Monday — do not advance.
    plan_week_start = _next_plan_week_start(today)

    # P1 — plan_deadline_reminder: fire on plan_deadline_weekday (default Friday) at 09:00
    if _is_plan_deadline_day(today, config):
        p1_fire_at = datetime.combine(today, dtime(9, 0))
        if _within_5min(now_local, p1_fire_at):
            events.extend(_compute_p1(plan_week_start, config))

    # P2 — plan_late: fire on Saturday (plan_deadline_weekday + 1) at 09:00
    if _is_plan_late_day(today, config):
        p2_fire_at = datetime.combine(today, dtime(9, 0))
        if _within_5min(now_local, p2_fire_at):
            events.extend(_compute_p2(plan_week_start, config))

    # P3 — plan_critical_late: fire on Monday of plan week at plan_critical_late_at_time.
    # today IS the plan week Monday, so use today directly (not _next_plan_week_start which
    # would return the following Monday when called on a Monday).
    if today.weekday() == config.plan_critical_late_at_weekday:
        p3_fire_at = datetime.combine(today, config.plan_critical_late_at_time)
        if _within_5min(now_local, p3_fire_at):
            events.extend(_compute_p3(today, config))

    return events


def fire(event: TriggerEvent) -> bool:
    """Idempotently fire a trigger event.

    Creates one HarvestDispatchLog row (UNIQUE on kind + target_user + scope_date)
    and one Notification row. Returns True on first-time fire, False if already
    fired (HarvestDispatchLog UNIQUE collision — IntegrityError swallowed).

    Args:
        event: TriggerEvent to persist.

    Returns:
        True if the notification was created (new), False if already fired.
    """
    from apps.greenhouse.models import HarvestDispatchLog
    from apps.export.models import Notification

    try:
        with transaction.atomic():
            HarvestDispatchLog.objects.create(
                trigger_kind=event.kind,
                target_user_id=event.target_user_id,
                scope_date=event.scope_date,
            )
            Notification.objects.create(
                user_id=event.target_user_id,
                kind=event.notification_kind,
                message=event.message,
                link=event.link,
            )
        # TODO: evaluate_kanban_rules(event)  # No-op until kanban work lands
        logger.info('Fired trigger %s for user=%d scope=%s', event.kind, event.target_user_id, event.scope_date)
        return True
    except IntegrityError:
        # Already fired for this (kind, user, scope_date) combination
        return False


# ---------------------------------------------------------------------------
# Internal helpers — window checks
# ---------------------------------------------------------------------------

def _within_5min(now: datetime, target: datetime) -> bool:
    """Return True if now falls within [target - 5min, target].

    The 5-minute window covers one cron tick interval so that the trigger
    fires within the interval that *contains* the target time.
    """
    window_start = target - timedelta(minutes=5)
    return window_start <= now <= target


def _is_operating_day(d: date, config) -> bool:
    """Return True if d is a configured operating day and not a holiday exception.

    Bitmask: bit 0 = Monday (weekday()=0) … bit 6 = Sunday (weekday()=6).
    """
    from apps.core.models import OperatingDayException

    bit = 1 << d.weekday()
    if not (config.operating_days_bitmask & bit):
        return False

    # Check holiday exception
    return not OperatingDayException.objects.filter(date=d, is_holiday=True).exists()


def _is_plan_deadline_day(today: date, config) -> bool:
    """Return True if today is the plan deadline weekday (default Friday = 4)."""
    return today.weekday() == config.plan_deadline_weekday


def _is_plan_late_day(today: date, config) -> bool:
    """Return True if today is the 'plan late' day (day after deadline, default Saturday = 5)."""
    late_weekday = (config.plan_deadline_weekday + 1) % 7
    return today.weekday() == late_weekday


def _next_plan_week_start(today: date) -> date:
    """Return Monday of the next upcoming week (the week currently being planned).

    Used by P1 (Friday) and P2 (Saturday) to identify which week's plan is due.
    Always returns a future Monday — if today is Monday this returns NEXT Monday.

    P3 fires ON Monday of the plan week, so P3 passes `today` directly to
    _compute_p3() instead of calling this function.
    """
    days_until_monday = (7 - today.weekday()) % 7
    if days_until_monday == 0:
        days_until_monday = 7
    return today + timedelta(days=days_until_monday)


# ---------------------------------------------------------------------------
# Trigger computation helpers — each returns a list of TriggerEvent
# ---------------------------------------------------------------------------

def _compute_t1(tomorrow: date, config) -> List[TriggerEvent]:
    """T1: notify each block manager about upcoming forecast window for tomorrow.

    Targets managers who have at least one active block assignment with no
    submitted forecast for tomorrow. Batched — one DB query per call.
    """
    from django.db.models import Exists, OuterRef

    from apps.greenhouse.models import BlockManagerAssignment, HarvestDayEntry

    # Managers with missing forecasts for tomorrow
    missing_qs = (
        BlockManagerAssignment.objects
        .filter(is_active=True)
        .annotate(
            has_forecast=Exists(
                HarvestDayEntry.objects.filter(
                    block=OuterRef('block'),
                    entry_date=tomorrow,
                    forecast_submitted_at__isnull=False,
                )
            ),
        )
        .filter(has_forecast=False)
        .select_related('user', 'block')
    )

    # Group missing blocks by manager user_id
    by_user: Dict[int, List[str]] = {}
    for asn in missing_qs:
        by_user.setdefault(asn.user_id, []).append(asn.block.code)

    events: List[TriggerEvent] = []
    link = f'/greenhouse/plan?date={tomorrow.isoformat()}'
    for user_id, block_codes in by_user.items():
        block_list = ', '.join(sorted(block_codes))
        events.append(TriggerEvent(
            kind='t1_forecast_nudge',
            target_user_id=user_id,
            scope_date=tomorrow,
            notification_kind='forecast_nudge',
            message=f'Submit tomorrow\'s forecast for blocks {block_list}',
            link=link,
        ))
    return events


def _compute_t2(tomorrow: date, config) -> List[TriggerEvent]:
    """T2: notify each warehouse_chief that the primary window just closed.

    Lists blocks that still have no submitted forecast for tomorrow. Fires once
    per warehouse_chief user regardless of block assignment.
    """
    from django.db.models import Exists, OuterRef

    from apps.core.models import User
    from apps.core.models import GreenhouseBlock
    from apps.greenhouse.models import HarvestDayEntry

    # Find blocks missing forecasts for tomorrow
    missing_blocks = list(
        GreenhouseBlock.objects
        .filter(is_active=True)
        .exclude(
            Exists(
                HarvestDayEntry.objects.filter(
                    block=OuterRef('pk'),
                    entry_date=tomorrow,
                    forecast_submitted_at__isnull=False,
                )
            )
        )
        .values_list('code', flat=True)
    )

    if not missing_blocks:
        return []

    block_list = ', '.join(sorted(missing_blocks))
    n = len(missing_blocks)

    warehouse_chiefs = list(
        User.objects.filter(role='warehouse_chief', is_active=True).values_list('id', flat=True)
    )

    link = f'/greenhouse/plan?date={tomorrow.isoformat()}&mode=fallback'
    return [
        TriggerEvent(
            kind='t2_forecast_handoff',
            target_user_id=uid,
            scope_date=tomorrow,
            notification_kind='forecast_handoff',
            message=f'Fallback: forecast missing for {n} block(s) → {block_list}',
            link=link,
        )
        for uid in warehouse_chiefs
    ]


def _compute_t3(today: date, config) -> List[TriggerEvent]:
    """T3: escalation — forecast still missing at fallback_close for today.

    Notifies warehouse_chief + admin + director users. Scope = today.
    """
    from django.db.models import Exists, OuterRef

    from apps.core.models import User
    from apps.core.models import GreenhouseBlock
    from apps.greenhouse.models import HarvestDayEntry

    # Blocks still missing forecasts for today
    missing_blocks = list(
        GreenhouseBlock.objects
        .filter(is_active=True)
        .exclude(
            Exists(
                HarvestDayEntry.objects.filter(
                    block=OuterRef('pk'),
                    entry_date=today,
                    forecast_submitted_at__isnull=False,
                )
            )
        )
        .values_list('code', flat=True)
    )

    if not missing_blocks:
        return []

    block_list = ', '.join(sorted(missing_blocks))

    escalation_users = list(
        User.objects
        .filter(role__in=['warehouse_chief', 'admin', 'director'], is_active=True)
        .values_list('id', flat=True)
    )

    link = f'/greenhouse/plan?date={today.isoformat()}&mode=escalation'
    return [
        TriggerEvent(
            kind='t3_forecast_escalation',
            target_user_id=uid,
            scope_date=today,
            notification_kind='forecast_escalation',
            message=f'ESCALATED: forecast still missing for {block_list}',
            link=link,
        )
        for uid in escalation_users
    ]


def _compute_p1(plan_week_start: date, config) -> List[TriggerEvent]:
    """P1: plan_deadline_reminder — Friday morning, plan not yet submitted for next week.

    Targets greenhouse_manager users who have active block assignments but have
    not submitted (WeeklyHarvestPlan.submitted_at IS NULL) for plan_week_start.
    """
    return _compute_plan_trigger(
        trigger_kind='p1_plan_reminder',
        notification_kind='plan_deadline_reminder',
        plan_week_start=plan_week_start,
        message_prefix='Plan deadline today',
        include_admin=False,
    )


def _compute_p2(plan_week_start: date, config) -> List[TriggerEvent]:
    """P2: plan_late — Saturday morning, plan still missing."""
    return _compute_plan_trigger(
        trigger_kind='p2_plan_late',
        notification_kind='plan_late',
        plan_week_start=plan_week_start,
        message_prefix='Plan overdue',
        include_admin=False,
    )


def _compute_p3(plan_week_start: date, config) -> List[TriggerEvent]:
    """P3: plan_critical_late — Monday 00:00 of plan week.

    Also fires to admin users (informational escalation).
    """
    return _compute_plan_trigger(
        trigger_kind='p3_plan_critical_late',
        notification_kind='plan_critical_late',
        plan_week_start=plan_week_start,
        message_prefix='CRITICAL: plan still missing',
        include_admin=True,
    )


def _compute_plan_trigger(
    trigger_kind: str,
    notification_kind: str,
    plan_week_start: date,
    message_prefix: str,
    include_admin: bool,
) -> List[TriggerEvent]:
    """Shared logic for P1/P2/P3 — find managers with missing plans and build events.

    Args:
        trigger_kind: HarvestDispatchLog trigger kind string.
        notification_kind: Notification.kind string.
        plan_week_start: Monday of the plan week (the one being planned).
        message_prefix: Human-readable prefix for the notification message.
        include_admin: Whether to also notify admin users (P3 escalation).
    """
    from django.db.models import Exists, OuterRef

    from apps.core.models import User
    from apps.greenhouse.models import BlockManagerAssignment, WeeklyHarvestPlan

    iso_year, iso_week, _ = plan_week_start.isocalendar()

    # Managers with active block assignments where the plan is not yet submitted
    missing_qs = (
        BlockManagerAssignment.objects
        .filter(is_active=True)
        .annotate(
            has_submitted=Exists(
                WeeklyHarvestPlan.objects.filter(
                    block=OuterRef('block'),
                    week_number=iso_week,
                    year=iso_year,
                    submitted_at__isnull=False,
                )
            ),
        )
        .filter(has_submitted=False)
        .select_related('user', 'block')
    )

    by_user: Dict[int, List[str]] = {}
    for asn in missing_qs:
        by_user.setdefault(asn.user_id, []).append(asn.block.code)

    link = f'/greenhouse/plan?week={iso_week}&year={iso_year}'
    events: List[TriggerEvent] = []

    for user_id, block_codes in by_user.items():
        block_list = ', '.join(sorted(block_codes))
        events.append(TriggerEvent(
            kind=trigger_kind,
            target_user_id=user_id,
            scope_date=plan_week_start,
            notification_kind=notification_kind,
            message=f'{message_prefix} — W{iso_week}/{iso_year} blocks {block_list}',
            link=link,
        ))

    if include_admin:
        # Notify admin users regardless of block assignment (informational escalation)
        admin_ids = list(
            User.objects.filter(role='admin', is_active=True).values_list('id', flat=True)
        )
        for uid in admin_ids:
            if uid not in by_user:  # avoid duplicate if admin is also a manager
                events.append(TriggerEvent(
                    kind=trigger_kind,
                    target_user_id=uid,
                    scope_date=plan_week_start,
                    notification_kind=notification_kind,
                    message=f'{message_prefix} (admin alert) — W{iso_week}/{iso_year}',
                    link=link,
                ))

    return events
