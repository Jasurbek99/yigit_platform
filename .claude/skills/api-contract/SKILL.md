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

**Sales rep scoping:** a `sales_rep` (non-superuser) gets only shipments whose `customer.sales_rep` is them — the Sheet's rule. Null-customer rows are excluded. List action only; `GET /shipments/{id}/` and other detail routes stay unscoped.

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

**Join board filter** (`?status_code__in=draft,gumruk_girish,gumruk_chykysh`, spec 2026-09-29): a comma-separated list of status codes, alongside the existing single `?status_code=`. Serves `ShipmentDraftListSerializer` — same shape as `?status_code=draft` (incl. `block_sources`) — extended with `status_code`, `country`, `customer` (ids), `truck_plate`, `driver_name`. Powers the Assignment Board's `useJoinBoard()`, which classifies rows into supply/waiting/joined client-side from these fields. `?status_code=draft` alone is unchanged.

### Product (tomato / pepper) — spec 2026-10-05, shipped 2026-10-07

One truck = one product. **NULL product reads as tomato** everywhere (old rows, old beta code); frontend uses `x ?? 'tomato'`.

| Where | Fields |
|---|---|
| `GET/POST/PATCH/DELETE /api/v1/core/product-types/` | `{id, name, code ('tomato'\|'pepper'), hs_code, name_en, name_ru, name_tk}`. Reads open to any authenticated user; writes `REFERENCE_DATA_WRITE` (admin). `code` is set on create only — a PATCH ignores it (200, code unchanged). DELETE of a product in use (varieties / shipments / contracts) → 400 `{"error": "Product is in use."}` |
| Variety (`/core/tomato-varieties/`) | `product_type` (id, writable), `product_type_code` (read-only) |
| Block serializer (core / greenhouse) | `product_type_code` read-only: `tomato` / `pepper` / null — main variety's product, else the parent block's (F1/F2 → F), else null |
| Shipment list, detail, Sheet row | `product_type` (id, writable), `product_type_code`, `product_type_name` (read-only) |
| Shipment create | optional `product_type` (only the `tomato` / `pepper` rows; a code-less product → 400 field error); with blocks it is derived from them, without blocks (destination row) default tomato |
| Contract list / detail / create | `product_type` (id, writable, default tomato on create), `product_type_code` (read-only) |

