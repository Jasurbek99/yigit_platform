---
title: Gaplama
tags: [screen, export, sera-design, tir-takip]
related: [[tir-takip]], [[../processes/weekly-harvest-planning]], [[../reference/api-endpoint-map]]
---

# Gaplama — packing view over the Weekly Plan

Two entry points, one screen: the `gaplama` tab of `/tir-takip` (`TirTakip.tsx`'s
`TAB_BODIES`) and its own route at `/export/gaplama` (`GaplamaPage.tsx`, sidebar entry
under the export group). Both mount `frontend/src/pages/sera/GaplamaTab.tsx` unmodified —
`GaplamaPage` is a thin `.sera-page` wrapper around it, nothing else. Both are gated on
the **same pair of page codes**: `tir_takip.gaplama` (the entry point's own code, shared
by design between the tab and the standalone route) and `export.plan` (the audience of
the Weekly Plan data the board reads). The tab checks the pair through
`TAB_BODIES.gaplama.requires`; the standalone route checks `tir_takip.gaplama` in the
router (`<ProtectedRoute pageCode="tir_takip.gaplama">`) and `export.plan` itself via
`canSeePage()`. The API enforces the identical pair server-side
(`CanViewTirGaplama`, superuser bypass) — so neither entry point can be widened by
forgetting a check on one side only.

## What it shows

A read-only week grid: each active top-level block's **plan** (`HarvestDayEntry.plan_value`),
**loaded** kg (`Sum(ShipmentBlockSource.weight_kg)` for that block/day, cancelled trucks
excluded), **carried-in** kg from earlier days, and **available** kg — the number this
screen exists to answer. Rows are grouped by `GreenhouseBlock.location_name` (Dusak / Kaka
/ Owadandepe), each group with its own subtotal row; a block with no location falls into a
trailing group labelled `tir_takip.gaplama.location_other`. Backed by
`GET /api/v1/export/gaplama/board/` → `backend/apps/export/services/gaplama.py`
(`build_gaplama_board`) — see `docs/superpowers/specs/2026-09-18-tir-takip-gaplama-design.md`
for the full design (D1-D16).

### The carry-over rule (no negative numbers)

`available_kg = max(0, carried_in_kg + plan_kg - loaded_kg)`. A day that gets loaded past
its own plan plus its carry-in never goes negative on screen — the overshoot is clamped to
0 and reported separately as `over_kg = max(0, unconsumed_load - plan_kg)`, which the grid
renders as a `0 ⚠` cell with a tooltip ("N kg artyk / over"). A day that finishes with
plan left over seeds a **FIFO bucket** consumable for `GreenhouseConfig.gaplama_carry_days`
days after it was created (default 2) — oldest bucket first. A negative remainder never
carries forward; only a positive one does. The board walks `carry_days` days before the
requested window specifically so a bucket created just before Monday is still visible (and
spendable) inside the displayed week — those lookback days' own rows and trucks are fetched
but filtered out of what the grid renders (`GaplamaTab.tsx` re-filters `board.days`/
`board.trucks` down to the 7 displayed dates after the wider fetch).

## Opening a truck

The **+ Tır Aç** button is shown to any role holding `shipment.create`
(`canDoBackendGated(user, 'shipment', 'create')`) in a season that isn't read-only, same
gate the Sheet's own supply drafts use. It is **disabled unless the displayed week
contains today** — a truck's date is fixed to the day it is created (`props.today`,
`GaplamaTab`'s own `today`, never the selected day/week), because `shipment_code`'s date
prefix and the actuals rollup both derive from the creation day and `Shipment.date` cannot
be edited after the fact. So the button exists on every week for layout consistency but
only does anything on the current one.

Clicking it opens `GaplamaTruckForm` in place of the button: one row per block (block +
kg), each capped at that block's `available_kg` for today, `+ Blok goş` to add another row,
plus an export-code field, harvest-status select and variety select. Submitting creates a
draft the same way the Sheet's own supply composer does —
`{ is_draft: true, date: today, skip_forecast_check: true, block_sources: [...],
weight_net: totalKg, export_code?, harvest_status?, varieties? }` via `useCreateDraft` —
so the new truck appears on the Sheet as an ordinary supply column and is joined to a
destination there as usual, the same as any supply-first draft. The kg total is compared against
`GreenhouseConfig.truck_capacity_kg` (default 18 500) purely to tag the truck **Partial**
(`isPartialTruck`) — under-filling a truck is allowed, not blocked.

