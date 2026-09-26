# Gaplama Tasks & Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the loading department head a daily "open today's trucks" reminder and an
auto-resolving "fix the over-load" task, and notify export_manager/admin/director when a
plan edit leaves a block-day over-loaded — all driven by Celery beat, reusing
`build_gaplama_board()` from the Gaplama Screen plan so the numbers can never disagree.

**Architecture:** Two new `TaskKind` values and one new `Notification.kind`. A beat job in
`export/services/gaplama_tasks.py`, mirroring the existing
`truck_allocation_tasks.py` pattern exactly (same file shape, same idempotency style, same
lazy-resolve-from-`views_me.py` hookup).

**Tech Stack:** Django, Celery beat, DRF — same stack as the parent plan.

**Spec:** `docs/superpowers/specs/2026-09-18-tir-takip-gaplama-design.md` §2 (D14, D15),
§5. **Prerequisite:** `docs/superpowers/plans/2026-09-23-gaplama-screen.md` must be merged
first — Task 1 of this plan imports `build_gaplama_board` from it.

## Global Constraints

- Same MSSQL rules as the parent plan (no JSONField/ArrayField/DISTINCT ON,
  `bulk_create(batch_size=500)`).
- No Django signals — this is exactly why the job is Celery beat, not a hook on
  `set_plan_value`/plan-change approval (`greenhouse` may not import `export`).
- All scheduled jobs go in `CELERY_BEAT_SCHEDULE` (`backend/config/settings.py`) — never a
  crontab (`feedback_celery_beat_not_crontab` memory: the beta crontab is empty).
- Build in the **same isolated worktree** as the parent plan, continuing on top of its
  commits (or its own fresh worktree off `main` HEAD if run independently — confirm
  `build_gaplama_board` exists in the tree before starting Task 1).
- Migration numbers: verify the actual next number off the worktree's current HEAD with
  `git ls-tree --name-only HEAD -- backend/apps/export/migrations/ | tail -3` at execution
  time — do not assume `0078` (the parent plan consumes `0077`).
- `models/` packages need `__init__.py` re-exports.
- No commit without the user's explicit "commit". Log the build in `BUILD_TEST_LOG.md`.

---

## File Structure

| file | responsibility |
|---|---|
| `backend/apps/export/migrations/00NN_task_scope_date.py` | `Task.scope_date` field |
| `backend/apps/export/migrations/00NN_alter_task_kind_gaplama.py` | two `TaskKind` choices |
| `backend/apps/export/migrations/00NN_alter_notification_kind_gaplama.py` | `gaplama_overload` choice |
| `backend/apps/export/models/task.py` | `Task.scope_date`, `TaskKind.GAPLAMA_DAILY`, `TaskKind.GAPLAMA_OVERLOAD` |
| `backend/apps/export/models/notification.py` | `Notification.KIND_CHOICES` += `gaplama_overload` |
| `backend/apps/export/services/gaplama_tasks.py` | the daily task + overload task/notify job, mirroring `truck_allocation_tasks.py` |
| `backend/apps/export/tasks.py` | `@shared_task` beat wrapper |
| `backend/config/settings.py` | `CELERY_BEAT_SCHEDULE` entry |
| `backend/apps/core/views_me.py` | add the new resolver to the lazy-resolve block (line ~78-104) |
| `frontend/src/types/index.ts:1764` | extend `TaskKind` union |
| `frontend/src/pages/me/SelfBoard.tsx:47-50` | extend `isPlanTask()` |
| `frontend/src/pages/export/TaskRulesPage.tsx:39` | catalog rows |
| `frontend/src/i18n/{tk,ru,en}.json` | task-kind triads + notification copy |

---

### Task 1: `Task.scope_date` and two `TaskKind` values

**Files:**
- Modify: `backend/apps/export/models/task.py` — `TaskKind` class (lines 26-30) and the
  `Task` model's scope fields (around lines 161-177, after `scope_week`)
- Create: `backend/apps/export/migrations/00NN_task_scope_date_gaplama_kinds.py`
  (one migration for both changes is fine — they're additive and unrelated to each other
  only superficially; Django will happily combine an `AddField` and an `AlterField` in one
  file via `makemigrations`)
- Test: `backend/apps/export/tests_gaplama_tasks.py` (new file, mirrors
  `tests_truck_allocation_tasks.py`'s naming convention — this app puts task-service tests
  at the app root as `tests_*.py`, not under `tests/`)

**Interfaces:**
- Produces: `Task.scope_date: date | None`, `TaskKind.GAPLAMA_DAILY = 'gaplama_daily'`,
  `TaskKind.GAPLAMA_OVERLOAD = 'gaplama_overload'`.

