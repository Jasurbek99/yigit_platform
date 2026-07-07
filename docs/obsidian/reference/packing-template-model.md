---
title: Packing Template Model (export app)
tags: [reference, models, export, p3, p4]
---

# Packing Template Model

App: `apps.export` | DB tables: `export_packing_template` + `export_packing_template_share`

Digitizes one Excel **`gross net`** row: the **whole-truck** packing plus each firm's
**explicit share**. Replaces the earlier `PackingPreset` + `SplitTemplate` + derivation
(migration `export.0054` deletes both and repoints `Shipment.packing_preset` →
`packing_template`). See [[../how_works/packing]] for the plain-language version.

## Purpose

Documents are prepared **before** loading, so the real weighbridge numbers don't exist —
the team picks a standard configuration. One `PackingTemplate` = one full row: the truck
totals (→ **CMR**) and a list of firm shares (→ each firm's **Invoice**). Nothing is
derived; every number is typed and visible.

## Models

**`PackingTemplate`** (parent — whole truck): `name`, `product_type` (`tomato`/`pepper` —
"Bulgar" = bell pepper = `pepper`), `net_kg`/`gross_kg` `Dec(10,2)`, `box_count` `Int`,
`pallet_count` `Dec(5,1)` (holds 16.5), `pallet_weight_kg` `Dec(8,2)`, `is_active`,
`sort_order`. BRUT = gross **with** pallets.

**`PackingTemplateShare`** (child — one firm's share, CASCADE): `template` FK, `share_order`,
same five packing numbers.

**`Shipment.packing_template`** FK → `PackingTemplate` (PROTECT, nullable) — the applied
truck template; the CMR reads its whole-truck values. **`ContractSale.gross_kg`/`box_count`/
`pallet_count`/`pallet_weight_kg`** hold each firm's packing (copied from the share on apply,
then editable per truck). NET per firm stays `quantity_kg` / `ShipmentFirmSplit.weight_kg`.

## Applying a template — `/api/v1/contracts/shipment-packing/`

`ShipmentPackingView` (contracts — may read/write export; reads open, writes gated to
admin/director/export_manager/document_team):

- `GET ?shipment=<id>` → `whole_truck` (template values) + `rows[]` (per-firm weight + actual
  packing) + `total_firm_weight` + `consistent` (Σ weights == truck net).
- `POST scope:'template'` — validates share-count == firm-count, sets each firm's weight from
  the share nets via the **quota-safe** `set_firm_splits` path (so `kg_used = weight_kg`
  stays correct — [[quota]]), copies each share's packing onto the firm's `ContractSale`,
  sets `Shipment.packing_template`. Approved-quota guard → 400.
- `POST scope:'firm'` — edit one firm's packing values (`.update()`).
- `POST scope:'swap'` — exchange two firms' weight + packing.

## Catalog CRUD — `/api/v1/export/packing-templates/`

`PackingTemplateViewSet` — nested `shares` written replace-all in the serializer. Read: any
auth; write: admin/director/export_manager. Delete of an in-use template → **409** (global
`ProtectedError` handler). Seeded by `seed_packing_templates`.

## Document builders (`document_context.py`)

- `build_invoice_context`: NET = `quantity_kg`; gross/boxes/pallets = the sale's explicit
  packing (fallback to the whole-truck shipment fields when unset). Never `weight_net`
  (ADR-023).
- `build_cmr_context`: reads `shipment.packing_template` whole-truck; `gross_with_pallet =
  gross_kg`, `gross_without_pallet = gross_kg − pallet_weight_kg`.

## UI

- **Sheet** `packing` popover (`ShipmentPackingPanel`) — pick a template (filtered to the
  firm count), per-firm **editable** numbers, live Σ-check, **⇄ swap**.
- **Admin** `/admin/packing-templates` — whole-truck fields + a `Form.List` shares editor.

See [[../processes/document-generation]] and [[contracts-contract-sale-model]].
