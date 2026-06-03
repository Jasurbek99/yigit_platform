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

### Settings modal

The toolbar's **⚙ Settings** button (top-left, after the Gapy switch) opens a `Sheet Display Settings` modal that houses the freeze pickers:

- **Freeze rows up to:** Ant `Select` with one option per visible row in the current order — labelled `<field label> (R<row_number>)` (e.g. `Harvest Status (R14)`). Picking row at position N sets `frozenRowCount = N`. The list reflects the user's reordered + visible row sequence (not the original Excel numbering), so freezing matches what the user actually sees on screen.
- **Freeze columns up to:** Ant `Select` with options `After column 1`, `After column 2`, …, capped at `min(20, shipmentCount − 1)`. Picking N sets `frozenColCount = N`. Disabled when there are fewer than 2 shipments.

Both pickers apply changes live (no Save button); the modal has `Reset to default` (rows=13, cols=0) and `Done` (close). A small badge dot on the gear button indicates the freeze is non-default. There is no longer an "Up to current row/column" shortcut — picking the row/column directly from the modal is more discoverable and doesn't require the user to first click a cell.

A blue 2px line on the trailing edge of the last frozen row/column marks the freeze line, mirroring Excel/Sheets. Header label cells (`#`, Who, Field name) are also `position: sticky; left: 0` so they remain visible during horizontal scrolling. Rows and section containers carry `min-width: max-content` so the sticky-left cells are bounded by the row's full content width — without this they unstick once the user scrolls past one viewport-width.

## Zoom

The toolbar's `−` / `%` / `+` group scales the whole grid between **60 %–150 %** in 10 % steps. State: `sheetZoom` in `sheetStore` (actions `zoomIn`/`zoomOut`/`resetZoom`/`setSheetZoom`, clamped + rounded to 2 dp), persisted per browser to `localStorage` under `ygt-sheet-zoom`. Default 100 %.

**Why not CSS `zoom`/`transform`?** The Sheet is virtualized with `@tanstack/react-virtual`. A CSS transform/zoom on the scroll container (or any ancestor of it) makes `scrollLeft` and `getBoundingClientRect()` report values in different coordinate frames, so the virtualizer renders the wrong columns as you scroll — a silent, browser-version-dependent breakage. Instead:

- **Layout px scale in JS.** `scaleSheetLayout(zoom)` in `constants/sheetRowConfig.ts` multiplies every layout constant (`COL_WIDTH_*`, `ROW_HEIGHT`, `FROZEN_LEFT_TOTAL`). `SheetGrid`, `SheetCell`, `SheetCellEditor`, and `SheetLabelColumn` all read `sheetZoom` from the store and derive identical scaled values, so the column virtualizer's `estimateSize`, the sticky-left `left` offsets, and the rendered cell widths stay in lockstep. The column virtualizer's `.measure()` re-runs whenever the scaled width changes so cached item sizes don't go stale. A per-cell custom width (`rowSetting.style.width`) is multiplied by zoom too.
- **Fonts + cell padding scale in CSS.** `SheetGrid` sets `--sheet-zoom: <zoom>` inline on `.sheet-grid`; the font-size and padding declarations in `SheetStyles.css` use `calc(Npx * var(--sheet-zoom, 1))`. The fallback `1` keeps the styles correct anywhere the variable isn't set.

## Row config

**Backend is the single source of truth.** `backend/apps/export/sheet_rows.py` exports `DEFAULT_SHEET_ROWS` (42 entries — row 16 is intentionally absent, matching the original Excel layout). The `/api/v1/export/shipments/sheet/` response ships these as the `rows` top-level key alongside `results` / `comment_counts` / `task_counts`. Frontend renders whatever the API returns; there is no longer a hard-coded `SHEET_ROW_CONFIG` array on the frontend. Adding, removing, or reordering rows is a one-place change in `sheet_rows.py`.

Translation strings (`sheet.who.*`, `sheet.row.*`) stay in `frontend/src/i18n/{tk,ru,en}.json`; the API ships only the i18n keys (`default_who_key`, `label_key`).

