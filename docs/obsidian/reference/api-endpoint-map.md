---
title: API Endpoint Map
tags: [reference, api, backend, frontend]
---

# API Endpoint Map

> Every API endpoint mapped to its backend ViewSet, frontend hook, and page.

## Auth Endpoints

| Method | Endpoint | ViewSet | Hook | Page |
|--------|----------|---------|------|------|
| POST | `/api/v1/auth/login/` | AuthView | `useAuth().login` | LoginPage |
| POST | `/api/v1/auth/logout/` | AuthView | `useAuth().logout` | - |
| GET | `/api/v1/auth/me/` | AuthView | `useAuth()` | - (loaded on app init) |

## Export Endpoints

### Shipments

| Method | Endpoint | ViewSet | Hook | Page |
|--------|----------|---------|------|------|
| GET | `/api/v1/export/shipments/` | ShipmentViewSet (list) | `useShipments` | ShipmentList |
| GET | `/api/v1/export/shipments/{id}/` | ShipmentViewSet (detail) | `useShipmentDetail` | ShipmentDetail |
| POST | `/api/v1/export/shipments/` | ShipmentViewSet (create) | `useShipments` (mutation) | ShipmentCreateModal |
| PATCH | `/api/v1/export/shipments/{id}/` | ShipmentViewSet (partial_update) | `useShipmentPatch` | ShipmentDetail, ShipmentSheet |
| POST | `/api/v1/export/shipments/{id}/transition/` | ShipmentViewSet.transition | `useShipmentDetail` (mutation) | TransitionButton |
| POST | `/api/v1/export/shipments/{id}/assign/` | ShipmentViewSet.assign | `useAssignDraft` | AssignmentBoard |
| POST | `/api/v1/export/shipments/{target_id}/join/` | ShipmentViewSet.join | _(in useDrafts)_ | ShipmentSheet (JoinShipmentsModal) |
| POST | `/api/v1/export/shipments/bulk-delete/` | ShipmentViewSet.bulk_delete | _(inline in page)_ | ShipmentList (admin only) |
| POST | `/api/v1/export/shipments/{id}/soft-delete/` | ShipmentViewSet.soft_delete | `useSoftDeleteShipment` | ShipmentList, ShipmentSheet (admin only) |
| POST | `/api/v1/export/shipments/{id}/restore/` | ShipmentViewSet.restore | `useRestoreShipment` | ShipmentList ?show_deleted (admin only) |
| GET | `/api/v1/export/shipments/overdue/` | ShipmentViewSet.overdue | `useOverdueShipments` | OverdueReports |
| GET | `/api/v1/export/shipments/sheet/` | ShipmentViewSet.sheet | `useShipmentSheet` | ShipmentSheet |
| PATCH | `/api/v1/export/shipments/{id}/quality/` | ShipmentViewSet.set_quality | `useShipmentDetail` (mutation) | ShipmentDetail (Document tab) |
| POST | `/api/v1/export/shipments/{id}/comment/` | ShipmentViewSet.comment | `useShipmentDetail` (mutation) | CommentComposer |
| POST | `/api/v1/export/shipments/{id}/sales-report/` | ShipmentViewSet.set_sales_report | `useShipmentDetail` (mutation) | ShipmentDetail (Finance tab) |
| POST | `/api/v1/export/shipments/{id}/block-sources/` | ShipmentViewSet.set_block_sources | `useShipmentDetail` (mutation) | ShipmentDetail |
| POST | `/api/v1/export/shipments/{id}/firm-splits/` | ShipmentViewSet.set_firm_splits | `useShipmentDetail` (mutation) | ShipmentDetail |
| GET | `/api/v1/export/shipments/{id}/tasks/` | ShipmentViewSet.tasks_list | `useShipmentTasks` | ShipmentDetail (Tasks tab) |

**Draft create** (`POST /shipments/` with `is_draft=true`) now also accepts optional `varieties`, `import_firm`, `firm_splits[]`, and `skip_forecast_check`. This supports the two-column Join flow's supply-only and destination-only drafts — see [[../processes/draft-shipments#Two-column Join flow (coexisting alternative)]]. `skip_forecast_check=true` (sent by the supply-column modal) skips **both** weight caps for that draft: the forecast-pool remaining check **and** the 18,500 kg one-truck cap — a supply column aggregates a day's harvest and may span more than one truck. The forecast-first one-truck DraftComposer path (no `skip_forecast_check`) keeps both caps.

