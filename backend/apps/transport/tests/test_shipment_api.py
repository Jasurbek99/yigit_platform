from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import Season, ShipmentStatusType
from apps.export.models import Shipment
from apps.transport.models import Truck, TraccarDevice, DevicePosition, ShipmentDeviceLink

User = get_user_model()


def _status():
    # 'draft' is seeded by a core data migration (0006_seed_shipment_draft_status);
    # reuse it instead of colliding with the unique `code` constraint.
    status, _ = ShipmentStatusType.objects.get_or_create(
        code='draft', defaults={'name_tk': 'D', 'step_order': 1},
    )
    return status


class ShipmentPositionApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.editor = User.objects.create_user(username='mgr', password='x', role='export_manager')
        self.viewer = User.objects.create_user(username='op', password='x', role='sales_rep')
        season = Season.objects.create(
            name='S', start_date='2025-09-01', end_date='2026-06-30', is_active=True,
        )
        status = _status()
        self.shipment = Shipment.objects.create(
            shipment_code='X', date='2025-11-01', season=season, status=status,
            truck_plate='4378AHF/2602TAH',
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