- [ ] **Step 1: Write the failing test**

```python
# backend/apps/export/tests_gaplama_tasks.py
from datetime import date
from django.test import TestCase
from apps.export.models import Task, TaskKind, TaskState, TaskCompletionRule


class TaskScopeDateTest(TestCase):
    def test_scope_date_field_exists_and_is_optional(self):
        task = Task.objects.create(
            kind=TaskKind.GAPLAMA_DAILY,
            step='gaplama_daily',
            title_key='tasks.gaplama_daily',
            assignee_role='loading_dept_head',
            completion_rule=TaskCompletionRule.MANUAL_DONE,
            scope_date=date(2026, 9, 23),
            state=TaskState.OPEN,
        )
        task.refresh_from_db()
        self.assertEqual(task.scope_date, date(2026, 9, 23))

    def test_gaplama_task_kinds_exist(self):
        self.assertEqual(TaskKind.GAPLAMA_DAILY, 'gaplama_daily')
        self.assertEqual(TaskKind.GAPLAMA_OVERLOAD, 'gaplama_overload')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python manage.py test apps.export.tests_gaplama_tasks -v 2`
Expected: FAIL — `AttributeError: type object 'TaskKind' has no attribute 'GAPLAMA_DAILY'`

- [ ] **Step 3: Add the model changes**

In `backend/apps/export/models/task.py`, extend `TaskKind` (lines 26-30):

```python
class TaskKind(models.TextChoices):
    SHIPMENT         = 'shipment',         _('Shipment task')
    WEEKLY_PLAN      = 'weekly_plan',      _('Weekly harvest-plan task')
    LOCAL_SELL_PLAN  = 'local_sell_plan',  _('Local sell-plan task')
    TRUCK_ALLOCATION = 'truck_allocation', _('Weekly truck-allocation task')
    GAPLAMA_DAILY    = 'gaplama_daily',    _('Daily Gaplama truck-opening reminder')
    GAPLAMA_OVERLOAD = 'gaplama_overload', _('Gaplama block-day over-load')
```

After the `scope_block` field (around line 169-177), add:

```python
    scope_date = models.DateField(
        null=True, blank=True, db_index=True,
        help_text='Calendar day this task covers — gaplama_daily and gaplama_overload '
                  'tasks are day-granular, unlike weekly_plan/truck_allocation which use '
                  'scope_year/scope_week. Always null for shipment tasks.',
    )
```

- [ ] **Step 4: Generate and apply the migration**

```bash
cd backend
python manage.py makemigrations export
```

Note the generated filename and number (verify it's the true next number per this plan's
Global Constraints — rename if a stale/foreign migration file in the working tree caused
Django to pick a wrong number). Then:

```bash
python manage.py migrate export
python manage.py showmigrations export | tail -5
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && python manage.py test apps.export.tests_gaplama_tasks -v 2`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/apps/export/models/task.py backend/apps/export/migrations/ \
        backend/apps/export/tests_gaplama_tasks.py
git commit -m "feat(export): add Task.scope_date and two Gaplama TaskKinds

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `gaplama_overload` notification kind

**Files:**
- Modify: `backend/apps/export/models/notification.py` — `KIND_CHOICES` (around line
  38-39, after `weekly_plan_summary`)
- Create: `backend/apps/export/migrations/00NN_alter_notification_kind_gaplama.py`
- Test: append to `backend/apps/export/tests_gaplama_tasks.py`

**Interfaces:**
- Produces: `Notification.KIND_CHOICES` includes `('gaplama_overload', 'Gaplama block-day over-load')`.

- [ ] **Step 1: Write the failing test**

```python
# append to backend/apps/export/tests_gaplama_tasks.py
from apps.export.models import Notification


class NotificationKindTest(TestCase):
    def test_gaplama_overload_kind_exists(self):
        kinds = dict(Notification.KIND_CHOICES)
        self.assertIn('gaplama_overload', kinds)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python manage.py test apps.export.tests_gaplama_tasks.NotificationKindTest -v 2`
Expected: FAIL — `AssertionError: 'gaplama_overload' not found in {...}`

- [ ] **Step 3: Add the choice**

In `backend/apps/export/models/notification.py`, after the `weekly_plan_summary` line
(around line 38-39), add:

```python
        # Gaplama block-day over-load — a plan edit (or an out-of-band draft) left
        # loaded kg above plan + carry-in for a block-day.
        ('gaplama_overload', 'Gaplama over-load'),
```

- [ ] **Step 4: Generate and apply the migration**

