---
title: Contract Model (contracts app)
tags: [reference, models, contracts, p4]
---

# Contract Model

App: `apps.contracts` | DB table: `contracts_contract` | Slice: A (foundation)

## Purpose

A `Contract` is the signed sale agreement between one YGT export firm (seller) and one foreign import firm (buyer) for a given season. Example: `177/25-YGT-EXP`, "36 trucks, 651 600 kg, $566 892, FCA".

Contracts are the root of the P4 module. Invoices, payments, and PasportSdelki attach to them in later slices.

## Fields

| Field | Type | Notes |
|---|---|---|
| `contract_number` | `CharField(100, unique)` | Cyrillic collation. Format e.g. `177/25-YGT-EXP, 22.09.2025` |
| `season` | FK → `core.Season` | PROTECT, nullable |
| `export_firm` | FK → `core.ExportFirm` | PROTECT, related `contracts` |
| `import_firm` | FK → `core.ImportFirm` | PROTECT, related `contracts` |
| `customer` | FK → `core.Customer` | PROTECT, nullable |
| `contract_type` | `CharField(20)` | Default `'EXPORT'` |
| `incoterm` | `CharField(10)` | e.g. `FCA`, blank OK |
| `start_date` | `DateField` | nullable |
| `end_date` | `DateField` | nullable |
| `planned_trucks` | `IntegerField` | nullable |
| `planned_quantity_kg` | `DecimalField(12,2)` | nullable |
| `planned_amount_usd` | `DecimalField(12,2)` | nullable |
| `exported_trucks` | `IntegerField` | default 0; written by rollup service (Slice B+) |
| `exported_quantity_kg` | `DecimalField(12,2)` | default 0; rollup-owned |
| `exported_amount_usd` | `DecimalField(12,2)` | default 0; rollup-owned |
| `payment_received_usd` | `DecimalField(12,2)` | default 0; rollup-owned |
| `remaining_usd` | `DecimalField(12,2)` | Ostatok. Auto-computed in `save()` as placeholder until rollup service (Slice C) takes ownership |
| `last_invoice_number` | `IntegerField` | nullable; tracks last assigned invoice serial |
| `sent_to_unk` | `BooleanField` | default False |
| `status` | `CharField(20)` | choices: active / completed / closed / cancelled |
| `created_by` | FK → `AUTH_USER_MODEL` | PROTECT, nullable |
| `created_at` | `DateTimeField` | auto_now_add |
| `updated_at` | `DateTimeField` | auto_now |

## Status choices

| Value | Meaning |
|---|---|
| `active` | In-force, trucks being dispatched |
| `completed` | All planned trucks dispatched |
| `closed` | Settled; payments reconciled |
| `cancelled` | Voided — never returned by list endpoint |

## Computed properties (not stored)

| Property | Formula |
|---|---|
| `trucks_remaining` | `planned_trucks - exported_trucks` |
| `quantity_remaining_kg` | `planned_quantity_kg - exported_quantity_kg` |
| `amount_remaining_usd` | `planned_amount_usd - exported_amount_usd` |
| `percent_consumed` | `round(exported_trucks / planned_trucks * 100)`, 0 if not planned |
| `ostatok_usd` | alias for `remaining_usd` |

## `save()` behaviour

`remaining_usd = exported_amount_usd - payment_received_usd` is recomputed on every save. This is a placeholder until the Slice B/C rollup service (`contracts.services.rollup.rollup_contract_totals`) takes ownership and writes all five denormalized fields atomically from invoice/payment aggregates.

## API endpoints

| Method | URL | Serializer | Notes |
|---|---|---|---|
| GET | `/api/v1/contracts/contracts/` | `ContractListSerializer` | Default: active only; `?include_ended=true` adds completed+closed |
| POST | `/api/v1/contracts/contracts/` | `ContractCreateSerializer` | export_manager / director / admin only |
| GET | `/api/v1/contracts/contracts/{id}/` | `ContractDetailSerializer` | Includes `editable_fields` |
| PATCH | `/api/v1/contracts/contracts/{id}/` | `ContractCreateSerializer` | Same roles as create |

Query params:
- `?season=<id>` — filter by season
- `?export_firm=<id>` — filter by export firm
- `?import_firm=<id>` — filter by import firm
- `?status=<value>` — explicit status filter (cancelled always blocked)
- `?include_ended=true` — include completed + closed alongside active

## Upcoming (not in Slice A)

- Slice B: Invoice model + rollup service
- Slice C: Payment model + rollup hook + remaining_usd ownership moves here
- Slice D: PasportSdelka model
- Slice F: Status transition endpoint + audit log
