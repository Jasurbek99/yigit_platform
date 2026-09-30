# Planning Tasks (Tasks.md items 1–5a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the planning roles their weekly and daily to-dos. The greenhouse plan task arrives on Friday and turns red after it. The truck-allocation task gets a Saturday deadline. A new «Tanyşdym» review opens when a plan change moves the truck count. A new transport task opens on a new transport page. Two new daily tasks cover «Ýük planla» and «Eksport planla», and a daily task nobody did is closed as «missed».

**Architecture:** This extends the existing code-driven plan-task pattern (`weekly_plan_tasks.py`, `truck_allocation_tasks.py`). There is no new rule engine.
- **Task model.** Four new `TaskKind`s, one new cancel reason, two new `Task` fields (`scope_date`, `ack_snapshot`) and two conditional unique constraints.
- **Where tasks are created.** Only in Celery beat and at synchronous write points: task creation, `set_splits`, and `acknowledge`. The lazy `/me/tasks/` read only closes tasks, never creates them.
- **Acknowledgement.** «Tanyşdym» is a new `POST /tasks/{id}/acknowledge/`. It stores what the user saw as an ASCII `k:v;…` snapshot.
- **Two read endpoints.** They sit on `WeeklyTruckAllocationViewSet` and feed the `/export/plan` banner and the new `/transport/plan` page.

**Tech Stack:** Django 5 + DRF on MSSQL (mssql-django), Celery beat, React 18 + TypeScript + Ant Design + TanStack Query, Vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-09-29-planning-tasks-design.md` (approved 2026-09-29). Whole-list context: `docs/superpowers/specs/2026-09-29-task-catalog-gap-map.md`.

## Global Constraints

**Codes and names**
- Task kinds (`Task.kind` is `max_length=16` and indexed; do NOT widen it): `alloc_review`, `transport_plan`, `daily_loading`, `daily_export`. Cancel reason: `missed`.
- Title keys:
  - `tasks.review_truck_allocation`
  - `tasks.transport_plan`
  - `tasks.transport_plan_changed`
  - `tasks.daily_loading_plan`
  - `tasks.daily_export_plan`
- Page code `transport.plan`. Route `/transport/plan`.
- API endpoints:
  - `GET /api/v1/export/truck-allocations/review/?year=&week=`
  - `GET /api/v1/export/truck-allocations/transport-plan/?year=&week=`
  - `POST /api/v1/export/tasks/{id}/acknowledge/`

**Time and counting rules**
- Local time is `GreenhouseConfig.timezone_name` (Asia/Ashgabat, the same as `CELERY_TIMEZONE`).
- `GreenhouseConfig.plan_deadline_weekday` is a **Python weekday** (Mon=0, Fri=4). Its help_text says "ISO", which is wrong: 4 is Friday only for `date.weekday()`.
- A deadline means 23:59:59 local on that day, built by `end_of_local_day(day)`. A task is red after it; `Task.is_overdue` already implements this.
- Trucks needed for a day = `_trucks_for_kg(kg)` in `truck_allocation_tasks.py`: half-up rounding at 18,500 kg. Never re-implement it.
- Trucks are compared **per day, Mon–Sat** (spec A-1).
- Reviews and transport re-reviews stop after the Saturday of week N+1 (spec A-4).
- "Live" shipment: `is_archived=False`, `deleted_at IS NULL`, status code not `cancelled`.

**Project rules**
- MSSQL:
  - no JSONField / ArrayField / DISTINCT ON
  - `bulk_create(..., batch_size=500)`
  - `.order_by()` on any aggregated queryset or any queryset wrapped in `Subquery`
- Dependency direction `core ← greenhouse ← export`. Greenhouse code never imports export; core imports export only lazily inside functions (existing pattern in `views_me.py`). No Django signals.
- Scheduled jobs go in `CELERY_BEAT_SCHEDULE`, never crontab (memory "Celery Beat, Not Crontab").
- UI copy never says draft / черновик / garalama.

**Commits and the shared tree**
- **Commits:** CLAUDE.md forbids committing without the user's explicit word "commit". At the start of execution, ask once whether the per-task commit steps are approved. If they are not, skip every commit step and leave the work uncommitted.
- **Shared tree:** other sessions share this working tree AND the git index.
  - Right now `AppLayout.tsx`, `AppLayout.menuGroups.test.tsx`, `core/models/user.py`, `core/roles.py`, `export/views.py`, `export/views_admin.py`, docs under `docs/obsidian/` and the untracked garawul migrations are dirty from the garawul session.
  - Before every commit, run `git status` and `git diff --cached`. Stage only this task's paths.
  - For a file another session also dirtied, stage only your own hunks with `git add -p <file>`. Never stage a whole file, and never run `git add -A`.
- **Migrations:**
  - Before each `makemigrations`, run `ls backend/apps/<app>/migrations | tail -3` and `git log --oneline -5 origin/main`. There must be exactly one leaf.
  - The garawul session also changes `Task` (kind `gate`, `scope_location`, a constraint). Its export migration must be the dependency of ours, or add a `--merge`.
  - Never renumber a migration that is already applied.
  - After `makemigrations`, run `migrate <app>` yourself and confirm with `showmigrations <app>`.
- **Garawul ordering (blocker for commit and deploy).**
  - The current leaves are the garawul session's **untracked** `export/0082_garawul_role_choices` and `core/0067_seed_garawul_perms`, and our Task 1 and Task 7 migrations will depend on them.
  - Our migrations must not be committed, pushed or deployed until the garawul migrations they depend on are committed first. Precedent: memory "Task Rules Commit Blocked".
  - If garawul is still uncommitted when a commit step comes up, skip it and tell the user.
- **Files the garawul plan also edits** (`docs/superpowers/plans/2026-09-29-garawul-gate.md`):
  - backend: `models/task.py`, `TaskListSerializer`, `core/views_me.py`, `permission_registry.py`, `seed_permissions.py`
  - frontend: `types/index.ts` (`TaskKind`, `ITaskListItem`), `SelfBoard.tsx` (`isPlanTask`), `PlanTaskCard.tsx`, `App.tsx`, `AppLayout.tsx`, `utils/permissions.ts`
  - Before editing one of these, re-read it. Keep any `gate` / garawul lines you find, and stage only your hunks.

**Test runs**
- Backend: `cd backend && ./venv/Scripts/python.exe manage.py test <label> --noinput --verbosity=1`.
- If another `manage.py test` process is running, use a private test DB before believing a red run (memory "Test DB Name Collision"): a scratchpad settings module with `DATABASES['default']['NAME']='master'` and `TEST['NAME']='test_YIGIT_ISOLATED_PT'`, run with `--settings`.
- Frontend: `cd frontend && npx vitest run <path>`. Typecheck with `npx tsc --noEmit --ignoreDeprecations 5.0`; `npm run type-check` is broken (TS5103).
- The backend suite is not a clean gate: 71/351 tests fail in pre-existing buckets. Judge a task by its own test labels plus the neighbour labels listed in each task.

## Review Focus

Most likely to bite first:

1. **A beat run twice, or a beat run racing `set_splits`.** Expected: exactly one daily task per kind per day, and exactly one open review or transport task per week. Pinned by the IntegrityError-swallow tests in Tasks 1, 4 and 6.
2. **The close→open season gap** (no active season). Expected: no daily or weekly-plan task is created. Pinned in Tasks 2 and 6.
3. **A truck opened today, then soft-deleted or cancelled.** Expected: it does not count as «done» for the daily task. Pinned in Task 6.
4. **ISO year boundary.** Expected: on 2026-12-31 "next week" is 2027-W1; Friday's plan task targets it, and so does its deadline. Pinned in Task 2.
5. **Double-click on «Tanyşdym»,** or a wrong role pressing it. Expected: a second click returns 200 with nothing changed; a `sales_rep` gets 403. Pinned in Task 4.

---

### Task 1: Task model — new kinds, `missed`, `scope_date`, `ack_snapshot`, constraints

**Files:**
- Modify: `backend/apps/export/models/task.py`
- Modify: `backend/apps/export/serializers.py`: `TaskListSerializer.Meta.fields`, currently ending at `'blocked_reason'`.
- Create: `backend/apps/export/migrations/00NN_plan_task_kinds.py`, generated. NN is the next free number after the garawul migration(s).
- Test: `backend/apps/export/tests_plan_task_model.py`

**Interfaces:**
- Produces:
  - `TaskKind.ALLOC_REVIEW`, `TRANSPORT_PLAN`, `DAILY_LOADING`, `DAILY_EXPORT`
  - `TaskCancelReason.MISSED`
  - `Task.scope_date: date | None`
  - `Task.ack_snapshot: str` (default `''`)
  - List serializer fields `scope_date` (`"YYYY-MM-DD"` or null) and `cancelled_reason` (str)

- [ ] **Step 1: Write the failing test**

```python
"""Model-level guarantees for the planning tasks (spec 2026-09-29-planning-tasks-design)."""
from datetime import date

from django.db import IntegrityError, transaction
from django.test import TestCase

from apps.export.models import Task, TaskCancelReason, TaskCompletionRule, TaskKind, TaskState
from apps.export.serializers import TaskListSerializer


def _task(**kw) -> Task:
    base = dict(
        shipment=None, rule=None, title_key='t', assignee_role='export_manager',
        completion_rule=TaskCompletionRule.MANUAL_DONE,
    )
    base.update(kw)
    base.setdefault('step', base['kind'])
    return Task.objects.create(**base)


class PlanTaskModelTests(TestCase):
    def test_new_kind_codes_fit_the_column(self):
        for kind in (TaskKind.ALLOC_REVIEW, TaskKind.TRANSPORT_PLAN,
                     TaskKind.DAILY_LOADING, TaskKind.DAILY_EXPORT):
            self.assertLessEqual(len(kind.value), Task._meta.get_field('kind').max_length)

    def test_one_daily_task_per_kind_and_day(self):
        d = date(2026, 9, 28)
        _task(kind=TaskKind.DAILY_EXPORT, scope_date=d)
        with self.assertRaises(IntegrityError), transaction.atomic():
            _task(kind=TaskKind.DAILY_EXPORT, scope_date=d)
        # The other daily kind on the same day is allowed.
        _task(kind=TaskKind.DAILY_LOADING, scope_date=d, assignee_role='loading_dept_head')

    def test_one_open_ack_task_per_week_but_done_ones_repeat(self):
        _task(kind=TaskKind.TRANSPORT_PLAN, scope_year=2026, scope_week=40,
              assignee_role='transport', state=TaskState.DONE)
        _task(kind=TaskKind.TRANSPORT_PLAN, scope_year=2026, scope_week=40, assignee_role='transport')
        with self.assertRaises(IntegrityError), transaction.atomic():
            _task(kind=TaskKind.TRANSPORT_PLAN, scope_year=2026, scope_week=40, assignee_role='transport')

    def test_list_serializer_exposes_scope_date_and_cancelled_reason(self):
        t = _task(kind=TaskKind.DAILY_EXPORT, scope_date=date(2026, 9, 28),
                  state=TaskState.CANCELLED, cancelled_reason=TaskCancelReason.MISSED)
        data = TaskListSerializer(t).data
        self.assertEqual(data['scope_date'], '2026-09-28')
        self.assertEqual(data['cancelled_reason'], 'missed')
        self.assertEqual(Task.objects.get(pk=t.pk).ack_snapshot, '')
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd backend && ./venv/Scripts/python.exe manage.py test apps.export.tests_plan_task_model --noinput`
Expected: ERROR, `AttributeError: ALLOC_REVIEW`.

- [ ] **Step 3: Implement the model changes**

In `models/task.py`, extend the enums:

```python
class TaskKind(models.TextChoices):
    SHIPMENT        = 'shipment',        _('Shipment task')
    WEEKLY_PLAN     = 'weekly_plan',     _('Weekly harvest-plan task')
    LOCAL_SELL_PLAN = 'local_sell_plan', _('Local sell-plan task')
    TRUCK_ALLOCATION = 'truck_allocation', _('Weekly truck-allocation task')
    # Task.kind is max_length=16 (indexed) — keep new codes ≤ 16 chars.
    ALLOC_REVIEW    = 'alloc_review',    _('Truck-allocation review (plan changed)')
    TRANSPORT_PLAN  = 'transport_plan',  _('Transport truck planning («Tanyşdym»)')
    DAILY_LOADING   = 'daily_loading',   _('Daily loading plan (Gaplama)')
    DAILY_EXPORT    = 'daily_export',    _('Daily export plan')
```

If the garawul session has already added `GATE = 'gate'`, keep it. Add these four after it.

Add a value to `TaskCancelReason`, after `RULE_DEACTIVATED`:

```python
    MISSED             = 'missed',             _('Daily task not done on its day')
```

Add the two fields to `Task`, after `scope_block`:

```python
    scope_date = models.DateField(
        null=True, blank=True,
        help_text='Local day a daily_loading / daily_export task covers',
    )
    ack_snapshot = models.TextField(
        blank=True, default='',
        help_text='ASCII "k:v;..." counts snapshot: the review baseline on a '
                  'truck_allocation task, or what was seen at «Tanyşdym» on '
                  'alloc_review / transport_plan tasks',
    )
```

Append to `Meta.constraints`:

```python
            # One daily task per kind per local day, in any state — a re-run of
            # the 06:00 beat, or a second worker, cannot duplicate it, and a
            # `missed` one is never re-created.
            models.UniqueConstraint(
                fields=['kind', 'scope_date'],
                condition=models.Q(kind__in=['daily_loading', 'daily_export']),
                name='export_task_one_daily_per_kind',
            ),
            # At most one OPEN acknowledgement task per (kind, ISO week); done
            # ones repeat (a later change raises a fresh one). MSSQL filtered
            # indexes accept IN (...) AND IN (...).
            models.UniqueConstraint(
                fields=['kind', 'scope_year', 'scope_week'],
                condition=models.Q(
                    kind__in=['alloc_review', 'transport_plan'],
                    state__in=['open', 'in_progress'],
                ),
                name='export_task_one_open_ack_per_week',
            ),
```

In `serializers.py`, add these to `TaskListSerializer.Meta.fields`, right after `'scope_block_code',`:

```python
            'scope_date',
            'cancelled_reason',