Dropdown rows whose `options_source` is fixed (e.g. `vehicle_condition`) resolve via `frontend/src/constants/sheetOptions.ts` `SHEET_OPTIONS_REGISTRY`. Dynamic dropdowns (`country`, `customer`, `border_point`, etc.) keep using their dedicated TanStack Query hooks.

### Per-user row order and visibility (Phase 2a — ADR-0003/ADR-0008)

Users can reorder and hide sheet rows through the toolbar. Preferences are stored server-side in the `UserSheetRowPref` table (one row per `(user, SheetRowSetting)`) and synced debounced from the frontend.

**Model**: `export_user_sheet_row_pref` — flat child table (no JSONField, MSSQL-safe per ADR-0008).
- `position`: sparse integer (step 1024). NULL = inherit admin `display_order`.
- `is_hidden`: true = hidden from this user's view. AND-composed with admin `is_visible`.

**Row order resolution** (in `/sheet/` action):
1. Load all `UserSheetRowPref` for the request user (1 query).
2. For each row in `DEFAULT_SHEET_ROWS`:
   - Skip if admin `is_visible=False` (admin-hidden; hard override).
   - Skip if user `is_hidden=True` (user-hidden).
   - `effective_order = user.position ?? setting.display_order` (fallback 999999 if no DB config).
3. Sort by `effective_order` (stable).

**`user_preferences` key** in `/sheet/` response:
```json
{
  "user_preferences": {
    "row_order": [12, 5, 8, ...],   // ids where user.position IS NOT NULL, ordered ASC
    "hidden_rows": [3, 14, ...]     // ids where user.is_hidden=True
  }
}
```
Frontend uses `user_preferences` to initialise the drag-and-drop row order state without a separate API call.

**Sync endpoint**: `GET/PATCH /api/v1/export/user/sheet-preferences/` — `UserSheetPreferencesView`. Auth: `IsAuthenticated`. PATCH accepts `{ row_order?: [...], hidden_rows?: [...] }` — absent key = no-op. Both keys are idempotent: the payload fully replaces the dimension it targets. The `row_order` key lists only ids with user-set positions; unlisted rows fall back to admin `display_order`.

### Per-row trigger configuration (Sheet Control v2)

Each row can be assigned **one or more formal roles** AND/OR **a specific user** and **extra users**, configurable in **Shipment Settings → Sheet Rows** (admin-only). The config is stored across three tables:

| Table | Purpose |
|-------|---------|
| `export_sheet_row_setting` | One row per `field_key`. Holds labels, description, style, `is_locked`, soft-delete fields, optimistic `version`. |
| `export_sheet_row_role_trigger` | Child rows: one per `(setting, role)`. Replaces the old single `triggered_role` column. |
| `export_sheet_row_user_permission` | Child rows: one per `(setting, user)`. Extra users who can edit regardless of `is_locked`. Soft-deleted with `deleted_at`. |

**Trigger + Lock semantics (ADR-0008 / ADR-0009 / ADR-0010):**
- If `is_locked=False` (default): `triggered_roles[]` acts as the "Who" label. Editing falls back to `RoleFieldPermission` for all roles — the trigger is display-only.
- If `is_locked=True`: only users whose role is in `triggered_roles[]` **OR** who appear in `extra_user_ids[]` (non-deleted `SheetRowUserPermission`) can edit the cell. All other roles get the fallback "no setting → field-perm" path denied.
- If both `triggered_roles[]` and `triggered_user` are empty (`is_locked=False`), only `RoleFieldPermission` governs access.
- `admin`, `director`, and `is_superuser` always bypass the lock.

**"Who" column label:**
1. `triggered_user.username` if a specific user is set (warning chip if `is_active=False`).
2. First matched `triggered_roles[]` label (role display name) if any roles are configured.
3. Fallback: translate `default_who_key` from i18n.

