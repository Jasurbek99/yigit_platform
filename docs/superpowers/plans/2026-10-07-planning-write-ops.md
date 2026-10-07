# Planning Write Ops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push destination city, product, loading-place events, destination customs and trip rejections to the transport department's Planning API, next to the existing export-code / loading pushes.

**Architecture:** `trip_push.PUSH_OPS` becomes a table of `PushOp` rows (body builder, signature, marker column, URL path, optional occurredAt source). Every op rides the existing machinery: pushed on assign, re-pushed by `push_pending_corrections` when its signature changes, sent by the `push_trip_update` Celery task. Rejection is a one-shot push behind a new `reject` action on the Truck Board API, plus three columns on `ExternalTrip` and a modal on the board.

**Tech Stack:** Django 5 + DRF + Celery (MSSQL), React 18 + Ant Design 5 + TanStack Query + vitest.

**Spec:** `docs/superpowers/specs/2026-10-07-planning-write-ops-design.md`

## Global Constraints

- Work only in the worktree `D:\projects\yigit_platform-planning-ops`, branch `feat/planning-write-ops`. Never touch `D:\projects\yigit_platform` (shared `main` tree used by other sessions).
- Commit only after the user has said "commit" for this plan (the user authorizes per-task commits at execution start). Stage explicit paths, never `git add -A`; run `git status` + `git diff --cached` before every commit. Co-author line: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- MSSQL rules: no JSONField; every new CharField has `max_length`; Cyrillic text fields use `**cyrillic_collation()`; new columns are nullable (beta runs old code on the same DB — no NOT NULL without DB default).
- Migration is `backend/apps/transport/migrations/0011_*`. Do **not** run `migrate` against the shared dev DB from this branch; tests build their own DB. Before merging to main, re-check the number is still free (`ls backend/apps/transport/migrations/ | tail -3` on main).
- Backend commands run from `D:\projects\yigit_platform-planning-ops\backend` with the main tree's venv and a private test DB:
  `TEST_DB_NAME=test_ygt_planning_ops /d/projects/yigit_platform/backend/venv/Scripts/python.exe manage.py test <label> --noinput -v 1`
- Frontend type check: `npx tsc --noEmit --ignoreDeprecations 5.0` (`npm run type-check` is broken). Tests: `npx vitest run <path>`.
- Contract field names are fixed by Planning: `city`, `cargoName`, `cargoRef`, `type`, `place {ref, name}`, `cleared`, `reason`; envelope `eventId`, `occurredAt`, `source: "EXTERNAL"`; event types `ARRIVED_AT_PLACE`, `LOADED`, `DEPARTED_FROM_PLACE`.
- Rejection reason: required, trimmed, max 512 characters.
- UI text must not use the word "draft"/«черновик» (shipments are «Подготовка»).

## Review Focus

1. **Event times re-pushed on every tick because of timezone formatting** — the signature is `isoformat()` of the stored value; if the DB round-trip changes the offset form, the marker never matches. Expected: one push per real edit. Pinned by `test_unchanged_event_time_is_not_pushed_again` (Task 2), which reads the shipment back from the DB before comparing.
2. **Unassigning a trip leaves old markers behind** — a re-assigned trip would then skip pushes it needs. Expected: release clears every `last_pushed_*` column. Pinned by `test_release_clears_every_marker` (Task 1).
3. **Rejection push fails with the broker down** — no marker to resend from. Expected: the trip shows a visible push error instead of silently losing it. Pinned by `test_rejection_broker_failure_is_visible` (Task 3).
4. **Exhausted retries on a rejection crash with `KeyError`** (`rejection` is not in `PUSH_OPS`). Expected: error recorded, no exception. Pinned by `test_rejection_exhausted_retries_record_error` (Task 3).
5. **Status-only poll bump wipes a rejection** — Planning bumps `changedAt` on its own status moves. Expected: rejection stays until a truck/trailer/driver swap or cancel. Pinned by `test_status_only_bump_keeps_rejection` (Task 3).

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `backend/apps/transport/models/external_trip.py` | Modify | 6 marker columns, 3 rejection columns, `REJECTION_FIELDS` |
| `backend/apps/transport/migrations/0011_trip_write_ops.py` | Create (makemigrations) | Schema for the 9 columns |
| `backend/apps/transport/services/trip_push.py` | Modify | `PushOp` table, new body builders, `enqueue_rejection` |
| `backend/apps/transport/services/trip_assignment.py` | Modify | Push every op on assign, clear every marker on release, refuse rejected trips |
| `backend/apps/transport/services/trip_rejection.py` | Create | `reject_trip` service |
| `backend/apps/transport/services/trip_sync.py` | Modify | Clear rejection on a real Planning change |
| `backend/apps/transport/tasks.py` | Modify | POST to the op's path; tolerate ops without a marker |
| `backend/apps/transport/views_trips.py` | Modify | `reject` action, `select_related('rejected_by')` |
| `backend/apps/transport/serializers_trips.py` | Modify | Expose rejection fields |
| `backend/apps/transport/tests/test_trip_push.py` | Modify | Tests for Tasks 1–2 |
| `backend/apps/transport/tests/test_trip_rejection.py` | Create | Tests for Task 3 |
| `backend/apps/transport/tests/test_trip_sync.py` | Modify | Rejection clearing tests |
| `frontend/src/types/externalTrip.ts` | Modify | Rejection fields on `IExternalTrip` |
| `frontend/src/mock/externalTrips.ts` | Modify | Mock base gets rejection fields |
| `frontend/src/hooks/useExternalTrips.ts` | Modify | `useRejectTrip` |
| `frontend/src/pages/export/truckBoard/RejectTripModal.tsx` | Create | Reason modal |
| `frontend/src/pages/export/truckBoard/TripCard.tsx` | Modify | «Отклонён» tag |
| `frontend/src/pages/export/truckBoard/TripDrawer.tsx` | Modify | Reject button + rejection row |
| `frontend/src/pages/export/truckBoard/TruckMatchPanel.tsx` | Modify | Assign disabled for a rejected trip |
| `frontend/src/pages/export/TruckBoard.tsx` | Modify | Wire modal |
| `frontend/src/i18n/{ru,en,tk}.json` | Modify | New keys, corrected `CITY_COUNTRY_MISMATCH` |
| `docs/obsidian/processes/truck-board.md`, `CHANGELOG.md`, `BUILD_TEST_LOG.md` | Modify | Docs |

---

### Task 1: PushOp table, schema, destination-city and cargo

**Files:**
- Modify: `backend/apps/transport/models/external_trip.py:58-65`
- Create: `backend/apps/transport/migrations/0011_trip_write_ops.py` (generated)
- Modify: `backend/apps/transport/services/trip_push.py` (whole file)
- Modify: `backend/apps/transport/services/trip_assignment.py:14-23,96-105`
- Test: `backend/apps/transport/tests/test_trip_push.py`

**Interfaces:**
- Produces: `PushOp(build_body, signature, marker, path, occurred_at=None)` NamedTuple; `PUSH_OPS: dict[str, PushOp]` with keys `export-code`, `loading`, `destination-city`, `cargo`; `destination_city_body(shipment) -> dict | None`; `cargo_body(shipment) -> dict | None`; `_place(shipment) -> dict | None`; `_queue_after_commit(trip_id: int, op: str, body: dict, event_id: str, marker: str | None = None) -> None`; `ExternalTrip.REJECTION_FIELDS = ('rejection_reason', 'rejected_at', 'rejected_by')` and the columns `last_pushed_destination_city`, `last_pushed_cargo`, `last_pushed_arrived`, `last_pushed_loaded`, `last_pushed_departed`, `last_pushed_customs`, `rejection_reason`, `rejected_at`, `rejected_by`.

- [ ] **Step 0: Prepare the worktree (once)**

