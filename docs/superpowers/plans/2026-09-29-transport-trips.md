# Transport Trips (Planning integration) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Regular (non-gapy) shipments get their tractor/trailer/driver from trips planned in the external Planning system; the export manager joins trips to shipments on a new Truck Board, and Planning changes/cancellations roll the shipment back by status.

**Architecture:** A local mirror `transport.ExternalTrip` is filled by a Celery-beat poller from `GET /trips?changedSince=`. A service layer in `apps/transport/services/` assigns trips to shipments (writing the existing loose Shipment transport fields), reacts to changes via a status table, and pushes export-code / loading back. `export` gains a system-only rollback path inside `transition_to()`. A mock client with the same interface keeps the demo alive when Planning is down.

**Tech Stack:** Django 5 + DRF, MSSQL (mssql-django), Celery beat, `requests`; React 18 + TS, antd, TanStack Query, react-leaflet, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-transport-trips-design.md` (read it first — section numbers below refer to it).
Contract of the external API: `D:/projects/yigit_platform/docs/transport_api_docs/planning-integration-api.v1.yaml` + `CONTRACT-NOTES.md` (untracked, main tree).

**Worktree:** `D:/projects/ygt_transport-trips`, branch `feat/transport-trips`. All paths below are relative to it. Backend commands run from `backend/`, frontend from `frontend/`.

## Global Constraints

- MSSQL: no JSONField / ArrayField / DISTINCT ON; `bulk_create(..., batch_size=500)`; Cyrillic text fields get `db_collation='Cyrillic_General_CI_AS'` (use the project helper `cyrillic_collation()` from `apps.core` as other models do); every CharField has `max_length`.
- Status changes ONLY through `apps.export.services.shipment.transition_to()`.
- Dependency direction: `transport` may import `export` and `core`; `export` must NOT import `transport`. No Django signals.
- Scheduled jobs go in `CELERY_BEAT_SCHEDULE` (config/settings.py), never crontab.
- Gapy satys (`Shipment.is_gapy_satys=True`) behaviour must not change anywhere.
- `truck_plate` format is `"{tractor_plate}/{trailer_plate}"`.
- Planning's passport expiry goes into `Shipment.driver_passport_issue_date` (spec D3).
- Idempotency-Key = eventId = `ygt-{trip uuid}-{op}-{enqueue unix ms}`.
- Migration numbers: check free before writing — `ls backend/apps/<app>/migrations/ | tail -3` and `git log --oneline origin/main -5`. Expected next: transport `0009`, core `0066`. Apply with `python manage.py migrate <app>` right after `makemigrations`.
- Worktree `backend/.env` lacks `TRANSPORT_API_*`; copy those lines from `D:/projects/yigit_platform/backend/.env` (never print the key).
- Never commit without the user's instruction per CLAUDE.md: each task's "Commit" step is executed only when the user said "commit" for this execution run (the user approves execution mode at handoff). `git status` + `git diff --cached` before every commit; add explicit paths only.
- Concurrent test runs share `test_YIGIT_PLATFROM` — run backend tests one process at a time.
- After every built task: append `- [ ] 2026-09-29 — <what> — NEEDS TEST` to `BUILD_TEST_LOG.md` (done once in Task 12 for the whole feature).

## Review Focus

1. Two trips sharing the same `changedAt` across a page boundary / poll boundary — nothing is skipped (5-minute overlap + idempotent upsert). Test in Task 3.
2. A save on a shipment right after rollback must NOT auto-advance it back to customs. Test in Task 7.
3. Two export managers assigning the same trip at once — second gets a 409 with a readable error, not a 500. Test in Task 4.
4. Trip with `destination_country_code = null` — assign refused without confirm, allowed with `confirm_unknown_country=true`; board shows it greyed. Tests in Task 4 and Task 6.
5. Planning bumps `changedAt` only because of a status move (e.g. CREATED→PLANNED) — no rollback, no comment. Test in Task 3.
6. Visa country names that match nothing (`Eýran Yslam Respublikasy`) — shown raw, never a ⚠. Test in Task 4.

---

## File map

Backend (new):
- `backend/apps/transport/models/external_trip.py` — `ExternalTrip`, `ExternalTripSyncState`.
- `backend/apps/transport/services/trips_client.py` — `TripsClient`, `MockTripsClient`, `TripsApiUnavailable`, `get_trips_client()`.
- `backend/apps/transport/services/trip_parsing.py` — `parse_trip(item) -> dict`, `visa_country_codes(visas_csv) -> list[str]`.
- `backend/apps/transport/services/trip_sync.py` — `sync_external_trips(client=None) -> list[ExternalTrip]`.
- `backend/apps/transport/services/trip_assignment.py` — `assign_trip`, `unassign_trip`, `move_trip`, `accept_trip_change`, `apply_trip_change`, `AssignmentError`.
- `backend/apps/transport/services/trip_push.py` — `enqueue_push`, `push_export_code`, `push_loading`.
- `backend/apps/transport/services/sync_user.py` — `get_sync_user()`.
- `backend/apps/transport/views_trips.py`, `backend/apps/transport/serializers_trips.py`.
- `backend/apps/transport/fixtures/external_trips.json`.
- `backend/apps/transport/management/commands/simulate_trip_change.py`.
- `backend/apps/export/services/rollback.py` — `rollback_to_draft`, `is_transport_locked`, `reopen_rule_task`.
- Tests: `backend/apps/transport/tests/test_trips_client.py`, `test_trip_sync.py`, `test_trip_assignment.py`, `test_trip_api.py`, `test_trip_change.py`, `test_trip_push.py`; `backend/apps/export/tests_rollback.py`.

Backend (modify): `transport/models/__init__.py`, `transport/tasks.py`, `transport/urls.py`, `transport/permissions.py`, `config/settings.py`, `export/services/shipment.py` (transition_to), `export/management/commands/seed_task_rules.py`, `core/permission_registry.py`, `core/management/commands/seed_permissions.py`, `export/views.py` (Task 11 guard).

Frontend (new): `src/hooks/useExternalTrips.ts`, `src/types/externalTrip.ts`, `src/pages/export/TruckBoard.tsx`, `src/pages/export/truckBoard/{ShipmentNeedCard.tsx,TripCard.tsx,TripDrawer.tsx,TruckMatchPanel.tsx,truckBoardHelpers.ts}`, tests next to them, `src/components/shipment/ShipmentTripBanner.tsx`.
Frontend (modify): `src/App.tsx`, `src/components/AppLayout.tsx`, `src/utils/permissions.ts`, `src/i18n/{en,ru,tk}.json`, `src/components/shipment/ShipmentTransportBody.tsx`, `src/utils/sheetPermissions.ts`, `src/components/sheet/SheetGrid.tsx`.

Build order / cut line (spec §11): Tasks 1–6 = demo path. 7–9 = change engine. 10 = pushes. 11 = Sheet read-only. 12 = docs. If the week slips, 10 and 11 move after the public test.

---

### Task 1: ExternalTrip models + settings

**Files:**
- Create: `backend/apps/transport/models/external_trip.py`
- Modify: `backend/apps/transport/models/__init__.py`, `backend/config/settings.py` (next to `TRACCAR_*`, ~line 44)
- Test: `backend/apps/transport/tests/test_trip_sync.py` (model part only here)

**Interfaces:**
- Produces: `ExternalTrip` (fields per spec §3.1, names below), `ExternalTrip.SNAPSHOT_FIELDS`, `ExternalTrip.CLOSED_STATUSES`, `ExternalTripSyncState.load() -> ExternalTripSyncState`; settings `TRANSPORT_API_URL`, `TRANSPORT_API_KEY`, `TRANSPORT_API_MODE`, `TRANSPORT_API_VERIFY_TLS`.

- [ ] **Step 1: Write the failing test**

```python
# backend/apps/transport/tests/test_trip_sync.py
from django.test import TestCase

from apps.transport.models import ExternalTrip, ExternalTripSyncState


class ExternalTripModelTests(TestCase):
    def test_sync_state_is_a_singleton(self):
        first = ExternalTripSyncState.load()
        second = ExternalTripSyncState.load()
        self.assertEqual(first.pk, second.pk)
        self.assertIsNone(first.cursor)

    def test_snapshot_fields_cover_the_change_triggers(self):
        self.assertEqual(
            ExternalTrip.SNAPSHOT_FIELDS,
            ('tractor_plate', 'trailer_plate', 'driver_full_name', 'driver_passport_number'),
        )
```

- [ ] **Step 2: Run to verify it fails**

Run: `python manage.py test apps.transport.tests.test_trip_sync --verbosity=1`
Expected: ImportError `cannot import name 'ExternalTrip'`.

- [ ] **Step 3: Implement the models**

```python
# backend/apps/transport/models/external_trip.py
from django.db import models

from apps.core.models.base import cyrillic_collation  # use the same import other models in this app use


class ExternalTrip(models.Model):
    """Local mirror of one trip planned in the external Planning system.

    Planning owns the row's truth; we only overwrite it from the poller.
    `shipment` is OUR link (spec §5) and survives re-polls.
    """

    SNAPSHOT_FIELDS = ('tractor_plate', 'trailer_plate', 'driver_full_name', 'driver_passport_number')
    CLOSED_STATUSES = ('CANCELLED', 'CLOSED', 'ARCHIVED')

    # === Identity ===
    integration_trip_id = models.UUIDField(unique=True)
    trip_number = models.CharField(max_length=50, null=True, blank=True)
    status = models.CharField(max_length=30)
    planned_departure = models.DateField()
    changed_at = models.DateTimeField()
    destination_country_code = models.CharField(max_length=5, null=True, blank=True)

    # === Tractor ===
    tractor_plate = models.CharField(max_length=50)
    tractor_brand = models.CharField(max_length=100, null=True, blank=True)
    tractor_model = models.CharField(max_length=100, null=True, blank=True)
    tractor_company = models.CharField(max_length=200, null=True, blank=True, **cyrillic_collation())
    tractor_source = models.CharField(max_length=20)

    # === Trailer ===
    trailer_plate = models.CharField(max_length=50)
    trailer_brand = models.CharField(max_length=100, null=True, blank=True)
    trailer_model = models.CharField(max_length=100, null=True, blank=True)
    trailer_company = models.CharField(max_length=200, null=True, blank=True, **cyrillic_collation())
    trailer_source = models.CharField(max_length=20)

    # === Driver ===
    driver_full_name = models.CharField(max_length=200, **cyrillic_collation())
    driver_phone = models.CharField(max_length=30, null=True, blank=True)
    driver_passport_number = models.CharField(max_length=50, null=True, blank=True)
    driver_passport_expiry = models.DateField(null=True, blank=True)
    # "Country:YYYY-MM-DD;Country:YYYY-MM-DD" — no JSONField on MSSQL.
    driver_visas = models.CharField(max_length=500, blank=True, default='', **cyrillic_collation())
    driver_source = models.CharField(max_length=20)

    # === Our side ===
    shipment = models.OneToOneField(
        'export.Shipment', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='external_trip',
    )
    conflict_note = models.TextField(null=True, blank=True, **cyrillic_collation())
    last_push_status = models.CharField(max_length=20, null=True, blank=True)
    last_push_error = models.TextField(null=True, blank=True)
    # What we last enqueued for export-code — compared on every poll tick (Task 10)
    # so a correction is pushed once, not every 2 minutes until Planning echoes it.
    last_pushed_export_code = models.CharField(max_length=30, null=True, blank=True)
    synced_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'transport_external_trips'
        ordering = ['planned_departure', 'id']

    def __str__(self) -> str:
        return f'{self.tractor_plate}/{self.trailer_plate} {self.planned_departure}'


class ExternalTripSyncState(models.Model):
    """Single row: poll cursor + health for the 'synced N min ago' line."""

    cursor = models.DateTimeField(null=True, blank=True)
    last_success_at = models.DateTimeField(null=True, blank=True)
    last_error = models.TextField(blank=True, default='')
    last_auth_alert_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'transport_external_trip_sync_state'

    @classmethod
    def load(cls) -> 'ExternalTripSyncState':
        state, _ = cls.objects.get_or_create(pk=1)
        return state
```

Before writing, open `backend/apps/transport/models/registry.py` and copy its exact `cyrillic_collation` import line (the path above is a guess — use the real one).

Add to `models/__init__.py`: `from .external_trip import ExternalTrip, ExternalTripSyncState` and both names to `__all__`.

Add to `config/settings.py` below the TRACCAR block:

```python
# Planning (transport department) trips API — spec 2026-09-29-transport-trips-design.md
TRANSPORT_API_URL = os.environ.get('TRANSPORT_API_URL', 'https://10.10.11.79:8444/api/v1/external')
TRANSPORT_API_KEY = os.environ.get('TRANSPORT_API_KEY', '')
TRANSPORT_API_MODE = os.environ.get('TRANSPORT_API_MODE', 'live')  # live | mock
# Path to a CA bundle, or 'false' to skip verification (self-signed internal cert).
_verify = os.environ.get('TRANSPORT_API_VERIFY_TLS', 'false')
TRANSPORT_API_VERIFY_TLS = False if _verify.lower() == 'false' else _verify
```

The `.env` value may be stored as `Bearer xxx` — the client strips a leading `Bearer ` (Task 2).

- [ ] **Step 4: Migration**

Run: `ls apps/transport/migrations | tail -3` (expect `0008_traccar_geofence.py` last), then
`python manage.py makemigrations transport -n external_trips` → `0009_external_trips.py`, then `python manage.py migrate transport` and `python manage.py showmigrations transport | tail -2`.

- [ ] **Step 5: Run tests — PASS**

Run: `python manage.py test apps.transport.tests.test_trip_sync --verbosity=1`

- [ ] **Step 6: Commit**

```bash
git add backend/apps/transport/models/external_trip.py backend/apps/transport/models/__init__.py backend/apps/transport/migrations/0009_external_trips.py backend/config/settings.py backend/apps/transport/tests/test_trip_sync.py
git commit -m "feat(p3): ExternalTrip mirror model for Planning trips"
```

---

### Task 2: Trips API client, mock client, parsing

**Files:**
- Create: `backend/apps/transport/services/trips_client.py`, `backend/apps/transport/services/trip_parsing.py`, `backend/apps/transport/fixtures/external_trips.json`
- Test: `backend/apps/transport/tests/test_trips_client.py`

**Interfaces:**
- Consumes: settings from Task 1.
- Produces:
  - `class TripsApiUnavailable(Exception)` with attribute `status_code: int | None`.
  - `TripsClient.list_trips(changed_since: datetime | None, page: int, page_size: int = 200) -> dict` (raw page: `items,total,page,pageSize`).
  - `TripsClient.get_trip(trip_uuid: str) -> dict`, `TripsClient.get_document(trip_uuid: str) -> bytes`.
  - `TripsClient.post_op(trip_uuid: str, op: str, body: dict, idempotency_key: str) -> tuple[int, dict]` — never raises for 4xx, raises `TripsApiUnavailable` for network/5xx.
  - `MockTripsClient` — same four methods; `is_mock = True` attribute on both (`False` on live).
  - `get_trips_client() -> TripsClient | MockTripsClient`.
  - `parse_trip(item: dict) -> dict` (model field → value, keys exactly the ExternalTrip field names incl. `integration_trip_id`, `destination_country_code` = `item.get('destinationCountryCode')`).
  - `visa_country_codes(visas_csv: str) -> list[str]`.

- [ ] **Step 1: Create the fixture** (the live response of 2026-09-29 with `destinationCountryCode` added)

```json
{
  "items": [
    {"integrationTripId": "89f2783b-e7e9-47ba-9884-8fe7bf34f1bd", "tripNumber": "X-TEST-0001", "status": "CREATED", "plannedDeparture": "2026-10-11", "changedAt": "2026-09-28T16:15:18.824156+00:00", "destinationCountryCode": "RU",
     "tractor": {"plateNumber": "2563AHF", "brand": "DAF", "model": "XF480", "companyName": "\"YIGIT\" HJ", "source": "GARAGE"},
     "trailer": {"plateNumber": "2251TAH", "brand": "SCHMITZ Cargobull", "model": "S.KO", "companyName": null, "source": "GARAGE"},
     "driver": {"fullName": "Amandurdyyew Atajan", "phone": "99361202698", "foreignPassport": {"seriesNumber": "A2510574", "expiryDate": "2029-04-08"}, "visas": [{"country": "Gazagystan", "expiryDate": "2026-10-28"}, {"country": "Russiýa", "expiryDate": "2026-10-28"}], "source": "GARAGE"}},
    {"integrationTripId": "b242b4de-a941-4dba-899e-3b0235e9f4ec", "tripNumber": null, "status": "CREATED", "plannedDeparture": "2026-10-01", "changedAt": "2026-09-29T10:58:12.951168+00:00", "destinationCountryCode": "KZ",
     "tractor": {"plateNumber": "2546AHF", "brand": "DAF", "model": "XF480", "companyName": "\"YIGIT\" HJ", "source": "GARAGE"},
     "trailer": {"plateNumber": "2296TAH", "brand": "SCHMITZ Cargobull", "model": "S.KO", "companyName": null, "source": "GARAGE"},
     "driver": {"fullName": "Allanazarow Agageldi Jorayewich", "phone": "99363318685", "foreignPassport": {"seriesNumber": "A2051674", "expiryDate": "2028-03-15"}, "visas": [{"country": "Gazagystan", "expiryDate": "2027-01-31"}, {"country": "Özbegistan", "expiryDate": "2027-03-07"}], "source": "GARAGE"}},
    {"integrationTripId": "052752a7-a810-4c69-8d3b-dc1d02f925ce", "tripNumber": null, "status": "CREATED", "plannedDeparture": "2026-10-02", "changedAt": "2026-09-29T10:59:39.814952+00:00", "destinationCountryCode": "KZ",
     "tractor": {"plateNumber": "1234AGG", "brand": "MAN", "model": "TF", "companyName": "Telekeçi Amanow", "source": "THIRD_PARTY"},
     "trailer": {"plateNumber": "Carrier", "brand": null, "model": null, "companyName": "Telekeçi Amanow", "source": "THIRD_PARTY"},
     "driver": {"fullName": "Amanberdiyew Aman Amanowich", "phone": null, "foreignPassport": null, "visas": [], "source": "THIRD_PARTY"}},
    {"integrationTripId": "bcf69fba-c7dc-48df-b0ae-1367f0a48da5", "tripNumber": null, "status": "CREATED", "plannedDeparture": "2026-10-03", "changedAt": "2026-09-29T11:00:30.136181+00:00", "destinationCountryCode": "KZ",
     "tractor": {"plateNumber": "2408AHF", "brand": "DAF", "model": "XF480", "companyName": "\"YIGIT\" HJ", "source": "GARAGE"},
     "trailer": {"plateNumber": "2251TAH", "brand": "SCHMITZ Cargobull", "model": "S.KO", "companyName": null, "source": "GARAGE"},
     "driver": {"fullName": "Amanow Nurjuma Allaberdiyewich", "phone": "99361311232", "foreignPassport": {"seriesNumber": "A2016533", "expiryDate": "2028-01-25"}, "visas": [{"country": "Gazagystan", "expiryDate": "2027-01-31"}, {"country": "Özbegistan", "expiryDate": "2027-03-07"}], "source": "GARAGE"}},
    {"integrationTripId": "088bc527-a988-48f5-8822-5cc11998dbfe", "tripNumber": null, "status": "CREATED", "plannedDeparture": "2026-10-03", "changedAt": "2026-09-29T11:01:10.43713+00:00", "destinationCountryCode": "UZ",
     "tractor": {"plateNumber": "2954AHF", "brand": "DAF", "model": "XF480", "companyName": "\"YIGIT\" HJ", "source": "GARAGE"},
     "trailer": {"plateNumber": "2285TAH", "brand": "SCHMITZ Cargobull", "model": "S.KO", "companyName": null, "source": "GARAGE"},
     "driver": {"fullName": "Annayew Derkar Azatgulyyewich", "phone": "99364438332", "foreignPassport": {"seriesNumber": "A2439616", "expiryDate": "2029-02-19"}, "visas": [{"country": "Russiýa", "expiryDate": "2026-08-03"}, {"country": "Gazagystan", "expiryDate": "2026-08-26"}, {"country": "Özbegistan", "expiryDate": "2026-11-30"}, {"country": "Eýran Yslam Respublikasy", "expiryDate": "2026-12-18"}], "source": "GARAGE"}},
    {"integrationTripId": "a236010e-cff3-466f-a1e9-dbf8aa66e377", "tripNumber": null, "status": "CREATED", "plannedDeparture": "2026-10-05", "changedAt": "2026-09-29T11:02:11.137529+00:00", "destinationCountryCode": "RU",
     "tractor": {"plateNumber": "2408AHF", "brand": "DAF", "model": "XF480", "companyName": "\"YIGIT\" HJ", "source": "GARAGE"},
     "trailer": {"plateNumber": "2068TAH", "brand": "SCHMITZ Cargobull", "model": "S.KO", "companyName": null, "source": "GARAGE"},
     "driver": {"fullName": "Annagurbanow Bekmyrat Orazbayewich", "phone": "99365299041", "foreignPassport": {"seriesNumber": "A2098786", "expiryDate": "2028-02-08"}, "visas": [{"country": "Gazagystan", "expiryDate": "2027-02-12"}, {"country": "Russiýa", "expiryDate": "2027-06-07"}], "source": "GARAGE"}}
  ],
  "total": 6, "page": 1, "pageSize": 200
}
```

- [ ] **Step 2: Write the failing tests**

```python
# backend/apps/transport/tests/test_trips_client.py
from datetime import datetime, timezone as dt_tz
from unittest import mock

