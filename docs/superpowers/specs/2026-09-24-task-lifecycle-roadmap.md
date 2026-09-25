# Task lifecycle — decomposition and decisions

**Date:** 2026-09-24
**Status:** Sequencing and per-feature decisions approved in chat. Only B has a
written spec so far.

**Written for:** whoever picks up any of these four pieces in a later session.
Every decision below was made by the owner in the 2026-09-23/24 brainstorm and
should not be re-litigated; every code fact is cited so it needn't be re-derived.

---

## Why this document exists

The owner asked for three things in one message — task ordering, what happens
when a shipment has to go backwards, and admin-configurable task rules. They are
not one feature. This file records the split, the order, and the decisions taken
for each, so the three later specs can be written without re-running the
brainstorm.

## The four pieces, in build order

| # | Piece | Spec | State |
|---|---|---|---|
| 1 | **B — condition re-evaluation** | [[2026-09-24-task-condition-reconcile-design]] | spec written, pending review |
| 2 | **Rule editor (admin-configurable rules)** | [[2026-09-18-task-rule-editor-design]] | design approved 2026-09-18, **not implemented** |
| 3 | **A — task ordering / dependencies** | [[2026-09-23-task-rule-dependencies-design]] | brainstorm parked; see corrections below |
| 4 | **C — rollback (going backwards)** | not written | decisions taken, spec not started |

**Why this order.** B is a live bug — the Gapy-Satyş task variants are never
created when the checkbox is ticked after step entry — and it is fixable on the
current data model in a way that survives the editor. The editor comes second
because A and C both add admin-configurable knobs to `TaskRule`
(`depends_on`, the reason×rule linkage); building them against the pre-editor
model means migrating them a second time. A and C then land with their
configuration UI already available.

Alternative orders considered and rejected: editor first (leaves the B bug live
for the whole editor build), and C first (the rollback-reason reference data would
need a throwaway Django-admin screen).

**Parallelism needs no feature.** The owner asked for "tasks that can be done in
parallel". That is already the behaviour: absence of a declared dependency *is*
parallel. Only ordering needs building (A). Say this out loud to the owner rather
than shipping a second mechanism.

---

## B — condition re-evaluation

Regular ↔ Gapy-Satyş flips (and `has_peregruz` flips) while the shipment already
sits in a step. Full design in its own spec. Decisions in one line each:

- Open mismatched tasks are **cancelled**; tasks already `DONE` are **never**
  touched — the work was really done and KPI keeps the credit.
- Automatic, no confirmation modal.
- Notify `document_team`, `export_manager`, `transport`.
- A `Task.cancelled_reason` column, **not** a new `superseded` state.
- Triggered from `ShipmentViewSet.partial_update`, never from `Shipment.save()`,
  and the reconciler never calls `auto_advance_if_ready`.
- Historical shipments are repaired by an explicit `reconcile_tasks` run.

---

## C — rollback: decisions taken, spec still to write

The driving case: all documents are handed over, then the truck breaks down. The
truck is swapped and every document has to be collected again.

| # | Decision |
|---|---|
| C-1 | The **status really moves backwards**. Not "status stays, tasks reset", and not "cancel and clone the shipment" — both were offered and declined. History, KPI and plan-vs-actual stay on one shipment row. |
| C-2 | **The reason decides the target step**, and the reasons are reference data configurable from the admin UI (`«замена машины» → gumruk_girish`, `«брак качества» → yuklenme`, …). The operator picks a reason, not a step. |
| C-3 | **Each reason carries its own list of rules** to re-open — a reason×`TaskRule` link table. Not "everything at or above the target step", and not a single `is_rework` flag on the rule. |
| C-4 | A re-opened task **keeps its row**; the finished attempt is copied into a child `TaskAttempt` table before the reset, plus a denormalized `Task.attempt_no`. Chosen over "new Task row per attempt" because the idempotency key `(shipment, rule)` stays intact and analytics gets a clean fact table instead of live and historical rows mixed together. |
| C-5 | Rollback events get their own `ShipmentRollbackLog` row (shipment, from step, to step, reason, who, when). |

**Why C-4 and C-5 look over-built for a rollback feature:** they aren't for the
rollback. The owner's stated goal is analysis — *"я потом хочу делать много
анализов … как работают сотрудники, где проблемы, где шипмент чаще
застревает"*. `ShipmentStatusLog` already answers step durations. What does not
exist today is any record of rework: how often a step is redone, for which
reason, and who absorbs it. `TaskAttempt` + `ShipmentRollbackLog` are that record.
The dashboard reading them is a separate spec — C only lays the data down.

### Landmine for whoever writes the C spec

**Rollback must not be expressed as backwards edges in `TRANSITIONS`.**
`_resolve_next_status` (`services/shipment.py:161-173`) returns the first edge
whose predicate passes, and `auto_advance_if_ready` drives on that. A backwards
edge added to that table would let auto-advance push shipments *backwards* on an
ordinary save. C needs either a separate allowed-rollback map or edges explicitly
excluded from `_resolve_next_status`.

Also note `transition_to` refuses any target not in `TRANSITIONS[current]`
(line 243) and writes a `ShipmentStatusLog` row plus an `AuditLog` row per call —
so a rollback path has to decide deliberately whether it reuses `transition_to`
(and therefore its role gate, `assert_season_open`, and notification) or sits
beside it. Reusing it is almost certainly right; `CLAUDE.md` forbids touching
`status_id` any other way.

---

## A — ordering: two corrections to the parked design

The parked design `2026-09-23-task-rule-dependencies-design.md` recommended
approach A (rule-declared dependency, task created `BLOCKED`, auto-unblock on
completion). That recommendation still stands. Two of its specifics do not,
because A now lands **after** the rule editor:

1. **Use a self-FK, not `depends_on_title_key`.** §3.7 rejected a self-FK because
   `seed_task_rules --reset` churns row ids. The editor changes both halves of
   that: `--reset` will require `--force`, and `seed_key` will exist as a stable
   identity the seed can re-resolve an FK against. More decisively,
   `depends_on_title_key` **cannot reference an admin-created rule at all** —
   those carry `title_text` and an empty `title_key`. Declare
   `depends_on = FK('self', null=True, on_delete=SET_NULL)` and have the seed
   resolve it by `seed_key`.
2. **The dependency must be editable in the rule editor's WHEN→IF→THEN drawer**,
   which is why A is sequenced after it. The parked doc assumed A shipped alone
   with no UI.

Unchanged and still load-bearing from that document: true deferred creation is
**not** required (the owner's need is board clarity, not enforcement); the
`unblock` endpoint must refuse while `blocked_by` is unsatisfied
(`views.py`, §3.5); `is_step_trigger_satisfied` must count `BLOCKED` auto-tasks
as outstanding or a dependency silently opens an auto-advance path (§3.3); and
the existing completion-time gate in `TaskViewSet.complete` stays as the
server-side backstop.

---

## Shared hazard, all four pieces

`is_step_trigger_satisfied` (`services/shipment.py:373`) counts only
`OPEN`/`IN_PROGRESS` non-`MANUAL_DONE` tasks at the shipment's current step, so
`CANCELLED` and `DONE` both read as finished — and `auto_advance_if_ready` walks
through **every** pre-satisfied step in one save. Any change that cancels,
re-opens or re-scopes tasks can therefore move a truck as a side effect of an
unrelated edit. Each spec must state explicitly what it does about this. B's
answer is that the reconciler never calls `auto_advance_if_ready`; A's and C's
answers are still to be written.
