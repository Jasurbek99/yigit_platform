# Pepper as a second export product — design

**Date:** 2026-10-05
**Status:** implemented
**Scope:** P3 Export (core + export + contracts documents)

## Problem

The platform was built for tomato. In season 2026-2027 (the active season) blocks
**D, G, M5** grow sweet pepper; every other block grows tomato. Which block grows what can
change each season.

Today pepper is half-modelled:

- `QuotaIssuance` / `QuotaUsageRecord` and `PackingTemplate` already carry
  `product_type ∈ {tomato, pepper}` (CharField).
- `Shipment.product_type` FK → `core.ProductType` exists but nothing reads or writes it
  (all rows NULL).
- Tomato is hardcoded in:
  - quota calls — `'tomato'` literal in `export/views.py:2350,3445`; `quota_sync.py:78`
    default used by `export/views.py:2384,3500` and `contracts/views.py:1154`;
  - documents — `TOMATO_HS_CODE = '070200000'`, `'Fresh tomatoes'`, `'FRESH TOMATOES'`,
    `'Ter pomidor'` in `contracts/services/document_context.py`;
  - the KZ contract template body — `contract_kz.docx` has the literal
    «Томаты / Pomidor» in its goods table (no placeholder);
  - the variety reference — `TomatoVariety`, tomato rows only.

  Checked clean: `invoice_*.docx`, `cmr_*.docx`, `ct1_ru.docx`, `fito_ru.docx`,
  `customs_tk.docx`, the CMR/TIR `.xlsx` templates, letterhead renderers.

Result: a pepper truck would consume tomato quota and print tomato on its documents.

## Agreed facts (from the user, 2026-10-05)

1. One truck = one product. Never mixed.
2. Product follows the block; a block grows one product per season; the mapping changes
   between seasons.
3. Pepper has varieties; a block may have two (main + secondary):
   D = Maranella + Gialte, G = Redwing + Camier, M5 = Maranella + Gialte.
4. Weekly plan is needed for pepper and must show pepper separately from tomato.
5. Same export firms, contracts and countries — no pepper-specific firms.
6. Old weekly plans are test data — no historical attribution concern.
7. Product parameters (HS code, names) and pepper variety codes must be editable in the
   admin UI. Pepper HS code for now: **0709 60 100 0**.
8. Documents are prepared before the Join, so the shipment needs its own explicit product
   field (also for analytics). New destination rows default to tomato.
9. Contracts carry their own product; pepper trucks go under pepper contracts.

## Approach (option 1 of 3, chosen)

One variety reference, each variety tagged with its product. A block's product is its
main variety's product. A shipment has its own explicit product field; supply rows get it
from their blocks, destination rows default to tomato, and blocks are checked against it.
Rejected: a block×season product table (≈2× the work, history not needed); a separate
pepper-variety table (duplicates every variety code path).

## Design

### 1. Data model

All new columns are **nullable** (`null=True`) — beta runs old code on the same DB, so no
NOT NULL column without a DB default.

**`core.ProductType`** — add:

| field | type | purpose |
|---|---|---|
| `code` | CharField(20), unique, null | bridge to the quota CharField: `tomato`, `pepper` |
| `hs_code` | CharField(20), null | TN VED code on invoice / spec |
| `name_en` | CharField(100), null | `Fresh tomatoes` / `Fresh sweet peppers` — invoice line, CMR cargo (uppercased) |
| `name_ru` | CharField(100), null, Cyrillic | `Помидор свежий` / `Перец сладкий свежий` — RU invoice line, contract RU column |
| `name_tk` | CharField(100), null, Cyrillic | `Ter pomidor` / `Ter bolgar burç` — customs letter, contract TK column |

**`core.TomatoVariety`** — add `product_type` FK → `ProductType`, `PROTECT`, null.
Class / table / endpoint are **not** renamed (churn without benefit).

**`core.GreenhouseBlock`** — no new column. Block product rule, as the model method
`GreenhouseBlock.resolve_product()` (in core, so core serializers can use it without a
reverse import):

- own `variety_main.product_type`, else the parent block's (sub-blocks F1/F2 → F,
  OD/OG → O), else **none**.
- Exposed read-only on the block serializer as `product_type_code`
  (`tomato` / `pepper` / null).

**`export.Shipment.product_type`** — explicit, editable (§2).

**Data migration** (must work on the live DB *and* on an empty test DB):

1. `ProductType`: `get_or_create` by `name` for `Pomidor` and `Bolgar burç`
   (live names verified 2026-10-05 — `ç` is U+00E7), then fill only blank fields:
   - Pomidor → `tomato`, `070200000`, `Fresh tomatoes`, `Помидор свежий`, `Ter pomidor`
     (the exact strings the invoice / customs letter print today)
   - Bolgar burç → `pepper`, `0709601000`, `Fresh sweet peppers`, `Перец сладкий свежий`,
     `Ter bolgar burç`
   - Badamjan / Hyyar untouched (`code` NULL, not exported).
