---
title: Boss Dashboard
tags: [screen, analytics, boss, director, executive]
related: [[../roles/boss]], [[../roles/roles-matrix]], [[../api-endpoint-map]]
---

# Boss Dashboard

Executive analytics view at `/boss/dashboard`. Available to `boss` (read-only, only page they see) and `director` (full nav + this dashboard).

Backend: `BossAnalyticsViewSet` at `/api/v1/export/boss/<action>/` — 15 endpoints, all gated by `IsBossOrDirector`, all cached for 60s.

## Page layout

Top toolbar:
- Title + subtitle ("Direktor görnüşi — analitika we hasabatlar")
- **Period switcher** (URL-backed via `useSearchParams`): Şu gün · Hepde · Aý (default) · Möwsüm · 5 ýyl
- **Export dropdown** (Excel / PDF) — opens a section sub-menu

Body — 13 widget groups, in this order:

| # | Component | Endpoint | Notes |
|---|---|---|---|
| 1 | `HeroKpiStrip.tsx` | `GET /summary/` | 6 KPI cards with 12-week sparklines |
| 2 | `RevenueChart.tsx` | `GET /revenue/` | ECharts line + area, current vs previous season |
| 3 | `DebtBreakdown.tsx` | `GET /debt/` | **Placeholder** — `is_placeholder: true` |
| 4 | `RoutePnlTable.tsx` | `GET /route_pnl/` | per country + city; clickable rows |
| 5 | `ComplianceStrip.tsx` | `GET /compliance/`, `/ops_pulse/` | reports overdue, 1:10 quota, docs by 13:00 + ops counters |
| 6 | `QuotaGrid.tsx` | `GET /quota_grid/` | 24 firms, 3-color levels |
| 7 | `BlocksHeatmap.tsx` | `GET /blocks_heatmap/` | 15 blocks, 5 color bands |
| 8 | `TopCustomers.tsx` | `GET /top_customers/` | Top 5 + "Galanlary" rest aggregate |
| 9 | `FirmRiskMatrix.tsx` | `GET /risk_matrix/` | quota = real, debt + credit = placeholder |
| 10 | `AlertsPanel.tsx` | `GET /alerts/` | 7 unread `Notification` rows |
| 11 | `ProductionResults.tsx` | `GET /production/?scope=daily\|seasonal` | Two stacked tables (daily + seasonal) |
| 12 | `ExportMarketByBlock.tsx` | `GET /export_market/` | Daşarky Bazar only — Içerki/Sowgatlyk excluded |
| 13 | `ReportsGrid.tsx` | triggers `/export_excel/` and `/export_pdf/` | 6 download tiles |

## KPI definitions

| KPI | Field | Formula |
|---|---|---|
| Möwsüm girdejisi | `revenue` | `Sum(Shipment.total_amount_usd)` over period; `delta_pct` vs same period last season |
| Margin | `margin` | `Sum(SalesReport.total_usd) − Sum(transport_cost + market_fee + other_expenses)`. Approximate — no true COGS yet |
| Bergi | `debt` | **Placeholder** until P4 Contracts |
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
| Production results row | `/export/plan?block={code}` |
| Export-market row | `/export/shipments?block_source={code}` |
| Alert | `Notification.link` |

## Out of v1 (explicit scope decisions)

- **Içerki Bazar** (domestic market per block) — excluded; will be added with the broader domestic-sales analytics phase.
- **Sowgatlyk** (gift / promo per block) — excluded for the same reason.
- **True debt aging + bank credit per firm** — wait for P4 Contracts (`Invoice`, `Payment`, firm credit table). v1 ships layout + placeholder badges only.
- **AI summary block, drill-down modals, comparison mode, cash-flow forecast, what-if scenarios, mobile push, voice summary, PDF charts, Navixy GPS map, Logo Tiger / 1C live integrations** — all deferred to follow-up PRs.

## i18n

All visible strings live under the `boss_dashboard.*` namespace in `frontend/src/i18n/{tk,ru,en}.json`. Turkmen is primary; the `note_excluded` footnote on the export-market table reads "Içerki Bazar we Sowgatlyk soň goşulýar".

## Caching

- Backend: 60s `cache.get_or_set` per `(action, period, from, to)`.
- Frontend: TanStack Query `staleTime: 60_000`.
- Switching period changes the queryKey → automatic refetch.

## Data audit (what's real vs placeholder)

See [[../roles/boss]] for the full table. Summary:
- **Real**: KPIs (except margin = approximate, debt = placeholder), revenue, ops pulse, quota grid, blocks heatmap, top customers, alerts, production results, export-market, compliance (1:10 rule, reports overdue, docs by 13:00), Excel + PDF exports.
- **Approximate**: Margin (no true COGS), route P&L cost (uses `SalesReport` aggregates).
- **Placeholder (P4 Contracts pending)**: Debt aging, firm risk matrix debt + bank-credit columns.
