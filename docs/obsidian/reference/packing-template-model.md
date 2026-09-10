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
  `ContractSale` is linked yet (their weight/quota *are* set). Approved-quota guard → 400. Each of
  those firms gets its packing when its own contract is linked — see *Linking a contract
  afterwards* below. A firm whose contract is never linked has no sale and so no packing.
- `POST scope:'firm'` — edit one firm's packing values (`.update()`).
### Linking a contract afterwards (fixed 2026-09-10)

The apply-time copy is a **one-shot push**: it updates zero rows for a firm whose
`ContractSale` does not exist yet. An operator who picks the template *before* linking
contracts used to end up with a sale carrying no packing at all, and that firm's Invoice
rendered with **no pieces, no gross and no pallet sentence** while the CMR — which reads the
truck template directly — printed correctly. `no_sale_firms` said so in the response and the
frontend never read it.

`link_split_to_contract` now closes the gap:

- It **refuses** a link on a truck with no `packing_template` (`ValueError` → 400), naming the
  fix. The Sheet's contracts panel shows the backend sentence instead of a generic toast.
- After creating the bridge sale it **back-fills only the blank** packing columns from the
  firm's share, so a number the operator typed in the packing panel survives a re-link.
- It back-fills only while the share's `net_kg` still equals the sale's `quantity_kg`. A
  `scope:'swap'` that reported `packing_swapped: false` exchanged the two firms' weights but
  left `split_order` alone, so the positional share now belongs to the other firm; writing it
  would put a gross and box count against a net they were never cut for. The columns stay
  blank instead, and the operator fills them in the packing panel.

Both this and the apply endpoint read the firm ↔ share mapping from one helper,
`template_share_for(shipment, export_firm_id, template=None)` — the mapping is **positional**
(Nth firm split by `split_order` ↔ Nth share by `share_order`), and duplicating that rule risks
printing one firm's boxes on another firm's invoice. It returns `None` when the share count no
longer matches the firm count.

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
  (ADR-023). It deliberately does **not** read `shipment.packing_template` — the invoice is
  per-firm and the template is whole-truck, so the share must already be on the sale.
- `build_cmr_context`: reads `shipment.packing_template` whole-truck; `gross_with_pallet =
  gross_kg`, `gross_without_pallet = gross_kg − pallet_weight_kg`.

## UI

- **Sheet** `packing` popover (`ShipmentPackingPanel`) — pick a template (filtered to the
  firm count), per-firm **editable** numbers, live Σ-check, **⇄ swap**.
- **Admin** `/admin/packing-templates` — whole-truck fields + a `Form.List` shares editor.

See [[../processes/document-generation]] and [[contracts-contract-sale-model]].
