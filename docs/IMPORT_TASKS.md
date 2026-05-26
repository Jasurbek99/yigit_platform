# Data Import Tasks

Run the `data-importer` agent in a separate chat: `/import`

The agent reads this file, executes the first `[ ]` task, and marks it `[x]` when done.

---

## How to run

Open a new Claude Code chat, then:
```
/import
```

The agent will find the next pending task, write the management command, run it, and mark it done.

---

## Tasks

### [x] 1. Market prices — Baha_Grafigi.xlsx → PriceEntry — **2,067 rows imported**

**Source**: `data/p3-export/Baha_Grafigi.xlsx` → sheet `Sayfa1`
**Target**: `export.price_entries` (model: `PriceEntry`)
**Command to create**: `backend/apps/export/management/commands/import_prices.py`
**Volume**: ~1,557 rows × 8 cities = up to 5,000–7,000 non-null entries

**Column mapping**:
| Col index | City name | Currency |
|-----------|-----------|----------|
| 1 | Şimkent | KZT |
| 2 | Almaty | KZT |
| 3 | Astana | KZT |
| 4 | Karaganda | KZT |
| 7 | Orenburg | RUB |
| 8 | Moskwa | RUB |
| 11 | Minsk | BYN |
| 14 | Bishkek | KGS |

