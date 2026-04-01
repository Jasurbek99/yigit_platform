# Excel Analysis: Export_contracts_20252026_1.xlsx

**Analyzed:** 2026-03-27
**File:** `/Users/macbookpro/yigit_programm/data/p3-export/Export_contracts_20252026_1.xlsx`
**Total sheets:** 28

---

## 1. Sheet Inventory

| Sheet name | Total rows | Non-empty rows | Role | Migration target |
|---|---|---|---|---|
| `2025-2026` | 599 | 361 | Summary view (contracts + invoice totals grouped by seller) | READ-ONLY reference |
| `1-Contracts` | 999 | 45 | Master contract list — 31 active contracts | `contracts.contracts` |
| `2-Sales` | 1,974 | 1,961 | Per-truck invoice rows — PRIMARY shipment source | `contracts.invoices`, `export.shipments` (partial) |
| `truck and driver` | 2,479 | 2,015 | Driver registry (name, passport, truck plates, brand) | `trip_mgmt.drivers` (out of scope now) |
| `gross net` | 1,013 | 127 | Per-truck weight detail (gross, net, boxes, pallets) | `export.shipments` (weight columns) |
| `Buyers` | 116 | 116 | Import firm / customer reference data (104 unique codes) | `core.import_firms`, `core.customers` |
| `sellers` | 1,001 | 26 | Export firm reference data — 25 sellers | `core.export_firms` |
| `CMR graphs` | 1,005 | 101 | Import firm → country/city mapping for CMR documents | `core.import_firms` (country/city FKs) |
| `PasportGel` | 1,000 | 83 | Passport Sdelka (payment passport) registry | `contracts.invoices.passport_sdelka` |
| `InvoiceRU` | 1,001 | 38 | Single-invoice print template (references 2-Sales row) | Template only — no bulk data |
| `InvoiceRU (копия)` | 1,001 | 38 | Duplicate of InvoiceRU | Skip |
| `InvoiceEN` | 1,003 | 37 | English invoice template | Skip |
| `CMR RU` | 1,000 | 26 | CMR document template (Russian) | Skip |
| `CMR RU(Sirin)` | 1,000 | 27 | CMR variant for Sirin route | Skip |
| `CMR RU(Aynur)` | 1,000 | 25 | CMR variant for Aynur route | Skip |
| `CMR RU (копия)` | 1,000 | 26 | CMR duplicate | Skip |
| `CMR RU (3 exporters)` | 1,002 | 28 | CMR variant (3 exporters) | Skip |
| `CMR RU (3 sellers)` | 1,002 | 29 | CMR variant (3 sellers) | Skip |
| `CMR EN` | 1,001 | 29 | CMR English template | Skip |
| `TIR CARNET (UZ)` | 999 | 14 | TIR document template | Skip |
| `TIR CARNET (UZ) (копия) 1` | 999 | 14 | TIR duplicate | Skip |
| `TIR CARNET (UZ) (копия)` | 999 | 14 | TIR duplicate | Skip |
| `customs` | 1,001 | 17 | Customs document counter/summary | READ-ONLY reference |
| `customs (копия)` | 1,001 | 17 | Customs duplicate | Skip |
| `letter CT1` | 1,000 | 15 | CT-1 certificate template | Skip |
| `letter CT1 (копия)` | 1,000 | 15 | CT-1 duplicate | Skip |
| `fito` | 1,000 | 12 | Phytosanitary certificate template | Skip |
| `Лист153` | 0 | 0 | Empty sheet | Skip |

**Migration-relevant sheets: 8** (`2-Sales`, `1-Contracts`, `gross net`, `Buyers`, `sellers`, `CMR graphs`, `PasportGel`, `2025-2026`)

---

## 2. Sheet-by-Sheet Column Analysis

### Sheet: `2-Sales` (PRIMARY — 1,961 data rows)

This is the main shipment/invoice register. One row = one truck delivery under a contract.