import requests
from django.test import TestCase, override_settings

from apps.core.models import Country
from apps.transport.services.trip_parsing import parse_trip, visa_country_codes
from apps.transport.services.trips_client import (
    MockTripsClient, TripsApiUnavailable, TripsClient, get_trips_client,
)


class ParseTripTests(TestCase):
    def setUp(self):
        self.item = MockTripsClient().list_trips(None, page=1)['items'][0]

    def test_maps_nested_blocks_to_flat_fields(self):
        fields = parse_trip(self.item)
        self.assertEqual(fields['tractor_plate'], '2563AHF')
        self.assertEqual(fields['trailer_plate'], '2251TAH')
        self.assertEqual(fields['driver_passport_number'], 'A2510574')
        self.assertEqual(str(fields['driver_passport_expiry']), '2029-04-08')
        self.assertEqual(fields['driver_visas'], 'Gazagystan:2026-10-28;Russiýa:2026-10-28')
        self.assertEqual(fields['destination_country_code'], 'RU')

    def test_third_party_driver_without_passport(self):
        item = MockTripsClient().list_trips(None, page=1)['items'][2]
        fields = parse_trip(item)
        self.assertIsNone(fields['driver_passport_number'])
        self.assertIsNone(fields['driver_passport_expiry'])
        self.assertEqual(fields['driver_visas'], '')


class VisaCountryTests(TestCase):
    def setUp(self):
        Country.objects.create(code='KZ', name_tk='GAZAGYSTAN')
        Country.objects.create(code='RU', name_tk='RUSSIYA')
        Country.objects.create(code='UZ', name_tk='OZBEKYSTAN')

    def test_maps_turkmen_names_including_alias(self):
        self.assertEqual(
            visa_country_codes('Gazagystan:2027-01-31;Özbegistan:2027-03-07;Russiýa:2027-06-07'),
            ['KZ', 'UZ', 'RU'],
        )

    def test_unknown_name_is_skipped_not_guessed(self):
        self.assertEqual(visa_country_codes('Eýran Yslam Respublikasy:2026-12-18'), [])


class LiveClientTests(TestCase):
    @override_settings(TRANSPORT_API_KEY='Bearer abc', TRANSPORT_API_URL='https://x/api/v1/external')
    @mock.patch('apps.transport.services.trips_client.requests.request')
    def test_strips_bearer_prefix_and_sends_changed_since(self, request):
        request.return_value = mock.Mock(status_code=200, json=lambda: {'items': [], 'total': 0})
        TripsClient().list_trips(datetime(2026, 9, 29, 10, 0, tzinfo=dt_tz.utc), page=2)
        _, kwargs = request.call_args
        self.assertEqual(kwargs['headers']['Authorization'], 'Bearer abc')
        self.assertEqual(kwargs['params']['page'], 2)
        self.assertEqual(kwargs['params']['changedSince'], '2026-09-29T10:00:00+00:00')

    @mock.patch('apps.transport.services.trips_client.requests.request',
                side_effect=requests.ConnectionError('down'))
    def test_network_error_raises_unavailable(self, _):
        with self.assertRaises(TripsApiUnavailable):
            TripsClient().get_trip('x')

    @mock.patch('apps.transport.services.trips_client.requests.request')
    def test_post_op_returns_4xx_instead_of_raising(self, request):
        request.return_value = mock.Mock(status_code=409, json=lambda: {'code': 'TRIP_CLOSED'})
        status, body = TripsClient().post_op('u', 'export-code', {}, 'k')
        self.assertEqual((status, body['code']), (409, 'TRIP_CLOSED'))


class FactoryTests(TestCase):
    @override_settings(TRANSPORT_API_MODE='mock')
    def test_mock_mode_returns_mock_client(self):
        self.assertTrue(get_trips_client().is_mock)

    def test_mock_filters_by_changed_since(self):
        since = datetime(2026, 9, 29, 11, 0, tzinfo=dt_tz.utc)
        items = MockTripsClient().list_trips(since, page=1)['items']
        self.assertEqual(len(items), 2)  # 11:00:30 and 11:02:11
```

- [ ] **Step 3: Run — FAIL** (`ModuleNotFoundError`): `python manage.py test apps.transport.tests.test_trips_client`

- [ ] **Step 4: Implement `trip_parsing.py`**

```python
# backend/apps/transport/services/trip_parsing.py
"""Planning trip JSON → ExternalTrip field dict, and visa-name → country codes."""
import unicodedata
from datetime import date
from uuid import UUID

from django.utils.dateparse import parse_date, parse_datetime

# Planning spells some countries differently from core.Country.name_tk.
VISA_NAME_ALIASES = {'OZBEGISTAN': 'UZ'}


def _norm(value: str) -> str:
    ascii_only = unicodedata.normalize('NFKD', value or '').encode('ascii', 'ignore').decode()
    return ''.join(ch for ch in ascii_only.upper() if ch.isalnum())


def _date_or_none(value: str | None) -> date | None:
    return parse_date(value) if value else None


def parse_trip(item: dict) -> dict:
    tractor, trailer, driver = item['tractor'], item['trailer'], item['driver']
    passport = driver.get('foreignPassport') or {}
    visas = ';'.join(f"{v['country']}:{v['expiryDate']}" for v in driver.get('visas') or [])
    return {
        'integration_trip_id': UUID(item['integrationTripId']),
        'trip_number': item.get('tripNumber'),
        'status': item['status'],
        'planned_departure': parse_date(item['plannedDeparture']),
        'changed_at': parse_datetime(item['changedAt']),
        'destination_country_code': item.get('destinationCountryCode'),
        'tractor_plate': tractor['plateNumber'],
        'tractor_brand': tractor.get('brand'),
        'tractor_model': tractor.get('model'),
        'tractor_company': tractor.get('companyName'),
        'tractor_source': tractor['source'],
        'trailer_plate': trailer['plateNumber'],
        'trailer_brand': trailer.get('brand'),
        'trailer_model': trailer.get('model'),
        'trailer_company': trailer.get('companyName'),
        'trailer_source': trailer['source'],
        'driver_full_name': driver['fullName'],
        'driver_phone': driver.get('phone'),
        'driver_passport_number': passport.get('seriesNumber'),
        'driver_passport_expiry': _date_or_none(passport.get('expiryDate')),
        'driver_visas': visas[:500],
        'driver_source': driver['source'],
    }


def visa_country_codes(visas_csv: str) -> list[str]:
    """Codes of countries the driver holds a visa for; unknown names are dropped."""
    from apps.core.models import Country

    by_name = {_norm(c.name_tk): c.code for c in Country.objects.exclude(code__isnull=True)}
    codes: list[str] = []
    for chunk in filter(None, (visas_csv or '').split(';')):
        name = chunk.rsplit(':', 1)[0]
        code = VISA_NAME_ALIASES.get(_norm(name)) or by_name.get(_norm(name))
        if code:
            codes.append(code)
    return codes
```

Check: `_norm('Russiýa')` → `RUSSIYA` (ý decomposes to y), `_norm('Gazagystan')` → `GAZAGYSTAN`. Both match `name_tk`.

- [ ] **Step 5: Implement `trips_client.py`**

```python
# backend/apps/transport/services/trips_client.py
"""Client for the Planning trips API (contract: planning-integration-api.v1.yaml).

Mirrors traccar_client.py. MockTripsClient has the same surface and is used
when TRANSPORT_API_MODE=mock so a demo never depends on 10.10.11.79.
"""
import json
import logging
from datetime import datetime
from pathlib import Path

import requests
from django.conf import settings
from django.utils.dateparse import parse_datetime

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 15
FIXTURE_PATH = Path(__file__).resolve().parent.parent / 'fixtures' / 'external_trips.json'
# Smallest valid one-page PDF — the mock "trip documents" sheet.
MOCK_PDF = (
    b'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'
    b'2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
    b'3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\n'
    b'trailer<</Root 1 0 R>>\n%%EOF\n'
)


class TripsApiUnavailable(Exception):
    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


class TripsClient:
    is_mock = False

    def __init__(self) -> None:
        self.base_url = settings.TRANSPORT_API_URL.rstrip('/')
        key = (settings.TRANSPORT_API_KEY or '').strip()
        self.key = key[len('Bearer '):] if key.startswith('Bearer ') else key

    def _request(self, method: str, path: str, **kwargs) -> requests.Response:
        headers = {'Accept': 'application/json', 'Authorization': f'Bearer {self.key}'}
        headers.update(kwargs.pop('headers', {}))
        try:
            return requests.request(
                method, f'{self.base_url}{path}', headers=headers,
                timeout=TIMEOUT_SECONDS, verify=settings.TRANSPORT_API_VERIFY_TLS, **kwargs,
            )
        except requests.RequestException as exc:
            logger.warning('Planning API %s %s failed: %s', method, path, exc)
            raise TripsApiUnavailable(str(exc)) from exc

    def _get_ok(self, path: str, **kwargs) -> requests.Response:
        response = self._request('GET', path, **kwargs)
        if response.status_code != 200:
            raise TripsApiUnavailable(f'GET {path} → {response.status_code}', response.status_code)
        return response

    def list_trips(self, changed_since: datetime | None, page: int, page_size: int = 200) -> dict:
        params = {'page': page, 'pageSize': page_size}
        if changed_since:
            params['changedSince'] = changed_since.isoformat()
        return self._get_ok('/trips', params=params).json()

    def get_trip(self, trip_uuid: str) -> dict:
        return self._get_ok(f'/trips/{trip_uuid}').json()

    def get_document(self, trip_uuid: str) -> bytes:
        return self._get_ok(f'/trips/{trip_uuid}/document', headers={'Accept': 'application/pdf'}).content

    def post_op(self, trip_uuid: str, op: str, body: dict, idempotency_key: str) -> tuple[int, dict]:
        response = self._request(
            'POST', f'/trips/{trip_uuid}/{op}', json=body,
            headers={'Idempotency-Key': idempotency_key, 'Content-Type': 'application/json'},
        )
        if response.status_code >= 500:
            raise TripsApiUnavailable(f'POST {op} → {response.status_code}', response.status_code)
        try:
            payload = response.json()
        except ValueError:
            payload = {}
        return response.status_code, payload


class MockTripsClient:
    is_mock = True

    def _items(self) -> list[dict]:
        return json.loads(FIXTURE_PATH.read_text(encoding='utf-8'))['items']

    def list_trips(self, changed_since: datetime | None, page: int, page_size: int = 200) -> dict:
        items = [
            i for i in self._items()
            if changed_since is None or parse_datetime(i['changedAt']) > changed_since
        ]
        items.sort(key=lambda i: (i['changedAt'], i['integrationTripId']))
        start = (page - 1) * page_size
        return {'items': items[start:start + page_size], 'total': len(items), 'page': page, 'pageSize': page_size}

    def get_trip(self, trip_uuid: str) -> dict:
        return next(i for i in self._items() if i['integrationTripId'] == trip_uuid)

    def get_document(self, trip_uuid: str) -> bytes:
        return MOCK_PDF

    def post_op(self, trip_uuid: str, op: str, body: dict, idempotency_key: str) -> tuple[int, dict]:
        logger.info('MOCK push %s %s key=%s body=%s', trip_uuid, op, idempotency_key, body)
        return 200, {'accepted': True, 'duplicate': False}


def get_trips_client() -> TripsClient | MockTripsClient:
    return MockTripsClient() if settings.TRANSPORT_API_MODE == 'mock' else TripsClient()
```

- [ ] **Step 6: Run — PASS**: `python manage.py test apps.transport.tests.test_trips_client`

- [ ] **Step 7: Commit**

```bash
git add backend/apps/transport/services/trips_client.py backend/apps/transport/services/trip_parsing.py backend/apps/transport/fixtures/external_trips.json backend/apps/transport/tests/test_trips_client.py
git commit -m "feat(p3): Planning trips API client with mock mode"
```

---

### Task 3: Poller — sync service + Celery beat

**Files:**
- Create: `backend/apps/transport/services/trip_sync.py`
- Modify: `backend/apps/transport/tasks.py`, `backend/config/settings.py` (`CELERY_BEAT_SCHEDULE`, ~line 466)
- Test: `backend/apps/transport/tests/test_trip_sync.py` (append)

**Interfaces:**
- Consumes: `parse_trip`, `get_trips_client`, `TripsApiUnavailable`, `ExternalTrip`, `ExternalTripSyncState`.
- Produces: `sync_external_trips(client=None) -> list[ExternalTrip]` (the linked trips that had a *real* change: snapshot diff or became CANCELLED); `is_real_change(old: dict, new: dict) -> bool`; Celery task `apps.transport.tasks.poll_external_trips`.

- [ ] **Step 1: Write failing tests (append to test_trip_sync.py)**

```python
from datetime import timedelta
from unittest import mock

from django.utils import timezone

from apps.transport.services.trip_sync import OVERLAP, sync_external_trips
from apps.transport.services.trips_client import MockTripsClient, TripsApiUnavailable


class FakeClient(MockTripsClient):
    """MockTripsClient whose items the test controls."""

    def __init__(self, items):
        self.items = items
        self.detail_calls = []
        self.since_seen = []

    def _items(self):
        return self.items

    def list_trips(self, changed_since, page, page_size=200):
        self.since_seen.append(changed_since)
        return super().list_trips(changed_since, page, page_size)

    def get_trip(self, trip_uuid):
        self.detail_calls.append(trip_uuid)
        return {**next(i for i in self.items if i['integrationTripId'] == trip_uuid),
                'destinationCountryCode': 'KZ'}


def _fixture_items():
    return MockTripsClient()._items()


class SyncTests(TestCase):
    def test_first_sync_creates_all_and_moves_cursor(self):
        sync_external_trips(FakeClient(_fixture_items()))
        self.assertEqual(ExternalTrip.objects.count(), 6)
        state = ExternalTripSyncState.load()
        self.assertEqual(state.cursor.isoformat(), '2026-09-29T11:02:11.137529+00:00')
        self.assertIsNotNone(state.last_success_at)

    def test_second_sync_asks_with_overlap_and_is_idempotent(self):
        client = FakeClient(_fixture_items())
        sync_external_trips(client)
        sync_external_trips(client)
        cursor = ExternalTripSyncState.load().cursor
        self.assertEqual(client.since_seen[-1], cursor - OVERLAP)
        self.assertEqual(ExternalTrip.objects.count(), 6)

    def test_paging_reads_every_page(self):
        client = FakeClient(_fixture_items())
        with mock.patch('apps.transport.services.trip_sync.PAGE_SIZE', 4):
            sync_external_trips(client)
        self.assertEqual(ExternalTrip.objects.count(), 6)

    def test_missing_country_is_filled_from_detail_once(self):
        items = [{**i, 'destinationCountryCode': None} for i in _fixture_items()[:1]]
        client = FakeClient(items)
        sync_external_trips(client)
        sync_external_trips(client)
        self.assertEqual(ExternalTrip.objects.get().destination_country_code, 'KZ')
        self.assertEqual(len(client.detail_calls), 1)

    def test_failure_keeps_cursor_and_records_error(self):
        client = FakeClient(_fixture_items())
        sync_external_trips(client)
        cursor = ExternalTripSyncState.load().cursor
        client.list_trips = mock.Mock(side_effect=TripsApiUnavailable('down'))
        with self.assertRaises(TripsApiUnavailable):
            sync_external_trips(client)
        state = ExternalTripSyncState.load()
        self.assertEqual(state.cursor, cursor)
        self.assertIn('down', state.last_error)


class ChangeDetectionTests(TestCase):
    """Review Focus 5: status-only bumps are not changes."""

    def _linked(self, client):
        sync_external_trips(client)
        trip = ExternalTrip.objects.get(tractor_plate='2563AHF')
        # Linking needs a shipment; a bare id is enough for detection.
        ExternalTrip.objects.filter(pk=trip.pk).update(shipment_id=_make_shipment().pk)
        return trip

    def _bump(self, items, **changes):
        item = items[0]
        item['changedAt'] = (timezone.now() + timedelta(minutes=1)).isoformat()
        for path, value in changes.items():
            block, _, key = path.partition('.')
            if key:
                item[block][key] = value
            else:
                item[block] = value

    def test_status_only_bump_is_not_a_change(self):
        items = _fixture_items()
        client = FakeClient(items)
        self._linked(client)
        self._bump(items, status='PLANNED')
        self.assertEqual(sync_external_trips(client), [])
        self.assertEqual(ExternalTrip.objects.get(tractor_plate='2563AHF').status, 'PLANNED')

    def test_driver_swap_is_a_change(self):
        items = _fixture_items()
        client = FakeClient(items)
        self._linked(client)
        self._bump(items, **{'driver.fullName': 'Täze Sürüji'})
        self.assertEqual(len(sync_external_trips(client)), 1)

    def test_cancel_is_a_change(self):
        items = _fixture_items()
        client = FakeClient(items)
        self._linked(client)
        self._bump(items, status='CANCELLED')
        self.assertEqual(len(sync_external_trips(client)), 1)

    def test_unlinked_trip_change_is_not_reported(self):
        items = _fixture_items()
        client = FakeClient(items)
        sync_external_trips(client)
        self._bump(items, **{'driver.fullName': 'X'})
        self.assertEqual(sync_external_trips(client), [])
