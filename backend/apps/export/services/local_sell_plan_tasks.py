"""Local sell-plan tasks — generation and auto-resolution.

These are non-shipment Tasks (kind=local_sell_plan): one shared task per ISO
week, reminding the `seller` role to fill that week's domestic (local) sell-plan
grid. The task is role-wide (assignee_user is null) — any seller sees it and
finishing the week clears it for all. Clicking the task navigates to the Quota
dashboard, which defaults a seller to the Local Sell tab.

Generation is triggered explicitly when a manager initializes a week
(`WeeklyLocalSellPlanViewSet.initialize_week`), and by a cron-run management
command as a backstop (`generate_local_sell_plan_tasks`).

A week's task auto-completes once every WeeklyLocalSellPlan row for the week is
submitted/approved OR is a zero-total draft (a firm with nothing to sell never
leaves draft, so an all-zero draft must not block completion). A rejected row or
a non-zero draft (started but not submitted) keeps the task open. Resolution is
invoked lazily from the task-read path (MeTaskListView), mirroring the
weekly_plan tasks.
"""
import logging
from datetime import date, timedelta

from django.utils import timezone

from apps.export.models import Task, TaskState, TaskKind, TaskCompletionRule

logger = logging.getLogger(__name__)

ASSIGNEE_ROLE = 'seller'
TITLE_KEY = 'tasks.fill_local_sell_plan'
STEP = 'local_sell_plan'

_DAY_FIELDS = (
    'monday_plan_kg', 'tuesday_plan_kg', 'wednesday_plan_kg',
    'thursday_plan_kg', 'friday_plan_kg', 'saturday_plan_kg',
)


def _build_link(year: int, week: int) -> str:
    return f'/export/quota?week={week}&year={year}'


def generate_local_sell_plan_tasks(year: int, week: int, user=None) -> list[Task]:
    """Create the shared seller local_sell_plan Task for the ISO week.

    Idempotent: if a local_sell_plan Task already exists for (year, week) — in
    any state — nothing is created. Safe to call repeatedly.

    Args:
        year: ISO year the plan week belongs to.
        week: ISO week number being planned.
        user: The actor triggering generation (for logging only).

    Returns:
        List with the newly created Task, or empty if one already existed.
    """
    exists = Task.objects.filter(
        kind=TaskKind.LOCAL_SELL_PLAN, scope_year=year, scope_week=week,
    ).exists()
    if exists:
        return []

    task = Task.objects.create(
        shipment=None,
        kind=TaskKind.LOCAL_SELL_PLAN,
        step=STEP,
        rule=None,
        title_key=TITLE_KEY,
        assignee_role=ASSIGNEE_ROLE,
        assignee_user=None,
        scope_block=None,
        completion_rule=TaskCompletionRule.MANUAL_DONE,
        link=_build_link(year, week),
        scope_year=year,
        scope_week=week,
        state=TaskState.OPEN,
    )
    logger.info(
        'Generated local_sell_plan task for W%d/%d (actor=%s)',
        week, year, getattr(user, 'username', user),
    )
    # A week already fully submitted should get an immediately-done task.
    _resolve_task(task)
    return [task]


def _week_is_complete(year: int, week: int) -> bool:
    """Return True if the week's local sell-plan entry is considered done.

    Done = the week has at least one WeeklyLocalSellPlan row AND every row is
    either submitted/approved or a zero-total draft. A rejected row or a
    non-zero draft (entered but not submitted) keeps the week incomplete.
    """
    from apps.export.models import WeeklyLocalSellPlan

    rows = WeeklyLocalSellPlan.objects.filter(year=year, week_number=week)
    if not rows.exists():
        return False

    # Require real progress: a freshly-initialized week is all zero-total drafts
    # (created by initialize_week), which would otherwise count as "complete" and
    # mark the task done before the seller touches it. At least one row must be
    # actually submitted/approved before the week can resolve.
    if not rows.filter(status__in=['submitted', 'approved']).exists():
        return False

    # Rows that are neither submitted nor approved. A draft with all six day
    # cells at 0 ("nothing to sell") is not blocking; anything else is.
    blocking = rows.exclude(status__in=['submitted', 'approved']).exclude(
        status='draft', **{f: 0 for f in _DAY_FIELDS},
    )
    return not blocking.exists()


def _resolve_task(task: Task) -> bool:
    """Mark a local_sell_plan task DONE if its week is complete.

    Returns True if the task was resolved in this call.
    """
    if task.scope_year is None or task.scope_week is None:
        return False
    if not _week_is_complete(task.scope_year, task.scope_week):
        return False

    now = timezone.now()
    task.state = TaskState.DONE
    task.completed_at = now
    if not task.started_at:
        task.started_at = now
    task.completed_by_id = task.assignee_user_id
    task.save(update_fields=['state', 'completed_at', 'started_at', 'completed_by'])
    return True


def resolve_local_sell_plan_tasks() -> list[Task]:
    """Resolve every open local_sell_plan task whose week is complete.

    Called lazily from the task-read path (MeTaskListView). The task is
    role-wide (no assignee_user), so resolution is global rather than
    per-user — the open set is tiny (one task per week).

    Returns:
        List of Task instances resolved in this call.
    """
    open_tasks = list(
        Task.objects.filter(
            kind=TaskKind.LOCAL_SELL_PLAN,
            state__in=[TaskState.OPEN, TaskState.IN_PROGRESS],
        )
    )
    resolved = [t for t in open_tasks if _resolve_task(t)]
    if resolved:
        logger.info('Auto-resolved %d local_sell_plan tasks', len(resolved))
    return resolved