```bash
cp /d/projects/yigit_platform/backend/.env /d/projects/yigit_platform-planning-ops/backend/.env
cmd //c mklink /J "D:\projects\yigit_platform-planning-ops\frontend\node_modules" "D:\projects\yigit_platform\frontend\node_modules"
cd /d/projects/yigit_platform-planning-ops/backend
TEST_DB_NAME=test_ygt_planning_ops /d/projects/yigit_platform/backend/venv/Scripts/python.exe manage.py test apps.transport --noinput -v 1
```
Expected: the transport suite passes (baseline). Write down the count. `.env` and `node_modules` are git-ignored — never stage them.

- [ ] **Step 1: Write the failing tests** — append to `backend/apps/transport/tests/test_trip_push.py`:

```python
class DestinationAndCargoTests(TestCase):
    def setUp(self):
        from apps.core.models import City, ProductType
        kz = Country.objects.create(code='KZ', name_tk='GAZAGYSTAN')
        self.pepper = ProductType.objects.get(code='pepper')  # seeded by core/0074
        self.shipment = _make_shipment(city=City.objects.create(country=kz, name='Almaty'),
                                       product_type=self.pepper)
        self.trip = make_trip()

    def test_destination_city_body(self):
        from apps.transport.services.trip_push import destination_city_body
        self.assertEqual(destination_city_body(self.shipment), {'city': 'Almaty'})

    def test_no_city_means_no_push(self):
        from apps.transport.services.trip_push import destination_city_body
        self.shipment.city = None
        self.assertIsNone(destination_city_body(self.shipment))

    def test_cargo_body_uses_russian_name_and_code(self):
        from apps.transport.services.trip_push import cargo_body
        self.assertEqual(cargo_body(self.shipment), {'cargoName': 'Перец сладкий свежий', 'cargoRef': 'pepper'})

    def test_cargo_body_falls_back_to_name_and_omits_missing_code(self):
        from apps.transport.services.trip_push import cargo_body
        self.pepper.name_ru, self.pepper.code = None, None
        self.assertEqual(cargo_body(self.shipment), {'cargoName': self.pepper.name})

    def test_no_product_means_no_push(self):
        from apps.transport.services.trip_push import cargo_body
        self.shipment.product_type = None
        self.assertIsNone(cargo_body(self.shipment))

    def test_pending_corrections_cover_city_and_cargo(self):
        from apps.transport.services.trip_push import push_pending_corrections
        ExternalTrip.objects.filter(pk=self.trip.pk).update(shipment=self.shipment)
        with mock.patch('apps.transport.services.trip_push.enqueue_push') as enqueue:
            push_pending_corrections()
        self.assertEqual(sorted(c.args[1] for c in enqueue.call_args_list), ['cargo', 'destination-city'])

    def test_unchanged_city_and_cargo_are_not_pushed_again(self):
        from apps.transport.services.trip_push import push_pending_corrections
        ExternalTrip.objects.filter(pk=self.trip.pk).update(
            shipment=self.shipment, last_pushed_destination_city='Almaty',
            last_pushed_cargo='Перец сладкий свежий|pepper')
        with mock.patch('apps.transport.services.trip_push.enqueue_push') as enqueue:
            push_pending_corrections()
        enqueue.assert_not_called()

    def test_enqueue_sends_envelope_and_city(self):
        from apps.transport.services.trip_push import enqueue_push
        ExternalTrip.objects.filter(pk=self.trip.pk).update(shipment=self.shipment)
        linked = ExternalTrip.objects.select_related('shipment__city').get(pk=self.trip.pk)
        with mock.patch('apps.transport.tasks.push_trip_update.delay') as delay, \
                self.captureOnCommitCallbacks(execute=True):
            enqueue_push(linked, 'destination-city')
        trip_id, op, body, event_id = delay.call_args.args
        self.assertEqual((trip_id, op), (self.trip.pk, 'destination-city'))
        self.assertEqual((body['city'], body['source'], body['eventId']), ('Almaty', 'EXTERNAL', event_id))
        linked.refresh_from_db()
        self.assertEqual(linked.last_pushed_destination_city, 'Almaty')

    def test_release_clears_every_marker(self):
        from apps.transport.services.trip_assignment import RELEASED_TRIP_COLUMNS
        from apps.transport.services.trip_push import PUSH_OPS
        self.assertTrue({push.marker for push in PUSH_OPS.values()} <= set(RELEASED_TRIP_COLUMNS))
```

Also change the existing `AssignEnqueuesPushesTests.test_assign_enqueues_export_code_and_loading` (same file) to:

```python
class AssignEnqueuesPushesTests(TestCase):
    def test_assign_enqueues_every_op(self):
        from django.contrib.auth import get_user_model

        from apps.transport.services.trip_assignment import assign_trip
        from apps.transport.services.trip_push import PUSH_OPS
        kz = Country.objects.create(code='KZ', name_tk='GAZAGYSTAN')
        shipment = _make_shipment(country=kz, export_code='04AP034/26')
        user = get_user_model().objects.create_user(username='em', password='x', role='export_manager')
        with mock.patch('apps.transport.services.trip_assignment.enqueue_push') as enqueue:
            assign_trip(make_trip(), shipment, user)
        self.assertEqual([c.args[1] for c in enqueue.call_args_list], list(PUSH_OPS))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `TEST_DB_NAME=test_ygt_planning_ops /d/projects/yigit_platform/backend/venv/Scripts/python.exe manage.py test apps.transport.tests.test_trip_push --noinput -v 1`
Expected: FAIL / ERROR — `ImportError: cannot import name 'destination_city_body'`, `AttributeError: 'tuple' object has no attribute 'marker'`.

- [ ] **Step 3: Add the model columns** — in `backend/apps/transport/models/external_trip.py` replace the block from `# What we last enqueued for export-code` through `last_pushed_loading = ...` with:

```python
    # What we last enqueued per push op — compared on every poll tick so a
    # correction is pushed once, not every 2 minutes until Planning echoes it.
    last_pushed_export_code = models.CharField(max_length=30, null=True, blank=True)
    # "city|place" last enqueued for `loading` — same once-per-change rule.
    last_pushed_loading = models.CharField(max_length=500, null=True, blank=True, **cyrillic_collation())
    last_pushed_destination_city = models.CharField(max_length=256, null=True, blank=True, **cyrillic_collation())
    # "cargoName|cargoRef"
    last_pushed_cargo = models.CharField(max_length=400, null=True, blank=True, **cyrillic_collation())
    # ISO timestamps of the operator-entered times last pushed as events / customs.
    last_pushed_arrived = models.CharField(max_length=40, null=True, blank=True)
    last_pushed_loaded = models.CharField(max_length=40, null=True, blank=True)
    last_pushed_departed = models.CharField(max_length=40, null=True, blank=True)
    last_pushed_customs = models.CharField(max_length=40, null=True, blank=True)

    # === Our rejection (TripRejection) — cleared when Planning swaps resources ===
    rejection_reason = models.CharField(max_length=512, null=True, blank=True, **cyrillic_collation())
    rejected_at = models.DateTimeField(null=True, blank=True)
    rejected_by = models.ForeignKey(
        'core.User', null=True, blank=True, on_delete=models.SET_NULL, related_name='+',
    )
```

and next to `CLOSED_STATUSES` (line 14) add:

```python
    REJECTION_FIELDS = ('rejection_reason', 'rejected_at', 'rejected_by')
```

- [ ] **Step 4: Generate the migration (do not apply it to the shared DB)**

```bash
cd /d/projects/yigit_platform-planning-ops/backend
ls apps/transport/migrations/ | tail -3        # last must be 0010_...
/d/projects/yigit_platform/backend/venv/Scripts/python.exe manage.py makemigrations transport --name trip_write_ops
```
Expected: `apps/transport/migrations/0011_trip_write_ops.py` with 9 `AddField` operations. Open it and confirm every field is `null=True`.

- [ ] **Step 5: Rewrite `trip_push.py`** — replace the whole file with:

