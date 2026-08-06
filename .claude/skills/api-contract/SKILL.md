---
name: api-contract
description: "The backend/frontend API agreement for the YGT Platform: DB-column-to-API field renaming rules, list/detail response shapes, pagination, error format, and per-endpoint contracts (shipments, sheet, comments, sales report, dashboard, team KPI, customs ledger). Use when creating or changing any DRF serializer, viewset, or endpoint, when writing frontend TypeScript types or hooks against the API, or when checking what an endpoint returns."
---

# API Contract Rules

The agreement between backend (Django/DRF) and frontend (React/TypeScript). Both sides must follow these rules.

## Base URL and versioning

All endpoints under `/api/v1/{app}/{resource}/`. Current apps: `export`, `contracts`, `core`, `finance`.

## Field naming convention

DB column names → API field names via DRF serializer. The API uses **readable names**, not raw DB columns:

| DB column (DDL v5.1) | API field name | Why |
|----------------------|---------------|-----|
| `code` | `shipment_code` | More descriptive for frontend |
| `weight_net_kg` | `weight_net` | Frontend doesn't need `_kg` suffix, unit is implied |
| `weight_gross_kg` | `weight_gross` | Same |
| `status_id` | `status` (int) + `status_display` (string) | Both: ID for mutations, display name for rendering |
| `country_id` | `country` (int) + `country_name` (string) | Same pattern |
| `export_firm_id` | on detail only: nested `export_firms[]` from firm_splits | List view: no firm. Detail: array of splits |
| `is_gapy_satys` | `is_gapy_satys` | Keep as-is, domain term |
| `created_by` | `created_by` (int) + `created_by_name` (string) | Same pattern |

Rule: every FK field returns both the ID (for mutations) and a `_display` or `_name` string (for rendering). Frontend never needs a second API call to resolve an FK name.

## Response shapes

### List endpoint: `GET /api/v1/export/shipments/`
Flat — no nested objects, no related tables. Used by ProTable.

The example below shows the **default-visible** fields. As of the ShipmentList column-manager work, `ShipmentListSerializer` ALSO returns the full set of **scalar** shipment fields (Sheet parity) so the column-settings panel can offer them as opt-in columns: all AD-1 + operator timestamps (`loading_started_at`, `customs_entry_at`, `customs_exit_at`, `border_crossed_at`, `sale_started_at`, `sale_ended_at`, `dest_entry_at`, `loading_ended_at`, `sales_report_date`, `harvest_date`), weight detail (`packaging_kg`, `pallet_count`, `box_count`, `rejected_weight_kg`), transport (`vehicle_responsible`/`_display`, `trailer_id`, `truck_plate`, `driver_name`, `driver_phone`, `transport_temp_c`, `transit_days`, `has_peregruz`, `peregruz_city`, `peregruz_date`), `customs_clearance_planned_day`, vehicle condition (`vehicle_condition`/`_note`, `vehicle_live_status`), flattened quality flags (`doc_azyk`, `doc_suriji`, `doc_hil`, `doc_kalibrowka`), per-role notes (`notes`, `export_manager_note`, `warehouse_note`, `document_note`, `additional_notes_arap`), refs (`status_code`, `country_code`, `variety`/`variety_code`, `import_firm`/`import_firm_name`), and audit (`created_by_name`, `created_at`). One firm field IS exposed on the list as a flattened scalar: `export_firms_display` — a comma-joined string of export firm **short names** (`ExportFirm.name_short`, falling back to `code` when blank; e.g. `"YGT, HJ"`) derived from the `firm_splits` junction (null when no splits). Documents continue to use `ExportFirm.code`; `name_short` is shipment-display only. The nested `firm_splits` / `block_sources` arrays themselves remain **detail/sheet only** — the list stays flat. The list queryset adds `select_related('import_firm', 'created_by', 'quality')` plus `prefetch_related('firm_splits__export_firm')` (one extra query per page, for `export_firms_display`) to keep this N+1-safe.

```json
{
  "count": 983,
  "next": "/api/v1/export/shipments/?page=2",
  "results": [
    {
      "id": 1,
      "shipment_code": "0201045/25",
      "date": "2025-02-01",
      "status": 4,
      "status_display": "Departed",
      "country_name": "Kazakhstan",
      "customer_name": "Berik",
      "weight_net": 18500.00,
      "weight_gross": 19200.00,
      "departed_at": "2025-02-01T14:30:00+05:00",
      "arrived_at": null,
      "is_gapy_satys": false
    }
  ]
}
```

