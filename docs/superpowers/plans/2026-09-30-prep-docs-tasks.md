# PREP + DOCS Task Chain (Tasks.md items 5b–22) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the draft and customs task rules with the owner's 5b–22 chain. Tasks appear only when their prerequisites are done. Button tasks («Taýýarladym», «Ugradyldy», …) hold the status until they are pressed. Print tasks close themselves when the document is downloaded. Items 11 and 22 set the «Resminamalar 13:00» cell.

**Architecture:** Four engine additions on `TaskRule`/`Task`:
- `depends_on` (CSV of `title_key`) with deferred creation, done by `spawn_ready_tasks`.
- A new completion rule `confirm` (a button that gates the step).
- A pending-dependents guard in `is_step_trigger_satisfied`.
- `gates_step=False` for a field task that must not hold the step.

Everything new lives in `services/task_chain.py`. `task_rules.py` and `Shipment.save()` call into it through function-level imports.

How closing is wired:
- Document downloads are recorded in a new `ShipmentDocumentDownload` table. They close the print tasks, including ones spawned after the download.
- The contracts app registers the «contracts ready» check into export's registry in `AppConfig.ready()`. The direction is contracts → export, which is allowed.
- New rules carry `effective_from`, so shipments already inside a step at deploy finish that step on their old tasks.

**Tech Stack:** Django 5 + DRF on MSSQL, React 18 + TS + antd + TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-30-prep-docs-tasks-design.md` (approved 2026-09-30, assumptions A-1…A-4 accepted).

## Global Constraints

**Rules and catalog**
- Status changes go only through `transition_to()`. In this plan that always happens via `auto_advance_if_ready()`.
- Dependency direction is `core ← greenhouse ← export ← contracts`:
  - `export` never imports `contracts`.
  - `contracts` may import `export`.
  - No Django signals.
- **Shared DB with beta (old code).** Every new NOT NULL column needs a DB-level default (lesson from `export/0085`, memory "NOT NULL Needs DB Default"). New rules must be seeded only AFTER this code is deployed. Do not run `seed_task_rules` on the shared DB during this work.
- MSSQL: `bulk_create(..., batch_size=500)`; `.order_by()` before any `Subquery`.
- Title keys (all `tasks.`):
  - `set_destination`, `join_supply`, `pick_export_firms`, `choose_truck`, `assign_driver`
  - `prepare_contract`, `fill_gross_net`, `prepare_transport_docs`
  - `print_cmr`, `print_tir`, `print_ct1`, `print_phyto`
  - `ct1_phyto_sent`, `print_customs_request`, `docs_to_stamp`, `docs_from_stamp`
  - `give_advance`, `prepare_declaration`, `docs_to_customs`, `docs_from_customs`
- Doc keys: `cmr`, `tir`, `ct1`, `phyto`, `customs_request`.
- `documents_status` codes:
  - item 11 → `in_progress` («Dowam edýär»);
  - item 22 → the active option whose `label_tk` is «Gümrükden geldi» (on the live DB its code is that same string).
- New DOCS tasks have **no deadline** (spec A-4).

**Git and the shared tree**
- Commits happen only on the user's "commit". Stage explicit paths/hunks only via the private-index helper (scratchpad `gitblob.py`).
- Other sessions share the tree and index: check `git status` and `git diff --cached` first.
- Check the migration numbers are free first: export next is `0090`, contracts next is `0014`.

**Test runs**
- Use a private DB via scratchpad `t.sh <labels>`: `DJANGO_TESTING=true`, `settings_isolated_pt`.
- Frontend: `npx vitest run <paths>` and `npx tsc --noEmit --ignoreDeprecations 5.0`.

## Known limit (ruled, not fixed)

A regular **packing-part** draft (no destination) created before deploy that gets its destination after deploy:
- does not get the old transport «driver» task, because that rule is now inactive;
- does not get `choose_truck`, because that rule is not yet effective for a shipment that entered `draft` earlier;
- so it can leave `draft` on 5b + 7 alone.

This is rare with the move-model join. Ledger it as a ruling; no fix.

## Review Focus

1. **A deploy-crossing shipment.** It entered `draft` before the new rules and enters `gumruk_girish` after them. It must reach `gumruk_chykysh` with no deadlock: a dependency on a rule from an earlier step with no task counts as satisfied (Task 2).
2. **A step made only of buttons.** It must not auto-advance before its last button. It must also not advance in the gap between "N closed" and "the task after N spawned" (Task 2, E3).
3. **One `packet.zip` download.** It closes CMR, CT-1, fito and the customs letter, and the CT-1/fito tasks that spawn afterwards close on arrival (Task 4).
4. **Gapy vs regular variants.** Item 11 waits for `choose_truck` on a regular shipment and for `assign_driver` on a gapy one. A gapy↔regular flip must not spawn 8.x or 11 early (Tasks 2, 6).
5. **In-flight shipments at deploy.** They keep their old tasks. The deactivated rules add nothing new, and no pending dependents block them (Task 7).

---

### Task 1: Model — `confirm`, rule fields, document-download table

**Files:**
- Modify: `backend/apps/export/models/task.py`
- Create: `backend/apps/export/models/document_download.py`; re-export it in `backend/apps/export/models/__init__.py`
- Create: `backend/apps/export/migrations/0090_prep_docs_engine.py` (makemigrations + RunSQL defaults)
- Modify: `backend/apps/export/serializers.py` (`TaskRuleSerializer`: `depends_on` as a list, `gates_step`)
- Test: `backend/apps/export/tests_task_chain.py` (model section)

**Interfaces — produces:**
- `TaskCompletionRule.CONFIRM = 'confirm'`
- `TaskRule.depends_on: str` (CSV, default `''`)
- `TaskRule.gates_step: bool` (default `True`)
- `TaskRule.effective_from: datetime | None`
- `ShipmentDocumentDownload(shipment, doc_key, downloaded_by, downloaded_at)`

- [ ] **Step 0: Baseline (before any code).** Run the Task 7 step-4 module list once on the private DB and ledger the failing test ids as `Baseline:` lines. "Pre-existing failure" later means "on this list".

- [ ] **Step 1: Failing tests** (`tests_task_chain.py`, first class)

```python
"""Task chain for PREP/DOCS (spec 2026-09-30-prep-docs-tasks-design)."""
from django.db import connection
from django.test import TestCase

from apps.export.models import ShipmentDocumentDownload, TaskCompletionRule, TaskRule


class ChainModelTests(TestCase):
    def test_new_rule_fields_and_defaults(self):
        rule = TaskRule.objects.create(step='draft', title_key='tasks.x', assignee_role='export_manager')
        self.assertEqual((rule.depends_on, rule.gates_step, rule.effective_from), ('', True, None))
        self.assertEqual(TaskCompletionRule.CONFIRM, 'confirm')

    def test_old_code_can_insert_a_rule_without_the_new_columns(self):
        # Beta runs old code on this database: its INSERT omits the new columns.
        with connection.cursor() as c:
            c.execute(
                "INSERT INTO export_task_rule (step, title_key, assignee_role, target_fields, "
                "completion_rule, target_value, deadline_rule, condition_field, condition_value, "
                "is_active, created_at) VALUES ('draft', 'tasks.legacy', 'export_manager', '', "
                "'manual_done', '', '', '', '', 1, SYSDATETIME())"
            )
        rule = TaskRule.objects.get(title_key='tasks.legacy')
        self.assertEqual((rule.depends_on, rule.gates_step), ('', True))

    def test_download_row(self):
        self.assertEqual(ShipmentDocumentDownload._meta.get_field('doc_key').max_length, 24)