```python
"""What we tell Planning — spec §7 and docs/superpowers/specs/2026-10-07-planning-write-ops-design.md.

Contract: planning-integration-api.v1.yaml. Every body extends EventEnvelope
(eventId, occurredAt, source=EXTERNAL).
"""
import logging
from collections.abc import Callable
from datetime import datetime, timezone as dt_tz
from typing import NamedTuple

from django.db import transaction

from apps.export.models import Shipment
from apps.transport.models import ExternalTrip

logger = logging.getLogger(__name__)


def build_event(trip: ExternalTrip, op: str, now_ms: int) -> tuple[str, str]:
    """eventId doubles as Idempotency-Key; a new enqueue gets a new key, a retry reuses it."""
    occurred = datetime.fromtimestamp(now_ms / 1000, tz=dt_tz.utc).isoformat()
    return f'ygt-{trip.integration_trip_id}-{op}-{now_ms}', occurred


def _place(shipment: Shipment) -> dict | None:
    """The blocks as one loading place: names joined, first code as ref."""
    # .all() + sort in Python so a prefetch (push_pending_corrections) is reused.
    sources = sorted(shipment.block_sources.all(), key=lambda source: source.id)
    if not sources:
        return None
    names = [s.block.name or s.block.code for s in sources]
    return {'ref': sources[0].block.code, 'name': ', '.join(names)}


def export_code_body(shipment: Shipment) -> dict | None:
    """ExportCodeUpdate body, or None while the shipment has no export code."""
    if not shipment.export_code:
        return None
    return {'exportCode': shipment.export_code}


def loading_body(shipment: Shipment) -> dict | None:
    """LoadingUpdate body: city = our loading location; place = the blocks."""
    place = _place(shipment)
    if place is None or not shipment.loading_location_id:
        return None
    return {'city': shipment.loading_location.name, 'place': place}


def destination_city_body(shipment: Shipment) -> dict | None:
    """DestinationCityUpdate body; Planning checks the city is in the trip's country."""
    if not shipment.city_id:
        return None
    return {'city': shipment.city.name}


def cargo_body(shipment: Shipment) -> dict | None:
    """CargoUpdate body: the product's Russian name, our code as cargoRef."""
    product = shipment.product_type
    if product is None:
        return None
    body = {'cargoName': product.name_ru or product.name}
    if product.code:
        body['cargoRef'] = product.code
    return body


def export_code_signature(shipment: Shipment) -> str | None:
    return shipment.export_code or None


def loading_signature(shipment: Shipment) -> str | None:
    """What a `loading` push would say, as one comparable string."""
    body = loading_body(shipment)
    return f"{body['city']}|{body['place']['name']}" if body else None


def destination_city_signature(shipment: Shipment) -> str | None:
    body = destination_city_body(shipment)
    return body['city'] if body else None


def cargo_signature(shipment: Shipment) -> str | None:
    body = cargo_body(shipment)
    return f"{body['cargoName']}|{body.get('cargoRef', '')}" if body else None


class PushOp(NamedTuple):
    build_body: Callable[[Shipment], dict | None]
    signature: Callable[[Shipment], str | None]
    marker: str  # ExternalTrip column holding the last enqueued signature
    path: str  # URL segment under /trips/{id}/
    occurred_at: Callable[[Shipment], str | None] | None = None  # None → time of enqueue


PUSH_OPS: dict[str, PushOp] = {
    'export-code': PushOp(export_code_body, export_code_signature, 'last_pushed_export_code', 'export-code'),
    'loading': PushOp(loading_body, loading_signature, 'last_pushed_loading', 'loading'),
    'destination-city': PushOp(
        destination_city_body, destination_city_signature, 'last_pushed_destination_city', 'destination-city',
    ),
    'cargo': PushOp(cargo_body, cargo_signature, 'last_pushed_cargo', 'cargo'),
}


def _queue_after_commit(trip_id: int, op: str, body: dict, event_id: str, marker: str | None = None) -> None:
    """POST after the caller's commit; a broker outage must not fail the request."""
    from apps.transport.tasks import push_trip_update

    def send() -> None:
        try:
            push_trip_update.delay(trip_id, op, body, event_id)
        except Exception:  # kombu/redis raise different types; any failure means "not queued"
            logger.warning('Could not queue Planning %s push for trip %s', op, trip_id, exc_info=True)
            if marker:
                # Forget the marker — the next poll tick enqueues it again.
                ExternalTrip.objects.filter(pk=trip_id).update(**{marker: None})
            else:
                # One-shot op: nothing re-sends it, so show it on the board.
                ExternalTrip.objects.filter(pk=trip_id).update(
                    last_push_status='error', last_push_error=f'{op}: PLANNING_UNAVAILABLE')

    transaction.on_commit(send)


def enqueue_push(trip: ExternalTrip, op: str) -> None:
    """Build the body now (frozen occurredAt/eventId), remember what was sent, POST after commit."""
    push = PUSH_OPS[op]
    body = push.build_body(trip.shipment)
    if body is None:
        return
    now_ms = int(datetime.now(tz=dt_tz.utc).timestamp() * 1000)
    event_id, occurred_at = build_event(trip, op, now_ms)
    if push.occurred_at:
        occurred_at = push.occurred_at(trip.shipment)
    body = {'eventId': event_id, 'occurredAt': occurred_at, 'source': 'EXTERNAL', **body}
    setattr(trip, push.marker, push.signature(trip.shipment))
    trip.save(update_fields=[push.marker])
    _queue_after_commit(trip.pk, op, body, event_id, push.marker)


def push_pending_corrections() -> int:
    """Linked trips whose pushed values changed since our last push get one new push per op.

    Runs every poll tick, so an edit on the Sheet reaches Planning within ~2
    minutes without export importing transport. Compares against what we last
    enqueued (last_pushed_*), NOT against Planning's echo: mock never echoes and
    live echoes late — that comparison would re-push forever. A refused push
    recovers by itself once the manager fixes the value.
    """
    pushed = 0
    trips = ExternalTrip.objects.filter(shipment__isnull=False).exclude(
        status__in=ExternalTrip.CLOSED_STATUSES,
    ).select_related(
        'shipment__loading_location', 'shipment__city', 'shipment__product_type',
    ).prefetch_related('shipment__block_sources__block')
    for trip in trips:
        for op, push in PUSH_OPS.items():
            current = push.signature(trip.shipment)
            if current and current != getattr(trip, push.marker):
                enqueue_push(trip, op)
                pushed += 1
    return pushed
```

- [ ] **Step 6: Update `trip_assignment.py`**

Replace the `RELEASED_TRIP_COLUMNS` block (lines 19-23) with:

```python
from apps.transport.services.trip_push import PUSH_OPS, enqueue_push
```
(merge into the existing `from apps.transport.services.trip_push import enqueue_push` line) and

```python
# Our own columns cleared whenever a trip leaves its shipment.
RELEASED_TRIP_COLUMNS = {
    'shipment': None, 'conflict_note': None, 'conflict_kind': None, 'conflict_from': None,
    'conflict_to': None, **{push.marker: None for push in PUSH_OPS.values()},
}
```

Replace the end of `assign_trip` (the `linked = ...` line and the two `enqueue_push` calls) with:

```python
    linked = ExternalTrip.objects.select_related(
        'shipment__loading_location', 'shipment__city', 'shipment__product_type',
    ).get(pk=trip.pk)
    for op in PUSH_OPS:
        enqueue_push(linked, op)
```

and update its docstring to `"""Join a free trip to a Preparation shipment and tell Planning everything we know."""`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `TEST_DB_NAME=test_ygt_planning_ops /d/projects/yigit_platform/backend/venv/Scripts/python.exe manage.py test apps.transport --noinput -v 1`
Expected: all transport tests PASS (baseline count + 9 new).

- [ ] **Step 8: Commit** (only if the user authorized commits)

