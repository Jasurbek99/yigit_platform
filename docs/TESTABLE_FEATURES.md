# Testable Features (Frontend)

Start both servers before testing:
- **Backend**: `USE_SQLITE=true venv/bin/python manage.py runserver 8000` (from `backend/`)
- **Frontend**: `npm run dev` (from `frontend/`)
- Or use VSCode task: **YGT: Run All** (`Cmd+Shift+B`)

Login at `http://localhost:5173/login`

---

## Test accounts

| Username | Password | Role |
|---|---|---|
| `admin` | `admin` | superuser |
| `export_manager` | `em123` | Export Manager |
| `warehouse_chief` | `wc123` | Warehouse Chief |
| `document_team` | `dt123` | Document Team |
| `transport` | `tr123` | Transport |
| `sales_rep` | `sr123` | Sales Rep |

---

## Features

### 1. Login / Auth
- `POST /login` sets httpOnly JWT cookie
- Wrong credentials → error message
- Logged-in user redirected away from `/login`
- `GET /api/v1/auth/me/` returns role + `editable_fields[]`

### 2. Shipment List — `/export/shipments`
- Paginated table (50/page) with cargo_code, date, status badge, country, customer, net weight, departed/arrived timestamps
- **All / My Work toggle** — "My Work" filters to shipments in your role's active phase (server-side)
- **Search** by cargo code (light filter bar)
- **Click any row** → navigates to ShipmentDetail
- Columns auto-hide on smaller screens (date, weight hidden on mobile)

> With `VITE_USE_MOCK=true` in `frontend/.env.local`: shows 5 hardcoded mock shipments without a running backend.

### 3. Shipment Detail — `/shipments/:id`
- Header: cargo code + status badge + back button
- **Overview tab**: all key fields in a Descriptions grid; export firm splits table; greenhouse block sources table
- **Logistics tab**: vehicle condition, route note, all 8 AD-1 timestamps (loading → sale ended)
- **Comments tab**: list of user comments with role badge and timestamp
- **History tab**: status change timeline (who changed to what, when, optional comment)

> With `VITE_USE_MOCK=true`: always shows shipment `0201045/25` regardless of ID.

### 4. Status colour badges (StatusTag)
All 13 statuses mapped to Ant Design tag colours:

| Status | Colour |
|---|---|
| Loading | blue |
| Customs Entry / Exit | gold |
| Departed | cyan |
| TM Border / Border Crossed / Dest Customs | orange |
| In Transit | geekblue |
| Arrived | lime |
| Being Sold / Sold | green |
| Report | purple |
| Completed | default (grey) |

---

### 5. Transition Button — ShipmentDetail header
- "Change Status" button appears when transitions are available for the current status
- Opens modal: select target status from allowed list + optional comment
- POSTs to `/transition/`, shows success/error toast, refreshes detail

### 6. Comment Composer — ShipmentDetail → Comments tab
- Textarea at the bottom of the Comments tab
- Ctrl+Enter to submit; button disabled when empty
- Adds comment, refreshes list

### 7. Kanban Board — `/export/kanban`
- 5 columns: Loading / Customs / Transit / Border / Sales
- Each card: cargo code, customer, StatusTag, weight, days since last update
- Red left border + ⚠ Overdue tag if stuck longer than phase threshold
- Global alert banner if any overdue shipments exist
- Click card → ShipmentDetail

### 8. Weekly Plan Grid — `/export/plan`
- Week picker (ISO week)
- Table: one row per greenhouse block, plan vs actual for Mon–Sat
- Actual cells show diff (+green / -red)
- Weekly total row at bottom

### 9. Quota Dashboard — `/export/quota`
- Summary cards: total granted, total used, warning firms, critical firms
- Per-firm progress bars: green < 80%, orange ≥ 80%, red ≥ 95%

### 10. Price Panel — `/export/prices`
- City × date pivot table
- 7 / 14 / 30 day range toggle
- ↑↓ trend tags comparing today vs yesterday

### 11. Export & Print — ShipmentList toolbar
- **Export to Excel** — downloads current page as `.xlsx` with translated headers
- **Print** — `window.print()` with CSS hiding sidebar/header/pagination

### 12. Field-level PATCH
- `PATCH /api/v1/export/shipments/{id}/` enforces role permissions
- warehouse_chief/document_team: box_count, pallet_count, weight_net, weight_gross
- transport: vehicle_condition, vehicle_condition_note, route_note
- export_manager/director: unrestricted
- Forbidden fields → 403

## What's NOT built yet

- ShipmentCreate form (new shipment from UI)
- Excel data import (1,959 historical shipments from Export_contracts.xlsx)
- Language switcher UI (i18n wired, just needs a toggle button)
