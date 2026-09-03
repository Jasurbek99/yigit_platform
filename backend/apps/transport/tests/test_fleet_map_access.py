"""Who may read the Fleet Map's live positions.

The seller was dropped from the Fleet Map nav item in de01b15 (owner request,
2026-08-23); the nav item is a client-side list, so these tests pin the part
that is actually a boundary — the 403 on the endpoint the page reads.

Since 2026-09-03 that boundary is the `transport.map` page row rather than a
hardcoded deny-list, so every test here seeds the permission matrix first. The
seller carve-out is unchanged in effect — it is a seeded `is_visible=False` row
now, which an admin can reverse from the permission screen.
"""
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import RolePagePermission, Season, ShipmentStatusType
from apps.export.models import Shipment
from apps.transport.models import DevicePosition, TraccarDevice, Truck

User = get_user_model()

URL = '/api/v1/transport/live-positions/'


class FleetMapAccessTests(TestCase):
    def setUp(self):
        call_command('seed_permissions')
        cache.clear()
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

    def test_role_outside_the_transport_department_is_allowed(self):
        """Everyone but the seller is seeded with the page (see PAGE_DEFAULTS)."""
        self.client.force_authenticate(
            User.objects.create_user(username='gh', password='x', role='greenhouse_manager')
        )
        self.assertEqual(self.client.get(URL).status_code, 200)

    def test_revoking_the_page_row_closes_the_endpoint(self):
        """The point of registering the page_code: an admin unchecking Fleet Map
        for a role must close the endpoint too, not just hide the nav item."""
        RolePagePermission.objects.filter(
            role='transport', page_code='transport.map',
        ).update(is_visible=False)
        cache.clear()
        self.client.force_authenticate(
            User.objects.create_user(username='drv2', password='x', role='transport')
        )
        self.assertEqual(self.client.get(URL).status_code, 403)

    def test_superuser_bypasses_the_matrix(self):
        self.client.force_authenticate(
            User.objects.create_superuser(username='root', password='x', role='seller')
        )
        self.assertEqual(self.client.get(URL).status_code, 200)

    def test_anonymous_is_401_not_403(self):
        self.assertEqual(self.client.get(URL).status_code, 401)


class FleetMapGateDidNotWidenTests(TestCase):
    """The rest of the transport module is finding F5's territory, untouched."""

    def setUp(self):
        call_command('seed_permissions')
        cache.clear()
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
