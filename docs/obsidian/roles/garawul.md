---
title: Garawul (Gate Guard)
tags: [role, garawul, gate, transport]
related: [[roles-matrix]], [[../processes/gate]], [[../processes/permissions-system]], [[../processes/shipment-lifecycle]]
---

# Garawul (Gate Guard)

## Who

**Role code**: `garawul`
**Added**: 2026-09-29
**People**: one guard per greenhouse gate — Dusak, Kaka, Owadandepe (more locations
may be added later). Each guard is bound to exactly one `LoadingLocation`.

## What He Does

He is the only person who records a truck physically entering or leaving the
greenhouse. On his phone screen (`/export/gate`) he sees two lists — «Gelmeli»
(expected) and «Ýyladyşhanada» (inside) — and taps one button per truck:

- **«Ýyladyşhana geldi»** — the truck has arrived.
- **«Ýyladyşhanadan çykdy»** — the truck has left.
- **«Yza al»** — undo the last mark, while it is still allowed.

Every tap opens a confirm dialog naming the plate first. A truck that is not on
his list cannot be marked from the gate screen at all — he calls the loading
head instead (by design; see [[../processes/gate#Known limits]]).

## Active Lifecycle Steps

He never calls `transition_to()` directly — both marks reach the status
machine only through `Shipment.save()` → `auto_advance_if_ready()`, via the
R19 / R21 trigger fields they write. Arrival fills `greenhouse_arrived_at`
(informational, not itself a trigger) and, only if it was still empty,
`loading_started_at` — the real R19 trigger — so a shipment at
`gumruk_chykysh` auto-advances to `yuklenme` on the arrival save. Departure
fills `departed_at` directly (R21, already a trigger): from `yuklenme`, once
loading data is complete, the shipment auto-advances to `yola_chykdy`, or
`tamamlandy` for a gapy truck. Every write is a plain `Shipment.save()`,
exactly like a Sheet edit.

## Pages He Sees

Exactly two — `export.gate` and `me.board` (My Tasks) — and **nothing else**,
not even the pages every other role gets by default (Feedback, Work Hours, Team
Leaderboard). `seed_permissions.py`: *"garawul (gate guard): the gate screen and
his gate tasks — nothing else."* No Sheet, no Shipment List, no Dashboard.
Landing: `/` redirects him straight to `/export/gate` (`IndexRoute.tsx`) — the
gate screen is his whole job.

## Resources

| Resource | Access |
|----------|--------|
| `gate` | view + edit (read the lists, mark / undo) |
| `shipment` | none — not even view |

No `shipment` grant at all: his gate payload (`gate_row()`) never carries
customer, firm, price or weight, so there is nothing on the shipment resource
for him to need.

## Binding to a Location

`User.loading_location` (FK → `core.LoadingLocation`, `on_delete=PROTECT`), set
on `/admin/users`. The admin form shows a location select, **required** when
role is `garawul` — creating or editing a guard with no location returns
`{"loading_location": ["A gate guard needs a location."]}`. A guard whose
account somehow has no location gets `400 {"error": "no_location"}` from every
gate call and `Size ýer berilmedi — admin bilen habarlaşyň` on the gate screen;
his My Tasks list and "done today" KPI tile both count zero.

A non-guard role holding the `gate` grant (`admin`, `boss`) is not bound to a
location — they pick one via `?location=` on every call, GET and POST alike.

## Sheet

Row 49, `greenhouse_arrived_at` — «Ýyladyşhana geldi», placed right after R21
(`display_order` sits at the midpoint between R21 and the next row). Shows the
time and lets `loading_dept_head`, `loading_dept_head_deputy` and `boss`
correct it by hand via an explicit trigger on the row (AD-17 — once a row has
any trigger, the triggers *are* the edit permission for it); `admin`,
`director`, `export_manager` and `document_team` can always correct it too,
since those four bypass every row's trigger config unconditionally
(`SHEET_BYPASS_ROLES`, AD-15). The caption reads «Garawul» (`sheet.who.garawul`),
but he never edits this cell himself — `WHO_TO_ROLE['garawul']` maps the
caption to the two loading roles, who do. In
the row-access band it therefore sits with the loading department's rows, not
in a band of its own. This row is **not** one of AD-1's ten state-machine
trigger timestamps — see [[../processes/gate#Sheet row 49]] for what a manual
edit does and doesn't do.

## Tasks

Two code-driven task steps, `gate_arrive` and `gate_depart` (`kind='gate'`,
not a `TaskRule` — see [[../processes/gate#Gate tasks]]). His My Tasks list and
his "done today" KPI tile are both scoped to `scope_location = his own
location` (`MeTaskListView`, `MeKpiTodayView`) — another guard's location's
trucks never appear for him, by role-family rules or otherwise. The task card's
button does the exact same action as the gate screen; there is no generic
"Done" button on a gate task, so it can never close without the actual mark.

Supervisors (`export_manager`, `director`, etc.) see every guard's tasks on
their own My Tasks / board, same as any other role's tasks — the button on
those cards shows only for the guard himself, a superuser, or a role holding
the `gate` edit grant, so a supervisor without that grant sees the task but no
button that could only 403.

## User Management

Admin only (AD-15). `garawul` is absent from `MANAGEABLE_BY_ROLE`, so no
department head may create or manage gate-guard accounts.

## Known Limits

- **«Yza al» dies the moment the status moves.** The common arrival
  (`gumruk_chykysh → yuklenme`) and a completing exit both move the status in
  the same save that makes the mark — so undo is only reachable for a mark that
  changed nothing else (arriving before `gumruk_chykysh`, or a departure that
  doesn't yet complete the loading data). This is not a bug to report; see
  [[../processes/gate#Undo]].
- A truck whose packing has not been joined yet, or whose blocks still sit on
  an unjoined supply row, has no resolvable location and never appears on his
  list — he has to be called, same as any truck not yet on the board.
- A packing part (a draft with no country and no customer yet) never appears
  in «Gelmeli» either: Join deletes that row, so a stamp on it would be lost.

## Test Login

`t_garawul` / `Test1234!`, bound to **Dusak** (see
[`TEST_ACCOUNTS.md`](../../TEST_ACCOUNTS.md)).
