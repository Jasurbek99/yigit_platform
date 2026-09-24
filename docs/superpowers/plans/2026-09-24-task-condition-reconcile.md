# Task Condition Re-evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a shipment's `is_gapy_satys` or `has_peregruz` field changes after the shipment has already entered a step, re-decide which Tasks apply to it — cancel the ones whose rule no longer matches, create the ones that now do, and tell the affected roles.

**Architecture:** One new pure service function, `reconcile_shipment_tasks(shipment, changed_fields, steps)`, in `apps/export/services/task_rules.py`. It returns the created / cancelled / reopened Task lists and writes nothing else. `ShipmentViewSet.partial_update` calls it after `serializer.save()` and hands the result to a new `notify_tasks_changed()` in `services/shipment.py`. The reconciler deliberately never calls `auto_advance_if_ready` — a checkbox must not move a truck. Task rows gain a `cancelled_reason` column so "the rule stopped applying" is distinguishable from "a human cancelled this", which is what makes the reopen branch safe and what the owner's later rework analytics will read.

**Tech Stack:** Django 5 / DRF on MSSQL (SQLite in tests), React 18 + antd + TanStack Query, vitest, `manage.py test`.

**Spec:** [`docs/superpowers/specs/2026-09-24-task-condition-reconcile-design.md`](../specs/2026-09-24-task-condition-reconcile-design.md)

Sequencing context (why this is first of four, and what comes after): [`docs/superpowers/specs/2026-09-24-task-lifecycle-roadmap.md`](../specs/2026-09-24-task-lifecycle-roadmap.md)

## Global Constraints

- **MSSQL:** no `JSONField`, no `ArrayField`, no `.distinct('field')`, every `bulk_create`/`bulk_update` gets an explicit `batch_size=500`.
- **`CharField` needs `max_length`.** `cancelled_reason` is `max_length=24`. No `db_collation` on it — the values are ASCII enum codes, not Cyrillic free text.
- **Status transitions only through `transition_to()`.** Nothing in this plan writes `shipment.status_id`, and the reconciler never calls `auto_advance_if_ready()`.
- **No Django signals.** Wiring is explicit function calls at the view layer.
- **`models/` is a package** — `TaskCancelReason` must be added to both the `from .task import ...` line and `__all__` in `backend/apps/export/models/__init__.py`, or migrations silently break.
- **Dependency direction** `core ← greenhouse ← export`. No reverse imports.
- **Migration numbers are not fixed in this plan.** Parallel sessions share this tree. Before `makemigrations`, run `ls backend/apps/export/migrations/ | tail -3` **and** `git log --oneline origin/main -5`. The last committed migration when this plan was written was `0077_gapy_driver_passports`, so the expected name is `0078_task_cancelled_reason` — verify, don't assume.
- **Never commit or push without the user saying "commit".** Each task's commit step is written out so it is ready to run, but wait for the word.
- **Closed seasons are frozen.** Every new code path checks `shipment.season.closed_at is None`.
- **Frontend type-check** is `npx tsc --noEmit --ignoreDeprecations 5.0` — `npm run type-check` is broken with TS5103.
- **i18n is three files**, always together: `frontend/src/i18n/en.json`, `ru.json`, `tk.json`.

## Review Focus

Input classes the spec implies that no task's happy-path test would otherwise exercise. Each has a test assigned to the task that owns the code.

1. **A rule whose `condition_value` has the wrong case** (`'true'` instead of `'True'`) matches nothing, so the reconciler cancels every task at that step and creates none — leaving the step auto-advance eligible. Once the rule editor lets admins type values this is one typo away. Pinned in Task 2, Step 9 (the warning log is the only defence and must fire).
2. **Two condition fields changed in one PATCH** (`is_gapy_satys` and `has_peregruz` together). Both rule families must be reconciled in one pass, not just the first. Pinned in Task 3, Step 7.
3. **A shipment with no tasks at all** — imported by `import_sheet_shipments`, which bypasses `Shipment.save()`. A condition-field PATCH must create the matching tasks rather than crash on an empty task set. Pinned in Task 2, Step 11.
4. **A cancelled shipment.** `_cancel_open_tasks` bulk-cancelled everything with `shipment_cancelled`; a later PATCH must not resurrect any of it. Pinned in Task 1, Step 9.
5. **A `PATCH` that changes nothing relevant** — the overwhelmingly common case. It must perform zero writes and send zero notifications, or every Sheet cell edit spams three roles. Pinned in Task 3, Step 9.

---

### Task 1: `cancelled_reason` column and its two existing writers

Adds the column, the enum, and makes the two places that already cancel tasks say why. No behaviour change yet — this task exists on its own so the column is in the DB and correctly populated before anything reads it.

**Files:**
- Modify: `backend/apps/export/models/task.py` (add `TaskCancelReason` near `TaskState`, add the field after `blocked_by`)
- Modify: `backend/apps/export/models/__init__.py:55,112`
- Modify: `backend/apps/export/services/shipment.py:354-370` (`_cancel_open_tasks`)
- Modify: `backend/apps/export/views.py:4455-4478` (`TaskViewSet.cancel`)
- Create: `backend/apps/export/migrations/0078_task_cancelled_reason.py` (generated; verify the number first)
- Create: `backend/apps/export/tests_task_cancel_reason.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `TaskCancelReason` (a `models.TextChoices` with members `MANUAL`, `SHIPMENT_CANCELLED`, `RULE_MISMATCH`, `RULE_DEACTIVATED`, values `'manual'`, `'shipment_cancelled'`, `'rule_mismatch'`, `'rule_deactivated'`), importable as `from apps.export.models import TaskCancelReason`; and `Task.cancelled_reason: str` (default `''`).

- [ ] **Step 1: Write the failing test**

Create `backend/apps/export/tests_task_cancel_reason.py`:

```python
"""Tests for Task.cancelled_reason and the two existing cancel paths.

Covers:
  - The enum values and the column default.
  - _cancel_open_tasks writes 'shipment_cancelled'.
  - TaskViewSet.cancel writes 'manual'.
  - A cancelled shipment's tasks are never resurrected (Review Focus 4).
"""
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import Season, ShipmentStatusType, User
from apps.export.models import (
    Shipment,
    Task,
    TaskCancelReason,
    TaskCompletionRule,
    TaskRule,
    TaskState,
)


def _make_user(username: str, role: str, is_superuser: bool = False) -> User:
    user = User(username=username, role=role, is_superuser=is_superuser)
    user.set_password('pass')
    user.save()
    return user


def _make_season(name: str = 'cancel-reason-test') -> Season:
    season, _ = Season.objects.get_or_create(
        name=name,
        defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': False},
    )
    return season


def _make_status(code: str = 'draft', step_order: int = 0) -> ShipmentStatusType:
    status, _ = ShipmentStatusType.objects.get_or_create(
        code=code,
        defaults={
            'name_tk': code, 'name_en': code, 'name_ru': code,
            'step_order': step_order, 'phase': 'DRAFT',
        },
    )
    return status


def _make_shipment(shipment_code: str, status_code: str = 'draft') -> Shipment:
    ship, _ = Shipment.objects.get_or_create(
        shipment_code=shipment_code,
        defaults={
            'date': '2026-01-15',
            'season': _make_season(),
            'status': _make_status(status_code),
        },
    )
    return ship


def _make_rule(**kwargs) -> TaskRule:
    defaults = {
        'step': 'draft',
        'title_key': 'tasks.cancel_reason_test',
        'assignee_role': 'transport',
        'target_fields': 'driver_name',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'target_value': '',
        'deadline_rule': '',
        'condition_field': '',
        'condition_value': '',
        'is_active': True,
    }
    defaults.update(kwargs)
    return TaskRule.objects.create(**defaults)


def _make_task(shipment: Shipment, rule: TaskRule | None = None, **kwargs) -> Task:
    defaults = {
        'shipment': shipment,
        'step': 'draft',
        'rule': rule,
        'title_key': 'tasks.cancel_reason_test',
        'assignee_role': 'transport',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'target_fields': 'driver_name',
        'target_value': '',
        'state': TaskState.OPEN,
    }
    defaults.update(kwargs)
    return Task.objects.create(**defaults)


class CancelReasonColumnTests(TestCase):
    def test_default_is_blank(self):
        ship = _make_shipment('0101001/26')
        task = _make_task(ship, _make_rule())
        self.assertEqual(task.cancelled_reason, '')

    def test_enum_values(self):
        self.assertEqual(TaskCancelReason.MANUAL, 'manual')
        self.assertEqual(TaskCancelReason.SHIPMENT_CANCELLED, 'shipment_cancelled')
        self.assertEqual(TaskCancelReason.RULE_MISMATCH, 'rule_mismatch')
        self.assertEqual(TaskCancelReason.RULE_DEACTIVATED, 'rule_deactivated')
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd backend && python manage.py test apps.export.tests_task_cancel_reason -v 2`
Expected: FAIL — `ImportError: cannot import name 'TaskCancelReason'`.

- [ ] **Step 3: Add the enum and the field**

In `backend/apps/export/models/task.py`, immediately after the `TaskState` class:

```python
class TaskCancelReason(models.TextChoices):
    """Why a Task was cancelled.

    Distinguishes a human's decision from the engine's. RULE_MISMATCH is the
    only value reconcile_shipment_tasks() will reopen — a task a person
    cancelled by hand, or one cancelled because its shipment was cancelled,
    stays cancelled forever. RULE_DEACTIVATED is written by the rule editor
    (a later spec), never by the reconciler; it is defined here so both
    specs share one column definition.
    """
    MANUAL             = 'manual',             _('Cancelled by a user')
    SHIPMENT_CANCELLED = 'shipment_cancelled', _('Shipment was cancelled')
    RULE_MISMATCH      = 'rule_mismatch',      _('Rule no longer applies')
    RULE_DEACTIVATED   = 'rule_deactivated',   _('Rule was deactivated')
```

In the `Task` model, directly after the `blocked_by` M2M field:

```python
    cancelled_reason = models.CharField(
        max_length=24, blank=True, default='',
        choices=TaskCancelReason.choices,
        help_text="Why this task was cancelled; blank on tasks that were never "
                  "cancelled and on rows cancelled before 2026-09 (unknown, "
                  "not 'manual').",
    )
```

- [ ] **Step 4: Re-export it**

In `backend/apps/export/models/__init__.py`, line 55, extend the import; and add the name to `__all__` after `'TaskKind',`:

```python
from .task import Task, TaskRule, TaskState, TaskCompletionRule, TaskKind, TaskCancelReason
```

```python
    'TaskKind',
    'TaskCancelReason',
```

- [ ] **Step 5: Create and apply the migration**

```bash
cd backend
ls apps/export/migrations/ | tail -3
git log --oneline origin/main -5
python manage.py makemigrations export -n task_cancelled_reason
python manage.py migrate export
python manage.py showmigrations export | tail -3
```

Expected: one migration containing a single `AddField` for `task.cancelled_reason`, applied, shown with `[X]`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend && python manage.py test apps.export.tests_task_cancel_reason -v 2`
Expected: 2 tests PASS.

