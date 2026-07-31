# Traccar Fleet Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show YGT's export trucks on a live map, fed by the fleet's Traccar GPS server, backed by a standalone `transport` registry + a polling sync.

**Architecture:** A new Django `transport` app stores a truck/driver/device registry and the latest position per device. A management command polls Traccar every minute and upserts positions into our DB. A read-only DRF endpoint serves positions from our DB (never Traccar in the request path). A React "Fleet Map" page (react-leaflet + OSM tiles, ECharts fallback) renders pins, auto-refreshing every 30s.

**Tech Stack:** Django + DRF + MSSQL (django-mssql-backend), Django `manage.py test` (unittest, not pytest); React + TypeScript + Ant Design + TanStack Query + react-leaflet; Vitest for frontend tests.

## Global Constraints

- MSSQL: no JSONField, no ArrayField, no `.distinct('field')`; `bulk_create`/`bulk_update` require `batch_size=500`; `CharField`/`TextField` with Turkmen/Russian text need `db_collation='Cyrillic_General_CI_AS'`; money/weight/coords use `DecimalField` (never `FloatField`); every `CharField` needs explicit `max_length`.
- Dependency direction: `transport` may import `core`/`export`; nothing imports `transport`. No reverse imports, no Django signals.
- Models split into a `models/` package MUST have `__init__.py` re-exports or migrations silently break.
- API names ≠ DB columns — serializers rename (per `api-contract` skill).
- Auth: httpOnly-cookie JWT; the browser never receives Traccar credentials.
- Runtime code is ORM-only (no raw SQL in the request path).
- Never commit without explicit instruction (project rule) — the "Commit" steps below are prepared commands; run them only when the user says to commit. Co-author tag: `Claude Opus 4.8 (1M context)`.
- Traccar creds come from `.env` (`TRACCAR_BASE_URL`, `TRACCAR_TOKEN`); tests never make live network calls (mock the client).
- Frontend tile URL from `VITE_MAP_TILE_URL` (default OSM).

---

### Task 1: Scaffold `transport` app + registry models

**Files:**
- Create: `backend/apps/transport/__init__.py`
- Create: `backend/apps/transport/apps.py`
- Create: `backend/apps/transport/models/__init__.py`
- Create: `backend/apps/transport/models/registry.py`
- Create: `backend/apps/transport/tests/__init__.py`
- Create: `backend/apps/transport/tests/test_models.py`
- Modify: `backend/config/settings.py` (add `'apps.transport'` to INSTALLED_APPS after `'apps.export'`)

**Interfaces:**
- Produces: models `Truck(plate, fleet_no, category, is_active)`, `Driver(name, phone, is_active)`, `TraccarDevice(traccar_id, imei, name, category, truck, status, last_seen)`, `DevicePosition(device, latitude, longitude, speed, course, address, ignition, fix_time, valid, updated_at)`. `TraccarDevice.CATEGORY_*` / `status` are plain strings.

- [ ] **Step 1: Create the app package files**

`backend/apps/transport/__init__.py`: empty.

`backend/apps/transport/apps.py`:
```python
from django.apps import AppConfig


class TransportConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.transport'
```

- [ ] **Step 2: Write the failing model test**

`backend/apps/transport/tests/__init__.py`: empty.

`backend/apps/transport/tests/test_models.py`:
```python
from django.db import IntegrityError
from django.test import TestCase

from apps.transport.models import Truck, Driver, TraccarDevice, DevicePosition


class RegistryModelTests(TestCase):
    def test_truck_plate_unique(self):
        Truck.objects.create(plate='2189AHF', fleet_no='TR038')
        with self.assertRaises(IntegrityError):
            Truck.objects.create(plate='2189AHF', fleet_no='TR999')

    def test_device_links_to_truck_and_has_position(self):
        truck = Truck.objects.create(plate='5161AHF', fleet_no='TR071')
        device = TraccarDevice.objects.create(
            traccar_id=21, imei='864275077746496',
            name='5161AHF TR071', truck=truck, status='online',
        )
        pos = DevicePosition.objects.create(
            device=device, latitude='37.544905', longitude='59.312225',
            speed='0', course='298', address='Artyk', ignition=True,
        )
        self.assertEqual(device.position, pos)
        self.assertEqual(truck.devices.first(), device)

    def test_driver_created(self):
        d = Driver.objects.create(name='Aman', phone='+99371093227')
        self.assertTrue(d.is_active)
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && python manage.py test apps.transport.tests.test_models -v2`
Expected: FAIL — `ModuleNotFoundError` / models don't exist.

- [ ] **Step 4: Write the models**

