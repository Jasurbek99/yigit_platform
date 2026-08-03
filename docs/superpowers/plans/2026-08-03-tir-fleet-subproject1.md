# TIR Fleet Integration — Sub-project 1 (Models + Import + Resolver) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed a platform-owned `TruckHead` + `Trailer` fleet registry (once, from the Z_TIRWEB TIR DB) and make the shipment GPS resolver prefer an explicit `truck_head_id`.

**Architecture:** Two new `transport` models. A one-time `import_tir_fleet` management command reads `Z_TIRWEB.truck_heads`/`trailers` (read-only pyodbc), upserts preserving ids, and links each truck-head to its Traccar device by plate. `resolve_device_for_shipment` gains a first, authoritative step: `shipment.truck_head_id → TruckHead.traccar_device → position`.

**Tech Stack:** Django + DRF + MSSQL (mssql-django); Django `manage.py test` (unittest, MSSQL); pyodbc.

**Scope:** Sub-project 1 of 4. This ships backend only (no endpoints/UI). Later sub-projects: list/create/CRUD endpoints, shipment selectors, admin page.

## Global Constraints

- MSSQL: no JSONField/ArrayField; `DecimalField` for capacity; explicit `max_length`; `db_collation='Cyrillic_General_CI_AS'` on any Cyrillic text (`owner_name`); `bulk_*` need `batch_size=500`. No Django signals.
- Dependency direction: `transport` may import `export`/`core`; `export` may NOT import `transport`. `Shipment.truck_head_id`/`trailer_id` are plain `BigIntegerField` (already on the model) — a loose id, not a Django FK.
- `models/` package needs `__init__.py` re-exports.
- Tests run on **MSSQL** — do NOT pass `USE_SQLITE`. Run `python manage.py test apps.transport … -v2` (`--keepdb` if a stale test DB blocks).
- Commit only on `feat/transport-fleet-map`. Co-author tag = the running model (implementer subagents: `Claude Sonnet 5`).
- Z_TIRWEB (read-only, one-time): `SERVER=10.10.11.233,62079;DATABASE=Z_TIRWEB;UID=<user>;PWD=<secret>;TrustServerCertificate=yes`. Never written to. Live connection only in the real command run — tests mock the client.
- Existing (already on branch): `TraccarDevice`, `DevicePosition`, `Truck`, `ShipmentDeviceLink`, `resolve_device_for_shipment(shipment) -> (device|None, str)`, `normalize_plate(str)`.

---

### Task 1: `TruckHead` + `Trailer` models

**Files:**
- Create: `backend/apps/transport/models/fleet.py`
- Modify: `backend/apps/transport/models/__init__.py`
- Create: `backend/apps/transport/tests/test_fleet_models.py`

**Interfaces:**
- Consumes: `TraccarDevice`.
- Produces: `TruckHead(id, plate_number, owner_type, owner_name, status, capacity, traccar_device, is_active, created_at)`, `Trailer(id, plate_number, owner_type, status, is_active, created_at)`.

- [ ] **Step 1: Write the failing model test**

`backend/apps/transport/tests/test_fleet_models.py`:
```python
from django.db import IntegrityError
from django.test import TestCase

from apps.transport.models import TruckHead, Trailer, TraccarDevice


class FleetModelTests(TestCase):
    def test_truck_head_links_device_and_plate_unique(self):
        dev = TraccarDevice.objects.create(traccar_id=67, name='4378AHF TR050', status='online')
        th = TruckHead.objects.create(
            id=13, plate_number='4378AHF', owner_type='company',
            capacity='20.00', traccar_device=dev,
        )
        self.assertEqual(th.traccar_device, dev)
        self.assertTrue(th.is_active)
        with self.assertRaises(IntegrityError):
            TruckHead.objects.create(id=14, plate_number='4378AHF')

    def test_truck_head_device_set_null_on_device_delete(self):
        dev = TraccarDevice.objects.create(traccar_id=68, name='X', status='offline')
        th = TruckHead.objects.create(id=15, plate_number='9999XYZ', traccar_device=dev)
        dev.delete()
        th.refresh_from_db()
        self.assertIsNone(th.traccar_device)

    def test_trailer_plate_unique(self):
        Trailer.objects.create(id=1, plate_number='2602TAH', owner_type='company')
        with self.assertRaises(IntegrityError):
            Trailer.objects.create(id=2, plate_number='2602TAH')
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && python manage.py test apps.transport.tests.test_fleet_models -v2`
Expected: FAIL — models missing.