```bash
cd /d/projects/yigit_platform-planning-ops
git status
git add backend/apps/transport/models/external_trip.py backend/apps/transport/migrations/0011_trip_write_ops.py \
  backend/apps/transport/services/trip_push.py backend/apps/transport/services/trip_assignment.py \
  backend/apps/transport/tests/test_trip_push.py
git diff --cached --stat
git commit -m "feat(p3): push destination city and product to Planning

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Loading-place events and destination customs

**Files:**
- Modify: `backend/apps/transport/services/trip_push.py` (add builders + 4 `PUSH_OPS` rows)
- Modify: `backend/apps/transport/tasks.py:130-145` (`push_trip_update`)
- Test: `backend/apps/transport/tests/test_trip_push.py`

**Interfaces:**
- Consumes: `PushOp`, `PUSH_OPS`, `_place` from Task 1.
- Produces: `PUSH_OPS` keys `event-arrived`, `event-loaded`, `event-departed` (path `events`), `customs` (path `customs`); `customs_body(shipment)`; `push_trip_update` POSTs to `PUSH_OPS[op].path` when `op` is a table op, else to `op` itself.

- [ ] **Step 1: Write the failing tests** — append to `backend/apps/transport/tests/test_trip_push.py`:

```python
class EventAndCustomsTests(TestCase):
    ARRIVED = '2026-10-07T08:30:00+00:00'

    def setUp(self):
        self.shipment = _make_shipment(greenhouse_arrived_at=self.ARRIVED)
        ShipmentBlockSource.objects.create(
            shipment=self.shipment, block=GreenhouseBlock.objects.create(code='A1', name='Blok A1'),
            weight_kg=1000)
        self.trip = make_trip()
        ExternalTrip.objects.filter(pk=self.trip.pk).update(shipment=self.shipment)

    def _linked(self):
        return ExternalTrip.objects.select_related('shipment').get(pk=self.trip.pk)

    def test_event_body_has_type_and_place(self):
        from apps.transport.services.trip_push import PUSH_OPS
        body = PUSH_OPS['event-arrived'].build_body(self._linked().shipment)
        self.assertEqual(body, {'type': 'ARRIVED_AT_PLACE', 'place': {'ref': 'A1', 'name': 'Blok A1'}})

    def test_event_without_blocks_has_no_place(self):
        from apps.transport.services.trip_push import PUSH_OPS
        self.shipment.block_sources.all().delete()
        self.assertEqual(PUSH_OPS['event-arrived'].build_body(self._linked().shipment), {'type': 'ARRIVED_AT_PLACE'})

    def test_empty_time_means_no_event(self):
        from apps.transport.services.trip_push import PUSH_OPS
        shipment = self._linked().shipment
        self.assertIsNone(PUSH_OPS['event-loaded'].build_body(shipment))
        self.assertIsNone(PUSH_OPS['event-departed'].build_body(shipment))

    def test_customs_only_after_destination_exit(self):
        from apps.transport.services.trip_push import customs_body
        shipment = self._linked().shipment
        self.assertIsNone(customs_body(shipment))
        shipment.customs_exit_at = self.ARRIVED
        self.assertEqual(customs_body(shipment), {'cleared': True})

    def test_occurred_at_is_the_operator_time(self):
        from apps.transport.services.trip_push import enqueue_push
        linked = self._linked()
        with mock.patch('apps.transport.tasks.push_trip_update.delay') as delay, \
                self.captureOnCommitCallbacks(execute=True):
            enqueue_push(linked, 'event-arrived')
        body = delay.call_args.args[2]
        self.assertEqual(body['occurredAt'], linked.shipment.greenhouse_arrived_at.isoformat())
        self.assertTrue(body['occurredAt'].startswith('2026-10-07T08:30:00'))

    def test_unchanged_event_time_is_not_pushed_again(self):
        from apps.transport.services.trip_push import enqueue_push, push_pending_corrections
        with mock.patch('apps.transport.tasks.push_trip_update.delay'), \
                self.captureOnCommitCallbacks(execute=True):
            enqueue_push(self._linked(), 'event-arrived')
        with mock.patch('apps.transport.services.trip_push.enqueue_push') as enqueue:
            push_pending_corrections()
        self.assertNotIn('event-arrived', [c.args[1] for c in enqueue.call_args_list])

    def test_corrected_event_time_is_pushed_again(self):
        from apps.transport.services.trip_push import push_pending_corrections
        ExternalTrip.objects.filter(pk=self.trip.pk).update(last_pushed_arrived='2026-10-07T07:00:00+00:00')
        with mock.patch('apps.transport.services.trip_push.enqueue_push') as enqueue:
            push_pending_corrections()
        self.assertIn('event-arrived', [c.args[1] for c in enqueue.call_args_list])

    def test_event_ops_post_to_events_path(self):
        client = mock.Mock(is_mock=False)
        client.post_op.return_value = (200, {})
        with mock.patch('apps.transport.tasks.get_trips_client', return_value=client):
            push_trip_update.apply(args=(self.trip.pk, 'event-loaded', {'eventId': 'k'}, 'k'))
        self.assertEqual(client.post_op.call_args.args[1], 'events')

    def test_exhausted_retries_forget_the_event_marker(self):
        from apps.transport.services.trips_client import TripsApiUnavailable
        ExternalTrip.objects.filter(pk=self.trip.pk).update(last_pushed_loaded='2026-10-07T09:00:00+00:00')
        client = mock.Mock(is_mock=False)
        client.post_op.side_effect = TripsApiUnavailable('down')
        with mock.patch('apps.transport.tasks.get_trips_client', return_value=client):
            push_trip_update.apply(args=(self.trip.pk, 'event-loaded', {'eventId': 'k'}, 'k'))
        self.trip.refresh_from_db()
        self.assertIsNone(self.trip.last_pushed_loaded)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `TEST_DB_NAME=test_ygt_planning_ops /d/projects/yigit_platform/backend/venv/Scripts/python.exe manage.py test apps.transport.tests.test_trip_push --noinput -v 1`
Expected: FAIL — `KeyError: 'event-arrived'`, `ImportError: cannot import name 'customs_body'`.

- [ ] **Step 3: Add the builders and rows** — in `trip_push.py`, after `cargo_signature`, add:

```python
def _event_body(event_type: str, field: str) -> Callable[[Shipment], dict | None]:
    """LoadingPlaceEvent body for one operator-entered time on the shipment."""
    def build(shipment: Shipment) -> dict | None:
        if getattr(shipment, field) is None:
            return None
        body = {'type': event_type}
        place = _place(shipment)
        if place:
            body['place'] = place
        return body
    return build


def _stamp(field: str) -> Callable[[Shipment], str | None]:
    """Signature and occurredAt of a timestamp op: the operator-entered time itself."""
    def read(shipment: Shipment) -> str | None:
        value = getattr(shipment, field)
        return value.isoformat() if value else None
    return read


def customs_body(shipment: Shipment) -> dict | None:
    """CustomsUpdate body once the truck has left destination-country customs."""
    return {'cleared': True} if shipment.customs_exit_at else None
```

and add these rows at the end of the `PUSH_OPS` dict:

```python
    # Events and customs carry the operator's own time as occurredAt; Planning orders
    # its history by it. Clearing a time sends nothing (the contract cannot retract).
    'event-arrived': PushOp(_event_body('ARRIVED_AT_PLACE', 'greenhouse_arrived_at'),
                            _stamp('greenhouse_arrived_at'), 'last_pushed_arrived', 'events',
                            _stamp('greenhouse_arrived_at')),
    'event-loaded': PushOp(_event_body('LOADED', 'loading_ended_at'),
                           _stamp('loading_ended_at'), 'last_pushed_loaded', 'events',
                           _stamp('loading_ended_at')),
    'event-departed': PushOp(_event_body('DEPARTED_FROM_PLACE', 'departed_at'),
                             _stamp('departed_at'), 'last_pushed_departed', 'events',
                             _stamp('departed_at')),
    'customs': PushOp(customs_body, _stamp('customs_exit_at'), 'last_pushed_customs', 'customs',
                      _stamp('customs_exit_at')),
```

- [ ] **Step 4: POST to the op's path** — in `backend/apps/transport/tasks.py`, inside `push_trip_update`, replace

```python
        status_code, payload = get_trips_client().post_op(str(trip.integration_trip_id), op, body, event_id)
```
with
```python
        path = PUSH_OPS[op].path if op in PUSH_OPS else op
        status_code, payload = get_trips_client().post_op(str(trip.integration_trip_id), path, body, event_id)
```

