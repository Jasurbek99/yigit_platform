# Transport trips from the Planning system — design

Date: 2026-09-29 · Branch: `feat/transport-trips` · Status: approved in chat, spec under review
Deadline: public test starts ~2026-10-06.

## 1. Goal

The transport department now plans trucks in **their own program** ("Planning",
`https://10.10.11.79:8444/api/v1/external`). For **regular (non-gapy) shipments** we stop picking
truck/trailer/driver from our TIR fleet. Instead:

1. Planning creates trips (tractor + trailer + driver) for trips the export side asked for.
2. We pull those trips into a local mirror.
3. The export manager joins a trip to a shipment on a new screen; countries must match.
4. We send Planning back the export code and the loading place (greenhouse block).
5. When Planning swaps a truck/trailer/driver or cancels a trip, the shipment reacts by its status.

**Gapy satys is unchanged** — it keeps `SheetGapyDriverEditor` and its own `assign_driver` task.

Contract source (theirs, not ours): `D:/projects/yigit_platform/docs/transport_api_docs/`
(`planning-integration-api.v1.yaml`, `CONTRACT-NOTES.md`, `README.md`) — untracked in the main tree.

## 2. Decisions taken in chat

| # | Decision |
|---|---|
| D1 | Contract is Planning's. We **poll** `GET /trips?changedSince=` (their push webhooks are "later" — not relied on). |
| D2 | Scope for this week = MVP (§11). `destination-city`, `cargo`, `events`, `customs`, `rejection` pushes are out. |
| D3 | Planning does not send passport **issue** date. We store `foreignPassport.expiryDate` in `driver_passport_issue_date` for now (field semantics documented; rename later). |
| D4 | `destinationCountryCode` is missing from the list response; Planning will add it. Until then we read it from `GET /trips/{id}`. |
| D5 | Change reaction by shipment status — table in §6. Rollback target is exactly `draft`. |
| D6 | In `yuklenme`: if any loading timestamp is entered (`loading_started_at` or `loading_ended_at`) the change is **not applied**; otherwise roll back to `draft`. |
| D7 | Trip `CANCELLED` → unlink + clear transport fields, same status rules as a change. |
| D8 | New screen joins trucks with shipments; country must match; trip card = main info, click = detail; current location shown. |
| D9 | `tasks.assign_driver` (non-gapy) is retired; new `tasks.choose_truck` for export_manager. |
| D10 | Transport fields of a shipment that has a trip are read-only in the Sheet; change only via unlink. |
| D11 | Mock mode so the demo survives if Planning is down. |

## 3. Architecture

Everything new lives in `backend/apps/transport/` (transport may import export; export must not import
transport). The shipment keeps only loose values it already has (`trip_id`, `truck_plate`, …).

```
Planning API ──poll (Celery beat 120s)──▶ transport.ExternalTrip (mirror)
                                              │  apply_trip_change()   ──▶ export.transition_to / rollback
Truck board (React) ──assign/unassign──▶ transport.services.trip_assignment ──▶ Shipment fields
                                              │
                                              └─ Celery push task ──▶ Planning POST export-code / loading
```

### 3.1 Model `transport.ExternalTrip`

| Field | Type | Source |
|---|---|---|
| `integration_trip_id` | UUIDField unique | `integrationTripId` |
| `trip_number` | Char(50) null | `tripNumber` (= our export code once pushed) |
| `status` | Char(30) | `status` (CREATED … CLOSED, CANCELLED, ARCHIVED) |
| `planned_departure` | Date | `plannedDeparture` |
| `changed_at` | DateTime | `changedAt` |
| `destination_country_code` | Char(5) null | `destinationCountryCode` (list later / detail now) |
| `tractor_plate`, `tractor_brand`, `tractor_model`, `tractor_company`, `tractor_source` | Char | `tractor.*` |
| `trailer_plate`, `trailer_brand`, `trailer_model`, `trailer_company`, `trailer_source` | Char | `trailer.*` |
| `driver_full_name`, `driver_phone` | Char (Cyrillic collation on name) | `driver.*` |
| `driver_passport_number`, `driver_passport_expiry` | Char / Date null | `driver.foreignPassport.*` |
| `driver_visas` | Char(500) | `driver.visas` as `Country:YYYY-MM-DD;…` (no JSONField — MSSQL) |
| `driver_source` | Char | `driver.source` |
| `shipment` | FK `export.Shipment`, null, `OneToOne`-style unique, `SET_NULL` | our link |
| `conflict_note` | Text null | set when a change was not applied (§6) |
| `last_push_status`, `last_push_error` | Char / Text null | result of our pushes |
| `synced_at` | DateTime | last time we wrote this row |