```

- [ ] **Step 4: Generate the migration and apply it**

```bash
ls backend/apps/export/migrations | tail -3
git log --oneline -5 origin/main
cd backend && ./venv/Scripts/python.exe manage.py makemigrations export --name plan_task_kinds
./venv/Scripts/python.exe manage.py migrate export
./venv/Scripts/python.exe manage.py showmigrations export | tail -3
```

Expected: one new migration with AlterField kind choices, AlterField cancelled_reason choices, AddField ×2 and AddConstraint ×2, shown applied (`[X]`).

**Open the generated file before migrating.** It must contain exactly those six operations. If it also contains `scope_location`, a `gate` choice that is not already in an earlier migration, or any constraint that is not ours, then `makemigrations` swallowed the garawul session's uncommitted `models/task.py` edits. In that case, delete the file, do not migrate, stop, and tell the user.

If `makemigrations` reports "Conflicting migrations", **stop**: another session added a sibling. Rebase this migration's `dependencies` onto the newest leaf, but only if this migration is unapplied everywhere. Otherwise run `makemigrations --merge`.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `./venv/Scripts/python.exe manage.py test apps.export.tests_plan_task_model apps.export.tests_task_models apps.export.tests_task_uniqueness apps.export.tests_task_api --noinput`
Expected: all green, except failures that were already failing before this task. Check that with `git stash` only if the tree is yours; otherwise compare against a run made before the change.

- [ ] **Step 6: Commit (only if commits are approved)**

```bash
git status && git diff --cached
git add backend/apps/export/models/task.py backend/apps/export/migrations/00NN_plan_task_kinds.py backend/apps/export/tests_plan_task_model.py
git add -p backend/apps/export/serializers.py
git commit -m "feat(p3): task kinds and fields for planning tasks"
```

---

### Task 2: Shared helpers + weekly plan task on Friday with a Friday deadline

**Files:**
- Create: `backend/apps/export/services/plan_task_common.py`
- Modify: `backend/apps/export/services/weekly_plan_tasks.py`: `generate_weekly_plan_tasks` and a new `plan_deadline`.
- Modify: `backend/apps/export/management/commands/run_weekly_plan_setup.py`
- Modify: `backend/apps/export/tests_weekly_plan_setup_command.py`. Its three tests currently depend on the real date.
- Test: `backend/apps/export/tests_plan_task_common.py`

**Interfaces:**
- Produces (in `plan_task_common`):
  - `local_tz() -> ZoneInfo`
  - `local_today(now: datetime | None = None) -> date`
  - `end_of_local_day(day: date) -> datetime`
  - `next_iso_week(today: date) -> tuple[int, int]`
  - `iso_monday(year: int, week: int) -> date`
  - `encode_counts(counts: Mapping[tuple[int, ...], int]) -> str`
  - `decode_counts(text: str) -> dict[tuple[int, ...], int]`
- Produces (in `weekly_plan_tasks`): `plan_deadline(year: int, week: int) -> datetime`.
- Produces: the command `run_weekly_plan_setup --today YYYY-MM-DD`.

- [ ] **Step 1: Write the failing tests**

`tests_plan_task_common.py`:

```python
"""Helpers shared by the planning tasks."""
from datetime import date, datetime, time
from zoneinfo import ZoneInfo

from django.test import TestCase

from apps.core.models import GreenhouseConfig
from apps.export.services.plan_task_common import (
    decode_counts, encode_counts, end_of_local_day, iso_monday, next_iso_week,
)
from apps.export.services.weekly_plan_tasks import plan_deadline

TZ = ZoneInfo('Asia/Ashgabat')


class PlanTaskCommonTests(TestCase):
    def setUp(self):
        GreenhouseConfig.get_solo()

    def test_end_of_local_day_is_2359_local(self):
        self.assertEqual(
            end_of_local_day(date(2026, 9, 25)),
            datetime.combine(date(2026, 9, 25), time(23, 59, 59), tzinfo=TZ),
        )

    def test_next_iso_week_crosses_the_year(self):
        self.assertEqual(next_iso_week(date(2026, 9, 25)), (2026, 40))
        self.assertEqual(next_iso_week(date(2026, 12, 31)), (2027, 1))

    def test_iso_monday(self):
        self.assertEqual(iso_monday(2026, 40), date(2026, 9, 28))

    def test_counts_round_trip_and_canonical(self):
        counts = {(3, 7): 1, (1, 5): 2, (2, 5): 0}
        text = encode_counts(counts)
        self.assertEqual(text, '1:5:2;3:7:1')          # zeros dropped, keys sorted
        self.assertEqual(decode_counts(text), {(1, 5): 2, (3, 7): 1})
        self.assertEqual(decode_counts(''), {})
        self.assertEqual(encode_counts({(2,): 3, (1,): 1}), '1:1;2:3')

    def test_plan_deadline_is_friday_before_the_week(self):
        # Week 2026-W40 starts Mon 2026-09-28 → deadline Fri 2026-09-25 23:59:59.
        self.assertEqual(plan_deadline(2026, 40), end_of_local_day(date(2026, 9, 25)))
        # Year boundary: 2027-W1 starts Mon 2027-01-04 → Fri 2027-01-01.
        self.assertEqual(plan_deadline(2027, 1), end_of_local_day(date(2027, 1, 1)))
```

Replace the three tests in `tests_weekly_plan_setup_command.py`. Keep the module docstring, and add a line saying tasks are now created from Friday for next week only:

```python
FRIDAY = '2026-05-22'      # ISO 2026-W21 → the task targets W22
THURSDAY = '2026-05-21'


    def test_friday_initializes_both_weeks_and_tasks_next_week_only(self):
        call_command('run_weekly_plan_setup', today=FRIDAY)

        weeks = set(
            WeeklyHarvestPlan.objects.filter(season=self.season)
            .values_list('year', 'week_number')
        )
        self.assertEqual(weeks, {(2026, 21), (2026, 22)})
        tasks = Task.objects.filter(kind=TaskKind.WEEKLY_PLAN, assignee_user=self.mgr)
        self.assertEqual(list(tasks.values_list('scope_year', 'scope_week')), [(2026, 22)])
        self.assertEqual(
            tasks.get().deadline,
            datetime.combine(date(2026, 5, 22), time(23, 59, 59), tzinfo=ZoneInfo('Asia/Ashgabat')),
        )

    def test_before_friday_initializes_weeks_but_creates_no_task(self):
        call_command('run_weekly_plan_setup', today=THURSDAY)
        self.assertEqual(WeeklyHarvestPlan.objects.filter(season=self.season).count(), 4)
        self.assertFalse(Task.objects.filter(kind=TaskKind.WEEKLY_PLAN).exists())

    def test_no_active_season_creates_nothing(self):
        Season.objects.update(is_active=False)
        call_command('run_weekly_plan_setup', today=FRIDAY)
        self.assertFalse(Task.objects.filter(kind=TaskKind.WEEKLY_PLAN).exists())

    def test_celery_task_runs_the_same_setup(self):
        """The beat entry must reach the command. Real date → assert only the
        date-independent half (the grid)."""
        from apps.export.tasks import run_weekly_plan_setup

        run_weekly_plan_setup()
        self.assertTrue(WeeklyHarvestPlan.objects.filter(season=self.season).exists())

    def test_rerun_is_idempotent(self):
        call_command('run_weekly_plan_setup', today=FRIDAY)
        call_command('run_weekly_plan_setup', today=FRIDAY)
        self.assertEqual(WeeklyHarvestPlan.objects.filter(season=self.season).count(), 4)
        self.assertEqual(Task.objects.filter(kind=TaskKind.WEEKLY_PLAN, assignee_user=self.mgr).count(), 1)
```

Add these imports: `from datetime import date, datetime, time` and `from zoneinfo import ZoneInfo`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `./venv/Scripts/python.exe manage.py test apps.export.tests_plan_task_common apps.export.tests_weekly_plan_setup_command --noinput`
Expected: ImportError on `plan_task_common`; the command tests fail on `today` as an unknown option.

- [ ] **Step 3: Implement**

`services/plan_task_common.py`:

```python
"""Helpers shared by the planning tasks (weekly plan, truck allocation, reviews,
daily loading / export). Spec: docs/superpowers/specs/2026-09-29-planning-tasks-design.md.

Days are greenhouse-local (GreenhouseConfig.timezone_name — the clock
run_weekly_plan_setup already uses). Counts snapshots are ASCII "k:v;..." strings
because Task cannot hold JSON on MSSQL.
"""
from collections.abc import Mapping
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.utils import timezone


def local_tz() -> ZoneInfo:
    from apps.core.models import GreenhouseConfig

    return ZoneInfo(GreenhouseConfig.get_solo().timezone_name)


def local_today(now: datetime | None = None) -> date:
    return (now or timezone.now()).astimezone(local_tz()).date()


def end_of_local_day(day: date) -> datetime:
    """23:59:59 local on `day` — a task with this deadline turns red after it."""
    return datetime.combine(day, time(23, 59, 59), tzinfo=local_tz())


def next_iso_week(today: date) -> tuple[int, int]:
    """(ISO year, ISO week) of the week after the one containing `today`."""
    year, week, _ = (today + timedelta(days=7)).isocalendar()
    return year, week


def iso_monday(year: int, week: int) -> date:
    return date.fromisocalendar(year, week, 1)


def encode_counts(counts: Mapping[tuple[int, ...], int]) -> str:
    """{(1, 5): 2, (3, 7): 1} → "1:5:2;3:7:1". Zero counts dropped and keys
    sorted, so two equal maps always encode to the same string."""
    return ';'.join(
        ':'.join(str(part) for part in (*key, n))
        for key, n in sorted(counts.items()) if n
    )


def decode_counts(text: str) -> dict[tuple[int, ...], int]:
    out: dict[tuple[int, ...], int] = {}
    for chunk in filter(None, text.split(';')):
        *key, n = (int(part) for part in chunk.split(':'))
        out[tuple(key)] = n
    return out
```

In `weekly_plan_tasks.py`, change the import line to:
`from datetime import date, datetime, timedelta`. Also add
`from apps.export.services.plan_task_common import end_of_local_day, iso_monday`. Then add, above `generate_weekly_plan_tasks`:

```python
def plan_deadline(year: int, week: int) -> datetime:
    """End of the plan-deadline day (Friday by default) in the week BEFORE (year, week).

    GreenhouseConfig.plan_deadline_weekday is a Python weekday (Mon=0, Fri=4),
    despite its help_text saying "ISO".
    """
    from apps.core.models import GreenhouseConfig

    weekday = GreenhouseConfig.get_solo().plan_deadline_weekday
    return end_of_local_day(iso_monday(year, week) - timedelta(days=7 - weekday))
```

In `generate_weekly_plan_tasks`, compute `deadline = plan_deadline(year, week)` once, before the loop. Then pass `deadline=deadline,` to `Task.objects.create(...)`.

`run_weekly_plan_setup.py`. Update the docstring: tasks are now generated for NEXT week only, from the plan-deadline weekday (Friday) on. Then:

```python
from datetime import date

from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Daily: initialize current+next weekly-plan weeks; from Friday, generate next week\'s plan tasks'

    def add_arguments(self, parser):
        parser.add_argument('--today', help='Local date YYYY-MM-DD to run as (tests / backfill).')

    def handle(self, *args, **options) -> None:
        from apps.core.models import GreenhouseConfig
        from apps.export.services import generate_weekly_plan_tasks
        from apps.export.services.plan_task_common import local_today, next_iso_week
        from apps.greenhouse.services import initialize_upcoming_weeks

        config = GreenhouseConfig.get_solo()
        today_local = date.fromisoformat(options['today']) if options.get('today') else local_today()

        weeks = initialize_upcoming_weeks(today_local)
        tasks_created = 0
        # Owner rule 2026-09-29 (docs/Tasks.md item 1): the "fill weekly plan"
        # task for week N+1 arrives on Friday (plan_deadline_weekday) and stays
        # until filled. Fri/Sat/Sun re-runs are idempotent and catch a manager
        # assigned late. No active season → `weeks` is empty → no tasks.
        if weeks and today_local.weekday() >= config.plan_deadline_weekday:
            year, week = next_iso_week(today_local)
            tasks_created = len(generate_weekly_plan_tasks(year, week))

        self.stdout.write(
            self.style.SUCCESS(
                f'Weekly-plan setup: ensured weeks {weeks}, '
                f'created {tasks_created} new plan tasks ({today_local}).'
            )
        )
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `./venv/Scripts/python.exe manage.py test apps.export.tests_plan_task_common apps.export.tests_weekly_plan_setup_command apps.export.tests_weekly_plan_tasks --noinput`
Expected: PASS. If a `tests_weekly_plan_tasks` test asserts `deadline is None`, update that assertion to `plan_deadline(year, week)`, and state it in the task report.

- [ ] **Step 5: Commit (only if commits are approved)**

```bash
git status && git diff --cached
git add backend/apps/export/services/plan_task_common.py backend/apps/export/services/weekly_plan_tasks.py backend/apps/export/management/commands/run_weekly_plan_setup.py backend/apps/export/tests_plan_task_common.py backend/apps/export/tests_weekly_plan_setup_command.py
git commit -m "feat(p3): weekly plan task comes on Friday for next week, red after Friday"
```

---

### Task 3: Truck allocation — Saturday deadline, needed/allocated counts, baseline at creation

**Files:**
- Modify: `backend/apps/export/services/truck_allocation_tasks.py`
- Test: `backend/apps/export/tests_truck_allocation_tasks.py` (append to `TruckAllocationTaskTests`)

**Interfaces:**
- Consumes: `encode_counts`, `end_of_local_day` and `iso_monday` from Task 2.
- Produces:
  - `needed_trucks_by_day(year: int, week: int) -> dict[tuple[int], int]`: key `(iso_weekday,)`, 1=Mon … 6=Sat, days needing 0 omitted.
  - `allocation_counts(year: int, week: int) -> dict[tuple[int, int], int]`: key `(iso_weekday, destination_id)`, Mon–Sat, count > 0 only.
  - The truck_allocation Task created with `deadline` = the Saturday before the week, 23:59:59, and `ack_snapshot` = `encode_counts(needed_trucks_by_day(...))`.

- [ ] **Step 1: Write the failing tests** (append to `TruckAllocationTaskTests`)