- [ ] **Step 7: Write the failing tests for the two existing writers**

Append to `backend/apps/export/tests_task_cancel_reason.py`:

```python
class ExistingCancelPathsTests(TestCase):
    def test_cancel_open_tasks_writes_shipment_cancelled(self):
        from apps.export.services.shipment import _cancel_open_tasks

        ship = _make_shipment('0101002/26')
        rule = _make_rule(title_key='tasks.a')
        open_task = _make_task(ship, rule, state=TaskState.OPEN)
        blocked_task = _make_task(
            ship, _make_rule(title_key='tasks.b'), state=TaskState.BLOCKED,
        )
        done_task = _make_task(
            ship, _make_rule(title_key='tasks.c'),
            state=TaskState.DONE, completed_at=timezone.now(),
        )

        updated = _cancel_open_tasks(ship)

        self.assertEqual(updated, 2)
        for task in (open_task, blocked_task):
            task.refresh_from_db()
            self.assertEqual(task.state, TaskState.CANCELLED)
            self.assertEqual(task.cancelled_reason, TaskCancelReason.SHIPMENT_CANCELLED)
        done_task.refresh_from_db()
        self.assertEqual(done_task.state, TaskState.DONE)
        self.assertEqual(done_task.cancelled_reason, '')

    def test_task_cancel_endpoint_writes_manual(self):
        admin = _make_user('cr-admin', 'admin', is_superuser=True)
        ship = _make_shipment('0101003/26')
        task = _make_task(ship, _make_rule(title_key='tasks.d'))

        client = APIClient()
        client.force_authenticate(user=admin)
        response = client.post(f'/api/v1/export/tasks/{task.id}/cancel/')

        self.assertEqual(response.status_code, 200)
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.CANCELLED)
        self.assertEqual(task.cancelled_reason, TaskCancelReason.MANUAL)
```

- [ ] **Step 8: Run them to verify they fail**

Run: `cd backend && python manage.py test apps.export.tests_task_cancel_reason.ExistingCancelPathsTests -v 2`
Expected: both FAIL — `cancelled_reason` is `''` where a reason is asserted.

- [ ] **Step 9: Write the Review-Focus-4 test (cancelled shipment never resurrected)**

Append to the same file:

```python
class CancelledShipmentStaysCancelledTests(TestCase):
    """Review Focus 4: a shipment cancelled wholesale must not come back to life.

    _cancel_open_tasks stamps shipment_cancelled, which is outside the
    rule_mismatch reopen filter by construction. This test is the guard on
    that construction, so a later widening of the filter fails loudly here.
    """

    def test_shipment_cancelled_tasks_are_not_reopened_by_reconcile(self):
        from apps.export.services.shipment import _cancel_open_tasks
        from apps.export.services.task_rules import reconcile_shipment_tasks

        ship = _make_shipment('0101004/26')
        rule = _make_rule(title_key='tasks.e')      # unconditional: always matches
        task = _make_task(ship, rule, state=TaskState.OPEN)

        _cancel_open_tasks(ship)
        task.refresh_from_db()
        self.assertEqual(task.cancelled_reason, TaskCancelReason.SHIPMENT_CANCELLED)

        reconcile_shipment_tasks(ship)

        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.CANCELLED)
        self.assertEqual(task.cancelled_reason, TaskCancelReason.SHIPMENT_CANCELLED)
        self.assertEqual(Task.objects.filter(shipment=ship, rule=rule).count(), 1)

    def test_manually_cancelled_task_is_not_reopened_by_reconcile(self):
        """The spec's other reopen-filter guarantee: a human's cancel is final.

        Separate from the shipment_cancelled case above, because it goes
        through a different writer (TaskViewSet.cancel) and a different
        reason value.
        """
        from apps.export.services.task_rules import reconcile_shipment_tasks

        admin = _make_user('cr-admin-reopen', 'admin', is_superuser=True)
        ship = _make_shipment('0101005/26')
        rule = _make_rule(title_key='tasks.f')   # unconditional: always matches
        task = _make_task(ship, rule, state=TaskState.OPEN)

        client = APIClient()
        client.force_authenticate(user=admin)
        response = client.post(f'/api/v1/export/tasks/{task.id}/cancel/')
        self.assertEqual(response.status_code, 200)
        task.refresh_from_db()
        self.assertEqual(task.cancelled_reason, TaskCancelReason.MANUAL)

        reconcile_shipment_tasks(ship)

        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.CANCELLED)
        self.assertEqual(task.cancelled_reason, TaskCancelReason.MANUAL)
```

Both tests stay red until Task 2 lands. That is intended and is noted in Task 2's steps — do not implement the reconciler here to make it pass.

- [ ] **Step 10: Make the two writers say why**

In `backend/apps/export/services/shipment.py`, `_cancel_open_tasks` — change the bulk update and the import:

```python
    from apps.export.models import Task, TaskState, TaskCancelReason
    return Task.objects.filter(
        shipment=shipment,
        state__in=[TaskState.OPEN, TaskState.IN_PROGRESS, TaskState.BLOCKED],
    ).update(state=TaskState.CANCELLED, cancelled_reason=TaskCancelReason.SHIPMENT_CANCELLED)
```

In `backend/apps/export/views.py`, `TaskViewSet.cancel` — change the import line and the write:

```python
        from apps.export.models import TaskState, TaskCancelReason
```

```python
        task.state = TaskState.CANCELLED
        task.cancelled_reason = TaskCancelReason.MANUAL
        task.save(update_fields=['state', 'cancelled_reason'])
```

- [ ] **Step 11: Run the tests to verify the two writers pass**

Run: `cd backend && python manage.py test apps.export.tests_task_cancel_reason.ExistingCancelPathsTests apps.export.tests_task_cancel_reason.CancelReasonColumnTests -v 2`
Expected: 4 tests PASS. (Both `CancelledShipmentStaysCancelledTests` tests are still red — Task 2 fixes them.)

- [ ] **Step 12: Check nothing else regressed**

Run: `cd backend && python manage.py test apps.export.tests_cancel apps.export.tests_task_api apps.export.tests_task_models -v 0`
Expected: no new failures versus the pre-existing baseline.

- [ ] **Step 13: Commit**

```bash
git add backend/apps/export/models/task.py \
        backend/apps/export/models/__init__.py \
        backend/apps/export/services/shipment.py \
        backend/apps/export/views.py \
        backend/apps/export/migrations/0078_task_cancelled_reason.py \
        backend/apps/export/tests_task_cancel_reason.py
git commit -m "feat(p3): record why a task was cancelled

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `reconcile_shipment_tasks` — the engine

The whole feature's logic, as one pure function that returns what it did and notifies nobody.

**Files:**
- Modify: `backend/apps/export/services/task_rules.py` (new function after `generate_tasks_for_status`, which ends around line 225)
- Create: `backend/apps/export/tests_task_condition_reconcile.py`

**Interfaces:**
- Consumes: `TaskCancelReason` from Task 1.
- Produces:
  ```python
  def reconcile_shipment_tasks(
      shipment,
      changed_fields: Iterable[str] | None = None,
      steps: Iterable[str] | None = None,
  ) -> dict:
      """-> {'created': list[Task], 'cancelled': list[Task], 'reopened': list[Task]}"""
  ```
  Later tasks read exactly those three keys and treat the values as Task lists.

- [ ] **Step 1: Write the failing test for the create + cancel flip**

Create `backend/apps/export/tests_task_condition_reconcile.py`:

```python
"""Tests for reconcile_shipment_tasks (services/task_rules.py).

Covers the Regular <-> Gapy-Satys flip on a shipment already sitting in a step:
tasks whose rule no longer matches are cancelled, tasks whose rule now matches
are created, DONE tasks are never touched, and the reconciler never moves the
shipment's status.
"""
from django.test import TestCase
from django.utils import timezone

from apps.core.models import Season, ShipmentStatusType
from apps.export.models import (
    Shipment,
    Task,
    TaskCancelReason,
    TaskCompletionRule,
    TaskRule,
    TaskState,
)
from apps.export.services.task_rules import reconcile_shipment_tasks


def _make_season(name: str = 'cond-rec-test', closed=False) -> Season:
    season, _ = Season.objects.get_or_create(
        name=name,
        defaults={
            'start_date': '2025-09-01', 'end_date': '2026-06-30',
            'is_active': False,
            'closed_at': timezone.now() if closed else None,
        },
    )
    return season


def _make_status(code: str = 'draft', step_order: int = 0) -> ShipmentStatusType:
    status, _ = ShipmentStatusType.objects.get_or_create(
        code=code,
        defaults={
            'name_tk': code, 'name_en': code, 'name_ru': code,
            'step_order': step_order, 'phase': 'DRAFT',
        },
    )
    return status


def _make_shipment(shipment_code: str, status_code: str = 'draft', **kwargs) -> Shipment:
    defaults = {
        'date': '2026-01-15',
        'season': _make_season(),
        'status': _make_status(status_code),
    }
    defaults.update(kwargs)
    ship, _ = Shipment.objects.get_or_create(
        shipment_code=shipment_code, defaults=defaults,
    )
    return ship


def _make_rule(**kwargs) -> TaskRule:
    defaults = {
        'step': 'draft',
        'title_key': 'tasks.cond_test',
        'assignee_role': 'transport',
        'target_fields': 'driver_name',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'target_value': '',
        'deadline_rule': '',
        'condition_field': '',
        'condition_value': '',
        'is_active': True,
    }
    defaults.update(kwargs)
    return TaskRule.objects.create(**defaults)


def _make_task(shipment: Shipment, rule: TaskRule, **kwargs) -> Task:
    defaults = {
        'shipment': shipment,
        'step': rule.step,
        'rule': rule,
        'title_key': rule.title_key,
        'assignee_role': rule.assignee_role,
        'completion_rule': rule.completion_rule,
        'target_fields': rule.target_fields,
        'target_value': rule.target_value,
        'state': TaskState.OPEN,
    }
    defaults.update(kwargs)
    return Task.objects.create(**defaults)


