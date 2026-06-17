"""Weekly harvest-plan tasks — generation and auto-resolution.

These are non-shipment Tasks (kind=weekly_plan): one per greenhouse_manager per
ISO week, reminding them to fill the weekly harvest-plan grid for their assigned
blocks. Clicking the task navigates to the plan grid; the task auto-completes
once no blank plan cells remain for that manager's blocks in the scope week.

Dependency direction (core ← greenhouse ← export): this module lives in export
and READS greenhouse models (BlockManagerAssignment, HarvestDayEntry), which is
the allowed direction. greenhouse code must never call back into export, so
resolution is invoked LAZILY from the task-read path (MeTaskListView), not from
the plan-save path — see resolve_weekly_plan_tasks_for_user.
"""
import logging
from datetime import date, timedelta

from django.utils import timezone

from apps.export.models import Task, TaskState, TaskKind, TaskCompletionRule

logger = logging.getLogger(__name__)

ASSIGNEE_ROLE = 'greenhouse_manager'
TITLE_KEY = 'tasks.fill_weekly_plan'
STEP = 'weekly_plan'


def _week_date_range(year: int, week: int) -> tuple[date, date]:
    """Return (Monday, Sunday) dates for an ISO (year, week)."""
    monday = date.fromisocalendar(year, week, 1)
    return monday, monday + timedelta(days=6)


def _build_link(year: int, week: int) -> str:
    return f'/export/plan?week={week}&year={year}'


def generate_weekly_plan_tasks(year: int, week: int, user=None) -> list[Task]:
    """Create one weekly_plan Task per active block manager for the given ISO week.

    Idempotent: a manager who already has a weekly_plan Task for (year, week) —
    in any state — is skipped. Safe to call repeatedly.

    Args:
        year: ISO year the plan week belongs to.
        week: ISO week number being planned.
        user: The actor triggering generation (for logging only).

    Returns:
        List of newly created Task instances (empty if all managers already had one).
    """
    from apps.greenhouse.models import BlockManagerAssignment

    manager_ids = list(
        BlockManagerAssignment.objects
        .filter(is_active=True)
        .values_list('user_id', flat=True)
        .distinct()
    )
    if not manager_ids:
        return []

    already = set(
        Task.objects
        .filter(kind=TaskKind.WEEKLY_PLAN, scope_year=year, scope_week=week,
                assignee_user_id__in=manager_ids)
        .values_list('assignee_user_id', flat=True)
    )

    link = _build_link(year, week)
    created: list[Task] = []
    for manager_id in manager_ids:
        if manager_id in already:
            continue
        created.append(Task.objects.create(
            shipment=None,
            kind=TaskKind.WEEKLY_PLAN,
            step=STEP,
            rule=None,
            title_key=TITLE_KEY,
            assignee_role=ASSIGNEE_ROLE,
            assignee_user_id=manager_id,
            completion_rule=TaskCompletionRule.MANUAL_DONE,
            link=link,
            scope_year=year,
            scope_week=week,
            state=TaskState.OPEN,
        ))

    if created:
        logger.info(
            'Generated %d weekly_plan tasks for W%d/%d (actor=%s)',
            len(created), week, year, getattr(user, 'username', user),
        )
        # A manager who already filled the week should get an immediately-done task.
        for task in created:
            _resolve_task(task)

    return created


def _plan_is_complete(block_ids: list[int], week_start: date, week_end: date) -> bool:
    """Return True if the manager's plan grid has no blank cells for the week.

    "Complete" = every assigned block has at least one HarvestDayEntry row in the
    week AND none of those rows has a NULL plan_value (an explicit 0 counts as
    filled). Requiring ≥1 row per block guards against a premature done on a week
    whose day-rows have not been initialised yet.
    """
    from apps.greenhouse.models import HarvestDayEntry

    if not block_ids:
        return False

    rows = HarvestDayEntry.objects.filter(
        block_id__in=block_ids,
        entry_date__range=(week_start, week_end),
    )
    # Every assigned block must have at least one row this week.
    blocks_with_rows = set(rows.values_list('block_id', flat=True).distinct())
    if blocks_with_rows != set(block_ids):
        return False

    # No blank plan cells may remain.
    return not rows.filter(plan_value__isnull=True).exists()


def _resolve_task(task: Task) -> bool:
    """Mark a single weekly_plan task DONE if its plan week is fully filled.

    Returns True if the task was resolved in this call.
    """
    from apps.greenhouse.models import BlockManagerAssignment

    if task.scope_year is None or task.scope_week is None or task.assignee_user_id is None:
        return False

    block_ids = list(
        BlockManagerAssignment.objects
        .filter(user_id=task.assignee_user_id, is_active=True)
        .values_list('block_id', flat=True)
    )
    week_start, week_end = _week_date_range(task.scope_year, task.scope_week)
    if not _plan_is_complete(block_ids, week_start, week_end):
        return False

    now = timezone.now()
    task.state = TaskState.DONE
    task.completed_at = now
    if not task.started_at:
        task.started_at = now
    task.save(update_fields=['state', 'completed_at', 'started_at'])
    return True


def resolve_weekly_plan_tasks_for_user(user) -> list[Task]:
    """Resolve all of a user's open weekly_plan tasks whose week is fully filled.

    Called lazily from the task-read path (MeTaskListView) — the manager sees the
    task flip to DONE the next time their board loads after filling every cell.

    Args:
        user: The current user.

    Returns:
        List of Task instances resolved in this call.
    """
    user_id = getattr(user, 'id', None)
    if not user_id:
        return []

    open_tasks = list(
        Task.objects.filter(
            kind=TaskKind.WEEKLY_PLAN,
            assignee_user_id=user_id,
            state__in=[TaskState.OPEN, TaskState.IN_PROGRESS],
        )
    )
    resolved = [t for t in open_tasks if _resolve_task(t)]
    if resolved:
        logger.info('Auto-resolved %d weekly_plan tasks for user=%s', len(resolved), user_id)
    return resolved


def resolve_all_open_weekly_plan_tasks() -> list[Task]:
    """Resolve every open weekly_plan task across all users (for cron/backfill)."""
    open_tasks = list(
        Task.objects.filter(
            kind=TaskKind.WEEKLY_PLAN,
            state__in=[TaskState.OPEN, TaskState.IN_PROGRESS],
        )
    )
    return [t for t in open_tasks if _resolve_task(t)]
