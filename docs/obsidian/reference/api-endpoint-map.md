---
title: API Endpoint Map
tags: [reference, api, backend, frontend]
---

# API Endpoint Map

> Every API endpoint mapped to its backend ViewSet, frontend hook, and page.

> [!info] Six create endpoints accept an `Idempotency-Key` header
> `POST /export/shipments/`, `POST /export/shipments/{id}/comment/`, `POST /export/comments/`,
> `POST /export/advances/`, `POST /export/customs-expenses/` and `POST /contracts/contracts/`
> are retry-safe: send the header and a repeat replays the original response instead of creating a
> duplicate. The header is **optional** — omitting it leaves behaviour unchanged. Full contract,
> outcome table and the per-mutation frontend rule: [[api-idempotency]].

## Auth Endpoints

| Method | Endpoint | ViewSet | Hook | Page |
|--------|----------|---------|------|------|
| POST | `/api/v1/auth/login/` | AuthView | `useAuth().login` | LoginPage |
| POST | `/api/v1/auth/logout/` | AuthView | `useAuth().logout` | - |
| GET | `/api/v1/auth/me/` | AuthView | `useAuth()` | - (loaded on app init) |

`/auth/me/` also returns `active_season: {id,name,status}|null` and `can_view_closed_seasons: boolean` (AD-16) — the two facts that seed the frontend season store (`useSeasonStore`) on page load, added to `core.UserMeSerializer` and inherited by the actually-mounted `export.ExtendedUserMeSerializer` (`config/urls.py` includes `apps.export.urls_auth` before `apps.core.urls.auth`, so the export-side view wins the identical `me/` path).

## Export Endpoints

### Shipments

| Method | Endpoint | ViewSet | Hook | Page |
|--------|----------|---------|------|------|
| GET | `/api/v1/export/shipments/` | ShipmentViewSet (list) | `useShipments` | ShipmentList — accepts `?season=<id>` (AD-16); default = active season; no active season = empty list (D7 fail-closed); a closed season requires `closed_season.can_view` else `403` |
| GET | `/api/v1/export/shipments/{id}/` | ShipmentViewSet (detail) | `useShipmentDetail` | ShipmentDetail |
| POST | `/api/v1/export/shipments/` | ShipmentViewSet (create) | `useShipments` (mutation) | ShipmentCreateModal |
| PATCH | `/api/v1/export/shipments/{id}/` | ShipmentViewSet (partial_update) | `useShipmentPatch` | ShipmentDetail, ShipmentSheet |
| POST | `/api/v1/export/shipments/{id}/transition/` | ShipmentViewSet.transition | `useShipmentDetail` (mutation) | TransitionButton |
| POST | `/api/v1/export/shipments/{id}/assign/` | ShipmentViewSet.assign | `useAssignDraft` | AssignmentBoard |
| POST | `/api/v1/export/shipments/{target_id}/join/` | ShipmentViewSet.join | _(in useDrafts)_ | ShipmentSheet (JoinShipmentsModal) |
| POST | `/api/v1/export/shipments/bulk-delete/` | ShipmentViewSet.bulk_delete | _(inline in page)_ | ShipmentList (admin only) |
| POST | `/api/v1/export/shipments/{id}/hard-delete/` | ShipmentViewSet.hard_delete_draft | `useHardDeleteDraftShipment` | ShipmentDetail (admin only, draft only) |
| POST | `/api/v1/export/shipments/{id}/soft-delete/` | ShipmentViewSet.soft_delete | `useSoftDeleteShipment` | ShipmentList (admin only), ShipmentSheet (any authenticated viewer) |
| POST | `/api/v1/export/shipments/{id}/restore/` | ShipmentViewSet.restore | `useRestoreShipment` | ShipmentList ?show_deleted (admin-only UI toggle; the endpoint itself accepts any authenticated user) |
| POST | `/api/v1/export/shipments/{id}/set-column-color/` | ShipmentViewSet.set_column_color | `useSetColumnColor` | ShipmentSheet (any authenticated viewer) |
| GET | `/api/v1/export/shipments/overdue/` | ShipmentViewSet.overdue | `useOverdueShipments` | OverdueReports |
| GET | `/api/v1/export/shipments/sheet/` | ShipmentViewSet.sheet | `useShipmentSheet` | ShipmentSheet |
| PATCH | `/api/v1/export/shipments/{id}/quality/` | ShipmentViewSet.set_quality | `useShipmentDetail` (mutation) | ShipmentDetail (Document tab) |
| POST | `/api/v1/export/shipments/{id}/comment/` | ShipmentViewSet.comment | `useShipmentDetail` (mutation) | CommentComposer |
| POST/PATCH | `/api/v1/export/shipments/{id}/sales-report/` | ShipmentViewSet.set_sales_report | `useSaveSalesReport` | ShipmentDetail (Finance tab), SalesReportDrawer |
| GET | `/api/v1/export/shipments/my-sales-reports/?needs_report=` | ShipmentViewSet.my_sales_reports | `useMySalesReports` | SalesRepReports — rep's worklist scoped to his customers (`customer__sales_rep`); mgmt/superuser see all step-4+ |
| GET | `/api/v1/export/sales-rep-coverage/` | SalesRepCoverageViewSet (list) | `useSalesRepCoverage` | SalesRepCoveragePage — reps + their `customer_ids`; gate: superuser/PRIVILEGED_ROLES |
| PUT | `/api/v1/export/sales-rep-coverage/{user_id}/` | SalesRepCoverageViewSet (update) | `useSaveSalesRepCoverage` | SalesRepCoveragePage — replace-all `{customer_ids}` (writes `Customer.sales_rep`); same gate |
| PATCH | `/api/v1/core/customers/{id}/` | CustomerViewSet (update) | `useAdmin` (customer mutation) | CustomersPage — incl. `sales_rep` field (rejects non-sales_rep user) |
| POST | `/api/v1/export/shipments/{id}/block-sources/` | ShipmentViewSet.set_block_sources | `useShipmentDetail` (mutation) | ShipmentDetail |
| POST | `/api/v1/export/shipments/{id}/firm-splits/` | ShipmentViewSet.set_firm_splits | `useShipmentDetail` (mutation) | ShipmentDetail |
| GET | `/api/v1/export/shipments/{id}/tasks/` | ShipmentViewSet.tasks_list | `useShipmentTasks` | ShipmentDetail (Tasks tab) |

