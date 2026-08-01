# Shipment ↔ Truck GPS Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the shipment's truck live on the ShipmentDetail page (mini map + details), resolving the Traccar device by auto-matching the plate with a manual override fallback.

**Architecture:** A `transport.ShipmentDeviceLink` table stores only manual overrides; a resolver (`transport/services/matching.py`) picks the device (manual link > plate auto-match > none). Three transport endpoints serve the position, the override write, and a device list. A React card on ShipmentDetail renders a mini Leaflet map + details + override picker, auto-refreshing every 30s.

**Tech Stack:** Django + DRF + MSSQL; Django `manage.py test` (unittest, MSSQL); React + TypeScript + Ant Design + react-leaflet (v4) + TanStack Query; Vitest.

## Global Constraints

- MSSQL: no JSONField/ArrayField/`.distinct(field)`; `bulk_*` need `batch_size=500`; Cyrillic text needs `db_collation='Cyrillic_General_CI_AS'`; explicit `max_length`; coords use `DecimalField`.
- Dependency direction: `transport` MAY import `export`/`core`; `export` may NOT import `transport`. The link therefore lives in `transport`. No Django signals — the resolver is called explicitly.
- `models/` package needs `__init__.py` re-exports.
- API names ≠ DB columns (serializer renames, per `api-contract` skill).
- Auth: httpOnly-cookie JWT; browser never receives Traccar creds. Endpoints read our DB only, never Traccar in the request path.
- Tests run on **MSSQL** — do NOT pass `USE_SQLITE`. Run `python manage.py test apps.transport ...` from `backend/` (`--keepdb` if a stale test DB blocks). Frontend type-check: `npx tsc --noEmit --ignoreDeprecations 5.0`.
- Commit only on the feature branch `feat/transport-fleet-map`. Co-author tag = the actual model running the task (implementer subagents: `Claude Sonnet 5`).
- Override permission = roles `{warehouse_chief, export_manager, director}` or superuser (same set as ShipmentDetail's variety-override).

---

### Task 1: `ShipmentDeviceLink` model + resolver service

**Files:**
- Create: `backend/apps/transport/models/link.py`
- Modify: `backend/apps/transport/models/__init__.py`
- Create: `backend/apps/transport/services/matching.py`
- Create: `backend/apps/transport/tests/test_matching.py`

**Interfaces:**
- Consumes: `Truck`, `TraccarDevice`, `DevicePosition` (Task-1 models of the fleet-map feature), `export.Shipment`.
- Produces: `ShipmentDeviceLink` model; `normalize_plate(str) -> str`; `resolve_device_for_shipment(shipment) -> tuple[TraccarDevice | None, str]` (`str` ∈ {`'manual'`,`'auto'`,`'none'`}).

- [ ] **Step 1: Write the failing resolver tests**

`backend/apps/transport/tests/test_matching.py`:
```python
from django.test import TestCase

from apps.core.models import Season
from apps.export.models import Shipment
from apps.transport.models import Truck, TraccarDevice, DevicePosition, ShipmentDeviceLink
from apps.transport.services.matching import normalize_plate, resolve_device_for_shipment


def _shipment(truck_plate):
    season = Season.objects.create(name='S', is_active=True)
    status = _status()
    return Shipment.objects.create(
        shipment_code='X', season=season, status=status, truck_plate=truck_plate,
    )


def _status():
    from apps.core.models import ShipmentStatusType
    return ShipmentStatusType.objects.create(code='draft', name_tk='D', step_order=1)


class NormalizeTests(TestCase):
    def test_strips_non_alnum_and_uppercases(self):
        self.assertEqual(normalize_plate(' 4378 ahf '), '4378AHF')
        self.assertEqual(normalize_plate(None), '')


class ResolveTests(TestCase):
    def setUp(self):
        self.truck = Truck.objects.create(plate='4378AHF', fleet_no='TR050')
        self.device = TraccarDevice.objects.create(
            traccar_id=67, name='4378AHF TR050', truck=self.truck, status='online',
        )
        DevicePosition.objects.create(
            device=self.device, latitude='37.9', longitude='58.4',
        )

    def test_auto_match_extracts_tractor_before_slash(self):
        device, how = resolve_device_for_shipment(_shipment('4378AHF/2602TAH'))
        self.assertEqual(device, self.device)
        self.assertEqual(how, 'auto')

    def test_manual_link_wins_over_auto(self):
        other_truck = Truck.objects.create(plate='9999XYZ', fleet_no='TR099')
        other = TraccarDevice.objects.create(traccar_id=99, name='9999XYZ TR099', truck=other_truck)
        shp = _shipment('4378AHF/2602TAH')
        ShipmentDeviceLink.objects.create(shipment=shp, device=other)
        device, how = resolve_device_for_shipment(shp)
        self.assertEqual(device, other)
        self.assertEqual(how, 'manual')

    def test_no_match_returns_none(self):
        device, how = resolve_device_for_shipment(_shipment('7463LBE/1779TLB'))
        self.assertIsNone(device)
        self.assertEqual(how, 'none')

    def test_blank_plate_returns_none(self):
        device, how = resolve_device_for_shipment(_shipment(''))
        self.assertIsNone(device)
        self.assertEqual(how, 'none')
```

> NOTE: `Shipment.objects.create(...)` requires whatever fields are non-null on the model. Before running, open `backend/apps/export/models/shipment.py` and pass the minimal required fields (the model auto-assigns `shipment_code` via save if applicable; `season`/`status` are FKs). Adjust `_shipment`/`_status` helpers to satisfy NOT NULL columns — keep them minimal. If `Season`/`ShipmentStatusType` need more required fields, add them.

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && python manage.py test apps.transport.tests.test_matching -v2`
Expected: FAIL — `ShipmentDeviceLink` / `matching` missing.

- [ ] **Step 3: Create the model**

`backend/apps/transport/models/link.py`:
```python
from django.db import models

from apps.core.db_utils import schema_table


class ShipmentDeviceLink(models.Model):
    """Manual override pinning a shipment to a specific Traccar device.

    Only manual overrides are persisted; auto-matches are computed live by
    resolve_device_for_shipment(). Lives in transport (export must not depend
    on transport), referencing export.Shipment via a lazy FK string.
    """

    shipment = models.OneToOneField(
        'export.Shipment', on_delete=models.CASCADE, related_name='device_link',
    )
    device = models.ForeignKey(
        'transport.TraccarDevice', on_delete=models.PROTECT, related_name='shipment_links',
    )
    created_by = models.ForeignKey(
        'core.User', on_delete=models.SET_NULL, null=True, blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = schema_table('transport', 'shipment_device_links')

    def __str__(self) -> str:
        return f'shipment {self.shipment_id} -> device {self.device_id}'
```

Append to `backend/apps/transport/models/__init__.py`:
```python
from .link import ShipmentDeviceLink
```
and add `'ShipmentDeviceLink'` to `__all__`.

- [ ] **Step 4: Write the resolver**

`backend/apps/transport/services/matching.py`:
```python
import re

from apps.transport.models import Truck, TraccarDevice, DevicePosition, ShipmentDeviceLink

_NON_ALNUM = re.compile(r'[^A-Z0-9]')
_SPLIT = re.compile(r'[/\s]')


def normalize_plate(value: str) -> str:
    """Uppercase and strip everything but letters/digits."""
    return _NON_ALNUM.sub('', (value or '').upper())


def _tractor_token(truck_plate: str) -> str:
    """The tractor plate = first token before a '/' or whitespace."""
    return _SPLIT.split((truck_plate or '').strip(), maxsplit=1)[0]


def _pick_device(truck: Truck) -> TraccarDevice | None:
    """Prefer a device with a stored position, then category 'truck', then any."""
    devices = list(TraccarDevice.objects.filter(truck=truck))
    if not devices:
        return None
    positioned = set(
        DevicePosition.objects.filter(device_id__in=[d.id for d in devices])
        .values_list('device_id', flat=True)
    )
    for d in devices:
        if d.id in positioned:
            return d
    for d in devices:
        if d.category == 'truck':
            return d
    return devices[0]


def resolve_device_for_shipment(shipment) -> tuple[TraccarDevice | None, str]:
    """Resolve the shipment's Traccar device.

    Order: a manual ShipmentDeviceLink, then a plate auto-match, else none.
    Returns (device_or_None, 'manual'|'auto'|'none').
    """
    link = (
        ShipmentDeviceLink.objects.filter(shipment=shipment)
        .select_related('device').first()
    )
    if link:
        return link.device, 'manual'

    plate_norm = normalize_plate(_tractor_token(shipment.truck_plate))
    if not plate_norm:
        return None, 'none'

    norm_to_truck = {
        normalize_plate(plate): tid
        for tid, plate in Truck.objects.values_list('id', 'plate')
    }
    truck_id = norm_to_truck.get(plate_norm)
    if truck_id is None:
        return None, 'none'
    device = _pick_device(Truck.objects.get(id=truck_id))
    return (device, 'auto') if device else (None, 'none')
```

- [ ] **Step 5: Migrate + run tests**

Run:
```bash
cd backend
python manage.py makemigrations transport
python manage.py migrate transport
python manage.py test apps.transport.tests.test_matching -v2
```
Expected: migration created + applied; tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/transport/models/link.py backend/apps/transport/models/__init__.py backend/apps/transport/services/matching.py backend/apps/transport/tests/test_matching.py backend/apps/transport/migrations/
git commit -m "feat(transport): ShipmentDeviceLink + device resolver (manual>auto>none)"
```

---

### Task 2: API — position, override, device list

**Files:**
- Modify: `backend/apps/transport/serializers.py`
- Modify: `backend/apps/transport/views.py`
- Modify: `backend/apps/transport/urls.py`
- Create: `backend/apps/transport/permissions.py`
- Create: `backend/apps/transport/tests/test_shipment_api.py`

**Interfaces:**
- Consumes: `resolve_device_for_shipment`, `ShipmentDeviceLink`, `TraccarDevice`, `DevicePosition`, `LivePositionSerializer`, `export.Shipment`.
- Produces: `GET /api/v1/transport/shipments/<id>/position/`; `PUT|DELETE /api/v1/transport/shipments/<id>/device/`; `GET /api/v1/transport/devices/`.

- [ ] **Step 1: Write the failing API tests**

`backend/apps/transport/tests/test_shipment_api.py`:
```python
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import Season, ShipmentStatusType
from apps.export.models import Shipment
from apps.transport.models import Truck, TraccarDevice, DevicePosition, ShipmentDeviceLink

User = get_user_model()


class ShipmentPositionApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.editor = User.objects.create_user(username='mgr', password='x', role='export_manager')
        self.viewer = User.objects.create_user(username='op', password='x', role='sales_rep')
        season = Season.objects.create(name='S', is_active=True)
        status = ShipmentStatusType.objects.create(code='draft', name_tk='D', step_order=1)
        self.shipment = Shipment.objects.create(
            shipment_code='X', season=season, status=status, truck_plate='4378AHF/2602TAH',
        )
        self.truck = Truck.objects.create(plate='4378AHF', fleet_no='TR050')
        self.device = TraccarDevice.objects.create(
            traccar_id=67, name='4378AHF TR050', truck=self.truck, status='online',
        )
        DevicePosition.objects.create(device=self.device, latitude='37.9', longitude='58.4')

    def test_position_auto_resolves(self):
        self.client.force_authenticate(self.viewer)
        r = self.client.get(f'/api/v1/transport/shipments/{self.shipment.id}/position/')
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body['resolved_by'], 'auto')
        self.assertEqual(body['device']['plate'], '4378AHF')
        self.assertEqual(body['position']['lat'], 37.9)

    def test_position_none_when_no_match(self):
        self.shipment.truck_plate = '7463LBE/1779TLB'
        self.shipment.save()
        self.client.force_authenticate(self.viewer)
        body = self.client.get(f'/api/v1/transport/shipments/{self.shipment.id}/position/').json()
        self.assertEqual(body['resolved_by'], 'none')
        self.assertIsNone(body['device'])
        self.assertIsNone(body['position'])

    def test_put_override_requires_editor_role(self):
        self.client.force_authenticate(self.viewer)
        r = self.client.put(
            f'/api/v1/transport/shipments/{self.shipment.id}/device/',
            {'traccar_id': 67}, format='json',
        )
        self.assertEqual(r.status_code, 403)

    def test_put_and_delete_override(self):
        other_truck = Truck.objects.create(plate='9999XYZ', fleet_no='TR099')
        other = TraccarDevice.objects.create(traccar_id=99, name='9999XYZ TR099', truck=other_truck)
        self.client.force_authenticate(self.editor)
        r = self.client.put(
            f'/api/v1/transport/shipments/{self.shipment.id}/device/',
            {'traccar_id': 99}, format='json',
        )
        self.assertEqual(r.status_code, 200)
        body = self.client.get(f'/api/v1/transport/shipments/{self.shipment.id}/position/').json()
        self.assertEqual(body['resolved_by'], 'manual')
        self.assertEqual(body['device']['traccar_id'], 99)
        # delete reverts to auto
        d = self.client.delete(f'/api/v1/transport/shipments/{self.shipment.id}/device/')
        self.assertEqual(d.status_code, 204)
        body = self.client.get(f'/api/v1/transport/shipments/{self.shipment.id}/position/').json()
        self.assertEqual(body['resolved_by'], 'auto')

    def test_devices_list(self):
        self.client.force_authenticate(self.viewer)
        r = self.client.get('/api/v1/transport/devices/')
        self.assertEqual(r.status_code, 200)
        row = next(d for d in r.json() if d['traccar_id'] == 67)
        self.assertEqual(row['plate'], '4378AHF')
        self.assertEqual(row['fleet_no'], 'TR050')
```

> NOTE: adjust the `Shipment.objects.create(...)` and `User.objects.create_user(..., role=...)` calls to the real required fields / role choices — read `backend/apps/export/models/shipment.py` and the User model first. If `role` isn't a direct kwarg, set it after create.

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && python manage.py test apps.transport.tests.test_shipment_api -v2`
Expected: FAIL — routes/permission missing (404/500).

- [ ] **Step 3: Permission class**

`backend/apps/transport/permissions.py`:
```python
from rest_framework.permissions import BasePermission

SHIPMENT_EDITOR_ROLES = {'warehouse_chief', 'export_manager', 'director'}


class CanEditShipment(BasePermission):
    """Same editor set as ShipmentDetail's variety-override."""

    def has_permission(self, request, view) -> bool:
        user = request.user
        if not (user and user.is_authenticated):
            return False
        return bool(user.is_superuser or getattr(user, 'role', None) in SHIPMENT_EDITOR_ROLES)
```

- [ ] **Step 4: Serializer for the device list**

Append to `backend/apps/transport/serializers.py`:
```python
from apps.transport.models import TraccarDevice


class TransportDeviceSerializer(serializers.ModelSerializer):
    """Registry device for the override picker (all devices, not just positioned)."""

    plate = serializers.CharField(source='truck.plate', default=None)
    fleet_no = serializers.CharField(source='truck.fleet_no', default=None)

    class Meta:
        model = TraccarDevice
        fields = ['traccar_id', 'plate', 'fleet_no', 'name']
```
(`serializers` and `LivePositionSerializer` already exist in this file.)

- [ ] **Step 5: Views**

Append to `backend/apps/transport/views.py` (imports at top of file):
```python
from django.shortcuts import get_object_or_404
from rest_framework import mixins, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.export.models import Shipment
from apps.transport.models import DevicePosition, TraccarDevice, ShipmentDeviceLink
from apps.transport.permissions import CanEditShipment
from apps.transport.serializers import LivePositionSerializer, TransportDeviceSerializer
from apps.transport.services.matching import resolve_device_for_shipment


class ShipmentTruckPositionView(APIView):
    """Latest position of the shipment's resolved truck (manual>auto>none)."""

    permission_classes = [IsAuthenticated]

    def get(self, request, shipment_id):
        shipment = get_object_or_404(Shipment, pk=shipment_id)
        device, resolved_by = resolve_device_for_shipment(shipment)
        data = {'resolved_by': resolved_by, 'device': None, 'position': None}
        if device is not None:
            data['device'] = {
                'traccar_id': device.traccar_id,
                'plate': device.truck.plate if device.truck else None,
                'fleet_no': device.truck.fleet_no if device.truck else None,
            }
            pos = (
                DevicePosition.objects.filter(device=device)
                .select_related('device', 'device__truck').first()
            )
            if pos is not None:
                data['position'] = LivePositionSerializer(pos).data
        return Response(data)


class ShipmentDeviceLinkView(APIView):
    """Manual override: PUT sets/replaces, DELETE clears (revert to auto)."""

    permission_classes = [IsAuthenticated, CanEditShipment]

    def put(self, request, shipment_id):
        shipment = get_object_or_404(Shipment, pk=shipment_id)
        device = get_object_or_404(TraccarDevice, traccar_id=request.data.get('traccar_id'))
        ShipmentDeviceLink.objects.update_or_create(
            shipment=shipment, defaults={'device': device, 'created_by': request.user},
        )
        return Response({'ok': True})

    def delete(self, request, shipment_id):
        ShipmentDeviceLink.objects.filter(shipment_id=shipment_id).delete()
        return Response(status=204)


class TransportDeviceViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """All registry devices for the override picker."""

    permission_classes = [IsAuthenticated]
    pagination_class = None
    serializer_class = TransportDeviceSerializer

    def get_queryset(self):
        return TraccarDevice.objects.select_related('truck').order_by('name')
```

- [ ] **Step 6: URLs**

Edit `backend/apps/transport/urls.py`:
```python
from django.urls import path
from rest_framework.routers import DefaultRouter

from apps.transport.views import (
    LivePositionViewSet,
    ShipmentTruckPositionView,
    ShipmentDeviceLinkView,
    TransportDeviceViewSet,
)

router = DefaultRouter()
router.register('live-positions', LivePositionViewSet, basename='live-positions')
router.register('devices', TransportDeviceViewSet, basename='transport-devices')

urlpatterns = [
    path('shipments/<int:shipment_id>/position/', ShipmentTruckPositionView.as_view()),
    path('shipments/<int:shipment_id>/device/', ShipmentDeviceLinkView.as_view()),
    *router.urls,
]
```

- [ ] **Step 7: Run tests + full app suite**

Run:
```bash
cd backend
python manage.py test apps.transport.tests.test_shipment_api -v2
python manage.py test apps.transport -v2
```
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/apps/transport/permissions.py backend/apps/transport/serializers.py backend/apps/transport/views.py backend/apps/transport/urls.py backend/apps/transport/tests/test_shipment_api.py
git commit -m "feat(transport): shipment position + device-override + devices API"
```

---

### Task 3: Frontend hooks + types

**Files:**
- Create: `frontend/src/hooks/useShipmentTruckPosition.ts`
- Create: `frontend/src/hooks/useTransportDevices.ts`
- Create: `frontend/src/hooks/useShipmentTruckPosition.test.ts`

**Interfaces:**
- Consumes: `GET /transport/shipments/:id/position/`, `GET /transport/devices/`, `PUT|DELETE /transport/shipments/:id/device/`.
- Produces: `useShipmentTruckPosition(shipmentId)`; `useTransportDevices()`; `useSetShipmentDevice(shipmentId)` (mutation with `set`/`clear`); interfaces `ITruckPositionResult`, `ITransportDevice`.

- [ ] **Step 1: Write the failing hook test**

`frontend/src/hooks/useShipmentTruckPosition.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useShipmentTruckPosition } from './useShipmentTruckPosition';
import api from '@/services/api';

vi.mock('@/services/api');

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useShipmentTruckPosition', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches the shipment position', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { resolved_by: 'auto', device: { traccar_id: 67, plate: '4378AHF', fleet_no: 'TR050' },
              position: { lat: 37.9, lon: 58.4, is_online: true, is_stale: false } },
    });
    const { result } = renderHook(() => useShipmentTruckPosition(12), { wrapper });
    await waitFor(() => expect(result.current.data?.resolved_by).toBe('auto'));
    expect(api.get).toHaveBeenCalledWith('/transport/shipments/12/position/');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/useShipmentTruckPosition.test.ts`
Expected: FAIL — hook missing.

- [ ] **Step 3: Implement the hooks**

`frontend/src/hooks/useShipmentTruckPosition.ts`:
```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';

export interface ITruckPosition {
  lat: number;
  lon: number;
  speed: number | null;
  course: number | null;
  address: string | null;
  fix_time: string | null;
  is_online: boolean;
  is_stale: boolean;
}

export interface ITruckPositionResult {
  resolved_by: 'manual' | 'auto' | 'none';
  device: { traccar_id: number; plate: string | null; fleet_no: string | null } | null;
  position: ITruckPosition | null;
}

export function useShipmentTruckPosition(shipmentId: number) {
  return useQuery<ITruckPositionResult>({
    queryKey: ['transport', 'shipment-position', shipmentId],
    queryFn: async () => {
      const { data } = await api.get<ITruckPositionResult>(
        `/transport/shipments/${shipmentId}/position/`,
      );
      return data;
    },
    refetchInterval: 30_000,
  });
}

export function useSetShipmentDevice(shipmentId: number) {
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['transport', 'shipment-position', shipmentId] });
  const set = useMutation({
    mutationFn: (traccarId: number) =>
      api.put(`/transport/shipments/${shipmentId}/device/`, { traccar_id: traccarId }),
    onSuccess: invalidate,
  });
  const clear = useMutation({
    mutationFn: () => api.delete(`/transport/shipments/${shipmentId}/device/`),
    onSuccess: invalidate,
  });
  return { set, clear };
}
```

`frontend/src/hooks/useTransportDevices.ts`:
```typescript
import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';

export interface ITransportDevice {
  traccar_id: number;
  plate: string | null;
  fleet_no: string | null;
  name: string;
}

export function useTransportDevices() {
  return useQuery<ITransportDevice[]>({
    queryKey: ['transport', 'devices'],
    queryFn: async () => {
      const { data } = await api.get<ITransportDevice[]>('/transport/devices/');
      return data;
    },
    staleTime: 5 * 60_000,
  });
}
```

- [ ] **Step 4: Run test + type-check**

Run:
```bash
cd frontend
npx vitest run src/hooks/useShipmentTruckPosition.test.ts
npx tsc --noEmit --ignoreDeprecations 5.0
```
Expected: test PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useShipmentTruckPosition.ts frontend/src/hooks/useTransportDevices.ts frontend/src/hooks/useShipmentTruckPosition.test.ts
git commit -m "feat(transport): shipment truck-position + devices hooks"
```

---

### Task 4: ShipmentTruckLocationCard + placement

**Files:**
- Create: `frontend/src/components/shipment/ShipmentTruckLocationCard.tsx`
- Modify: `frontend/src/pages/export/ShipmentDetail.tsx`
- Modify: `frontend/src/i18n/tk.json`, `ru.json`, `en.json` (card strings)

**Interfaces:**
- Consumes: `useShipmentTruckPosition`, `useSetShipmentDevice`, `useTransportDevices`, `ITruckPositionResult`.
- Produces: `<ShipmentTruckLocationCard shipmentId={number} canEdit={boolean} />`.

- [ ] **Step 1: Build the card**

`frontend/src/components/shipment/ShipmentTruckLocationCard.tsx`:
```tsx
import { useMemo, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import { Card, Select, Button, Space, Tag, Typography, Spin, Empty } from 'antd';
import { useTranslation } from 'react-i18next';
import 'leaflet/dist/leaflet.css';
import { useShipmentTruckPosition, useSetShipmentDevice } from '@/hooks/useShipmentTruckPosition';
import { useTransportDevices } from '@/hooks/useTransportDevices';

const TILE_URL =
  import.meta.env.VITE_MAP_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

export function ShipmentTruckLocationCard({
  shipmentId,
  canEdit,
}: {
  shipmentId: number;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const { data, isLoading } = useShipmentTruckPosition(shipmentId);
  const { set, clear } = useSetShipmentDevice(shipmentId);
  const [picking, setPicking] = useState(false);
  const devicesQuery = useTransportDevices();

  const deviceOptions = useMemo(
    () =>
      (devicesQuery.data ?? []).map((d) => ({
        value: d.traccar_id,
        label: `${d.plate ?? d.name} ${d.fleet_no ?? ''}`.trim(),
      })),
    [devicesQuery.data],
  );

  const title = t('fleet_map.shipment_card_title');
  if (isLoading) return <Card title={title}><Spin /></Card>;

  const pos = data?.position ?? null;
  const pinColor = pos?.is_stale ? '#9ca3af' : pos?.is_online ? '#16a34a' : '#f59e0b';

  return (
    <Card
      title={title}
      extra={
        data?.resolved_by && data.resolved_by !== 'none' ? (
          <Tag color={data.resolved_by === 'manual' ? 'blue' : 'default'}>{data.resolved_by}</Tag>
        ) : null
      }
      style={{ marginBottom: 8 }}
    >
      {data?.resolved_by === 'none' && !picking ? (
        <Empty description={t('fleet_map.shipment_no_gps')}>
          {canEdit && <Button onClick={() => setPicking(true)}>{t('fleet_map.link_device')}</Button>}
        </Empty>
      ) : (
        <>
          {pos && (
            <div style={{ height: 220, marginBottom: 8 }}>
              <MapContainer center={[pos.lat, pos.lon]} zoom={9} style={{ height: '100%' }}>
                <TileLayer url={TILE_URL} attribution="&copy; OpenStreetMap" />
                <CircleMarker
                  center={[pos.lat, pos.lon]}
                  radius={8}
                  pathOptions={{ color: pinColor, fillColor: pinColor, fillOpacity: 0.9 }}
                >
                  <Popup>
                    {data?.device?.plate} {data?.device?.fleet_no}
                    <br />
                    {pos.address ?? '—'}
                  </Popup>
                </CircleMarker>
              </MapContainer>
            </div>
          )}
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            <Typography.Text strong>
              {data?.device?.plate ?? '—'} {data?.device?.fleet_no ?? ''}
            </Typography.Text>
            <Typography.Text type="secondary">{pos?.address ?? t('fleet_map.no_position')}</Typography.Text>
            {pos && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {pos.speed ?? 0} km/h · {pos.is_online ? t('fleet_map.online') : t('fleet_map.offline')}
                {pos.is_stale ? ` · ${t('fleet_map.stale')}` : ''}
              </Typography.Text>
            )}
          </Space>
        </>
      )}

      {canEdit && (picking || data?.resolved_by !== 'none') && (
        <Space style={{ marginTop: 8 }} wrap>
          <Select
            showSearch
            placeholder={t('fleet_map.pick_device')}
            style={{ minWidth: 220 }}
            options={deviceOptions}
            optionFilterProp="label"
            loading={devicesQuery.isLoading}
            onChange={(v) => set.mutate(v as number, { onSuccess: () => setPicking(false) })}
          />
          {data?.resolved_by === 'manual' && (
            <Button onClick={() => clear.mutate()}>{t('fleet_map.reset_auto')}</Button>
          )}
        </Space>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Add i18n keys**

Add to `frontend/src/i18n/en.json` (and Russian/Turkmen equivalents in `ru.json`/`tk.json`, matching the file's existing `fleet_map.*` block):
```json
"fleet_map": {
  "shipment_card_title": "Truck location",
  "shipment_no_gps": "No GPS device linked for this truck",
  "link_device": "Link a device",
  "no_position": "No position yet",
  "pick_device": "Pick a device",
  "reset_auto": "Reset to auto",
  "online": "online",
  "offline": "offline",
  "stale": "stale"
}
```
(If a `fleet_map` object already exists from the FleetMap page, MERGE these keys into it — do not create a duplicate object. Provide real `ru`/`tk` translations.)

- [ ] **Step 3: Place the card on ShipmentDetail**

In `frontend/src/pages/export/ShipmentDetail.tsx`, import the card and render it after `<ShipmentCustomsExpensesCard .../>`:
```tsx
import { ShipmentTruckLocationCard } from '@/components/shipment/ShipmentTruckLocationCard';
```
```tsx
<ShipmentTruckLocationCard shipmentId={shipment.id} canEdit={canOverrideVariety} />
```
(`canOverrideVariety` is already computed in this component — reuse it as the edit gate, matching the backend `CanEditShipment` roles.)

- [ ] **Step 4: Type-check + hook test still green**

Run:
```bash
cd frontend
npx tsc --noEmit --ignoreDeprecations 5.0
npx vitest run src/hooks/useShipmentTruckPosition.test.ts
```
Expected: no type errors; test PASS.

- [ ] **Step 5: Manual smoke (optional but recommended)**

Run the app, open a ShipmentDetail whose `truck_plate` starts with a fleet plate (e.g. `4378AHF/...`) — expect the map + `auto` tag. Open one with a foreign plate — expect "No GPS device linked" + (for an editor) the picker.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/shipment/ShipmentTruckLocationCard.tsx frontend/src/pages/export/ShipmentDetail.tsx frontend/src/i18n/tk.json frontend/src/i18n/ru.json frontend/src/i18n/en.json
git commit -m "feat(transport): truck location card on ShipmentDetail with override picker"
```

---

### Task 5: Docs + changelog + build log

**Files:**
- Modify: `docs/obsidian/processes/fleet-map.md`
- Modify: `docs/obsidian/reference/api-endpoint-map.md`
- Modify: `CHANGELOG.md`, `BUILD_TEST_LOG.md`

- [ ] **Step 1: Update fleet-map.md**

Add a "Shipment ↔ Truck link" section: the `ShipmentDeviceLink` model, the resolver order (manual > auto-by-tractor-plate > none), the three endpoints, and the ShipmentDetail card. Note that only manual overrides are stored.

- [ ] **Step 2: Update api-endpoint-map.md**

Add rows for `GET shipments/<id>/position/`, `PUT|DELETE shipments/<id>/device/`, `GET devices/` under the Transport section (match the existing table style).

- [ ] **Step 3: CHANGELOG + BUILD_TEST_LOG**

CHANGELOG `[Unreleased] → Added`:
```
- Shipment truck GPS: ShipmentDetail shows the truck's live position (auto-matched by plate, manual override), new transport shipment-position/device endpoints.
```
BUILD_TEST_LOG (top):
```
- [ ] 2026-08-01 — Shipment↔truck GPS link: resolver + position/override/devices API + ShipmentDetail location card — NEEDS TEST
```

- [ ] **Step 4: Commit**

```bash
git add docs/obsidian/processes/fleet-map.md docs/obsidian/reference/api-endpoint-map.md CHANGELOG.md BUILD_TEST_LOG.md
git commit -m "docs(transport): document shipment<->truck GPS link"
```

---

## Self-Review

**Spec coverage:**
- ShipmentDeviceLink (transport-owned, OneToOne, manual-only) → Task 1 ✓
- Resolver manual>auto>none, tractor-extraction + normalization, device preference → Task 1 ✓
- `position/` + `device/` PUT/DELETE + `devices/` endpoints, permission gate → Task 2 ✓
- Hooks (30s refetch) + types → Task 3 ✓
- Mini map + details card + override picker + none-state + placement → Task 4 ✓
- Auto-refresh 30s → Task 3 hook ✓
- Docs/changelog/build-log → Task 5 ✓
- Dependency direction (transport→export FK, no reverse) → Task 1 model ✓
- Read-DB-only, never Traccar in request path → Tasks 2 views read our tables ✓

**Placeholder scan:** No TBD/TODO in code steps. Task 1/2 tests carry NOTE caveats to align `Shipment`/`User` construction with real required fields — the implementer must open the models (unavoidable: those NOT-NULL columns are project-specific and live outside this plan).

**Type consistency:** `resolve_device_for_shipment -> (device, str)` used identically in Task 1 (def) and Task 2 (call). `ITruckPositionResult` fields (Task 3) match the Task 2 view response (`resolved_by`, `device{traccar_id,plate,fleet_no}`, `position` = `LivePositionSerializer` output incl. `lat/lon/is_online/is_stale`). `TransportDeviceSerializer` fields (Task 2) match `ITransportDevice` (Task 3) and the picker options (Task 4). `canOverrideVariety` (existing) = `CanEditShipment` roles (Task 2) — same set, kept in sync.

**Open confirmations for the implementer:**
1. `Shipment` / `Season` / `ShipmentStatusType` / `User` minimal required fields for the test fixtures (read the models; the plan's `create(...)` calls may need extra NOT-NULL fields).
2. That `LivePositionSerializer.data` for a position includes `lat`/`lon`/`is_online`/`is_stale` (it does, per the fleet-map feature) — the card and `ITruckPosition` rely on it.