Skip cols 5, 6, 9, 10, 12, 13 (aggregate USD + notes).
Skip cols 15–20 (domestic TM markets — handled in task #4).
Header rows: 4 (data starts row 5). Date in col 0.
Skip cells that are `None` or `'-'`.
Cities Orenburg, Minsk, Bishkek must exist — run `seed_data` first.
Unique constraint: `(date, city_id)` — use `ignore_conflicts=True`.

**Special rules**: `source='Baha_Grafigi.xlsx'`, `entered_by=None`, `price_usd=None`.

---

### [x] 2. Cargo codes + shipments — Hasabat_202526.xlsx → Shipment — **1,145 shipments + 1,465 firm splits imported**

**Source**: `data/p3-export/Hasabat_202526.xlsx` → sheet `Saher`
**Target**: `export.shipments` (model: `Shipment`), `export.shipment_firm_splits`
**Command to create**: `backend/apps/export/management/commands/import_saher_shipments.py`
**Volume**: ~1,145 rows

**Key fields in Saher sheet** (analyze first to confirm exact column indices):
- Cargo code (`DDCC###/YY` format) — normalize Cyrillic С → Latin C
- Date
- Export firm(s) — may be multi-firm (dash-separated e.g. `YGT-HMS`)
- Country destination
- Customer name
- Block source code

**Rules**:
- Skip if `Shipment.objects.filter(cargo_code=code).exists()` (the 3 sample shipments are already there)
- All imported shipments → status `tamamlandy` (step 13)
- All AD-1 timestamps → `None` (historical, not tracked)
- Multi-firm: split weight equally among firms in `ShipmentFirmSplit`
- Must read the actual Saher sheet headers before writing — column positions may differ from expectations

---

### [x] 3. Weight/invoice details — Export_contracts_20252026_1.xlsx → Shipment (enrich) — **549 shipments enriched**

**Source**: `data/p3-export/Export_contracts_20252026_1.xlsx` → sheet `2-Sales`
**Target**: Update existing `Shipment` rows with weight, box count, invoice data
**Command**: `backend/apps/export/management/commands/import_sales_details.py`
**Volume**: 1,959 rows processed, 549 shipments enriched (769 matched, deduped), 1,190 unmatched (third-party sellers not in YGT DB)

**Join**: (invoice_date, seller_code) → positional match within sorted group by cargo_code
**gross_net sheet**: Right-side cols 7-11 give weight_gross, box_count, pallet_count indexed by global serial
**Cancellations**: 3 cancelled rows detected (yatyryldy/iptal/YZA SUYSIRILDI) → ShipmentComment
**R15 notes**: 44 rows with notes — all in unmatched groups (Sep 24 batch), logged as warnings

---

### [x] 4. Domestic market prices — Satys_bahalar_202526.xlsx → DomesticMarketPrice — **2,522 rows imported**

**Source**: `data/p3-export/Satys_bahalar_202526.xlsx` → 7 monthly sheets (Sep 2025–Mar 2026)
**Target**: `export.domestic_market_prices` (model: `DomesticMarketPrice`)
**Command**: `backend/apps/export/management/commands/import_domestic_prices.py`
**Volume**: 2,522 price entries (3 price types × up to 5 varieties × markets × dates)

**Structure**: Each sheet has 3 side-by-side panels: BAZAR (cols 0-6), KLENTLER (cols 8-14), Onlayn (cols 16-22)
**price_type values**: `bazar`, `klent`, `online`
**variety_type values**: `tomato_salkym`, `tomato_gulpakly`, `tomato_gulpaksyz`, `tomato_mayda`, `tomato_cherri`, `tomato_gulgune`
**Skipped**: aggregate rows (Boluleni, Klient sanyna, Ortaca, etc.), None/zero prices

---

### [x] 5. Weekly harvest plans — Pomidor_Dükany__20252026.xlsx → WeeklyHarvestPlan — **257 rows imported**

**Source**: `data/p3-export/Pomidor_Dükany__20252026.xlsx` → sheet `Hepdelik planlama`
**Target**: `export.weekly_harvest_plans` (model: `WeeklyHarvestPlan`)
**Command**: `backend/apps/export/management/commands/import_harvest_plans.py`
**Volume**: 257 records (24 weeks × up to 15 blocks, only non-zero rows)

**Structure**: Sheet divided into week blocks starting with 'XX-NJY HEPDE' headers
**Blocks**: A-L, M15, M5, O (15 total, matching GreenhouseBlock.code values)
**Season**: Uses active Season (2025-2026)
**Skipped**: 103 rows where all plan values are 0 (inactive blocks for that week)
**actual_kg**: Only weekly total available → stored as monday_actual_kg

---

### [x] 6. Weekly harvest plans (updated source) — weekly_plan.xlsx → WeeklyHarvestPlan — **318 rows imported**

**Source**: `data/weekly_plan.xlsx` → sheet `Hepdelik planlama`
**Target**: `export.weekly_harvest_plans` (model: `WeeklyHarvestPlan`)
**Command**: `backend/apps/export/management/commands/import_weekly_plan.py`
**Volume**: 318 WeeklyHarvestPlan + 173 WeeklyTruckAllocation + 446 TruckDestinationSplit

**Structure**: 29 week blocks (weeks 40-52/2025, weeks 1-16/2026). Each block has 15 greenhouse rows + truck summary rows.
**Plan kg**: per-day (cols C-H) → `monday_plan_kg` .. `saturday_plan_kg`
**Actual kg**: weekly total only (col J) → `actual_weekly_total_kg` (new field added for this import)
**Truck data**: Daily total planned kg (Jemi KG row) → `WeeklyTruckAllocation.total_planned_kg`
**Truck splits**: Rossiya/Gazak/Gapy Satys daily truck counts → `TruckDestinationSplit.truck_count`
**Season**: Uses active Season (2025-2026)
**Status**: All harvest plan rows imported as `approved` (historical data)
**Reset**: Deletes all existing plans + truck allocations for the season before importing
**Skipped**: 117 rows where all plan values are 0 (inactive blocks)
**Filtered**: 7 actual values below 500 kg threshold (likely truck counts, not kg)
**String cleanup**: European-style numbers like `'40,000,00'` → 40000.00; `'bayramcylyk'` (holiday) → 0 trucks

---

### [x] 8. May shipments — shipments.xlsx (transposed YGT sheet) → Shipment — **442 shipments imported**

**Source**: `docs/shipments/shipments.xlsx` → sheet `YGT` (transposed: each column = one shipment, rows 1-47 = fields, col 2 = TM field label)
**Target**: `export.shipments` + `shipment_firm_splits` + `shipment_block_sources` + `varieties_dominant` M2M
**Command**: `backend/apps/export/management/commands/import_sheet_shipments.py`
**Volume**: 442 May (`MY`) shipments + 608 firm splits + 627 block sources + 523 variety links

**Rules**:
- Imports only cargo codes whose month abbrev = `MY` (configurable via `--month`); season = active 2025-2026
- Status **derived** from timestamp-chain completeness (report→`tamamlandy` … →`yuklenme`), set directly (not via `transition_to()`) — historical bulk import
- Auto-created 2 missing `ExportFirm` rows: `TELGURBAN`, `TELAMANG`
- Parses TM datetimes, harvest-date ranges, `"N gün T"` transit/temp, multi-firm/block/variety shorthand
- `--dry-run` / `--limit N` flags; per-row insert fallback (MSSQL bulk_create has no PK return / no ignore_conflicts)

---

## Completed

- **Task 8** — 442 May shipments from `shipments.xlsx` (transposed YGT sheet) — populates the Shipment Sheet
- **Task 1** — 2,067 price entries from `Baha_Grafigi.xlsx` (8 cities, KZT/RUB/BYN/KGS)
- **Task 2** — 1,145 shipments + 1,465 firm splits from `Hasabat_202526.xlsx` (all status=tamamlandy)
- **Task 3** — 549 shipments enriched from `Export_contracts_20252026_1.xlsx` (weight, truck plate, box/pallet counts)
- **Task 4** — 2,522 domestic market prices from `Satys_bahalar_202526.xlsx` (7 months, 3 price types, 5 varieties)
- **Task 5** — 257 weekly harvest plans from `Pomidor_Dükany__20252026.xlsx` (24 weeks, 15 blocks) — *superseded by task #6*
- **Task 6** — 318 harvest plans + 173 truck allocations + 446 destination splits from `weekly_plan.xlsx`
- **Task 7** — 67 quota allocations (65 tomato + 2 pepper) from `quota.xlsx` (8 grant events, 15 firms, 12 new firms auto-created)
- **Task 7b** — re-imported all three quota streams from the richer `data/quota/quota.xlsx`: 19 `QuotaIssuance` events + 157 allocations (`import_quotas`), 560 `QuotaUsageRecord` rows (`import_quota_usage`, now status=approved), 3,008,816 kg local sales into `WeeklyLocalSellPlan` (`import_local_sales`, daily→ISO-week). Shared `_quota_import_utils.py`; fixed prior firm-mislabel (`Tel G Amangeldiyew`→#19, `Tel GJ`→#18) + `cleanup_mislabeled_local_sales` removed the 14 stale double-count rows on #8/#13.
- **Pre-req** — reference data seeded: 20 export firms, 172 import firms, 6 customers, 13 cities
