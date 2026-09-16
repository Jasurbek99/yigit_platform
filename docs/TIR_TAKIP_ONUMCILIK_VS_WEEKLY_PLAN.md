---
title: Tır Takip → Önümçilik tab vs our Weekly Plan
date: 2026-09-16
branch: Copy_Gadams_UI
status: research — no code written
---

# Tır Takip · Önümçilik tab — how it works, and how it lines up with our Weekly Plan

Research note for the first tab of `/tir-takip`. Source of the design:
`data/sera-butce-web/client/src/App.jsx` — `TirTakipPage` at **L12037**, the Önümçilik
tab body at **L13382–L13503**.

---

## 1. What the sera tab actually is

One `<Card>`. No modals, no drawers, no second table.

```
┌─ Önümçilik — Haftalyk Meýilnama ────────── [◀ Öňki hepde][Şu hepde][Indiki hepde ▶] ┐
│ 16.09.2026 — 22.09.2026                                                             │
│ Her gün üçin Üretim Plany'ndan gelen kg (mawy, salt okalýar) we müdiriň ýazan       │
│ hakyky kg-sy (ýaşyl, el bilen).                                                      │
│                                                                                      │
│ [Tümünü Seç][Temizle]                                                                │
│   Dusak  (tümünü seç/kaldır)   ⬤A ⬤B ⬤C ⬤1 … ⬤10                                   │
│   Kaka   (tümünü seç/kaldır)   ⬤D ⬤E … ⬤L ⬤N ⬤P ⬤M15 ⬤M5                           │
│   Owadandepe                    ⬤O                                                    │
│                                                                                      │
│ Blok        │ 16.09 │ 17.09 │ 18.09 │ 19.09 │ 20.09 │ 21.09 │ 22.09 │   JEMI         │
│             │       │       │ şu gün│       │       │       │       │                │
│ Dusak A     │[18500]│[17000]│[19000]│[     ]│[     ]│[     ]│[     ]│   54 500       │
│             │E+G:17k│E+G:17k│E+G:17k│E+G:17k│E+G:17k│E+G: 0 │E+G:17k│                │
│ …                                                                                    │
│ ═════════════════════════════════════════════════════════════════════════════════   │
│ JEMI (gün)  │ 18500 │ 17000 │ 19000 │   0   │   0   │   0   │   0   │   54 500       │
│ Tır sany —  │  1,00 │  0,92 │  1,03 │   —   │   —   │   —   │   —   │    2,95        │
│  Pomidor (÷18 500 kg)                                                                │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

Every cell is **two numbers stacked**:

| | what | source | editable |
|---|---|---|---|
| top (big, bordered input) | müdür's kg for that block-day | `state.tirHaftalikPlan[block][ymd]` | **yes, by anyone** |
| bottom (tiny, blue) | `Export+Gapy: N` | computed, never stored | no |
**Export +Gapy don't need**

Header row: today's column gets `bg-amber-100` + a "şu gün" caption. First column
is `sticky left-0`. The whole table is `overflow-x-auto`.

Footer has **JEMI (gün)** (emerald), then **one truck row per crop in use** —
`Tır sany — Pomidor (÷18 500 kg)`, amber, value = `dayKg / tirKg` printed to
**2 decimals** (so `0,92` of a truck is a legitimate reading, not rounded away).

## 2. Exact state inventory (sera)

All of it hangs off one global `state` object, autosaved wholesale to
`sera_butce_state_v1` through `window.storage` → the node server's `/api/storage/*`.

| key | shape | written on | read by this tab |
|---|---|---|---|
| `weeklyProduction[blockKey][weekKey]` | kg, **weekly** grain | Üretim Planı page (`setWeeklyValue`, L3159) | indirectly, via the blue line |
| `tirHaftalikPlan[blockKey][ymd]` | kg, **daily** grain | **this tab** (`setHaftalikPlan`, L12116) | the green input |
| `gaplamaHaftalikPlan[blockKey][ymd]` | kg, daily | Gaplama tab | falls back to `tirHaftalikPlan` when unset |
| `blockCropType[blockKey]` | cropId | Blok Ayarları | picks truck capacity + distribution |
| `cropTypes[].distribution[MM]` | `{exportChannels:[{id,pct}], kapi, icPazar}` | Satış page | **the blue line** |
| `standartTirKgByCrop[cropId]` | kg, default **18500** | Ayarlar | the `÷` divisor of the Tır sany row |
| `annualLeaveDays[]` | `{date, description}` | Üretim Planı page | zeroes out a day in the spread |
| `blockSettings[key].label` | display name | Blok Ayarları | row label |

### The two derivations

**a. weekly plan → daily** (`buildDailyProductionFromWeekly`, L881)

```
perDay = weeklyTotal / (count of working days in that week)
working day = NOT Sunday (index 0 of the week)  AND  NOT in annualLeaveDays
```

Flat spread. A 6-working-day week holding 111 000 kg gives every day 18 500 kg;
one leave day in that week pushes the other five up to 22 200 kg each.

**b. daily total → export+gate share** (`getExportKapiDailyKg`, L12078)

```
monthKey = ymd.slice(5,7)                            // "2026-09-18" → "09"
dist     = getNormalizedDist(crop, monthKey)
share    = Σ dist.exportChannels[].pct + dist.kapi   // İçerki Bazar excluded
blue     = round(dailyProduction[block][ymd] * share / 100)
```

So **the blue reference is not harvest — it is the export + gate-sale slice of
harvest**, which is exactly the tonnage that can become a truck.

## 3. The week-model trap (biggest structural difference)

Two *different* week grids sit inside one screen:

| | anchor | used for |
|---|---|---|
| `weekDates(year, w)` | **Sunday**-anchored (`firstSundayOnOrBefore(year)`), Sun…Sat | `weeklyProduction`, the flat-spread denominator |
| `next7Days` (L12122) | **today + weekOffset × 7**, then +0…+6 | this tab's columns and its JEMI sums |

`next7Days` is a **rolling window**, not a calendar week. Open the tab on a
Wednesday and the columns run Wed→Tue; the JEMI column is the sum of a window
that has no counterpart anywhere else in the app. The blue numbers inside it
still derive from Sun–Sat weekly totals, so the two grids are permanently
unaligned and nothing reconciles them.

Our grid is **ISO week (Mon–Sun) throughout**.

## 4. Our Weekly Plan, for comparison

`frontend/src/pages/export/WeeklyPlanGrid.tsx` (893 lines) +
`docs/obsidian/processes/weekly-harvest-planning.md`.

- **Storage**: `WeeklyHarvestPlan` (container, UNIQUE `season+block+week+year`) →
  `HarvestDayEntry` (one row per block-day, UNIQUE `weekly_plan+entry_date`).
- **Three value layers per cell**, not one: `plan_value`, `forecast_value`,
  `actual_value` — each with its own `*_submitted_at` / `*_submitted_by`, plus
  `plan_state` (on_time/late/critical_late), `forecast_window`
  (primary/fallback/same_day_red_flag), `forecast_revision_count`, and
  `actual_source` (manual/shipment_rollup/admin_override).
- **Writes are per-cell PATCH** to `/greenhouse/day-entries/{id}/`, gated in the
  service layer by role **and** block ownership (`BlockManagerAssignment`) **and**
  time window (plan: through that week's own Sunday 23:59:59; forecast: the
  configured window). Admin/boss overrides demand a `reason` that lands in `AuditLog`.
- **Actuals are computed**, not typed: `rollup_actuals_for_date` sums
  `ShipmentBlockSource.weight_kg` per block per day (sub-blocks F1/F2 folded into F).
- **Trucks**: header tile = Σ most-current-value ÷ `GreenhouseConfig.truck_capacity_kg`
  (18 500), plus a separate `TruckAllocationTable` below the grid with
  destination rows × day columns.
- **Blocks**: 15 active top-level; `GreenhouseBlock.location` → `LoadingLocation`
  = **Dusak / Kaka / Owadandepe** — the same three-way split sera calls `group`.

## 5. Mapping table

| sera concept | our equivalent | status |
|---|---|---|
| `BLOCKS` (27, hardcoded) | `GreenhouseBlock` (15 active top-level + sub-blocks) | ✅ exists, different count |
| `b.group` Dusak/Kaka/Owadandepe | `GreenhouseBlock.location` → `LoadingLocation` | ✅ exact match |
| `blockLabel(state, key)` | `block.name` / `block.code` | ✅ |
| `blockCropType[block]` | `GreenhouseBlock.variety_main` (FK `TomatoVariety`) | ⚠️ ours is a cultivar, not a "crop with a sales profile" |
| `weeklyProduction[block][week]` | `HarvestDayEntry.plan_value` (already daily) | ⚠️ ours is finer — no weekly→daily spread needed |
| flat spread over working days | *nothing* — our managers type each day | ✅ we are ahead; but this path has no `annualLeaveDays` equivalent (`OperatingDayException` is the nearest) |
| `tirHaftalikPlan[block][ymd]` (green cell) | **no clean match** — see §6 Q1 | 🔴 **OPEN** |
| `cropTypes[].distribution[MM]` (export%/kapı%/içerki%) | **does not exist** | 🔴 **OPEN** |
| blue `Export+Gapy: N` | **not buildable as designed** — see §6 Q2 | 🔴 **OPEN** |
| `standartTirKgByCrop[cropId]` | `GreenhouseConfig.truck_capacity_kg` (one global value, not per-variety) | ⚠️ ours is global |
| `Tır sany` footer row, 2 decimals | "Est. Trucks" tile (week total) + `TruckAllocationTable` per-day capacity `Math.round(kg/18500)` | ⚠️ we round to whole trucks; sera shows fractions |
| rolling 7-day window | ISO week picker | 🔴 different nav model |
| free edit, no audit, no roles | 4-point permission chain + audit + time windows | 🔴 different governance |

## 6. The open questions — these change the build, so settle them first

### Q1. What *is* the green cell, in our data model?

Sera's green number is judged against an **export+gate** reference, so what the
müdür types there is **export-bound kg**, not total harvest. Ours:

- `plan_value` = total harvest planned — **wrong grain**
- `forecast_value` = total harvest expected — **wrong grain**
- `actual_value` = already "exported, not harvested" (it is a shipment rollup) —
  right grain, **but computed, not typed, and only exists after the fact**

None of the three is a drop-in. Three ways out:

1. **Re-skin `forecast_value`** — cheapest, ships fastest, but silently redefines
   forecast from "harvest" to "export-bound" for every other consumer
   (truck allocation, boss dashboard, weekly-plan actuals).
2. **New field** `export_plan_value` on `HarvestDayEntry` — honest, one migration,
   no collateral damage, but a fourth layer on an already four-layer row.
3. **New model** `TirDailyPlan(block, date, kg)` in the export app — fully separate,
   sera-shaped, zero risk to greenhouse; costs a table and a reconciliation story.

### Q2. Where does the blue reference number come from?

We have **no per-month channel split**. `TomatoVariety` carries no percentages;
`LocalSellPlan` is per **export firm** per weekday in kg (firm-scoped, not
block-scoped), and `DomesticSale` records after-the-fact events. Options:

1. Drop the blue line; show `plan_value` (total harvest) as the reference and
   rename the caption. Loses the export/domestic distinction sera had.
2. Build the split — a new per-variety-per-month distribution table. That is a
   feature in its own right, not part of this tab.
3. Use `forecast_value` as the reference and treat the green cell as the
   packing-bound number, dropping the percentage concept entirely.

### Q3. Rolling 7 days, or ISO week?

Sera's `today + n×7` window is arguably a bug they live with. Keep it and this
tab cannot reuse the week picker, and its JEMI totals will never tie out against
`/export/plan`. Switch to ISO week and the tab becomes a second view of the same
week, with the two screens agreeing — at the cost of not matching the reference
design exactly.
*(Day-grain reads are unaffected either way: `useDayEntries({from_date,to_date})`
serves any window.)*

### Q4. Who may type in the cell?

`tir_takip.onumcilik` is currently granted to **all 15 roles** (migration
`core/0051_tir_takip_page_perms`) — that is a *visibility* grant. Sera has no
write gate at all. Our plan cells are gated at four separate points (frontend
capability, two backend field checks, resource check). **An editable grid behind
a visibility-only permission is a hole**; it needs its own write code
(e.g. `tir_takip.onumcilik.write`) decided before the build, not after.

## 7. Side note, not for fixing here

Truck capacity is spelled three ways in the frontend today:
`GreenhouseConfig.truck_capacity_kg` (18 500, used by `WeeklyPlanGrid` and
`FallbackForecastView`), a hardcoded `18500` in
[TruckAllocationTable.tsx:20](../frontend/src/pages/export/TruckAllocationTable.tsx#L20),
and `18100` in [contractPlan.ts:12](../frontend/src/utils/contractPlan.ts#L12).
Worth unifying someday; out of scope for this tab.

## 8. Build surface, if/when we proceed

`frontend/src/pages/sera/sera.css` (159 lines) currently defines only
`.sera-page`, `.sera-tabs`, `.sera-tab`, `.sera-card`, `.sera-empty`.
The Önümçilik tab additionally needs: a grouped chip selector, a sticky-first-column
data table, an inline numeric cell, a today-column highlight, and footer total rows.
None exist yet — and per the owner's rule ("new pages have another design, don't
change ours") they must be sera-styled CSS, not antd components.

## 9. What the copy actually isolates — and what it does not

Only the **view** is duplicated. Everything under it is one system, so "we copied
it" is not the same as "we can change it freely".

| Layer | Shared with `/export/plan`? | Change it and… |
|---|---|---|
| `pages/sera/OnumcilikTab.tsx` | ✗ isolated | only the tab changes |
| `HarvestCell`, `CellHistoryModal`, `GrantExtensionModal`, `TruckAllocationTable` | ✓ shared | **both** screens change |
| `usePlanning` hooks, `WeeklyPlanGrid.roles`, the `plan.*` i18n keys | ✓ shared | **both** screens change |
| `/greenhouse/day-entries/`, `greenhouse/services`, `HarvestDayEntry` | ✓ shared | **both** screens change, plus every other consumer |

So **step 2 (restyle) is safe by construction** — it touches the copy and CSS and
nothing else. **Step 3 (functional) is where this bites**, and it is the same
question as §6 Q1 by another route: redefining `forecast_value` to mean
"export-bound kg" for this tab silently redefines it on `/export/plan`, in
[[truck-allocation]], on the boss dashboard, and in the weekly-plan actuals
rollup. Nothing warns you — the field keeps its name and its type.

### The rule for step 3

Any change that must apply to **one** screen only needs its own storage:

1. **New field** on `HarvestDayEntry` (e.g. `export_plan_value`) — one migration,
   `/export/plan` never reads it. Cheapest honest option.
2. **New model** in the export app — fully separate, sera-shaped, zero risk to
   greenhouse. Costs a table and a reconciliation story.
3. **Reuse the existing field** — only when both screens genuinely mean the same
   thing. Otherwise the two screens are one feature wearing two coats, and every
   later change to either is a change to both.

The same caution applies one layer up: the moment the restyle needs its own
`HarvestCell`, **fork that file too** rather than adding a `variant` prop to the
shared one. A prop that selects between two designs puts both designs in one
file, which is the coupling the duplication was bought to avoid.

### What is deliberately shared forever

The **data**. Both screens read and write the same `HarvestDayEntry` rows — type a
number on `/export/plan` and it is there in the tab, and the other way round. The
duplication is of the view, never of the truth. That is the point; nothing in
step 2 or step 3 should change it without the owner saying so explicitly.
