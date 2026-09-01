---
title: Roles Matrix
tags: [roles, permissions, matrix]
related: [[permissions-system]]
---

# Roles Matrix

> Master lookup: which role can access which pages, resources, and shipment lifecycle steps.

> [!warning] This hand-maintained table has drifted from the DB (checked 2026-08-22)
> The live source of truth is `core_role_page_permissions` (280 rows with `is_visible=True`
> of 645). A dump taken 2026-08-22 disagrees with the Page Visibility Matrix below in at
> least three cells and is missing four role columns entirely:
> - **Dashboard** is marked `Y` for `sales_rep` and `seller` — neither has it. `sales_rep`
>   sees 7 pages (no dashboard); `seller` sees 5 (`export.quota.local_sell` + the universal four).
> - ~~**Shipment List** is marked `-` for `greenhouse_manager`, which does have `export.shipments`.~~
>   **Resolved 2026-09-01 the other way:** the table was right about the intent and the DB was
>   drifted. `greenhouse_manager` had `export.shipments` + the two codes migration 0036 split
>   off it, but **no `shipment` resource row at all**, so all three links 403'd (F6). Migration
>   `core/0037` switched them off; the role is now back to its 8 seeded pages.
> - No columns for **`loading_dept_head` (21 pages), `loading_dept_head_deputy` (19),
>   `weight_master` (9), `accountant` (8)** — the head/deputy pair differs by exactly two
>   pages, `admin.staff_access` + `admin.users`.
>
> A per-role page count and a one-line "what this role gates" summary, read live from the DB,
> is in [`docs/TEST_ACCOUNTS.md`](../../TEST_ACCOUNTS.md) §D — along with the `t_<role>` test
> logins for all 15 roles. Re-verify against the DB before trusting the table below.

> [!note] `seller` sees the Quota Dashboard ROUTE, not the quota (2026-08-23)
> `seller` holds one real page, `export.quota.local_sell`, and `canSeePage()` treats
> access to any CHILD page as access to the parent — which is why `/export/quota` appears
> in their sidebar and the matrix cell above says `Y`. Everything ON that page is gated
> separately by `quotaPanelAccess()` (`frontend/src/pages/export/QuotaDashboard.helpers.ts`)
> against the `quota_issuance` RESOURCE, which `seller` does not hold: they get the Local
> Sell Plan grid alone — no tab strip, no KPI pipeline, no filters. Before this fix the
> page fired `GET /export/quota-dashboard/` for them and rendered its 403 as
> "Failed to load quota data" on every visit. `seller` also gained `initialize-week`
> (moved `LOCAL_SELL_APPROVE` → `LOCAL_SELL_WRITE`) and LOST the Fleet Map nav entry in
> the same change. See [[local-sell-plan]], [[quota-management]], [[fleet-map]].

## Page Visibility Matrix

| Page | admin | export_manager | director | boss | warehouse_chief | document_team | transport | sales_rep | finansist | greenhouse_manager | seller |
|------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Dashboard | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| Boss Dashboard (`analytics.boss`) | Y | - | Y | Y | - | - | - | - | - | - | - |
| Shipment List | Y | Y | Y | Y | Y | Y | Y | Y | Y | - | - |
| Kanban Board | Y | Y | Y | Y | Y | Y | Y | Y | Y | - | - |
| Shipment Sheet | Y | Y | Y | Y | - | Y | - | - | - | - | - |
| Shipment Dashboard | Y | Y | Y | Y | - | - | - | - | - | - | - |
| Overdue Reports | Y | Y | Y | Y | - | - | - | Y | - | - | - |
| Quota Dashboard | Y | Y | Y | Y | - | Y | - | - | - | - | Y |
| Weekly Plan | Y | Y | Y | Y | - | - | - | - | - | Y | - |
| Price Panel | Y | Y | Y | Y | - | - | - | Y | - | - | - |
| Advances | Y | Y | Y | Y | - | - | - | - | Y | - | - |
| Truck Forecast | Y | Y | Y | Y | - | - | Y | - | - | - | - |
| Block Summary | Y | Y | Y | Y | - | - | - | - | - | Y | - |
| Domestic Sales | Y | Y | Y | Y | - | - | - | - | - | Y | - |
| Admin Pages (Firms, Seasons, Blocks, Customers, Truck Dest, Shipment Settings, Process Links) | Y | - | - | Y | - | - | - | - | - | - | - |
| Admin: Users (`admin.users`) / Staff Page Access (`admin.staff_access`) | Y | - | - | - | - | - | - | - | - | - | - |
| Feedback: Admin Inbox (`feedback.admin_inbox`) | Y | - | - | - | - | - | - | - | - | - | - |
| Permission Matrix page (`admin.permissions`) | Y | - | - | - | - | - | - | - | - | - | - |

