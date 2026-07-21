# Team KPI Leaderboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public, Bitrix24-style per-user leaderboard ranking every user by tasks completed, with on-time rate, current overdue count, and active hours — on a new `/team/kpi` page linked from the sidebar.

**Architecture:** The enabler is a new nullable `Task.completed_by` FK, populated at every site that sets `state=DONE`. The dominant path (auto-complete via `Shipment.save()` → `resolve_for_shipment`) credits `shipment.updated_by`, which is already set to the editing user before `save()` runs. A new `core` service aggregates completions/on-time/overdue/active-hours in three grouped queries and one roster query; a thin APIView exposes `GET /api/v1/core/team-kpi/?period=`. The frontend mirrors the existing Worklog page (antd `Table`, rank column, role tag) with a period `Segmented` switcher.

**Tech Stack:** Django 5 + DRF, MSSQL (SQLite in tests), React + TypeScript, Ant Design, TanStack Query, react-i18next.

## Global Constraints

- **MSSQL**: no JSONField/ArrayField, no `.distinct('field')`, `bulk_create`/`bulk_update` need `batch_size=500`. (This plan uses none of these; `Count(..., filter=Q(...))` → `CASE WHEN` is MSSQL-safe.)
- **Dependency direction**: `core ← export`. New code lives in `apps/core` and imports `apps.export.models.Task` **lazily inside functions** (the pattern `views_me.py` already uses).
- **Cross-app FK**: `Task.completed_by` uses string ref `'core.User'`, `on_delete=SET_NULL`, `null=True, blank=True`.
- **`update_fields` discipline**: any `task.save(update_fields=[...])` that now also writes `completed_by` MUST add `'completed_by'` to the list, or the write is silently dropped.
- **Attribution rule**: when no user is in scope, `completed_by` stays null and the completion counts toward nobody. Never guess an actor.
- **Access**: any authenticated user (no role gate) — matches `WorklogTeamView`'s radical-transparency policy.
- **i18n**: every user-visible string via `t('key')`, added to all three files (`i18n/tk.json`, `i18n/ru.json`, `i18n/en.json`). Never hardcode.
- **Frontend typecheck**: the `npm run type-check` script is broken (TS5103); verify with `npx tsc --noEmit --ignoreDeprecations 5.0`.
- **Commit discipline**: one commit per task. Co-author tag: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Backend test runner**: `python manage.py test apps.core.tests_team_kpi apps.export.tests_task_attribution --verbosity=2` (run from `backend/`).

---

### Task 1: Add `Task.completed_by` field + migration

**Files:**
- Modify: `backend/apps/export/models/task.py` (add field near `assignee_user`, ~line 125)
- Test: `backend/apps/export/tests_task_attribution.py` (create)
- Migration: generated into `backend/apps/export/migrations/`

**Interfaces:**
- Produces: `Task.completed_by` (FK → `core.User`, nullable), `related_name='completed_tasks'`.

- [ ] **Step 1: Write the failing test**

Create `backend/apps/export/tests_task_attribution.py`:

```python
"""Tests for Task.completed_by attribution across every completion site."""
from django.test import TestCase

from apps.core.models import User
from apps.export.models import Task, TaskState, TaskCompletionRule


class TaskCompletedByFieldTest(TestCase):
    def test_completed_by_defaults_null_and_accepts_user(self):
        user = User.objects.create(username='editor1', role='loading_dept_head')
        task = Task.objects.create(
            title_key='t.x', assignee_role='loading_dept_head',
            completion_rule=TaskCompletionRule.MANUAL_DONE, state=TaskState.OPEN,
        )
        self.assertIsNone(task.completed_by)

        task.completed_by = user
        task.save(update_fields=['completed_by'])
        task.refresh_from_db()
        self.assertEqual(task.completed_by_id, user.id)
        # reverse accessor name
        self.assertIn(task, user.completed_tasks.all())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python manage.py test apps.export.tests_task_attribution.TaskCompletedByFieldTest --verbosity=2`
Expected: FAIL — `AttributeError`/`FieldError`: Task has no field `completed_by`.

- [ ] **Step 3: Add the field**

In `backend/apps/export/models/task.py`, directly after the `assignee_user` FK (~line 125-129), add:

```python
    completed_by = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='completed_tasks',
        help_text='User credited with completing this task; null when no user was in scope.',
    )
```

- [ ] **Step 4: Make and apply the migration**

Run: `cd backend && python manage.py makemigrations export`
Expected: creates `export/migrations/00XX_task_completed_by.py` with one `AddField`.

Run: `cd backend && python manage.py migrate export`
Expected: `Applying export.00XX_task_completed_by... OK`

Run: `cd backend && python manage.py makemigrations --check --dry-run`
Expected: `No changes detected` (exit 0).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && python manage.py test apps.export.tests_task_attribution.TaskCompletedByFieldTest --verbosity=2`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/export/models/task.py backend/apps/export/migrations/ backend/apps/export/tests_task_attribution.py
git commit -m "feat(p3): add Task.completed_by field for per-user KPI attribution

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Credit the auto-complete + sales-report paths

The two completion sites in `services/task_rules.py`. `resolve_for_shipment` is the dominant path (auto-complete when a Sheet cell is filled) — it must credit `shipment.updated_by`.

**Files:**
- Modify: `backend/apps/export/services/task_rules.py:353-360` (`resolve_for_shipment` loop) and `:405-410` (`close_sales_report_task` loop)
- Test: `backend/apps/export/tests_task_attribution.py` (append)

**Interfaces:**
- Consumes: `Task.completed_by` (Task 1), `shipment.updated_by` (set by the view before `save()`).
- Produces: `resolve_for_shipment` now writes `completed_by = getattr(shipment, 'updated_by', None)`; `close_sales_report_task` writes `completed_by = user`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/apps/export/tests_task_attribution.py`. Use the existing shipment-creation helpers already used by `tests_sales_report_task.py` as a reference for required FKs. Minimal version:

```python
from django.utils import timezone
from datetime import timedelta

from apps.export.services.task_rules import resolve_for_shipment, close_sales_report_task


class AutoCompleteAttributionTest(TestCase):
    def _make_shipment_with_open_task(self, editor):
        """Create a shipment + one ANY_FIELD_FILLED task on an editable field.
        Mirror the FK setup used in tests_sales_report_task.py."""
        from apps.export.tests_task_attribution_helpers import make_basic_shipment
        shipment = make_basic_shipment(created_by=editor)
        task = Task.objects.create(
            shipment=shipment, title_key='t.fill_weight',
            assignee_role='loading_dept_head',
            target_fields='weight_net',
            completion_rule=TaskCompletionRule.ANY_FIELD_FILLED,
            state=TaskState.OPEN,
        )
        return shipment, task

    def test_resolve_credits_shipment_updated_by(self):
        editor = User.objects.create(username='ed_resolve', role='loading_dept_head')
        shipment, task = self._make_shipment_with_open_task(editor)
        shipment.weight_net = 18500
        shipment.updated_by = editor           # set by the view before save()
        resolve_for_shipment(shipment)
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.DONE)
        self.assertEqual(task.completed_by_id, editor.id)

    def test_resolve_no_user_credits_nobody(self):
        editor = User.objects.create(username='ed_none', role='loading_dept_head')
        shipment, task = self._make_shipment_with_open_task(editor)
        shipment.weight_net = 18500
        shipment.updated_by = None             # no actor in scope
        resolve_for_shipment(shipment)
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.DONE)
        self.assertIsNone(task.completed_by_id)
```

Also add the sales-report case:

```python
    def test_close_sales_report_credits_user(self):
        user = User.objects.create(username='sr_user', role='export_manager')
        shipment, _ = self._make_shipment_with_open_task(user)
        reminder = Task.objects.create(
            shipment=shipment, title_key='tasks.submit_sales_report',
            assignee_role='export_manager',
            completion_rule=TaskCompletionRule.MANUAL_DONE, state=TaskState.OPEN,
        )
        close_sales_report_task(shipment, user)
        reminder.refresh_from_db()
        self.assertEqual(reminder.state, TaskState.DONE)
        self.assertEqual(reminder.completed_by_id, user.id)
```

Create the helper `backend/apps/export/tests_task_attribution_helpers.py` with a `make_basic_shipment(created_by)` that builds a shipment with the minimal required FKs (copy the FK-setup block from `setUp` in `backend/apps/export/tests_sales_report_task.py`). Keeping it in a helper avoids repeating the fixture in every test class.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python manage.py test apps.export.tests_task_attribution.AutoCompleteAttributionTest --verbosity=2`
Expected: FAIL — `completed_by_id` is `None` where a user is expected (field not yet populated).

- [ ] **Step 3: Populate `completed_by` in both loops**

In `resolve_for_shipment` (`task_rules.py`), change the resolution block (currently lines 353-360):

```python
    actor = getattr(shipment, 'updated_by', None)
    for task in open_tasks:
        if _completion_satisfied(task, shipment):
            task.state = TaskState.DONE
            task.completed_at = now
            if not task.started_at:
                task.started_at = now
            task.completed_by = actor
            task.save(update_fields=['state', 'completed_at', 'started_at', 'completed_by'])
            resolved.append(task)
```

In `close_sales_report_task` (`task_rules.py`), change the reminder loop (currently lines 405-410):

```python
    for task in reminders:
        task.state = TaskState.DONE
        task.completed_at = now
        if not task.started_at:
            task.started_at = now
        task.completed_by = user
        task.save(update_fields=['state', 'completed_at', 'started_at', 'completed_by'])
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python manage.py test apps.export.tests_task_attribution --verbosity=2`
Expected: PASS (all classes so far).

- [ ] **Step 5: Regression — task rules suite still green**

Run: `cd backend && python manage.py test apps.export.tests_sales_report_task apps.export.tests_task_api --verbosity=1`
Expected: no new failures vs. baseline.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/export/services/task_rules.py backend/apps/export/tests_task_attribution.py backend/apps/export/tests_task_attribution_helpers.py
git commit -m "feat(p3): credit completed_by on auto-resolve and sales-report close

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Credit the manual-complete and plan-resolver paths

Remaining three completion sites: `TaskViewSet.complete` (manual "Done"), the weekly-plan resolver, and the local-sell-plan resolver.

**Files:**
- Modify: `backend/apps/export/views.py:3714-3719` (`TaskViewSet.complete`)
- Modify: `backend/apps/export/services/weekly_plan_tasks.py:153-158` (`_resolve_task`)
- Modify: `backend/apps/export/services/local_sell_plan_tasks.py:125-130` (`_resolve_task`)
- Test: `backend/apps/export/tests_task_attribution.py` (append)

**Interfaces:**
- Consumes: `Task.completed_by` (Task 1).
- Produces: `complete` credits `request.user`; both `_resolve_task` functions credit `task.assignee_user` (may be null).

- [ ] **Step 1: Write the failing tests**

Append to `backend/apps/export/tests_task_attribution.py`:

```python
from rest_framework.test import APIClient