```

- [ ] **Step 2: Run the tests** — `t.sh apps.export.tests_task_chain`. Expected: ImportError / AttributeError.

- [ ] **Step 3: Implement**

`models/task.py`: add to `TaskCompletionRule` after `FIELD_SET`:
```python
    # A button that HOLDS the step (unlike manual_done, which never gates).
    # For the DOCS chain («Taýýarladym», «Ugradyldy», «Çap etdim»).
    CONFIRM           = 'confirm',           _('Button that gates the step')
```

Add to `TaskRule`, after `condition_value`:
```python
    depends_on = models.CharField(
        max_length=512, blank=True, default='',
        help_text='CSV of title_keys that must be done before this rule creates '
                  'its task (docs/Tasks.md "after N"). Blank = created at step entry.',
    )
    gates_step = models.BooleanField(
        default=True,
        help_text='False = the task closes itself but never holds the step '
                  '(join_supply: documents may start before packing).',
    )
    effective_from = models.DateTimeField(
        null=True, blank=True,
        help_text='The rule applies only to shipments that entered its step at or '
                  'after this moment. Set once by seed_task_rules on create.',
    )
```

`models/document_download.py`:
```python
"""A document generated (downloaded) for a shipment — closes the matching print
task, even one that spawns later (spec 2026-09-30 §3)."""
from django.db import models


class ShipmentDocumentDownload(models.Model):
    shipment = models.ForeignKey('export.Shipment', on_delete=models.CASCADE, related_name='document_downloads')
    doc_key = models.CharField(max_length=24)          # cmr | tir | ct1 | phyto | customs_request
    downloaded_by = models.ForeignKey('core.User', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    downloaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'export_shipment_document_download'
        indexes = [models.Index(fields=['shipment', 'doc_key'], name='export_sdd_ship_doc_idx')]
```

In `models/__init__.py`, add `from .document_download import ShipmentDocumentDownload` next to the task imports, and add it to `__all__` if the file keeps one.

Migration: `makemigrations export --name prep_docs_engine`. **Open the file.** It must contain only:
- the AlterField choices on `completion_rule` (Task and TaskRule);
- AddField ×3 on `taskrule`;
- CreateModel `ShipmentDocumentDownload`.

Then append to `operations`:
```python
        migrations.RunSQL(
            sql="ALTER TABLE [export_task_rule] ADD CONSTRAINT [DF_export_task_rule_depends_on] DEFAULT N'' FOR [depends_on]; "
                "ALTER TABLE [export_task_rule] ADD CONSTRAINT [DF_export_task_rule_gates_step] DEFAULT 1 FOR [gates_step];",
            reverse_sql="ALTER TABLE [export_task_rule] DROP CONSTRAINT [DF_export_task_rule_depends_on]; "
                        "ALTER TABLE [export_task_rule] DROP CONSTRAINT [DF_export_task_rule_gates_step];",
        ),
```
Apply it: `migrate export`, `showmigrations export | tail -2`. Verify with INFORMATION_SCHEMA that `depends_on` has `COLUMN_DEFAULT (N'')` and `gates_step` has `((1))`.

`serializers.py` `TaskRuleSerializer`:
- Add `depends_on = serializers.SerializerMethodField()` and `def get_depends_on(self, obj) -> list[str]: return [k.strip() for k in obj.depends_on.split(',') if k.strip()]`.
- Add `'depends_on', 'gates_step'` to `fields` after `'is_active'`.

- [ ] **Step 4: Run the tests** — `t.sh apps.export.tests_task_chain apps.export.tests_task_rules_api apps.export.tests_task_models`. Expected: PASS. If `tests_task_rules_api` pins the exact payload keys, add the two keys to its expectation.

- [ ] **Step 5: Commit** (only on the user's "commit"): model, migration, `__init__`, serializer, test.

---

### Task 2: Engine — dependencies, deferred creation, E3, save ordering

**Files:**
- Create: `backend/apps/export/services/task_chain.py`
- Modify:
  - `backend/apps/export/services/task_rules.py`: `generate_tasks_for_status`, `resolve_for_shipment`, `reconcile_shipment_tasks`.
  - `backend/apps/export/services/shipment.py`: `is_step_trigger_satisfied`.
  - `backend/apps/export/models/shipment.py`: `save()`, plus the new helper `advance_after_tasks`.
- Test: `tests_task_chain.py` (engine section)

**Interfaces — produces (in `task_chain`):**
- `dep_keys(rule) -> list[str]`
- `step_entered_at(shipment) -> datetime`
- `rule_effective(rule, entered_at) -> bool`
- `spawn_ready_tasks(shipment) -> list[Task]` (created tasks)
- `has_pending_dependents(shipment) -> bool`
- In `models/shipment.py`: `advance_after_tasks(shipment, resolved_tasks) -> bool`

- [ ] **Step 1: Failing tests** (append to `tests_task_chain.py`)

```python
from django.utils import timezone

from apps.core.models import Country, Customer, ImportFirm, Season, ShipmentStatusType, User
from apps.export.models import Shipment, ShipmentStatusLog, Task, TaskState
from apps.export.services.task_chain import has_pending_dependents, spawn_ready_tasks, step_entered_at
from apps.export.services.task_rules import generate_tasks_for_status

STATUSES = [('draft', 0, 'DRAFT'), ('gumruk_girish', 1, 'CUSTOMS'), ('gumruk_chykysh', 2, 'CUSTOMS')]


def _rule(step, title, **kw):
    base = dict(step=step, title_key=title, assignee_role='document_team',
                completion_rule=TaskCompletionRule.CONFIRM)
    base.update(kw)
    return TaskRule.objects.create(**base)


class ChainFixture(TestCase):
    """Fixture + helpers only — no test_ methods, so subclasses in other
    modules don't re-run anything."""

    @classmethod
    def setUpTestData(cls):
        for code, order, phase in STATUSES:
            ShipmentStatusType.objects.get_or_create(
                code=code, defaults={'name_tk': code, 'name_en': code, 'name_ru': code,
                                     'step_order': order, 'phase': phase})
        cls.user = User.objects.create_user(username='tc_dt', password='pw', role='document_team')
        cls.season, _ = Season.objects.get_or_create(
            name='2025-2026', defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True})

    def _at(self, code='gumruk_girish', **extra):
        s = Shipment.objects.create(shipment_code=f'TC-{Shipment.objects.count()}', date='2026-01-01',
                                    season=self.season, status=ShipmentStatusType.objects.get(code=code),
                                    created_by=self.user, updated_by=self.user, **extra)
        return s

    def _press(self, shipment, title):
        """What POST /tasks/{id}/complete/ does for a confirm task (Task 3 wires it)."""
        from apps.export.services.task_chain import after_task_done
        task = shipment.tasks.get(title_key=title)
        task.state = TaskState.DONE
        task.completed_at = timezone.now()
        task.save(update_fields=['state', 'completed_at'])
        after_task_done(shipment, self.user, [task])


