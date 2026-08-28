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
| (none) | Delete action (right-fixed, roles with `contract.can_delete` only) |

Columns in the Planned, Exported, Remaining, and Payments groups are hidden on small screens (`responsive: ['md']`).

### Toolbar (left to right)

1. **+ Şertnama goş** — opens the create modal (primary green button)
2. **Search** — client-side filter on `contract_number` (fine for ~30 contracts)
3. **Status filter** — All / Active / Completed / Closed
4. **Show ended toggle** — Switch; off by default. URL-synced via `?ended=1` query param. When on: passes `includeEnded=true` → backend returns active + completed + closed. Cancelled is never shown.

### Delete action

A right-fixed trash button on each row, appended to the column set **only** when
`canDo(user, 'contract', 'delete')` — the dynamic matrix (`contract` resource,
`can_delete`), toggled per role in *Admin → Permissions*. Kept on the One-time
tab as well as Framework: one-time contracts are the auto-created ad-hoc ones and
are the likeliest thing to need removing.

Deleting is only offered for an **unused** contract — one with no `ContractSale`
attached. The list row carries `has_sales` (annotated server-side with `Exists`,
not `Count`: an aggregate would drag every `select_related` column into `GROUP BY`
and MSSQL cannot group by `nvarchar(max)`). When `has_sales` is true the button
renders disabled with a tooltip; the backend refuses the same case with **409**.

The confirm dialog (`Modal.confirm`, danger) warns that any uploaded documents go
with it — `ContractAttachment` is `on_delete=CASCADE`, so its rows are removed
(the files themselves stay on disk). The delete is permanent; there is no undo.

The row's own `onClick` navigates to the detail page, so the button calls
`e.stopPropagation()`.

> The list never returns `cancelled` contracts, so a cancelled-and-unused
> contract has no row to delete from here. `DELETE` by id still works.

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

Fields: contract_number, export_firm (ExportFirmSelect), import_firm (ImportFirmSelect), season (SeasonSelect), incoterm (Select: FCA/CIP/DAP/CIF/FOB/EXW/DDP/DAT, **defaults to FCA**), planned_trucks (InputNumber), planned_quantity_kg, price_per_kg, planned_amount_usd, contract_date (DatePicker, defaults to today), start_date (DatePicker), end_date (optional), customer (optional, CustomerSelect), contract_type (optional Input).

Auto-calculation (`onValuesChange`): trucks ⇄ quantity convert through **18 100 kg
per truck** (editing either fills the other), and `planned_amount_usd` is always
`planned_quantity_kg × price_per_kg`. All three stay editable.

The **deal passport** (`passport_sdelka`) is no longer asked for here — the bank
issues it after signing, so the field stays on the model (searchable via `?search=`,
shown on the detail screen) but is filled by import, not at creation.

On submit: `POST /api/v1/contracts/contracts/` → sonner toast on success → ProTable refetches. DRF field-level errors displayed inline on the relevant Form.Item.

## Detail page (Slice A placeholder)

`ContractDetail.tsx` — Ant Design Descriptions block with all scalar fields. Rich tabs (Sales / Shipments / Passports / Comments) are deferred to Slice B.

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
`DELETE /api/v1/contracts/contracts/{id}/` — delete an unused contract (204). Returns **409** when the contract has sales, both from the explicit guard in `ContractViewSet.destroy` and, as a race net, from the global `ProtectedError` handler in `apps/core/exceptions.py`.

See [[../reference/contracts-contract-model]] for full field list and backend implementation notes.