### Detail endpoint: `GET /api/v1/export/shipments/{id}/`
Full data with nested related objects.

```json
{
  "id": 1,
  "shipment_code": "0201045/25",
  "...all list fields...",
  "firm_splits": [
    { "export_firm_id": 1, "export_firm_name": "YGT H.J.", "weight_kg": 10000, "amount_usd": 14500 }
  ],
  "block_sources": [
    { "block_code": "A", "block_name": "A-Ýyladyşhana", "weight_kg": 12000 }
  ],
  "status_log": [
    { "status_display": "Loading", "changed_by_name": "Soltanmyrat", "changed_at": "...", "comment": "..." }
  ],
  "quality": { "azyk_maglumatnama": true, "suriji_gozukdiriji": true, "...": "..." },
  "comments": [ { "user_name": "Gadam", "role": "export_manager", "content": "...", "created_at": "..." } ],
  "vehicle_condition": "OK",
  "vehicle_condition_note": null,
  "route_note": null,
  "editable_fields": ["weight_net", "weight_gross", "box_count"]
}
```

### Status transition: `POST /api/v1/export/shipments/{id}/transition/`
```json
// Request
{ "new_status": "gumruk_girish", "comment": "Docs ready" }

// Response: updated shipment detail (same as GET detail)
// Error 400: { "error": "Cannot transition from yuklenme to bardy" }
// Error 403: { "error": "Role document_team cannot trigger this transition" }
```

### Hard-delete draft: `POST /api/v1/export/shipments/{id}/hard-delete/`

Permanently deletes a single **draft** shipment from the detail page, cascading its
comments, status_log, firm_splits, block_sources, pallets, quality, tasks and custom field
values, and releasing any `QuotaUsageRecord` rows (drafts deleted, approveds released — same
cleanup as `bulk-delete`). Irreversible — there is no restore.

Allowed roles: `admin` or superuser only. The shipment **must** be in `draft` status; once it
has advanced, use `cancel` (lifecycle) or `soft-delete` (restorable trash) instead. No body.

```json
// Response 200: { "deleted": 1, "cascade_rows_deleted": 7, "draft_quota_deleted": 0,
//                 "approved_quota_released": 0, "approved_quota_to_reconcile": [] }
// Error 400: { "error": "Only draft shipments can be permanently deleted. Cancel or soft-delete active shipments instead." }
// Error 403: { "error": "Only admin can permanently delete shipments." }
```

### Sales report: `POST`/`PATCH /api/v1/export/shipments/{id}/sales-report/`

The final per-shipment sales report (the "hasabat" the export manager used to keep in Excel).
Allowed roles: `sales_rep`, `export_manager`, `director`, plus superusers. The shipment must
have departed (`yola_chykdy`, step 4) or later, else 400 (system status lags the real sale, so
gating on "sold" would block trucks that have already departed and sold). Read it from the shipment **detail** response
(nested under `sales_report`) — there is no separate GET. Returns the full shipment detail on success.

Amounts are stored in the report's **native currency** (`currency`, defaults from `shipment.country.currency`
on first create, falling back to `'KZT'`); USD totals are **derived** server-side as `*_local / exchange_rate`
(the "Kurs"). Money/weight are decimal strings.

**Wire format change (Phase 1):** `expenses[].category` is now an **integer PK** (FK to
`ExpenseCategory`), not a string code. Frontend will send PKs from Phase 2 onward. The read
response includes `category_code` (string, e.g. `"NDS"`), `category_display` (English label),
and `logo_code` alongside the numeric `category` PK.