`backend/apps/transport/models/registry.py`:
```python
from django.db import models

from apps.core.db_utils import cyrillic_collation, schema_table


class Truck(models.Model):
    """Fleet vehicle registry — one row per physical truck/trailer."""

    CATEGORY_CHOICES = [
        ('truck', 'Truck'),
        ('trailer', 'Trailer'),
        ('unknown', 'Unknown'),
    ]

    plate = models.CharField(max_length=20, unique=True)
    fleet_no = models.CharField(max_length=10, unique=True, null=True, blank=True)
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES, default='unknown')
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = schema_table('transport', 'trucks')
        ordering = ['fleet_no', 'plate']

    def __str__(self) -> str:
        return f'{self.plate} ({self.fleet_no})' if self.fleet_no else self.plate


class Driver(models.Model):
    """Driver registry."""

    name = models.CharField(max_length=100, **cyrillic_collation())
    phone = models.CharField(max_length=30, null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = schema_table('transport', 'drivers')
        ordering = ['name']

    def __str__(self) -> str:
        return self.name


class TraccarDevice(models.Model):
    """Maps a Traccar GPS device to one of our trucks."""

    traccar_id = models.IntegerField(unique=True)
    imei = models.CharField(max_length=32, null=True, blank=True)
    name = models.CharField(max_length=100, **cyrillic_collation())
    category = models.CharField(max_length=20, null=True, blank=True)
    truck = models.ForeignKey(
        Truck, on_delete=models.PROTECT, null=True, blank=True, related_name='devices',
    )
    status = models.CharField(max_length=10, default='unknown')
    last_seen = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = schema_table('transport', 'traccar_devices')
        ordering = ['name']

    def __str__(self) -> str:
        return self.name


class DevicePosition(models.Model):
    """Latest known position for a device — one row per device, upserted."""

    device = models.OneToOneField(
        TraccarDevice, on_delete=models.CASCADE, related_name='position',
    )
    latitude = models.DecimalField(max_digits=9, decimal_places=6)
    longitude = models.DecimalField(max_digits=9, decimal_places=6)
    speed = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    course = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    address = models.CharField(max_length=300, null=True, blank=True, **cyrillic_collation())
    ignition = models.BooleanField(null=True, blank=True)
    fix_time = models.DateTimeField(null=True, blank=True)
    valid = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = schema_table('transport', 'device_positions')

    def __str__(self) -> str:
        return f'{self.device.name} @ {self.fix_time}'
```

`backend/apps/transport/models/__init__.py`:
```python
from .registry import Truck, Driver, TraccarDevice, DevicePosition

__all__ = ['Truck', 'Driver', 'TraccarDevice', 'DevicePosition']
```

> NOTE: `schema_table('transport', 'trucks')` returns the flat string `'transport_trucks'` (verified in `apps/core/db_utils.py` — it accepts any schema prefix, no registration). `cyrillic_collation()` returns the collation kwarg on MSSQL and `{}` under `USE_SQLITE=true`. Both are safe to use as written.

- [ ] **Step 5: Register the app**

In `backend/config/settings.py`, add `'apps.transport',` immediately after `'apps.contracts',` in INSTALLED_APPS.

- [ ] **Step 6: Make + apply migration, run tests**

Run:
```bash
cd backend
python manage.py makemigrations transport
python manage.py migrate transport
python manage.py test apps.transport.tests.test_models -v2
```
Expected: migration created + applied; tests PASS.

- [ ] **Step 7: Commit** (only on explicit instruction)

```bash
git add backend/apps/transport backend/config/settings.py
git commit -m "feat(transport): scaffold app + truck/driver/device registry models"
```

---

### Task 2: TraccarClient service (read-only API wrapper)

**Files:**
- Create: `backend/apps/transport/services/__init__.py`
- Create: `backend/apps/transport/services/traccar_client.py`
- Create: `backend/apps/transport/tests/test_traccar_client.py`
- Modify: `backend/config/settings.py` (add Traccar settings block)
- Modify: `backend/.env.example` (document new vars)

**Interfaces:**
- Produces: `TraccarClient()` with `.get_devices() -> list[dict]` and `.get_positions() -> list[dict]`; exception `TraccarUnavailable(Exception)`. Reads `settings.TRACCAR_BASE_URL` / `settings.TRACCAR_TOKEN`.

- [ ] **Step 1: Add settings + env docs**

In `backend/config/settings.py` (near the other `os.environ.get` blocks):
```python
# Traccar GPS integration (read-only)
TRACCAR_BASE_URL = os.environ.get('TRACCAR_BASE_URL', '')
TRACCAR_TOKEN = os.environ.get('TRACCAR_TOKEN', '')
TRACCAR_STALE_MINUTES = int(os.environ.get('TRACCAR_STALE_MINUTES', '15'))
```

Append to `backend/.env.example`:
```
# Traccar GPS integration (use a dedicated READ-ONLY Traccar account/token)
TRACCAR_BASE_URL=http://10.10.11.79:8082
TRACCAR_TOKEN=
TRACCAR_STALE_MINUTES=15
```

- [ ] **Step 2: Write the failing client test**