```

Add the shipment helper at the top of the file (same pattern as `apps/transport/tests/test_shipment_api.py:14-30`):

```python
from apps.core.models import Season, ShipmentStatusType
from apps.export.models import Shipment


def _make_shipment(code='T-1', status_code='draft', **fields):
    status, _ = ShipmentStatusType.objects.get_or_create(code=status_code, defaults={'name_tk': status_code})
    season = Season.objects.filter(is_active=True).first() or Season.objects.create(
        name='S', start_date='2026-09-01', end_date='2027-06-30', is_active=True)
    return Shipment.objects.create(shipment_code=code, date='2026-10-01', season=season, status=status, **fields)
```

If `ShipmentStatusType` needs more required fields, copy the `_status()` helper from `test_shipment_api.py:14` verbatim.

- [ ] **Step 2: Run — FAIL** (`ModuleNotFoundError trip_sync`).

- [ ] **Step 3: Implement `trip_sync.py`**

```python
# backend/apps/transport/services/trip_sync.py
"""Pull Planning trips into ExternalTrip (spec §4).

changedSince is strictly-after and pages are ordered changedAt+id, so we poll
from cursor − OVERLAP: the upsert is idempotent, the overlap guards against
rows sharing a timestamp across polls.
"""
import logging
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from apps.transport.models import ExternalTrip, ExternalTripSyncState
from apps.transport.services.trip_parsing import parse_trip
from apps.transport.services.trips_client import TripsApiUnavailable, get_trips_client

logger = logging.getLogger(__name__)

OVERLAP = timedelta(minutes=5)
PAGE_SIZE = 200


def is_real_change(old: dict, new: dict) -> bool:
    """Only resource swaps or a cancel count; status moves and our own pushes don't."""
    if new['status'] == 'CANCELLED' and old['status'] != 'CANCELLED':
        return True
    return any(old[f] != new[f] for f in ExternalTrip.SNAPSHOT_FIELDS)


def _upsert(item: dict, client) -> ExternalTrip | None:
    """Write one trip; return it when it is linked and really changed."""
    fields = parse_trip(item)
    trip = ExternalTrip.objects.filter(integration_trip_id=fields['integration_trip_id']).first()
    if fields['destination_country_code'] is None:
        fields['destination_country_code'] = trip.destination_country_code if trip else None
    if fields['destination_country_code'] is None:
        fields['destination_country_code'] = client.get_trip(item['integrationTripId']).get('destinationCountryCode')
    if trip is None:
        ExternalTrip.objects.create(**fields)
        return None
    old = {f: getattr(trip, f) for f in (*ExternalTrip.SNAPSHOT_FIELDS, 'status')}
    for name, value in fields.items():
        setattr(trip, name, value)
    trip.save()
    return trip if trip.shipment_id and is_real_change(old, fields) else None


def sync_external_trips(client=None) -> list[ExternalTrip]:
    client = client or get_trips_client()
    state = ExternalTripSyncState.load()
    since = state.cursor - OVERLAP if state.cursor else None
    changed: list[ExternalTrip] = []
    newest = state.cursor
    page = 1
    try:
        while True:
            data = client.list_trips(since, page=page, page_size=PAGE_SIZE)
            items = data.get('items') or []
            with transaction.atomic():
                for item in items:
                    trip = _upsert(item, client)
                    if trip:
                        changed.append(trip)
            for item in items:
                stamp = parse_trip(item)['changed_at']
                newest = stamp if newest is None or stamp > newest else newest
            if not items or page * PAGE_SIZE >= data.get('total', 0):
                break
            page += 1
    except TripsApiUnavailable as exc:
        state.last_error = str(exc)[:2000]
        state.save(update_fields=['last_error'])
        raise
    state.cursor = newest
    state.last_success_at = timezone.now()
    state.last_error = ''
    state.save()
    return changed
```

- [ ] **Step 4: Celery task + beat**

Append to `backend/apps/transport/tasks.py`:

```python
from apps.transport.services.trip_sync import sync_external_trips
from apps.transport.services.trips_client import TripsApiUnavailable


@shared_task(time_limit=110, soft_time_limit=100)
def poll_external_trips():
    """Pull changed Planning trips. Change handling is wired in Task 8."""
    try:
        changed = sync_external_trips()
    except TripsApiUnavailable as exc:
        logger.warning('Planning trips poll failed: %s', exc)
        return {'ok': False, 'changed': 0}
    return {'ok': True, 'changed': len(changed)}
```

In `config/settings.py` `CELERY_BEAT_SCHEDULE` add:

```python
    'poll-external-trips': {
        'task': 'apps.transport.tasks.poll_external_trips',
        'schedule': 120.0,
        'options': {'expires': 110},
    },
```

- [ ] **Step 5: Run — PASS**: `python manage.py test apps.transport.tests.test_trip_sync`

- [ ] **Step 6: Live smoke (read-only)** — copy the `TRANSPORT_API_*` lines into the worktree `backend/.env`, then
`python manage.py shell -c "from apps.transport.services.trip_sync import sync_external_trips as s; print(len(s()))"` → prints 0 (no linked trips), and `ExternalTrip.objects.count()` ≥ 6. **This writes to the shared DB** (new table only) — fine.

- [ ] **Step 7: Commit**

```bash
git add backend/apps/transport/services/trip_sync.py backend/apps/transport/tasks.py backend/config/settings.py backend/apps/transport/tests/test_trip_sync.py
git commit -m "feat(p3): poll Planning trips every 2 minutes"
```

---

### Task 4: Assign / unassign service + board API + permissions

**Files:**
- Create: `backend/apps/transport/services/trip_assignment.py`, `backend/apps/transport/services/sync_user.py`, `backend/apps/transport/serializers_trips.py`, `backend/apps/transport/views_trips.py`, core data migration `backend/apps/core/migrations/0066_truck_board_page_perms.py`
- Modify: `backend/apps/transport/urls.py`, `backend/apps/transport/permissions.py`, `backend/apps/core/permission_registry.py` (~line 85), `backend/apps/core/management/commands/seed_permissions.py` (~line 190)
- Test: `backend/apps/transport/tests/test_trip_assignment.py`, `backend/apps/transport/tests/test_trip_api.py`

**Interfaces:**
- Consumes: `ExternalTrip`, `normalize_plate` from `apps.transport.services.matching`, `device_for_plate` (same module), `visa_country_codes`, `snapshot_fields`/`diff_audit_rows` from `apps.export.services.sheet_audit`, `AuditLog` from `apps.export.models`.
- Produces:
  - `class AssignmentError(ValueError)` with `.code: str` (`'not_draft'`, `'gapy'`, `'has_trip'`, `'trip_taken'`, `'trip_closed'`, `'country_mismatch'`, `'country_unknown'`, `'locked'`).
  - `TRANSPORT_FIELDS: tuple[str, ...]` — the shipment fields a trip writes.
  - `trip_values(trip) -> dict` — shipment field values for a trip.
  - `write_transport_fields(shipment, values: dict, user) -> None` — audited save.
  - `assign_trip(trip, shipment, user, confirm_unknown_country: bool = False) -> None`.
  - `unassign_trip(trip, user) -> None` (Task 4: draft only; Task 8 widens).
  - `get_sync_user() -> User`.
  - Endpoints under `/api/v1/transport/external-trips/`: `GET ""` (filters `?free=1`, `?country=KZ`), `GET {id}/`, `GET {id}/document/`, `POST {id}/assign/` body `{shipment_id, confirm_unknown_country}`, `POST {id}/unassign/`, `GET sync-state/`, `GET candidate-shipments/`.
  - Page code `export.truck_board`; write gate = resource `shipment_assign` `can_edit`.

- [ ] **Step 1: Write failing service tests**

```python
# backend/apps/transport/tests/test_trip_assignment.py
from django.contrib.auth import get_user_model
from django.test import TestCase

from apps.core.models import Country
from apps.transport.models import ExternalTrip, TruckHead
from apps.transport.services.trip_assignment import AssignmentError, assign_trip, unassign_trip
from apps.transport.tests.test_trip_sync import _make_shipment

User = get_user_model()


def make_trip(**overrides):
    fields = dict(
        integration_trip_id='89f2783b-e7e9-47ba-9884-8fe7bf34f1bd', status='CREATED',
        planned_departure='2026-10-11', changed_at='2026-09-28T16:15:18+00:00',
        destination_country_code='KZ', tractor_plate='2563AHF', tractor_source='GARAGE',
        trailer_plate='2251TAH', trailer_source='GARAGE', driver_full_name='Amandurdyyew Atajan',
        driver_phone='99361202698', driver_passport_number='A2510574',
        driver_passport_expiry='2029-04-08', driver_source='GARAGE',
    )
    fields.update(overrides)
    return ExternalTrip.objects.create(**fields)


class AssignTripTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='em', password='x', role='export_manager')
        self.kz = Country.objects.create(code='KZ', name_tk='GAZAGYSTAN')
        self.ru = Country.objects.create(code='RU', name_tk='RUSSIYA')
        self.shipment = _make_shipment(country=self.kz)
        self.trip = make_trip()

    def test_assign_writes_shipment_fields_and_link(self):
        assign_trip(self.trip, self.shipment, self.user)
        self.shipment.refresh_from_db()
        self.trip.refresh_from_db()
        self.assertEqual(self.shipment.truck_plate, '2563AHF/2251TAH')
        self.assertEqual(self.shipment.driver_name, 'Amandurdyyew Atajan')
        self.assertEqual(self.shipment.driver_phone, '99361202698')
        self.assertEqual(self.shipment.driver_passport_serial, 'A2510574')
        self.assertEqual(str(self.shipment.driver_passport_issue_date), '2029-04-08')
        self.assertEqual(self.shipment.trip_id, self.trip.pk)
        self.assertIsNone(self.shipment.driver_id)
        self.assertEqual(self.trip.shipment_id, self.shipment.pk)

    def test_assign_links_our_truck_head_by_normalised_plate(self):
        head = TruckHead.objects.create(plate_number='2563 ahf')
        assign_trip(self.trip, self.shipment, self.user)
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.truck_head_id, head.pk)

    def test_country_mismatch_refused(self):
        self.shipment.country = self.ru
        self.shipment.save()
        with self.assertRaises(AssignmentError) as ctx:
            assign_trip(self.trip, self.shipment, self.user)
        self.assertEqual(ctx.exception.code, 'country_mismatch')

    def test_unknown_country_needs_confirm(self):
        self.trip.destination_country_code = None
        self.trip.save()
        with self.assertRaises(AssignmentError) as ctx:
            assign_trip(self.trip, self.shipment, self.user)
        self.assertEqual(ctx.exception.code, 'country_unknown')
        assign_trip(self.trip, self.shipment, self.user, confirm_unknown_country=True)
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.trip_id, self.trip.pk)

    def test_gapy_refused(self):
        self.shipment.is_gapy_satys = True
        self.shipment.save()
        with self.assertRaises(AssignmentError) as ctx:
            assign_trip(self.trip, self.shipment, self.user)
        self.assertEqual(ctx.exception.code, 'gapy')

    def test_non_draft_refused(self):
        other = _make_shipment(code='T-2', status_code='gumruk_girish', country=self.kz)
        with self.assertRaises(AssignmentError) as ctx:
            assign_trip(self.trip, other, self.user)
        self.assertEqual(ctx.exception.code, 'not_draft')

    def test_trip_already_taken_refused(self):
        assign_trip(self.trip, self.shipment, self.user)
        other = _make_shipment(code='T-2', country=self.kz)
        with self.assertRaises(AssignmentError) as ctx:
            assign_trip(self.trip, other, self.user)
        self.assertEqual(ctx.exception.code, 'trip_taken')

    def test_cancelled_trip_refused(self):
        self.trip.status = 'CANCELLED'
        self.trip.save()
        with self.assertRaises(AssignmentError) as ctx:
            assign_trip(self.trip, self.shipment, self.user)
        self.assertEqual(ctx.exception.code, 'trip_closed')

    def test_unassign_clears_fields_in_draft(self):
        assign_trip(self.trip, self.shipment, self.user)
        unassign_trip(self.trip, self.user)
        self.shipment.refresh_from_db()
        self.trip.refresh_from_db()
        self.assertIsNone(self.shipment.trip_id)
        self.assertFalse(self.shipment.truck_plate)
        self.assertIsNone(self.trip.shipment_id)
```

- [ ] **Step 2: Run — FAIL.** `python manage.py test apps.transport.tests.test_trip_assignment`

- [ ] **Step 3: Implement `sync_user.py`**

```python
# backend/apps/transport/services/sync_user.py
"""The actor for poller-driven writes (comments need a non-null author)."""
from django.contrib.auth import get_user_model

SYNC_USERNAME = 'planning_sync'


def get_sync_user():
    user_model = get_user_model()
    user, created = user_model.objects.get_or_create(
        username=SYNC_USERNAME, defaults={'role': 'transport', 'is_active': False},
    )
    if created:
        user.set_unusable_password()
        user.save(update_fields=['password'])
    return user
```

- [ ] **Step 4: Implement `trip_assignment.py` (assign/unassign part)**

```python
# backend/apps/transport/services/trip_assignment.py
"""Join Planning trips to shipments (spec §5) and react to their changes (spec §6)."""
import logging

from django.db import IntegrityError, transaction

from apps.export.models import AuditLog, Shipment
from apps.export.services.sheet_audit import diff_audit_rows, snapshot_fields
from apps.transport.models import ExternalTrip, Trailer, TruckHead
from apps.transport.services.matching import normalize_plate

logger = logging.getLogger(__name__)

TRANSPORT_FIELDS = (
    'truck_plate', 'driver_name', 'driver_phone', 'driver_passport_serial',
    'driver_passport_issue_date', 'truck_head_id', 'trailer_id', 'trip_id',
)


class AssignmentError(ValueError):
    def __init__(self, code: str, message: str = ''):
        super().__init__(message or code)
        self.code = code


def _match_id(model, plate: str) -> int | None:
    wanted = normalize_plate(plate)
    for pk, candidate in model.objects.values_list('pk', 'plate_number'):
        if normalize_plate(candidate) == wanted:
            return pk
    return None


def trip_values(trip: ExternalTrip) -> dict:
    return {
        'truck_plate': f'{trip.tractor_plate}/{trip.trailer_plate}',
        'driver_name': trip.driver_full_name,
        'driver_phone': trip.driver_phone,
        'driver_passport_serial': trip.driver_passport_number,
        # Spec D3: Planning has no issue date; expiry stands in until it does.
        'driver_passport_issue_date': trip.driver_passport_expiry,
        'truck_head_id': _match_id(TruckHead, trip.tractor_plate),
        'trailer_id': _match_id(Trailer, trip.trailer_plate),
        'trip_id': trip.pk,
    }


EMPTY_VALUES = {field: None for field in TRANSPORT_FIELDS}


def write_transport_fields(shipment: Shipment, values: dict, user) -> None:
    """Save like a Sheet edit: tasks resolve, auto-advance runs, AuditLog rows written."""
    fields = list(values)
    before = snapshot_fields(shipment, fields)
    for name, value in values.items():
        setattr(shipment, name, value)
    shipment.updated_by = user
    shipment.save()
    shipment.refresh_from_db()
    rows = diff_audit_rows(shipment, before, snapshot_fields(shipment, fields), user)
    if rows:
        AuditLog.objects.bulk_create(rows, batch_size=500)


def _check_assignable(trip: ExternalTrip, shipment: Shipment, confirm_unknown_country: bool) -> None:
    if shipment.is_gapy_satys:
        raise AssignmentError('gapy')
    if shipment.status.code != 'draft':
        raise AssignmentError('not_draft')
    if shipment.trip_id:
        raise AssignmentError('has_trip')
    if trip.status in ExternalTrip.CLOSED_STATUSES:
        raise AssignmentError('trip_closed')
    if trip.shipment_id:
        raise AssignmentError('trip_taken')
    if trip.destination_country_code is None:
        if not confirm_unknown_country:
            raise AssignmentError('country_unknown')
    elif not shipment.country_id or shipment.country.code != trip.destination_country_code:
        raise AssignmentError('country_mismatch')


def assign_trip(trip: ExternalTrip, shipment: Shipment, user, confirm_unknown_country: bool = False) -> None:
    try:
        with transaction.atomic():
            trip = ExternalTrip.objects.select_for_update().get(pk=trip.pk)
            _check_assignable(trip, shipment, confirm_unknown_country)
            trip.shipment = shipment
            trip.save(update_fields=['shipment'])
            write_transport_fields(shipment, trip_values(trip), user)
    except IntegrityError as exc:  # OneToOne race: another assign won
        raise AssignmentError('trip_taken') from exc
    # Pushes (Task 10) are enqueued here via transaction.on_commit.


def _release(trip: ExternalTrip, shipment: Shipment, user) -> None:
    trip.shipment = None
    trip.conflict_note = None
    trip.save(update_fields=['shipment', 'conflict_note'])
    write_transport_fields(shipment, dict(EMPTY_VALUES), user)


def unassign_trip(trip: ExternalTrip, user) -> None:
    shipment = trip.shipment
    if shipment is None:
        return
    if shipment.status.code != 'draft':
        raise AssignmentError('locked')  # Task 8 replaces this with the §6 table
    with transaction.atomic():
        _release(trip, shipment, user)
```

Note: `_match_id` scans ~100 rows — fleet tables are small (91 heads / 74 trailers); fine.

- [ ] **Step 5: Run service tests — PASS.**

- [ ] **Step 6: Permissions**

In `backend/apps/core/permission_registry.py` next to `('transport.map', ...)` add `('export.truck_board', 'Truck Board (Planning trips ↔ shipments)'),`.

In `seed_permissions.py` next to line 190 add:

```python
for _role in ('export_manager', 'document_team', 'director', 'boss', 'admin', 'transport'):
    PAGE_DEFAULTS[_role] |= {'export.truck_board'}
```

Create `backend/apps/core/migrations/0066_truck_board_page_perms.py` by copying `0056_task_rules_page_perms.py` verbatim and changing only: the page code to `'export.truck_board'`, the role list to the six above, and `dependencies` to `('core', '0065_greenhouseconfig_scan_base_url')`. Check `ls apps/core/migrations | tail -3` first. Run `python manage.py migrate core`.

In `backend/apps/transport/permissions.py` add (copy `CanViewFleetMap` shape at line 76):

```python
class CanViewTruckBoard(BasePermission):
    """Read gate for the Truck Board: the export.truck_board page grant."""

    def has_permission(self, request, view) -> bool:
        user = request.user
        if user.is_superuser:
            return True
        role = getattr(user, 'role', None)
        if not role:
            return False
        return get_page_permissions(role).get('export.truck_board', False)