| Col | Header | Sample values | DDL v5.1 target | Notes |
|---|---|---|---|---|
| A | ` ` (row serial) | `1.0`, `2.0` | — | Sequential per-contract row counter, not PK |
| B | `Seller` | `YGT`, `GB`, `HMS`, `DM`, `MA` | `core.export_firms.code` | 20 unique seller codes |
| C | `Buyer` | `Nur-Alem`, `Aranşy KZ`, `ABSOLYUT` | `core.customers.name` / `core.import_firms.name_short` | 63 unique buyer names |
| D | `Contract` | `177/25-YGT-EXP, 22.09.2025` | `contracts.contracts.contract_number` | Format: `NNN/YY-FIRM-EXP, DD.MM.YYYY` |
| E | `Invoice date` | `datetime(2025, 9, 24)` | `contracts.invoices.invoice_date` | Stored as Python datetime object |
| F | `total no. of truck` | `36`, `72` | `contracts.contracts.planned_trucks` | Total trucks in contract |
| G | `serial no. of truck` | `1`, `2`, `3` | `contracts.invoices.serial_truck_number` | Per-contract serial — NOT globally unique |
| H | `inv.no` | `258`, `259`, `260` | `contracts.invoices.invoice_number` (as INT) | **NOT globally unique** — resets per contract |
| I | `Inc.ter.` | `None` (mostly empty), `FCA` | `contracts.invoices.incoterm` | Usually inherited from contract |
| J | `Quantity (kg)` | `14000.0`, `18100.0` | `export.shipments.weight_net_kg` via gross net join | Weight in kg |
| K | `$` | `12180`, `15747` | `contracts.invoices.total_usd` | USD amount (derived: qty × price) |
| L | `No. of truck` | `3194AHF/2411TAH` | `export.shipments.truck_head_id` + `trailer_id` (via trip_mgmt) | Format: `HHHHXXX/TTTTXXX` (head plate / trailer plate) |
| M | `Pas.Zdelka` | `1304-22058-382617/1` | `contracts.invoices.passport_sdelka` | Payment passport number |
| N | `Scan` | `True`/`None` | `contracts.invoices.scan_uploaded` | Boolean |
| O | *(unlabeled)* | `14000ton(ulandy)`, `tazeden asakda goylan` | `export.shipment_comments.content` via R15 migration | **R15 legacy notes** — 41 rows, migrate to `shipment_comments` with `is_system=True` |

**Important observation:** Column H `inv.no` is NOT the cargo code (`DDMM###/YY`). The `inv.no` is a sequential number that resets per contract (confirmed: 1,782 rows but only 380 unique values, 306 duplicates). The cargo code must be reconstructed from date + serial or is in the `gross net` sheet row number.

### Sheet: `1-Contracts` (31 active contracts)

| Col | Header | Sample | DDL v5.1 target |
|---|---|---|---|
| A | `Contract` | `177/25-YGT-EXP, 22.09.2025` | `contracts.contracts.contract_number` |
| B | `Seller` | `YGT`, `GB`, `HMS` | `contracts.contracts.export_firm_id` |
| C | `Buyer` | `Nur-Alem`, `Aranşy KZ` | `contracts.contracts.import_firm_id` / `customer_id` |
| D | `trucks per contracts` | `36.0`, `72.0` | `contracts.contracts.planned_trucks` |
| E | `Inc.ter.` | `FCA` | `contracts.contracts.incoterm` |
| F | `Quantity (kg)` | `651600.0`, `1303200.0` | `contracts.contracts.planned_quantity_kg` |
| G | `Sum$` | `566892`, `1133784` | `contracts.contracts.planned_amount_usd` |
| H | `Exported Quantity` | `36` | `contracts.contracts.exported_trucks` |
| I | `Contract-Export Count` | `0` | Delta: trucks remaining (computed) |
| J | `Exported Sum` | `566892` | `contracts.contracts.exported_quantity_kg` (derived) |
| K | `Contract-Export Sum` | `0` | Delta: remaining amount (computed) |
| L | `Peyment` | `566892` | `contracts.contracts.payment_received_usd` |
| M | `Last InvNo` | `257.0` | `contracts.contracts.last_invoice_number` |
| N | `sent to UNK` | `True` | `contracts.contracts.sent_to_unk` |
| O | `Ostatok` | `0` | `contracts.contracts.remaining_usd` (keep negative if present) |
| P | `Yapylan PZ` | `OK` | Status note — map to `contracts.contracts.status` |
| S-U | `Firma`, `Kontrakt N`, `sum USD` | `DM`, `192/25-DM-EXP`, `517532` | Secondary linked contracts (cross-reference) |