- [ ] **Step 3: Create the models**

`backend/apps/transport/models/fleet.py`:
```python
from django.db import models

from apps.core.db_utils import cyrillic_collation, schema_table


class TruckHead(models.Model):
    """Company tractor — the shipment's selectable truck. Seeded once from the
    TIR system (Z_TIRWEB.truck_heads), platform-owned thereafter. Linked to a
    Traccar device (by plate) for GPS.

    NOTE: `id` is assigned explicitly on import (preserving the Z_TIRWEB id, so
    Shipment.truck_head_id lines up). See the import command for how new ids are
    allocated above the imported max.
    """

    plate_number = models.CharField(max_length=50, unique=True)
    owner_type = models.CharField(max_length=20, blank=True, default='')
    owner_name = models.CharField(max_length=200, blank=True, default='', **cyrillic_collation())
    status = models.CharField(max_length=20, blank=True, default='')
    capacity = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    traccar_device = models.ForeignKey(
        'transport.TraccarDevice', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='truck_heads',
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = schema_table('transport', 'truck_heads')
        ordering = ['plate_number']

    def __str__(self) -> str:
        return self.plate_number


class Trailer(models.Model):
    """Trailer — seeded once from Z_TIRWEB.trailers, platform-owned thereafter."""

    plate_number = models.CharField(max_length=50, unique=True)
    owner_type = models.CharField(max_length=20, blank=True, default='')
    status = models.CharField(max_length=20, blank=True, default='')
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = schema_table('transport', 'trailers')
        ordering = ['plate_number']

    def __str__(self) -> str:
        return self.plate_number
```

Append to `backend/apps/transport/models/__init__.py`:
```python
from .fleet import TruckHead, Trailer
```
and add `'TruckHead', 'Trailer'` to `__all__`.

- [ ] **Step 4: Migrate + test**

Run:
```bash
cd backend
python manage.py makemigrations transport
python manage.py migrate transport
python manage.py test apps.transport.tests.test_fleet_models -v2
```
Expected: migration created + applied; tests PASS.

> NOTE: the test creates rows with explicit `id=` on the `BigAutoField` PK. On MSSQL this is an identity column — the ORM `create(id=…)` may require `SET IDENTITY_INSERT`. If the test errors with an identity-insert message, that confirms the import command (Task 2) MUST wrap explicit-id inserts in `IDENTITY_INSERT`; adjust the test to create without explicit `id` for the pure-model test and move id-preservation coverage to Task 2 (which handles IDENTITY_INSERT). Record which behavior you observed in the report — it determines Task 2's approach.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/transport/models/fleet.py backend/apps/transport/models/__init__.py backend/apps/transport/tests/test_fleet_models.py backend/apps/transport/migrations/
git commit -m "feat(transport): TruckHead + Trailer fleet models"
```

---

### Task 2: One-time `import_tir_fleet` command

**Files:**
- Create: `backend/apps/transport/services/tir_client.py`
- Create: `backend/apps/transport/services/tir_import.py`
- Create: `backend/apps/transport/management/commands/import_tir_fleet.py`
- Create: `backend/apps/transport/tests/test_tir_import.py`

**Interfaces:**
- Consumes: `TruckHead`, `Trailer`, `TraccarDevice`, `normalize_plate`.
- Produces: `TirClient.get_truck_heads() -> list[dict]` / `.get_trailers() -> list[dict]`; `import_fleet(client) -> dict` (counts); command `import_tir_fleet`.

- [ ] **Step 1: Write the failing import test (client mocked)**

`backend/apps/transport/tests/test_tir_import.py`:
```python
from unittest.mock import MagicMock

from django.test import TestCase

from apps.transport.models import TruckHead, Trailer, TraccarDevice
from apps.transport.services.tir_import import import_fleet


def _client():
    c = MagicMock()
    c.get_truck_heads.return_value = [
        {'id': 13, 'plate_number': '3269AHF', 'owner_type': 'company',
         'owner_name': '', 'status': 'idle', 'capacity': 20},
        {'id': 124, 'plate_number': '4470AHF', 'owner_type': 'company',
         'owner_name': '', 'status': 'idle', 'capacity': None},
    ]
    c.get_trailers.return_value = [
        {'id': 1, 'plate_number': '2602TAH', 'owner_type': 'company', 'status': 'idle'},
    ]
    return c