```json
// Request (PATCH — partial; omitting line_items/expenses leaves children untouched)
{
  "currency": "KZT",
  "exchange_rate": "680.0000",          // Kurs: local units per USD
  "weight_loaded_kg": "18500.00",
  "weight_sold_kg": "18371.00",
  "weight_rejected_kg": "129.00",
  "notes": "Karaganda, 25 AP 280",
  "line_items": [                        // replace-all when present
    { "line_number": 1, "product_name": null, "quantity_kg": "18371.00", "price_local": "680.00" }
    // amount_local is ALWAYS recomputed server-side as quantity_kg * price_local (client value ignored)
  ],
  "expenses": [                          // replace-all when present; category = integer PK
    { "category": 13, "label_raw": null, "amount_local": "1476000.00" },
    { "category": 1,                     "amount_local": "227250.00" },
    { "category": 7,                     "amount_local": "59745.00" },
    { "category": 3,  "label_raw": "KAPLANB-KARAGANDA NAKLIYE", "amount_local": "800000.00" },
    { "category": 4,                     "amount_local": "500000.00" }
  ]
}
```

Expense read shape (per item in `expenses[]`):
```json
{
  "category": 13,
  "category_code": "NDS",
  "category_display": "VAT (NDS)",
  "logo_code": null,
  "label_raw": null,
  "amount_local": "1476000.00"
}
```

Server-computed, read-only on the report object (cannot be set by the client):
`total_sales_local`, `total_expenses_local`, `net_income_local` (= sales − expenses), and the
derived `total_sales_usd` / `total_expenses_usd` / `net_income_usd`.

`expenses[].category` references an `ExpenseCategory` row (see `/expense-categories/` below).
The 21 original seed codes remain: `TOM_ROSHOD`, `NAKLIYE`, `BAZAR_ROSHOD`, `INTERES`,
`UZBEK_FURA_AWANS`, `DOZWOL`, `ANALIZ`, `PROSTOY`, `PERESEPKA`, `ARAP`, `KASPIY_KOMIS`,
`UZBEK_FURA_SOLYARKA`, `NDS`, `SBOR`, `UZB_KAZ_POST`, `UZB_KAZ_NAKLIYE`, `UZBEK_TAM`, `MOI`,
`DOSMOTR`, `PEREWOT`, `OTHER`. Admin can add more at any time; `is_active=False` rows are
rejected by the serializer. `label_raw` carries the verbatim sheet text for audit/import
fidelity. The legacy flat USD fields (`total_usd`, `transport_cost_usd`, `market_fee_usd`,
`other_expenses_usd`, `price_per_kg`) remain for back-compat.

### Expense categories: `GET|POST|PATCH|DELETE /api/v1/export/expense-categories/`

Admin-managed template for sales report expense categories. One pre-listed row per category
appears in the Sale tab. Categories with `is_active=False` are hidden from the form and
rejected by the expense serializer.

Read: any authenticated user.
Write (create/update/delete): `admin`, `director`, `export_manager`, superusers.

Caution: DELETE of a category that has `SalesReportExpense` rows in use raises a 500
(PROTECT FK). Prefer toggling `is_active=False` instead of deleting.

Response item shape:
```json
{
  "id": 13,
  "code": "NDS",
  "name_tk": "NDS (goşulan baha salgyt)",
  "name_ru": "НДС",
  "name_en": "VAT (NDS)",
  "logo_code": null,
  "sort_order": 12,
  "is_active": true
}
```

### Auth: `POST /api/v1/auth/login/`
```json
// Request
{ "username": "gadam", "password": "..." }

// Response: sets httpOnly cookie, returns user info
{ "id": 1, "username": "gadam", "role": "export_manager", "editable_fields": ["..."] }

// Error 401: { "error": "Invalid credentials" } | { "error": "Account disabled" }
// Error 429 (brute-force lockout — django-axes, keyed on username+IP):
{ "error": "Too many failed login attempts. Please try again later.",
  "detail": "locked_out", "retry_after": 1800 }   // also sends a Retry-After header (seconds)
```

Brute-force lockout is **escalating**: 3 failed logins for one `(username, IP)` pair block it
for 30 min, 3 more → 5 h, then 1 day (fresh 3 attempts per tier). A successful login before
lockout resets the counter. `retry_after` is the block's remaining seconds. See
`docs/obsidian/processes/authentication.md`.

### Me: `GET /api/v1/auth/me/` — season fields (AD-16)