class GapyFlipTests(TestCase):
    """The Regular <-> Gapy pair, which is the case that motivated the feature."""

    def setUp(self):
        self.regular_rule = _make_rule(
            title_key='tasks.assign_driver',
            condition_field='is_gapy_satys', condition_value='False',
        )
        self.gapy_rule = _make_rule(
            title_key='tasks.assign_driver',
            target_fields='driver_name,driver_2_name',
            condition_field='is_gapy_satys', condition_value='True',
        )

    def test_flip_to_gapy_cancels_regular_and_creates_gapy(self):
        ship = _make_shipment('0201001/26', is_gapy_satys=False)
        regular_task = _make_task(ship, self.regular_rule)

        result = reconcile_shipment_tasks(ship)
        self.assertEqual(result['created'], [])
        self.assertEqual(result['cancelled'], [])

        ship.is_gapy_satys = True
        ship.save(update_fields=['is_gapy_satys'])

        result = reconcile_shipment_tasks(ship, changed_fields=['is_gapy_satys'])

        regular_task.refresh_from_db()
        self.assertEqual(regular_task.state, TaskState.CANCELLED)
        self.assertEqual(regular_task.cancelled_reason, TaskCancelReason.RULE_MISMATCH)

        self.assertEqual(len(result['created']), 1)
        gapy_task = result['created'][0]
        self.assertEqual(gapy_task.rule_id, self.gapy_rule.id)
        self.assertEqual(gapy_task.state, TaskState.OPEN)
        self.assertEqual(gapy_task.target_fields, 'driver_name,driver_2_name')
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd backend && python manage.py test apps.export.tests_task_condition_reconcile -v 2`
Expected: FAIL — `ImportError: cannot import name 'reconcile_shipment_tasks'`.

- [ ] **Step 3: Write the reconciler**

In `backend/apps/export/services/task_rules.py`, after `generate_tasks_for_status`:

```python
_ACTIVE_TASK_STATES = (TaskState.OPEN, TaskState.IN_PROGRESS, TaskState.BLOCKED)


def _empty_reconcile_result() -> dict:
    return {'created': [], 'cancelled': [], 'reopened': []}


def reconcile_shipment_tasks(
    shipment,
    changed_fields: Iterable[str] | None = None,
    steps: Iterable[str] | None = None,
) -> dict:
    """Re-decide which Tasks should exist for this shipment, and why.

    Tasks are generated once, at step entry, from the rules whose condition
    matched the shipment at that moment. But a condition field
    (is_gapy_satys, has_peregruz) is edited on the Sheet long after step
    entry. This function closes that gap.

    Per active rule in scope, exactly one outcome:
      - matches, no Task for (shipment, rule)                  -> create
      - matches, Task CANCELLED with reason rule_mismatch       -> reopen
      - does not match, Task OPEN/IN_PROGRESS/BLOCKED           -> cancel
      - Task DONE                                              -> untouched
      - Task CANCELLED for any other reason                    -> untouched

    DONE is untouched on purpose: the work really was done and the person
    keeps the KPI credit. A task a human cancelled, or one cancelled because
    the shipment was cancelled, is never resurrected — that is what
    cancelled_reason is for.

    This function NEVER calls auto_advance_if_ready(). Cancelling the last
    open auto-task at a step makes that step eligible
    (is_step_trigger_satisfied counts only OPEN/IN_PROGRESS), and advancing
    from here would let a checkbox move a truck, cascading through every
    pre-satisfied step in one save. The shipment advances on its next
    ordinary save instead, through the normal gate. It does call
    resolve_for_shipment() when it created or reopened anything, so a task
    whose targets are already filled closes immediately rather than sitting
    OPEN — same courtesy generate_tasks_for_status() extends.

    Args:
        shipment: Shipment instance with a PK.
        changed_fields: Field keys the caller just wrote. When given, the
            function returns an empty result unless at least one active
            rule conditions on one of them — so an ordinary weight or date
            PATCH costs one small query and no writes. None means
            "reconcile regardless of what changed".
        steps: Status codes whose rules to consider. None means every step
            that has a non-terminal task on this shipment, plus the
            shipment's current step. Scoping to the current step alone would
            miss long-lived earlier-step tasks (tasks.submit_sales_report is
            created at yola_chykdy and lives for days past it).

    Returns:
        {'created': [...], 'cancelled': [...], 'reopened': [...]} of Task
        instances, so the caller can build a notification without a second
        query.
    """
    from apps.export.models import TaskCancelReason

    # Closed seasons are frozen (D1).
    if shipment.season_id and shipment.season.closed_at is not None:
        return _empty_reconcile_result()

    active_rules = list(TaskRule.objects.filter(is_active=True))
    if not active_rules:
        return _empty_reconcile_result()

    # The gate. Cheapest possible early exit for the common PATCH.
    if changed_fields is not None:
        condition_fields = {r.condition_field for r in active_rules if r.condition_field}
        if not condition_fields.intersection(set(changed_fields)):
            return _empty_reconcile_result()

    if steps is None:
        step_set = set(
            shipment.tasks
            .filter(state__in=_ACTIVE_TASK_STATES)
            .values_list('step', flat=True)
        )
        if shipment.status_id:
            step_set.add(shipment.status.code)
    else:
        step_set = set(steps)

    rules = [r for r in active_rules if r.step in step_set]
    if not rules:
        return _empty_reconcile_result()

    # At most one Task per (shipment, rule) — generate_tasks_for_status is
    # keyed on that pair. No DB constraint enforces it, so order by id and
    # let the newest win if a duplicate ever exists.
    tasks_by_rule: dict[int, Task] = {
        task.rule_id: task
        for task in shipment.tasks.filter(
            rule_id__in=[r.id for r in rules]
        ).order_by('id')
    }

    now = timezone.now()
    created: list[Task] = []
    cancelled: list[Task] = []
    reopened: list[Task] = []

    for rule in rules:
        task = tasks_by_rule.get(rule.id)
        matches = _condition_matches(rule, shipment)

        if matches:
            if task is None:
                created.append(Task.objects.create(
                    shipment=shipment,
                    step=rule.step,
                    rule=rule,
                    title_key=rule.title_key,
                    assignee_role=rule.assignee_role,
                    target_fields=rule.target_fields,
                    completion_rule=rule.completion_rule,
                    target_value=rule.target_value,
                    deadline=parse_deadline_rule(rule.deadline_rule, reference=now),
                    deadline_rule=rule.deadline_rule,
                    state=TaskState.OPEN,
                ))
            elif (
                task.state == TaskState.CANCELLED
                and task.cancelled_reason == TaskCancelReason.RULE_MISMATCH
            ):
                task.state = TaskState.OPEN
                task.cancelled_reason = ''
                task.save(update_fields=['state', 'cancelled_reason'])
                reopened.append(task)
        elif task is not None and task.state in _ACTIVE_TASK_STATES:
            task.state = TaskState.CANCELLED
            task.cancelled_reason = TaskCancelReason.RULE_MISMATCH
            task.save(update_fields=['state', 'cancelled_reason'])
            cancelled.append(task)

    if cancelled and not created:
        logger.warning(
            'reconcile_shipment_tasks: shipment %s — cancelled %d task(s) at %s '
            'and created none; those steps may now be auto-advance eligible',
            shipment.shipment_code, len(cancelled),
            sorted({t.step for t in cancelled}),
        )

    if created or reopened:
        # Close anything whose targets are already filled. Deliberately NOT
        # auto_advance_if_ready — see the docstring.
        resolve_for_shipment(shipment)
        for task in created + reopened:
            task.refresh_from_db()

    if created or cancelled or reopened:
        logger.info(
            'reconcile_shipment_tasks: shipment %s — created %d, cancelled %d, reopened %d',
            shipment.shipment_code, len(created), len(cancelled), len(reopened),
        )

    return {'created': created, 'cancelled': cancelled, 'reopened': reopened}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && python manage.py test apps.export.tests_task_condition_reconcile.GapyFlipTests -v 2`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the flip back (reopen, not duplicate)**

Append to `GapyFlipTests`:

```python
    def test_flip_back_reopens_the_same_row(self):
        ship = _make_shipment('0201002/26', is_gapy_satys=False)
        regular_task = _make_task(ship, self.regular_rule)

        ship.is_gapy_satys = True
        ship.save(update_fields=['is_gapy_satys'])
        reconcile_shipment_tasks(ship, changed_fields=['is_gapy_satys'])

        ship.is_gapy_satys = False
        ship.save(update_fields=['is_gapy_satys'])
        result = reconcile_shipment_tasks(ship, changed_fields=['is_gapy_satys'])

        self.assertEqual(len(result['reopened']), 1)
        self.assertEqual(result['reopened'][0].id, regular_task.id)
        self.assertEqual(result['created'], [])
        # Still exactly one row per (shipment, rule) — reopen, never duplicate.
        self.assertEqual(
            Task.objects.filter(shipment=ship, rule=self.regular_rule).count(), 1,
        )

    def test_done_task_is_never_touched(self):
        ship = _make_shipment('0201003/26', is_gapy_satys=False)
        done_task = _make_task(
            ship, self.regular_rule,
            state=TaskState.DONE, completed_at=timezone.now(),
        )

        ship.is_gapy_satys = True
        ship.save(update_fields=['is_gapy_satys'])
        result = reconcile_shipment_tasks(ship, changed_fields=['is_gapy_satys'])

        done_task.refresh_from_db()
        self.assertEqual(done_task.state, TaskState.DONE)
        self.assertEqual(done_task.cancelled_reason, '')
        self.assertEqual(result['cancelled'], [])
```

- [ ] **Step 6: Run them to verify they pass**

Run: `cd backend && python manage.py test apps.export.tests_task_condition_reconcile.GapyFlipTests -v 2`
Expected: 3 tests PASS. The reconciler written in Step 3 already handles both.

- [ ] **Step 7: Write the gate, idempotency, and closed-season tests**

Append to the file:

```python
class GateAndIdempotencyTests(TestCase):
    def test_unrelated_changed_field_does_nothing(self):
        _make_rule(condition_field='is_gapy_satys', condition_value='True')
        ship = _make_shipment('0201010/26', is_gapy_satys=True)

        result = reconcile_shipment_tasks(ship, changed_fields=['weight_net'])

        self.assertEqual(result, {'created': [], 'cancelled': [], 'reopened': []})
        self.assertEqual(Task.objects.filter(shipment=ship).count(), 0)

    def test_none_changed_fields_reconciles_regardless(self):
        rule = _make_rule(condition_field='is_gapy_satys', condition_value='True')
        ship = _make_shipment('0201011/26', is_gapy_satys=True)

        result = reconcile_shipment_tasks(ship, changed_fields=None)

        self.assertEqual(len(result['created']), 1)
        self.assertEqual(result['created'][0].rule_id, rule.id)

    def test_second_call_is_a_no_op(self):
        _make_rule(condition_field='is_gapy_satys', condition_value='True')
        ship = _make_shipment('0201012/26', is_gapy_satys=True)

        first = reconcile_shipment_tasks(ship)
        second = reconcile_shipment_tasks(ship)

        self.assertEqual(len(first['created']), 1)
        self.assertEqual(second, {'created': [], 'cancelled': [], 'reopened': []})

    def test_closed_season_is_skipped(self):
        _make_rule(condition_field='is_gapy_satys', condition_value='True')
        closed = _make_season('cond-rec-closed', closed=True)
        ship = _make_shipment('0201013/26', is_gapy_satys=True, season=closed)

        result = reconcile_shipment_tasks(ship)

        self.assertEqual(result, {'created': [], 'cancelled': [], 'reopened': []})
        self.assertEqual(Task.objects.filter(shipment=ship).count(), 0)

    def test_inactive_rule_is_out_of_scope(self):
        rule = _make_rule(is_active=False)
        ship = _make_shipment('0201014/26')
        task = _make_task(ship, rule)

        result = reconcile_shipment_tasks(ship)

        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.OPEN)
        self.assertEqual(result['cancelled'], [])

    def test_earlier_step_task_is_in_scope(self):
        """tasks.submit_sales_report lives long past the step that created it."""
        late_rule = _make_rule(
            step='yola_chykdy', title_key='tasks.submit_sales_report',
            condition_field='has_peregruz', condition_value='True',
        )
        ship = _make_shipment('0201015/26', status_code='bardy', has_peregruz=False)
        _make_status('yola_chykdy', step_order=5)
        stale = _make_task(ship, late_rule, step='yola_chykdy')

        result = reconcile_shipment_tasks(ship, changed_fields=['has_peregruz'])

        stale.refresh_from_db()
        self.assertEqual(stale.state, TaskState.CANCELLED)
        self.assertEqual(stale.cancelled_reason, TaskCancelReason.RULE_MISMATCH)
        self.assertEqual(len(result['cancelled']), 1)
