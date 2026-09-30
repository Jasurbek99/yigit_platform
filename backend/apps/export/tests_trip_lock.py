"""Transport fields are read-only on a regular shipment that carries a Planning trip.

Spec: docs/superpowers/specs/2026-09-29-transport-trips-design.md D10 / §9.3.
"""
from types import SimpleNamespace

from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import Season, ShipmentStatusType, User
from apps.export.models import Shipment
from apps.export.services.trip_lock import trip_locked_fields


class TripLockTests(TestCase):
    def _ship(self, trip_id=None, gapy=False):
        return SimpleNamespace(trip_id=trip_id, is_gapy_satys=gapy)

    def test_linked_regular_shipment_locks_transport_fields(self):
        self.assertEqual(trip_locked_fields(self._ship(trip_id=5), ['driver_name', 'border_point']), ['driver_name'])

    def test_no_trip_or_gapy_locks_nothing(self):
        self.assertEqual(trip_locked_fields(self._ship(), ['driver_name']), [])
        self.assertEqual(trip_locked_fields(self._ship(trip_id=5, gapy=True), ['driver_name']), [])


class TripLockPatchTests(TestCase):
    def setUp(self):
        call_command('seed_permissions')
        status, _ = ShipmentStatusType.objects.get_or_create(
            code='draft', defaults={'name_tk': 'draft', 'step_order': 0},
        )
        season = Season.objects.create(name='S', start_date='2026-09-01', end_date='2027-06-30', is_active=True)
        self.shipment = Shipment.objects.create(
            shipment_code='T-1', date='2026-10-01', season=season, status=status, trip_id=7,
        )
        user = User.objects.create_user(username='em', password='x', role='export_manager')
        self.client = APIClient()
        self.client.force_authenticate(user)

    def _patch(self, body):
        return self.client.patch(f'/api/v1/export/shipments/{self.shipment.pk}/', body, format='json')

    def test_patch_driver_on_linked_shipment_is_refused(self):
        response = self._patch({'driver_name': 'Typed Driver'})
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json(), {'error': 'trip_locked', 'fields': ['driver_name']})

    def test_patch_driver_without_trip_is_allowed(self):
        Shipment.objects.filter(pk=self.shipment.pk).update(trip_id=None)
        response = self._patch({'driver_name': 'Typed Driver'})
        self.assertEqual(response.status_code, 200, response.content)

    def test_other_fields_stay_editable_on_linked_shipment(self):
        response = self._patch({'vehicle_live_status': 'on the way'})
        self.assertEqual(response.status_code, 200, response.content)

    def test_sheet_payload_exposes_trip_id(self):
        from apps.export.serializers import ShipmentSheetSerializer
        self.assertEqual(ShipmentSheetSerializer(self.shipment).data['trip_id'], 7)

    def test_detail_payload_exposes_trip_id(self):
        from apps.export.serializers import ShipmentDetailSerializer
        self.shipment.refresh_from_db()
        self.assertEqual(ShipmentDetailSerializer(self.shipment).data['trip_id'], 7)

    def test_detail_payload_exposes_passport_expiry(self):
        from apps.export.serializers import ShipmentDetailSerializer
        Shipment.objects.filter(pk=self.shipment.pk).update(driver_passport_expiry='2029-04-08')
        self.shipment.refresh_from_db()
        self.assertEqual(ShipmentDetailSerializer(self.shipment).data['driver_passport_expiry'], '2029-04-08')
