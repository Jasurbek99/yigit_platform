# Boss Dashboard — merge the three per-block tables into one

**Date:** 2026-08-11
**Status:** Approved, not implemented
**Scope:** Frontend only. No backend, no API, no migration.

## Problem

The Boss Dashboard writes the greenhouse block list four times down one page:

| Where | Shape | Source |
|---|---|---|
| `BlocksHeatmap.tsx` | 15 colored tiles | `GET /boss/blocks_heatmap/` |
| `ProductionResults.tsx` — table 1 | 15 rows | `GET /boss/production/?scope=daily` |
| `ProductionResults.tsx` — table 2 | 15 rows | `GET /boss/production/?scope=seasonal` |
| `ExportMarketByBlock.tsx` | 15 rows | `GET /boss/export_market/` |

Three of those are vertical tables whose left column is the same block list in the same
order, so the boss reads "A1, A2, B1, …" three times and has to hold a block in memory to
compare its harvest against its export. 45 block labels on screen where 15 would do.

## Decision

Merge the **three tables** into one card. The heatmap stays — it is a different
instrument (at-a-glance color scan, not a comparison table) and sits in a different part of
the page next to Top Customers.

```
BLOKLAR BOÝUNÇA NETIJELER

          │ GÜNLÜK      │ AÝLYK       │ MÖWSÜMLEÝIN  │ DAŞARKY BAZAR│
 Blok     │ Plan   Fakt │ Plan   Fakt │ Plan   Fakt  │  KG      %   │ Möwsüm %
──────────┼─────────────┼─────────────┼──────────────┼──────────────┼──────────
 A1       │3 000  2 800 │ 62k    58k  │ 210k   198k  │ 185 400  12.1│ ▓▓▓▓▓▓▓░ 94%
 A2       │2 500  2 900 │ 55k    60k  │ 180k   191k  │ 176 200  11.5│ ▓▓▓▓▓▓▓▓ 106%
 …
 JEMI     │12 700 11 900│ 680k  641k  │ 890k   874k  │1 532 000 100%│ ▓▓▓▓▓▓▓▓ 98%

 Içerki Bazar we Sowgatlyk soň goşulýar
```

## Why the merge is safe

All three backend aggregators build their row list from the **identical** query:

```python
GreenhouseBlock.objects.all().values('id', 'code', ...).order_by('code')
```

— `_aggregate_production` (`boss_analytics.py:1097`), `_aggregate_export_market`
(`:1171`), `_aggregate_blocks_heatmap` (`:842`). Every block appears in every response,
zero-filled when it has no data. So the merge is a 1:1 join on `block_code` with no
missing-row case in practice.

`mergeBlockRows()` still left-joins on the daily response and zero-fills a block absent
from either of the others, rather than assuming the invariant holds. The invariant is a
property of today's backend, not a contract the frontend can enforce; a zero row is a
recoverable wrong number, an undefined-property crash takes the whole card down.

## Time windows differ per column group

This is pre-existing behaviour that the merge makes visible, and the reason the groups are
labelled at all:

| Group | Window | Follows the period switcher? |
|---|---|---|
| GÜNLÜK | `today` only — `_aggregate_production` overrides the range with `date.today()` (`:1101-1103`) | **No** |
| AÝLYK | current calendar month, computed from `today` (`:1110-1114`) | **No** |
| MÖWSÜMLEÝIN | the requested `from_date … to_date` | Yes |
| DAŞARKY BAZAR | the requested `from_date … to_date` | Yes |

Two of the four groups ignore the period pills. Stacked as separate tables this was merely
unclear; side by side in one row it would be actively misleading without the group headers.

**`monthly_*` is identical in both production responses** — it is derived from `today`,
never from `scope`. The AÝLYK group therefore reads from the **daily** response and the
seasonal response's copy is ignored. This is deliberate, not an oversight.

## Network cost

Unchanged. The page already issues all three requests today; `ProductionResults` calls
`useBossProduction` twice and `ExportMarketByBlock` calls `useBossExportMarket` once. The
merge is client-side. Three requests before, three after — one card instead of two.

## Click targets

A merged row cannot have one destination, so the target follows the **cell group** clicked:

| Clicked | Destination |
|---|---|
| Block name, GÜNLÜK, AÝLYK, MÖWSÜMLEÝIN cells | `/export/plan?block=<code>` |
| DAŞARKY BAZAR cells (KG, %) | `/export/shipments?block_source=<code>` |
| The Möwsüm % bar | `/export/plan?block=<code>` |

Hover highlights only the group under the cursor, so both destinations stay discoverable.
Both routes exist today — this preserves them rather than inventing navigation.

## Files

**New**

- `frontend/src/pages/boss/BlocksTable.tsx` — the card: three hooks, merge call, header /
  rows / total. Target ≤150 lines (`frontend/CLAUDE.md`), which both deleted files exceed.
- `frontend/src/pages/boss/BlocksTable.helpers.ts` — `mergeBlockRows()`, `sumTotals()`,
  and the shared `GRID_TEMPLATE` string. Pure functions, no React. Follows the
  `QuotaUsageGrid.helpers.ts` precedent so the merge rule is unit-testable without
  rendering.

