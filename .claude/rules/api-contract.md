# API Contract Rules

The agreement between backend (Django/DRF) and frontend (React/TypeScript). Both sides must follow these rules.

## Base URL and versioning

All endpoints under `/api/v1/{app}/{resource}/`. Current apps: `export`, `contracts`, `core`, `finance`.

## Field naming convention

DB column names → API field names via DRF serializer. The API uses **readable names**, not raw DB columns:

| DB column (DDL v5.1) | API field name | Why |
|----------------------|---------------|-----|
| `code` | `cargo_code` | More descriptive for frontend |
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

The example below shows the **default-visible** fields. As of the ShipmentList column-manager work, `ShipmentListSerializer` ALSO returns the full set of **scalar** shipment fields (Sheet parity) so the column-settings panel can offer them as opt-in columns: all AD-1 + operator timestamps (`loading_started_at`, `customs_entry_at`, `customs_exit_at`, `border_crossed_at`, `sale_started_at`, `sale_ended_at`, `dest_entry_at`, `loading_ended_at`, `sales_report_date`, `harvest_date`), weight detail (`packaging_kg`, `pallet_count`, `box_count`, `rejected_weight_kg`), transport (`vehicle_responsible`/`_display`, `trailer_id`, `truck_plate`, `driver_name`, `driver_phone`, `transport_temp_c`, `transit_days`, `has_peregruz`, `peregruz_city`, `peregruz_date`), `customs_clearance_planned_day`, vehicle condition (`vehicle_condition`/`_note`, `vehicle_live_status`), flattened quality flags (`doc_azyk`, `doc_suriji`, `doc_hil`, `doc_kalibrowka`), per-role notes (`notes`, `export_manager_note`, `warehouse_note`, `document_note`, `additional_notes_arap`), refs (`status_code`, `country_code`, `variety`/`variety_code`, `import_firm`/`import_firm_name`), and audit (`created_by_name`, `created_at`). Nested `firm_splits` / `block_sources` remain **detail/sheet only** — the list stays flat (no related-table prefetch). The list queryset adds `select_related('import_firm', 'created_by', 'quality')` to keep this N+1-safe.

```json
{
  "count": 983,
  "next": "/api/v1/export/shipments/?page=2",
  "results": [
    {
      "id": 1,
      "cargo_code": "0201045/25",
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
  "cargo_code": "0201045/25",
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

### Auth: `POST /api/v1/auth/login/`
```json
// Request
{ "username": "gadam", "password": "..." }

// Response: sets httpOnly cookie, returns user info
{ "id": 1, "username": "gadam", "role": "export_manager", "editable_fields": ["..."] }
```

### My work filter: `GET /api/v1/export/shipments/?my_work=true`
Same response shape as list, filtered by role's active window server-side.

### Sheet endpoint: `GET /api/v1/export/shipments/sheet/`
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
- `DELETE /comments/{id}/` — soft delete (sets `is_deleted=True`)
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
      "cargo_code": "26FV047/25",
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
- `season` is `null` when no active season exists.
- `alerts.weekly_plan` is `null` when no `HarvestDayEntry` rows exist for the current ISO week.
- `stats.in_transit` and `stats.selling` are LIVE (not season-scoped).
- `active_shipments`: max 5, ordered by `-status_changed_at`. `location` = `Shipment.vehicle_live_status` or `""`.
- `routes.percent` = integer percentage of season total trucks, rounded. Top 4 cities per country, null/empty city names omitted.
- Implementation: `apps/export/views_dashboard.py`, service: `apps/export/services/dashboard_summary.py`.

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
