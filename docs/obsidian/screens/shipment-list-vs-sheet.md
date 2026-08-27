---
title: Shipment List, Detail & Sheet — Comparison
tags: [screen, export, shipment, comparison]
related: [[shipment-sheet]], [[../processes/shipment-lifecycle]], [[../processes/comments-tasks]], [[../reference/api-endpoint-map]], [[../processes/permissions-system]]
---

# Shipment List, Detail & Sheet

The same `Shipment` model is exposed through three different screens, each tuned to a different workflow. This page contrasts them so you can pick the right one (Part A, for users) and so a developer can keep the three views in sync when fields, phases, or permissions change (Part B).

## TL;DR

- **List** = "find a shipment" — paginated table, filters, role-aware "My Work / Archive" toggle.
- **Detail** = "work on one shipment" — hero + guidance line + completeness bar, then an always-open grid of stage cards (nothing collapsed, nothing behind a click), click-to-edit fields, status transitions, activity log on `/shipments/:id/activity`. Process walkthrough: [[../processes/detail-vs-sheet]].
- **Sheet** = "work across many shipments at once" — Excel-style season grid, inline cell edits, per-cell comments and tasks.

| You want to… | Use |
|---|---|
| Find a specific shipment by code, customer, country, date | **List** |
| Move a shipment to the next status, edit grouped fields, read its log | **Detail** |
| Edit the same field across many shipments, or assign a task to a cell | **Sheet** |

## Three views at a glance

| | Shipment List | Shipment Detail | Shipment Sheet |
|---|---|---|---|
| Route | `/export/shipments` | `/export/shipments/:id` | `/export/shipments/sheet` |
| Sidebar item | "Shipments" | (drilled into from List) | "Shipment Sheet" (separate menu entry) |
| Endpoint | `GET /api/v1/export/shipments/` | `GET /api/v1/export/shipments/{id}/` | `GET /api/v1/export/shipments/sheet/` |
| Data scope | Paginated (50/page, max 200) | One record | All shipments for the active season, no pagination |
| Layout | ProTable rows | Hero + completeness bar + always-open stage cards + route rail | Excel-style grid (column = shipment, row = field) |
| Primary action | Drill into Detail; bulk transition | Status transition; click a row to edit it in place | Inline cell edit; comment / assign task |

---

## Part A — For Users

### A1. Shipment List (`/export/shipments`)

**Use it for:** browsing and finding shipments.

**What you see:** rows of shipments showing shipment code, date, status tag, country, customer, weights, departure / arrival timestamps, and a freshness clock.

**Filters and toggles:**
- **All / My Work / Archive** view toggle (Archive is restricted to admin / director / export manager / finansist / boss).
- Search by shipment code or customer.
- Phase dropdown (one of the seven status phases).
- Country, customer, export firm, date range.
- "Pending my fields" — only show shipments where I still owe data.