```bash
cd backend
python manage.py makemigrations export
python manage.py migrate export
python manage.py showmigrations export | tail -3
```

This follows the same pattern as `0043_alter_notification_kind.py` and
`0072_alter_notification_kind.py` (both `AlterField` on `Notification.kind` regenerating
the `choices=` list) — expect an `AlterField` migration, not `AddField`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && python manage.py test apps.export.tests_gaplama_tasks.NotificationKindTest -v 2`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/apps/export/models/notification.py backend/apps/export/migrations/ \
        backend/apps/export/tests_gaplama_tasks.py
git commit -m "feat(export): add gaplama_overload notification kind

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: The daily task + the over-load task/notify service

**Files:**
- Create: `backend/apps/export/services/gaplama_tasks.py`
- Modify: `backend/apps/export/services/__init__.py` — export the new functions
- Test: append to `backend/apps/export/tests_gaplama_tasks.py`

**Interfaces:**
- Consumes: `build_gaplama_board(from_date, to_date, season)` from
  `apps.export.services.gaplama` (parent plan, Task 2); `apps.core.seasons.get_active_season`.
- Produces:

```python
def generate_gaplama_daily_task(today: date) -> list[Task]
def resolve_gaplama_overload_tasks() -> list[Task]
def run_gaplama_daily_job(today: date) -> None
```

- [ ] **Step 1: Write the failing tests**

```python
# append to backend/apps/export/tests_gaplama_tasks.py
from decimal import Decimal
from apps.core.models import GreenhouseBlock, GreenhouseConfig, Season
from apps.greenhouse.models import HarvestDayEntry, WeeklyHarvestPlan
from apps.export.models import Shipment, ShipmentBlockSource, ShipmentStatusType, Notification
from apps.export.services.gaplama_tasks import (
    generate_gaplama_daily_task,
    resolve_gaplama_overload_tasks,
    run_gaplama_daily_job,
)
from apps.core.models import User


class GaplamaDailyTaskTest(TestCase):
    def setUp(self):
        self.season = Season.objects.create(
            name='2026/2027', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
            is_active=True,
        )

    def test_creates_one_task_per_day(self):
        tasks = generate_gaplama_daily_task(date(2026, 9, 23))
        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0].kind, 'gaplama_daily')
        self.assertEqual(tasks[0].scope_date, date(2026, 9, 23))
        self.assertEqual(tasks[0].assignee_role, 'loading_dept_head')

    def test_idempotent_per_day(self):
        generate_gaplama_daily_task(date(2026, 9, 23))
        second = generate_gaplama_daily_task(date(2026, 9, 23))
        self.assertEqual(second, [])
        self.assertEqual(Task.objects.filter(kind='gaplama_daily').count(), 1)

    def test_not_auto_closed_by_resolver(self):
        # The daily task must NOT be touched by resolve_gaplama_overload_tasks —
        # it is manual-close only (D15). Confirm the resolver only ever looks at
        # gaplama_overload tasks.
        generate_gaplama_daily_task(date(2026, 9, 23))
        resolve_gaplama_overload_tasks()
        task = Task.objects.get(kind='gaplama_daily')
        self.assertEqual(task.state, 'open')


