---
title: Contract Detail
tags: [screen, contracts, p4, slice-b]
related: [[../reference/contracts-contract-sale-model]], [[../reference/contracts-contract-model]], [[contract-list]]
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

Five `Ant Design Tabs` below the Descriptions:

| Tab key | Label (tk/ru/en) | Content |
|---|---|---|
| `sales` | Fakturalar / Фактуры / Sales | **ContractSalesTab** — fully built (Slice B). i18n label key `contracts.detail.tab.sales` |
| `documents` | Resminamalar / Документы / Documents | **DocumentsTab** — PDF attachments (upload / inline view / delete) |
| `payments` | Tölegler / Оплаты / Payments | "Coming soon" Empty — Slice C |
| `passports` | Passport sdelkalary / Паспорта сделок / Deal Passports | "Coming soon" Empty — Slice D |
| `comments` | Kommentarlar / Комментарии / Comments | "Coming soon" Empty — later |

## Documents Tab (DocumentsTab)

Component: `pages/contracts/DocumentsTab.tsx`

Lets users attach signed-contract PDFs (and annexes) to a contract for download/preview. Reads the nested `attachments[]` array from the contract detail response.

### Behaviour

- **Upload** (write-gated): antd `Upload`, `accept="application/pdf"`, multiple. Each file POSTs to `…/contracts/{id}/attachments/` (multipart `files`). PDF-only — backend rejects non-PDFs (magic-byte check), ≤20 MB, max 20 per contract.
- **List**: bordered `List` of attachments — filename, size, uploader name, upload datetime (`DD.MM.YYYY HH:mm`).
- **View**: opens `contractAttachmentUrl(contractId, attId)` (the authed `…/download/` endpoint) in a new tab. The httpOnly auth cookie rides the same-origin GET; the PDF previews inline (`Content-Disposition: inline`). Never a direct `/media/` URL — contract documents stay behind auth.
- **Delete** (write-gated): Popconfirm → `DELETE …/attachments/{attId}/`.

Write controls are gated on the user's **resource** permissions (contract has no field-level perms): the Upload button shows when `resource_permissions.contract.create` (or superuser); the Delete action shows when `resource_permissions.contract.delete`. The backend enforces the same (POST→`can_create`, DELETE→`can_delete`).

### API

`POST   /api/v1/contracts/contracts/{id}/attachments/` — upload one or more PDFs (multipart `files`); returns created attachment metadata. `can_create`.
`GET    /api/v1/contracts/contracts/{id}/attachments/{attId}/download/` — stream the PDF inline. `can_view`.
`DELETE /api/v1/contracts/contracts/{id}/attachments/{attId}/` — delete. `can_delete`.

See [[../reference/contracts-contract-model]] for the `ContractAttachment` model + validation rules.

## Faktura Tab (ContractSalesTab)

Component: `pages/contracts/ContractSalesTab.tsx`

ProTable of `IContractSale` rows fetched from `GET /api/v1/contracts/sales/?contract=<id>`.

### Columns

| # | Field | Notes |
|---|---|---|
| 1 | Row # | index + 1 |
| 2 | Faktura № | invoice_number |
| 3 | Sene | invoice_date, formatted DD.MM.YYYY |
| 4 | Tir № | serial_truck_number (— if null) |
| 5 | Şipment kody | Link to `/export/shipments/{id}` when not null (always null until Slice E links sales ↔ shipments) |
| 6 | Mukdar (kg) | quantity_kg, integer formatted |
| 7 | Baha ($/kg) | price_per_kg, 4 decimal places |
| 8 | Jemi ($) | total_usd, prefixed with $ |
| 9 | Passport sdelka | passport_sdelka |
| 10 | Skan | ✓ (green) / ✗ (secondary) |
| 11 | Ýagdaý | status Tag — draft=default, sent=blue, paid=green, void=red |
| 12 | Hereket | Edit button (all roles) + Delete button (admin/superuser only, with Popconfirm) |

Pagination: off. All sales per contract fit in one page (dozens, not thousands).

### Toolbar

"Faktura goş" primary button opens ContractSaleCreate modal.

### Next invoice number

Derived from `Math.max(0, ...sales.map(s => s.invoice_number)) + 1` because `last_invoice_number` is a Contract model field but is **not serialized** in `ContractListSerializer`/`ContractDetailSerializer` (Slice A decision). No backend change needed.

## ContractSaleCreate Modal

Component: `pages/contracts/ContractSaleCreate.tsx`

Single component handles both CREATE (POST) and EDIT (PATCH) modes. Edit mode is activated by passing `editingSale` prop.

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

Money validation: at least (qty + price) OR total_usd must be filled. Frontend validates before submit; server also enforces via `ContractSaleCreateSerializer.validate()`.

### On success

1. Sonner toast (created / updated).
2. Both `['contract-sales']` and `['contracts']` TanStack Query families invalidated — contract header rollup refreshes automatically.
3. Form reset + modal close.

### DRF field errors

Mapped to `Form.Item` via `form.setFields()`. Non-field / unexpected errors → toast.

## Delete sale

Admin / superuser only (button hidden for other roles). Popconfirm two-step. On confirm: `DELETE /api/v1/contracts/sales/{id}/` → server re-rolls contract totals → `['contract-sales']` + `['contracts']` invalidated.

## Files

| File | Role |
|---|---|
| `frontend/src/pages/contracts/ContractDetail.tsx` | Detail page (header + tabs) |
| `frontend/src/pages/contracts/ContractSalesTab.tsx` | Faktura ProTable |
| `frontend/src/pages/contracts/DocumentsTab.tsx` | Contract PDF attachments (upload / view / delete) |
| `frontend/src/pages/contracts/ContractSaleCreate.tsx` | Create + Edit modal |
| `frontend/src/hooks/useContractSales.ts` | useContractSales, useContractSale, useCreateContractSale, useUpdateContractSale, useDeleteContractSale |
| `frontend/src/types/contractSale.ts` | IContractSale, IContractSaleDetail, IContractSaleCreatePayload, IContractSaleUpdatePayload, ContractSaleStatus |

## API

`GET /api/v1/contracts/sales/?contract=<id>` — list (flat, no pagination for now)
`POST /api/v1/contracts/sales/` — create
`PATCH /api/v1/contracts/sales/{id}/` — update
`DELETE /api/v1/contracts/sales/{id}/` — delete (admin/superuser)

See [[../reference/contracts-contract-sale-model]] for full field list, rollup service behaviour, and validation rules.

## Upcoming (out of scope for Slice B)

- Slice C: Payments tab
- Slice D: Passports tab
- Slice E: Contract Sale ↔ Shipment linking (`shipment_code` column will become clickable)
- Slice F: Status transition workflow with audit trail