class ChainEngineTests(ChainFixture):
    def test_dependent_appears_only_when_prerequisites_done(self):
        _rule('gumruk_girish', 'tasks.a')
        _rule('gumruk_girish', 'tasks.b')
        _rule('gumruk_girish', 'tasks.c', depends_on='tasks.a,tasks.b')
        s = self._at()
        generate_tasks_for_status(s, 'gumruk_girish')
        self.assertFalse(s.tasks.filter(title_key='tasks.c').exists())
        self._press(s, 'tasks.a')
        self.assertFalse(s.tasks.filter(title_key='tasks.c').exists())
        self._press(s, 'tasks.b')
        self.assertTrue(s.tasks.filter(title_key='tasks.c', state=TaskState.OPEN).exists())

    def test_earlier_step_rule_without_a_task_counts_as_done(self):
        # The deploy-crossing shipment: no task for the draft-step prerequisite.
        _rule('draft', 'tasks.choose_truck', completion_rule=TaskCompletionRule.ALL_FIELDS_FILLED,
              target_fields='truck_head_id')
        _rule('gumruk_girish', 'tasks.after_truck', depends_on='tasks.choose_truck')
        s = self._at()
        generate_tasks_for_status(s, 'gumruk_girish')
        self.assertTrue(s.tasks.filter(title_key='tasks.after_truck').exists())

    def test_variant_that_does_not_apply_is_ignored(self):
        _rule('draft', 'tasks.assign_driver', condition_field='is_gapy_satys', condition_value='True')
        _rule('gumruk_girish', 'tasks.x', depends_on='tasks.assign_driver')
        s = self._at(is_gapy_satys=False)
        generate_tasks_for_status(s, 'gumruk_girish')
        self.assertTrue(s.tasks.filter(title_key='tasks.x').exists())

    def test_step_does_not_advance_while_dependents_are_pending(self):
        _rule('gumruk_girish', 'tasks.a')
        _rule('gumruk_girish', 'tasks.c', depends_on='tasks.a')
        s = self._at()
        generate_tasks_for_status(s, 'gumruk_girish')
        self.assertTrue(has_pending_dependents(s))
        self._press(s, 'tasks.a')             # a done → c spawns; c open → no advance
        s.refresh_from_db()
        self.assertEqual(s.status.code, 'gumruk_girish')
        self._press(s, 'tasks.c')
        s.refresh_from_db()
        self.assertEqual(s.status.code, 'gumruk_chykysh')

    def test_rule_not_yet_effective_for_a_shipment_already_in_the_step(self):
        s = self._at()
        ShipmentStatusLog.objects.create(shipment=s, status=s.status, changed_by=self.user)
        _rule('gumruk_girish', 'tasks.new', effective_from=timezone.now() + timezone.timedelta(seconds=1))
        generate_tasks_for_status(s, 'gumruk_girish')
        self.assertFalse(s.tasks.filter(title_key='tasks.new').exists())
        self.assertFalse(has_pending_dependents(s))

    def test_step_entered_at_uses_the_status_log_then_created_at(self):
        s = self._at()
        self.assertEqual(step_entered_at(s), s.created_at)
        log = ShipmentStatusLog.objects.create(shipment=s, status=s.status, changed_by=self.user)
        self.assertEqual(step_entered_at(s), log.changed_at)

    def test_non_gating_field_task_does_not_hold_the_step(self):
        _rule('gumruk_girish', 'tasks.join', completion_rule=TaskCompletionRule.ANY_FIELD_FILLED,
              target_fields='block_sources', gates_step=False)
        _rule('gumruk_girish', 'tasks.a')
        s = self._at()
        generate_tasks_for_status(s, 'gumruk_girish')
        self._press(s, 'tasks.a')
        s.refresh_from_db()
        self.assertEqual(s.status.code, 'gumruk_chykysh')
        self.assertEqual(s.tasks.get(title_key='tasks.join').state, TaskState.OPEN)
```

- [ ] **Step 2: Run the tests** — Expected: ImportError on `task_chain`.

- [ ] **Step 3: Implement `services/task_chain.py`** (engine part; Tasks 3–5 extend this same module)

```python
"""Task chain for PREP / DOCS — docs/Tasks.md items 5b–22.

Deferred creation ("task after N"): a rule with depends_on is created only once
the shipment is at its step AND every prerequisite is satisfied. A prerequisite D
is satisfied when (1) no task titled D is still active, and (2) if there is no
task titled D at all, no applicable + effective rule D of the CURRENT step
exists (it would still be created). A D-rule of an earlier step with no task —
a shipment that crossed the deploy, or a variant that does not apply — counts
as satisfied, so nothing deadlocks.

effective_from: a rule applies only to shipments that entered its step at or
after it (step entry = latest status-log row for the status, else created_at),
so shipments already inside a step at deploy finish on their old tasks.

Spec: docs/superpowers/specs/2026-09-30-prep-docs-tasks-design.md.
"""
import logging
from datetime import datetime

from django.utils import timezone

from apps.export.models import Task, TaskRule, TaskState

logger = logging.getLogger(__name__)

ACTIVE_STATES = (TaskState.OPEN, TaskState.IN_PROGRESS, TaskState.BLOCKED)
MAX_SPAWN_PASSES = 25


def dep_keys(rule: TaskRule) -> list[str]:
    return [k.strip() for k in (rule.depends_on or '').split(',') if k.strip()]


def step_entered_at(shipment) -> datetime:
    from apps.export.models import ShipmentStatusLog

    if shipment.status_id:
        at = (
            ShipmentStatusLog.objects
            .filter(shipment_id=shipment.pk, status_id=shipment.status_id)
            .order_by('-changed_at', '-id')
            .values_list('changed_at', flat=True)
            .first()
        )
        if at:
            return at
    return shipment.created_at


def rule_effective(rule: TaskRule, entered_at: datetime | None) -> bool:
    return rule.effective_from is None or (entered_at is not None and entered_at >= rule.effective_from)


def _step_rules(shipment) -> list[TaskRule]:
    if not shipment.status_id:
        return []
    return list(TaskRule.objects.filter(step=shipment.status.code, is_active=True))


def _deps_satisfied(rule, shipment, step_rules, tasks, entered_at) -> bool:
    from apps.export.services.task_rules import _rule_applies

    for key in dep_keys(rule):
        titled = [t for t in tasks if t.title_key == key]
        if any(t.state in ACTIVE_STATES for t in titled):
            return False
        if not titled and any(
            r.title_key == key and _rule_applies(r, shipment) and rule_effective(r, entered_at)
            for r in step_rules
        ):
            return False
    return True


def _pending_rules(shipment, step_rules, tasks, entered_at) -> list[TaskRule]:
    """Applicable, effective rules of this step with depends_on and no task yet."""
    from apps.export.services.task_rules import _rule_applies

    have = {t.rule_id for t in tasks if t.rule_id}
    return [
        r for r in step_rules
        if dep_keys(r) and r.id not in have
        and _rule_applies(r, shipment) and rule_effective(r, entered_at)
    ]


def has_pending_dependents(shipment) -> bool:
    """E3: a gating dependent of the current step not created yet holds the
    step. Non-gating rules (gates_step=False) never hold it, pending or not."""
    step_rules = _step_rules(shipment)
    if not any(dep_keys(r) and r.gates_step for r in step_rules):
        return False
    tasks = list(shipment.tasks.all())
    return any(r.gates_step for r in _pending_rules(shipment, step_rules, tasks, step_entered_at(shipment)))


def spawn_ready_tasks(shipment) -> list[Task]:
    """Create every dependent task whose prerequisites are now satisfied, close
    the ones already satisfied (downloads / registered checks, Task 4–5), and
    repeat until nothing changes. Returns the tasks created."""
    from apps.export.services.task_rules import create_rule_task, parse_deadline_rule, resolve_for_shipment

    step_rules = _step_rules(shipment)
    if not any(dep_keys(r) for r in step_rules):
        return []
    entered_at = step_entered_at(shipment)
    created_all: list[Task] = []
    for _ in range(MAX_SPAWN_PASSES):
        tasks = list(shipment.tasks.all())
        ready = [r for r in _pending_rules(shipment, step_rules, tasks, entered_at)
                 if _deps_satisfied(r, shipment, step_rules, tasks, entered_at)]
        if not ready:
            break
        now = timezone.now()
        for rule in ready:
            task = create_rule_task(
                shipment=shipment, step=rule.step, rule=rule, title_key=rule.title_key,
                assignee_role=rule.assignee_role, target_fields=rule.target_fields,
                completion_rule=rule.completion_rule, target_value=rule.target_value,
                deadline=parse_deadline_rule(rule.deadline_rule, reference=now),
                deadline_rule=rule.deadline_rule, state=TaskState.OPEN,
            )
            if task is not None:
                created_all.append(task)
        resolve_for_shipment(shipment)
        close_auto_satisfied(shipment)
    return created_all


