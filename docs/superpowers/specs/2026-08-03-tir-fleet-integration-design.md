# TIR Fleet Integration — Design

**Date:** 2026-08-03
**Status:** Approved (design), pending implementation plan
**Module:** `transport` (+ shipment truck-entry surfaces in `export` frontend). Builds on the Traccar Fleet Map + Shipment↔Truck GPS-link features (`feat/transport-fleet-map`).

## Goal

Let a shipment record its truck by **selecting a tractor + trailer from the company fleet** (seeded once from the TIR system) instead of typing free text — so the GPS link resolves automatically and plates are consistent. Foreign / Gapy-Satys shipments keep free text and no map.

## Context (verified against live data)

- **`Z_TIRWEB`** is the TIR fleet-management DB — MSSQL, host `10.10.11.233`, **AW instance = TCP port 62079**, DB `Z_TIRWEB`, user `tirweb`/`tirweb`. Tables include `truck_heads`, `trailers`, `drivers`, `trips`, earnings/expenses.
- **`truck_heads`** (91 rows): `id bigint`, `plate_number nvarchar(50)`, `owner_type`, `owner_name`, `status`, `capacity`, timestamps. All `owner_type='company'`, `status='idle'`. Clean single tractor plates (`3269AHF`, `4470AHF`) — Traccar format.
- **`trailers`** (74 rows, cleaned by the user): `id`, `plate_number`, `owner_type`, `status`, timestamps. Real trailer plates (`2602TAH`, `2607TAH`).
- **GPS coverage: 90 of 91 truck_heads** match a Traccar device by normalized plate (the 1 miss is a `2613AHF`↔`2613AHG` data diff).
- **`Shipment.truck_head_id` / `trailer_id` / `driver_id`** already exist as reserved **`BigIntegerField`** (nullable) — this is the `trip_mgmt` integration the DDL anticipated. `Shipment.is_gapy_satys` (Boolean) already flags local sales.
- `truck_plate` (free text, combined `"tractor/trailer"`) is edited in the **Sheet cell** (`sheet_rows.py` field `truck_plate`) and the **shipment edit drawer** (`shipmentEditConfig.ts`, `inputType:'text'`), shown read-only in list/detail. It appears on documents.
- Module rule: `transport` may import `export`; `export` may **not** import `transport`. `Shipment.truck_head_id` is a **plain bigint, not a Django FK**, so storing it does not couple `export` to `transport`.
- Existing `transport.Truck` (Traccar-derived, 95) + `TraccarDevice` + `DevicePosition` + `ShipmentDeviceLink` + `resolve_device_for_shipment` are already shipped.

## Decisions (from brainstorming)

1. **One-time import**, not a recurring sync. After the seed, the **platform owns** the TruckHead/Trailer master (Z_TIRWEB is just the initial source).
2. **Both tractor + trailer** selectable.
3. **Create-if-not-in-list = both**: inline "+ Add" from the dropdown AND a dedicated admin page.
4. Non-Gapy-Satys → dropdowns; **Gapy-Satys → free text, no GPS**.
5. GPS resolves via `truck_head_id` first (authoritative), falling back to the existing manual-link / plate-match chain.
6. Keep `transport.Truck` (Traccar-derived) for the fleet map; `TruckHead` is the authoritative shipment pick-list. Merging them is a future cleanup, not now.

## Architecture

### Data model (`transport`)

`TruckHead` — platform-owned; seeded once from `Z_TIRWEB.truck_heads`:
- `id` — BigAutoField, but **import preserves the Z_TIRWEB id** (so `Shipment.truck_head_id` lines up). After import, the identity seed is bumped above `max(id)` so new inline/admin creates don't collide.
- `plate_number` — CharField(50), unique
- `owner_type` — CharField(20) (`company` / `hired` / …)
- `owner_name` — CharField(200), blank
- `status` — CharField(20), blank
- `capacity` — DecimalField(max_digits=10, decimal_places=2), null
- `traccar_device` — FK→`TraccarDevice`, `on_delete=SET_NULL`, null (matched by plate at import/create → GPS)
- `is_active` — Boolean, default True
- `created_at` — auto_now_add
- `db_table = schema_table('transport', 'truck_heads')`

`Trailer` — same shape minus GPS:
- `id`, `plate_number` CharField(50) unique, `owner_type`, `status`, `is_active`, `created_at`.
- `db_table = schema_table('transport', 'trailers')`

Cyrillic: plate/owner fields are Latin/Turkmen-Latin — no `db_collation` unless `owner_name` carries Cyrillic (add it there to be safe).

### One-time import

