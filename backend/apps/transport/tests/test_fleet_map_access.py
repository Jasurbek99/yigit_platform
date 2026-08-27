"""Who may read the Fleet Map's live positions.

The seller was dropped from the Fleet Map nav item in de01b15 (owner request,
2026-08-23); the nav item is a client-side list, so these tests pin the part
that is actually a boundary — the 403 on the endpoint the page reads.
"""
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import Season, ShipmentStatusType
from apps.export.models import Shipment
from apps.transport.models import DevicePosition, TraccarDevice, Truck

User = get_user_model()

URL = '/api/v1/transport/live-positions/'


class FleetMapAccessTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        truck = Truck.objects.create(plate='2189AHF', fleet_no='TR038')
        device = TraccarDevice.objects.create(
            traccar_id=74, name='2189AHF TR038', truck=truck, status='online',
        )
        DevicePosition.objects.create(device=device, latitude='37.97', longitude='58.49')

    def test_seller_is_denied(self):
        self.client.force_authenticate(
            User.objects.create_user(username='sell', password='x', role='seller')
        )
        self.assertEqual(self.client.get(URL).status_code, 403)

    def test_transport_role_is_allowed(self):
        self.client.force_authenticate(
            User.objects.create_user(username='drv', password='x', role='transport')
        )
        resp = self.client.get(URL)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()), 1)

    def test_role_absent_from_the_deny_set_is_allowed(self):
        """Deny-list, not allow-list: a role nobody listed still gets the map."""
        self.client.force_authenticate(
            User.objects.create_user(username='gh', password='x', role='greenhouse_manager')
        )
        self.assertEqual(self.client.get(URL).status_code, 200)

    def test_superuser_bypasses_the_deny_set(self):
        self.client.force_authenticate(
            User.objects.create_superuser(username='root', password='x', role='seller')
        )
        self.assertEqual(self.client.get(URL).status_code, 200)

    def test_anonymous_is_401_not_403(self):
        self.assertEqual(self.client.get(URL).status_code, 401)


class FleetMapGateDidNotWidenTests(TestCase):
    """The rest of the transport module is finding F5's territory, untouched."""

    def setUp(self):
        self.client = APIClient()
        self.seller = User.objects.create_user(username='sell2', password='x', role='seller')
        self.client.force_authenticate(self.seller)
        status, _ = ShipmentStatusType.objects.get_or_create(
            code='draft', defaults={'name_tk': 'D', 'step_order': 1},
        )
        season = Season.objects.create(
            name='S-fleetmap', start_date='2025-09-01', end_date='2026-06-30', is_active=True,
        )
        self.shipment = Shipment.objects.create(
            shipment_code='FM-1', date='2025-11-01', season=season, status=status,
            truck_plate='4378AHF/2602TAH',
        )
        truck = Truck.objects.create(plate='4378AHF', fleet_no='TR050')
        device = TraccarDevice.objects.create(
            traccar_id=67, name='4378AHF TR050', truck=truck, status='online',
        )
        DevicePosition.objects.create(device=device, latitude='37.9', longitude='58.4')

    def test_shipment_position_endpoint_is_unchanged(self):
        resp = self.client.get(f'/api/v1/transport/shipments/{self.shipment.id}/position/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['resolved_by'], 'auto')

    def test_device_list_endpoint_is_unchanged(self):
        self.assertEqual(self.client.get('/api/v1/transport/devices/').status_code, 200)