class CanAssignTrips(BasePermission):
    """Write gate: RoleResourcePermission shipment_assign.can_edit — the same
    grant the frontend reads with canDo(user, 'shipment_assign', 'edit')."""

    def has_permission(self, request, view) -> bool:
        if request.method in SAFE_METHODS:
            return True
        user = request.user
        if user.is_superuser:
            return True
        return user_can(user, 'shipment_assign', 'edit')
```

`user_can` — open `apps/core/permissions.py:283` (`resource_write_permission`) and reuse the exact lookup it performs for a resource+action (import that helper; if it is inlined, extract it into a module-level function `user_can(user, resource_code, action) -> bool` in the same file and make `resource_write_permission` call it — no behaviour change). Transport role has the page but not `shipment_assign` edit, so it is read-only.

- [ ] **Step 7: Serializers + views + urls**

```python
# backend/apps/transport/serializers_trips.py
from rest_framework import serializers

from apps.transport.models import ExternalTrip
from apps.transport.services.trip_parsing import visa_country_codes


class ExternalTripSerializer(serializers.ModelSerializer):
    visas = serializers.SerializerMethodField()
    visa_country_codes = serializers.SerializerMethodField()
    shipment_code = serializers.CharField(source='shipment.shipment_code', read_only=True, default=None)
    position = serializers.SerializerMethodField()

    class Meta:
        model = ExternalTrip
        fields = [
            'id', 'integration_trip_id', 'trip_number', 'status', 'planned_departure', 'changed_at',
            'destination_country_code',
            'tractor_plate', 'tractor_brand', 'tractor_model', 'tractor_company', 'tractor_source',
            'trailer_plate', 'trailer_brand', 'trailer_model', 'trailer_company', 'trailer_source',
            'driver_full_name', 'driver_phone', 'driver_passport_number', 'driver_passport_expiry',
            'driver_source', 'visas', 'visa_country_codes',
            'shipment', 'shipment_code', 'conflict_note', 'last_push_status', 'last_push_error', 'position',
        ]

    def get_visas(self, trip) -> list[dict]:
        pairs = [c.rsplit(':', 1) for c in filter(None, trip.driver_visas.split(';'))]
        return [{'country': name, 'expiry_date': expiry} for name, expiry in pairs]

    def get_visa_country_codes(self, trip) -> list[str]:
        return visa_country_codes(trip.driver_visas)

    def get_position(self, trip) -> dict | None:
        position = self.context.get('positions', {}).get(trip.tractor_plate)
        if position is None:
            return None
        return {
            'lat': float(position.latitude), 'lon': float(position.longitude),
            'address': position.address, 'fix_time': position.fix_time,
            'geofence_name': getattr(position.current_geofence, 'name', None),
        }


class CandidateShipmentSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    code = serializers.CharField(source='shipment_code')
    date = serializers.DateField()
    country_code = serializers.CharField(source='country.code', default=None)
    country_name = serializers.CharField(source='country.name_tk', default=None)
    customer_name = serializers.CharField(source='customer.name', default=None)
    blocks = serializers.SerializerMethodField()

    def get_blocks(self, shipment) -> list[str]:
        return [s.block.code for s in shipment.block_sources.all()]
```

Before finishing: check `DevicePosition` field names (`latitude`, `longitude`, `address`, `fix_time`, `current_geofence`) in `models/registry.py` and `Customer`'s display field in `apps/core/models` — adjust names if they differ. `visa_country_codes` queries Country per row; move the Country map into serializer context if the list exceeds ~50 rows (not needed now).

```python
# backend/apps/transport/views_trips.py
from django.http import HttpResponse
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.export.models import Shipment
from apps.transport.models import ExternalTrip, ExternalTripSyncState
from apps.transport.permissions import CanAssignTrips, CanViewTruckBoard
from apps.transport.serializers_trips import CandidateShipmentSerializer, ExternalTripSerializer
from apps.transport.services.matching import device_for_plate
from apps.transport.services.trip_assignment import AssignmentError, assign_trip, unassign_trip
from apps.transport.services.trips_client import TripsApiUnavailable, get_trips_client


def _positions_by_plate(trips) -> dict:
    positions = {}
    for trip in trips:
        device = device_for_plate(trip.tractor_plate)
        position = getattr(device, 'position', None) if device else None
        if position is not None and position.valid:
            positions[trip.tractor_plate] = position
    return positions


class ExternalTripViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = ExternalTripSerializer
    permission_classes = [IsAuthenticated, CanViewTruckBoard, CanAssignTrips]
    pagination_class = None

    def get_queryset(self):
        qs = ExternalTrip.objects.select_related('shipment')
        params = self.request.query_params
        if params.get('free') == '1':
            qs = qs.filter(shipment__isnull=True).exclude(status__in=ExternalTrip.CLOSED_STATUSES)
        if params.get('linked') == '1':
            qs = qs.filter(shipment__isnull=False)
        if params.get('country'):
            qs = qs.filter(destination_country_code=params['country'])
        return qs

    def get_serializer_context(self):
        context = super().get_serializer_context()
        if self.action in ('list', 'retrieve'):
            trips = [self.get_object()] if self.action == 'retrieve' else list(self.get_queryset())
            context['positions'] = _positions_by_plate(trips)
        return context

    @action(detail=True, methods=['get'])
    def document(self, request, pk=None):
        trip = self.get_object()
        try:
            pdf = get_trips_client().get_document(str(trip.integration_trip_id))
        except TripsApiUnavailable as exc:
            code = 'no_documents' if exc.status_code == 404 else 'planning_unavailable'
            return Response({'detail': code}, status=status.HTTP_502_BAD_GATEWAY)
        response = HttpResponse(pdf, content_type='application/pdf')
        response['Content-Disposition'] = f'inline; filename="trip-{trip.integration_trip_id}.pdf"'
        return response

    @action(detail=True, methods=['post'])
    def assign(self, request, pk=None):
        trip = self.get_object()
        shipment = Shipment.objects.select_related('status', 'country').get(pk=request.data['shipment_id'])
        try:
            assign_trip(trip, shipment, request.user,
                        confirm_unknown_country=bool(request.data.get('confirm_unknown_country')))
        except AssignmentError as exc:
            return Response({'detail': exc.code}, status=status.HTTP_409_CONFLICT)
        return Response(ExternalTripSerializer(ExternalTrip.objects.get(pk=trip.pk)).data)

    @action(detail=True, methods=['post'])
    def unassign(self, request, pk=None):
        trip = self.get_object()
        try:
            unassign_trip(trip, request.user)
        except AssignmentError as exc:
            return Response({'detail': exc.code}, status=status.HTTP_409_CONFLICT)
        return Response(ExternalTripSerializer(ExternalTrip.objects.get(pk=trip.pk)).data)

    @action(detail=False, methods=['get'], url_path='sync-state')
    def sync_state(self, request):
        state = ExternalTripSyncState.load()
        return Response({
            'last_success_at': state.last_success_at, 'last_error': state.last_error,
            'is_mock': get_trips_client().is_mock,
        })

    @action(detail=False, methods=['get'], url_path='candidate-shipments')
    def candidate_shipments(self, request):
        shipments = (
            Shipment.objects.filter(status__code='draft', is_gapy_satys=False, trip_id__isnull=True)
            .select_related('country', 'customer').prefetch_related('block_sources__block')
            .order_by('date', 'id')
        )
        return Response(CandidateShipmentSerializer(shipments, many=True).data)
```

Candidate shipments: drafts without a destination country are excluded? No — keep them; the board shows them with "no country" and assign refuses with `country_mismatch`. Season scoping: if the Sheet list uses `useSelectedSeason`, filter `season_id=request.query_params.get('season')` when given (check `apps/export/views.py` shipments list for the param name and copy it).

In `backend/apps/transport/urls.py`: `router.register('external-trips', ExternalTripViewSet, basename='external-trips')` (import from `views_trips`).

- [ ] **Step 8: API tests**

```python
# backend/apps/transport/tests/test_trip_api.py
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.core.models import Country
from apps.transport.tests.test_trip_assignment import make_trip
from apps.transport.tests.test_trip_sync import _make_shipment

User = get_user_model()


@override_settings(TRANSPORT_API_MODE='mock')
class TripApiTests(TestCase):
    def setUp(self):
        call_command('seed_permissions')
        cache.clear()
        self.client = APIClient()
        self.kz = Country.objects.create(code='KZ', name_tk='GAZAGYSTAN')
        self.shipment = _make_shipment(country=self.kz)
        self.trip = make_trip()

    def _as(self, role):
        user = User.objects.create_user(username=role, password='x', role=role)
        self.client.force_authenticate(user)
        return user

    def test_export_manager_lists_and_assigns(self):
        self._as('export_manager')
        self.assertEqual(len(self.client.get('/api/v1/transport/external-trips/?free=1').json()), 1)
        response = self.client.post(f'/api/v1/transport/external-trips/{self.trip.pk}/assign/',
                                    {'shipment_id': self.shipment.pk}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['shipment_code'], self.shipment.shipment_code)

    def test_second_assign_of_same_trip_is_409(self):
        self._as('export_manager')
        other = _make_shipment(code='T-2', country=self.kz)
        url = f'/api/v1/transport/external-trips/{self.trip.pk}/assign/'
        self.client.post(url, {'shipment_id': self.shipment.pk}, format='json')
        response = self.client.post(url, {'shipment_id': other.pk}, format='json')
        self.assertEqual((response.status_code, response.json()['detail']), (409, 'trip_taken'))

    def test_transport_role_can_view_not_assign(self):
        self._as('transport')
        self.assertEqual(self.client.get('/api/v1/transport/external-trips/').status_code, 200)
        response = self.client.post(f'/api/v1/transport/external-trips/{self.trip.pk}/assign/',
                                    {'shipment_id': self.shipment.pk}, format='json')
        self.assertEqual(response.status_code, 403)

    def test_sales_rep_cannot_view(self):
        self._as('sales_rep')
        self.assertEqual(self.client.get('/api/v1/transport/external-trips/').status_code, 403)

    def test_document_proxies_pdf_in_mock_mode(self):
        self._as('export_manager')
        response = self.client.get(f'/api/v1/transport/external-trips/{self.trip.pk}/document/')
        self.assertEqual(response['Content-Type'], 'application/pdf')
        self.assertTrue(response.content.startswith(b'%PDF'))

    def test_candidate_shipments_excludes_gapy_and_linked(self):
        self._as('export_manager')
        _make_shipment(code='G-1', country=self.kz, is_gapy_satys=True)
        codes = [s['code'] for s in self.client.get(
            '/api/v1/transport/external-trips/candidate-shipments/').json()]
        self.assertEqual(codes, [self.shipment.shipment_code])

    def test_sync_state_reports_mock(self):
        self._as('export_manager')
        self.assertTrue(self.client.get('/api/v1/transport/external-trips/sync-state/').json()['is_mock'])
```

If `test_transport_role_can_view_not_assign` fails because the `transport` role already holds `shipment_assign` edit in `seed_permissions`, STOP and ask the user (it would mean transport may assign).

- [ ] **Step 9: Run — PASS**: `python manage.py test apps.transport.tests.test_trip_assignment apps.transport.tests.test_trip_api`

- [ ] **Step 10: Commit**

```bash
git add backend/apps/transport/services/trip_assignment.py backend/apps/transport/services/sync_user.py backend/apps/transport/serializers_trips.py backend/apps/transport/views_trips.py backend/apps/transport/urls.py backend/apps/transport/permissions.py backend/apps/core/permission_registry.py backend/apps/core/management/commands/seed_permissions.py backend/apps/core/migrations/0066_truck_board_page_perms.py backend/apps/core/permissions.py backend/apps/transport/tests/test_trip_assignment.py backend/apps/transport/tests/test_trip_api.py
git commit -m "feat(p3): assign Planning trips to shipments — service, API, page permission"
```

---

### Task 5: `tasks.choose_truck` replaces non-gapy `assign_driver`

**Files:**
- Modify: `backend/apps/export/management/commands/seed_task_rules.py` (rule at ~line 57-70)
- Modify: `frontend/src/i18n/{en,ru,tk}.json` (task title key)
- Test: `backend/apps/export/tests_choose_truck_rule.py`

**Interfaces:**
- Produces: TaskRule `step='draft', title_key='tasks.choose_truck', assignee_role='export_manager', target_fields='trip_id', ALL_FIELDS_FILLED, condition is_gapy_satys=False`; the non-gapy `tasks.assign_driver` rule gets `'is_active': False`.

- [ ] **Step 1: Failing test**

```python
# backend/apps/export/tests_choose_truck_rule.py
from django.test import TestCase

from apps.export.management.commands.seed_task_rules import Command as SeedTaskRules
from apps.export.models import TaskRule


class ChooseTruckRuleTests(TestCase):
    def setUp(self):
        SeedTaskRules().handle(reset=False)

    def test_choose_truck_rule_seeded(self):
        rule = TaskRule.objects.get(title_key='tasks.choose_truck')
        self.assertEqual((rule.step, rule.assignee_role, rule.target_fields), ('draft', 'export_manager', 'trip_id'))
        self.assertEqual((rule.condition_field, rule.condition_value), ('is_gapy_satys', 'False'))
        self.assertTrue(rule.is_active)

    def test_non_gapy_assign_driver_deactivated_gapy_kept(self):
        self.assertFalse(TaskRule.objects.get(title_key='tasks.assign_driver', condition_value='False').is_active)
        self.assertTrue(TaskRule.objects.get(title_key='tasks.assign_driver', condition_value='True').is_active)
```

- [ ] **Step 2: Run — FAIL**: `python manage.py test apps.export.tests_choose_truck_rule`

- [ ] **Step 3: Edit `seed_task_rules.py`**

Add `'is_active': False,` to the non-gapy `tasks.assign_driver` dict and update its comment to `# Retired 2026-09-29: regular shipments get their truck from a Planning trip (tasks.choose_truck).` Insert right after it:

```python
    {
        # Regular shipments: the export manager joins a Planning trip on the
        # Truck Board (spec 2026-09-29-transport-trips-design.md). Joining writes
        # Shipment.trip_id, which closes this task.
        'step': 'draft',
        'title_key': 'tasks.choose_truck',
        'assignee_role': 'export_manager',
        'target_fields': 'trip_id',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'target_value': '',
        'deadline_rule': '24h_after_status',
        'condition_field': 'is_gapy_satys',
        'condition_value': 'False',
    },
```

Check the resolver accepts `trip_id` as a target field: grep `target_fields` handling in `apps/export/services/task_rules.py` for an allow-list (e.g. against `SHEET_FIELD_KEYS`). If `trip_id` is rejected, add it to that list in the same commit and say so in the report.

i18n: add `"choose_truck": "Choose a truck (Planning trip)"` / ru `"Выбрать машину (рейс)"` / tk `"Maşyn saýla (reýs)"` inside the existing `tasks` object in each locale file.

- [ ] **Step 4: Run — PASS.** Also run `python manage.py test apps.export.tests_task_engine apps.export.tests_auto_advance --verbosity=1` (no new failures vs `git stash`-free baseline: compare with the same command on `origin/main` if anything fails).

- [ ] **Step 5: Do NOT run `seed_task_rules` against the shared DB now.** Live drafts would get `choose_truck`, which nobody can fill until the board is deployed. It is a deploy-time step (Task 12 docs + CHANGELOG). Also note for the deploy: deactivating the regular `assign_driver` rule makes `reconcile_open_tasks_with_rules()` cancel its OPEN tasks, and `is_step_trigger_satisfied` (`export/services/shipment.py:414`) treats CANCELLED as satisfied — so open regular drafts with no driver lose that gate. The user decides whether to accept that (handoff question).

- [ ] **Step 6: Commit**

```bash
git add backend/apps/export/management/commands/seed_task_rules.py backend/apps/export/tests_choose_truck_rule.py frontend/src/i18n/en.json frontend/src/i18n/ru.json frontend/src/i18n/tk.json
git commit -m "feat(p3): choose-truck task replaces assign-driver for regular shipments"
```

---

### Task 6: Truck Board page (frontend)

**Files:**
- Create: `frontend/src/types/externalTrip.ts`, `frontend/src/hooks/useExternalTrips.ts`, `frontend/src/pages/export/TruckBoard.tsx`, `frontend/src/pages/export/truckBoard/ShipmentNeedCard.tsx`, `TripCard.tsx`, `TripDrawer.tsx`, `TruckMatchPanel.tsx`, `truckBoardHelpers.ts`, tests `truckBoardHelpers.test.ts`, `TruckBoard.test.tsx`
- Modify: `frontend/src/App.tsx` (lazy import ~line 48, route next to `export/assign` ~line 197), `frontend/src/components/AppLayout.tsx` (`ROUTE_LABELS` ~157, `ITEMS` ~244, both menu groups ~366/~402), `frontend/src/utils/permissions.ts` (`ROUTE_PAGE_MAP` ~38), `frontend/src/i18n/{en,ru,tk}.json`

**Interfaces:**
- Consumes: endpoints from Task 4.
- Produces: `IExternalTrip`, `ICandidateShipment`, `ITripSyncState`; hooks `useExternalTrips(params)`, `useCandidateShipments()`, `useTripSyncState()`, `useAssignTrip()`, `useUnassignTrip()`; helpers `filterTripsForShipment`, `filterShipmentsForTrip`, `hasVisaFor`, `syncAgeMinutes`.

- [ ] **Step 1: Types**

```ts
// frontend/src/types/externalTrip.ts
export interface ITripPosition {
  lat: number;
  lon: number;
  address: string | null;
  fix_time: string | null;
  geofence_name: string | null;
}

export interface IExternalTrip {
  id: number;
  integration_trip_id: string;
  trip_number: string | null;
  status: string;
  planned_departure: string;
  changed_at: string;
  destination_country_code: string | null;
  tractor_plate: string;
  tractor_brand: string | null;
  tractor_model: string | null;
  tractor_company: string | null;
  tractor_source: 'GARAGE' | 'THIRD_PARTY';
  trailer_plate: string;
  trailer_brand: string | null;
  trailer_model: string | null;
  trailer_company: string | null;
  trailer_source: 'GARAGE' | 'THIRD_PARTY';
  driver_full_name: string;
  driver_phone: string | null;
  driver_passport_number: string | null;
  driver_passport_expiry: string | null;
  driver_source: 'GARAGE' | 'THIRD_PARTY';
  visas: { country: string; expiry_date: string }[];
  visa_country_codes: string[];
  shipment: number | null;
  shipment_code: string | null;
  conflict_note: string | null;
  last_push_status: string | null;
  last_push_error: string | null;
  position: ITripPosition | null;
}

export interface ICandidateShipment {
  id: number;
  code: string;
  date: string;
  country_code: string | null;
  country_name: string | null;
  customer_name: string | null;
  blocks: string[];
}

export interface ITripSyncState {
  last_success_at: string | null;
  last_error: string;
  is_mock: boolean;
}
```

- [ ] **Step 2: Failing helper tests**