**Contract number format:** `NNN/YY-FIRM-EXP, DD.MM.YYYY`
Example: `177/25-YGT-EXP, 22.09.2025` = number 177, year 25, firm YGT, type EXP, signed 22-Sep-2025.

### Sheet: `gross net` (114 valid weight rows)

| Col | Header | Sample | DDL v5.1 target |
|---|---|---|---|
| A | `№` | `1.0`, `2.0` | Row serial (join key with 2-Sales via row position) |
| B | `BRUT:` | `20628.0` | `export.shipments.weight_gross_kg` |
| C | `NET:` | `18100.0` | `export.shipments.weight_net_kg` |
| D | `YASIK:` | `3192.0` | `export.shipments.packaging_kg` (box weight total) |
| E | `PALET` | `33.0` | `export.shipments.pallet_count` |
| F | `PALET AGRAMY:` | `433.0` | `export.shipments.pallet_weight_kg` |
| G | *(empty separator)* | `None` | — |
| H–L | Cols H-L | Mirror of B-F | Duplicate columns — same data, ignore |
| M | *(empty)* | `None` | — |
| N | Season tag | `2025-2026` | Validation: all rows should be current season |

**Join strategy:** `gross net` row `№` aligns positionally with `2-Sales` invoice serial (`G: serial no. of truck`). No direct cargo code present — requires positional join.

### Sheet: `sellers` (25 export firms)

| Col | Header | Sample | DDL v5.1 target |
|---|---|---|---|
| A | `Н` | `1.0` | Row number |
| B | `code` | `GB`, `HMS`, `MA`, `DM`, `YGT` | `core.export_firms.code` (PK lookup) |
| C | `компания` | `Х.О"Гок булут"` | `core.export_firms.name_ru` |
| D | `адрес` | `Адрес: Туркменистан...` | `core.export_firms.address_ru` |
| E | `банковские реквизиты` | multi-line SWIFT, INN, account | `core.export_firms.bank_details_ru` |
| F | `директор` | `Директор Чарыев А.` | `core.export_firms.director` |
| H | `company` | `Economic society "Gok bulut"` | `core.export_firms.name_en` |
| I | `Addresses` | English address | `core.export_firms.address_en` |
| J | `Bank details` | English bank details | `core.export_firms.bank_details_en` |
| L | `kompaniya` | `"Gök bulut" HJ` (Turkmen) | `core.export_firms.name_tk` |
| M | `salgysy` | Turkmen address | `core.export_firms.address_tk` |
| N | `bank maglumatlary` | Turkmen bank details | `core.export_firms.bank_details_tk` |

**25 seller rows confirmed.** Seller codes in 2-Sales include 20 unique values: `AB`, `BKHK`, `DM`, `GB`, `HG`, `HMS`, `ISH`, `KIHK`, `MA`, `TAM`, `THM`, `Tel CH`, `Tel ED`, `Tel GA`, `Tel JD`, `Tel JD..`, `Tel PH`, `YE`, `YGT`, `YMK`. Not all sellers in the sellers sheet appear in 2-Sales (some may be inactive).

### Sheet: `Buyers` (104 import firm/customer codes)

| Col | Header | Sample | DDL v5.1 target |
|---|---|---|---|
| A | `№` | `1.0` | Row number |
| B | `code` | `Nur-Alem`, `Aranşy KZ`, `Qazfruit` | `core.customers.name` (short identifier) |
| C | `компания` | `ТОО "Нур-Алем"` | `core.import_firms.name_company` |
| D | `адрес` | Full legal address (Cyrillic) | `core.import_firms.address` |
| E | `банковские реквизиты` | BIN, IBAN, SWIFT, bank name | `core.import_firms.bank_details` |
| F | `TM name` (unlabeled) | `"Nur-alem" JÇJ` | `core.import_firms.name_short` (Turkmen short name) |