Plus a singleton-ish `ExternalTripSyncState` (one row): `cursor` (DateTime null), `last_success_at`,
`last_error`. The board reads it for "synced N min ago".

`Shipment.trip_id` (existing, unused BigInteger) stores `ExternalTrip.pk`. Verify it is NULL on every
live row before the first write.

## 4. Polling

`poll_external_trips` Celery task, added to `CELERY_BEAT_SCHEDULE` (120 s, `expires` 110) — not crontab.

1. Request `GET /trips?changedSince=<cursor − 5 min>&page=N&pageSize=200`, loop all pages.
   `changedSince` is strictly-after; the 5-minute overlap guards against same-timestamp rows and costs
   nothing because the upsert is idempotent.
2. For each item: upsert by `integration_trip_id`. If `destinationCountryCode` is absent and the stored
   value is null, call `GET /trips/{id}` once to fill it (D4).
3. **What counts as a change** (only these call `apply_trip_change`): the trip is linked to a shipment
   AND (tractor plate, trailer plate, driver name or driver passport differ from the stored snapshot,
   OR status became `CANCELLED`). A bump of `changedAt` from their status moves or from our own
   export-code push is **not** a change.
4. Cursor = max `changedAt` seen; saved only after the whole run succeeds.
5. On `TripsApiUnavailable` / 5xx / network error: keep cursor, write `last_error`, retry next tick.
   On `401`: same, plus notify `admin` once per hour.

## 5. Assigning a trip (the board's backend)

`transport/services/trip_assignment.py`:

- `assign_trip(trip, shipment, user)` — guards: shipment not gapy, not cancelled, no trip yet;
  trip free and not `CANCELLED/CLOSED/ARCHIVED`; `trip.destination_country_code == shipment.country.code`
  (**if the trip's code is null**: allowed only with `confirm_unknown_country=true`, the UI asks
  "country of trip is not set — assign anyway?"; otherwise 400). Then writes via a normal shipment
  save (so tasks resolve and audit runs):
  - `truck_plate = "{tractor_plate}/{trailer_plate}"` — the format every document already reads
    (`document_context.py` truck-plate helper).
  - `driver_name`, `driver_phone`, `driver_passport_serial = driver_passport_number`,
    `driver_passport_issue_date = driver_passport_expiry` (D3).
  - `truck_head_id` / `trailer_id` = our `TruckHead` / `Trailer` matched by normalised plate, else null.
    This keeps Traccar GPS matching working (`matching.py`). `driver_id` stays **null** — external
    drivers are not `transport.Driver` rows; documents fall back to `driver_passport_serial`
    (`_driver_passports()` already does fleet → persisted → typed).
  - `trip_id = trip.pk`; `trip.shipment = shipment`.
  - Enqueue pushes (§7).
- `unassign_trip(trip, user)` — clears the same fields and `trip_id`; the shipment goes through the §6
  status table (may roll back to `draft`; refused when locked).
- `move_trip(trip, to_shipment, user)` = unassign from A (refused if A is locked) + assign to B, one
  transaction.
- Our shipment cancelled or deleted → `trip.shipment` set to null, the trip returns to the free list.
  Nothing is sent to Planning (no such operation).

## 6. Reacting to a change / cancellation

`apply_trip_change(trip)` decides by the linked shipment's status:

| Shipment status | Tractor/trailer/driver changed | Trip `CANCELLED` |
|---|---|---|
| `draft` | apply new values; notify export_manager; comment "was → now" | unlink, clear fields; notify |
| `gumruk_girish`, `gumruk_chykysh` | apply + **rollback to `draft`**; notify export_manager + document_team | unlink + rollback to `draft` |
| `yuklenme`, no loading timestamp | apply + rollback to `draft` | unlink + rollback to `draft` |
| `yuklenme` with `loading_started_at` or `loading_ended_at` | **not applied** → `conflict_note` | **not unlinked** → `conflict_note` |
| `yola_chykdy` and later | not applied → `conflict_note` | not unlinked → `conflict_note` |

