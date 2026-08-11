---
title: Boss
tags: [role, boss, executive, analytics]
related: [[roles-matrix]], [[../screens/boss-dashboard]]
---

# Boss (Başlyk)

**Role code**: `boss`

An executive role that reaches the **entire export process from his own login**, without impersonating any other role — extended from a read-only, dashboard-only account by the **boss process visibility** feature (2026-08-05). Still used the same way day to day: a 30-second daily "Is everything OK? Where is it burning? How much money?" check, viewed 2–3 minutes/day, mostly mobile. The widening adds capability (he can now walk into any screen and act on it), it does not change the primary habit of starting on the dashboard.

## Page visibility

Every registered page **except four** — 38 of the 42 `_ALL_PAGES` codes (2026-08-07), was 3 pages (view-only) before this feature. Each exclusion is a page whose every call is refused by a gate that does **not** consult the permission matrix, so granting it would only add a nav entry that fails:

- `admin.permissions` — `_AdminOnlyPermission` rejects every method including GET for non-admins (AD-15).
- `admin.users` — `UserManagementViewSet.get_queryset` raises for a role that manages nobody, and `boss` is not in `MANAGEABLE_BY_ROLE`.
- `admin.staff_access` — `ManagedPagePermissionsView` admits full admins and delegated managers only.
- `feedback.admin_inbox` — **worse than a 403**: the inbox is scoped on `role == 'admin'`, so `boss` silently sees only his own tickets and the page reads as "there is no feedback".

The set lives in `_BOSS_DEAD_PAGES` (`seed_permissions.py`) and is duplicated in `EXCLUDED_PAGES` (`core/0033`); a test asserts the two are identical. See [[../processes/permissions-system]] for the registry and the AD-15 tension the remaining `admin.*` pages create.