**Notes:** Buyers are KZ, RU, UZ, KG, AZ entities. The `code` column doubles as `core.customers.name` and the lookup key used in `2-Sales`.

### Sheet: `CMR graphs` (100 import firm → routing records)

| Col | Header | Sample | DDL v5.1 target |
|---|---|---|---|
| A | `Yurt` | `Kazakistan`, `Azerbaycan`, `Rusiya` | `core.countries.name_tk` (lookup) |
| B | `Şirket Adı` | `Nur-Alem`, `ABSOLYUT` | `core.import_firms.name_short` (match to Buyers) |
| C | `3 setir Yeri` | `г.Баку`, `через Бухара` | `core.cities.name` / routing notes |
| D | `3 setir Dowleti` | `Республика Казахстан` | `core.countries.name_ru` (lookup) |
| E | `CMR 13 ...` | customs location | Document field — not stored in DDL |
| F | `CMR 17` | city/customs ref | Document field — not stored in DDL |

**Use:** Resolves `import_firms.country_id` and `import_firms.city_id` for the Buyers list.

### Sheet: `PasportGel` (82 payment passport records)

| Col | Header | Sample | DDL v5.1 target |
|---|---|---|---|
| A | `T/N` | `1.0` | Row number |
| B | `Sene` | `datetime(2025, 9, 22)` | Date opened |
| C | `ContractNo` | `1304-22058-382617/1` | `contracts.invoices.passport_sdelka` |
| D | `Nomer` | `3.0` | Number of invoices under this passport |
| E | `Um Baha` | `47241` | Total passport value (USD) |
| F | `Ulanylan` | `43674` | Used amount (USD) |
| G | `Galan` | `3567` | Remaining amount (USD) — can be negative |
| H | `Ulanylan Tir san` | `3` | Number of trucks used |

**Use:** Validates `passport_sdelka` references in `contracts.invoices`.

### Sheet: `truck and driver` (1,799 valid driver records)

| Col | Header | Sample | DDL v5.1 target |
|---|---|---|---|
| A | `№` | `1.0` | Row number |
| B | `ADY` | `MANSUR` | Driver first name |
| C | `FAMILYASY` | `MARUPOV` | Driver last name |
| D | `SERIYA` | `FA0408084`, `N15159170` | Passport series/number |
| E | `Pass Berlen Senesi` | `03.07.2019` (string DD.MM.YYYY) | Passport issue date |
| F | `ÖŇI MASHYN NOMERI` | `30R960VA` | Truck head plate number |
| G | `YZY MASHYN NOMERI` | `306636AA` | Trailer plate number |
| H | `MARKA` | `DAF`, `VOLVO`, `MAN`, `MERCEDES BENZ` | Truck brand |

**1,799 driver records.** Top brands: DAF (706), VOLVO (615), MAN (115), Mercedes Benz (~188 across variants). Note: brand names have inconsistencies (`MERSEDEC BENZ`, `WOLWO`, `Mercedes Benz`) — normalize during import. Date format is string `DD.MM.YYYY` throughout.

**Scope note:** `trip_mgmt` is not a managed Django app yet. These records can be stored as raw lookup data but full FK wiring is out of Sprint 1 scope. The plate number pair from `2-Sales` col L (`3194AHF/2411TAH`) must be split on `/` to match `truck_head` and `trailer` plates.

---

## 3. Cargo Code Discovery

**Critical finding:** The standard cargo code format `DDMM###/YY` (e.g., `0201045/25`) is **NOT present** in this Excel file as an explicit column.

Instead, shipments are identified by a combination of:
- `contracts.invoices.invoice_number` (col H in 2-Sales) — sequential integer, resets per contract
- Contract number + serial truck number (cols D + G in 2-Sales)
- Row position (aligns `gross net` weights with `2-Sales` rows)

**Consequence for migration:** Cargo codes must be **generated** during import using the formula:
```
cargo_code = DDMM + zero-padded-serial(3) + "/" + YY
```
Where DDMM = invoice date, serial = global running count per date.