**Season scoping (AD-16):** `?season=<id>` works the same way on every list endpoint marked "season-scoped" in this map — shipments, Sheet, Kanban board, harvest plans, day entries, truck allocations/destinations, local-sell plans, contracts, contract-sales, comments, tasks, quota-usage, advances, customs-expenses, document-packets, clients-report. Omitted → the active season. An unknown id → `404`. A closed id without the `closed_season.can_view` resource permission → `403`. No active season at all (the close→open gap) → the list returns empty, not unfiltered (D7 — fail closed). Detail-by-id routes (e.g. `GET /shipments/{id}/`) are NOT season-scoped by design — a direct link always resolves, closed season or not; mutating that row still 409s per the write freeze below. `quota-issuances`, `admin/*` reference-data endpoints, and `sales-rep-coverage` are explicit opt-outs (see AD-16 / design spec §4.5) — passing `?season=` to them is a no-op.

**Write freeze (AD-16):** any mutation against a row anchored to a **closed** season — directly (`Shipment.season`) or by join (e.g. `Comment.shipment.season`) — returns `409 {"error":"season_closed","season":"<name>","closed_at":"<iso>"}` instead of applying. This includes status transitions, the Sheet bulk-edit, the two-row Join, and creates that target a closed season via the request body.

A few models reach their season through neither a `season` FK nor a `shipment` FK and declare a `freeze_season` property instead — `ContractSale` (via `contract`), `FinansistAdvance` (via its shipment junction), and `QuotaUsageRecord` (via `usage_date` when it has no shipment, added 2026-08-08 after all four verbs — `POST`, `PATCH`, `DELETE`, `POST /quota-usage/approve/` — were found to bypass the freeze entirely on the 575 shipment-less rows). Adding a model whose season is not a plain FK? Give it that property, or the freeze is a silent no-op on it.

**Draft create** (`POST /shipments/` with `is_draft=true`) now also accepts optional `varieties`, `import_firm`, `firm_splits[]`, and `skip_forecast_check`. This supports the two-column Join flow's supply-only and destination-only drafts — see [[../processes/draft-shipments#Two-column Join flow (coexisting alternative)]]. `skip_forecast_check=true` (sent by the supply-column modal) skips **both** weight caps for that draft: the forecast-pool remaining check **and** the 18,500 kg one-truck cap — a supply column aggregates a day's harvest and may span more than one truck. The forecast-first one-truck DraftComposer path (no `skip_forecast_check`) keeps both caps.

**Multi-variety on draft create:** `varieties` is a list of **1–4 TomatoVariety IDs** (a shipment can carry multiple tomato sorts). The first ID is the **primary**; the list sets the `varieties_dominant` M2M plus the back-compat `variety` FK, with `variety_confidence='low'` (manually estimated). The single `variety` field still works for back-compat. No new DB table or migration — multi-variety reuses the existing `Shipment.varieties_dominant` M2M.

**Join** (`POST /shipments/{target_id}/join/`) body `{"source_id": <int>}`. `export_manager`/`director` only. Gates: both must be `draft`; target ≠ source; target must have country + customer and **no** blocks; source must have ≥1 block. Effect: source's `block_sources` (and `firm_splits` if target has none) move to the target; `variety` + `export_code` copied if empty; `weight_net` recomputed; one `ShipmentStatusLog` row written on target; the source creator gets a `Notification`; the **source is hard-deleted**. Returns updated target detail (200); errors `{error}` 400/403/404.

**`created_by_role`**: the `/shipments/sheet/` items now include `created_by_role: string|null`, used by the frontend to tint supply-created columns.

**`varieties_dominant`**: the `/shipments/sheet/` items now also include `varieties_dominant` — an array of `{id, code, name, is_experimental}` per shipment (1–4 entries) so the variety cell can render all sorts a shipment carries.

**Bulk hard-delete** (`POST /shipments/bulk-delete/`) body `{"ids": [int, ...]}` — **admin / superuser only** (tighter than `cancel`, which uses PRIVILEGED_ROLES). Capped at 200 IDs per call. Bypasses the operational/archive filter so admins can purge by ID regardless of view. Cascade removes: comments, status_log, firm_splits, block_sources, pallets, quality, sales_report, custom_field_values, advance_links. `QuotaUsageRecord.shipment` is `SET_NULL` — draft quotas are deleted (mirrors `cancel`), approved quotas are orphaned and their IDs returned in `approved_quota_to_reconcile` so the admin can reconcile via QuotaUsageGrid. One `AuditLog` row per shipment with `action='delete'` is written before destruction (AuditLog uses a plain IntegerField for `object_id`, so historical update/transition rows for the deleted shipment also survive). Response: `{deleted, cascade_rows_deleted, draft_quota_deleted, approved_quota_to_reconcile}`.

**Hard-delete draft** (`POST /shipments/{id}/hard-delete/`) — **admin / superuser only**, no body. The single-shipment counterpart to `bulk-delete`, surfaced as a "Delete draft" button on `ShipmentDetailHero` (visible only when `status_code === 'draft'` and the user is admin/superuser). Refuses a non-draft shipment with **400** (`hard_delete_draft` checks `shipment.status.code != 'draft'`) — once a shipment has advanced, use `cancel` or `soft-delete`. Shares the same cleanup as bulk-delete via `ShipmentViewSet._hard_delete_targets(user, targets)`: cascade removes children, deletes draft quota rows, releases approveds (returned in `approved_quota_to_reconcile`), writes one `AuditLog` row with `action='delete'`, busts the FIFO cache. Response: `{deleted, cascade_rows_deleted, draft_quota_deleted, approved_quota_released, approved_quota_to_reconcile}`. The frontend hook `useHardDeleteDraftShipment` calls `removeQueries(['shipment', id])` (not invalidate) so the open detail page doesn't refetch a now-404 row, then the component navigates to `/export/shipments`.