2. Every existing variety → product Pomidor.
3. `get_or_create` pepper varieties Maranella, Gialte, Redwing, Camier (product
   Bolgar burç, `code` NULL → official code prints `--` until the admin sets one).
4. Blocks D, G, M5 → their pepper `variety_main` / `variety_secondary` (above). Skipped
   silently when a block code does not exist (test DB).
5. Existing shipments with `product_type` NULL → Pomidor.

The other blocks' tomato varieties in the 2026-2027 table differ from the DB
(e.g. B = Guardiosa, I = Sanmaru). Not migrated — the admin edits them in the UI.

### 2. Shipment product — explicit field, checked against blocks

Decided 2026-10-05: documents are prepared on the destination row **before** the Join, when
it has no blocks yet — so the product cannot be derived from blocks alone. It is an explicit,
editable shipment field that blocks are checked against. It also drives analytics.

**`Shipment.product_type`** (existing FK, stays nullable for beta):

- **Create, with blocks** (supply draft): set from the blocks' product.
- **Create, without blocks** (destination row, Add-shipment): from the request; default
  **tomato** when not sent.
- **Edit** on Sheet / Detail / edit drawer: allowed for anyone holding the existing
  `product_type` field permission (already in the Sheet permission lists). Rejected (400)
  when the shipment has blocks of another product. A change re-syncs quota usage (§3).
- NULL (old rows, old beta code) reads as tomato everywhere.

New service `apps/export/services/product_type.py`:

```python
class ProductMismatchError(ValueError): ...      # → 400

def resolve_product_type(blocks) -> ProductType | None
    # distinct block.resolve_product() over blocks, IGNORING None;
    # 0 → None, 1 → that product, >1 → ProductMismatchError ("mixed")
def check_blocks_fit(shipment, blocks) -> ProductType | None
    # P = resolve_product_type(blocks)
    # P is None or P == product(shipment)  → OK
    # shipment has no block sources yet     → OK, caller adopts P
    # otherwise                             → ProductMismatchError
def set_shipment_product(shipment, product, user) -> bool
    # save if changed, re-run quota usage sync when it has firm splits
def shipment_product_code(shipment) -> str
    # shipment.product_type.code or 'tomato'
```

Every block-source write and the check it runs **before** writing (raise → nothing
written):

| site | flow | check |
|---|---|---|
| `services/block_sources.py::write_block_sources` | all replace-writes (supply-draft create `views.py:2328`, Sheet block edit `views.py:3371`, `services/shipment.py:1013`, `normalize_block_sources` command) | `check_blocks_fit`; adopt P when the row had no blocks |
| `views.py:2316` | direct `bulk_create` on the create path | product = `resolve_product_type(blocks)` |
| `views.py:2649` | Sheet Join — supply's blocks move to the destination | supply product ≠ destination product → 400 «продукты не совпадают» |
| `services/packaging.py:154` | `unjoin_packing` — blocks move to a new row | new row copies the original row's product |
| `services/packaging.py:213-222` | `swap_packing` — blocks swap between two rows | the two rows' products differ → 400 |

Errors: 400 `{"detail": "..."}`, frontend i18n keys `errors.mixed_product`
(«В одной фуре нельзя смешивать томат и перец») and `errors.product_mismatch`
(«Продукт блоков не совпадает с продуктом рейса»).

### 3. Quotas

- Pass `shipment_product_code(shipment)` at `export/views.py:2384,3500` and
  `contracts/views.py:1154`. The function's `'tomato'` default stays for other callers.
- `compute_firm_quota_balances(...)` at `export/views.py:2350,3445` uses the shipment's
  product; on the create path it uses the product the new row will get (§2).
- A product change (`set_shipment_product`, §2) re-syncs the shipment's usage rows, so they
  move to the right quota.
- `invalidate` cache keys already enumerate `('tomato', 'pepper')` — unchanged.

### 4. Documents

`contracts/services/document_context.py` gains `_product_for(shipment)`. Each field falls
back to today's tomato constant when the product or the field is blank — a missing admin
value never breaks a document.

1. **Invoice / spec:** HS code `line.hs_code or product.hs_code or TOMATO_HS_CODE`;
   product name `product.name_en`.
