# TaskRule dependencies — ordering tasks within a step

**Status: BRAINSTORM PARKED.** Approach A is the standing recommendation, still not
formally approved. No code written for this feature.

> **Read [[2026-09-24-task-lifecycle-roadmap]] first.** The 2026-09-24 brainstorm
> sequenced this feature **after** the rule editor, which invalidates two specifics
> below. Short version: use a `depends_on` **self-FK** resolved by `seed_key`, not
> `depends_on_title_key` — §3.7's premise no longer holds once `--reset` is
> `--force`-gated, and `depends_on_title_key` cannot reference an admin-created
> rule at all (those have `title_key=''`). The dependency must also be editable in
> the editor's WHEN→IF→THEN drawer, which this document did not anticipate.
> Everything else here still stands.

**Written for:** whoever picks this up in a later session — assume they have not read the
conversation that produced it. Every fact below is cited to a file so nothing has to be
re-derived.

Date: 2026-09-23
Related: [[../../obsidian/reference/task-rules]], [[../../obsidian/screens/self-board]],
`docs/DOCUMENT_TEAM_TASKS.md` (untracked, written by a parallel session)

---

## 1. The ask

The owner asked, about the Gapy-Satyş draft flow:

> "why not the rule task 2 appears only after task 1? I think we need it or not"

Context: `tasks.assign_driver` (gapy variant) and `tasks.give_documents_gapy` are both
`step='draft'` rules, so both Tasks are created at the same moment — when the shipment
enters `draft`. The owner expected the second to appear only after the first was done.

**What the owner actually wants** (answered in the brainstorm, multi-select):

- ✅ **Clarity on the board** — document_team opens My tasks, sees ~5 tasks for one draft
  shipment, no visible order, doesn't know what to do first.
- ✅ **A general capability** — configurable per rule, not a one-off for gapy; more task
  pairs will need this.
- ❌ NOT "the deadline is unfair".
- ❌ NOT "it must be impossible to see/attempt" — enforcement is not the driver.

That last ❌ is load-bearing: **true deferred creation is not required**, which removes the
only expensive option. Do not re-open it without re-asking.

---

## 2. Already shipped (the baseline this builds on)

Shipped 2026-09-23, uncommitted at time of writing, in the same session:

- `TaskViewSet.complete` (`backend/apps/export/views.py`) refuses to mark
  `tasks.give_documents_gapy` DONE while that shipment's `tasks.assign_driver` task is not
  DONE. Fails **open** when no `assign_driver` task exists or it is CANCELLED, so a legacy
  shipment can never be permanently stranded.
- That gate is *completion-time enforcement only*. It does not affect when tasks appear,
  which is what this document is about.

So the server-side ordering rule already exists. What is missing is the **visible** ordering
and the **general, rule-declared** form of it.

---

## 3. Findings — the expensive part, do not re-derive

### 3.1 `Task.blocked_by` already exists, and is dead

`backend/apps/export/models/task.py:184`

```python
blocked_by = models.ManyToManyField(
    'self', symmetrical=False, blank=True, related_name='blocking',
    help_text='Tasks that must complete before this one can be worked on',
)
```

It is serialized (`serializers.py:2360-2371`, `get_blocked_by` → list of ids) and typed on
the frontend (`frontend/src/types/index.ts:1802`). It has model-level tests proving it can
be populated and is non-symmetrical (`tests_task_models.py:285-311`) and an API test that
the detail route returns it (`tests_task_api.py:267,283-286`).

**Nothing writes it. Nothing enforces it. Nothing renders it.** The dependency concept was
scaffolded and abandoned. This work is *finishing* that, not inventing it.

### 3.2 Tasks are created on step entry, keyed by (shipment, rule)

`backend/apps/export/services/task_rules.py:159` — `generate_tasks_for_status()` creates one
Task per active TaskRule matching `step` + condition, skipping `(shipment, rule)` pairs that
already exist (idempotent). Deadline is computed at creation from `deadline_rule`.

### 3.3 A BLOCKED task does not gate auto-advance

`backend/apps/export/services/shipment.py:373` — `is_step_trigger_satisfied()` counts only
tasks in `state__in=[OPEN, IN_PROGRESS]`, excluding `MANUAL_DONE`. So BLOCKED auto-tasks are
invisible to the gate.

For *this* pair it is moot anyway: `give_documents_gapy` is `MANUAL_DONE` and never gated
auto-advance. **But if a future dependency is declared on a non-MANUAL_DONE rule, blocking
it would let the shipment auto-advance past a step whose work has not been done.** That is
the one real correctness risk in approach A and the design must address it.

### 3.4 KPI overdue already ignores draft-shipment tasks