def close_auto_satisfied(shipment) -> list[Task]:
    """Close open tasks already satisfied outside the field engine (documents
    downloaded, registered ready checks). Filled in by Tasks 4 and 5."""
    return []
```

`task_rules.generate_tasks_for_status`, inside the loop, before `deadline = …`:
```python
        if dep_keys(rule) or not rule_effective(rule, entered_at):
            continue          # deferred (spawn_ready_tasks) or not for this shipment
```
Also:
- Before the loop, add `from apps.export.services.task_chain import dep_keys, rule_effective, spawn_ready_tasks` and `entered_at = step_entered_at(shipment)`, importing `step_entered_at` too.
- After the `if created:` block and before `return created`, add:
```python
    if shipment.status_id and shipment.status.code == new_status_code:
        created += spawn_ready_tasks(shipment)
```

`task_rules.reconcile_shipment_tasks`: in the `if matches:` → `if task is None:` branch, before `if not create_missing:`, add:
```python
                from apps.export.services.task_chain import dep_keys, rule_effective, step_entered_at
                if dep_keys(rule) or not rule_effective(rule, step_entered_at(shipment)):
                    continue      # created by spawn_ready_tasks once its prerequisites are done
```
Then, in the `if created or reopened:` block after `resolve_for_shipment(shipment)`, add:
```python
        from apps.export.services.task_chain import spawn_ready_tasks
        created += spawn_ready_tasks(shipment)
```

`services/shipment.py` `is_step_trigger_satisfied`:
- In `open_auto_tasks_exist`, add `.exclude(rule__gates_step=False)` after the MANUAL_DONE exclude.
- Before `return not open_auto_tasks_exist`, add:
```python
    if (shipment.status_id and shipment.status.code == status_code
            and not open_auto_tasks_exist):
        from apps.export.services.task_chain import has_pending_dependents
        if has_pending_dependents(shipment):
            return False
```

`models/shipment.py`. Add a module-level helper below `_AUTO_ADVANCE_REENTRY`:
```python
def advance_after_tasks(shipment, resolved_tasks) -> bool:
    """auto_advance_if_ready under the same re-entry guard save() uses."""
    if getattr(_AUTO_ADVANCE_REENTRY, 'active', False):
        return False
    try:
        _AUTO_ADVANCE_REENTRY.active = True
        from apps.export.services.shipment import auto_advance_if_ready
        return auto_advance_if_ready(shipment, resolved_tasks=resolved_tasks)
    finally:
        _AUTO_ADVANCE_REENTRY.active = False
```
In `save()`, replace the block after `resolved = resolve_for_shipment(self)` with:
```python
        # Re-entry guard: transition_to() calls shipment.save(update_fields=...)
        # which re-enters this method. Skip spawning and a second auto-advance.
        if getattr(_AUTO_ADVANCE_REENTRY, 'active', False):
            return

        # resolve → spawn the tasks now due → auto-advance (spec §1 ordering).
        # A dependent can only become ready when something closed, so an
        # ordinary Sheet edit that resolved nothing pays nothing here.
        spawned = []
        if resolved:
            from apps.export.services.task_chain import spawn_ready_tasks
            spawned = spawn_ready_tasks(self)
        advance_after_tasks(self, list(resolved) + spawned)
```

Add a temporary `after_task_done` in `task_chain.py` for the tests; Task 3 completes it:
```python
def after_task_done(shipment, user, done_tasks) -> list[Task]:
    """A task closed outside Shipment.save() (button, download, hook): spawn what
    is now due and advance through the normal gate."""
    shipment.updated_by = user
    spawned = spawn_ready_tasks(shipment)
    from apps.export.models.shipment import advance_after_tasks
    advance_after_tasks(shipment, list(done_tasks) + spawned)
    return spawned
```

- [ ] **Step 4: Run the tests** — `t.sh apps.export.tests_task_chain apps.export.tests_auto_advance apps.export.tests_task_engine apps.export.tests_task_condition_reconcile`. Expected: the new tests PASS. The old modules may still carry the known pre-existing failure `draft → yuklenme` in `tests_task_engine`; nothing new may fail.

- [ ] **Step 5: Commit** (on "commit").

---

### Task 3: `confirm` buttons, side effects on close

**Files:**
- Modify: `services/task_chain.py` (`after_task_done` + `apply_task_done_effects`), `services/task_rules.py` (`resolve_for_shipment` calls the effects), `views.py` (`TaskViewSet.complete`)
- Test: `tests_task_chain.py` (effects + API section)

**Interfaces — produces:**
- `apply_task_done_effects(task, shipment) -> None`
- `/complete/` accepts `confirm`.

- [ ] **Step 1: Failing tests**

```python
from rest_framework.test import APIClient
from apps.core.models import ShipmentOptionType


class ChainEffectsTests(ChainFixture):
    def test_complete_accepts_confirm_and_advances(self):
        _rule('gumruk_girish', 'tasks.a')
        s = self._at()
        generate_tasks_for_status(s, 'gumruk_girish')
        task = s.tasks.get(title_key='tasks.a')
        client = APIClient()
        client.force_authenticate(self.user)
        resp = client.post(f'/api/v1/export/tasks/{task.id}/complete/')
        self.assertEqual(resp.status_code, 200, resp.content)
        s.refresh_from_db()
        self.assertEqual(s.status.code, 'gumruk_chykysh')
        self.assertEqual(s.tasks.get(pk=task.pk).completed_by, self.user)

    def test_prepare_transport_docs_sets_documents_in_progress(self):
        _rule('gumruk_girish', 'tasks.prepare_transport_docs')
        _rule('gumruk_girish', 'tasks.hold')                       # keeps the step
        s = self._at()
        generate_tasks_for_status(s, 'gumruk_girish')
        self._press(s, 'tasks.prepare_transport_docs')
        s.refresh_from_db()
        self.assertEqual(s.documents_status, 'in_progress')

    def test_docs_from_customs_sets_the_gumrukden_geldi_option(self):
        ShipmentOptionType.objects.get_or_create(
            category='documents_status', code='Gümrükden geldi',
            defaults={'label_tk': 'Gümrükden geldi', 'is_active': True})
        _rule('gumruk_chykysh', 'tasks.docs_from_customs', completion_rule=TaskCompletionRule.ALL_FIELDS_FILLED,
              target_fields='customs_exit_at')
        s = self._at('gumruk_chykysh')
        generate_tasks_for_status(s, 'gumruk_chykysh')
        s.customs_exit_at = timezone.now()
        s.save()
        s.refresh_from_db()
        self.assertEqual(s.documents_status, 'Gümrükden geldi')

    def test_manual_edit_after_the_effect_is_kept(self):
        _rule('gumruk_girish', 'tasks.prepare_transport_docs')
        _rule('gumruk_girish', 'tasks.hold')
        s = self._at()
        generate_tasks_for_status(s, 'gumruk_girish')
        self._press(s, 'tasks.prepare_transport_docs')
        Shipment.objects.filter(pk=s.pk).update(documents_status='ready')
        s.refresh_from_db()
        s.save()
        s.refresh_from_db()
        self.assertEqual(s.documents_status, 'ready')
```

If `ShipmentOptionType` has other required fields, add them to the `get_or_create` defaults (see `core/models/logistics.py`).

- [ ] **Step 2: Run the tests.** Expected: the first test fails with 400; the effect tests fail.

- [ ] **Step 3: Implement**

`task_chain.py`: replace the temporary `after_task_done` and add the effects:
```python
DOCS_IN_PROGRESS = 'in_progress'
FROM_CUSTOMS_LABEL = 'Gümrükden geldi'


