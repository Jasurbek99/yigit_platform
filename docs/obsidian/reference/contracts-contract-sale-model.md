---
title: Contract Sale Model (contracts app)
tags: [reference, models, contracts, p4]
---

# Contract Sale Model

App: `apps.contracts` | DB table: `contracts_contract_sale` | Slice: B

> Renamed from `Invoice` → `ContractSale` to avoid confusion with the *invoice document* the platform generates. The fields `invoice_number` / `invoice_date` keep their names — they name the invoice document's number/date, not the record.

## Purpose

A `ContractSale` represents **one export firm's share of a truck** — one row in the `2-Sales` Excel sheet — against a parent `Contract`. It is **NOT** a whole truck: one physical truck is commonly split across 2 (~35.6%), rarely 3, export firms to keep each invoice under the **$10,000** threshold, so **1 truck → 1..3 `ContractSale` rows**, each with its own invoice/CMR/contract. Each non-void sale increments the contract's `exported_trucks` counter and accumulates `exported_quantity_kg` / `exported_amount_usd` via the rollup service.

The truck itself is `export.Shipment`; this row bridges to it by the identity key **`(shipment, export_firm)`** — the same firm-share as `export.ShipmentFirmSplit`. The `shipment` FK is nullable and **not yet populated** by the 2-Sales importer (truck reconstruction by `(truck_plate + date)` is Slice 3). See **ADR-023** for the full `Shipment → FirmSplit → Contract` model, the bridge invariant, and the two distinct identifiers (`shipment_code` vs `contract_no`).

## Fields

| Field | Type | Notes |
|---|---|---|
| `contract` | FK → `contracts.Contract` | PROTECT, required |
| `shipment` | FK → `export.Shipment` | PROTECT, nullable — wired in later slice |
| `invoice_number` | `IntegerField` | Unique per contract (see unique_together). Names the invoice document's number. |
| `invoice_date` | `DateField` | Required. Names the invoice document's date. |
| `serial_truck_number` | `IntegerField` | nullable — sequential truck serial for the contract |
| `export_firm` | FK → `core.ExportFirm` | PROTECT, nullable — denormalized for reporting |
| `import_firm` | FK → `core.ImportFirm` | PROTECT, nullable — denormalized for reporting |
| `gross_kg` / `box_count` / `pallet_count` / `pallet_weight_kg` | `Decimal`/`Int` | nullable — per-firm packing **override** for this sale's **Invoice**. Null = use the value **derived** from the truck's `PackingPreset` split by this firm's weight share. Net is never here (it is `quantity_kg`). See [[packing-preset-model]]. |
| `incoterm` | `CharField(10)` | blank OK, e.g. `FCA` |
| `quantity_kg` | `DecimalField(10,2)` | nullable |
| `price_per_kg` | `DecimalField(8,4)` | nullable |
| `total_usd` | `DecimalField(12,2)` | nullable; auto-computed if null/0 AND both qty+price are set |
| `passport_sdelka` | `CharField(100)` | Cyrillic collation, blank OK |
| `scan_uploaded` | `BooleanField` | default False |
| `status` | `CharField(20)` | choices: draft / sent / paid / void |
| `created_at` | `DateTimeField` | auto_now_add |
| `updated_at` | `DateTimeField` | auto_now |

## Status choices

| Value | Counts toward rollup? | Meaning |
|---|---|---|
| `draft` | Yes | Not yet sent to buyer |
| `sent` | Yes | **Default on create** — dispatched, invoice issued |
| `paid` | Yes | Payment received |
| `void` | No | Cancelled/invalidated sale |

Only `void` is excluded from rollup aggregates. All other statuses count.

A proper status-transition endpoint with audit trail is deferred to Slice F. Until then, PATCH `status` directly.

## Meta

- `db_table = 'contracts_contract_sale'`
- `unique_together = [('contract', 'invoice_number')]`
- `ordering = ['contract_id', 'invoice_number']`

## `save()` behaviour

1. **Auto-compute `total_usd`**: if `total_usd` is null or `0` AND both `quantity_kg` and `price_per_kg` are non-null, computes `total_usd = quantity_kg × price_per_kg` (Decimal multiplication — no float).

2. **Rollup**: calls `rollup_contract_totals(self.contract_id)` AFTER `super().save()` so the aggregate query sees the new/updated row.

3. **Contract reassignment detection**: uses `from_db()` to snapshot `_loaded_contract_id`. If `contract_id` changes (sale moved to another contract), both old and new contracts are re-rolled.

## `delete()` behaviour

Calls `rollup_contract_totals(contract_id)` AFTER `super().delete()` so the contract's exported totals drop correctly.

## Rollup service

`apps.contracts.services.rollup.rollup_contract_totals(contract_id)` is the single writer of `Contract`'s five denormalized fields. It:

1. Opens a `transaction.atomic()` block.
2. Locks the contract row with `select_for_update()`.
3. Aggregates non-void sales: `COUNT(*)`, `SUM(quantity_kg)`, `SUM(total_usd)`.
4. Reads current `payment_received_usd` from the locked row (Slice C will update this).
5. Computes `remaining_usd = exported_amount_usd - payment_received_usd`.
6. Updates `last_invoice_number = MAX(invoice_number)`.
7. Writes all fields via `.update()` (bypasses `Contract.save()`).

## API endpoints

| Method | URL | Serializer | Notes |
|---|---|---|---|
| GET | `/api/v1/contracts/sales/` | `ContractSaleListSerializer` | Flat; supports `?contract=<id>` and `?status=<code>` filters |
| POST | `/api/v1/contracts/sales/` | `ContractSaleCreateSerializer` | export_manager / director / admin |
| GET | `/api/v1/contracts/sales/{id}/` | `ContractSaleDetailSerializer` | Includes `editable_fields` |
| PATCH | `/api/v1/contracts/sales/{id}/` | `ContractSaleCreateSerializer` | Same roles as create |
| DELETE | `/api/v1/contracts/sales/{id}/` | — | **admin / superuser only** |

Query params:
- `?contract=<id>` — filter to a specific contract's sales
- `?status=<code>` — filter by status (draft / sent / paid / void)

The document-generation action lives on the same viewset: `GET /api/v1/contracts/sales/{id}/document/` (see [[../processes/document-generation]]).

## Permissions

| Action | Allowed roles |
|---|---|
| Read (list, detail) | Any authenticated user |
| Create, update | export_manager, director, admin |
| Delete | admin, superuser only |

Resource `resource_code='sale'` (renamed from `invoice`).

## Validation

`ContractSaleCreateSerializer.validate()` enforces:
1. Either (`quantity_kg` AND `price_per_kg`) OR `total_usd` must be provided — no money info at all is rejected (400).
2. Parent contract must not be `cancelled` — 400 with clear error message.
3. Duplicate `(contract, invoice_number)` → 400 via DRF UniqueTogetherValidator.

## Upcoming (not in Slice B)

- Slice C: `InvoicePayment` model; rollup service gains `payment_received_usd` aggregation from payments
- Slice D: `PasportSdelka` model; `passport_sdelka` field wired to FK
- Slice F: Status transition endpoint with audit trail