`management/commands/import_tir_fleet.py`:
- Connects to Z_TIRWEB read-only via **pyodbc** (`SERVER=10.10.11.233,62079;DATABASE=Z_TIRWEB;UID=tirweb;PWD=tirweb;TrustServerCertificate=yes`), from a small `services/tir_client.py` helper. Read-only — never writes to Z_TIRWEB.
- Upserts `TruckHead`/`Trailer` (`update_or_create` on `id`), **preserving the Z_TIRWEB ids**. Because `id` is an MSSQL identity column, inserting explicit ids requires wrapping the load in `SET IDENTITY_INSERT transport_truck_heads ON … OFF` (and likewise for trailers) — done inside the command via a raw cursor. (Alternative if IDENTITY_INSERT proves troublesome: make `id` a non-identity `BigIntegerField` PK managed by the app; decide at plan time.)
- Matches each `TruckHead.traccar_device` by normalized plate against `TraccarDevice`/`Truck.plate` (reuse `normalize_plate`).
- After load, reseeds the MSSQL identity so future inserts start above the max imported id (`DBCC CHECKIDENT('transport_truck_heads', RESEED, <max>)` etc., guarded and idempotent).
- Idempotent — safe to re-run. **Not scheduled** (no Celery beat).

### Shipment selection

- Store on the existing **`Shipment.truck_head_id` / `trailer_id`** (bigint). On selection, also set `truck_plate = f"{head.plate_number}/{trailer.plate_number}"` (or just the head when no trailer) so documents / sheet display / legacy code keep working. Clearing the selection / Gapy-Satys leaves `truck_head_id` null.
- **Frontend surfaces** (both, gated on `!shipment.is_gapy_satys`):
  - **Sheet cell** (`truck_plate` row): a searchable truck-head select (+ inline "+ Add") and a trailer select. For Gapy-Satys rows, the plain text input remains.
  - **Shipment edit drawer** (`shipmentEditConfig.ts`): replace the `truck_plate` text field with the same two selectors (conditional on `is_gapy_satys`).
- **Inline add**: typing a plate with no match offers `+ Add "<plate>"` → POST creates a `TruckHead`/`Trailer` (plate-matched to a device) and selects it.

### Admin management

- A `TruckHead` / `Trailer` management page (list + create + edit + deactivate), following the platform's existing admin-page patterns (e.g. `TruckDestinationsPage`). Reuses the same create/CRUD endpoints.

### GPS resolution (upgrade `resolve_device_for_shipment`)

New order: **1) `shipment.truck_head_id` → `TruckHead.traccar_device` → latest `DevicePosition`** (authoritative, exact) → 2) manual `ShipmentDeviceLink` → 3) plate auto-match (legacy/free-text fallback) → 4) none. The GPS card + endpoints are unchanged; they just resolve better.

### API (`transport`)

- `GET /transport/truck-heads/?search=` → `[{id, plate_number, owner_type, status, has_gps}]` (searchable, for the dropdown; `has_gps` = traccar_device set).
- `GET /transport/trailers/?search=` → `[{id, plate_number, owner_type, status}]`.
- `POST /transport/truck-heads/` / `POST /transport/trailers/` → inline/admin create (plate unique; matches device by plate). Gated to the shipment-editor role set (reuse `CanEditShipment`).
- `PUT/PATCH`/deactivate for the admin page.
- Writing `truck_head_id`/`trailer_id` onto a shipment goes through the **existing export shipment-update path** (Sheet patch / drawer save) — it writes the bigint + derived `truck_plate`; no `transport` import needed there.

### Dependency direction

`Shipment.truck_head_id`/`trailer_id` stay plain bigints (no FK) — `export` never imports `transport`. `transport` owns `TruckHead`/`Trailer` and resolves them (transport→export allowed for the GPS path).

### Error handling / edges

- Import when Z_TIRWEB unreachable → command errors clearly, writes nothing.
- Inline-add duplicate plate → 400 / select the existing one.
- Truck-head with no matching device → stored, `traccar_device` null, card shows "No GPS".
- Gapy-Satys shipment → selectors hidden, free text, `truck_head_id` null, no map.
- Deactivated truck-head → hidden from the dropdown but still resolves GPS for shipments already referencing it.

### Testing

- Import: preserves ids, matches devices by plate, idempotent, identity reseed prevents collision.
- Resolver: `truck_head_id` path wins over manual/plate; falls back correctly.
- Endpoints: list/search, create (plate-match + unique), permission gate, shipment-update writes ids + derived plate.
- Frontend: selector (search + inline add), Gapy-Satys → text, drawer/sheet conditional.

## Out of scope (future)

- Drivers / trips / earnings from Z_TIRWEB (drivers table exists — a later slice).
- Any write-back to Z_TIRWEB.
- Merging `transport.Truck` (Traccar-derived) into `TruckHead`.
- Recurring re-sync (explicitly one-time).

## Decomposition (for the plan)

Sizable — implement as sub-projects, each shippable:
1. **Models + one-time import + GPS-resolver upgrade** (backend, no UI).
2. **List/create/CRUD endpoints** (backend).
3. **Shipment selectors** (Sheet cell + edit drawer, conditional on `is_gapy_satys`) + inline add.
4. **Admin management page.**

## Rollout / project rules

- MSSQL-safe (Decimal capacity, explicit max_length, PROTECT/SET_NULL, no JSONField, identity reseed via guarded raw SQL in a management command only — values parameterized/constant). No Django signals.
- Obsidian docs + CHANGELOG + BUILD_TEST_LOG.
- Continue on `feat/transport-fleet-map` (or a fresh branch once that PR merges — decide at plan time).
