---
title: Fleet Map (Traccar GPS)
tags: [process, backend, frontend, transport, traccar, gps, fleet-map]
related: [[worklog]], [[../screens/team-kpi]]
---

# Fleet Map (Traccar GPS)

## What Is This Feature?

Live truck positions on a map, sourced from the office's existing **Traccar** GPS server
(`10.10.11.79:8082`). Lives in a new standalone Django app, `apps.transport` — a registry
of trucks/drivers/devices plus a 1-minute poller that keeps a "last known position" table
in our own DB. The `/api/v1/transport/live-positions/` endpoint and the `/transport/map`
page **never** call Traccar in the request path; they only ever read our DB, so a slow or
down Traccar server cannot slow down or break the app for users looking at the map.

`apps.transport` depends **only on `apps.core`** (for the shared `schema_table` /
`cyrillic_collation` DB helpers) — it does not touch `greenhouse`/`export`/`contracts`/
`finance`, and nothing in those apps depends on it. It hangs off `core` as its own leaf,
a sibling of `greenhouse` in the `core ← greenhouse ← export ← contracts ← finance` chain.
`Truck` is a new, separate registry; it is **not** linked to `Shipment` in this slice (see
Out of Scope).

## How It Works (Business Flow)

```mermaid
flowchart LR
    A["seed_traccar_devices<br/>(one-time, idempotent)"] --> B["Truck + TraccarDevice rows<br/>created from Traccar's /api/devices"]
    B --> C["Cron every 1 min:<br/>poll_traccar_positions"]
    C --> D["TraccarClient.get_positions()<br/>GET /api/positions"]
    D --> E["sync_positions():<br/>upsert latest DevicePosition<br/>per known device"]
    E --> F["GET /api/v1/transport/live-positions/<br/>reads DB only, never Traccar"]
    F --> G["FleetMap page<br/>(react-leaflet, 30s refetch)"]
```

If Traccar is unreachable, `TraccarClient` raises `TraccarUnavailable`; both management
commands catch it, log a warning, and exit non-fatally — the last-known `DevicePosition`
rows stay as-is and the next scheduled poll retries.

## Data Model

Four models in `backend/apps/transport/models/registry.py`, table prefix `transport.*`
(`schema_table('transport', ...)`).

### `Truck`

| Field | Type | Notes |
|---|---|---|
| `plate` | CharField(20), unique | |
| `fleet_no` | CharField(10), unique, null | `TR##` token parsed off the Traccar device name |
| `category` | CharField(20), choices `truck`/`trailer`/`unknown` | default `unknown` |
| `is_active` | Boolean | default `True` |

### `Driver`

| Field | Type | Notes |
|---|---|---|
| `name` | CharField(100), Cyrillic collation | |
| `phone` | CharField(30), null | |
| `is_active` | Boolean | default `True` |

Not yet linked to `Truck`/`TraccarDevice` — see Out of Scope.

### `TraccarDevice`

| Field | Type | Notes |
|---|---|---|
| `traccar_id` | IntegerField, unique | Traccar's own device `id` |
| `imei` | CharField(32), null | Traccar's `uniqueId` |
| `name` | CharField(100), Cyrillic collation | raw Traccar device name, e.g. `"12 AB 3456 TR07"` |
| `category` | CharField(20), null | |
| `truck` | FK → `Truck`, PROTECT, null | set by `sync_devices` |
| `status` | CharField(10) | Traccar's own `online`/`offline`/`unknown` |
| `last_seen` | DateTimeField, null | Traccar's `lastUpdate` |

### `DevicePosition`

Latest known position for a device — **one row per device**, upserted (not a history table).

| Field | Type | Notes |
|---|---|---|
| `device` | OneToOne → `TraccarDevice`, CASCADE, `related_name='position'` | |
| `latitude` / `longitude` | Decimal(9,6) | |
| `speed` | Decimal(6,2), null | km/h, from Traccar |
| `course` | Decimal(5,1), null | heading in degrees |
| `address` | CharField(300), null, Cyrillic collation | reverse-geocoded by Traccar, truncated to 300 |
| `ignition` | Boolean, null | from Traccar's `attributes.ignition` |
| `fix_time` | DateTimeField, null | when Traccar fixed the position (not when we polled) |
| `valid` | Boolean | default `True`; the API only serves `valid=True` rows |
| `updated_at` | DateTimeField, `auto_now` | when we last upserted this row |

