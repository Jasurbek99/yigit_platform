---
title: Shipment Sheet
tags: [screen, export, shipment, spreadsheet, ops]
related: [[../processes/shipment-lifecycle]], [[../reference/api-endpoint-map]], [[../processes/permissions-system]]
---

# Shipment Sheet

Excel-style spreadsheet view at `/export/shipments/sheet/`. Each shipment is **one column**; each operational field is **one row**. Mirrors the original Excel "Eksport Hasabat" tab the platform replaced.

Backend: `ShipmentViewSet.sheet()` action at `GET /api/v1/export/shipments/sheet/` returns a flat per-season payload (no pagination — the grid loads the whole season).

## Page layout

```
┌─────────────────────────────────────────────────┐
│  Toolbar  [+ Add column]  [search]  [Gapy only] │
├──┬──────┬───────────┬────────┬────────┬─────────┤
│ #│ Who  │ Field     │ S-001  │ S-002  │   ...   │  ← virtualised
├──┼──────┼───────────┼────────┼────────┼─────────┤
│ 2│Logist│ Route     │  ...   │  ...   │   ...   │  ┐
│..│      │           │        │        │         │  │ Frozen top
│14│Solty │ Harvest   │  ...   │  ...   │         │  ┘ (rows 2–14)
├──┼──────┼───────────┼────────┼────────┼─────────┤
│15│Haltac│ Capacity  │  ...   │  ...   │         │  ┐ Scrollable
│..│      │           │        │        │         │  │ bottom
│45│Arap  │ Notes     │  ...   │  ...   │         │  ┘ (rows 15–45)
└──┴──────┴───────────┴────────┴────────┴─────────┘
```

