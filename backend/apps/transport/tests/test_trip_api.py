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
        self.assertEqual((response.status_code, response.json()['error']), (409, 'trip_taken'))

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
        rows = self.client.get('/api/v1/transport/external-trips/candidate-shipments/').json()
        self.assertEqual([r['shipment_code'] for r in rows], [self.shipment.shipment_code])
        # FK exposed as id + _name pair (api-contract).
        self.assertIn('customer', rows[0])
        self.assertNotIn('code', rows[0])

    def test_candidate_shipments_are_scoped_to_the_season(self):
        from apps.core.models import Season
        self._as('export_manager')
        old = Season.objects.create(name='Old', start_date='2025-09-01', end_date='2026-06-30', is_active=False)
        old_draft = _make_shipment(code='OLD-1', country=self.kz)
        type(old_draft).objects.filter(pk=old_draft.pk).update(season=old)
        url = '/api/v1/transport/external-trips/candidate-shipments/'
        codes = [r['shipment_code'] for r in self.client.get(url).json()]
        self.assertNotIn('OLD-1', codes)  # default = active season
        self.assertIn(self.shipment.shipment_code, codes)
        codes = [r['shipment_code'] for r in self.client.get(f'{url}?season={old.pk}').json()]
        self.assertEqual(codes, ['OLD-1'])

    def test_date_filter(self):
        self._as('export_manager')
        make_trip(integration_trip_id='b242b4de-a941-4dba-899e-3b0235e9f4ec', planned_departure='2026-10-01')
        rows = self.client.get('/api/v1/transport/external-trips/?date=2026-10-11').json()
        self.assertEqual([r['planned_departure'] for r in rows], ['2026-10-11'])

    def test_any_role_reads_the_trip_of_a_shipment(self):
        self._as('export_manager')
        self.client.post(f'/api/v1/transport/external-trips/{self.trip.pk}/assign/',
                         {'shipment_id': self.shipment.pk}, format='json')
        self._as('sales_rep')
        url = f'/api/v1/transport/shipments/{self.shipment.pk}/trip/'
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['id'], self.trip.pk)
        other = _make_shipment(code='T-9', country=self.kz)
        self.assertEqual(self.client.get(f'/api/v1/transport/shipments/{other.pk}/trip/').status_code, 404)

    def test_role_without_shipment_view_cannot_read_driver_data(self):
        self._as('garawul')
        response = self.client.get(f'/api/v1/transport/shipments/{self.shipment.pk}/trip/')
        self.assertEqual(response.status_code, 403)

    def test_sync_state_reports_mock(self):
        self._as('export_manager')
        self.assertTrue(self.client.get('/api/v1/transport/external-trips/sync-state/').json()['is_mock'])

    def test_move_to_another_draft(self):
        self._as('export_manager')
        other = _make_shipment(code='T-2', country=self.kz)
        base = f'/api/v1/transport/external-trips/{self.trip.pk}/'
        self.client.post(base + 'assign/', {'shipment_id': self.shipment.pk}, format='json')
        response = self.client.post(base + 'move/', {'shipment_id': other.pk}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['shipment'], other.pk)

    def test_accept_change_without_conflict_is_a_no_op(self):
        self._as('export_manager')
        response = self.client.post(f'/api/v1/transport/external-trips/{self.trip.pk}/accept-change/')
        self.assertEqual(response.status_code, 200, response.content)


class SimulateTripChangeTests(TestCase):
    def test_edits_driver_and_bumps_changed_at_in_a_copy_of_the_fixture(self):
        import json
        import shutil
        import tempfile
        from pathlib import Path
        from unittest import mock

        from apps.transport.services import trips_client
        tmp = Path(tempfile.mkdtemp()) / 'trips.json'
        shutil.copy(trips_client.FIXTURE_PATH, tmp)
        uuid = '89f2783b-e7e9-47ba-9884-8fe7bf34f1bd'
        with mock.patch.object(trips_client, 'FIXTURE_PATH', tmp), \
                mock.patch('apps.transport.management.commands.simulate_trip_change.FIXTURE_PATH', tmp, create=True):
            call_command('simulate_trip_change', uuid, '--driver', 'Täze Sürüji', '--cancel', stdout=open(tmp.parent / 'out', 'w'))
        item = next(i for i in json.loads(tmp.read_text(encoding='utf-8'))['items'] if i['integrationTripId'] == uuid)
        self.assertEqual(item['driver']['fullName'], 'Täze Sürüji')
        self.assertEqual(item['status'], 'CANCELLED')
        self.assertGreater(item['changedAt'], '2026-09-29')


class MoveUnknownCountryApiTests(TestCase):
    def setUp(self):
        call_command('seed_permissions')
        cache.clear()
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user(username='em2', password='x', role='export_manager'))
        kz = Country.objects.create(code='KZ', name_tk='GAZAGYSTAN')
        self.a = _make_shipment(code='A', country=kz)
        self.b = _make_shipment(code='B', country=kz)
        self.trip = make_trip(destination_country_code=None)
        self.base = f'/api/v1/transport/external-trips/{self.trip.pk}/'
        self.client.post(self.base + 'assign/', {'shipment_id': self.a.pk, 'confirm_unknown_country': True}, format='json')

    def test_move_passes_the_confirm_through(self):
        refused = self.client.post(self.base + 'move/', {'shipment_id': self.b.pk}, format='json')
        self.assertEqual((refused.status_code, refused.json()['error']), (409, 'country_unknown'))
        moved = self.client.post(self.base + 'move/', {'shipment_id': self.b.pk, 'confirm_unknown_country': True}, format='json')
        self.assertEqual(moved.status_code, 200, moved.content)
        self.assertEqual(moved.json()['shipment'], self.b.pk)
