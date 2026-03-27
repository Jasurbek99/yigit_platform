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
Lightweight — no nested objects, no related tables. Used by ProTable.

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
