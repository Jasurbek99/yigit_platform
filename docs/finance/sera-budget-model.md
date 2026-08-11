# Sera Bütçe — budget model reference

Reference for the **budget half** of the external `Sera Bütçe Yönetimi` app, written as input to the
planned `apps.finance` module. Everything here was read from source and **verified numerically** against
the live 2026 data, not inferred.

- **Source:** `data/sera-butce-web/client/src/App.jsx` (21 320 lines, single file), commit `17b8eb9`
- **Data:** `data/sera-butce-web/server/data.json` → `personal.sera_butce_state_v1` (987 KB JSON string)
- **Methodology audit:** `data/sera-butce-web/Butce_Metodologiya_Audit_2026-08-01.pdf`
- **Golden fixture:** [`fixtures/sera-2026-golden.csv`](fixtures/sera-2026-golden.csv) — 324 rows
  (27 blocks × 12 months), regenerate with [`fixtures/build-golden.harness.js`](fixtures/build-golden.harness.js)
- **Date read:** 2026-08-03

**Scope:** budget only. Sera also carries tır tracking, quota, invoices, buyers, foreign contracts and
sera izleme — all of which the platform's `export` / `contracts` / `greenhouse` apps already own better.
Those are excluded here by decision.

---

## 1. Dimensions

| Dimension | Values | Source |
|---|---|---|
| **Year** | 2024–2028, each a fully independent copy of every section | `yearsData[year]` |
| **Block** | **27**: `Dusak-A/B/C`, `Dusak-1..10`, `Kaka-D..L`, `Kaka-N/P/M15/M5`, `Owadandepe-O` | `buildBlocks()` App.jsx:529 |
| **Cost centre** | `Dolandyrys-Merkez` — a virtual record, not a greenhouse. Excluded from production/area/fertilizer; feeds the 770 pool only | `PERSONNEL_ONLY_RECORDS` App.jsx:553 |
| **Month** | `"01".."12"` string keys | `MONTHS` App.jsx:340 |
| **Week** | `2026-W02` … **Sunday-anchored**, week 1 starts the Sunday on or before Jan 1 | `firstSundayOnOrBefore` App.jsx:783 |
| **Cost code** | 710, 720, 730, 750, 760, 770 | `ACCOUNTING_CODES` App.jsx:355 |
| **Crop** | 9 defined; every block is `tomato`, 3 blocks rotate to `crop_i65thbi` (cucumber) from month 07 | `cropTypes`, `blockCropRotation` |
| **Sales channel** | export channels (Kazakistan, Rusya, user-addable) + `kapi` (gate) + `icPazar` (domestic) | `crop.distribution[month]` |
| **Area unit** | **GA = hectare.** Block areas 5–20 GA, total ≈ 394 GA | `blockSettings[block].area` |
| **Quantity unit** | **kg.** Confirmed: Dusak-A = 2 807 603 kg / 10 GA = 281 t/ha, a realistic protected-crop yield | verified |

### Cost codes

| Code | Meaning | How it is computed |
|---|---|---|
| **710** | Raw material — fertilizer + consumables | Rate per GA × block area × unit price |
| **720** | Direct production labour | headcount × salary |
| **730** | General production overhead | Standard amount "per 10 GA" ÷ 10 × block area |
| **750** | Quality control staff | headcount × salary (personnel only, no expense page) |
| **760** | Marketing, packaging, customs, transport | Driven by export kg and truck count |
| **770** | General administration — **a pool, distributed to blocks** | see §4 |

---

## 2. Production — the input every other number depends on

Entry is **weekly tonnage per block** (`weeklyProduction[block][weekKey]`), given by the agronomy
consultant. Two independent derivations exist:

**Monthly** (`buildMonthlyProductionFromWeekly`, App.jsx:855) — the whole week's tonnage is assigned to
**one anchor month**, the month containing that week's **Wednesday** (`dates[3]`), except any week
containing Jan 1, which is forced to January. Weeks are never split across months.