The live route is `apps.export.views_auth.MeView` + `ExtendedUserMeSerializer` (shadows
`apps.core.urls.auth`'s own `me/` route — `config/urls.py` includes the export urls first).
It gains two fields on top of the existing `role`/`editable_fields`/`permissions`/etc.:

```json
{
  "active_season": { "id": 13, "name": "2026/2027", "status": "ACTIVE" },
  "can_view_closed_seasons": true
}
```

`active_season` is `null` during the close→open gap (no season currently active) — this is
what seeds the frontend season store on load; there is no separate endpoint for it.
`can_view_closed_seasons` mirrors `RoleResourcePermission(resource_code='closed_season').can_view`
(or `is_superuser`) — whether this user may select a closed season in the header switcher.

### My work filter: `GET /api/v1/export/shipments/?my_work=true`
Same response shape as list, filtered by role's active window server-side.

### My tasks: `GET /api/v1/me/tasks/` and `GET /api/v1/me/kpi-today/`

Backs the **My tasks** page (`/me/board`, `SelfBoard.tsx`) — not to be confused with the
**Board** page (`/export/shipments/board`).

Regular users are locked to their own `assignee_role` (plus tasks personally assigned to
them). Supervisors — `export_manager`, `boss`, `admin`, `director`, superusers — receive
**every** role's tasks by default.

Optional `?assignee_role=<role>` narrows to one role. **Supervisors only** — silently
ignored for every other role, whose own-role lock is unconditional. Unknown role → 400
on `/me/tasks/`. Other filters: `?state=`, `?step=`, `?overdue=true`.

`/me/tasks/` is **season-scoped** (`?season=<id>`, defaults to the active season, 403 on a
closed season without `closed_season.can_view`, 404 on an unknown id) — same contract as
every other scoped list. The anchor is `shipment__season` with `include_null_link`, so
weekly-plan / local-sell-plan tasks (no shipment) stay on the board under an open season and
drop out when a closed season is explicitly selected. It fails closed during the close→open
gap. `useMyTasks`' query key carries `seasonId` for the same reason every other scoped hook
does.

`/me/kpi-today/` is deliberately **not** season-scoped — it is a "what did this role finish
today" tile, and a closed season's tasks cannot be completed at all (the write freeze blocks
the transition), so a season filter would only blank the tile while browsing a closed season.

`/me/kpi-today/` accepts the same param under the same gate, so the KPI tiles describe the
role being viewed. Its 60s cache key includes the effective role
(`me:kpi-today:{user_id}:{role}`) — tests that clear this key must include the role or they
silently stop isolating.

The supervisor-filtered view is a **superset** of that role's own screen: it applies
`assignee_role=X` with no `assignee_user` clause, so tasks another user has personally
picked up are included (intended oversight semantic).

Caution: with **no** role selected, a supervisor's list is truncated — `count=1213` vs
`page_size=1000` as of 2026-07. Selecting a role makes the view complete; the largest
single role is ~550.

### Team KPI leaderboard: `GET /api/v1/core/team-kpi/?period=today|week|month|season`

Backs the **Team KPI** page (`/team/kpi`, `TeamKpi.tsx`) — a Bitrix-style leaderboard, one
row per active user, ranked by tasks completed in the selected window. **Public**:
`IsAuthenticated` only, no role gate — every authenticated user sees everyone's numbers
(same radical-transparency rule as `/worklog`). When `period=season`, an optional
`&season=<id>` (AD-16) moves the window's start date to that season instead of the active
one (same closed-season permission rules as any other `?season=`); ignored for every other
`period` value. **Incomplete even when wired:** `overdue_now` and `trend` are
**window-independent** regardless of `?season=` — `overdue_now` reads `timezone.now()` and
`trend` is a fixed rolling 14 days from today (see this file's own caveats on those two
fields, below). Browsing a closed season therefore returns one row blending that season's
`completed`/`on_time_rate` with **today's** overdue count and a **current** 14-day trend —
two epochs in one row. This was flagged as a decision for whoever wires the switcher onto
this endpoint (AD-16) and was never made: blank those two fields for a non-active season,
relabel them, or accept and document further. Currently unresolved. During the close→open
gap `period=season` returns `results: []` — D7 fail-closed; it previously fell through to an
unbounded ALL-TIME window that blended every closed season's completions. Default period is
`week`; unknown period →
400. 60 s server-side cache keyed by period (`team-kpi:{period}`).