**Edit-map**: `get_sheet_edit_map(user)` computes edit access in **4 DB queries** (1 settings + 2 prefetch for `role_triggers` and `user_permissions` + 1 field perms). Result is embedded in the `/sheet/` response as `row_settings[field_key]` — the frontend never makes per-cell permission calls.

**Admin endpoint**: `GET/POST/PATCH/DELETE /api/v1/export/admin/sheet-rows/{id}/` — see the Sheet Rows Admin section below.

**Visibility toggle**: `is_visible=False` rows are excluded entirely from the `row_settings` map in the `/sheet/` response. Hidden rows are always denied edit access.

### Sheet Rows Admin endpoint

`/api/v1/export/admin/sheet-rows/` — managed by `SheetRowSettingViewSet`. Auth: `admin` role only.

| Method | Path | Action |
|--------|------|--------|
| GET | `/sheet-rows/` | List all rows (`?include_deleted=1` shows soft-deleted) |
| GET | `/sheet-rows/{id}/` | Row detail with `role_triggers[]` and `user_permissions[]` |
| POST | `/sheet-rows/` | Create a new setting |
| PATCH | `/sheet-rows/{id}/` | Update labels, `is_locked`, `triggered_user`, `triggered_roles[]`, style. Requires matching `version` (optimistic lock) — wrong version → 409 Conflict. |
| DELETE | `/sheet-rows/{id}/` | Soft-delete (sets `deleted_at`). Rejected with 400 if row is still `is_visible=True`. |
| POST | `/sheet-rows/{id}/restore/` | Restore a soft-deleted row. Returns 400 if already active. |
| POST | `/sheet-rows/reorder/` | Accepts `[{"id": N, "display_order": N}]`. Uses sparse ADR-0007 spacing (`(idx+1)*1024`). Writes one `AuditLog` row for every order change. |
| POST | `/sheet-rows/{id}/permissions/bulk/` | Bulk grant/revoke `SheetRowUserPermission`. Body: `{"grant": [uid, ...], "revoke": [uid, ...]}`. Idempotent. |

**Optimistic locking (ADR-0006):** Every PATCH must include `version` matching the current DB value. The server increments `version` on save. Concurrent edits are detected and return 409 with `{"error": "Version conflict. Reload and retry.", "current_version": N}`.

**Soft-delete (ADR-0002):** `DELETE` sets `deleted_at` + `deleted_by`. Soft-deleted rows are excluded from the default `get_queryset()` (manager `.active()`). Use `?include_deleted=1` to see them. Restore via `/restore/`.

**Sparse display_order (ADR-0007):** Rows use step=1024 spacing (1024, 2048, …). Reorder recalculates from scratch. Inserting between two rows uses midpoint; no rebalancing needed until values collapse.

| Section | Rows | Purpose |
|---------|------|---------|
| Frozen top | 2–14 | Identity & planning — route note, customs/docs/harvest status, cargo code, blocks, firms, country, customer, city, import firm |
| Scrollable bottom | 15–44 | Operations & logistics — truck capacity, loading/departure timestamps, transport, border, weights, variety, sale window, sales report flag |

Row numbers mirror the original "Eksport Hasabat" Excel sheet so users can cross-reference the platform view with their spreadsheet by row index. Earlier versions of the platform had a one-row offset on R20+ (loading_started_at was rendered on R20 instead of R19, transit_days_temp on R27 instead of R26, etc.); that has been corrected.

**Per-role freeform notes (R17, R18):** Plain text cells, parallel to Gadam's `export_manager_note` (R5). R17 holds `warehouse_note` — owned by Soltanmyrat (`loading_dept_head`); deputies (`warehouse_chief`) share the same field. R18 holds `document_note` — owned by Şirin (`document_team`). Editable inline like any other text cell; per-cell discussion threads still live on each cell's CommentMarker.