```python
    def test_deadline_is_saturday_before_the_week(self):
        from apps.export.services.plan_task_common import end_of_local_day

        task = generate_truck_allocation_task(YEAR, WEEK)[0]
        self.assertEqual(task.deadline, end_of_local_day(datetime.date(2026, 9, 19)))

    def test_created_with_needed_trucks_baseline(self):
        self._fill(self.block_a, [0], value=Decimal('20000'))   # Mon → 1 truck
        self._fill(self.block_a, [1], value=Decimal('40000'))   # Tue → 2 trucks
        self._fill(self.block_a, [2], value=Decimal('5000'))    # Wed → 0, omitted
        task = generate_truck_allocation_task(YEAR, WEEK)[0]
        self.assertEqual(task.ack_snapshot, '1:1;2:2')

    def test_needed_trucks_rounds_half_up(self):
        from apps.export.services.truck_allocation_tasks import needed_trucks_by_day

        self._fill(self.block_a, [0], value=Decimal('27750'))   # 1.5 → 2
        self._fill(self.block_a, [1], value=Decimal('27749'))   # 1.4999 → 1
        self.assertEqual(needed_trucks_by_day(YEAR, WEEK), {(1,): 2, (2,): 1})

    def test_allocation_counts_skip_zero_and_sunday(self):
        from apps.export.services.truck_allocation_tasks import allocation_counts

        self._trucks(1, 2)
        self._trucks(2, 0)
        self._trucks(7, 3)                     # Sunday — not a plan day
        self._trucks(1, 1, dest=self.dest_kz)
        self.assertEqual(
            allocation_counts(YEAR, WEEK),
            {(1, self.dest_ru.id): 2, (1, self.dest_kz.id): 1},
        )
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `./venv/Scripts/python.exe manage.py test apps.export.tests_truck_allocation_tasks --noinput`
Expected: the 4 new tests FAIL or ERROR; the older ones PASS.

- [ ] **Step 3: Implement**

In `truck_allocation_tasks.py`, add `from apps.export.services.plan_task_common import encode_counts, end_of_local_day, iso_monday`. Then replace `_week_is_allocated` and add the two readers:

```python
def needed_trucks_by_day(year: int, week: int) -> dict[tuple[int], int]:
    """(ISO weekday,) → trucks the plan needs, Mon–Sat, days needing 0 omitted.

    Uses _trucks_for_kg (half-up at 18,500 kg), the same rounding the table
    and the allocation task use, so "needed" always matches the screen.
    """
    from apps.greenhouse.models import HarvestDayEntry

    monday, saturday = _mon_sat(year, week)
    planned_kg = (
        HarvestDayEntry.objects
        .filter(entry_date__range=(monday, saturday), plan_value__isnull=False)
        .order_by()
        .values('entry_date')
        .annotate(kg=Sum('plan_value'))
        .values_list('entry_date', 'kg')
    )
    needed: dict[tuple[int], int] = {}
    for day, kg in planned_kg:
        trucks = _trucks_for_kg(kg)
        if trucks >= 1:
            needed[(day.isoweekday(),)] = trucks
    return needed


def allocation_counts(year: int, week: int) -> dict[tuple[int, int], int]:
    """(ISO weekday, destination id) → trucks allocated, Mon–Sat, count > 0 only."""
    from apps.export.models import TruckDestinationSplit

    rows = (
        TruckDestinationSplit.objects
        .filter(
            truck_allocation__year=year,
            truck_allocation__week_number=week,
            truck_allocation__day_of_week__lte=PLAN_DAYS,
            truck_count__gt=0,
        )
        .order_by()
        .values_list('truck_allocation__day_of_week', 'destination_id', 'truck_count')
    )
    return {(dow, dest): n for dow, dest, n in rows}


def _week_is_allocated(year: int, week: int) -> bool:
    trucks_by_day: dict[int, int] = {}
    for (dow, _dest), n in allocation_counts(year, week).items():
        trucks_by_day[dow] = trucks_by_day.get(dow, 0) + n
    if not trucks_by_day:
        return False
    return all(trucks_by_day.get(dow, 0) > 0 for (dow,) in needed_trucks_by_day(year, week))
```

In `generate_truck_allocation_task`, add to `Task.objects.create(...)`:

```python
        # docs/Tasks.md item 2: due Saturday (red from Sunday).
        deadline=end_of_local_day(iso_monday(year, week) - timedelta(days=2)),
        # Review baseline (spec §3) — refreshed by every set_splits and review «Tanyşdym».
        ack_snapshot=encode_counts(needed_trucks_by_day(year, week)),
```

Update the module docstring: mention the Saturday deadline, and that `needed_trucks_by_day` and `allocation_counts` are shared with `plan_ack_tasks.py`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `./venv/Scripts/python.exe manage.py test apps.export.tests_truck_allocation_tasks --noinput`
Expected: all PASS (old and new).

- [ ] **Step 5: Commit (only if commits are approved)**

```bash
git status && git diff --cached
git add backend/apps/export/services/truck_allocation_tasks.py backend/apps/export/tests_truck_allocation_tasks.py
git commit -m "feat(p3): truck allocation task due Saturday, stores the plan baseline"
```

---

### Task 4: Allocation review (`alloc_review`) — sync, «Tanyşdym» endpoint, set_splits hook, banner data

**Files:**
- Create: `backend/apps/export/services/plan_ack_tasks.py`
- Modify:
  - `backend/apps/export/views.py`: `TaskViewSet`, a new `acknowledge` action, and a guard in `complete`.
  - `backend/apps/export/views_planning.py`: `set_splits` hook, the new `review` action and the `_year_week` helper.
  - `backend/apps/export/tasks.py`: new `sync_plan_ack_tasks` shared_task.
  - `backend/config/settings.py`: beat entry `plan-ack-sync`.
- Test: `backend/apps/export/tests_plan_ack_tasks.py`

**Interfaces:**
- Consumes: `needed_trucks_by_day`, `allocation_counts` and `resolve_truck_allocation_tasks` (Task 3); `encode_counts`, `decode_counts`, `iso_monday`, `local_today` and `next_iso_week` (Task 2).
- Produces in `plan_ack_tasks`:
  - `ACK_KINDS`, `OPEN_STATES`
  - `set_allocation_baseline(year, week) -> None`
  - `review_changes(year, week) -> list[dict]`, items `{'day_of_week': int, 'was': int, 'now': int}`
  - `sync_alloc_review(year, week, today) -> Task | None`
  - `acknowledge(task, user) -> Task`
  - `on_allocation_saved(year, week) -> None`
  - `sync_plan_ack_tasks(today: date | None = None) -> list[Task]`
  - `_create_ack_task(...)`, `_allocation_task(...)` and `_week_over(...)` (Task 5 reuses them)
- Produces, HTTP:
  - `POST /api/v1/export/tasks/{id}/acknowledge/` → TaskDetail JSON.
  - `GET /api/v1/export/truck-allocations/review/?year=&week=` → `{"year": int, "week": int, "open_task_id": int|null, "changes": [{"day_of_week": int, "was": int, "now": int}]}`.

- [ ] **Step 1: Write the failing tests**

`tests_plan_ack_tasks.py`. It reuses the plan/split fixture shape of `tests_truck_allocation_tasks.py`.

```python
"""alloc_review + transport_plan acknowledgement tasks (docs/Tasks.md items 2b, 3)."""
import datetime
from decimal import Decimal

from django.db import IntegrityError
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import GreenhouseBlock, GreenhouseConfig, Season, TruckDestination, User
from apps.export.models import Task, TaskKind, TaskState, TruckDestinationSplit, WeeklyTruckAllocation
from apps.export.services.plan_ack_tasks import (
    acknowledge, on_allocation_saved, review_changes, sync_alloc_review, sync_plan_ack_tasks,
)
from apps.export.services.truck_allocation_tasks import generate_truck_allocation_task
from apps.greenhouse.models import HarvestDayEntry, WeeklyHarvestPlan

YEAR, WEEK = 2026, 40                       # Mon 2026-09-28 .. Sat 2026-10-03
MONDAY = datetime.date(2026, 9, 28)
SAT_BEFORE = datetime.date(2026, 9, 26)     # task day
IN_WEEK = datetime.date(2026, 9, 30)
AFTER_WEEK = datetime.date(2026, 10, 4)     # Sunday after — reviews stop


def _user(username, role):
    u = User(username=username, role=role)
    u.set_password('pw')
    u.save()
    return u


class _Fixture(TestCase):
    @classmethod
    def setUpTestData(cls):
        GreenhouseConfig.get_solo()
        Season.objects.update(is_active=False)
        cls.season = Season.objects.create(
            name='pat', start_date='2026-08-01', end_date='2027-06-30', is_active=True,
        )
        cls.block = GreenhouseBlock.objects.create(code='PAT-A', name='A', is_active=True)
        cls.dest = TruckDestination.objects.create(name='PAT Russia', sort_order=1)
        cls.em = _user('pat_em', 'export_manager')
        cls.tr = _user('pat_tr', 'transport')
        cls.rep = _user('pat_rep', 'sales_rep')

    def _plan(self, offset, kg):
        plan, _ = WeeklyHarvestPlan.objects.get_or_create(
            season=self.season, block=self.block, week_number=WEEK, year=YEAR,
        )
        d = MONDAY + datetime.timedelta(days=offset)
        HarvestDayEntry.objects.update_or_create(
            weekly_plan=plan, entry_date=d,
            defaults={'season': self.season, 'block': self.block,
                      'weekday': d.weekday(), 'plan_value': Decimal(kg)},
        )

    def _split(self, dow, count):
        alloc, _ = WeeklyTruckAllocation.objects.get_or_create(
            season=self.season, week_number=WEEK, year=YEAR, day_of_week=dow,
        )
        TruckDestinationSplit.objects.update_or_create(
            truck_allocation=alloc, destination=self.dest, defaults={'truck_count': count},
        )

    def setUp(self):
        # Role permission lookups are cached per role (60 s); a row written by an
        # earlier test in the same process must not leak in.
        from django.core.cache import cache

        cache.clear()
        from apps.core.models import RoleResourcePermission

        RoleResourcePermission.objects.update_or_create(
            role='export_manager', resource_code='truck_allocation',
            defaults={'can_view': True, 'can_create': True, 'can_edit': True, 'can_delete': False},
        )

    def _allocated_week(self):
        """Mon plan 20 t (1 truck), allocation task generated + 1 truck on Mon → DONE.
        The clock is pinned to SAT_BEFORE so the suite does not rot after the week."""
        self._plan(0, '20000')
        generate_truck_allocation_task(YEAR, WEEK)
        self._split(1, 1)
        on_allocation_saved(YEAR, WEEK, today=SAT_BEFORE)
        alloc = Task.objects.get(kind=TaskKind.TRUCK_ALLOCATION)
        self.assertEqual(alloc.state, TaskState.DONE)
        return alloc

    def _reviews(self):
        return Task.objects.filter(kind=TaskKind.ALLOC_REVIEW, scope_year=YEAR, scope_week=WEEK)


class AllocReviewTests(_Fixture):
    def test_no_review_while_truck_count_unchanged(self):
        self._allocated_week()
        self._plan(0, '21000')                    # still 1 truck
        self.assertIsNone(sync_alloc_review(YEAR, WEEK, IN_WEEK))

    def test_review_when_a_day_needs_more_trucks(self):
        self._allocated_week()
        self._plan(0, '40000')                    # 1 → 2 trucks
        task = sync_alloc_review(YEAR, WEEK, IN_WEEK)
        self.assertEqual(task.assignee_role, 'export_manager')
        self.assertEqual(task.title_key, 'tasks.review_truck_allocation')
        self.assertEqual(task.link, f'/export/plan?week={WEEK}&year={YEAR}')
        self.assertEqual(review_changes(YEAR, WEEK), [{'day_of_week': 1, 'was': 1, 'now': 2}])
        # Second sync: still one open review.
        self.assertIsNone(sync_alloc_review(YEAR, WEEK, IN_WEEK))
        self.assertEqual(self._reviews().count(), 1)

    def test_decrease_to_zero_also_raises_a_review(self):
        self._allocated_week()
        self._plan(0, '0')
        self.assertIsNotNone(sync_alloc_review(YEAR, WEEK, IN_WEEK))

    def test_no_review_before_allocation_done_or_after_the_week(self):
        self._plan(0, '20000')
        generate_truck_allocation_task(YEAR, WEEK)            # OPEN
        self._plan(0, '40000')
        self.assertIsNone(sync_alloc_review(YEAR, WEEK, IN_WEEK))
        self._split(1, 2)
        on_allocation_saved(YEAR, WEEK, today=SAT_BEFORE)     # DONE, baseline = 2
        self._plan(0, '60000')
        self.assertIsNone(sync_alloc_review(YEAR, WEEK, AFTER_WEEK))

    def test_set_splits_refreshes_the_baseline(self):
        self._allocated_week()
        self._plan(0, '40000')
        self._split(1, 2)
        on_allocation_saved(YEAR, WEEK, today=IN_WEEK)   # manager saw the new plan while saving
        self.assertIsNone(sync_alloc_review(YEAR, WEEK, IN_WEEK))

    def test_empty_legacy_baseline_is_adopted_not_reviewed(self):
        alloc = self._allocated_week()
        Task.objects.filter(pk=alloc.pk).update(ack_snapshot='')
        self._plan(0, '40000')
        self.assertIsNone(sync_alloc_review(YEAR, WEEK, IN_WEEK))
        self.assertEqual(Task.objects.get(pk=alloc.pk).ack_snapshot, '1:2')

    def test_acknowledge_closes_and_moves_the_baseline(self):
        self._allocated_week()
        self._plan(0, '40000')
        task = sync_alloc_review(YEAR, WEEK, IN_WEEK)
        acknowledge(task, self.em)
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.DONE)
        self.assertEqual(task.completed_by, self.em)
        self.assertEqual(task.ack_snapshot, '1:2')
        self.assertEqual(Task.objects.get(kind=TaskKind.TRUCK_ALLOCATION).ack_snapshot, '1:2')
        self.assertIsNone(sync_alloc_review(YEAR, WEEK, IN_WEEK))

    def test_lost_race_does_not_duplicate(self):
        from apps.export.services.plan_ack_tasks import _create_ack_task

        self._allocated_week()
        _create_ack_task(TaskKind.ALLOC_REVIEW, YEAR, WEEK, 'export_manager', 't', '/x', None)
        self.assertIsNone(
            _create_ack_task(TaskKind.ALLOC_REVIEW, YEAR, WEEK, 'export_manager', 't', '/x', None),
        )
        self.assertEqual(self._reviews().count(), 1)

    def test_beat_entry_names_a_registered_task(self):
        from django.conf import settings

        from config.celery import app

        app.loader.import_default_modules()
        self.assertIn(settings.CELERY_BEAT_SCHEDULE['plan-ack-sync']['task'], app.tasks)


class AcknowledgeApiTests(_Fixture):
    def _review(self):
        self._allocated_week()
        self._plan(0, '40000')
        return sync_alloc_review(YEAR, WEEK, IN_WEEK)

    def _post(self, user, task_id):
        client = APIClient()
        client.force_authenticate(user)
        return client.post(f'/api/v1/export/tasks/{task_id}/acknowledge/')

    def test_export_manager_acknowledges_and_double_click_is_harmless(self):
        task = self._review()
        first = self._post(self.em, task.id)
        self.assertEqual(first.status_code, 200, first.content)
        self.assertEqual(first.data['state'], 'done')
        second = self._post(self.em, task.id)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(Task.objects.get(pk=task.pk).completed_by, self.em)

    def test_wrong_role_is_forbidden(self):
        task = self._review()
        self.assertEqual(self._post(self.rep, task.id).status_code, 403)

    def test_other_kinds_are_refused_and_complete_refuses_ack_kinds(self):
        alloc = self._allocated_week()
        self.assertEqual(self._post(self.em, alloc.id).status_code, 400)
        self._plan(0, '40000')
        review = sync_alloc_review(YEAR, WEEK, IN_WEEK)
        client = APIClient()
        client.force_authenticate(self.em)
        resp = client.post(f'/api/v1/export/tasks/{review.id}/complete/')
        self.assertEqual(resp.status_code, 400)

    def test_review_endpoint(self):
        task = self._review()
        client = APIClient()
        client.force_authenticate(self.em)
        resp = client.get(f'/api/v1/export/truck-allocations/review/?year={YEAR}&week={WEEK}')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data, {
            'year': YEAR, 'week': WEEK, 'open_task_id': task.id,
            'changes': [{'day_of_week': 1, 'was': 1, 'now': 2}],
        })
        bad = client.get('/api/v1/export/truck-allocations/review/?year=2026')
        self.assertEqual(bad.status_code, 400)
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `./venv/Scripts/python.exe manage.py test apps.export.tests_plan_ack_tasks --noinput`
Expected: ImportError on `plan_ack_tasks`.