`backend/apps/core/services_team_kpi.py:134-142` — `overdue_now` excludes
`shipment__status__code='draft'`, with the comment "a draft is a parked, supply-only
shipment … treat a draft as 'not on the clock'". So for draft-step tasks, BLOCKED vs OPEN
has **zero** KPI or overdue consequence. This is why "deadline is unfair" was correctly not
chosen as the problem.

### 3.5 `unblock` has no guard — an existing hole

`backend/apps/export/views.py`, `TaskViewSet.unblock`: any user who passes the actor
permission can flip a BLOCKED task to IN_PROGRESS and it clears `blocked_reason`. On the
board, `SelfBoard.requestMove` maps a drag from Blocked → In Progress onto exactly this.

Any design that uses BLOCKED for dependencies **must** make `unblock` refuse while
`blocked_by` is unsatisfied, or the ordering is one drag away from being bypassed.

### 3.6 The board already has a Blocked column

`frontend/src/pages/me/SelfBoard.tsx` `COLUMNS` — `todo / in_progress / blocked /
done_today`, plus a History column behind "Show all". A task put in BLOCKED visibly leaves
the To-Do pile with no frontend work at all. That is the "unclear order" fix, for free.

### 3.7 Rules are upserted by a composite natural key

`backend/apps/export/management/commands/seed_task_rules.py` — `update_or_create` keyed on
`(step, title_key, condition_field, condition_value)`, and `--reset` deletes all rules and
re-seeds. **A self-FK on TaskRule would not survive `--reset`** (ids change), so a
dependency must be declared by a stable natural value, not a row id.

---

## 4. Approaches

### A — Rule-declared dependency; create the task BLOCKED, auto-unblock on completion (RECOMMENDED)

- `TaskRule` gains `depends_on_title_key` (CharField, blank default `''`) — a title_key
  within the same step. Chosen over an FK because of §3.7.
- `generate_tasks_for_status`: after creating tasks, any task whose rule declares a
  dependency, and whose blocker on that shipment is not DONE, is set to `BLOCKED` with
  `blocked_by` populated and a reason naming the blocker.
- On the blocker flipping DONE (in `resolve_for_shipment`, and in the manual `complete`
  action), any task whose `blocked_by` set is now fully satisfied is returned to OPEN.
- `unblock` endpoint refuses while `blocked_by` is unsatisfied (§3.5).
- **Must resolve §3.3**: either forbid declaring a dependency on a non-`MANUAL_DONE`
  dependent, or teach `is_step_trigger_satisfied` to count BLOCKED auto-tasks as outstanding.
  Recommend the latter — it is one line and fails safe.
- Frontend: nothing required. Optional polish: distinguish a system block from an operator
  block on the card.
- Cost: one migration (one column), ~3 services, one endpoint guard, and it finally wires
  up the dead `blocked_by` field.

### B — New `WAITING` task state

Cleaner semantics: BLOCKED keeps meaning "an operator is stuck and typed why", WAITING means
"not your turn yet". But a new state value touches every consumer — board columns and their
i18n ×3, filters, the TS state union, KPI, `/me/tasks` `?state=`, and every `state__in` list
in the backend. Large blast radius to buy a better word. Reconsider only if operators
actually confuse the two in practice.

### C — Literally defer creation

Truest to the owner's phrasing, and **rejected**. `Shipment.save()` runs
`resolve_for_shipment()` then `auto_advance_if_ready()`, so the shipment can leave `draft` in
the *same save* that completes `assign_driver` — the dependent task would be created onto a
shipment already in customs, or never created at all. It also destroys the deadline anchor
and hides the task from anyone planning the week. Since "must be impossible" was explicitly
not the need (§1), this cost buys nothing.

---

## 5. Decision needed to resume

1. **Approve approach A** (or pick B/C with reasons). Nothing else is blocked on anything.
2. Then: full design in sections → approval per section → spec → `writing-plans`.

Open sub-questions to settle inside the design, not before:

- Should `is_step_trigger_satisfied` count BLOCKED auto-tasks as outstanding? (Recommend
  yes — see §3.3.)
- Should the card visually distinguish a system block from an operator block, or is the
  `blocked_reason` text enough?
- Does `reconcile_tasks` need to re-evaluate dependencies when a rule's
  `depends_on_title_key` is edited after tasks already exist? (Same class of staleness the
  existing `target_fields` edit already has.)
- Which other rule pairs get a dependency on day one, if any? The owner said more pairs are
  coming but named none.

---

## 6. Hard constraints for whoever implements this

- Do not use a self-FK for the dependency (§3.7).
- Do not close the `unblock` hole by removing the endpoint — operators legitimately unblock
  their own blocks; it must refuse *only* dependency blocks (§3.5).
- Do not let a dependency silently open an auto-advance path (§3.3).
- The existing completion-time gate in `TaskViewSet.complete` (§2) stays as the server-side
  backstop even after this lands. Visibility and enforcement are separate layers.
