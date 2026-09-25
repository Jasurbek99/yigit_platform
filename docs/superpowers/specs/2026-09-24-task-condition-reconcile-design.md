# Task condition re-evaluation — Design (feature B)

**Date:** 2026-09-24
**Status:** Design approved in chat, spec pending review
**Module:** `export` (Task engine), `frontend` (notification bell)
**Part of:** the task-lifecycle sequence — see
[[2026-09-24-task-lifecycle-roadmap]]. This spec is **B only**; the rule editor,
task ordering (A) and rollback (C) come after it and have their own specs.

## Goal

A shipment's own fields decide which tasks apply to it — `is_gapy_satys` picks
between the Regular and the Gapy-Satyş variants of `tasks.assign_driver` and
`tasks.give_documents`; `has_peregruz` picks the transshipment fork. Those fields
are edited on the Sheet **while the shipment already sits in a step**, but tasks
are generated only once, at step entry.

So today, when a manager ticks Gapy-Satyş on a draft:

- the Regular-variant tasks stay OPEN forever — nobody can satisfy them and they
  keep blocking auto-advance;
- the Gapy-variant tasks are **never created at all**, because
  `generate_tasks_for_status` runs only from `transition_to`.

This is a live bug, not a missing nicety. The fix is one service function that
re-decides which tasks should exist for a shipment, plus the column and the
notification that make the outcome legible.

## Confirmed decisions (from the brainstorm, 2026-09-23/24)

| # | Question | Decision |
|---|---|---|
| B-1 | Open tasks whose condition no longer matches | `CANCELLED` |
| B-2 | Tasks already `DONE` under the old condition | **Never touched.** The work was really done; KPI keeps the credit. |
| B-3 | Automatic, or preview → confirm? | **Automatic**, no modal. |
| B-4 | Who is told | `document_team`, `export_manager`, `transport` — generalised to *roles owning the affected tasks* ∪ `STATUS_NOTIFY_ROLES[step]`, which equals those three at `draft`. |
| B-5 | New `superseded` task state? | **No.** A `cancelled_reason` column instead — a new state would touch board columns, their i18n ×3, filters, the TS state union, KPI and every `state__in` list, all to buy a better word. |
| B-6 | Where the re-evaluation is triggered | `ShipmentViewSet.partial_update`, **not** `Shipment.save()` (see Safety). |
| B-7 | Historical shipments already in a bad state | Repaired by an explicit `reconcile_tasks` run, never as a side effect of an operator's save. |
| B-8 | Notification bell not clickable (found in passing) | Fixed inside this spec. |

## Behaviour rules

1. **Match** is unchanged from today's contract: a rule with a blank
   `condition_field` always matches; otherwise
   `str(getattr(shipment, condition_field)) == condition_value`
   (`_condition_matches`, `services/task_rules.py:143`).
