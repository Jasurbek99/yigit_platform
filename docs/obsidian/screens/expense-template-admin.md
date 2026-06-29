---
title: Expense Template Admin
tags: [screen, export, admin, p3, sales-report]
related: [[../reference/sales-report-model]], [[sales-report-page]]
---

# Expense Template Admin

CRUD screen for the sales-report expense **template** at `/admin/expense-template`.
Component: `frontend/src/pages/admin/ExpenseTemplatePage.tsx` (+ `ExpenseTemplateModal.tsx`).
Backs the pre-listed expense rows on the [[sales-report-page]].

## Access

PageCode `export.expense_template` — **non-admin** prefix on purpose (AD-15), so
admin / director / export_manager inherit it; restricted-set roles do not. Write operations on
`/export/expense-categories/` are independently gated server-side to the same three roles + superuser.

## What it manages

ProTable over `GET /export/expense-categories/`, ordered by `sort_order`. Per category:

| Field | Notes |
|---|---|
| `code` | Stable key. Writable on create, **immutable after** (serializer `update()` drops it). |
| `name_tk` / `name_ru` / `name_en` | Localised display names (rendered on the sales report by language). Nullable. |
| `logo_code` | Future LOGO-ERP account ref. Stored only — **no sync wired yet**. |
| `sort_order` | Row order in the sales-report expense list. |
| `is_active` | Inactive categories are hidden from the sales report (`?is_active=true` filter). |

## Behaviour

- Add via modal; edit via modal (code field disabled).
- **Deactivate, don't delete** in-use categories: the FK is `PROTECT`, so deleting a category
  referenced by a saved `SalesReportExpense` returns **409** (centralised `ProtectedError` handler)
  and shows a toast. Toggling `is_active=false` is the soft path.
- Mutations (`useCreate/Update/DeleteExpenseCategory`) invalidate the `['expense-categories']` query.

The 21 original categories were seeded from the legacy `ExpenseCategoryEnum`
(migration `export.0049`); see [[../reference/sales-report-model]].
