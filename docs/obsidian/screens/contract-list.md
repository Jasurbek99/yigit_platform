---
title: Contract List
tags: [screen, contracts, p4, slice-a]
related: [[../reference/contracts-contract-model]], [[../reference/api-endpoint-map]]
---

# Contract List (P4 Slice A)

List page at `/contracts` for the `Contract` model. Entry point to the P4 Contracts module.

## URL

`/contracts` — ContractList
`/contracts/:id` — ContractDetail (placeholder for Slice B)

## Access

All authenticated roles. Sidebar group "Şertnamalar" at the bottom of the sidebar (after all existing groups).

> TODO: Register page_code `contracts.list` in backend `seed_page_codes.py` to switch from the current all-roles bypass to the dynamic permission matrix.

## Layout

ProTable with grouped column headers. Horizontal scroll enabled (`scroll={{ x: 'max-content' }}`).

### Column groups

| Group | Sub-columns |
|---|---|
| (none) | #, Contract number, Seller, Buyer, Incoterm |
| **Planlanan** (Planned) | Trucks, Quantity (kg), Amount ($) |
| **Eksport edilen** (Exported) | Trucks, Quantity (kg), Amount ($) |
| **Galan** (Remaining) | Trucks, Quantity (kg) |
| **Tölegler** (Payments) | Received ($), Ostatok ($) |
| (none) | Status tag |

Columns in the Planned, Exported, Remaining, and Payments groups are hidden on small screens (`responsive: ['md']`).

### Toolbar (left to right)

1. **+ Şertnama goş** — opens the create modal (primary green button)
2. **Search** — client-side filter on `contract_number` (fine for ~30 contracts)
3. **Status filter** — All / Active / Completed / Closed
4. **Show ended toggle** — Switch; off by default. URL-synced via `?ended=1` query param. When on: passes `includeEnded=true` → backend returns active + completed + closed. Cancelled is never shown.

## Number formatting

All kg and $ values displayed with `toLocaleString('en-US', { maximumFractionDigits: 0 })` — no decimal places.

The DB stores `DECIMAL(12,2)` and DRF returns the value as a string. Frontend parses with `parseFloat()` then rounds with `Math.round()`.

**Exported columns** — zero values render as "—" (visual cue that nothing has shipped yet). Planned and Remaining show actual numbers including 0.

## Status tag colors

| Status | Color |
|---|---|
| active | blue |
| completed | green |
| closed | grey (default) |
| cancelled | red (never appears in list) |

## Create modal

`ContractCreate.tsx` — Ant Design Modal + Form with two-column layout.

Fields: contract_number, export_firm (ExportFirmSelect), import_firm (ImportFirmSelect), season (SeasonSelect), incoterm (Select: FCA/CIP/DAP/CIF/FOB/EXW/DDP/DAT), planned_trucks (InputNumber), planned_quantity_kg, planned_amount_usd, start_date (DatePicker), end_date (optional), customer (optional, CustomerSelect), contract_type (optional Input).

On submit: `POST /api/v1/contracts/contracts/` → sonner toast on success → ProTable refetches. DRF field-level errors displayed inline on the relevant Form.Item.

## Detail page (Slice A placeholder)

`ContractDetail.tsx` — Ant Design Descriptions block with all scalar fields. Rich tabs (Invoices / Shipments / Passports / Comments) are deferred to Slice B.

## Files

| File | Role |
|---|---|
| `frontend/src/types/contract.ts` | IContract, IContractDetail, IContractCreatePayload, ContractStatus |
| `frontend/src/hooks/useContracts.ts` | useContracts(), useContract(), useCreateContract() |
| `frontend/src/pages/contracts/ContractList.tsx` | List page |
| `frontend/src/pages/contracts/ContractCreate.tsx` | Create modal (imported by ContractList) |
| `frontend/src/pages/contracts/ContractDetail.tsx` | Detail placeholder |
| `frontend/src/components/SeasonSelect.tsx` | Self-fetching Season select |

## API

`GET /api/v1/contracts/contracts/` — list (default: active only)
`GET /api/v1/contracts/contracts/?include_ended=true` — active + completed + closed
`POST /api/v1/contracts/contracts/` — create (export_manager / director / admin)
`GET /api/v1/contracts/contracts/{id}/` — detail

See [[../reference/contracts-contract-model]] for full field list and backend implementation notes.