2. **Scope** is the `is_active=True` rules whose `step` is in `steps`, **whose
   `condition_field` is non-blank, and — when the caller passes
   `changed_fields` — whose `condition_field` is among them.** Added after
   review: without that filter the create branch fires for every active rule
   with no Task row, which makes this function `backfill_tasks` with no opt-out
   and reverses the 2026-09-23 `tasks.set_border_point` decision (the 69 legacy
   non-gapy drafts must stay unblocked; `seed_task_rules.py` says so in the
   rule's own comment). For the same reason the bulk repair path defaults to
   `create_missing=False`: a routine `reconcile_tasks` run cancels what a
   condition change stranded but never emits, and `--create-missing` opts in.
   A per-shipment PATCH does create, because a deliberate edit to one shipment
   should give it the task its new state calls for — which does mean that
   toggling `is_gapy_satys` twice on one of those 69 drafts will gate it. A Task whose
   rule is inactive, or whose `rule_id` is NULL (`Task.rule` is
   `null=True, blank=True` — "null if ad-hoc", `models/task.py:118-122`), is
   outside scope and is never touched by this feature — deactivation is the rule
   editor's job and writes `rule_deactivated`.
3. For each rule in scope, exactly one of five outcomes:
   - rule matches, **no** Task row for `(shipment, rule)` → **create**, deadline
     computed from now;
   - rule matches, Task is `CANCELLED` with `cancelled_reason='rule_mismatch'`
     → **reopen** (`state=OPEN`, `cancelled_reason=''`);
   - rule does **not** match, Task is `OPEN`/`IN_PROGRESS`/`BLOCKED` →
     **cancel** with `cancelled_reason='rule_mismatch'`;
   - Task is `DONE` → untouched, whatever the condition now says (B-2);
   - Task is `CANCELLED` for any other reason → untouched. `manual` and
     `shipment_cancelled` therefore never get resurrected, which is the point of
     the column.
4. **Re-open is accepted as a no-op for the operator.** Flip Gapy on, let
   transport assign the driver, flip Gapy off: the Regular task reopens, but its
   target field is already filled, so the closing `resolve_for_shipment` marks it
   DONE in the same call. Nobody is asked to do work twice. The alternative —
   "do not reopen when a DONE task shares the `title_key`" — is deliberately
   rejected: admin-created rules will carry `title_text` and an empty
   `title_key`, so that special case would silently stop working.
5. **Idempotent.** A second call with the same shipment state changes nothing and
   sends no notification.
6. **Closed seasons are never touched.** Same bound the rule editor uses.

## Safety — why not `Shipment.save()`

Hooking the reconciler into `Shipment.save()` is the obvious move and it is
wrong, for two independent reasons.

**It races `transition_to`.** `transition_to` assigns the new status and calls
`save(update_fields=...)` (`services/shipment.py:302-306`), and only then calls
`generate_tasks_for_status` (line 322). A reconciler inside `save()` would run
against the *new* step before that step's tasks exist, decide the matching rules
have no tasks, and create them itself — so task creation would happen through two
code paths with different ordering, two lines apart. The existing re-entry guard
covers `auto_advance_if_ready` only, not this.

**Self-healing every shipment on every save is the hazard, not the feature.**
`is_step_trigger_satisfied` (`services/shipment.py:373`) counts only
`OPEN`/`IN_PROGRESS` non-`MANUAL_DONE` tasks, so `CANCELLED` reads as finished.
Cancelling the last mismatched auto-task flips a step to eligible, and
`auto_advance_if_ready` then walks the shipment through **every** pre-satisfied
step in one save. On an unconditional `save()` hook that fires from an unrelated
Sheet cell PATCH, with no confirmation gate (B-3).

Two measures, both required:

- **The call sites are the views. There are TWO, not one.** Corrected after
  review — the original claim that `partial_update` was the only runtime writer
  was wrong. `has_peregruz` is in `SWAPPABLE_FIELDS` (`swap_config.py:76`) and
  `ShipmentViewSet.swap` → `_execute_swap` writes it on **both** shipments via
  `save(update_fields=...)`, so it reconciles both too, gated on the `swapped`
  list exactly as the PATCH path is gated on `submitted_keys`. Left unwired it
  was worse than the plain stale-task bug: `_resolve_next_status` forks on
  `has_peregruz`, so each shipment's stale task targeted a field on a branch it
  would never take. (`is_gapy_satys` is correctly absent from that whitelist.)
  Everything else in the original claim holds: the `is_gapy_satys` hits in
  `views_admin.py` belong to **`ExportFirm`/`ImportFirm`**, a different model;
  the `import_shipments` / `import_sheet_shipments` commands set the fields at
  creation time, before any task exists, and bypass `Shipment.save()` anyway —
  the engine's documented bulk limit; and no `join` or `promote` path touches
  either field.
  `ShipmentViewSet.partial_update`
  ([views.py:647](../../../backend/apps/export/views.py#L647)) already holds
  `submitted_keys`; the reconciler is called there, immediately after
  `serializer.save()`, next to `mark_started_for_changed_fields`. By then the
  normal save chain (`resolve_for_shipment` → `auto_advance_if_ready`) has
  already run against the pre-reconcile task set.
- **The reconciler never calls `auto_advance_if_ready`.** It calls
  `resolve_for_shipment` once at the end if it created or reopened anything — so
  newly-applicable tasks that are already satisfied close immediately — and stops
  there. If the reconcile leaves a step eligible, the shipment advances on the
  next ordinary save **that resolves a task** — `auto_advance_if_ready` returns
  early on an empty `resolved_tasks` list (`services/shipment.py:441`) and again
  when `shipment.updated_by` is unset (`:444`). So a cancel-only reconcile can
  leave a truck eligible-but-parked indefinitely. That is strictly safer than the
  alternative, and it is why the reconciler logs a warning naming each step that
  lost its last open auto-task. A checkbox never moves a truck.

Residual, documented and not prevented: a future admin-created condition set
could mismatch *every* rule on a step, leaving it with no open auto-task and
therefore eligible. Impossible with the 24 seeded rules — every step carries
either an unconditional auto rule or a complementary `True`/`False` pair. The
reconciler logs a warning when it cancels tasks at a step and creates none.

## Data model

### Changed: `export.Task`

| Field | Change |
|---|---|
| `cancelled_reason` | **New.** `CharField(max_length=24, blank=True, default='', choices=TaskCancelReason.choices)` |

```python
class TaskCancelReason(models.TextChoices):
    MANUAL             = 'manual',             _('Cancelled by a user')
    SHIPMENT_CANCELLED = 'shipment_cancelled', _('Shipment was cancelled')
    RULE_MISMATCH      = 'rule_mismatch',      _('Rule no longer applies')
    RULE_DEACTIVATED   = 'rule_deactivated',   _('Rule was deactivated')
```

`RULE_DEACTIVATED` is defined now and written by the rule editor later; this spec
never writes it. Defining it here keeps the two specs from racing on the same
column. No `db_collation` — the values are ASCII enum codes, not free text.

Two existing writers of `state=CANCELLED` must set the reason explicitly:

- `_cancel_open_tasks` (`services/shipment.py:354-370`) — a single bulk
  `.update()`; add `cancelled_reason=TaskCancelReason.SHIPMENT_CANCELLED`.
- `TaskViewSet.cancel` ([views.py:4457](../../../backend/apps/export/views.py#L4457))
  — add `MANUAL`, and list the column in its `update_fields`.

Both then fall outside the `rule_mismatch` reopen filter by construction rather
than by accident.

### Changed: `export.Notification`

One new entry in `KIND_CHOICES`: `('tasks_changed', 'Tasks changed')`. A
choices-only change still needs a migration row (a no-op `AlterField`); it goes
in the same migration as `cancelled_reason`.

`message` is `CharField(max_length=500)` with Cyrillic collation, so it carries a
real sentence, not just the shipment code.

### Migration

One migration in `export`. **Do not fix the number in this spec** — parallel
sessions share this tree and the last applied number moves. At implementation
time run `ls backend/apps/export/migrations/ | tail -3` and
`git log --oneline origin/main -5` first, per the parallel-sessions rules in
`CLAUDE.md`.

## Service layer — `services/task_rules.py`

```python
def reconcile_shipment_tasks(
    shipment,
    changed_fields: Iterable[str] | None = None,
    steps: Iterable[str] | None = None,
) -> dict:
    """Re-decide which Tasks should exist for this shipment. Returns counts."""
```

Returns `{'created': [...], 'cancelled': [...], 'reopened': [...]}` as Task
lists, so the caller can build the notification without a second query.

**`changed_fields`** is the gate. When given, the function loads the active
rules once, takes the set of their non-blank `condition_field` values, and
returns an empty result immediately if none of them appears in
`changed_fields`. An ordinary PATCH of a weight or a date therefore costs one
small query against a ~22-row table and no writes. `None` means "reconcile
regardless of what changed" and is what the management command passes.

**`steps`** scopes which rules are considered. `None` means *every step that has
a non-terminal task on this shipment, plus the shipment's current step*. Scoping
to the current step alone would be wrong twice over: `tasks.submit_sales_report`
is created at `yola_chykdy` and lives for days past it, and the rule editor's
`apply_rule_change` will need to reconcile at the **rule's** step regardless of
where the shipment sits. One parameter now, no rework when the editor lands.

`_condition_matches` stays as-is; when the editor replaces it with
`_conditions_match` over the `TaskRuleCondition` child table, this function is
the only caller that needs re-reading.

### Call sites

| Caller | `changed_fields` | `steps` |
|---|---|---|
| `ShipmentViewSet.partial_update` | `submitted_keys` | `None` |
| `reconcile_tasks` command (extended) | `None` | `None` |
| `apply_rule_change` (rule editor, later spec) | `None` | the rule's step |

The `reconcile_tasks` command already syncs rule **drift** (title, targets,
completion rule, target value) and already calls `resolve_for_shipment` per
shipment and already supports `--dry-run`. It gains the condition axis: after
its existing drift pass, it calls `reconcile_shipment_tasks` for each shipment in
an open season and reports the created / cancelled / reopened counts alongside
the drift counts. `--dry-run` must cover the new pass too — that is how the
historical backlog gets inspected before it is written (B-7).

### Notification

When a reconcile produced any change, one `tasks_changed` notification per
recipient user, where recipients are the users whose role is in:

```
{t.assignee_role for t in created + cancelled + reopened}
  ∪ set(STATUS_NOTIFY_ROLES.get(shipment.status.code, []))
```

For the Gapy flip on a draft that resolves to `transport` (both
`assign_driver` variants) and `document_team` (both `give_documents` variants)
from the first set, and `export_manager` from the second — exactly the three
roles asked for, without hard-coding them.

`message` names the shipment code and the counts; `link` is
`/shipments/{id}`. Created with `bulk_create(batch_size=500)`, matching
`_notify_action_required`.

## Frontend

Backend-only except for the bell.

- **`NotificationBell.tsx`** — add `tasks_changed` to `KIND_COLOR` (the
  `Record<INotification['kind'], string>` type makes a missing entry a compile
  error) and to the `INotification['kind']` union in `types/index.ts`.
- **Bell click (B-8)** — each notification row is currently plain text;
  `n.link` is never read, so a notification that names a shipment cannot take
  anyone to it. Wrap the row so that clicking it marks the notification read and
  navigates to `n.link` when present, leaving rows without a link inert. This
  repairs every kind at once, not only the new one.
  The estimate holds: `useMarkOneRead()` already exists in
  `hooks/useNotifications.ts` (`POST /export/notifications/{id}/read/`), so this
  is a `useNavigate` call and an `onClick` — no new endpoint, serializer or hook.
- **i18n** — `notifications.tasks_changed` in `en/ru/tk.json`.

No Sheet change. No new screen.

## Testing (TDD — failing tests first)

**Backend** (`apps/export/`):

- Flip `is_gapy_satys` False → True on a draft: the Regular `assign_driver` and
  `give_documents` tasks end `CANCELLED/rule_mismatch`; the Gapy variants exist
  and are `OPEN`.
- Flip True → False: the mirror image, and the previously cancelled Regular tasks
  are **reopened**, not duplicated — still one Task row per `(shipment, rule)`.
- A `DONE` task whose condition stopped matching stays `DONE` with its
  `completed_by` and `completed_at` intact (B-2).
- A task cancelled through `TaskViewSet.cancel` is **not** reopened when its rule
  matches again.
- Gate: a PATCH of a field no rule conditions on performs no writes.
- **Status does not move**: a reconcile that cancels the last open auto-task at
  the current step leaves `shipment.status` unchanged, and the shipment then
  advances on the next ordinary save. This is the regression test for the whole
  Safety section — assert on the status *and* on `ShipmentStatusLog` row count.
- Idempotency: calling twice produces no second notification and no writes.
- Notification recipients for the Gapy flip are exactly the users holding
  `transport`, `document_team`, `export_manager`.
- `has_peregruz` flip at `barysh_gumrugi` behaves the same — the mechanism is not
  gapy-specific.
- `_cancel_open_tasks` writes `shipment_cancelled`; `TaskViewSet.cancel` writes
  `manual`.
- `reconcile_tasks --dry-run` reports the condition-mismatch counts and writes
  nothing.
- Closed-season shipments are skipped.

**Frontend** (vitest):

- `NotificationBell` renders a `tasks_changed` row with its colour.
- Clicking a row with a `link` navigates there and marks it read; a row without
  one does not navigate.

Scope note: no Sheet permission logic changes, so
`TestEveryRoleCanEditItsOwnSheetRow` is not part of this gate.

## Docs to update

- `docs/obsidian/reference/task-rules.md` — condition re-evaluation, the
  `cancelled_reason` values, what the reconciler will and will not do.
- `docs/obsidian/processes/comments-tasks.md` — engine section; the notification.
- `CHANGELOG.md`, `BUILD_TEST_LOG.md`.

## Known consequences

- A shipment's task set now changes without a status transition. Anything that
  assumed "tasks appear only on step entry" is wrong from here on — the
  reconciler is the second creator.
- `cancelled_reason` is blank on every task cancelled before this migration. Any
  analytics over it must treat `''` as "unknown, pre-2026-09", not as `manual`.
- **The editor of the checkbox is notified about their own edit.** Since B-3
  declined a modal, the `tasks_changed` notification is their only feedback.
  `_notify_action_required` has the same wart, documented in its call site — the
  notification helpers take no actor. Acceptable; named here so it does not read
  as a bug later.
- **The `changed_fields` gate only understands flat shipment field keys.** A
  condition on a related field (`export_firm.is_gapy_satys` — that column really
  exists on `ExportFirm`) would not appear in `submitted_keys` when the FK
  changes, so the reconcile would not fire. Today every `condition_field` is a
  plain boolean on `Shipment`. The rule editor will let an admin pick condition
  fields from `SheetRowSetting`, so its spec must either forbid dotted condition
  paths or widen this gate.
- A reopen can close instantly via `resolve_for_shipment` (rule 4), so a task's
  `completed_at` may be later than its first completion, which now exists only in
  `AuditLog`. Feature C introduces `TaskAttempt` and makes that history
  first-class; until then, repeated-rework analytics is not available for
  condition flips.

## Out of scope

- The rule editor (its own spec, 2026-09-18) — this spec does not add
  `TaskRuleCondition`, `seed_key` or `title_text`, and does not make the DB the
  source of truth for rules.
- Task ordering / dependencies (A) and rollback (C) — later specs in the
  sequence.
- The analytics dashboard over task attempts and rollbacks. This spec only stops
  producing wrong task sets; it does not read them back.
- Preview → confirm on the Sheet. Explicitly declined (B-3).
