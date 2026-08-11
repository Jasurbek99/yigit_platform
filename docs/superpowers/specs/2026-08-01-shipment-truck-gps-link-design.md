# Shipment ↔ Truck GPS Link — Design

**Date:** 2026-08-01
**Status:** Approved (design), pending implementation plan
**Module:** `transport` (+ a card on the export ShipmentDetail page). Builds on the Traccar Fleet Map feature (`feat/transport-fleet-map`).

## Goal

On the ShipmentDetail page, show the live GPS location of the shipment's truck — a mini map + position details resolved from the Traccar fleet, with a manual override when auto-matching can't find the device.

## Context (verified against live data)

- `export.Shipment` stores free-text `truck_plate` / `driver_name` / `driver_phone`. `truck_plate` is a **combined tractor/trailer** string in inconsistent formats: `'4378AHF/2602TAH'`, `'AG2236/ TAH2526'`, `'797BCV13/35ADI13'`, plus foreign hauliers (`'7463LBE/1779TLB'`) and occasional garbage (`'sadas'`).
- `transport.Truck.plate` holds a **clean single tractor plate** parsed from Traccar device names (`'4378AHF'`), only for YGT's own ~95 tracked trucks.
- **Matching reality (measured):** 0/79 distinct shipment plates match the whole string; **30/79 match** when the tractor part (before `/` or space) is extracted and normalized. The remaining ~49 are overwhelmingly trucks with **no GPS device** (foreign/hired/older). So auto-match by tractor-extraction covers essentially all GPS-equipped trucks; manual override handles the rare tracked-truck-with-mistyped-plate case.
- **Module dependency rule:** `transport` may import `export`; `export` may **not** import `transport`. Therefore the link cannot be a field on `Shipment` — it lives in `transport`.
- ShipmentDetail (`frontend/src/pages/export/ShipmentDetail.tsx`) is composed of cards (hero, stage cards, customs-expenses card). The GPS element is a new card alongside them.
- The Fleet Map already provides: `DevicePosition` (latest per device), `TraccarDevice` (with `truck` FK + `status`), a Leaflet map pattern (`CircleMarker`), and the `useLivePositions` hook style.

## Decisions (from brainstorming)

1. **Auto-match + manual override** (not display-only, not manual-only).
2. **Link stored in `transport`**, only manual overrides persisted; auto-match computed live.
3. **UI:** mini Leaflet map + details card on ShipmentDetail.
4. **Auto-refresh** the position every 30s (matches the fleet map).

## Architecture

### Data model

`transport.ShipmentDeviceLink` — a manual override (one per shipment):
- `shipment` — `OneToOneField('export.Shipment', on_delete=CASCADE, related_name='device_link')`
- `device` — `ForeignKey('transport.TraccarDevice', on_delete=PROTECT)`
- `created_by` — `ForeignKey('core.User', on_delete=SET_NULL, null=True)`
- `created_at` — `DateTimeField(auto_now_add=True)`
- `db_table = schema_table('transport', 'shipment_device_links')`

Auto-matches are **not** stored (no sync/staleness problem).

### Resolver (service)

`resolve_device_for_shipment(shipment) -> tuple[TraccarDevice | None, str]` in `transport/services/matching.py`:
1. Manual `ShipmentDeviceLink` exists → `(link.device, 'manual')`.
2. Else `plate = normalize(first_token(shipment.truck_plate))` where `first_token` splits on `/` or whitespace and `normalize = re.sub(r'[^A-Z0-9]', '', s.upper())`; match against a normalized `Truck.plate` index. On hit, pick the truck's device, preferring one with a `DevicePosition` (else category `truck`, else first). → `(device, 'auto')`.
3. Else → `(None, 'none')`.

Empty/blank `truck_plate` short-circuits to `none`.

### API (under `/api/v1/transport/`)