```json
{
  "period": "week",
  "results": [
    {
      "user_id": 7,
      "user_name": "Soltanmyrat",
      "role": "loading_dept_head",
      "completed": 42,
      "on_time_rate": 0.9048,
      "overdue_now": 1,
      "active_seconds": 93600,
      "trend": [0,1,0,2,0,0,3,1,0,0,2,1,0,4]
    }
  ]
}
```

- `completed` / `on_time_rate` are **windowed** and attributed by `Task.completed_by` — the
  user credited with finishing the task (see `Task.completed_by` in
  `docs/obsidian/processes/comments-tasks.md`). `on_time_rate` is `null` when the user has no
  completed tasks with a deadline in the window (same convention as `/me/kpi-today/`).
- `active_seconds` sums `WorkSessionDaily.active_seconds_total` over the same window.
- **`trend`**: 14 ints, oldest→newest, one per calendar day in Asia/Ashgabat — the user's
  daily completed-task count (attributed by `completed_by`, same as `completed`). This is a
  **FIXED 14-day window, independent of `period`** — it does not shrink/grow when the
  `period` selector changes, so don't read it as period-scoped. A user with zero completions
  in the window gets `[0,0,0,0,0,0,0,0,0,0,0,0,0,0]`.
- **Caution — `overdue_now` is current-state and window-independent**: it counts tasks that
  are overdue **right now**, regardless of the `period` selector, and is attributed by
  **role** (`assignee_role`, expanded through `task_roles_for()` for deputy equivalence) —
  not by `completed_by`. It does not change when you switch periods; only the other three
  metrics do.
- Roster is every `User.is_active=True` row, so a user with zero activity in the window
  still appears with `completed=0`, `on_time_rate=null`, `active_seconds=0`.

### Sheet endpoint: `GET /api/v1/export/shipments/sheet/`
Optional `?shipment=<id>` returns just that one shipment's row alongside the **same global config** (`rows` / `row_settings` / `users_index` / `current_user_*`) — a tiny payload used by the task drawer's field editors (Shipment Board + Self Kanban) so opening a task to act on it doesn't download the whole-season sheet. `?season=<id>` overrides the active-season default; with `?shipment=` the season scope is bypassed (archived/soft-deleted guards still apply).

**Customer-based row scoping (sales_rep):** when the requesting user's role is `sales_rep` (and they are not a superuser), the Sheet rows are filtered to shipments whose `customer.sales_rep` is that user — assigned via `Customer.sales_rep` / the Sales Rep Coverage endpoint. Shipments with a null customer are excluded for reps, and a rep with no assigned customers gets an empty `results`. The filter applies to the `?shipment=` drawer path too, so a rep cannot open an unowned shipment. Management (`admin`/`export_manager`/`director`) and every other operational role (loading/transport/etc., who work by status phase, not customer) see all rows unchanged. The global config (`rows` / `row_settings` / `users_index`) is identical regardless of scoping.

**Wrapped response shape** (not a flat array):
```json
{
  "results": [ /* IShipmentSheetItem[] — flat per-season payload, no pagination */ ],
  "comment_counts": {
    "<shipment_id>": { "<field_key>": 3, "__shipment__": 1 }
  },
  "task_counts": {
    "<shipment_id>": { "open": 2, "done": 5, "assigned_to_me_open": 1 }
  }
}
```
Frontend reads `comment_counts` for per-cell marker badges and `task_counts` for the toolbar's "open tasks assigned to me" indicator. Both are computed by single grouped queries on the backend (no N+1).

### Comments CRUD: `/api/v1/export/comments/`
- `GET /comments/?shipment={id}&field_key={key}&assignee=me&is_done=false&parent_comment=null` — list with filters; standard `PageNumberPagination`
- `POST /comments/` — body: `{shipment, content, field_key?, mentions?: number[], role_mentions?: string[], parent_comment?, assignee?}`; replies inherit parent's `field_key`; tasks live on root comments only
- `PATCH /comments/{id}/` — body `{content}` only (own comments or `delete_any` perm)
- `DELETE /comments/{id}/` — soft delete (sets `is_deleted=True`); cascades to the comment's non-deleted replies so orphaned replies don't inflate the per-cell badge count
- `POST /comments/{id}/done/` — mark task done (assignee or `delete_any`)
- `POST /comments/{id}/reopen/` — reopen task (author or assignee)