class ManualCompleteAttributionTest(TestCase):
    def test_manual_complete_credits_request_user(self):
        user = User.objects.create(username='clicker', role='export_manager')
        user.set_password('x'); user.save()
        task = Task.objects.create(
            title_key='t.manual', assignee_role='export_manager',
            completion_rule=TaskCompletionRule.MANUAL_DONE, state=TaskState.OPEN,
        )
        client = APIClient()
        client.force_authenticate(user=user)
        resp = client.post(f'/api/v1/export/tasks/{task.id}/complete/')
        self.assertEqual(resp.status_code, 200)
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.DONE)
        self.assertEqual(task.completed_by_id, user.id)
```

For the weekly-plan resolver, add a focused unit test that calls `_resolve_task` directly with a task whose `assignee_user` is set and whose block week is complete. Model it on the fixture in `backend/apps/export/tests_weekly_plan_tasks.py` (reuse its week/block setup). Assert `task.completed_by_id == task.assignee_user_id` after resolution. (The local-sell resolver always has `assignee_user=None`, so its attribution is null by construction — cover it only if `tests_local_sell_plan_tasks.py` already has a resolvable fixture; otherwise the null path is already covered by `test_resolve_no_user_credits_nobody`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python manage.py test apps.export.tests_task_attribution.ManualCompleteAttributionTest --verbosity=2`
Expected: FAIL — `completed_by_id` is `None`.

- [ ] **Step 3: Populate `completed_by` at all three sites**

`views.py` `complete` (currently lines 3714-3719):

```python
        now = timezone.now()
        task.state = TaskState.DONE
        task.completed_at = now
        if not task.started_at:
            task.started_at = now
        task.completed_by = request.user
        task.save(update_fields=['state', 'completed_at', 'started_at', 'completed_by'])
```

`weekly_plan_tasks.py` `_resolve_task` (currently lines 153-158):

```python
    now = timezone.now()
    task.state = TaskState.DONE
    task.completed_at = now
    if not task.started_at:
        task.started_at = now
    task.completed_by_id = task.assignee_user_id
    task.save(update_fields=['state', 'completed_at', 'started_at', 'completed_by'])
    return True
```

`local_sell_plan_tasks.py` `_resolve_task` (currently lines 125-130):

```python
    now = timezone.now()
    task.state = TaskState.DONE
    task.completed_at = now
    if not task.started_at:
        task.started_at = now
    task.completed_by_id = task.assignee_user_id
    task.save(update_fields=['state', 'completed_at', 'started_at', 'completed_by'])
    return True
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python manage.py test apps.export.tests_task_attribution --verbosity=2`
Expected: PASS.

- [ ] **Step 5: Regression**

Run: `cd backend && python manage.py test apps.export.tests_weekly_plan_tasks apps.export.tests_task_api --verbosity=1`
Expected: no new failures.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/export/views.py backend/apps/export/services/weekly_plan_tasks.py backend/apps/export/services/local_sell_plan_tasks.py backend/apps/export/tests_task_attribution.py
git commit -m "feat(p3): credit completed_by on manual complete and plan resolvers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `compute_team_kpi` service

Pure aggregation. Three grouped queries + roster merge. No HTTP concerns.

**Files:**
- Create: `backend/apps/core/services_team_kpi.py`
- Test: `backend/apps/core/tests_team_kpi.py` (create)

**Interfaces:**
- Consumes: `Task` (lazy import), `WorkSessionDaily`, `User`, `task_roles_for`, `Season`.
- Produces:
  - `parse_period(value: str | None) -> str` — validates ∈ `{today, week, month, season}`, defaults `week`, raises `ValueError` on unknown.
  - `period_window(period: str) -> tuple[datetime | None, date | None]` — `(since_dt, since_date)` in Asia/Ashgabat local midnight; `(None, None)` for `season` when no active Season exists (no lower bound).
  - `compute_team_kpi(period: str) -> list[dict]` — one dict per active user with keys `user_id, user_name, role, completed, on_time_rate, overdue_now, active_seconds`, sorted `(-completed, user_name)`.

- [ ] **Step 1: Write the failing test**

Create `backend/apps/core/tests_team_kpi.py`:

```python
"""Tests for the team-KPI aggregation service."""
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from apps.core.models import User
from apps.core.services_team_kpi import parse_period, compute_team_kpi
from apps.export.models import Task, TaskState, TaskCompletionRule


class ParsePeriodTest(TestCase):
    def test_defaults_to_week(self):
        self.assertEqual(parse_period(None), 'week')
        self.assertEqual(parse_period(''), 'week')

    def test_valid_values(self):
        for p in ('today', 'week', 'month', 'season'):
            self.assertEqual(parse_period(p), p)

    def test_unknown_raises(self):
        with self.assertRaises(ValueError):
            parse_period('year')


class ComputeTeamKpiTest(TestCase):
    def setUp(self):
        self.alice = User.objects.create(username='alice', role='loading_dept_head', is_active=True)
        self.bob = User.objects.create(username='bob', role='document_team', is_active=True)

    def _done_task(self, user, *, deadline=None, completed_at=None, on_time=True):
        now = completed_at or timezone.now()
        dl = deadline
        if deadline is None and on_time is not None:
            dl = now + (timedelta(hours=1) if on_time else timedelta(hours=-1))
        return Task.objects.create(
            title_key='t', assignee_role=user.role,
            completion_rule=TaskCompletionRule.MANUAL_DONE,
            state=TaskState.DONE, completed_at=now, completed_by=user, deadline=dl,
        )

    def test_counts_completed_per_user_this_week(self):
        self._done_task(self.alice)
        self._done_task(self.alice)
        self._done_task(self.bob)
        rows = {r['user_id']: r for r in compute_team_kpi('week')}
        self.assertEqual(rows[self.alice.id]['completed'], 2)
        self.assertEqual(rows[self.bob.id]['completed'], 1)

    def test_on_time_rate(self):
        self._done_task(self.alice, on_time=True)
        self._done_task(self.alice, on_time=False)
        rows = {r['user_id']: r for r in compute_team_kpi('week')}
        self.assertEqual(rows[self.alice.id]['on_time_rate'], 0.5)

    def test_on_time_rate_null_when_no_deadline(self):
        Task.objects.create(
            title_key='t', assignee_role=self.alice.role,
            completion_rule=TaskCompletionRule.MANUAL_DONE,
            state=TaskState.DONE, completed_at=timezone.now(),
            completed_by=self.alice, deadline=None,
        )
        rows = {r['user_id']: r for r in compute_team_kpi('week')}
        self.assertIsNone(rows[self.alice.id]['on_time_rate'])

    def test_overdue_now_is_role_based_and_window_independent(self):
        # An open, past-deadline task (never completed → no completed_by).
        Task.objects.create(
            title_key='t', assignee_role='loading_dept_head',
            completion_rule=TaskCompletionRule.MANUAL_DONE,
            state=TaskState.OPEN, deadline=timezone.now() - timedelta(hours=2),
        )
        rows = {r['user_id']: r for r in compute_team_kpi('today')}
        self.assertEqual(rows[self.alice.id]['overdue_now'], 1)
        self.assertEqual(rows[self.bob.id]['overdue_now'], 0)

    def test_zero_completion_users_present_and_sorted_last(self):
        self._done_task(self.alice)
        rows = compute_team_kpi('week')
        ids = [r['user_id'] for r in rows]
        self.assertIn(self.bob.id, ids)                 # zero user still present
        self.assertEqual(rows[0]['user_id'], self.alice.id)   # most completed first
        self.assertEqual(rows[-1]['completed'], 0)            # zeros at the bottom

    def test_old_completion_excluded_from_today(self):
        old = timezone.now() - timedelta(days=3)
        self._done_task(self.alice, completed_at=old)
        rows = {r['user_id']: r for r in compute_team_kpi('today')}
        self.assertEqual(rows[self.alice.id]['completed'], 0)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python manage.py test apps.core.tests_team_kpi --verbosity=2`
Expected: FAIL — `ModuleNotFoundError: apps.core.services_team_kpi`.

- [ ] **Step 3: Implement the service**

Create `backend/apps/core/services_team_kpi.py`:

```python
"""Team KPI leaderboard aggregation.

Placed in apps.core (like views_me) because it aggregates export-domain data
without being shipment-specific. Task is imported lazily to respect the
core ← export dependency direction.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta

from django.db.models import Count, F, Q, Sum
from django.utils import timezone
from zoneinfo import ZoneInfo

from apps.core.models import User, WorkSessionDaily
from apps.core.roles import task_roles_for

_TM_TZ = ZoneInfo('Asia/Ashgabat')
_VALID_PERIODS = ('today', 'week', 'month', 'season')


def parse_period(value: str | None) -> str:
    """Validate the period query param. Defaults to 'week'; raises on unknown."""
    if not value:
        return 'week'
    if value not in _VALID_PERIODS:
        raise ValueError(f'Unknown period: {value!r}')
    return value


def _local_midnight(d: date) -> datetime:
    return datetime.combine(d, time.min, tzinfo=_TM_TZ)


def period_window(period: str) -> tuple[datetime | None, date | None]:
    """Return (since_dt, since_date) for the given period in Asia/Ashgabat.

    since_dt gates Task.completed_at (a datetime); since_date gates
    WorkSessionDaily.work_date (a date). (None, None) means no lower bound
    (season with no active Season row).
    """
    now_local = timezone.now().astimezone(_TM_TZ)
    today = now_local.date()

    if period == 'today':
        start = today
    elif period == 'week':
        start = today - timedelta(days=today.weekday())      # Monday
    elif period == 'month':
        start = today.replace(day=1)
    else:  # season
        from apps.core.models import Season
        season = Season.objects.filter(is_active=True).order_by('-start_date').first()
        if season is None:
            return None, None
        start = season.start_date

    return _local_midnight(start), start


def compute_team_kpi(period: str) -> list[dict]:
    """Aggregate per-user KPI rows for the leaderboard.

    Three grouped queries (completions/on-time by completed_by, overdue by
    role, active-seconds by user) merged over the full active-user roster.
    """
    from apps.export.models import Task, TaskState

    since_dt, since_date = period_window(period)

    # 1. Completions + on-time, grouped by the crediting user.
    comp_filter = Q(state=TaskState.DONE, completed_by__isnull=False)
    if since_dt is not None:
        comp_filter &= Q(completed_at__gte=since_dt)
    comp_rows = (
        Task.objects.filter(comp_filter)
        .values('completed_by')
        .annotate(
            completed=Count('id'),
            with_deadline=Count('id', filter=Q(deadline__isnull=False)),
            on_time=Count('id', filter=Q(
                deadline__isnull=False, completed_at__lte=F('deadline'),
            )),
        )
    )
    comp_by_user = {r['completed_by']: r for r in comp_rows}

    # 2. Overdue NOW — current-state, window-independent, grouped by role.
    now = timezone.now()
    overdue_rows = (
        Task.objects.filter(deadline__lt=now)
        .exclude(state__in=[TaskState.DONE, TaskState.CANCELLED])
        .values('assignee_role')
        .annotate(c=Count('id'))
    )
    overdue_by_role = {r['assignee_role']: r['c'] for r in overdue_rows}

    # 3. Active seconds, grouped by user over the window.
    active_qs = WorkSessionDaily.objects.all()
    if since_date is not None:
        active_qs = active_qs.filter(work_date__gte=since_date)
    active_rows = active_qs.values('user_id').annotate(s=Sum('active_seconds_total'))
    active_by_user = {r['user_id']: int(r['s'] or 0) for r in active_rows}

    # 4. Roster merge.
    users = User.objects.filter(is_active=True).values(
        'id', 'username', 'first_name', 'last_name', 'role',
    )
    payload: list[dict] = []
    for u in users:
        full = ' '.join(
            p for p in [(u['first_name'] or '').strip(), (u['last_name'] or '').strip()] if p
        )
        comp = comp_by_user.get(u['id'])
        completed = comp['completed'] if comp else 0
        if comp and comp['with_deadline']:
            on_time_rate = round(comp['on_time'] / comp['with_deadline'], 4)
        else:
            on_time_rate = None
        overdue_now = sum(overdue_by_role.get(r, 0) for r in task_roles_for(u['role']))
        payload.append({
            'user_id': u['id'],
            'user_name': full or u['username'],
            'role': u['role'],
            'completed': completed,
            'on_time_rate': on_time_rate,
            'overdue_now': overdue_now,
            'active_seconds': active_by_user.get(u['id'], 0),
        })

    payload.sort(key=lambda r: (-r['completed'], r['user_name']))
    return payload
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python manage.py test apps.core.tests_team_kpi --verbosity=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/core/services_team_kpi.py backend/apps/core/tests_team_kpi.py
git commit -m "feat(core): team-KPI leaderboard aggregation service

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `TeamKpiView` endpoint + URL

Thin APIView with 60 s cache keyed by period. Serializer validates the response row shape.

**Files:**
- Create: `backend/apps/core/views_team_kpi.py`
- Modify: `backend/apps/core/urls/core.py` (import + one `path`)
- Test: `backend/apps/core/tests_team_kpi.py` (append API test class)

**Interfaces:**
- Consumes: `parse_period`, `compute_team_kpi` (Task 4).
- Produces: `GET /api/v1/core/team-kpi/?period=<p>` → `{"period": str, "results": [row, ...]}`. Unknown period → 400 `{"error": ...}`.

- [ ] **Step 1: Write the failing test**

Append to `backend/apps/core/tests_team_kpi.py`:

```python
from rest_framework.test import APIClient


class TeamKpiApiTest(TestCase):
    def setUp(self):
        self.user = User.objects.create(username='viewer', role='document_team', is_active=True)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_returns_period_and_results(self):
        resp = self.client.get('/api/v1/core/team-kpi/?period=week')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['period'], 'week')
        self.assertIsInstance(resp.data['results'], list)
        row = next(r for r in resp.data['results'] if r['user_id'] == self.user.id)
        self.assertEqual(
            set(row.keys()),
            {'user_id', 'user_name', 'role', 'completed', 'on_time_rate',
             'overdue_now', 'active_seconds'},
        )

    def test_default_period_is_week(self):
        resp = self.client.get('/api/v1/core/team-kpi/')
        self.assertEqual(resp.data['period'], 'week')

    def test_unknown_period_400(self):
        resp = self.client.get('/api/v1/core/team-kpi/?period=decade')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('error', resp.data)

    def test_requires_auth(self):
        anon = APIClient()
        resp = anon.get('/api/v1/core/team-kpi/?period=week')
        self.assertIn(resp.status_code, (401, 403))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python manage.py test apps.core.tests_team_kpi.TeamKpiApiTest --verbosity=2`
Expected: FAIL — 404 (route not registered).

- [ ] **Step 3: Implement the view**

Create `backend/apps/core/views_team_kpi.py`:

```python
"""Team KPI leaderboard endpoint. Public (radical transparency), 60s cache."""
from __future__ import annotations

from django.core.cache import cache
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.services_team_kpi import compute_team_kpi, parse_period

_CACHE_TTL = 60


class TeamKpiView(APIView):
    """GET /api/v1/core/team-kpi/?period=today|week|month|season

    One row per active user, ranked by tasks completed in the window.
    Visible to every authenticated user (no role gate).
    """

    permission_classes = [IsAuthenticated]

    def get(self, request) -> Response:
        try:
            period = parse_period(request.query_params.get('period'))
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        cache_key = f'team-kpi:{period}'
        results = cache.get(cache_key)
        if results is None:
            results = compute_team_kpi(period)
            cache.set(cache_key, results, _CACHE_TTL)

        return Response({'period': period, 'results': results})