class GaplamaOverloadTest(TestCase):
    def setUp(self):
        self.season = Season.objects.create(
            name='2026/2027', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
            is_active=True,
        )
        self.block = GreenhouseBlock.objects.create(
            code='F', name='F', location='dusak', is_active=True,
        )
        self.head = User.objects.create_user(
            username='head', password='x', role='loading_dept_head',
        )
        self.manager = User.objects.create_user(
            username='mgr', password='x', role='export_manager',
        )

    def _plan(self, entry_date, kg):
        iso_year, iso_week, _ = entry_date.isocalendar()
        plan, _ = WeeklyHarvestPlan.objects.get_or_create(
            season=self.season, block=self.block, week_number=iso_week, year=iso_year,
        )
        HarvestDayEntry.objects.create(
            weekly_plan=plan, season=self.season, block=self.block,
            entry_date=entry_date, weekday=entry_date.weekday(), plan_value=Decimal(kg),
        )

    def _truck(self, ship_date, kg):
        status = ShipmentStatusType.objects.get(code='draft')
        shipment = Shipment.objects.create(
            shipment_code=f'TEST{ship_date.isoformat()}', date=ship_date,
            season=self.season, status=status,
        )
        ShipmentBlockSource.objects.create(shipment=shipment, block=self.block, weight_kg=Decimal(kg))

    def test_no_overload_no_task_no_notification(self):
        self._plan(date(2026, 9, 21), 20000)
        self._truck(date(2026, 9, 21), 12000)
        run_gaplama_daily_job(date(2026, 9, 21))
        self.assertEqual(Task.objects.filter(kind='gaplama_overload').count(), 0)
        self.assertEqual(Notification.objects.filter(kind='gaplama_overload').count(), 0)

    def test_overload_notifies_manager_admin_director_and_head(self):
        self._plan(date(2026, 9, 21), 10000)
        self._truck(date(2026, 9, 21), 15000)  # over by 5000
        run_gaplama_daily_job(date(2026, 9, 21))
        recipients = set(
            Notification.objects.filter(kind='gaplama_overload').values_list('user__role', flat=True)
        )
        self.assertIn('export_manager', recipients)
        self.assertIn('loading_dept_head', recipients)

    def test_overload_creates_task_for_loading_head_only(self):
        self._plan(date(2026, 9, 21), 10000)
        self._truck(date(2026, 9, 21), 15000)
        run_gaplama_daily_job(date(2026, 9, 21))
        tasks = Task.objects.filter(kind='gaplama_overload')
        self.assertEqual(tasks.count(), 1)
        self.assertEqual(tasks.first().assignee_role, 'loading_dept_head')

    def test_repeat_run_same_excess_does_not_renotify(self):
        self._plan(date(2026, 9, 21), 10000)
        self._truck(date(2026, 9, 21), 15000)
        run_gaplama_daily_job(date(2026, 9, 21))
        first_count = Notification.objects.filter(kind='gaplama_overload').count()
        run_gaplama_daily_job(date(2026, 9, 21))
        second_count = Notification.objects.filter(kind='gaplama_overload').count()
        self.assertEqual(first_count, second_count)

    def test_grown_excess_notifies_again(self):
        self._plan(date(2026, 9, 21), 10000)
        self._truck(date(2026, 9, 21), 15000)  # over by 5000
        run_gaplama_daily_job(date(2026, 9, 21))
        first_count = Notification.objects.filter(kind='gaplama_overload').count()
        self._truck(date(2026, 9, 21), 3000)  # now over by 8000
        run_gaplama_daily_job(date(2026, 9, 21))
        second_count = Notification.objects.filter(kind='gaplama_overload').count()
        self.assertGreater(second_count, first_count)

    def test_task_auto_closes_when_overload_gone(self):
        self._plan(date(2026, 9, 21), 10000)
        self._truck(date(2026, 9, 21), 15000)
        run_gaplama_daily_job(date(2026, 9, 21))
        task = Task.objects.get(kind='gaplama_overload')
        self.assertEqual(task.state, 'open')
        # Plan raised to cover the load — over_kg becomes 0.
        entry = HarvestDayEntry.objects.get(block=self.block, entry_date=date(2026, 9, 21))
        entry.plan_value = Decimal(20000)
        entry.save(update_fields=['plan_value'])
        resolved = resolve_gaplama_overload_tasks()
        self.assertEqual(len(resolved), 1)
        task.refresh_from_db()
        self.assertEqual(task.state, 'done')
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python manage.py test apps.export.tests_gaplama_tasks.GaplamaDailyTaskTest apps.export.tests_gaplama_tasks.GaplamaOverloadTest -v 2`
Expected: FAIL — `ModuleNotFoundError: No module named 'apps.export.services.gaplama_tasks'`

- [ ] **Step 3: Write the implementation**

```python
# backend/apps/export/services/gaplama_tasks.py
"""Gaplama-related task and notification generation.

Two independent jobs, both run from the same Celery beat tick (run_gaplama_daily_job):

1. A daily reminder ("open today's trucks") for the loading head — manual-close only
   (design spec D15), one per calendar day, idempotent.
2. An over-load detector — reuses build_gaplama_board() (the same calculation the
   Gaplama screen renders) so this can never disagree with what the user sees. Notifies
   export_manager/admin/director every time the excess GROWS, and gives the loading head
   both a notification and a task that auto-closes once the over-load clears (D14).

Mirrors apps.export.services.truck_allocation_tasks in shape: idempotent generation,
a separate resolve_* function called both from the beat job and lazily from
apps.core.views_me.MeTaskListView (see that file's existing resolve_truck_allocation_tasks
call for the pattern this follows).
"""
import logging
from datetime import date, timedelta
from decimal import Decimal

from apps.export.models import Task, TaskCompletionRule, TaskKind, TaskState

logger = logging.getLogger(__name__)