- [ ] **Step 3: Implement `services/plan_ack_tasks.py`**

```python
"""Acknowledgement («Tanyşdym») planning tasks — docs/Tasks.md items 2b and 3.

alloc_review    export_manager   The greenhouse plan changed how many trucks a day
                                 needs, after the week's truck allocation was done.
transport_plan  transport        The week's allocation is ready (first time), or it
                                 changed since transport last acknowledged it.

Both close ONLY through acknowledge() — the «Tanyşdym» button on the page that
shows the data — which records what was seen in Task.ack_snapshot.

Baselines are written at synchronous points only (task creation, set_splits,
acknowledge), never from the lazy /me/tasks/ read: a plan edit landing between an
allocation save and the next read would otherwise be swallowed into the baseline
and never raise a review. Tasks are CREATED only here (beat + set_splits), never
on a GET; the export_task_one_open_ack_per_week constraint makes a lost race a
no-op.

Spec: docs/superpowers/specs/2026-09-29-planning-tasks-design.md §3.
"""
import logging
from datetime import date, datetime, timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.export.models import Task, TaskCompletionRule, TaskKind, TaskState
from apps.export.services.plan_task_common import (
    decode_counts, encode_counts, iso_monday, local_today, next_iso_week,
)
from apps.export.services.truck_allocation_tasks import (
    allocation_counts, needed_trucks_by_day, resolve_truck_allocation_tasks,
)

logger = logging.getLogger(__name__)

ACK_KINDS = (TaskKind.ALLOC_REVIEW, TaskKind.TRANSPORT_PLAN)
OPEN_STATES = (TaskState.OPEN, TaskState.IN_PROGRESS)

REVIEW_ROLE = 'export_manager'
REVIEW_TITLE = 'tasks.review_truck_allocation'


def _week_over(year: int, week: int, today: date) -> bool:
    """Reviews stop after the week's Saturday (spec A-4)."""
    return today > iso_monday(year, week) + timedelta(days=5)


def _allocation_task(year: int, week: int) -> Task | None:
    return (
        Task.objects
        .filter(kind=TaskKind.TRUCK_ALLOCATION, scope_year=year, scope_week=week)
        .order_by('id')
        .first()
    )


def _create_ack_task(kind, year, week, role, title_key, link, deadline: datetime | None) -> Task | None:
    try:
        with transaction.atomic():
            task = Task.objects.create(
                shipment=None, kind=kind, step=kind, rule=None, title_key=title_key,
                assignee_role=role, assignee_user=None,
                completion_rule=TaskCompletionRule.MANUAL_DONE,
                link=link, scope_year=year, scope_week=week,
                deadline=deadline, state=TaskState.OPEN,
            )
    except IntegrityError:
        # A concurrent sync created the open task first.
        return None
    logger.info('Opened %s task for W%d/%d', kind, week, year)
    return task


def set_allocation_baseline(year: int, week: int) -> None:
    """Record what the plan needs now as the alloc_review baseline."""
    Task.objects.filter(
        kind=TaskKind.TRUCK_ALLOCATION, scope_year=year, scope_week=week,
    ).update(ack_snapshot=encode_counts(needed_trucks_by_day(year, week)))


def review_changes(year: int, week: int) -> list[dict]:
    """Days whose needed-truck count differs from the baseline."""
    alloc = _allocation_task(year, week)
    if alloc is None or not alloc.ack_snapshot:
        return []
    was = decode_counts(alloc.ack_snapshot)
    now = needed_trucks_by_day(year, week)
    days = sorted({key[0] for key in was} | {key[0] for key in now})
    return [
        {'day_of_week': d, 'was': was.get((d,), 0), 'now': now.get((d,), 0)}
        for d in days
        if was.get((d,), 0) != now.get((d,), 0)
    ]


def sync_alloc_review(year: int, week: int, today: date) -> Task | None:
    alloc = _allocation_task(year, week)
    if alloc is None or alloc.state != TaskState.DONE or _week_over(year, week, today):
        return None
    if not alloc.ack_snapshot:
        # A task from before this feature: adopt today's plan as the baseline
        # instead of raising a review for a change nobody can see.
        set_allocation_baseline(year, week)
        return None
    if Task.objects.filter(
        kind=TaskKind.ALLOC_REVIEW, scope_year=year, scope_week=week, state__in=OPEN_STATES,
    ).exists():
        return None
    if not review_changes(year, week):
        return None
    return _create_ack_task(
        TaskKind.ALLOC_REVIEW, year, week, REVIEW_ROLE, REVIEW_TITLE,
        f'/export/plan?week={week}&year={year}', deadline=None,
    )


def acknowledge(task: Task, user) -> Task:
    """«Tanyşdym»: store what the user saw, then close. Caller holds the row lock."""
    if task.kind == TaskKind.ALLOC_REVIEW:
        snapshot = encode_counts(needed_trucks_by_day(task.scope_year, task.scope_week))
        Task.objects.filter(
            kind=TaskKind.TRUCK_ALLOCATION,
            scope_year=task.scope_year, scope_week=task.scope_week,
        ).update(ack_snapshot=snapshot)
    elif task.kind == TaskKind.TRANSPORT_PLAN:
        snapshot = encode_counts(allocation_counts(task.scope_year, task.scope_week))
    else:
        raise ValueError(f'Task kind {task.kind!r} is not acknowledged.')

    now = timezone.now()
    task.ack_snapshot = snapshot
    task.state = TaskState.DONE
    task.completed_at = now
    task.started_at = task.started_at or now
    task.completed_by = user
    task.save(update_fields=['ack_snapshot', 'state', 'completed_at', 'started_at', 'completed_by'])
    return task


def on_allocation_saved(year: int, week: int, today: date | None = None) -> None:
    """set_splits hook, synchronous: refresh the review baseline, then close the
    allocation task if the week is now covered. `today` pins the clock for tests
    (Task 5 uses it for the transport sync)."""
    set_allocation_baseline(year, week)
    resolve_truck_allocation_tasks()


def sync_plan_ack_tasks(today: date | None = None) -> list[Task]:
    """Beat entry (every 30 min) for the current and the next ISO week."""
    today = today or local_today()
    resolve_truck_allocation_tasks()
    this_year, this_week, _ = today.isocalendar()
    created = []
    for year, week in ((this_year, this_week), next_iso_week(today)):
        task = sync_alloc_review(year, week, today)
        if task is not None:
            created.append(task)
    return created
```

- [ ] **Step 4: Wire up views, the celery task and beat**

`views.py` → `TaskViewSet`. In `complete()`, right after the `MANUAL_DONE` check block, add:

```python
        from apps.export.services.plan_ack_tasks import ACK_KINDS

        if task.kind in ACK_KINDS:
            return Response(
                {'error': 'Use /acknowledge/ for review tasks.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
```

Add a new action after `complete`, and add a line to the class docstring's route list: `POST /api/v1/export/tasks/{id}/acknowledge/ — «Tanyşdym» (alloc_review / transport_plan only)`.

```python
    @action(detail=True, methods=['post'])
    def acknowledge(self, request, pk=None):
        """POST /api/v1/export/tasks/{id}/acknowledge/ — «Tanyşdym».

        alloc_review / transport_plan only: stores what the user saw in
        Task.ack_snapshot and closes the task. Idempotent on a DONE task.
        """
        from apps.export.models import Task, TaskState
        from apps.export.serializers import TaskDetailSerializer
        from apps.export.services.plan_ack_tasks import ACK_KINDS, acknowledge

        task = self.get_object()
        denied = self._check_task_actor_permission(request, task, 'acknowledge')
        if denied:
            return denied
        if task.kind not in ACK_KINDS:
            return Response(
                {'error': 'Only review tasks can be acknowledged.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        with transaction.atomic():
            task = Task.objects.select_for_update().get(pk=task.pk)
            if task.state == TaskState.CANCELLED:
                return Response(
                    {'error': 'Cannot acknowledge a cancelled task.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if task.state != TaskState.DONE:
                acknowledge(task, request.user)
        return Response(TaskDetailSerializer(task).data)
```

`views_planning.py`. Add a module-level helper under the imports:

```python
def _year_week(request) -> tuple[int, int] | None:
    """?year=&week= as a valid ISO week, or None."""
    try:
        year = int(request.query_params['year'])
        week = int(request.query_params['week'])
        datetime.date.fromisocalendar(year, week, 1)
    except (KeyError, ValueError):
        return None
    return year, week
```

In `set_splits`, just before `allocation.refresh_from_db()`, add:

```python
        # Spec §3: the manager saw the current plan while saving — refresh the
        # review baseline and close the allocation task synchronously.
        from apps.export.services.plan_ack_tasks import on_allocation_saved

        on_allocation_saved(allocation.year, allocation.week_number)
```

Add a new action on `WeeklyTruckAllocationViewSet`:

```python
    @action(detail=False, methods=['get'], url_path='review')
    def review(self, request):
        """GET /api/v1/export/truck-allocations/review/?year=&week=

        The /export/plan banner: the open alloc_review task (if any) and the days
        whose needed-truck count moved since the allocation baseline.
        """
        from apps.export.models import Task, TaskKind
        from apps.export.services.plan_ack_tasks import OPEN_STATES, review_changes

        parsed = _year_week(request)
        if parsed is None:
            return Response(
                {'error': 'year and week must be a valid ISO year and week.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        year, week = parsed
        open_task = (
            Task.objects
            .filter(kind=TaskKind.ALLOC_REVIEW, scope_year=year, scope_week=week, state__in=OPEN_STATES)
            .order_by('id')
            .first()
        )
        return Response({
            'year': year,
            'week': week,
            'open_task_id': open_task.id if open_task else None,
            'changes': review_changes(year, week),
        })
```

`tasks.py`: add

```python
@shared_task
def sync_plan_ack_tasks() -> None:
    """Every 30 min: open alloc_review / transport_plan tasks the plan or allocation now needs."""
    from apps.export.services.plan_ack_tasks import sync_plan_ack_tasks as run

    run()
```

`settings.py` → `CELERY_BEAT_SCHEDULE`: add

```python
    # Plan-change reviews («Tanyşdym»): greenhouse plan edits cannot call export
    # (dependency direction), so this sweep raises alloc_review / transport_plan
    # tasks. set_splits also syncs synchronously.
    'plan-ack-sync': {
        'task': 'apps.export.tasks.sync_plan_ack_tasks',
        'schedule': 1800.0,
        'options': {'expires': 1700},
    },
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `./venv/Scripts/python.exe manage.py test apps.export.tests_plan_ack_tasks apps.export.tests_truck_allocation_tasks apps.export.tests_task_api apps.export.tests_truck_split_admin --noinput`
Expected: PASS.

- [ ] **Step 6: Commit (only if commits are approved)**

```bash
git status && git diff --cached
git add backend/apps/export/services/plan_ack_tasks.py backend/apps/export/tests_plan_ack_tasks.py backend/apps/export/tasks.py
git add -p backend/apps/export/views.py backend/apps/export/views_planning.py backend/config/settings.py
git commit -m "feat(p3): Tanyşdym review when a plan change moves the truck count"
```

---

### Task 5: Transport task (`transport_plan`) — sync and page data endpoint

**Files:**
- Modify: `backend/apps/export/services/plan_ack_tasks.py`
- Modify: `backend/apps/export/views_planning.py`: the `transport_plan` action.
- Test: `backend/apps/export/tests_plan_ack_tasks.py` (append)

**Interfaces:**
- Consumes: from Task 4, `_allocation_task`, `_create_ack_task`, `_week_over`, `OPEN_STATES` and `acknowledge`; from Task 3, `allocation_counts`; from Task 2, `end_of_local_day`.
- Produces:
  - `sync_transport_plan(year, week, today) -> Task | None`
  - `build_transport_plan(year, week) -> dict`
  - `on_allocation_saved` and `sync_plan_ack_tasks` now also sync transport.
- Produces, HTTP: `GET /api/v1/export/truck-allocations/transport-plan/?year=&week=` returns:

```json
{
  "year": 2026, "week": 40,
  "days": [{"day_of_week": 1, "date": "2026-09-28"}],
  "destinations": [{"id": 3, "name": "Russia"}],
  "cells": [{"day_of_week": 1, "destination_id": 3, "truck_count": 2, "acknowledged_count": 1}],
  "open_task_id": 51,
  "acknowledged_at": "2026-09-26T16:05:00+05:00"
}
```

- `days` always has 6 entries, Mon–Sat.
- `cells` covers every (day, destination) that is non-zero now **or** in the last acknowledged snapshot.
- `acknowledged_count` is `null` when transport has never acknowledged this week.
- `acknowledged_at` is `null` in that case too.
- All numbers are JSON ints.

- [ ] **Step 1: Write the failing tests** (append to `tests_plan_ack_tasks.py`)

```python
class TransportPlanTests(_Fixture):
    def _transport(self):
        return Task.objects.filter(kind=TaskKind.TRANSPORT_PLAN, scope_year=YEAR, scope_week=WEEK)

    def test_first_task_opens_when_allocation_is_done(self):
        from apps.export.services.plan_ack_tasks import sync_transport_plan
        from apps.export.services.plan_task_common import end_of_local_day

        self._plan(0, '20000')
        generate_truck_allocation_task(YEAR, WEEK)
        self.assertIsNone(sync_transport_plan(YEAR, WEEK, SAT_BEFORE))       # not done yet
        self._split(1, 1)
        on_allocation_saved(YEAR, WEEK, today=SAT_BEFORE)                    # set_splits path
        task = self._transport().get()
        self.assertEqual(task.assignee_role, 'transport')
        self.assertEqual(task.title_key, 'tasks.transport_plan')
        self.assertEqual(task.link, f'/transport/plan?week={WEEK}&year={YEAR}')
        self.assertEqual(task.deadline, end_of_local_day(SAT_BEFORE))

    def test_no_new_task_after_the_week_ends(self):
        from apps.export.services.plan_ack_tasks import sync_transport_plan

        self._allocated_week()
        acknowledge(self._transport().get(), self.tr)
        self._split(2, 3)
        self.assertIsNone(sync_transport_plan(YEAR, WEEK, AFTER_WEEK))

    def test_change_after_acknowledge_opens_a_changed_task(self):
        from apps.export.services.plan_ack_tasks import sync_transport_plan

        self._allocated_week()
        first = self._transport().get()
        acknowledge(first, self.tr)
        self.assertIsNone(sync_transport_plan(YEAR, WEEK, IN_WEEK))          # nothing changed
        self._split(2, 3)
        second = sync_transport_plan(YEAR, WEEK, IN_WEEK)
        self.assertEqual(second.title_key, 'tasks.transport_plan_changed')
        self.assertIsNone(sync_transport_plan(YEAR, WEEK, IN_WEEK))          # one open at a time

    def test_cancelled_first_task_is_not_recreated(self):
        from apps.export.services.plan_ack_tasks import sync_transport_plan

        self._allocated_week()
        self._transport().update(state=TaskState.CANCELLED)
        self.assertIsNone(sync_transport_plan(YEAR, WEEK, IN_WEEK))

    def test_beat_sweep_covers_current_and_next_week(self):
        self._plan(0, '20000')
        generate_truck_allocation_task(YEAR, WEEK)
        self._split(1, 1)                       # allocated, but set_splits hook not run
        created = sync_plan_ack_tasks(SAT_BEFORE)
        self.assertEqual([t.kind for t in created], [TaskKind.TRANSPORT_PLAN])

    def test_endpoint_shows_changes_since_acknowledge(self):
        from apps.core.models import RoleResourcePermission

        RoleResourcePermission.objects.update_or_create(
            role='transport', resource_code='truck_allocation',
            defaults={'can_view': True, 'can_create': False, 'can_edit': False, 'can_delete': False},
        )
        self._allocated_week()
        acknowledge(self._transport().get(), self.tr)
        self._split(1, 2)
        client = APIClient()
        client.force_authenticate(self.tr)
        resp = client.get(f'/api/v1/export/truck-allocations/transport-plan/?year={YEAR}&week={WEEK}')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(len(resp.data['days']), 6)
        self.assertEqual(resp.data['days'][0], {'day_of_week': 1, 'date': '2026-09-28'})
        self.assertEqual(resp.data['destinations'], [{'id': self.dest.id, 'name': 'PAT Russia'}])
        self.assertEqual(resp.data['cells'], [
            {'day_of_week': 1, 'destination_id': self.dest.id, 'truck_count': 2, 'acknowledged_count': 1},
        ])
        self.assertIsNone(resp.data['open_task_id'])       # the sweep has not run yet
        self.assertIsNotNone(resp.data['acknowledged_at'])

    def test_transport_acknowledges_through_the_api(self):
        self._allocated_week()
        task = self._transport().get()
        client = APIClient()
        client.force_authenticate(self.tr)
        resp = client.post(f'/api/v1/export/tasks/{task.id}/acknowledge/')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(Task.objects.get(pk=task.pk).ack_snapshot, f'1:{self.dest.id}:1')
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `./venv/Scripts/python.exe manage.py test apps.export.tests_plan_ack_tasks.TransportPlanTests --noinput`
Expected: ImportError on `sync_transport_plan`, or FAIL (no transport task).

