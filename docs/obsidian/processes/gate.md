---
title: Gate
tags: [process, backend, frontend, export, transport, garawul]
related: [[../roles/garawul]], [[task]], [[task-rules]], [[permissions-system]], [[shipment-lifecycle]]
---

# Gate

The gate guard's screen: two lists of trucks at one greenhouse location, and
the two marks that move a truck between them. Spec:
`docs/superpowers/specs/2026-09-29-garawul-gate-design.md`. Service:
`backend/apps/export/services/gate.py` + `services/gate_tasks.py`. Endpoint:
`backend/apps/export/views_gate.py`. Frontend: `pages/export/GatePage.tsx`,
`components/gate/*`, `components/me/GateTaskCard.tsx`.

## What Is This Process?

Before 2026-09-29 nobody recorded a truck physically entering or leaving the
greenhouse. R21 «Ýyladyşhanadan çykdy» (`departed_at`) was typed by hand, late
or never, and the loading team had no signal that a truck had actually shown
up. The gate guard now fills that gap from a phone at the gate.

## Location of a truck

`location_q(L)` (`services/gate.py`) — a truck belongs to location `L` when
either:
- `Shipment.loading_location == L` (the gate itself set this on arrival), or
- `loading_location IS NULL` and one of its `ShipmentBlockSource` rows points
  at a `GreenhouseBlock` whose `location == L`.

No live shipment carried `loading_location` before this feature, so every
truck's location comes from its blocks until the gate stamps it on arrival.
The block subquery is wrapped in `.order_by()` before `Subquery()` per the
MSSQL rule (no bare `ORDER BY` inside a derived table).

## The three lists

All three read from `_live()` — `is_archived=False`, `deleted_at IS NULL`,
status not `cancelled`.

**«Gelmeli» — `expected(L)`.** Live rows at `L`, status in `{draft,
gumruk_girish, gumruk_chykysh, yuklenme}`, plate filled (`truck_plate` not
null and not `''` — no trimming), `greenhouse_arrived_at IS NULL`,
`departed_at IS NULL`, `date` today−30 or later (was −7 until 2026-09-30: a truck held up by documents for two weeks disappeared). No limit ahead since 2026-10-01 (was: up to tomorrow) — an assigned truck is on the gate at once, whatever its date. A **packing part**
— a `draft` with no `country` and no `customer` — is excluded even if
everything else matches: Join deletes that row, so a gate stamp on it would be
lost (owner-approved decision, 2026-09-29; the same exclusion `/me/tasks/`
applies to every task column). Ordered by `date`, then `id`.

**«Ýyladyşhanada» — `inside(L)`.** Live rows at `L` with
`greenhouse_arrived_at` set and `departed_at IS NULL`. **Deliberately ignores
status** — a status move (e.g. into `yola_chykdy` by a Sheet edit elsewhere)
must never hide a truck that is still physically inside. Ordered by
`greenhouse_arrived_at`, then `id`.

**Recently left — `recently_left(L)`.** `departed_at` within the last 10
minutes and `greenhouse_arrived_at` set. Shown greyed at the bottom of the
Ýyladyşhanada tab so the exit can still be undone.

**Row payload** (`gate_row()`) — nothing but what the guard needs, no
customer, firm, price or weight: `id`, `shipment_code`, `truck_plate`,
`truck_plate_2`, `driver_name`, `driver_phone`, `date`, `is_gapy_satys`,
`status_code`, `greenhouse_arrived_at`, `departed_at`, `can_undo`.

> **Timestamps are local, like the rest of the contract** (final-fix review
> F6, 2026-09-29). `greenhouse_arrived_at` and `departed_at` go through
> `timezone.localtime(value).isoformat()` in `gate_row()`'s `_iso()` helper
> (`date` is a plain date, `can_undo` a bool, neither goes through it), so
> they now carry the `TIME_ZONE='Asia/Ashgabat'` offset (`+05:00`) like every
> other timestamp in the API. Previously this helper used plain
> `datetime.isoformat()` on the raw UTC-aware value and printed `+00:00` — the
> one place in the contract that disagreed; same instant, only the printed
> offset changed. See [API contract — Gate](../../../.claude/skills/api-contract/SKILL.md).