## Traccar Client (read-only)

`backend/apps/transport/services/traccar_client.py` — `TraccarClient` wraps two read-only
Traccar REST calls, `GET /api/devices` and `GET /api/positions`, both via
`Authorization: Bearer {TRACCAR_TOKEN}`. `TraccarClient` never issues a write to Traccar.
Any network error, non-2xx status, or non-JSON body raises `TraccarUnavailable`.

### Settings (`.env`)

| Var | Default | Purpose |
|---|---|---|
| `TRACCAR_BASE_URL` | `''` | e.g. `http://10.10.11.79:8082` |
| `TRACCAR_TOKEN` | `''` | Bearer token for a **dedicated read-only** Traccar account — never a personal login, never exposed to the browser |
| `TRACCAR_STALE_MINUTES` | `15` | age threshold for `is_stale` in the API response |

## Sync Service

`backend/apps/transport/services/sync.py`:

- **`parse_device_name(name)`** — splits a Traccar device name of the form
  `"<PLATE> TR<NN>"` (case-insensitive `TR\d+` suffix) into `(plate, fleet_no)`. No
  trailing `TR##` token → returns `(whole_name, None)`.
- **`sync_devices(client=None)`** — pulls `get_devices()`, `update_or_create`s a `Truck`
  per parsed plate and a `TraccarDevice` per Traccar device id. Idempotent — safe to
  re-run.
- **`sync_positions(client=None)`** — pulls `get_positions()`, upserts one
  `DevicePosition` per **known** device (looked up by `traccar_id`). Positions for a
  `deviceId` with no matching `TraccarDevice`, or with a null `latitude`, are skipped and
  logged as a warning — they never raise.

## Management Commands

| Command | Type | Schedule |
|---|---|---|
| `seed_traccar_devices` | one-time, idempotent | run manually once (and again if new trucks/devices are added in Traccar) |
| `poll_traccar_positions` | recurring | **every 1 minute** — mirrors `archive_shipments`'s cron pattern |

```cron
* * * * * cd /app/backend && python manage.py poll_traccar_positions
```

```
Windows Task Scheduler: run `python manage.py poll_traccar_positions` every 1 minute.
```

Both commands catch `TraccarUnavailable` and exit non-fatally (warning for the poller,
error for the seed command) — a down Traccar server never crashes the schedule, it just
means positions go stale until Traccar comes back.

## REST Surface

`GET /api/v1/transport/live-positions/` — `IsAuthenticated`, no role gate, no pagination
(bare list — bounded to one row per device). Reads `DevicePosition.objects.filter(valid=True)`
with `select_related('device', 'device__truck')`; never calls Traccar.

Response item shape (`LivePositionSerializer`, DB columns → API field names per
`api-contract`):

```jsonc
{
  "device_id": 42,       // device.traccar_id
  "plate": "12 AB 3456", // device.truck.plate, null if unmatched
  "fleet_no": "TR07",    // device.truck.fleet_no, null if unmatched
  "status": "online",    // device.status (Traccar's own value)
  "lat": 37.95,          // latitude, float
  "lon": 58.39,          // longitude, float
  "speed": 62.5,         // float or null
  "course": 184.0,       // float or null
  "address": "…",        // string or null
  "fix_time": "2026-07-30T09:14:00Z",
  "is_online": true,     // status == 'online'
  "is_stale": false      // now - fix_time > TRACCAR_STALE_MINUTES
}
```

## Fleet Map Page

Route `/transport/map`, nav entry "Fleet Map" (`nav.fleet_map`, Turkmen/Russian/English —
`fleet_map.*` keys in all three locale files). **No `transport.map` page_code registered
yet** — same bypass as `worklog`/`team/kpi`: `ProtectedRoute` with no `pageCode`, open to
every authenticated role (see `frontend/src/App.tsx`, `AppLayout.tsx`).