- [ ] **Step 3: Implement**

In `plan_ack_tasks.py`, add the constants under `REVIEW_TITLE`:

```python
TRANSPORT_ROLE = 'transport'
TRANSPORT_TITLE = 'tasks.transport_plan'
TRANSPORT_CHANGED_TITLE = 'tasks.transport_plan_changed'
```

Extend the `plan_task_common` import with `end_of_local_day`. Add:

```python
def sync_transport_plan(year: int, week: int, today: date) -> Task | None:
    alloc = _allocation_task(year, week)
    if alloc is None or alloc.state != TaskState.DONE or _week_over(year, week, today):
        return None
    tasks = Task.objects.filter(kind=TaskKind.TRANSPORT_PLAN, scope_year=year, scope_week=week)
    if tasks.filter(state__in=OPEN_STATES).exists():
        return None
    last_done = tasks.filter(state=TaskState.DONE).order_by('-completed_at', '-id').first()
    if last_done is None:
        if tasks.exists():
            return None          # only cancelled ones — someone stood it down on purpose
        title = TRANSPORT_TITLE
    elif decode_counts(last_done.ack_snapshot) == allocation_counts(year, week):
        return None
    else:
        title = TRANSPORT_CHANGED_TITLE
    return _create_ack_task(
        TaskKind.TRANSPORT_PLAN, year, week, TRANSPORT_ROLE, title,
        f'/transport/plan?week={week}&year={year}',
        deadline=end_of_local_day(today),          # spec A-3
    )


def build_transport_plan(year: int, week: int) -> dict:
    """Payload of GET /truck-allocations/transport-plan/ — see the api-contract skill."""
    from apps.core.models import TruckDestination

    current = allocation_counts(year, week)
    tasks = Task.objects.filter(kind=TaskKind.TRANSPORT_PLAN, scope_year=year, scope_week=week)
    last_ack = tasks.filter(state=TaskState.DONE).order_by('-completed_at', '-id').first()
    acked = decode_counts(last_ack.ack_snapshot) if last_ack else None
    open_task = tasks.filter(state__in=OPEN_STATES).order_by('id').first()

    keys = set(current) | set(acked or {})
    destinations = list(
        TruckDestination.objects
        .filter(id__in={dest for _dow, dest in keys})
        .order_by('sort_order', 'name')
        .values('id', 'name')
    )
    monday = iso_monday(year, week)
    return {
        'year': year,
        'week': week,
        'days': [
            {'day_of_week': dow, 'date': (monday + timedelta(days=dow - 1)).isoformat()}
            for dow in range(1, 7)
        ],
        'destinations': destinations,
        'cells': [
            {
                'day_of_week': dow,
                'destination_id': dest,
                'truck_count': current.get((dow, dest), 0),
                'acknowledged_count': None if acked is None else acked.get((dow, dest), 0),
            }
            for dow, dest in sorted(keys)
        ],
        'open_task_id': open_task.id if open_task else None,
        # Local offset (+05:00), per the api-contract timestamp rule.
        'acknowledged_at': timezone.localtime(last_ack.completed_at).isoformat() if last_ack else None,
    }
```

Make these changes:
- In `on_allocation_saved`, add `sync_transport_plan(year, week, today or local_today())` after `resolve_truck_allocation_tasks()`, and update its docstring ("…and open/refresh transport's task").
- In `sync_plan_ack_tasks`, loop over both syncs:

```python
    for year, week in ((this_year, this_week), next_iso_week(today)):
        for task in (sync_alloc_review(year, week, today), sync_transport_plan(year, week, today)):
            if task is not None:
                created.append(task)
```

`views_planning.py` → `WeeklyTruckAllocationViewSet`: add

```python
    @action(detail=False, methods=['get'], url_path='transport-plan')
    def transport_plan(self, request):
        """GET /api/v1/export/truck-allocations/transport-plan/?year=&week=

        The /transport/plan page: the week's allocation, what transport last
        acknowledged, and the open transport_plan task. Needs truck_allocation
        can_view (transport is granted view-only).
        """
        from apps.export.services.plan_ack_tasks import build_transport_plan

        parsed = _year_week(request)
        if parsed is None:
            return Response(
                {'error': 'year and week must be a valid ISO year and week.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        return Response(build_transport_plan(*parsed))
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `./venv/Scripts/python.exe manage.py test apps.export.tests_plan_ack_tasks --noinput`
Expected: PASS.

- [ ] **Step 5: Commit (only if commits are approved)**

```bash
git status && git diff --cached
git add backend/apps/export/services/plan_ack_tasks.py backend/apps/export/tests_plan_ack_tasks.py
git add -p backend/apps/export/views_planning.py
git commit -m "feat(p3): transport truck-planning task and page data"
```

---

### Task 6: Daily tasks (`daily_loading`, `daily_export`) — beat, resolve, «missed»

**Files:**
- Create: `backend/apps/export/services/daily_plan_tasks.py`
- Modify:
  - `backend/apps/export/services/__init__.py`: export `resolve_daily_plan_tasks`.
  - `backend/apps/core/views_me.py`: lazy resolve in `MeTaskListView.get`.
  - `backend/apps/export/tasks.py`: new `run_daily_plan_tasks` shared_task.
  - `backend/config/settings.py`: beat entry `daily-plan-tasks`.
- Test: `backend/apps/export/tests_daily_plan_tasks.py`

**Interfaces:**
- Consumes: `end_of_local_day` and `local_today` (Task 2); `get_active_season` (`apps.core.seasons`).
- Produces:
  - `generate_daily_plan_tasks(today: date) -> list[Task]`
  - `resolve_daily_plan_tasks() -> list[Task]`
  - `cancel_missed_daily_tasks(today: date) -> int`
  - `run_daily_plan_tasks(today: date | None = None) -> None`

- [ ] **Step 1: Write the failing tests**

```python
"""Daily planning tasks — docs/Tasks.md items 4 («Ýük planla») and 5a («Eksport planla»)."""
import datetime

from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import (
    Country, Customer, GreenhouseBlock, GreenhouseConfig, Season, ShipmentStatusType, User,
)
from apps.export.models import (
    Shipment, ShipmentBlockSource, Task, TaskCancelReason, TaskKind, TaskState,
)
from apps.export.services.daily_plan_tasks import (
    cancel_missed_daily_tasks, generate_daily_plan_tasks, resolve_daily_plan_tasks,
    run_daily_plan_tasks,
)
from apps.export.services.plan_task_common import end_of_local_day

MONDAY = datetime.date(2026, 9, 28)
TUESDAY = datetime.date(2026, 9, 29)
SATURDAY = datetime.date(2026, 10, 3)
SUNDAY = datetime.date(2026, 10, 4)


class DailyPlanTaskTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        GreenhouseConfig.get_solo()
        Season.objects.update(is_active=False)
        cls.season = Season.objects.create(
            name='dpt', start_date='2026-08-01', end_date='2027-06-30', is_active=True,
        )
        for code, order, phase in [('draft', 0, 'DRAFT'), ('cancelled', 99, 'CANCELLED')]:
            ShipmentStatusType.objects.get_or_create(
                code=code,
                defaults={'name_tk': code, 'name_en': code, 'name_ru': code,
                          'step_order': order, 'phase': phase},
            )
        cls.user = User.objects.create_user(username='dpt_em', password='pw', role='export_manager')
        cls.deputy = User.objects.create_user(
            username='dpt_dep', password='pw', role='loading_dept_head_deputy',
        )
        cls.block = GreenhouseBlock.objects.create(code='DPT-A', name='A', is_active=True)
        cls.country = Country.objects.create(name_tk='DPT land', code='DP')
        cls.customer = Customer.objects.create(name='DPT customer')
        cls.n = 0

    def _shipment(self, day, status='draft', **extra) -> Shipment:
        DailyPlanTaskTests.n += 1
        return Shipment.objects.create(
            shipment_code=f'DPT-{self.n}', date=day, season=self.season,
            status=ShipmentStatusType.objects.get(code=status),
            created_by=self.user, updated_by=self.user, **extra,
        )

    def _truck(self, day, **extra) -> Shipment:
        s = self._shipment(day, **extra)
        ShipmentBlockSource.objects.create(shipment=s, block=self.block, weight_kg=1000)
        return s

    def _task(self, kind, day):
        return Task.objects.get(kind=kind, scope_date=day)

    def test_generates_two_tasks_monday_to_saturday_not_sunday(self):
        created = generate_daily_plan_tasks(MONDAY)
        self.assertEqual({t.kind for t in created}, {TaskKind.DAILY_LOADING, TaskKind.DAILY_EXPORT})
        loading = self._task(TaskKind.DAILY_LOADING, MONDAY)
        self.assertEqual(loading.assignee_role, 'loading_dept_head')
        self.assertEqual(loading.link, '/export/gaplama')
        self.assertEqual(loading.title_key, 'tasks.daily_loading_plan')
        self.assertEqual(loading.deadline, end_of_local_day(MONDAY))
        export = self._task(TaskKind.DAILY_EXPORT, MONDAY)
        self.assertEqual((export.assignee_role, export.link), ('export_manager', '/export/drafts'))
        self.assertEqual(len(generate_daily_plan_tasks(SATURDAY)), 2)
        self.assertEqual(generate_daily_plan_tasks(SUNDAY), [])

    def test_rerun_does_not_duplicate(self):
        generate_daily_plan_tasks(MONDAY)
        self.assertEqual(generate_daily_plan_tasks(MONDAY), [])
        self.assertEqual(Task.objects.filter(scope_date=MONDAY).count(), 2)

    def test_no_active_season_no_tasks(self):
        Season.objects.update(is_active=False)
        self.assertEqual(generate_daily_plan_tasks(MONDAY), [])

    def test_loading_done_by_a_truck_dated_today_even_if_opened_yesterday(self):
        self._truck(MONDAY)                               # opened earlier, dated Monday
        generate_daily_plan_tasks(MONDAY)
        resolve_daily_plan_tasks()
        self.assertEqual(self._task(TaskKind.DAILY_LOADING, MONDAY).state, TaskState.DONE)
        self.assertEqual(self._task(TaskKind.DAILY_EXPORT, MONDAY).state, TaskState.OPEN)

    def test_export_done_needs_country_and_customer(self):
        generate_daily_plan_tasks(MONDAY)
        self._shipment(MONDAY, country=self.country)      # no customer yet
        resolve_daily_plan_tasks()
        self.assertEqual(self._task(TaskKind.DAILY_EXPORT, MONDAY).state, TaskState.OPEN)
        self._shipment(MONDAY, country=self.country, customer=self.customer)
        resolve_daily_plan_tasks()
        self.assertEqual(self._task(TaskKind.DAILY_EXPORT, MONDAY).state, TaskState.DONE)

    def test_deleted_cancelled_archived_or_other_day_do_not_count(self):
        generate_daily_plan_tasks(MONDAY)
        self._truck(MONDAY, deleted_at=end_of_local_day(MONDAY))
        self._truck(MONDAY, status='cancelled')
        self._truck(MONDAY, is_archived=True)
        self._truck(TUESDAY)
        resolve_daily_plan_tasks()
        self.assertEqual(self._task(TaskKind.DAILY_LOADING, MONDAY).state, TaskState.OPEN)

    def test_next_morning_leftover_is_missed(self):
        run_daily_plan_tasks(MONDAY)
        run_daily_plan_tasks(TUESDAY)
        monday = self._task(TaskKind.DAILY_EXPORT, MONDAY)
        self.assertEqual(monday.state, TaskState.CANCELLED)
        self.assertEqual(monday.cancelled_reason, TaskCancelReason.MISSED)
        self.assertEqual(self._task(TaskKind.DAILY_EXPORT, TUESDAY).state, TaskState.OPEN)
        self.assertEqual(cancel_missed_daily_tasks(TUESDAY), 0)

    def test_late_record_rescues_yesterday_before_missed(self):
        generate_daily_plan_tasks(MONDAY)
        self._truck(MONDAY)                               # added late Monday night
        run_daily_plan_tasks(TUESDAY)
        self.assertEqual(self._task(TaskKind.DAILY_LOADING, MONDAY).state, TaskState.DONE)

    def test_saturday_leftover_is_missed_on_sunday(self):
        run_daily_plan_tasks(SATURDAY)
        run_daily_plan_tasks(SUNDAY)
        self.assertEqual(self._task(TaskKind.DAILY_LOADING, SATURDAY).state, TaskState.CANCELLED)
        self.assertFalse(Task.objects.filter(scope_date=SUNDAY).exists())

    def test_deputy_sees_the_loading_task_and_me_tasks_resolves_it(self):
        generate_daily_plan_tasks(MONDAY)
        self._truck(MONDAY)
        client = APIClient()
        client.force_authenticate(self.deputy)
        resp = client.get('/api/v1/me/tasks/')
        self.assertEqual(resp.status_code, 200, resp.content)
        rows = resp.data['results'] if isinstance(resp.data, dict) else resp.data
        loading = self._task(TaskKind.DAILY_LOADING, MONDAY)
        self.assertEqual(loading.state, TaskState.DONE)
        self.assertIn(loading.id, [r['id'] for r in rows])

    def test_beat_entry_names_a_registered_task(self):
        from django.conf import settings

        from config.celery import app

        app.loader.import_default_modules()
        self.assertIn(settings.CELERY_BEAT_SCHEDULE['daily-plan-tasks']['task'], app.tasks)