class ImportFleetTests(TestCase):
    def test_import_preserves_ids_and_links_device_by_plate(self):
        TraccarDevice.objects.create(traccar_id=999, name='3269AHF TR013', status='online')
        result = import_fleet(client=_client())
        self.assertEqual(result['truck_heads'], 2)
        self.assertEqual(result['trailers'], 1)
        th = TruckHead.objects.get(id=13)  # id preserved
        self.assertEqual(th.plate_number, '3269AHF')
        self.assertIsNotNone(th.traccar_device)          # matched by plate
        self.assertIsNone(TruckHead.objects.get(id=124).traccar_device)  # no device
        self.assertEqual(Trailer.objects.get(id=1).plate_number, '2602TAH')

    def test_import_is_idempotent(self):
        import_fleet(client=_client())
        import_fleet(client=_client())
        self.assertEqual(TruckHead.objects.count(), 2)
        self.assertEqual(Trailer.objects.count(), 1)

    def test_new_create_after_import_does_not_collide(self):
        import_fleet(client=_client())  # imports ids 13, 124
        fresh = TruckHead.objects.create(plate_number='5555AHF')  # app-assigned id
        self.assertGreater(fresh.id, 124)
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && python manage.py test apps.transport.tests.test_tir_import -v2`
Expected: FAIL — `tir_import` missing.

- [ ] **Step 3: Implement the TIR client + import service**

`backend/apps/transport/services/tir_client.py`:
```python
import logging

import pyodbc
from django.conf import settings

logger = logging.getLogger(__name__)


class TirUnavailable(Exception):
    """Raised when the Z_TIRWEB source DB cannot be reached."""


class TirClient:
    """Read-only reader of the Z_TIRWEB TIR fleet DB. Never writes."""

    def __init__(self) -> None:
        self.conn_str = settings.TIR_DB_CONN_STR

    def _rows(self, sql: str) -> list[dict]:
        try:
            with pyodbc.connect(self.conn_str, timeout=20) as cn:
                cur = cn.cursor()
                cur.execute(sql)
                cols = [c[0] for c in cur.description]
                return [dict(zip(cols, r)) for r in cur.fetchall()]
        except pyodbc.Error as exc:
            logger.error('Z_TIRWEB read failed', exc_info=True)
            raise TirUnavailable(str(exc)) from exc

    def get_truck_heads(self) -> list[dict]:
        return self._rows(
            'SELECT id, plate_number, owner_type, owner_name, status, capacity FROM truck_heads'
        )

    def get_trailers(self) -> list[dict]:
        return self._rows(
            'SELECT id, plate_number, owner_type, status FROM trailers'
        )
```

Add to `backend/config/settings.py` (near other env reads):
```python
# TIR fleet DB (Z_TIRWEB) — read-only, used ONLY by the one-time import_tir_fleet command
TIR_DB_CONN_STR = os.environ.get(
    'TIR_DB_CONN_STR',
    'DRIVER={ODBC Driver 17 for SQL Server};SERVER=10.10.11.233,62079;'
    'DATABASE=Z_TIRWEB;UID=<user>;PWD=<secret>;TrustServerCertificate=yes',
)
```
Document it in `backend/.env.example`.

`backend/apps/transport/services/tir_import.py`:
```python
from django.db import connection, transaction

from apps.transport.models import TruckHead, Trailer, TraccarDevice
from apps.transport.services.matching import normalize_plate
from apps.transport.services.tir_client import TirClient


def _device_by_plate(norm_index: dict, plate: str) -> TraccarDevice | None:
    return norm_index.get(normalize_plate(plate))


def _reseed(table: str) -> None:
    """Bump the MSSQL identity above the current max so app-created rows don't
    collide with preserved TIR ids. No-op on empty table."""
    with connection.cursor() as cur:
        cur.execute(f"SELECT ISNULL(MAX(id), 0) FROM {table}")
        max_id = cur.fetchone()[0]
        if max_id:
            cur.execute(f"DBCC CHECKIDENT ('{table}', RESEED, {max_id})")


def _upsert_with_id(model, rows: list[dict], table: str, extra=None) -> int:
    """update_or_create by id, forcing the explicit id via IDENTITY_INSERT."""
    with connection.cursor() as cur:
        cur.execute(f"SET IDENTITY_INSERT {table} ON")
        try:
            for row in rows:
                defaults = {k: row.get(k) for k in extra} if extra else {}
                model.objects.update_or_create(
                    id=row['id'],
                    defaults={
                        'plate_number': row['plate_number'],
                        'owner_type': row.get('owner_type') or '',
                        'status': row.get('status') or '',
                        **defaults,
                    },
                )
        finally:
            cur.execute(f"SET IDENTITY_INSERT {table} OFF")
    return len(rows)