- **Filter:** `GET /api/v1/export/shipments/?product_type=tomato|pepper` (tomato also matches NULL).
- **Shipment PATCH `product_type`:** needs the `product_type` field permission; only the `tomato` / `pepper` rows — `null` or a code-less product → 400 `{"product_type": [...]}`; re-syncs quota usage rows to the new product. On a truck with firm splits every split firm needs live quota of the new product, else 400 `{"product_type": ["<FIRM> has no remaining <code> quota."]}` (same refusal, as `{"error": ...}`, on a Sheet block edit that switches a supply row's product, and on manifest close).
- **New 400 codes** (the code is the body's `error` value — `{"error": "<code>"}` — or, on a serializer field error, `{"product_type": ["<code>"]}`; frontend i18n `errors.<code>`, mapped in `utils/apiErrorText.ts`):
  - `mixed_product` — blocks of two products in one truck (supply-draft create, Sheet block edit, block-source writes).
  - `product_mismatch` — blocks of another product than the destination row; PATCH product to one that disagrees with the row's blocks; Sheet Join of supply and destination products that differ; Swap between rows of different products.
  - `contract_product_mismatch` — the truck's product differs from a contract it is sold under (NULL ≡ tomato on both sides; void sales and cancelled contracts ignored). Shipment PATCH `product_type` → `{"product_type": ["contract_product_mismatch"]}`; contract-sale `POST /contracts/sales/` or a PATCH that changes `contract` / `shipment` → `{"contract": ["contract_product_mismatch"]}`. Block-source writes and manifest close that would switch the truck's product → `{"error": "contract_product_mismatch"}`. Re-sending the current product is never refused.
- Framework-contract link of another product (`link_split_to_contract`) is a 400 with the existing message «contract_id is not an active framework contract for this pair and product.»
- Framework contracts offered for a truck (`framework_contracts_for_pair`) are filtered by the truck's product (NULL ≡ tomato); one-time contracts inherit the truck's product.

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
    { "block_code": "A", "block_name": "A-Ýyladyşhana", "weight_kg": 12000, "harvest_date": "2026-09-21" }
  ],
  // block_sources is one row per BATCH (block + harvest day), not one per block — a
  // truck can carry two batches from the same block on different days, so block_code
  // can repeat. harvest_date is nullable (operator-entered, added 2026-09-24).
  // weight_kg is a DecimalField (string on the wire, e.g. "12000.00"); shown here
  // unquoted per this doc's convention of always noting decimal-vs-number explicitly.
  "status_log": [
    { "status_display": "Loading", "changed_by_name": "Soltanmyrat", "changed_at": "...", "comment": "..." }
  ],
  // The four flags are READ-ONLY (derived: true iff a scan of that type exists).
  // Certificates are uploaded via POST /shipments/{id}/quality-certificates/.
  "quality": {
    "azyk_maglumatnama": true, "suriji_gozukdiriji": true, "...": "...",
    "certificates": [
      { "id": 7, "doc_type": "azyk_maglumatnama", "original_filename": "scan.pdf",
        "mime_type": "application/pdf", "size_bytes": 204800,
        "uploaded_at": "...", "uploaded_by_name": "...", "download_url": "..." }
    ]
  },
  "comments": [ { "user_name": "Gadam", "role": "export_manager", "content": "...", "created_at": "..." } ],
  // Sheet parity (2026-09-30): scalar columns the Detail page renders.
  "greenhouse_arrived_at": "2026-01-01T08:00:00Z",
  "pallet_weight_kg": "25.00",          // decimal string
  "shelf_life_days": 12,
  "packing_template": 3, "packing_template_name": "2 firms 20t",
  "truck_head_2_id": null, "driver_2_id": null,
  "has_current_advance": false,         // model property — give_advance target
  // Every visible custom Sheet row (SheetRowSetting.is_custom), value null if never written.
  // Written via PATCH /shipments/{id}/custom-fields/ {field_key, value}.
  "custom_fields": [
    { "field_key": "custom_seal", "label_tk": "Plomba", "label_ru": "Пломба", "label_en": "Seal", "value": "A-17" }
  ],
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

### Packing join / unjoin / swap (spec 2026-09-29)

Packing (`block_sources` + `export_code`, `variety`, `varieties_dominant`, `harvest_date`,
`harvest_status`, `weight_to_load_kg`) **moves** between shipment rows — it is never linked. All
three actions gate on `apps.core.roles.JOIN_ROLES` (`admin`/`director`/`boss`/export-manager-like
roles, plus `loading_dept_head`/`loading_dept_head_deputy` since this spec) + superuser, via
`resource_edit_permission('shipment')`. All three refuse a row outside
`PRE_LOADING = {draft, gumruk_girish, gumruk_chykysh}` or with recorded pallets. Weight rule,
shared by all three: `packaging_weight()` is read **before** the move; a row still `draft`
afterwards gets `weight_net` = the packing's weight; a row past `draft` only has an **empty**
`weight_net` filled (never overwrites one already set); `weight_gross` is never touched.

**Join** (extended) — `POST /api/v1/export/shipments/{target_id}/join/` body `{"source_id": <int>}`.
Target may now be **any** `PRE_LOADING` status, not only `draft` — a destination plan can start
customs paperwork before packing is joined. Gates: target has country + customer, no packing, no
pallets; source is `draft`, has ≥1 block, no pallets.

```json
// Response 200: full shipment detail (target)
// Error 400: { "error": "Target shipment has no destination (country and customer required)" }
```

**Unjoin** (new) — `POST /api/v1/export/shipments/{id}/unjoin/`, no body. Detaches the packing of
a destination plan into a **new** `draft` supply-plan row (fresh `shipment_code`, same date so
the weekly-plan actual doesn't move day). Caller must hold the shared JOIN_ROLES gate above.

```json
// Response 200: { ...full shipment detail of the ORIGINAL row..., "new_supply_id": 431, "new_supply_code": "2909002/26" }
// Error 400: { "error": "<code>: has no packing to detach" }
```

**Swap packing** (new, replaces the old field-picking `/swap/`) —
`POST /api/v1/export/shipments/{a_id}/swap-packaging/` body `{"other_id": <int>}`. Either row may
be a free supply plan. `block_sources` are deleted and re-created on the opposite row, one row at
a time — **not** `bulk_create`, because a batch mixing `None`/`Decimal` `weight_kg` trips an
MSSQL/pyodbc type bug (`.claude/rules/mssql-compat.md`).

```json
// Request: { "other_id": 512 }
// Response 200: { "shipments": [ {...detail a...}, {...detail b...} ] }
// Error 400: { "error": "Cannot swap packing of a shipment with itself" }
```

**Notifications**: join still notifies the source's creator. Unjoin/swap notify every active
`loading_dept_head` (plus `document_team` too if either row's documents have started), excluding
the caller — the original creator may be long out of the picture by the time packing is detached
or swapped.

**Removed**: `POST /shipments/{id}/swap/`, `GET /shipments/swappable-fields/`, `swap_config.py`,
`ShipmentSwapSerializer` — the old field-picking swap is gone; `swap-packaging` moves packing
only, with a fixed field set, no `fields: [...]` list in the body.

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

### Sales report approval: `POST /api/v1/export/shipments/{id}/sales-report/approve/` (2026-09-29)

«Hasabaty tassykla» (`docs/Tasks.md` item 37). No body. Roles: `export_manager`, `admin`, `boss`,
`director`, superusers — else 403. No report yet → 400 `There is no sales report to approve yet.`
Deleted/archived → 403. Sets `sales_report.approved_at` / `approved_by` (idempotent — a second call
keeps the first approval) and saves the shipment, so the satyldy approval task resolves and the
shipment auto-advances to `tamamlandy`. Returns the full shipment detail. The nested `sales_report`
now carries read-only `approved_at`, `approved_by` (int) and `approved_by_name`.

**`has_peregruz` is tri-state** since 2026-09-29: `null` = the sales rep has not answered «Peregruz
barmy?» yet (new shipments start `null`; older rows keep `true`/`false`). Task and rule payloads may
carry `completion_rule: "field_set"` (any value, `false` included).

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

### Agent market: `/api/v1/market/` (2026-10-09, part A)

External roles `agent` / `agent_seller` may call **only** `/api/v1/auth/` and `/api/v1/market/`; every other path returns **403** for them (fence in `CookieJWTAuthentication`; the WebSocket closes 4403). Lists are DRF-paginated (`{count, next, previous, results}`). Writes use `POST` / `PATCH` only (no DELETE: rows are deactivated with `is_active`). Field errors come back as 400 `{field: [msgs]}`.

**Agent logins: `GET|POST|PATCH /api/v1/market/agents/`** (resource `market_agent`; staff. A sales_rep sees only the customers he is rep of; admin / boss / director / export_manager / document_team see all)
```json
// GET item / POST + PATCH response
{ "id": 41, "username": "ahmet", "first_name": "Ahmet", "last_name": "", "is_active": true,
  "customer": { "id": 11, "name": "IP Ahmedov" } }

// POST body (password required on create, checked by Django password validators)
{ "customer_id": 11, "username": "ahmet", "password": "...", "first_name": "Ahmet", "last_name": "" }
// PATCH body: any of first_name, last_name, is_active, password.
// customer_id and username are silently ignored on update (a login never moves customer or renames).
// password is write-only and never returned. POST with a customer outside the rep's scope -> 403.
// password: Django validators run with the login's username/name; a leading or trailing space -> 400
// {"password": ["Пароль не может начинаться или заканчиваться пробелом."]} (same rule on /team/sellers/).
// Every /api/v1/market/ response speaks Russian (validators, 401/403/404 included).
```

**Team: `GET|POST|PATCH /api/v1/market/team/bazaars/` and `/team/sellers/`** (resource `market_team`; reads are scoped to the caller's customer, staff read all within their scope; **writes only by an `agent`**, anyone else gets 403 `{"error": "Командой управляет только агент."}`)
```json
// Bazaar (GET / POST / PATCH)
{ "id": 3, "name": "Alay", "city_id": 7, "is_active": true }
// POST body: { "name": "Alay", "city_id": 7 }   city_id optional / nullable; unknown city or a duplicate name for the agent -> 400

// Seller (GET / POST / PATCH response)
{ "id": 52, "username": "seller1", "first_name": "Murat", "last_name": "", "is_active": true,
  "bazaar": { "id": 3, "name": "Alay" } }          // bazaar is null only if unbound
// POST body: { "username", "password", "first_name", "bazaar_id" }; password and bazaar_id are required,
//   bazaar_id must be an ACTIVE bazaar of the agent (else 400 "Unknown bazaar.")
// PATCH body: first_name, last_name, is_active, password, bazaar_id. username is read-only after create;
//   role / is_staff / is_superuser cannot be set. A weak or username-like password -> 400 {"password": [...]}.
// GET /team/sellers/?active=1 lists active sellers only.
```

**Me: `GET /api/v1/market/me/`** (any authenticated user)
```json
{ "role": "agent_seller", "customer": { "id": 11, "name": "IP Ahmedov" }, "bazaar": { "id": 3, "name": "Alay" } }
// customer is null for a user without an AgentMember; bazaar is null for an agent himself
```
`/market/me/` carries no first name; the market app reads `GET /api/v1/auth/me/` for that. Login and logout use `/api/v1/auth/login/` and `/auth/logout/` as everywhere.

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

### Task rules catalog: `GET /api/v1/export/task-rules/`

Backs the **Task Rules** reference page (`/export/task-rules`) — the read-only catalog of
which shipment status opens which task, who owns it, and what closes it.

Gate: `IsAuthenticated` + `CanViewTaskRules`, which reads the **`export.task_rules` page row**
(the same row the nav entry and the route guard read), so hiding the page in the admin matrix
also closes the endpoint. Seeded visible for `admin` / `director` / `export_manager` /
`document_team` / `boss`; every other role has an explicit hidden row an admin can flip.

**Not paginated** — a flat array, like `/transport/geofences/current/`. Ordered by the status
table's `step_order`; a rule whose `step` has no `ShipmentStatusType` row (a retired status)
sorts **last** with `step_order: null` and `step_display` falling back to the raw code. Not
season-scoped: rules are global configuration.

Optional `?is_active=true|false`. **Default returns both** active and inactive rules — a
deactivated rule is exactly what someone asking "why did my task never appear?" needs to see.

`target_fields` is a **list**, never the stored string: the column is a CSV `CharField`
(MSSQL forbids JSONField) and the serializer splits and trims it. Do not re-parse on the
frontend.

```json
[
  {
    "id": 1,
    "step": "draft",
    "step_display": "Draft",
    "step_order": 0,
    "step_phase": "DRAFT",
    "title_key": "tasks.set_destination",
    "assignee_role": "export_manager",
    "assignee_role_display": "Export Manager",
    "target_fields": ["country", "customer", "import_firm"],
    "completion_rule": "all_fields_filled",
    "completion_rule_display": "All target fields filled",
    "target_value": "",
    "deadline_rule": "24h_after_status",
    "condition_field": "",
    "condition_value": "",
    "depends_on": [],
    "gates_step": true,
    "is_active": true
  }
]
```

**2026-09-30 (PREP/DOCS chain, spec `docs/superpowers/specs/2026-09-30-prep-docs-tasks-design.md`):**
`depends_on` is a **list** of `title_key`s (stored as CSV, split like `target_fields`) — the
task is created only after they are done. `gates_step: false` = the task never holds its step
(`tasks.join_supply`). `completion_rule` gains `"confirm"` — a button task that holds the step.
`POST /api/v1/export/tasks/{id}/complete/` accepts `manual_done` **and** `confirm`; for
`confirm` it then creates the tasks now due and runs auto-advance (response unchanged: the task
detail). Document endpoints now also close print tasks on a successful download (no response
change): `GET /contracts/shipments/{id}/cmr/` → `tasks.print_cmr`, `…/tir/` → `tasks.print_tir`,
`…/packet.zip` → CMR + (with an active sale) CT-1, fito, customs letter; `GET /contracts/sales/{id}/document/?type=ct1_ru|fito_ru|customs_tk`
→ the matching print task. `GET /contracts/contracts/{id}/agreement/` stamps
`Contract.agreement_downloaded_at` (first time) and may close `tasks.prepare_contract`. A
closed season records and closes nothing; the file is still served.

**Quality task needs «Upload certificates» first (2026-10-01):** `POST /api/v1/export/tasks/{id}/complete/`
on a `tasks.quality_inspection` task still in state `open` returns 400
`{"error": "Press «Upload certificates» before closing the quality task."}`. The card's
«Upload certificates» button calls `/start/` (→ `in_progress`) and opens
`/shipments/{id}#detail-field-quality.azyk_maglumatnama`; field edits on the card no longer
start this task.

**Truck-change rollback mark (2026-09-30):** `documents_reset_at` (ISO datetime or null) on the
shipment list, detail and sheet items — set when a Planning truck change rolled the shipment back
to draft, cleared when `tasks.docs_to_customs` closes again. Task list items gain
`documents_redo` (bool — a document task that rollback reopened). `GET /transport/trips/` items
gain `shipment_documents_reset_at` (the linked shipment's stamp, null when unlinked).
`GET /contracts/document-packets/` accepts `?shipment=<id>` (one truck's packet — the task card's
print buttons); same shape, one or zero results.

Read-only by design (`ReadOnlyModelViewSet`). Editing a `TaskRule` leaves existing open Tasks
on their snapshotted `target_fields` until `reconcile_tasks` runs, so write verbs need that
reconciliation wired in first.

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
  metrics do. **Excludes** tasks on soft-deleted shipments and on **draft** shipments (a
  draft is parked/supply-only with no destination, so its downstream tasks aren't yet
  actionable overdue work); non-shipment plan tasks are kept.
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

### Plan change requests (ADR-024): `/api/v1/greenhouse/plan-change-requests/`

Once a plan week has started (Monday 00:00 local), a `greenhouse_manager`'s plan edit no longer
writes `plan_value` directly — it becomes a `PlanChangeRequest` that `export_manager`/`admin`/`boss`
approves or rejects. All decimals below are **strings** (plain `models.DecimalField` through a
`ModelSerializer` — see *Numbers* above).

**`PATCH /greenhouse/day-entries/{id}/` returns 202** (same body shape as the normal 200) when a
manager's in-week plan edit was routed to approval instead of written. A withdraw (requested value
equals the currently-approved value) still returns 200 with `pending_change: null`.

**`POST /greenhouse/day-entries/write-cell/` returns 202 on the same rule.** Create-on-write
dispatches to the same `set_plan_value`, so a manager's write into a started week becomes a
PlanChangeRequest even on a cell that did not exist yet: the container row is created, `plan_value`
stays `null`, and `pending_change` carries the request.

A refused in-week edit returns **400 `{"plan_value": "<message>"}`** — keyed by field, unlike the
`{"error": ...}` shape of approve/reject below. Causes: a value outside the allowed range (the
message names it, e.g. `Allowed range: 8,500–11,500 kg.`), clearing the cell (`plan_value: null` →
`The plan cannot be cleared after the week has started.`), or invalid input (non-numeric, negative,
≥ 100,000,000, or a `reason` over 500 characters). A `note` over 500 characters on approve/reject is
a 400 `{"error": ...}` and leaves the request pending.

`HarvestDayEntrySerializer` gains two read-only fields:
```json
{
  "plan_baseline_value": "10000.00",
  "pending_change": {
    "id": 41, "requested_value": "11500.00", "change_pct": "15.00",
    "requested_by_name": "Myrat", "requested_at": "2026-09-22T09:10:00+05:00"
  }
}
```
`pending_change` is `null` when the cell has no pending request.

`GET /greenhouse/plan-change-requests/` — the revision queue/log. Filters: `?status=&year=&week=&block=&season=`.
Reads: any authenticated user. Standard pagination.
```json
{
  "id": 41, "entry": 1203, "block": 5, "block_code": "F", "entry_date": "2026-09-23", "weekday": 1,
  "baseline_value": "10000.00", "current_value": "10000.00", "requested_value": "11500.00",
  "change_pct": "15.00", "status": "pending", "reason": "",
  "requested_by": 17, "requested_by_name": "Myrat", "requested_at": "2026-09-22T09:10:00+05:00",
  "decided_by": null, "decided_by_name": null, "decided_at": null, "decision_note": ""
}
```

`POST /greenhouse/plan-change-requests/{id}/approve/` and `.../reject/` — body `{"note": "..."}`
(optional). 200 → the updated item (same shape as above).
```json
// Error 403 (role other than export_manager/admin/boss/superuser)
{ "error": "Role 'greenhouse_manager' cannot decide plan changes." }
// Error 400 (already decided)
{ "error": "Request is no longer pending." }
// Error 409 (closed season, via SeasonNotClosed)
{ "error": "season_closed", "season": "2025/2026", "closed_at": "2026-08-03T10:00:00Z" }
```

Notification kinds `plan_change_requested` / `plan_change_approved` / `plan_change_rejected` are
sent by the service and registered in `Notification.KIND_CHOICES` (Task 5 / migration `export.0072`).
### Tır Takip Hasabat: `GET /api/v1/export/tir-hasabat/`

Backs the **📊 Hasabat** tab on `/tir-takip` (`HasabatTab.tsx`, `useTirHasabat`). Read-only,
60 s cache keyed on the season. **Gated server-side on two page codes** — `tir_takip.hasabat`
and `analytics.clients` (`CanViewTirHasabat`; superuser bypass); either missing → 403.
Season-scoped by the `Shipment.season` FK (`?season=`, same rules as below). Counts the season's
shipments **minus** `draft`, `cancelled`, soft-deleted and archived.

```json
{
  "season": { "id": 13, "name": "2026/2027" },
  "kpis": { "total_trucks": 3, "total_kg": 38000.0, "avg_kg": 12667.0, "open_trucks": 2, "arrived_trucks": 1 },
  "by_month": [ { "month": "2026-01", "trucks": 1, "kg": 18000.0 } ],
  "by_country":  { "rows": [ { "name": "Russia", "trucks": 1, "kg": 20000.0 }, { "name": null, "trucks": 1, "kg": 0.0 } ], "total_kg": 38000.0 },
  "by_customer": { "rows": [], "total_kg": 0.0 },
  "by_variety":  { "rows": [], "total_kg": 0.0 },
  "by_firm":     { "rows": [ { "name": "X", "trucks": 2, "kg": 30000.0 } ], "total_kg": 30000.0 },
  "by_block":    { "rows": [ { "name": "A", "trucks": 2, "kg": 12000.0 } ], "total_kg": 12000.0 }
}
```

- **Every number is a JSON number** (cast with `float()` in the service), not a decimal string.
- `name: null` = trucks with no value in that dimension; the frontend labels it "Näbelli".
- Rows are sorted by `kg` descending. `trucks` is a distinct shipment count per group.
- kg sources differ per grouping: `weight_net` for kpis/month/country/customer/variety,
  `ShipmentFirmSplit.weight_kg` for `by_firm`, `ShipmentBlockSource.weight_kg` for `by_block`.
  So `by_firm.total_kg` / `by_block.total_kg` do **not** equal `kpis.total_kg` — take shares
  against the grouping's own `total_kg`.
- `open_trucks` = `status.step_order < 9`, `arrived_trucks` = `>= 9` (`bardy` and later).
- Month = `TruncMonth(Shipment.date)`, `'YYYY-MM'`, oldest first.
- No active season → `season: null` with the same shape, all zeros / empty.

### Gaplama board: `GET /api/v1/export/gaplama/board/?from_date=&to_date=[&season=]`

Backs the **Gaplama** tab on `/tir-takip` and its standalone twin at `/export/gaplama`
(`GaplamaTab.tsx`, both entry points render the same component; `useGaplamaBoard`). The
Weekly Plan minus kg already loaded onto opened trucks, plus a carried-over remainder from
earlier days — see `backend/apps/export/services/gaplama.py::build_gaplama_board` for the
FIFO carry-over rule. `from_date`/`to_date` are required `YYYY-MM-DD`; the window may not
exceed 31 days (`400` otherwise). **Gated server-side on two page codes** —
`tir_takip.gaplama` and `export.plan` (`CanViewTirGaplama`; superuser bypass); either
missing → 403. Season-scoped the same way as every list endpoint (`?season=`, default
active; `404` unknown id; `403` closed without `closed_season.can_view`); no active season
at all → `{"days": [], "trucks": []}`.

```json
{
  "days": [
    {
      "date": "2026-09-23", "block_id": 4, "block_code": "B", "location": "Dusak",
      "plan_kg": "5000.00", "loaded_kg": "2000.00", "carried_in_kg": "500.00",
      "available_kg": "3500.00", "over_kg": "0.00"
    }
  ],
  "trucks": [
    {
      "id": 812, "shipment_code": "23SP812/26", "export_code": null, "date": "2026-09-23",
      "status": 1, "status_code": "draft", "status_display": "Draft",
      "country": null, "customer": null,
      "block_sources": [ { "block_id": 4, "block_code": "B", "weight_kg": "2000.00" } ]
    }
  ]
}
```

- **Every `*_kg` field is a decimal string** (`str(Decimal)` at the view boundary, per the
  convention below) — coerce on the frontend at the fetch boundary, same as every other
  Decimal field. `useGaplamaBoard` does this in its `queryFn`, not at the render site.
- `days[]` covers every **active top-level** block — sub-block and inactive-block kg is
  folded into the parent's `loaded_kg`/`block_sources`, never reported under its own id.
  A block-day with zero plan and zero loaded still gets a row (e.g. a carry-in bucket
  expiring with nothing new planned).
- `available_kg = max(0, carried_in_kg + plan_kg - loaded_kg)` — never negative. An
  overshoot is reported separately as `over_kg`, never as a negative `available_kg`.
- `trucks[]` is every shipment in `[from_date, to_date]` (not walked back like `days[]`)
  with at least one non-null `block_sources` row, cancelled excluded. `country`/`customer`
  are `null` while the truck is still a bare supply row (not yet joined on the Sheet) —
  that is also the Üýtget edit-eligibility check on the frontend (`status_code == 'draft'`
  and both null).
- `status_display` is `status__name_en` — **always English**, not locale-aware. Use
  `status_code` to key your own translated label if the UI needs one; `GaplamaTab.tsx`
  currently renders `status_display` as-is in the truck list.
- The requested `[from_date, to_date]` is clamped to the resolved season's own date range
  before the query runs (`clamped_from`/`clamped_to`) — a default window is not a bound.

### Current geofence per truck: `GET /api/v1/transport/geofences/current/`

Which Traccar geofence each truck is in right now, grouped by geofence. Gate: `IsAuthenticated` +
`CanViewFleetMap` (the `transport.map` page row — same as `live-positions/`, so the seller gets 403).
Not paginated, not season-scoped, reads our DB only (the 120 s `poll_traccar` beat task keeps it fresh).
Rows = `DevicePosition` with `valid=True`. Order: most trucks first, then geofence name; trucks outside
every geofence come **last** in a group with `geofence_id: null`, `geofence_name: null`.

```json
[
  {
    "geofence_id": 3,
    "geofence_name": "Garaž",
    "truck_count": 55,
    "trucks": [
      { "device_id": 12, "plate": "4178AHF", "fleet_no": "TR069",
        "since": "2026-09-17T19:40:00+05:00", "fix_time": "2026-09-18T15:58:00+05:00",
        "is_online": true, "is_stale": false }
    ]
  }
]
```

- `geofence_id` is Traccar's geofence id (`TraccarGeofence.traccar_id`), like `device_id` is Traccar's device id.
- `since` (DB `geofence_since`) = the first poll that saw the truck in this geofence, **not** Traccar's
  enter event — understated right after deploy. `null` in the no-geofence group.
- Offline trucks keep their last geofence; use `is_stale` (`now − fix_time > TRACCAR_STALE_MINUTES`)
  before treating a truck as "there now".

### Current geofence on the single-truck payloads (2026-09-19)

`LivePositionSerializer` — which backs `GET /transport/live-positions/` (the Fleet Map) **and**
the `position` object inside `GET /transport/shipments/{id}/position/` (Shipment Detail / the
Sheet's R15 map modal) — also carries the truck's current geofence, so an operator doesn't need
the grouped endpoint above to see one truck's own zone:

```jsonc
{
  "device_id": 42, "plate": "12 AB 3456", "fleet_no": "TR07", "status": "online",
  "lat": 37.95, "lon": 58.39, "speed": 62.5, "course": 184.0, "address": "…",
  "fix_time": "2026-07-30T09:14:00Z", "updated_at": "2026-07-30T09:14:31Z",
  "is_online": true, "is_stale": false,
  "geofence_name": "Garaž",                  // current_geofence.name, null outside every geofence
  "geofence_since": "2026-09-18T19:40:00Z"   // first poll that saw it there, null with geofence_name
}
```

Same caveats as `since` above (understated right after deploy, offline trucks keep their last
geofence). Frontend: `ILivePosition`/`ITruckPosition` both carry the two fields;
`ShipmentTruckLocationBlock.tsx` (shared by the Detail card and the Sheet modal) and
`FleetMap.tsx` render `geofence_name` as a purple Tag when present.

### Truck's current shipment on the Fleet Map (2026-10-01)

`GET /transport/live-positions/` only (`FleetLivePositionSerializer`; the shipment position
endpoint keeps the plain shape) — each row adds `shipment`, the load that truck is on now:

```jsonc
"shipment": {
  "id": 812, "code": "3009001/26",            // code = DB shipment_code
  "export_code": "30|09|001|A|26|01",         // null until typed
  "status_code": "yola_chykdy",
  "country_code": "KZ", "country_name": "Kazakhstan",   // country.name_en, both null on a plan
  "import_firm_name": "Buyer",                 // name_short, else name_company
  "export_firms_display": "Ak Bulut, Gök"      // firm splits, comma-joined, null if none
}
```

`null` when the truck has none. Picked from shipments dated in the last 30 days, not
complete or cancelled; a loaded one beats a `draft` plan, else newest `date` wins. Names
match `ShipmentListSerializer`. Frontend: `ILiveShipment` in `useLivePositions.ts`.

### Truck Board trips: `/api/v1/transport/external-trips/` (2026-10-07)

Trips mirrored from Planning. Not paginated (flat array). Read needs the `export.truck_board` page
grant; every POST needs `shipment_assign` edit (`CanAssignTrips`).

`GET /external-trips/` — optional `?free=1` (unlinked, not closed), `?linked=1` (linked to a
shipment), `?country=<code>`, `?date=<planned_departure>`. Also `GET /{id}/`, `GET /{id}/document/`
(PDF), `GET /sync-state/`.

Item fields added by the write-ops branch:

```jsonc
"rejection_reason": "Нет визы KZ",   // null when not rejected
"rejected_at": "2026-10-07T09:12:00Z",
"rejected_by_name": "Aman Aman"      // full name, else username; null when not rejected
```

Link actions, all `POST /external-trips/{id}/<action>/` returning the updated trip item; a refusal is
`{"error": "<code>"}`:

| Action | Body | Refusals |
|--------|------|----------|
| `assign` | `{shipment_id, confirm_unknown_country?}` | 400 `shipment_id_required`, 404 `shipment_not_found`, 409 `gapy` `not_draft` `has_trip` `trip_closed` `trip_taken` `trip_rejected` `country_unknown` `country_mismatch` `season_closed` |
| `move` | same | same as `assign`, plus 409 `locked` |
| `unassign` | none | 409 `locked`, `season_closed` |
| `accept-change` | none | 409 `season_closed` |
| `reject` | `{reason}` | 400 `reason_required` (empty, blank or not a string), 400 `reason_too_long` (> 512), 409 `trip_closed`, `trip_linked`, `trip_rejected` |

`reject` marks a free, open trip rejected and sends `reason` to Planning once. A rejected trip can be
rejected again only while its last push failed (`last_push_error` starts with `rejection:`), else 409
`trip_rejected`. `assign` / `move` onto a rejected trip are 409 `trip_rejected`.

### Planning tasks: review, transport plan, acknowledge (2026-09-29)

Backs the «Tanyşdym» planning tasks (`docs/Tasks.md` items 2b and 3). Spec:
`docs/superpowers/specs/2026-09-29-planning-tasks-design.md`. **Not season-scoped**
— keyed by ISO `year` + `week`. Every count is a **JSON int** (no decimal strings).

`GET /api/v1/export/truck-allocations/review/?year=&week=` — the `/export/plan`
banner. Gate: `truck_allocation.can_view` (the viewset's `DynamicResourcePermission`).
`changes` lists the Mon–Sat days (`day_of_week` 1=Mon…6=Sat) whose needed-truck
count (half-up at 18,500 kg) differs from the allocation baseline; `open_task_id`
is the open `alloc_review` task, or null.

```json
{ "year": 2026, "week": 40, "open_task_id": 12,
  "changes": [ { "day_of_week": 1, "was": 1, "now": 2 } ],
  "snapshot": "1:2", "can_acknowledge": true }
```

Both GETs carry `snapshot` (the counts the page shows, ASCII `k:v;…`; `";"` = a
recorded empty plan) and `can_acknowledge` (true for the task's assignee role
family — `export_manager` here, `transport` on the transport plan — plus admin /
boss / director and superusers).

`GET /api/v1/export/truck-allocations/transport-plan/?year=&week=` — the
`/transport/plan` page. Same gate (transport holds `truck_allocation` view-only).
`days` always has 6 entries (Mon–Sat). `cells` covers every (day, destination) that
is non-zero now **or** in transport's last acknowledged snapshot;
`acknowledged_count` and `acknowledged_at` are `null` when transport never
acknowledged this week. `acknowledged_at` carries the local offset.

```json
{
  "year": 2026, "week": 40,
  "days": [ { "day_of_week": 1, "date": "2026-09-28" } ],
  "destinations": [ { "id": 3, "name": "Russia" } ],
  "cells": [ { "day_of_week": 1, "destination_id": 3, "truck_count": 2, "acknowledged_count": 1 } ],
  "open_task_id": 51,
  "acknowledged_at": "2026-09-26T16:05:00+05:00",
  "snapshot": "1:3:2",
  "can_acknowledge": true
}
```

Both: a missing or invalid ISO `year`/`week` → `400 {"error": "year and week must be a valid ISO year and week."}`.

`POST /api/v1/export/tasks/{id}/acknowledge/` — «Tanyşdym». Body
`{"snapshot": "<snapshot from the GET the page rendered>"}` (missing → 400).
`alloc_review` / `transport_plan` tasks only (other kinds → 400 `Only review tasks
can be acknowledged.`); cancelled → 400. **Only the assignee role family,
admin / boss / director, or a superuser** (owner, 2026-09-29) — `export_manager`
gets 403 on transport's task, unlike `/complete/`, because he makes the allocation
changes and acknowledging for transport would hide them from transport.
If the data changed since the page loaded → **409** `{"error": "stale", "detail":
…}` and nothing changes (the frontend refetches). Stores what was seen in
`Task.ack_snapshot` and returns the task detail. **Idempotent** on a done task (200,
nothing changes).
`/complete/` refuses these two kinds with 400 `Use /acknowledge/ for review tasks.`

Task list/detail payloads gained `scope_date` (`"YYYY-MM-DD"` for `daily_loading` /
`daily_export`, else null) and `cancelled_reason` (`"missed"` = a daily task nobody
did; `""` when not cancelled).

**2026-10-02:** task list/detail payloads also carry `export_code` — the shipment's official
export code (DB `official_export_code`), `null` until typed and on tasks with no shipment.
`SelfKanbanCard` shows it under `shipment_code` when non-blank.

### Daily plan progress (2026-10-01)

`GET /api/v1/export/truck-allocations/daily-progress/?date=YYYY-MM-DD[&season=]` — plan vs fact
for Mon–Sat of `date`'s ISO week. Spec: `docs/superpowers/specs/2026-10-01-daily-plan-progress-tasks-design.md`.
Gate: `truck_allocation.can_view`. No `date` → the **server's** local today. Malformed →
`400 {"error": "date must be YYYY-MM-DD."}`. **Season-scoped** (unlike `review` / `transport-plan`,
because it counts shipments): `?season=` per `resolve_season`, `days: []` during the gap. Every count
is a JSON int.

```json
{ "date": "2026-10-01",
  "days": [ { "date": "2026-09-28", "day_of_week": 1,
    "rows": [ { "key": "country:3", "label": "Moskwa + Piter", "country_id": 3, "is_gapy": false, "plan": 4, "fact": 3 },
              { "key": "gapy", "label": "Gapy Satys", "country_id": null, "is_gapy": true, "plan": 1, "fact": 1 } ],
    "plan_total": 5, "export_parts": 4, "export_parts_packed": 3, "packed": 3, "loading_target": 5 } ] }
```

- Rows: the day's splits grouped by country (labels joined with « + »); destinations with no country
  form the `gapy` row, matched by `is_gapy_satys`. A country exported but not planned → `plan: 0`,
  label = `Country.name_en`.
- `fact` = live shipments dated that day with country + customer (gapy row: `is_gapy_satys=true`;
  country rows: `false`). `packed` = live rows with `block_sources`, free or joined.
  `loading_target` = `max(plan_total, export_parts)`.

`/me/tasks/` items gain `progress` — the same day object for an **open** `daily_export` /
`daily_loading` task, `null` otherwise. `POST /export/shipments/` (draft path) accepts
`is_gapy_satys` (bool, default `false`).

### Gate: `/api/v1/export/gate/` (2026-09-29)

The gate guard's screen (garawul). Spec:
`docs/superpowers/specs/2026-09-29-garawul-gate-design.md`. Own `ViewSet`, not
`ShipmentViewSet`. **Not season-scoped**, unlike every list above. A `garawul`
user always works his own `User.loading_location`; any `?location=` he sends
is ignored. Every other role holding the `gate` grant (`admin`, `boss`) must
send `?location=<id>` — on **all four calls, GET and the three POSTs alike**
(missing → `400 {"error": "location_required"}`; unknown id → `400
{"error": "bad_location"}`).

`GET /gate/[?location=]` → `{location: {id, name}, expected: IGateRow[],
inside: IGateRow[], recently_left: IGateRow[]}`. Gate: `gate.can_view`.

```json
{
  "location": { "id": 1, "name": "Dusak" },
  "expected": [ { "id": 42, "shipment_code": "S-042", "truck_plate": "AB1234",
    "truck_plate_2": null, "driver_name": "Merdan", "driver_phone": "+99361...",
    "date": "2026-09-29", "is_gapy_satys": false, "status_code": "gumruk_chykysh",
    "greenhouse_arrived_at": null, "departed_at": null, "can_undo": false } ],
  "inside": [ "...same shape, can_undo=true means «undo arrival»" ],
  "recently_left": [ "...same shape, greyed on the Ýyladyşhanada tab, can_undo=true means «undo exit»" ]
}
```

`IGateRow` never carries customer, firm, price or weight — the guard's payload
is deliberately narrow. `can_undo` is server-computed per row using the exact
rule the POST would enforce, so the frontend never has to reimplement it.

**Timestamp fields are local `+05:00`, same as the rest of the contract**
(final-fix review F6, 2026-09-29). `greenhouse_arrived_at` / `departed_at` now
go through `timezone.localtime(value).isoformat()` in `gate_row()`'s `_iso()`
helper — previously plain `datetime.isoformat()` on the raw UTC-aware value
printed `+00:00`, the one place in this contract that disagreed with `##
Timestamps` below. Same instant either way; only the printed offset changed.

`POST /gate/{id}/arrive/`, `POST /gate/{id}/depart/` — no body. `POST
/gate/{id}/undo/` — body `{"event": "arrive" | "depart"}`. All three gate on
`gate.can_edit` (marking an existing truck is an edit, not a create) and
return the updated `IGateRow` on success. A successful write also pokes the
Sheet for that shipment id, like every other shipment-writing endpoint
(`GateViewSet.finalize_response`, final-fix review F1) — `GET /gate/` never
does.

**Arrival with packing not yet joined** (final-fix review F5). If
`needs_packing_for_loading(shipment)` is true (pre-loading status, no
`block_sources`), `/arrive/` still stamps `greenhouse_arrived_at` (+
`loading_location` if null) and sends the `gate_arrival` notification, but
leaves `loading_started_at` null — there is nothing to load yet, and filling
it would auto-advance a truck with no packing.

`/gate/{id}/undo/`'s response row now reports `can_undo` for the mark that is
still live afterward, not always `false` (final-fix review F7): undoing a
`depart` leaves the truck inside again, so the row's `can_undo` reflects
whether its *arrival* is still undoable; undoing an `arrive` returns the truck
to Gelmeli, where nothing is undoable, so `can_undo` is `false`.

**Gate tasks never make a shipment "owned" by garawul** (final-fix review
F3). `owner_role` on a Shipment Board item, and the board's `?owner_role=`
filter, both read the shipment's most-recently-created task — but they now
skip `kind='gate'` tasks. Without that, a lazily-created gate task (opened the
moment a truck is due) would outrank the real rule task and make every plated
truck look owned by the guard.

**Error codes** — body is always `{"error": "<code>"}`, never a human-readable
message (frontend renders `gate.error.<code>`, fallback `gate.error.generic`):

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `no_location` | guard's `User.loading_location` is null |
| 400 | `location_required` | non-guard sent no `?location=` |
| 400 | `bad_location` | `?location=` isn't a real `LoadingLocation` id |
| 400 | `bad_event` | `undo` body's `event` isn't `arrive`/`depart` |
| 404 | `not_found` | no such shipment id |
| 409 | `not_expected` | `/arrive/` on a truck not currently in `expected(L)` |
| 409 | `not_inside` | `/depart/` on a truck not currently in `inside(L)` |
| 409 | `not_here` | `/undo/` on a truck not live at `L` at all |
| 409 | `undo_closed` | past the 10-minute window, or the status already moved |
| 409 | `season_closed` | the shipment's season is closed (write freeze) |

403 comes from the permission classes directly (`gate.can_view` / `can_edit`),
not from this table.

## Season scoping (AD-16)

Every season-bearing list endpoint (shipments, Sheet, Kanban board, harvest plans, day
entries, plan-change-requests (anchor `entry__season`, ADR-024), truck allocations/destinations,
local-sell plans, contracts, contract-sales, comments, tasks, quota-usage, quota-issuances,
quota-firm-balances, advances, customs-expenses, document-packets, clients-report) accepts an
optional `?season=<id>`:
entries, truck allocations/destinations, local-sell plans, contracts, contract-sales,
comments, tasks, quota-usage, quota-issuances, quota-firm-balances, advances,
customs-expenses, document-packets, clients-report, tir-hasabat, gaplama-board) accepts an optional `?season=<id>`:

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

`GET /export/harvest-forecast/remaining/?date=` is season-scoped too (**fixed 2026-08-07**,
the seventh instance of the "builds its own queryset" shape). It filtered `HarvestDayEntry` on
`entry_date` alone; `HarvestDayEntry.season` is non-null and seasons never overlap, so a date
inside a closed season *was* a closed-season read available to any authenticated user with no
`?season=` to gate on — the same hole `block-summary` had. It now takes the resolved season
(`?season=` optional, default active; `404` unknown id; `403` closed without permission; `[]`
during the gap). The two **write** validators that share `get_remaining_for_date()` —
draft-create `validate()` and `assert_draw_within_pool()` — deliberately keep passing
`season=None`: they check a draw against the shipment's own date on a path the write freeze
already restricts to an open season, and scoping them would change what a create is validated
against rather than gate a read. The frontend sends no `?season=` here on purpose (the draft
composer always draws on the write target's pool).

**`is_active` on `/admin/seasons/` is writable, but the viewset routes it through the lifecycle
services — it is never written as a plain column** (restored 2026-08-10; read-only between
2026-08-07 and then). `POST` and `PATCH` accept `name`, `start_date`, `end_date`, `is_active`.
`SeasonViewSet.perform_create()` always INSERTs the row inactive and then calls `open_season()`
when `is_active: true` was sent; `perform_update()` pops the flag out of `validated_data` and
routes `false -> true` to `open_season()` and `true -> false` to `deactivate_season()`. So a
body carrying `is_active` gets exactly what `POST .../open/` gives: an atomic incumbent swap
and an `AuditLog` row. `true -> false` stands the season down **without** closing it —
`closed_at` stays NULL, `status` returns to `UPCOMING`, and the platform is left with no active
season (the legitimate gap D7 fails closed on). `PATCH {"is_active": true}` on a **CLOSED**
season is a `400` keyed on `is_active` (`SeasonSerializer.validate_is_active()`, reusing
`Season.assert_activation_allowed()`); reopening stays unsupported.

Two things must not be undone or the field breaks again. (1) `is_active` is **declared
explicitly** on `SeasonSerializer` (`serializers.BooleanField(required=False)`). Left to
`ModelSerializer`, DRF 3.17 attaches a field-level `UniqueValidator` derived from the
`uq_season_single_active` filtered constraint, whose queryset is already
`Season.objects.filter(is_active=True)` — that 400s every `is_active=true` write made while any
other season holds the flag, which is the normal case. (It is a field-level `UniqueValidator`,
**not** a serializer-level `UniqueTogetherValidator`; `Meta.validators = []` does not remove
it.) (2) The frontend hooks that hit these two verbs must invalidate the **whole** query cache,
like `useOpenSeason`/`useCloseSeason` — a targeted `['admin-seasons']` invalidate leaves
`/auth/me/` and every season-scoped list serving the previous season.

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
- Because of that derivation, **`POST`/`PATCH` on `/quota-usage/` 400 when the resulting row would
  belong to no season** — an unlinked row dated outside every season is invisible everywhere and
  counted in no ledger. `services_quota.season_of_usage(shipment, usage_date)` is the row-level
  inverse of `usage_season_q()`; the two must stay in step, or a write can be accepted into a
  season whose list then refuses to show it. A *linked* row is always accepted, whatever its date —
  its shipment anchors it.
- **A `/quota-usage/` row whose season is CLOSED returns `409 season_closed`, not 400** — that is
  a write against frozen data, not a bad field, and the two are distinct failures on the same POST
  (**fixed 2026-08-08**). This applies to `POST`, `PATCH`, `DELETE` **and** `POST /quota-usage/approve/`,
  including the 575 rows with **no shipment**: their anchor is `usage_date`, resolved by
  `QuotaUsageRecord.freeze_season`. (`POST /quota-usage/approve/` was in this list until
  **2026-08-10**, when the approval step was removed — see below.) Until that hook existed `freeze_season_of()` returned `None`
  for every unlinked row, so both freeze layers were no-ops and those four verbs returned
  201/200/204/200 against a closed season. If you add a bulk action on this resource, guard it with
  `services_quota.assert_usage_batch_seasons_open(qs)` — **not** the generic
  `assert_bulk_seasons_open(qs, 'shipment__season')`, which resolves through a NULL FK and matches
  no season for exactly those rows.
- `quota-firm-balances` follows the **resolved** season, not the active one, and returns `{}`
  during the gap. Its cache key and the FIFO cache key both carry the season id.
- **`quota-firm-balances` counts LIVE quota only** (2026-08-23). `issued_kg` / `used_kg` /
  `remaining_kg` all exclude allocations past their `validity` window (`quota_expiry_date()`,
  lapse test `expiry < today`, so the expiry date itself still counts). Until this change the
  response summed the whole season, so the sheet offered ~20 firms as having quota when one
  held a live allocation. `remaining_kg <= 0` (or an absent firm) is a **hard block** on every path that puts a firm on a
  truck: `SheetCellEditor`, `ExportFirmSelect` with `checkQuota` (the destination-draft modal),
  `POST /shipments/{id}/firm-splits/`, and `POST /shipments/` with `is_draft: true` +
  `firm_splits` (added 2026-08-23 — same 400 body, and the shipment header rolls back with it).
  Only the firm-splits endpoint exempts firms already on the split; on a new draft every firm is
  newly added. `POST /shipments/{id}/join/` is **not** gated — it merges existing splits.
- **`PATCH /contracts/sales/{id}/` changing `quantity_kg` rewrites the firm's
  `ShipmentFirmSplit.weight_kg` and re-runs quota usage** (added 2026-08-11). The two are the
  same number by design — the firm's official export weight (AD-016) — but only the
  PackingTemplate path kept them in step, so an edited invoice and the quota ledger silently
  disagreed. Other firms on the truck keep their weights; a firm with no split is skipped, not
  added. `export` may not import `contracts`, so the sync necessarily lives on the contracts
  side (`sync_split_weight_from_sale` in `contracts/views.py`); do not add a reverse read.
- **There is no quota-usage approval step** (removed 2026-08-10). `POST /quota-usage/approve/`
  is **gone** (405). Rows are created `status='approved'` by both `perform_create` and
  `quota_sync.sync_draft_quota_usage_for_shipment`, and count in FIFO / firm balances / the
  dashboard immediately. `status` is read-only on the serializer and server-set — a client
  sending `"draft"` gets `"approved"` back. `approved_by` / `approved_at` stay **NULL**:
  `'approved'` means "counted", not "signed". `PATCH` / `DELETE` no longer return
  `400 Only draft records can be edited/deleted` — permissions and the season write freeze are
  the only refusals left. `sync_draft_quota_usage_for_shipment` no longer raises
  `ApprovedQuotaExistsError`; it replaces every row on the shipment, so
  `POST /shipments/{id}/firm-splits/` no longer 400s with "approved quota usage records exist".
- **`GET /quota-usage/?shipment=<id>` relaxes the season scope for callers who may view closed
  seasons** (added 2026-08-10), backing the quota card on ShipmentDetail. Same param, same meaning
  and the same implementation as `/customs-expenses/?shipment=`: Rule A says detail pages resolve
  for any season, so a prior-season shipment opened by direct link must show its own quota rather
  than an empty card. **The relaxation is gated on `can_view_closed()`** — a role holding
  `quota_usage` but not `closed_season` stays scoped even with `?shipment=`, or the param would
  route around the 403 that `?season=<closed>` returns. `resolve_season()` still runs
  unconditionally, so the gap fails closed and a bad/closed `?season=` still 404s/403s, and the
  unfiltered list is still `usage_season_q()`-scoped.
- On `GET /quota-issuances/`, the `used_kg` in each allocation comes from the **list's resolved
  season**; on `GET /quota-issuances/{id}/` it comes from **that row's own `season`**. Detail routes
  bypass season scoping (Rule A), so keying the ledger off the request's season there reported
  `used_kg: 0.00` for any issuance outside the active season.
- `GET /quota-dashboard/` goes through `resolve_season()` like every other read path
  (**fixed 2026-08-07** — it used to read `?season=` directly, so `closed_season.can_view` was
  never enforced and a role holding `quota_issuance` but not `closed_season` could read a
  closed season's aggregates it was 403'd from on `/quota-issuances/`). Contract now:
  `?season=` is **optional** and defaults to the active season (it used to be required, and
  omitting it 400'd — this endpoint was the only scoped read where that was true); an unknown
  id returns **404** (was 400); a closed season without `closed_season.can_view` returns
  **403**; and during the close→open gap it returns the empty payload with its shape intact
  (`kpis` all zero, `per_firm` / `weekly_flow` `[]`), per D7, so the page renders its normal
  empty states. Season resolution happens **before** the 60s cache read, and the cache key
  carries `season.pk` rather than the raw parameter.
- **`?date_from=`/`?date_to=` are CLAMPED to the resolved season, not merely defaulted to it**
  (`max(from, season.start_date)` / `min(to, season.end_date)`). A default alone left the gate
  bypassable: `build_quota_dashboard()` aggregates on dates alone, so sending the closed
  season's own range with **no** `?season=` passed the check on the active season and returned
  the closed season's numbers anyway. A window wholly outside the season inverts and every
  aggregate reads it as empty — fail closed. **If you add another date-windowed endpoint, clamp
  it; a default window is not a bound.**
- **Still date-driven, deliberately:** `build_quota_dashboard()` itself takes only
  `(date_from, date_to, product_type, today=None)`. The resolved season supplies the clamped
  window and the permission gate; it is **not** pushed into the aggregates as a `season`
  predicate. Re-scoping those aggregates would change published numbers, not just visibility,
  and needs its own ruling (§4.7's own standard). The clamp is what makes deferring that safe.
  (`today` only pins expiry for tests; it defaults to `timezone.localdate()`.)
- **Every figure in `per_firm` must come through that one window** (2026-08-23). `per_firm[]`
  rows and `kpis` now carry **`expired_kg`** — quota whose validity lapsed before today, summed
  from the same date-windowed issuance list `weekly_flow` uses. It was previously computed in
  the browser from a separate `/quota-issuances/` fetch scoped to the **global** season
  switcher, while the rest of the row followed the quota page's own season dropdown; moving one
  selector and not the other made half of each row describe a different season. If you add
  another column here, aggregate it server-side off `date_from`/`date_to` — a second client-side
  data source re-opens this. `expired_kg` is the **unused remainder** of a lapsed allocation
  (`kg_quota` minus what FIFO consumed from it), not the whole allocation — it shipped as the whole
  allocation on 2026-08-23 and was corrected the same day, so a figure read before that correction
  is larger for the same data.

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

## Uploaded files arrive as a **root-relative** url, never absolute

Every media field — `ExportFirm.director_signature` / `director_seal` /
`director_stamp`, `ImportFirm.director_signature` / `director_seal` /
`director_stamp`, `FeedbackAttachment.file` — serialises through
`apps.core.serializer_fields.RelativeFileField` and returns a path, not a url:

```json
{ "director_seal": "/media/import_firms/seals/shah.png" }
```

`director_stamp` (2026-09-10) is one photo showing a firm's seal and signature
together. It is a **third variant of the pair, not an addition**: when it is set,
document generation uses it and ignores the other two, and the firm-completeness
rule stops requiring them. Uploads for all three are a multipart `PATCH` with the
file under its own field name; `null` clears one.

Never `http://host/media/...`. **Do not use DRF's stock `serializers.FileField`
for anything the frontend renders**: it returns `request.build_absolute_uri(...)`,
built from the `Host` header Django received, and neither proxy in front of this
app sets that to the browser's origin — prod nginx forwards `Host $host` (which
drops the `:8080` port) and the Vite dev proxy uses `changeOrigin: true` (which
rewrites it to the proxy target). Both produced urls that 404 in the browser
while the upload itself reported success. Frontend drops the value straight into
`<img src>` / `href` — same-origin, no base-url joining.

Empty/absent file → `null`, not `""` (the pages gate the `<img>` on truthiness).
Uploads are unaffected: only `to_representation` is overridden, so a multipart
`PATCH` with the file under its own field name still works. Pinned by
`apps/core/tests_media_urls.py`.

## Numbers: `Decimal` arrives as a **string**, unless it came from a method field

`COERCE_DECIMAL_TO_STRING` is at its DRF default (`True`) — deliberately, because flipping it in
`settings.REST_FRAMEWORK` re-types every money and weight field in the platform at once. The
consequence is an asymmetry that has now bitten twice:

| Backend field | JSON | Example |
|---|---|---|
| `models.DecimalField` through a `ModelSerializer` | **string** | `"100000.00"` |
| `serializers.DecimalField(...)` declared explicitly | **string** | `"100000.00"` |
| `SerializerMethodField` returning a `Decimal` | **number** | `100000.0` |
| Annotated `Sum(...)` surfaced by a method field | **number** | `100000.0` |

The last two go through `rest_framework.utils.encoders.JSONEncoder`, which floats a `Decimal`. So two
fields of the same model, on the same row, can arrive as different JSON types — `QuotaIssuanceFirmAllocation`
ships `kg_quota` as a string (model field) and `used_kg` as a number (method field).

**TypeScript declares these as `number`, and that is the intended contract.** Do not re-type them as
`string`; make the declaration true instead:

> **Coerce in the hook's `queryFn`, at the fetch boundary — never at the usage site.**
> ```ts
> const rows = Array.isArray(data) ? data : data.results;
> return rows.map((r) => ({ ...r, weight_kg: Number(r.weight_kg) || 0 }));
> ```

A usage-site patch fixes one screen and leaves the next `reduce()` broken; the boundary fixes every
consumer of the hook at once. Existing boundaries doing this: `useQuotaIssuances`
(`kg_quota`, `used_kg`) and `useDomesticSales` (`weight_kg`, `price_per_kg`). Pre-existing usage-site
patches that prove the trap recurs: `ShipmentQuotaCard.tsx` (`Number(r.kg_used)`) and
`SalesReportPage`'s `toSavedRow` (`Number(ex.amount_local)`).

**The failure signature** — a string decimal survives arithmetic silently and only shows up in the UI:

- `+` concatenates instead of adding: `0 + "100000.00" + "250000.00"` → `"0100000.00250000.00"`, so a
  Total row renders a wall of digits. (`-`, `*`, `/` and `<` coerce, so **sorters and ratios keep
  working** — only the sums break, which is why this hides.)
- `fmtWeight()` passes it through untouched: `String.prototype.toLocaleString` ignores its arguments.
- In **ton** mode the same cell renders `не число` / `NaN`, because `Number(garbage)` is `NaN`.
- TypeScript cannot catch any of it: the type already said `number`, and the lie is on the wire.

When you add a serializer field, state its JSON type in the endpoint's contract section below if it is
a `Decimal` — the frontend cannot tell a string decimal from a number one until it renders wrong.

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

### Categories (`category` field)

`category` is a code from `GET /api/v1/export/customs-expense-categories/` (rows of
`core.ShipmentOptionType` with `category='customs_expense'`). An unknown code → `400 {"category": [...]}`.
`category_display` = the category's `label_en`, else `label_tk`. Seeded codes:

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

### Customs expense categories: `GET|POST /api/v1/export/customs-expense-categories/`

Read: any authenticated user; lists **active** categories only, paginated, ordered by `sort_order`.
Create: the customs expense write roles (`finansist`, `export_manager`, `document_team`, `admin`,
`director`, superusers); others → `403 {"error": ...}`. No update/delete endpoint — use Django admin.
Not season-scoped.

```json
// Request
{ "label_tk": "Ýol haky", "label_ru": "Дорожный сбор" }   // label_ru, label_en optional

// Response 201 (same shape as a list item)
{ "id": 214, "code": "YOL_HAKY", "label_tk": "Ýol haky", "label_ru": "Дорожный сбор",
  "label_en": null, "sort_order": 140, "is_active": true }

// Error 400: { "label_tk": ["A category with this name already exists."] }  (case-insensitive)
```

`code` is server-generated from `label_tk` (slugified, upper-case, `_2`… on collision, `CAT` when
the name has no Latin letters) and read-only.

### Advances by shipment: `GET /api/v1/export/advances/?shipment=<id>` (2026-10-01)

Only advances linked to that shipment (via `FinansistAdvanceShipment`), same list shape.
`Exists()`-based, so `shipment_count` / `allocated_total` still count **all** of the advance's
links. Season scope relaxes for callers with `closed_season.can_view` — same rule as
`/customs-expenses/?shipment=`. Backs the Advances page opened from the Sheet, Shipment Detail
or the «Awans ber» task.

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