```

If `Customer` needs more required fields, or `Country` needs `name_*`, copy the minimal creates from `tests_packing_part_tasks.py` or an existing Country fixture. Do not add fields the model does not require.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `./venv/Scripts/python.exe manage.py test apps.export.tests_daily_plan_tasks --noinput`
Expected: ImportError on `daily_plan_tasks`.

- [ ] **Step 3: Implement `services/daily_plan_tasks.py`**

```python
"""Daily planning tasks — docs/Tasks.md items 4 and 5a.

daily_loading  loading_dept_head (+ deputy via TASK_ROLE_EQUIVALENTS)
               «Şu güne ýük, maşyn planla» → /export/gaplama. Done when a live
               Gaplama truck (a shipment with block_sources) is dated today.
daily_export   export_manager
               «Eksport planla» → /export/drafts. Done when a live shipment with
               a country AND a customer is dated today.

"Dated today" (owner, 2026-09-29): a truck opened yesterday FOR today counts.
Mon–Sat only. Red after 23:59 local (Task.deadline). The 06:00 beat first
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
```

`services/__init__.py`: add `from .daily_plan_tasks import resolve_daily_plan_tasks` next to the other plan-task imports, and add `'resolve_daily_plan_tasks'` to `__all__`.

`core/views_me.py` → `MeTaskListView.get`: extend the lazy import and call it after `resolve_truck_allocation_tasks()`:

```python
        from apps.export.services import (
            resolve_all_open_weekly_plan_tasks,
            resolve_daily_plan_tasks,
            resolve_local_sell_plan_tasks,
            resolve_truck_allocation_tasks,
        )
        ...
        resolve_truck_allocation_tasks()
        # Daily loading/export tasks: resolve only — creation belongs to the
        # 06:05 beat (a GET that creates would race on every badge poll).
        resolve_daily_plan_tasks()
```

`tasks.py`:

```python
@shared_task
def run_daily_plan_tasks() -> None:
    """Daily 06:05: close done daily tasks, mark yesterday's leftovers missed, open today's."""
    from apps.export.services.daily_plan_tasks import run_daily_plan_tasks as run

    run()
```

`settings.py` → `CELERY_BEAT_SCHEDULE`:

```python
    # «Ýük planla» / «Eksport planla» (docs/Tasks.md items 4, 5a). Runs every day
    # so Saturday's leftovers become `missed` on Sunday; creates Mon–Sat only.
    # 06:05, after weekly-plan-setup.
    'daily-plan-tasks': {
        'task': 'apps.export.tasks.run_daily_plan_tasks',
        'schedule': crontab(hour=6, minute=5),
        'options': {'expires': 3600},
    },
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `./venv/Scripts/python.exe manage.py test apps.export.tests_daily_plan_tasks apps.export.tests_truck_allocation_tasks apps.core.tests_team_kpi --noinput`
Expected: PASS. `tests_team_kpi` checks that the new cancelled/overdue rows did not break the KPI.

- [ ] **Step 5: Commit (only if commits are approved)**

```bash
git status && git diff --cached
git add backend/apps/export/services/daily_plan_tasks.py backend/apps/export/tests_daily_plan_tasks.py
git add -p backend/apps/export/services/__init__.py backend/apps/core/views_me.py backend/apps/export/tasks.py backend/config/settings.py
git commit -m "feat(p3): daily Ýük planla / Eksport planla tasks, missed next morning"
```

---

### Task 7: Permissions — `transport.plan` page and transport view on `truck_allocation`

**Files:**
- Modify: `backend/apps/core/permission_registry.py`: `PAGE_REGISTRY`, after `('transport.fleet', …)`.
- Modify: `backend/apps/core/management/commands/seed_permissions.py`: `PAGE_DEFAULTS['transport']` and `RESOURCE_DEFAULTS['transport']`.
- Create: `backend/apps/core/migrations/00NN_transport_plan_page.py`. NN is the next free number; depend on the current core leaf.
- Test: `backend/apps/core/tests_transport_plan_perms.py`

**Interfaces:**
- Produces:
  - Page code `transport.plan`: visible for admin, boss, director, export_manager, document_team and transport; hidden rows for every other role.
  - `truck_allocation.can_view` for transport.
  - `seed_transport_plan(RolePagePermission, RoleResourcePermission) -> int`, a testable seeder.

- [ ] **Step 1: Write the failing test**

```python
"""transport.plan page + transport's view grant on truck_allocation (planning tasks, 2026-09-29)."""
import importlib

from django.apps import apps as django_apps
from django.test import TestCase

from apps.core.models import RolePagePermission, RoleResourcePermission
from apps.core.permission_registry import PAGE_REGISTRY

migration = importlib.import_module('apps.core.migrations.00NN_transport_plan_page')


class TransportPlanPermsTests(TestCase):
    def test_page_is_registered(self):
        self.assertIn('transport.plan', PAGE_REGISTRY)

    def test_seed_writes_every_role_and_the_view_grant(self):
        RoleResourcePermission.objects.update_or_create(
            role='transport', resource_code='truck_allocation',
            defaults={'can_view': False, 'can_create': False, 'can_edit': False, 'can_delete': False},
        )
        migration.seed_transport_plan(
            django_apps.get_model('core', 'RolePagePermission'),
            django_apps.get_model('core', 'RoleResourcePermission'),
        )
        rows = dict(RolePagePermission.objects.filter(page_code='transport.plan')
                    .values_list('role', 'is_visible'))
        self.assertEqual(set(rows), set(migration.ALL_ROLES))
        self.assertTrue(rows['transport'])
        self.assertTrue(rows['boss'])
        self.assertFalse(rows['sales_rep'])
        grant = RoleResourcePermission.objects.get(role='transport', resource_code='truck_allocation')
        self.assertEqual((grant.can_view, grant.can_edit), (True, False))

    def test_seed_does_not_stomp_an_admin_toggle(self):
        RolePagePermission.objects.create(role='transport', page_code='transport.plan', is_visible=False)
        migration.seed_transport_plan(
            django_apps.get_model('core', 'RolePagePermission'),
            django_apps.get_model('core', 'RoleResourcePermission'),
        )
        self.assertFalse(RolePagePermission.objects.get(role='transport', page_code='transport.plan').is_visible)
```

Replace `00NN` with the real number in both places.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `./venv/Scripts/python.exe manage.py test apps.core.tests_transport_plan_perms --noinput`
Expected: ModuleNotFoundError.

- [ ] **Step 3: Implement**

`permission_registry.py`, after the `transport.fleet` line:

```python
    ('transport.plan',          'Transport Truck Planning (weekly allocation, «Tanyşdym»)'),
```

`seed_permissions.py`:
- Add `'transport.plan'` to the `'transport': {...}` set in `PAGE_DEFAULTS`. admin, director, export_manager and boss get it through `_ALL_PAGES`; document_team copies export_manager's set.
- In `RESOURCE_DEFAULTS['transport']`, add `'truck_allocation': _VIEW,  # /transport/plan reads the week's allocation`.

Migration file. Check `ls backend/apps/core/migrations | tail -3` for the number and leaf first:

```python
"""Register /transport/plan (planning tasks, 2026-09-29) and let transport read the
truck allocation behind it.

seed_permissions only get_or_creates on a fresh DB and production runs `migrate`
only, so a registered page code with no rows is hidden from EVERY role (fail
closed — see core/0039). Every role gets a row; /admin/permissions Save deletes
and recreates page rows, so a partial matrix silently loses access (core/0054).

get_or_create for pages — a re-run must not stomp an admin's toggle. The
truck_allocation grant only ever turns can_view ON; other flags are untouched.
"""
from django.db import migrations

# Snapshot of ROLE_CHOICES at write time — a later role is seeded by seed_permissions.
ALL_ROLES = (
    'admin', 'export_manager', 'loading_dept_head', 'loading_dept_head_deputy',
    'warehouse_chief', 'weight_master', 'document_team', 'transport', 'sales_rep',
    'finansist', 'director', 'accountant', 'greenhouse_manager', 'seller',
    'quality_inspector', 'garawul', 'boss',
)
VISIBLE_ROLES = frozenset({'admin', 'boss', 'director', 'export_manager', 'document_team', 'transport'})
PAGE_CODE = 'transport.plan'


def seed_transport_plan(RolePagePermission, RoleResourcePermission) -> int:
    created = 0
    for role in ALL_ROLES:
        _, was_created = RolePagePermission.objects.get_or_create(
            role=role, page_code=PAGE_CODE, defaults={'is_visible': role in VISIBLE_ROLES},
        )
        created += int(was_created)
    grant, _ = RoleResourcePermission.objects.get_or_create(
        role='transport', resource_code='truck_allocation',
        defaults={'can_view': True, 'can_create': False, 'can_edit': False, 'can_delete': False},
    )
    if not grant.can_view:
        grant.can_view = True
        grant.save(update_fields=['can_view'])
    return created


def _wipe_perm_cache() -> None:
    try:
        from django.core.cache import cache

        from apps.core.views_permissions import PERM_CACHE_PREFIX
        cache.delete_many(
            [f'{PERM_CACHE_PREFIX}:pages:{r}' for r in ALL_ROLES]
            + [f'{PERM_CACHE_PREFIX}:resources:transport']
        )
    except Exception:
        pass


def apply(apps, schema_editor):
    # Gated on the connection, not an env var — see core/0033 and core/0039.
    if schema_editor.connection.settings_dict['NAME'].startswith('test_'):
        return
    seed_transport_plan(
        apps.get_model('core', 'RolePagePermission'),
        apps.get_model('core', 'RoleResourcePermission'),
    )
    _wipe_perm_cache()


def unapply(apps, schema_editor):
    apps.get_model('core', 'RolePagePermission').objects.filter(page_code=PAGE_CODE).delete()
    _wipe_perm_cache()


class Migration(migrations.Migration):
    dependencies = [
        ('core', '<current leaf>'),
    ]
    operations = [migrations.RunPython(apply, reverse_code=unapply)]
```

Before relying on the resource cache key, check its real format: `grep -n "PERM_CACHE_PREFIX" backend/apps/core/views_permissions.py`. Use the real one; if resources are not cached separately, drop that list entry.

Apply the migration: `./venv/Scripts/python.exe manage.py migrate core` then `showmigrations core | tail -3`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `./venv/Scripts/python.exe manage.py test apps.core.tests_transport_plan_perms apps.core.tests_boss_access apps.core.tests_permissions --noinput`. If a label does not exist, drop it; `ls backend/apps/core/tests_*perm*` shows the real names.
Expected: PASS.

- [ ] **Step 5: Commit (only if commits are approved)**

```bash
git status && git diff --cached
git add backend/apps/core/migrations/00NN_transport_plan_page.py backend/apps/core/tests_transport_plan_perms.py
git add -p backend/apps/core/permission_registry.py backend/apps/core/management/commands/seed_permissions.py
git commit -m "feat(core): transport.plan page and transport read access to truck allocation"
```

---

### Task 8: Frontend — task types, plan card deadline / red / missed, SelfBoard kinds

**Files:**
- Modify: `frontend/src/types/index.ts`: `TaskKind`, `TaskCompletionRule` (add the missing `'field_equals'`), `ITaskListItem`, plus new interfaces.
- Modify: `frontend/src/components/me/PlanTaskCard.tsx`
- Modify: `frontend/src/pages/me/SelfBoard.tsx`: `isPlanTask`.
- Modify: `frontend/src/i18n/tk.json`, `ru.json`, `en.json`: the `tasks.*` keys below.
- Test: `frontend/src/components/me/PlanTaskCard.test.tsx`

**Interfaces:**
- Produces TS types:
  - `TaskKind` with the 4 new codes.
  - `ITaskListItem.scope_date: string | null`
  - `ITaskListItem.cancelled_reason: string`
  - `ITruckAllocationReview`
  - `ITransportPlan`, as in the API shapes of Tasks 4 and 5.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import type { ITaskListItem } from '@/types';
import { PlanTaskCard } from './PlanTaskCard';

function task(over: Partial<ITaskListItem>): ITaskListItem {
  return {
    id: 1, kind: 'daily_export', shipment: null, shipment_code: '', step: 'daily_export',
    phase: 'PLAN', title_key: 'tasks.daily_export_plan', assignee_role: 'export_manager',
    assignee_user: null, assignee_user_name: null, target_fields_list: [],
    completion_rule: 'manual_done', deadline: '2026-09-28T23:59:59+05:00', deadline_rule: '',
    state: 'open', is_overdue: false, created_at: '2026-09-28T06:05:00+05:00',
    started_at: null, completed_at: null, blocked_reason: '', link: '/export/drafts',
    scope_year: null, scope_week: null, scope_block: null, scope_block_code: null,
    scope_date: '2026-09-28', cancelled_reason: '',
    ...over,
  } as ITaskListItem;
}

function renderCard(t: ITaskListItem) {
  return render(<MemoryRouter><PlanTaskCard task={t} /></MemoryRouter>);
}

describe('PlanTaskCard', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });

  it('shows the due time and the day of a daily task', () => {
    renderCard(task({}));
    expect(screen.getByText(/Due: 28\.09 23:59/)).toBeInTheDocument();
    expect(screen.getByText('28.09')).toBeInTheDocument();
  });

  it('marks an overdue task red', () => {
    renderCard(task({ is_overdue: true }));
    expect(screen.getByRole('button')).toHaveStyle({ borderLeft: '3px solid #ff4d4f' });
  });

  it('labels a missed daily task', () => {
    renderCard(task({ state: 'cancelled', cancelled_reason: 'missed' }));
    expect(screen.getByText('Missed')).toBeInTheDocument();
  });

  it('tells a late weekly-plan manager they can still fill until Sunday', () => {
    renderCard(task({ kind: 'weekly_plan', title_key: 'tasks.fill_weekly_plan', is_overdue: true, scope_date: null }));
    expect(screen.getByText(/until Sunday/)).toBeInTheDocument();
  });
});
```

`toHaveStyle` with `borderLeft` depends on jsdom serialization. If it fails on formatting only, assert `getByRole('button').style.borderLeft` contains `'rgb(255, 77, 79)'` or `'#ff4d4f'`, whichever jsdom produces.

The deadline string: dayjs formats in the test runner's local timezone. If the runner's TZ is not +05, pin it for this test with `process.env.TZ = 'Asia/Ashgabat'` at the top of the file. Otherwise assert only `/Due: /` plus the date part.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd frontend && npx vitest run src/components/me/PlanTaskCard.test.tsx`
Expected: FAIL (text not found / type errors).