`react-leaflet@4.2.1` + OpenStreetMap tiles (`VITE_MAP_TILE_URL` env override, default
`{s}.tile.openstreetmap.org`), default view centred on Ashgabat
(`[37.95, 58.39]`, zoom 5, matching the Traccar server's own coverage). A searchable
sidebar (plate / fleet_no / address) list next to the `MapContainer`; each truck is a
`CircleMarker` colour-coded by state:

| Colour | Meaning |
|---|---|
| Grey | `is_stale` (no recent fix, regardless of online/offline) |
| Green | `is_online` and not stale |
| Amber | known but offline, not stale |

## Code Map

| Concern | File |
|---|---|
| Models | [`backend/apps/transport/models/registry.py`](../../../backend/apps/transport/models/registry.py) |
| Migration | [`backend/apps/transport/migrations/0001_initial.py`](../../../backend/apps/transport/migrations/0001_initial.py) |
| Traccar client | [`backend/apps/transport/services/traccar_client.py`](../../../backend/apps/transport/services/traccar_client.py) |
| Sync service | [`backend/apps/transport/services/sync.py`](../../../backend/apps/transport/services/sync.py) |
| Seed command | [`backend/apps/transport/management/commands/seed_traccar_devices.py`](../../../backend/apps/transport/management/commands/seed_traccar_devices.py) |
| Poll command | [`backend/apps/transport/management/commands/poll_traccar_positions.py`](../../../backend/apps/transport/management/commands/poll_traccar_positions.py) |
| Serializer | [`backend/apps/transport/serializers.py`](../../../backend/apps/transport/serializers.py) |
| ViewSet | [`backend/apps/transport/views.py`](../../../backend/apps/transport/views.py) |
| URLs | [`backend/apps/transport/urls.py`](../../../backend/apps/transport/urls.py) (mounted at `api/v1/transport/`) |
| Tests | `backend/apps/transport/tests/` (`test_models.py`, `test_traccar_client.py`, `test_sync.py`, `test_commands.py`, `test_api.py` — 22 cases) |
| Query hook | [`frontend/src/hooks/useLivePositions.ts`](../../../frontend/src/hooks/useLivePositions.ts) — `ILivePosition`, 30s `refetchInterval` |
| Page | [`frontend/src/pages/transport/FleetMap.tsx`](../../../frontend/src/pages/transport/FleetMap.tsx) |
| Route + nav | `frontend/src/App.tsx` (`transport/map`), `frontend/src/components/AppLayout.tsx` (`nav.fleet_map`) |

## Out of Scope (this slice)

- **No `Shipment` ↔ `Truck` link** — the transport registry is standalone; a truck on the
  map is not (yet) tied to a shipment/trip.
- **No position history** — `DevicePosition` is upsert-latest-only, one row per device.
  A trail/history table would be a separate model + endpoint.
- **No geofence-driven timestamps** — AD-1's shipment lifecycle timestamps are still
  written only by `transition_to()`; this feature does not auto-advance shipment status
  from GPS geofence events.
- **No reefer temperature/humidity** — Traccar can carry these as device attributes, not
  wired in this slice.
- **No trips/routes** — no start/end/route replay, just a live snapshot.
- **`transport.map` page_code** — not registered; the page is open-to-all-authenticated
  as a deliberate interim choice, matching `worklog`/`team/kpi`. Restricting it to
  specific roles is a future backend follow-up (add the page_code + permission entries).

## Verification

1. **Seed**: `python manage.py seed_traccar_devices` — creates `Truck`/`TraccarDevice`
   rows from Traccar; re-running is a no-op (idempotent `update_or_create`).
2. **Poll**: `python manage.py poll_traccar_positions` — updates `DevicePosition` rows;
   stop Traccar (or point `TRACCAR_BASE_URL` at nothing) and re-run — command prints a
   warning and exits 0, existing rows untouched.
3. **API**: `GET /api/v1/transport/live-positions/` as an authenticated user returns the
   JSON list above; unauthenticated → 401/403.
4. **Page**: `/transport/map` shows the sidebar + map, pins colour-matching device state;
   typing in the search box filters both the list and the pins; wait 30s and confirm the
   list quietly refetches (no full-page reload).
5. **Backend tests**: `python manage.py test apps.transport` — 22 cases across 5 files.
