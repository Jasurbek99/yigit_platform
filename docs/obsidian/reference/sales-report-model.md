# Sales Report — Backend Model & API

## Overview

One `SalesReport` record per shipment. Backed by `export_sales_reports` (header) + two child
tables: `export_sales_report_line_items` (price tiers) and `export_sales_report_expenses`
(itemized costs). Both child tables use replace-all semantics on PATCH — sending the list
replaces all existing rows; omitting the field leaves children untouched.

## Models

### `SalesReport` (header)
- `shipment` — OneToOne FK to `Shipment`
- `currency` — CharField (defaults from `country.currency` on first create, fallback `'KZT'`)
- `exchange_rate` — DecimalField (Kurs: local units per USD)
- `weight_loaded_kg`, `weight_sold_kg`, `weight_rejected_kg` — Decimal
- `total_sales_local`, `total_expenses_local`, `net_income_local` — server-computed, read-only
- Legacy flat fields: `price_per_kg`, `total_usd`, `transport_cost_usd`, `market_fee_usd`,
  `other_expenses_usd` (back-compat, not recomputed by the new model)

### `SalesReportLineItem`
- `report` → `SalesReport` (CASCADE)
- `line_number`, `product_name`, `quantity_kg`, `price_local`, `amount_local`
- `amount_local` is always recomputed server-side as `quantity_kg × price_local`

### `SalesReportExpense`
- `report` → `SalesReport` (CASCADE)
- `category` → `ExpenseCategory` (PROTECT FK — use `is_active=False` to retire, don't delete)
- `label_raw` — optional free-text label (route-specific NAKLIYE variants, import audit trail)
- `amount_local` — Decimal

### `ExpenseCategory` (admin-managed template)
- `code` — unique CharField (stable key; matches former TextChoices enum codes)
- `name_tk`, `name_ru`, `name_en` — Cyrillic collation on tk/ru
- `logo_code` — reserved for future LOGO ERP account sync (no logic yet)
- `sort_order`, `is_active`
- **Seeded** with 21 rows by migration `0049_seed_expense_categories`

## Wire Format

`expenses[].category` is an **integer PK** (not a string code). Read response includes
`category_code`, `category_display`, and `logo_code` alongside the numeric PK.

See `.claude/rules/api-contract.md` → "Sales report" and "Expense categories" sections.

## Endpoint

`POST`/`PATCH /api/v1/export/shipments/{id}/sales-report/`
`GET|POST|PATCH|DELETE /api/v1/export/expense-categories/`

## Currency defaulting

On first `SalesReport.get_or_create`, the view sets `currency` from
`shipment.country.currency` (seeded: KZ→`KZT`, RU→`RUB`), falling back to `'KZT'`.
A client-supplied `currency` field in the subsequent partial update overrides the default.

## Known limitations (Phase 1)

- `DELETE /expense-categories/{id}/` on a category with existing expense rows raises a 500
  (PROTECT FK). Prefer `is_active=False`.
- The old frontend (pre-Phase 2) sends string category codes; these will be rejected by
  `PrimaryKeyRelatedField`. Phase 2 updates the frontend to send integer PKs.
- `ExpenseCategoryEnum` (renamed from `ExpenseCategory` TextChoices) is kept in
  `export/models/sales.py` as a seed reference; it is no longer used on any model field.
