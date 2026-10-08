from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.core.models import Country
from apps.transport.models import ExternalTrip
from apps.transport.tasks import push_trip_update
from apps.transport.tests.test_trip_assignment import make_trip
from apps.transport.tests.test_trip_sync import _make_shipment

User = get_user_model()


@override_settings(TRANSPORT_API_MODE='mock')
class RejectApiTests(TestCase):
    def setUp(self):
        call_command('seed_permissions')
        cache.clear()
        self.client = APIClient()
        self.kz = Country.objects.create(code='KZ', name_tk='GAZAGYSTAN')
        self.shipment = _make_shipment(country=self.kz)
        self.trip = make_trip()
        self.url = f'/api/v1/transport/external-trips/{self.trip.pk}/reject/'

    def _as(self, role):
        user = User.objects.create_user(username=role, password='x', role=role, first_name='Aman')
        self.client.force_authenticate(user)
        return user

    def test_export_manager_rejects_a_free_trip_and_planning_gets_the_reason(self):
        self._as('export_manager')
        with mock.patch('apps.transport.tasks.push_trip_update.delay') as delay, \
                self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(self.url, {'reason': '  Нет визы KZ  '}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual((data['rejection_reason'], data['rejected_by_name']), ('Нет визы KZ', 'Aman'))
        self.assertIsNotNone(data['rejected_at'])
        trip_id, op, body, event_id = delay.call_args.args
        self.assertEqual((trip_id, op, body['reason'], body['eventId']), (self.trip.pk, 'rejection', 'Нет визы KZ', event_id))

    def test_rejecting_again_resends_with_the_new_reason(self):
        """A rejection Planning never got can be sent again from the board."""
        self._as('export_manager')
        with mock.patch('apps.transport.tasks.push_trip_update.delay') as delay, \
                self.captureOnCommitCallbacks(execute=True):
            self.client.post(self.url, {'reason': 'Нет визы KZ'}, format='json')
        ExternalTrip.objects.filter(pk=self.trip.pk).update(
            last_push_status='error', last_push_error='rejection: PLANNING_UNAVAILABLE')
        with mock.patch('apps.transport.tasks.push_trip_update.delay') as again, \
                self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(self.url, {'reason': 'Паспорт истекает'}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['rejection_reason'], 'Паспорт истекает')
        self.assertEqual((delay.call_count, again.call_count), (1, 1))
        self.assertEqual(again.call_args.args[2]['reason'], 'Паспорт истекает')

    def test_reason_is_required(self):
        self._as('export_manager')
        response = self.client.post(self.url, {'reason': '   '}, format='json')
        self.assertEqual((response.status_code, response.json()['error']), (400, 'reason_required'))

    def test_a_reason_that_is_not_text_counts_as_missing(self):
        self._as('export_manager')
        response = self.client.post(self.url, {'reason': ['x']}, format='json')
        self.assertEqual((response.status_code, response.json()['error']), (400, 'reason_required'))

    def test_rejected_trip_cannot_be_rejected_again_while_planning_has_the_reason(self):
        self._as('export_manager')
        self.client.post(self.url, {'reason': 'Нет визы KZ'}, format='json')
        response = self.client.post(self.url, {'reason': 'Паспорт истекает'}, format='json')
        self.assertEqual((response.status_code, response.json()['error']), (409, 'trip_rejected'))
        self.trip.refresh_from_db()
        self.assertEqual(self.trip.rejection_reason, 'Нет визы KZ')

    def test_reason_is_capped(self):
        self._as('export_manager')
        response = self.client.post(self.url, {'reason': 'x' * 513}, format='json')
        self.assertEqual((response.status_code, response.json()['error']), (400, 'reason_too_long'))

    def test_linked_trip_cannot_be_rejected(self):
        self._as('export_manager')
        ExternalTrip.objects.filter(pk=self.trip.pk).update(shipment=self.shipment)
        response = self.client.post(self.url, {'reason': 'x'}, format='json')
        self.assertEqual((response.status_code, response.json()['error']), (409, 'trip_linked'))

    def test_closed_trip_cannot_be_rejected(self):
        self._as('export_manager')
        ExternalTrip.objects.filter(pk=self.trip.pk).update(status='CLOSED')
        response = self.client.post(self.url, {'reason': 'x'}, format='json')
        self.assertEqual((response.status_code, response.json()['error']), (409, 'trip_closed'))

    def test_rejected_trip_cannot_be_assigned(self):
        self._as('export_manager')
        self.client.post(self.url, {'reason': 'x'}, format='json')
        response = self.client.post(f'/api/v1/transport/external-trips/{self.trip.pk}/assign/',
                                    {'shipment_id': self.shipment.pk}, format='json')
        self.assertEqual((response.status_code, response.json()['error']), (409, 'trip_rejected'))

    def test_transport_role_cannot_reject(self):
        self._as('transport')
        self.assertEqual(self.client.post(self.url, {'reason': 'x'}, format='json').status_code, 403)


class RejectTripServiceTests(TestCase):
    def test_the_service_validates_the_raw_reason(self):
        from apps.transport.services.trip_rejection import RejectionError, reject_trip
        trip = make_trip()
        user = User.objects.create_user(username='em', password='x', role='export_manager')
        for reason, code, http_status in [(None, 'reason_required', 400), ('  ', 'reason_required', 400),
                                          (['x'], 'reason_required', 400), ('x' * 513, 'reason_too_long', 400)]:
            with self.assertRaises(RejectionError) as ctx:
                reject_trip(trip, reason, user)
            self.assertEqual((ctx.exception.code, ctx.exception.http_status), (code, http_status))


class RejectionPushTests(TestCase):
    def setUp(self):
        self.trip = make_trip()

    def test_rejection_posts_to_rejection_path(self):
        client = mock.Mock(is_mock=False)
        client.post_op.return_value = (200, {})
        with mock.patch('apps.transport.tasks.get_trips_client', return_value=client):
            push_trip_update.apply(args=(self.trip.pk, 'rejection', {'eventId': 'k', 'reason': 'x'}, 'k'))
        self.assertEqual(client.post_op.call_args.args[1], 'rejection')

    def test_rejection_exhausted_retries_record_error(self):
        from apps.transport.services.trips_client import TripsApiUnavailable
        client = mock.Mock(is_mock=False)
        client.post_op.side_effect = TripsApiUnavailable('down')
        with mock.patch('apps.transport.tasks.get_trips_client', return_value=client):
            push_trip_update.apply(args=(self.trip.pk, 'rejection', {'eventId': 'k'}, 'k'))
        self.trip.refresh_from_db()
        self.assertEqual(self.trip.last_push_status, 'error')
        self.assertEqual(self.trip.last_push_error, 'rejection: PLANNING_UNAVAILABLE')

    def test_rejection_broker_failure_is_visible(self):
        from apps.transport.services.trip_push import enqueue_rejection
        with mock.patch('apps.transport.tasks.push_trip_update.delay', side_effect=ConnectionError('redis')), \
                self.captureOnCommitCallbacks(execute=True):
            enqueue_rejection(self.trip, 'x')
        self.trip.refresh_from_db()
        self.assertEqual(self.trip.last_push_error, 'rejection: PLANNING_UNAVAILABLE')
