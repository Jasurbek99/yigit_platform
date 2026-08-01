# Traccar Fleet Map — Design (Slice 1)

**Date:** 2026-07-30
**Status:** Approved (design), pending implementation plan
**Module:** new `transport` app (deps: `core`, `export` — none touched in this slice)

## Goal

Show YGT's export trucks on a live map, backed by the fleet's existing Traccar
GPS server. This is the first slice of a larger Traccar integration; it is
deliberately the smallest end-to-end feature that delivers visible value while
building the reusable poller/registry foundation the later slices need.

## Context (verified against the live server)

- Traccar **v6.14.4** at `http://10.10.11.79:8082`, timezone `Asia/Ashgabat`.
- **95 devices** = the whole fleet. Teltonika **FMC650** trackers.
- Device name convention: `<PLATE> TR<NN>` — e.g. `2189AHF TR038`. The first
  token is the vehicle plate; `TR01`–`TR91` is a stable internal fleet number.
  Trailers are separate devices (`category: trailer`).
- Positions carry: `latitude`, `longitude`, `speed`, `course`, `altitude`,
  reverse-geocoded `address` (in Turkmen, e.g. "Artyk Gümrük Posty Ýoly"),
  `fixTime`, `valid`, plus attributes `ignition`, `motion`, `odometer`,
  engine `hours`, `fuel`, `rpm`, and reefer sensors `temp1/2/3`, `humidity`.
- **31 geofences** already exist (greenhouses, customs posts, destination
  cities) — reserved for a later auto-timestamp slice, not used here.
- Backend has **no task queue** (Celery commented out). Periodic jobs run as
  management commands via cron / Windows Task Scheduler (precedent:
  `apps/export/management/commands/archive_shipments.py`).
- Frontend has **ECharts** (`echarts` 6, `echarts-for-react`); no Leaflet yet.

## Decisions (from brainstorming)

1. **First feature:** Fleet Map page (all trucks on one map) — simplest,
   most visible, fully decoupled from `Shipment`.
2. **Registry, not free-text:** dedicated `Truck` and `Driver` tables.
3. **No Shipment link this slice:** standalone registry; do not touch
   `Shipment`, Sheet, document templates, or importers.
4. **Data flow = Approach B (poll into our DB):** a management command polls
   Traccar and upserts positions into our DB; the API and frontend read our DB,
   never Traccar directly. Chosen over read-through proxy because every later
   slice (auto-timestamps, cold-chain) needs stored data, so the poller is not
   throwaway work.
5. **Map:** `react-leaflet` + OSM tiles, tile URL from env
   (`VITE_MAP_TILE_URL`). ECharts geo-scatter is the documented offline
   fallback, implemented only if OSM tiles are confirmed blocked on the prod
   network.

## Architecture

### App

New Django app `apps/transport`. Registered in `INSTALLED_APPS`. Dependency
direction respected (`transport` may import `core`/`export`; nothing imports
`transport`). `models/` package with `__init__.py` re-exports (per project
rule, or a single `models.py` if it stays under 200 lines).

### Data model (all MSSQL-safe)

`Truck`
- `plate` — CharField(20), unique
- `fleet_no` — CharField(10), unique, null (the `TR##` token)
- `category` — CharField(20) choices: truck / trailer / unknown
- `is_active` — BooleanField(default=True)

`Driver`
- `name` — CharField(100), `db_collation='Cyrillic_General_CI_AS'`
- `phone` — CharField(30), null
- `is_active` — BooleanField(default=True)