**Daily** (`buildDailyProductionFromWeekly`, App.jsx:881) — the week's tonnage is divided **equally over
working days**, where a working day is any day that is neither Sunday nor listed in `annualLeaveDays`.

> The budget engine uses the **monthly** derivation. The daily one serves other screens only. The two do
> not reconcile at month boundaries, and this is the single biggest obstacle to reading production from
> `greenhouse.HarvestDayEntry` instead — see §7.

```
monthly[block][month] = Σ over weeks w where anchorMonth(w) == month of weeklyProduction[block][w]
```

---

## 3. Revenue

`calculateMonthlyRevenue(qty, month, crop)` — App.jsx:1106.

```
qty_channel = qty × pct_channel / 100
revenue_channel = qty_channel × price_channel × (1 − yenileme_channel/100)     # export channels
revenue_kapi     = qty × pct_kapi/100     × gateSelling
revenue_domestic = qty × pct_icPazar/100  × domestic          # in manat, NOT converted

totalUSD = Σ revenue_export_channels + revenue_kapi           # domestic deliberately excluded
```

- `yenileme` is a per-channel shrinkage/replacement %, deducted from **revenue only** — the same kg still
  drive 760 packaging and transport cost.
- Domestic revenue is tracked in manat and kept out of the USD total. The audit classifies this as an
  IAS 21.56 *convenience translation* that is permitted but must be labelled supplementary and disclose
  its method — not a standard violation.
- `usdRate` is entered **manually per month** (2026-01 = 19.5).

---

## 4. The 770 pool — two pools wearing one name

This is the most important structural finding.

**Pool A — administrative personnel** (`pool770ForMonth` → `pool770ShareForBlock`, App.jsx:1231/1687)
- Source: 770-coded positions on the `Dolandyrys-Merkez` record only.
- Distributed **monthly**, mode `distributionMode770` (2026 = `equal`).
- `personnel` mode base = `totalHeadcountForBlockMonth` — **all codes except 770, for that month**.

**Pool B — manual office/admin expense items** (`yonetim770ShareForBlock`, App.jsx:1657)
- Source: `code770YonetimGroups` — 12 hand-entered line items (bank fees, taxi, canteen, fair, ads, office rent…).
- Distributed from the **annual** total, mode `distributionMode770Yonetim` (2026 = `personnel`), then **÷ 12**.
- `personnel` mode base = `blockYearlyHeadcount` — **720 only, yearly average**.

Both offer the same four mode names, and the modes mean different things in each:

| Mode | Pool A base | Pool B base |
|---|---|---|
| `equal` | ÷ 27 blocks | ÷ 27 blocks |
| `area` | block area ÷ total area | same |
| `production` | that **month's** production share | that **year's** production share |
| `personnel` | **all codes except 770, that month** | **720 only, yearly average** |

All non-`equal` modes fall back to `area` when the denominator is zero.

> Two bases = two pools. Modelling this as one pool with two mode flags is what the audit flags under
> CAS 418 homogeneity. `apps.finance` should carry a `CostPool` row per pool, each with its own basis —
> and must reproduce **both** headcount definitions to match Sera.

---

## 5. Cost formulas

`calculateMonthlyExpense(state, block, month)` — App.jsx:1730.

```
total = personnel_ex_770 + pool770_share + fertilizer + sarf + general
```

If `blockSettings[block].acilisTarihi` (opening date) is later than the month, **every** cost is zero.

### 710 — fertilizer
```
need[material] = rate[material][month].cooled   × block.cooled
               + rate[material][month].uncooled × (block.area − block.cooled)
cost = Σ need[material] × fertilizerPrices[crop][material]
```
Rates are per GA, entered globally per material × month; the block contributes only its cooled/uncooled
area split. `uncooled` is derived, never entered (`blockUncooled`, App.jsx:1247).

> `blockSettings[block].fertilizerPerGA` looks like a per-block rate override and is initialised for every
> block × month × material, but **nothing ever reads it** — the only three references (App.jsx:567, 570,
> 945) are writes by the default builders. It is vestigial and must not be migrated into a table.