def apply_task_done_effects(task: Task, shipment) -> None:
    """One-shot side effects at close (spec §4). Never re-applied later, so a
    manual edit of «Resminamalar 13:00» after it stands."""
    from apps.export.models import Shipment

    if task.title_key == 'tasks.prepare_transport_docs':
        if shipment.documents_status in (None, '', 'ready'):
            Shipment.objects.filter(pk=shipment.pk).update(documents_status=DOCS_IN_PROGRESS)
            shipment.documents_status = DOCS_IN_PROGRESS
    elif task.title_key == 'tasks.docs_from_customs':
        from apps.core.models import ShipmentOptionType

        code = (
            ShipmentOptionType.objects
            .filter(category='documents_status', label_tk__iexact=FROM_CUSTOMS_LABEL, is_active=True)
            .order_by('id').values_list('code', flat=True).first()
        )
        if code is None:
            logger.warning('No active documents_status option «%s»; %s left unchanged',
                           FROM_CUSTOMS_LABEL, shipment.shipment_code)
            return
        Shipment.objects.filter(pk=shipment.pk).update(documents_status=code)
        shipment.documents_status = code


def after_task_done(shipment, user, done_tasks) -> list[Task]:
    """A task closed outside Shipment.save() (button, download, hook): apply its
    effects, spawn what is now due, advance through the normal gate."""
    for task in done_tasks:
        apply_task_done_effects(task, shipment)
    shipment.updated_by = user
    spawned = spawn_ready_tasks(shipment)
    from apps.export.models.shipment import advance_after_tasks
    advance_after_tasks(shipment, list(done_tasks) + spawned)
    return spawned
```

`task_rules.resolve_for_shipment`: in the loop, after `task.save(...)` and `resolved.append(task)`, add:
```python
            from apps.export.services.task_chain import apply_task_done_effects
            apply_task_done_effects(task, shipment)
```

`views.py` `TaskViewSet.complete`:
- Replace `if task.completion_rule != TaskCompletionRule.MANUAL_DONE:` with `if task.completion_rule not in (TaskCompletionRule.MANUAL_DONE, TaskCompletionRule.CONFIRM):` and keep the error text.
- After `task.save(update_fields=['state', 'completed_at', 'started_at', 'completed_by'])`, add:
```python
        if task.completion_rule == TaskCompletionRule.CONFIRM and task.shipment_id:
            # A confirm task holds its step: spawn what is now due and advance.
            from apps.export.services.task_chain import after_task_done
            after_task_done(task.shipment, request.user, [task])
```
Also update the docstring: "Manually marks a MANUAL_DONE or CONFIRM task as DONE."

- [ ] **Step 4: Run the tests** — `t.sh apps.export.tests_task_chain apps.export.tests_task_api`. Expected: PASS.

- [ ] **Step 5: Commit** (on "commit").

---

### Task 4: Document downloads close print tasks

**Files:**
- Modify: `services/task_chain.py` (`DOC_TASKS`, `record_document_download`, `close_auto_satisfied`)
- Modify: `backend/apps/contracts/views.py` — `ShipmentCmrView.get`, `ShipmentTirView.get`, `ContractSaleViewSet.document`, `ShipmentPacketZipView.get`
- Test: `backend/apps/export/tests_task_documents.py`

**Interfaces — produces:** `record_document_download(shipment, doc_keys: list[str], user) -> list[Task]`.

- [ ] **Step 1: Failing tests** (`tests_task_documents.py`)

```python
"""Print tasks close when the document is downloaded (spec §3, A-1…A-3)."""
from apps.export.models import ShipmentDocumentDownload, TaskCompletionRule, TaskState
from apps.export.services.task_chain import record_document_download
from apps.export.services.task_rules import generate_tasks_for_status
from apps.export.tests_task_chain import ChainFixture, _rule


class DocumentDownloadTests(ChainFixture):
    def test_cmr_download_closes_print_cmr(self):
        _rule('gumruk_girish', 'tasks.print_cmr')
        _rule('gumruk_girish', 'tasks.hold')
        s = self._at()
        generate_tasks_for_status(s, 'gumruk_girish')
        record_document_download(s, ['cmr'], self.user)
        task = s.tasks.get(title_key='tasks.print_cmr')
        self.assertEqual((task.state, task.completed_by), (TaskState.DONE, self.user))
        self.assertTrue(ShipmentDocumentDownload.objects.filter(shipment=s, doc_key='cmr').exists())

    def test_packet_downloaded_before_the_chain_closes_later_tasks_on_arrival(self):
        _rule('gumruk_girish', 'tasks.print_cmr')
        _rule('gumruk_girish', 'tasks.print_ct1', depends_on='tasks.print_cmr')
        _rule('gumruk_girish', 'tasks.print_phyto', depends_on='tasks.print_ct1')
        _rule('gumruk_girish', 'tasks.ct1_phyto_sent', depends_on='tasks.print_ct1,tasks.print_phyto')
        s = self._at()
        generate_tasks_for_status(s, 'gumruk_girish')
        record_document_download(s, ['cmr', 'ct1', 'phyto', 'customs_request'], self.user)
        states = dict(s.tasks.values_list('title_key', 'state'))
        # (assertions below)
        self.assertEqual(states['tasks.print_cmr'], TaskState.DONE)
        self.assertEqual(states['tasks.print_ct1'], TaskState.DONE)
        self.assertEqual(states['tasks.print_phyto'], TaskState.DONE)
        self.assertEqual(states['tasks.ct1_phyto_sent'], TaskState.OPEN)     # a button, not a download

    def test_closed_season_download_changes_nothing(self):
        from django.utils import timezone
        _rule('gumruk_girish', 'tasks.print_cmr')
        s = self._at()
        generate_tasks_for_status(s, 'gumruk_girish')
        type(self.season).objects.filter(pk=self.season.pk).update(closed_at=timezone.now())
        s.refresh_from_db()
        self.assertEqual(record_document_download(s, ['cmr'], self.user), [])
        self.assertFalse(ShipmentDocumentDownload.objects.filter(shipment=s).exists())
        self.assertEqual(s.tasks.get(title_key='tasks.print_cmr').state, TaskState.OPEN)
```

Also add **endpoint tests** in `backend/apps/contracts/tests_prepare_contract_task.py`, reusing the fixture of the existing packet test (`grep -rn "packet.zip" backend/apps/contracts/tests*.py`):
- `GET /api/v1/contracts/shipments/{id}/packet.zip` → 200, and `print_cmr`, `print_ct1`, `print_phyto`, `print_customs_request` are DONE (Review Focus #3).
- A CMR download on a closed-season shipment → 200, nothing is closed.

Add one endpoint test in `backend/apps/contracts/tests_prepare_contract_task.py` (Task 5 file) for the CMR view. Build the fixture the same way the existing CMR endpoint tests do (`grep -rn "cmr/" backend/apps/contracts/tests*.py` shows them), and assert that `print_cmr` is DONE after a 200 response.

- [ ] **Step 2: Run the tests.** Expected: ImportError.

- [ ] **Step 3: Implement** in `task_chain.py`:
```python
DOC_TASKS = {
    'cmr': 'tasks.print_cmr',
    'tir': 'tasks.print_tir',
    'ct1': 'tasks.print_ct1',
    'phyto': 'tasks.print_phyto',
    'customs_request': 'tasks.print_customs_request',
}
_READY_CHECKS: dict = {}          # title_key -> callable(shipment) -> bool (Task 5)


def register_ready_check(title_key: str, check) -> None:
    _READY_CHECKS[title_key] = check


def _close(tasks, user) -> None:
    now = timezone.now()
    for task in tasks:
        task.state = TaskState.DONE
        task.completed_at = now
        task.started_at = task.started_at or now
        task.completed_by = user
        task.save(update_fields=['state', 'completed_at', 'started_at', 'completed_by'])