```

In `backend/apps/core/urls/core.py`, add the import next to the worklog import:

```python
from apps.core.views_team_kpi import TeamKpiView
```

and add to `urlpatterns` (next to the worklog paths):

```python
    # Team KPI leaderboard — all authenticated users may read (radical transparency).
    path('team-kpi/', TeamKpiView.as_view(), name='team-kpi'),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python manage.py test apps.core.tests_team_kpi.TeamKpiApiTest --verbosity=2`
Expected: PASS.

- [ ] **Step 5: Full backend regression for touched apps**

Run: `cd backend && python manage.py test apps.core.tests_team_kpi apps.export.tests_task_attribution --verbosity=1`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/core/views_team_kpi.py backend/apps/core/urls/core.py backend/apps/core/tests_team_kpi.py
git commit -m "feat(core): team-KPI leaderboard endpoint /api/v1/core/team-kpi/

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Frontend types + `useTeamKpi` hook

**Files:**
- Create: `frontend/src/types/teamKpi.ts`
- Create: `frontend/src/hooks/useTeamKpi.ts`

**Interfaces:**
- Produces: `TeamKpiPeriod` (`'today' | 'week' | 'month' | 'season'`), `ITeamKpiRow`, `ITeamKpiResponse`, `useTeamKpi(period)`.

- [ ] **Step 1: Create the types**

Create `frontend/src/types/teamKpi.ts`:

```typescript
// Team KPI leaderboard API shapes — mirror apps/core/views_team_kpi.py.

export type TeamKpiPeriod = 'today' | 'week' | 'month' | 'season';

export interface ITeamKpiRow {
  user_id: number;
  user_name: string;
  role: string;
  completed: number;
  on_time_rate: number | null;
  overdue_now: number;
  active_seconds: number;
}

export interface ITeamKpiResponse {
  period: TeamKpiPeriod;
  results: ITeamKpiRow[];
}
```

- [ ] **Step 2: Create the hook**

Create `frontend/src/hooks/useTeamKpi.ts`:

```typescript
// useTeamKpi — TanStack Query hook for the team-KPI leaderboard.

import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import type { ITeamKpiResponse, TeamKpiPeriod } from '@/types/teamKpi';

const SIXTY_SEC = 60 * 1000;

