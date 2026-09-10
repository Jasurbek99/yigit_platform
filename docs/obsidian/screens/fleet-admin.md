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
| May read driver passports | the same **resource** `fleet` | `CanAccessDriverDocuments` on the three `DriverViewSet` document actions — the one gate here that closes GET too (see [[#Driver passport documents]]) |

Page code is `transport.fleet`, not `admin.fleet` — AD-15 reserves the `admin.` prefix for
admin-only pages, and `director` / `export_manager` have every `admin.*` code subtracted from
their defaults, while warehouse and loading heads hold this one. The resource carries **no
delete**: none of the three ViewSets expose `destroy` (rows are deactivated), so `can_delete`
is seeded `False` for every role. Reads are ungated on purpose — the truck / trailer / driver
pickers on the Sheet and the shipment drawer list the same catalog. The **one exception** is a
driver's passport (serial, issue date, scans), which only fleet editors may read; that is what
`CanAccessDriverDocuments` and the split driver serializer are for.

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
  **truck_model**, capacity, GPS (green/grey tag from `has_gps`), status (active/inactive
  tag), row actions. `truck_model` is the vehicle's make and model as free text
  (e.g. `MAN TGX`) — the `Z_TIRWEB` import carries no such column, so every seeded row
  starts blank. **Required on every save since 2026-09-10** — see
  [[#Required fields (2026-09-10)]].
- **Trailers** — `useAdminTrailers()`. Columns: plate_number, owner_type, status, row actions.
- **Drivers** — `useAdminDrivers()`, in its own component `FleetDriversTab.tsx`. Columns:
  name, phone, **passport serial**, **passport scan count**, **Logo code**, status, row
  actions. Form fields: **name** (required), **phone**, **passport_serial** (required),
  **passport_issue_date** (required), **is_active**, plus the passport scan panel — an
  upload list in edit mode, a staged picker in add mode (see
  [[#Driver passport documents]] and [[#Required fields (2026-09-10)]]). `driver_logo_code` is displayed but **not editable** — the import refreshes it
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

Plate numbers are upper-cased on submit. Truck form fields: **plate_number** (required),
**owner_type, owner_name, truck_model** (required)**, capacity, is_active**. Trailer form fields: **plate_number, owner_type,
is_active**. Success/error surface as `sonner` toasts. Mutations invalidate both the admin
query keys and the shared picker query keys (`['transport','truck-heads']` /
`['transport','trailers']`), so a fleet edit here is immediately reflected in
`ShipmentTruckSelector`.

Creating or editing a truck-head that changes its `plate_number` re-runs the backend's Traccar
`device_for_plate()` match (a plate-only change flips its GPS link); a PATCH that leaves the
plate unchanged does **not** re-match. Trailers have no GPS link. See
[[../reference/api-endpoint-map]] for the endpoint contract.

## Required fields (2026-09-10)

Owner request: a truck may not be registered without a **model**, and a driver may not exist
without a **passport serial and issue date**. All three were optional until this change, and
every imported row is blank on them — 92 of 92 truck heads carry no model, 153 of 153 drivers
no passport — so this is a fill-in-as-you-go rule, not a claim about today's data.

**Enforced on add AND edit**, not create-only (a create-only rule would have left every
imported row permanently incomplete). The check reads the **effective** value — the incoming
one when the payload carries it, the stored one otherwise — so a PATCH cannot leave a blank row
blank by simply omitting the field. Editing an imported truck or driver therefore prompts for
the missing value before it will save.

**One exempt payload: `is_active` on its own.** Deactivation is how a wrongly-imported truck or
a duplicate driver is retired (a delete would come straight back on the next `Z_TIRWEB` import —
see the `Driver` model docstring), and that row is precisely the one nobody will ever supply a
model or passport for. A required field must not make a row impossible to switch off.

The rule lives in `require_filled()` in `apps/transport/serializers.py`, called from
`TruckHeadSerializer.validate()` and `DriverAdminSerializer.validate()`. It is **not** a model
constraint on purpose: the TIR import writes these same rows and carries neither column, so a
`blank=False` field would break every import run. Errors come back keyed by field name, so the
form marks the offending input instead of showing a banner.

### The pickers' inline "+ Add" is gone, for drivers and truck heads

Two one-line controls used to create a registry row from a typed value alone, and both would now
400 on every use, so both were removed rather than left to fail. An unrecognised value shows a
hint pointing at this screen instead.

| Control | Used to POST | Shared by |
|---|---|---|
| "Add driver «NAME»" in `DriverSelect` | `{name}` | Sheet R27 editor, Detail card, edit drawer |
| "Add truck «PLATE»" in `SheetTruckSelectEditor` / `ShipmentTruckSelector` | `{plate_number}` | Sheet truck cell, Detail card, edit drawer |

`useCreateDriver()` and `useCreateTruckHead()` went with them. **`useCreateTrailer()` stays** and
the trailer's inline add still works: a trailer has no required field beyond its plate, so
nothing there changed.

The TIR import is unaffected — `apps/transport/services/tir_import.py` writes through
`Model.objects.update_or_create()`, which never touches a serializer.

## Driver passport documents

Added 2026-09-09. A driver row carries two passport scalars — `passport_serial` (free text; a
Turkmen passport reads like `I-AN 1234567` and the platform must not reject a foreign driver's
format) and `passport_issue_date` — plus any number of scans, one to five, each a JPG or a PDF.
Both scalars are optional and blank on every imported row.

**Reads are closed here, unlike everywhere else on this screen.** The driver pickers on the Sheet
and the shipment drawer call the same `/transport/drivers/` route as this page, so exposing
passport data on the shared serializer would ship it to every authenticated user. Two mechanisms
keep that from happening:

- `DriverViewSet.get_serializer_class()` returns `DriverAdminSerializer` — the one carrying
  `passport_serial`, `passport_issue_date` and `document_count` — only when `can_edit_fleet()`
  passes. Everyone else gets the plain `DriverSerializer`, whose response has no passport keys at
  all.
- The three document actions are gated by `CanAccessDriverDocuments`, which unlike `CanEditFleet`
  refuses GET as well. Same `fleet` resource, applied to every method.

Scans are never reachable at a `/media/` path. `frontend/nginx.conf` aliases that directory with
no auth, so the file is streamed by an authenticated download action instead, exactly as
[[contract-detail|contract attachments]] are. The frontend links to it with a plain `<a href>`
built by `driverDocumentUrl()`: the JWT cookie is httpOnly and same-origin, so the browser sends
it and the scan previews in a new tab.

Validation lives in `apps/transport/services/files.py`: `.jpg`/`.jpeg`/`.pdf` only, confirmed by
magic bytes rather than the browser's Content-Type, 10 MB per file, 5 files per driver. A single
POST may carry several files under the `files` form key, and one bad file rejects the whole batch
before any row is written — a half-accepted upload would leave the operator guessing which
passport page landed. `original_filename` is stripped to its basename against directory traversal.

The upload panel renders **only when the modal is editing an existing driver**. A file needs a
driver id to hang off, and the create form has none yet, so a new driver is saved first and its
scans attached on a second open.

### Attaching a scan while creating a driver

The Add dialog has a scan picker too (2026-09-10). Files chosen there are held in the browser —
there is no driver id to POST against yet — and uploaded the moment the create call returns one,
in the same single request the edit panel uses. A scan is **optional**: a rejected file is
reported on its own and the driver row still exists, so "the scan bounced" never reads as "the
driver was not created"; the operator re-attaches it from the edit dialog.

`useUploadDriverDocuments()` takes the driver id in its **mutate variables**, not as a hook
argument, precisely because the Add dialog only learns the id from the create response — a hook
bound at render time would still be holding `null` when the upload fires.

## Files

| File | Role |
|------|------|
| `frontend/src/pages/admin/FleetAdminPage.tsx` | Page — three tabs, truck/trailer tables and modals |
| `frontend/src/pages/admin/FleetDriversTab.tsx` | Drivers tab — ProTable + filter + create/edit modal |
| `frontend/src/hooks/useFleetAdmin.ts` | `useAdminTruckHeads`/`useAdminTrailers`/`useAdminDrivers` (incl. inactive), the three `useAdminCreate*`, the three `useUpdate*`, the `useDriverDocuments`/`useUploadDriverDocuments`/`useDeleteDriverDocument` trio with `driverDocumentUrl()`, and the `IDriver` type |
| `frontend/src/hooks/useFleet.ts` | Shared `ITruckHead`/`ITrailer` types (extended locally for admin-only fields) |
| `backend/apps/transport/views.py` | `TruckHeadViewSet` / `TrailerViewSet` / `DriverViewSet` (list/create/update) |
| `backend/apps/transport/permissions.py` | `CanEditFleet` — write gate, `resource_write_permission('fleet')`; `CanAccessDriverDocuments` + `can_edit_fleet()` — passport read/write gate |
| `backend/apps/transport/services/files.py` | Passport scan validation — JPG/PDF, magic bytes, 10 MB, 5 per driver |
| `backend/apps/transport/migrations/0006_driver_passport_issue_date_driver_passport_serial_and_more.py` | `passport_serial`, `passport_issue_date`, `truck_model`, `DriverDocument` |
| `frontend/src/App.tsx`, `AppLayout.tsx` | Route + nav item (`nav.admin_fleet`), both gated on `transport.fleet` |
| `backend/apps/core/permission_registry.py`, `seed_permissions.py`, `core/migrations/0039_fleet_page_perms.py`, `0040_fleet_resource.py` | Page code + resource code, seeded defaults, live-DB backfill |
