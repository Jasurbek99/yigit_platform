---
title: Boss
tags: [role, boss, executive, analytics]
related: [[roles-matrix]], [[../screens/boss-dashboard]]
---

# Boss (Başlyk)

**Role code**: `boss`

A strictly read-only executive role that lands on the Boss Dashboard. Used by holding directors who want a 30-second daily answer to "Is everything OK? Where is it burning? How much money?" — viewed 2–3 minutes/day, mostly mobile.

## Page visibility

Only one page is visible: `analytics.boss` → `/boss/dashboard`.

All other pages (shipment list, kanban, quota, admin, etc.) are hidden in the sidebar. The boss user sees a single nav entry that takes them straight to analytics.

> **Director vs boss.** The existing `director` role keeps full access to every page (operations + admin + analytics) and is also granted `analytics.boss` so directors can navigate to the same dashboard via their menu. `boss` is the simpler, executive-only variant.

## Resource permissions

Read-only across **every** resource — `boss` cannot create, edit, or delete anything. Write-protected at the dynamic permission layer (`RoleResourcePermission` rows seeded by `seed_permissions`).

## Lifecycle scope

Read-only across all 13 steps. The boss does **not** trigger transitions, sign documents, or edit shipments — they consume aggregated KPIs only.

## What the dashboard shows

13 widget groups, all sourced from `/api/v1/export/boss/<action>/`:

| Widget | Data source |
|---|---|
| 6 hero KPIs (revenue, margin, debt, today loaded, in transit, quota used) | `Shipment.total_amount_usd` + status counts + `QuotaUsageRecord` |
| Revenue chart (current vs previous season, weekly) | `Shipment` × `season` × `TruncWeek('date')` |
| Debt aging by firm (4 buckets) | **Placeholder** until P4 Contracts ships |
| Route P&L | `Shipment` grouped by `country` + `city` + `SalesReport` cost aggregates |
| Compliance strip (reports overdue, 1:10, docs by 13:00) | 1:10 from `DomesticSale` vs `QuotaUsageRecord`; reports overdue from `Shipment.sale_started_at` − `SalesReport.created_at`; docs from `QualityDocument` flags |
| Operations pulse (ýolda, serhetde, satyşda, bu gün) | Live `Shipment.status__code` counts |
| Quota grid (24 firms, 3-color) | `QuotaIssuanceFirmAllocation` ÷ `QuotaUsageRecord` |
| Block heatmap (15 blocks, 7-day actual vs plan) | `WeeklyHarvestPlan.{day}_plan_kg` vs `..._actual_kg` |
| Top customers table | `Shipment` grouped by `customer` |
| Firm risk matrix | Quota = real, debt + bank credit = placeholder |
| Alerts panel ("Üns beriň") | Recent unread `Notification` rows |
| **Production results** (daily + seasonal, plan vs actual per block) | `WeeklyHarvestPlan` summed per block over scope |
| **Export-market by block** (Daşarky Bazar only) | `ShipmentBlockSource.weight_kg` summed per block |
| Reports grid | Triggers `/export/boss/export_excel/?section=...` and `/export/boss/export_pdf/?section=...` |

> **Out of v1**: Içerki Bazar (domestic per block) and Sowgatlyk (gift per block) are explicitly excluded. They will be added together with the wider domestic-sales analytics phase.

## Drill-down map

Every chart click navigates to a filtered list page (using the existing `useSearchParams` filter pattern from `ShipmentList`):

| Click | Goes to |
|---|---|
| Hero "trucks in transit" | `/export/shipments?status=yyolda` |
| Hero "today loaded" | `/export/shipments?status=yuklenme&date=today` |
| Hero "quota used" | `/export/quota` |
| Revenue chart point | `/export/shipments?from={week}&to={week+6}` |
| Route P&L row | `/export/shipments?country={id}&city={city}` |
| Quota grid cell | `/export/quota?firm={id}` |
| Block heatmap cell | `/export/plan?block={code}` |
| Top customer row | `/export/shipments?customer={id}` |
| Production results row | `/export/plan?block={code}` |
| Export-market row | `/export/shipments?block_source={code}` |
| Alert | uses `Notification.link` |

## Caching

Each backend endpoint is cached server-side for 60s; frontend hooks use `staleTime: 60_000`. The dashboard reloads often but underlying data changes minute-scale at most — caching keeps response times sub-second.

## Period filter

Pill switcher at the top: Şu gün · Hepde · Aý (default) · Möwsüm · 5 ýyl. Stored in URL as `?period=...` so directors can paste a link to a specific snapshot.

## Mobile

The 6-col KPI grid collapses to 3 cols on tablet and 2 cols on phone. Sidebar is hidden behind a hamburger on phone.

## Related docs

- [[../screens/boss-dashboard]] — full widget specification
- [[roles-matrix]] — permissions per role at a glance