```ts
// frontend/src/pages/export/truckBoard/truckBoardHelpers.test.ts
import { describe, expect, it } from 'vitest';
import { filterShipmentsForTrip, filterTripsForShipment, hasVisaFor, syncAgeMinutes } from './truckBoardHelpers';
import type { ICandidateShipment, IExternalTrip } from '@/types/externalTrip';

const trip = (id: number, code: string | null, visas: string[] = []) =>
  ({ id, destination_country_code: code, visa_country_codes: visas }) as IExternalTrip;
const ship = (id: number, code: string | null) => ({ id, country_code: code }) as ICandidateShipment;

describe('truckBoardHelpers', () => {
  it('keeps same-country trips first-class and unknown-country trips separate', () => {
    const { matching, unknown } = filterTripsForShipment([trip(1, 'KZ'), trip(2, 'RU'), trip(3, null)], ship(9, 'KZ'));
    expect(matching.map((t) => t.id)).toEqual([1]);
    expect(unknown.map((t) => t.id)).toEqual([3]);
  });

  it('with no shipment selected shows every trip as matching', () => {
    const { matching, unknown } = filterTripsForShipment([trip(1, 'KZ'), trip(3, null)], null);
    expect(matching.map((t) => t.id)).toEqual([1, 3]);
    expect(unknown).toEqual([]);
  });

  it('filters shipments by the selected trip country; unknown trip country keeps all', () => {
    expect(filterShipmentsForTrip([ship(1, 'KZ'), ship(2, 'RU')], trip(5, 'RU')).map((s) => s.id)).toEqual([2]);
    expect(filterShipmentsForTrip([ship(1, 'KZ'), ship(2, 'RU')], trip(5, null)).map((s) => s.id)).toEqual([1, 2]);
  });

  it('visa check is only a warning when the country code is known', () => {
    expect(hasVisaFor(trip(1, 'KZ', ['KZ']), 'KZ')).toBe(true);
    expect(hasVisaFor(trip(1, 'KZ', []), 'KZ')).toBe(false);
    expect(hasVisaFor(trip(1, 'KZ', []), null)).toBe(true);
  });

  it('computes sync age in whole minutes, null when never synced', () => {
    const now = new Date('2026-09-29T12:10:00Z');
    expect(syncAgeMinutes('2026-09-29T12:00:00Z', now)).toBe(10);
    expect(syncAgeMinutes(null, now)).toBeNull();
  });
});
```

Run: `npx vitest run src/pages/export/truckBoard/truckBoardHelpers.test.ts` → FAIL (module missing).

- [ ] **Step 3: Helpers**

```ts
// frontend/src/pages/export/truckBoard/truckBoardHelpers.ts
import type { ICandidateShipment, IExternalTrip } from '@/types/externalTrip';

export const STALE_SYNC_MINUTES = 10;

export function filterTripsForShipment(
  trips: IExternalTrip[],
  shipment: ICandidateShipment | null,
): { matching: IExternalTrip[]; unknown: IExternalTrip[] } {
  if (!shipment) return { matching: trips, unknown: [] };
  return {
    matching: trips.filter((t) => t.destination_country_code === shipment.country_code),
    unknown: trips.filter((t) => t.destination_country_code === null),
  };
}

export function filterShipmentsForTrip(
  shipments: ICandidateShipment[],
  trip: IExternalTrip | null,
): ICandidateShipment[] {
  if (!trip || trip.destination_country_code === null) return shipments;
  return shipments.filter((s) => s.country_code === trip.destination_country_code);
}

export function hasVisaFor(trip: IExternalTrip, countryCode: string | null): boolean {
  if (!countryCode) return true;
  return trip.visa_country_codes.includes(countryCode);
}

export function syncAgeMinutes(lastSuccessAt: string | null, now: Date = new Date()): number | null {
  if (!lastSuccessAt) return null;
  return Math.floor((now.getTime() - new Date(lastSuccessAt).getTime()) / 60_000);
}
```

Run again → PASS.

- [ ] **Step 4: Hooks**

```ts
// frontend/src/hooks/useExternalTrips.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import type { ICandidateShipment, IExternalTrip, ITripSyncState } from '@/types/externalTrip';

const BASE = '/transport/external-trips/';
export const TRIPS_KEY = ['transport', 'external-trips'] as const;

export function useExternalTrips(params: { free?: boolean; linked?: boolean } = {}) {
  return useQuery({
    queryKey: [...TRIPS_KEY, params],
    queryFn: async (): Promise<IExternalTrip[]> => {
      const { data } = await api.get<IExternalTrip[]>(BASE, {
        params: { free: params.free ? 1 : undefined, linked: params.linked ? 1 : undefined },
      });
      return data;
    },
    refetchInterval: 60_000,
  });
}

export function useCandidateShipments() {
  return useQuery({
    queryKey: [...TRIPS_KEY, 'candidates'],
    queryFn: async (): Promise<ICandidateShipment[]> => (await api.get(`${BASE}candidate-shipments/`)).data,
  });
}

export function useTripSyncState() {
  return useQuery({
    queryKey: [...TRIPS_KEY, 'sync-state'],
    queryFn: async (): Promise<ITripSyncState> => (await api.get(`${BASE}sync-state/`)).data,
    refetchInterval: 60_000,
  });
}

function useTripAction<TVars>(path: (vars: TVars) => string, body: (vars: TVars) => object) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: TVars): Promise<IExternalTrip> => (await api.post(path(vars), body(vars))).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TRIPS_KEY });
      queryClient.invalidateQueries({ queryKey: ['shipments'] });
    },
  });
}

export function useAssignTrip() {
  return useTripAction<{ tripId: number; shipmentId: number; confirmUnknownCountry?: boolean }>(
    (v) => `${BASE}${v.tripId}/assign/`,
    (v) => ({ shipment_id: v.shipmentId, confirm_unknown_country: !!v.confirmUnknownCountry }),
  );
}

export function useUnassignTrip() {
  return useTripAction<{ tripId: number }>((v) => `${BASE}${v.tripId}/unassign/`, () => ({}));
}

export function tripDocumentUrl(tripId: number): string {
  const base = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';
  return `${base}${BASE}${tripId}/document/`;
}
```

- [ ] **Step 5: Cards, drawer, match panel, page**

`ShipmentNeedCard.tsx` — copy the visual shell of `pages/export/assignment/SupplyCard.tsx` (props `{ shipment: ICandidateShipment; selected: boolean; onSelect: () => void }`), rendering `code`, `date`, `country_name` (or `t('truck_board.no_country')` in grey), `customer_name`, `blocks.join(', ')`.

`TripCard.tsx`:

```tsx
import { Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { IExternalTrip } from '@/types/externalTrip';
import { hasVisaFor } from './truckBoardHelpers';
import { COLORS } from '@/constants/styles';

const { Text } = Typography;

interface IProps {
  trip: IExternalTrip;
  selected: boolean;
  dimmed?: boolean;
  countryCode: string | null;
  onSelect: () => void;
  onOpen: () => void;
}

export function TripCard({ trip, selected, dimmed, countryCode, onSelect, onOpen }: IProps) {
  const { t } = useTranslation();
  const where = trip.position
    ? trip.position.geofence_name ?? trip.position.address ?? `${trip.position.lat.toFixed(3)}, ${trip.position.lon.toFixed(3)}`
    : t('truck_board.no_gps');
  return (
    <div
      data-testid={`trip-card-${trip.id}`}
      onClick={onSelect}
      onDoubleClick={onOpen}
      style={{
        border: `1px solid ${selected ? COLORS.primary : '#f0f0f0'}`, borderRadius: 8, padding: 10,
        marginBottom: 8, cursor: 'pointer', opacity: dimmed ? 0.55 : 1, background: '#fff',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <Text strong>{trip.tractor_plate} / {trip.trailer_plate}</Text>
        <Text type="secondary">{trip.planned_departure}</Text>
      </div>
      <div>{trip.driver_full_name}</div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
        <Tag>{trip.tractor_source === 'GARAGE' ? t('truck_board.garage') : t('truck_board.third_party')}</Tag>
        {trip.destination_country_code && <Tag color="blue">{trip.destination_country_code}</Tag>}
        {!hasVisaFor(trip, countryCode) && <Tag color="orange">⚠ {t('truck_board.no_visa')}</Tag>}
      </div>
      <Text type="secondary" style={{ fontSize: 12 }}>📍 {where}</Text>
      <a style={{ float: 'right', fontSize: 12 }} onClick={(e) => { e.stopPropagation(); onOpen(); }}>
        {t('truck_board.details')}
      </a>
    </div>
  );
}
```

If `COLORS.primary` does not exist in `@/constants/styles`, use the key `AssignmentBoard`/`SupplyCard` use for the selected border.

`TripDrawer.tsx` — antd `Drawer` (pattern `pages/feedback/MyTicketsPage.tsx:242`, `width={520} destroyOnHidden`). Content: `Descriptions` with all tractor/trailer/driver fields, passport number + expiry, visas list (`country — expiry_date`), trip number/status; a mini map when `trip.position` — reuse the `MapContainer`/`TileLayer`/`Marker` + `pinIcon` block from `components/shipment/ShipmentTruckLocationBlock.tsx` (copy the ~20 lines, height 220, centred on `[lat, lon]`, zoom 12); a button `t('truck_board.documents_pdf')` that does `window.open(tripDocumentUrl(trip.id), '_blank')`.

`TruckMatchPanel.tsx` — props `{ shipment: ICandidateShipment | null; trip: IExternalTrip | null; canAssign: boolean; isReadOnly: boolean; isLoading: boolean; onAssign: () => void; onClear: () => void }`. Shows both selections side by side, a red `Alert` `t('truck_board.country_mismatch')` when both chosen and `trip.destination_country_code` is non-null and differs, and the Assign button disabled unless both chosen, no mismatch, `canAssign && !isReadOnly`.

`TruckBoard.tsx` (layout copied from `AssignmentBoard.tsx`: header, `gridTemplateColumns: '320px 1fr 340px'`):

```tsx
import { useMemo, useState } from 'react';
import { Alert, Modal, Spin, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useSeasonReadOnly } from '@/hooks/useSeasonReadOnly';
import { canDo } from '@/utils/permissions';
import {
  useAssignTrip, useCandidateShipments, useExternalTrips, useTripSyncState,
} from '@/hooks/useExternalTrips';
import { ShipmentNeedCard } from './truckBoard/ShipmentNeedCard';
import { TripCard } from './truckBoard/TripCard';
import { TripDrawer } from './truckBoard/TripDrawer';
import { TruckMatchPanel } from './truckBoard/TruckMatchPanel';
import {
  STALE_SYNC_MINUTES, filterShipmentsForTrip, filterTripsForShipment, syncAgeMinutes,
} from './truckBoard/truckBoardHelpers';

const { Title, Text } = Typography;

export default function TruckBoard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isReadOnly = useSeasonReadOnly();
  const canAssign = canDo(user, 'shipment_assign', 'edit');
  const { data: shipments = [], isLoading: shipmentsLoading } = useCandidateShipments();
  const { data: trips = [], isLoading: tripsLoading } = useExternalTrips({ free: true });
  const { data: sync } = useTripSyncState();
  const assign = useAssignTrip();

  const [shipmentId, setShipmentId] = useState<number | null>(null);
  const [tripId, setTripId] = useState<number | null>(null);
  const [drawerTripId, setDrawerTripId] = useState<number | null>(null);

  const shipment = shipments.find((s) => s.id === shipmentId) ?? null;
  const trip = trips.find((tr) => tr.id === tripId) ?? null;
  const { matching, unknown } = useMemo(() => filterTripsForShipment(trips, shipment), [trips, shipment]);
  const visibleShipments = useMemo(() => filterShipmentsForTrip(shipments, trip), [shipments, trip]);
  const age = syncAgeMinutes(sync?.last_success_at ?? null);

  function doAssign(confirmUnknownCountry = false) {
    if (!shipment || !trip) return;
    assign.mutate(
      { tripId: trip.id, shipmentId: shipment.id, confirmUnknownCountry },
      {
        onSuccess: () => {
          toast.success(t('truck_board.assigned', { code: shipment.code }));
          setShipmentId(null);
          setTripId(null);
        },
        onError: (err: any) => toast.error(t(`truck_board.error.${err?.response?.data?.detail ?? 'generic'}`)),
      },
    );
  }

  function handleAssign() {
    if (trip?.destination_country_code === null) {
      Modal.confirm({ title: t('truck_board.unknown_country_confirm'), onOk: () => doAssign(true) });
      return;
    }
    doAssign();
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Title level={4}>{t('truck_board.title')}</Title>
          <Text type="secondary">{t('truck_board.subtitle')}</Text>
        </div>
        <div>
          {sync?.is_mock && <Tag color="orange">{t('common.demo_badge')}</Tag>}
          <Text type={age !== null && age > STALE_SYNC_MINUTES ? 'warning' : 'secondary'} data-testid="sync-age">
            {age === null ? t('truck_board.never_synced') : t('truck_board.synced_ago', { minutes: age })}
          </Text>
        </div>
      </div>
      {sync?.last_error && <Alert type="warning" showIcon message={t('truck_board.sync_error')} style={{ margin: '8px 0' }} />}
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr 340px', gap: 14, marginTop: 12 }}>
        <div>
          <Text strong>{t('truck_board.col_shipments')} · {visibleShipments.length}</Text>
          {shipmentsLoading ? <Spin /> : visibleShipments.map((s) => (
            <ShipmentNeedCard key={s.id} shipment={s} selected={s.id === shipmentId}
              onSelect={() => setShipmentId(s.id === shipmentId ? null : s.id)} />
          ))}
        </div>
        <TruckMatchPanel shipment={shipment} trip={trip} canAssign={canAssign} isReadOnly={isReadOnly}
          isLoading={assign.isPending} onAssign={handleAssign}
          onClear={() => { setShipmentId(null); setTripId(null); }} />
        <div>
          <Text strong>{t('truck_board.col_trips')} · {matching.length}</Text>
          {tripsLoading ? <Spin /> : matching.map((tr) => (
            <TripCard key={tr.id} trip={tr} selected={tr.id === tripId} countryCode={shipment?.country_code ?? null}
              onSelect={() => setTripId(tr.id === tripId ? null : tr.id)} onOpen={() => setDrawerTripId(tr.id)} />
          ))}
          {unknown.length > 0 && <Text type="secondary">{t('truck_board.unknown_country_group')}</Text>}
          {unknown.map((tr) => (
            <TripCard key={tr.id} trip={tr} dimmed selected={tr.id === tripId} countryCode={shipment?.country_code ?? null}
              onSelect={() => setTripId(tr.id === tripId ? null : tr.id)} onOpen={() => setDrawerTripId(tr.id)} />
          ))}
        </div>
      </div>
      <TripDrawer trip={trips.find((tr) => tr.id === drawerTripId) ?? null} onClose={() => setDrawerTripId(null)} />
    </div>
  );
}
```

- [ ] **Step 6: Route, menu, page map, i18n**

- `App.tsx`: `const TruckBoard = lazy(() => import('@/pages/export/TruckBoard'));` and next to `export/assign`:
  `<Route path="export/truck-board" element={<ProtectedRoute pageCode="export.truck_board"><TruckBoard /></ProtectedRoute>} />`
- `utils/permissions.ts` `ROUTE_PAGE_MAP`: `'/export/truck-board': 'export.truck_board',`
- `AppLayout.tsx`: `ROUTE_LABELS['/export/truck-board'] = t('nav.truck_board')`; `ITEMS` entry `'/export/truck-board': { key: '/export/truck-board', icon: <IconTruck size={15} />, label: t('nav.truck_board') },` (use whichever tabler icon the file already imports for trucks; else `IconTruck` from `@tabler/icons-react`); add `'/export/truck-board'` to `BOSS_MENU_GROUPS` `nav.group_shipping` and to `STAFF_MENU_GROUPS` `nav.group_export`.
- i18n — add to each locale (`nav.truck_board` + a `truck_board` object):

en:
```json
"truck_board": {
  "title": "Truck Board", "subtitle": "Join Planning trips to regular shipments",
  "col_shipments": "Shipments without a truck", "col_trips": "Planned trucks",
  "no_country": "No country", "no_gps": "No GPS", "garage": "Own fleet", "third_party": "Third party",
  "no_visa": "No visa", "details": "Details", "documents_pdf": "Trip documents (PDF)",
  "assign": "Assign", "clear": "Clear", "assigned": "Truck assigned to {{code}}",
  "country_mismatch": "Countries do not match", "unknown_country_group": "Trip country not set",
  "unknown_country_confirm": "The trip's country is not set. Assign anyway?",
  "synced_ago": "Synced {{minutes}} min ago", "never_synced": "Not synced yet",
  "sync_error": "Planning is not responding — showing the last received trips",
  "error": { "trip_taken": "This truck is already assigned", "country_mismatch": "Countries do not match",
    "country_unknown": "Trip country not set", "not_draft": "Shipment is past Preparation",
    "has_trip": "Shipment already has a truck", "trip_closed": "Trip is closed or cancelled",
    "gapy": "Gate-sale shipments keep their own driver", "locked": "Shipment is locked — loading started",
    "generic": "Could not save" }
}
```
ru: same keys — «Машины ↔ Отгрузки», «Связать рейсы Planning с обычными отгрузками», «Отгрузки без машины», «Запланированные машины», «Страна не указана», «Нет GPS», «Свой парк», «Сторонний», «Нет визы», «Подробнее», «Документы рейса (PDF)», «Привязать», «Сбросить», «Машина привязана к {{code}}», «Страны не совпадают», «Страна рейса не указана», «Страна рейса не указана. Всё равно привязать?», «Синхронизация {{minutes}} мин назад», «Ещё не синхронизировано», «Planning не отвечает — показаны последние полученные рейсы», errors: «Эта машина уже привязана», «Страны не совпадают», «Страна рейса не указана», «Отгрузка уже прошла подготовку», «У отгрузки уже есть машина», «Рейс закрыт или отменён», «У gapy satyş свой водитель», «Отгрузка заблокирована — погрузка началась», «Не удалось сохранить».
tk: «Maşynlar ↔ Ugratmalar», «Planning reýslerini adaty ugratmalara birikdir», «Maşynsyz ugratmalar», «Meýilleşdirilen maşynlar», «Ýurt görkezilmedik», «GPS ýok», «Öz parkymyz», «Daşary», «Wiza ýok», «Jikme-jik», «Reýs resminamalary (PDF)», «Birikdir», «Arassala», «Maşyn {{code}} bilen birikdirildi», «Ýurtlar gabat gelmeýär», «Reýsiň ýurdy görkezilmedik», «Reýsiň ýurdy görkezilmedik. Şonda-da birikdirilsinmi?», «{{minutes}} min öň sinhronlandy», «Entek sinhronlanmady», «Planning jogap bermeýär — soňky alnan reýsler görkezilýär», errors: «Bu maşyn eýýäm birikdirilen», «Ýurtlar gabat gelmeýär», «Reýsiň ýurdy görkezilmedik», «Ugratma taýýarlykdan geçdi», «Ugratmanyň eýýäm maşyny bar», «Reýs ýapyk ýa-da ýatyryldy», «Gapy satyşyň öz sürüjisi bar», «Ugratma gulplandy — ýükleme başlady», «Ýatda saklap bolmady».
`nav.truck_board`: en "Truck Board", ru "Машины ↔ Отгрузки", tk "Maşynlar ↔ Ugratmalar".