@transaction.atomic
def import_fleet(client: TirClient | None = None) -> dict:
    client = client or TirClient()
    norm_index = {
        normalize_plate(p): d
        for d in TraccarDevice.objects.select_related('truck')
        for p in [d.truck.plate if d.truck_id else _plate_from_name(d.name)]
        if p
    }
    heads = client.get_truck_heads()
    for row in heads:
        dev = _device_by_plate(norm_index, row['plate_number'])
        TruckHead.objects.update_or_create(
            id=row['id'],
            defaults={
                'plate_number': row['plate_number'],
                'owner_type': row.get('owner_type') or '',
                'owner_name': row.get('owner_name') or '',
                'status': row.get('status') or '',
                'capacity': row.get('capacity'),
                'traccar_device': dev,
            },
        )
    trailers = client.get_trailers()
    for row in trailers:
        Trailer.objects.update_or_create(
            id=row['id'],
            defaults={
                'plate_number': row['plate_number'],
                'owner_type': row.get('owner_type') or '',
                'status': row.get('status') or '',
            },
        )
    _reseed('transport_truck_heads')
    _reseed('transport_trailers')
    return {'truck_heads': len(heads), 'trailers': len(trailers)}


def _plate_from_name(name: str) -> str:
    from apps.transport.services.sync import parse_device_name
    return parse_device_name(name)[0]
```

> IMPLEMENTATION NOTE (id preservation): `update_or_create(id=…)` inserts an explicit PK on an MSSQL identity column, which requires `SET IDENTITY_INSERT … ON`. The `_upsert_with_id` helper shows the pattern, but `import_fleet` above uses plain `update_or_create` for readability — **wrap the TruckHead/Trailer create loops in the `SET IDENTITY_INSERT ON/OFF` cursor calls** (as in `_upsert_with_id`) so the explicit ids land. If mssql-django rejects `SET IDENTITY_INSERT` mid-transaction, the documented fallback (per the spec) is to make `id` a non-identity `BigIntegerField(primary_key=True)` and assign ids in-app — if you take that path, update Task 1's model + migration accordingly and note it in the report. Whichever path: the three tests (id preserved, idempotent, new-create-no-collision) must pass on MSSQL.

`backend/apps/transport/management/commands/import_tir_fleet.py`:
```python
from django.core.management.base import BaseCommand

from apps.transport.services.tir_import import import_fleet
from apps.transport.services.tir_client import TirUnavailable


class Command(BaseCommand):
    help = 'ONE-TIME import of TruckHead/Trailer from the Z_TIRWEB TIR DB (read-only). Idempotent.'

    def handle(self, *args, **options):
        try:
            result = import_fleet()
        except TirUnavailable as exc:
            self.stdout.write(self.style.ERROR(f'Z_TIRWEB unavailable: {exc}'))
            return
        self.stdout.write(self.style.SUCCESS(
            f"Imported {result['truck_heads']} truck heads, {result['trailers']} trailers."
        ))
```

- [ ] **Step 4: Run tests**

Run: `cd backend && python manage.py test apps.transport.tests.test_tir_import -v2`
Expected: PASS (id preserved, idempotent, no-collision). If IDENTITY_INSERT issues arise, follow the fallback in the note and re-run.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/transport/services/tir_client.py backend/apps/transport/services/tir_import.py backend/apps/transport/management/commands/import_tir_fleet.py backend/apps/transport/tests/test_tir_import.py backend/config/settings.py backend/.env.example
git commit -m "feat(transport): one-time import_tir_fleet (Z_TIRWEB truck_heads/trailers)"
```

---

### Task 3: GPS resolver prefers `truck_head_id`

**Files:**
- Modify: `backend/apps/transport/services/matching.py`
- Modify: `backend/apps/transport/tests/test_matching.py`

**Interfaces:**
- Consumes: `TruckHead`, existing resolver internals.
- Produces: updated `resolve_device_for_shipment` — order: truck_head → manual link → auto plate-match → none. `resolved_by` for the truck_head path returns `'auto'` (keeps the shipped `{manual,auto,none}` API contract; the truck-head resolution is an automatic, authoritative one).