export function useTeamKpi(period: TeamKpiPeriod) {
  return useQuery({
    queryKey: ['team-kpi', period],
    queryFn: async () => {
      const { data } = await api.get<ITeamKpiResponse>('/core/team-kpi/', {
        params: { period },
      });
      return data;
    },
    staleTime: SIXTY_SEC,
    refetchInterval: SIXTY_SEC,
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0`
Expected: no errors from the two new files.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/teamKpi.ts frontend/src/hooks/useTeamKpi.ts
git commit -m "feat(frontend): team-KPI types + useTeamKpi query hook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Team KPI page + route + sidebar + i18n

**Files:**
- Create: `frontend/src/pages/team/TeamKpi.tsx`
- Modify: `frontend/src/App.tsx` (lazy import ~line 63; route ~line 133)
- Modify: `frontend/src/components/AppLayout.tsx` (sidebar entry, `group_team`, ~line 246-260)
- Modify: `frontend/src/i18n/tk.json`, `frontend/src/i18n/ru.json`, `frontend/src/i18n/en.json`

**Interfaces:**
- Consumes: `useTeamKpi`, `ITeamKpiRow`, `TeamKpiPeriod` (Task 6).

- [ ] **Step 1: Add i18n keys to all three files**

Add a `team_kpi` block and one `nav.team_kpi` key to each of `tk.json`, `ru.json`, `en.json`. Place `nav.team_kpi` inside the existing `nav` object.

`en.json`:
```json
"team_kpi": {
  "title": "Team leaderboard",
  "subtitle": "Tasks completed per user. Public to the whole team.",
  "col_user": "User",
  "col_role": "Role",
  "col_completed": "Completed",
  "col_on_time": "On time",
  "col_overdue": "Overdue now",
  "col_active": "Active",
  "period_today": "Today",
  "period_week": "Week",
  "period_month": "Month",
  "period_season": "Season",
  "no_data": "No data yet"
}
```
and in `nav`: `"team_kpi": "Team leaderboard"`.

`ru.json`:
```json
"team_kpi": {
  "title": "Рейтинг команды",
  "subtitle": "Выполненные задачи по каждому сотруднику. Видно всей команде.",
  "col_user": "Сотрудник",
  "col_role": "Роль",
  "col_completed": "Выполнено",
  "col_on_time": "Вовремя",
  "col_overdue": "Просрочено",
  "col_active": "Активность",
  "period_today": "Сегодня",
  "period_week": "Неделя",
  "period_month": "Месяц",
  "period_season": "Сезон",
  "no_data": "Пока нет данных"
}
```
and in `nav`: `"team_kpi": "Рейтинг команды"`.

`tk.json`:
```json
"team_kpi": {
  "title": "Toparyň reýtingi",
  "subtitle": "Her ulanyjy boýunça tamamlanan işler. Ähli topara açyk.",
  "col_user": "Ulanyjy",
  "col_role": "Wezipe",
  "col_completed": "Tamamlanan",
  "col_on_time": "Wagtynda",
  "col_overdue": "Möhleti geçen",
  "col_active": "Işjeňlik",
  "period_today": "Şu gün",
  "period_week": "Hepde",
  "period_month": "Aý",
  "period_season": "Möwsüm",
  "no_data": "Entek maglumat ýok"
}
```
and in `nav`: `"team_kpi": "Toparyň reýtingi"`.

- [ ] **Step 2: Create the page**

Create `frontend/src/pages/team/TeamKpi.tsx`:

```tsx
// TeamKpi — public per-user task leaderboard (Bitrix-style).
//
// Visibility (locked decision): every authenticated user sees everyone's
// numbers, mirroring the Worklog page's radical-transparency rule. Ranks by
// tasks completed in the selected period; overdue-now is current-state and
// does not follow the period selector.

import { useMemo } from 'react';
import { Card, Segmented, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTeamKpi } from '@/hooks/useTeamKpi';
import type { ITeamKpiRow, TeamKpiPeriod } from '@/types/teamKpi';
import { COLORS } from '@/constants/styles';

const { Title, Text } = Typography;
const PERIODS: TeamKpiPeriod[] = ['today', 'week', 'month', 'season'];

function formatHm(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export default function TeamKpi() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const raw = params.get('period');
  const period: TeamKpiPeriod =
    raw && (PERIODS as string[]).includes(raw) ? (raw as TeamKpiPeriod) : 'week';

  const query = useTeamKpi(period);

  const columns: ColumnsType<ITeamKpiRow> = useMemo(() => [
    {
      title: '#',
      key: 'rank',
      width: 56,
      render: (_v, _row, idx) => <Text type="secondary">{idx + 1}</Text>,
    },
    {
      title: t('team_kpi.col_user'),
      dataIndex: 'user_name',
      key: 'user_name',
      sorter: (a, b) => a.user_name.localeCompare(b.user_name),
    },
    {
      title: t('team_kpi.col_role'),
      dataIndex: 'role',
      key: 'role',
      width: 160,
      render: (role: string) => (
        <Tag color="blue">{t(`roles.${role}`, { defaultValue: role })}</Tag>
      ),
      sorter: (a, b) => a.role.localeCompare(b.role),
    },
    {
      title: t('team_kpi.col_completed'),
      dataIndex: 'completed',
      key: 'completed',
      width: 120,
      align: 'right' as const,
      render: (n: number) => (
        <Text strong={n > 0} type={n === 0 ? 'secondary' : undefined}
          style={{ fontSize: 16 }}>
          {n === 0 ? '—' : n}
        </Text>
      ),
      sorter: (a, b) => a.completed - b.completed,
      defaultSortOrder: 'descend' as const,
    },
    {
      title: t('team_kpi.col_on_time'),
      dataIndex: 'on_time_rate',
      key: 'on_time_rate',
      width: 110,
      align: 'right' as const,
      render: (rate: number | null) => {
        if (rate == null) return <Text type="secondary">—</Text>;
        const pct = Math.round(rate * 100);
        return <Text style={{ color: rate >= 0.8 ? COLORS.success : COLORS.orange }}>{pct}%</Text>;
      },
      sorter: (a, b) => (a.on_time_rate ?? -1) - (b.on_time_rate ?? -1),
    },
    {
      title: t('team_kpi.col_overdue'),
      dataIndex: 'overdue_now',
      key: 'overdue_now',
      width: 120,
      align: 'right' as const,
      render: (n: number) => (
        <Text style={{ color: n > 0 ? COLORS.orange : undefined }}
          type={n === 0 ? 'secondary' : undefined}>
          {n === 0 ? '—' : n}
        </Text>
      ),
      sorter: (a, b) => a.overdue_now - b.overdue_now,
    },
    {
      title: t('team_kpi.col_active'),
      dataIndex: 'active_seconds',
      key: 'active_seconds',
      width: 120,
      align: 'right' as const,
      render: (sec: number) => (
        <Text type={sec === 0 ? 'secondary' : undefined}>
          {sec === 0 ? '—' : formatHm(sec)}
        </Text>
      ),
      sorter: (a, b) => a.active_seconds - b.active_seconds,
    },
  ], [t]);

  return (
    <div style={{ padding: '0 4px' }}>
      <Title level={3} style={{ marginBottom: 4 }}>{t('team_kpi.title')}</Title>
      <Text type="secondary">{t('team_kpi.subtitle')}</Text>

      <Card size="small" style={{ marginTop: 16 }}
        title={
          <Segmented<TeamKpiPeriod>
            size="small"
            value={period}
            onChange={(v) => setParams({ period: v })}
            options={PERIODS.map((p) => ({ value: p, label: t(`team_kpi.period_${p}`) }))}
          />
        }
      >
        <Table<ITeamKpiRow>
          size="small"
          loading={query.isLoading}
          dataSource={query.data?.results ?? []}
          columns={columns}
          rowKey="user_id"
          pagination={{ pageSize: 25, showSizeChanger: false, hideOnSinglePage: true }}
          locale={{ emptyText: t('team_kpi.no_data') }}
        />
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Wire the route in `App.tsx`**

Add the lazy import near the other page imports (~line 63):

```tsx
const TeamKpi = lazy(() => import('@/pages/team/TeamKpi'));
```

Add the route next to the Worklog route (~line 133-136):

```tsx
                  {/* Team KPI — open to every authenticated user (radical-transparency rule). */}
                  <Route path="team/kpi" element={
                    <ProtectedRoute><TeamKpi /></ProtectedRoute>
                  } />
```

- [ ] **Step 4: Add the sidebar entry in `AppLayout.tsx`**

In the `group_team` block (~line 246-260), add a second item after the `/worklog` entry, reusing the same explicit `roles` ALL-list the worklog entry uses:

```tsx
      {
        key: '/team/kpi',
        icon: <IconTrophy size={15} />,
        label: t('nav.team_kpi'),
        roles: [
          'admin', 'export_manager', 'loading_dept_head', 'loading_dept_head_deputy', 'warehouse_chief',
          'weight_master', 'document_team', 'transport', 'sales_rep', 'finansist',
          'director', 'accountant', 'greenhouse_manager', 'seller', 'boss',
        ] as import('@/types').UserRole[],
      },
```

Ensure `IconTrophy` is imported at the top of `AppLayout.tsx` alongside the other `@tabler/icons-react` imports (e.g. `IconClock`). If `IconTrophy` is not available in the installed icon set, use `IconAward` or `IconChartBar` instead — pick whichever exists (grep the existing import line for the set name and confirm).

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0`
Expected: no errors.

- [ ] **Step 6: Verify i18n completeness**

Run: `cd frontend && node -e "const tk=require('./src/i18n/tk.json'),ru=require('./src/i18n/ru.json'),en=require('./src/i18n/en.json'); for (const k of Object.keys(en.team_kpi)) { if(!tk.team_kpi?.[k]||!ru.team_kpi?.[k]) throw new Error('missing '+k); } if(!tk.nav.team_kpi||!ru.nav.team_kpi||!en.nav.team_kpi) throw new Error('missing nav.team_kpi'); console.log('i18n OK');"`
Expected: `i18n OK`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/team/TeamKpi.tsx frontend/src/App.tsx frontend/src/components/AppLayout.tsx frontend/src/i18n/tk.json frontend/src/i18n/ru.json frontend/src/i18n/en.json
git commit -m "feat(frontend): team KPI leaderboard page, route, sidebar entry

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Docs + changelog

**Files:**
- Modify: `.claude/rules/api-contract.md` (document the new endpoint)
- Modify: `CHANGELOG.md`
- Modify: `docs/obsidian/` — add/update the relevant endpoint + page doc (see `docs/obsidian/00-index.md` for placement)

- [ ] **Step 1: Document the endpoint in api-contract.md**

Add a section under the Me/KPI area describing `GET /api/v1/core/team-kpi/?period=today|week|month|season`, its response shape (`{period, results:[{user_id, user_name, role, completed, on_time_rate, overdue_now, active_seconds}]}`), the "overdue_now is role-based and window-independent" caveat, the 60 s cache keyed by period, and the public (no role gate) access rule.

- [ ] **Step 2: Update the Obsidian vault**

Per `CLAUDE.md`, add the new endpoint + page to `docs/obsidian/`. Check `docs/obsidian/00-index.md` for the correct file (API endpoints doc + a page doc for `/team/kpi`), and note the `Task.completed_by` field on the Task model doc.

- [ ] **Step 3: Update CHANGELOG.md**

Under `## [Unreleased] → ### Added`:
```markdown
- Team KPI leaderboard page (/team/kpi) — per-user tasks-completed ranking with on-time %, overdue-now, active hours, period switcher (feat)
- GET /api/v1/core/team-kpi/ endpoint — public, 60s cache (feat(core))
```
Under `### Changed`:
```markdown
- Task model: added completed_by FK; populated at all five completion sites for per-user attribution (db)
```

- [ ] **Step 4: Log the build for testing**

Prepend to `BUILD_TEST_LOG.md`:
```markdown
- [ ] 2026-07-21 — Team KPI leaderboard (Task.completed_by + /team/kpi page) — NEEDS TEST
```

- [ ] **Step 5: Commit**

```bash
git add .claude/rules/api-contract.md CHANGELOG.md BUILD_TEST_LOG.md docs/obsidian/
git commit -m "docs(p3): document team KPI leaderboard endpoint + page

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Attribution model (`completed_by` at 5 sites) → Tasks 1-3. ✓
- Forward-only / "no user → nobody" → Task 2 `test_resolve_no_user_credits_nobody`. ✓
- API endpoint + period windowing + on-time formula + role-based overdue + zeros + cache → Tasks 4-5. ✓
- Public access → Task 5 `test_requires_auth` + IsAuthenticated only. ✓
- Frontend page/hook/types/sidebar/i18n → Tasks 6-7. ✓
- Worklog kept, active hours as context column → Task 7 columns. ✓
- Out-of-scope items (comment-tasks, per-role grouping, backfill, avg-duration) → not implemented, correct. ✓
- Bulk-write risk (spec Risk 3) → resolved in planning: JOIN path (`views.py:2107`) uses `.update()` (bypasses resolution, no attribution needed); SWAP path (`views.py:2353`) uses `.save()` (resolution runs, `updated_by` already set → credited by Task 2's change). No separate task required.

**Placeholder scan:** No TBD/TODO. Every code step shows full code. The one deliberate lookup ("copy the FK-setup block from `tests_sales_report_task.py`") points at a concrete existing file rather than hand-waving a fixture.

**Type consistency:** `completed_by` FK + `completed_tasks` reverse accessor used consistently (Tasks 1-4). Service keys `{user_id, user_name, role, completed, on_time_rate, overdue_now, active_seconds}` match the serializer response test (Task 5), the TS `ITeamKpiRow` (Task 6), and the page columns (Task 7). `TeamKpiPeriod` values match `_VALID_PERIODS`. `parse_period`/`period_window`/`compute_team_kpi` signatures consistent across Tasks 4-5.