- [ ] **Step 7: Page test**

```tsx
// frontend/src/pages/export/TruckBoard.test.tsx
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import TruckBoard from './TruckBoard';
import * as trips from '@/hooks/useExternalTrips';

vi.mock('@/hooks/useExternalTrips');
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { is_superuser: true } }) }));
vi.mock('@/hooks/useSeasonReadOnly', () => ({ useSeasonReadOnly: () => false }));
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: any) => <div>{children}</div>, TileLayer: () => null, Marker: () => null,
  Popup: () => null, useMap: () => ({ setView: vi.fn(), invalidateSize: vi.fn() }),
}));

const base = { visas: [], visa_country_codes: [], position: null, tractor_source: 'GARAGE', trailer_plate: 'T', driver_full_name: 'D', planned_departure: '2026-10-01' };

beforeAll(async () => { await i18n.changeLanguage('en'); });

function renderBoard() {
  vi.mocked(trips.useCandidateShipments).mockReturnValue({ data: [
    { id: 1, code: 'KZ-SHIP', date: '2026-10-01', country_code: 'KZ', country_name: 'GAZAGYSTAN', customer_name: 'C', blocks: ['A'] },
    { id: 2, code: 'RU-SHIP', date: '2026-10-01', country_code: 'RU', country_name: 'RUSSIYA', customer_name: 'C', blocks: ['B'] },
  ], isLoading: false } as any);
  vi.mocked(trips.useExternalTrips).mockReturnValue({ data: [
    { ...base, id: 10, tractor_plate: 'KZ-TRUCK', destination_country_code: 'KZ' },
    { ...base, id: 11, tractor_plate: 'RU-TRUCK', destination_country_code: 'RU' },
    { ...base, id: 12, tractor_plate: 'NO-COUNTRY', destination_country_code: null },
  ], isLoading: false } as any);
  vi.mocked(trips.useTripSyncState).mockReturnValue({ data: { last_success_at: null, last_error: '', is_mock: true } } as any);
  vi.mocked(trips.useAssignTrip).mockReturnValue({ mutate: vi.fn(), isPending: false } as any);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><TruckBoard /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TruckBoard', () => {
  it('selecting a KZ shipment hides RU trucks and greys unknown-country trucks', () => {
    renderBoard();
    fireEvent.click(screen.getByText('KZ-SHIP'));
    expect(screen.queryByText(/RU-TRUCK/)).toBeNull();
    expect(screen.getByText(/KZ-TRUCK/)).toBeInTheDocument();
    expect(screen.getByText(/NO-COUNTRY/)).toBeInTheDocument();
    expect(screen.getByText('Trip country not set')).toBeInTheDocument();
  });

  it('selecting a RU truck hides KZ shipments', () => {
    renderBoard();
    fireEvent.click(screen.getByText(/RU-TRUCK/));
    expect(screen.queryByText('KZ-SHIP')).toBeNull();
    expect(screen.getByText('RU-SHIP')).toBeInTheDocument();
  });

  it('shows the demo badge in mock mode', () => {
    renderBoard();
    expect(screen.getByText('Demo')).toBeInTheDocument();
  });
});
```

Run: `npx vitest run src/pages/export/TruckBoard.test.tsx src/pages/export/truckBoard` → PASS. Then `npx tsc --noEmit --ignoreDeprecations 5.0` → no errors (`npm run type-check` is broken — memory).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/types/externalTrip.ts frontend/src/hooks/useExternalTrips.ts frontend/src/pages/export/TruckBoard.tsx frontend/src/pages/export/TruckBoard.test.tsx frontend/src/pages/export/truckBoard frontend/src/App.tsx frontend/src/components/AppLayout.tsx frontend/src/utils/permissions.ts frontend/src/i18n/en.json frontend/src/i18n/ru.json frontend/src/i18n/tk.json
git commit -m "feat(frontend): Truck Board joins Planning trips to shipments"
```

**— Demo-path cut line —**

---

### Task 7: System rollback to draft (export side)

**Files:**
- Modify: `backend/apps/export/services/shipment.py` (`transition_to`, lines ~224-300)
- Create: `backend/apps/export/services/rollback.py`
- Test: `backend/apps/export/tests_rollback.py`

**Interfaces:**
- Produces:
  - `transition_to(..., rollback: bool = False)` — with `rollback=True` the only allowed targets are `ROLLBACK_TRANSITIONS[current]`; requires `is_auto=True`.
  - `ROLLBACK_TRANSITIONS = {'gumruk_girish': 'draft', 'gumruk_chykysh': 'draft', 'yuklenme': 'draft'}`.
  - `is_transport_locked(shipment) -> bool`.
  - `rollback_to_draft(shipment, user, reason: str) -> None`.
  - `reopen_rule_task(shipment, title_key: str) -> bool`.

- [ ] **Step 1: Failing tests**

```python
# backend/apps/export/tests_rollback.py
from django.test import TestCase
from django.utils import timezone

from apps.export.models import Task, TaskState
from apps.export.services.rollback import is_transport_locked, reopen_rule_task, rollback_to_draft
from apps.export.services.shipment import TRANSITIONS, transition_to
from apps.export.tests_auto_advance import (  # reuse the full-draft builders
    _ensure_statuses, _make_season, _make_user, _seed_rules,
)


def make_advanced_shipment(user):
    """A regular shipment that auto-advanced out of draft into gumruk_girish.

    Body written in Step 3 (copied builder). Module-level so
    apps.transport.tests.test_trip_change can reuse it.
    """


class RollbackTests(TestCase):
    """Builds a shipment that auto-advanced out of draft, then rolls it back."""

    def setUp(self):
        _ensure_statuses()
        _seed_rules()
        self.user = _make_user('doc', 'document_team')
        self.shipment = make_advanced_shipment(self.user)

    def test_backward_edge_is_not_in_the_public_table(self):
        self.assertNotIn('draft', [edge[0] for edge in TRANSITIONS['gumruk_girish']])

    def test_rollback_flag_required(self):
        with self.assertRaises(ValueError):
            transition_to(self.shipment, 'draft', self.user, is_auto=True)

    def test_rollback_lands_in_draft_and_logs_reason(self):
        rollback_to_draft(self.shipment, self.user, 'Transport changed: A → B')
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.status.code, 'draft')
        self.assertEqual(self.shipment.documents_status, 'in_progress')
        self.assertEqual(self.shipment.status_logs.latest('id').comment, 'Transport changed: A → B')

    def test_save_after_rollback_does_not_auto_advance(self):
        """Review Focus 2."""
        rollback_to_draft(self.shipment, self.user, 'x')
        self.shipment.refresh_from_db()
        self.shipment.driver_phone = '99365000000'
        self.shipment.updated_by = self.user
        self.shipment.save()
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.status.code, 'draft')
        task = Task.objects.get(shipment=self.shipment, rule__title_key='tasks.start_documents_prep')
        self.assertEqual(task.state, TaskState.OPEN)

    def test_rollback_from_customs_exit_clears_customs_exit(self):
        self.shipment.customs_exit_at = timezone.now()
        self.shipment.updated_by = self.user
        self.shipment.save()
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.status.code, 'gumruk_chykysh')
        rollback_to_draft(self.shipment, self.user, 'x')
        self.shipment.refresh_from_db()
        self.assertIsNone(self.shipment.customs_exit_at)
        self.assertEqual(self.shipment.status.code, 'draft')

    def test_redone_documents_stop_at_customs_after_rollback_from_customs_exit(self):
        """The cascade must not replay gumruk_girish → gumruk_chykysh on stale DONE tasks."""
        self.shipment.customs_exit_at = timezone.now()
        self.shipment.updated_by = self.user
        self.shipment.save()
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.status.code, 'gumruk_chykysh')
        rollback_to_draft(self.shipment, self.user, 'x')
        self.shipment.refresh_from_db()
        self.shipment.documents_status = 'ready'
        self.shipment.updated_by = self.user
        self.shipment.save()
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.status.code, 'gumruk_girish')
        task = Task.objects.get(shipment=self.shipment, rule__title_key='tasks.trigger_customs_exit')
        self.assertEqual(task.state, TaskState.OPEN)

    def test_locked_rules(self):
        self.assertFalse(is_transport_locked(self.shipment))
        self.shipment.status = type(self.shipment.status).objects.get(code='yuklenme')
        self.assertFalse(is_transport_locked(self.shipment))
        self.shipment.loading_started_at = timezone.now()
        self.assertTrue(is_transport_locked(self.shipment))
        self.shipment.loading_started_at = None
        self.shipment.status = type(self.shipment.status).objects.get(code='yola_chykdy')
        self.assertTrue(is_transport_locked(self.shipment))

    def test_reopen_rule_task_returns_false_when_absent(self):
        self.assertFalse(reopen_rule_task(self.shipment, 'tasks.no_such_task'))
```

Check the related name for status logs (`status_logs`?) in `apps/export/models` and fix if different.

- [ ] **Step 2: Run — FAIL**: `python manage.py test apps.export.tests_rollback`

- [ ] **Step 3: Write the body of `make_advanced_shipment(user)`** by copying the builder from `tests_auto_advance.py` (~line 82, the helper that creates a fully joined draft); `return s` at the end. Fill the draft targets listed in the seeded rules: `country, customer, import_firm` (set_destination), a `ShipmentFirmSplit` (pick_export_firms), `trip_id=1` (choose_truck), `border_point` (set_border_point), `documents_status='ready'` (start_documents_prep), and mark the MANUAL_DONE `tasks.give_documents` task DONE (`Task.objects.filter(shipment=s, rule__title_key='tasks.give_documents').update(state=TaskState.DONE)`) before the final save. End with `self.assertEqual(s.status.code, 'gumruk_girish')`. If the draft does not advance, print `[(t.rule.title_key, t.state) for t in s.tasks.all()]` and fill what is missing.

- [ ] **Step 4: Implement the `transition_to` change**

In `apps/export/services/shipment.py` after `TRANSITIONS`:

```python
# System-only backward edges (spec 2026-09-29-transport-trips §6.1). Kept OUT of
# TRANSITIONS on purpose: that table feeds the manual /transition/ UI and
# auto-advance edge selection; neither may ever offer a step back.
ROLLBACK_TRANSITIONS: dict[str, str] = {
    'gumruk_girish': 'draft',
    'gumruk_chykysh': 'draft',
    'yuklenme': 'draft',
}
```

Signature becomes `transition_to(shipment, new_status_code, user, comment='', is_auto=False, notify=True, rollback=False)`; document `rollback` in the docstring Args. Replace the allowed-codes block:

```python
    current_code = shipment.status.code if shipment.status_id else None
    if rollback:
        if not is_auto or ROLLBACK_TRANSITIONS.get(current_code) != new_status_code:
            raise ValueError(f'No system rollback from {current_code!r} to {new_status_code!r}')
        edges = []
    else:
        edges = TRANSITIONS.get(current_code, [])
        allowed_codes = [_edge_to(edge) for edge in edges]
        if new_status_code not in allowed_codes:
            raise ValueError(
                f'Cannot transition from {current_code!r} to {new_status_code!r}. '
                f'Allowed: {allowed_codes}'
            )
```

The draft join-guard (`current_code == 'draft'`) and the role check (skipped because `is_auto`) need no change. In the AuditLog `detail`, append `' (rollback)'` when `rollback`.

- [ ] **Step 5: Implement `rollback.py`**

```python
# backend/apps/export/services/rollback.py
"""Put a shipment back into Preparation when its truck changes (spec §6.1).

Order matters: the re-gate (documents_status, customs_exit_at, reopened task)
is written with queryset.update() BEFORE transition_to(). transition_to saves
the shipment, Shipment.save() runs auto-advance, and without the re-gate every
draft task is already DONE — the cascade would walk straight back to customs.
"""
from django.utils import timezone

from apps.export.models import Shipment, Task, TaskState
from apps.export.services.shipment import transition_to

LOCKED_STATUSES = frozenset({
    'yola_chykdy', 'serhet_gechdi', 'dest_entry', 'barysh_gumrugi', 'transshipment',
    'bardy', 'satylyar', 'satyldy', 'tamamlandy', 'cancelled',
})
# The lifecycle up to loading, and the auto-rule that gates leaving each step
# (seed_task_rules.py). Rolling back from S re-opens the gate of every step the
# shipment already passed after draft, and clears its trigger field — otherwise
# generate_tasks_for_status (which skips rules that already have a Task) leaves
# them DONE and the cascade replays straight through them.
PRE_LOADING_ORDER = ('draft', 'gumruk_girish', 'gumruk_chykysh', 'yuklenme')
STEP_GATES = {
    'gumruk_girish': ('tasks.trigger_customs_exit', 'customs_exit_at'),
    'gumruk_chykysh': ('tasks.trigger_loading_start', 'loading_started_at'),
}


def is_transport_locked(shipment: Shipment) -> bool:
    """True when the truck may no longer change on this shipment (spec D6)."""
    code = shipment.status.code
    if code in LOCKED_STATUSES:
        return True
    return code == 'yuklenme' and bool(shipment.loading_started_at or shipment.loading_ended_at)


def reopen_rule_task(shipment: Shipment, title_key: str) -> bool:
    now = timezone.now()
    updated = Task.objects.filter(
        shipment=shipment, rule__title_key=title_key, state=TaskState.DONE,
    ).update(state=TaskState.OPEN, completed_at=None, completed_by=None, started_at=None)
    return bool(updated)


def rollback_to_draft(shipment: Shipment, user, reason: str) -> None:
    code = shipment.status.code
    if code == 'draft':
        return
    regate = {'documents_status': 'in_progress'}
    passed = PRE_LOADING_ORDER[1:PRE_LOADING_ORDER.index(code)]
    for step in passed:
        _, field = STEP_GATES[step]
        regate[field] = None
    Shipment.objects.filter(pk=shipment.pk).update(**regate)
    for name, value in regate.items():
        setattr(shipment, name, value)
    reopen_rule_task(shipment, 'tasks.start_documents_prep')
    for step in passed:
        reopen_rule_task(shipment, STEP_GATES[step][0])
    transition_to(shipment, 'draft', user, comment=reason, is_auto=True, notify=False, rollback=True)
```

`now` in `reopen_rule_task` is unused — delete it. If `Task` has no `started_at`, drop it from the update. If the reopened task needs a fresh deadline, set `deadline=parse_deadline_rule(...)` per task like `_reopen_task` at `task_rules.py:281` does (loop instead of `.update`).

- [ ] **Step 6: Run — PASS**: `python manage.py test apps.export.tests_rollback apps.export.tests --verbosity=1` (the second covers `test_invalid_transition_backwards_raises`, which must still pass).

- [ ] **Step 7: Commit**

```bash
git add backend/apps/export/services/shipment.py backend/apps/export/services/rollback.py backend/apps/export/tests_rollback.py
git commit -m "feat(p3): system-only rollback to Preparation with a documents re-gate"
```

---

### Task 8: React to Planning changes — apply, conflict, accept, move, simulate

**Files:**
- Modify: `backend/apps/transport/services/trip_assignment.py`, `backend/apps/transport/tasks.py`, `backend/apps/transport/views_trips.py`
- Create: `backend/apps/transport/management/commands/simulate_trip_change.py`
- Test: `backend/apps/transport/tests/test_trip_change.py`

**Interfaces:**
- Consumes: `rollback_to_draft`, `is_transport_locked`, `reopen_rule_task` (Task 7); `get_sync_user` (Task 4).
- Produces: `apply_trip_change(trip, user) -> str` returning one of `'applied'`, `'applied_rollback'`, `'unlinked'`, `'unlinked_rollback'`, `'conflict'`; `accept_trip_change(trip, user) -> None`; `move_trip(trip, to_shipment, user) -> None`; new `unassign_trip` using the §6 table; endpoints `POST {id}/accept-change/`, `POST {id}/move/` body `{shipment_id}`.

- [ ] **Step 1: Failing tests**

```python
# backend/apps/transport/tests/test_trip_change.py
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone

from apps.core.models import Country, ShipmentStatusType
from apps.export.models import Notification, ShipmentComment
from apps.transport.models import ExternalTrip
from apps.transport.services.trip_assignment import (
    AssignmentError, accept_trip_change, apply_trip_change, assign_trip, move_trip, unassign_trip,
)
from apps.transport.tests.test_trip_assignment import make_trip
from apps.transport.tests.test_trip_sync import _make_shipment

User = get_user_model()


class ApplyTripChangeTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='em', password='x', role='export_manager')
        self.kz = Country.objects.create(code='KZ', name_tk='GAZAGYSTAN')
        self.shipment = _make_shipment(country=self.kz)
        self.trip = make_trip()
        assign_trip(self.trip, self.shipment, self.user)
        self.trip.refresh_from_db()

    def _swap_driver(self):
        self.trip.driver_full_name = 'Täze Sürüji'
        self.trip.save()

    def _set_status(self, code, **fields):
        status, _ = ShipmentStatusType.objects.get_or_create(code=code, defaults={'name_tk': code})
        type(self.shipment).objects.filter(pk=self.shipment.pk).update(status=status, **fields)
        self.shipment.refresh_from_db()
        self.trip.refresh_from_db()

    def test_draft_change_applies_and_comments(self):
        self._swap_driver()
        self.assertEqual(apply_trip_change(self.trip, self.user), 'applied')
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.driver_name, 'Täze Sürüji')
        comment = ShipmentComment.objects.filter(shipment=self.shipment, is_system=True).latest('id')
        self.assertIn('Amandurdyyew Atajan', comment.content)
        self.assertIn('Täze Sürüji', comment.content)
        self.assertTrue(Notification.objects.filter(user=self.user, link=f'/shipments/{self.shipment.pk}').exists())

    def test_departed_shipment_gets_conflict_not_change(self):
        self._set_status('yola_chykdy')
        self._swap_driver()
        self.assertEqual(apply_trip_change(self.trip, self.user), 'conflict')
        self.shipment.refresh_from_db()
        self.trip.refresh_from_db()
        self.assertEqual(self.shipment.driver_name, 'Amandurdyyew Atajan')
        self.assertIn('Täze Sürüji', self.trip.conflict_note)

    def test_loading_started_is_a_conflict(self):
        self._set_status('yuklenme', loading_started_at=timezone.now())
        self._swap_driver()
        self.assertEqual(apply_trip_change(self.trip, self.user), 'conflict')

    def test_cancel_in_draft_unlinks(self):
        self.trip.status = 'CANCELLED'
        self.trip.save()
        self.assertEqual(apply_trip_change(self.trip, self.user), 'unlinked')
        self.shipment.refresh_from_db()
        self.trip.refresh_from_db()
        self.assertIsNone(self.shipment.trip_id)
        self.assertIsNone(self.trip.shipment_id)

    def test_cancel_when_locked_is_conflict_and_stays_linked(self):
        self._set_status('yola_chykdy')
        self.trip.status = 'CANCELLED'
        self.trip.save()
        self.assertEqual(apply_trip_change(self.trip, self.user), 'conflict')
        self.trip.refresh_from_db()
        self.assertEqual(self.trip.shipment_id, self.shipment.pk)

    def test_accept_applies_despite_lock_and_clears_conflict(self):
        self._set_status('yola_chykdy')
        self._swap_driver()
        apply_trip_change(self.trip, self.user)
        self.trip.refresh_from_db()
        accept_trip_change(self.trip, self.user)
        self.shipment.refresh_from_db()
        self.trip.refresh_from_db()
        self.assertEqual(self.shipment.driver_name, 'Täze Sürüji')
        self.assertIsNone(self.trip.conflict_note)
        self.assertEqual(self.shipment.status.code, 'yola_chykdy')

    def test_move_refused_when_source_locked(self):
        self._set_status('yola_chykdy')
        other = _make_shipment(code='T-2', country=self.kz)
        with self.assertRaises(AssignmentError) as ctx:
            move_trip(self.trip, other, self.user)
        self.assertEqual(ctx.exception.code, 'locked')

    def test_move_between_drafts(self):
        other = _make_shipment(code='T-2', country=self.kz)
        move_trip(self.trip, other, self.user)
        self.shipment.refresh_from_db()
        other.refresh_from_db()
        self.assertIsNone(self.shipment.trip_id)
        self.assertEqual(other.trip_id, self.trip.pk)

    def test_unassign_in_draft_clears_trip(self):
        unassign_trip(self.trip, self.user)
        self.shipment.refresh_from_db()
        self.assertIsNone(self.shipment.trip_id)