def close_auto_satisfied(shipment) -> list[Task]:
    """Close open print tasks whose document was already downloaded, and open
    tasks whose registered ready check passes."""
    from apps.export.models import ShipmentDocumentDownload

    open_tasks = list(shipment.tasks.filter(state__in=[TaskState.OPEN, TaskState.IN_PROGRESS]))
    if not open_tasks:
        return []
    downloads = {}
    for key, user_id in (
        ShipmentDocumentDownload.objects.filter(shipment_id=shipment.pk)
        .order_by('downloaded_at').values_list('doc_key', 'downloaded_by_id')
    ):
        downloads[DOC_TASKS.get(key)] = user_id           # latest downloader wins
    closed = []
    for task in open_tasks:
        if task.title_key in downloads:
            task.completed_by_id = downloads[task.title_key]
            _close([task], task.completed_by)
            closed.append(task)
        elif task.title_key in _READY_CHECKS and _READY_CHECKS[task.title_key](shipment):
            _close([task], getattr(shipment, 'updated_by', None))
            closed.append(task)
    for task in closed:
        apply_task_done_effects(task, shipment)
    return closed


def record_document_download(shipment, doc_keys, user) -> list[Task]:
    from apps.export.models import ShipmentDocumentDownload

    # Closed seasons are frozen (D1): the download still succeeds, nothing is
    # recorded or closed — transition_to would refuse inside a GET.
    if shipment.season_id and shipment.season.closed_at is not None:
        return []
    ShipmentDocumentDownload.objects.bulk_create(
        [ShipmentDocumentDownload(shipment=shipment, doc_key=k, downloaded_by=user) for k in doc_keys],
        batch_size=500,
    )
    closed = close_auto_satisfied(shipment)
    if closed:
        after_task_done(shipment, user, closed)
    return closed
```
- Replace the stub `close_auto_satisfied` from Task 2 with this version.
- In `_close`, `completed_by=None` when the id is None is fine.
- Make `close_auto_satisfied` set `completed_by_id` directly. Keep it this simple, and don't pass a user object where you only have an id.

In `contracts/views.py`, just before each successful `return response`:
- `ShipmentCmrView.get`, `ShipmentTirView.get`, `ShipmentPacketZipView.get`: add
```python
        from apps.export.services.task_chain import record_document_download
        record_document_download(shipment, ['cmr'], request.user)          # TIR: ['tir']
```
  For the packet, pass `['cmr', 'ct1', 'phyto', 'customs_request']`.
- `ContractSaleViewSet.document` (the sale is `invoice`):
```python
        doc_key = {'ct1_ru': 'ct1', 'fito_ru': 'phyto', 'customs_tk': 'customs_request'}.get(doc_type)
        if doc_key and invoice.shipment_id:
            from apps.export.services.task_chain import record_document_download
            record_document_download(invoice.shipment, [doc_key], request.user)
```

- [ ] **Step 4: Run the tests** — `t.sh apps.export.tests_task_documents apps.export.tests_task_chain` plus the contracts CMR/TIR/packet test modules (`ls backend/apps/contracts/tests*`; those that hit `cmr/`, `tir/`, `packet.zip`, `document`). Expected: PASS.

- [ ] **Step 5: Commit** (on "commit").

---

### Task 5: Contract readiness (item 9)

**Files:**
- Modify: `backend/apps/contracts/models/contract.py` (`agreement_downloaded_at`)
- Create: `backend/apps/contracts/migrations/0014_contract_agreement_downloaded_at.py` (makemigrations; nullable)
- Create: `backend/apps/contracts/services/task_checks.py`
- Modify:
  - `backend/apps/contracts/apps.py`: `ready()` registers the check.
  - `backend/apps/contracts/views.py`: `ContractViewSet.agreement`, `ShipmentFirmContractsView.post`, `ContractSaleViewSet.perform_create` / `perform_update`.
- Test: `backend/apps/contracts/tests_prepare_contract_task.py`

**Interfaces:**
- Consumes: `register_ready_check`, `close_auto_satisfied`, `after_task_done` (Task 4).
- Produces:
  - `contracts_ready(shipment) -> bool`
  - `sync_prepare_contract(shipment, user) -> None`

- [ ] **Step 1: Failing tests.** In the same style as the existing contracts tests (`grep -n "ContractSale.objects.create\|Contract.objects.create" backend/apps/contracts/tests*.py`), build:
  - a shipment at `gumruk_girish` with two firm splits (firms A, B);
  - the rule `tasks.prepare_contract` (CONFIRM, depends_on `''`);
  - `generate_tasks_for_status`.

Assert:
1. A sale with a contract for A only → task open.
2. Sales with contracts for A and B, no agreement downloaded → task open.
3. `GET /api/v1/contracts/contracts/{id}/agreement/` for A's contract, then for B's → the task is DONE after the second (the view runs `sync_prepare_contract` for every shipment with a non-void sale on that contract).
4. `contracts_ready` ignores void sales.

- [ ] **Step 2: Run the tests.** Expected: FAIL/ERROR.

- [ ] **Step 3: Implement**

`contract.py`: add
```python
    # First time the agreement document was generated (docs/Tasks.md item 9,
    # «Kontrakt saýla/döret we ýükle»). Set by the agreement endpoint.
    agreement_downloaded_at = models.DateTimeField(null=True, blank=True)
```
Run `makemigrations contracts --name contract_agreement_downloaded_at`, then `migrate contracts`.

`services/task_checks.py`:
```python
"""Contract readiness for the export task chain (docs/Tasks.md item 9).

Registered into apps.export.services.task_chain from ContractsConfig.ready() —
contracts may import export, never the reverse.
"""
from apps.contracts.models import ContractSale

PREPARE_CONTRACT = 'tasks.prepare_contract'


def contracts_ready(shipment) -> bool:
    """Every export firm on the truck has a non-void sale with a contract whose
    agreement has been downloaded at least once."""
    firms = set(shipment.firm_splits.values_list('export_firm_id', flat=True))
    if not firms:
        return False
    covered = set(
        ContractSale.objects
        .filter(shipment=shipment, contract__isnull=False, contract__agreement_downloaded_at__isnull=False)
        .exclude(status=ContractSale.STATUS_VOID)
        .values_list('export_firm_id', flat=True)
    )
    return firms <= covered


def sync_prepare_contract(shipment, user) -> None:
    from apps.export.services.task_chain import after_task_done, close_auto_satisfied

    if shipment.season_id and shipment.season.closed_at is not None:
        return        # closed season: frozen (D1)
    shipment.updated_by = user
    closed = close_auto_satisfied(shipment)
    if closed:
        after_task_done(shipment, user, closed)
```

`apps.py`:
```python
    def ready(self):
        from apps.contracts.services.task_checks import PREPARE_CONTRACT, contracts_ready
        from apps.export.services.task_chain import register_ready_check

        register_ready_check(PREPARE_CONTRACT, contracts_ready)
```

`views.py`:
- `ContractViewSet.agreement`, before `return response`:
```python
        if contract.agreement_downloaded_at is None:
            Contract.objects.filter(pk=contract.pk).update(agreement_downloaded_at=timezone.now())
        # Only shipments still waiting on item 9 — a season contract can cover
        # dozens of trucks, and this is a GET.
        from apps.contracts.services.task_checks import PREPARE_CONTRACT, sync_prepare_contract
        from apps.export.models import Shipment, TaskState
        waiting_ids = (
            contract.sales.exclude(status=ContractSale.STATUS_VOID)
            .filter(shipment__tasks__title_key=PREPARE_CONTRACT,
                    shipment__tasks__state__in=[TaskState.OPEN, TaskState.IN_PROGRESS])
            .order_by().values_list('shipment_id', flat=True).distinct()
        )
        for shipment in Shipment.objects.filter(id__in=list(waiting_ids)).select_related('season'):
            sync_prepare_contract(shipment, request.user)