DAILY_TITLE_KEY = 'tasks.gaplama_daily'
DAILY_ASSIGNEE_ROLE = 'loading_dept_head'
OVERLOAD_TITLE_KEY = 'tasks.gaplama_overload'
OVERLOAD_ASSIGNEE_ROLE = 'loading_dept_head'
OVERLOAD_NOTIFY_ROLES = ('export_manager', 'admin', 'director')


def _gaplama_link() -> str:
    return '/export/gaplama'


def generate_gaplama_daily_task(today: date) -> list[Task]:
    """Create the loading head's daily Gaplama task, once per calendar day.

    Idempotent: nothing is created if one already exists for `today` in any state.
    Manual-close only (D15) — no resolver ever auto-closes this kind.
    """
    if Task.objects.filter(kind=TaskKind.GAPLAMA_DAILY, scope_date=today).exists():
        return []

    task = Task.objects.create(
        shipment=None,
        kind=TaskKind.GAPLAMA_DAILY,
        step=TaskKind.GAPLAMA_DAILY,
        rule=None,
        title_key=DAILY_TITLE_KEY,
        assignee_role=DAILY_ASSIGNEE_ROLE,
        assignee_user=None,
        scope_date=today,
        completion_rule=TaskCompletionRule.MANUAL_DONE,
        link=_gaplama_link(),
        state=TaskState.OPEN,
    )
    logger.info('Generated gaplama_daily task for %s', today)
    return [task]


def _current_overloads(today: date, season) -> list[dict]:
    """Rows from build_gaplama_board for today + the next 6 days where over_kg > 0."""
    from apps.export.services.gaplama import build_gaplama_board

    board = build_gaplama_board(today, today + timedelta(days=6), season)
    return [row for row in board['days'] if row['over_kg'] > 0]


def check_gaplama_overloads(today: date) -> list[dict]:
    """Find current over-loads, create/refresh the loading head's task, and notify.

    Returns the list of over-loaded rows (for logging/testing).
    De-duplication: a Notification is sent again only when a (block, date)'s over_kg
    has GROWN since the last notification sent for that (block, date) — tracked by
    re-reading the most recent gaplama_overload Notification whose message embeds the
    previous excess. A Task is created once per (block, date) and left open/updated
    until resolve_gaplama_overload_tasks() closes it.
    """
    from apps.core.models import User
    from apps.export.models import Notification
    from apps.core.seasons import get_active_season

    season = get_active_season()
    if season is None:
        return []

    overloads = _current_overloads(today, season)

    for row in overloads:
        block_id = row['block_id']
        entry_date = row['date']
        over_kg = row['over_kg']

        # One open task per (block, date) — reuse if it already exists and update
        # nothing on it (the task's job is "go fix this", not to display the figure).
        task_exists = Task.objects.filter(
            kind=TaskKind.GAPLAMA_OVERLOAD,
            scope_block_id=block_id,
            scope_date=entry_date,
            state__in=[TaskState.OPEN, TaskState.IN_PROGRESS],
        ).exists()
        if not task_exists:
            Task.objects.create(
                shipment=None,
                kind=TaskKind.GAPLAMA_OVERLOAD,
                step=TaskKind.GAPLAMA_OVERLOAD,
                rule=None,
                title_key=OVERLOAD_TITLE_KEY,
                assignee_role=OVERLOAD_ASSIGNEE_ROLE,
                assignee_user=None,
                scope_block_id=block_id,
                scope_date=entry_date,
                completion_rule=TaskCompletionRule.MANUAL_DONE,
                link=_gaplama_link(),
                state=TaskState.OPEN,
            )
            logger.info('Generated gaplama_overload task: block=%s date=%s over=%s',
                        block_id, entry_date, over_kg)

        # De-dup: has a notification already been sent for this (block, date) at
        # this excess or higher? Track via the most recent one's stored link, which
        # embeds the excess as a query param — cheap, no new model.
        marker = f'{_gaplama_link()}?block={block_id}&date={entry_date}&over={over_kg}'
        already_sent = Notification.objects.filter(
            kind='gaplama_overload', link=marker,
        ).exists()
        if already_sent:
            continue

        notify_roles = set(OVERLOAD_NOTIFY_ROLES) | {DAILY_ASSIGNEE_ROLE}
        recipients = User.objects.filter(role__in=notify_roles, is_active=True)
        message = (
            f'Block {row["block_code"]} on {entry_date.isoformat()} is loaded '
            f'{over_kg} kg over plan.'
        )
        Notification.objects.bulk_create(
            [
                Notification(user=user, kind='gaplama_overload', message=message, link=marker)
                for user in recipients
            ],
            batch_size=500,
        )
        logger.info('Notified %d users of gaplama over-load: block=%s date=%s over=%s',
                    recipients.count(), block_id, entry_date, over_kg)

    return overloads