**R4 — `transport_docs_given_at` (Şirin / `document_team`).** Datetime cell logging when the transport department handed over the shipment docs. Empty state renders `Berilmedi` (not the generic em-dash) so an unfilled cell is unambiguous; picking a date+time implies `Berildi` at that moment. Repurposed from the legacy Malik "Goşmaça bellik" column per in-app feedback #9 — `Shipment.notes` still exists on the model (and on the Detail view) for historical data but is no longer surfaced on the Sheet.

## Comments Drawer

The Sheet has a right-side **Comments Drawer** (Ant `Drawer`, `mask=false`, 360px) for cell-anchored discussions and task assignment. Full process documented in [[../processes/comments-tasks]] — short summary here:

- **Open**: Comments button in the toolbar, OR click any cell's blue/orange/green marker badge
- **Filters** (chip group in drawer header): _This cell_ (when a cell is active), _All cells_, _My tasks_
- **Compose**:
  - Type `@` → user/role autocomplete popover (`useMentionable`)
  - Type `#` → cell autocomplete popover (from the `rows` payload of `/sheet/`)
  - Toggle "Pin to active cell" — sets `field_key` so the comment becomes a cell anchor
  - Pick an Assignee → comment becomes a task; assignee gets `task_assigned` notification
  - Ctrl+Enter to send
- **Markers** appear in cell corners when a cell has comments: blue (comment), orange (open task), green (done)
- **Deep-link**: `/export/shipments/sheet?shipment={id}&row={fieldKey}&comment={id}` selects the cell, auto-opens the drawer, and scrolls the comment into view with a 2-second highlight ring. Used by all three new notification kinds (`mention`, `task_assigned`, `task_done`).

The sheet endpoint response now includes top-level `comment_counts` and `task_counts` dicts keyed by shipment ID — used by the cell markers and the toolbar's "my open tasks" badge respectively.

## Cell-level edit audit (clock-icon marker)

Every shipment field PATCH writes one `AuditLog` row per changed field with structured `(field_name, old_value, new_value, user, timestamp)` (`backend/apps/export/services/sheet_audit.py` `render_field_value()` is the single rendering source — `__str__` for FK objects, `format(d, 'f')` for Decimals, `.isoformat()` for date/datetime, `.label` for TextChoices). Same-value PATCHes write zero rows. The save and the audit `bulk_create` run inside one `transaction.atomic()` so a save failure rolls back audit rows too. Existing 403/400 forbidden-field path on `partial_update` is preserved.

The `/sheet/` response includes a sparse `last_edits[shipment_id_str][field_key] = {user_id, user_name, old_value, new_value, edited_at}` map — populated by a single window-function query (`Window(RowNumber(), partition_by=[object_id, field_name], order_by=created_at DESC)`, filtered to `rn=1` via `Subquery(values('pk'))` so it stays MSSQL-safe and bounded to the visible shipments). Cells with a matching entry render a small clock-icon marker (`CellLastEditMarker`, harmonised with `CommentMarker`):

- **Hover** → tooltip `"Last edited by {user} on {date} — {old} → {new}"`
- **Click** → Ant `Popover` lazily fetches `GET /api/v1/export/shipments/{id}/field-history/?field=<field_key>&limit=50` (paginated, newest-first) and renders the prior edits. Endpoint requires `can_edit_sheet_field(user, field_key)` — readers without edit access see the latest summary on hover but get 403 + `t('sheet.history_forbidden')` on click (privacy: historical values may include old prices, phones).

Defaults: `?limit` defaults to 50, capped at 200. The popover does no pagination of its own — limit-based truncation only.

