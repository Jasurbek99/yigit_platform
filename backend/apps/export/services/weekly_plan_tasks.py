"""Weekly harvest-plan tasks — generation and auto-resolution.

These are non-shipment Tasks (kind=weekly_plan): one per (greenhouse_manager,
block) per ISO week, reminding the manager to fill that block's weekly
harvest-plan grid. Clicking the task navigates to the plan grid; a block's task
auto-completes once its Mon–Sat plan cells are filled (Sunday is not measured,
so a blank Sunday cell never blocks completion). Each block resolves
independently — filling block K's plan does not depend on block L.

Dependency direction (core ← greenhouse ← export): this module lives in export
and READS greenhouse models (BlockManagerAssignment, HarvestDayEntry), which is
the allowed direction. greenhouse code must never call back into export, so
resolution is invoked LAZILY from the task-read path (MeTaskListView), not from
the plan-save path — see resolve_weekly_plan_tasks_for_user.

Known limit: generation uses a read-then-write idempotency check, so two truly
concurrent calls to the (admin-only) generate endpoint can race and create a
duplicate task for the same (manager, block, week). Re-running generation is
otherwise idempotent; the cleanup path de-dupes if it ever happens.
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


def _build_link(year: int, week: int, block_id: int | None = None) -> str:
    link = f'/export/plan?week={week}&year={year}'
    if block_id is not None:
        link += f'&block={block_id}'
    return link


def generate_weekly_plan_tasks(year: int, week: int, user=None) -> list[Task]:
    """Create one weekly_plan Task per (active manager, block) for the ISO week.

    Idempotent: a (manager, block) pair that already has a weekly_plan Task for
    (year, week) — in any state — is skipped. Safe to call repeatedly.

    Args:
        year: ISO year the plan week belongs to.
        week: ISO week number being planned.
        user: The actor triggering generation (for logging only).

    Returns:
        List of newly created Task instances (empty if all pairs already had one).
    """
    from apps.greenhouse.models import BlockManagerAssignment

    pairs = list(
        BlockManagerAssignment.objects
        .filter(is_active=True)
        .values_list('user_id', 'block_id')
        .distinct()
    )
    if not pairs:
        return []

    already = set(
        Task.objects
        .filter(kind=TaskKind.WEEKLY_PLAN, scope_year=year, scope_week=week)
        .values_list('assignee_user_id', 'scope_block_id')
    )

    created: list[Task] = []
    for manager_id, block_id in pairs:
        if (manager_id, block_id) in already:
            continue
        created.append(Task.objects.create(
            shipment=None,
            kind=TaskKind.WEEKLY_PLAN,
            step=STEP,
            rule=None,
            title_key=TITLE_KEY,
            assignee_role=ASSIGNEE_ROLE,
            assignee_user_id=manager_id,
            scope_block_id=block_id,
            completion_rule=TaskCompletionRule.MANUAL_DONE,
            link=_build_link(year, week, block_id),
            scope_year=year,
            scope_week=week,
            state=TaskState.OPEN,
        ))

    if created:
        logger.info(
            'Generated %d weekly_plan tasks for W%d/%d (actor=%s)',
            len(created), week, year, getattr(user, 'username', user),
        )
        # A block already fully planned should get an immediately-done task.
        for task in created:
            _resolve_task(task)

    return created


def _block_plan_is_complete(block_id: int, week_start: date) -> bool:
    """Return True if a single block's Mon–Sat plan cells are all filled.

    "Complete" = the block has at least one HarvestDayEntry row in Mon–Sat of the
    week AND none of those rows has a NULL plan_value (an explicit 0 counts as
    filled). Sunday (week_start + 6) is excluded entirely — it is not measured,
    so a blank Sunday cell must never block completion. Requiring ≥1 row guards
    against a premature done on a week whose day-rows have not been initialised.
    """
    from apps.greenhouse.models import HarvestDayEntry

    if not block_id:
        return False

    # Mon..Sat — the range stops at Saturday, so Sunday rows are ignored. Using a
    # date range (not Django's __week_day) keeps this DB-collation-independent,
    # which matters on MSSQL.
    saturday = week_start + timedelta(days=5)
    rows = HarvestDayEntry.objects.filter(
        block_id=block_id,
        entry_date__range=(week_start, saturday),
    )
    if not rows.exists():
        return False
    return not rows.filter(plan_value__isnull=True).exists()


def _resolve_task(task: Task) -> bool:
    """Mark a single weekly_plan task DONE if its block's Mon–Sat plan is filled.

    Returns True if the task was resolved in this call. A task with no scope_block
    (a legacy per-manager task) is skipped — the cleanup path replaces those with
    per-block tasks.
    """
    if (task.scope_year is None or task.scope_week is None
            or task.assignee_user_id is None or task.scope_block_id is None):
        return False

    week_start, _ = _week_date_range(task.scope_year, task.scope_week)
    if not _block_plan_is_complete(task.scope_block_id, week_start):
        return False

    now = timezone.now()
    task.state = TaskState.DONE
    task.completed_at = now
    if not task.started_at:
        task.started_at = now
    task.completed_by_id = task.assignee_user_id
    task.save(update_fields=['state', 'completed_at', 'started_at', 'completed_by'])
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
