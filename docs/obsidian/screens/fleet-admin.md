---
title: Fleet Admin
tags: [screen, frontend, admin, transport, tir-fleet, fleet-map]
related: [[../processes/fleet-map]], [[../reference/api-endpoint-map]], [[../reference/data-model-map]]
---

# Fleet Admin

CRUD screen for the company **TIR fleet** — the `TruckHead` (tractor) and `Trailer` registries
that shipments pick their truck from. Route `/admin/fleet`. Component:
`frontend/src/pages/admin/FleetAdminPage.tsx`. Backs the truck-head / trailer dropdowns in
[[../processes/fleet-map|`ShipmentTruckSelector`]]. The registries are seeded once from
`Z_TIRWEB` (see [[../processes/fleet-map#One-time import from Z_TIRWEB]]); this page is the
ongoing edit surface.

## Access

**No `admin.fleet` page_code is registered.** The route is instead role-gated via
`<ProtectedRoute roles={[...]}>` in `App.tsx` to the fleet-editor set — `admin`, `director`,
`export_manager`, `warehouse_chief`, `loading_dept_head`, `loading_dept_head_deputy` — a
literal mirror of the backend `SHIPMENT_EDITOR_ROLES` (`apps/transport/permissions.py`
`CanEditShipment`), the same set that gates the write endpoints. The `AppLayout` nav item
(`nav.admin_fleet`, under the System group) is role-filtered with the same list, so users
outside it never see the link. Write endpoints are independently enforced server-side.

## Layout

An Ant Design `Tabs` with two tabs:

- **Trucks** — `useAdminTruckHeads()`. Columns: plate_number, owner_type, owner_name,
  capacity, GPS (green/grey tag from `has_gps`), status (active/inactive tag), row actions.
- **Trailers** — `useAdminTrailers()`. Columns: plate_number, owner_type, status, row actions.

Both tabs list **all** rows including inactive ones — the admin hooks call the list endpoint
with `?include_inactive=true` (the shipment picker, by contrast, sees active-only). Tables are
unpaginated (bounded fleet size).

## Actions

| Action | How | Hook |
|---|---|---|
| **Create** | "Add" button → modal; a **single POST** with the full payload | `useAdminCreateTruckHead` / `useAdminCreateTrailer` |
| **Edit** | row "Edit" → same modal pre-filled | `useUpdateTruckHead` / `useUpdateTrailer` (PATCH) |
| **Activate / Deactivate** | row toggle button → PATCH `{is_active}` | same update hooks |

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
| `frontend/src/pages/admin/FleetAdminPage.tsx` | Page — two tabs, tables, create/edit modals |
| `frontend/src/hooks/useFleetAdmin.ts` | `useAdminTruckHeads`/`useAdminTrailers` (incl. inactive), `useAdminCreateTruckHead`/`useAdminCreateTrailer`, `useUpdateTruckHead`/`useUpdateTrailer` |
| `frontend/src/hooks/useFleet.ts` | Shared `ITruckHead`/`ITrailer` types (extended locally for admin-only fields) |
| `backend/apps/transport/views.py` | `TruckHeadViewSet` / `TrailerViewSet` (list/create/update) |
| `backend/apps/transport/permissions.py` | `CanEditShipment` — write gate |
| `frontend/src/App.tsx`, `AppLayout.tsx` | Role-gated route + nav item (`nav.admin_fleet`) |