### 710 — sarf (consumables: seed, cocopeat, cubes, chemicals)
```
need[material] = (month == expenseMonth[block][material]) ? standardRate[crop][material] × block.area : 0
cost = Σ need[material] × sarfPrices[crop][material]
```
Seasonal, booked once in a single month (default `"07"`), not spread.

### 720 / 730 / 750 / 760 — personnel
```
salaryUSD = currency == "usd" ? salary : salary / usdRate[month]
cost[code] = Σ over positions  headcount[block][month][code][pos] × salaryUSD[pos]
```
Two salary tables exist per position: `personnelSalaries` (actual) and `personnelOfficialSalaries`
(declared — the base for pension and income tax). Only the **actual** one reaches the cost total.

### 730 — general production overhead
```
item_cost = monthly[month]         / 10 × block.cooled
          + monthlyUncooled[month] / 10 × (block.area − block.cooled)
```
Amounts are entered for a **standard 10 GA** and scaled linearly by area (`STANDARD_GA = 10`,
`calc730ForBlock` App.jsx:369). Items are grouped: energy/utilities, repairs, other operating.

> The audit's second critical finding: this treats the *entire* pool as strictly variable in area.
> Boiler, supervisors, irrigation node are step costs. Correct treatment is `y = a + bx` with only `b·x` scaled.

### 760 — marketing, packaging, customs, transport
Five groups, three different unit formulas. `tirKg = standartTirKgByCrop[crop] || 18500` is the standard
truck load.

| Group | Driver |
|---|---|
| **760.01 Packaging** | `satisKg / kgPerYesige` (per box), or `(satisKg/tirKg) × paletPerTir` (per pallet), or `icPazarKg / kgPerYesige`. `satisKg = qty × (100 − icPazar%)/100` |
| **760.02 Customs** | same unit formulas as 760.01 |
| **760.03 Transport** | `(channelKg / tirKg) × (fiyat1 + fiyat2)` per destination; `fiyat2` applies to Kazakistan only |
| **760.04 Import customs** | `(channelKg / tirKg) × fiyat1` per destination |
| **760.05 Selling expenses** | per item, unit is `tir` or `kg` × per-destination price |

Prices marked `DTM` are divided by that month's `usdRate`.

### 770
Pool A share + Pool B share ÷ 12, per §4.

---

## 6. What the live 2026 data actually contains

Regenerating the model over `data.json` (`fixtures/sera-2026-golden.csv`) gives:

| Line | 2026 total |
|---|---|
| Production | 59 916 653 kg |
| Revenue (USD, export + gate) | $56 643 395 |
| Domestic revenue (manat, excluded above) | 47 117 486 |
| **Expense** | **$20 496 273** |
| — personnel 720/730/750/760 | **$0** |
| — 770 pool A (admin personnel) | **$0** |
| — 770 pool B (admin expenses) | **$0** |
| — 710 fertilizer | $126 900 |
| — 710 consumables | $596 122 |
| — 730 general production | $11 268 423 |
| — 760 marketing/packaging | $8 504 828 |
| Profit / margin | $36 147 122 / 63.8 % |

**The 2026 budget contains no labour cost at all**, and no administrative cost. Causes, each verified:

1. **Salaries were never entered.** Not a breakage — `addPosition` (App.jsx:5455) creates every new
   position with `salary = 0` and `official = 0` by design, expecting the user to fill them in. In 2026
   someone replaced the placeholder job titles with 33 real Turkmen ones across codes 720/730/750/760
   (`Brigadir`, `Agronomlar`, `Önümçilik Müdir`, `Kotelny`…) and never returned to price them. Headcount
   *is* entered — Dusak-A month 10 has 129 people — and multiplies by zero.

   The only priced positions are the five untouched 770 ones (`p770_1..5`, 500–550), and those are
   `DEFAULT_SALARIES` (App.jsx:710) — the app's **template placeholders** (400, 350, 360, 370…), not YGT
   figures. Years 2024/2025/2027/2028 show all 37 default positions "priced", but with those same
   placeholders and no production data.

   > **Consequence: no year in Sera holds a real salary.** Salary figures for the platform must come from
   > YGT payroll/HR, not from a Sera import.