`backend/apps/transport/tests/test_traccar_client.py`:
```python
from unittest.mock import patch, MagicMock

from django.test import TestCase, override_settings

from apps.transport.services.traccar_client import TraccarClient, TraccarUnavailable


@override_settings(TRACCAR_BASE_URL='http://traccar.test', TRACCAR_TOKEN='tok')
class TraccarClientTests(TestCase):
    @patch('apps.transport.services.traccar_client.requests.get')
    def test_get_devices_returns_json(self, mock_get):
        mock_get.return_value = MagicMock(status_code=200, json=lambda: [{'id': 1}])
        mock_get.return_value.raise_for_status = lambda: None
        devices = TraccarClient().get_devices()
        self.assertEqual(devices, [{'id': 1}])
        called_url = mock_get.call_args[0][0]
        self.assertIn('/api/devices', called_url)

    @patch('apps.transport.services.traccar_client.requests.get')
    def test_network_error_raises_unavailable(self, mock_get):
        import requests
        mock_get.side_effect = requests.RequestException('boom')
        with self.assertRaises(TraccarUnavailable):
            TraccarClient().get_positions()
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && python manage.py test apps.transport.tests.test_traccar_client -v2`
Expected: FAIL — module/class missing.

- [ ] **Step 4: Implement the client**

`backend/apps/transport/services/__init__.py`: empty.

`backend/apps/transport/services/traccar_client.py`:
```python
import logging

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 15


class TraccarUnavailable(Exception):
    """Raised when Traccar cannot be reached or returns an error."""


class TraccarClient:
    """Read-only wrapper over the Traccar REST API.

    Never issues writes to Traccar. Auth via Bearer token from settings.
    """

    def __init__(self) -> None:
        self.base_url = settings.TRACCAR_BASE_URL.rstrip('/')
        self.token = settings.TRACCAR_TOKEN

    def _get(self, path: str) -> list[dict]:
        url = f'{self.base_url}{path}'
        headers = {'Accept': 'application/json'}
        if self.token:
            headers['Authorization'] = f'Bearer {self.token}'
        try:
            response = requests.get(url, headers=headers, timeout=TIMEOUT_SECONDS)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as exc:
            logger.error('Traccar request failed: %s', url, exc_info=True)
            raise TraccarUnavailable(str(exc)) from exc

    def get_devices(self) -> list[dict]:
        return self._get('/api/devices')

    def get_positions(self) -> list[dict]:
        return self._get('/api/positions')
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && python manage.py test apps.transport.tests.test_traccar_client -v2`
Expected: PASS.

- [ ] **Step 6: Commit** (only on explicit instruction)

```bash
git add backend/apps/transport/services backend/apps/transport/tests/test_traccar_client.py backend/config/settings.py backend/.env.example
git commit -m "feat(transport): read-only TraccarClient + settings/env"
```

---

### Task 3: Name parsing + position sync service

**Files:**
- Create: `backend/apps/transport/services/sync.py`
- Create: `backend/apps/transport/tests/test_sync.py`

**Interfaces:**
- Consumes: `TraccarClient`, models from Task 1.
- Produces: `parse_device_name(name: str) -> tuple[str, str | None]`; `sync_positions(client=None) -> int` (returns count of positions written); `sync_devices(client=None) -> int`.

- [ ] **Step 1: Write the failing tests**

`backend/apps/transport/tests/test_sync.py`:
```python
from unittest.mock import MagicMock

from django.test import TestCase

from apps.transport.models import Truck, TraccarDevice, DevicePosition
from apps.transport.services.sync import parse_device_name, sync_devices, sync_positions


class ParseNameTests(TestCase):
    def test_splits_plate_and_fleet(self):
        self.assertEqual(parse_device_name('2189AHF TR038'), ('2189AHF', 'TR038'))

    def test_no_fleet_token(self):
        self.assertEqual(parse_device_name('1780TAH'), ('1780TAH', None))

    def test_trims_whitespace(self):
        self.assertEqual(parse_device_name('  6247 TAH  '), ('6247 TAH', None))


class SyncTests(TestCase):
    def _client(self):
        client = MagicMock()
        client.get_devices.return_value = [
            {'id': 74, 'uniqueId': '864275077741745', 'name': '2189AHF TR038',
             'category': None, 'status': 'online', 'lastUpdate': '2026-07-12T00:27:24.226+00:00'},
        ]
        client.get_positions.return_value = [
            {'deviceId': 74, 'latitude': 37.9734, 'longitude': 58.4925, 'speed': 0,
             'course': 298, 'address': 'Artyk', 'valid': True,
             'fixTime': '2026-07-30T05:26:28.060+00:00',
             'attributes': {'ignition': True}},
        ]
        return client

    def test_sync_devices_creates_truck_and_device(self):
        count = sync_devices(client=self._client())
        self.assertEqual(count, 1)
        self.assertEqual(Truck.objects.get(plate='2189AHF').fleet_no, 'TR038')
        self.assertEqual(TraccarDevice.objects.get(traccar_id=74).status, 'online')

    def test_sync_positions_upserts_one_row_per_device(self):
        sync_devices(client=self._client())
        sync_positions(client=self._client())
        sync_positions(client=self._client())  # second poll must not duplicate
        self.assertEqual(DevicePosition.objects.count(), 1)
        pos = DevicePosition.objects.get()
        self.assertEqual(pos.ignition, True)
        self.assertEqual(str(pos.address), 'Artyk')

    def test_sync_positions_skips_position_without_device_row(self):
        # position references device 74 but no TraccarDevice exists yet
        written = sync_positions(client=self._client())
        self.assertEqual(written, 0)
        self.assertEqual(DevicePosition.objects.count(), 0)
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && python manage.py test apps.transport.tests.test_sync -v2`
Expected: FAIL — `sync` module missing.

