# TIR Fleet Integration — Sub-project 2 (TruckHead + Trailer Endpoints) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** REST endpoints for the `TruckHead` + `Trailer` fleet registry — searchable lists for the shipment dropdowns, plus create/update/deactivate for inline-add and the admin page.

**Architecture:** Two DRF `ModelViewSet`s mirroring the existing `TransportDeviceViewSet` pattern. List is `IsAuthenticated`; create/update/deactivate are gated to `CanEditShipment`. Creating a `TruckHead` plate-matches a Traccar device (reusing the resolver's `_pick_device`) so a new truck gets GPS automatically.

**Tech Stack:** Django + DRF + MSSQL; Django `manage.py test` (unittest, MSSQL).

**Scope:** Sub-project 2 of 4 (backend endpoints only). Builds on sub-project 1 (`TruckHead`/`Trailer` models, `import_tir_fleet`, resolver). Sub-projects 3–4 (shipment selectors, admin page UI) follow.

## Global Constraints

- **WORK IN THE WORKTREE** `D:/projects/yigit_platform-transport-fleet-map` (branch `feat/transport-fleet-map`); the main repo dir is on another session's branch. Backend commands from that worktree's `backend/`.
- MSSQL: no JSONField; `bulk_*` need batch_size=500 (n/a here); explicit field types.
- Dependency direction: `transport` may import `core`/`export`; nothing imports `transport`. No signals.
- API names per `api-contract` skill. List endpoints are bare lists (no pagination) — small bounded sets.
- Tests run on **MSSQL** — do NOT pass `USE_SQLITE`. Run `python manage.py test apps.transport … -v2` (`--keepdb`).
- Commit only on `feat/transport-fleet-map` (worktree). Co-author: `Claude Sonnet 5` (implementer subagents).
- Existing (on branch): `TruckHead(id, plate_number unique, owner_type, owner_name, status, capacity, traccar_device FK, is_active)`, `Trailer(id, plate_number unique, owner_type, status, is_active)`, `CanEditShipment` permission (roles `{admin,export_manager,director,warehouse_chief,loading_dept_head,loading_dept_head_deputy}` + superuser), `_pick_device(truck)` and `normalize_plate(str)` in `services/matching.py`, `Truck` (Traccar-derived, plate). Pattern to mirror: `TransportDeviceViewSet` (`views.py:72`), `TransportDeviceSerializer` (`serializers.py:40`).

---

### Task 1: `device_for_plate` helper + TruckHead endpoints

**Files:**
- Modify: `backend/apps/transport/services/matching.py` (add `device_for_plate`)
- Modify: `backend/apps/transport/serializers.py` (add `TruckHeadSerializer`)
- Modify: `backend/apps/transport/views.py` (add `TruckHeadViewSet`)
- Modify: `backend/apps/transport/urls.py` (register `truck-heads`)
- Create: `backend/apps/transport/tests/test_fleet_api.py`

**Interfaces:**
- Consumes: `TruckHead`, `Truck`, `_pick_device`, `normalize_plate`, `CanEditShipment`.
- Produces: `device_for_plate(plate: str) -> TraccarDevice | None`; `GET/POST /transport/truck-heads/`, `PATCH /transport/truck-heads/<id>/`.

- [ ] **Step 1: Write the failing API tests**

`backend/apps/transport/tests/test_fleet_api.py`:
```python
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.transport.models import TruckHead, Trailer, TraccarDevice, Truck, DevicePosition

User = get_user_model()


class TruckHeadApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.editor = User.objects.create_user(username='mgr', password='x', role='export_manager')
        self.viewer = User.objects.create_user(username='op', password='x', role='sales_rep')
        truck = Truck.objects.create(plate='4378AHF', fleet_no='TR050')
        self.device = TraccarDevice.objects.create(traccar_id=67, name='4378AHF TR050', truck=truck, status='online')
        DevicePosition.objects.create(device=self.device, latitude='37.9', longitude='58.4')
        TruckHead.objects.create(id=13, plate_number='3269AHF', owner_type='company', traccar_device=self.device)
        TruckHead.objects.create(id=14, plate_number='9999XYZ', owner_type='company', is_active=False)

    def test_list_requires_auth(self):
        self.assertEqual(self.client.get('/api/v1/transport/truck-heads/').status_code, 401)

    def test_list_returns_active_with_has_gps_and_search(self):
        self.client.force_authenticate(self.viewer)
        rows = self.client.get('/api/v1/transport/truck-heads/').json()
        plates = {r['plate_number'] for r in rows}
        self.assertIn('3269AHF', plates)
        self.assertNotIn('9999XYZ', plates)          # inactive omitted
        row = next(r for r in rows if r['plate_number'] == '3269AHF')
        self.assertTrue(row['has_gps'])
        # search
        rows2 = self.client.get('/api/v1/transport/truck-heads/?search=3269').json()
        self.assertEqual([r['plate_number'] for r in rows2], ['3269AHF'])

    def test_create_requires_editor_role(self):
        self.client.force_authenticate(self.viewer)
        r = self.client.post('/api/v1/transport/truck-heads/', {'plate_number': '5555AHF'}, format='json')
        self.assertEqual(r.status_code, 403)

    def test_create_matches_device_by_plate_and_avoids_id_collision(self):
        self.client.force_authenticate(self.editor)
        r = self.client.post('/api/v1/transport/truck-heads/', {'plate_number': '4378AHF'}, format='json')
        self.assertEqual(r.status_code, 201)
        th = TruckHead.objects.get(plate_number='4378AHF')
        self.assertEqual(th.traccar_device, self.device)   # matched by plate
        self.assertGreater(th.id, 14)                       # no collision with imported ids

    def test_deactivate_via_patch(self):
        self.client.force_authenticate(self.editor)
        r = self.client.patch('/api/v1/transport/truck-heads/13/', {'is_active': False}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertFalse(TruckHead.objects.get(id=13).is_active)
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && python manage.py test apps.transport.tests.test_fleet_api -v2`
Expected: FAIL — route/view missing.

- [ ] **Step 3: Add the `device_for_plate` helper**

Append to `backend/apps/transport/services/matching.py`:
```python
def device_for_plate(plate: str) -> "TraccarDevice | None":
    """Best Traccar device for a plate (same choice the resolver would make).

    Looks up the active Truck by normalized plate, then _pick_device().
    """
    plate_norm = normalize_plate(plate)
    if not plate_norm:
        return None
    norm_to_truck = {
        normalize_plate(p): tid
        for tid, p in Truck.objects.filter(is_active=True).values_list('id', 'plate')
    }
    truck_id = norm_to_truck.get(plate_norm)
    if truck_id is None:
        return None
    return _pick_device(Truck.objects.get(id=truck_id))
```
(`Truck`, `normalize_plate`, `_pick_device` already in this module.)

- [ ] **Step 4: Add the serializer**

Append to `backend/apps/transport/serializers.py`:
```python
from apps.transport.models import TruckHead
from apps.transport.services.matching import device_for_plate


class TruckHeadSerializer(serializers.ModelSerializer):
    has_gps = serializers.SerializerMethodField()

    class Meta:
        model = TruckHead
        fields = ['id', 'plate_number', 'owner_type', 'owner_name', 'status',
                  'capacity', 'is_active', 'has_gps']
        read_only_fields = ['id', 'has_gps']

    def get_has_gps(self, obj) -> bool:
        return obj.traccar_device_id is not None

    def create(self, validated_data):
        # plate-match a Traccar device on create (like the import)
        validated_data['traccar_device'] = device_for_plate(validated_data['plate_number'])
        return super().create(validated_data)
```

- [ ] **Step 5: Add the viewset + url**

Append to `backend/apps/transport/views.py`:
```python
from rest_framework import filters
from apps.transport.models import TruckHead
from apps.transport.permissions import CanEditShipment
from apps.transport.serializers import TruckHeadSerializer


class TruckHeadViewSet(mixins.ListModelMixin, mixins.CreateModelMixin,
                       mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """Fleet tractors — list (active) for pickers, create (inline/admin), update/deactivate."""

    serializer_class = TruckHeadSerializer
    pagination_class = None
    filter_backends = [filters.SearchFilter]
    search_fields = ['plate_number', 'owner_name']

    def get_permissions(self):
        if self.action in ('create', 'update', 'partial_update'):
            return [IsAuthenticated(), CanEditShipment()]
        return [IsAuthenticated()]

    def get_queryset(self):
        qs = TruckHead.objects.all().order_by('plate_number')
        if self.action == 'list':
            qs = qs.filter(is_active=True)   # pickers show active only
        return qs
```
In `backend/apps/transport/urls.py`, add to the router:
```python
from apps.transport.views import TruckHeadViewSet
router.register('truck-heads', TruckHeadViewSet, basename='truck-heads')
```

> NOTE on update showing inactive: `get_queryset` filters `is_active=True` only for `list`; `update`/`partial_update`/`retrieve` see all rows, so an admin can re-activate or edit a deactivated truck via PATCH `/<id>/`.

- [ ] **Step 6: Run tests**

Run: `cd backend && python manage.py test apps.transport.tests.test_fleet_api -v2`
Expected: PASS (auth, has_gps, search, role-gate 403, device-match-on-create + no id collision, deactivate).

- [ ] **Step 7: Commit**

```bash
git add backend/apps/transport/services/matching.py backend/apps/transport/serializers.py backend/apps/transport/views.py backend/apps/transport/urls.py backend/apps/transport/tests/test_fleet_api.py
git commit -m "feat(transport): TruckHead list/create/update endpoints (device-match, search, role-gated)"
```

---

### Task 2: Trailer endpoints

**Files:**
- Modify: `backend/apps/transport/serializers.py` (add `TrailerSerializer`)
- Modify: `backend/apps/transport/views.py` (add `TrailerViewSet`)
- Modify: `backend/apps/transport/urls.py` (register `trailers`)
- Modify: `backend/apps/transport/tests/test_fleet_api.py` (add Trailer tests)

**Interfaces:**
- Consumes: `Trailer`, `CanEditShipment`.
- Produces: `GET/POST /transport/trailers/`, `PATCH /transport/trailers/<id>/`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/apps/transport/tests/test_fleet_api.py`:
```python
class TrailerApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.editor = User.objects.create_user(username='mgr2', password='x', role='director')
        self.viewer = User.objects.create_user(username='op2', password='x', role='sales_rep')
        Trailer.objects.create(id=1, plate_number='2602TAH', owner_type='company')
        Trailer.objects.create(id=2, plate_number='9000ZZZ', owner_type='company', is_active=False)

    def test_list_active_only_and_search(self):
        self.client.force_authenticate(self.viewer)
        rows = self.client.get('/api/v1/transport/trailers/').json()
        plates = {r['plate_number'] for r in rows}
        self.assertIn('2602TAH', plates)
        self.assertNotIn('9000ZZZ', plates)
        rows2 = self.client.get('/api/v1/transport/trailers/?search=2602').json()
        self.assertEqual([r['plate_number'] for r in rows2], ['2602TAH'])

    def test_create_requires_editor_role(self):
        self.client.force_authenticate(self.viewer)
        self.assertEqual(
            self.client.post('/api/v1/transport/trailers/', {'plate_number': '3TAH'}, format='json').status_code,
            403,
        )

    def test_editor_creates_and_deactivates(self):
        self.client.force_authenticate(self.editor)
        r = self.client.post('/api/v1/transport/trailers/', {'plate_number': '5TAH'}, format='json')
        self.assertEqual(r.status_code, 201)
        tid = r.json()['id']
        d = self.client.patch(f'/api/v1/transport/trailers/{tid}/', {'is_active': False}, format='json')
        self.assertEqual(d.status_code, 200)
        self.assertFalse(Trailer.objects.get(id=tid).is_active)
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && python manage.py test apps.transport.tests.test_fleet_api.TrailerApiTests -v2`
Expected: FAIL — route/view missing.

- [ ] **Step 3: Serializer**

Append to `backend/apps/transport/serializers.py`:
```python
from apps.transport.models import Trailer


class TrailerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Trailer
        fields = ['id', 'plate_number', 'owner_type', 'status', 'is_active']
        read_only_fields = ['id']
```

- [ ] **Step 4: Viewset + url**

Append to `backend/apps/transport/views.py`:
```python
from apps.transport.models import Trailer
from apps.transport.serializers import TrailerSerializer


class TrailerViewSet(mixins.ListModelMixin, mixins.CreateModelMixin,
                     mixins.UpdateModelMixin, viewsets.GenericViewSet):
    serializer_class = TrailerSerializer
    pagination_class = None
    filter_backends = [filters.SearchFilter]
    search_fields = ['plate_number']

    def get_permissions(self):
        if self.action in ('create', 'update', 'partial_update'):
            return [IsAuthenticated(), CanEditShipment()]
        return [IsAuthenticated()]

    def get_queryset(self):
        qs = Trailer.objects.all().order_by('plate_number')
        if self.action == 'list':
            qs = qs.filter(is_active=True)
        return qs
```
In `urls.py`:
```python
from apps.transport.views import TrailerViewSet
router.register('trailers', TrailerViewSet, basename='trailers')
```

- [ ] **Step 5: Run tests + full app suite**

Run:
```bash
cd backend
python manage.py test apps.transport.tests.test_fleet_api -v2
python manage.py test apps.transport -v2
```
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/transport/serializers.py backend/apps/transport/views.py backend/apps/transport/urls.py backend/apps/transport/tests/test_fleet_api.py
git commit -m "feat(transport): Trailer list/create/update endpoints"
```

---

## Self-Review

**Spec coverage (sub-project 2 slice, per parent spec §API):**
- `GET truck-heads/?search=` with `has_gps`, active-only → Task 1 ✓
- `POST truck-heads/` device-match on create, role-gated → Task 1 ✓
- `PATCH truck-heads/<id>/` deactivate/edit (sees inactive) → Task 1 ✓
- `GET/POST/PATCH trailers/` → Task 2 ✓
- Permission gate = `CanEditShipment` on writes, `IsAuthenticated` on list → both tasks ✓
- Device-match reuses `_pick_device` (consistent with import + resolver) → Task 1 `device_for_plate` ✓

**Placeholder scan:** No TBD/TODO. All code steps concrete.

**Type consistency:** `device_for_plate(plate) -> TraccarDevice|None` defined in Task 1, used by `TruckHeadSerializer.create`. `TruckHeadSerializer`/`TrailerSerializer` fields match the models. ViewSets mirror the existing `TransportDeviceViewSet` (mixins, `pagination_class=None`, `IsAuthenticated`). `search_fields`/`SearchFilter` is DRF-standard.

**Open confirmations for the implementer:**
1. `User.objects.create_user(..., role=…)` — confirm the real User role field/choices (sub-project-1 tests already used `role='export_manager'`/`'sales_rep'` successfully — reuse that).
2. DRF `SearchFilter` is enabled project-wide or import `rest_framework.filters` locally (the plan imports it in views.py) — confirm no global `DEFAULT_FILTER_BACKENDS` conflict.