Comment read shape (used in list + create response):
```json
{
  "id": 12, "user": 3, "user_name": "Ahmet", "role": "export_manager",
  "content": "Check @user:5 and @role:warehouse_chief on #cell:weight_net",
  "field_key": "weight_net",
  "mentions_users": [{"id":5,"name":"Bahar","role":"warehouse_chief"}],
  "role_mentions_list": [{"code":"warehouse_chief","label":"Warehouse Chief"}],
  "assignee": 5, "assignee_name": "Bahar",
  "is_done": false, "done_at": null, "done_by_name": null,
  "is_system": false, "is_deleted": false,
  "parent_comment": null, "replies_count": 2,
  "created_at": "2026-04-27T10:00:00+05:00", "updated_at": null
}
```

Mention/cell tokens are stored verbatim in `content`: `@user:42`, `@role:warehouse_chief`, `#cell:vehicle_condition`. Frontend parses with the regex `/(@user:\d+|@role:[a-z_]+|#cell:[a-z_]+)/g`.

### Mentionable autocomplete: `GET /api/v1/core/users/mentionable/?q=&limit=10`
Returns mixed list of users + roles for the `@` popover:
```json
[
  {"type":"user","id":42,"name":"Ahmet","role":"export_manager"},
  {"type":"role","code":"warehouse_chief","label":"Warehouse Chief","member_count":4}
]
```
Empty `q` returns top users + all 12 roles.

### Notifications kinds (existing endpoint)
`Notification.kind` choices include `mention`, `task_assigned`, `task_done` for the comment system. `link` format: `/export/shipments/sheet?shipment={id}&row={fieldKey}&comment={commentId}` — the Sheet page parses these query params on mount and auto-opens the Comments Drawer.

### Dashboard summary: `GET /api/v1/export/dashboard/summary/`

Main landing page for ALL authenticated users. 60 s server-side cache. No role gate.

```json
{
  "season": { "id": 3, "name": "2024-2025" },
  "stats": {
    "total":       { "value": 983, "delta_7d": 47 },
    "in_transit":  { "value": 296 },
    "selling":     { "value": 9 },
    "completed":   { "value": 173, "delta_7d": 12 },
    "no_report":   { "value": 90 },
    "quota_firms": { "value": 16 }
  },
  "alerts": {
    "no_report_count": 90,
    "quota_exceeded_count": 2,
    "docs_pending_count": 8,
    "weekly_plan": { "week": 22, "tons": 340.0, "blocks": 15 }
  },
  "routes": [
    {
      "country_id": 1,
      "country_name": "Kazakhstan",
      "trucks": 474,
      "percent": 48,
      "cities": [ { "city": "Şimkent", "trucks": 166 } ]
    }
  ],
  "active_shipments": [
    {
      "id": 1,
      "shipment_code": "26FV047/25",
      "customer_name": "Begjan",
      "country_name": "Kazakhstan",
      "city_name": "Şimkent",
      "status_display": "Yolda",
      "phase": "TRANSIT",
      "weight_net": 18400.0,
      "departed_at": "2025-02-25T14:30:00+05:00",
      "location": "Farap Postta"
    }
  ]
}
```

Notes:
- `season` is `null` when no active season exists, and the whole payload is then **empty**
  — every `stats`/`alerts` value `0`, `weekly_plan` `null`, `routes` and `active_shipments`
  `[]`. D7 fail-closed (see *Season scoping* below): the endpoint used to substitute a
  current-month range, which during the close→open gap aggregated the just-closed season's
  rows for any authenticated user. The response *shape* is unchanged, so the page renders
  its normal empty states. Note this also zeroes the LIVE counts below.
- `alerts.weekly_plan` is `null` when no `HarvestDayEntry` rows exist for the current ISO week.
- `stats.in_transit` and `stats.selling` are LIVE (not season-scoped).
- `active_shipments`: max 5, ordered by `-status_changed_at`. `location` = `Shipment.vehicle_live_status` or `""`.
- `routes.percent` = integer percentage of season total trucks, rounded. Top 4 cities per country, null/empty city names omitted.
- Implementation: `apps/export/views_dashboard.py`, service: `apps/export/services/dashboard_summary.py`.

## Season scoping (AD-16)