Every applied change and every conflict writes a shipment Comment (was → now) and a Notification to
export_manager (+ document_team on rollback).

### 6.1 Rollback mechanics

- **Not** a new edge in `TRANSITIONS`: that table feeds the manual `/transition/` UI and auto-advance
  edge selection. Instead a separate `ROLLBACK_TRANSITIONS = {'gumruk_girish': 'draft',
  'gumruk_chykysh': 'draft', 'yuklenme': 'draft'}` is checked inside `transition_to()` only when it is
  called with `rollback=True` (system actor, `is_auto=True`, comment = reason). `transition_to()` stays
  the only writer of status (CLAUDE.md rule).
- **Re-gate, otherwise auto-advance walks straight back:** draft tasks are not regenerated on re-entry
  (`generate_tasks_for_status` skips rules that already have a Task) and they are all DONE. So the
  rollback also:
  1. sets `documents_status = 'in_progress'` (was `ready`) and reopens the
     `tasks.start_documents_prep` task — documents must be redone for the new truck;
  2. clears `customs_exit_at` when rolling back from `gumruk_chykysh` or `yuklenme` (old value kept in
     the comment and audit log), so the customs step is not skipped either.
- **Clearing a conflict:** the export manager on the board either presses **Accept** (applies the
  Planning values despite the lock, clears `conflict_note`, no status change) or **Unlink**. Refetch on
  next poll never clears it by itself.

## 7. Pushes to Planning (MVP: two operations)

Celery task `push_trip_update(trip_id, op, payload, event_id, occurred_at)` with autoretry
(exponential, max 6).

| Op | When | Body |
|---|---|---|
| `export-code` | on assign, and when `Shipment.export_code` changes while linked | `{ exportCode }` |
| `loading` | on assign, and when block sources change while linked | `city` = `shipment.loading_location` name; `place.name` = block names joined `", "` in `ShipmentBlockSource` order, `place.ref` = first block code |

- `eventId` = `Idempotency-Key` = `ygt-{trip uuid}-{op}-{enqueue unix ms}`. `occurredAt` frozen at
  enqueue time. Retries reuse both, so a retry never gets `IDEMPOTENCY_KEY_REUSED`; a later correction
  (A→B→A) gets a new key.
- `409 TRIP_CLOSED` → give up, `last_push_status='closed'`. `409 DUPLICATE_EXPORT_CODE` or `422` → give
  up, show error on the shipment, notify export_manager. `401` → give up, notify admin. Network/5xx →
  retry. No outbox table in MVP.
- Skip `export-code` push when the shipment has no export code yet.

## 8. Config and mock