def resolve_gaplama_overload_tasks() -> list[Task]:
    """Auto-close every open gaplama_overload task whose over-load has cleared.

    Called from the same beat tick as check_gaplama_overloads, and lazily from
    apps.core.views_me.MeTaskListView (mirroring resolve_truck_allocation_tasks).
    """
    from apps.core.seasons import get_active_season

    season = get_active_season()
    if season is None:
        return []

    open_tasks = list(
        Task.objects.filter(
            kind=TaskKind.GAPLAMA_OVERLOAD, state__in=[TaskState.OPEN, TaskState.IN_PROGRESS],
        )
    )
    if not open_tasks:
        return []

    from apps.export.services.gaplama import build_gaplama_board
    from django.utils import timezone

    dates = [t.scope_date for t in open_tasks if t.scope_date]
    if not dates:
        return []
    board = build_gaplama_board(min(dates), max(dates), season)
    over_lookup = {(row['block_id'], row['date']): row['over_kg'] for row in board['days']}

    resolved = []
    for task in open_tasks:
        key = (task.scope_block_id, task.scope_date)
        if over_lookup.get(key, Decimal(0)) <= 0:
            task.state = TaskState.DONE
            task.completed_at = timezone.now()
            task.save(update_fields=['state', 'completed_at'])
            resolved.append(task)
            logger.info('Auto-resolved gaplama_overload task id=%s', task.id)

    return resolved


def run_gaplama_daily_job(today: date) -> None:
    """The single entry point the Celery beat task calls each working morning."""
    generate_gaplama_daily_task(today)
    check_gaplama_overloads(today)
    resolve_gaplama_overload_tasks()
    logger.info('run_gaplama_daily_job completed for %s', today)
```

**Verify before finalizing:** the `_current_overloads` window (`today` through `today + 6
days`) is a reasonable default per the design spec's "current and next ISO week" language,
but confirm `Task.scope_block_id` is the correct filter attribute name (it should be, as
Django auto-generates `_id` accessors for FK fields — `scope_block` is the FK per the
existing model).

- [ ] **Step 4: Export from `services/__init__.py`**

In `backend/apps/export/services/__init__.py`, add alongside the existing
`resolve_truck_allocation_tasks` import/export:

```python
from apps.export.services.gaplama_tasks import (
    generate_gaplama_daily_task,
    resolve_gaplama_overload_tasks,
    run_gaplama_daily_job,
)
```

(Check the file's existing `__all__` list, if any, and add the three names to it too.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && python manage.py test apps.export.tests_gaplama_tasks -v 2`
Expected: PASS (all tests from Task 1, 2, and this task — ~13 total)

- [ ] **Step 6: Commit**

```bash
git add backend/apps/export/services/gaplama_tasks.py backend/apps/export/services/__init__.py \
        backend/apps/export/tests_gaplama_tasks.py
git commit -m "feat(export): add Gaplama daily task and over-load task/notification

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Celery beat wiring + lazy resolve from `views_me.py`

**Files:**
- Modify: `backend/apps/export/tasks.py` (add `@shared_task run_gaplama_daily` after
  `send_saturday_plan_summary`)
- Modify: `backend/config/settings.py` — `CELERY_BEAT_SCHEDULE` dict
- Modify: `backend/apps/core/views_me.py` — add `resolve_gaplama_overload_tasks()` to the
  lazy-resolve block (around lines 78-104)
- Test: `backend/apps/export/tests_gaplama_beat.py`

**Interfaces:**
- Consumes: `run_gaplama_daily_job` (Task 3), `resolve_gaplama_overload_tasks` (Task 3).
- Produces: `apps.export.tasks.run_gaplama_daily` (Celery task name).

- [ ] **Step 1: Write the failing test**

```python
# backend/apps/export/tests_gaplama_beat.py
from django.test import TestCase
from django.utils import timezone
from apps.export.tasks import run_gaplama_daily


class GaplamaBeatTaskTest(TestCase):
    def test_task_runs_without_error(self):
        # Smoke test — no season/data needed, just confirms the wiring calls through
        # to run_gaplama_daily_job with today's date and doesn't raise.
        run_gaplama_daily()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python manage.py test apps.export.tests_gaplama_beat -v 2`
Expected: FAIL — `ImportError: cannot import name 'run_gaplama_daily'`

- [ ] **Step 3: Add the beat task**

In `backend/apps/export/tasks.py`, after `send_saturday_plan_summary` (around line 21-25),
add:

```python
from apps.export.services.gaplama_tasks import run_gaplama_daily_job