2. **`Dolandyrys-Merkez` record does not exist** in any year, so 770 pool A is always empty.
3. **`code770YonetimGroups` line items have empty `monthly`** in every year, so 770 pool B is always empty.
4. **`generalExpenses` manual arrays are empty** for every block/month, so manual 710/720/750/770 = 0.

Also: only **15 of 27 blocks** have a production plan (`Dusak-1..10`, `Kaka-N`, `Kaka-P` have none), and
production covers **weeks W02–W26 only** — the plan stops at June. `cropTypes` contains test junk
(`ggfggf`, `sdss`, `dfdf`, `SDSDDS`).

> **Consequence for the port:** the golden fixture is a faithful reproduction of Sera's *engine*, and that
> is what the Django engine must match. But the 2026 *numbers* are not a usable budget — importing them
> yields a budget with no labour and no administration in it. Salaries and head-office costs have to be
> sourced from YGT payroll and finance, entered once in the platform, not carried over from Sera.

---

## 7. Defects and gaps

Ordered by impact. Items 1–3 are from the methodology audit; 4–9 were found reading the code.

| # | Finding | Evidence |
|---|---|---|
| 1 | **Plan-vs-fact does not exist.** `butce` and `gerceklesen` are the *same function over the same plan data* — all 12 months vs elapsed months. The "actual" column holds no actuals. | App.jsx:11126–11127 |
| 2 | **730 scaled as fully variable in area.** No fixed/variable split. | App.jsx:369 |
| 3 | **Annual admin cost ÷ 12 evenly.** Rejected by the greenhouse costing literature for seasonal operations. | App.jsx:1576 |
| 4 | **Extra labour costs never reach any total.** Pension 20 %, income tax 10 %, transport, health and city-improvement charges are computed and displayed on the Personnel page; `calculateMonthlyExpense` never adds them. Structural and permanent. **Current magnitude is $0** — `extraLaborMonthly` and `perPersonRates` are empty, and official salaries are zero for the same reason as #1 in §6. Once the salary table is fixed this becomes ≈30 % of official payroll. | App.jsx:8734 vs 1730 |
| 5 | **Foreign staff salaries never reach any total.** `dasaryYurtIsgarler` is read only by the 760.05 UI (App.jsx:5859); item `i760_5_5` is explicitly filtered out of the group total with a comment saying it is handled elsewhere. It is not. Structural. **Current magnitude: 1 person × 1 000 for month 01 only** — small today, unbounded later. | App.jsx:5859, 1470 |
| 6 | **Crop rotation applied inconsistently to 760.** `generalExpenseSumForBlockMonth` picks the group *list* with the rotation-aware crop, then calls `block760GroupMonthTotal`, which re-derives the crop **without** rotation for the *amounts* — and returns 0 if the group id is absent under the primary crop. No 2026 impact (rotation starts month 07, where production is 0), but it is a live bug. | App.jsx:1544 vs 1470 |
| 7 | **Two production sources in one allocation family.** 770 pool A `production` mode reads the stored `state.production` key; pool B `production` mode reads the computed `buildMonthlyProductionFromWeekly`. They can disagree. | App.jsx:1619 vs 1629 |
| 8 | **750 missing from the reports breakdown.** `generalExpenseBreakdownForBlockMonth` initialises 710/720/730/760/770 but not 750, so a 750 manual item is invisible in Reports (totals are unaffected). | App.jsx:1582 |
| 9 | **Shrinkage asymmetry.** `yenileme` reduces channel revenue but not the kg that drive 760 packaging and transport cost. Possibly intentional — packaging is consumed on shrunk fruit too — but it is undocumented. | App.jsx:1106 vs 1379 |

---

## 8. Implications for `apps.finance`

