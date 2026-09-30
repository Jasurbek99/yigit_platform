"""Daily planning tasks — docs/Tasks.md items 4 and 5a.

daily_loading  loading_dept_head (+ deputy via TASK_ROLE_EQUIVALENTS)
               «Şu güne ýük, maşyn planla» → /export/gaplama. Done when a live
               Gaplama truck (a shipment with block_sources) is dated today.
daily_export   export_manager
               «Eksport planla» → /export/drafts. Done when a live shipment with
               a country AND a customer is dated today.

"Dated today" (owner, 2026-09-29): a truck opened yesterday FOR today counts.
Mon–Sat only. Red after 23:59 local (Task.deadline). The 06:05 beat first
resolves, then cancels every earlier open one as `missed` (history only — KPI
ignores cancelled tasks), then opens today's. /me/tasks/ resolves lazily but
never creates.

Spec: docs/superpowers/specs/2026-09-29-planning-tasks-design.md.
"""
import logging
from dataclasses import dataclass
from datetime import date

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

from apps.export.models import Task, TaskCancelReason, TaskCompletionRule, TaskKind, TaskState
from apps.export.services.plan_task_common import end_of_local_day, local_today

logger = logging.getLogger(__name__)

SUNDAY = 6
OPEN_STATES = (TaskState.OPEN, TaskState.IN_PROGRESS)


@dataclass(frozen=True)
class DailySpec:
    role: str
    title_key: str
    link: str
    done_q: Q


SPECS: dict[str, DailySpec] = {
    TaskKind.DAILY_LOADING: DailySpec(
        'loading_dept_head', 'tasks.daily_loading_plan', '/export/gaplama',
        Q(block_sources__isnull=False),
    ),
    TaskKind.DAILY_EXPORT: DailySpec(
        'export_manager', 'tasks.daily_export_plan', '/export/drafts',
        Q(country__isnull=False, customer__isnull=False),
    ),
}


def _is_done(kind: str, day: date) -> bool:
    from apps.export.models import Shipment

    return (
        Shipment.objects
        .filter(date=day, is_archived=False, deleted_at__isnull=True)
        .exclude(status__code='cancelled')
        .filter(SPECS[kind].done_q)
        .exists()
    )


def generate_daily_plan_tasks(today: date) -> list[Task]:
    from apps.core.seasons import get_active_season

    if today.weekday() == SUNDAY or get_active_season() is None:
        return []
    created: list[Task] = []
    for kind, spec in SPECS.items():
        if Task.objects.filter(kind=kind, scope_date=today).exists():
            continue
        try:
            with transaction.atomic():
                created.append(Task.objects.create(
                    shipment=None, kind=kind, step=kind, rule=None,
                    title_key=spec.title_key, assignee_role=spec.role, assignee_user=None,
                    completion_rule=TaskCompletionRule.MANUAL_DONE, link=spec.link,
                    scope_date=today, deadline=end_of_local_day(today), state=TaskState.OPEN,
                ))
        except IntegrityError:
            continue      # a concurrent run created it (export_task_one_daily_per_kind)
    return created


def resolve_daily_plan_tasks() -> list[Task]:
    """Close every open daily task whose day now has its record. Global and lazy
    (/me/tasks/, beat). The open set is at most two tasks per day."""
    resolved: list[Task] = []
    for task in Task.objects.filter(kind__in=list(SPECS), state__in=OPEN_STATES, scope_date__isnull=False):
        if not _is_done(task.kind, task.scope_date):
            continue
        now = timezone.now()
        task.state = TaskState.DONE
        task.completed_at = now
        task.started_at = task.started_at or now
        task.save(update_fields=['state', 'completed_at', 'started_at'])
        resolved.append(task)
    return resolved


def cancel_missed_daily_tasks(today: date) -> int:
    return Task.objects.filter(
        kind__in=list(SPECS), state__in=OPEN_STATES, scope_date__lt=today,
    ).update(state=TaskState.CANCELLED, cancelled_reason=TaskCancelReason.MISSED)


def run_daily_plan_tasks(today: date | None = None) -> None:
    """Beat, daily 06:05 local."""
    today = today or local_today()
    resolve_daily_plan_tasks()
    missed = cancel_missed_daily_tasks(today)
    created = generate_daily_plan_tasks(today)
    resolve_daily_plan_tasks()        # a truck already dated today closes the fresh task
    logger.info('Daily plan tasks %s: %d created, %d missed', today, len(created), missed)