@shared_task
def run_gaplama_daily() -> None:
    """Working mornings: the Gaplama daily task + over-load check/notify/resolve."""
    run_gaplama_daily_job(timezone.localdate())
```

- [ ] **Step 4: Add the beat schedule entry**

In `backend/config/settings.py`, inside `CELERY_BEAT_SCHEDULE` (around lines 466-496),
add, mirroring the `weekly-plan-setup` entry's dict shape:

```python
    'gaplama-daily': {
        'task': 'apps.export.tasks.run_gaplama_daily',
        'schedule': crontab(hour=6, minute=30),
        'options': {'expires': 3600},
    },
```

- [ ] **Step 5: Wire the lazy resolve into `views_me.py`**

In `backend/apps/core/views_me.py`, extend the import block (around lines 78-82):

```python
        from apps.export.services import (
            resolve_all_open_weekly_plan_tasks,
            resolve_local_sell_plan_tasks,
            resolve_truck_allocation_tasks,
            resolve_gaplama_overload_tasks,
        )
```

And after the `resolve_truck_allocation_tasks()` call (line 104):

```python
        resolve_gaplama_overload_tasks()
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && python manage.py test apps.export.tests_gaplama_beat -v 2`
Expected: PASS

- [ ] **Step 7: Run the existing `MeTaskListView` tests to confirm no regression**

Run: `cd backend && python manage.py test apps.export.tests_task_api -v 2`
Expected: PASS — same behavior, one extra (idempotent, cheap) resolver call added.

- [ ] **Step 8: Commit**

```bash
git add backend/apps/export/tasks.py backend/config/settings.py backend/apps/core/views_me.py \
        backend/apps/export/tests_gaplama_beat.py
git commit -m "feat(export): schedule the Gaplama daily beat job, wire lazy resolve

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Frontend — task kind, SelfBoard rendering, task-rules catalog, i18n

**Files:**
- Modify: `frontend/src/types/index.ts:1764` (`TaskKind` type union)
- Modify: `frontend/src/pages/me/SelfBoard.tsx:47-50` (`isPlanTask`)
- Modify: `frontend/src/pages/export/TaskRulesPage.tsx:39` (catalog rows)
- Modify: `frontend/src/i18n/{tk,ru,en}.json` (task-kind triads + `gaplama_overload`
  notification copy, mirroring the existing `kind_truck_allocation_*` triad locations)
- Test: extend `frontend/src/pages/me/SelfBoard.test.tsx` if it exists (check first; if
  not, add assertions to whatever test file already covers `isPlanTask`-equivalent
  behavior — search for an existing `truck_allocation` test case to extend alongside it)

**Interfaces:**
- Consumes: the two new backend `TaskKind` values from Task 1 (their string values
  `'gaplama_daily'` / `'gaplama_overload'` must match exactly).

- [ ] **Step 1: Write the failing test**

```ts
// add to whatever file already tests isPlanTask (search for the truck_allocation case)
it('treats gaplama_daily and gaplama_overload as plan tasks', () => {
  expect(isPlanTask({ kind: 'gaplama_daily' } as any)).toBe(true);
  expect(isPlanTask({ kind: 'gaplama_overload' } as any)).toBe(true);
});
```

