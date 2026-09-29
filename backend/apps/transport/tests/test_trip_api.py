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