Alternatively, if the existing operational system already has a cargo code table, the import must JOIN to that table using (contract + serial_truck_number) as the composite key.

This is a **migration blocker** that requires clarification with the domain owner before writing the import script.

---

## 4. DDL v5.1 Column Mapping

### `contracts.contracts`
| Excel source | Sheet | DDL column |
|---|---|---|
| Col A: Contract number | 1-Contracts | `contract_number` |
| Col B: Seller code | 1-Contracts | `export_firm_id` (via `core.export_firms.code`) |
| Col C: Buyer | 1-Contracts | `import_firm_id` + `customer_id` (via `core.import_firms.name_short`) |
| Col D: trucks per contracts | 1-Contracts | `planned_trucks` |
| Col E: Inc.ter. | 1-Contracts | `incoterm` |
| Col F: Quantity (kg) | 1-Contracts | `planned_quantity_kg` |
| Col G: Sum$ | 1-Contracts | `planned_amount_usd` |
| Col H: Exported Quantity (trucks) | 1-Contracts | `exported_trucks` |
| Col L: Peyment | 1-Contracts | `payment_received_usd` |
| Col M: Last InvNo | 1-Contracts | `last_invoice_number` |
| Col N: sent to UNK | 1-Contracts | `sent_to_unk` |
| Col P: Yapylan PZ | 1-Contracts | `status` (`OK` → `active`, others TBD) |
| Season from contract date | derived | `season_id` (2025 → season "2025-2026") |

### `contracts.invoices`
| Excel source | Sheet | DDL column |
|---|---|---|
| Col D: Contract | 2-Sales | `contract_id` (FK lookup) |
| Col E: Invoice date | 2-Sales | `invoice_date` (datetime object → DATE) |
| Col G: serial no. of truck | 2-Sales | `serial_truck_number` |
| Col H: inv.no | 2-Sales | `invoice_number` (INT, scoped per contract) |
| Col I: Inc.ter. | 2-Sales | `incoterm` |
| Col J: Quantity (kg) | 2-Sales | `quantity_kg` |
| Col K: $ | 2-Sales | `total_usd` |
| Col M: Pas.Zdelka | 2-Sales | `passport_sdelka` |
| Col N: Scan | 2-Sales | `scan_uploaded` |
| Derived: K/J | 2-Sales | `price_per_kg` |
| Col B: Seller | 2-Sales | `export_firm_id` |
| Col C: Buyer | 2-Sales | `import_firm_id` |

### `export.shipments` (partial — weight data)
| Excel source | Sheet | DDL column |
|---|---|---|
| Col B: BRUT | gross net | `weight_gross_kg` |
| Col C: NET | gross net | `weight_net_kg` |
| Col D: YASIK | gross net | `packaging_kg` |
| Col E: PALET | gross net | `pallet_count` |
| Col F: PALET AGRAMY | gross net | `pallet_weight_kg` |
| Col L: No. of truck (head) | 2-Sales | `truck_head_id` (raw plate, trip_mgmt join later) |
| Col L: No. of truck (trailer) | 2-Sales | `trailer_id` (raw plate, trip_mgmt join later) |

### `core.export_firms`
| Excel source | Sheet | DDL column |
|---|---|---|
| Col B: code | sellers | `code` |
| Col C: компания | sellers | `name_ru` |
| Col D: адрес | sellers | `address_ru` |
| Col E: банковские реквизиты | sellers | `bank_details_ru` |
| Col F: директор | sellers | `director` |
| Col H: company | sellers | `name_en` |
| Col I: Addresses | sellers | `address_en` |
| Col J: Bank details | sellers | `bank_details_en` |
| Col L: kompaniya | sellers | `name_tk` |
| Col M: salgysy | sellers | `address_tk` |
| Col N: bank maglumatlary | sellers | `bank_details_tk` |

