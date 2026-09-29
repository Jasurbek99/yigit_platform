---
title: Assignment Board
tags: [process, frontend, shipment, draft]
related: [[draft-shipments]], [[shipment-lifecycle]]
---

# Assignment Board

## What Is This Process?

The screen where **`JOIN_ROLES`** (export_manager-like roles plus, since 2026-09-29, the loading
department) join, detach and swap **packing** between shipment rows before loading starts. Spec:
`docs/superpowers/specs/2026-09-29-packaging-join-board-design.md`.

Before 2026-09-29 this board matched drafts against a mocked "Demand" column (`MOCK_DEMAND`) and
its Confirm button drove `/assign/`. Both are gone — the board now only moves packing.
`POST /shipments/{id}/assign/` (destination fields + `draft → gumruk_girish`) still exists; it is
called from `ShipmentDetailHero` on a destination plan's own detail page, not from this board.

Reference: [[draft-shipments]] describes the two-phase creation this board builds on, including
the [[draft-shipments#Late join, detach, swap (2026-09-29)]] section this board is built on.

## Layout

Three columns (`frontend/src/pages/export/AssignmentBoard.tsx` + `assignment/*`):

| Column | Content | Selection |
|--------|---------|-----------|
| **Supply** (left, 320px, `SupplyCard`) | Free supply plans — `draft`, has packing, no country/customer | Click toggles; up to 2 cards picked in total |
| **Action** (centre, flex, `PackingActionPanel`) | The picked cards + the one action they allow | — |
| **Export** (right, 340px, `ExportPartCard`), two groups | Destination plans (country + customer set), not yet loading, split into **«Waiting for packing»** and **«With packing»** | Click toggles |

One query, `useJoinBoard()` (see Data below), feeds all three columns.
`splitBoardColumns()` (`assignment/boardHelpers.ts`) classifies every row into `free` / `waiting`
/ `joined` from status + packing presence — there is no server-side grouping.

## Selection & Action Rules

`decideBoardAction(selected)` derives the single legal action from up to two picked cards. There
is no "compatible / incompatible" matching any more — the old variety/freshness Demand-matching
logic left with `MOCK_DEMAND`:

| Picked | Action | Endpoint |
|--------|--------|----------|
| One destination plan **with** packing | **Detach** | `POST /shipments/{id}/unjoin/` |
| One free supply plan + one destination plan **without** packing | **Join** | `POST /shipments/{target}/join/` `{source_id}` |
| Two rows that both carry packing (either may be a free supply plan) | **Swap packing** | `POST /shipments/{a}/swap-packaging/` `{other_id}` |
| Anything else (0 picked, 2 incompatible cards, same row twice) | none — the panel shows what's missing | — |

`SupplyCard` still shows the tomato-age warning ("вчерашний" / "старый", per `harvest_age_days`)
— that's freshness, not compatibility, and it never blocks an action.

**Weight rule** (`services/packaging.py::net_update`, applied by all three endpoints):
`packaging_weight()` is read from the packing **before** it moves — all blocks weighed → their
sum; else, on a `draft` row, its own `weight_net`; else the weighed blocks' sum, or `null`. A row
still `draft` after the move gets `weight_net` = the packing's weight that ended up on it (`null`
if none did). A row already past `draft` only has its `weight_net` **filled if it was empty** — a
value already there is never overwritten, and `weight_gross` is never touched by any of the
three operations.

**Pallet and loading limits** (`assert_can_move_packing`): all three actions refuse a row that is
not in `PRE_LOADING = {draft, gumruk_girish, gumruk_chykysh}` ("loading has started — packing can
no longer change"), or that already has recorded pallets ("pallets are recorded — packing can no
longer change"). Both checks re-run inside the transaction under `select_for_update`, so a
concurrent loading-start or pallet scan can't race past them.

## Actions

No "Confirm" button any more — the centre panel runs whichever action `decideBoardAction`
derives:

- **Join** runs immediately on click (`PackingActionPanel.confirmThenRun` skips the confirm modal
  for `kind: 'join'` — a fresh merge, nothing destructive to double-check).
- **Detach** and **Swap packing** ask for confirmation first (`Modal.confirm`), and the confirm
  body carries the **QR-reprint reminder**: *"if QR labels are already printed, reprint them"*
  (`packing.confirm_unjoin_body` / `packing.confirm_swap_body`) — the printed label encodes the
  row's `export_code`, and that code just moved to a different shipment row.
- On success the board refetches (`useJoinBoard` shares the `['drafts']` query key that every
  join/unjoin/swap mutation invalidates) and the selection clears.

## Data

One list call, `useJoinBoard()` (`frontend/src/hooks/useDrafts.ts`):
`GET /api/v1/export/shipments/?status_code__in=draft,gumruk_girish,gumruk_chykysh&page_size=200&ordering=harvest_age_desc[&season=]`.
`status_code__in` is a new list filter alongside the existing single `?status_code=` — it serves
`ShipmentDraftListSerializer` (same shape as `?status_code=draft`, `block_sources` prefetched)
extended with `status_code`, `country`, `customer` (ids), `truck_plate`, `driver_name`, so the
board can classify rows without a second request. `useDrafts()` (Draft Pool) is untouched and
keeps its own `?status_code=draft` query.

## Files

- Page: `frontend/src/pages/export/AssignmentBoard.tsx`, `frontend/src/pages/export/assignment/*`
  (`BoardColumn`, `SupplyCard`, `ExportPartCard`, `PackingActionPanel`, `boardHelpers.ts`)
- Route: `/export/assign` (`pageCode: 'export.assign'`)
- Navigation: no sidebar entry — removed from every role's menu 2026-08-24 (owner request, same treatment as Truck Forecast); reachable only by direct URL. See [[permissions-system#Sidebar Navigation (2026-08-05)]].
- Backend: `join` / `unjoin` / `swap_packaging` actions on `ShipmentViewSet`
  (`backend/apps/export/views.py`); business logic in `backend/apps/export/services/packaging.py`.
- Hooks: `useJoinBoard`, `useJoinShipments`, `useUnjoinPackaging`, `useSwapPackaging`
  (`frontend/src/hooks/useDrafts.ts`).

## Permissions

- **Read**: `export.assign` page — `export_manager`, `director`, and, since core migration
  `0068_loading_dept_assign_page` (written and applied on the dev DB, **not yet committed** — it
  depends on another session's uncommitted core `0066`/`0067`), `loading_dept_head` +
  `loading_dept_head_deputy`.
- **Mutation**: all three actions gate on `apps.core.roles.JOIN_ROLES` (mirrored in
  `frontend/src/components/sheet/joinHelpers.ts`) — `admin`, `director`, `boss`,
  `export_manager`-like roles, plus (since 2026-09-29) `loading_dept_head` and its deputy, since
  it's their packing. Superusers always pass. `get_permissions()` routes all three to
  `resource_edit_permission('shipment')` — the same branch `join` already used, not the coarse
  `can_create` gate.
- Closed season → the board is read-only (`useSeasonReadOnly`); action buttons render disabled.

## Related

- [[draft-shipments]] — two-phase creation and the "Late join, detach, swap (2026-09-29)" section
  this board is built on.
- [[shipment-lifecycle]] — where the packing barrier sits now (`gumruk_chykysh → yuklenme`).
- ADR-0014 (`docs/DECISIONS.md`) — the packing move model and why the barrier moved.