## Actions

All three run in `transaction.atomic()` with `select_for_update()` on the
shipment, time captured once as `timezone.now()`. Every write is a plain
`Shipment.save()` (`updated_by = <guard>`) — task resolution and
`auto_advance_if_ready()` run exactly as for a Sheet edit, so the status still
only ever changes inside `transition_to()`. A closed season fails the save
cleanly as `409 {"error": "season_closed"}`, never a 500.

**Arrive** — precondition: the shipment must currently be in `expected(L)`,
else `409 not_expected`. Writes `greenhouse_arrived_at = now`; sets
`loading_location = L` if it was null; sets `loading_started_at = now` **only
if it was still empty** (never overwrites an existing value) **and only if
the truck's packing has been joined** (final-fix review F5,
`needs_packing_for_loading()` from `services/packaging.py` — pre-loading
status, no `block_sources`). A truck that physically arrives before its
supply is joined still gets its arrival stamped and the notification sent;
`loading_started_at` stays null until the packing exists, so the row does not
auto-advance on nothing to load. One `gate_arrival` notification is sent to
every active `loading_dept_head` and `loading_dept_head_deputy` user — **not
scoped to `L`**, every location's heads and deputies get every arrival —
message `"{plate} — {location}"`, link `/shipments/{id}`.

**Depart** — precondition: the shipment must be in `inside(L)`, else `409
not_inside`. Writes `departed_at = now`. From `yuklenme`, once loading data is
complete, this auto-advances to `yola_chykdy` (or `tamamlandy` for a gapy
truck, the existing fork).

**Undo** — body `{"event": "arrive" | "depart"}`; `bad_event` → `400` if
neither. Any guard of that location may undo, not only the one who marked it
(`AuditLog` keeps who actually did each write).

## Undo

`can_undo(shipment, event)` — true only while **both** hold:
1. The mark is at most 10 minutes old.
2. `status_changed_at` is null, or earlier than the mark.

