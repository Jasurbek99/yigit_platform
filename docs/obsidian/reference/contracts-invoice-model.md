---
title: Invoice Model (contracts app)
tags: [reference, models, contracts, p4]
---

# Invoice Model

App: `apps.contracts` | DB table: `contracts_invoice` | Slice: B

## Purpose

An `Invoice` represents one truck dispatched against a parent `Contract` — one row in the `2-Sales` Excel sheet. Each non-void invoice increments the contract's `exported_trucks` counter and accumulates `exported_quantity_kg` / `exported_amount_usd` via the rollup service.

Invoices attach to a `Shipment` once the truck loads (optional FK, wired in a later slice).

## Fields

| Field | Type | Notes |
|---|---|---|
| `contract` | FK → `contracts.Contract` | PROTECT, required |
| `shipment` | FK → `export.Shipment` | PROTECT, nullable — wired in later slice |
| `invoice_number` | `IntegerField` | Unique per contract (see unique_together) |
| `invoice_date` | `DateField` | Required |
| `serial_truck_number` | `IntegerField` | nullable — sequential truck serial for the contract |
| `export_firm` | FK → `core.ExportFirm` | PROTECT, nullable — denormalized for reporting |
| `import_firm` | FK → `core.ImportFirm` | PROTECT, nullable — denormalized for reporting |
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
| `void` | No | Cancelled/invalidated invoice |

Only `void` is excluded from rollup aggregates. All other statuses count.

A proper status-transition endpoint with audit trail is deferred to Slice F. Until then, PATCH `status` directly.

## Meta

- `db_table = 'contracts_invoice'`
- `unique_together = [('contract', 'invoice_number')]`
- `ordering = ['contract_id', 'invoice_number']`

## `save()` behaviour

1. **Auto-compute `total_usd`**: if `total_usd` is null or `0` AND both `quantity_kg` and `price_per_kg` are non-null, computes `total_usd = quantity_kg × price_per_kg` (Decimal multiplication — no float).

2. **Rollup**: calls `rollup_contract_totals(self.contract_id)` AFTER `super().save()` so the aggregate query sees the new/updated row.

3. **Contract reassignment detection**: uses `from_db()` to snapshot `_loaded_contract_id`. If `contract_id` changes (invoice moved to another contract), both old and new contracts are re-rolled.

## `delete()` behaviour

Calls `rollup_contract_totals(contract_id)` AFTER `super().delete()` so the contract's exported totals drop correctly.

## Rollup service

`apps.contracts.services.rollup.rollup_contract_totals(contract_id)` is the single writer of `Contract`'s five denormalized fields. It:

1. Opens a `transaction.atomic()` block.
2. Locks the contract row with `select_for_update()`.
3. Aggregates non-void invoices: `COUNT(*)`, `SUM(quantity_kg)`, `SUM(total_usd)`.
4. Reads current `payment_received_usd` from the locked row (Slice C will update this).
5. Computes `remaining_usd = exported_amount_usd - payment_received_usd`.
6. Updates `last_invoice_number = MAX(invoice_number)`.
7. Writes all fields via `.update()` (bypasses `Contract.save()`).

## API endpoints

| Method | URL | Serializer | Notes |
|---|---|---|---|
| GET | `/api/v1/contracts/invoices/` | `InvoiceListSerializer` | Flat; supports `?contract=<id>` and `?status=<code>` filters |
| POST | `/api/v1/contracts/invoices/` | `InvoiceCreateSerializer` | export_manager / director / admin |
| GET | `/api/v1/contracts/invoices/{id}/` | `InvoiceDetailSerializer` | Includes `editable_fields` |
| PATCH | `/api/v1/contracts/invoices/{id}/` | `InvoiceCreateSerializer` | Same roles as create |
| DELETE | `/api/v1/contracts/invoices/{id}/` | — | **admin / superuser only** |

Query params:
- `?contract=<id>` — filter to a specific contract's invoices
- `?status=<code>` — filter by status (draft / sent / paid / void)

## Permissions

| Action | Allowed roles |
|---|---|
| Read (list, detail) | Any authenticated user |
| Create, update | export_manager, director, admin |
| Delete | admin, superuser only |

## Validation

`InvoiceCreateSerializer.validate()` enforces:
1. Either (`quantity_kg` AND `price_per_kg`) OR `total_usd` must be provided — no money info at all is rejected (400).
2. Parent contract must not be `cancelled` — 400 with clear error message.
3. Duplicate `(contract, invoice_number)` → 400 via DRF UniqueTogetherValidator.

## Upcoming (not in Slice B)

- Slice C: `InvoicePayment` model; rollup service gains `payment_received_usd` aggregation from payments
- Slice D: `PasportSdelka` model; `passport_sdelka` field wired to FK
- Slice F: Status transition endpoint with audit trail
