---
title: Boss
tags: [role, boss, executive, analytics]
related: [[roles-matrix]], [[../screens/boss-dashboard]]
---

# Boss (Başlyk)

**Role code**: `boss`

An executive role that reaches the **entire export process from his own login**, without impersonating any other role — extended from a read-only, dashboard-only account by the **boss process visibility** feature (2026-08-05). Still used the same way day to day: a 30-second daily "Is everything OK? Where is it burning? How much money?" check, viewed 2–3 minutes/day, mostly mobile. The widening adds capability (he can now walk into any screen and act on it), it does not change the primary habit of starting on the dashboard.

## Page visibility

Every registered page **except `admin.permissions`** — 41 of the 42 `_ALL_PAGES` codes as of 2026-08-05, was 3 pages (view-only) before this feature. `admin.permissions` is excluded because `_AdminOnlyPermission` rejects every method including GET for non-admins (AD-15), so the entry would open a page whose every API call 403s. See [[../processes/permissions-system]] for the registry and the AD-15 tension the remaining nine `admin.*` pages create.

The sidebar itself is grouped by **export process phase** and its order is global — the same sequence every role sees (Overview → Planning → Prep → Shipping → Docs → Sales, then support groups). `boss` gets no special ordering; he simply sees more of the sequence than most roles because almost nothing is hidden from him. Per-role configurable ordering was explicitly deferred — see [[../processes/permissions-system#Sidebar Navigation (2026-08-05)]].

> **Director vs boss.** `director` has always had full access to every page (operations + admin + analytics) and is also granted `analytics.boss` to reach the same dashboard. Before 2026-08-05, `boss` was the deliberately narrower, dashboard-only variant; that distinction is now much thinner since `boss` holds nearly the same page set.

## Resource permissions

Full CRUD (view/create/edit/delete) on every resource **except three carve-outs**:

- `closed_season` — view-only under the D1 write-freeze rule, the same carve-out `admin` has.
- `truck_split_default` — view-only. Only the director may change the official kg-per-firm constants (Gap 7 / ADR-016); `export_manager` is read-only here, so `boss` must not exceed him.
- `sale` — view + create + edit, **no delete**. Sale deletion is `admin`-only for `director` and `export_manager` too, and deleting a `ContractSale` re-rolls the parent `Contract`'s totals.

This replaces the previous strictly-read-only default; write access is protected by those carve-outs and by the view/edit toggle below, not by a blanket read-only grant anymore.

> **Applying this to an existing database needs `core/0033_boss_process_visibility_perms`, not `seed_permissions`.** The seed command's `get_or_create(..., defaults={...})` only writes `defaults` on INSERT, and every pre-2026-08-05 database already holds the boss's rows. **`DJANGO_TESTING` must be unset when you run `migrate`** — with it set, `0033` skips its work but is still recorded as applied, and will never re-run. Verification query and recovery steps: [[../processes/permissions-system#Permission Defaults]].

## View/edit mode

A `Segmented` control in the app header (boss-only) switches between **Просмотр** (view) and **Редактирование** (edit):

- Every `boss` session **starts in Просмотр (view)** — the `bossEditMode` flag defaults to `false` and is deliberately not persisted, so a page reload always returns him to view mode. He opts into editing per session, every session.
- Switching into edit mode shows a confirm dialog ("Вы будете вносить изменения от своего имени..."); switching back to view is immediate, no confirm.
- While in view mode, `canDo()`, `canEditField()` and `isCellEditable()` (the Sheet grid's own gate) force every write check to `false` for `boss`, regardless of what the underlying DB permission rows allow. The Sheet needed its own copy: its payload carries a backend-computed `can_current_user_edit` flag per row that the helper trusts instead of calling the other two.

**This toggle is a UI guard, not a security boundary.** The backend does not know about it — `boss` writes succeed at the API in either toggle position. Only the pages that call `canDo`/`canEditField`/`isCellEditable` actually hide their edit controls in view mode; a screen that renders a form without consulting one of those helpers stays editable for `boss` regardless of the toggle. Coverage must be checked per screen, not inferred from the helper list. Full mechanism: [[../processes/permissions-system#Boss view/edit toggle (UI guard only) — 2026-08-05]].

## Lifecycle scope

`boss` is in `PRIVILEGED_ROLES` (`apps/export/services/shipment.py`), so `transition_to()` accepts him on any valid status edge — he can walk a shipment through the 13-step chain the same as `export_manager` or `director`, via `POST /shipments/{id}/transition/`, subject to the view/edit gate above.

Two endpoints don't route through that check — they gate independently on a different, unchanged constant (`apps.core.permissions.PRIVILEGED_ROLES = {admin, export_manager, director}`):

- `POST /shipments/{id}/assign/` — **now accepts `boss`** (widened at the call site, 2026-08-05). `/export/assign` is in his process sidebar and assigning a draft is a real process step, so its only action had to work.
- `POST /shipments/{id}/cancel/` — **still 403s for `boss`**, deliberately. `ShipmentDetailHero` hardcodes `CANCEL_ROLES` without him, so the button never renders: no error, no surprise. Known, deferred.

See [[../processes/permissions-system#Boss transition authority (2026-08-05)]].

## Audit trail

Writes made by `boss` are attributed to him like any other user's — status changes and field edits carry `boss` in the audit log the same way an `export_manager` edit would. There is no separate "read-only session" marker; anything he does while in edit mode is indistinguishable in the log from an equivalent edit by a fully operational role.

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