**Soft delete (deactivate)** (`POST /shipments/{id}/soft-delete/`) — **any authenticated user**, no body. Listed in `ShipmentViewSet._OPEN_ACTIONS`; `get_permissions()` swaps `DynamicResourcePermission` for `IsAuthenticated` so roles without `shipment.can_create` (transport, sales_rep, document_team, …) still pass — the page-perm gate on `/export/shipments` is the only access check. Sets `Shipment.deleted_at = now()` + `deleted_by = request.user`; the row stays in the DB but is filtered out of every list / sheet / board / dashboard-active-shipments queryset by default. Idempotent (no-op on already-deleted). Writes one `AuditLog` row with `action='soft_delete'`. Editing a soft-deleted row via `PATCH` returns 403 (mirror of the archived-row guard). Returns the full `ShipmentDetailSerializer` response (so the UI can update in place).

**Restore** (`POST /shipments/{id}/restore/`) — **any authenticated user**, no body. Same `_OPEN_ACTIONS` treatment as soft-delete. Clears `deleted_at` + `deleted_by`. Idempotent. Writes one `AuditLog` row with `action='restore'`. The `?show_deleted=true` list filter is also open to all users (the UI checkbox on `ShipmentList` is still admin-only via `canHardDelete`, but a non-admin who soft-deleted a Sheet column can recover it by hitting `GET /shipments/?show_deleted=true` directly → restore). Detail-style actions (cancel, transition, retrieve, restore) bypass the soft-delete filter so the row is always reachable by ID. The Sheet column header has a small trash icon at the bottom-right of every column header (visible for every authenticated user — was admin-only) that fires soft-delete with a confirmation modal — hidden during reorder mode.

**Set column color** (`POST /shipments/{id}/set-column-color/`) — **any authenticated user**, body `{"color": "#RRGGBB" | null | ""}`. Dedicated endpoint listed in `_OPEN_ACTIONS` so column tint works for every Sheet viewer regardless of their `shipment.can_edit` grant — column_color is a UI decoration, not domain data. Rejects edits to deleted/archived shipments (403). Defensively truncates `color` to 7 chars (`#RRGGBB`); `null` or empty clears the tint. Writes one `AuditLog` row only when the value actually changes (diff-audit, mirrors `partial_update`). Returns the full detail response. Frontend hook: `useSetColumnColor` — reuses `useShipmentPatch`'s exported `applyOptimistic` / `reconcileFromServer` / `rollback` for instant paint + rollback-on-error.

### Pallet Manifest (weightmaster loading detail)

Per-pallet weighing data filled during loading (`Pallet` model: gross, crate_type, crate_count, pallet_weight, additions, `variety`, `sub_block`, `created_by`). Source of truth for `Shipment.weight_net`/`weight_gross`. Screen: `PalletManifest.tsx`.

**Write authority:** all three write actions below are gated by the **`PALLET_WRITE_ROLES`** allowlist (`views.py`) checked inside each method body — `{admin, export_manager, director, warehouse_chief, weight_master, loading_dept_head, loading_dept_head_deputy}` + superuser. `get_permissions()` swaps `DynamicResourcePermission` for `IsAuthenticated` on the **write** paths — `manifest_close`, `import_weightmaster`, and `pallets` **POST only** (GET `/pallets/` keeps its normal `shipment.can_view` gate) — like `set_sales_report`, because POST maps to `shipment.can_create` — **False** for `weight_master` and `warehouse_chief` even though they OWN the manifest, so the DB-perm gate would wrongly block them. The in-body allowlist is the sole authority; it grants no role beyond the list.

- **List / bulk-upsert pallets** (`GET | POST /shipments/{id}/pallets/`) — GET returns pallets; POST body `{"pallets": [...]}` replaces ALL pallets for the shipment (`created_by = request.user`, so "filled by" is tracked). Frontend: `usePallets` / `useUpsertPallets`.
- **Close manifest** (`POST /shipments/{id}/manifest/close/`) — aggregates pallet weights into shipment totals + dominant-variety roll-up, **and writes parent-grain `block_sources`** from pallet net weights (`close_pallet_manifest()`, Step 2). Frontend: `useCloseManifest`.
- **Block breakdown** (`GET /shipments/{id}/block-breakdown/`) — per (top-level block × variety) net-weight breakdown from the pallet manifest, sub-blocks summed into parent (F1+F2→F). Read-only, gated by `shipment.can_view`. Response `{rows: [{block_id, block_code, block_name, variety_id, variety_name, weight_kg}], total_net_kg}`. This is the data the sales report's block section is filled from (Step 3). Service `compute_block_variety_breakdown()`. Frontend: `useBlockBreakdown` + `BlockBreakdownCard` on PalletManifest.