> AD-15: `admin` is the **sole top-tier system administrator** — only role with permission-matrix and user-management access. `director` and `export_manager` lose admin pages but keep all operational power including reference-data writes (countries, cities, customers, blocks).
>
> **`boss` widened 2026-08-05** from read-only/dashboard-only to near-full page visibility — every row above **except four pages** (`_BOSS_DEAD_PAGES`, extended 2026-08-07): the Permission Matrix (`_AdminOnlyPermission` 403s even GET), Users (`UserManagementViewSet.get_queryset` raises for a role that manages nobody), Staff Page Access (`ManagedPagePermissionsView` admits admins and delegated managers only) and the Feedback Admin Inbox (scoped on `role == 'admin'`, so `boss` would silently see only his own tickets — worse than a 403). Each would be a dead or misleading menu entry; AD-15 intact. The remaining Admin Pages run against AD-15's grain (`director`/`export_manager` are explicitly denied them) and were a deliberate, user-approved call. Seeing a page is not the same as acting on it: `boss` still cannot manage users (`_is_full_admin` gates that independently and was not touched), and reference-data writes stay `admin`/`director`/`export_manager`-only (`REFERENCE_DATA_WRITE`, also untouched — the frontend now hides those controls from him instead of rendering buttons that 403) — see the Resource CRUD Matrix footnote below. See [[boss]], [[permissions-system]], `docs/ADR.md` (AD-15).

## Resource CRUD Matrix

> **Legend:** `V`/`C`/`U`/`D` = view / create / edit / delete. `CRUD` = all four. `view` = `V` only, spelled out (pre-existing convention, unchanged). A **partial** combination is spelled as its letters in `V,C,U,D` order — e.g. `VUD` = view+edit+delete, **no create**. `+action` appended to a tag = one extra workflow action beyond the four CRUD verbs, gated separately from them (e.g. `CRUD+approve`; `V+submit` = view only, plus one specific ungated workflow action, not full create). `limited` (Shipment edit only) is a separate, pre-existing term for field-level restriction, not a verb-subset — see `RESOURCE_FIELDS` in [[permissions-system]]. Every non-obvious tag in the `boss` column is footnoted; **the cell tag and its footnote are written to agree** — if you only read the cell, it should not mislead you.

| Resource | admin | export_manager | director | boss | warehouse_chief | document_team | transport | sales_rep | finansist | greenhouse_manager |
|----------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Shipment (view) | Y | Y | Y | Y | Y | Y | Y | Y | Y | - |
| Shipment (create) | Y | Y | Y | Y | - | - | - | - | - | - |
| Shipment (edit) | Y | Y | Y | Y | limited | limited | limited | limited | limited | - |
| Shipment (delete) | Y | Y | Y | Y | - | - | - | - | - | - |
| Quota Issuance | CRUD | CRUD | CRUD | CRUD | - | view | - | - | - | - |
| Quota Usage | CRUD+approve | CRUD+approve | CRUD+approve | CRUD+approve | - | view | - | - | - | - |
| Weekly Plan | CRUD+approve | CRUD+approve | CRUD+approve | CRUD+approve | - | - | - | - | - | CRUD (own blocks) |
| Local Sell Plan | CRUD+approve | CRUD+approve | CRUD+approve | V+submit¹ | - | - | - | - | - | - |
| Price Entry | CRUD | CRUD | CRUD | CRUD | - | - | CRUD | - | - | - |
| Advance | CRUD | CRUD | CRUD | VUD² | - | - | - | - | CRUD | - |
| Truck Allocation | CRUD | CRUD | CRUD | CRUD | - | - | view | - | - | - |
| Reference Data (Country, City, Customer, BorderPoint, Block, ShipmentStatusType, OptionType, TruckDestination) | CRUD | CRUD | CRUD | view³ | - | - | - | - | - | - |
| Truck Split Default | CRUD | view | CRUD | view⁵ | - | - | - | - | - | - |
| Contract | CRUD | CRUD | CRUD | CRUD | - | CRUD | - | - | - | - |
| Sale (ContractSale) | CRUD | VCU | VCU | VCU⁶ | - | VCU | - | - | - | - |
| Season (admin Seasons page + close/open) | CRUD+close | CRUD+close | CRUD+close | CRUD+close⁷ | - | - | - | view | - | - |
| Sheet Row Settings (`/admin/sheet-rows/`) | CRUD | CRUD | CRUD | CRUD⁸ | VCU | VU | VU | VU | VU | - |
| Permission Matrix (page / resource / field) | CRUD | - | - | -⁴ | - | - | - | - | - | - |
| User CRUD (role / activate / password) | CRUD | - | - | - | - | - | - | - | - | - |