**Multi-variety on draft create:** `varieties` is a list of **1–4 TomatoVariety IDs** (a shipment can carry multiple tomato sorts). The first ID is the **primary**; the list sets the `varieties_dominant` M2M plus the back-compat `variety` FK, with `variety_confidence='low'` (manually estimated). The single `variety` field still works for back-compat. No new DB table or migration — multi-variety reuses the existing `Shipment.varieties_dominant` M2M.

**Join** (`POST /shipments/{target_id}/join/`) body `{"source_id": <int>}`. `export_manager`/`director` only. Gates: both must be `draft`; target ≠ source; target must have country + customer and **no** blocks; source must have ≥1 block. Effect: source's `block_sources` (and `firm_splits` if target has none) move to the target; `variety` + `official_export_code` copied if empty; `weight_net` recomputed; one `ShipmentStatusLog` row written on target; the source creator gets a `Notification`; the **source is hard-deleted**. Returns updated target detail (200); errors `{error}` 400/403/404.

**`created_by_role`**: the `/shipments/sheet/` items now include `created_by_role: string|null`, used by the frontend to tint supply-created columns.

**`varieties_dominant`**: the `/shipments/sheet/` items now also include `varieties_dominant` — an array of `{id, code, name, is_experimental}` per shipment (1–4 entries) so the variety cell can render all sorts a shipment carries.

**Bulk hard-delete** (`POST /shipments/bulk-delete/`) body `{"ids": [int, ...]}` — **admin / superuser only** (tighter than `cancel`, which uses PRIVILEGED_ROLES). Capped at 200 IDs per call. Bypasses the operational/archive filter so admins can purge by ID regardless of view. Cascade removes: comments, status_log, firm_splits, block_sources, pallets, quality, sales_report, custom_field_values, advance_links. `QuotaUsageRecord.shipment` is `SET_NULL` — draft quotas are deleted (mirrors `cancel`), approved quotas are orphaned and their IDs returned in `approved_quota_to_reconcile` so the admin can reconcile via QuotaUsageGrid. One `AuditLog` row per shipment with `action='delete'` is written before destruction (AuditLog uses a plain IntegerField for `object_id`, so historical update/transition rows for the deleted shipment also survive). Response: `{deleted, cascade_rows_deleted, draft_quota_deleted, approved_quota_to_reconcile}`.

**Soft delete (deactivate)** (`POST /shipments/{id}/soft-delete/`) — **admin / superuser only**, no body. Sets `Shipment.deleted_at = now()` + `deleted_by = request.user`; the row stays in the DB but is filtered out of every list / sheet / board / dashboard-active-shipments queryset by default. Idempotent (no-op on already-deleted). Writes one `AuditLog` row with `action='soft_delete'`. Editing a soft-deleted row via `PATCH` returns 403 (mirror of the archived-row guard). Returns the full `ShipmentDetailSerializer` response (so the UI can update in place).

**Restore** (`POST /shipments/{id}/restore/`) — **admin / superuser only**, no body. Clears `deleted_at` + `deleted_by`. Idempotent. Writes one `AuditLog` row with `action='restore'`. Returns the full detail response. Admins find soft-deleted shipments via `GET /shipments/?show_deleted=true` on the Shipments page (admin-only param — non-admins get 200 with 0 results; the param flips the list to show **only** deleted rows). Detail-style actions (cancel, transition, retrieve, restore) bypass the soft-delete filter so the row is always reachable by ID. The Sheet column header has a small admin-only trash icon (bottom-right of each column — the seq number sits top-left and the color-dot top-right, so bottom-right is the one free corner) that fires soft-delete with a confirmation modal — hidden during reorder mode.

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
  "id": 1, "shipment": 42, "shipment_cargo_code": "0201045/25",
  "step": "yuklenme", "phase": "LOADING",
  "title_key": "tasks.fill_loading_data",
  "assignee_role": "warehouse_chief", "assignee_user": null, "assignee_user_name": null,
  "target_fields_list": ["cargo_code", "block_sources", "weight_net"],
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
| GET | `/api/v1/export/quota-dashboard/` | QuotaDashboardView | `useQuotaDashboard` | QuotaDashboard |

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
| GET/POST/PATCH | `/api/v1/export/prices/` | PriceEntryViewSet | `usePriceEntries` | PricePanel |
| GET/POST/PATCH | `/api/v1/export/local-sell-plans/` | WeeklyLocalSellPlanViewSet | _(in QuotaDashboard)_ | LocalSellPlanGrid |
| GET/POST | `/api/v1/export/advances/` | FinansistAdvanceViewSet | `useAdvances` | AdvancesTracker |
| GET | `/api/v1/export/advances/{id}/` | FinansistAdvanceViewSet (detail) | `useAdvanceDetail` | AdvancesTracker |
| PATCH | `/api/v1/export/advances/{id}/reconcile/` | FinansistAdvanceViewSet.reconcile | `useReconcileAdvance` | AdvancesTracker |
| GET/POST | `/api/v1/export/notifications/` | NotificationViewSet | `useNotifications` | AppLayout |
| GET | `/api/v1/export/audit-log/` | AuditLogViewSet | _(admin)_ | _(admin)_ |

