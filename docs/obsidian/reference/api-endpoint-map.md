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
| GET | `/api/v1/export/shipments/` | ShipmentViewSet (list) | `useShipments` | ShipmentList, KanbanBoard |
| GET | `/api/v1/export/shipments/{id}/` | ShipmentViewSet (detail) | `useShipmentDetail` | ShipmentDetail |
| POST | `/api/v1/export/shipments/` | ShipmentViewSet (create) | `useShipments` (mutation) | ShipmentCreateModal |
| PATCH | `/api/v1/export/shipments/{id}/` | ShipmentViewSet (partial_update) | `useShipmentPatch` | ShipmentDetail, ShipmentSheet |
| POST | `/api/v1/export/shipments/{id}/transition/` | ShipmentViewSet.transition | `useShipmentDetail` (mutation) | TransitionButton |
| GET | `/api/v1/export/shipments/overdue/` | ShipmentViewSet.overdue | `useOverdueShipments` | OverdueReports |
| GET | `/api/v1/export/shipments/sheet/` | ShipmentViewSet.sheet | `useShipmentSheet` | ShipmentSheet |
| PATCH | `/api/v1/export/shipments/{id}/quality/` | ShipmentViewSet.set_quality | `useShipmentDetail` (mutation) | ShipmentDetail (Document tab) |
| POST | `/api/v1/export/shipments/{id}/comment/` | ShipmentViewSet.comment | `useShipmentDetail` (mutation) | CommentComposer |
| POST | `/api/v1/export/shipments/{id}/sales-report/` | ShipmentViewSet.set_sales_report | `useShipmentDetail` (mutation) | ShipmentDetail (Finance tab) |
| POST | `/api/v1/export/shipments/{id}/block-sources/` | ShipmentViewSet.set_block_sources | `useShipmentDetail` (mutation) | ShipmentDetail |
| POST | `/api/v1/export/shipments/{id}/firm-splits/` | ShipmentViewSet.set_firm_splits | `useShipmentDetail` (mutation) | ShipmentDetail |

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
| GET/POST/PATCH | `/api/v1/greenhouse/domestic-sales/` | DomesticSaleViewSet | `useDomesticSales` | DomesticSales |
| GET/POST/PATCH | `/api/v1/greenhouse/admin/blocks/` | GreenhouseBlockAdminViewSet | `useAdmin` | BlocksPage |
| GET/POST/PATCH | `/api/v1/greenhouse/admin/block-assignments/` | BlockManagerAssignmentViewSet | `useAdmin` | BlockDetailPage |

## Core Reference Endpoints

| Method | Endpoint | Hook | Used By |
|--------|----------|------|---------|
| GET | `/api/v1/core/countries/` | `useCountries` | CountrySelect |
| GET | `/api/v1/core/cities/` | `useCities` | CitySelect |
| GET | `/api/v1/core/customers/` | `useCustomers` | CustomerSelect |
| GET | `/api/v1/core/truck-destinations/?is_active=true` | `useTruckDestinations` | TruckForecast |
