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

Two matrix entries, the standard page/resource split — both on `/admin/permissions`:

| What | Entry | Gates |
|---|---|---|
| Sees the screen | **page** `transport.fleet` (Pages tab, *Transport* group) | nav item (`canSeePage`) + route (`<ProtectedRoute pageCode="transport.fleet">`) |
| May write | **resource** `fleet` (Resources tab) | `CanEditFleet` = `resource_write_permission('fleet')` on `TruckHeadViewSet` / `TrailerViewSet` / `DriverViewSet` — `can_create` for POST, `can_edit` for PATCH |

Page code is `transport.fleet`, not `admin.fleet` — AD-15 reserves the `admin.` prefix for
admin-only pages, and `director` / `export_manager` have every `admin.*` code subtracted from
their defaults, while warehouse and loading heads hold this one. The resource carries **no
delete**: none of the three ViewSets expose `destroy` (rows are deactivated), so `can_delete`
is seeded `False` for every role. Reads are ungated on purpose — the truck / trailer / driver
pickers on the Sheet and the shipment drawer list the same catalog.

Registering the code also puts it inside `/admin/staff-access`'s reach: `ManagedPagePermissionsView._grantable_pages`
delegates every non-`admin.` code a manager's own role can see, so a department head who holds
`transport.fleet` can now grant it to a role they manage — i.e. hand out fleet **write** access. That
is self-bounded (a manager can never delegate a page they do not hold) and is the same rule that
already applies to every other non-`admin.` page, including `export.harvest_board`, which likewise
gates writes. Called out because before 2026-09-03 no delegation of this page was possible at all.

Seeded defaults for both entries reproduce the old hardcoded `SHIPMENT_EDITOR_ROLES` set
exactly — `admin`, `director`, `export_manager`, **`boss`**, `warehouse_chief`,
`loading_dept_head`, `loading_dept_head_deputy` — so nobody's access changed on the 2026-09-03
deploy. Core migration `0039_fleet_page_perms` writes the page rows (plus an
`is_visible=False` row for every other role, so each has a checkbox) and `0040_fleet_resource`
writes the resource rows (view+create+edit for those seven; other roles get no row, which
reads as no writes). `boss` needs an explicit resource row for the same reason
`sheet_row_setting` did — the `_ALL_RESOURCES` wildcard only fires under `seed_permissions`,
which production never runs.

> **`boss` was added to all three gates on 2026-08-20.** `/admin/fleet` had been in
> `BOSS_MENU_GROUPS` since the composition split, but the item's inline `roles` list omitted
> `boss`, so the link never rendered for a real boss account — and `CanEditShipment` would have
> 403'd every write even if it had. Same shape as the weekly-plan and `/join` widenings: `boss`
> holds `['*']` in the permission matrix, but these hardcoded sets never consult it.
> `SHIPMENT_EDITOR_ROLES` gated **only** `apps/transport/views.py` — the GPS device-link
> override plus TruckHead/Trailer/Driver CRUD — so the widening reached nothing else. Since
> 2026-09-03 it gates only the device-link override; the fleet CRUD moved to `CanEditFleet`
> and the matrix, where `boss` holds `transport.fleet` through the every-page grant.
>
> `AppLayout.menuGroups.test.tsx` could not have caught this: its `fakeUser` fixture sets
> `is_superuser: true`, which takes the bypass branch in the filter. Dedicated tests now render
> a **non-superuser** boss and assert `/admin/fleet` is present when `transport.fleet` is
> granted and absent when it is revoked.

## Layout

An Ant Design `Tabs` with three tabs:

- **Trucks** — `useAdminTruckHeads()`. Columns: plate_number, owner_type, owner_name,
  capacity, GPS (green/grey tag from `has_gps`), status (active/inactive tag), row actions.
- **Trailers** — `useAdminTrailers()`. Columns: plate_number, owner_type, status, row actions.
- **Drivers** — `useAdminDrivers()`, in its own component `FleetDriversTab.tsx`. Columns:
  name, phone, **Logo code**, status, row actions. Form fields: **name** (required), **phone**,
  **is_active**. `driver_logo_code` is displayed but **not editable** — the import refreshes it
  from `Z_TIRWEB` on every run, so an edit would be silently reverted, and it is the key the
  duplicate retirement runs on. It is shown because two drivers can share a name (ids 30/31 are
  both `BATYROW BAYRAMMYRAT`) and the code is the only thing telling them apart; the tab's
  client-side filter searches it too.

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
| `backend/apps/transport/permissions.py` | `CanEditFleet` — write gate, `resource_write_permission('fleet')` |
| `frontend/src/App.tsx`, `AppLayout.tsx` | Route + nav item (`nav.admin_fleet`), both gated on `transport.fleet` |
| `backend/apps/core/permission_registry.py`, `seed_permissions.py`, `core/migrations/0039_fleet_page_perms.py`, `0040_fleet_resource.py` | Page code + resource code, seeded defaults, live-DB backfill |