### Admin (under /api/v1/export/admin/)

| Method | Endpoint | ViewSet | Hook | Page |
|--------|----------|---------|------|------|
| GET/POST/PATCH | `/api/v1/export/admin/seasons/` | SeasonViewSet | `useSeasons` | SeasonsPage |
| GET/POST/PATCH | `/api/v1/export/admin/firms/` | ExportFirmViewSet | `useAdmin` | ExportFirmsPage |
| GET/POST/PATCH | `/api/v1/export/admin/import-firms/` | ImportFirmViewSet | `useAdmin` | ImportFirmsPage |
| GET/POST/PATCH | `/api/v1/export/admin/users/` | UserManagementViewSet | `useAdmin` | UsersPage |
| GET/PUT | `/api/v1/export/admin/users/{id}/permissions/` | UserPermissionsView | `useAdmin` | PermissionsPage |
| GET/POST | `/api/v1/export/admin/sheet-rows/` | SheetRowSettingViewSet (list/create) | `useSheetRowSettings` | ShipmentSettings (Sheet Rows tab) |
| GET/PATCH/DELETE | `/api/v1/export/admin/sheet-rows/{id}/` | SheetRowSettingViewSet (detail/update/soft-delete) | `useSheetRowSettings` | ShipmentSettings (Sheet Rows tab) |
| POST | `/api/v1/export/admin/sheet-rows/{id}/restore/` | SheetRowSettingViewSet.restore | `useSheetRowSettings` | ShipmentSettings (Sheet Rows tab) |
| POST | `/api/v1/export/admin/sheet-rows/reorder/` | SheetRowSettingViewSet.reorder | `useSheetRowSettings` | ShipmentSettings (Sheet Rows tab) |
| POST | `/api/v1/export/admin/sheet-rows/{id}/permissions/bulk/` | SheetRowSettingViewSet.permissions_bulk | `useSheetRowSettings` | ShipmentSettings (Sheet Rows tab) |

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
| GET/POST/PATCH | `/api/v1/greenhouse/domestic-sales/` | DomesticSaleViewSet | `useDomesticSales` | DomesticSales |
| GET/POST/PATCH | `/api/v1/greenhouse/admin/blocks/` | GreenhouseBlockAdminViewSet | `useAdmin` | BlocksPage |
| GET/POST/PATCH | `/api/v1/greenhouse/admin/block-assignments/` | BlockManagerAssignmentViewSet | `useAdmin` | BlockDetailPage |

## Me Endpoints (current-user scoped)

| Method | Endpoint | View | Hook | Page |
|--------|----------|------|------|------|
| GET | `/api/v1/me/tasks/` | `MeTaskListView` | `useMyTasks` | TaskInbox, AppLayout badge |
| GET | `/api/v1/me/kpi-today/` | `MeKpiTodayView` | `useMyKpiToday` | KPI widget / Dashboard |

**`/me/tasks/` filters:** `?state=open&step=yuklenme&overdue=true`. Supervisors (`export_manager`, `boss`, `admin`, `director`) see all tasks; other roles see only tasks for their own `assignee_role`. Paginated (`page_size=50`).

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

**`Shipment.status_changed_at`:** New indexed DateTimeField set by `transition_to()` on every status change and by `create_shipment()` on creation. Backfilled from `ShipmentStatusLog` by migration 0011. Used by KPI helpers and replaces `Max(status_log__changed_at)` annotation in the board view's sort key.

## Core Reference Endpoints

| Method | Endpoint | Hook | Used By |
|--------|----------|------|---------|
| GET | `/api/v1/core/countries/` | `useCountries` | CountrySelect |
| GET | `/api/v1/core/cities/` | `useCities` | CitySelect |
| GET | `/api/v1/core/customers/` | `useCustomers` | CustomerSelect |
| GET | `/api/v1/core/truck-destinations/?is_active=true` | `useTruckDestinations` | TruckForecast |
