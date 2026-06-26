---
title: Sales Report (Rich)
tags: [export, sales, finance, serializer, nested-write]
---

# Sales Report — Rich Structured Report

Replaces the per-shipment Excel workbook (`kazak_export_report_begjan.xlsx`, 478 sheets) with
a structured DB record that captures multi-tier sale lines, itemized expenses, exchange rate
(Kurs), and derived USD totals.

## When it's used

- Shipment must have **departed** (`yola_chykdy`, step 4) or later before the report can be
  submitted. The system status often lags the real sale, so gating on `satyldy` (step 11) would
  block reports for trucks that have already departed and sold. Drafts (step 0) and pre-departure
  steps (customs entry/exit, loading) stay blocked.
- Roles allowed: `sales_rep`, `export_manager`, `director` (all PRIVILEGED_ROLES + `sales_rep`),
  plus superusers.

## Models

### `SalesReport` (extended) — `apps/export/models/quality.py`

Existing model extended with new header fields (all `null=True` for back-compat):

| Field | Type | Notes |
|-------|------|-------|
| `currency` | CharField(10) | Default `'KZT'`. Local currency of destination country. |
| `exchange_rate` | Decimal(12,4) | Kurs: local units per 1 USD. KZT range 370–550. |
| `weight_loaded_kg` | Decimal(10,2) | Total kg loaded on truck (may differ from Shipment.weight_net). |
| `total_sales_local` | Decimal(14,2) | Sum of line item `amount_local`. Stored for fast queries. |
| `total_expenses_local` | Decimal(14,2) | Sum of expense `amount_local`. Stored. |
| `net_income_local` | Decimal(14,2) | `total_sales_local − total_expenses_local`. Stored. |

Existing legacy fields are unchanged for back-compat: `price_per_kg`, `total_usd`,
`weight_sold_kg`, `weight_rejected_kg`, `transport_cost_usd`, `market_fee_usd`,
`other_expenses_usd`, `notes`.

### `SalesReportLineItem` — `apps/export/models/sales.py`

One price-tier row. A single shipment may have 1–14 lines (different grades/price tiers).

| Field | Type | Notes |
|-------|------|-------|
| `report` | FK → SalesReport CASCADE | `related_name='line_items'` |
| `line_number` | PositiveSmallIntegerField | Display order |
| `product_name` | CharField(200, nullable) | Cyrillic collation |
| `quantity_kg` | Decimal(10,2) | Kg sold at this price tier |
| `price_local` | Decimal(12,2) | Price per kg in local currency |
| `amount_local` | Decimal(14,2) | `qty × price` — computed by serializer if omitted |

DB table: `export_sales_report_line_items`. Meta.ordering: `['line_number']`.

### `SalesReportExpense` — `apps/export/models/sales.py`

One itemized expense row. Uses `ExpenseCategory` TextChoices enum (21 codes).

| Field | Type | Notes |
|-------|------|-------|
| `report` | FK → SalesReport CASCADE | `related_name='expenses'` |
| `category` | CharField(32) | `ExpenseCategory` choices |
| `label_raw` | CharField(120, nullable) | Exact sheet label (city-specific variants); Cyrillic collation |
| `amount_local` | Decimal(14,2) | Amount in local currency |

DB table: `export_sales_report_expenses`. Meta.ordering: `['id']`.

### `ExpenseCategory` codes

| Code | English label |
|------|--------------|
| `TOM_ROSHOD` | Tom Roshod (Production cost deduction) |
| `NAKLIYE` | Nakliye (Transport/delivery fee) |
| `BAZAR_ROSHOD` | Bazar Roshod (Market fee) |
| `INTERES` | Interes (Commission/interest) |
| `UZBEK_FURA_AWANS` | Uzbek Fura Awans (Uzbek truck advance) |
| `DOZWOL` | Dozwol (Permit fee) |
| `ANALIZ` | Analiz (Lab analysis fee) |
| `PROSTOY` | Prostoy (Demurrage) |
| `PERESEPKA` | Peresepka (Reloading fee) |
| `ARAP` | Arap (Arab brokerage) |
| `KASPIY_KOMIS` | Kaspiy Komis (Caspian commission) |
| `UZBEK_FURA_SOLYARKA` | Uzbek Fura Solyarka (Uzbek truck fuel) |
| `NDS` | NDS (VAT) |
| `SBOR` | Sbor (Levy/collection fee) |
| `UZB_KAZ_POST` | Uzb-Kaz Post (UZ-KZ postal/border fee) |
| `UZB_KAZ_NAKLIYE` | Uzb-Kaz Nakliye (UZ-KZ transport) |
| `UZBEK_TAM` | Uzbek Tam (Uzbek customs) |
| `MOI` | Moi (Security/police fee) |
| `DOSMOTR` | Dosmotr (Inspection fee) |
| `PEREWOT` | Perewot (Translation fee) |
| `OTHER` | Other |

