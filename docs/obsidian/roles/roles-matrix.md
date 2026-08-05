---
title: Roles Matrix
tags: [roles, permissions, matrix]
related: [[permissions-system]]
---

# Roles Matrix

> Master lookup: which role can access which pages, resources, and shipment lifecycle steps.

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
| Admin Pages (Users, Permissions, Firms, Seasons, Blocks, Customers, Truck Dest, Shipment Settings) | Y | - | - | Y | - | - | - | - | - | - | - |

> AD-15: `admin` is the **sole top-tier system administrator** — only role with permission-matrix and user-management access. `director` and `export_manager` lose admin pages but keep all operational power including reference-data writes (countries, cities, customers, blocks).
>
> **`boss` widened 2026-08-05** from read-only/dashboard-only to full page visibility — every row above, including Admin Pages, same as `admin`'s row. This runs against AD-15's grain (`director`/`export_manager` are explicitly denied Admin Pages) and was a deliberate, user-approved call, under review for possible narrowing. Seeing a page is not the same as acting on it: `boss` still cannot configure permissions or manage users (`_AdminOnlyPermission` gates those independently and was not touched), and reference-data writes stay `admin`/`director`/`export_manager`-only (`REFERENCE_DATA_WRITE`, also untouched) — see the Resource CRUD Matrix footnote below. See [[boss]], [[permissions-system]], `docs/ADR.md` (AD-15).

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
| Permission Matrix (page / resource / field) | CRUD | - | - | -⁴ | - | - | - | - | - | - |
| User CRUD (role / activate / password) | CRUD | - | - | - | - | - | - | - | - | - |

> **`boss` column (2026-08-05 widening) — CRUD on every `RESOURCE_REGISTRY` entry except `closed_season`** (view-only, D1 write-freeze, same as `admin`; not its own row above — see [[permissions-system]]). Four cells above are *not* the plain grant the `DynamicResourcePermission` layer implies, because the viewsets add their own hardcoded role checks on top of it that the feature didn't touch. **Verified action-by-action, not by name** (earlier passes wrongly grouped actions together, and wrongly compressed a partial grant into `CRUD`/`view`/`-` when none of those tags fit — corrected below; see the legend above for how partial cells are now tagged) — same recurring shape as the `/cancel/`/`/assign/` transition gap documented in [[boss]]:
> 1. **Local Sell Plan — `boss` gets `V+submit`: view, plus one specific ungated workflow action, not full CRUD.** `WeeklyLocalSellPlanViewSet` (`apps/export/views_planning.py`) hardcodes role checks *inside* `perform_create` (line 291) and `perform_update` (line 318, unconditional — applies regardless of the plan's status) requiring `LOCAL_SELL_WRITE` = `{admin, export_manager, director, seller}`: `boss` is blocked from both **create** and **edit** despite passing the class-level CRUD grant. `approve`/`reject`/`bulk-approve`/`initialize-week` (lines 357, 369, 401, 441) separately require `LOCAL_SELL_APPROVE` = `{admin, export_manager, director}`: `boss` blocked from all four. `bulk-submit` (line 381) also requires `LOCAL_SELL_WRITE`: blocked. The one action that *does* work is the single-record `submit` (line 344) — it has no extra role check anywhere (view method or the `submit_local_sell_plan` service), so it passes on the class-level `can_create` mapping alone; **this is a real mutating POST that moves a plan draft→submitted**, which is why the cell says `V+submit` and not plain `view`. In practice it doesn't unlock much, since `boss` cannot create a plan of his own to submit — only submit an existing draft someone else entered. `delete` isn't implemented for anyone on this viewset (not in its `http_method_names`).
> 2. **Advance — `boss` gets `VUD`: view, edit, delete, but no create** (and not reconcile or shipment-linking, which ride on the same missing `C`). `FinansistAdvanceViewSet` (`apps/export/views_finance.py`) hardcodes `role not in ADVANCE_WRITE` (`{admin, finansist, director}` — note `export_manager` is also excluded here despite its `CRUD` cell to the left) inside `create()` (line 146), `reconcile` (line 187), `link_shipment` (line 214), and `unlink_shipment` (line 273). None of those include `boss` — there is no ungated exception here the way `submit` is for Local Sell Plan; `boss` has **zero** path to creating an advance. Plain `PATCH`/`DELETE` on an existing advance have **no** such override — they fall through to the class-level `can_edit`/`can_delete` grant, which `boss` has, hence `U` and `D` in the tag.
> 3. **Reference Data — `boss` gets `view`, not `-`.** These viewsets (`CountryViewSet`, `CityViewSet`, `CustomerViewSet`, `ShipmentStatusTypeViewSet`, `BorderPointViewSet`, `TruckDestinationViewSet`, `ShipmentOptionTypeViewSet`, `GreenhouseBlockAdminViewSet` — all individually checked) gate on `write_permission(*REFERENCE_DATA_WRITE)` (`REFERENCE_DATA_WRITE = {admin, director, export_manager}`), which never went through `DynamicResourcePermission`/`RESOURCE_REGISTRY` at all — `boss`'s resource-permission widening literally cannot reach these endpoints for writes. But `write_permission()` (`apps/core/permissions.py:152`) explicitly allows all `SAFE_METHODS` (GET/HEAD/OPTIONS) to any authenticated user before checking the role allowlist — reads are open to everyone, `boss` included. Blocked on create/edit/delete; not blocked on view.
> 4. **Permission Matrix — `boss` gets `-`, genuinely zero access.** Gates on `_AdminOnlyPermission` (`role=='admin'` or superuser), whose own docstring says it "restrict[s] ALL methods (including GET)" — unlike `write_permission()` above, this class does not carve out an exception for safe methods. `boss` has the `admin.permissions` page visible (see Page Visibility Matrix above) but every call to the four backing endpoints, including read, 403s. `-` is accurate here, unlike Reference Data above.

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

> **`boss` in Privileged Override (2026-08-05):** `boss` joined `PRIVILEGED_ROLES` in `apps/export/services/shipment.py`, so `transition_to()` — and therefore `POST /shipments/{id}/transition/` — accepts him on every edge above, same as `export_manager`/`director`. This does **not** extend to the dedicated `POST /shipments/{id}/cancel/` or `POST /shipments/{id}/assign/` endpoints, which check a separate, unchanged `PRIVILEGED_ROLES` in `apps/core/roles.py` (`{admin, export_manager, director}`, no `boss`) and 403 him. See [[boss]] for the full gap.

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