- [ ] **Step 1: Write the failing test**

Add to `backend/apps/transport/tests/test_matching.py`:
```python
def test_truck_head_id_resolves_device_first(self):
    from apps.transport.models import TruckHead
    dev = self.device  # from setUp: device linked to a Truck with a position
    th = TruckHead.objects.create(id=500, plate_number='ZZZ999', traccar_device=dev)
    shp = _shipment('somethingelse')      # plate would NOT auto-match
    shp.truck_head_id = th.id
    shp.save(update_fields=['truck_head_id'])
    device, how = resolve_device_for_shipment(shp)
    self.assertEqual(device, dev)
    self.assertEqual(how, 'auto')

def test_truck_head_without_device_falls_through(self):
    from apps.transport.models import TruckHead
    th = TruckHead.objects.create(id=501, plate_number='NOGPS1', traccar_device=None)
    shp = _shipment('7463LBE/1779TLB')    # no plate match either
    shp.truck_head_id = th.id
    shp.save(update_fields=['truck_head_id'])
    device, how = resolve_device_for_shipment(shp)
    self.assertIsNone(device)
    self.assertEqual(how, 'none')
```
(`_shipment` and `self.device` already exist in this test module from the GPS-link work — reuse them. Confirm `self.device` in `setUp` is linked to a Truck that has a `DevicePosition`; the existing tests rely on it.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && python manage.py test apps.transport.tests.test_matching -v2`
Expected: FAIL — truck_head path not implemented.

- [ ] **Step 3: Update the resolver**

In `backend/apps/transport/services/matching.py`, at the TOP of `resolve_device_for_shipment`, before the existing manual-link check, add:
```python
    # 1. Explicit truck-head selection (authoritative).
    if getattr(shipment, 'truck_head_id', None):
        from apps.transport.models import TruckHead
        th = (
            TruckHead.objects.filter(id=shipment.truck_head_id)
            .select_related('traccar_device').first()
        )
        if th and th.traccar_device_id:
            return th.traccar_device, 'auto'
        # truck-head set but no device → do NOT fall through to plate-match
        # (an explicit selection with no GPS device means "no GPS", not "guess").
        return None, 'none'
```
Keep the existing manual-link → plate-match → none logic below it (unchanged) for shipments with no `truck_head_id`.

> NOTE: a truck-head that IS selected but has no linked device returns `(None,'none')` — it does NOT fall through to fuzzy plate-matching, because an explicit selection is authoritative. This matches `test_truck_head_without_device_falls_through`.

- [ ] **Step 4: Run tests**

Run: `cd backend && python manage.py test apps.transport.tests.test_matching apps.transport -v2`
Expected: new tests PASS; all prior matching/API tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/transport/services/matching.py backend/apps/transport/tests/test_matching.py
git commit -m "feat(transport): resolver prefers explicit truck_head_id for GPS"
```

---

## Self-Review

**Spec coverage (sub-project 1 slice):**
- TruckHead/Trailer models (platform-owned, device FK SET_NULL, capacity Decimal) → Task 1 ✓
- One-time import, id-preserving, device-match by plate, idempotent, reseed-to-avoid-collision → Task 2 ✓
- Resolver truck_head_id-first → Task 3 ✓
- Dependency direction (loose bigint, transport owns tables) → truck_head_id read via `getattr`, no export import ✓
- Read-only Z_TIRWEB, mocked in tests → Task 2 ✓

**Placeholder scan:** No TBD/TODO in code steps. The id-preservation approach carries an explicit IMPLEMENTATION NOTE with a decision + fallback (IDENTITY_INSERT vs non-identity PK) — unavoidable, because it depends on mssql-django's runtime behavior which must be observed on the MSSQL test DB.

**Type consistency:** `resolve_device_for_shipment -> (device, str)` unchanged signature; new path returns `'auto'` (within the existing `{manual,auto,none}` contract — no frontend/type change). `import_fleet(client=None) -> dict{'truck_heads','trailers'}` consistent between Task 2 def and the command caller. `TruckHead`/`Trailer` fields consistent across Tasks 1–3.

**Open confirmations for the implementer:**
1. MSSQL identity-insert behavior (Task 1 NOTE / Task 2 NOTE) — observe on the test DB, pick IDENTITY_INSERT or non-identity PK, record in the report.
2. `_shipment`/`self.device` fixtures exist in `test_matching.py` from the GPS-link work — reuse; confirm `self.device` has a `DevicePosition`.