- [ ] **Step 3: Implement**

`types/index.ts`:

```ts
export type TaskCompletionRule = 'all_fields_filled' | 'any_field_filled' | 'field_equals' | 'manual_done';

export type TaskKind =
  | 'shipment' | 'weekly_plan' | 'local_sell_plan' | 'truck_allocation'
  | 'alloc_review' | 'transport_plan' | 'daily_loading' | 'daily_export';
```

If the garawul session already added `'gate'`, keep it.

In `ITaskListItem`, after `scope_block_code`, add:

```ts
  /** Local day (YYYY-MM-DD) a daily_loading / daily_export task covers; null otherwise. */
  scope_date: string | null;
  /** Why a cancelled task was cancelled; 'missed' = a daily task nobody did. '' otherwise. */
  cancelled_reason: string;
```

Add these interfaces right after `ITaskDetail`:

```ts
/** GET /export/truck-allocations/review/ — the /export/plan «Tanyşdym» banner. */
export interface ITruckAllocationReview {
  year: number;
  week: number;
  open_task_id: number | null;
  changes: { day_of_week: number; was: number; now: number }[];
}

/** GET /export/truck-allocations/transport-plan/ — the /transport/plan page. */
export interface ITransportPlan {
  year: number;
  week: number;
  days: { day_of_week: number; date: string }[];
  destinations: { id: number; name: string }[];
  cells: {
    day_of_week: number;
    destination_id: number;
    truck_count: number;
    /** null = transport never acknowledged this week. */
    acknowledged_count: number | null;
  }[];
  open_task_id: number | null;
  acknowledged_at: string | null;
}
```

`SelfBoard.tsx`: replace `isPlanTask`:

```ts
/** Non-shipment planning tasks rendered with the compact PlanTaskCard rather
 *  than the shipment Kanban card. */
const PLAN_TASK_KINDS: ReadonlySet<TaskKind> = new Set<TaskKind>([
  'weekly_plan', 'local_sell_plan', 'truck_allocation',
  'alloc_review', 'transport_plan', 'daily_loading', 'daily_export',
]);

function isPlanTask(task: ITaskListItem): boolean {
  return PLAN_TASK_KINDS.has(task.kind);
}
```

Import `TaskKind` from `@/types` if it is not imported already.

`PlanTaskCard.tsx`: add `import dayjs from 'dayjs';`. Inside the component, add:

```tsx
  const isMissed = task.state === 'cancelled' && task.cancelled_reason === 'missed';
  const borderColor = task.is_overdue ? COLORS.danger : isDone ? COLORS.borderLight : COLORS.primary;
  const dayLabel = task.scope_date ? dayjs(task.scope_date).format('DD.MM') : null;
```

Replace the existing `borderColor` line with the one above. In Row 2, after `weekLabel`, render `dayLabel` the same way (`<Text type="secondary" style={{ fontSize: 11 }}>{dayLabel}</Text>`).

Replace the state `<Tag>` with:

```tsx
        <Tag
          color={isMissed ? 'error' : isDone ? 'default' : 'processing'}
          style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px', margin: 0 }}
        >
          {isMissed ? t('tasks.missed') : stateLabel}
        </Tag>
```

Add Row 3, shown only while the task is not done:

```tsx
      {!isDone && task.deadline && (
        <div style={{ marginTop: 4 }}>
          <Text style={{ fontSize: 11, color: task.is_overdue ? COLORS.danger : undefined }}
                type={task.is_overdue ? undefined : 'secondary'}>
            {task.is_overdue && task.kind === 'weekly_plan'
              ? t('tasks.weekly_plan_late_until_sunday')
              : t('tasks.deadline_at', { time: dayjs(task.deadline).format('DD.MM HH:mm') })}
          </Text>
        </div>
      )}
```

Update the component docstring to list the new kinds and the red/missed behaviour.

i18n. Add to the `"tasks"` object in each file, next to `fill_truck_allocation`:

| key | tk | ru | en |
|---|---|---|---|
| `review_truck_allocation` | Hepdelik plan üýtgedi — maşyn paýlanyşyny gözden geçir | План теплиц изменился — проверьте распределение машин | Greenhouse plan changed — review the truck allocation |
| `transport_plan` | Transport maşyn planlamasy | Планирование машин (транспорт) | Transport truck planning |
| `transport_plan_changed` | Maşyn paýlanyşy üýtgedi — tanyş boluň | Распределение машин изменилось — ознакомьтесь | Truck allocation changed — review it |
| `daily_loading_plan` | Şu güne ýük, maşyn planla | Спланируйте груз и машины на сегодня | Plan today's load and trucks |
| `daily_export_plan` | Eksport planla | Спланируйте экспорт | Plan export |
| `acknowledge` | Tanyşdym | Ознакомлен | Reviewed |
| `missed` | Ýerine ýetirilmedi | Пропущена | Missed |
| `deadline_at` | Möhlet: {{time}} | Срок: {{time}} | Due: {{time}} |
| `weekly_plan_late_until_sunday` | Gijä galdy — ýekşenbä çenli doldurup bolýar | Просрочено — можно дозаполнить до воскресенья | Late — can still be filled until Sunday |

Also check that `tasks.role.transport`, `tasks.role.loading_dept_head` and `tasks.role.export_manager` exist in all three files (`grep -n '"transport"' frontend/src/i18n/tk.json` inside the `tasks.role` block). Add any that are missing. The task drawer renders `t(`tasks.role.${assignee_role}`)`.

- [ ] **Step 4: Run the test and typecheck, and confirm they pass**

Run: `cd frontend && npx vitest run src/components/me/PlanTaskCard.test.tsx src/pages/me && npx tsc --noEmit --ignoreDeprecations 5.0`
Expected: PASS, and tsc exits 0. Fix every test fixture of `ITaskListItem` that tsc flags: add `scope_date: null, cancelled_reason: ''`.

- [ ] **Step 5: Commit (only if commits are approved)**

```bash
git status && git diff --cached
git add frontend/src/components/me/PlanTaskCard.tsx frontend/src/components/me/PlanTaskCard.test.tsx
git add -p frontend/src/types/index.ts frontend/src/pages/me/SelfBoard.tsx frontend/src/i18n/tk.json frontend/src/i18n/ru.json frontend/src/i18n/en.json
git commit -m "feat(frontend): planning task cards show deadline, red when late, missed"
```

---

### Task 9: Frontend — «Tanyşdym» banner on /export/plan

**Files:**
- Create: `frontend/src/hooks/usePlanAck.ts`
- Create: `frontend/src/pages/export/TruckReviewBanner.tsx`
- Modify: `frontend/src/pages/export/WeeklyPlanGrid.tsx`. Render the banner in the grid, **not** in `TruckAllocationTable`: the Tır Takip `OnumcilikTab` also renders that table, and Tır Takip changes go in its own fork.
- Modify: i18n `plan.review_title`.
- Test: `frontend/src/pages/export/TruckReviewBanner.test.tsx`

**Interfaces:**
- Consumes: `ITruckAllocationReview` and `ITransportPlan` (Task 8); the endpoints from Tasks 4 and 5.
- Produces:
  - `useTruckAllocationReview(year?: number, week?: number)`
  - `useTransportPlan(year: number, week: number)`
  - `useAcknowledgeTask()`: a mutation taking `taskId: number`.
  - `<TruckReviewBanner year week />`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { TruckReviewBanner } from './TruckReviewBanner';

const mutate = vi.fn();
let review: unknown = null;

vi.mock('@/hooks/usePlanAck', () => ({
  useTruckAllocationReview: () => ({ data: review }),
  useAcknowledgeTask: () => ({ mutate, isPending: false }),
}));

describe('TruckReviewBanner', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });

  it('renders nothing without an open review', () => {
    review = { year: 2026, week: 40, open_task_id: null, changes: [] };
    const { container } = render(<TruckReviewBanner year={2026} week={40} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists changed days and acknowledges', async () => {
    review = { year: 2026, week: 40, open_task_id: 7, changes: [{ day_of_week: 2, was: 1, now: 2 }] };
    render(<TruckReviewBanner year={2026} week={40} />);
    expect(screen.getByText(/Tu: 1 → 2/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reviewed' }));
    expect(mutate).toHaveBeenCalledWith(7);
  });
});
```

`Tu` is the `weekday.tue` value in en.json. Check it with `grep -n '"tue"' frontend/src/i18n/en.json` and use the real value.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd frontend && npx vitest run src/pages/export/TruckReviewBanner.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`hooks/usePlanAck.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import type { ITransportPlan, ITruckAllocationReview } from '@/types';

/** The /export/plan «Tanyşdym» banner data. Not season-scoped: keyed by ISO week. */
export function useTruckAllocationReview(year?: number, week?: number) {
  return useQuery<ITruckAllocationReview>({
    enabled: year != null && week != null,
    queryKey: ['truck-allocation-review', year, week],
    queryFn: async () => {
      const { data } = await api.get(`/export/truck-allocations/review/?year=${year}&week=${week}`);
      return data;
    },
  });
}

/** The /transport/plan page data. All counts are JSON ints — no coercion needed. */
export function useTransportPlan(year: number, week: number) {
  return useQuery<ITransportPlan>({
    queryKey: ['transport-plan', year, week],
    queryFn: async () => {
      const { data } = await api.get(`/export/truck-allocations/transport-plan/?year=${year}&week=${week}`);
      return data;
    },
  });
}

/** «Tanyşdym» — POST /export/tasks/{id}/acknowledge/. */
export function useAcknowledgeTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: number) => {
      const { data } = await api.post(`/export/tasks/${taskId}/acknowledge/`);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['truck-allocation-review'] });
      qc.invalidateQueries({ queryKey: ['transport-plan'] });
      qc.invalidateQueries({ queryKey: ['my-tasks'] });
    },
  });
}
```

`pages/export/TruckReviewBanner.tsx`:

```tsx
import { Alert, Button } from 'antd';
import { useTranslation } from 'react-i18next';
import { useAcknowledgeTask, useTruckAllocationReview } from '@/hooks/usePlanAck';

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

interface ITruckReviewBannerProps {
  readonly year?: number;
  readonly week?: number;
}

/**
 * «Tanyşdym» banner for the export manager (docs/Tasks.md item 2b): the
 * greenhouse plan changed how many trucks a day needs after the allocation was
 * done. Shown only while an alloc_review task is open for the week.
 */
export function TruckReviewBanner({ year, week }: ITruckReviewBannerProps) {
  const { t } = useTranslation();
  const { data } = useTruckAllocationReview(year, week);
  const ack = useAcknowledgeTask();

  if (!data || data.open_task_id == null) return null;
  const taskId = data.open_task_id;

  const changes = data.changes
    .map((c) => `${t(`weekday.${WEEKDAY_KEYS[c.day_of_week - 1]}`)}: ${c.was} → ${c.now}`)
    .join(', ');

  return (
    <Alert
      type="warning"
      showIcon
      style={{ marginBottom: 12 }}
      message={t('plan.review_title')}
      description={changes}
      action={(
        <Button size="small" type="primary" loading={ack.isPending} onClick={() => ack.mutate(taskId)}>
          {t('tasks.acknowledge')}
        </Button>
      )}
    />
  );
}
```

`WeeklyPlanGrid.tsx`: import `TruckReviewBanner`. Render `<TruckReviewBanner year={year} week={weekNumber} />` directly above the tabs/collapse block that holds the `trucks` section, visible to anyone who can see the page. The backend decides whether a review is open; the button 403s for roles that are not task actors, which is acceptable since those roles only read.

i18n `plan.review_title`:
- tk: «Hepdelik plan üýtgedi: gerek maşyn sany üýtgedi»
- ru: «План изменился: изменилось нужное число машин»
- en: «Plan changed: trucks needed changed»

- [ ] **Step 4: Run the tests and typecheck, and confirm they pass**

Run: `cd frontend && npx vitest run src/pages/export/TruckReviewBanner.test.tsx src/pages/export && npx tsc --noEmit --ignoreDeprecations 5.0`
Expected: PASS, and tsc exits 0.

- [ ] **Step 5: Commit (only if commits are approved)**

```bash
git status && git diff --cached
git add frontend/src/hooks/usePlanAck.ts frontend/src/pages/export/TruckReviewBanner.tsx frontend/src/pages/export/TruckReviewBanner.test.tsx
git add -p frontend/src/pages/export/WeeklyPlanGrid.tsx frontend/src/i18n/tk.json frontend/src/i18n/ru.json frontend/src/i18n/en.json
git commit -m "feat(frontend): Tanyşdym banner when a plan change moves the truck count"
```

---

### Task 10: Frontend — new `/transport/plan` page, route and menu

**Files:**
- Create: `frontend/src/pages/transport/TransportPlanPage.tsx`
- Modify:
  - `frontend/src/App.tsx`: lazy import and route.
  - `frontend/src/utils/permissions.ts`: route → page-code map.
  - `frontend/src/components/AppLayout.tsx`: the title map (≈ line 201), `ITEMS` (≈ line 329), `STAFF_MENU_GROUPS` `nav.group_export` after `'/transport/map'`, and `BOSS_MENU_GROUPS` `nav.group_planning` after `'/export/plan'`. **Dirty from another session — stage your hunks only.**
  - `frontend/src/components/AppLayout.menuGroups.test.tsx`, if it pins the group lists. Also dirty.
  - i18n: `nav.transport_plan` and a `transport_plan.*` block.
- Test: `frontend/src/pages/transport/TransportPlanPage.test.tsx`

**Interfaces:**
- Consumes: `useTransportPlan` and `useAcknowledgeTask` (Task 9); `ITransportPlan` (Task 8).
- Produces: route `/transport/plan?week=&year=`, the task link target from Task 5.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import TransportPlanPage from './TransportPlanPage';

const mutate = vi.fn();
let plan: unknown;

vi.mock('@/hooks/usePlanAck', () => ({
  useTransportPlan: () => ({ data: plan, isLoading: false }),
  useAcknowledgeTask: () => ({ mutate, isPending: false }),
}));

const DAYS = [1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, date: `2026-09-${27 + d}` }));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/transport/plan?week=40&year=2026']}>
      <TransportPlanPage />
    </MemoryRouter>,
  );
}

describe('TransportPlanPage', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });

  it('shows counts, highlights a changed cell and acknowledges', async () => {
    plan = {
      year: 2026, week: 40, days: DAYS,
      destinations: [{ id: 3, name: 'Russia' }],
      cells: [
        { day_of_week: 1, destination_id: 3, truck_count: 2, acknowledged_count: 1 },
        { day_of_week: 2, destination_id: 3, truck_count: 1, acknowledged_count: 1 },
      ],
      open_task_id: 51, acknowledged_at: '2026-09-26T11:05:00+05:00',
    };
    renderPage();
    expect(screen.getByText('Russia')).toBeInTheDocument();
    const changed = screen.getByTestId('cell-1-3');
    expect(changed).toHaveTextContent('2');
    expect(changed).toHaveAttribute('data-changed', 'true');
    expect(screen.getByTestId('cell-2-3')).toHaveAttribute('data-changed', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Reviewed' }));
    expect(mutate).toHaveBeenCalledWith(51);
  });

  it('never-acknowledged week has no highlights and no button without a task', () => {
    plan = {
      year: 2026, week: 40, days: DAYS, destinations: [{ id: 3, name: 'Russia' }],
      cells: [{ day_of_week: 1, destination_id: 3, truck_count: 2, acknowledged_count: null }],
      open_task_id: null, acknowledged_at: null,
    };
    renderPage();
    expect(screen.getByTestId('cell-1-3')).toHaveAttribute('data-changed', 'false');
    expect(screen.queryByRole('button', { name: 'Reviewed' })).toBeNull();
  });

  it('empty week shows the empty state', () => {
    plan = { year: 2026, week: 40, days: DAYS, destinations: [], cells: [], open_task_id: null, acknowledged_at: null };
    renderPage();
    expect(screen.getByText('No truck allocation for this week')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd frontend && npx vitest run src/pages/transport/TransportPlanPage.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`pages/transport/TransportPlanPage.tsx`:

```tsx
import { useMemo } from 'react';
import { Button, Card, DatePicker, Empty, Space, Table, Tooltip, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useAcknowledgeTask, useTransportPlan } from '@/hooks/usePlanAck';
import type { ITransportPlan } from '@/types';