**Known limitation:** fields modified by `save()` side effects (computed totals, auto status transitions) are NOT captured by this hook — only fields the user actually submitted in the PATCH body. Status transitions already emit their own `AuditLog` rows from `services_workflow.py`. Other side-effect fields would need their own service-level hooks.

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
| `multiselect` | Ant `Select mode="multiple"` | Junction tables (`firm_splits`, `block_sources`) — posts to `block-sources/` / `firm-splits/` action endpoints. The dropdown has an explicit **Done** button (`dropdownRender` footer) that commits and closes; users no longer have to click another cell to dismiss it (which would open that cell's editor). Click-outside still commits via `onOpenChange`; a guard ref prevents a double save. |
| `status` | Ant `Select` | Options from `ShipmentOptionType` filtered by `category = fieldKey` |
| `readonly` | None | Display-only; never editable |
| `comment_count` | None | Display count + icon; click navigates to ShipmentDetail's Changes tab |

## Right-click context menu

Every non-hidden cell is wrapped in an Ant `Dropdown` (`trigger={['contextMenu']}`) so right-click always opens a Sheet-owned menu instead of the browser's native one. This is the foundation for future cell actions (Copy value, View history, etc.) — currently the only item is **Clear cell**.

The `date` and `datetime` editors deliberately disable Ant's built-in `allowClear` X (operators kept accidentally wiping saved values when missing-click the picker's X), so the right-click → Clear cell path is the supported way to null a filled cell.

**Clear cell** dispatches per field type. All three paths apply an instant cache update first (so the cell repaints empty on the next render) and only then fire the network request:

- `custom_*` rows → optimistic `custom_fields[key] = ''` on the cached row, then `PATCH /shipments/{id}/custom-fields/` with `value=''`. Snapshot rolled back to the previous cache on error.
- `multiselect` junctions (`firm_splits`, `block_sources`) → optimistic `[field] = []` on the cached row, then `POST /shipments/{id}/firm-splits/` or `block-sources/` with the items array empty (server replaces all rows, so empty = delete-all). Snapshot rolled back to the previous cache on error. **No post-success sheet invalidate** — the junction endpoints only return `{status, count}`, so the optimistic update IS the truth; an invalidate here would re-trigger a full-season refetch (~1–2 s, ~1000 rows) and felt like "needs refresh" before this was added.
- FK fields (`country`, `customer`, `city`, `import_firm`, `variety`, `border_point`, `vehicle_responsible`) → wipe cached companion fields (`country_name`, `country_code`, `country_color`, etc.) via `applyOptimistic` *before* `useShipmentPatch` fires, so the cell flips empty on the next render instead of waiting ~200–500 ms for the PATCH response to land via `reconcileFromServer`. The reconcile step still runs and overwrites with the authoritative response.
- Everything else → plain `PATCH /shipments/{id}/` with `{field: null}` via `useShipmentPatch` — the existing optimistic+reconcile path is enough because scalar fields have no companion data.

The menu item is **disabled (greyed out)** rather than the whole menu being suppressed, in these cases — so the menu still mounts and future items can become enabled on a per-case basis:

| Disabled when | Why |
|---|---|
| Cell is empty | nothing to clear |
| Cell is not editable (role/lock) | user can't write the field anyway |
| `cargo_code` | primary identifier — must never be null |
| `has_doc_advance`, `has_sales_report` | computed from related rows, can't be set directly |
| `peregruz`, `is_gapy_satys` | bool-backed 0/1 dropdowns — pick "no" from the dropdown instead |
| Reorder mode is active | edits are blocked while reordering columns |

Hidden cells (`gapy_hidden && is_gapy_satys` — the `—` placeholder rows) are the only ones that skip the Dropdown wrapper entirely; they have no semantic content to act on.

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

## Per-shipment column color

Each shipment column header carries a small swatch button (top-right of the cell) that opens an Ant `ColorPicker`. The picked hex (`#RRGGBB`) is stored on `Shipment.column_color` (nullable `CharField(max_length=7)`); clearing the picker writes `null`. Sheet cells in that column then render with a tinted background (`color-mix(in srgb, var(--col-tint) 60%, var(--surface))`), and the header gets a 3px top border in the raw color so the flag is visible from the column-header row alone. For gapy-satys shipments the tint is mixed 75/25 over the gapy pink with `!important` so the operator's pick wins (white reads as white instead of disappearing into pink).

