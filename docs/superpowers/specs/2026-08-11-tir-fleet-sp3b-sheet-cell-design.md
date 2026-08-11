# TIR Fleet — SP3b (Sheet-cell truck picker) Design Spec

**Date:** 2026-08-11
**Branch:** `feat/transport-fleet-map` (worktree `D:/projects/yigit_platform-transport-fleet-map`)
**Parent spec:** `docs/superpowers/specs/2026-08-03-tir-fleet-integration-design.md`
**Status:** design approved (user), ready for writing-plans.

## Goal

Make the Sheet grid's `truck_plate` cell pick a **truck-head (tractor) + trailer from the company fleet** (so GPS resolves automatically), the same capability already shipped on the ShipmentDetail / edit-drawer surfaces (SP3a) — while keeping the **HARD RULE**: if `shipment.is_gapy_satys` is true, the cell stays a **plain text input** (no dropdowns, no GPS — local buyers' trucks, not the fleet).

This is the last remaining TIR sub-project. SP1/SP2 (backend), SP3a (drawer selector), SP3c (inline add), SP4 (admin page) are done.

## Decisions (locked with the user)

1. **Virtual combined cell** — keep the single `truck_plate` row; its editor edits three backing fields at once. (Not two separate rows.)
2. **Inline "+ Add"** is included in the Sheet cell too (create-if-not-in-list), mirroring SP3c.

## Background — how the Sheet cell editor works today

`frontend/src/components/sheet/SheetCellEditor.tsx`:
- `renderEditor()` switches on `rowConfig.input_type` (`text`/`phone`/`number`/`dropdown`/`multiselect`/`date`/`datetime`/`status`) plus **field-key special-cases**. `truck_plate` is currently `input_type: 'text'` → a plain `<Input>`.
- **Precedent — R26 `transit_days_temp`:** a *virtual* cell (`field_key === 'transit_days_temp'`, special-cased at the top of `renderEditor()`) whose one text input edits **two** real fields (`transit_days`, `transport_temp_c`) through `patchMultiMutation` (`useShipmentPatchMulti`) with undo capture: `recordMultiEntry(id, before, fields)` → `patchMultiMutation.mutate({id, fields})` → `setEntryAfter(...)`. SP3b is the same shape with three fields.
- **Precedent — `multiselect` cell:** defers save until commit — pending selection held in a `ref`, committed once on **Done button / click-outside** (`onOpenChange(open=false)`), guarded against double-commit. SP3b's two-select overlay reuses this "commit-once" pattern.
- `getOptions()` builds `[{value,label}]` lists by `options_source ?? field_key`. Reference-data hooks (`useCountries`, `useCities`, …) are called unconditionally at the top of the component and cached by TanStack Query.
- `shipment.is_gapy_satys`, `shipment.truck_head_id`, `shipment.trailer_id`, `shipment.truck_plate` are ALL on the sheet payload (`IShipmentSheetItem`, `types/index.ts`; backend sheet serializer sends them). **No backend work needed.**
- Display: `getCellValue.ts` (`case 'truck_plate'`) shows `shipment.truck_plate` — unchanged by this work.

## Design

### Component shape

Special-case `rowConfig.field_key === 'truck_plate'` at the top of `renderEditor()` (like `transit_days_temp`), delegating to a small dedicated sub-component so `SheetCellEditor.tsx` doesn't grow unwieldy:

```
renderEditor():
  if (field_key === 'truck_plate') {
    if (shipment.is_gapy_satys) return <the existing text <Input> saving truck_plate via save()>;
    return <SheetTruckSelectEditor shipment=... onCommit=... onClose=... />;
  }
```