dayjs.extend(isoWeek);

const { Title, Text } = Typography;
const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const CHANGED_BG = '#fff1b8';

/** Monday of the ISO week in ?week=&year=, else of next week (the plan week, N+1). */
function weekFromParams(params: URLSearchParams): Dayjs {
  const week = Number(params.get('week'));
  const year = Number(params.get('year'));
  if (week > 0 && year > 0) return dayjs(`${year}-01-04`).isoWeek(week).isoWeekday(1);
  return dayjs().add(1, 'week').isoWeekday(1);
}

interface IRow {
  destinationId: number;
  name: string;
}

/**
 * Transport truck planning — docs/Tasks.md item 3. Read-only view of the week's
 * truck allocation (day × destination × trucks); cells that changed since
 * transport's last «Tanyşdym» are highlighted. The «Tanyşdym» button shows while
 * a transport_plan task is open and is the only way that task closes.
 */
export default function TransportPlanPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const monday = weekFromParams(params);
  const year = monday.isoWeekYear();
  const week = monday.isoWeek();
  const { data, isLoading } = useTransportPlan(year, week);
  const ack = useAcknowledgeTask();

  const cellMap = useMemo(() => {
    const map = new Map<string, ITransportPlan['cells'][number]>();
    for (const c of data?.cells ?? []) map.set(`${c.day_of_week}-${c.destination_id}`, c);
    return map;
  }, [data]);

  const rows: IRow[] = (data?.destinations ?? []).map((d) => ({ destinationId: d.id, name: d.name }));

  const columns = [
    { title: t('transport_plan.destination'), dataIndex: 'name', key: 'name', width: 180 },
    ...(data?.days ?? []).map((day) => ({
      title: `${t(`weekday.${WEEKDAY_KEYS[day.day_of_week - 1]}`)} ${dayjs(day.date).format('DD.MM')}`,
      key: `d${day.day_of_week}`,
      align: 'center' as const,
      render: (_: unknown, row: IRow) => {
        const cell = cellMap.get(`${day.day_of_week}-${row.destinationId}`);
        const count = cell?.truck_count ?? 0;
        const acknowledged = cell?.acknowledged_count ?? null;
        const changed = acknowledged != null && acknowledged !== count;
        const content = (
          <div
            data-testid={`cell-${day.day_of_week}-${row.destinationId}`}
            data-changed={String(changed)}
            style={{ background: changed ? CHANGED_BG : undefined, borderRadius: 4, padding: '2px 0' }}
          >
            {count}
          </div>
        );
        return changed
          ? <Tooltip title={t('transport_plan.was', { n: acknowledged })}>{content}</Tooltip>
          : content;
      },
    })),
  ];

  function onWeekChange(value: Dayjs | null) {
    if (!value) return;
    setParams({ week: String(value.isoWeek()), year: String(value.isoWeekYear()) });
  }

  const taskId = data?.open_task_id;

  return (
    <Card>
      <Space style={{ width: '100%', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <Title level={4} style={{ margin: 0 }}>{t('transport_plan.title')}</Title>
        <Space wrap>
          <DatePicker picker="week" value={monday} onChange={onWeekChange} allowClear={false} />
          {taskId != null && (
            <Button type="primary" loading={ack.isPending} onClick={() => ack.mutate(taskId)}>
              {t('tasks.acknowledge')}
            </Button>
          )}
        </Space>
      </Space>
      {data?.acknowledged_at && (
        <Text type="secondary" style={{ display: 'block', margin: '8px 0' }}>
          {t('transport_plan.acknowledged_at', { time: dayjs(data.acknowledged_at).format('DD.MM HH:mm') })}
        </Text>
      )}
      {!isLoading && rows.length === 0 ? (
        <Empty description={t('transport_plan.empty')} />
      ) : (
        <Table<IRow>
          rowKey="destinationId"
          size="small"
          loading={isLoading}
          pagination={false}
          dataSource={rows}
          columns={columns}
          scroll={{ x: true }}
        />
      )}
    </Card>
  );
}
```

`App.tsx`: add `const TransportPlanPage = lazy(() => import('@/pages/transport/TransportPlanPage'));` next to `FleetMap`. Add the route next to `transport/map`:

```tsx
                  {/* Transport truck planning (docs/Tasks.md item 3) — page_code
                      transport.plan; the data endpoint needs truck_allocation view. */}
                  <Route path="transport/plan" element={
                    <ProtectedRoute pageCode="transport.plan"><TransportPlanPage /></ProtectedRoute>
                  } />
```

`utils/permissions.ts`: after `'/transport/map': 'transport.map',`, add `'/transport/plan':            'transport.plan',`.

`AppLayout.tsx`:
- Title map: `'/transport/plan': t('nav.transport_plan'),`
- `ITEMS`: `'/transport/plan': { key: '/transport/plan', icon: <IconTruck size={15} />, label: t('nav.transport_plan') },`. `IconTruck` is already imported for `/admin/fleet`.
- `STAFF_MENU_GROUPS` → `nav.group_export`: insert `'/transport/plan'` after `'/transport/map'`.
- `BOSS_MENU_GROUPS` → `nav.group_planning`: insert `'/transport/plan'` after `'/export/plan'`.

Update `AppLayout.menuGroups.test.tsx` only if it fails because it pins exact lists.

i18n:
- `nav.transport_plan`: tk «Transport maşyn planlamasy», ru «Планирование машин (транспорт)», en «Transport truck planning».
- New top-level block `transport_plan`, identical keys in all three files:

| key | tk | ru | en |
|---|---|---|---|
| `title` | Transport maşyn planlamasy | Планирование машин (транспорт) | Transport truck planning |
| `destination` | Ugur | Направление | Destination |
| `was` | Öň: {{n}} | Было: {{n}} | Was: {{n}} |
| `acknowledged_at` | Soňky tanyşlyk: {{time}} | Последнее ознакомление: {{time}} | Last reviewed: {{time}} |
| `empty` | Bu hepde üçin maşyn paýlanyşy ýok | На эту неделю машины не распределены | No truck allocation for this week |

- [ ] **Step 4: Run the tests and typecheck, and confirm they pass**

Run: `cd frontend && npx vitest run src/pages/transport src/components/AppLayout.menuGroups.test.tsx src/test/menuComposition.test.ts && npx tsc --noEmit --ignoreDeprecations 5.0`
Expected: PASS, and tsc exits 0.

- [ ] **Step 5: Commit (only if commits are approved)**

```bash
git status && git diff --cached
git add frontend/src/pages/transport/TransportPlanPage.tsx frontend/src/pages/transport/TransportPlanPage.test.tsx
git add -p frontend/src/App.tsx frontend/src/utils/permissions.ts frontend/src/components/AppLayout.tsx frontend/src/components/AppLayout.menuGroups.test.tsx frontend/src/i18n/tk.json frontend/src/i18n/ru.json frontend/src/i18n/en.json
git commit -m "feat(frontend): transport truck planning page with Tanyşdym"
```

---

### Task 11: Task Rules page, docs, contract, changelog, build log

**Files:**
- Modify: `frontend/src/pages/export/TaskRulesPage.tsx`: `CODE_DRIVEN_KINDS` and its doc comment ("three task kinds" → seven).
- Modify: i18n `task_rules.kind_<key>_name|_trigger|_completes` for the four new keys; also update `kind_weekly_plan_trigger` and `kind_truck_allocation_trigger`/`_completes`.
- Modify:
  - `.claude/skills/api-contract/SKILL.md`: a new section "Planning tasks" with the three endpoints and shapes from Tasks 4 and 5.
  - `docs/obsidian/processes/truck-allocation.md`, `docs/obsidian/processes/comments-tasks.md`, `docs/obsidian/reference/task.md`: new kinds, Friday rule, deadlines, «Tanyşdym», missed, beat entries, transport page.
  - `CHANGELOG.md` (`[Unreleased]` → Added / Changed).
  - `BUILD_TEST_LOG.md`: new top entry.

- [ ] **Step 1: Update `TaskRulesPage.tsx`**

```ts
const CODE_DRIVEN_KINDS: ICodeDrivenKind[] = [
  { key: 'weekly_plan', role: 'greenhouse_manager' },
  { key: 'local_sell_plan', role: 'seller' },
  { key: 'truck_allocation', role: 'export_manager' },
  { key: 'alloc_review', role: 'export_manager' },
  { key: 'transport_plan', role: 'transport' },
  { key: 'daily_loading', role: 'loading_dept_head' },
  { key: 'daily_export', role: 'export_manager' },
];
```

Update the doc comment above it: seven kinds, services `{weekly_plan,local_sell_plan,truck_allocation,plan_ack,daily_plan}_tasks.py`.

- [ ] **Step 2: Add the i18n texts** (ru shown; write tk and en with the same meaning)

- `kind_weekly_plan_trigger`: «Каждую пятницу — на следующую неделю, по задаче на пару (менеджер, блок). С субботы красная, дозаполнить можно до воскресенья.»
- `kind_truck_allocation_trigger`: «Каждую субботу в 09:00 — на следующую неделю. Срок — суббота, с воскресенья красная.»
- `kind_alloc_review_name`: «Проверить распределение машин (план изменился)»
- `kind_alloc_review_trigger`: «После того как распределение сделано, менеджер теплицы изменил план так, что на какой-то день нужно другое число машин.»
- `kind_alloc_review_completes`: «Кнопка «Tanyşdym» на странице Недельного плана.»
- `kind_transport_plan_name`: «Планирование машин транспорта»
- `kind_transport_plan_trigger`: «Когда распределение машин на неделю готово, и снова — если его изменили после «Tanyşdym». Срок — конец дня.»
- `kind_transport_plan_completes`: «Кнопка «Tanyşdym» на странице «Планирование машин (транспорт)».»
- `kind_daily_loading_name`: «Спланируйте груз и машины на сегодня»
- `kind_daily_loading_trigger`: «Каждый день кроме воскресенья в 06:05. Срок — конец дня. Не сделана до утра — «Пропущена».»
- `kind_daily_loading_completes`: «На сегодняшнюю дату открыт хотя бы один грузовик в Gaplama.»
- `kind_daily_export_name`: «Спланируйте экспорт»
- `kind_daily_export_trigger`: same text as `kind_daily_loading_trigger`.
- `kind_daily_export_completes`: «На сегодняшнюю дату есть отгрузка со страной и клиентом.»

- [ ] **Step 3: Update the docs**
- api-contract section: paste the JSON shapes from Tasks 4 and 5 and the error `{"error": "year and week must be a valid ISO year and week."}`. Note: ints, not decimal strings; not season-scoped; `transport-plan` needs `truck_allocation.can_view`.
- Obsidian docs:
  - `reference/task.md`: kinds table + `scope_date`, `ack_snapshot`, `missed`.
  - `processes/truck-allocation.md`: Saturday deadline, review, transport step.
  - `processes/comments-tasks.md`: the two beat entries, the lazy-resolve-never-create rule.
- `CHANGELOG.md` `[Unreleased]`:
  - Added: planning tasks (Friday weekly plan, Tanyşdym reviews, transport planning page, daily Ýük/Eksport planla).
  - Changed: weekly-plan tasks only for next week, from Friday.
- `BUILD_TEST_LOG.md` (top): `- [ ] 2026-09-29 — Planning tasks (Tasks.md 1–5a): Friday weekly plan, Saturday allocation deadline, Tanyşdym review + /transport/plan, daily Ýük/Eksport planla + missed — NEEDS TEST`.

- [ ] **Step 4: Run the full verification**

```bash
cd backend && ./venv/Scripts/python.exe manage.py test apps.export.tests_plan_task_model apps.export.tests_plan_task_common apps.export.tests_weekly_plan_setup_command apps.export.tests_weekly_plan_tasks apps.export.tests_truck_allocation_tasks apps.export.tests_plan_ack_tasks apps.export.tests_daily_plan_tasks apps.export.tests_task_api apps.core.tests_transport_plan_perms apps.core.tests_team_kpi --noinput
./venv/Scripts/python.exe manage.py makemigrations --check --dry-run
cd ../frontend && npx vitest run src/components/me src/pages/me src/pages/export src/pages/transport && npx tsc --noEmit --ignoreDeprecations 5.0
```

Expected: all green; `makemigrations --check` reports "No changes detected"; tsc exits 0.

- [ ] **Step 5: Commit (only if commits are approved)**

```bash
git status && git diff --cached
git add -p frontend/src/pages/export/TaskRulesPage.tsx frontend/src/i18n/tk.json frontend/src/i18n/ru.json frontend/src/i18n/en.json .claude/skills/api-contract/SKILL.md docs/obsidian/processes/truck-allocation.md docs/obsidian/processes/comments-tasks.md docs/obsidian/reference/task.md CHANGELOG.md BUILD_TEST_LOG.md
git commit -m "docs: planning tasks — task rules page, contract, obsidian, changelog"
```

- [ ] **Step 6: Report**

Tell the user, in this form: «Built — NOT tested yet. Did you test it?». List the test labels that passed. State plainly that the real schedule (Friday task, 06:05 daily run, 30-min sync) only runs once the celery beat container is rebuilt on beta (memory "Celery Beat, Not Crontab").