- [ ] **Step 3: Implement the sync service**

`backend/apps/transport/services/sync.py`:
```python
import logging
import re

from django.utils.dateparse import parse_datetime

from apps.transport.models import Truck, TraccarDevice, DevicePosition
from apps.transport.services.traccar_client import TraccarClient

logger = logging.getLogger(__name__)

_FLEET_RE = re.compile(r'^(?P<plate>.+?)\s+(?P<fleet>TR\d+)$', re.IGNORECASE)


def parse_device_name(name: str) -> tuple[str, str | None]:
    """Split a Traccar device name '<PLATE> TR<NN>' into (plate, fleet_no).

    Returns (whole_name, None) when there is no trailing TR## token.
    """
    cleaned = (name or '').strip()
    match = _FLEET_RE.match(cleaned)
    if match:
        return match.group('plate').strip(), match.group('fleet').upper()
    return cleaned, None


def sync_devices(client: TraccarClient | None = None) -> int:
    """Upsert Truck + TraccarDevice rows from Traccar. Returns device count."""
    client = client or TraccarClient()
    devices = client.get_devices()
    for device in devices:
        plate, fleet_no = parse_device_name(device.get('name', ''))
        truck, _ = Truck.objects.update_or_create(
            plate=plate,
            defaults={'fleet_no': fleet_no, 'category': device.get('category') or 'unknown'},
        )
        TraccarDevice.objects.update_or_create(
            traccar_id=device['id'],
            defaults={
                'imei': device.get('uniqueId'),
                'name': device.get('name', ''),
                'category': device.get('category'),
                'truck': truck,
                'status': device.get('status', 'unknown'),
                'last_seen': parse_datetime(device['lastUpdate']) if device.get('lastUpdate') else None,
            },
        )
    return len(devices)


def sync_positions(client: TraccarClient | None = None) -> int:
    """Upsert the latest DevicePosition per known device. Returns rows written."""
    client = client or TraccarClient()
    positions = client.get_positions()
    device_ids = {p['deviceId'] for p in positions}
    known = {
        d.traccar_id: d
        for d in TraccarDevice.objects.filter(traccar_id__in=device_ids)
    }
    written = 0
    for pos in positions:
        device = known.get(pos['deviceId'])
        if device is None or pos.get('latitude') is None:
            continue
        attrs = pos.get('attributes') or {}
        DevicePosition.objects.update_or_create(
            device=device,
            defaults={
                'latitude': pos['latitude'],
                'longitude': pos['longitude'],
                'speed': pos.get('speed'),
                'course': pos.get('course'),
                'address': (pos.get('address') or '')[:300] or None,
                'ignition': attrs.get('ignition'),
                'fix_time': parse_datetime(pos['fixTime']) if pos.get('fixTime') else None,
                'valid': pos.get('valid', True),
            },
        )
        written += 1
    return written
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python manage.py test apps.transport.tests.test_sync -v2`
Expected: PASS.

- [ ] **Step 5: Commit** (only on explicit instruction)

```bash
git add backend/apps/transport/services/sync.py backend/apps/transport/tests/test_sync.py
git commit -m "feat(transport): device-name parsing + position sync service"
```

---

### Task 4: Management commands (seed + poll)

**Files:**
- Create: `backend/apps/transport/management/__init__.py`
- Create: `backend/apps/transport/management/commands/__init__.py`
- Create: `backend/apps/transport/management/commands/seed_traccar_devices.py`
- Create: `backend/apps/transport/management/commands/poll_traccar_positions.py`
- Create: `backend/apps/transport/tests/test_commands.py`

**Interfaces:**
- Consumes: `sync_devices`, `sync_positions`.
- Produces: commands `seed_traccar_devices`, `poll_traccar_positions`.

- [ ] **Step 1: Write the failing command test**

`backend/apps/transport/tests/test_commands.py`:
```python
from unittest.mock import patch
from io import StringIO

from django.core.management import call_command
from django.test import TestCase


class CommandTests(TestCase):
    @patch('apps.transport.management.commands.poll_traccar_positions.sync_positions', return_value=7)
    def test_poll_reports_count(self, mock_sync):
        out = StringIO()
        call_command('poll_traccar_positions', stdout=out)
        mock_sync.assert_called_once()
        self.assertIn('7', out.getvalue())

    @patch('apps.transport.management.commands.seed_traccar_devices.sync_devices', return_value=95)
    def test_seed_reports_count(self, mock_sync):
        out = StringIO()
        call_command('seed_traccar_devices', stdout=out)
        mock_sync.assert_called_once()
        self.assertIn('95', out.getvalue())

    @patch('apps.transport.management.commands.poll_traccar_positions.sync_positions')
    def test_poll_handles_traccar_unavailable(self, mock_sync):
        from apps.transport.services.traccar_client import TraccarUnavailable
        mock_sync.side_effect = TraccarUnavailable('down')
        out = StringIO()
        call_command('poll_traccar_positions', stdout=out)  # must not raise
        self.assertIn('unavailable', out.getvalue().lower())
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && python manage.py test apps.transport.tests.test_commands -v2`
Expected: FAIL — commands don't exist.

