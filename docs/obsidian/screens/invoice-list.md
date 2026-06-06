---
title: Invoice List
tags: [screen, contracts, p4, slice-c]
related: [[../reference/contracts-invoice-model]], [[../reference/contracts-contract-model]], [[../reference/api-endpoint-map]]
---

# Invoice List (P4 Slice C)

Standalone all-invoices list page at `/invoices`. Shows invoices across all contracts in one table with client-side search and status filter.

## URL

`/invoices` — InvoiceList

## Access

All authenticated roles. Sidebar group "Şertnamalar" — second item after "Şertnamalar sanawy".

> TODO: Register page_code `contracts.invoices` in backend `seed_page_codes.py` to switch from the current all-roles bypass to the dynamic permission matrix.

## Layout

ProTable with horizontal scroll. Toolbar: search box (left), status filter Select, "Add invoice" button (right).

### Columns

| Column | Source | Notes |
|---|---|---|
| # | row index | Sequential |
| Invoice # | `invoice_number` | Sortable |
| Date | `invoice_date` | Sortable, default descend (newest first), formatted DD.MM.YYYY |
| Contract # | `contract_number` | Clickable link → `/contracts/{contract}` |
| Exporter | `export_firm_name` | Sortable |
| Importer | `import_firm_name` | Sortable |
| Truck # | `serial_truck_number` | |
| Qty (kg) | `quantity_kg` | Sortable, integer formatted |
| Price ($/kg) | `price_per_kg` | 4 decimal places |
| Total ($) | `total_usd` | Sortable, integer formatted |
| Deal passport | `passport_sdelka` | Truncated at 24 chars with tooltip |
| Scan | `scan_uploaded` | ✓ / ✗ |
| Status | `status` | Tag with STATUS_COLORS |
| Actions | — | Edit button (all), Delete button (admin only) |

Row click navigates to `/contracts/{contract}` (same as the contract_number link).

## Data source

`GET /api/v1/contracts/invoices/?page_size=200` — backend default ordering is `[-invoice_date, contract_id, invoice_number]`. Frontend loads up to 200 invoices, sorts client-side (ProTable sorter on every column), and paginates client-side (default 50, options 25/50/100).

### Client-side filtering

- **Text search** — normalised against `contract_number + export_firm_name + import_firm_name + passport_sdelka + shipment_code + invoice_number`
- **Status filter** — passed to backend as `?status=` query param; enum: `draft | sent | paid | void`

URL state: search query stored as `?q=`, status as `?status=`.

## CRUD

- **Create** — "Add invoice" button opens `InvoiceCreate` modal in standalone mode (shows `ContractSelect` as first field). `last_invoice_number` auto-fetched via `useContract` once a contract is selected; invoice number pre-filled as `last_invoice_number + 1`.
- **Edit** — pencil icon on each row opens `InvoiceCreate` in edit mode (same modal, pre-filled).
- **Delete** — admin/superuser only, guarded by `Popconfirm`.

## Key components

- `InvoiceList` (`pages/invoices/InvoiceList.tsx`) — page component
- `InvoiceCreate` (`pages/contracts/InvoiceCreate.tsx`) — shared modal (tab + standalone modes)
- `ContractSelect` (`components/ContractSelect.tsx`) — self-fetching contract picker used in standalone create

## i18n keys

- `nav.invoices.list` — sidebar label
- `invoices_list.*` — page-specific labels (columns, toolbar, empty state, pagination)
- `invoices.create.field.contract` — "Contract" label in standalone create modal
- `contracts.select.placeholder` — default placeholder for ContractSelect