```
  Import `timezone` and `Contract` if not already imported in that file.
- `ShipmentFirmContractsView.post`, before the success `return Response({...})`: `sync_prepare_contract(shipment, request.user)`.
- `ContractSaleViewSet.perform_create` / `perform_update`, after `sale = serializer.save()`: `if sale.shipment_id: sync_prepare_contract(sale.shipment, self.request.user)`.

- [ ] **Step 4: Run the tests** — `t.sh apps.contracts.tests_prepare_contract_task` plus the existing contracts suites touched (agreement, firm-contracts, sale create/update). Expected: PASS.

- [ ] **Step 5: Commit** (on "commit").

---

### Task 6: Other write paths — join / swap, advances

**Files:**
- Modify: `backend/apps/export/views.py` (`ShipmentViewSet.join`), `backend/apps/export/services/packaging.py` (`swap_packing`), `backend/apps/export/views_finance.py` (advance create + link-shipment)
- Test: `backend/apps/export/tests_task_chain.py` (write-path section)

**Interface — produces:** `refresh_tasks_after_write(shipment, user) -> None` in `task_chain.py`.

- [ ] **Step 1: Failing tests.** Use the existing join/advance test fixtures as models (`tests_packing.py` for join/swap, `tests_*advance*` or `views_finance` tests for advances).
  - A draft destination plan with an open `join_supply` task (rule ANY_FIELD_FILLED `block_sources`, `gates_step=False`) gets packing joined via `POST /shipments/{target}/join/` → the task is DONE.
  - A shipment with an open `give_advance` task (ANY_FIELD_FILLED `advance_links`) is linked in the advance create endpoint → DONE; the same via `link-shipment`.
  - A gapy↔regular flip at `draft` before `set_destination` is done does not create `choose_truck` / `assign_driver` (they depend on `set_destination`).

- [ ] **Step 2: Run the tests.** Expected: FAIL (tasks stay open).

- [ ] **Step 3: Implement** in `task_chain.py`:
```python
def refresh_tasks_after_write(shipment, user) -> None:
    """For writes that bypass Shipment.save() (QuerySet.update moves, link rows):
    resolve field tasks, then spawn/effects/advance like any other close."""
    from apps.export.services.task_rules import resolve_for_shipment

    shipment.updated_by = user
    resolved = resolve_for_shipment(shipment)
    after_task_done(shipment, user, resolved)
```
Call it:
- `join` → for `target`, after the transaction that moves the packing, before the success `return`.
- `swap_packing` → for both `a` and `b`, at the end, before `return a, b`.
- `views_finance.py` → after `bulk_create(links, …)`, for each linked shipment (`Shipment.objects.filter(id__in=shipment_ids)`); after `FinansistAdvanceShipment.objects.create(...)` in the link action, for that shipment.

The gapy/regular-flip test should pass already through Task 2's `reconcile_shipment_tasks` change. If it doesn't, fix it there.

- [ ] **Step 4: Run the tests** — `t.sh apps.export.tests_task_chain apps.export.tests_packing apps.export.tests_shipment_join` plus the finance/advance test module. Expected: PASS.

- [ ] **Step 5: Commit** (on "commit").

---

### Task 7: The catalog (seed) + full-path tests

**Files:**
- Modify: `backend/apps/export/management/commands/seed_task_rules.py`
- Test: `backend/apps/export/tests_prep_docs_catalog.py`; update the existing task tests that encode the old draft/customs catalog.

**Interfaces:**
- Consumes: everything above.
- Produces: the 5b–22 rules. Seed entries may carry `'new_in_catalog': True`. That key is popped before `update_or_create`, and it means "set `effective_from=now()` when this row is created".

- [ ] **Step 1: Failing tests** (`tests_prep_docs_catalog.py`). Seed the rules, then build a regular shipment with a destination (country, customer, import firm).
  - **Regular path:** `draft` has `set_destination`, then `pick_export_firms` + `choose_truck` + `join_supply`. After a firm split and `truck_head_id`, the shipment moves to `gumruk_girish`.
  - Continue: add `packing_template`, press `prepare_contract`, press `prepare_transport_docs`, and record the downloads `cmr, tir, ct1, phyto, customs_request`.
  - Then press `ct1_phyto_sent`, `docs_to_stamp`, `docs_from_stamp`, `prepare_declaration`, add an advance link, and press `docs_to_customs` → the shipment is at `gumruk_chykysh` with `docs_from_customs` open.
  - Set `customs_exit_at` → the task is DONE and `documents_status` is the «Gümrükden geldi» option.
  - **Gapy path:** `assign_driver` (document_team; driver_name, truck_plate, driver_phone) instead of `choose_truck`; `prepare_transport_docs` waits for it.
  - **Deploy crossing:** the shipment enters `draft` with only the OLD rules. Deactivate them, seed the new catalog, finish the old draft tasks → the shipment enters `gumruk_girish` and reaches `gumruk_chykysh` via the new chain.
  - **In-flight:** a shipment whose `gumruk_girish` log row predates the seed gets no new `gumruk_girish` tasks and advances on its old `trigger_customs_exit` task.

- [ ] **Step 2: Run the tests.** Expected: FAIL (old catalog).

- [ ] **Step 3: Implement the seed.** In `TASK_RULES`, make these changes.

Set `is_active: False` on these rules (keep the rows):
- `set_border_point`
- `give_documents`
- `give_documents_gapy`
- `start_documents_prep`
- `trigger_customs_exit`
- the regular `assign_driver` (transport, `is_gapy_satys=False`)

Update rows that already exist (same key):
- `set_destination`: unchanged targets.
- `pick_export_firms`: `depends_on='tasks.set_destination'`.
- gapy `assign_driver`:
  - `target_fields='driver_name,truck_plate,driver_phone'`
  - `depends_on='tasks.set_destination'`
  - `deadline_rule=''`

Add these new rules. Every one has `'new_in_catalog': True`, `deadline_rule=''` and `target_value=''`. Condition fields are blank unless noted.

| step | title_key | role | completion_rule | target_fields | depends_on | extra |
|---|---|---|---|---|---|---|
| draft | tasks.join_supply | export_manager | ANY_FIELD_FILLED | block_sources | tasks.set_destination | gates_step=False |
| draft | tasks.choose_truck | export_manager | ALL_FIELDS_FILLED | truck_head_id | tasks.set_destination | condition is_gapy_satys=False |
| gumruk_girish | tasks.prepare_contract | document_team | CONFIRM | '' | tasks.pick_export_firms | |
| gumruk_girish | tasks.fill_gross_net | document_team | ALL_FIELDS_FILLED | packing_template | tasks.pick_export_firms | |
| gumruk_girish | tasks.prepare_transport_docs | document_team | CONFIRM | '' | tasks.choose_truck,tasks.assign_driver | |
| gumruk_girish | tasks.print_cmr | document_team | CONFIRM | '' | tasks.prepare_contract,tasks.fill_gross_net,tasks.prepare_transport_docs | |
| gumruk_girish | tasks.print_tir | document_team | CONFIRM | '' | tasks.prepare_transport_docs | |
| gumruk_girish | tasks.print_ct1 | document_team | CONFIRM | '' | tasks.print_cmr | |
| gumruk_girish | tasks.print_phyto | document_team | CONFIRM | '' | tasks.print_ct1 | |
| gumruk_girish | tasks.ct1_phyto_sent | document_team | CONFIRM | '' | tasks.print_ct1,tasks.print_phyto | |
| gumruk_girish | tasks.print_customs_request | document_team | CONFIRM | '' | tasks.print_cmr | |
| gumruk_girish | tasks.docs_to_stamp | document_team | CONFIRM | '' | tasks.ct1_phyto_sent,tasks.print_customs_request | |
| gumruk_girish | tasks.docs_from_stamp | document_team | CONFIRM | '' | tasks.docs_to_stamp | |
| gumruk_girish | tasks.give_advance | finansist | ANY_FIELD_FILLED | advance_links | '' | |
| gumruk_girish | tasks.prepare_declaration | document_team | CONFIRM | '' | tasks.docs_from_stamp | |
| gumruk_girish | tasks.docs_to_customs | document_team | CONFIRM | '' | tasks.give_advance,tasks.prepare_declaration | |
| gumruk_chykysh | tasks.docs_from_customs | document_team | ALL_FIELDS_FILLED | customs_exit_at | '' | |

`give_advance` and `docs_from_customs` have no `depends_on`, so they are created at step entry. Give them `'new_in_catalog': True` too, so in-flight shipments don't get them.

In `handle()`, in the loop:
```python
                rule_data = dict(rule_data)
                new_in_catalog = rule_data.pop('new_in_catalog', False)
                ...
                _rule, created = TaskRule.objects.update_or_create(**key, defaults=defaults)
                if created and new_in_catalog:
                    TaskRule.objects.filter(pk=_rule.pk).update(effective_from=timezone.now())