> **`boss` column (2026-08-05 widening) — CRUD on every `RESOURCE_REGISTRY` entry except three carve-outs:** `closed_season` (view-only, D1 write-freeze, same as `admin`; not its own row above — see [[permissions-system]]), `truck_split_default` (view-only, footnote 5) and `sale` (no delete, footnote 6). Four cells above are *not* the plain grant the `DynamicResourcePermission` layer implies, because the viewsets add their own hardcoded role checks on top of it that the feature didn't touch. **Scope of the verification sweep, stated honestly (2026-08-07):** every cell *in this table* was checked action-by-action against its viewset, not by name (earlier passes wrongly grouped actions together, and wrongly compressed a partial grant into `CRUD`/`view`/`-` when none of those tags fit — corrected below; see the legend above for how partial cells are now tagged). It was **not** an exhaustive sweep of every endpoint the widening made reachable: two capabilities were missing from the table entirely until 2026-08-07 (season close, footnote 7, and Sheet row settings, footnote 8), both found by review rather than by the sweep. Treat the table as complete for the resources it lists and as a floor, not a ceiling, for what `boss` can reach — same recurring shape as the `/cancel/`/`/assign/` transition gap documented in [[boss]]:
> 1. **Local Sell Plan — `boss` gets `V+submit`: view, plus one specific ungated workflow action, not full CRUD.** `WeeklyLocalSellPlanViewSet` (`apps/export/views_planning.py`) hardcodes role checks *inside* `perform_create` (line 291) and `perform_update` (line 318, unconditional — applies regardless of the plan's status) requiring `LOCAL_SELL_WRITE` = `{admin, export_manager, director, seller}`: `boss` is blocked from both **create** and **edit** despite passing the class-level CRUD grant. `approve`/`reject`/`bulk-approve` separately require `LOCAL_SELL_APPROVE` = `{admin, export_manager, director}`: `boss` blocked from all three. `initialize-week` moved from `LOCAL_SELL_APPROVE` to `LOCAL_SELL_WRITE` on 2026-08-23 so the `seller` can open their own week (owner request) — `boss` is in neither set, so he stays blocked there too. `bulk-submit` (line 381) also requires `LOCAL_SELL_WRITE`: blocked. The one action that *does* work is the single-record `submit` (line 344) — it has no extra role check anywhere (view method or the `submit_local_sell_plan` service), so it passes on the class-level `can_create` mapping alone; **this is a real mutating POST that moves a plan draft→submitted**, which is why the cell says `V+submit` and not plain `view`. In practice it doesn't unlock much, since `boss` cannot create a plan of his own to submit — only submit an existing draft someone else entered. `delete` isn't implemented for anyone on this viewset (not in its `http_method_names`).
> 2. **Advance — `boss` gets `VUD`: view, edit, delete, but no create** (and not reconcile or shipment-linking, which ride on the same missing `C`). `FinansistAdvanceViewSet` (`apps/export/views_finance.py`) hardcodes `role not in ADVANCE_WRITE` (`{admin, finansist, director}` — note `export_manager` is also excluded here despite its `CRUD` cell to the left) inside `create()` (line 146), `reconcile` (line 187), `link_shipment` (line 214), and `unlink_shipment` (line 273). None of those include `boss` — there is no ungated exception here the way `submit` is for Local Sell Plan; `boss` has **zero** path to creating an advance. Plain `PATCH`/`DELETE` on an existing advance have **no** such override — they fall through to the class-level `can_edit`/`can_delete` grant, which `boss` has, hence `U` and `D` in the tag.
> 3. **Reference Data — `boss` gets `view`, not `-`.** These viewsets (`CountryViewSet`, `CityViewSet`, `CustomerViewSet`, `ShipmentStatusTypeViewSet`, `BorderPointViewSet`, `TruckDestinationViewSet`, `ShipmentOptionTypeViewSet`, `GreenhouseBlockAdminViewSet` — all individually checked) gate on `write_permission(*REFERENCE_DATA_WRITE)` (`REFERENCE_DATA_WRITE = {admin, director, export_manager}`), which never went through `DynamicResourcePermission`/`RESOURCE_REGISTRY` at all — `boss`'s resource-permission widening literally cannot reach these endpoints for writes. But `write_permission()` (`apps/core/permissions.py:152`) explicitly allows all `SAFE_METHODS` (GET/HEAD/OPTIONS) to any authenticated user before checking the role allowlist — reads are open to everyone, `boss` included. Blocked on create/edit/delete; not blocked on view.
> 4. **Permission Matrix — `boss` gets `-`, genuinely zero access.** Gates on `_AdminOnlyPermission` (`role=='admin'` or superuser), whose own docstring says it "restrict[s] ALL methods (including GET)" — unlike `write_permission()` above, this class does not carve out an exception for safe methods. Every call to the four backing endpoints, including read, 403s. Because of that, the `admin.permissions` **page** was removed from the boss grant on 2026-08-05 (see Page Visibility Matrix above) rather than left as a nav entry onto an inert screen. `-` is accurate here, unlike Reference Data above.
> 5. **Truck Split Default — `boss` gets `view`, narrowed 2026-08-05.** `TruckSplitDefaultViewSet` (`apps/export/views_admin.py:340`) is matrix-gated only, so the blanket CRUD grant reached it and gave `boss` **more** than `export_manager`, whose seed default is deliberately read-only here (Gap 7 / ADR-016 — only the director changes the official kg-per-firm constants). Corrected in both `seed_permissions.py` and `core/0033`.
> 6. **Sale — `boss` gets `VCU`: no delete, narrowed 2026-08-05.** Sale deletion is `admin`-only by design; `director` and `export_manager` both get view+create+edit only. The blanket grant had handed `boss` a delete they don't have, and deleting a `ContractSale` re-rolls the parent `Contract`'s totals — money data. Corrected in both `seed_permissions.py` and `core/0033`. (`/sales` already hides its delete button behind an `isAdmin` check, so no control was live for him even before this.)
> 7. **Season — `boss` gets `CRUD+close`, and closing is irreversible.** `SeasonViewSet.close` / `open` / `close-preview` (`apps/export/views_admin.py`) call `_require_season_edit`, which reads the `season` resource's `edit` flag — so the blanket widening reached them and `boss` can freeze a season. This is at **parity** with `director`/`export_manager`, who already had it, and is defensible on that basis; it is recorded here because it was missing, not because it is wrong. Note the asymmetry with the rest of the matrix: `close_season` (`apps/core/services/season.py`) raises on any attempt to reopen a closed season by design, so this is the one grant in the boss column with no undo. Distinct from `closed_season` (view-only, D1), which only gates *browsing* an already-closed season.
> 8. **Sheet Row Settings — `boss` gets `CRUD`, inherited from `shipment`, and this is NOT boss-specific.** `SheetRowSettingViewSet` (`apps/export/views_sheet_settings.py`) declares `resource_code = 'shipment'` and no other gate, so its cells are the `shipment` cells restated: relabel/reorder/soft-delete Sheet rows and the `permissions/bulk` per-user field exceptions all ride on the shipment grant. Several non-management roles reach the edit paths the same way — a pre-existing property of that resource_code choice, not something the boss widening introduced. `permissions/bulk` grants are AND-composed with `RoleFieldPermission` in `can_edit_sheet_field`, so no user gains a field their role lacks.

> **Draft-create (supply column):** `loading_dept_head` (Soltanmyrat) is now also granted shipment-**draft** create — supply-only columns (blocks + variety, no destination) in the [[draft-shipments#Two-column Join flow (coexisting alternative)]] flow. Previously draft-create was limited to `warehouse_chief` + `export_manager`/`director`. The **Join** action that merges a supply draft into a destination draft remains `export_manager`/`director` only.

> **Deputy role:** `loading_dept_head_deputy` (Ýükleme gaplama bölüminiň orunbassary, June 2026) has **identical** access to `loading_dept_head` — same page visibility, resource CRUD, editable Sheet fields, forecast-write window, draft-create, variety override, and Sheet column-order rights. On existing deployments the deputy's permission rows are cloned from the head by migration `core/0018_clone_loading_dept_head_deputy_perms`. **This parity is point-in-time** — after the clone the two roles hold independent permission rows, so a permission later granted to the head via the admin matrix UI is **not** auto-propagated to the deputy (re-run the clone or grant it manually). Anywhere this doc says `loading_dept_head`, read it as "head **or** deputy". The head's Turkmen label was also corrected to **Ýükleme gaplama bölüminiň müdiri**.

## Shipment Lifecycle Steps by Role

| Step | Code | Required Role | Privileged Override |
|------|------|---------------|-------------------|
| 1. Loading | `yuklenme` | warehouse_chief | export_manager, director, boss |
| 2. Customs Entry | `gumruk_girish` | warehouse_chief | export_manager, director, boss |
| 3. Customs Exit | `gumruk_chykysh` | document_team | export_manager, director, boss |
| 4. Departed | `yola_chykdy` | document_team | export_manager, director, boss |
| 5. TM Border | `serhet_tm` | transport | export_manager, director, boss |
| 6. Border Crossed | `serhet_gechdi` | transport | export_manager, director, boss |
| 7. Dest. Customs | `barysh_gumrugi` | sales_rep | export_manager, director, boss |
| 8. En Route | `yolda` | sales_rep | export_manager, director, boss |
| 9. Arrived | `bardy` | sales_rep | export_manager, director, boss |
| 10. Selling | `satylyar` | sales_rep | export_manager, director, boss |
| 11. Sold | `satyldy` | sales_rep | export_manager, director, boss |
| 12. Report | `hasabat` | sales_rep | export_manager, director, boss |
| 13. Completed | `tamamlandy` | finansist | export_manager, director, boss |

> **`boss` in Privileged Override (2026-08-05):** `boss` joined `PRIVILEGED_ROLES` in `apps/export/services/shipment.py`, so `transition_to()` — and therefore `POST /shipments/{id}/transition/` — accepts him on every **forward** edge above, same as `export_manager`/`director`. This does **not** extend to the dedicated `POST /shipments/{id}/cancel/` or `POST /shipments/{id}/assign/` endpoints, which check a separate, unchanged `PRIVILEGED_ROLES` in `apps/core/roles.py` (`{admin, export_manager, director}`, no `boss`) and 403 him. See [[boss]] for the full gap.
>
> **Cancellation is not a transition (2026-08-07):** every status also has a `cancelled` edge, which is NOT reachable through `POST /shipments/{id}/transition/` — that action returns **400** for `new_status=cancelled` for every role, pointing the caller at `/cancel/`. The generic path skips what `/cancel/` does (cancel open Tasks, delete draft `QuotaUsageRecord`s, demand a `reason`), so it would leave the shipment `cancelled` with dangling work items. `CANCEL_ROLES` (`services/shipment.py`) is a literal `{admin, export_manager, director}` — deliberately not derived from `PRIVILEGED_ROLES`, which is what silently added `boss` to every cancel edge when he was granted the step-privilege.

## "My Work" Filter by Role

When `?my_work=true` is applied:

| Role | Sees Shipments in Phases |
|------|-------------------------|
| `warehouse_chief` | LOADING only |
| `document_team` | LOADING + CUSTOMS |
| `transport` | LOADING + CUSTOMS + TRANSIT |
| `sales_rep` | BORDER + SALES |
| `finansist` | All phases |
| `export_manager` | All phases |
| `director` | All phases |
| `boss` | All phases (not in `ROLE_PHASE_MAP` — same mechanism as `export_manager`/`director`; added 2026-08-05) |
| `admin` | All phases (and only role with permission-matrix + user-management access — see AD-15) |
