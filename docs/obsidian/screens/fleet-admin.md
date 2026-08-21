---
title: Fleet Admin
tags: [screen, frontend, admin, transport, tir-fleet, fleet-map]
related: [[../processes/fleet-map]], [[../reference/api-endpoint-map]], [[../reference/data-model-map]]
---

# Fleet Admin

CRUD screen for the company **TIR fleet** — the `TruckHead` (tractor), `Trailer` and `Driver`
registries. Route `/admin/fleet`. Component:
`frontend/src/pages/admin/FleetAdminPage.tsx`. Backs the truck-head / trailer dropdowns in
[[../processes/fleet-map|`ShipmentTruckSelector`]]. The registries are seeded once from
`Z_TIRWEB` (see [[../processes/fleet-map#One-time import from Z_TIRWEB]]); this page is the
ongoing edit surface.

## Access

**No `admin.fleet` page_code is registered.** The route is instead role-gated via
`<ProtectedRoute roles={[...]}>` in `App.tsx` to the fleet-editor set — `admin`, `director`,
`export_manager`, **`boss`**, `warehouse_chief`, `loading_dept_head`,
`loading_dept_head_deputy` — a literal mirror of the backend `SHIPMENT_EDITOR_ROLES`
(`apps/transport/permissions.py` `CanEditShipment`), the same set that gates the write
endpoints. The `AppLayout` nav item (`nav.admin_fleet`) is role-filtered with the same list, so
users outside it never see the link. Write endpoints are independently enforced server-side.

> **`boss` was added to all three gates on 2026-08-20.** `/admin/fleet` had been in
> `BOSS_MENU_GROUPS` since the composition split, but the item's inline `roles` list omitted
> `boss`, so the link never rendered for a real boss account — and `CanEditShipment` would have
> 403'd every write even if it had. Same shape as the weekly-plan and `/join` widenings: `boss`
> holds `['*']` in the permission matrix, but these hardcoded sets never consult it.
> `SHIPMENT_EDITOR_ROLES` gates **only** `apps/transport/views.py` — the GPS device-link
> override plus TruckHead/Trailer/Driver CRUD — so the widening reaches nothing else.
>
> `AppLayout.menuGroups.test.tsx` could not have caught this: its `fakeUser` fixture sets
> `is_superuser: true`, which takes the bypass branch in the role filter. A dedicated test now
> renders a **non-superuser** boss and asserts `/admin/fleet` is present.

## Layout

An Ant Design `Tabs` with three tabs:

- **Trucks** — `useAdminTruckHeads()`. Columns: plate_number, owner_type, owner_name,
  capacity, GPS (green/grey tag from `has_gps`), status (active/inactive tag), row actions.
- **Trailers** — `useAdminTrailers()`. Columns: plate_number, owner_type, status, row actions.
- **Drivers** — `useAdminDrivers()`, in its own component `FleetDriversTab.tsx`. Columns:
  name, phone, status, row actions. Form fields: **name** (required), **phone**, **is_active**.

Every tab lists **all** rows including inactive ones — the admin hooks call the list endpoint
with `?include_inactive=true` (the shipment picker, by contrast, sees active-only).

The two fleet tabs are unpaginated (bounded fleet size). **Drivers differs**: 152 rows is past
the point where a wall of rows is usable, so that tab is a `ProTable` with 50-per-page
pagination, a client-side name/phone filter in its toolbar (the whole list is already in
memory — no round trip per keystroke), and column sorters defaulting to active-first then name.
Its modal sets `okText`/`cancelText` from our own i18n rather than Ant Design's bundled locale,
which ships no Turkmen (`App.tsx` falls back to `en_US` for `tk`).

## Actions

| Action | How | Hook |
|---|---|---|
| **Create** | "Add" button → modal; a **single POST** with the full payload | `useAdminCreateTruckHead` / `useAdminCreateTrailer` / `useAdminCreateDriver` |
| **Edit** | row "Edit" → same modal pre-filled | `useUpdateTruckHead` / `useUpdateTrailer` / `useUpdateDriver` (PATCH) |
| **Activate / Deactivate** | row toggle button → PATCH `{is_active}` | same update hooks |

There is **no delete** on any tab — deactivate instead. For drivers this matters more than for
the fleet: `Shipment.driver_id` is a loose integer with no FK to protect it, so a deleted row
would leave dangling references with nothing to raise an error.

A blank driver phone is sent as `null`, never `''` — the column is nullable and `NULL` is what
the `Z_TIRWEB` import means by "no phone known".

Plate numbers are upper-cased on submit. Truck form fields: **plate_number, owner_type,
owner_name, capacity, is_active**. Trailer form fields: **plate_number, owner_type,
is_active**. Success/error surface as `sonner` toasts. Mutations invalidate both the admin
query keys and the shared picker query keys (`['transport','truck-heads']` /
`['transport','trailers']`), so a fleet edit here is immediately reflected in
`ShipmentTruckSelector`.

Creating or editing a truck-head that changes its `plate_number` re-runs the backend's Traccar
`device_for_plate()` match (a plate-only change flips its GPS link); a PATCH that leaves the
plate unchanged does **not** re-match. Trailers have no GPS link. See
[[../reference/api-endpoint-map]] for the endpoint contract.

## Files

| File | Role |
|------|------|
| `frontend/src/pages/admin/FleetAdminPage.tsx` | Page — three tabs, truck/trailer tables and modals |
| `frontend/src/pages/admin/FleetDriversTab.tsx` | Drivers tab — ProTable + filter + create/edit modal |
| `frontend/src/hooks/useFleetAdmin.ts` | `useAdminTruckHeads`/`useAdminTrailers`/`useAdminDrivers` (incl. inactive), the three `useAdminCreate*`, the three `useUpdate*`, and the `IDriver` type |
| `frontend/src/hooks/useFleet.ts` | Shared `ITruckHead`/`ITrailer` types (extended locally for admin-only fields) |
| `backend/apps/transport/views.py` | `TruckHeadViewSet` / `TrailerViewSet` / `DriverViewSet` (list/create/update) |
| `backend/apps/transport/permissions.py` | `CanEditShipment` — write gate |
| `frontend/src/App.tsx`, `AppLayout.tsx` | Role-gated route + nav item (`nav.admin_fleet`) |