Rule 2 means undo is unreachable the instant the mark itself moved the status
— which is the **common case** for both actions: an arrival from
`gumruk_chykysh` auto-advances to `yuklenme` in the same save, and a
completing departure auto-advances too. «Yza al» only works when the mark
changed nothing else (an early arrival before `gumruk_chykysh`, or a departure
that doesn't yet complete the loading data) — a transition has no way back.
`can_undo` in the payload is computed with the exact same rule, so the button
only ever shows when the server will actually accept the undo.

**The `/undo/` response row's own `can_undo` reflects the mark still live
afterward** (final-fix review F7): undoing a `depart` puts the truck back
inside, so the returned row's `can_undo` is for its *arrival*; undoing an
`arrive` puts it back in Gelmeli, where nothing is undoable, so `can_undo` is
`false`.

- **Undo depart**: clears `departed_at`. Reopens any `DONE` status task this
  mark closed (see below).
- **Undo arrive** (only while `departed_at` is still null): clears
  `greenhouse_arrived_at`; clears `loading_started_at` too, but **only if it
  still equals the arrival mark** — i.e. only if the guard is the one who
  wrote it. `loading_location` is **never** cleared on undo — it already
  equals the block location the truck was listed under, so clearing it would
  gain nothing and could orphan the row.

**Reopening the task a mark closed.** `_reopen_tasks_closed_by(shipment,
field, since)` finds `DONE` tasks on the shipment completed at/after the mark
whose CSV `target_fields` contain that exact field. The DB filter
(`target_fields__contains=field`) is a cheap substring pre-filter only — the
real match is exact, done in Python against `Task.target_field_list` (the
model's own CSV-token parser), so a future field whose name merely contains
`field` as a substring (e.g. `departed_at_note` against `departed_at`) cannot
falsely match.

## Gate tasks

`sync_gate_tasks(L)` (`services/gate_tasks.py`) — code-driven, like
`weekly_plan` / `truck_allocation`, **not** a `TaskRule`: a rule is role-wide,
so every guard would see every location's trucks, and a field-triggered rule
would also hold the document team's auto-advance until the truck physically
arrived. Two steps, both `assignee_role='garawul'`, `completion_rule =
MANUAL_DONE`, `link='/export/gate'`, no deadline:

| Task | `step` | Opens when | Done when |
|---|---|---|---|
| «TIR {plate} gelmeli» | `gate_arrive` | truck in `expected(L)` | arrival marked |
| «TIR {plate} çykmaly» | `gate_depart` | truck in `inside(L)` | exit marked |

`sync_gate_tasks(L)` makes the tasks equal the lists on every call: a truck
newly in `expected` gets its arrive task opened (created, or reopened after an
undo, cancelling any exit task); a truck newly in `inside` closes the arrive
task and opens the exit task; a departed truck closes the exit task; a truck
that dropped out of every list (cancelled, deleted, out of the date window, or
— **only before it has arrived** — its packaging moved to another location's
blocks) has both cancelled with reason `rule_mismatch`. Once a truck has
arrived, `loading_location` is stamped and `location_q()` checks that field
first, so a later packaging move no longer drops it off `L`'s lists — see
[[#Known limits]]. `UniqueConstraint (shipment, step) where kind='gate'` keeps
two guards syncing at once from ever double-creating a task.

**On every save, not a beat job** (owner, 2026-10-01 — before, it ran only on
reads, so a truck's arrive task did not exist until the guard opened his
screen). `sync_shipment_gate_tasks(shipment_id, actor)` runs at the end of
every `Shipment.save()` — so assigning a truck (Planning trip, or a plate typed
on the Sheet) opens the arrive task at once — and after each packing move
(Join, Unjoin, Swap), which write with `.update()` and bypass `save()`. A truck
with no packing yet has no location, so its task opens at Join. It syncs every
location the shipment may be on: its blocks', its `loading_location`, and any
location holding a live gate task for it. Reads still sync too: every
`GET /gate/`, each gate action, and `GET /me/tasks/` for a `garawul` user. There
is no Celery beat entry.

`actor` credits `completed_by` — the gate action passes the acting guard; the
save-time sync passes `shipment.updated_by`, the same credit the task engine
gives any task a save resolves (so a time fixed on the Sheet credits the
editor); a read-time sync credits nobody.

**A gate task never makes a shipment "owned" by garawul** (final-fix review
F3). `get_owner_role()` (the Shipment Board item's `owner_role`) and the
Board's `?owner_role=` subquery both read the shipment's most-recently-created
task, but skip `kind='gate'` — otherwise the arrive task, lazily created the
moment a truck enters `expected(L)`, would outrank whatever real rule task the
truck already carries and show it as "owned" by the guard on every board that
groups by owner.

## Endpoint

`/api/v1/export/gate/` — its own `ViewSet`, not `ShipmentViewSet`. Full call
shapes, error codes and HTTP statuses:
[API contract — Gate](../../../.claude/skills/api-contract/SKILL.md).

| Method | Path | Who supplies the location |
|---|---|---|
| GET | `/gate/` | guard: his own, ignored if sent. Others: `?location=` required |
| POST | `/gate/{id}/arrive/` | same — `?location=` required for non-guards |
| POST | `/gate/{id}/depart/` | same |
| POST | `/gate/{id}/undo/` | same, plus body `{"event": ...}` |

Every successful arrive/depart/undo also pokes the Sheet for that shipment id
(`GateViewSet.finalize_response`, final-fix review F1) — `GET /gate/`
does not, same rule `poke_sheet()` already applies on every other
shipment-writing ViewSet.

Permission: resource `gate` — `can_view` gates the list, `can_edit` gates all
three POSTs (marking is an edit on an existing truck, not a create). Seeded:
`garawul` view+edit; `admin`/`boss` full via their wildcard. `director`,
`export_manager` and `document_team` are explicitly carved out of their
every-resource wildcard (`_GATE_RESOURCES`/`_GATE_PAGES` in
`seed_permissions.py`) — the gate is off for them by default, grantable from
the matrix like anything else. Live-DB rollout is data migration
`core/0067_seed_garawul_perms`, which — like `export/0087` below — skips a
database whose name starts with `test_` (the `core/0033` pattern): a test run
gets none of these rows unless it creates them itself, and `migrate` stays
safe to run with `DJANGO_TESTING` set.

## Sheet row 49

`greenhouse_arrived_at`, «Ýyladyşhana geldi», placed right after R21 (display
order only — the row number is literally 49, not a renumbering of the
existing rows). Two ways in to editing it, same as any other AD-17 Sheet row:
`loading_dept_head`, `loading_dept_head_deputy` and `boss` hold an explicit
trigger on the row (`export/0087`'s `TRIGGER_ROLES`); `admin`, `director`,
`export_manager` and `document_team` bypass every row's trigger config
unconditionally (`SHEET_BYPASS_ROLES`, `apps/core/permissions.py`, AD-15) —
so all seven roles, plus a superuser, can correct the value by hand. **This is
not one of AD-1's ten state-machine trigger timestamps** (see
[[../screens/shipment-sheet#Permissions]]) — editing it on the Sheet only
changes what the next `sync_gate_tasks()` call sees (the truck moves between
«Gelmeli» and «Ýyladyşhanada» on the next read, task `completed_by` left null)
and does **not** itself touch `loading_location`, `loading_started_at`, or
send the arrival notification — those three only happen through the gate's
own `arrive()` action. Live-DB rollout is one data migration,
`export/0087_seed_greenhouse_arrival_row` (field grants for the two loading
roles + the `SheetRowSetting` row with its triggers, including `boss`) — not
the two separate migrations the original design sketch described. Like
`core/0067` above, it skips a database whose name starts with `test_` (the
`core/0033` pattern) — a test run gets none of these rows unless the test
itself creates them, and `migrate` is safe to run with `DJANGO_TESTING` set.

## Known limits

- **A truck is invisible until it has a plate and blocks (or
  `loading_location`).** No plate, or blocks that are still on an unjoined
  supply row → not on any list. By design: the guard calls the loading head.
- **A guard can technically call `/tasks/{id}/...` on another location's gate
  task** (the generic task-actions endpoint doesn't check `scope_location`
  against the caller), but the next `sync_gate_tasks()` for that task's real
  location reopens it — so a stray close does not stick.
- **A stray `/tasks/{id}/block/` on a gate task does not self-heal.**
  `_open()`/`_done()` in `gate_tasks.py` treat `BLOCKED` as already-live and
  leave it alone, so `sync_gate_tasks()` never flips it back to `OPEN` on its
  own. The gate mark still works regardless — `arrive`/`depart` drive the task
  straight to `DONE` no matter its prior state — so the truck is never stuck,
  only the card's visible state until the guard marks it.
- **`/complete/` refuses every gate task** (final-fix review F2):
  `TaskViewSet.complete` returns `400 {"error": "gate_task_needs_mark"}` for
  `kind='gate'`, so the generic "Mark done" path (My Tasks' Task drawer, the
  Board's task modal) can never close one — only `POST
  /gate/{id}/arrive|depart/` can.
- **`loading_location` stays set after an undo of arrival.** It equals the
  block location the truck was already listed under, so undoing the arrival
  timestamp does not need to clear it.
- **A truck stays pinned to its arrival location even if its packing is later
  moved elsewhere.** Arrival stamps `loading_location = L`, and `location_q()`
  checks that field before it ever looks at blocks — so a swap or unjoin that
  moves the packing to another location's blocks *after* arrival does not pull
  the truck off `L`'s lists (it can still only depart from `L`). Before
  arrival, a packaging move does drop the truck off the old location's
  «Gelmeli» — see [[#Gate tasks]].
- **Undo is dead after the mark moves the status** — see [[#Undo]] above; this
  covers the common arrival and a completing departure, not just an edge case.

## Out of scope (2026-09-29)

The guard typing plates or creating trucks; vehicles not in the system;
auto-marking from the Traccar geofence; per-location deputies; exit filling
`loading_ended_at`.
