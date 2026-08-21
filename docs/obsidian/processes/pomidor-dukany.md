---
tags: [process, analytics, production, planning]
related: ["[[weekly-harvest-planning]]", "[[permissions-system]]", "[[../roles/boss]]"]
---

# Pomidor Dükany — production analysis

## What Is This Process?

Planned vs achieved tomato production per greenhouse block. It replaces the analysis the office ran by hand in `data/Pomidor Dükany 2025-2026.xlsx` — a 203-sheet workbook whose analytical sheets are `Hepdelik planlama` (weekly plan with per-block totals and variance), `Gunluk babatynda` (daily basis), `Aylyk we mowsumluk babatynda` (monthly + seasonal, with an achievement ratio) and `Ekilen meydana gora` (by planted area). `sera-butce-web` carries the same screen; this is the YGT port of it.

**Nothing is imported from the workbook.** Every figure is computed from data the platform already stores — the workbook defined *which* numbers matter, not where they come from.

## How It Works

| Column | Source |
|--------|--------|
| Meýilleşdirilen (planned) | `HarvestDayEntry.plan_value` summed over the range |
| Daşarky bazar (export) | `ShipmentBlockSource.weight_kg` |
| Içerki bazar (domestic) | `DomesticSale.weight_kg` |
| **Ýerine ýetirilen (achieved)** | **export + domestic** — see below |
| Rollup | `HarvestDayEntry.actual_value` — **diagnostic only** |
| Tapawut (variance) | achieved − planned, signed |
| Ýerine ýetiriş % | achieved / planned, colour-banded ≥90 green / ≥60 amber / below red (the same thresholds sera-butce uses, so the two screens agree on "on track") |
| Meýdan, kg/m² | `GreenhouseBlock.area_m2` — populated since the original seed but, before this feature, read by nothing except the block admin page |

### Why achieved is not `HarvestDayEntry.actual_value`

The first cut of this page used the rollup value, and it was wrong three ways. The owner caught it by asking where the data came from.

1. **`plan_value` is a *harvest* plan; the rollup only measures exports.** `rollup_actuals` sums `ShipmentBlockSource` and never reads `DomesticSale` — grep it. Judging a harvest plan by export-only understates every block that sold at home.
2. **It was duplication dressed as corroboration.** `actual_value` and a `ShipmentBlockSource` sum are the *same rows*, differing only in date bucketing. The table showed both as if they were independent measurements.
3. **It reads zero where the rollup has not run.** That job is a cron absent from `CELERY_BEAT_SCHEDULE` and installed per server. On this project's database it had filled **26 of 3,519** cells while `ShipmentBlockSource` held 2,302,262 kg — so a block that exported millions would have shown 0% achievement.

Achieved is therefore `export + domestic`: the real dispositions. It works whether or not the rollup runs, counts domestic sales the moment anyone records them (the table has **0 rows** today — nobody has used it yet, so that column reads zero for now), and measures the thing the plan actually plans.

`rollup_kg` is still returned and shown in a muted column, as a **staleness diagnostic**: where it diverges from achieved, the rollup is stale for those days or an admin overrode a cell. `rollup_days` counts the days carrying a value, so `—` ("never computed") is distinguishable from `0` ("computed as zero") — a distinction a plain `SUM` of NULLs erases.

**Grain: top-level blocks only** (`parent__isnull=True`). Not tidiness — correctness. `HarvestDayEntry` rows are created for top-level blocks and `ShipmentBlockSource` writes are normalized to the parent by `services/block_sources.py`, so including sub-blocks would list O, OD and OG as three rows whose areas (173,184 = 86,592 + 86,592 m²) and weights double-count one greenhouse. A test pins this.

**Domestic/export shares are of achieved**, which is those two summed — so they always total 100%.

**Date bucketing mirrors the existing `/boss` aggregates** so the numbers agree with the dashboard: harvest by `entry_date`, exports by `Shipment.date`, domestic by `DomesticSale.date`. Soft-deleted shipments (`deleted_at`) are excluded; **archived ones are not** — `is_archived` only means "terminal for 21 days", which is exactly what a past month's analysis is made of.

## The four screen modes are one query

The page has two independent toggles — period mode (Hepdelik / Aýlyk / Möwsümleýin) and granularity (Döwür / Jemleýji) — but the backend takes only `date_from` / `date_to`. `PomidorDukany.helpers.resolveRange()` collapses the modes to a range in pure, tested code.

This is deliberate: a `mode=` parameter would put four branches of calendar logic in the service, to be kept in sync with the UI that already owns week/month pickers. Cumulative granularity **clamps** its cut-off day into the period — the day and the period are picked independently, so a stale cut-off must not widen the range or invert it (the endpoint 400s on an inverted range).

## Backend

- `apps/export/services/pomidor_dukany.py` — `build_production_analysis(date_from, date_to, block_ids=None)`. Three grouped aggregates, no per-block queries.
- `apps/export/views_pomidor_dukany.py` — `GET /api/v1/export/production-analysis/?date_from=&date_to=&blocks=`.
- Blocks with no data in range are still returned as zeros, so the row set stays stable as the user pages between months.
- `MAX_RANGE_DAYS = 800` guards the **range**, not the row count: rows are bounded by the block table (~15), but an unbounded range would scan every `HarvestDayEntry` ever written.

## Permissions

Page code `export.pomidor_dukany` (`core/permission_registry.py`). `_ALL_PAGES` is computed from that registry, so `admin`, `director`, `export_manager` and `boss` pick it up from `seed_permissions` automatically — no `PAGE_DEFAULTS` edit and, because a brand-new page code has no existing rows, **no migration**: `get_or_create` inserts on a plain re-run (unlike the boss widening, which had to update rows that already existed).

The endpoint gates independently on `ANALYSIS_VIEW_ROLES = PRIVILEGED_ROLES | {'boss'}` — the same call-site widening pattern as `/assign` and `/join`. The two lists match by construction, and a test asserts `transport` gets a 403.

## Frontend

- `pages/export/PomidorDukany.tsx` — route `/export/pomidor-dukany`.
- `pages/export/PomidorDukany.helpers.ts` — `resolveRange`, `achievementTone`, `formatVariance`. Pure and unit-tested.
- `hooks/useProductionAnalysis.ts` — block ids are sorted before entering the query key so a re-ordered selection still hits the cache.
- Menu: boss sees it in `nav.group_planning` right after the Weekly Plan (the analysis of that plan); staff see it in `nav.group_analytics` beside Block Summary. Both orderings are asserted in `AppLayout.menuGroups.test.tsx`.

## Not built

- **Year-over-year comparison** (`Onceki Yillar onumcilik karsila` in the workbook). Deferred, not attempted.
- The weekly plan grid itself still has **no per-block row totals** — the `Jemi` / `Ýerine ýetirilen` / variance columns the `Hepdelik planlama` sheet carries on the right. Those numbers live on this page instead; adding them to the grid remains an option.

## Connections

- [[weekly-harvest-planning]] — where `plan_value` and `actual_value` are entered and computed
- [[permissions-system]] — page registry and the call-site role widening
- [[../roles/boss]] — the main consumer