`TraccarDevice` (maps a Traccar device to one of our trucks)
- `traccar_id` — IntegerField, unique (Traccar's device `id`)
- `imei` — CharField(32), null (Traccar `uniqueId`)
- `name` — CharField(100) (raw Traccar device name)
- `category` — CharField(20), null
- `truck` — FK→`Truck`, `on_delete=PROTECT`, null (link may be unresolved)
- `status` — CharField(10) (online / offline / unknown)
- `last_seen` — DateTimeField, null (Traccar `lastUpdate`)

`DevicePosition` (latest snapshot per device — one row per device, upserted)
- `device` — OneToOneField→`TraccarDevice`, `on_delete=CASCADE`
- `latitude` — DecimalField(max_digits=9, decimal_places=6)
- `longitude` — DecimalField(max_digits=9, decimal_places=6)
- `speed` — DecimalField(max_digits=6, decimal_places=2), null (km/h)
- `course` — DecimalField(max_digits=5, decimal_places=1), null
- `address` — CharField(300), null, Cyrillic collation
- `ignition` — BooleanField, null
- `fix_time` — DateTimeField, null (Traccar `fixTime`)
- `valid` — BooleanField(default=True)
- `updated_at` — DateTimeField(auto_now=True)

`DevicePosition` is intentionally **not** append-only history. History and
geofence-event tables belong to the auto-timestamp slice.

### Services

`services/traccar_client.py` — `TraccarClient`
- Reads `TRACCAR_BASE_URL` + `TRACCAR_TOKEN` from settings/env.
- `get_devices() -> list[dict]`, `get_positions() -> list[dict]`.
- Read-only. Never issues writes to Traccar.
- Raises a typed `TraccarUnavailable` on network/auth failure.

`services/sync.py`
- `sync_positions()` — fetch devices + positions, upsert `DevicePosition` per
  device keyed on `traccar_id`, update `TraccarDevice.status`/`last_seen`.
  `bulk_update`/`bulk_create` with `batch_size=500`. On `TraccarUnavailable`,
  log and return without mutating existing rows (last-known survives).
- `parse_device_name(name) -> (plate, fleet_no)` — split `<PLATE> TR<NN>`;
  returns `(name, None)` when the pattern doesn't match. Unit-tested.

### Management commands

- `poll_traccar_positions` — calls `sync_positions()`. Scheduled every 1 min
  via cron (Linux beta host) / Windows Task Scheduler. Mirrors
  `archive_shipments` docstring pattern for the schedule entry.
- `seed_traccar_devices` — one-time, idempotent. Pulls the 95 devices, parses
  names, creates/links `Truck` + `TraccarDevice`. Safe to re-run (upsert).

### API

`GET /api/v1/transport/live-positions/` — DRF read-only ViewSet,
`IsAuthenticated`. Reads our DB only (never Traccar in the request path).

Response item (field naming per `api-contract` skill — API names ≠ DB columns):
```json
{
  "device_id": 74,
  "plate": "2189AHF",
  "fleet_no": "TR038",
  "status": "online",
  "lat": 37.544905,
  "lon": 59.312225,
  "speed": 0,
  "course": 298,
  "address": "Artyk Gümrük Posty Ýoly",
  "fix_time": "2026-07-30T05:26:28Z",
  "is_online": true,
  "is_stale": false
}
```
`is_stale` = `fix_time` older than a configurable threshold (default 15 min).
Only devices that have a `DevicePosition` with a valid `latitude`/`longitude`
are returned. Trailers and never-positioned devices are omitted (they cannot be
placed on the map).

### Frontend

New page `/transport/map` — "Fleet Map", plus a nav entry.
- `react-leaflet` + `leaflet`; tile URL from `VITE_MAP_TILE_URL` (default OSM).
- Status-colored pins; popup shows plate, fleet_no, address, speed, last-seen.
- Searchable sidebar list of trucks (status dot, last address, relative time);
  clicking an item flies the map to that pin.
- TanStack Query hook `useLivePositions()` with `refetchInterval: 30_000`.
- Stale pins (`is_stale`) rendered greyed out.
- **ECharts geo-scatter fallback**: a `<FleetMapEcharts>` component behind the
  same `useLivePositions()` hook, built only if OSM tiles are confirmed blocked.

### Configuration & security

- `.env`: `TRACCAR_BASE_URL`, `TRACCAR_TOKEN`; documented in `.env.example`.
- Use a **dedicated read-only Traccar account/token**, not the shared admin
  login. The token is server-side only; the browser never receives Traccar
  credentials (respects the httpOnly-cookie auth model).
- Frontend: `VITE_MAP_TILE_URL` in the frontend env.

### Error handling

- Traccar unreachable during a poll → logged, existing rows untouched
  (last-known positions remain visible, flagged stale as they age).
- API always serves from our DB, so a Traccar outage never breaks the page.
- Malformed/absent position (no `latitude`) → device skipped that cycle.

### Testing

- `parse_device_name` — plate/fleet split incl. non-matching names, trailers.
- `sync_positions` — upsert creates then updates a single row per device;
  Traccar-unavailable path leaves rows intact. `TraccarClient` mocked; no live
  network calls in tests.
- API — response shape and field renaming; `is_stale` threshold boundary.
- Frontend — hook returns/normalizes rows; pin status/stale rendering
  (component test as the existing suite allows).

## Out of scope (future slices)

- Shipment ↔ Truck/Driver link (FK on `Shipment`).
- Position history + geofence enter/exit events.
- Auto-fill of AD-1 lifecycle timestamps from geofence events.
- Reefer cold-chain (`temp1/2/3`, `humidity`) monitoring + alerts.
- Trips / proof-of-delivery breadcrumbs.
- Any write back to Traccar.

## Rollout / project-rule checklist

- Obsidian docs: new page under `docs/obsidian/` + link in `00-index.md`.
- `CHANGELOG.md` entry (Added).
- `BUILD_TEST_LOG.md` entry — mark NEEDS TEST.
- Commit per logical unit (models, services, command, API, frontend, docs).