and in `_record_push` replace `marker = PUSH_OPS[op][2]` with `marker = PUSH_OPS[op].marker`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `TEST_DB_NAME=test_ygt_planning_ops /d/projects/yigit_platform/backend/venv/Scripts/python.exe manage.py test apps.transport --noinput -v 1`
Expected: all PASS.

- [ ] **Step 6: Commit** (only if authorized)

```bash
git status
git add backend/apps/transport/services/trip_push.py backend/apps/transport/tasks.py backend/apps/transport/tests/test_trip_push.py
git diff --cached --stat
git commit -m "feat(p3): push loading-place events and destination customs to Planning

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Trip rejection backend

**Files:**
- Create: `backend/apps/transport/services/trip_rejection.py`
- Modify: `backend/apps/transport/services/trip_push.py` (add `enqueue_rejection`)
- Modify: `backend/apps/transport/services/trip_assignment.py` (`_check_trip`)
- Modify: `backend/apps/transport/services/trip_sync.py:67-71` (`_upsert`)
- Modify: `backend/apps/transport/tasks.py` (`_record_push`)
- Modify: `backend/apps/transport/views_trips.py`
- Modify: `backend/apps/transport/serializers_trips.py`
- Create: `backend/apps/transport/tests/test_trip_rejection.py`
- Modify: `backend/apps/transport/tests/test_trip_sync.py` (`ChangeDetectionTests`)

**Interfaces:**
- Consumes: `ExternalTrip.REJECTION_FIELDS`, rejection columns (Task 1); `_queue_after_commit`, `build_event` (Task 1); `AssignmentError`.
- Produces: `reject_trip(trip: ExternalTrip, reason: str, user: User) -> None`; `REJECTION_REASON_MAX = 512`; `enqueue_rejection(trip: ExternalTrip, reason: str) -> None`; `POST /api/v1/transport/external-trips/{id}/reject/` body `{reason}` → 200 trip payload / 400 `reason_required` | `reason_too_long` / 409 `trip_linked` | `trip_closed`; assign/move → 409 `trip_rejected`; serializer fields `rejection_reason`, `rejected_at`, `rejected_by_name`.

- [ ] **Step 1: Write the failing tests** — create `backend/apps/transport/tests/test_trip_rejection.py`:

```python
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.core.models import Country
from apps.transport.models import ExternalTrip
from apps.transport.tasks import push_trip_update
from apps.transport.tests.test_trip_assignment import make_trip
from apps.transport.tests.test_trip_sync import _make_shipment

User = get_user_model()