## Serializers — `apps/export/serializers.py`

### `SalesReportLineItemSerializer`
Fields: `line_number`, `product_name`, `quantity_kg`, `price_local`, `amount_local`.
- `amount_local` is **always recomputed server-side** as `qty × price` whenever both are present
  — any client-supplied value is ignored, so the stored total can never diverge from `Σ(qty × price)`.

### `SalesReportExpenseSerializer`
Fields: `category`, `category_display` (read-only), `label_raw`, `amount_local`.

### `SalesReportSerializer` (extended)
Added fields:
- **New header**: `currency`, `exchange_rate`, `weight_loaded_kg`, `total_sales_local`,
  `total_expenses_local`, `net_income_local`.
- **Nested writable lists**: `line_items` (many, `required=False`), `expenses` (many, `required=False`).
- **Derived read-only USD**: `total_sales_usd`, `total_expenses_usd`, `net_income_usd`
  (computed as `local / exchange_rate`, null when exchange_rate missing or zero).

#### Replace-all nested write semantics

When `line_items` or `expenses` is present in the request:
1. All existing children of that type for this report are deleted.
2. New children are bulk-created (`batch_size=500`).
3. `total_sales_local`, `total_expenses_local`, `net_income_local` are recomputed and stored.

Omitting a field entirely (PATCH without `line_items`) leaves existing children untouched.

All nested writes happen inside `transaction.atomic()`.

## API Endpoint

`POST/PATCH /api/v1/export/shipments/{id}/sales-report/`