- [ ] **Step 3: Implement the commands**

`backend/apps/transport/management/__init__.py`: empty.
`backend/apps/transport/management/commands/__init__.py`: empty.

`backend/apps/transport/management/commands/seed_traccar_devices.py`:
```python
from django.core.management.base import BaseCommand

from apps.transport.services.sync import sync_devices
from apps.transport.services.traccar_client import TraccarUnavailable


class Command(BaseCommand):
    help = 'One-time (idempotent) seed of Truck + TraccarDevice rows from Traccar.'

    def handle(self, *args, **options):
        try:
            count = sync_devices()
        except TraccarUnavailable as exc:
            self.stdout.write(self.style.ERROR(f'Traccar unavailable: {exc}'))
            return
        self.stdout.write(self.style.SUCCESS(f'Synced {count} devices.'))
```

`backend/apps/transport/management/commands/poll_traccar_positions.py`:
```python
from django.core.management.base import BaseCommand

from apps.transport.services.sync import sync_positions
from apps.transport.services.traccar_client import TraccarUnavailable


class Command(BaseCommand):
    help = (
        'Poll Traccar and upsert the latest position per device.\n\n'
        'Schedule every 1 min (last-known positions survive a missed poll):\n'
        '  Linux cron:   * * * * * cd /app/backend && python manage.py poll_traccar_positions\n'
        '  Windows Task Scheduler: run `python manage.py poll_traccar_positions` every 1 minute.'
    )

    def handle(self, *args, **options):
        try:
            count = sync_positions()
        except TraccarUnavailable as exc:
            # Non-fatal: existing rows remain; the scheduler retries next minute.
            self.stdout.write(self.style.WARNING(f'Traccar unavailable, kept last-known: {exc}'))
            return
        self.stdout.write(self.style.SUCCESS(f'Updated {count} positions.'))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python manage.py test apps.transport.tests.test_commands -v2`
Expected: PASS.

- [ ] **Step 5: Commit** (only on explicit instruction)

```bash
git add backend/apps/transport/management backend/apps/transport/tests/test_commands.py
git commit -m "feat(transport): seed + poll management commands"
```

---

### Task 5: Live-positions API endpoint

**Files:**
- Create: `backend/apps/transport/serializers.py`
- Create: `backend/apps/transport/views.py`
- Create: `backend/apps/transport/urls.py`
- Create: `backend/apps/transport/tests/test_api.py`
- Modify: `backend/config/urls.py` (include transport urls)

**Interfaces:**
- Consumes: `DevicePosition`, `TraccarDevice`, `Truck`, `settings.TRACCAR_STALE_MINUTES`.
- Produces: `GET /api/v1/transport/live-positions/` → list of `{device_id, plate, fleet_no, status, lat, lon, speed, course, address, fix_time, is_online, is_stale}`.

- [ ] **Step 1: Write the failing API test**

`backend/apps/transport/tests/test_api.py`:
```python
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.transport.models import Truck, TraccarDevice, DevicePosition

User = get_user_model()


@override_settings(TRACCAR_STALE_MINUTES=15)
class LivePositionsApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username='op', password='x')
        self.client.force_authenticate(self.user)
        truck = Truck.objects.create(plate='2189AHF', fleet_no='TR038')
        self.device = TraccarDevice.objects.create(
            traccar_id=74, name='2189AHF TR038', truck=truck, status='online',
        )

    def _make_position(self, minutes_old):
        DevicePosition.objects.create(
            device=self.device, latitude='37.97', longitude='58.49',
            speed='0', course='298', address='Artyk', ignition=True,
            fix_time=timezone.now() - timedelta(minutes=minutes_old),
        )

    def test_requires_auth(self):
        self.client.force_authenticate(None)
        resp = self.client.get('/api/v1/transport/live-positions/')
        self.assertEqual(resp.status_code, 401)

    def test_returns_renamed_fields(self):
        self._make_position(minutes_old=1)
        resp = self.client.get('/api/v1/transport/live-positions/')
        self.assertEqual(resp.status_code, 200)
        row = resp.json()[0]
        self.assertEqual(row['plate'], '2189AHF')
        self.assertEqual(row['fleet_no'], 'TR038')
        self.assertEqual(row['lat'], 37.97)
        self.assertEqual(row['lon'], 58.49)
        self.assertTrue(row['is_online'])
        self.assertFalse(row['is_stale'])

    def test_stale_flag_by_fix_time_age(self):
        self._make_position(minutes_old=30)
        row = self.client.get('/api/v1/transport/live-positions/').json()[0]
        self.assertTrue(row['is_stale'])

    def test_device_without_position_is_omitted(self):
        # no position created
        resp = self.client.get('/api/v1/transport/live-positions/')
        self.assertEqual(resp.json(), [])
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && python manage.py test apps.transport.tests.test_api -v2`
Expected: FAIL — url/view missing (404/ImportError).

