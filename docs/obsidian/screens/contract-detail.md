---
title: Contract Detail
tags: [screen, contracts, p4, slice-b]
related: [[../reference/contracts-invoice-model]], [[../reference/contracts-contract-model]], [[contract-list]]
---

# Contract Detail (P4 Slice B)

Detail page at `/contracts/:id` for a single `Contract`. Replaces the Slice A placeholder.

## URL

`/contracts/:id` — ContractDetail

## Access

All authenticated roles. Back button navigates to `/contracts`.

## Layout

### Header row

Back button (`ArrowLeftOutlined` + "Şertnamalar sanawyna gaýt") → contract_number `Title` + status `Tag`.

### Descriptions block

`Ant Design Descriptions`, bordered, 3-column responsive (`xs=1, sm=2, md=3`). Groups:

| Group key | Fields shown |
|---|---|
| Identity | contract_number, seller (export_firm_name), buyer (import_firm_name), season_name, incoterm, status tag |
| Planlanan (Planned) | planned_trucks, planned_quantity_kg, planned_amount_usd |
| Eksport edilen | exported_trucks, exported_quantity_kg, exported_amount_usd |
| Galan (Remaining) | trucks_remaining, quantity_remaining_kg |
| Tölegler (Payments) | payment_received_usd, ostatok_usd |
| Dates | start_date → end_date (DD.MM.YYYY) |

Numbers use `fmt()` — `Math.round().toLocaleString('en-US', { maximumFractionDigits: 0 })`.

### Tabs

Four `Ant Design Tabs` below the Descriptions:

| Tab key | Label (tk/ru/en) | Content |
|---|---|---|
| `invoices` | Fakturalar / Фактуры / Invoices | **InvoicesTab** — fully built (Slice B) |
| `payments` | Tölegler / Оплаты / Payments | "Coming soon" Empty — Slice C |
| `passports` | Passport sdelkalary / Паспорта сделок / Deal Passports | "Coming soon" Empty — Slice D |
| `comments` | Kommentarlar / Комментарии / Comments | "Coming soon" Empty — later |

## Faktura Tab (InvoicesTab)

Component: `pages/contracts/InvoicesTab.tsx`

ProTable of `IInvoice` rows fetched from `GET /api/v1/contracts/invoices/?contract=<id>`.

### Columns

| # | Field | Notes |
|---|---|---|
| 1 | Row # | index + 1 |
| 2 | Faktura № | invoice_number |
| 3 | Sene | invoice_date, formatted DD.MM.YYYY |
| 4 | Tir № | serial_truck_number (— if null) |
| 5 | Şipment kody | Link to `/export/shipments/{id}` when not null (always null until Slice E links invoices ↔ shipments) |
| 6 | Mukdar (kg) | quantity_kg, integer formatted |
| 7 | Baha ($/kg) | price_per_kg, 4 decimal places |
| 8 | Jemi ($) | total_usd, prefixed with $ |
| 9 | Passport sdelka | passport_sdelka |
| 10 | Skan | ✓ (green) / ✗ (secondary) |
| 11 | Ýagdaý | status Tag — draft=default, sent=blue, paid=green, void=red |
| 12 | Hereket | Edit button (all roles) + Delete button (admin/superuser only, with Popconfirm) |

Pagination: off. All invoices per contract fit in one page (dozens, not thousands).

### Toolbar

"Faktura goş" primary button opens InvoiceCreate modal.

### Next invoice number

Derived from `Math.max(0, ...invoices.map(i => i.invoice_number)) + 1` because `last_invoice_number` is a Contract model field but is **not serialized** in `ContractListSerializer`/`ContractDetailSerializer` (Slice A decision). No backend change needed.

## InvoiceCreate Modal

Component: `pages/contracts/InvoiceCreate.tsx`

Single component handles both CREATE (POST) and EDIT (PATCH) modes. Edit mode is activated by passing `editingInvoice` prop.

### Fields

| Field | Required | Notes |
|---|---|---|
| Faktura № | yes | Pre-filled with nextInvoiceNumber; editable |
| Sene | yes | DatePicker, defaults today |
| Tir № | no | InputNumber |
| Mukdar (kg) | conditional | onChange triggers auto-compute of Jemi |
| Baha ($/kg) | conditional | onChange triggers auto-compute of Jemi |
| Jemi ($) | conditional | Auto-computed when qty+price filled; `userManuallyEditedTotal` ref prevents clobbering manual override |
| Passport sdelka | no | Input |
| Skan ýüklendi | no | Checkbox |
| Ýagdaý | no | Select, defaults `sent` |

Money validation: at least (qty + price) OR total_usd must be filled. Frontend validates before submit; server also enforces via `InvoiceCreateSerializer.validate()`.

### On success

1. Sonner toast (created / updated).
2. Both `['invoices']` and `['contracts']` TanStack Query families invalidated — contract header rollup refreshes automatically.
3. Form reset + modal close.

### DRF field errors

Mapped to `Form.Item` via `form.setFields()`. Non-field / unexpected errors → toast.

## Delete invoice

Admin / superuser only (button hidden for other roles). Popconfirm two-step. On confirm: `DELETE /api/v1/contracts/invoices/{id}/` → server re-rolls contract totals → `['invoices']` + `['contracts']` invalidated.

## Files

| File | Role |
|---|---|
| `frontend/src/pages/contracts/ContractDetail.tsx` | Detail page (header + tabs) |
| `frontend/src/pages/contracts/InvoicesTab.tsx` | Faktura ProTable |
| `frontend/src/pages/contracts/InvoiceCreate.tsx` | Create + Edit modal |
| `frontend/src/hooks/useInvoices.ts` | useInvoices, useInvoice, useCreateInvoice, useUpdateInvoice, useDeleteInvoice |
| `frontend/src/types/invoice.ts` | IInvoice, IInvoiceDetail, IInvoiceCreatePayload, IInvoiceUpdatePayload, InvoiceStatus |

## API

`GET /api/v1/contracts/invoices/?contract=<id>` — list (flat, no pagination for now)
`POST /api/v1/contracts/invoices/` — create
`PATCH /api/v1/contracts/invoices/{id}/` — update
`DELETE /api/v1/contracts/invoices/{id}/` — delete (admin/superuser)

See [[../reference/contracts-invoice-model]] for full field list, rollup service behaviour, and validation rules.

## Upcoming (out of scope for Slice B)

- Slice C: Payments tab
- Slice D: Passports tab
- Slice E: Invoice ↔ Shipment linking (`shipment_code` column will become clickable)
- Slice F: Status transition workflow with audit trail