Existing endpoint `set_sales_report` (views.py). No structural change — the endpoint
`get_or_create`s the SalesReport then calls `SalesReportSerializer(partial=True).update()`.
Allowed when `request.user.is_superuser` OR role ∈ {`sales_rep`, `export_manager`, `director`}
(the superuser bypass keeps the server gate aligned with the UI's edit gate).

### Example request (Karaganda canonical test case)
```json
{
  "currency": "KZT",
  "exchange_rate": "470.0000",
  "weight_loaded_kg": "18500.00",
  "line_items": [
    { "line_number": 1, "product_name": "Pomidor", "quantity_kg": "18371.00", "price_local": "680.00" }
  ],
  "expenses": [
    { "category": "NDS",          "amount_local": "1476000.00" },
    { "category": "TOM_ROSHOD",   "amount_local": "227250.00" },
    { "category": "ANALIZ",       "amount_local": "59745.00" },
    { "category": "BAZAR_ROSHOD", "amount_local": "103000.00" },
    { "category": "NAKLIYE",      "amount_local": "800000.00" },
    { "category": "INTERES",      "amount_local": "500000.00" }
  ]
}
```

Expected computed values:
- `amount_local` on line 1: 18371 × 680 = 12,492,280 KZT
- `total_expenses_local`: 3,165,995 KZT
- `net_income_local`: 9,326,285 KZT
- `net_income_usd` at Kurs 470: 9,326,285 / 470 ≈ 19,843.16 USD

## Migration

Migration `0037_salesreport_currency_salesreport_exchange_rate_and_more` (applied).
Creates `export_sales_report_line_items` and `export_sales_report_expenses` tables,
adds 6 columns to `export_sales_reports`.

## Tests

`apps/export/tests.SalesReportTest` — 8 tests total:
- 5 pre-existing (3 pass, 2 pre-existing failures unrelated to this feature)
- 3 new: `test_nested_create_persists_children_and_computes_totals`,
  `test_usd_derived_fields_correct_when_exchange_rate_set`,
  `test_replace_all_removes_old_children`

## Frontend

`SalesReportPanel` (`frontend/src/components/SalesReportPanel.tsx`) renders on the **Shipment
Detail** page once the shipment has departed (`yola_chykdy`, step 4+). It composes two editable sub-tables —
`salesReport/LineItemsTable.tsx` (product, qty, price → auto `amount`) and
`salesReport/ExpensesTable.tsx` (21-code category `Select`; `OTHER` reveals a free-text label) —
plus `currency` + `exchange_rate` (Kurs) inputs and a live read-only summary (gross / total
expenses / **net** + USD equivalents) that mirrors the server computation. Shared constants/types/
formatters live in `salesReport/salesReportUtils.ts`.

- **Save**: `useSaveSalesReport(shipmentId)` (`hooks/useSalesReport.ts`) POST/PATCHes the endpoint
  and invalidates the `['shipment', shipmentId]` query so the detail view refreshes.
- **Edit gate**: editable only for superuser OR role ∈ {`sales_rep`, `export_manager`, `director`}
  AND step ≥ 4 (departed); otherwise the panel renders read-only (inputs `disabled`). The shared
  threshold constant is `MIN_SALES_REPORT_STEP` in `components/salesReport/salesReportUtils.ts`.
- **Types**: `ISalesReport`, `ISalesReportLineItem`, `ISalesReportExpense` (+ `*Input`/`*Payload`)
  in `src/types/index.ts`. **i18n**: `sales_report.*` keys (incl. all 21 `sales_report.expense.<CODE>`
  labels) in `tk.json` / `ru.json` / `en.json`.

## Sales Rep page + customer-based ownership

A dedicated worklist lets a `sales_rep` enter reports for only *his* shipments. The platform has
no per-shipment sales-rep owner (`vehicle_responsible` is free text), so ownership is **by
customer**: a rep handles specific buyers and sees only their shipments. One rep per customer.

### Ownership link — `core.Customer.sales_rep`
`Customer` (`apps/core/models/firms.py`) gains a nullable FK `sales_rep` → `core.User`
(`on_delete=SET_NULL`, `related_name='customers'`; migration `core.0022`). Exposed on
`CustomerAdminSerializer` as writable `sales_rep` + read-only `sales_rep_name`; `validate_sales_rep`
rejects assigning a user whose role ≠ `sales_rep` (null clears). (The earlier country-based
`SalesRepCoverage` join table was dropped — migration `export.0046`.)

### Endpoints
- `GET /api/v1/export/sales-rep-coverage/` → `[{sales_rep, sales_rep_name, customer_ids:[...]}]`
  for every `role='sales_rep'` user (empty list when none). **Gate**: superuser / PRIVILEGED_ROLES.
- `PUT /api/v1/export/sales-rep-coverage/{user_id}/` body `{customer_ids:[...]}` → replace-all in
  `transaction.atomic()`: sets `Customer.sales_rep=user` for the listed customers and clears
  (`=None`) the ones this rep had but dropped. Reassigning a customer from another rep just moves
  the FK. Validates the target is a sales_rep (400) and that the customer IDs exist. Same gate.
- `GET /api/v1/export/shipments/my-sales-reports/?needs_report=true|false` → the rep's worklist:
  step-4+ (departed) non-deleted shipments filtered to `customer__sales_rep=request.user`.
  `needs_report=true` drops shipments that already have a report. **Management bypass**: superuser /
  PRIVILEGED_ROLES see ALL step-4+ shipments (oversight). A `sales_rep` with no customers gets an
  empty list. `has_sales_report` annotated via the existing `Exists` pattern; `select_related('customer')`
  keeps it N+1-safe. Serializer: `MySalesReportShipmentSerializer` (= `ShipmentListSerializer` + `has_sales_report`).

### Permissions
Page codes `export.sales_reports` (sales_rep + management) and `export.sales_rep_coverage`
(admin/director/export_manager). The coverage page uses a **non-`admin.` prefix** deliberately so
management roles inherit it via `_ALL_PAGES` without breaching AD-15 (admin-only `admin.*` pages).

### Frontend
- `SalesRepReports.tsx` (`/export/my-reports`, page code `export.sales_reports`): two tabs —
  **Needs report** (default, `needs_report=true`) then **All my shipments** (report-status column).
  Each row opens the shared `SalesReportDrawer`; saving invalidates both tab queries so the row
  moves between tabs. Hook `useMySalesReports(needsReport)`.
- `SalesReportDrawer.tsx` — the report editor in a Drawer (on-demand `useShipmentDetail`, the
  step-4 `canEdit` gate, `SalesReportPanel`). Extracted from `OverdueReportDrawer`, which is now a
  thin re-export shim so the Overdue page is unchanged.
- The rep↔customer link is managed in **both** places: the **Customers admin page**
  (`CustomersPage.tsx` — a Sales Rep select + column per customer, via `PATCH /core/customers/{id}/`)
  and `SalesRepCoveragePage.tsx` (`/admin/sales-rep-coverage`, page code `export.sales_rep_coverage`)
  — a grid with a customer multi-select per rep. Both write the same `Customer.sales_rep` FK. Hook
  `useSalesRepCoverage` (invalidates the coverage + customer queries on save).

## Historical import

478 Excel sheets (`kazak_export_report_begjan.xlsx`) are a separate follow-up task.
The model + serializer are designed for import fidelity: `label_raw` preserves
the exact sheet expense label, `line_number` preserves row order.
