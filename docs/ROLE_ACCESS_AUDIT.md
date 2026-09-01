# Role Access Audit — 2026-08-22

> Method: logged in as one account per role (15 roles) against the running backend and issued
> **GET only** to all 109 parameterless `/api/v1/` endpoints. No POST, PATCH or DELETE other
> than the logins. Raw matrix and the sweep script are in the session scratchpad.
> Findings below were re-verified by hand against the source before being written down.
>
> **No endpoint returned 500 for any role.** Every login succeeded.

## Summary

| Module | Verdict |
|--------|---------|
| `core/`, `contracts/` | **Clean.** Every broad-200 traced to a documented decision. |
| `greenhouse/` | **4 findings** — one is a write hole, see F1. |
| `transport/` | 1 known, already-tracked gap (F5). |
| `feedback/`, `me/` | Clean — querysets are correctly user-scoped. |
| `export/` | **5 findings + a config cluster** — see F6–F11. |
| lifecycle (write path) | **3 findings** — F12 is the big one. Found by the new test suite, not the GET sweep. |

**The recurring pattern:** `write_permission(*roles)`
([core/permissions.py:152-170](../backend/apps/core/permissions.py#L152-L170)) gates **writes
only** — `if request.method in SAFE_METHODS: return True`. Several viewsets use it as though it
gated reads too. Page visibility then hides the screen while the API still serves the data.

---

## F1 — CRITICAL: any authenticated user can overwrite a block's harvest forecast

> **CLOSED 2026-09-01.** Fixed the first way — a page check, not `set_forecast_value()`.
> `DailyHarvestBoardViewSet` now carries `page_write_permission('export.harvest_board')`
> (`core/permissions.py`), which allows reads to every authenticated user and admits a
> write only when `RolePagePermission` marks the page visible for the caller's role.
> Fail-closed for a role with no row; superusers bypass. Routing through
> `set_forecast_value()` was rejected: it raises `PermissionError` for the seven roles
> that hold this board on purpose, and it does not cover `yesterday_rest` or `note`.
> Reads stay open — pinned by a test, and reopened only if F4 is answered.
> Tests: `apps/greenhouse/tests/test_daily_board_access.py`.

`POST /api/v1/greenhouse/daily-plan/` →
[views_daily_board.py:71](../backend/apps/greenhouse/views_daily_board.py#L71) carries
`permission_classes = [IsAuthenticated]` and its `create()` performs **no role check** — only
400-level field validation. It calls `upsert_daily_board()`, which writes
`HarvestDayEntry.forecast_value`
([daily_board.py:110-121](../backend/apps/greenhouse/services/daily_board.py#L110-L121)).

That is the **same column** `set_forecast_value()` guards with a strict role × time-window ×
block-assignment matrix
([harvest_day_service.py:338-398](../backend/apps/greenhouse/services/harvest_day_service.py#L338-L398)):
`admin`/`boss` need a non-empty override reason, `greenhouse_manager` is confined to its own
assigned block inside the primary window, `loading_dept_head`/`deputy` to a day-before→day-of
window, and **every other role raises `PermissionError`** — `export_manager` included.

The module docstring says the board writes "without the role/window gates that govern the
Weekly Plan grid (**any authenticated user with page access may edit**)"
([daily_board.py:4-5](../backend/apps/greenhouse/services/daily_board.py#L4-L5)). The relaxation
is deliberate; **the "with page access" half is never enforced.** The viewset checks
authentication and nothing else.

`export.harvest_board` is not visible to `sales_rep` (7 pages) or `seller` (5 pages), yet both
can POST to this endpoint and silently rewrite any block's forecast for any date — bypassing the
window, the block assignment and the override-reason requirement. Forecast values feed the
weekly plan and the draft-drawdown pool.

**Fix:** enforce the docstring's own condition — a page check on `export.harvest_board`, or
route `create()` through `set_forecast_value()`.

**Not exploited to confirm.** Verifying this end-to-end means a real write to live
`YIGIT_PLATFROM_NEW`. The read of the code is unambiguous; confirm it on the test DB.

## F2 — HIGH: `domestic-sales` serves `price_per_kg` to all 15 roles

`GET /api/v1/greenhouse/domestic-sales/` returns 200 for **every** role. The serializer includes
`price_per_kg` ([greenhouse/serializers.py:135](../backend/apps/greenhouse/serializers.py#L135)).
The `export.domestic_sales` page is visible to only 7 of 15 roles — not `finansist`,
`warehouse_chief`, `weight_master`, `accountant`, `transport`, `sales_rep` or `seller`.

Cause: `DomesticSaleViewSet` uses `write_permission(*_DOMESTIC_WRITE_ROLES)`
([greenhouse/views.py:513-541](../backend/apps/greenhouse/views.py#L513-L541)), which passes all
reads.

The contrast is measured, not theoretical — from the same sweep:

| Endpoint | Roles that get 200 |
|---|---|
| `/api/v1/export/prices/` | **5** — admin, boss, export_manager, director, finansist |
| `/api/v1/greenhouse/domestic-sales/` | **15** — everyone |

Both carry pricing. `domestic_sale` **is** a registered resource code
([permission_registry.py:99](../backend/apps/core/permission_registry.py#L99)) — the gate exists
and simply isn't wired. **Fix:** `DynamicResourcePermission(resource_code='domestic_sale')`,
matching what `price_entry` already does.

## F3 — MEDIUM: `greenhouse/admin/blocks/` and `admin/block-assignments/` readable by all 15

`admin.blocks` is visible to 5 roles; both endpoints answer 200 to all 15, exposing which staff
member manages which block. Sibling routes under the same `admin/` prefix —
`core/admin/page-permissions/` and the other three — are hard-gated to `admin` for reads too, so
this is an inconsistency rather than a convention. Same cause as F2
([views_admin.py:113,138](../backend/apps/greenhouse/views_admin.py#L113)); `greenhouse_block` is
likewise a registered-but-unwired resource code.

## F4 — MEDIUM: `harvest-plans/` and `day-entries/` reads ungated

Writes are carefully gated; reads are open to any authenticated user while `export.plan` is
visible to 7 of 15. `weekly_plan` is another registered-but-unwired resource code. Lower severity
— kg figures, no pricing or PII. **Either** wire it **or** delete the unused registry entry and
say in a comment that these reads are intentionally open.

## F5 — LOW: transport module open to all (already tracked)

`devices/`, `drivers/`, `live-positions/`, `truck-heads/`, `trailers/` are all
`IsAuthenticated` only. Already documented as a deliberate interim choice in
`docs/obsidian/processes/fleet-map.md` → "Out of Scope". Recorded here only to give it a
concrete argument for prioritisation: `seller` has no fleet page and no `export.shipments`, yet
can list every truck, every driver's name and phone, and every live GPS position.

---

## Cleared — verified non-issues

- **`core/team-kpi/`, `core/worklog/team/` open to all** — ADR-020's locked "radical
  transparency" decision (`docs/ADR.md:122`): every user may see everyone's hours and KPIs.
- **Reference data readable by all** (`customers`, `export-firms`, `countries`, `cities`, …) —
  the platform-wide `write_permission(*REFERENCE_DATA_WRITE)` pattern, pinned by
  `apps/core/tests_reference_data_perms.py`. Dropdowns need this regardless of role; the
  `admin.customers` page gates the CRUD screen, not the read.
- **`contracts/document-layouts/` GET open** — six rows of margin numbers; writes gated by
  `DynamicResourcePermission`.
- **AD-15 permission-matrix endpoints** — `_AdminOnlyPermission` does a bare `role == 'admin'`
  compare, correctly refusing `boss` and `director`. Matrix agrees: only `admin` gets 200.
- **`feedback/tickets/`** — `get_queryset` scopes non-admins to own + public; the 200 is correct.
  `admin_unread_count/` correctly 403s non-admins.
- **`me/tasks/`, `me/kpi-today/`** — user-scoped querysets, supervisor widening explicitly gated.
- **`harvest-plans/block-summary/` 400s** — missing `year`/`week` query params, not access.

---

## F6 — HIGH: `greenhouse_manager` sees the Shipments nav link and every call behind it 403s

Verified from the sweep, not inferred:

| Role | `export.shipments` page visible? | `GET /api/v1/export/shipments/` |
|------|-------------------------------|-------------------------------|
| `greenhouse_manager` | **yes** | **403** |
| every other role except `seller` | yes | 200 |

`greenhouse_manager` gets 403 on all seven shipment endpoints — `/shipments/`, `/board/`,
`/sheet/`, `/sheet-order/`, `/my-pending-count/`, `/my-sales-reports/`, `/swappable-fields/`.
`ShipmentViewSet` uses `resource_code = 'shipment'` +`DynamicResourcePermission`
([views.py:130-131](../backend/apps/export/views.py#L130-L131)), and
`RESOURCE_DEFAULTS['greenhouse_manager']`
([seed_permissions.py:269-272](../backend/apps/core/management/commands/seed_permissions.py#L269-L272))
grants only `weekly_plan` and `domestic_sale` — no `shipment` key at all.

This is the product's main data screen, not an admin sub-page. **Fix:** either revoke the
`export.shipments` page grant for this role, or add `'shipment': _VIEW` to its resource defaults.
`seller` is 403 too but correctly — it has no `export.shipments` page.

## F7 — `export_manager` and `document_team` have a dead Boss Analytics link

Both hold the `analytics.boss` page; both get **403 on all 13 `boss/*` endpoints**.
`BossAnalyticsViewSet` gates on `IsBossOrDirector`
([permissions.py:400-413](../backend/apps/core/permissions.py#L400-L413)) = `admin`, `boss`,
`director` only.

This is the exact pattern `_BOSS_DEAD_PAGES`
([seed_permissions.py:59-73](../backend/apps/core/management/commands/seed_permissions.py#L59-L73))
was created to prevent — a page grant whose endpoint refuses the role — applied to `boss`'s own
grant but never to anyone else's. The data is revenue, debt and margin, so **don't default to
widening the gate**; the likely fix is revoking the page.

## F8 — `boss` has a dead Sales-Rep Coverage link

`boss` holds `export.sales_rep_coverage` and gets **403**; `admin`/`export_manager`/`director`
get 200. `SalesRepCoverageViewSet._check_privileged()`
([views.py:4057-4062](../backend/apps/export/views.py#L4057-L4062)) tests membership of
`core.roles.PRIVILEGED_ROLES` = `{admin, export_manager, director}` — which excludes `boss`.
Most gates were migrated to `ADMIN_LIKE`/`is_admin_like()` when boss was widened in Aug 2026;
this one was missed.

## F9 — `customs-expenses/` and its ledger readable by every role

200 for all 15, including `seller`, `weight_master`, `greenhouse_manager`, `transport`,
`accountant`, `sales_rep` — none of whom hold a finance page. `CustomsExpenseViewSet` has
`permission_classes = [IsAuthenticated, SeasonNotClosed]` and **no `resource_code`**
([views_finance.py:369](../backend/apps/export/views_finance.py#L369)).

Its sibling in the same file and the same money domain, `FinansistAdvanceViewSet`, does it right:
`resource_code = 'advance'` + `DynamicResourcePermission`
([views_finance.py:107-108](../backend/apps/export/views_finance.py#L107-L108)). Writes *are*
gated (`CUSTOMS_EXPENSE_WRITE`); only reads leak. The `ledger()` action exposes the full
cash-float money-in/money-out summary.

## F10 — `clients-report/` relies on the frontend route guard

200 for every role. `permission_classes = [IsAuthenticated]` only, and the module docstring says
so outright: *"Page-level access (analytics.clients) is enforced by the frontend ProtectedRoute…
Server-side we require an authenticated user"*
([views_clients_report.py:5-7](../backend/apps/export/views_clients_report.py#L5-L7)).

A route guard is not an access control — this sweep bypassed it by definition. The endpoint
returns customer names with per-country/per-city truck counts and tonnage.

## F11 — config cluster: page grants that have drifted ahead of resource grants

Not code bugs — each gate behaves as written. The defect is a live `RolePagePermission` row with
no matching `RoleResourcePermission`. Same class as F6/F7; the repo's own precedent
(`_BOSS_DEAD_PAGES`) says **revoke the page, don't widen the gate**, absent a stakeholder call.

| Role | Page visible | Endpoint 403 | Missing grant |
|------|--------------|--------------|---------------|
| `document_team` | `admin.seasons` | `admin/seasons/` | `season` |
| `document_team` | `admin.users` | `admin/users/` | not in `MANAGEABLE_BY_ROLE` |
| `document_team` | `audit_log` | `audit-log/` | not in `AUDIT_VIEWERS` |
| `document_team` | `export.trucks` | `truck-allocations/` | `truck_allocation` |
| `document_team`, `loading_dept_head`, `loading_dept_head_deputy` | `export.quota.local_sell` | `local-sell-plans/` | `local_sell_plan` |
| `accountant` | `export.shipments` (works) | `comments/` | `shipment_comment` — the comment widget 403s on every shipment |

`document_team`'s live page list is 24 pages against 12 in
`PAGE_DEFAULTS['document_team']` — the DB has drifted well past the seed.

## Cleared in `export/` — verified correct

- **`dashboard/summary/`, `kpi/dashboard/`, `kpi/by-phase/`** — docstrings state explicitly that
  every authenticated role sees the same data; not executive-only.
- **`production-analysis/`** — 403s exactly the roles lacking `export.pomidor_dukany`.
- **`admin/managed-page-permissions/`** — 200 only for `admin` and `loading_dept_head`, the one
  delegated manager under ADR-022; `boss` 403 matches `_BOSS_DEAD_PAGES`.
- **`shipments/overdue/`** for `sales_rep`/`finansist` — explicit commented whitelist
  ([views.py:989-995](../backend/apps/export/views.py#L989-L995)); sales reps file the report it
  tracks, finansist tracks payment lag.
- **`advances/`** for `sales_rep` — explicit `RESOURCE_DEFAULTS['sales_rep']['advance'] = _VIEW`.
- **`admin/seasons/`** for `finansist` — documented; the header season switcher needs it.

## Not determinable from this sweep

`harvest-forecast/`, `harvest-forecast/remaining/`, `kpi/by-role/` return 400 (missing required
query param) for every role — the request never reached the permission gate. Re-test with params.

---

# Write-path findings (from `apps/export/tests_role_lifecycle.py`)

The GET sweep could not reach these — they are POST-only. Found while building the
lifecycle test, verified against both the seeded matrix and the live DB.

## F12 — HIGH: `POST /transition/` is unreachable for the roles that own the steps

`DynamicResourcePermission` maps **POST → `shipment.can_create`**
([permissions.py:463-495](../backend/apps/core/permissions.py#L463)). `/transition/` is a POST,
and `ShipmentViewSet.get_permissions` has **no relaxation branch for it**. Live
`RoleResourcePermission` for `shipment`:

| Role | Edges it owns | `can_create` | Can it use `/transition/`? |
|---|---|---|---|
| `document_team` | 3 (both customs steps + `yola_chykdy`) | **0** | **no** |
| `sales_rep` | 5 (`dest_entry` → `satyldy`) | **0** | **no** |
| `warehouse_chief` | 1 (`yuklenme`) | **0** | **no** |
| `transport` | 1 (`serhet_gechdi`) | **0** | **no** |
| `finansist` | 1 (`tamamlandy`) | **0** | **no** |
| `export_manager` / `director` / `boss` | — (privilege bypass) | 1 | yes |

So **all 11 lifecycle edges are owned by roles that the DRF layer refuses**, and the process can
only be driven by hand by `export_manager`, `director` or `boss`. The role gate inside
`transition_to()` would have admitted each of them — the request dies before reaching it, with
DRF's generic message rather than the gate's "cannot trigger transition …".

`get_permissions` already relaxes this exact clash **three times** — `_OPEN_ACTIONS`, the
pallet-manifest writes, and `set_sales_report` — each with a comment saying POST→`can_create`
"would wrongly block" the role that owns the work
([views.py:143-171](../backend/apps/export/views.py#L143-L171)). `transition` never got the same
treatment. That pattern makes an oversight much more likely than a decision, but it is a
judgement call, not a fact — confirm before changing it.

**Why the business still runs:** transitions also fire from `auto_advance_if_ready` as a side
effect of an ordinary PATCH, and `can_edit` **is** 1 for all these roles. Operators fill Sheet
cells and the shipment advances itself. It is the explicit transition button that is closed to
them.

Pinned by `TransitionEndpointReachabilityTests`, which asserts today's behaviour and will go red
when it is fixed.

## F13 — the repo contradicts itself on `warehouse_chief.can_create`

**Corrected 2026-08-22.** First written as *"warehouse_chief cannot create drafts in production
though the design says it should"* — that was wrong. The documentation says `can_create = False`
**is** the intended state:

- `roles/support-roles.md` — *"Warehouse Chief … cannot create shipments or access admin."*
- `processes/shipment-lifecycle.md:422` — role table, `warehouse_chief` → **Can Create: No**.
- `reference/api-endpoint-map.md:88` — POST maps to `shipment.can_create`, *"**False** for
  `weight_master` and `warehouse_chief` even though they OWN the manifest"*, which is the stated
  reason the pallet-write paths carry a hand-written exemption.
- `processes/draft-shipments.md:129` — the supply draft is created by Soltanmyrat, role
  **`loading_dept_head`**.

Live matrix vs `seed_permissions` defaults for `shipment`:

| Role | Seeded | Live | Which is right |
|---|---|---|---|
| `warehouse_chief` | `_VCE` (create yes) | create **no** | **live** — matches three docs |
| `document_team` | `_VE` (delete no) | delete **yes** | **seed** — nothing asks for the delete |

So what remains is two smaller things:

1. `seed_permissions.py:218` grants `_VCE` with the comment *"warehouse_chief can now create
   draft shipments (Finding #2)"*, contradicting `api-endpoint-map.md:88`. One is stale; the repo
   does not say which.
2. `seed_permissions` only `get_or_create`s and never overwrites — documented at
   `processes/permissions-system.md:327` along with two other live drifts from the same cause —
   so that seed change could not have applied to an existing DB regardless.

Confirmed in the browser 2026-08-22: `warehouse_chief` sees neither create button, both being
behind one `canCreate` condition. **Correct behaviour.**

## F14 — `apps.export.tests_cancel` is order-dependent and mostly red on its own

Not caused by this work, but it surfaced during it and it distorts any suite result:

| Run | Failures |
|---|---|
| `tests_cancel` alone | **10+** |
| `tests_cancel` after `tests_role_lifecycle` | **1** |

`tests_cancel` seeds no permission rows of its own and depends on whatever another module left in
the process-wide permission cache — which has no per-test reset, so entries outlive transaction
rollback (the hazard already documented at length in
[tests_boss_transitions.py:27-52](../backend/apps/export/tests_boss_transitions.py#L27)). The new
lifecycle module calls `seed_permissions`, warms the cache with real values, and **masks** most of
those failures. That is a side effect, not a fix — `tests_cancel` should seed its own rows.

The one failure that survives in every ordering is `test_admin_role_can_cancel`: a `role='admin'`
non-superuser gets 403 from `DynamicResourcePermission` because no `shipment` row exists for it in
that test's DB. Pre-existing.
