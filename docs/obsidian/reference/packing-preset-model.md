---
title: Packing Preset Model (export app) — the digital "gross net"
tags: [reference, models, export, contracts, p4, documents]
---

# Packing Preset Model

App: `apps.export` | DB table: `export_packing_preset`

## Purpose

`PackingPreset` is the digital form of the Excel **`gross net`** sheet — a **pick-list
catalog** of standard packing configurations. The document team prepares export
documents (Invoice, CMR) **before** a truck is loaded, so the real weighbridge numbers
don't exist yet; they **select** the config that matches the planned **product type +
pallet count + split share**, and the documents fill from it.

The catalog holds **whole-truck configs only**. You pick **one** on the shipment
(`Shipment.packing_preset`, in the Sheet) — it fills the **CMR**, and each firm's Invoice
packing is **derived** from it by that firm's weight share (`services/packing_split.py`).
**Poka-yoke:** the per-firm values always sum back to the truck, so an inconsistent split
(e.g. 10 000 + 10 000 on an 18 000 truck) is impossible; NET per firm is the firm's own
weight (`ContractSale.quantity_kg`), never derived.

For a `10000/8000` truck you pick one "18 000 / 20 400 gross / 3 040 boxes" config: YGT
gets `10000/18000` of it, HJ gets `8000/18000`. A firm may **override** any derived
gross/box/pallet value (`ContractSale.gross_kg` etc.) when a real truck differs; the Sheet
panel shows a live Σ-check. Because the catalog is whole-truck-only, a half-truck config
can never be mistakenly picked as a whole truck.

## Fields

| Field | Type | Notes |
|---|---|---|
| `name` | `CharField(120)` | Cyrillic collation; the picker label |
| `product_type` | `CharField(10)` | choices `tomato` / `pepper` (default tomato). "Bulgar" (Turkmen for bell pepper) rows are just `pepper`. |
| `net_kg` | `DecimalField(10,2)` | nullable — the **official** cap (NET), not the real weight |
| `gross_kg` | `DecimalField(10,2)` | nullable — BRUT = gross **WITH** pallets |
| `box_count` | `IntegerField` | nullable — YASIK (box count) |
| `pallet_count` | `DecimalField(5,1)` | nullable — Decimal: a 2-firm share is `16.5` pallets |
| `pallet_weight_kg` | `DecimalField(8,2)` | nullable — PALET AGRAMY (pallet tare) |
| `is_active` | `BooleanField` | default True; inactive presets hidden from pickers |
| `sort_order` | `IntegerField` | default 0; catalog display order |

`Meta.db_table = 'export_packing_preset'`, `ordering = ['sort_order', 'name']`.

## How the documents read it (`document_context.py`)

- `build_invoice_context`: NET = the firm's own weight (`quantity_kg`, **never**
  `Shipment.weight_net`). Gross/boxes/pallets = `effective_firm_packing()` — the sale's
  **override** if set, else the value **derived** from `shipment.packing_preset` split by
  this firm's weight share (`firm_weight / Σ firm weights`). Falls back to the whole-truck
  shipment fields only when there is no truck preset.
- `build_cmr_context`: reads `shipment.packing_preset` directly (whole truck);
  `gross_with_pallet = preset.gross_kg`, `gross_without_pallet = preset.gross_kg −
  preset.pallet_weight_kg` (BRUT = gross with pallet). Falls back to the shipment's own
  weight fields.

## API

`GET|POST|PATCH|DELETE /api/v1/export/packing-presets/`
- Read: any authenticated user (operators must list them to pick).
- Write: `admin` / `director` / `export_manager` (others 403). Delete of an in-use preset
  → 409 (PROTECT FK); prefer toggling `is_active`.
- Filters: `?product_type=`, `?is_active=`. Order: `?ordering=sort_order|name|net_kg`.

Seeded by `python manage.py seed_packing_presets` (curated standard configs, idempotent by
name; net caps reuse `TruckSplitDefault` via `get_default_truck_weight`).

## Where it's picked (UI)

- **Unified packing panel** (`ShipmentPackingPanel`) — the only place. Opened from the export
  Sheet's synthetic **`packing`** row (a popover). You pick **one whole-truck config** at the
  top (→ CMR + derivation source); below, each firm split shows its **derived** net/gross/
  boxes/pallets with editable **override** inputs. A live **Σ-check** banner turns red if the
  firm weights don't sum to the truck config's net (poka-yoke). Backed by
  `GET|POST /api/v1/contracts/shipment-packing/` (contracts-side — joins `Shipment` +
  `ContractSale`; writes use `.update()`, no save() side effects). A firm with no linked
  `ContractSale` shows "link a contract first".
- **Admin** — `/admin/packing-presets` manages the catalog (whole-truck configs only).

See [[../processes/document-generation]] and [[contracts-contract-sale-model]].