### `core.import_firms`
| Excel source | Sheet | DDL column |
|---|---|---|
| Col B: code | Buyers | `name_short` (used as lookup code) |
| Col C: компания | Buyers | `name_company` |
| Col D: адрес | Buyers | `address` |
| Col E: банковские реквизиты | Buyers | `bank_details` |
| Col F: TM short name | Buyers | `code` |
| Col A (CMR): Yurt | CMR graphs | `country_id` (via `core.countries` lookup) |
| Col C (CMR): 3 setir Yeri | CMR graphs | `city_id` (via `core.cities` lookup) |

### `export.shipment_comments` (R15 migration)
| Excel source | Sheet | DDL column |
|---|---|---|
| Col O: unlabeled note | 2-Sales | `content` = `"[Migrated from R15] " + note` |
| — | — | `is_system = True` |
| `shipment.created_by` | — | `user_id` (system migration user) |

---

## 5. Data Quality Issues

### CRITICAL — Blockers

**DQ-1: No cargo code column exists.**
The `DDMM###/YY` cargo code is absent from every sheet. `inv.no` (col H, 2-Sales) is NOT a cargo code — it resets per contract and has 306 duplicates across 1,782 rows. The migration script cannot populate `export.shipments.code` without either a cargo code generation rule or a join to the existing operational database.
**Action required:** Clarify with domain owner whether cargo codes should be generated fresh or loaded from legacy system.

**DQ-2: `2-Sales` and `gross net` join is positional only.**
There is no shared key between these two sheets. `gross net` has 114 rows, `2-Sales` has 1,961. The `gross net` sheet appears to be a partial extract (only ~6% of trucks have explicit weight detail). For the remaining 94%, weights must be taken from `2-Sales` col J (`Quantity (kg)`) as `weight_net_kg`, with `weight_gross_kg` estimated or left NULL.
**Action required:** Confirm whether `gross net` is a rolling window (current batch only) or a historical gap.

### HIGH — Data quality flags

**DQ-3: 1 row has `net > 18500 kg`.**
Row #92 in `gross net`: `net = 19000.0 kg`. Exceeds standard truck limit. Must be flagged for `is_gapy_satys = True` or manual review before import.

**DQ-4: 1 row has `net > gross`.**
One row in `gross net` has net weight exceeding gross weight — physically impossible. Flag and skip or require manual correction.

**DQ-5: Truck brand name inconsistencies.**
`truck and driver` col H: `MERSEDEC BENZ` (80 rows), `WOLWO` (49 rows), `Mercedes Benz` (12 rows) alongside correct `MERCEDES BENZ` (96 rows) and `VOLVO` (615 rows). Normalize before import.

**DQ-6: Seller code trailing dots in `2025-2026` sheet.**
Seller codes appear as `YGT.`, `HMS.`, `DM.` (with trailing dots) in the summary sheet but without dots in `1-Contracts` and `sellers`. Strip trailing dots and whitespace during normalization.

**DQ-7: Buyer name inconsistencies.**
`FRESHWORLD` vs `FRESHWORLD TRADE`, `Frutreal` vs `Frukt real`, `Tel JD` vs `Tel JD..`, `IP Tursynbayew` with 4 sub-variants. These likely map to the same `core.import_firms` record. Requires fuzzy match or explicit mapping table.

**DQ-8: Passport date format is string `DD.MM.YYYY`.**
`truck and driver` col E stores dates as strings (`03.07.2019`, `11.10.2022`), not Excel date serials or Python datetime objects. The migration script must call `datetime.strptime(val, '%d.%m.%Y')` for this column.

**DQ-9: Invoice date is a Python datetime object.**
`2-Sales` col E stores dates as `datetime.datetime(2025, 9, 24, 0, 0)` — already parsed by openpyxl from Excel serial. Call `.date()` to extract DATE.

**DQ-10: Contract dates embedded in contract number string.**
Contract number `177/25-YGT-EXP, 22.09.2025` contains the signed date. Extract with regex: `r'(\d{2}\.\d{2}\.\d{4})$'`.

**DQ-11: Negative `Ostatok` (remaining balance) possible.**
`1-Contracts` col O `Ostatok` = `0` in most rows currently, but the known pain point (negative quota balances) means some rows may be negative. Import as-is, flag `remaining_usd < 0` for review.