Recorded now, to be confirmed before any design is written.

1. **MSSQL forbids JSONField.** Sera's state is `block × month × material × code → value` nested maps.
   Every one becomes a long/narrow row table plus a reference table for the labels. Turkmen labels
   (`Elektrik energiýasy`, `Gaplaýyş kagyzy`) need `cyrillic_collation()`.
2. **Plan and actual must be separate tables from day one**, keyed identically so variance is a join.
   This is what fixes defect #1, and it is the main reason to rebuild rather than patch Sera.
3. **Two `CostPool` rows for 770**, each with its own allocation basis, reproducing both headcount
   definitions from §4.
4. **730 needs a fixed + variable field pair** even if only the variable half is populated at first.
5. **Block dimension does not match.** Platform `core.GreenhouseBlock` has 19 rows to Sera's 27: no
   `Dusak-1..10`, no `Kaka-N/P`, and D–J sit at location *Dusak* where Sera says *Kaka*. `area_m2` is null
   on 16 of 19 blocks, and every 730 and 770 allocation needs area. **Reconciling this is a prerequisite
   task, owned by the user.**
6. **Production: read or duplicate?** `greenhouse.HarvestDayEntry` already carries plan / forecast /
   actual per block per day, which would give real production actuals for free. But Sera's weeks are
   **Sunday**-anchored while `WeeklyHarvestPlan` documents itself as **ISO** (Monday) — that is from the
   field docstring, *not* verified against what the importer actually wrote, and it must be checked
   against data before this decision is made. Sera also assigns a whole week to one
   anchor month rather than splitting days across months. Rolling daily entries up to months will
   disagree with Sera at every boundary week. Decide explicitly: replicate the anchor-month rule inside
   finance, or set the acceptance tolerance at year level and accept monthly drift.
7. **Actual costs wait for LOGO ERP** (user decision, 2026-08-03). The actual table still carries a
   `source` field from the start; production and revenue actuals come from platform data
   (`HarvestDayEntry`, shipments, weightmaster) and do not wait for LOGO.
8. **Only 2026 is importable.** The other four years hold defaults, not data.

---

## 9. Acceptance fixture

`fixtures/sera-2026-golden.csv` — 324 rows, one per block × month, produced by lifting App.jsx lines
340–1774 verbatim into Node and running them over the live `data.json`. Columns:

The figures were cross-checked through the app's own hydration path (`mergeRootWithDefaults` →
`mergeYearWithDefaults` → `purgeLegacy770Data`, App.jsx:10105–10299) and are **identical** — the default
merge does not backfill salaries, because 2026 already carries `positionsSchemaVersion = 2`, which skips
the branch that would reset `personnelSalaries` to `DEFAULT_SALARIES`. So §6 is what the live app shows,
not an artifact of the harness.


```
block, month, production_kg, rev_export, rev_kapi, rev_domestic, rev_totalUSD,
personnel_ex770, pool770_share, fertilizer, sarf,
gen_710, gen_720, gen_730, gen_750, gen_760, gen_770manual, yonetim770,
general_total, expense_total
```

The Django engine must reproduce this file cell for cell before any entry screen is built. If a defect
from §7 is fixed rather than reproduced, the fixture must be regenerated with that fix isolated, so the
diff shows exactly what the fix changed and nothing else.

Regenerate (run from the repo root; `build-golden.harness.js` has the `data.json` path hardcoded as
`d:/projects/yigit_platform/...` — edit that line if the repo lives elsewhere):

```bash
node -e "const fs=require('fs');const s=fs.readFileSync('data/sera-butce-web/client/src/App.jsx','utf8').split(/\r?\n/);fs.writeFileSync('calc.cjs',s.slice(339,1774).join('\n'))"
cat docs/finance/fixtures/build-golden.harness.js >> calc.cjs
node calc.cjs
```

Line numbers are pinned to commit `17b8eb9`. If Sera is edited, re-derive the slice bounds — the range
must start at `const MONTHS` and end after `calculateProfit`.