```
Import `from django.utils import timezone`. Pop `new_in_catalog` before building `defaults`.

Update the comment block above the old draft rules: the owner replaced this catalog 2026-09-30 (docs/Tasks.md 5b–22); the rows stay inactive for history.

- [ ] **Step 4: Run the full task suite.**
```
t.sh apps.export.tests_prep_docs_catalog apps.export.tests_task_chain apps.export.tests_task_documents \
     apps.export.tests_auto_advance apps.export.tests_task_engine apps.export.tests_task_seed \
     apps.export.tests_packing_part_tasks apps.export.tests_border_point_task apps.export.tests_role_lifecycle \
     apps.export.tests_task_condition_reconcile apps.export.tests_task_condition_reconcile_api \
     apps.export.tests_draft_promote apps.export.tests_gapy_terminal apps.export.tests_shipment_join
```
Expected: the new modules pass.

Tests in the older modules that fail because they encode the OLD draft/customs catalog get updated:
- `set_border_point`, `start_documents_prep`, `give_documents*`, `trigger_customs_exit`, transport `assign_driver`;
- counts of draft tasks;
- `draft → gumruk_girish` via `documents_status`.

Change each to the new catalog, or mark it as history of a deactivated rule by giving the test its own inactive rule. Ledger each changed test as a `Ruling:`. Do not change the known pre-existing failures (`draft → yuklenme` in `tests_task_engine`, the duplicate-task insert in `tests_completeness`).

- [ ] **Step 5: Commit** (on "commit").

---

### Task 8: Frontend

**Files:**
- Modify:
  - `frontend/src/types/index.ts`: `TaskCompletionRule` gains `'confirm'`; `ITaskRule` gains `completion_rule` `'confirm'`, `depends_on: string[]`, `gates_step: boolean`.
  - `frontend/src/components/kanban/SelfBoardActiveTaskPanel.tsx` and `frontend/src/components/shipment/MyTaskCard.tsx`: the button shows for `confirm` too; per-task label; join-supply link.
  - `frontend/src/pages/export/TaskRulesPage.tsx`: `RULE_COLOR.confirm`, a `completes_confirm` label, «after:» tags.
  - i18n tk/ru/en.
- Test: `frontend/src/components/kanban/SelfBoardActiveTaskPanel.confirm.test.tsx` (mock the hooks the way `SelfBoardActiveTaskPanel.test.tsx` does); extend `TaskRulesPage.test.tsx`.

- [ ] **Step 1: Failing tests**
  - A `confirm` task renders its per-task button: `tasks.button.print_cmr` → «Printed» in en.
  - Clicking it calls the complete mutation.
  - `join_supply` renders a link to `/export/assign`.
  - TaskRulesPage shows `after: …` for a rule with `depends_on`.

- [ ] **Step 2: Run them.** Expected: FAIL.

- [ ] **Step 3: Implement.**
  - In both components: `const isButtonTask = task.completion_rule === 'manual_done' || task.completion_rule === 'confirm';` replaces `isManualDone` in `canComplete`.
  - Button label: `t(\`tasks.button.${task.title_key.replace('tasks.', '')}\`, { defaultValue: t('shipment.detail.mark_done') })`.
  - For `task.title_key === 'tasks.join_supply'`, render `<Link to="/export/assign"><Button size="small">{t('tasks.open_assign_board')}</Button></Link>`.
  - TaskRulesPage:
    - `RULE_COLOR` gets `confirm: 'orange'`;
    - the completion tag shows `t('task_rules.completes_confirm')` for `confirm`;
    - under the targets, when `rule.depends_on.length`, render `t('task_rules.after')` + tags of `t(key)`.

i18n (tk / ru / en):
- Titles of the 18 new keys, as in the spec table. Update the texts of `tasks.set_destination` («Eksport maglumatlaryny dolduryň» / «Заполните данные экспорта» / «Fill in the export details») and `tasks.assign_driver` («Transport maglumatlaryny dolduryň» / «Заполните данные транспорта» / «Fill in the transport details»).
- Buttons `tasks.button.*`:

| key(s) | tk | ru | en |
|---|---|---|---|
| prepare_transport_docs, prepare_declaration | Taýýarladym | Подготовил | Prepared |
| print_cmr, print_tir, print_ct1, print_phyto, print_customs_request | Çap etdim | Распечатал | Printed |
| ct1_phyto_sent, docs_to_stamp, docs_to_customs | Ugradyldy | Отправлено | Sent |
| docs_from_stamp | Geldi | Вернулись | Back |
| prepare_contract | Taýýar | Готово | Done |

- `tasks.open_assign_board`: Birikdirme tagtasy / Доска присоединения / Assignment board.
- `task_rules.completes_confirm`: Düwme (ädimi saklaýar) / Кнопка (держит шаг) / Button (holds the step).
- `task_rules.after`: Soňra: / После: / After:.

- [ ] **Step 4: Run** `npx vitest run src/components/kanban src/components/shipment src/pages/export/TaskRulesPage.test.tsx` and `npx tsc --noEmit --ignoreDeprecations 5.0`. Expected: PASS, tsc 0.

- [ ] **Step 5: Commit** (on "commit").

---

### Task 9: Docs

- [ ] Update these docs. Each change is marked 2026-09-30 and links the spec.
  - `docs/obsidian/reference/task-rules.md`:
    - the new catalog table for `draft` / `gumruk_girish` / `gumruk_chykysh`;
    - `confirm`, `depends_on`, `gates_step`, `effective_from`;
    - the deactivated rules.
  - `docs/obsidian/reference/task.md`: an engine paragraph on deferred creation, E3 and the ordering.
  - `.claude/skills/api-contract/SKILL.md`: `TaskRule` payload gains `depends_on` (list) and `gates_step`; `/complete/` accepts `confirm`; document endpoints now also close print tasks.
  - `CHANGELOG.md` (Added + Changed).
  - `BUILD_TEST_LOG.md`: `- [ ] 2026-09-30 — PREP+DOCS task chain (Tasks.md 5b–22) — NEEDS TEST`.
  - Add a gap-map status note that items 5b–22 are done.
- [ ] **Deploy note** (CHANGELOG):
  - `migrate export contracts` has already run on the shared DB (the columns are nullable or DB-defaulted).
  - After deploying this code, run `seed_task_rules`.
  - Rebuild celery.
- [ ] Commit (on "commit").