```

- [ ] **Step 8: Run them to verify they pass**

Run: `cd backend && python manage.py test apps.export.tests_task_condition_reconcile.GateAndIdempotencyTests -v 2`
Expected: 6 tests PASS.

- [ ] **Step 9: Write the Review-Focus-1 test (wrong-case `condition_value` warns)**

Append to the file:

```python
class WrongCaseConditionValueTests(TestCase):
    """Review Focus 1.

    str(True) == 'True'. A rule seeded or typed with condition_value='true'
    matches nothing, so every task at that step is cancelled and none created
    — leaving the step auto-advance eligible. The warning log is the only
    defence; this test is what keeps it there.
    """

    def test_lowercase_true_cancels_everything_and_warns(self):
        bad_rule = _make_rule(
            title_key='tasks.typo_rule',
            condition_field='is_gapy_satys', condition_value='true',
        )
        ship = _make_shipment('0201020/26', is_gapy_satys=True)
        task = _make_task(ship, bad_rule)

        with self.assertLogs('apps.export.services.task_rules', level='WARNING') as cm:
            result = reconcile_shipment_tasks(ship, changed_fields=['is_gapy_satys'])

        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.CANCELLED)
        self.assertEqual(len(result['cancelled']), 1)
        self.assertEqual(result['created'], [])
        self.assertTrue(
            any('created none' in line for line in cm.output),
            f'expected the auto-advance-eligibility warning, got: {cm.output}',
        )
```

- [ ] **Step 10: Run it to verify it passes**

Run: `cd backend && python manage.py test apps.export.tests_task_condition_reconcile.WrongCaseConditionValueTests -v 2`
Expected: PASS — the warning written in Step 3 fires.

- [ ] **Step 11: Write the Review-Focus-3 test (shipment with no tasks at all)**

Append to the file:

```python
class ShipmentWithNoTasksTests(TestCase):
    """Review Focus 3.

    import_sheet_shipments creates shipments in bulk, bypassing
    Shipment.save(), so a live shipment can sit in a step with zero Task
    rows. A condition-field PATCH must create the matching tasks, not crash
    on the empty set.
    """

    def test_creates_tasks_for_a_shipment_that_has_none(self):
        matching = _make_rule(
            title_key='tasks.gapy_docs',
            condition_field='is_gapy_satys', condition_value='True',
        )
        _make_rule(
            title_key='tasks.regular_docs',
            condition_field='is_gapy_satys', condition_value='False',
        )
        ship = _make_shipment('0201030/26', is_gapy_satys=True)
        self.assertEqual(Task.objects.filter(shipment=ship).count(), 0)

        result = reconcile_shipment_tasks(ship, changed_fields=['is_gapy_satys'])

        self.assertEqual(len(result['created']), 1)
        self.assertEqual(result['created'][0].rule_id, matching.id)
        self.assertEqual(result['cancelled'], [])
```

- [ ] **Step 12: Run it to verify it passes**

Run: `cd backend && python manage.py test apps.export.tests_task_condition_reconcile.ShipmentWithNoTasksTests -v 2`
Expected: PASS.

- [ ] **Step 13: Verify Task 1's deferred test now passes, and run the whole engine suite**

```bash
cd backend
python manage.py test apps.export.tests_task_cancel_reason -v 2
python manage.py test apps.export.tests_task_condition_reconcile apps.export.tests_task_engine apps.export.tests_task_reconcile apps.export.tests_auto_advance -v 0
```
Expected: `tests_task_cancel_reason` now 6/6 PASS (both `CancelledShipmentStaysCancelledTests` tests included); no new failures in the engine suites.

- [ ] **Step 14: Commit**

```bash
git add backend/apps/export/services/task_rules.py \
        backend/apps/export/tests_task_condition_reconcile.py
git commit -m "feat(p3): re-decide a shipment's tasks when a condition field changes

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Wire the reconciler into the shipment PATCH

**Files:**
- Modify: `backend/apps/export/views.py:719-723` (`ShipmentViewSet.partial_update`, right after the `mark_started_for_changed_fields` call)
- Create: `backend/apps/export/tests_task_condition_reconcile_api.py`

**Interfaces:**
- Consumes: `reconcile_shipment_tasks(shipment, changed_fields=..., steps=None) -> dict` from Task 2.
- Produces: the PATCH endpoint now reconciles. No new function.

- [ ] **Step 1: Write the failing test — the PATCH flips the task set**

Create `backend/apps/export/tests_task_condition_reconcile_api.py`:

```python
"""Tests that PATCHing a condition field re-decides the shipment's tasks.

The engine itself is covered in tests_task_condition_reconcile.py. This file
covers the wiring: that the view calls it, with the submitted keys as the gate,
and that doing so never moves the shipment's status.
"""
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import Season, ShipmentStatusType, User
from apps.export.models import (
    Shipment,
    ShipmentStatusLog,
    Task,
    TaskCancelReason,
    TaskCompletionRule,
    TaskRule,
    TaskState,
)


def _make_user(username: str, role: str, is_superuser: bool = False) -> User:
    user = User(username=username, role=role, is_superuser=is_superuser)
    user.set_password('pass')
    user.save()
    return user


def _make_season(name: str = 'cond-api-test') -> Season:
    season, _ = Season.objects.get_or_create(
        name=name,
        defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True},
    )
    return season


def _make_status(code: str, step_order: int, phase: str = 'DRAFT') -> ShipmentStatusType:
    status, _ = ShipmentStatusType.objects.get_or_create(
        code=code,
        defaults={
            'name_tk': code, 'name_en': code, 'name_ru': code,
            'step_order': step_order, 'phase': phase,
        },
    )
    return status


def _make_rule(**kwargs) -> TaskRule:
    defaults = {
        'step': 'draft',
        'title_key': 'tasks.cond_api_test',
        'assignee_role': 'transport',
        'target_fields': 'driver_name',
        'completion_rule': TaskCompletionRule.MANUAL_DONE,
        'target_value': '',
        'deadline_rule': '',
        'condition_field': '',
        'condition_value': '',
        'is_active': True,
    }
    defaults.update(kwargs)
    return TaskRule.objects.create(**defaults)


class PatchReconcilesTests(TestCase):
    def setUp(self):
        _make_status('draft', 0)
        self.admin = _make_user('cond-api-admin', 'admin', is_superuser=True)
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

        self.regular_rule = _make_rule(
            title_key='tasks.assign_driver',
            condition_field='is_gapy_satys', condition_value='False',
        )
        self.gapy_rule = _make_rule(
            title_key='tasks.assign_driver',
            condition_field='is_gapy_satys', condition_value='True',
        )
        self.shipment = Shipment.objects.create(
            shipment_code='0301001/26',
            date='2026-01-15',
            season=_make_season(),
            status=_make_status('draft', 0),
            is_gapy_satys=False,
        )
        self.regular_task = Task.objects.create(
            shipment=self.shipment, step='draft', rule=self.regular_rule,
            title_key='tasks.assign_driver', assignee_role='transport',
            completion_rule=TaskCompletionRule.MANUAL_DONE,
            target_fields='driver_name', target_value='',
            state=TaskState.OPEN,
        )

    def test_patching_is_gapy_satys_swaps_the_task_set(self):
        response = self.client.patch(
            f'/api/v1/export/shipments/{self.shipment.id}/',
            {'is_gapy_satys': True}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)

        self.regular_task.refresh_from_db()
        self.assertEqual(self.regular_task.state, TaskState.CANCELLED)
        self.assertEqual(self.regular_task.cancelled_reason, TaskCancelReason.RULE_MISMATCH)
        self.assertTrue(
            Task.objects.filter(
                shipment=self.shipment, rule=self.gapy_rule, state=TaskState.OPEN,
            ).exists()
        )
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd backend && python manage.py test apps.export.tests_task_condition_reconcile_api.PatchReconcilesTests -v 2`
Expected: FAIL — the regular task is still `OPEN`, no gapy task exists.

- [ ] **Step 3: Wire it in**

The reconcile **must be inside** the existing `with transaction.atomic():`
block, not after it. The field write and the task churn are one fact: if the
reconcile fails after the field committed, the shipment says Gapy while its
tasks say Regular — precisely the broken state this feature exists to remove,
newly reachable through a transient DB error. `mark_started_for_changed_fields`
staying outside is fine by contrast: it only stamps `started_at`, and losing
that is cosmetic.

The **notification stays outside** the block. `bulk_create`ing notifications
inside a transaction that can still roll back would tell three roles about a
change that then un-happened.

In `backend/apps/export/views.py`, in `partial_update`, add the reconcile as the
last statement inside the `atomic()` block and initialise its result before the
block so it is readable after:

```python
        # Capture only the fields the user actually submitted.
        submitted_keys = list(serializer.validated_data.keys())
        before = snapshot_fields(shipment, submitted_keys)
        reconcile_result = {'created': [], 'cancelled': [], 'reopened': []}

        with transaction.atomic():
            # Set updated_by so Shipment.save() → auto_advance_if_ready() has
            # a user to credit for any auto-transition this PATCH triggers.
            serializer.save(updated_by=request.user)
            # Reload from DB so computed fields (auto_now timestamps, DB defaults) are fresh.
            instance = serializer.instance
            instance.refresh_from_db()
            after = snapshot_fields(instance, submitted_keys)

            audit_rows = diff_audit_rows(instance, before, after, request.user)
            if audit_rows:
                AuditLog.objects.bulk_create(audit_rows, batch_size=500)

            # A condition field (is_gapy_satys, has_peregruz) may have just
            # changed, which changes WHICH tasks apply to this shipment. Inside
            # the transaction so the field write and the task churn commit
            # together. submitted_keys is the gate: reconcile_shipment_tasks
            # returns immediately when no active rule conditions on any of them.
            # It never calls auto_advance_if_ready, so a checkbox cannot move
            # the shipment — see its docstring.
            from apps.export.services.task_rules import reconcile_shipment_tasks
            reconcile_result = reconcile_shipment_tasks(
                instance, changed_fields=submitted_keys,
            )
```