**`SheetTruckSelectEditor`** (new file, `frontend/src/components/sheet/SheetTruckSelectEditor.tsx`):
- Props: `shipment` (for `truck_head_id`/`trailer_id` prefill + compose), `onCommit(fields: {truck_head_id, trailer_id, truck_plate})`, `onClose()`.
- Renders an **absolutely-positioned mini-panel** anchored to the cell (overflowing it downward, like the dropdown popups already do with `popupMatchSelectWidth={false}`): a truck-head `<Select>` on top, a trailer `<Select>` below, and a small **Done** button — mirroring the multiselect cell's `dropdownRender` Done affordance.
- Options from `useTruckHeads()` / `useTrailers()` (`useFleet.ts`), `[{value: id, label: plate_number}]`; `showSearch` + client-side `filterOption`. Inline **"+ Add"** via `dropdownRender` on each Select → `useCreateTruckHead()` / `useCreateTrailer()` (plate uppercased on create) → the created row is selected. (Reuses the exact SP3c approach.)
- **Defer + commit-once:** hold pending `{headId, trailerId}` in a `ref`, seeded from `shipment.truck_head_id`/`trailer_id`. Commit on Done or click-outside (`onClose` path). If unchanged from the shipment's current ids, just close (no patch).
- On commit: resolve head/trailer **plate strings** from the option lists (or from a just-created row's plate passed straight through, not the not-yet-refetched list — the SP3c `knownPlates` lesson), compose `truck_plate` via the shared helper, and call `onCommit({truck_head_id, trailer_id, truck_plate})`.

### Save + undo (in `SheetCellEditor`)

`onCommit` runs a **multi-patch with undo capture**, mirroring `saveTransitTemp`:
```
const before = { truck_head_id: shipment.truck_head_id, trailer_id: shipment.trailer_id, truck_plate: shipment.truck_plate };
const undoId = recordMultiEntry(shipment.id, before, fields);
patchMultiMutation.mutate({ id: shipment.id, fields },
  undoId === -1 ? undefined : {
    onError: () => dropEntry(undoId),
    onSuccess: (data) => setEntryAfter(undoId, /* reconciled 3 fields, falling back to sent */, cascadeFrom(shipment, data)),
  });
close();
```
Inline-add is a two-step (POST the fleet row, then this multi-patch links it); undo reverts only the shipment's three truck fields — the created fleet row persists (consistent with how creation works elsewhere, and with SP3c).

### Options (`getOptions()`)

Add two cases returning `[{value: id, label: plate_number}]`:
```
case 'truckHeads':
case 'truck_head_id':
  return (truckHeads ?? []).map(h => ({ value: h.id, label: h.plate_number }));
case 'trailers':
case 'trailer_id':
  return (trailers ?? []).map(tr => ({ value: tr.id, label: tr.plate_number }));
```
Fetch `useTruckHeads()` / `useTrailers()` at the top of `SheetCellEditor` alongside the other reference hooks (cached; the lists are small — 91 heads / 74 trailers). *(If preferred, gate them behind `enabled: field_key === 'truck_plate' && !is_gapy_satys` — implementer's call; either is fine.)*

### Shared compose helper

Extract the `"{head}/{trailer}"` composition + uppercase-on-create rule (today inside SP3a's `ShipmentTruckSelector.tsx`) into a shared util (e.g. `frontend/src/utils/truckPlate.ts` — `composeTruckPlate(headPlate?: string, trailerPlate?: string): string`) and have BOTH `ShipmentTruckSelector` and `SheetTruckSelectEditor` use it, so the two surfaces can never diverge on the composed string.

### Unchanged

- `getCellValue.ts` display (still the `truck_plate` string).
- Backend (payload already complete).
- Gapy cells (text, no GPS) — enforced by the `is_gapy_satys` branch.
- The Sheet's undo/redo, comment markers, gapy-hidden logic in `SheetCell.tsx`.

## Interfaces / units

| Unit | Does | Depends on |
|---|---|---|
| `composeTruckPlate()` util | one source of truth for `"{head}/{trailer}"` + uppercase | none |
| `SheetTruckSelectEditor` | two-select overlay + inline-add + commit-once; emits `{3 fields}` | `useTruckHeads`/`useTrailers`/`useCreateTruckHead`/`useCreateTrailer`, `composeTruckPlate` |
| `SheetCellEditor` truck_plate branch | gapy→text / else→editor; multi-patch + undo | `SheetTruckSelectEditor`, `patchMultiMutation`, undoCapture |

## Testing (extend `SheetCellEditor.test.tsx`, + a focused `SheetTruckSelectEditor.test.tsx`)

1. **Gapy** shipment → `truck_plate` cell renders a **text input**; editing saves `truck_plate` via the single-field path (no multi-patch, no selects).
2. **Non-gapy** → renders two selects; picking a head + trailer and pressing Done fires **one** `patchMultiMutation` with `{truck_head_id, trailer_id, truck_plate: "HEAD/TRAILER"}`.
3. **Inline "+ Add"** on an unknown plate → creates via the hook, then the commit's `truck_plate` reflects the just-created plate (not a stale-list lookup).
4. **Undo** — `recordMultiEntry` is called with the before/after three fields on commit.
5. Commit-once: changing head then trailer before Done results in a single patch, not two.

## Constraints

- MSSQL rules N/A (frontend only). i18n tk/ru/en for any new strings (e.g. the Done button reuses `sheet.multiselect_done`; "+ Add" reuses the SP3c `shipment_edit_drawer.add_truck`/`.add_trailer` keys if suitable, else new `sheet.*` keys).
- `npx tsc --noEmit --ignoreDeprecations 5.0` clean; `npx vitest run` for the touched test files.
- Commits on `feat/transport-fleet-map` (worktree). Implementer subagents co-author `Claude Sonnet 5`.

## Self-review

- **Placeholders:** none — every unit, field, and save path is concrete.
- **Consistency:** save/undo path mirrors the in-file `saveTransitTemp`; commit-once mirrors the in-file multiselect; options mirror the existing `getOptions` cases; gapy branch matches the HARD RULE used on the other two surfaces.
- **Scope:** one sub-project, ~2 tasks (helper + getOptions/hooks; then the overlay editor + save-branch + tests). Focused enough for a single plan.
- **Ambiguity resolved:** (a) two selects don't fit a 1-row cell → absolutely-positioned overlay, explicitly chosen; (b) save timing → deferred commit-once (not per-pick); (c) stale-list compose after inline create → pass the created plate straight through (SP3c `knownPlates` lesson); (d) fetch-always vs enabled for the fleet hooks → either acceptable, implementer's call.
- **Risk:** the overlay-in-a-cell (positioning, focus/keyboard, click-outside commit vs. the grid's own click handling) is the one non-trivial piece; everything else is well-trodden in this file.