**What you can do:**
- Click a row → opens [[#A2 Shipment Detail `/export/shipments/:id`|Detail]].
- Edit `weight_net` directly in the cell (only when your role allows).
- Select multiple rows → run a bulk status transition.
- **Column settings** (gear icon, top-right of the table) → ProTable's built-in `ColumnSetting` panel. Check/uncheck to show or hide any column, drag to reorder, and pin left/right. The List now offers **near-parity with the Sheet's rows** — almost every scalar shipment field is available as an opt-in column (all AD-1 + operator timestamps, weight detail, transport, doc checkboxes, per-role notes, vehicle condition, audit, etc.). Only nested `firm_splits` / `block_sources` are excluded (Sheet-only). Seven columns ship visible by default (shipment code, customer, country, status, net weight, departed, arrived); everything else ships hidden and is opt-in via `HIDDEN_BY_DEFAULT` → `DEFAULT_COLUMN_STATE`. Layout (visibility + order + pin) is remembered per browser via `columnsState` (localStorage key `ygt.shipmentList.columnsState.v2` — the version suffix is bumped whenever the default column set changes, since ProTable merges stored state over `DEFAULT_COLUMN_STATE` rather than letting defaults win). The actions column is `hideInSetting` so it can't be hidden or moved. Backing this, `ShipmentListSerializer` returns all those scalar fields (see [api-contract.md](../../../.claude/rules/api-contract.md)).
- The Archive view is **read-only**; no inline edits, no row selection, no bulk actions.

### A2. Shipment Detail (`/export/shipments/:id`)

**Use it for:** working on one shipment — moving its status, filling in your phase's fields, reading its history.

**Layout — no tabs, nothing collapsed.** The page is one scroll: hero → guidance line → completeness bar → a 2-column grid of **always-open stage cards** (Destination, Documents, Loading, Transit, Notes, …) with the route timeline rail as a third column → a full-width Sale section → the customs-expenses card → a link to the activity log. Every field group is visible at once — an operator reconciling weights against firm splits against timestamps no longer has to hold a collapsed section's contents in memory while looking at another one.

- **Completeness bar** — "X of Y fields filled", amber chips for fields the shipment's current lifecycle step expects but that are still empty (click a chip to scroll to the field and open it for editing), and a checklist of manual tasks (TaskRules with no target field, so they can't be measured as "filled"). Renders nothing when nothing is outstanding. The underlying `completeness` data is computed live on the detail endpoint from `TaskRule.target_fields` — it is not a stored field or a new rule table.
- **Route timeline rail** — same design as before, now also rendered on mobile (previously it disappeared below the `md` breakpoint).
- **Stage cards** — each row shows its value as plain text; clicking turns it into an editor, and Tab moves to the next row and opens that one too. Saves autosave with a persistent "Saved" confirmation (not a transient spinner) and a visible error + Retry state if the save fails.
- **Export firm(s)** — the Destination card's export-firm row is an **editable multi-select** (`ShipmentFirmSelector`), no longer read-only. `firm_splits` is a junction table, so it writes through its own `POST /export/shipments/:id/firm-splits/` (the same endpoint the Sheet firm cell uses) rather than the generic field PATCH — pick firms only, the backend derives each firm's official weight and 400s a no-quota firm (flagged ⚠ in the dropdown). A step toward Detail/Sheet parity: firm splits are now editable on Detail, not Sheet-only.
- **Header actions** — a status-transition button that only offers transitions allowed for your role and the current status, plus a **Discussion** button (badge = comment count) opening the whole-shipment thread.

**Comments are on the page, at two scopes**: the hero's **Discussion** button for the whole shipment, and a 💬 icon on each field row for that field's thread. Both reuse the Sheet's `CommentsDrawer` (now in `frontend/src/components/comments/`) — per-field comment counts are derived client-side from the already-loaded comments, no per-field API calls. For editing the same field across many shipments, or assigning a task to a specific cell, still use the [[#A3 Shipment Sheet `/export/shipments/sheet`|Sheet]].

### A3. Shipment Sheet (`/export/shipments/sheet`)

**Use it for:** seeing or editing the same field across many shipments, and for flagging specific cells to colleagues via comments and tasks.

**Layout** — one column per shipment, one row per operational field, mirroring the original "Eksport Hasabat" Excel tab. Frozen rows and columns are configurable; a `Gapy` toggle filters to gapy-satys shipments only.

**What you can do:**
- Click any cell → edit inline (subject to your role's editable fields).
- Click a comment-count badge on a cell → opens the Comments Drawer scoped to that cell (`shipment_id` + `field_key`). Leave a comment, mention `@user` / `@role`, or convert it into a task with an assignee.
- Open task counts from the toolbar to see open tasks assigned to you.
- A notification (mention, task assigned, task done) deep-links straight to the cell that triggered it via `?shipment=&row=&comment=`.

The Sheet has its own dedicated page in this knowledge base: [[shipment-sheet]] — see it for freeze panes, per-user row order, and grid internals.

### A4. When to use which (decision guide)

- "I need to find one specific shipment." → **List**
- "I need to do something to one specific shipment" — transition status, fill weights, add a quality doc, read its status log or comments → **Detail**
- "I need to see or edit the same field across many shipments" or "I want to assign a task on a specific cell" → **Sheet**

---

## Part B — For Developers

### B1. Endpoints and response shapes

| Verb | Path | Pagination | Response shape |
|---|---|---|---|
| `GET` | `/api/v1/export/shipments/` | `PageNumberPagination` (50 / 100 / 200) | `{count, next, previous, results: IShipmentListItem[]}` |
| `GET` | `/api/v1/export/shipments/{id}/` | n/a | `IShipmentDetail` (flat list fields + `firm_splits[]`, `block_sources[]`, `status_log[]`, `quality`, `comments[]`, `editable_fields`, `completeness`, …) |
| `GET` | `/api/v1/export/shipments/sheet/` | none — flat per season | `{results: IShipmentSheetItem[], comment_counts, task_counts, rows, user_preferences}` |
| `PATCH` | `/api/v1/export/shipments/{id}/` | n/a | Same endpoint serves inline cell edits from List, click-to-edit row saves from Detail, and cell edits from Sheet. |
| `POST` | `/api/v1/export/shipments/{id}/transition/` | n/a | Returns updated detail (per [api-contract.md](../../../.claude/rules/api-contract.md)). |

The canonical response field naming is owned by [api-contract.md](../../../.claude/rules/api-contract.md) — do not duplicate it here.

### B2. Field coverage matrix (grouped summary)

A representative sample, not exhaustive. Source-of-truth: [serializers.py](../../../backend/apps/export/serializers.py) (`ShipmentListSerializer` ~line 60, `ShipmentSheetSerializer` ~line 225) and `IShipmentDetail` in [types/index.ts](../../../frontend/src/types/index.ts).

> **Note (column-manager update):** the "List" column in the matrix below shows the *default-visible* set. `ShipmentListSerializer` now also returns every **scalar** field marked ✓ for Sheet (timestamps, weight detail, transport, doc flags, notes, vehicle condition, audit) so they can be turned on as opt-in List columns. Treat any scalar Sheet ✓ as "List: opt-in column". Only nested `firm_splits` / `block_sources` stay Sheet/Detail-only — with one exception: export firms are exposed on the List as a flattened scalar `export_firms_display` (comma-joined firm **short names** — `ExportFirm.name_short`, falling back to `code` when blank — e.g. `"YGT, HJ"`, opt-in column), backed by `prefetch_related('firm_splits__export_firm')`. Documents keep using `ExportFirm.code`; the Sheet firm-chip (`firm_splits[].firm_code`) likewise shows `name_short`.

| Group | Field | List | Detail | Sheet |
|---|---|---|---|---|
| Identifiers | `id`, `shipment_code`, `date`, `export_code` | ✓ | ✓ | ✓ |
| Status | `status`, `status_display`, `status_step` | ✓ | ✓ | ✓ |
| Status | `status_code` | — | — | ✓ |
| Status | `allowed_transitions[]` | — | ✓ | — |
| FK refs | `country_name`, `customer_name`, `border_point_name` | ✓ | ✓ | ✓ |
| FK refs | `country` / `customer` / `city` IDs (for form dropdowns) | — | ✓ | ✓ |
| Weights | `weight_net`, `weight_gross` | ✓ | ✓ | ✓ |
| Weights | `box_count`, `pallet_count`, `packaging_kg`, `rejected_weight_kg` | — | ✓ | ✓ |

> **Note:** `rejected_weight_kg` is a legacy column name — it actually holds the (unofficial) tonnage that **must be loaded** and is displayed as **"Weight to load" / "Ýüklemeli tonna"** everywhere (Sheet row 36, List column, Detail field row). There is no "rejected weight" concept on the shipment. (The separate sales-report `weight_rejected_kg`, db_column `waste_kg`, is unrelated — it is waste recorded during the sale.)
| Timestamps | `departed_at`, `arrived_at` | ✓ | ✓ | ✓ |
| Timestamps | `loading_started_at`, `customs_entry_at`, `customs_exit_at`, `border_crossed_at`, `sale_started_at`, `sale_ended_at` | — | ✓ | ✓ |
| Quality | `quality` (nested object) | — | ✓ | — |
| Quality | `doc_azyk`, `doc_suriji`, `doc_hil`, `doc_kalibrowka` (flat) | — | — | ✓ |
| Finance | `firm_splits[]`, `block_sources[]` | — | ✓ (full) | ✓ (inline minimal) |
| Finance | `price_per_kg`, `total_amount_usd` | ✓ | ✓ | ✓ |
| Finance | `sales_report` object | — | ✓ (≥ hasabat) | — |
| Finance | `has_sales_report`, `has_doc_advance` (flags) | — | — | ✓ |
| Vehicle (AD-2) | `vehicle_condition`, `vehicle_condition_note`, `route_note` | — | ✓ | ✓ |
| Comments | whole-shipment thread + per-field thread | — | ✓ | — |
| Comments / tasks | per-cell `comment_counts`, `task_counts` | — | — | ✓ |
| Notes (per-role freeform) | `export_manager_note`, `warehouse_note`, `document_note` | — | ✓ | ✓ |
| Sheet-only | `variety_code`, `custom_fields` (Phase 5c admin rows) | — | — | ✓ |
| Permissions | `editable_fields[]` (per role) | — | ✓ | implicit (Sheet uses same source) |
| Freshness | `harvest_age_days`, `freshness` | ✓ | — | — |

Sheet-only flat fields exist because the grid renders one cell per (shipment, field) pair and cannot afford nested traversal at render time — quality doc flags and counts are denormalised on the wire.

### B3. Backend

- **ViewSet:** `ShipmentViewSet` in [backend/apps/export/views.py](../../../backend/apps/export/views.py) (~line 79). `list()` and `retrieve()` are inherited; `sheet()` is a custom `@action`.
- **Serializers** in [backend/apps/export/serializers.py](../../../backend/apps/export/serializers.py):
  - `ShipmentListSerializer` (~line 60) — lightweight list shape.
  - `ShipmentDetailSerializer` — extends list with FK ids, nested `firm_splits[]`, `block_sources[]`, `status_log[]`, `quality`, `comments[]`, `editable_fields`, `allowed_transitions`, `completeness` (required/missing fields for the current lifecycle step, derived live from `TaskRule.target_fields`).
  - `ShipmentSheetSerializer` (~line 178) — flat 44+ fields, plus inline `SheetFirmSplitInlineSerializer` / `SheetBlockSourceInlineSerializer` and viewset-annotated booleans / counts.
- **Sheet action** annotates `has_sales_report`, `has_doc_advance` via `Exists()` subqueries before serialising — single-pass, N+1 safe.
- **Pagination:** `PageNumberPagination` (default 50, max 200) on the list endpoint. Sheet returns the whole season — no pagination.
- **Filters:**
  - List honours `?my_work=true` (filters by the role's active phase window), `?view=archive` (gated to `_ARCHIVE_VIEW_ROLES`), plus phase / country / customer / date range.
  - Sheet ignores phase windows — it always returns the operational shipments for the active season regardless of role.
- **Permissions:** the same `editable_fields` per (role × status) drives which Detail rows are click-to-edit (a role without edit rights sees plain text and clicking does nothing), the List inline `weight_net` cell, and the Sheet cell editor. Change role permissions in one place — see [[../processes/permissions-system]].

### B4. Frontend

| Concern | List | Detail | Sheet |
|---|---|---|---|
| Page | [ShipmentList.tsx](../../../frontend/src/pages/export/ShipmentList.tsx) | [ShipmentDetail.tsx](../../../frontend/src/pages/export/ShipmentDetail.tsx) | [ShipmentSheet.tsx](../../../frontend/src/pages/export/ShipmentSheet.tsx) + `SheetGrid` |
| Hook | [`useShipments.ts`](../../../frontend/src/hooks/useShipments.ts) | [`useShipmentDetail.ts`](../../../frontend/src/hooks/useShipmentDetail.ts) | [`useShipmentSheet.ts`](../../../frontend/src/hooks/useShipmentSheet.ts) |
| Type | `IShipmentListItem` ([types/index.ts](../../../frontend/src/types/index.ts)) | `IShipmentDetail` (same file) | `IShipmentSheetItem` (same file) |
| Edit UI | `ListEditableCell` for `weight_net`; bulk transition modal | Click-to-edit `DetailFieldRow` (value → editor on click, Tab to next field); transition modal | Inline cell editor; debounced PATCH |
| Comments UI | — | Hero **Discussion** button (whole-shipment) + per-field 💬 icon on each row | `CommentsDrawer` opened per cell, scoped to `(shipment_id, field_key)` |

Detail reuses the Sheet's `CommentsDrawer` (moved to [`components/comments/`](../../../frontend/src/components/comments/)) for both scopes — whole-shipment (no `field_key`) and per-field. Detail has no tabs and no `ShipmentEditDrawer` anymore; the page is one scroll of always-open stage cards — see [[#A2 Shipment Detail `/export/shipments/:id`|Part A]] above for the layout.

### B5. Routing and deep-links

| View | Query / path params |
|---|---|
| List | `?view=all\|my_work\|archive`, `?page=`, `?page_size=`, `?search=`, `?phase=`, `?country=`, `?customer=`, `?export_firm=`, `?date_after=`, `?date_before=`, `?pending_my_fields=true` |
| Detail | no query params — one scroll, no deep-linkable sections |
| Sheet | `?shipment={id}&row={field_key}&comment={comment_id}` — the format used by `Notification.link` for `mention`, `task_assigned`, `task_done` notifications. The Sheet parses these on mount and auto-opens the Comments Drawer on the right cell. |

### B6. Performance and data-load contrast

| | List | Detail | Sheet |
|---|---|---|---|
| Rows per request | 50 (default) | 1 | Whole season (~100–500) |
| Server queries | List serializer + `select_related` on FKs | Detail serializer + `prefetch_related` for splits / sources / log / comments | Sheet action: 6× `select_related` + 2× `prefetch_related` + grouped queries for `comment_counts`, `task_counts`, user prefs (≈ 9–10 total) |
| TanStack Query `staleTime` | 30 s | 30 s | 30 s |
| Edit cadence | One PATCH per cell (`weight_net`) | One PATCH per field, autosaved on click-away | One PATCH per cell, debounced; row reorder PATCHes user prefs |

### B7. Common drift to watch for

When changing the shipment domain, ask all four questions:

1. **Adding a new shipment field.** Does it belong as a List column? In a Detail stage card? As a Sheet row? Is it in `editable_fields` for any role? If a `TaskRule` targets it, does the Detail completeness bar need to know about it (it does, automatically, via `target_fields` — but confirm the field is reachable from a stage card so a chip's "jump to field" has somewhere to land)?
2. **Adding a phase.** Update `status_step`, `status_display` ordering, the route timeline rail in Detail, and `allowed_transitions`. The Sheet needs no change unless the phase introduces a new operational field.
3. **Changing role permissions.** Verify the `editable_fields` response after the change — it drives all three views' edit eligibility.
4. **Adding a notification kind that points at a shipment.** Use the Sheet `?shipment=&row=&comment=` deep-link if the user should land on a cell; Detail has no equivalent deep-link — it opens the whole page and its Discussion/field threads.

When a Sheet-only flat field (like `doc_*`) starts being read elsewhere — promote it to the Detail serializer rather than copying the flattening logic.