Then, after the block, leave `mark_started_for_changed_fields` where it is and
add the notification below it:

```python
        # Mark OPEN tasks targeting any of the submitted fields as IN_PROGRESS.
        # Must happen AFTER save so Shipment.save() auto-resolution runs first
        # (tasks that are already DONE won't be touched here).
        from apps.export.services.task_rules import mark_started_for_changed_fields
        mark_started_for_changed_fields(instance, submitted_keys)

        # Outside the transaction on purpose: nobody should be told about a
        # task change that then rolled back.
        from apps.export.services.shipment import notify_tasks_changed
        notify_tasks_changed(instance, reconcile_result)
```

`notify_tasks_changed` lands in Task 4. For this task, add a temporary no-op so the wiring is testable on its own — Task 4 replaces the body:

In `backend/apps/export/services/shipment.py`, after `_notify_action_required`:

```python
def notify_tasks_changed(shipment: Shipment, reconcile_result: dict) -> int:
    """Placeholder — implemented in Task 4. Returns notifications created."""
    return 0
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && python manage.py test apps.export.tests_task_condition_reconcile_api.PatchReconcilesTests -v 2`
Expected: PASS.

- [ ] **Step 5: Write the failing test — the PATCH must not move the status**

Append to `PatchReconcilesTests`:

```python
    def test_reconcile_never_moves_the_status(self):
        """The regression test for the whole Safety section of the spec.

        The regular task is the only open auto-task at `draft`. Cancelling it
        makes the step trigger-satisfied (is_step_trigger_satisfied counts only
        OPEN/IN_PROGRESS). If the reconciler called auto_advance_if_ready, this
        PATCH would push the shipment to gumruk_girish.
        """
        _make_status('gumruk_girish', 1, phase='CUSTOMS')
        # An auto-resolving rule, so the step is a real auto-advance candidate.
        self.regular_rule.completion_rule = TaskCompletionRule.ALL_FIELDS_FILLED
        self.regular_rule.save(update_fields=['completion_rule'])
        self.regular_task.completion_rule = TaskCompletionRule.ALL_FIELDS_FILLED
        self.regular_task.save(update_fields=['completion_rule'])
        # The gapy rule is MANUAL_DONE, so nothing replaces the cancelled gate.
        log_count_before = ShipmentStatusLog.objects.filter(
            shipment=self.shipment,
        ).count()

        response = self.client.patch(
            f'/api/v1/export/shipments/{self.shipment.id}/',
            {'is_gapy_satys': True}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)

        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.status.code, 'draft')
        self.assertEqual(
            ShipmentStatusLog.objects.filter(shipment=self.shipment).count(),
            log_count_before,
        )
```

- [ ] **Step 6: Run it to verify it passes**

Run: `cd backend && python manage.py test apps.export.tests_task_condition_reconcile_api.PatchReconcilesTests.test_reconcile_never_moves_the_status -v 2`
Expected: PASS — the reconciler written in Task 2 never advances.

- [ ] **Step 7: Write the Review-Focus-2 test (two condition fields in one PATCH)**

Append to the file:

```python
class TwoConditionFieldsInOnePatchTests(TestCase):
    """Review Focus 2.

    One PATCH can carry both is_gapy_satys and has_peregruz. Both rule
    families must be reconciled in the same pass, not just whichever the
    gate happened to match first.
    """

    def test_both_families_reconcile(self):
        _make_status('draft', 0)
        admin = _make_user('cond-api-two', 'admin', is_superuser=True)
        client = APIClient()
        client.force_authenticate(user=admin)

        gapy_false = _make_rule(
            title_key='tasks.regular_driver',
            condition_field='is_gapy_satys', condition_value='False',
        )
        peregruz_false = _make_rule(
            title_key='tasks.direct_arrival',
            condition_field='has_peregruz', condition_value='False',
        )
        gapy_true = _make_rule(
            title_key='tasks.gapy_driver',
            condition_field='is_gapy_satys', condition_value='True',
        )
        peregruz_true = _make_rule(
            title_key='tasks.transshipment',
            condition_field='has_peregruz', condition_value='True',
        )

        shipment = Shipment.objects.create(
            shipment_code='0301002/26', date='2026-01-15',
            season=_make_season(), status=_make_status('draft', 0),
            is_gapy_satys=False, has_peregruz=False,
        )
        old_tasks = [
            Task.objects.create(
                shipment=shipment, step='draft', rule=rule,
                title_key=rule.title_key, assignee_role=rule.assignee_role,
                completion_rule=TaskCompletionRule.MANUAL_DONE,
                target_fields=rule.target_fields, target_value='',
                state=TaskState.OPEN,
            )
            for rule in (gapy_false, peregruz_false)
        ]

        response = client.patch(
            f'/api/v1/export/shipments/{shipment.id}/',
            {'is_gapy_satys': True, 'has_peregruz': True}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)

        for task in old_tasks:
            task.refresh_from_db()
            self.assertEqual(task.state, TaskState.CANCELLED, task.title_key)
            self.assertEqual(task.cancelled_reason, TaskCancelReason.RULE_MISMATCH)

        for rule in (gapy_true, peregruz_true):
            self.assertTrue(
                Task.objects.filter(
                    shipment=shipment, rule=rule, state=TaskState.OPEN,
                ).exists(),
                f'no task created for {rule.title_key}',
            )
```

- [ ] **Step 8: Run it to verify it passes**

Run: `cd backend && python manage.py test apps.export.tests_task_condition_reconcile_api.TwoConditionFieldsInOnePatchTests -v 2`
Expected: PASS.

- [ ] **Step 9: Write the Review-Focus-5 test (an ordinary PATCH writes nothing)**

Append to the file:

```python
class OrdinaryPatchIsFreeTests(TestCase):
    """Review Focus 5.

    The overwhelmingly common PATCH touches no condition field. It must not
    write to any Task row — otherwise every Sheet cell edit churns tasks and
    spams three roles.
    """

    def test_patching_an_unrelated_field_touches_no_task(self):
        _make_status('draft', 0)
        admin = _make_user('cond-api-plain', 'admin', is_superuser=True)
        client = APIClient()
        client.force_authenticate(user=admin)

        rule = _make_rule(
            title_key='tasks.regular_driver',
            condition_field='is_gapy_satys', condition_value='False',
        )
        shipment = Shipment.objects.create(
            shipment_code='0301003/26', date='2026-01-15',
            season=_make_season(), status=_make_status('draft', 0),
            is_gapy_satys=False,
        )
        task = Task.objects.create(
            shipment=shipment, step='draft', rule=rule,
            title_key=rule.title_key, assignee_role='transport',
            completion_rule=TaskCompletionRule.MANUAL_DONE,
            target_fields='driver_name', target_value='',
            state=TaskState.OPEN,
        )
        state_before = (task.state, task.cancelled_reason)
        count_before = Task.objects.filter(shipment=shipment).count()

        # `notes` is in the Sheet's patchable field set and no rule conditions
        # on it — verified against serializers.py. Any other patchable
        # non-condition field would do; the point is "a field no rule cares
        # about".
        response = client.patch(
            f'/api/v1/export/shipments/{shipment.id}/',
            {'notes': 'ordinary edit'}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)

        task.refresh_from_db()
        self.assertEqual((task.state, task.cancelled_reason), state_before)
        self.assertEqual(Task.objects.filter(shipment=shipment).count(), count_before)
```

- [ ] **Step 10: Run it to verify it passes**

Run: `cd backend && python manage.py test apps.export.tests_task_condition_reconcile_api.OrdinaryPatchIsFreeTests -v 2`
Expected: PASS.

- [ ] **Step 11: Run the surrounding suites**

Run: `cd backend && python manage.py test apps.export.tests_shipment_sheet apps.export.tests_sheet_perms apps.export.tests_auto_advance apps.export.tests_draft_promote -v 0`
Expected: no new failures versus baseline.

- [ ] **Step 12: Commit**

```bash
git add backend/apps/export/views.py \
        backend/apps/export/services/shipment.py \
        backend/apps/export/tests_task_condition_reconcile_api.py
git commit -m "feat(p3): reconcile tasks on shipment PATCH

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `tasks_changed` notification

**Files:**
- Modify: `backend/apps/export/models/notification.py:40-55` (`KIND_CHOICES`)
- Modify: `backend/apps/export/services/shipment.py` (replace the `notify_tasks_changed` placeholder from Task 3)
- Create: `backend/apps/export/migrations/0079_notification_tasks_changed_kind.py` (generated; verify the number)
- Create: `backend/apps/export/tests_tasks_changed_notification.py`

**Interfaces:**
- Consumes: the `{'created': [...], 'cancelled': [...], 'reopened': [...]}` dict from Task 2; `STATUS_NOTIFY_ROLES` already in `services/shipment.py:114`.
- Produces: `notify_tasks_changed(shipment, reconcile_result: dict) -> int` (number of `Notification` rows created).

- [ ] **Step 1: Write the failing test**

Create `backend/apps/export/tests_tasks_changed_notification.py`:

```python
"""Tests for notify_tasks_changed (services/shipment.py).

Recipients are the roles owning the affected tasks, union the roles
STATUS_NOTIFY_ROLES already pings for the shipment's current step. For a
Gapy flip on a draft that is transport + document_team + export_manager.
"""
from django.test import TestCase

from apps.core.models import Season, ShipmentStatusType, User
from apps.export.models import (
    Notification,
    Shipment,
    Task,
    TaskCompletionRule,
    TaskRule,
    TaskState,
)
from apps.export.services.shipment import notify_tasks_changed


def _make_user(username: str, role: str) -> User:
    user = User(username=username, role=role)
    user.set_password('pass')
    user.save()
    return user


def _make_shipment(code: str) -> Shipment:
    season, _ = Season.objects.get_or_create(
        name='notif-test',
        defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True},
    )
    status, _ = ShipmentStatusType.objects.get_or_create(
        code='draft',
        defaults={
            'name_tk': 'draft', 'name_en': 'draft', 'name_ru': 'draft',
            'step_order': 0, 'phase': 'DRAFT',
        },
    )
    return Shipment.objects.create(
        shipment_code=code, date='2026-01-15', season=season, status=status,
    )


def _make_task(shipment, role: str, title_key: str) -> Task:
    rule = TaskRule.objects.create(
        step='draft', title_key=title_key, assignee_role=role,
        target_fields='driver_name',
        completion_rule=TaskCompletionRule.MANUAL_DONE,
        target_value='', deadline_rule='',
        condition_field='', condition_value='', is_active=True,
    )
    return Task.objects.create(
        shipment=shipment, step='draft', rule=rule, title_key=title_key,
        assignee_role=role, completion_rule=TaskCompletionRule.MANUAL_DONE,
        target_fields='driver_name', target_value='', state=TaskState.OPEN,
    )