@override_settings(TRANSPORT_API_MODE='mock')
class RejectApiTests(TestCase):
    def setUp(self):
        call_command('seed_permissions')
        cache.clear()
        self.client = APIClient()
        self.kz = Country.objects.create(code='KZ', name_tk='GAZAGYSTAN')
        self.shipment = _make_shipment(country=self.kz)
        self.trip = make_trip()
        self.url = f'/api/v1/transport/external-trips/{self.trip.pk}/reject/'

    def _as(self, role):
        user = User.objects.create_user(username=role, password='x', role=role, first_name='Aman')
        self.client.force_authenticate(user)
        return user

    def test_export_manager_rejects_a_free_trip_and_planning_gets_the_reason(self):
        self._as('export_manager')
        with mock.patch('apps.transport.tasks.push_trip_update.delay') as delay, \
                self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(self.url, {'reason': '  Нет визы KZ  '}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual((data['rejection_reason'], data['rejected_by_name']), ('Нет визы KZ', 'Aman'))
        self.assertIsNotNone(data['rejected_at'])
        trip_id, op, body, event_id = delay.call_args.args
        self.assertEqual((trip_id, op, body['reason'], body['eventId']), (self.trip.pk, 'rejection', 'Нет визы KZ', event_id))

    def test_reason_is_required(self):
        self._as('export_manager')
        response = self.client.post(self.url, {'reason': '   '}, format='json')
        self.assertEqual((response.status_code, response.json()['error']), (400, 'reason_required'))

    def test_reason_is_capped(self):
        self._as('export_manager')
        response = self.client.post(self.url, {'reason': 'x' * 513}, format='json')
        self.assertEqual((response.status_code, response.json()['error']), (400, 'reason_too_long'))

    def test_linked_trip_cannot_be_rejected(self):
        self._as('export_manager')
        ExternalTrip.objects.filter(pk=self.trip.pk).update(shipment=self.shipment)
        response = self.client.post(self.url, {'reason': 'x'}, format='json')
        self.assertEqual((response.status_code, response.json()['error']), (409, 'trip_linked'))

    def test_closed_trip_cannot_be_rejected(self):
        self._as('export_manager')
        ExternalTrip.objects.filter(pk=self.trip.pk).update(status='CLOSED')
        response = self.client.post(self.url, {'reason': 'x'}, format='json')
        self.assertEqual((response.status_code, response.json()['error']), (409, 'trip_closed'))

    def test_rejected_trip_cannot_be_assigned(self):
        self._as('export_manager')
        self.client.post(self.url, {'reason': 'x'}, format='json')
        response = self.client.post(f'/api/v1/transport/external-trips/{self.trip.pk}/assign/',
                                    {'shipment_id': self.shipment.pk}, format='json')
        self.assertEqual((response.status_code, response.json()['error']), (409, 'trip_rejected'))

    def test_transport_role_cannot_reject(self):
        self._as('transport')
        self.assertEqual(self.client.post(self.url, {'reason': 'x'}, format='json').status_code, 403)


class RejectionPushTests(TestCase):
    def setUp(self):
        self.trip = make_trip()

    def test_rejection_posts_to_rejection_path(self):
        client = mock.Mock(is_mock=False)
        client.post_op.return_value = (200, {})
        with mock.patch('apps.transport.tasks.get_trips_client', return_value=client):
            push_trip_update.apply(args=(self.trip.pk, 'rejection', {'eventId': 'k', 'reason': 'x'}, 'k'))
        self.assertEqual(client.post_op.call_args.args[1], 'rejection')

    def test_rejection_exhausted_retries_record_error(self):
        from apps.transport.services.trips_client import TripsApiUnavailable
        client = mock.Mock(is_mock=False)
        client.post_op.side_effect = TripsApiUnavailable('down')
        with mock.patch('apps.transport.tasks.get_trips_client', return_value=client):
            push_trip_update.apply(args=(self.trip.pk, 'rejection', {'eventId': 'k'}, 'k'))
        self.trip.refresh_from_db()
        self.assertEqual(self.trip.last_push_status, 'error')
        self.assertEqual(self.trip.last_push_error, 'rejection: PLANNING_UNAVAILABLE')

    def test_rejection_broker_failure_is_visible(self):
        from apps.transport.services.trip_push import enqueue_rejection
        with mock.patch('apps.transport.tasks.push_trip_update.delay', side_effect=ConnectionError('redis')), \
                self.captureOnCommitCallbacks(execute=True):
            enqueue_rejection(self.trip, 'x')
        self.trip.refresh_from_db()
        self.assertEqual(self.trip.last_push_error, 'rejection: PLANNING_UNAVAILABLE')
```

And add to `ChangeDetectionTests` in `backend/apps/transport/tests/test_trip_sync.py`:

```python
    def _rejected(self, client):
        sync_external_trips(client)
        trip = ExternalTrip.objects.get(tractor_plate='2563AHF')
        ExternalTrip.objects.filter(pk=trip.pk).update(rejection_reason='Нет визы', rejected_at=timezone.now())
        return trip

    def test_driver_swap_clears_rejection(self):
        items = _fixture_items()
        client = FakeClient(items)
        trip = self._rejected(client)
        self._bump(items, **{'driver.fullName': 'Täze Sürüji'})
        sync_external_trips(client)
        trip.refresh_from_db()
        self.assertIsNone(trip.rejection_reason)
        self.assertIsNone(trip.rejected_at)

    def test_status_only_bump_keeps_rejection(self):
        items = _fixture_items()
        client = FakeClient(items)
        trip = self._rejected(client)
        self._bump(items, status='PLANNED')
        sync_external_trips(client)
        trip.refresh_from_db()
        self.assertEqual(trip.rejection_reason, 'Нет визы')
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `TEST_DB_NAME=test_ygt_planning_ops /d/projects/yigit_platform/backend/venv/Scripts/python.exe manage.py test apps.transport.tests.test_trip_rejection apps.transport.tests.test_trip_sync --noinput -v 1`
Expected: FAIL — 404 on `/reject/`, `ImportError: enqueue_rejection`, `KeyError: 'rejection'`, rejection not cleared.

- [ ] **Step 3: `enqueue_rejection`** — append to `trip_push.py`:

```python
def enqueue_rejection(trip: ExternalTrip, reason: str) -> None:
    """One-shot TripRejection push: not in the correction loop, so no marker."""
    now_ms = int(datetime.now(tz=dt_tz.utc).timestamp() * 1000)
    event_id, occurred_at = build_event(trip, 'rejection', now_ms)
    body = {'eventId': event_id, 'occurredAt': occurred_at, 'source': 'EXTERNAL', 'reason': reason}
    _queue_after_commit(trip.pk, 'rejection', body, event_id)
```

- [ ] **Step 4: The service** — create `backend/apps/transport/services/trip_rejection.py`:

```python
"""Tell Planning a free trip does not suit us (contract TripRejection).

The rejection stays on the trip until Planning swaps the truck, trailer or
driver, or cancels the trip (trip_sync._upsert clears it).
"""
from django.db import transaction
from django.utils import timezone

from apps.core.models import User
from apps.transport.models import ExternalTrip
from apps.transport.services.trip_assignment import AssignmentError
from apps.transport.services.trip_push import enqueue_rejection

REJECTION_REASON_MAX = 512


def reject_trip(trip: ExternalTrip, reason: str, user: User) -> None:
    """Mark a free, open trip rejected and send the reason to Planning once."""
    with transaction.atomic():
        trip = ExternalTrip.objects.select_for_update().get(pk=trip.pk)
        if trip.status in ExternalTrip.CLOSED_STATUSES:
            raise AssignmentError('trip_closed')
        if trip.shipment_id:
            raise AssignmentError('trip_linked')
        trip.rejection_reason, trip.rejected_at, trip.rejected_by = reason, timezone.now(), user
        trip.save(update_fields=list(ExternalTrip.REJECTION_FIELDS))
        enqueue_rejection(trip, reason)
```

- [ ] **Step 5: Refuse assigning a rejected trip** — in `trip_assignment._check_trip`, after the `trip_taken` check add:

```python
    if trip.rejected_at:
        raise AssignmentError('trip_rejected')
```

- [ ] **Step 6: Clear on a real change** — in `trip_sync._upsert`, replace the last line `return trip if trip.shipment_id and is_real_change(old, fields) else None` with:

```python
    changed = is_real_change(old, fields)
    if changed and trip.rejected_at:
        # Planning swapped the truck or driver (or cancelled): our rejection is answered.
        # A queryset update keeps our columns out of the poll's own save (see docstring).
        ExternalTrip.objects.filter(pk=trip.pk).update(**dict.fromkeys(ExternalTrip.REJECTION_FIELDS))
    return trip if trip.shipment_id and changed else None
```

- [ ] **Step 7: Tolerate the marker-less op** — in `tasks._record_push` replace `if resend:` with `if resend and op in PUSH_OPS:`.

- [ ] **Step 8: Endpoint** — in `views_trips.py`:

add the import `from apps.transport.services.trip_rejection import REJECTION_REASON_MAX, reject_trip`;
change `ExternalTrip.objects.select_related('shipment')` to `ExternalTrip.objects.select_related('shipment', 'rejected_by')` in both `_trip_payload` and `get_queryset`;
add after the `unassign` action:

```python
    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        reason = str(request.data.get('reason') or '').strip()
        if not reason:
            return _error('reason_required', status.HTTP_400_BAD_REQUEST)
        if len(reason) > REJECTION_REASON_MAX:
            return _error('reason_too_long', status.HTTP_400_BAD_REQUEST)
        return self._run(lambda trip: reject_trip(trip, reason, request.user))
```

- [ ] **Step 9: Serializer** — in `serializers_trips.ExternalTripSerializer` add the field

```python
    rejected_by_name = serializers.SerializerMethodField()
```
append `'rejection_reason', 'rejected_at', 'rejected_by_name',` to `Meta.fields` (after `'last_push_error',`), and add the method:

```python
    def get_rejected_by_name(self, trip: ExternalTrip) -> str | None:
        user = trip.rejected_by
        return (user.get_full_name() or user.username) if user else None
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `TEST_DB_NAME=test_ygt_planning_ops /d/projects/yigit_platform/backend/venv/Scripts/python.exe manage.py test apps.transport --noinput -v 1`
Expected: all PASS.

- [ ] **Step 11: Commit** (only if authorized)

```bash
git status
git add backend/apps/transport/services/trip_rejection.py backend/apps/transport/services/trip_push.py \
  backend/apps/transport/services/trip_assignment.py backend/apps/transport/services/trip_sync.py \
  backend/apps/transport/tasks.py backend/apps/transport/views_trips.py backend/apps/transport/serializers_trips.py \
  backend/apps/transport/tests/test_trip_rejection.py backend/apps/transport/tests/test_trip_sync.py
git diff --cached --stat
git commit -m "feat(p3): reject a Planning trip with a reason from the Truck Board API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Truck Board rejection UI and push labels

**Files:**
- Modify: `frontend/src/types/externalTrip.ts` (`IExternalTrip`)
- Modify: `frontend/src/mock/externalTrips.ts` (`base`)
- Modify: `frontend/src/hooks/useExternalTrips.ts`
- Create: `frontend/src/pages/export/truckBoard/RejectTripModal.tsx`
- Create: `frontend/src/pages/export/truckBoard/RejectTripModal.test.tsx`
- Create: `frontend/src/pages/export/truckBoard/TruckMatchPanel.test.tsx`
- Modify: `frontend/src/pages/export/truckBoard/TripCard.tsx`, `TripCard.test.tsx`
- Modify: `frontend/src/pages/export/truckBoard/TripDrawer.tsx`, `TruckMatchPanel.tsx`
- Modify: `frontend/src/pages/export/TruckBoard.tsx`
- Modify: `frontend/src/i18n/ru.json`, `en.json`, `tk.json` (`truck_board` section)

**Interfaces:**
- Consumes: API from Task 3 (`POST /transport/external-trips/{id}/reject/`, fields `rejection_reason`, `rejected_at`, `rejected_by_name`; error keys `reason_required`, `reason_too_long`, `trip_linked`, `trip_rejected`).
- Produces: `useRejectTrip()` mutation `{ tripId: number; reason: string }`; `RejectTripModal({ trip, onClose })`; `TripDrawer` props `canReject: boolean`, `onReject: (trip: IExternalTrip) => void`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/pages/export/truckBoard/RejectTripModal.test.tsx`:

```tsx
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18n from '@/i18n';
import * as trips from '@/hooks/useExternalTrips';
import type { IExternalTrip } from '@/types/externalTrip';
import { RejectTripModal } from './RejectTripModal';

vi.mock('@/hooks/useExternalTrips');

const mutate = vi.fn();
const trip = { id: 7, tractor_plate: '2563AHF', trailer_plate: '2251TAH' } as unknown as IExternalTrip;

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
  mutate.mockReset();
  vi.mocked(trips.useRejectTrip).mockReturnValue({ mutate, isPending: false } as any);
});