`.env`: `TRANSPORT_API_URL`, `TRANSPORT_API_KEY`, `TRANSPORT_API_MODE=live|mock`,
`TRANSPORT_API_VERIFY_TLS` (path to CA bundle or `false`; the server's cert is likely self-signed).

`transport/services/trips_client.py` mirrors `traccar_client.py` (`requests`, raises
`TripsApiUnavailable`). A `MockTripsClient` with the same interface is chosen when mode = `mock`:

- reads `transport/fixtures/external_trips.json` (the 6-trip response of 2026-09-29 plus
  `destinationCountryCode` filled);
- pushes are logged, not sent; `document` returns a bundled sample PDF;
- `python manage.py simulate_trip_change <uuid> [--driver NAME] [--tractor PLATE] [--trailer PLATE] [--cancel]`
  edits the fixture and bumps `changedAt`, so the next poll runs the full §6 chain on stage.

## 9. Frontend

### 9.1 Truck board `/export/truck-board`

Built on the `AssignmentBoard.tsx` pattern (two columns + match panel).

- **Left — shipments needing a truck:** non-gapy, not cancelled, `trip_id` null, status `draft`.
  Card: code, planned date, country, customer, blocks.
- **Right — trips:** free, status not `CANCELLED/CLOSED/ARCHIVED`. Card: planned departure, tractor /
  trailer plates, driver, GARAGE / third-party tag, **current location** (address or geofence +
  "N min ago"; "no GPS" when the plate has no Traccar device), ⚠ when driver has no valid visa for
  the country.
- **Country match:** selecting a shipment filters trips to its country (trips with unknown country
  shown in a separate greyed group, §5 confirm); selecting a trip filters shipments the same way.
- **Trip click → drawer:** every field, passport + expiry, visas, mini map with position, button
  "Trip documents (PDF)" (`GET /api/v1/transport/external-trips/{id}/document/` proxies Planning).
- **Match panel:** Assign · and for linked pairs a "Linked" tab with Unlink · Move · Accept (conflict).
- Header line: "synced N min ago" (yellow > 10 min) and a MOCK badge in mock mode.

Visa → country: Planning sends Turkmen names (`Gazagystan`, `Russiýa`, `Özbegistan`). Match by
normalised name against `Country.name_tk` plus a small alias map (`Özbegistan`→`UZ`, …). Unmatched visa
names are shown raw and never produce ⚠.

Location: plate → `TruckHead` → `traccar_device` → latest `DevicePosition` (reuse the fleet-map hooks).

### 9.2 Shipment detail

Transport block shows trip number + Planning status, PDF button, red `conflict_note` banner.

### 9.3 Sheet

For a non-gapy shipment with `trip_id` set, `truck_plate`, `driver_name`, `driver_phone`,
`driver_passport_*` are read-only. The existing fleet pickers stay for shipments without a trip
(legacy rows). Gapy untouched.

## 10. API, permissions, tasks

- Endpoints (`/api/v1/transport/`): `external-trips/` (list, filters `free`, `country`, `date`),
  `external-trips/{id}/`, `…/document/`, `…/assign/`, `…/unassign/`, `…/move/`, `…/accept-change/`,
  `external-trips/sync-state/`. Field names per `api-contract` skill.
- Permission page code `truck_board` in the matrix: edit = export_manager + privileged roles,
  view = transport. Every new role list goes through the touch list in memory.
- Task rules: deactivate `tasks.assign_driver` (condition `is_gapy_satys=False`); add
  `tasks.choose_truck` — step `draft`, role `export_manager`, `target_fields='trip_id'`,
  `ALL_FIELDS_FILLED`, condition `is_gapy_satys=False`. New drafts only (no backfill).
- i18n en/ru/tk; `docs/obsidian/` pages for the board, ExternalTrip, the poller; CHANGELOG;
  BUILD_TEST_LOG.

## 11. Build order and cut line

1. **Demo path:** model + client + mock + poll · board (both columns, country filter, drawer, location,
   PDF) · assign/unassign · `choose_truck` task.
2. Change engine: §6 table, rollback in `transition_to`, re-gate, conflicts, `simulate_trip_change`.
3. Pushes (§7).
4. Sheet read-only (§9.3) — touches the 4 Sheet permission enforcement points; last because it is the
   riskiest and least visible.

If the week slips, 3 and 4 move after the public test; 1 and 2 are the demo.

## 12. Testing

Backend: poll upsert, paging, overlap cursor, detail fill for missing country; change detection
ignores status-only bumps; every row of §6 incl. rollback via `transition_to(rollback=True)` and the
re-gate (a save after rollback does **not** auto-advance); cancel; move + locked refusal; country
guard + unknown-country confirm; plate → TruckHead match; idempotency key stable across retries and new
for corrections; `TRIP_CLOSED` / `DUPLICATE_EXPORT_CODE` handling; mock client; `choose_truck` rule;
`TestEveryRoleCanEditItsOwnSheetRow` after §9.3.
Frontend: board filters by country, drawer, conflict banner, read-only Sheet cells.

## 13. Open items (not blocking)

- API key for live — needed before any live check (a GET without it returns 401).
- Planning adds `destinationCountryCode` to the list response.
- Planning has a passport for 1 of 95 own drivers — documents will print blanks until they fill it.
- Rename `driver_passport_issue_date` semantics (D3) after Planning's data settles.
