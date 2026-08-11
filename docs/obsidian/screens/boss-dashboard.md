---
title: Boss Dashboard
tags: [screen, analytics, boss, director, executive]
related: [[../roles/boss]], [[../roles/roles-matrix]], [[../api-endpoint-map]]
---

# Boss Dashboard

Executive analytics view at `/boss/dashboard`. Available to `boss` and `director`. Before the 2026-08-05 boss-process-visibility widening this was `boss`'s only visible page (read-only, dashboard-only); `boss` now has full page/resource access across the app (see [[../roles/boss]]) but this dashboard remains his default landing page and daily habit — a 30-second check, mostly mobile.

Backend: `BossAnalyticsViewSet` at `/api/v1/export/boss/<action>/` — 17 endpoints (added `process-doc` + `process-doc-links`, 2026-08-06), all gated by `IsBossOrDirector`. Most are cached for 60s; `process-doc` (serves a static file) and `process-doc-links` (a small always-fresh mapping table) are not.

## Page layout

Top toolbar:
- Title + subtitle ("Direktor görnüşi — analitika we hasabatlar")
- **Period switcher** (URL-backed via `useSearchParams`): Şu gün · Hepde · Aý (default) · Möwsüm · 5 ýyl
- **Export dropdown** (Excel / PDF) — opens a section sub-menu

Body — 12 widget groups, in this order:

| # | Component | Endpoint | Notes |
|---|---|---|---|
| 1 | `HeroKpiStrip.tsx` | `GET /summary/` | 6 KPI cards with 12-week sparklines |
| 2 | `RevenueChart.tsx` | `GET /revenue/` | ECharts line + area, current vs previous season; full-width |
| 3 | `RoutePnlTable.tsx` | `GET /route_pnl/` | per country + city; clickable rows |
| 4 | `ComplianceStrip.tsx` | `GET /compliance/`, `/ops_pulse/` | reports overdue, 1:10 quota, docs by 13:00 + ops counters |
| 5 | `QuotaGrid.tsx` | `GET /quota_grid/` | 24 firms, 3-color levels |
| 6 | `BlocksHeatmap.tsx` | `GET /blocks_heatmap/` | 15 blocks, 5 color bands |
| 7 | `TopCustomers.tsx` | `GET /top_customers/` | Top 5 + "Galanlary" rest aggregate |
| 8 | `FirmRiskMatrix.tsx` | `GET /risk_matrix/` | quota = real, debt + credit = placeholder |
| 9 | `AlertsPanel.tsx` | `GET /alerts/` | 7 unread `Notification` rows |
| 10 | `BlocksTable.tsx` + `BlocksTableRows.tsx` + `BlocksTable.helpers.ts` | `GET /production/?scope=daily`, `GET /production/?scope=seasonal`, `GET /export_market/` | One row per block: Günlük / Aýlyk / Möwsümleýin plan-vs-actual + Daşarky Bazar kg & share. Merged client-side on `block_code` (2026-08-11 — replaced `ProductionResults.tsx` + `ExportMarketByBlock.tsx`, which wrote the block list three times). Two click targets per row — see below |
| 11 | `ReportsGrid.tsx` | triggers `/export_excel/` and `/export_pdf/` | 6 download tiles |
| 12 | `ProcessGuides.tsx` | `GET /process-doc/?doc=<slug>`, `GET /process-doc-links/` (BPMN diagram fetches this one directly, not through the React app) | Two tiles opening process-explainer docs from `docs/how_works/` in a new tab; full mechanism + security notes in [[../roles/boss#Process guides (2026-08-06)]] |

## BlocksTable — the merged per-block view (2026-08-11)

Until 2026-08-11 the block list was written **three times** down the page: two stacked
tables inside `ProductionResults.tsx` (daily + seasonal) and one more in
`ExportMarketByBlock.tsx`. All three iterated the same
`GreenhouseBlock.objects.all().order_by('code')`, so they always held the identical row
set in the identical order. They are now one table with the block column written once.

**The merge is client-side.** No endpoint changed, and the page issues the same three
requests it always did — `mergeBlockRows()` in `BlocksTable.helpers.ts` joins them on
`block_code`. The join left-joins on the **daily** response, zero-filling a block absent
from the seasonal or export response rather than trusting the shared-row-set invariant,
which is a property of the current backend and not a contract the frontend can enforce.

**The four column groups cover different time windows, and only two follow the period
switcher:**

| Group | Window | Follows the period pills? |
|---|---|---|
| Günlük | `date.today()` — the requested range is overridden in `_aggregate_production` | **No** |
| Aýlyk | current calendar month, derived from `today` | **No** |
| Möwsümleýin | the requested `from_date … to_date` | Yes |
| Daşarky Bazar | the requested `from_date … to_date` | Yes |

That was always true; stacking the tables merely hid it. The group headers are the only
thing on screen saying so — do not remove them. `monthly_*` is read from the daily
response only, since the backend derives it from `today` regardless of `scope` and the
seasonal response carries an identical copy.

**Two click targets per row.** The harvest cells (block name, Günlük, Aýlyk, Möwsümleýin,
and the % bar) open `/export/plan?block=<code>`; the Daşarky Bazar cells open
`/export/shipments?block_source=<code>`. Both destinations existed before the merge and
both are preserved. Hover highlights only the group under the cursor. `BlocksTable.test.tsx`
pins the two targets — that test fails against any implementation that puts one `onClick`
on the whole row, which is what both replaced components did.

The total row's Möwsümleýin % is recomputed from the summed plan and actual, never by
averaging the per-row percentages.

## KPI definitions

| KPI | Field | Formula |
|---|---|---|
| Möwsüm girdejisi | `revenue` | `Sum(Shipment.total_amount_usd)` over period; `delta_pct` vs same period last season |
| Margin | `margin` | `Sum(SalesReport.total_usd) − Sum(transport_cost + market_fee + other_expenses)`. Approximate — no true COGS yet |
| Bergi | `debt` | **Placeholder** until P4 Contracts (hero KPI tile only — the debt-aging card was removed 2026-08-11) |
| Bu gün ýüklendi | `today_loaded` | `Shipment.loading_started_at::date = today` |
| Ýolda maşyn | `in_transit` | `Shipment.status__code` in {`yola_chykdy`, `serhet_tm`, `serhet_gechdi`, `barysh_gumrugi`, `yolda`} |
| Kwota ulanyldy | `quota_used` | `Sum(QuotaUsageRecord.kg_used) ÷ Sum(QuotaIssuanceFirmAllocation.kg_quota)` × 100 |

## Threshold tables

Quota grid `level`:
- `≤80%` → `ok` (green)
- `80–95%` → `warn` (yellow)
- `≥95%` → `alert` (red)

Block heatmap `color_band` (% of plan):
- `≥120%` → `excellent` (dark green)
- `100–120%` → `good`
- `90–100%` → `ok`
- `70–90%` → `warn`
- `<70%` → `alert`

Firm risk_level (v1, until debt + credit data exists):
- `quota_pct ≥ 95%` → `high`
- `80–95%` → `med`
- `<80%` → `low`

## Drill-down map

| Click | Goes to |
|---|---|
| Hero "in transit" | `/export/shipments?status=yyolda` |
| Hero "today loaded" | `/export/shipments?status=yuklenme&date=today` |
| Hero "quota used" | `/export/quota` |
| Revenue chart point | `/export/shipments?from={week}&to={week+6}` |
| Route P&L row | `/export/shipments?country={id}&city={city}` |
| Quota grid cell | `/export/quota?firm={id}` |
| Block heatmap cell | `/export/plan?block={code}` |
| Top customer row | `/export/shipments?customer={id}` |
| BlocksTable — harvest cells (block name, Günlük, Aýlyk, Möwsümleýin, % bar) | `/export/plan?block={code}` |
| BlocksTable — Daşarky Bazar cells (kg, %) | `/export/shipments?block_source={code}` |
| Alert | `Notification.link` |

## Out of v1 (explicit scope decisions)

- **Içerki Bazar** (domestic market per block) — excluded; will be added with the broader domestic-sales analytics phase.
- **Sowgatlyk** (gift / promo per block) — excluded for the same reason.
- **True debt aging + bank credit per firm** — wait for P4 Contracts (`ContractSale`, `Payment`, firm credit table). The `DebtBreakdown` aging card was removed from the page on 2026-08-11; `GET /debt/` still exists on the backend and can be re-mounted when P4 lands.
- **AI summary block, drill-down modals, comparison mode, cash-flow forecast, what-if scenarios, mobile push, voice summary, PDF charts, Navixy GPS map, Logo Tiger / 1C live integrations** — all deferred to follow-up PRs.

## i18n

All visible strings live under the `boss_dashboard.*` namespace in `frontend/src/i18n/{tk,ru,en}.json`. Turkmen is primary; the `note_excluded` footnote under the BlocksTable reads "Içerki Bazar we Sowgatlyk soň goşulýar". The BlocksTable's group headers reuse `boss_dashboard.production.scope_daily` / `scope_monthly` / `scope_seasonal` — keys that existed but had no consumer before the merge; its own short column labels live under `boss_dashboard.blocks_table.*`.

## Caching

- Backend: 60s `cache.get_or_set` per `(action, period, from, to)`.
- Frontend: TanStack Query `staleTime: 60_000`.
- Switching period changes the queryKey → automatic refetch.

## Data audit (what's real vs placeholder)

See [[../roles/boss]] for the full table. Summary:
- **Real**: KPIs (except margin = approximate, debt = placeholder), revenue, ops pulse, quota grid, blocks heatmap, top customers, alerts, production results, export-market, compliance (1:10 rule, reports overdue, docs by 13:00), Excel + PDF exports.
- **Approximate**: Margin (no true COGS), route P&L cost (uses `SalesReport` aggregates).
- **Placeholder (P4 Contracts pending)**: Debt KPI tile, firm risk matrix debt + bank-credit columns. (Debt-aging card removed from the page 2026-08-11.)