Three frozen left columns (#, Who, Field label) + virtualised data columns rendered via `@tanstack/react-virtual`. A full season (~1,000 shipments × 44 rows) is handled by virtualising columns; only ~20 visible at a time are in the DOM.

## Freeze panes (configurable)

Both axes of the freeze are user-configurable, modelled on Google Sheets:

- **Frozen rows** — top N data rows (default `13`, mirroring the original "rows 2–14 = identity & planning" band). Rendered in a `position: sticky; top: ROW_HEIGHT` band; remaining rows scroll vertically beneath it.
- **Frozen columns** — first N data columns (default `0`). Rendered as `position: sticky; left: <offset>` cells between the label band and the virtualizer container; the remaining shipments are passed to `@tanstack/react-virtual` as the virtualization population.

State lives in `sheetStore` (`frozenRowCount`, `frozenColCount`) and persists to `localStorage` under `ygt-sheet-freeze`. Defaults restore on first visit. The grid clamps stored values against the visible row/column counts each render so a stale localStorage value (e.g. 5C frozen, only 2 shipments visible after filter) still produces a coherent layout.

The toolbar exposes a **Freeze** dropdown with: _No rows / 1 row / 2 rows / Up to current row (N) / Default (rows 2–14)_ and the equivalent column options. "Up to current row/column" reads `activeCell` and is disabled when no cell is selected. The current setting is shown as `<R>R · <C>C` next to the button (this is the *user-set* value, not the clamped one — stable across filter changes).

A blue 2px line on the trailing edge of the last frozen row/column marks the freeze line, mirroring Excel/Sheets. Header label cells (`#`, Who, Field name) are also `position: sticky; left: 0` so they remain visible during horizontal scrolling.

## Row config

Source of truth: [`frontend/src/constants/sheetRowConfig.ts`](../../../frontend/src/constants/sheetRowConfig.ts).

| Section | Rows | Purpose |
|---------|------|---------|
| Frozen top | 2–14 | Identity & planning — route note, customs/docs/harvest status, cargo code, blocks, firms, country, customer, city, import firm |
| Scrollable bottom | 15–44 | Operations & logistics — truck capacity, loading/departure timestamps, transport, border, weights, variety, sale window, sales report flag |

Row numbers mirror the original "Eksport Hasabat" Excel sheet so users can cross-reference the platform view with their spreadsheet by row index. Earlier versions of the platform had a one-row offset on R20+ (loading_started_at was rendered on R20 instead of R19, transit_days_temp on R27 instead of R26, etc.); that has been corrected.

**Comment summary cells (R17, R18):** Read-only count cells with a chat-bubble icon. R17 counts comments by `warehouse_chief` (Soltanmyrat); R18 counts comments by `document_team` (Şirin). Click → opens the [[../processes/comments-tasks|Comments Drawer]] filtered to that role's threads on the active shipment column. Counts come from `Count('comments', filter=Q(comments__user__role=...))` annotated by the sheet viewset.

## Comments Drawer

The Sheet has a right-side **Comments Drawer** (Ant `Drawer`, `mask=false`, 360px) for cell-anchored discussions and task assignment. Full process documented in [[../processes/comments-tasks]] — short summary here:

- **Open**: Comments button in the toolbar, OR click any cell's blue/orange/green marker badge
- **Filters** (chip group in drawer header): _This cell_ (when a cell is active), _All cells_, _My tasks_
- **Compose**:
  - Type `@` → user/role autocomplete popover (`useMentionable`)
  - Type `#` → cell autocomplete popover (from `sheetRowConfig.ts`)
  - Toggle "Pin to active cell" — sets `field_key` so the comment becomes a cell anchor
  - Pick an Assignee → comment becomes a task; assignee gets `task_assigned` notification
  - Ctrl+Enter to send
- **Markers** appear in cell corners when a cell has comments: blue (comment), orange (open task), green (done)
- **Deep-link**: `/export/shipments/sheet?shipment={id}&row={fieldKey}&comment={id}` selects the cell, auto-opens the drawer, and scrolls the comment into view with a 2-second highlight ring. Used by all three new notification kinds (`mention`, `task_assigned`, `task_done`).

The sheet endpoint response now includes top-level `comment_counts` and `task_counts` dicts keyed by shipment ID — used by the cell markers and the toolbar's "my open tasks" badge respectively.

R24 = `has_doc_advance` (✓/❌, Babageldi). True once a `FinansistAdvanceShipment` row links the shipment to a `FinansistAdvance` — i.e. the finansist has issued documentation/customs money for the shipment. Click navigates to `/export/advances?shipment={id}`. R25 = `customs_exit_at` (Türkmenistan customs exit, Şirin). R26 = `transit_days_temp` (transit days + temperature, Quality inspector).

## Input types

| `inputType` | Editor | Notes |
|-------------|--------|-------|
| `text` | Ant `Input` | Strings; saves on Enter or blur |
| `number` | Ant `InputNumber` | Decimals for kg, USD |
| `phone` | Ant `Input` | Driver phone — same as text, semantic only |
| `date` | Ant `DatePicker` | ISO date (YYYY-MM-DD) |
| `datetime` | Ant `DatePicker showTime` | ISO 8601 with offset |
| `dropdown` | Ant `Select` | Options from reference hooks (countries, firms, …) or `ShipmentOptionType` by category |
| `multiselect` | Ant `Select mode="multiple"` | Junction tables (`firm_splits`, `block_sources`) — posts to `block-sources/` / `firm-splits/` action endpoints |
| `status` | Ant `Select` | Options from `ShipmentOptionType` filtered by `category = fieldKey` |
| `readonly` | None | Display-only; never editable |
| `comment_count` | None | Display count + icon; click navigates to ShipmentDetail's Changes tab |

## Permissions

The sheet now reads from the **dynamic permission registry** (no hardcoded role matrix):

- Direct shipment fields → `canEditField(user, 'shipment', fieldKey)` — gated by `RoleFieldPermission`
- Junction tables → `canDo(user, 'shipment_firm_split' | 'shipment_block_source', 'edit')`
- Add-column button → `canDo(user, 'shipment', 'create')`

Directors manage these matrices at `/admin/permissions`. The seed defaults are populated by `seed_permissions`.

> **AD-1 timestamps** (`loading_started_at`, `customs_entry_at`, `customs_exit_at`, `departed_at`, `border_crossed_at`, `arrived_at`, `sale_started_at`, `sale_ended_at`) are **not** in `RESOURCE_FIELDS['shipment']` and are explicitly excluded from `_ALL_PATCHABLE_FIELDS` in `ShipmentPatchSerializer`. They render as non-editable in the sheet — set them via `transition_to()` (see [[../processes/shipment-lifecycle]]).

## Save flow

`useShipmentPatch.ts` performs **optimistic updates with rollback**:

```
edit cell → setQueryData(... new value) → PATCH /export/shipments/{id}/ →
  ✓ success: invalidate ['shipments', 'sheet']
  ✗ error:   restore previous cache, show toast 'sheet.save_error'
```

Junction edits use a separate mutation that POSTs to `block-sources/` or `firm-splits/` and invalidates the same query key.

### Auto-split for R8 / R9 (Gap 7 — see ADR-016)

When the user picks blocks (R8) or firms (R9) in the multiselect, the frontend sends only the IDs — **`weight_kg` is omitted**. The backend fills the weights using two different rules because the two cells track conceptually different numbers:

| Cell | Rule |
|---|---|
| **R8 `block_sources`** (Soltanmyrat) | `(shipment.weight_net or 18,100) / N`, last entry gets the rounding remainder. Real harvest weight, no cap. |
| **R9 `firm_splits`** (Şulgun) | Lookup by N in `TruckSplitDefault` (admin-configurable). Defaults: 1→18,100 · 2→9,000 · 3→6,000. The OFFICIAL kg written on export documents — capped at 18,100 kg total per truck even though real trucks carry 20,000–21,000 kg. |

Director changes the per-firm-count amounts at `/admin/shipment-settings` → "Truck Split Defaults" tab. Cache invalidates on save so the next firm-split save uses the new value.

If the client sends an explicit non-zero `weight_kg`, the backend honours it (admin override path).

## Toolbar

- `+ Add column` — creates a new draft shipment (`useSheetCreate`); visible when `canDo('shipment', 'create')`
- Search — filters by `cargo_code` or `customer_name` (client-side)
- Gapy only — filters to `is_gapy_satys = true`
- **Freeze** — dropdown to set frozen-row and frozen-column counts (see Freeze panes above)
- Deadline timer — global hour deadline indicator

## Backend payload

`ShipmentSheetSerializer` flattens 44+ fields including:
- `firm_splits` and `block_sources` (inline `SheetFirmSplitInlineSerializer` / `SheetBlockSourceInlineSerializer`)
- Quality doc booleans (`doc_azyk`, `doc_suriji`, `doc_hil`, `doc_kalibrowka`) — sourced from `quality.*` (related_name on `QualityDocument` is `quality`)
- `has_sales_report` — annotated by viewset queryset via `Exists(SalesReport.objects.filter(shipment=OuterRef('pk')))`
- `variety_code` from `TomatoVariety.code` (the official 01–10/E1–E3 registry code)
- AD-1 timestamps — read-only display
- AD-2 fields — `vehicle_condition`, `vehicle_condition_note`, `route_note`

Querystring `?season=<id>` overrides the active season; default scopes to `season__is_active=True`.

## Known issues

- All rows from R2 to R44 are now configured (R24 is the new finansist doc-advance flag).
- **`harvest_date`, `additional_notes_arap`, `truck_capacity`, `product_date`, `transit_days_temp`, `truck_plate`, `driver_name`, `driver_phone`** — present in `sheetRowConfig.ts` but not in the `Shipment` model nor `_ALL_PATCHABLE_FIELDS`. They render but cell edits will 403 from the backend. Either map to the right model fields (e.g. `truck_plate` → `truck_head_id` lookup) or remove from the row config.

## Related

- [[../processes/shipment-lifecycle]] — How AD-1 timestamps get written
- [[../processes/permissions-system]] — Dynamic permission registry, `canEditField` / `canDo`
- [[../reference/api-endpoint-map]] — `GET /export/shipments/sheet/` and the inline patch contract