@override_settings(TRANSPORT_API_MODE='mock')
class RollbackPathTests(TestCase):
    """Customs-status change → rollback to draft. Reuses the full builder from
    apps.export.tests_rollback (RollbackTests._make_advanced_shipment)."""

    def test_customs_change_rolls_back(self):
        from apps.export.tests_auto_advance import _ensure_statuses, _make_user, _seed_rules
        from apps.export.tests_rollback import make_advanced_shipment
        _ensure_statuses()
        _seed_rules()
        user = _make_user('doc', 'document_team')
        shipment = make_advanced_shipment(user)
        shipment.country = Country.objects.get_or_create(code='KZ', defaults={'name_tk': 'GAZAGYSTAN'})[0]
        trip = make_trip(integration_trip_id='b242b4de-a941-4dba-899e-3b0235e9f4ec')
        ExternalTrip.objects.filter(pk=trip.pk).update(shipment=shipment)
        type(shipment).objects.filter(pk=shipment.pk).update(trip_id=trip.pk)
        trip.refresh_from_db()
        trip.driver_full_name = 'Täze Sürüji'
        trip.save()
        self.assertEqual(apply_trip_change(trip, user), 'applied_rollback')
        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'draft')
        self.assertEqual(shipment.driver_name, 'Täze Sürüji')
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement in `trip_assignment.py`**

Replace `unassign_trip` and add:

```python
from django.contrib.auth import get_user_model

from apps.export.models import Notification, ShipmentComment
from apps.export.services.rollback import is_transport_locked, reopen_rule_task, rollback_to_draft

NOTIFY_ROLES = ('export_manager',)
NOTIFY_ROLES_ON_ROLLBACK = ('export_manager', 'document_team')


def _describe(values: dict) -> str:
    return f"{values.get('truck_plate') or '—'}, {values.get('driver_name') or '—'}"


def _notify(shipment: Shipment, roles: tuple[str, ...], message: str) -> None:
    users = get_user_model().objects.filter(role__in=roles, is_active=True).values_list('pk', flat=True)
    Notification.objects.bulk_create(
        [Notification(user_id=uid, kind='action_required', message=message[:500],
                      link=f'/shipments/{shipment.pk}') for uid in users],
        batch_size=500,
    )


def _record(shipment: Shipment, user, message: str, roles: tuple[str, ...]) -> None:
    ShipmentComment.objects.create(shipment=shipment, user=user, content=message[:2000], is_system=True)
    _notify(shipment, roles, f'{shipment.shipment_code}: {message}')


def _current_values(shipment: Shipment) -> dict:
    return {field: getattr(shipment, field) for field in TRANSPORT_FIELDS}


def apply_trip_change(trip: ExternalTrip, user) -> str:
    """React to a real Planning change on a linked trip (spec §6 table)."""
    shipment = trip.shipment
    if shipment is None:
        return 'unlinked'
    cancelled = trip.status == 'CANCELLED'
    old = _current_values(shipment)
    new = dict(EMPTY_VALUES) if cancelled else trip_values(trip)
    what = 'Planning cancelled the trip' if cancelled else 'Planning changed the truck'
    message = f'{what}: {_describe(old)} → {_describe(new)}'
    if is_transport_locked(shipment):
        trip.conflict_note = message
        trip.save(update_fields=['conflict_note'])
        _record(shipment, user, f'Not applied (shipment locked). {message}', NOTIFY_ROLES)
        return 'conflict'
    rolled_back = shipment.status.code != 'draft'
    with transaction.atomic():
        if rolled_back:
            rollback_to_draft(shipment, user, message)
        if cancelled:
            _release(trip, shipment, user)
            reopen_rule_task(shipment, 'tasks.choose_truck')
        else:
            write_transport_fields(shipment, new, user)
    _record(shipment, user, message, NOTIFY_ROLES_ON_ROLLBACK if rolled_back else NOTIFY_ROLES)
    if cancelled:
        return 'unlinked_rollback' if rolled_back else 'unlinked'
    return 'applied_rollback' if rolled_back else 'applied'


def accept_trip_change(trip: ExternalTrip, user) -> None:
    """Export manager overrides a conflict: take Planning's values, no status change."""
    shipment = trip.shipment
    if shipment is None or not trip.conflict_note:
        return
    with transaction.atomic():
        if trip.status == 'CANCELLED':
            _release(trip, shipment, user)
        else:
            write_transport_fields(shipment, trip_values(trip), user)
            trip.conflict_note = None
            trip.save(update_fields=['conflict_note'])
    _record(shipment, user, f'Accepted despite lock: {_describe(trip_values(trip))}', NOTIFY_ROLES)


def unassign_trip(trip: ExternalTrip, user) -> None:
    shipment = trip.shipment
    if shipment is None:
        return
    if is_transport_locked(shipment):
        raise AssignmentError('locked')
    with transaction.atomic():
        if shipment.status.code != 'draft':
            rollback_to_draft(shipment, user, f'Truck unassigned by {user.username}')
        _release(trip, shipment, user)
        reopen_rule_task(shipment, 'tasks.choose_truck')


def move_trip(trip: ExternalTrip, to_shipment: Shipment, user) -> None:
    with transaction.atomic():
        unassign_trip(trip, user)
        trip.refresh_from_db()
        assign_trip(trip, to_shipment, user)
```

Note `_release` writes `trip_id=None` via `EMPTY_VALUES`, so the choose_truck resolver sees it empty. `move_trip` nests `transaction.atomic()` — fine (savepoints). If `assign_trip` raises inside, the whole move rolls back.

Wire the poller — in `tasks.py` `poll_external_trips`:

```python
    from apps.transport.services.sync_user import get_sync_user
    from apps.transport.services.trip_assignment import apply_trip_change

    user = get_sync_user()
    for trip in changed:
        try:
            apply_trip_change(trip, user)
        except Exception:  # one bad shipment must not stop the rest
            logger.exception('apply_trip_change failed for trip %s', trip.integration_trip_id)
```

Spec §5 "our shipment cancelled → trip freed": export cannot call transport, so the poll tick releases them. Add to `trip_assignment.py`:

```python
def release_cancelled_shipments() -> int:
    """Free trips whose shipment we cancelled; Planning is not told (no such operation)."""
    return ExternalTrip.objects.filter(shipment__status__code='cancelled').update(
        shipment=None, conflict_note=None, last_pushed_export_code=None,
    )
```

(`last_pushed_export_code` exists from Task 1.) Call it in `poll_external_trips` before the change loop. Test (add to `ApplyTripChangeTests`):

```python
    def test_cancelled_shipment_frees_its_trip(self):
        from apps.transport.services.trip_assignment import release_cancelled_shipments
        self._set_status('cancelled')
        self.assertEqual(release_cancelled_shipments(), 1)
        self.trip.refresh_from_db()
        self.assertIsNone(self.trip.shipment_id)
```

Views — add to `ExternalTripViewSet`:

```python
    @action(detail=True, methods=['post'], url_path='accept-change')
    def accept_change(self, request, pk=None):
        trip = self.get_object()
        accept_trip_change(trip, request.user)
        return Response(ExternalTripSerializer(ExternalTrip.objects.get(pk=trip.pk)).data)

    @action(detail=True, methods=['post'])
    def move(self, request, pk=None):
        trip = self.get_object()
        target = Shipment.objects.select_related('status', 'country').get(pk=request.data['shipment_id'])
        try:
            move_trip(trip, target, request.user)
        except AssignmentError as exc:
            return Response({'detail': exc.code}, status=status.HTTP_409_CONFLICT)
        return Response(ExternalTripSerializer(ExternalTrip.objects.get(pk=trip.pk)).data)
```

Add `accept_trip_change, move_trip` to the import.

- [ ] **Step 4: `simulate_trip_change` command**

```python
# backend/apps/transport/management/commands/simulate_trip_change.py
"""Demo helper (mock mode): edit the fixture so the next poll sees a change."""
import json

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.transport.services.trips_client import FIXTURE_PATH


class Command(BaseCommand):
    help = 'Change or cancel a trip in the mock fixture; the next poll applies it.'

    def add_arguments(self, parser):
        parser.add_argument('trip_uuid')
        parser.add_argument('--driver')
        parser.add_argument('--tractor')
        parser.add_argument('--trailer')
        parser.add_argument('--cancel', action='store_true')

    def handle(self, *args, **opts):
        data = json.loads(FIXTURE_PATH.read_text(encoding='utf-8'))
        item = next((i for i in data['items'] if i['integrationTripId'] == opts['trip_uuid']), None)
        if item is None:
            raise CommandError(f"No trip {opts['trip_uuid']} in {FIXTURE_PATH}")
        if opts['driver']:
            item['driver']['fullName'] = opts['driver']
        if opts['tractor']:
            item['tractor']['plateNumber'] = opts['tractor']
        if opts['trailer']:
            item['trailer']['plateNumber'] = opts['trailer']
        if opts['cancel']:
            item['status'] = 'CANCELLED'
        item['changedAt'] = timezone.now().isoformat()
        FIXTURE_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding='utf-8')
        self.stdout.write(self.style.SUCCESS(f"Updated {opts['trip_uuid']}; run poll_external_trips"))
```

The command edits a tracked file — after a demo, `git checkout backend/apps/transport/fixtures/external_trips.json`. Mention this in the docs page (Task 12).

- [ ] **Step 5: Run — PASS**: `python manage.py test apps.transport apps.export.tests_rollback`

- [ ] **Step 6: Commit**

```bash
git add backend/apps/transport/services/trip_assignment.py backend/apps/transport/tasks.py backend/apps/transport/views_trips.py backend/apps/transport/management/commands/simulate_trip_change.py backend/apps/transport/tests/test_trip_change.py
git commit -m "feat(p3): Planning truck changes roll shipments back or raise a conflict"
```

---

### Task 9: Frontend — linked trips, conflict banner, shipment detail

**Files:**
- Modify: `frontend/src/hooks/useExternalTrips.ts`, `frontend/src/pages/export/TruckBoard.tsx`, `frontend/src/components/shipment/ShipmentTransportBody.tsx`, i18n files
- Create: `frontend/src/pages/export/truckBoard/LinkedTripsTab.tsx`, `frontend/src/components/shipment/ShipmentTripBanner.tsx`, `frontend/src/components/shipment/ShipmentTripBanner.test.tsx`

**Interfaces:**
- Consumes: `accept-change`, `move`, `unassign` endpoints; `GET external-trips/?linked=1`.
- Produces: `useAcceptTripChange()`, `useMoveTrip()`; `useShipmentTrip(shipmentId)` (reads `?linked=1` list and finds `shipment === id` — no new endpoint).

- [ ] **Step 1: Hooks** — append to `useExternalTrips.ts`:

```ts
export function useAcceptTripChange() {
  return useTripAction<{ tripId: number }>((v) => `${BASE}${v.tripId}/accept-change/`, () => ({}));
}

export function useMoveTrip() {
  return useTripAction<{ tripId: number; shipmentId: number }>(
    (v) => `${BASE}${v.tripId}/move/`,
    (v) => ({ shipment_id: v.shipmentId }),
  );
}

export function useShipmentTrip(shipmentId: number) {
  const query = useExternalTrips({ linked: true });
  return { ...query, data: query.data?.find((trip) => trip.shipment === shipmentId) ?? null };
}
```

- [ ] **Step 2: Failing banner test**