- [ ] **Step 3: Implement serializer, view, urls**

`backend/apps/transport/serializers.py`:
```python
from django.conf import settings
from django.utils import timezone
from rest_framework import serializers

from apps.transport.models import DevicePosition


class LivePositionSerializer(serializers.ModelSerializer):
    """DB columns -> API field names (per api-contract)."""

    device_id = serializers.IntegerField(source='device.traccar_id')
    plate = serializers.CharField(source='device.truck.plate', default=None)
    fleet_no = serializers.CharField(source='device.truck.fleet_no', default=None)
    status = serializers.CharField(source='device.status')
    lat = serializers.FloatField(source='latitude')
    lon = serializers.FloatField(source='longitude')
    is_online = serializers.SerializerMethodField()
    is_stale = serializers.SerializerMethodField()

    class Meta:
        model = DevicePosition
        fields = [
            'device_id', 'plate', 'fleet_no', 'status',
            'lat', 'lon', 'speed', 'course', 'address',
            'fix_time', 'is_online', 'is_stale',
        ]

    def get_is_online(self, obj: DevicePosition) -> bool:
        return obj.device.status == 'online'

    def get_is_stale(self, obj: DevicePosition) -> bool:
        if not obj.fix_time:
            return True
        age = timezone.now() - obj.fix_time
        return age.total_seconds() > settings.TRACCAR_STALE_MINUTES * 60
```

`backend/apps/transport/views.py`:
```python
from rest_framework import mixins, viewsets
from rest_framework.permissions import IsAuthenticated

from apps.transport.models import DevicePosition
from apps.transport.serializers import LivePositionSerializer


class LivePositionViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Latest position per device, served from our DB (never Traccar live)."""

    serializer_class = LivePositionSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None  # small, bounded set (one row per device)

    def get_queryset(self):
        return (
            DevicePosition.objects
            .select_related('device', 'device__truck')
            .order_by('device__name')
        )
```

`backend/apps/transport/urls.py`:
```python
from rest_framework.routers import DefaultRouter

from apps.transport.views import LivePositionViewSet

router = DefaultRouter()
router.register('live-positions', LivePositionViewSet, basename='live-positions')

urlpatterns = router.urls
```

In `backend/config/urls.py`, add after the `contracts` include:
```python
    path('api/v1/transport/', include('apps.transport.urls')),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python manage.py test apps.transport.tests.test_api -v2`
Expected: PASS.