The sidebar `boss` sees is **his own composition**, not the one every other role gets: `BOSS_MENU_GROUPS` is ordered by export process phase while `STAFF_MENU_GROUPS` keeps the original module grouping, and `pickMenuComposition()` selects between them by role. They are disjoint compositions over the same 45 routes, not one global order — full mechanism and the drift hazards in [[../processes/permissions-system#Sidebar Navigation (2026-08-05)]]. (This paragraph previously said the order was global and that `boss` got no special ordering; true when written, false since the owner asked for boss-only process ordering.) Per-role *configurable* ordering — a table plus a drag-drop admin UI — remains deferred.

> **Director vs boss.** `director` has always had full access to every page (operations + admin + analytics) and is also granted `analytics.boss` to reach the same dashboard. Before 2026-08-05, `boss` was the deliberately narrower, dashboard-only variant; that distinction is now much thinner since `boss` holds nearly the same page set.

## Resource permissions

Full CRUD (view/create/edit/delete) on every resource **except three carve-outs**:

- `closed_season` — view-only under the D1 write-freeze rule, the same carve-out `admin` has.
- `truck_split_default` — view-only. Only the director may change the official kg-per-firm constants (Gap 7 / ADR-016); `export_manager` is read-only here, so `boss` must not exceed him.
- `sale` — view + create + edit, **no delete**. Sale deletion is `admin`-only for `director` and `export_manager` too, and deleting a `ContractSale` re-rolls the parent `Contract`'s totals.

This replaces the previous strictly-read-only default; write access is protected by those carve-outs and by the view/edit toggle below, not by a blanket read-only grant anymore.

> **Applying this to an existing database needs `core/0033_boss_process_visibility_perms`, not `seed_permissions`.** The seed command's `get_or_create(..., defaults={...})` only writes `defaults` on INSERT, and every pre-2026-08-05 database already holds the boss's rows. `0033` skips only when the connection's database name starts with `test_`, so it is safe to run with `DJANGO_TESTING` set (it used to skip on that variable and still be recorded as applied — corrected 2026-08-07). Verification query and recovery steps: [[../processes/permissions-system#Permission Defaults]].

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
| Process guides (2 tiles) | Static `docs/how_works/*.html` served byte-for-byte via a whitelisted endpoint — not live data |

> **Out of v1**: Içerki Bazar (domestic per block) and Sowgatlyk (gift per block) are explicitly excluded. They will be added together with the wider domestic-sales analytics phase.

## Process guides (2026-08-06)

The last widget on the dashboard is a "How the process works" card (`ProcessGuides.tsx`) with two tiles — "A shipment's journey" and "BPMN diagram." Each opens a process-explainer document from `docs/how_works/` in a new tab via `GET /api/v1/export/boss/process-doc/?doc=<slug>` on `BossAnalyticsViewSet`, so it inherits the viewset's `IsBossOrDirector` gate.

> **Known limitation, not a decision anyone argued for.** Both documents describe *every* role's job in the shipment process, not just the boss's — but because the endpoint hangs off the boss analytics viewset, only `boss`, `director` and `admin` can open them. Nobody chose to restrict the explainers to those three roles; it fell out of where the action was added.

**The whitelist is the security control, not a convenience — do not "simplify" it away.** `?doc=` is user input naming a file, but it never becomes a filesystem path: `_PROCESS_DOCS` in `views_analytics.py` is a hardcoded `{slug: filename}` dict, and a slug that isn't a key in it 404s before any disk access happens. Adding one of the other documents already sitting in `docs/how_works/` is a one-line dict edit — never `os.path.join` / string formatting from `?doc=`. `tests_process_docs.py` exists specifically to catch a regression to path-joining: four traversal payloads, a case-variant slug, and — the sharpest case, added on review because the other three would still pass under naive path-joining — a request for a real, unlisted file sitting in the same directory (`?doc=walkthrough`), which a naive `Path(dir) / f'{slug}.html'` would happily serve but the whitelist correctly 404s.

### BPMN diagram click-through

The second document, `shipment-bpmn.html`, draws a BPMN diagram of the 20-step process. Its task blocks are clickable: once the SVG has rendered, the page fetches `GET /api/v1/export/boss/process-doc-links/` (same viewset, same `IsBossOrDirector` gate) and upgrades any `<div id="task-{node_id}">` whose id is in the response into a real `<a target="_blank">`. If the fetch fails, 404s, or returns garbage, the diagram is left exactly as it rendered without the fetch — no error, no partial state — so it still works offline or with an expired session.

The mapping lives in `export.ProcessNodeLink` (table `export_process_node_links`): `node_id` (unique), `label` (Turkmen, transcribed verbatim from the diagram's node array, `Cyrillic_General_CI_AS` collation per project convention regardless of script), `route`, `is_active`. Seeded with its 20 rows by data migration `0060_seed_process_node_links`, verified against the diagram's own node array and against `frontend/src/utils/permissions.ts`'s `ROUTE_PAGE_MAP`.

**`node_id` is the join key to the diagram's own data array and is read-only via the API.** Change it and the row silently orphans — the block simply stops linking, with no error anywhere to notice by. There is no create or delete on the admin endpoint either: the 20 ids are fixed by the diagram's data array, so a new node needs a diagram change plus a migration, not an admin action.

Editable at **`/admin/process-links`**, admin role only (route guard `roles={['admin']}`, not a `pageCode`) — see [[../processes/permissions-system#Process node links — inline admin gate, not the resource matrix (2026-08-06)]] for why it deliberately bypasses the resource-permission matrix. `node_id` and `label` are read-only in that UI even though the API technically permits editing `label`.

**Stored-XSS fix (2026-08-06).** `route` is written into the diagram's `<a href>` via `setAttribute()`, and the boss clicks it. Before migration `0061`, `route` was unconstrained free text — a `javascript:` value saved through the admin PATCH would have executed in the boss's session. Admin-only gating on the field does not contain that: AD-15 keeps `admin` and `boss` as separate principals, and the payload would run in the boss's browser, not the admin's. Fixed in two layers: a server-side `RegexValidator` on the model field (blank, or an in-app absolute path only — no scheme, no protocol-relative `//`) is the real boundary, since it rejects the value before it is ever stored and DRF copies model-field validators onto every write path through the serializer; a client-side `isSafeInAppRoute()` guard in `shipment-bpmn.html` is defence-in-depth only, covering rows written before the validator existed (or through any future write path that bypasses the serializer) — the client check alone would not have been sufficient, since the API can always be reached directly.

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