Every season-bearing list endpoint (shipments, Sheet, Kanban board, harvest plans, day
entries, truck allocations/destinations, local-sell plans, contracts, contract-sales,
comments, tasks, quota-usage, quota-issuances, quota-firm-balances, advances,
customs-expenses, document-packets, clients-report) accepts an optional `?season=<id>`:

- Omitted → the active (write-target) season.
- Unknown id → `404`.
- A **closed** season's id, without the `closed_season` resource permission (`can_view`) →
  `403`.
- No active season at all (the close→open gap, before an admin opens the next one) → the
  list returns **empty**, not unfiltered — a deliberate fail-closed choice (design spec D7):
  the alternative would make every closed season's data visible to everyone during that gap.

Detail-by-id routes (`GET /shipments/{id}/`, etc.) are **not** season-scoped — a direct link
always resolves regardless of the row's season. Explicit opt-outs that ignore `?season=`
entirely: every `admin/*` reference-data endpoint, and `sales-rep-coverage`.

**Quota is season-scoped in BOTH directions (D11, 2026-08-06).** `quota-issuances` was on the
opt-out list until then, on the reasoning that issuances are consumed FIFO *across* season
boundaries. The domain owner reversed that: quota never crosses a season boundary, so
`quota-issuances` is scoped on its `season` FK, and `compute_fifo_usage(product_type, season)`
/ `compute_firm_quota_balances(product_type, season)` take the season explicitly and stop the
FIFO walk at it — leftover issuance expires with its season rather than carrying forward.
Consequences worth knowing before you touch this code:

- An issuance whose `issue_date` falls in the gap between two seasons has `season = NULL` and
  is **invisible on every list** (reachable by direct link only). `POST /quota-issuances/`
  now 400s during the close→open gap rather than creating another one.
- `QuotaUsageRecord` has **no** `season` FK and **no** `issuance` FK — only `usage_date` and a
  nullable `shipment`. Its season is derived by `services_quota.usage_season_q(season)`:
  `shipment.season` when linked, else `usage_date` inside the season's range. Use that helper;
  do not hand-roll the predicate, and do not assume an `issuance` link exists.
- `quota-firm-balances` follows the **resolved** season, not the active one, and returns `{}`
  during the gap. Its cache key and the FIFO cache key both carry the season id.

`boss` analytics is mixed, not uniformly parameterised — check the specific action before
assuming `?season=` moves it:
- `GET /export/boss/revenue/` **does** take `?season=<id>` and parameterises the comparison
  (`current_season` vs the season immediately before it by `start_date`, regardless of
  open/closed) rather than filtering by it — the one endpoint in the whole feature that must
  never get `SeasonScopedMixin`, since scoping it would empty `previous_season`.
- Every **other** `boss/*` action derives its date range from `?period=` alone via
  `period_to_range()`, which for `period=season` hardcodes `get_active_season()` — passing
  `?season=` to any of them is a silent no-op.
- `GET /export/dashboard/summary/` and `GET /core/team-kpi/?period=season` **do** accept
  `?season=<id>` (added after the initial pass, per AD-16) — both move with the switcher,
  and both **fail closed** during the gap like every scoped list: the dashboard returns an
  all-zero/empty payload (shape preserved) instead of a current-month range, and team-kpi
  returns `results: []` instead of an unbounded all-time window. `team-kpi`'s other three
  periods never consult a season and are unaffected.

### Write freeze: `409 season_closed`

Any write against a row anchored (directly or by join) to a **closed** season is rejected
before the normal validation/save path:

```json
409 Conflict
{ "error": "season_closed", "season": "2025/2026", "closed_at": "2026-08-03T10:00:00Z" }
```

409, not 403 — the request is well-formed and the user is authorised in principle; it
conflicts with the resource's *state*. The frontend's global Axios interceptor shows a toast
on this shape app-wide; it is the safety net, not the mechanism — every control that could
trigger it should already be `disabled` via `useSeasonReadOnly()` before the request is sent.
See `docs/ADR.md` (AD-16) for the full design.

## Pagination

All list endpoints use `PageNumberPagination`:
- Default page size: 50
- Client can request: `?page=2&page_size=100`
- Max page size: 200
- Response always includes `count`, `next`, `previous`, `results`

## Error format

All errors return JSON:
```json
{ "error": "Human-readable message" }
// or for field validation:
{ "field_name": ["Error message 1", "Error message 2"] }
```

