---
title: Contract Model (contracts app)
tags: [reference, models, contracts, p4]
---

# Contract Model

App: `apps.contracts` | DB table: `contracts_contract` | Slice: A (foundation)

## Purpose

A `Contract` is the signed sale agreement between one YGT export firm (seller) and one foreign import firm (buyer) for a given season. Example: `177/25-YGT-EXP`, "36 trucks, 651 600 kg, $566 892, FCA".

Contracts are the root of the P4 module. Contract sales (reverse accessor `contract.sales`), payments, and PasportSdelki attach to them in later slices.

## Fields

| Field | Type | Notes |
|---|---|---|
| `contract_number` | `CharField(100, unique)` | Cyrillic collation. Format e.g. `177/25-YGT-EXP, 22.09.2025` |
| `season` | FK → `core.Season` | PROTECT, nullable |
| `export_firm` | FK → `core.ExportFirm` | PROTECT, related `contracts` |
| `import_firm` | FK → `core.ImportFirm` | PROTECT, related `contracts` |
| `customer` | FK → `core.Customer` | PROTECT, nullable |
| `contract_type` | `CharField(20)` | Default `'EXPORT'` |
| `incoterm` | `CharField(10)` | e.g. `FCA`, blank OK. Create form defaults to `FCA` |
| `contract_date` | `DateField` | nullable. The date the **document** carries — printed in the contract header after `ş. Asgabat` and embedded in the auto-generated `contract_number`. Falls back to `start_date` on rows created before this field existed |
| `start_date` | `DateField` | nullable. Printed in **§2.6** of the contract ("delivery until") |
| `end_date` | `DateField` | nullable. Validity date in §8.1 |
| `planned_trucks` | `IntegerField` | nullable. Create form keeps it in sync with `planned_quantity_kg` at **18 100 kg / truck** |
| `planned_quantity_kg` | `DecimalField(12,2)` | nullable |
| `planned_amount_usd` | `DecimalField(12,2)` | nullable. Create form derives it as `planned_quantity_kg × price_per_kg` |
| `price_per_kg` | `DecimalField(8,4)` | nullable. Agreed USD per net kg — what the contract document prints as the unit price (derived from the totals for older rows) |
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

`remaining_usd = exported_amount_usd - payment_received_usd` is recomputed on every save. This is a placeholder until the Slice B/C rollup service (`contracts.services.rollup.rollup_contract_totals`) takes ownership and writes all five denormalized fields atomically from sale/payment aggregates.

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

## ContractAttachment (PDF documents)

App: `apps.contracts` | DB table: `contracts_contract_attachment` | Migration: `0003`

A PDF document attached to a contract (signed scan, annex, …) for download/inline preview. Mirrors `feedback.FeedbackAttachment`. The detail response nests read-only `attachments[]` metadata (no file URL — files are served only through the authenticated download action).

| Field | Type | Notes |
|---|---|---|
| `contract` | FK → `contracts.Contract` | `CASCADE`, related `attachments` |
| `file` | `FileField(upload_to='contracts/%Y/%m/')` | the stored PDF |
| `original_filename` | `CharField(255)` | sanitised basename of the upload |
| `mime_type` | `CharField(100)` | always `application/pdf` |
| `size_bytes` | `IntegerField` | |
| `uploaded_by` | FK → `core.User` | PROTECT |
| `uploaded_at` | `DateTimeField` | auto_now_add |

**Validation** (`contracts/services/files.py::validate_contract_document`): PDF only — `.pdf` extension + `%PDF-` magic bytes, ≤20 MB per file, max 20 per contract. Runs before any DB write.

### Attachment endpoints (actions on `ContractViewSet`)

| Method | URL | Permission | Notes |
|---|---|---|---|
| POST | `…/contracts/{id}/attachments/` | `can_create` | multipart `files` (one or more); validates all before persisting; returns created metadata |
| GET | `…/contracts/{id}/attachments/{attId}/download/` | `can_view` | `FileResponse`, `Content-Disposition: inline` (browser previews the PDF) |
| DELETE | `…/contracts/{id}/attachments/{attId}/` | `can_delete` | removes the file + row |

Permission maps by HTTP method via `DynamicResourcePermission` on `resource_code='contract'`. Downloads are **authenticated** (never a direct `/media/` URL) because contract documents are legal/financial records.

The status/FK filtering in `get_queryset` applies to the **list** action only — detail (`retrieve`) and the attachment actions resolve by pk across every status, so a contract's documents stay accessible after it is completed or closed (when they are most needed — settlement, disputes).

## Upcoming (not in Slice A)

- Slice B: ContractSale model + rollup service
- Slice C: Payment model + rollup hook + remaining_usd ownership moves here
- Slice D: PasportSdelka model
- Slice F: Status transition endpoint + audit log