## Editing a truck (Üýtget)

Shown only while the truck is still a bare supply row — `status_code === 'draft'` **and**
`country == null` **and** `customer == null`. The moment it is joined to a destination it
drops off this list's edit affordance and is edited on the Sheet like any other row
instead.

Clicking **Üýtget** swaps the create button/form for the same `GaplamaTruckForm`,
pre-filled from `editingTruck.block_sources`, capped per block at
`available_kg (for that truck's own date) + whatever this truck already holds in that
block` — so the truck's own existing kg is never counted against itself as "unavailable."
Saving calls `useUpdateTruckBlocks`, which is **two calls**, not one:
`POST /export/shipments/{id}/block-sources/` with `{ blocks: [{ block_id, weight_kg }] }`
(body key is `blocks`, not `block_sources` — verified against
`ShipmentViewSet.set_block_sources`), then `PATCH /export/shipments/{id}/` with the new
`weight_net` total. Both are calls the Sheet's own editors already make; nothing new was
added to the backend for this screen.

### Remount-on-edit-target-change

`GaplamaTruckForm` is given a `key` prop that changes with the edit target — `edit-<id>`
for a specific truck, `create` otherwise — set in `GaplamaTab.tsx`. Without that key,
clicking **Üýtget** on truck B while truck A's edit (or
an unsubmitted create) is still open in the form would change the `mode`/`editingTruck`
props but React would keep the same component instance — the form's own
`useState(initialRowsFor(props))` never re-runs on a prop change, so it would silently keep
showing the previous truck's rows while claiming to edit the new one. The key forces a full
remount on every switch between create, and each distinct truck's edit, so the rows always
start from that target's own data.

## Week navigation and the block filter

**◀ Prev week / This week / Next week** move `weekOffset`; weeks are ISO (`isoWeekday(1)`
start). A day column header is clickable to filter the summary table and truck list below
to that one day (click again to clear). `BlockFilterSelect` (shared with Önümçilik) narrows
the grid, footer, and location subtotals together — filtering never desyncs one from
another, because every aggregate reads from the same `boardDays` (already filtered) rather
than the raw board. The truck-edit form is the one place that deliberately reads the
**unfiltered** board (`capForBlockDate` looks at `board.days`, not `boardDays`), since a
truck sourced from a block the current filter hides must still be editable.

## Not built in this screen

Task and notification wiring for a daily "open today's trucks" reminder and an over-load
alert (D14/D15 in the design spec) is a separate, deferred feature — see
`docs/superpowers/plans/2026-09-23-gaplama-tasks.md`. Undo/redo and multi-row selection are
not part of this screen at all (that is the Sheet's clipboard feature, unrelated).

## Files

| Role | Path |
|---|---|
| Tab body | `frontend/src/pages/sera/GaplamaTab.tsx` + `.test.tsx` |
| Standalone page | `frontend/src/pages/sera/GaplamaPage.tsx` + `.test.tsx` |
| Truck form | `frontend/src/pages/sera/GaplamaTruckForm.tsx` + `.test.tsx` |
| Pure arithmetic | `frontend/src/pages/sera/GaplamaTab.totals.ts` + `.test.ts` |
| Hooks | `frontend/src/hooks/useGaplama.ts` — `useGaplamaBoard`, `useUpdateTruckBlocks` |
| Types | `frontend/src/types/index.ts` — `IGaplamaDay`, `IGaplamaTruck` |
| Endpoint | `backend/apps/export/views_gaplama.py` — `GaplamaBoardView` |
| Service | `backend/apps/export/services/gaplama.py` — `build_gaplama_board` |
| Permission | `backend/apps/export/permissions.py` — `CanViewTirGaplama` |
| Config | `backend/apps/core/models/config.py` — `GreenhouseConfig.gaplama_carry_days` (default 2), `.truck_capacity_kg` (default 18 500) |
| Tests | `backend/apps/export/tests_gaplama_board.py` |
| Route | `frontend/src/App.tsx` — `export/gaplama`, `pageCode="tir_takip.gaplama"` |
| Nav | `frontend/src/components/AppLayout.tsx` — `nav.gaplama` |
| i18n | `frontend/src/i18n/{tk,ru,en}.json` — `tir_takip.gaplama.*`, `nav.gaplama` |
| CSS | `frontend/src/pages/sera/sera.css` — `.sera-gaplama-*` |
| Design spec | `docs/superpowers/specs/2026-09-18-tir-takip-gaplama-design.md` |