**Block-source grain (Step 2):** `ShipmentBlockSource` is now stored at **parent-block grain** — the weekly plan (`HarvestDayEntry`) is keyed on top-level blocks (`parent__isnull=True`), so a sub-block source silently misses `rollup_actuals_for_date`. The single choke point `services/block_sources.py::write_block_sources()` normalizes each block to its parent and **merges** (F1+F2 → one F row, weights summed) — used by shipment **create**, **set-block-sources** (`POST /shipments/{id}/block-sources/`), and **manifest close**. Backfill command `python manage.py normalize_block_sources [--apply]` (dry-run by default) rewrites legacy sub-block rows (OD/OG → O). The block tree is exactly one level deep, so `parent_id or id` fully normalizes.
- **Import weightmaster Excel** (`POST /shipments/{id}/pallets/import-weightmaster/`) — multipart `file` = the weightmaster `.xlsx`. **Dry-run: parses, does NOT save.** Parser `services/weightmaster_import.py` reads the fixed template (header row 1; data rows 2..N until col A blank), mapping B→gross, C→crate unit weight (resolves `CrateType` by `weight_kg`), D→crate_count, F→pallet_weight, G→additions, I→variety (by `TomatoVariety.name`, case-insensitive), K→sub_block (by `GreenhouseBlock.code`), M→harvest date (`DD,MM,YYYY`). Response `{rows, warnings, summary}`. Unresolved crate/variety/block are returned with a **null id + a warning carrying the raw text** (never silently dropped); the frontend loads rows into the editable grid (`weightmasterRowToEditableRow`, null→0) for the user to fix, then saves via the normal pallets upsert. `summary`: `{load_code, harvest_date, pallet_count, total_gross_kg, total_net_kg, code_mismatch}` — `code_mismatch` warns (does not block) when the file's load code (e.g. `10AP116`) doesn't match `shipment_code`. Frontend hook: `useImportWeightmaster`.

### Tasks (Structured Task Engine)

| Method | Endpoint | ViewSet | Hook | Page |
|--------|----------|---------|------|------|
| GET | `/api/v1/export/tasks/` | TaskViewSet (list) | `useTasks` | TaskInbox |
| GET | `/api/v1/export/tasks/{id}/` | TaskViewSet (retrieve) | `useTaskDetail` | ShipmentDetail (Tasks tab) |
| POST | `/api/v1/export/tasks/{id}/start/` | TaskViewSet.start | `useStartTask` | TaskCard |
| POST | `/api/v1/export/tasks/{id}/block/` | TaskViewSet.block | `useBlockTask` | TaskCard |
| POST | `/api/v1/export/tasks/{id}/unblock/` | TaskViewSet.unblock | `useUnblockTask` | TaskCard |
| POST | `/api/v1/export/tasks/{id}/complete/` | TaskViewSet.complete | `useCompleteTask` | TaskCard |
| POST | `/api/v1/export/tasks/{id}/cancel/` | TaskViewSet.cancel | `useCancelTask` | TaskCard |

**Task list filters:** `?assignee_role=&assignee_user=&state=&shipment=&step=&overdue=true`

**Task list response shape (lightweight):**
```json
{
  "id": 1, "shipment": 42, "shipment_code": "0201045/25",
  "step": "yuklenme", "phase": "LOADING",
  "title_key": "tasks.fill_loading_data",
  "assignee_role": "warehouse_chief", "assignee_user": null, "assignee_user_name": null,
  "target_fields_list": ["shipment_code", "block_sources", "weight_net"],
  "completion_rule": "ALL_FIELDS_FILLED",
  "deadline": "2025-02-01T23:59:00+05:00", "deadline_rule": "23:59_same_day",
  "state": "OPEN", "is_overdue": false,
  "created_at": "2025-02-01T08:00:00+05:00", "started_at": null, "completed_at": null
}
```

**Task detail response** adds: `blocked_reason`, `blocked_by` (list of blocking task IDs), `rule` (TaskRule ID), `duration_seconds`.

**Permissions on state actions:**
- `start`, `block`, `unblock`, `complete` — assignee's role OR supervisor roles (`export_manager`, `boss`, `admin`, `director`)
- `cancel` — admin / director only
- Only `MANUAL_DONE` completion-rule tasks can be completed via `complete/`; all others auto-resolve via `Shipment.save()`

### Quotas

| Method | Endpoint | ViewSet | Hook | Page |
|--------|----------|---------|------|------|
| GET | `/api/v1/export/quota-issuances/` | QuotaIssuanceViewSet (list) | `useQuotaIssuances` | QuotaIssuancesList |
| POST | `/api/v1/export/quota-issuances/` | QuotaIssuanceViewSet (create) | `useQuotaIssuances` (mutation) | AddQuotaIssuance |
| PUT | `/api/v1/export/quota-issuances/{id}/` | QuotaIssuanceViewSet (update) | `useQuotaIssuances` (mutation) | QuotaIssuancesList |
| DELETE | `/api/v1/export/quota-issuances/{id}/` | QuotaIssuanceViewSet (destroy) | `useQuotaIssuances` (mutation) | QuotaIssuancesList |
| PATCH | `/api/v1/export/quota-issuances/{id}/reassign/` | QuotaIssuanceViewSet.reassign | `useQuotaIssuances` (mutation) | QuotaIssuancesList |
| GET | `/api/v1/export/quota-usage/` | QuotaUsageViewSet (list) | `useQuotaUsageRecords` | QuotaUsageTab |
| PUT | `/api/v1/export/quota-usage/{id}/` | QuotaUsageViewSet (update) | `useQuotaUsageRecords` (mutation) | QuotaUsageTab |
| DELETE | `/api/v1/export/quota-usage/{id}/` | QuotaUsageViewSet (destroy) | `useQuotaUsageRecords` (mutation) | QuotaUsageTab |
| POST | `/api/v1/export/quota-usage/approve/` | QuotaUsageViewSet.approve | `useBulkApproveQuotaUsage` | QuotaUsageTab |
| GET | `/api/v1/export/quota-dashboard/` | QuotaDashboardView | `useQuotaDashboard` | QuotaDashboard — `?season=` optional (defaults to active) and resolved through `resolve_season()`: `404` unknown id, `403` closed season without `closed_season.can_view`, empty-but-shaped payload during the close→open gap (D7) |
| GET | `/api/v1/export/quota-firm-balances/` | QuotaFirmBalancesView | `useQuotaFirmBalances` | Sheet `firm_splits` cell + ExportFirmSelect — the firm-split hard block. Returns `{"<firm_id>": {issued_kg, used_kg, remaining_kg, active_issuance_count, nearest_expiry}}` for LIVE (unexpired) allocations of the resolved season. `?season=` resolved through `resolve_season()` (same 404/403/gap rules as the dashboard); `{}` during the close→open gap. 60 s cache, busted by `invalidate_quota_caches()` |
| GET | `/api/v1/export/quota-firm-summary/` | QuotaFirmSummaryView | `useQuotaFirmSummary` | QuotaDashboard → Firm Quota tab — the same live balance as `quota-firm-balances`, as a **list** with firm names: `[{export_firm, export_firm_name, issued_kg, used_kg, remaining_kg, active_issuance_count, nearest_expiry}]` sorted by `remaining_kg` desc. `?season=` resolved through `resolve_season()`; `[]` during the close→open gap (D7). Takes **no** `date_from`/`date_to` by design — quota expires in ~a month, so a period filter would hide live quota. Uncached |

