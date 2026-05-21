---
title: Main Dashboard
tags: [screen, export, dashboard]
route: /
---

# Main Dashboard

**Route:** `/` (redirects here; all authenticated roles)
**File:** `frontend/src/pages/DashboardPage.tsx`
**Hook:** `frontend/src/hooks/useDashboardSummary.ts`

## Purpose

Operational overview for the current export season. Shows six stat cards, an alerts panel, a routes breakdown, and a table of currently active shipments. All data comes from a single summary endpoint so the page loads in one round-trip.

## Data source

`GET /api/v1/export/dashboard/summary/`

Response sections:
- `season` — active season id + name (nullable when no active season)
- `stats` — six counters: total, in_transit, selling, completed, no_report, quota_firms. `total` and `completed` carry an optional `delta_7d` field used in the trend chip. `in_transit` and `selling` are LIVE (not season-scoped).
- `alerts` — counts for missing reports, quota overages, pending docs, and an optional weekly plan object (`null` if no `HarvestDayEntry` rows for current ISO week)
- `routes[]` — per-country truck count, percent share, and top-4 city breakdown (null/empty city names excluded)
- `active_shipments[]` — up to 5 rows ordered by `-status_changed_at`, with phase code for color-coding

Stale time: 60 s.

## Backend implementation

| Layer | File |
|-------|------|
| ViewSet | `backend/apps/export/views_dashboard.py` — `DashboardViewSet` |
| Service | `backend/apps/export/services/dashboard_summary.py` — `build_dashboard_summary()` |
| Tests | `backend/apps/export/tests_dashboard_summary.py` (11 tests) |
| URL | Registered on `router` as `dashboard` → `/api/v1/export/dashboard/` |
| Cache key | `'dashboard:summary'`, TTL 60 s |

Permission: `IsAuthenticated` only — no role gate.

## Sub-components

All live under `frontend/src/components/dashboard/`:

| Component | File | Props |
|-----------|------|-------|
| `DashboardStatCards` | `DashboardStatCards.tsx` | `stats: IDashboardStats` |
| `DashboardAlertsPanel` | `DashboardAlerts.tsx` | `alerts: IDashboardAlerts` |
| `DashboardRoutes` | `DashboardRoutes.tsx` | `routes: IDashboardRoute[]` |
| `DashboardActiveShipments` | `DashboardActiveShipments.tsx` | `shipments: IDashboardActiveShipment[]` |

## Alerts panel logic

- `no_report_count > 0` → error alert
- `quota_exceeded_count > 0` → warning alert
- `docs_pending_count > 0` → warning alert
- `weekly_plan != null` → info alert
- If no conditions are true, shows "No active alerts" empty state
- Red badge count = number of visible alerts

## Phase colors (active shipments table)

| Phase code | Ant Design Tag color |
|------------|---------------------|
| PREP | default |
| DOCS | purple |
| LOAD | blue |
| TRANSIT | cyan |
| DEST | orange |
| CLOSE | green |

## Country flag lookup

Flags matched by `country_name` from the API (exact string match). Defined in `DashboardRoutes.tsx` as `COUNTRY_FLAGS`. Unknown countries fall back to `🌍`.

## Navigation

- Stat card "Total" → `/export/shipments`
- Stat card "Quota Firms" → `/export/quota`
- Active shipment row click → `/shipments/{id}`
- "View All" button → `/export/shipments`

## i18n keys

All strings use `dashboard.*` namespace. Three new keys added in this iteration:
- `dashboard.loading` — spinner tip
- `dashboard.load_error` — error alert message
- `dashboard.alerts_empty` — empty state for alerts panel

## Loading / error states

- `isLoading` → centered `<Spin size="large">` with `dashboard.loading` tip
- `isError` → full-width `<Alert type="error">` with `dashboard.load_error`
- Empty `routes[]` and `active_shipments[]` → graceful empty states (ProTable built-in)
