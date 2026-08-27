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
  sets `Shipment.packing_template`. **All three writes are one `transaction.atomic()`.**
  Returns **`no_sale_firms`** — firm ids whose packing couldn't be copied because no
  `ContractSale` is linked yet (their weight/quota *are* set). Approved-quota guard → 400.
- `POST scope:'firm'` — edit one firm's packing values (`.update()`).
- `POST scope:'swap'` — exchange two firms' weight + packing. **Rebuilds the full weight map
  and swaps only the two, so the other firms on a 3+ firm truck are preserved** (a bare
  two-firm map would delete the rest — the fix for the review's HIGH finding). Returns
  **`packing_swapped`** (false if a firm has no sale, so weight swapped but packing didn't).

## Catalog CRUD — `/api/v1/export/packing-templates/`

`PackingTemplateViewSet` — nested `shares` written replace-all in the serializer. Delete of an
in-use template → **409** (global `ProtectedError` handler). Seeded by `seed_packing_templates`.

**Permissions (changed 2026-08-27).** Reads stay open to any authenticated user — the Sheet
packing panel's dropdown lists templates for every role that picks one on a truck, so gating
GET would break it. Writes moved off the hardcoded role tuple onto the permission matrix:
`resource_write_permission('packing_template')` reads the `packing_template` row in
`RoleResourcePermission` (POST → `can_create`, PATCH → `can_edit`, DELETE → `can_delete`;
no row → no writes). Seeded holders: admin, director, export_manager, boss, **document_team**
(full CRUD — they build the CMR/Invoice packets, so they own the catalog they pick from).
`document_team` also gains the `export.packing_presets` page. Registry entry lives in
`permission_registry.RESOURCE_REGISTRY`; back-fill migration `core/0035`.

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
