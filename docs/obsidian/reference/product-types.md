---
title: Product Types (tomato / pepper)
tags: [reference, core, product, pepper]
---

# Product Types — tomato and pepper

> Pepper became a second export product on 2026-10-07 (spec `docs/superpowers/specs/2026-10-05-pepper-product-design.md`, status `implemented`).
> One truck = one product, never mixed. A NULL product anywhere reads as **tomato** (old rows, old beta code on the shared DB).

## Data model (all new columns nullable)

| Model | Field | Meaning |
|---|---|---|
| `core.ProductType` | `code` (unique) | `tomato` / `pepper` — the bridge to the `QuotaIssuance` / `QuotaUsageRecord` `product_type` CharField |
| | `hs_code` | TN VED on invoice / spec. Tomato `070200000`, pepper `0709601000` |
| | `name_en` / `name_ru` / `name_tk` | Invoice line, CMR cargo (uppercased), contract RU / TK columns, customs letter. Tomato: `Fresh tomatoes` / `Помидор свежий` / `Ter pomidor`; pepper: `Fresh sweet peppers` / `Перец сладкий свежий` / `Ter bolgar burç` |
| `core.TomatoVariety` | `product_type` FK | Tags every variety with its product (class / table / endpoint keep the tomato name). Existing rows → tomato; Maranella, Gialte, Redwing, Camier → pepper |
| `core.GreenhouseBlock` | `resolve_product()` | No column. Main variety's product, else the parent block's (F1/F2 → F, OD/OG → O), else none. Exposed as `product_type_code` on the block serializer |
| `export.Shipment` | `product_type` FK | Explicit and editable. Supply rows take it from their blocks; destination rows default to tomato; edit allowed for holders of the `product_type` field permission, **cannot be cleared from the UI** |
| `contracts.Contract` | `product_type` FK | Pepper trucks go under pepper contracts; NULL ≡ tomato |

Migrations: core 0073 / 0074, export 0097 / 0098, contracts 0018 / 0019. 0074 sets D, G, M5 to pepper varieties (D and M5 = Maranella + Gialte, G = Redwing + Camier) and backfills every existing shipment / contract to tomato.

## Service — `apps/export/services/product_type.py`

`resolve_product_type(block_ids)` (mixed → `mixed_product`), `check_blocks_fit(shipment, block_ids)`, `set_shipment_product(shipment, product, user)` (uses `.update()`, then re-syncs quota usage when the shipment has firm splits), `shipment_product_code(shipment)`. A destination row (country + customer set) refuses blocks of another product; a supply-only row adopts the blocks' product.

Guarded block writes: block-source replace-writes, supply-draft create, Sheet block edit, Sheet Join (supply product must equal destination product), Unjoin (new row copies the product), Swap (the two rows' products must match). Errors are 400 `mixed_product` / `product_mismatch`; frontend text under `errors.mixed_product` / `errors.product_mismatch`.

## Where the product is read

- **Quota** — [[../processes/quota-management]]: firm-split gate, draft usage sync and Sheet block edit pass the shipment's product; a product edit re-syncs usage rows to the other quota.
- **Documents** — [[../processes/document-generation]]: invoice / spec, CMR, CT-1, Fito, customs letter, KZ contract.
- **Weekly plan** — [[../processes/weekly-harvest-planning]]: totals per product.
- **Contracts** — [[contracts-contract-model]], [[../screens/contract-list]].
- **Sheet / Detail** — [[../screens/shipment-sheet]]: «Продукт» row.
- **Admin** — `/admin/shipment-settings` → Option Lists → «Продукты» (`shipment_settings.category_product_type`): name, code, HS code, three names; delete is 400 while in use. Variety form / table have a «Продукт» select.
- **API** — `/api/v1/core/product-types/` (reads open, writes `REFERENCE_DATA_WRITE`); `?product_type=tomato|pepper` on the shipment list.

## Deploy notes

1. `update.sh`, then `migrate core export contracts` (all additive, nullable; old beta code keeps working on the same DB).
2. Pepper firms need pepper `QuotaIssuance` rows, or a pepper truck's firm split is refused («no remaining quota»).
3. Pepper framework contracts (product «Bolgar burç») must exist before pepper trucks can be linked in framework mode.
4. In-flight destination rows were backfilled **tomato**. Any that carry D / G / M5 pallets must have their product set to pepper before the manifest closes.
5. Pepper variety official codes print `--` until the admin sets them.

## Out of scope (later)

Truck allocation (`WeeklyTruckAllocation`, trucks = combined kg ÷ 18 500 — may be one truck off on a pepper week), Pomidor Dükany (tomato only), weightmaster import, domestic TM sales / market prices, Tır Takip forks of the Sheet / Weekly Plan, per-product dashboard breakdowns.