class NotifyTasksChangedTests(TestCase):
    def setUp(self):
        self.transport = _make_user('n-transport', 'transport')
        self.doc_team = _make_user('n-docteam', 'document_team')
        self.export_mgr = _make_user('n-exportmgr', 'export_manager')
        self.sales = _make_user('n-sales', 'sales_rep')
        self.shipment = _make_shipment('0401001/26')

    def test_notifies_affected_roles_plus_step_roles(self):
        created = [_make_task(self.shipment, 'transport', 'tasks.gapy_driver')]
        cancelled = [_make_task(self.shipment, 'document_team', 'tasks.give_documents')]

        count = notify_tasks_changed(
            self.shipment,
            {'created': created, 'cancelled': cancelled, 'reopened': []},
        )

        self.assertEqual(count, 3)
        notified = set(
            Notification.objects.filter(kind='tasks_changed')
            .values_list('user__role', flat=True)
        )
        self.assertEqual(notified, {'transport', 'document_team', 'export_manager'})

    def test_empty_result_notifies_nobody(self):
        count = notify_tasks_changed(
            self.shipment, {'created': [], 'cancelled': [], 'reopened': []},
        )
        self.assertEqual(count, 0)
        self.assertFalse(Notification.objects.filter(kind='tasks_changed').exists())

    def test_message_names_the_shipment_and_link_points_at_it(self):
        created = [_make_task(self.shipment, 'transport', 'tasks.gapy_driver')]

        notify_tasks_changed(
            self.shipment, {'created': created, 'cancelled': [], 'reopened': []},
        )

        notification = Notification.objects.filter(kind='tasks_changed').first()
        self.assertIn(self.shipment.shipment_code, notification.message)
        self.assertEqual(notification.link, f'/shipments/{self.shipment.id}')
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd backend && python manage.py test apps.export.tests_tasks_changed_notification -v 2`
Expected: FAIL — the placeholder returns 0 and creates nothing.

- [ ] **Step 3: Add the notification kind**

In `backend/apps/export/models/notification.py`, in `KIND_CHOICES`, after the `('task_done', 'Task done'),` line:

```python
        # Written by reconcile_shipment_tasks via notify_tasks_changed: a
        # condition field changed, so which tasks apply to this shipment
        # changed too.
        ('tasks_changed', 'Tasks changed'),
```

- [ ] **Step 4: Create and apply the migration**

```bash
cd backend
ls apps/export/migrations/ | tail -3
python manage.py makemigrations export -n notification_tasks_changed_kind
python manage.py migrate export
```
Expected: one `AlterField` on `notification.kind`, applied.

- [ ] **Step 5: Implement `notify_tasks_changed`**

In `backend/apps/export/services/shipment.py`, replace the Task 3 placeholder:

```python
def notify_tasks_changed(shipment: Shipment, reconcile_result: dict) -> int:
    """Tell the affected roles that this shipment's task set changed.

    Recipients are the roles that own the created / cancelled / reopened
    tasks, union the roles STATUS_NOTIFY_ROLES already pings for the
    shipment's current step. The union matters: on a Gapy flip the owners of
    the affected tasks are transport and document_team, but export_manager
    also needs to know, and it is in the draft step's notify list — so the
    right three roles fall out without hard-coding them.

    Known wart, shared with _notify_action_required: the actor is notified
    too, because neither helper takes a user. Since the reconcile is silent
    by design (no confirmation modal), that self-ping is in fact the editing
    manager's only feedback.

    Returns:
        Number of Notification rows created.
    """
    from apps.core.models import User
    from apps.export.models import Notification

    affected = (
        reconcile_result.get('created', [])
        + reconcile_result.get('cancelled', [])
        + reconcile_result.get('reopened', [])
    )
    if not affected:
        return 0

    roles = {task.assignee_role for task in affected if task.assignee_role}
    if shipment.status_id:
        roles.update(STATUS_NOTIFY_ROLES.get(shipment.status.code, []))
    if not roles:
        return 0

    user_ids = list(
        User.objects.filter(role__in=roles, is_active=True)
        .values_list('id', flat=True)
    )
    if not user_ids:
        return 0

    counts = (
        f"+{len(reconcile_result.get('created', []))} "
        f"-{len(reconcile_result.get('cancelled', []))} "
        f"~{len(reconcile_result.get('reopened', []))}"
    )
    message = f'{shipment.shipment_code}: {counts}'
    Notification.objects.bulk_create(
        [
            Notification(
                user_id=uid,
                kind='tasks_changed',
                message=message,
                link=f'/shipments/{shipment.id}',
            )
            for uid in user_ids
        ],
        batch_size=500,
    )
    logger.info(
        'notify_tasks_changed: %d notifications for %s (roles: %s)',
        len(user_ids), shipment.shipment_code, sorted(roles),
    )
    return len(user_ids)
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend && python manage.py test apps.export.tests_tasks_changed_notification -v 2`
Expected: 3 tests PASS.

- [ ] **Step 7: Verify the end-to-end PATCH notifies**

Append to `backend/apps/export/tests_task_condition_reconcile_api.py`, inside `PatchReconcilesTests`:

```python
    def test_patch_sends_one_tasks_changed_notification_per_recipient(self):
        from apps.export.models import Notification

        transport = _make_user('cond-api-transport', 'transport')
        self.assertTrue(transport.is_active)

        self.client.patch(
            f'/api/v1/export/shipments/{self.shipment.id}/',
            {'is_gapy_satys': True}, format='json',
        )

        notifications = Notification.objects.filter(kind='tasks_changed')
        self.assertTrue(notifications.exists())
        self.assertIn(
            'transport',
            set(notifications.values_list('user__role', flat=True)),
        )
```

Run: `cd backend && python manage.py test apps.export.tests_task_condition_reconcile_api -v 2`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/apps/export/models/notification.py \
        backend/apps/export/services/shipment.py \
        backend/apps/export/migrations/0079_notification_tasks_changed_kind.py \
        backend/apps/export/tests_tasks_changed_notification.py \
        backend/apps/export/tests_task_condition_reconcile_api.py
git commit -m "feat(p3): notify affected roles when a shipment's task set changes

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `reconcile_tasks` command gains the condition pass

Repairs the shipments already in a bad state, as a deliberate operator action with a dry run — never as a side effect of somebody's save.

**Files:**
- Modify: `backend/apps/export/services/task_rules.py` (new `reconcile_conditions_for_shipments` wrapper after `reconcile_shipment_tasks`)
- Modify: `backend/apps/export/management/commands/reconcile_tasks.py`
- Modify: `backend/apps/export/tests_task_reconcile.py` (append a class)

**Interfaces:**
- Consumes: `reconcile_shipment_tasks` from Task 2.
- Produces:
  ```python
  def reconcile_conditions_for_shipments(shipments=None, dry_run: bool = False) -> dict:
      """-> {'created': int, 'cancelled': int, 'reopened': int,
              'shipments_scanned': int, 'changes': list[dict]}"""
  ```
  Each `changes` entry: `{'shipment_code': str, 'title_key': str, 'action': 'created'|'cancelled'|'reopened'}`.

- [ ] **Step 1: Write the failing test**

Append to `backend/apps/export/tests_task_reconcile.py`:

```python
# ---------------------------------------------------------------------------
# Condition re-evaluation pass (feature B)
# ---------------------------------------------------------------------------

class ReconcileConditionsTests(TestCase):
    """The condition pass added to the reconcile_tasks command.

    This is how the historical backlog gets repaired: explicitly, with a
    dry run available first.
    """

    def setUp(self):
        # Rules are created once per test, not once per shipment: a test that
        # builds two shipments must see ONE pair of rules, or the expected
        # counts double.
        self.regular_rule = _make_rule(
            title_key='tasks.assign_driver',
            condition_field='is_gapy_satys', condition_value='False',
        )
        self.gapy_rule = _make_rule(
            title_key='tasks.assign_driver_gapy',
            condition_field='is_gapy_satys', condition_value='True',
        )

    def _gapy_shipment_with_stale_task(self, code: str):
        """A shipment flipped to Gapy whose Regular task was never reconciled.

        Exactly the historical state the command exists to repair.
        """
        from apps.export.models import TaskState

        ship = _make_shipment(code)
        ship.is_gapy_satys = True
        ship.save(update_fields=['is_gapy_satys'])
        task = _make_task(
            ship, self.regular_rule, title_key='tasks.assign_driver',
            target_fields='driver_name', state=TaskState.OPEN,
        )
        return ship, task

    def test_dry_run_reports_and_writes_nothing(self):
        from apps.export.models import TaskState
        from apps.export.services.task_rules import reconcile_conditions_for_shipments

        ship, task = self._gapy_shipment_with_stale_task('0501001/26')

        summary = reconcile_conditions_for_shipments(shipments=[ship], dry_run=True)

        self.assertEqual(summary['cancelled'], 1)
        self.assertEqual(summary['created'], 1)
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.OPEN)
        self.assertEqual(Task.objects.filter(shipment=ship).count(), 1)

    def test_real_run_repairs_the_shipment(self):
        from apps.export.models import TaskCancelReason, TaskState
        from apps.export.services.task_rules import reconcile_conditions_for_shipments

        ship, task = self._gapy_shipment_with_stale_task('0501002/26')

        summary = reconcile_conditions_for_shipments(shipments=[ship], dry_run=False)

        self.assertEqual(summary['cancelled'], 1)
        self.assertEqual(summary['created'], 1)
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.CANCELLED)
        self.assertEqual(task.cancelled_reason, TaskCancelReason.RULE_MISMATCH)
        self.assertTrue(
            Task.objects.filter(
                shipment=ship, title_key='tasks.assign_driver_gapy',
                state=TaskState.OPEN,
            ).exists()
        )

    def test_dry_run_plan_matches_the_real_run(self):
        """_plan_condition_changes duplicates the decision loop of
        reconcile_shipment_tasks in read-only form. Nothing but this test stops
        the two drifting apart."""
        from apps.export.services.task_rules import reconcile_conditions_for_shipments

        ship_a, _ = self._gapy_shipment_with_stale_task('0501005/26')
        ship_b, _ = self._gapy_shipment_with_stale_task('0501006/26')

        planned = reconcile_conditions_for_shipments(shipments=[ship_a], dry_run=True)
        actual = reconcile_conditions_for_shipments(shipments=[ship_b], dry_run=False)

        def _shape(summary):
            return (
                summary['created'], summary['cancelled'], summary['reopened'],
                sorted((c['action'], c['title_key']) for c in summary['changes']),
            )

        self.assertEqual(_shape(planned), _shape(actual))

    def test_command_runs_both_passes(self):
        from apps.export.models import TaskState

        ship, task = self._gapy_shipment_with_stale_task('0501003/26')
        out = StringIO()

        call_command('reconcile_tasks', '--shipment', '0501003/26', stdout=out)

        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.CANCELLED)
        self.assertIn('condition', out.getvalue().lower())

    def test_command_dry_run_writes_nothing(self):
        from apps.export.models import TaskState

        ship, task = self._gapy_shipment_with_stale_task('0501004/26')
        out = StringIO()

        call_command('reconcile_tasks', '--dry-run', '--shipment', '0501004/26', stdout=out)

        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.OPEN)
        self.assertIn('DRY RUN', out.getvalue())
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd backend && python manage.py test apps.export.tests_task_reconcile.ReconcileConditionsTests -v 2`
Expected: FAIL — `ImportError: cannot import name 'reconcile_conditions_for_shipments'`.

- [ ] **Step 3: Write the wrapper**

In `backend/apps/export/services/task_rules.py`, after `reconcile_shipment_tasks`:

```python
def reconcile_conditions_for_shipments(shipments=None, dry_run: bool = False) -> dict:
    """Run the condition pass across many shipments, with a dry-run mode.

    The bulk counterpart to reconcile_shipment_tasks, used by the
    reconcile_tasks command to repair shipments whose condition fields were
    edited before that function existed. Deliberately an explicit operator
    action: cancelling a stale task can leave a step auto-advance eligible,
    so this is something a human runs after reading a dry run, not something
    a Sheet edit triggers en masse.

    dry_run computes the plan without writing by reading the same rule/task
    state and comparing, then rolling nothing back — it simply does not call
    the mutator.

    Args:
        shipments: Optional iterable of Shipment instances. None means every
            shipment in an open season that has at least one non-terminal
            task, plus no others — a shipment with no tasks at all is only
            reconciled when passed explicitly, because a full-table sweep
            creating tasks for every historical row is not what an operator
            asked for.
        dry_run: When True, report what would change and write nothing.

    Returns:
        {'created': int, 'cancelled': int, 'reopened': int,
         'shipments_scanned': int, 'changes': list[dict]} where each change is
        {'shipment_code': str, 'title_key': str, 'action': str}.
    """
    from apps.export.models import Shipment

    if shipments is None:
        shipment_ids = (
            Task.objects
            .filter(state__in=_ACTIVE_TASK_STATES, rule__isnull=False)
            .filter(shipment__season__closed_at__isnull=True)
            .values_list('shipment_id', flat=True)
            .distinct()
        )
        candidates = list(
            Shipment.objects
            .filter(pk__in=list(shipment_ids))
            .select_related('status', 'season')
        )
    else:
        candidates = [s for s in shipments if s.season.closed_at is None]

    totals = {'created': 0, 'cancelled': 0, 'reopened': 0}
    changes: list[dict] = []

    for shipment in candidates:
        if dry_run:
            plan = _plan_condition_changes(shipment)
        else:
            result = reconcile_shipment_tasks(shipment)
            plan = {
                key: [(t.title_key, key) for t in result[key]]
                for key in ('created', 'cancelled', 'reopened')
            }

        for action in ('created', 'cancelled', 'reopened'):
            entries = plan.get(action, [])
            totals[action] += len(entries)
            for title_key, _action in entries:
                changes.append({
                    'shipment_code': shipment.shipment_code,
                    'title_key': title_key,
                    'action': action,
                })

    logger.info(
        'reconcile_conditions_for_shipments: scanned %d shipment(s) — '
        'created %d, cancelled %d, reopened %d%s',
        len(candidates), totals['created'], totals['cancelled'],
        totals['reopened'], ' (dry run)' if dry_run else '',
    )
    return {**totals, 'shipments_scanned': len(candidates), 'changes': changes}