```tsx
// frontend/src/components/shipment/ShipmentTripBanner.test.tsx
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '@/i18n';
import { ShipmentTripBanner } from './ShipmentTripBanner';
import * as trips from '@/hooks/useExternalTrips';

vi.mock('@/hooks/useExternalTrips');
beforeAll(async () => { await i18n.changeLanguage('en'); });

describe('ShipmentTripBanner', () => {
  it('shows the conflict note and trip number', () => {
    vi.mocked(trips.useShipmentTrip).mockReturnValue({ data: {
      id: 3, trip_number: '04AP034/26', status: 'PLANNED', conflict_note: 'Planning changed the truck: A → B',
    } } as any);
    vi.mocked(trips.useAcceptTripChange).mockReturnValue({ mutate: vi.fn(), isPending: false } as any);
    render(<ShipmentTripBanner shipmentId={7} canEdit />);
    expect(screen.getByText(/Planning changed the truck: A → B/)).toBeInTheDocument();
    expect(screen.getByText(/04AP034\/26/)).toBeInTheDocument();
  });

  it('renders nothing without a trip', () => {
    vi.mocked(trips.useShipmentTrip).mockReturnValue({ data: null } as any);
    const { container } = render(<ShipmentTripBanner shipmentId={7} canEdit />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 3: Banner**

```tsx
// frontend/src/components/shipment/ShipmentTripBanner.tsx
import { Alert, Button, Space, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { tripDocumentUrl, useAcceptTripChange, useShipmentTrip } from '@/hooks/useExternalTrips';

export function ShipmentTripBanner({ shipmentId, canEdit }: { shipmentId: number; canEdit: boolean }) {
  const { t } = useTranslation();
  const { data: trip } = useShipmentTrip(shipmentId);
  const accept = useAcceptTripChange();
  if (!trip) return null;
  return (
    <Space direction="vertical" style={{ width: '100%', marginBottom: 8 }}>
      <Space>
        <Tag color="blue">{t('truck_board.trip')}: {trip.trip_number ?? t('truck_board.awaiting_code')}</Tag>
        <Tag>{trip.status}</Tag>
        <Button size="small" onClick={() => window.open(tripDocumentUrl(trip.id), '_blank')}>
          {t('truck_board.documents_pdf')}
        </Button>
      </Space>
      {trip.conflict_note && (
        <Alert type="error" showIcon message={trip.conflict_note} action={canEdit && (
          <Button size="small" danger loading={accept.isPending}
            onClick={() => accept.mutate({ tripId: trip.id }, {
              onSuccess: () => toast.success(t('truck_board.accepted')),
              onError: () => toast.error(t('truck_board.error.generic')),
            })}>
            {t('truck_board.accept_change')}
          </Button>
        )} />
      )}
      {trip.last_push_error && <Alert type="warning" showIcon message={trip.last_push_error} />}
    </Space>
  );
}
```

Render it at the top of `ShipmentTransportBody.tsx` when `!shipment.is_gapy_satys`: `<ShipmentTripBanner shipmentId={shipment.id} canEdit={!readOnly} />` (check the prop/field names on `IShipmentDetail`).

- [ ] **Step 4: LinkedTripsTab on the board** — an antd `Tabs` around the three-column grid: tab "Join" (existing grid) and tab "Linked" rendering `LinkedTripsTab`: a `Table` of `useExternalTrips({ linked: true })` with columns shipment code, plates, driver, status, conflict (red tag), and actions — Unlink (`useUnassignTrip`, `Modal.confirm` "This may return the shipment to Preparation"), Move (`Select` of `useCandidateShipments()` filtered by `country_code === trip.destination_country_code`, then `useMoveTrip`), Accept (only when `conflict_note`). Actions hidden unless `canDo(user,'shipment_assign','edit') && !isReadOnly`. Errors: `toast.error(t('truck_board.error.' + detail))`.

i18n additions (en / ru / tk): `trip` "Trip" / «Рейс» / «Reýs»; `awaiting_code` "awaiting code" / «ожидает кода» / «kod garaşylýar»; `accept_change` "Accept change" / «Принять изменение» / «Üýtgetmäni kabul et»; `accepted` "Change accepted" / «Изменение принято» / «Üýtgetme kabul edildi»; `tab_join` "Join" / «Связать» / «Birikdir»; `tab_linked` "Linked" / «Привязанные» / «Birikdirilenler»; `unlink` "Unlink" / «Отвязать» / «Aýyr»; `move` "Move" / «Перенести» / «Göçür»; `unlink_confirm` "The shipment may return to Preparation. Continue?" / «Отгрузка может вернуться в подготовку. Продолжить?» / «Ugratma taýýarlyga gaýdyp biler. Dowam etmelimi?».

- [ ] **Step 5: Run** `npx vitest run src/components/shipment/ShipmentTripBanner.test.tsx src/pages/export` and `npx tsc --noEmit --ignoreDeprecations 5.0` → PASS / no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/useExternalTrips.ts frontend/src/pages/export/TruckBoard.tsx frontend/src/pages/export/truckBoard/LinkedTripsTab.tsx frontend/src/components/shipment/ShipmentTripBanner.tsx frontend/src/components/shipment/ShipmentTripBanner.test.tsx frontend/src/components/shipment/ShipmentTransportBody.tsx frontend/src/i18n/en.json frontend/src/i18n/ru.json frontend/src/i18n/tk.json
git commit -m "feat(frontend): linked trips tab and trip conflict banner"
```

---

### Task 10: Push export-code and loading to Planning

**Files:**
- Create: `backend/apps/transport/services/trip_push.py`
- Modify: `backend/apps/transport/tasks.py`, `backend/apps/transport/services/trip_assignment.py` (`assign_trip`), and the shipment update path (see Step 4)
- Test: `backend/apps/transport/tests/test_trip_push.py`

**Interfaces:**
- Produces: `build_event(trip, op: str, now_ms: int) -> tuple[str, str]` (event_id, occurred_at iso); `export_code_body(shipment) -> dict | None`; `loading_body(shipment) -> dict | None`; `enqueue_push(trip, op: str) -> None`; Celery task `push_trip_update(trip_id: int, op: str, body: dict, event_id: str)`.

- [ ] **Step 1: Failing tests**

```python
# backend/apps/transport/tests/test_trip_push.py
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from apps.core.models import Country, GreenhouseBlock, LoadingLocation
from apps.export.models import ShipmentBlockSource
from apps.transport.models import ExternalTrip
from apps.transport.services.trip_push import build_event, export_code_body, loading_body
from apps.transport.tasks import push_trip_update
from apps.transport.tests.test_trip_assignment import make_trip
from apps.transport.tests.test_trip_sync import _make_shipment


class PushBodyTests(TestCase):
    def setUp(self):
        self.shipment = _make_shipment(export_code='04AP034/26',
                                       loading_location=LoadingLocation.objects.create(name='Ahal'))
        for code in ('B3', 'A1'):
            ShipmentBlockSource.objects.create(
                shipment=self.shipment, block=GreenhouseBlock.objects.create(code=code, name=f'Blok {code}'),
                weight_kg=1000)
        self.trip = make_trip()

    def test_event_id_is_idempotency_key_and_changes_per_enqueue(self):
        first, occurred = build_event(self.trip, 'export-code', 1000)
        second, _ = build_event(self.trip, 'export-code', 2000)
        self.assertEqual(first, f'ygt-{self.trip.integration_trip_id}-export-code-1000')
        self.assertNotEqual(first, second)
        self.assertIn('+00:00', occurred)

    def test_export_code_body(self):
        body = export_code_body(self.shipment)
        self.assertEqual(body['exportCode'], '04AP034/26')

    def test_no_export_code_means_no_push(self):
        self.shipment.export_code = None
        self.assertIsNone(export_code_body(self.shipment))

    def test_loading_body_joins_blocks_in_source_order(self):
        body = loading_body(self.shipment)
        self.assertEqual(body['city'], 'Ahal')
        self.assertEqual(body['place'], {'ref': 'B3', 'name': 'B3, A1'})


class PushTaskTests(TestCase):
    def setUp(self):
        self.trip = make_trip()

    def _run(self, status_code, payload):
        client = mock.Mock(is_mock=False)
        client.post_op.return_value = (status_code, payload)
        with mock.patch('apps.transport.tasks.get_trips_client', return_value=client):
            push_trip_update.apply(args=(self.trip.pk, 'export-code', {'eventId': 'k'}, 'k'))
        self.trip.refresh_from_db()
        return client

    def test_ok(self):
        self._run(200, {'accepted': True})
        self.assertEqual(self.trip.last_push_status, 'ok')

    def test_trip_closed_gives_up(self):
        self._run(409, {'code': 'TRIP_CLOSED'})
        self.assertEqual(self.trip.last_push_status, 'closed')

    def test_duplicate_code_is_an_error_for_people(self):
        self._run(409, {'code': 'DUPLICATE_EXPORT_CODE'})
        self.assertEqual(self.trip.last_push_status, 'error')
        self.assertIn('DUPLICATE_EXPORT_CODE', self.trip.last_push_error)

    def test_retry_reuses_the_same_key(self):
        client = mock.Mock(is_mock=False)
        from apps.transport.services.trips_client import TripsApiUnavailable
        client.post_op.side_effect = [TripsApiUnavailable('down'), (200, {})]
        with mock.patch('apps.transport.tasks.get_trips_client', return_value=client):
            push_trip_update.apply(args=(self.trip.pk, 'export-code', {'eventId': 'k'}, 'k'))
        keys = [call.args[3] for call in client.post_op.call_args_list]
        self.assertEqual(keys, ['k', 'k'])
```

Retries in eager mode: `CELERY_TASK_ALWAYS_EAGER=True` in tests; `self.retry` in eager mode re-runs synchronously when `task_eager_propagates` is off. If `test_retry_reuses_the_same_key` cannot observe the retry in eager mode, change it to call `push_trip_update.run` twice with the same args and assert both calls used `'k'` — the property under test is that the key is an argument, not recomputed.

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement `trip_push.py` + task**

```python
# backend/apps/transport/services/trip_push.py
"""What we tell Planning (MVP: export-code, loading) — spec §7."""
from datetime import datetime, timezone as dt_tz

from django.db import transaction

from apps.export.models import Shipment
from apps.transport.models import ExternalTrip


def build_event(trip: ExternalTrip, op: str, now_ms: int) -> tuple[str, str]:
    """eventId doubles as Idempotency-Key; a new enqueue gets a new key, a retry reuses it."""
    occurred = datetime.fromtimestamp(now_ms / 1000, tz=dt_tz.utc).isoformat()
    return f'ygt-{trip.integration_trip_id}-{op}-{now_ms}', occurred


def export_code_body(shipment: Shipment) -> dict | None:
    if not shipment.export_code:
        return None
    return {'exportCode': shipment.export_code}


def loading_body(shipment: Shipment) -> dict | None:
    sources = list(shipment.block_sources.select_related('block').order_by('id'))
    if not sources or not shipment.loading_location_id:
        return None
    codes = [s.block.code for s in sources]
    return {'city': shipment.loading_location.name, 'place': {'ref': codes[0], 'name': ', '.join(codes)}}


BODY_BUILDERS = {'export-code': export_code_body, 'loading': loading_body}


def enqueue_push(trip: ExternalTrip, op: str) -> None:
    """Build the body now (frozen occurredAt/eventId) and send after commit."""
    from apps.transport.tasks import push_trip_update

    body = BODY_BUILDERS[op](trip.shipment)
    if body is None:
        return
    now_ms = int(datetime.now(tz=dt_tz.utc).timestamp() * 1000)
    event_id, occurred_at = build_event(trip, op, now_ms)
    body = {'eventId': event_id, 'occurredAt': occurred_at, 'source': 'EXTERNAL', **body}
    transaction.on_commit(lambda: push_trip_update.delay(trip.pk, op, body, event_id))
```

Check the contract body field names before implementing: open `planning-integration-api.v1.yaml`, schemas `ExportCodeUpdate` and `LoadingUpdate` (grep `ExportCodeUpdate:` / `LoadingUpdate:`). If the export-code field is not `exportCode`, use the contract name and fix the test. `source: EXTERNAL` is required by `EventEnvelope`.

Append to `tasks.py`:

```python
from apps.transport.models import ExternalTrip
from apps.transport.services.trips_client import get_trips_client

GIVE_UP_CODES = {'TRIP_CLOSED': 'closed'}


@shared_task(bind=True, max_retries=6, time_limit=60)
def push_trip_update(self, trip_id: int, op: str, body: dict, event_id: str):
    trip = ExternalTrip.objects.get(pk=trip_id)
    try:
        status_code, payload = get_trips_client().post_op(str(trip.integration_trip_id), op, body, event_id)
    except TripsApiUnavailable as exc:
        raise self.retry(exc=exc, countdown=min(30 * 2 ** self.request.retries, 1800))
    if status_code < 300:
        trip.last_push_status, trip.last_push_error = 'ok', None
    else:
        code = payload.get('code', str(status_code))
        trip.last_push_status = GIVE_UP_CODES.get(code, 'error')
        trip.last_push_error = None if code == 'TRIP_CLOSED' else f'{op}: {code} {payload.get("detail", "")}'.strip()
        if code == 'UNAUTHORIZED':
            logger.error('Planning rejected our key on %s', op)
    trip.save(update_fields=['last_push_status', 'last_push_error'])
```

- [ ] **Step 4: Enqueue points**

1. `assign_trip` — after the atomic block: `enqueue_push(trip_refreshed, 'export-code'); enqueue_push(trip_refreshed, 'loading')` where `trip_refreshed = ExternalTrip.objects.select_related('shipment__loading_location').get(pk=trip.pk)`.
2. When a linked shipment's export code changes later: `export` must not import `transport`, so the Sheet PATCH path cannot enqueue. Instead the poller tick detects it — in `poll_external_trips`, after applying changes, call `push_pending_corrections()`:

```python
# trip_push.py
def push_pending_corrections() -> int:
    """Linked trips whose export code changed since our last push get one new push.

    Runs every poll tick, so an export-code edit on the Sheet reaches Planning
    within ~2 minutes without export importing transport. Compares against
    last_pushed_export_code (set by enqueue_push), NOT trip_number: mock never
    echoes, and live echoes late — comparing to trip_number would re-push forever.
    A DUPLICATE_EXPORT_CODE error recovers by itself once the manager fixes the code.
    """
    pushed = 0
    trips = ExternalTrip.objects.filter(shipment__isnull=False).exclude(
        status__in=ExternalTrip.CLOSED_STATUSES).select_related('shipment')
    for trip in trips:
        code = trip.shipment.export_code
        if code and code != trip.last_pushed_export_code:
            enqueue_push(trip, 'export-code')
            pushed += 1
    return pushed
```

And in `enqueue_push`, for `op == 'export-code'`, record the value before scheduling:

```python
    if op == 'export-code':
        trip.last_pushed_export_code = trip.shipment.export_code
        trip.save(update_fields=['last_pushed_export_code'])
```

Loading corrections after assignment are out of MVP scope (say so in docs); loading is pushed once at assign time. `_release` (Task 4) must also reset `last_pushed_export_code = None` so a re-assign pushes again — add it to the `update_fields` there. Tests (add to `PushBodyTests`):

```python
    def test_pending_correction_pushes_once_per_code(self):
        from apps.transport.services.trip_push import push_pending_corrections
        ExternalTrip.objects.filter(pk=self.trip.pk).update(shipment=self.shipment)
        with mock.patch('apps.transport.tasks.push_trip_update.delay') as delay, \
                self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(push_pending_corrections(), 1)
            self.assertEqual(push_pending_corrections(), 0)
        self.assertEqual(delay.call_count, 1)

    def test_corrected_code_is_pushed_again(self):
        from apps.transport.services.trip_push import push_pending_corrections
        ExternalTrip.objects.filter(pk=self.trip.pk).update(
            shipment=self.shipment, last_pushed_export_code='OLD')
        with mock.patch('apps.transport.services.trip_push.enqueue_push') as enqueue:
            self.assertEqual(push_pending_corrections(), 1)
        enqueue.assert_called_once()
```

Wire it into `poll_external_trips` after the change loop: `push_pending_corrections()` inside its own `try/except Exception: logger.exception(...)`.

- [ ] **Step 5: Run — PASS**: `python manage.py test apps.transport`

- [ ] **Step 6: Commit**

```bash
git add backend/apps/transport/services/trip_push.py backend/apps/transport/tasks.py backend/apps/transport/services/trip_assignment.py backend/apps/transport/tests/test_trip_push.py
git commit -m "feat(p3): send export code and loading place to Planning"
```

---

### Task 11: Transport fields read-only when a trip is linked

**Files:**
- Modify: `backend/apps/export/views.py` (shipment PATCH ~line 746 and the Sheet cell write endpoint), `frontend/src/utils/sheetPermissions.ts`, `frontend/src/components/sheet/SheetGrid.tsx` (~line 788), the sheet shipment serializer that feeds SheetGrid
- Create: `backend/apps/export/services/trip_lock.py`
- Test: `backend/apps/export/tests_trip_lock.py`, `frontend/src/utils/sheetPermissions.test.ts` (append or create)

**Interfaces:**
- Produces: `TRIP_LOCKED_FIELDS = ('truck_plate','driver_name','driver_phone','driver_passport_serial','driver_passport_issue_date','truck_head_id','trailer_id','trip_id')`; `trip_locked_fields(shipment, changed: Iterable[str]) -> list[str]`; FE `isTripLockedCell(shipment: { trip_id?: number | null; is_gapy_satys?: boolean }, fieldKey: string): boolean`.

- [ ] **Step 1: Find the write paths.** Run `grep -n "def partial_update\|def update_cell\|def cell\b\|snapshot_fields(" backend/apps/export/views*.py`. Every place that writes Shipment fields from a user request must call the guard. Record the list in the task report.

- [ ] **Step 2: Failing backend test**

```python
# backend/apps/export/tests_trip_lock.py
from django.test import TestCase

from apps.export.services.trip_lock import trip_locked_fields


class TripLockTests(TestCase):
    def _ship(self, **kw):
        from types import SimpleNamespace
        return SimpleNamespace(trip_id=kw.get('trip_id'), is_gapy_satys=kw.get('gapy', False))

    def test_linked_regular_shipment_locks_transport_fields(self):
        self.assertEqual(trip_locked_fields(self._ship(trip_id=5), ['driver_name', 'border_point']), ['driver_name'])

    def test_no_trip_or_gapy_locks_nothing(self):
        self.assertEqual(trip_locked_fields(self._ship(), ['driver_name']), [])
        self.assertEqual(trip_locked_fields(self._ship(trip_id=5, gapy=True), ['driver_name']), [])
```

Plus one API test per write path found in Step 1: PATCH `driver_name` on a shipment with `trip_id` set → 400 with `{'detail': 'trip_locked', 'fields': ['driver_name']}`; same PATCH without `trip_id` → 200. Build the request exactly like the nearest existing test for that endpoint (find it with `grep -rn "<endpoint path>" backend/apps/export/tests*.py`).

- [ ] **Step 3: Implement**

```python
# backend/apps/export/services/trip_lock.py
"""Shipments carrying a Planning trip take their transport fields from it (spec D10).

Lives in export (no transport import): it only reads Shipment.trip_id.
"""
from collections.abc import Iterable

TRIP_LOCKED_FIELDS = (
    'truck_plate', 'driver_name', 'driver_phone', 'driver_passport_serial',
    'driver_passport_issue_date', 'truck_head_id', 'trailer_id', 'trip_id',
)


def trip_locked_fields(shipment, changed: Iterable[str]) -> list[str]:
    if not shipment.trip_id or shipment.is_gapy_satys:
        return []
    return [field for field in changed if field in TRIP_LOCKED_FIELDS]
```

In each write path from Step 1, before saving:

```python
locked = trip_locked_fields(shipment, request.data.keys())
if locked:
    return Response({'detail': 'trip_locked', 'fields': locked}, status=status.HTTP_400_BAD_REQUEST)
```

(Use the API field names if the serializer renames any of these — check `api-contract` skill.) The transport services write through `write_transport_fields`, not these views, so they are unaffected.

- [ ] **Step 4: Frontend**

Expose `trip_id` on the shipment objects SheetGrid receives: find the sheet serializer (`grep -n "is_gapy_satys" backend/apps/export/serializers*.py backend/apps/export/sheet*.py`) and add `trip_id` next to `is_gapy_satys`; add `trip_id?: number | null` to the matching TS interface.

```ts
// frontend/src/utils/sheetPermissions.ts
export const TRIP_LOCKED_FIELDS = new Set([
  'truck_plate', 'driver_name', 'driver_phone', 'driver_passport_serial', 'driver_passport_issue_date',
]);

export function isTripLockedCell(
  shipment: { trip_id?: number | null; is_gapy_satys?: boolean },
  fieldKey: string,
): boolean {
  return !!shipment.trip_id && !shipment.is_gapy_satys && TRIP_LOCKED_FIELDS.has(fieldKey);
}
```

Test:

```ts
import { describe, expect, it } from 'vitest';
import { isTripLockedCell } from './sheetPermissions';

describe('isTripLockedCell', () => {
  it('locks transport cells of a regular shipment with a trip', () => {
    expect(isTripLockedCell({ trip_id: 3, is_gapy_satys: false }, 'driver_name')).toBe(true);
    expect(isTripLockedCell({ trip_id: 3, is_gapy_satys: false }, 'border_point')).toBe(false);
  });
  it('never locks gapy or trip-less shipments', () => {
    expect(isTripLockedCell({ trip_id: 3, is_gapy_satys: true }, 'driver_name')).toBe(false);
    expect(isTripLockedCell({ trip_id: null }, 'driver_name')).toBe(false);
  });
});
```

In `SheetGrid.tsx` at the `isEditable` computation (~line 788), AND it: `isEditable={isCellEditable(...) && !isTripLockedCell(shipment, rowConfig.field_key)}` — use the variable names present at that line; apply the same at lines ~637 and ~653 where `isCellEditable` is also called (clipboard paste / keyboard paths).

- [ ] **Step 5: Run**

Backend: `python manage.py test apps.export.tests_trip_lock` and the Sheet permission regression required by memory: `python manage.py test apps.export.tests_sheet_authority --verbosity=1` (contains `TestEveryRoleCanEditItsOwnSheetRow`; if it lives elsewhere, `grep -rn "class TestEveryRoleCanEditItsOwnSheetRow" backend/apps`). Frontend: `npx vitest run src/utils src/components/sheet` and `npx tsc --noEmit --ignoreDeprecations 5.0`.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/export/services/trip_lock.py backend/apps/export/tests_trip_lock.py backend/apps/export/views.py frontend/src/utils/sheetPermissions.ts frontend/src/utils/sheetPermissions.test.ts frontend/src/components/sheet/SheetGrid.tsx
git commit -m "feat(p3): transport cells are read-only when a Planning trip is linked"
```
(plus the serializer / TS interface files you touched in Step 4 — list them explicitly.)

---

### Task 12: Docs, changelog, test log, full verification

**Files:**
- Create: `docs/obsidian/<module folder>/Truck Board.md`, `docs/obsidian/<module folder>/ExternalTrip Poller.md` (find the right folders in `docs/obsidian/00-index.md`)
- Modify: `docs/obsidian/00-index.md`, `CHANGELOG.md` ([Unreleased] → Added/Changed), `BUILD_TEST_LOG.md`

- [ ] **Step 1: Obsidian pages** — cover: purpose; the poll (120 s, overlap, cursor, `TRANSPORT_API_*` env, mock mode + `simulate_trip_change` + resetting the fixture with `git checkout`); the §6 table; rollback re-gate; endpoints; permissions (`export.truck_board` page, `shipment_assign` edit); the choose_truck task; known gaps (loading corrections not re-pushed; passport issue date = expiry; Planning's passports mostly empty). Link from `00-index.md`.

Include a **Deploy** section on the poller page, in this order: set `TRANSPORT_API_URL/KEY/MODE/VERIFY_TLS` in the server `.env` → `migrate core transport` → `seed_permissions` → `seed_task_rules` (only now — never during development, Task 5) → rebuild celery worker + beat containers (memory: celery beat, not crontab).

- [ ] **Step 2: CHANGELOG** under `[Unreleased]`:
  - Added: Truck Board — join Planning trips to regular shipments (country match, details drawer, live location, trip PDF).
  - Added: Planning trips poller (2 min) with mock mode.
  - Added: Planning truck changes roll the shipment back to Preparation or raise a conflict.
  - Added: export code + loading place sent to Planning.
  - Changed: regular shipments get `tasks.choose_truck` instead of `tasks.assign_driver`.
  - Changed: transport cells read-only on shipments with a Planning trip.

- [ ] **Step 3: BUILD_TEST_LOG.md** (newest on top): `- [ ] 2026-09-29 — Truck Board + Planning trips integration (poll, assign, change/rollback, pushes, read-only cells) — NEEDS TEST`

- [ ] **Step 4: Full verification**

```
cd backend
python manage.py makemigrations --check
python manage.py test apps.transport apps.export.tests_rollback apps.export.tests_choose_truck_rule apps.export.tests_trip_lock apps.export.tests --verbosity=1
cd ../frontend
npx vitest run
npx tsc --noEmit --ignoreDeprecations 5.0
```
The whole backend suite has known pre-existing failures (memory: 4 buckets); compare any failure outside the files above against `origin/main` before calling it new.

- [ ] **Step 5: Commit**

```bash
git add docs/obsidian CHANGELOG.md BUILD_TEST_LOG.md
git commit -m "docs: Truck Board and Planning trips integration"
```