**Deleted**

- `frontend/src/pages/boss/ProductionResults.tsx` (209 lines)
- `frontend/src/pages/boss/ExportMarketByBlock.tsx` (146 lines)

**Edited**

- `frontend/src/pages/boss/BossDashboard.tsx` — the `<ProductionResults>` and
  `<ExportMarketByBlock>` mounts become one `<BlocksTable period={period} />`.
- `frontend/src/i18n/{tk,ru,en}.json` — see below.

**Carried over verbatim:** the `note_excluded` footnote and the CRITICAL comment at the top
of `ExportMarketByBlock.tsx` forbidding `domestic_kg` / `gift_kg` / `icerki_kg` /
`sowgatlyk_kg` columns. That comment exists to stop exactly the "while we're here, add a
column" edit a table refactor invites, and it must survive the file it lives in.

## Hooks and types

No change. `useBossProduction`, `useBossExportMarket`, `IBossProductionRow`,
`IBossExportMarketRow` are all reused as they are. `mergeBlockRows()` introduces one new
local type, `IMergedBlockRow`, declared in the helpers file:

```ts
export interface IMergedBlockRow {
  block_code: string;
  block_name: string;
  daily_plan_kg: number;
  daily_actual_kg: number;
  monthly_plan_kg: number;
  monthly_actual_kg: number;
  seasonal_plan_kg: number;
  seasonal_actual_kg: number;
  seasonal_pct: number;   // drives the bar
  export_kg: number;
  export_pct: number;
}
```

## i18n

Most of what the merged table needs already exists, including three keys that are
**currently defined in all three languages but consumed by nothing** —
`production.scope_daily` / `scope_monthly` / `scope_seasonal`. They become the group
headers, which is what they read like.

**Reused as-is:** `production.header_block`, `production.total_row`,
`production.scope_daily`, `production.scope_monthly`, `production.scope_seasonal`,
`export_market.note_excluded`.

**New — `boss_dashboard.blocks_table.*` plus one section title:**

| Key | tk | ru | en |
|---|---|---|---|
| `section.blocks_table` | Bloklar boýunça netijeler | Результаты по блокам | Results by Block |
| `blocks_table.group_export` | Daşarky Bazar | Внешний рынок | Export Market |
| `blocks_table.col_plan` | Plan | План | Plan |
| `blocks_table.col_actual` | Fakt | Факт | Actual |
| `blocks_table.col_kg` | KG | КГ | KG |
| `blocks_table.col_season_pct` | Möwsüm % | Сезон % | Season % |

The `%` sub-column under DAŞARKY BAZAR is the literal character, not a key.

**Removed from all three languages** (every consumer is a deleted file — verified by grep,
nothing outside `ProductionResults.tsx` / `ExportMarketByBlock.tsx` reads them):
`section.production_daily`, `section.production_seasonal`, `section.export_market`,
`production.header_planned`, `production.header_actual`, `production.header_graph`,
`export_market.header_block`, `export_market.header_kg`, `export_market.header_pct`,
`export_market.total_row`.

`export_market.note_excluded` **stays** — it is the footnote, still rendered.

## Testing

`BlocksTable.helpers.test.ts` (pure, no render):

1. Merge aligns on `block_code` — a row's daily, monthly, seasonal and export figures all
   land in the right fields.
2. A block present in production but absent from the export response zero-fills rather
   than producing `undefined` or dropping the row.
3. An export row whose `block_code` matches nothing in production is dropped, not
   appended as a nameless row.
4. `sumTotals()` sums all eight numeric columns and recomputes the seasonal % from the
   summed plan/actual, not by averaging the per-row percentages.
5. Empty input → empty rows, zero totals, no divide-by-zero.

`BlocksTable.test.tsx` (render):

6. Clicking a MÖWSÜMLEÝIN cell navigates to `/export/plan?block=A1`.
7. Clicking a DAŞARKY BAZAR cell on the same row navigates to
   `/export/shipments?block_source=A1`.

Test 7 is the discriminating one: it fails against any implementation that puts a single
`onClick` on the row, which is what both deleted components did.

## Docs to update

- `docs/obsidian/screens/boss-dashboard.md` — widget table 13 → 12 rows, renumbered;
  `ProductionResults` + `ExportMarketByBlock` rows collapse into one `BlocksTable` row.
- `docs/obsidian/roles/boss.md` — widget list 12 → 11 rows, same collapse.
- `CHANGELOG.md` under **Changed**.
- `BUILD_TEST_LOG.md`.

## Out of scope

- **The heatmap is not touched.** Merging it in was offered and declined; it is a
  different instrument and lives elsewhere on the page.
- **No backend change.** `/boss/production/` and `/boss/export_market/` keep their current
  shapes and tests. A single merged endpoint was not proposed — the three calls are already
  cached 60 s both server- and client-side, and collapsing them would rewrite tested
  aggregators to save nothing measurable.
- **Içerki Bazar / Sowgatlyk columns** remain excluded, per the standing v1 decision.
- **Making GÜNLÜK / AÝLYK follow the period switcher.** Their windows are fixed by the
  backend and this change only labels that; altering it is a separate question for the
  domain owner.
