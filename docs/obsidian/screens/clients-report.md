---
title: Clients Report
tags: [screen, analytics, clients, customers, export]
related: [[boss-dashboard]], [[../roles/roles-matrix]], [[../api-endpoint-map]]
---

# Clients Report

Analytics screen at `/analytics/clients-report`. Live, always-correct replacement for the legacy
`data/by_clients.xlsx` workbook (which was a hand-maintained `COUNTIF` dashboard over the master
shipment register and is now full of `#REF!` after its external link broke).

Lives in a new top-level **Analytics** nav group. Page access via page_code `analytics.clients`
(seeded visible for `admin`, `director`, `export_manager`, `boss`). Server-side the endpoint only
requires an authenticated user — page gating is enforced by `ProtectedRoute` + the seeded
`RolePagePermission`, the same model the Boss Dashboard uses.

## Backend

- Service: `apps/export/services/clients_report.py` → `build_clients_report(season)`. Pure DB
  aggregator, no writes.
- Endpoint: `GET /api/v1/export/clients-report/` (`ClientsReportViewSet` in
  `apps/export/views_clients_report.py`). Read-only, 60s cached per active season.
- All numbers aggregate from `export.shipments` for the **active season** (`Season.is_active`),
  bounded by `start_date`/`end_date`.
- MSSQL-safe: `TruncMonth` for month buckets, `Coalesce(Sum('weight_net'), 0)`, no JSONField.

### Response shape

```json
{
  "season": { "id": 3, "name": "2025-2026" },
  "months": [ { "key": "2025-10", "year": 2025, "month": 10 }, ... ],
  "clients": [
    {
      "customer_id": 5, "customer_name": "Begjan",
      "country_id": 1, "country_name": "Kazakhstan",
      "monthly": { "2025-10": { "trucks": 3, "tonnage": 54.6 }, ... },
      "total_trucks": 675, "total_tonnage": 12285.0, "pct": 23.4
    }
  ],
  "totals": { "monthly": { "2025-10": {"trucks":46,"tonnage":...} }, "total_trucks": 2883, "total_tonnage": ... },
  "by_country": [ { "name": "Kazakhstan", "trucks": 1551, "tonnage": ... } ],
  "by_city":    [ { "name": "Şimkent",    "trucks": 564,  "tonnage": ... } ]
}
```

Notes:
- `clients` rows are grouped by **customer × country** — a customer shipping to two countries appears
  twice. This reproduces the spreadsheet's `Begjan` vs `Begjan-Rossiya` route split.
- `tonnage` is in **tonnes** (kg / 1000), from real `weight_net` — not the spreadsheet's
  trucks × 18.2 estimate.
- `pct` = share of total trucks (0–100, 1 decimal).

## Frontend

- Page: `pages/analytics/ClientsReport.tsx` (default export, lazy-loaded in `App.tsx`).
- Table: `pages/analytics/ClientsMatrixTable.tsx` — Ant `Table`, fixed Customer/Total columns, one
  column per season month (trucks + tonnage per cell), sortable, totals summary row.
- Charts (Apache ECharts via `components/EChart.tsx`, which now registers `PieChart`/`BarChart`):
  doughnut by customer, pie by country, pie by city.
- Hook: `hooks/useClientsReport.ts` (TanStack Query, 60s staleTime).
- Month column labels localized from numeric year+month via `clients_report.months[]` in all three
  locale files (`i18n/{tk,ru,en}.json`).

## Replaces

`data/by_clients.xlsx` — sheet `filtr_report_by_clients`: client×month truck table, by-country pie,
by-city pie, and the sales-by-customer doughnut.
