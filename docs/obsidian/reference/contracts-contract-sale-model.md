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
| `gross_kg` / `box_count` / `pallet_count` / `pallet_weight_kg` | `Decimal`/`Int` | nullable — this firm's **explicit** packing for its **Invoice**, copied from the applied `PackingTemplate` share (then editable). Net is not here (it is `quantity_kg` / the firm-split weight). See [[packing-template-model]]. |
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

The bridge row itself is created by `POST /api/v1/contracts/shipment-firm-contracts/`
(`link_split_to_contract`). Since 2026-09-10 that call **requires the truck to carry a packing
template** and copies the firm's share onto the new sale's `gross_kg` / `box_count` /
`pallet_count` / `pallet_weight_kg`, filling only columns that are still blank. Without it a
sale linked after the template was applied kept NULL packing and its Invoice printed no pieces,
gross or pallet line — see [[packing-template-model]].

### One-time contracts require a price (2026-09-10)

`mode: 'one_time'` on that POST also **requires `price_per_kg`** — agreed USD per net kg, a
positive number up to `9999.9999`. Omit it and the call is a 400 whose `error` sentence the
Sheet panel shows verbatim; nothing is created (the whole call is one transaction).

The reason is the contract document. A framework contract carries its own signed terms, but a
one-time contract is created on the spot with none, and `build_contract_context` reads three of
its placeholders straight off the contract row:

| Placeholder in `contract_kz.docx` | Source field |
|---|---|
| `price` | `Contract.price_per_kg` |
| `quantity` | `Contract.planned_quantity_kg` |
| `total_sum`, `total_sum_words_tk`, `total_sum_words_ru` | `Contract.planned_amount_usd` |

All three were NULL on every auto-created one-time contract, so the generated .docx printed a
blank price, quantity and total. `_create_one_time_contract` now sets all three from the one
truck: the price the operator typed, the firm split's `weight_kg`, and their product rounded to
cents. It also stamps `contract_date` (the document header used to fall back to `start_date`).

The price lands on the bridge `ContractSale.price_per_kg` too, so the Invoice's price column
reads it. `ContractSale.total_usd` still takes the **split's own `amount_usd`** whenever that is
set — that is the export side's money and this call must not rewrite it; only a split with no
amount gets `weight × price`. The reverse is true as well: overriding the suggested price does
**not** rewrite `ShipmentFirmSplit.amount_usd`, so a deliberate override leaves the truck's
amount and the contract's planned amount describing different things.

> Caveat carried over from the template: `total_sum` prints to 2 decimals but the spelled-out
> amount voices `int(amount)` only. `weight × price` is rarely a round dollar figure, so the
> words now commonly omit cents the figure shows. Pre-existing behaviour, unchanged here.

**Fixing a mistyped price.** Calling the endpoint again with `mode: 'one_time'` does **not**
correct the contract — it mints a second auto-numbered one, repoints the sale at it and leaves
the first with no sales, consuming a number in the per-firm/per-year sequence. The orphan is
deletable from the contract list (unused contracts are). Pinned by
`test_a_second_create_mints_a_new_contract_and_orphans_the_first`.

Use **Edit plan** on the contract detail page instead (added 2026-09-10) — a `PATCH` over the
four planned figures, and the only way to change any of them once the contract exists. It
deliberately leaves `ContractSale.price_per_kg` alone: that is what the *invoice* prints, an
invoice may already be issued, and rewriting a document that has left the building without
being asked is worse than the drift. Correct the sale on the Faktura tab when it needs it.
See [[../screens/contract-detail]].

Pre-existing one-time contracts created before this date keep their NULL price and still
generate a blank-price document; fill them in on the contract detail page.

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