### Dashboard (main landing page)

| Method | Endpoint | ViewSet | Hook | Page |
|--------|----------|---------|------|------|
| GET | `/api/v1/export/dashboard/summary/` | DashboardViewSet.summary | `useDashboardSummary` | DashboardPage |

Permission: `IsAuthenticated` only (no role gate). Cache: 60 s. Returns: season, stats, alerts, routes, active_shipments.
See [[screens/main-dashboard]] for the full response contract.

### Planning & Finance

| Method | Endpoint | ViewSet | Hook | Page |
|--------|----------|---------|------|------|
| GET/POST/PATCH | `/api/v1/export/truck-allocations/` | WeeklyTruckAllocationViewSet | `useTruckAllocations` | TruckForecast |
| GET | `/api/v1/export/truck-destination-selections/` | WeeklyDestinationSelectionViewSet | `useTruckDestinationSelection` | WeeklyPlanGrid |
| POST | `/api/v1/export/truck-destination-selections/set/` | WeeklyDestinationSelectionViewSet | `useSetTruckDestinationSelection` | WeeklyPlanGrid |
| GET/POST/PATCH | `/api/v1/export/prices/` | PriceEntryViewSet | `usePriceEntries` | PricePanel |
| GET/POST/PATCH | `/api/v1/export/local-sell-plans/` | WeeklyLocalSellPlanViewSet | _(in QuotaDashboard)_ | LocalSellPlanGrid — PATCH is the autosave path: it auto-submits a draft/rejected row and answers **409 `plan_approved_locked`** / **409 `cell_locked_after_submit`** on a locked cell (see [[local-sell-plan]]) |
| GET/POST | `/api/v1/export/advances/` | FinansistAdvanceViewSet | `useAdvances` | AdvancesTracker |
| GET | `/api/v1/export/advances/{id}/` | FinansistAdvanceViewSet (detail) | `useAdvanceDetail` | AdvancesTracker |
| PATCH | `/api/v1/export/advances/{id}/reconcile/` | FinansistAdvanceViewSet.reconcile | `useReconcileAdvance` | AdvancesTracker |
| GET/POST | `/api/v1/export/notifications/` | NotificationViewSet | `useNotifications` | AppLayout |
| GET | `/api/v1/export/audit-log/` | AuditLogViewSet | `useAuditLog` | AuditLogPage — filters `?model_name=&action=&object_id=&user=` (user filter via `UserSelect`, backed by mentionable endpoint so director can populate it too) |

### Admin (under /api/v1/export/admin/)

| Method | Endpoint | ViewSet | Hook | Page |
|--------|----------|---------|------|------|
| GET/POST/PATCH/DELETE | `/api/v1/export/admin/seasons/` | SeasonViewSet | `useSeasons` | SeasonsPage — read gated on `season.can_view` (admin/director/export_manager/boss full or read CRUD; `finansist` view-only, so it can populate the header switcher without season write access) |
| GET | `/api/v1/export/admin/seasons/{id}/close-preview/` | SeasonViewSet.close_preview_action | `useSeasonClosePreview` | SeasonCloseModal — counts (`drafts`/`in_transit`/`open_tasks`/`unfinished_plans`/`draft_quota_usage`) for the confirm dialog; gated on `season.can_edit`, not `can_view`. The first four are a fixed contract — add keys, never rename or remove. `draft_quota_usage` (added 2026-08-08) drives a separate warning: unlike the others, those rows are not merely hidden, they can never be approved once the season freezes |
| POST | `/api/v1/export/admin/seasons/{id}/close/` | SeasonViewSet.close | `useCloseSeason` | SeasonsPage — freezes + hides the season (AD-16, D2); `409` if already closed |
| POST | `/api/v1/export/admin/seasons/{id}/open/` | SeasonViewSet.open | `useOpenSeason` | SeasonsPage — makes the season the write target; `409` if the target is closed (reopening is unsupported) |
| GET/POST/PATCH | `/api/v1/export/admin/firms/` | ExportFirmViewSet | `useAdmin` | ExportFirmsPage |
| GET/POST/PATCH | `/api/v1/export/admin/import-firms/` | ImportFirmViewSet | `useAdmin` | ImportFirmsPage |