> NOTE: `LivePositionViewSet` sets `pagination_class = None` so the response is a bare list (matching the test's `resp.json()[0]`). If the project's `StandardPagination` is expected everywhere, confirm with the `api-contract` skill; the Fleet Map needs all pins at once, so no pagination is correct here.

- [ ] **Step 5: Run the whole app suite**

Run: `cd backend && python manage.py test apps.transport -v2`
Expected: all PASS.

- [ ] **Step 6: Commit** (only on explicit instruction)

```bash
git add backend/apps/transport/serializers.py backend/apps/transport/views.py backend/apps/transport/urls.py backend/apps/transport/tests/test_api.py backend/config/urls.py
git commit -m "feat(transport): live-positions read-only API endpoint"
```

---

### Task 6: Frontend data hook + types

**Files:**
- Create: `frontend/src/hooks/useLivePositions.ts`
- Create: `frontend/src/hooks/useLivePositions.test.ts`

**Interfaces:**
- Consumes: `GET /api/v1/transport/live-positions/`.
- Produces: `interface ILivePosition {...}`; `useLivePositions()` TanStack Query hook with 30s `refetchInterval` returning `ILivePosition[]`.

- [ ] **Step 1: Write the failing hook test**

`frontend/src/hooks/useLivePositions.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useLivePositions } from './useLivePositions';
import api from '@/services/api';

vi.mock('@/services/api');

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useLivePositions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the position rows from the API', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [{ device_id: 74, plate: '2189AHF', fleet_no: 'TR038', status: 'online',
               lat: 37.97, lon: 58.49, speed: 0, course: 298, address: 'Artyk',
               fix_time: '2026-07-30T05:26:28Z', is_online: true, is_stale: false }],
    });
    const { result } = renderHook(() => useLivePositions(), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data?.[0].plate).toBe('2189AHF');
    expect(api.get).toHaveBeenCalledWith('/transport/live-positions/');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/useLivePositions.test.ts`
Expected: FAIL — hook missing.

- [ ] **Step 3: Implement the hook**

`frontend/src/hooks/useLivePositions.ts`:
```typescript
import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';

export interface ILivePosition {
  device_id: number;
  plate: string | null;
  fleet_no: string | null;
  status: string;
  lat: number;
  lon: number;
  speed: number | null;
  course: number | null;
  address: string | null;
  fix_time: string | null;
  is_online: boolean;
  is_stale: boolean;
}

export function useLivePositions() {
  return useQuery<ILivePosition[]>({
    queryKey: ['transport', 'live-positions'],
    queryFn: async () => {
      const { data } = await api.get<ILivePosition[]>('/transport/live-positions/');
      return data;
    },
    refetchInterval: 30_000,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/hooks/useLivePositions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (only on explicit instruction)

```bash
git add frontend/src/hooks/useLivePositions.ts frontend/src/hooks/useLivePositions.test.ts
git commit -m "feat(transport): useLivePositions query hook + types"
```

---

### Task 7: Fleet Map page (react-leaflet) + route + nav

**Files:**
- Modify: `frontend/package.json` (add `leaflet`, `react-leaflet`, `@types/leaflet`)
- Create: `frontend/src/pages/transport/FleetMap.tsx`
- Modify: `frontend/src/App.tsx` (lazy import + route)
- Modify: `frontend/src/components/AppLayout.tsx` (nav entry)
- Modify: `frontend/.env.example` (add `VITE_MAP_TILE_URL`) — create if absent

**Interfaces:**
- Consumes: `useLivePositions`, `ILivePosition`.
- Produces: route `/transport/map` rendering the `FleetMap` page.

- [ ] **Step 1: Install map deps**

Run: `cd frontend && npm install leaflet react-leaflet && npm install -D @types/leaflet`

- [ ] **Step 2: Add tile-url env default**

Append to `frontend/.env.example` (create if missing):
```
# Fleet map tiles — public OSM by default; point to a self-hosted server if the deployment is airgapped
VITE_MAP_TILE_URL=https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png
```

- [ ] **Step 3: Build the Fleet Map page**

`frontend/src/pages/transport/FleetMap.tsx`:
```tsx
import { useMemo, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import { Input, List, Badge, Spin, Alert, Typography } from 'antd';
import 'leaflet/dist/leaflet.css';
import { useLivePositions, type ILivePosition } from '@/hooks/useLivePositions';

const TILE_URL =
  import.meta.env.VITE_MAP_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
// Turkmenistan-centred default view (Ashgabat area), matching the Traccar server.
const DEFAULT_CENTER: [number, number] = [37.95, 58.39];
const DEFAULT_ZOOM = 5;

function pinColor(p: ILivePosition): string {
  if (p.is_stale) return '#9ca3af'; // grey
  if (p.is_online) return '#16a34a'; // green
  return '#f59e0b'; // amber (known but offline)
}

export default function FleetMap() {
  const { data, isLoading, isError } = useLivePositions();
  const [search, setSearch] = useState('');

  const rows = useMemo(() => {
    const items = data ?? [];
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(
      (p) =>
        (p.plate ?? '').toLowerCase().includes(q) ||
        (p.fleet_no ?? '').toLowerCase().includes(q) ||
        (p.address ?? '').toLowerCase().includes(q),
    );
  }, [data, search]);

  if (isLoading) return <Spin style={{ margin: 48 }} />;
  if (isError) return <Alert type="error" message="Could not load truck positions" />;

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 120px)', gap: 12 }}>
      <div style={{ width: 320, overflowY: 'auto' }}>
        <Input.Search
          placeholder="Search plate / fleet / place"
          allowClear
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginBottom: 8 }}
        />
        <List
          size="small"
          dataSource={rows}
          renderItem={(p) => (
            <List.Item>
              <div>
                <Badge color={pinColor(p)} />{' '}
                <Typography.Text strong>{p.plate ?? p.fleet_no ?? p.device_id}</Typography.Text>{' '}
                <Typography.Text type="secondary">{p.fleet_no}</Typography.Text>
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {p.address ?? '—'}
                  </Typography.Text>
                </div>
              </div>
            </List.Item>
          )}
        />
      </div>
      <div style={{ flex: 1 }}>
        <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} style={{ height: '100%' }}>
          <TileLayer url={TILE_URL} attribution="&copy; OpenStreetMap" />
          {rows.map((p) => (
            <CircleMarker
              key={p.device_id}
              center={[p.lat, p.lon]}
              radius={7}
              pathOptions={{ color: pinColor(p), fillColor: pinColor(p), fillOpacity: 0.9 }}
            >
              <Popup>
                <strong>{p.plate}</strong> {p.fleet_no}
                <br />
                {p.address ?? '—'}
                <br />
                {p.speed ?? 0} km/h · {p.is_online ? 'online' : 'offline'}
                {p.is_stale ? ' · stale' : ''}
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}
```

> NOTE: `CircleMarker` is used instead of the default Leaflet pin icon on purpose — it avoids the well-known broken-marker-icon asset problem under Vite (no icon imports needed) and lets us colour by status.

- [ ] **Step 4: Register the route**

In `frontend/src/App.tsx`, add a lazy import next to the other page imports:
```tsx
const FleetMap = lazy(() => import('@/pages/transport/FleetMap'));
```
And add a protected route alongside the existing routes (match the surrounding `<Route ... element={<ProtectedRoute>...}` pattern already in the file):
```tsx
<Route path="/transport/map" element={<ProtectedRoute><FleetMap /></ProtectedRoute>} />
```

- [ ] **Step 5: Add the nav entry**

In `frontend/src/components/AppLayout.tsx`, add a menu item pointing to `/transport/map` labelled "Fleet Map" (Turkmen/Russian labels per the file's existing i18n pattern; reuse an existing icon such as a car/environment icon). Follow the exact shape of the neighbouring menu items in that file.

- [ ] **Step 6: Type-check + tests**

Run:
```bash
cd frontend
npx tsc --noEmit --ignoreDeprecations 5.0
npx vitest run src/hooks/useLivePositions.test.ts
```
Expected: no type errors; hook test PASS.

- [ ] **Step 7: Manual smoke test**

With `TRACCAR_BASE_URL`/`TRACCAR_TOKEN` set in `backend/.env`:
```bash
cd backend && python manage.py seed_traccar_devices && python manage.py poll_traccar_positions
```
Then run the app and open `/transport/map` — expect green/amber pins across Turkmenistan and a searchable sidebar.

- [ ] **Step 8: Commit** (only on explicit instruction)

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/pages/transport/FleetMap.tsx frontend/src/App.tsx frontend/src/components/AppLayout.tsx frontend/.env.example
git commit -m "feat(transport): Fleet Map page with live truck pins"
```

---

### Task 8: Docs + changelog + build log

**Files:**
- Create: `docs/obsidian/` page for the Fleet Map feature (follow `docs/obsidian/00-index.md` structure) + link it in the index
- Modify: `CHANGELOG.md` (Added entry)
- Modify: `BUILD_TEST_LOG.md` (NEEDS TEST entry, newest on top)

- [ ] **Step 1: Write the Obsidian doc**

Create a feature page under `docs/obsidian/` describing: the `transport` app, the four models, the poll/seed commands + their schedule, the `live-positions` endpoint (with the response shape), and the Fleet Map page. Add a link to it in `docs/obsidian/00-index.md` under the appropriate section.

- [ ] **Step 2: Update CHANGELOG.md**

Add under `[Unreleased] → Added`:
```
- Fleet Map (transport): live truck positions from Traccar — standalone truck/driver/device registry, 1-min poller, `/api/v1/transport/live-positions/`, react-leaflet map page.
```

- [ ] **Step 3: Update BUILD_TEST_LOG.md** (newest on top)

```
- [ ] 2026-07-30 — Fleet Map: Traccar registry + poller + live-positions API + Leaflet map page — NEEDS TEST
```

- [ ] **Step 4: Commit** (only on explicit instruction)

```bash
git add docs/obsidian CHANGELOG.md BUILD_TEST_LOG.md
git commit -m "docs(transport): Fleet Map feature docs + changelog + build log"
```

---

## Self-Review

**Spec coverage:**
- Truck/Driver/TraccarDevice/DevicePosition models → Task 1 ✓
- TraccarClient (read-only, token from env) → Task 2 ✓
- name parsing + sync (latest-per-device upsert, Traccar-down safety) → Task 3 ✓
- poll (1-min schedule) + idempotent seed commands → Task 4 ✓
- live-positions API (renamed fields, is_stale, only positioned devices, auth) → Task 5 ✓
- frontend hook (30s refetch) → Task 6 ✓
- Fleet Map page (Leaflet, OSM tile-url env, status/stale pins, searchable sidebar) + route + nav → Task 7 ✓
- security (dedicated read-only token, `.env`, browser never sees creds) → Task 2 (settings/env) + endpoint reads DB only (Task 5) ✓
- docs/changelog/build-log → Task 8 ✓
- ECharts fallback → documented in spec as build-only-if-tiles-blocked; not a task here (conditional, out of the default path). If OSM is confirmed blocked, add a follow-up task swapping `FleetMap` internals for an ECharts geo-scatter behind the same `useLivePositions` hook.

**Placeholder scan:** No TBD/TODO in code steps. Task 7 Step 5 (nav entry) and Task 8 Step 1 (Obsidian doc) describe following existing file patterns rather than pasting exact code, because both depend on per-file i18n/menu conventions that must be read at implementation time — acceptable, but the implementer must open the referenced files.

**Type consistency:** `ILivePosition` fields (Task 6) match the serializer output (Task 5). `sync_positions`/`sync_devices`/`parse_device_name` signatures consistent between Task 3 (definition) and Task 4 (callers). `TraccarUnavailable` raised in Task 2, caught in Tasks 3/4. `DevicePosition.device` OneToOne `related_name='position'` (Task 1) matches serializer `select_related('device')` + `obj.device` usage (Task 5).

**Open confirmations for the implementer:**
1. Traccar Bearer-token auth vs session cookie for v6.14.4 — the client uses `Authorization: Bearer`; if the dedicated read-only account only supports session auth, extend `TraccarClient` with a `/api/session` login step (POST `email`+`password`, reuse the returned cookie). This was verified to work with session auth during design.
