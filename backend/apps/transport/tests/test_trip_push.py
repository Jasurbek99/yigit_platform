from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from apps.core.models import Country, GreenhouseBlock, LoadingLocation
from apps.export.models import ShipmentBlockSource
from apps.transport.models import ExternalTrip
from apps.transport.services.trip_push import build_event, export_code_body, loading_body
from apps.transport.tasks import push_trip_update
from apps.transport.tests.test_trip_assignment import make_trip
from apps.transport.tests.test_trip_sync import _make_shipment


class PushBodyTests(TestCase):
    def setUp(self):
        self.shipment = _make_shipment(export_code='04AP034/26',
                                       loading_location=LoadingLocation.objects.create(name='Ahal'))
        for code in ('B3', 'A1'):
            ShipmentBlockSource.objects.create(
                shipment=self.shipment, block=GreenhouseBlock.objects.create(code=code, name=f'Blok {code}'),
                weight_kg=1000)
        self.trip = make_trip()

    def test_event_id_is_idempotency_key_and_changes_per_enqueue(self):
        first, occurred = build_event(self.trip, 'export-code', 1000)
        second, _ = build_event(self.trip, 'export-code', 2000)
        self.assertEqual(first, f'ygt-{self.trip.integration_trip_id}-export-code-1000')
        self.assertNotEqual(first, second)
        self.assertIn('+00:00', occurred)

    def test_export_code_body(self):
        body = export_code_body(self.shipment)
        self.assertEqual(body['exportCode'], '04AP034/26')

    def test_no_export_code_means_no_push(self):
        self.shipment.export_code = None
        self.assertIsNone(export_code_body(self.shipment))

    def test_loading_body_joins_blocks_in_source_order(self):
        body = loading_body(self.shipment)
        self.assertEqual(body['city'], 'Ahal')
        self.assertEqual(body['place'], {'ref': 'B3', 'name': 'B3, A1'})


    def test_pending_correction_pushes_once_per_code(self):
        from apps.transport.services.trip_push import push_pending_corrections
        ExternalTrip.objects.filter(pk=self.trip.pk).update(shipment=self.shipment)
        with mock.patch('apps.transport.tasks.push_trip_update.delay') as delay, \
                self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(push_pending_corrections(), 1)
            self.assertEqual(push_pending_corrections(), 0)
        self.assertEqual(delay.call_count, 1)

    def test_corrected_code_is_pushed_again(self):
        from apps.transport.services.trip_push import push_pending_corrections
        ExternalTrip.objects.filter(pk=self.trip.pk).update(
            shipment=self.shipment, last_pushed_export_code='OLD')
        with mock.patch('apps.transport.services.trip_push.enqueue_push') as enqueue:
            self.assertEqual(push_pending_corrections(), 1)
        enqueue.assert_called_once()


class PushTaskTests(TestCase):
    def setUp(self):
        self.trip = make_trip()

    def _run(self, status_code, payload):
        client = mock.Mock(is_mock=False)
        client.post_op.return_value = (status_code, payload)
        with mock.patch('apps.transport.tasks.get_trips_client', return_value=client):
            push_trip_update.apply(args=(self.trip.pk, 'export-code', {'eventId': 'k'}, 'k'))
        self.trip.refresh_from_db()
        return client

    def test_ok(self):
        self._run(200, {'accepted': True})
        self.assertEqual(self.trip.last_push_status, 'ok')

    def test_trip_closed_gives_up(self):
        self._run(409, {'code': 'TRIP_CLOSED'})
        self.assertEqual(self.trip.last_push_status, 'closed')

    def test_duplicate_code_is_an_error_for_people(self):
        self._run(409, {'code': 'DUPLICATE_EXPORT_CODE'})
        self.assertEqual(self.trip.last_push_status, 'error')
        self.assertIn('DUPLICATE_EXPORT_CODE', self.trip.last_push_error)

    def test_retry_reuses_the_same_key(self):
        client = mock.Mock(is_mock=False)
        from apps.transport.services.trips_client import TripsApiUnavailable
        client.post_op.side_effect = [TripsApiUnavailable('down'), (200, {})]
        with mock.patch('apps.transport.tasks.get_trips_client', return_value=client):
            push_trip_update.apply(args=(self.trip.pk, 'export-code', {'eventId': 'k'}, 'k'))
        keys = [call.args[3] for call in client.post_op.call_args_list]
        self.assertEqual(keys, ['k', 'k'])


class AssignEnqueuesPushesTests(TestCase):
    def test_assign_enqueues_export_code_and_loading(self):
        from django.contrib.auth import get_user_model

        from apps.transport.services.trip_assignment import assign_trip
        kz = Country.objects.create(code='KZ', name_tk='GAZAGYSTAN')
        shipment = _make_shipment(country=kz, export_code='04AP034/26')
        user = get_user_model().objects.create_user(username='em', password='x', role='export_manager')
        with mock.patch('apps.transport.services.trip_assignment.enqueue_push') as enqueue:
            assign_trip(make_trip(), shipment, user)
        self.assertEqual([c.args[1] for c in enqueue.call_args_list], ['export-code', 'loading'])