describe('RejectTripModal', () => {
  it('requires a reason', async () => {
    render(<RejectTripModal trip={trip} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reject trip' }));
    expect(await screen.findByText('Enter a reason')).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('sends the trimmed reason', async () => {
    render(<RejectTripModal trip={trip} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  No KZ visa ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject trip' }));
    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate.mock.calls[0][0]).toEqual({ tripId: 7, reason: 'No KZ visa' });
  });
});
```

Create `frontend/src/pages/export/truckBoard/TruckMatchPanel.test.tsx`:

```tsx
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '@/i18n';
import type { ICandidateShipment, IExternalTrip } from '@/types/externalTrip';
import { TruckMatchPanel } from './TruckMatchPanel';

beforeAll(async () => { await i18n.changeLanguage('en'); });

const shipment = { id: 1, shipment_code: 'KZ-1', country_code: 'KZ' } as unknown as ICandidateShipment;
const trip = {
  id: 2, tractor_plate: 'A', trailer_plate: 'B', destination_country_code: 'KZ',
  rejected_at: '2026-10-07T10:00:00Z', rejection_reason: 'No visa',
} as unknown as IExternalTrip;

describe('TruckMatchPanel', () => {
  it('does not offer Assign for a rejected trip', () => {
    render(<TruckMatchPanel shipment={shipment} trip={trip} canAssign isReadOnly={false} isLoading={false}
      onAssign={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Assign' })).toBeDisabled();
    expect(screen.getByText('Waiting for Planning to change the truck or driver')).toBeInTheDocument();
  });
});
```

Append to `TripCard.test.tsx` inside the `describe`:

```tsx
  it('marks a rejected trip with its reason', () => {
    render(<TripCard trip={{ ...full, rejected_at: '2026-10-07T10:00:00Z', rejection_reason: 'No KZ visa' }}
      selected={false} countryCode="RU" onSelect={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByText('Rejected: No KZ visa')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `frontend/`): `npx vitest run src/pages/export/truckBoard`
Expected: FAIL — `RejectTripModal` module not found, `useRejectTrip` not a function, texts not found.

- [ ] **Step 3: Types and mock** — in `IExternalTrip` (`types/externalTrip.ts`) after `last_push_error: string | null;` add:

```ts
  /** Our rejection sent to Planning; cleared when Planning swaps the truck or driver. */
  rejection_reason: string | null;
  rejected_at: string | null;
  rejected_by_name: string | null;
```
In `mock/externalTrips.ts` `base`, after `last_push_error: null,` add `rejection_reason: null, rejected_at: null, rejected_by_name: null,`.

- [ ] **Step 4: Hook** — in `hooks/useExternalTrips.ts` after `useUnassignTrip` add:

```ts
export function useRejectTrip() {
  return useTripAction<{ tripId: number; reason: string }>(
    (v) => `${BASE}${v.tripId}/reject/`,
    (v) => ({ reason: v.reason }),
  );
}
```

- [ ] **Step 5: Modal** — create `frontend/src/pages/export/truckBoard/RejectTripModal.tsx`:

```tsx
import { Form, Input, Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useRejectTrip } from '@/hooks/useExternalTrips';
import type { IExternalTrip } from '@/types/externalTrip';
import { apiErrorKey } from './truckBoardHelpers';

const REASON_MAX = 512;

interface IRejectTripModalProps {
  trip: IExternalTrip | null;
  onClose: () => void;
}

/** Ask for the reason and tell Planning this trip does not suit us. */
export function RejectTripModal({ trip, onClose }: IRejectTripModalProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm<{ reason: string }>();
  const reject = useRejectTrip();

  async function submit() {
    const values = await form.validateFields().catch(() => null);
    if (!trip || !values) return;
    reject.mutate(
      { tripId: trip.id, reason: values.reason.trim() },
      {
        onSuccess: () => {
          toast.success(t('truck_board.rejected_toast'));
          onClose();
        },
        onError: (err) => toast.error(t(`truck_board.error.${apiErrorKey(err)}`)),
      },
    );
  }

  return (
    <Modal
      open={trip !== null}
      title={trip ? `${t('truck_board.reject_title')} · ${trip.tractor_plate} / ${trip.trailer_plate}` : ''}
      okText={t('truck_board.reject')}
      okButtonProps={{ danger: true, loading: reject.isPending }}
      onOk={submit}
      onCancel={onClose}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item
          name="reason"
          label={t('truck_board.reject_reason')}
          rules={[{ required: true, whitespace: true, message: t('truck_board.error.reason_required') }]}
        >
          <Input.TextArea rows={3} maxLength={REASON_MAX} showCount />
        </Form.Item>
      </Form>
    </Modal>
  );
}
```

- [ ] **Step 6: Card tag** — in `TripCard.tsx`, inside the tag row after the no-visa tag, add:

```tsx
        {trip.rejected_at && (
          <Tag color="red">{t('truck_board.rejected_tag', { reason: trip.rejection_reason })}</Tag>
        )}
```

- [ ] **Step 7: Match panel** — in `TruckMatchPanel.tsx` replace the `ready` line with:

```tsx
  const rejected = !!trip?.rejected_at;
  const ready = !!shipment && !!trip && !mismatch && !rejected && canAssign && !isReadOnly;
```
and after the `mismatch` Alert add:

```tsx
        {rejected && <Alert type="warning" showIcon message={t('truck_board.rejected_wait')} />}
```

- [ ] **Step 8: Drawer** — in `TripDrawer.tsx`:
extend props:

```tsx
interface ITripDrawerProps {
  trip: IExternalTrip | null;
  canReject: boolean;
  onReject: (trip: IExternalTrip) => void;
  onClose: () => void;
}

export function TripDrawer({ trip, canReject, onReject, onClose }: ITripDrawerProps) {
```
add, as the last `Descriptions.Item` (after visas):

```tsx
            {trip.rejected_at && (
              <Descriptions.Item label={t('truck_board.rejected_label')}>
                {trip.rejection_reason} · {trip.rejected_by_name ?? '—'} · {trip.rejected_at.slice(0, 16).replace('T', ' ')}
              </Descriptions.Item>
            )}
```
and replace the PDF `<Button ...>` with:

```tsx
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <Button onClick={() => openPdf(trip.id)}>{t('truck_board.documents_pdf')}</Button>
            {canReject && !trip.shipment && !trip.rejected_at && (
              <Button danger onClick={() => onReject(trip)}>{t('truck_board.reject')}</Button>
            )}
          </div>
```

- [ ] **Step 9: Page wiring** — in `TruckBoard.tsx`:
import `import { RejectTripModal } from './truckBoard/RejectTripModal';`;
add state `const [rejectTripId, setRejectTripId] = useState<number | null>(null);`;
replace the `<TripDrawer ... />` line with:

```tsx
      <TripDrawer trip={trips.find((tr) => tr.id === drawerTripId) ?? null} canReject={canAssign && !isReadOnly}
        onReject={(tr) => { setDrawerTripId(null); setRejectTripId(tr.id); }} onClose={() => setDrawerTripId(null)} />
      <RejectTripModal trip={trips.find((tr) => tr.id === rejectTripId) ?? null} onClose={() => setRejectTripId(null)} />
```
Then `grep -rn "<TripDrawer" frontend/src` — if any other caller exists, pass `canReject={false} onReject={() => {}}` there.

- [ ] **Step 10: i18n** — in each file's `truck_board` object:

`ru.json` — add next to `"assign"`:
```json
    "reject": "Отклонить рейс",
    "reject_title": "Отклонить рейс в Planning",
    "reject_reason": "Причина",
    "rejected_tag": "Отклонён: {{reason}}",
    "rejected_label": "Отклонён",
    "rejected_toast": "Рейс отклонён — Planning получит причину",
    "rejected_wait": "Ждём от Planning замену машины или водителя",
```
add to `truck_board.error`:
```json
      "reason_required": "Укажите причину",
      "reason_too_long": "Причина длиннее 512 символов",
      "trip_linked": "Рейс привязан к отгрузке — сначала отвяжите",
      "trip_rejected": "Рейс отклонён — ждём замену от Planning",
```
add to `truck_board.push_op`:
```json
      "destination-city": "город назначения",
      "cargo": "продукт",
      "event-arrived": "событие «приехал на погрузку»",
      "event-loaded": "событие «загружен»",
      "event-departed": "событие «выехал с погрузки»",
      "customs": "отметку таможни",
      "rejection": "отклонение рейса"
```
and change `truck_board.push_error.CITY_COUNTRY_MISMATCH` to `"Planning отклонил город назначения: он не в стране рейса"`.

`en.json`:
```json
    "reject": "Reject trip",
    "reject_title": "Reject the trip in Planning",
    "reject_reason": "Reason",
    "rejected_tag": "Rejected: {{reason}}",
    "rejected_label": "Rejected",
    "rejected_toast": "Trip rejected — Planning will get the reason",
    "rejected_wait": "Waiting for Planning to change the truck or driver",
```
```json
      "reason_required": "Enter a reason",
      "reason_too_long": "The reason is longer than 512 characters",
      "trip_linked": "The trip is assigned to a shipment — unassign it first",
      "trip_rejected": "The trip was rejected — waiting for Planning's change",
```
```json
      "destination-city": "the destination city",
      "cargo": "the product",
      "event-arrived": "the arrival event",
      "event-loaded": "the loaded event",
      "event-departed": "the departure event",
      "customs": "the customs mark",
      "rejection": "the trip rejection"
```
`CITY_COUNTRY_MISMATCH`: `"Planning refused the destination city: it is not in the trip country"`.

`tk.json`:
```json
    "reject": "Reýsi ret etmek",
    "reject_title": "Reýsi Planning-de ret etmek",
    "reject_reason": "Sebäbi",
    "rejected_tag": "Ret edildi: {{reason}}",
    "rejected_label": "Ret edildi",
    "rejected_toast": "Reýs ret edildi — Planning sebäbi alar",
    "rejected_wait": "Planning-den maşynyň ýa-da sürüjiniň çalşylmagyna garaşylýar",
```
```json
      "reason_required": "Sebäbi ýazyň",
      "reason_too_long": "Sebäp 512 belgiden uzyn",
      "trip_linked": "Reýs ugratma birikdirilen — ilki aýryň",
      "trip_rejected": "Reýs ret edildi — Planning-den çalşyk garaşylýar",
```
```json
      "destination-city": "barjak şäheri",
      "cargo": "önümi",
      "event-arrived": "«ýüklemä geldi» wakasyny",
      "event-loaded": "«ýüklendi» wakasyny",
      "event-departed": "«ýüklemeden çykdy» wakasyny",
      "customs": "gümrük belligini",
      "rejection": "reýsiň ret edilmegini"
```
`CITY_COUNTRY_MISMATCH`: `"Planning barjak şäheri kabul etmedi: ol reýsiň ýurdunda däl"`.

Mind JSON commas: the last entry of `push_op` currently is `"loading": ...` without a trailing comma — add one before the new entries.

- [ ] **Step 11: Run tests and type check**

```bash
cd /d/projects/yigit_platform-planning-ops/frontend
npx vitest run src/pages/export src/components/shipment
npx tsc --noEmit --ignoreDeprecations 5.0
node -e "for (const f of ['ru','en','tk']) JSON.parse(require('fs').readFileSync('src/i18n/'+f+'.json','utf8'))"
```
Expected: tests PASS, 0 TypeScript errors, JSON parses.

- [ ] **Step 12: Commit** (only if authorized)

```bash
git status
git add frontend/src/types/externalTrip.ts frontend/src/mock/externalTrips.ts frontend/src/hooks/useExternalTrips.ts \
  frontend/src/pages/export/truckBoard/RejectTripModal.tsx frontend/src/pages/export/truckBoard/RejectTripModal.test.tsx \
  frontend/src/pages/export/truckBoard/TruckMatchPanel.tsx frontend/src/pages/export/truckBoard/TruckMatchPanel.test.tsx \
  frontend/src/pages/export/truckBoard/TripCard.tsx frontend/src/pages/export/truckBoard/TripCard.test.tsx \
  frontend/src/pages/export/truckBoard/TripDrawer.tsx frontend/src/pages/export/TruckBoard.tsx \
  frontend/src/i18n/ru.json frontend/src/i18n/en.json frontend/src/i18n/tk.json
git diff --cached --stat
git commit -m "feat(frontend): reject a Planning trip from the Truck Board

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Docs and full verification

**Files:**
- Modify: `docs/obsidian/processes/truck-board.md`
- Modify: `CHANGELOG.md` (`[Unreleased]` → `Added`)
- Modify: `BUILD_TEST_LOG.md` (newest on top)

- [ ] **Step 1: Full suites**

```bash
cd /d/projects/yigit_platform-planning-ops/backend
TEST_DB_NAME=test_ygt_planning_ops /d/projects/yigit_platform/backend/venv/Scripts/python.exe manage.py test apps.transport apps.export.tests_trip_lock --noinput -v 1
/d/projects/yigit_platform/backend/venv/Scripts/python.exe manage.py makemigrations --check --dry-run
cd ../frontend && npx vitest run && npx tsc --noEmit --ignoreDeprecations 5.0
```
Expected: transport PASS; `No changes detected`; frontend PASS (record counts); 0 TS errors. Report any failure verbatim — do not fix unrelated pre-existing failures.

- [ ] **Step 2: Obsidian doc** — in `docs/obsidian/processes/truck-board.md` find the section listing what we push to Planning (search `export-code`) and replace it with this table, plus a «Отклонение рейса» section:

```markdown
| Операция | Маршрут Planning | Источник у нас | Когда |
|---|---|---|---|
| Код экспорта | `export-code` | `export_code` | привязка + изменение |
| Место погрузки | `loading` | `loading_location` + блоки | привязка + изменение |
| Город назначения | `destination-city` | `city` | привязка + изменение |
| Продукт | `cargo` | `product_type` (`name_ru`, `code`) | привязка + изменение |
| Приехал на погрузку | `events` `ARRIVED_AT_PLACE` | `greenhouse_arrived_at` | время заполнено/исправлено |
| Загружен | `events` `LOADED` | `loading_ended_at` | время заполнено/исправлено |
| Выехал с погрузки | `events` `DEPARTED_FROM_PLACE` | `departed_at` | время заполнено/исправлено |
| Таможня пройдена | `customs` `cleared:true` | `customs_exit_at` (таможня страны назначения) | время заполнено/исправлено |
| Отклонение рейса | `rejection` | кнопка «Отклонить рейс» в карточке рейса | один раз |

Очистка поля после отправки в Planning ничего не шлёт: контракт не умеет отзывать события.
Исправленное время уходит вторым событием с новым `occurredAt`.

## Отклонение рейса

Свободный рейс можно отклонить из карточки (кнопка «Отклонить рейс», причина обязательна,
до 512 символов). Право — то же, что у привязки (`shipment_assign` edit). Рейс остаётся на доске
с меткой «Отклонён: <причина>», привязать его нельзя (`409 trip_rejected`). Метка снимается сама,
когда Planning меняет тягач, прицеп или водителя либо отменяет рейс.
API: `POST /api/v1/transport/external-trips/{id}/reject/` `{reason}`.
```

- [ ] **Step 3: CHANGELOG** — under `## [Unreleased]` → `### Added`:

```markdown
- feat(p3): Planning API — push destination city, product, loading-place events (arrived/loaded/departed) and destination customs; reject a trip with a reason from the Truck Board
```

- [ ] **Step 4: BUILD_TEST_LOG** — add at the top of the list:

```markdown
- [ ] 2026-10-07 — Planning write ops (destination-city, cargo, events, customs, rejection) on branch feat/planning-write-ops — NEEDS TEST
```

- [ ] **Step 5: Commit** (only if authorized)

```bash
git status
git add docs/obsidian/processes/truck-board.md CHANGELOG.md BUILD_TEST_LOG.md
git diff --cached --stat
git commit -m "docs(p3): Planning write ops and trip rejection

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Report** — tell the user: tasks done, test counts per suite, that migration `transport/0011` is **not applied** to the shared DB, and that merging to `main` needs the migration number re-checked. End with: *"Built — NOT tested yet. Did you test it?"*