(If `isPlanTask` is not exported from `SelfBoard.tsx` for direct import, check whether the
existing test suite tests it indirectly through rendered output instead — match whatever
pattern the existing `truck_allocation` test case already uses in that file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run <path-to-the-test-file-found-in-step-1>`
Expected: FAIL — `gaplama_daily`/`gaplama_overload` not recognized as plan tasks.

- [ ] **Step 3: Extend the `TaskKind` type**

In `frontend/src/types/index.ts:1764`:

```ts
export type TaskKind =
  | 'shipment'
  | 'weekly_plan'
  | 'local_sell_plan'
  | 'truck_allocation'
  | 'gaplama_daily'
  | 'gaplama_overload';
```

- [ ] **Step 4: Extend `isPlanTask` in `SelfBoard.tsx`**

At lines 47-50:

```ts
function isPlanTask(task: ITaskListItem): boolean {
  return task.kind === 'weekly_plan' || task.kind === 'local_sell_plan'
    || task.kind === 'truck_allocation' || task.kind === 'gaplama_daily'
    || task.kind === 'gaplama_overload';
}
```

- [ ] **Step 5: Add catalog rows in `TaskRulesPage.tsx`**

Near line 39 (the `{ key: 'truck_allocation', role: 'export_manager' }` row), add:

```ts
{ key: 'gaplama_daily', role: 'loading_dept_head' },
{ key: 'gaplama_overload', role: 'loading_dept_head' },
```

- [ ] **Step 6: Add i18n triads**

In `tk.json`, `ru.json`, `en.json`, mirror the existing `kind_truck_allocation_name` /
`_trigger` / `_completes` triad (reported around lines 352-354, 3045-3048, 3800-3805) with
two new triads: `kind_gaplama_daily_*` and `kind_gaplama_overload_*`. Also add the
`tasks.gaplama_daily` / `tasks.gaplama_overload` title-key strings (referenced by
`title_key` on the backend Task rows) and a `notification.gaplama_overload` copy string for
the bell.

Example tk copy (adjust register to match the file's existing voice):
- `tasks.gaplama_daily`: "Şu günki tırlary aç"
- `tasks.gaplama_overload`: "Aşa ýüklenen bloky düzet"

- [ ] **Step 7: Run test to verify it passes**

Run: `cd frontend && npx vitest run <path-to-the-test-file-found-in-step-1>`
Expected: PASS

- [ ] **Step 8: Type-check**

Run: `cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0`
Expected: no new errors.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/pages/me/SelfBoard.tsx \
        frontend/src/pages/export/TaskRulesPage.tsx \
        frontend/src/i18n/tk.json frontend/src/i18n/ru.json frontend/src/i18n/en.json
git commit -m "feat(frontend): recognize the two Gaplama task kinds on the board

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Docs and full-suite verification

**Files:**
- Modify: `docs/obsidian/screens/gaplama.md` — remove the "Not built in this screen" note
  pointing to this plan; add a short "Tasks and notifications" section describing the
  daily reminder and the over-load flow
- Modify: `docs/obsidian/processes/comments-tasks.md` (or wherever `TaskKind` values are
  documented — grep for `truck_allocation` in `docs/obsidian/` and mirror its entry)
- Modify: `CHANGELOG.md`
- Modify: `BUILD_TEST_LOG.md`

- [ ] **Step 1: Update `docs/obsidian/screens/gaplama.md`**

Replace the "Not built in this screen" section with:

```markdown
## Tasks and notifications

A Celery beat job (`apps.export.tasks.run_gaplama_daily`, 06:30 local) runs
`run_gaplama_daily_job` each working morning:

- Creates one **daily task** ("open today's trucks") for the loading head, per calendar
  day. Manual-close only — nothing auto-resolves it (design spec D15).
- Checks the board for the current and next ISO week for over-loaded block-days
  (`over_kg > 0`) using the same `build_gaplama_board()` the screen renders. For each
  one: notifies export_manager, admin, director and the loading head, and gives the
  loading head an **over-load task** that auto-closes once the excess clears
  (design spec D14).

See `backend/apps/export/services/gaplama_tasks.py`.
```

- [ ] **Step 2: Grep and mirror the TaskKind doc entry**

```bash
grep -rln "truck_allocation" docs/obsidian/
```

Add the two new kinds beside whatever entry documents `truck_allocation` there, following
its exact format.

- [ ] **Step 3: Update `CHANGELOG.md`**

Add under `[Unreleased]` → `Added`: "Gaplama daily task + over-load task/notification
(Celery beat, `gaplama_overload` notification kind)."

- [ ] **Step 4: Log the build**

Prepend to `BUILD_TEST_LOG.md`:

```markdown
- [ ] 2026-09-23 — Gaplama daily task + over-load task/notification (Celery beat) — NEEDS TEST
```

- [ ] **Step 5: Run the full backend suite for touched apps**

```bash
cd backend
python manage.py test apps.export apps.core --verbosity=2
```

Expected: PASS, or only pre-existing tracked failures.

- [ ] **Step 6: Confirm migrations applied and clean**

```bash
python manage.py showmigrations export | grep -v '\[X\]'
python manage.py makemigrations --check
```

Expected: no unapplied migrations, "No changes detected".

- [ ] **Step 7: Run the full frontend suite and type-check**

```bash
cd frontend
npx vitest run
npx tsc --noEmit --ignoreDeprecations 5.0
```

Expected: PASS, no new type errors.

- [ ] **Step 8: Commit docs**

```bash
git add docs/obsidian/screens/gaplama.md docs/obsidian/ CHANGELOG.md BUILD_TEST_LOG.md
git commit -m "docs(gaplama): document the daily task and over-load flow

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 9: State results plainly, do not merge**

Report which suites passed and which pre-existing failures were seen. State plainly:
"Built — NOT tested yet. Did you test it?" Do not merge this worktree's branch into `main`
without the user's explicit "commit"/"merge" instruction.