Permission: **open to every authenticated Sheet viewer.** The dot renders for any logged-in user (`canPaint = !!user`), and writes go through a dedicated `POST /api/v1/export/shipments/{id}/set-column-color/` endpoint listed in `ShipmentViewSet._OPEN_ACTIONS`. The viewset's `get_permissions()` override swaps `DynamicResourcePermission` for `IsAuthenticated` on that action, so roles without `shipment.can_edit` (e.g. `accountant`, `weight_master`, `boss`) still pass — column_color is a UI decoration, not domain data. (The field is also bypassed in `ShipmentPatchSerializer.validate()` as a defense for any code path that still PATCHes it via the shared shipment endpoint, e.g. `useShipmentPatchMulti` in the Edit Drawer.)

The picker has `disabledAlpha` to suppress the opacity slider, and the frontend defensively truncates the hex to 7 chars before saving so an older Ant build emitting `#RRGGBBAA` still fits the `max_length=7` column. Save flow uses the new `useSetColumnColor` hook (reuses `useShipmentPatch`'s exported `applyOptimistic` / `reconcileFromServer` / `rollback` for instant paint + rollback-on-error). Every value-changing write produces one `AuditLog` row (`field_name='column_color'`) via the standard sheet-PATCH diff-audit helper; the field is intentionally **not** in `DEFAULT_SHEET_ROWS`, so no clock-icon marker appears on any cell. The colour ships through `ShipmentSheetSerializer` as the `column_color` field.

## Supply-column tint

Columns created as **supply-only drafts** in the two-column Join flow are visually tinted so Gadam can spot them while assembling a shipment. The tint is driven by `created_by_role ∈ {loading_dept_head, warehouse_chief}` — the sheet endpoint items now carry a `created_by_role: string|null` field for this. A manual `column_color` (above) still **takes precedence** over the tint when set. See [[../processes/draft-shipments#Two-column Join flow (coexisting alternative)]] for the full creation + Join flow.

## Column reorder mode (global order)

Admin / export_manager can set a **global** left-to-right order for the shipment columns that every user then sees.

- **Entry**: the **Reorder columns** toolbar button (visible only when `user.is_superuser || user.role ∈ {admin, export_manager}`) toggles `reorderMode` in `sheetStore` (transient, not persisted; mutually exclusive with `joinMode`). While on, an inline banner explains the mode and offers a **Done** button.
- **Editing is locked**: with `reorderMode` on, `SheetCell` short-circuits click/double-click to edit, and the per-row Up/Down/drag + hide controls in the label column are disabled — the two reorder mechanisms (rows vs columns) never conflict.
- **Frozen columns**: while reordering, the effective `shipmentFreezeCount` is forced to `0` (computed in `SheetGrid`, store value untouched) so every shipment column lives in the single virtualized + sortable track and drags uniformly. The label band (#, Who, Field) keeps its freeze.
- **Drag**: column **headers** become dnd-kit `useSortable` items (`SortableHeaderWrapper`) inside a `DndContext` + `SortableContext` (`horizontalListSortingStrategy`, `autoScroll` enabled so dragging near an edge scrolls the virtualized track and reveals off-screen columns). Only the header is draggable; data cells follow because they map over the same ordered `shipments` array. `SortableContext` holds **all** shipment IDs even though virtualization renders only a subset.
- **Optimistic + save**: on drag end, `arrayMove` produces the new id order → `sheetStore.columnOrder` is set optimistically (ShipmentSheet's `filtered` useMemo reorders by it, tolerant of stale/new IDs) → `useSaveSheetColumnOrder` POSTs the full id list. The page clears `columnOrder` after the next server refetch (guarded by `!reorderMode` so a background refetch can't yank the view mid-drag).

**Persistence**: `Shipment.sheet_position` (`PositiveIntegerField`, null, `db_index`) — sparse step `(idx+1)*1024`. The sheet queryset orders `F('sheet_position').asc(nulls_first=True), '-date', '-id'`: manually-placed shipments appear in saved order; brand-new shipments (NULL position) are the newest by date, so **NULLS FIRST** drops them at the top where `-date` naturally places the newest. No JSONField (MSSQL).

**Endpoint**: `POST /api/v1/export/shipments/sheet-order/` `{ "shipment_ids": [12, 7, 99, ...] }` → `200 { "updated": N }`. Server-side permission: `is_superuser || role ∈ {admin, export_manager}` (intentionally narrower than `PRIVILEGED_ROLES` — excludes `director` — to match the button gate); 403 otherwise. Validates list-of-ints, rejects duplicates; assigns positions via `bulk_update(batch_size=500)`; unknown ids ignored. The global order affects all users, so it is restricted to senior operators.

## Toolbar

- **Reorder columns** — admin / export_manager only; toggles the global column-reorder mode above.
- **Ýük goş** (Add cargo) — **one-click** creation of an **empty** supply-only `draft` column (hook `useCreateEmptyColumn`, `POST {is_draft: true}`); no modal. The backend auto-generates `cargo_code` and defaults `date` to today; no blocks, variety, or destination. Soltanmyrat (`loading_dept_head`) then types the values directly into the Sheet cells and joins the column with Gadam's destination column later. Visible to `loading_dept_head` / `warehouse_chief` / `export_manager` / `director` / superuser. Replaces the former `SupplyDraftModal` (forecast-pool block picker), now removed. See [[../processes/draft-shipments#Two-column Join flow (coexisting alternative)]].
- **New destination shipment** — opens `DestinationDraftModal`; creates a destination-only `draft` column (country + import_firm + customer, optional firm_splits, no blocks). Used by Gadam (`export_manager`).
- **Join** — arms a **column-selection mode** (no modal): Gadam clicks two draft columns directly in the grid (highlighted with a blue ring); the `JoinActionBar` below the toolbar auto-detects the destination (target) vs supply (source), shows a preview, and confirms via Popconfirm. Merges the supply's blocks into the destination draft via `POST /export/shipments/{target_id}/join/` `{source_id}`; the source is hard-deleted on success. `export_manager`/`director` only.
- `+ Add column` — creates a new blank draft shipment (`useSheetCreate`); visible when `canDo('shipment', 'create')`
- Search — filters by `cargo_code` or `customer_name` (client-side)
- Gapy only — filters to `is_gapy_satys = true`
- **⚙ Settings** — opens the `Sheet Display Settings` modal with the freeze pickers (see Freeze panes above)
- **Zoom `−` / `%` / `+`** — scales the whole grid (cells **and** fonts) 60 %–150 % in 10 % steps; click the `%` to reset to 100 %. State lives in `sheetStore` (`sheetZoom`, with `zoomIn`/`zoomOut`/`resetZoom`/`setSheetZoom`) and persists per browser to `localStorage` under `ygt-sheet-zoom`. See [Zoom](#zoom) below.
- **⛶ Fullscreen** (toolbar right) — enters a distraction-free mode: the page pins itself over the entire viewport (`.sheet-page--fullscreen`, `position:fixed; inset:0; z-index:1000`), covering the AppLayout sidebar (z-index 100) and header (z-index 99). The toolbar itself is **unmounted** — only the grid plus a small floating circular **exit** button (top-right) remain. Exit via that button or the **Esc** key. State: `sheetFullscreen` in `sheetStore` (`setSheetFullscreen`/`toggleSheetFullscreen`) — **ephemeral** (not persisted; a per-session view choice), and force-reset on page unmount so navigating away can't leave the flag stuck.
- Deadline timer — global hour deadline indicator

## Backend payload

`ShipmentSheetSerializer` flattens 44+ fields including:
- `firm_splits` and `block_sources` (inline `SheetFirmSplitInlineSerializer` / `SheetBlockSourceInlineSerializer`)
- Quality doc booleans (`doc_azyk`, `doc_suriji`, `doc_hil`, `doc_kalibrowka`) — sourced from `quality.*` (related_name on `QualityDocument` is `quality`)
- `has_sales_report` — annotated by viewset queryset via `Exists(SalesReport.objects.filter(shipment=OuterRef('pk')))`
- `variety_code` from `TomatoVariety.code` (the official 01–10/E1–E3 registry code) — single-sort back-compat field
- `varieties_dominant` — array of `{id, code, name, is_experimental}` (1–4 entries). When a shipment carries more than one sort, the variety cell shows all of them joined (e.g. codes comma-separated). Backed by the existing `Shipment.varieties_dominant` M2M (no new table)
- AD-1 timestamps — read-only display
- AD-2 fields — `vehicle_condition`, `vehicle_condition_note`, `route_note`

Querystring `?season=<id>` overrides the active season; default scopes to `season__is_active=True`.

### `/sheet/` response top-level keys (v2)

```json
{
  "results":          [ /* IShipmentSheetItem[] */ ],
  "comment_counts":   { "<shipment_id>": { "<field_key>": 3, "__shipment__": 1 } },
  "task_counts":      { "<shipment_id>": { "open": 2, "done": 5, "assigned_to_me_open": 1 } },
  "rows":             [ /* SheetRow config from DEFAULT_SHEET_ROWS — i18n keys + inputType + options_source */ ],
  "row_settings":     {
    "<field_key>": {
      "id": 12,
      "labels":            { "tk": "...", "ru": "...", "en": "..." },   /* only non-empty keys present */
      "description":       { "tk": "...", "ru": "...", "en": "..." },
      "style":             { "color": "#fff", "background": "#333" },
      "triggered_roles":   ["warehouse_chief", "document_team"],        /* from SheetRowRoleTrigger child table */
      "triggered_user":    42,                                           /* FK or null */
      "triggered_user_name": "Soltanmyrat",
      "triggered_user_active": true,
      "extra_user_ids":    [5, 8],                                       /* from SheetRowUserPermission (non-deleted) */
      "is_locked":         true,
      "is_visible":        true,
      "can_current_user_edit": false,
      "version":           3,
      "settings_updated_at": "2026-04-30T10:00:00+05:00",
      "settings_updated_by_id": 1
    }
    /* hidden rows (is_visible=False) are excluded entirely */
  },
  "last_edits":       { "<shipment_id>": { "<field_key>": { "user_id": 3, "user_name": "...", "old_value": "...", "new_value": "...", "edited_at": "..." } } },
  "users_index":      { "<user_id>": { "name": "Ahmet", "role": "warehouse_chief" } },
  "current_user_id":  3,
  "current_user_lang": "tk",
  "user_preferences": {
    "row_order":   [12, 5, 8],   // ids where user.position IS NOT NULL, ordered by position ASC
    "hidden_rows": [3, 14]       // ids where user.is_hidden = True
  }
}
```

**`users_index`** is a compact lookup map (`str(user_id) → {name, role}`) emitted once at root to avoid per-row user object repetition. Frontend uses it to resolve `triggered_user` and `extra_user_ids` without additional API calls.

**`current_user_lang`** is the request user's preferred language (defaults to `'tk'`). Frontend uses it to pick the right `labels[lang]` for the "Who" column and cell tooltips.

## Known issues

- All rows from R2 to R44 are now configured (R24 is the new finansist doc-advance flag).
- **`harvest_date`, `additional_notes_arap`, `truck_capacity`, `product_date`, `transit_days_temp`, `truck_plate`, `driver_name`, `driver_phone`** — present in `sheetRowConfig.ts` but not in the `Shipment` model nor `_ALL_PATCHABLE_FIELDS`. They render but cell edits will 403 from the backend. Either map to the right model fields (e.g. `truck_plate` → `truck_head_id` lookup) or remove from the row config.

## Related

- [[../processes/shipment-lifecycle]] — How AD-1 timestamps get written
- [[../processes/permissions-system]] — Dynamic permission registry, `canEditField` / `canDo`
- [[../reference/api-endpoint-map]] — `GET /export/shipments/sheet/` and the inline patch contract