> Both firm endpoints return `director_signature` / `director_seal` as a
> **root-relative** `/media/...` path (or `null`), never an absolute url — see
> the api-contract skill and `apps/core/serializer_fields.RelativeFileField`.
> Uploads are a multipart `PATCH` with the file under its own field name.
| GET/POST/PATCH | `/api/v1/export/admin/users/` | UserManagementViewSet | `useAdmin` | UsersPage |
| GET/PUT | `/api/v1/export/admin/users/{id}/permissions/` | UserPermissionsView | `useAdmin` | PermissionsPage |
| GET/POST | `/api/v1/export/admin/sheet-rows/` | SheetRowSettingViewSet (list/create) | `useSheetRowSettings` | ShipmentSettings (Sheet Rows tab) |
| GET/PATCH/DELETE | `/api/v1/export/admin/sheet-rows/{id}/` | SheetRowSettingViewSet (detail/update/soft-delete) | `useSheetRowSettings` | ShipmentSettings (Sheet Rows tab) |
| POST | `/api/v1/export/admin/sheet-rows/{id}/restore/` | SheetRowSettingViewSet.restore | `useSheetRowSettings` | ShipmentSettings (Sheet Rows tab) |
| POST | `/api/v1/export/admin/sheet-rows/reorder/` | SheetRowSettingViewSet.reorder | `useSheetRowSettings` | ShipmentSettings (Sheet Rows tab) |
| POST | `/api/v1/export/admin/sheet-rows/{id}/permissions/bulk/` | SheetRowSettingViewSet.permissions_bulk | `useSheetRowSettings` | ShipmentSettings (Sheet Rows tab) |
| GET / PATCH | `/api/v1/export/admin/process-node-links/` (+ `{id}/`) | ProcessNodeLinkViewSet | `useProcessNodeLinks` / `useUpdateProcessNodeLink` | ProcessNodeLinksPage (`/admin/process-links`) — list + edit only (no create/delete), `node_id` read-only, admin-only via inline gate not the resource matrix — see [[../processes/permissions-system#Process node links — inline admin gate, not the resource matrix (2026-08-06)]] |

### Per-user Sheet Preferences (Phase 2a)

| Method | Endpoint | ViewSet | Hook | Page |
|--------|----------|---------|------|------|
| GET | `/api/v1/export/user/sheet-preferences/` | UserSheetPreferencesView | `useSheetPreferences` | ShipmentSheet |
| PATCH | `/api/v1/export/user/sheet-preferences/` | UserSheetPreferencesView | `useSheetPreferences` (mutation) | ShipmentSheet |

Response shape (GET): `{ row_order: [id, ...], hidden_rows: [id, ...], updated_at: "ISO8601|null" }`
PATCH body (partial): `{ row_order?: [id, ...], hidden_rows?: [id, ...] }` — absent key = no-op.

## Greenhouse Endpoints

| Method | Endpoint | ViewSet | Hook | Page |
|--------|----------|---------|------|------|
| GET/POST/PATCH | `/api/v1/greenhouse/harvest-plans/` | WeeklyHarvestPlanViewSet | `useHarvestPlans` | WeeklyPlanGrid |
| POST | `/api/v1/greenhouse/harvest-plans/{id}/submit/` | .submit | `useBulkSubmitHarvestPlans` | WeeklyPlanGrid |
| POST | `/api/v1/greenhouse/harvest-plans/{id}/approve/` | .approve | `useBulkApproveHarvestPlans` | WeeklyPlanGrid |
| POST | `/api/v1/greenhouse/harvest-plans/{id}/reject/` | .reject | `useBulkRejectHarvestPlans` | WeeklyPlanGrid |
| POST | `/api/v1/greenhouse/harvest-plans/bulk-submit/` | .bulk_submit | `useBulkSubmitHarvestPlans` | WeeklyPlanGrid |
| POST | `/api/v1/greenhouse/harvest-plans/bulk-approve/` | .bulk_approve | `useBulkApproveHarvestPlans` | WeeklyPlanGrid |
| POST | `/api/v1/greenhouse/harvest-plans/bulk-reject/` | .bulk_reject | `useBulkRejectHarvestPlans` | WeeklyPlanGrid |
| POST | `/api/v1/greenhouse/harvest-plans/initialize-week/` | .initialize_week | _(in usePlanning)_ | WeeklyPlanGrid |
| GET | `/api/v1/greenhouse/harvest-plans/block-summary/` | .block_summary | _(in usePlanning)_ | BlockSummary |
| POST | `/api/v1/greenhouse/harvest-plans/{id}/grant-late-edit/` | .grant_late_edit | _(admin only)_ | AdminPlanOverride |
| POST | `/api/v1/greenhouse/harvest-plans/{id}/revoke-late-edit/` | .revoke_late_edit | _(admin only)_ | AdminPlanOverride |
| GET/POST | `/api/v1/greenhouse/daily-plan/` | DailyHarvestBoardViewSet | `useDailyBoard` / `useUpsertDailyBoard` | DailyHarvestBoard |
| GET/POST/PATCH | `/api/v1/greenhouse/domestic-sales/` | DomesticSaleViewSet | `useDomesticSales` | DomesticSales |
| GET/POST/PATCH | `/api/v1/greenhouse/admin/blocks/` | GreenhouseBlockAdminViewSet | `useAdmin` | BlocksPage |
| GET/POST/PATCH | `/api/v1/greenhouse/admin/block-assignments/` | BlockManagerAssignmentViewSet | `useAdmin` | BlockDetailPage |

## Me Endpoints (current-user scoped)

| Method | Endpoint | View | Hook | Page |
|--------|----------|------|------|------|
| GET | `/api/v1/me/tasks/` | `MeTaskListView` | `useMyTasks` | TaskInbox, AppLayout badge |
| GET | `/api/v1/me/kpi-today/` | `MeKpiTodayView` | `useMyKpiToday` | KPI widget / Dashboard |

**`/me/tasks/` filters:** `?state=open&step=yuklenme&overdue=true`. Supervisors (`export_manager`, `boss`, `admin`, `director`) see all tasks; other roles see only tasks for their own `assignee_role`. Paginated (`page_size=50`).

**`/me/tasks/` is season-scoped** (`?season=<id>`, spec §4.8) with the same anchor as `TaskViewSet` — `shipment__season` plus `include_null_link`, so weekly-plan/local-sell-plan tasks (no shipment) stay visible under an open season and drop out when a closed season is explicitly selected. Fails closed during the close→open gap. `/me/kpi-today/` is deliberately **not** scoped — see the note in the `api-contract` skill.

**`/me/kpi-today/` response:**
```json
{ "done_count": 3, "avg_duration_seconds": 1800, "on_time_rate": 0.6667 }
```
`on_time_rate` is `null` when no completed tasks had a deadline today. Cached 60 s per user (`me:kpi-today:{user_id}`).

## KPI Endpoints (Stream E)

All under `/api/v1/export/kpi/`. Require `IsAuthenticated`, no role restriction.

| Method | Endpoint | View | Description |
|--------|----------|------|-------------|
| GET | `/api/v1/export/kpi/dashboard/` | KpiViewSet.dashboard | Full 7-KPI grid. 60s cache. |
| GET | `/api/v1/export/kpi/by-role/?role=X` | KpiViewSet.by_role | Role-scoped on_time_rate + avg_task_duration. Required `role` param. 60s cache per role. |
| GET | `/api/v1/export/kpi/by-phase/` | KpiViewSet.by_phase | Average phase durations (seconds per phase). 5min cache. |
| GET | `/api/v1/export/kpi/by-shipment/{id}/` | KpiViewSet.by_shipment | Per-shipment phase context: in_phase_seconds, phase_avg_seconds, status_changed_at. 60s cache per shipment. |

**Dashboard response shape:**
```json
{
  "throughput": { "closed_count": 3, "created_count": 8, "window_days": 7 },
  "cycle_time": { "avg_seconds": 345600, "count": 3, "window_days": 30 },
  "avg_phase_time": { "PREP": 7200, "LOAD": 14400, "TRANSIT": 259200 },
  "on_time_rate": 0.75,
  "avg_task_duration": 5400,
  "stuck_shipments": 2,
  "blocked_age": { "count": 1, "avg_seconds": 43200, "max_seconds": 43200, "p95_seconds": 43200 }
}
```

**Boss Dashboard integration:** `GET /api/v1/export/boss/task_throughput/?window_days=7` returns `{closed_count, created_count, on_time_rate, window_days}`.

## Team KPI Leaderboard

| Method | Endpoint | View | Hook | Page |
|--------|----------|------|------|------|
| GET | `/api/v1/core/team-kpi/?period=today\|week\|month\|season` | `TeamKpiView` | `useTeamKpi` | TeamKpi (`/team/kpi`) |

`IsAuthenticated` only, no role gate (visible in the sidebar to every role). 60s cache
keyed by period (`team-kpi:{period}`). One row per active user:
`{user_id, user_name, role, completed, on_time_rate, overdue_now, active_seconds, trend}`.
`completed`/`on_time_rate`/`active_seconds` are windowed by `period` and attributed by
`Task.completed_by`; `overdue_now` is current-state and **window-independent**, attributed
by `assignee_role` instead. `trend` is a 14-int daily completed-task series (oldest→newest,
Asia/Ashgabat days) attributed the same way as `completed`, but on a **FIXED 14-day window
independent of `period`**. `period=season` **fails closed** (D7 / AD-16): during the
close→open gap, with no active season and no `?season=`, it returns `results: []` rather
than falling through to an unbounded all-time window; the other three periods never consult
a season. Service: `apps/core/services_team_kpi.py`. Page rebuilt as cards +
a ranking bar chart + per-card trend sparklines (was a plain table) — see
`screens/team-kpi.md`. Full response shape and caveats: `.claude/rules/api-contract.md`
("Team KPI leaderboard").

**`Shipment.status_changed_at`:** New indexed DateTimeField set by `transition_to()` on every status change and by `create_shipment()` on creation. Backfilled from `ShipmentStatusLog` by migration 0011. Used by KPI helpers and replaces `Max(status_log__changed_at)` annotation in the board view's sort key.

## Transport Endpoints

| Method | Endpoint | ViewSet | Hook | Page |
|--------|----------|---------|------|------|
| GET | `/api/v1/transport/live-positions/` | LivePositionViewSet (list) — **`IsAuthenticated` + `CanViewFleetMap`** | `useLivePositions` | FleetMap (`/transport/map`) |
| GET | `/api/v1/transport/shipments/{id}/position/` | ShipmentTruckPositionView | `useShipmentTruckPosition` | ShipmentDetail (`ShipmentTruckLocationCard`) |
| PUT/DELETE | `/api/v1/transport/shipments/{id}/device/` | ShipmentDeviceLinkView | `useSetShipmentDevice` | ShipmentDetail (`ShipmentTruckLocationCard`) |
| GET | `/api/v1/transport/devices/` | TransportDeviceViewSet (list) | `useTransportDevices` | ShipmentDetail (`ShipmentTruckLocationCard`, device picker) |
| GET/POST/PATCH | `/api/v1/transport/truck-heads/` `/truck-heads/{id}/` | TruckHeadViewSet | `useTruckHeads`/`useCreateTruckHead` (`useFleet`); `useAdminTruckHeads`/`useAdminCreateTruckHead`/`useUpdateTruckHead` (`useFleetAdmin`) | `ShipmentTruckSelector` (ShipmentDetail + edit drawer), FleetAdminPage (`/admin/fleet`) |
| GET/POST/PATCH | `/api/v1/transport/trailers/` `/trailers/{id}/` | TrailerViewSet | `useTrailers`/`useCreateTrailer` (`useFleet`); `useAdminTrailers`/`useAdminCreateTrailer`/`useUpdateTrailer` (`useFleetAdmin`) | `ShipmentTruckSelector` (ShipmentDetail + edit drawer), FleetAdminPage (`/admin/fleet`) |
| GET/POST/PATCH | `/api/v1/transport/drivers/` `/drivers/{id}/` | DriverViewSet | `useDrivers`/`useCreateDriver` (`useFleet`, active-only picker feed); `useAdminDrivers`/`useAdminCreateDriver`/`useUpdateDriver` (`useFleetAdmin`, incl. inactive) | `SheetDriverSelectEditor` (Sheet R27), FleetAdminPage Drivers tab (`/admin/fleet`) |

`live-positions/` is the one gated endpoint in this module: `IsAuthenticated` +
`CanViewFleetMap` (`apps/transport/permissions.py`), a **deny-list** — every
authenticated role passes except `FLEET_MAP_DENIED_ROLES`, currently `{'seller'}`
(owner request, 2026-08-23), with a superuser bypass. It is **not** page-permission
backed: no `transport.map` page_code is registered, so nothing here reads the matrix
(see [[fleet-map]] "Out of Scope" for why). Every other row in this table is still
`IsAuthenticated` only, apart from the fleet-CRUD writes, which use `CanEditShipment` —
a hardcoded `SHIPMENT_EDITOR_ROLES` allow-list in the same file. No pagination — a bare list,
bounded to one row per device. Reads only `DevicePosition.objects.filter(valid=True)` from
our own DB (`select_related('device', 'device__truck')`); never calls Traccar in the
request path. One row per device:
`{device_id, plate, fleet_no, status, lat, lon, speed, course, address, fix_time, is_online, is_stale}`
— `plate`/`fleet_no` are `null` when the device isn't matched to a `Truck`; `is_online`
mirrors Traccar's own `device.status`; `is_stale` is `now - fix_time > TRACCAR_STALE_MINUTES`
(setting, default 15 min). Positions are kept fresh by Celery beat polling every 120s
(`apps.transport.tasks.poll_traccar`), not by this endpoint. Full model/service/page detail:
`processes/fleet-map.md`.

**Shipment position** (`GET shipments/{id}/position/`) — resolves the shipment's truck via
`resolve_device_for_shipment` (manual override > auto plate-match > none) and returns
`{resolved_by: "manual"|"auto"|"none", device: {traccar_id, plate, fleet_no}|null, position:
{...}|null}`. `position`, when present, is the same row shape as `live-positions/` above
(filtered `valid=True`). `resolved_by` can be `"auto"`/`"manual"` with `position: null` — the
device resolved but has no stored fix yet.

**Shipment device override** (`PUT|DELETE shipments/{id}/device/`) — sets or clears a manual
`ShipmentDeviceLink`. `PUT` body `{"traccar_id": <int>}`; `DELETE` reverts to auto-match, no
body. Gated to `SHIPMENT_EDITOR_ROLES` (`admin`/`export_manager`/`director`/`warehouse_chief`/
`loading_dept_head`/`loading_dept_head_deputy`) or superuser — `apps/transport/permissions.py`
`CanEditShipment`, the same editor set as `ShipmentDetail`'s variety-override.

**Devices list** (`GET devices/`) — every registry `TraccarDevice` (not filtered to
positioned ones), for the override picker: `{traccar_id, plate, fleet_no, name}`.

**Truck heads** (`GET/POST/PATCH truck-heads/`) — `TruckHead` (fleet tractors, seeded once
from TIR then platform-owned). `GET` (any authenticated user) lists **active-only**
(`is_active=True`), `SearchFilter` on `plate_number`/`owner_name`, no pagination:
`{id, plate_number, owner_type, owner_name, status, capacity, is_active, has_gps}` —
`has_gps` is `traccar_device_id is not None`. `POST`/`PATCH` gated to `CanEditShipment`
(same `SHIPMENT_EDITOR_ROLES` as the device override above). `POST` auto-matches a
`TraccarDevice` by normalized plate via `device_for_plate()` (`apps/transport/services/
matching.py`) — same resolution `_pick_device()` uses (positioned > category=truck > first).
`PATCH /truck-heads/{id}/` sees **all** rows including inactive ones (only `list` filters to
active), so `{"is_active": false}` deactivates and `{"is_active": true}` re-activates. No
`RetrieveModelMixin` registered — `GET /truck-heads/{id}/` is 405, not 404.
`PATCH` re-runs `device_for_plate()` **only when `plate_number` actually changes** (a
PATCH that omits the plate, or resends the unchanged plate, leaves `traccar_device` alone —
this guards against silently wiping a working GPS link when another field is edited). A plate
correction re-matches (or clears) `traccar_device` instead of leaving it stale.
`?include_inactive=true` on the list makes `GET` return inactive rows too — used by the admin
page (`useAdminTruckHeads`); the shipment-truck picker (`useTruckHeads`) omits it and so sees
active rows only. Consumed by the [[../screens/fleet-admin|FleetAdminPage]] (`/admin/fleet`,
CRUD) and `ShipmentTruckSelector` (ShipmentDetail + edit drawer — the selector filters the
list client-side by label, it does not drive `?search=`). Full feature detail:
`processes/fleet-map.md`.

**Trailers** (`GET/POST/PATCH trailers/`) — `Trailer` (fleet trailers, seeded once from TIR
then platform-owned). Same shape as truck heads minus GPS: `GET` (any authenticated user)
lists **active-only** (`is_active=True`), `SearchFilter` on `plate_number`, no pagination:
`{id, plate_number, owner_type, status, is_active}`. `POST`/`PATCH` gated to
`CanEditShipment`. No device matching — trailers have no `TraccarDevice` link. `PATCH
/trailers/{id}/` sees all rows including inactive ones, so `{"is_active": false}`
deactivates and `{"is_active": true}` re-activates. No `RetrieveModelMixin` registered —
`GET /trailers/{id}/` is 405, not 404. `?include_inactive=true` on the list works the same
as for truck heads (admin page uses it; the picker does not). Consumed by the
[[../screens/fleet-admin|FleetAdminPage]] and `ShipmentTruckSelector`.

## Core Reference Endpoints

| Method | Endpoint | Hook | Used By |
|--------|----------|------|---------|
| GET | `/api/v1/core/countries/` | `useCountries` | CountrySelect |
| GET | `/api/v1/core/cities/` | `useCities` | CitySelect |
| GET | `/api/v1/core/customers/` | `useCustomers` | CustomerSelect |
| GET | `/api/v1/core/truck-destinations/?is_active=true` | `useTruckDestinations` | TruckForecast |
