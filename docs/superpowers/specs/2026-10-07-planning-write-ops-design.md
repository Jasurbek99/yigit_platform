# Planning API — remaining write operations (design)

Date: 2026-10-07. Branch: `feat/planning-write-ops` (worktree `../yigit_platform-planning-ops`).
Contract: `docs/transport_api_docs/planning-integration-api.v1.yaml` v1.3-draft, notes in
`CONTRACT-NOTES.md` §1.3–§1.4.

## Goal

We already push `export-code` and `loading` to Planning. Connect the other five write
operations of the contract: `destination-city`, `cargo`, `events`, `customs`, `rejection`.

## Part 1 — automatic sync (destination-city, cargo, events, customs)

Extend `PUSH_OPS` in `backend/apps/transport/services/trip_push.py`. Each op keeps the existing
shape `(body builder, signature, ExternalTrip marker column)` plus the URL path segment and an
optional `occurredAt` source. Sending works exactly as today: on assign
(`trip_assignment.assign_trip` calls `enqueue_push` for every op) and on every poll tick via
`push_pending_corrections` when the signature differs from the marker. Retries, the
`Idempotency-Key = eventId` rule, `TRIP_CLOSED` handling and the export_manager notification on
refusal are reused unchanged.

| op key | path | body (besides envelope) | source on Shipment | skipped when | `occurredAt` |
|---|---|---|---|---|---|
| `destination-city` | `destination-city` | `{city: City.name}` | `city` | `city` is null | now |
| `cargo` | `cargo` | `{cargoName: name_ru or name, cargoRef: code}` (`cargoRef` omitted if no code) | `product_type` | `product_type` is null | now |
| `event-arrived` | `events` | `{type: ARRIVED_AT_PLACE, place}` | `greenhouse_arrived_at` | field is null | the field value |
| `event-loaded` | `events` | `{type: LOADED, place}` | `loading_ended_at` | field is null | the field value |
| `event-departed` | `events` | `{type: DEPARTED_FROM_PLACE, place}` | `departed_at` | field is null | the field value |
| `customs` | `customs` | `{cleared: true}` | `customs_entry_at` («Таможня пройдена», destination-country customs; `customs_exit_at` is the Turkmen export customs and is not sent) | field is null | the field value |

`place` for events is the same `{ref, name}` that `loading_body` builds from the block sources;
it is omitted when the shipment has no block sources.

Signatures: city name; `cargoName|cargoRef`; the ISO timestamp for events and customs.

`event_id` must stay unique per op: `build_event` already embeds the op key, so
`event-arrived` and `event-loaded` never share an Idempotency-Key.

### Accepted limitations

1. Clearing a field after it was pushed sends nothing — the contract has no way to retract
   an event or customs mark (`cleared:false` is not sent).
2. Correcting an event / customs time sends a second message with the new `occurredAt`;
   Planning's history then shows both.
3. A city outside the trip's destination country is refused by Planning
   (`422 CITY_COUNTRY_MISMATCH`); this goes through the existing refusal path
   (`last_push_error` + export_manager notification). The marker is kept, so it is not
   re-sent until the manager changes the city.
4. An event / customs time earlier than `ExternalTrip.linked_at` (when the trip joined its
   current shipment) is not sent — after a truck change it belongs to the previous truck.
   Links made before the column existed have `linked_at` NULL and are not filtered.
   This also applies to a first link: `assign_trip` itself never sends events/customs
   already filled, and a truck linked late (after it already arrived) never sends that
   arrival — accepted trade-off (user decision 2026-10-07, option a).

### Model

Migration `transport/0011`: six nullable columns on `ExternalTrip`:
`last_pushed_destination_city` (CharField 256, Cyrillic collation), `last_pushed_cargo`
(CharField 400, Cyrillic collation), `last_pushed_arrived`, `last_pushed_loaded`,
`last_pushed_departed`, `last_pushed_customs` (CharField 40 — ISO timestamp strings).

`push_pending_corrections` adds `shipment__city` and `shipment__product_type` to its
`select_related`.

## Part 2 — trip rejection

### Backend

- Same migration adds `rejection_reason` (CharField 512, Cyrillic collation, null),
  `rejected_at` (DateTimeField, null), `rejected_by` (FK `core.User`, `SET_NULL`, null).
- New action `POST /api/v1/transport/external-trips/{id}/reject/` (same router as `assign`),
  body `{reason}`; permission `CanAssignTrips` like assign.
  - `reason` empty or > 512 chars → `400 reason_required` / `400 reason_too_long`.
  - trip linked to a shipment → `409 trip_linked`; trip in `CLOSED_STATUSES` → `409 trip_closed`.
  - a trip already rejected → `409 trip_rejected`, unless its last push failed
    (`last_push_error` starts with `rejection:`): then it can be rejected again.
  - Otherwise store the three fields and enqueue the one-shot push `rejection`
    (`{reason}`; not part of the correction loop, no marker column). Returns the trip payload.
- `assign` / `move` onto a rejected trip → `409 trip_rejected` (`AssignmentError`).
- `trip_sync._upsert`: when `is_real_change(old, fields)` is true (resource swap or cancel),
  clear the three rejection fields — for unlinked trips too (today `_upsert` only returns
  linked trips; the clearing happens before that return).
- `ExternalTripSerializer` exposes `rejection_reason`, `rejected_at`, `rejected_by_name`.

### Frontend (Truck Board)

- `TripDrawer` only: «Отклонить» button on free, non-closed trips for users who can assign.
  Opens a modal with a required reason (max 512). The card shows the rejected tag and, when the
  push failed, the error — no button. A rejected trip can be rejected again only while its last
  rejection push failed (else `409 trip_rejected`); the drawer hides the button otherwise.
- A rejected trip stays on the board with a tag «Отклонён: <причина>»; its assign action is
  disabled. The tag disappears after the next poll that brings a real change.
- `useExternalTrips.ts`: `useRejectTrip` mutation; types gain the three fields.
- i18n keys in ru / tk / en.

## Testing

- Backend unit tests per op: body builder output, skip-when-null, signature change → one push,
  unchanged → no push, `occurredAt` = field value for events/customs.
- Reject endpoint: happy path enqueues push, 400/409 cases, assign refused while rejected,
  real change in sync clears rejection.
- `push_trip_update` passes the op's path segment (not the op key) to `post_op`, so the three
  event ops all POST to `events`; error messages and markers keep the op key. Mock client
  already logs any path; no client change needed.
- Frontend: TripDrawer shows / hides the reject button; TripCard renders the rejected tag; modal requires reason.

## Out of scope

- Receiving Planning's own event history back (read side unchanged).
- Retracting events / customs (`cleared:false`).
- Rejecting trips that are already linked (unassign first).

## Docs

Update `docs/obsidian/processes/truck-board.md` (pushed ops table, rejection flow) and
`CHANGELOG.md`; append `BUILD_TEST_LOG.md`.