2. **CMR:** `cargo_name` = `product.name_en.upper()`.
3. **KZ contract** (`contract_kz.docx`): replace the literal «Томаты / Pomidor» with
   `{{ product_name_ru }}/ {{ product_name_tk }}`, read from the **contract's own
   product** (decided 2026-10-05, option a — pepper trucks go under a pepper contract):
   - `contracts.Contract.product_type` FK → `core.ProductType`, `PROTECT`, null.
     NULL reads as tomato (old beta code keeps creating NULL rows). Data migration sets
     existing contracts → Pomidor.
   - One-time contract (`_create_one_time_contract`) takes the shipment's product.
   - Framework contract: the create / edit form gets a «Продукт» select, default tomato.
   - `framework_contracts_for_pair(...)` gains a `product_type` filter (NULL ≡ tomato),
     so a pepper truck is offered only pepper framework contracts
     (`contracts/views.py:935`, `shipment_firm_contracts.py:222`).
   - `link_split_to_contract(mode='framework')` rejects a contract whose product differs
     from the shipment's → 400 `errors.contract_product_mismatch`.
   - Contract list / detail show the product.
   - Visible wording change: the tomato contract cell prints «Помидор свежий/ Ter pomidor»
     (the shared product names) instead of today's «Томаты/ Pomidor». Editable in the admin.
4. **Customs letter (TK):** `product` = `product.name_tk`.

### 5. Admin UI

`/admin/shipment-settings` → Option Lists:

- New FK category **«Продукты»** (`product_type`): columns name, code, HS code,
  name EN / RU / TK; create / edit / delete (delete → 400 while in use, `PROTECT`).
  Backed by a new `ProductTypeViewSet` at `/api/v1/core/product-types/` — reads open,
  writes admin-only, same pattern as `TomatoVarietyViewSet`.
- Variety form and table gain a **«Продукт»** select / column. The existing `code` field
  serves pepper variety codes.

### 6. Weekly plan (`/export/plan`, `WeeklyPlanGrid`)

Rows already come from blocks, so D/G/M5 appear. Change: in the normal layout the single
`plan.total` summary row becomes one row per product present (`Итого томат`,
`Итого перец`). The transposed layout already totals per block (columns are blocks), so it
is unchanged.

*Addition beyond the approved list (drop if unwanted):* a small product tag next to the
block code.

The Önümçilik tab in Tır Takip (`pages/sera`) is a fork and is **not** changed.

### 7. Shipment surfaces

- **Sheet:** new editable column «Продукт» (томат / перец select), in the same field
  permission chain as other Sheet fields (`product_type` is already in
  `seed_permissions.py` and `permission_registry.py`).
- **Shipment Detail / edit drawer:** the same select.
- **Create forms** (Add-shipment / destination row): select, default tomato. Supply-draft
  modal shows the product read-only, derived from the chosen blocks.
- Serializer: `product_type` (id, writable) + `product_type_code` + `product_type_name`
  (read-only).
- **Analytics hook:** shipment list accepts `?product_type=tomato|pepper`. Per-product
  breakdowns in the dashboards come in a later phase.

*Addition beyond the approved list (drop if unwanted):* variety pickers list only the
shipment's product's varieties.

## Out of scope (later phase)

- **Truck allocation** (`WeeklyTruckAllocation`, `truck_allocation_tasks.py`,
  `views_planning.py`): trucks are computed from the combined planned kg ÷ 18 500. With one
  product per truck and a 16 800 kg pepper load, the right figure is per product. Stays
  combined in this phase — the count can be off by one truck on a pepper week.
- «Pomidor Dükany» production analysis — tomato only.
- Weightmaster import (matches varieties by name; tomato labels).
- Domestic TM sales, market prices.
- Tır Takip forks of the Sheet / Weekly Plan.

## Testing

Backend (TDD):
- `block_product` / `resolve_product_type`: none, one, mixed, sub-block inherits parent,
  block without variety ignored.
- Supply-draft create from a pepper block → product pepper; usage rows
  `product_type='pepper'`; tomato balances untouched.
- Destination row created without product → tomato.
- Tomato + pepper blocks → 400, nothing written.
- Pepper block added to a tomato row that already has blocks → 400.
- Product edit to pepper on a row with tomato blocks → 400; on a row without blocks → OK,
  quota rows move to pepper.
- Sheet Join of a pepper supply into a tomato destination → 400.
- Unjoin copies product; swap between different products → 400.
- Shipment list `?product_type=pepper` filter.
- Document contexts: pepper → `0709601000` / `FRESH SWEET PEPPERS` / `Ter bolgar burç`;
  blank admin field → tomato constants.
- `ProductTypeViewSet` permissions (read open, write admin).
- Data migration on an empty DB (no blocks, no product rows) does not fail.
- Contracts: one-time contract inherits pepper; framework list for a pepper truck excludes
  tomato contracts; framework link with mismatched product → 400; KZ contract context
  prints the contract's product, NULL → «Томаты / Pomidor».

Frontend (vitest):
- Option Lists product category form.
- Framework contract form product select.
- Sheet «Продукт» column edit; create form default tomato.
- Weekly plan per-product summary rows.

## Docs to update

`docs/obsidian/` (product/variety reference, quota, document generation, weekly plan),
`CHANGELOG.md`, `BUILD_TEST_LOG.md`, `api-contract` skill (product-types endpoint,
`product_type_code` on blocks, `product_type_name` on shipments).