HTTP status codes: 400 (validation), 401 (not authenticated), 403 (no permission), 404 (not found), 500 (server error).

## Timestamps

All timestamps in ISO 8601 with timezone: `2025-02-01T14:30:00+05:00`. Frontend displays using `dayjs` with user's locale. Backend stores as `DATETIMEOFFSET`.

## Customs/Document Cash-Advance Ledger

Tracks money the cashier (Hangeldi) spends on per-shipment customs clearance and batch document fees. Money-IN is `FinansistAdvance`; this is the money-OUT side. Currency is `TMT` (Turkmen manat) by default.

### List / CRUD: `GET|POST|PATCH|DELETE /api/v1/export/customs-expenses/`

Write roles: `finansist`, `export_manager`, `document_team`, `admin`, `director`. Reads: any authenticated user.

Filter params: `?category=GUMRUKLEME`, `?currency=TMT`, `?shipment=123`, `?date_from=YYYY-MM-DD`, `?date_to=YYYY-MM-DD`. Search: `?search=` matches `export_code_raw`, `vehicle_plate`, `route_label`, `label_raw`.

Response item shape:
```json
{
  "id": 1,
  "expense_date": "2026-06-15",
  "category": "GUMRUKLEME",
  "category_display": "Customs clearance (per truck)",
  "amount": "450.00",
  "currency": "TMT",
  "shipment": 42,
  "shipment_code": "1506042/25",
  "export_code_raw": "1506042/25",
  "vehicle_plate": "48 AT 580",
  "route_label": "HMS-DM",
  "label_raw": "Gumrukleme haky",
  "quantity": null,
  "notes": null,
  "created_by": 3,
  "created_by_name": "hangeldi",
  "created_at": "2026-06-15T10:00:00+05:00"
}
```

Batch fee (no shipment, with quantity):
```json
{ "shipment": null, "shipment_code": null, "quantity": 19, "label_raw": "19 AD KARANTIN" }
```

### Category enum codes (`category` field)

| Code | Display |
|------|---------|
| `GUMRUKLEME` | Customs clearance (per truck) |
| `KARANTIN` | Quarantine fee |
| `CT1` | CT-1 certificate of origin |
| `FITO` | Phytosanitary certificate |
| `ANALIZ` | Lab analysis |
| `PASPORT_SDELKA` | Deal passport (bank) |
| `PLATYOSKA` | Payment order registration |
| `DOC_POST` | Document postage |
| `YUZLENME_HAT` | Reference letter |
| `GUMRUK_AMAL` | Customs operation fee |
| `BORDER_RETURN` | Truck returned (border closed) |
| `SERTNAMA` | Contract fee |
| `OTHER` | Other |

### Ledger summary: `GET /api/v1/export/customs-expenses/ledger/`

Cash-float balance over an optional date window (same `?date_from`/`?date_to` params). All aggregation is DB-side.

`FinansistAdvance` rows default to `USD` while customs expenses default to `TMT`; summing across currencies is meaningless, so the ledger **scopes both sides to a single currency** — `?currency=` (default `TMT`). Rows in other currencies are excluded from that window's totals. The response echoes the effective `currency`.

```json
{
  "currency": "TMT",
  "advances_total": "12500.00",
  "expenses_total": "9800.00",
  "balance": "2700.00",
  "by_category": [
    {
      "category": "GUMRUKLEME",
      "category_display": "Customs clearance (per truck)",
      "total": "5000.00",
      "count": 10
    }
  ],
  "by_date": [
    { "date": "2026-06-01", "advances": "2500.00", "expenses": "1200.00" }
  ]
}
```

`advances_total` sums `FinansistAdvance.total_amount` (filtered by `advance_date`). `by_date` merges both sides ascending by date. Empty window returns zeros and empty arrays. Money fields are decimal strings.

### Shipment detail nesting

`GET /api/v1/export/shipments/{id}/` includes:
```json
{
  "customs_expenses": [
    { "id": 1, "expense_date": "2026-06-15", "category": "GUMRUKLEME", "amount": "450.00", "..." }
  ]
}
```
Per-shipment expenses only (batch fees with `shipment=null` do not appear here). Use the list endpoint with `?shipment={id}` to query all expenses for a shipment including batch allocations.
