---
title: Sales Report Page
tags: [screen, export, p3, sales-report]
related: [[../reference/sales-report-model]], [[expense-template-admin]], [[shipment-sheet]]
---

# Sales Report Page

Full-page, Excel-like sales report ("Export Hasabat") at `/export/sales-reports/:shipmentId`.
Replaces the old `SalesReportDrawer` for the Sales Rep worklist flow (`SalesRepReports`, which now
navigates here instead of opening a drawer). Modelled on `data/sales_report/kazak_export_report_begjan.xlsx`.

Component: `frontend/src/pages/export/SalesReportPage.tsx` (state lifted here; sub-tabs in
`components/salesReport/SaleTab.tsx` + `ProcessingTab.tsx`).

## Access

`canEdit` = role ∈ {sales_rep, export_manager, director, admin, superuser} **and**
`shipment.status_step >= MIN_SALES_REPORT_STEP` (4 = departed). Route gated by pageCode
`export.sales_reports`. One `SalesReport` record backs both tabs; a single Save persists everything
(both tab panes stay mounted so all `Form.Item`s register at `validateFields()`).

## Tab 1 — Sale (sales rep)

- **Line items**: `LineItemsTable` — quantity_kg × price_local → amount (price tiers for one lot,
  not separate SKUs).
- **Expenses**: `FixedExpensesTable` pre-lists **every active** `ExpenseCategory` (from
  `useExpenseCategories` → `/export/expense-categories/?is_active=true`) as a fixed row — no "Add"
  click. Amounts left blank are dropped on save (`amount_local > 0` filter). `label_raw` free-text
  input shows for `OTHER` and `NAKLIYE` (city-specific freight). Category labels render from the API
  name (tk/ru/en by current language), not a hardcoded i18n enum.
- **Currency**: auto-fills from the shipment's destination `Country.currency` (KZ→KZT, RU→RUB,
  fallback KZT) and stays editable.

## Tab 2 — Processing (export manager)

- **Kurs** (`exchange_rate`): KZT/RUB per USD — drives all derived USD figures.
- **Weights**: `weight_loaded_kg` (defaults to Σ `block_sources` kg), `weight_sold_kg` (defaults to
  Σ line-item kg), and the derived **Tapawutly** `weight_rejected_kg = max(0, loaded − sold)`
  (computed client-side in `buildPayload`; the field is display-only).
- **Per-block table**: read-only from shipment `block_sources` (block_code, weight_kg) with each
  block's proportional share of the loss.
- **Totals**: gross sales / total expenses / net income in local currency, plus derived USD
  (`local ÷ exchange_rate`).

## Notes

- The legacy `SalesReportDrawer`/`SalesReportPanel` still serve the ShipmentDetail "Sales Report"
  section and OverdueReports; both are PK-compatible with the new expense-category FK.
- Wire format: `expenses[].category` is an integer PK (see [[../reference/sales-report-model]]).