### MEDIUM — Import warnings

**DQ-12: Truck plate format in 2-Sales.**
Col L format is `HEADPLATE/TRAILERPLATE` (e.g., `3194AHF/2411TAH`). Must split on `/` to get individual plates. Validate each part against `truck and driver` cols F and G.

**DQ-13: Duplicate buyer names across `Buyers` and `2-Sales`.**
`2-Sales` buyers include names not in the `Buyers` sheet (e.g., `Smart Moushn Link`, `Bukhorzoda Begenc`, multiple city suffixes). These orphan references need a fallback: create minimal `core.customers` record with name only, `is_active = False`.

**DQ-14: `sellers` sheet has 25 rows but 2-Sales has 20 unique seller codes.**
5 sellers in the master sheet (`sellers`) may be inactive or historical. Mark inactive sellers as `is_active = False`.

**DQ-15: `PasportGel` can have negative `Galan` (remaining).**
Import as-is per domain rule for negative balances. Flag for review.

---

## 6. Sheets That Are Print Templates (No Migration)

The following 19 sheets are Excel-linked print templates that auto-populate from the data sheets. They contain no additional data:
`InvoiceRU`, `InvoiceRU (копия)`, `InvoiceEN`, `CMR RU`, `CMR RU(Sirin)`, `CMR RU(Aynur)`, `CMR RU (копия)`, `CMR RU (3 exporters)`, `CMR RU (3 sellers)`, `CMR EN`, `TIR CARNET (UZ)`, `TIR CARNET (UZ) (копия) 1`, `TIR CARNET (UZ) (копия)`, `customs`, `customs (копия)`, `letter CT1`, `letter CT1 (копия)`, `fito`, `Лист153`.

---

## 7. Migration Script Skeleton

Target file: `/Users/macbookpro/yigit_programm/backend/apps/core/management/commands/import_export_contracts.py`

```python
# Management command: python manage.py import_export_contracts --file=... [--dry-run]
#
# Load order (respect FK dependencies):
#   1. core.export_firms      ← sellers sheet
#   2. core.import_firms      ← Buyers sheet + CMR graphs (country/city)
#   3. core.customers         ← Buyers sheet (code → name)
#   4. contracts.contracts    ← 1-Contracts sheet
#   5. contracts.invoices     ← 2-Sales sheet (one row per truck)
#   6. export.shipments       ← 2-Sales + gross net (weight join)
#   7. export.shipment_comments ← 2-Sales col O (R15 migration, is_system=True)
#
# BLOCKER: cargo code generation strategy must be resolved before step 6.
#
# Key transforms:
#   - Contract date: regex extract from contract_number string
#   - Invoice date: datetime_obj.date()
#   - Passport date (truck sheet): datetime.strptime(val, '%d.%m.%Y')
#   - Truck plates: val.split('/') → [head_plate, trailer_plate]
#   - Seller code: val.strip().rstrip('.')  (removes trailing dots)
#   - Price/kg: total_usd / quantity_kg  (round to 4 decimal places)
#   - R15 note: "[Migrated from R15] " + col_O_value
#   - Weight join: gross net row_serial aligns with 2-Sales serial per contract
#
# MSSQL rules:
#   bulk_create(objs, batch_size=500)
#   No JSONField, no ArrayField
#   DecimalField for all money/weight
```

---

## 8. Summary Statistics

| Item | Count |
|---|---|
| Active contracts | 31 |
| Invoice/shipment rows in `2-Sales` | 1,961 |
| Valid weight rows in `gross net` | 114 |
| Export firms (sellers) | 25 |
| Import firms / buyers | 104 |
| Driver records | 1,799 |
| Payment passports | 82 |
| R15 notes to migrate to comments | 41 |
| Unique seller codes in 2-Sales | 20 |
| Unique buyer names in 2-Sales | 63 |
| Price range ($/kg) | $0.87 – $1.10 (well within KZ $0.80-$2.50 range) |
| Weight range net | 3,000 – 19,000 kg |
| Weight outliers (net > 18,500 kg) | 1 row |
| Net > Gross quality errors | 1 row |
