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
| `core.ProductType` | `code` (unique) | `tomato` / `pepper` — the bridge to the `QuotaIssuance` / `QuotaUsageRecord` `product_type` CharField. Set on create only; the API ignores it on update and the admin form disables it when editing |
| | `hs_code` | TN VED on invoice / spec. Tomato `070200000`, pepper `0709601000` |
| | `name_en` / `name_ru` / `name_tk` | Invoice line, CMR cargo (uppercased), contract RU / TK columns, customs letter. Tomato: `Fresh tomatoes` / `Помидор свежий` / `Ter pomidor`; pepper: `Fresh sweet peppers` / `Перец сладкий свежий` / `Ter bolgar burç` |
| `core.TomatoVariety` | `product_type` FK | Tags every variety with its product (class / table / endpoint keep the tomato name). Existing rows → tomato; Maranella, Gialte, Redwing, Camier → pepper |
| `core.GreenhouseBlock` | `resolve_product()` | No column. Main variety's product, else the parent block's (F1/F2 → F, OD/OG → O), else none. Exposed as `product_type_code` on the block serializer |
| `export.Shipment` | `product_type` FK | Explicit and editable. Supply rows take it from their blocks; destination rows default to tomato; edit allowed for holders of the `product_type` field permission. The API accepts only the `tomato` / `pepper` rows and never `null` (create and PATCH) |
| `contracts.Contract` | `product_type` FK | Pepper trucks go under pepper contracts; NULL ≡ tomato |

Migrations: core 0073 / 0074, export 0097 / 0098, contracts 0018 / 0019. 0074 sets D, G, M5 to pepper varieties (D and M5 = Maranella + Gialte, G = Redwing + Camier) and backfills every existing shipment / contract to tomato.

## Service — `apps/export/services/product_type.py`

`resolve_product_type(block_ids)` (mixed → `mixed_product`), `check_blocks_fit(shipment, block_ids)`, `check_contract_product(shipment, product)`, `check_product_quota(shipment, product)`, `set_shipment_product(shipment, product, user)`, `shipment_product_code(shipment)`. A destination row (country + customer set) refuses blocks of another product; a supply-only row adopts the blocks' product.

- `check_product_quota` — the product-change hard block, shared by the shipment PATCH (`ShipmentPatchSerializer.validate`) and the block-edit adopt (`set_shipment_product`): on a truck with firm splits, every split firm needs live quota of the new product in the shipment's season, else `ProductQuotaError` («<FIRM> has no remaining <code> quota.», 400). Same rule as the `set_firm_splits` gate. A change that keeps the effective code (NULL → tomato) is not checked.
- `set_shipment_product` — runs the contract check and the quota check, writes with `.update()` (no auto-advance), writes one `AuditLog` row (`field_name='product_type'`, user may be None), and re-syncs quota usage only when the effective code moves and the truck has splits.
- **Contracts fix the product.** `check_contract_product` — a product that differs from a contract the truck is sold under (its non-void `sales`, contract not cancelled; NULL ≡ tomato) raises `ContractProductError` (`contract_product_mismatch`, 400). It runs in the shipment PATCH and inside `set_shipment_product`, so the block-edit adopt, manifest close and `backfill_product_types` obey it too (2026-10-07 fix). Re-sending the truck's current product is never checked, so older mismatched data stays editable; the contract-sale API refuses the same on create or when `contract` / `shipment` changes (a status-only PATCH on an older mismatched sale still passes). Export reads it through the `sales` reverse accessor only — it does not import contracts.

Guarded block writes: block-source replace-writes, supply-draft create, Sheet block edit, manifest close, Sheet Join (supply product must equal destination product), Unjoin (new row copies the product), Swap (the two rows' products must match). Errors are 400 `mixed_product` / `product_mismatch` / `contract_product_mismatch`; frontend text under `errors.*`, mapped in `utils/apiErrorText.ts`. The pallet manifest's «Close manifest» shows the server error as a toast (`pallet.toast_close_error` fallback). The supply-plan modal shows the product of the chosen blocks read-only (mixed → the `errors.mixed_product` text).

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
6. After every deploy while old beta code still runs on the shared DB (it writes NULL products): `python manage.py backfill_product_types` and `python manage.py backfill_contract_products` — dry-run, read the summary — then the same with `--apply`. Shipments take their blocks' product, else tomato; mixed-block, code-less-product, no-quota and contract-of-another-product trucks are skipped and listed for a hand fix. Dry-run on the dev DB 2026-10-07: 0 NULL shipments, 0 NULL contracts.

## Out of scope (later)

Truck allocation (`WeeklyTruckAllocation`, trucks = combined kg ÷ 18 500 — may be one truck off on a pepper week), Pomidor Dükany (tomato only), weightmaster import, domestic TM sales / market prices, Tır Takip forks of the Sheet / Weekly Plan, per-product dashboard breakdowns.

## Known gaps / deferred

Found in the final review (2026-10-07) and deliberately left for later:

- **M1 — adopt rule keyed on the destination plan.** `check_blocks_fit` decides refuse-vs-adopt by `is_destination_plan` (country + customer set), not by the spec's "the row had no blocks yet". A supply row with blocks adopts a new product; a destination row with no blocks refuses one.
- **Shipment 763** — its product data is not corrected.
- **PackingTemplate filtering by product** — packing templates are not filtered by the truck's product.
- **Join: orphaned quota usage** — quota usage left behind by the Join is not cleaned up.
- **Sheet `getCellValue` NULL display** — how the Sheet cell shows a NULL product.
- **`_invoice_product` contract fallback** — the invoice product does not fall back to the contract's product.
- **Contract-sale form** (`ContractSaleCreate.tsx`) maps 400 field errors only onto its own form fields, so a `{"contract": ["contract_product_mismatch"]}` refusal on the standalone edit form is not shown. The sale form never sends `shipment`, so in practice it arises only when re-pointing a linked sale to a contract of the other product.