- `GET shipments/<id>/position/` — `IsAuthenticated`, shipment must be visible to the user.
  ```json
  { "resolved_by": "manual|auto|none",
    "device": {"traccar_id": 74, "plate": "4378AHF", "fleet_no": "TR050"} | null,
    "position": {"lat": .., "lon": .., "speed": .., "course": .., "address": "..",
                 "fix_time": "..", "is_online": true, "is_stale": false} | null }
  ```
  `device` non-null with `position` null = matched a device that has no stored position yet.
- `PUT shipments/<id>/device/` — body `{"traccar_id": N}` → create/replace the manual link. `DELETE` → remove it (revert to auto). Gated to **shipment-edit permission** (reuse the existing rule that governs editing a shipment's transport fields — exact permission confirmed in the plan).
- `GET devices/` — `[{"traccar_id", "plate", "fleet_no"}]` for all registry devices (the override picker needs the full list, not just positioned ones).

All read from our DB; never Traccar in the request path.

### Frontend

- `frontend/src/hooks/useShipmentTruckPosition.ts` — `useShipmentTruckPosition(shipmentId)`, TanStack Query, `refetchInterval: 30_000`; `ITruckPositionResult` type mirroring the response.
- `frontend/src/hooks/useTransportDevices.ts` — fetches `devices/` for the picker (cached, no refetch interval).
- `frontend/src/components/shipment/ShipmentTruckLocationCard.tsx`:
  - Mini `MapContainer` + `CircleMarker` (reuse the FleetMap pattern, `VITE_MAP_TILE_URL`), pin colored by online/stale.
  - Details: plate · fleet_no · address · speed · last-seen (relative) · online/stale badge · a small tag showing `resolved_by` (`auto` / `manual`).
  - Override: a "wrong truck?" affordance → searchable Select of devices (`useTransportDevices`) → `PUT`; a "reset to auto" → `DELETE`. Both invalidate the position query.
  - `resolved_by: none` → "No GPS device linked for this truck" + the picker to link one.
- Rendered as a card in `ShipmentDetail.tsx` beside the existing cards.

### Permissions

- View position: any user who can view the shipment (same gate as ShipmentDetail).
- Override (`PUT`/`DELETE`): shipment-edit permission — reuse the existing permission that allows editing a shipment's transport/vehicle fields. Confirmed in the plan.

### Error handling / edges

- No/garbage `truck_plate` → `none` (no error).
- Foreign truck with no device → `none` + picker (operator may link if a device does exist).
- Stale position (`fix_time` > `TRACCAR_STALE_MINUTES`) → `is_stale: true` → greyed pin + "updated Nh ago".
- Manual link points at a device later deleted → PROTECT prevents device deletion; not a runtime concern.
- Position endpoint returns `resolved_by: none, position: null` gracefully — the card renders its empty state, never errors.

### Testing

- Resolver: manual > auto > none; tractor-extraction + normalization against the real messy cases (`'4378AHF/2602TAH'` → `4378AHF`; `'AG2236/ TAH2526'`; foreign → none; `'sadas'` → none); device preference (positioned > truck-category > first).
- Endpoints: `position/` shapes for each `resolved_by`; `device/` PUT creates/replaces + DELETE clears; permission gate on PUT/DELETE; `devices/` list shape.
- Frontend: hook returns/normalizes; card renders each state (auto / manual / none / stale); override PUT/DELETE invalidates.

## Out of scope (future)

- Position history / breadcrumb trail; ETA to destination.
- Backfilling stored auto-links (auto stays computed).
- Any change to `Shipment`'s own fields, the Sheet, or document templates.
- Geofence-based lifecycle auto-timestamps (separate slice).

## Rollout / project rules

- Obsidian: extend `docs/obsidian/processes/fleet-map.md` (or a new page) + link in index.
- CHANGELOG + BUILD_TEST_LOG entries.
- MSSQL-safe (OneToOne, PROTECT, explicit max_length; no JSONField). No Django signals — the resolver is called explicitly by the endpoint.
- Continue on `feat/transport-fleet-map` (extends the same feature) unless a separate branch is preferred.