def _plan_condition_changes(shipment) -> dict:
    """Read-only twin of reconcile_shipment_tasks's decision loop.

    Returns the same shape the mutating path reports, as
    {action: [(title_key, action), ...]}, without writing. Kept next to
    reconcile_shipment_tasks so the two decision loops stay in step; the
    tests assert they agree.
    """
    from apps.export.models import TaskCancelReason

    if shipment.season_id and shipment.season.closed_at is not None:
        return {'created': [], 'cancelled': [], 'reopened': []}

    active_rules = list(TaskRule.objects.filter(is_active=True))
    step_set = set(
        shipment.tasks
        .filter(state__in=_ACTIVE_TASK_STATES)
        .values_list('step', flat=True)
    )
    if shipment.status_id:
        step_set.add(shipment.status.code)
    rules = [r for r in active_rules if r.step in step_set]

    tasks_by_rule = {
        task.rule_id: task
        for task in shipment.tasks.filter(
            rule_id__in=[r.id for r in rules]
        ).order_by('id')
    }

    plan: dict = {'created': [], 'cancelled': [], 'reopened': []}
    for rule in rules:
        task = tasks_by_rule.get(rule.id)
        matches = _condition_matches(rule, shipment)
        if matches:
            if task is None:
                plan['created'].append((rule.title_key, 'created'))
            elif (
                task.state == TaskState.CANCELLED
                and task.cancelled_reason == TaskCancelReason.RULE_MISMATCH
            ):
                plan['reopened'].append((task.title_key, 'reopened'))
        elif task is not None and task.state in _ACTIVE_TASK_STATES:
            plan['cancelled'].append((task.title_key, 'cancelled'))
    return plan
```

- [ ] **Step 4: Run the service tests to verify they pass**

Run: `cd backend && python manage.py test apps.export.tests_task_reconcile.ReconcileConditionsTests.test_dry_run_reports_and_writes_nothing apps.export.tests_task_reconcile.ReconcileConditionsTests.test_real_run_repairs_the_shipment -v 2`
Expected: both PASS.

- [ ] **Step 5: Extend the command**

In `backend/apps/export/management/commands/reconcile_tasks.py`:

Extend the module docstring's `Usage:` block with a line noting the second pass:

```
    python manage.py reconcile_tasks              # sync drift AND re-evaluate conditions
```

In `handle`, extend the import:

```python
        from apps.export.services.task_rules import (
            reconcile_conditions_for_shipments,
            reconcile_open_tasks_with_rules,
        )
```

Then add a helper method to the class, which both the dry-run and the real
path call after the existing drift reporting:

```python
    def _report_conditions(self, shipments, dry_run: bool) -> None:
        """Run and print the condition-re-evaluation pass."""
        from apps.export.services.task_rules import reconcile_conditions_for_shipments

        summary = reconcile_conditions_for_shipments(shipments=shipments, dry_run=dry_run)
        changes = summary['changes']
        if not changes:
            self.stdout.write(self.style.SUCCESS(
                'Condition pass: no task matches a rule it should not, '
                'and none is missing.'
            ))
            return

        verb = 'would be' if dry_run else 'were'
        self.stdout.write(
            f'Condition pass ({summary["shipments_scanned"]} shipment(s) scanned) -- '
            f'{len(changes)} task(s) {verb} changed:'
        )
        for ch in changes:
            self.stdout.write(
                f'  {ch["shipment_code"]}: {ch["action"]} {ch["title_key"]}'
            )
        line = (
            f'Condition pass summary: created {summary["created"]}, '
            f'cancelled {summary["cancelled"]}, reopened {summary["reopened"]}.'
        )
        self.stdout.write(self.style.WARNING(line) if dry_run else self.style.SUCCESS(line))
```

Call it in both paths. In the real path, inside the existing
`with transaction.atomic():` block, the current code `return`s early when
`changes` is empty — so move the condition call **before** that early return:

```python
            with transaction.atomic():
                summary = reconcile_open_tasks_with_rules(shipments=shipments, dry_run=False)
                self._report_conditions(shipments, dry_run=False)

                changes = summary.get('changes', [])
                if not changes:
                    self.stdout.write(self.style.SUCCESS(
                        'No stale tasks found -- all open tasks already match their rules.'
                    ))
                    return
                # ... existing per-task drift reporting unchanged ...
```

And in the dry-run path, likewise before its early return:

```python
        if dry_run:
            summary = reconcile_open_tasks_with_rules(shipments=shipments, dry_run=True)
            self._report_conditions(shipments, dry_run=True)
        else:
            ...
```

so the `changes`-empty early return no longer skips the condition report.

- [ ] **Step 6: Run the command tests to verify they pass**

Run: `cd backend && python manage.py test apps.export.tests_task_reconcile -v 2`
Expected: all PASS, including the five new ones.

- [ ] **Step 7: Commit**

```bash
git add backend/apps/export/services/task_rules.py \
        backend/apps/export/management/commands/reconcile_tasks.py \
        backend/apps/export/tests_task_reconcile.py
git commit -m "feat(p3): add a condition pass to reconcile_tasks

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Frontend — the new kind, and a clickable bell

**Files:**
- Modify: `frontend/src/types/index.ts:1623` (the `INotification['kind']` union)
- Modify: `frontend/src/components/NotificationBell.tsx`
- Modify: `frontend/src/i18n/en.json`, `ru.json`, `tk.json` (the `notifications` object)
- Modify: `frontend/src/components/NotificationBell.test.tsx`

**Interfaces:**
- Consumes: the `tasks_changed` kind and the `link` field the backend now sends (Task 4).
- Produces: no new exported symbol.

- [ ] **Step 1: Write the failing tests**

`frontend/src/components/NotificationBell.test.tsx` currently holds a
module-level `const notifications: INotification[]` that its `vi.mock` returns
directly, and its mock does **not** expose `useMarkOneRead`. Both have to change,
so rewrite the file's head and append the new cases. Replace lines 1-22 (the
imports, the fixture array and the `vi.mock` block) with:

```tsx
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { NotificationBell } from './NotificationBell';
import type { INotification } from '@/types';

const WEEKLY_PLAN_ROW: INotification = {
  id: 1,
  kind: 'weekly_plan_summary',
  message: 'W39/2026: 50% · Maral 25% (B, C) · Toyly 100%',
  link: '/export/plan?week=39&year=2026',
  read_at: null,
  created_at: '2026-09-19T09:00:00+05:00',
};

// Mutable so each test can set the rows the bell renders. The vi.mock factory
// closes over this binding, so reassigning it before render is enough.
let notifications: INotification[] = [WEEKLY_PLAN_ROW];

const mockMarkOneRead = vi.fn();
const mockNavigate = vi.fn();

vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => ({ data: notifications }),
  useMarkAllRead: () => ({ mutate: vi.fn(), isPending: false }),
  useMarkOneRead: () => ({ mutate: mockMarkOneRead, isPending: false }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

async function openBell(rows: INotification[]) {
  notifications = rows;
  render(<NotificationBell />);
  await userEvent.click(screen.getByRole('button', { name: 'Notifications' }));
}
```

Then, inside the existing `describe('NotificationBell', ...)` block, add a
`beforeEach` and rewrite the existing test to use the helper, so the fixture
reset applies to it too:

```tsx
  beforeEach(() => {
    notifications = [WEEKLY_PLAN_ROW];
    mockMarkOneRead.mockClear();
    mockNavigate.mockClear();
  });

  it('prefixes the weekly plan summary with its translated label', async () => {
    await openBell([WEEKLY_PLAN_ROW]);
    expect(
      await screen.findByText(
        "Next week's harvest plan filled: W39/2026: 50% · Maral 25% (B, C) · Toyly 100%",
      ),
    ).toBeTruthy();
  });
```

And append the three new cases:

```tsx
  it('renders a tasks_changed notification with its translated label', async () => {
    await openBell([
      {
        id: 2,
        kind: 'tasks_changed',
        message: '2309002/26: +1 -1 ~0',
        link: '/shipments/42',
        read_at: null,
        created_at: '2026-09-24T09:00:00+05:00',
      },
    ]);

    expect(
      await screen.findByText(
        'Task list changed for this shipment — 2309002/26: +1 -1 ~0',
      ),
    ).toBeTruthy();
  });

  it('marks read and navigates when the notification has a link', async () => {
    await openBell([
      {
        id: 3,
        kind: 'tasks_changed',
        message: '2309003/26: +1 -1 ~0',
        link: '/shipments/43',
        read_at: null,
        created_at: '2026-09-24T09:00:00+05:00',
      },
    ]);

    await userEvent.click(
      await screen.findByText('Task list changed for this shipment — 2309003/26: +1 -1 ~0'),
    );

    expect(mockMarkOneRead).toHaveBeenCalledWith(3);
    expect(mockNavigate).toHaveBeenCalledWith('/shipments/43');
  });

  it('does not navigate when the notification has no link', async () => {
    await openBell([
      {
        id: 4,
        kind: 'task_done',
        message: 'no link here',
        link: null,
        read_at: null,
        created_at: '2026-09-24T09:00:00+05:00',
      },
    ]);

    await userEvent.click(await screen.findByText('no link here'));

    expect(mockMarkOneRead).toHaveBeenCalledWith(4);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd frontend && npx vitest run src/components/NotificationBell.test.tsx`
Expected: FAIL — `tasks_changed` is not assignable to `INotification['kind']`, and no navigation happens.

- [ ] **Step 3: Add the kind to the TS union**

In `frontend/src/types/index.ts:1623`, add `| 'tasks_changed'` to the union:

```ts
  kind: 'quota_80' | 'quota_90' | 'quota_95' | 'quota_100' | 'overdue' | 'action_required' | 'plan_submitted' | 'plan_approved' | 'plan_rejected' | 'mention' | 'task_assigned' | 'task_done' | 'tasks_changed' | 'feedback_resolved' | 'feedback_rejected' | 'weekly_plan_summary';
```

- [ ] **Step 4: Make the bell clickable and colour the new kind**

In `frontend/src/components/NotificationBell.tsx`:

Add to the imports:

```tsx
import { useNavigate } from 'react-router-dom';
import { useNotifications, useMarkAllRead, useMarkOneRead } from '../hooks/useNotifications';
```

(keep whatever the existing `useNotifications` import line already brings in; just add `useMarkOneRead`.)

Add to `KIND_COLOR`, after `task_done`:

```tsx
  tasks_changed: COLORS.orange,
```

Inside the component, next to the existing `markAllRead`:

```tsx
  const markOneRead = useMarkOneRead();
  const navigate = useNavigate();

  const handleRowClick = (n: INotification) => {
    if (!n.read_at) markOneRead.mutate(n.id);
    if (n.link) {
      setIsOpen(false);
      navigate(n.link);
    }
  };
```

On the per-notification `<div>`, add the handler and the affordance:

```tsx
          <div
            key={n.id}
            onClick={() => handleRowClick(n)}
            style={{
              padding: '8px 16px',
              cursor: n.link ? 'pointer' : 'default',
              background: n.read_at ? undefined : '#f0f5ff',
              borderLeft: n.read_at ? undefined : `3px solid ${KIND_COLOR[n.kind]}`,
              borderBottom: '1px solid #f5f5f5',
            }}
          >
```

`INotification` must be imported in this file if it is not already.

- [ ] **Step 5: Add the i18n label**

In each of `frontend/src/i18n/en.json`, `ru.json`, `tk.json`, inside the `notifications` object:

```json
    "tasks_changed": "Task list changed for this shipment",
```
```json
    "tasks_changed": "Список задач по этому шипменту изменился",
```
```json
    "tasks_changed": "Bu ýük üçin tabşyryk sanawy üýtgedi",
```

And in `notificationText`, render it with the label before the counts:

```tsx
  if (n.kind === 'tasks_changed') return `${t('notifications.tasks_changed')} — ${n.message}`;
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd frontend
npx vitest run src/components/NotificationBell.test.tsx
npx tsc --noEmit --ignoreDeprecations 5.0
```
Expected: all bell tests PASS; type-check clean.

- [ ] **Step 7: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: no new failures versus baseline.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/types/index.ts \
        frontend/src/components/NotificationBell.tsx \
        frontend/src/components/NotificationBell.test.tsx \
        frontend/src/i18n/en.json frontend/src/i18n/ru.json frontend/src/i18n/tk.json
git commit -m "feat(frontend): show tasks_changed notifications and make the bell clickable

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Documentation

**Files:**
- Modify: `docs/obsidian/reference/task-rules.md`
- Modify: `docs/obsidian/processes/comments-tasks.md`
- Modify: `CHANGELOG.md`
- Modify: `BUILD_TEST_LOG.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing code-facing.

- [ ] **Step 1: Read the two obsidian docs to match their structure**

```bash
cd /d/projects/yigit_platform
sed -n '1,60p' docs/obsidian/reference/task-rules.md
grep -n "engine\|13 rules\|22 rules" docs/obsidian/processes/comments-tasks.md
```

- [ ] **Step 2: Update `docs/obsidian/reference/task-rules.md`**

Add a section after the existing generation/resolution description:

```markdown
## Condition re-evaluation

Tasks are created once, when the shipment enters a step, from the rules whose
condition matched at that moment. But `is_gapy_satys` and `has_peregruz` are
edited on the Sheet long after step entry, and the rules that key off them are
paired — one variant for `True`, one for `False`. `reconcile_shipment_tasks()`
(`services/task_rules.py`) closes that gap on every shipment PATCH whose
submitted fields include a field some active rule conditions on.

Per active rule in scope, one outcome:

| Rule matches? | Existing task | Outcome |
|---|---|---|
| yes | none | created |
| yes | `CANCELLED` / `rule_mismatch` | reopened |
| no | `OPEN` / `IN_PROGRESS` / `BLOCKED` | cancelled, reason `rule_mismatch` |
| either | `DONE` | untouched — the work was really done |
| either | `CANCELLED`, any other reason | untouched — never resurrected |

Scope is every step that has a non-terminal task on the shipment, plus the
shipment's current step, so a long-lived earlier-step task
(`tasks.submit_sales_report`, created at `yola_chykdy`) is covered.

**It never calls `auto_advance_if_ready()`.** Cancelling the last open
auto-task at a step makes that step trigger-satisfied, and advancing from here
would let a checkbox move a truck through every pre-satisfied step at once. The
shipment advances on its next ordinary save instead.

Affected roles get a `tasks_changed` notification: the roles owning the
created / cancelled / reopened tasks, union `STATUS_NOTIFY_ROLES` for the
current step.

### `Task.cancelled_reason`

| Value | Written by |
|---|---|
| `manual` | `TaskViewSet.cancel` — a person cancelled it |
| `shipment_cancelled` | `_cancel_open_tasks` — the whole shipment was cancelled |
| `rule_mismatch` | `reconcile_shipment_tasks` — the only value it will reopen |
| `rule_deactivated` | reserved for the rule editor; nothing writes it yet |

Blank means either "never cancelled" or "cancelled before 2026-09" — treat `''`
as unknown in any analytics, not as `manual`.

### Repairing history

`python manage.py reconcile_tasks --dry-run` now reports a second pass: tasks
that a condition change stranded. Read the dry run first — cancelling a stale
task can leave a step auto-advance eligible on that shipment's next save.
```

- [ ] **Step 3: Update `docs/obsidian/processes/comments-tasks.md`**

In its task-engine section, note the second creator and fix any stale rule count found in Step 1:

```markdown
Two things create shipment Tasks, not one: `generate_tasks_for_status()` on step
entry, and `reconcile_shipment_tasks()` when a condition field changes on a
shipment that is already in a step. Anything that assumes tasks appear only on
step entry is wrong as of 2026-09-24. See
[[../reference/task-rules#Condition re-evaluation]].
```

- [ ] **Step 4: Update `CHANGELOG.md`**

Under `[Unreleased]`, matching the file's existing style:

```markdown
### Added
- feat(p3): re-decide a shipment's tasks when `is_gapy_satys` / `has_peregruz` changes after step entry — stale variants cancelled, the right ones created, affected roles notified
- feat(p3): `Task.cancelled_reason` records why a task was cancelled (`manual` / `shipment_cancelled` / `rule_mismatch` / `rule_deactivated`)
- feat(p3): `reconcile_tasks` gains a condition-re-evaluation pass for repairing historical shipments

### Fixed
- fix(frontend): notification bell rows are clickable — they mark the notification read and navigate to its link
```

- [ ] **Step 5: Log the build**

Prepend to `BUILD_TEST_LOG.md` (newest on top):

```markdown
- [ ] 2026-09-24 — Task condition re-evaluation (feature B): gapy/peregruz flip re-decides the task set, `Task.cancelled_reason`, `tasks_changed` notification, clickable notification bell, `reconcile_tasks` condition pass — NEEDS TEST
```

- [ ] **Step 6: Commit**

```bash
git add docs/obsidian/reference/task-rules.md \
        docs/obsidian/processes/comments-tasks.md \
        CHANGELOG.md BUILD_TEST_LOG.md
git commit -m "docs: document task condition re-evaluation

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: Final verification across both stacks**

```bash
cd backend
python manage.py makemigrations --check --dry-run
python manage.py test apps.export -v 0
cd ../frontend
npx vitest run
npx tsc --noEmit --ignoreDeprecations 5.0
```

Expected: no pending migrations; no new backend failures versus the pre-existing baseline (~52 known failures in four buckets — compare against a `git stash`ed baseline run, do not assume a green suite); frontend green.

Then report plainly: what passed, what the pre-existing failures were, and that the feature is **built but not tested by a human yet**.

---

## Notes for the implementer

- **The spec is the argument, this plan is the procedure.** When a step's code and the spec disagree, the spec wins — say so rather than silently following the plan.
- **Task 1 leaves one test deliberately red** (`CancelledShipmentStaysCancelledTests`), which Task 2 turns green. Do not "fix" it inside Task 1.
- **Task 3 writes a placeholder** `notify_tasks_changed` that Task 4 replaces. Do not leave the placeholder behind.
- **`_plan_condition_changes` in Task 5 duplicates the decision loop** of `reconcile_shipment_tasks` in read-only form. That duplication is deliberate — a dry run must not write — but the two loops must stay in step; if you change one, change both. `test_dry_run_plan_matches_the_real_run` is the only thing that catches drift between them, so do not weaken it.
