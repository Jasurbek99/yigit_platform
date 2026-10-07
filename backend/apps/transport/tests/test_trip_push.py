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
        self.assertEqual(body['place'], {'ref': 'B3', 'name': 'Blok B3, Blok A1'})


    def test_pending_correction_pushes_once_per_code(self):
        from apps.transport.services.trip_push import loading_signature, push_pending_corrections
        # Loading already sent: this test is about the export-code op alone.
        ExternalTrip.objects.filter(pk=self.trip.pk).update(
            shipment=self.shipment, last_pushed_loading=loading_signature(self.shipment))
        with mock.patch('apps.transport.tasks.push_trip_update.delay') as delay, \
                self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(push_pending_corrections(), 1)
            self.assertEqual(push_pending_corrections(), 0)
        self.assertEqual(delay.call_count, 1)

    def test_corrected_code_is_pushed_again(self):
        from apps.transport.services.trip_push import loading_signature, push_pending_corrections
        ExternalTrip.objects.filter(pk=self.trip.pk).update(
            shipment=self.shipment, last_pushed_export_code='OLD',
            last_pushed_loading=loading_signature(self.shipment))
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
    def test_assign_enqueues_every_op(self):
        from django.contrib.auth import get_user_model

        from apps.transport.services.trip_assignment import assign_trip
        from apps.transport.services.trip_push import PUSH_OPS
        kz = Country.objects.create(code='KZ', name_tk='GAZAGYSTAN')
        shipment = _make_shipment(country=kz, export_code='04AP034/26')
        user = get_user_model().objects.create_user(username='em', password='x', role='export_manager')
        with mock.patch('apps.transport.services.trip_assignment.enqueue_push') as enqueue:
            assign_trip(make_trip(), shipment, user)
        self.assertEqual([c.args[1] for c in enqueue.call_args_list], list(PUSH_OPS))


class PushFailureTests(TestCase):
    def setUp(self):
        self.trip = make_trip()
        ExternalTrip.objects.filter(pk=self.trip.pk).update(last_pushed_export_code='04AP034/26')

    def _run(self, client, op, key):
        with mock.patch('apps.transport.tasks.get_trips_client', return_value=client):
            push_trip_update.apply(args=(self.trip.pk, op, {'eventId': key}, key))
        self.trip.refresh_from_db()

    def test_exhausted_retries_forget_the_pushed_code_so_the_next_tick_resends(self):
        from apps.transport.services.trips_client import TripsApiUnavailable
        client = mock.Mock(is_mock=False)
        client.post_op.side_effect = TripsApiUnavailable('down')
        self._run(client, 'export-code', 'k')
        self.assertIsNone(self.trip.last_pushed_export_code)
        self.assertEqual(self.trip.last_push_status, 'error')

    def test_loading_ok_does_not_wipe_an_export_code_error(self):
        client = mock.Mock(is_mock=False)
        client.post_op.return_value = (409, {'code': 'DUPLICATE_EXPORT_CODE'})
        self._run(client, 'export-code', 'a')
        client.post_op.return_value = (200, {})
        self._run(client, 'loading', 'b')
        self.assertEqual(self.trip.last_push_status, 'error')
        self.assertIn('DUPLICATE_EXPORT_CODE', self.trip.last_push_error)

    def test_refusal_keeps_the_marker_so_it_is_not_resent_every_tick(self):
        client = mock.Mock(is_mock=False)
        client.post_op.return_value = (409, {'code': 'DUPLICATE_EXPORT_CODE'})
        self._run(client, 'export-code', 'a')
        self.assertEqual(self.trip.last_pushed_export_code, '04AP034/26')

    def test_duplicate_code_notifies_export_managers(self):
        from apps.export.models import Notification
        get_user_model().objects.create_user(username='em', password='x', role='export_manager')
        client = mock.Mock(is_mock=False)
        client.post_op.return_value = (409, {'code': 'DUPLICATE_EXPORT_CODE'})
        self._run(client, 'export-code', 'a')
        self.assertTrue(Notification.objects.filter(user__username='em').exists())


class LoadingCorrectionTests(TestCase):
    def setUp(self):
        self.shipment = _make_shipment(loading_location=LoadingLocation.objects.create(name='Ahal'))
        ShipmentBlockSource.objects.create(
            shipment=self.shipment, block=GreenhouseBlock.objects.create(code='A1', name='Blok A1'), weight_kg=1000)
        self.trip = make_trip()
        ExternalTrip.objects.filter(pk=self.trip.pk).update(shipment=self.shipment)

    def _ops_pushed(self):
        from apps.transport.services.trip_push import push_pending_corrections
        with mock.patch('apps.transport.services.trip_push.enqueue_push') as enqueue:
            push_pending_corrections()
        return [c.args[1] for c in enqueue.call_args_list]

    def test_changed_blocks_are_pushed_once(self):
        from apps.transport.services.trip_push import loading_signature
        ExternalTrip.objects.filter(pk=self.trip.pk).update(
            last_pushed_loading=loading_signature(self.shipment))
        self.assertEqual(self._ops_pushed(), [])
        ShipmentBlockSource.objects.create(
            shipment=self.shipment, block=GreenhouseBlock.objects.create(code='B2', name='Blok B2'), weight_kg=500)
        self.assertEqual(self._ops_pushed(), ['loading'])

    def test_enqueue_records_the_loading_signature(self):
        from apps.transport.services.trip_push import enqueue_push, loading_signature
        trip = ExternalTrip.objects.select_related('shipment').get(pk=self.trip.pk)
        with mock.patch('apps.transport.tasks.push_trip_update.delay'), self.captureOnCommitCallbacks(execute=True):
            enqueue_push(trip, 'loading')
        trip.refresh_from_db()
        self.assertEqual(trip.last_pushed_loading, loading_signature(self.shipment))


class CorrectionQueryCountTests(TestCase):
    def test_query_count_does_not_grow_with_trips(self):
        from apps.transport.services.trip_push import loading_signature, push_pending_corrections
        location = LoadingLocation.objects.create(name='Ahal')
        block = GreenhouseBlock.objects.create(code='A1', name='Blok A1')
        uuids = ['89f2783b-e7e9-47ba-9884-8fe7bf34f1bd', 'b242b4de-a941-4dba-899e-3b0235e9f4ec',
                 '052752a7-a810-4c69-8d3b-dc1d02f925ce']
        for n, uuid in enumerate(uuids):
            shipment = _make_shipment(code=f'Q-{n}', loading_location=location, export_code=f'C{n}')
            ShipmentBlockSource.objects.create(shipment=shipment, block=block, weight_kg=100)
            make_trip(integration_trip_id=uuid)
            ExternalTrip.objects.filter(integration_trip_id=uuid).update(
                shipment=shipment, last_pushed_export_code=f'C{n}', last_pushed_loading=loading_signature(shipment))
        with self.assertNumQueries(3):  # trips+shipments, block_sources, blocks
            self.assertEqual(push_pending_corrections(), 0)


class DestinationAndCargoTests(TestCase):
    def setUp(self):
        from apps.core.models import City, ProductType
        kz = Country.objects.create(code='KZ', name_tk='GAZAGYSTAN')
        self.pepper = ProductType.objects.get(code='pepper')  # seeded by core/0074
        self.shipment = _make_shipment(city=City.objects.create(country=kz, name='Almaty'),
                                       product_type=self.pepper)
        self.trip = make_trip()

    def test_destination_city_body(self):
        from apps.transport.services.trip_push import destination_city_body
        self.assertEqual(destination_city_body(self.shipment), {'city': 'Almaty'})

    def test_no_city_means_no_push(self):
        from apps.transport.services.trip_push import destination_city_body
        self.shipment.city = None
        self.assertIsNone(destination_city_body(self.shipment))

    def test_cargo_body_uses_russian_name_and_code(self):
        from apps.transport.services.trip_push import cargo_body
        self.assertEqual(cargo_body(self.shipment), {'cargoName': 'Перец сладкий свежий', 'cargoRef': 'pepper'})

    def test_cargo_body_falls_back_to_name_and_omits_missing_code(self):
        from apps.transport.services.trip_push import cargo_body
        self.pepper.name_ru, self.pepper.code = None, None
        self.assertEqual(cargo_body(self.shipment), {'cargoName': self.pepper.name})

    def test_no_product_means_no_push(self):
        from apps.transport.services.trip_push import cargo_body
        self.shipment.product_type = None
        self.assertIsNone(cargo_body(self.shipment))

    def test_pending_corrections_cover_city_and_cargo(self):
        from apps.transport.services.trip_push import push_pending_corrections
        ExternalTrip.objects.filter(pk=self.trip.pk).update(shipment=self.shipment)
        with mock.patch('apps.transport.services.trip_push.enqueue_push') as enqueue:
            push_pending_corrections()
        self.assertEqual(sorted(c.args[1] for c in enqueue.call_args_list), ['cargo', 'destination-city'])

    def test_unchanged_city_and_cargo_are_not_pushed_again(self):
        from apps.transport.services.trip_push import push_pending_corrections
        ExternalTrip.objects.filter(pk=self.trip.pk).update(
            shipment=self.shipment, last_pushed_destination_city='Almaty',
            last_pushed_cargo='Перец сладкий свежий|pepper')
        with mock.patch('apps.transport.services.trip_push.enqueue_push') as enqueue:
            push_pending_corrections()
        enqueue.assert_not_called()

    def test_enqueue_sends_envelope_and_city(self):
        from apps.transport.services.trip_push import enqueue_push
        ExternalTrip.objects.filter(pk=self.trip.pk).update(shipment=self.shipment)
        linked = ExternalTrip.objects.select_related('shipment__city').get(pk=self.trip.pk)
        with mock.patch('apps.transport.tasks.push_trip_update.delay') as delay,                 self.captureOnCommitCallbacks(execute=True):
            enqueue_push(linked, 'destination-city')
        trip_id, op, body, event_id = delay.call_args.args
        self.assertEqual((trip_id, op), (self.trip.pk, 'destination-city'))
        self.assertEqual((body['city'], body['source'], body['eventId']), ('Almaty', 'EXTERNAL', event_id))
        linked.refresh_from_db()
        self.assertEqual(linked.last_pushed_destination_city, 'Almaty')

    def test_release_clears_every_marker(self):
        from apps.transport.services.trip_assignment import RELEASED_TRIP_COLUMNS
        from apps.transport.services.trip_push import PUSH_OPS
        self.assertTrue({push.marker for push in PUSH_OPS.values()} <= set(RELEASED_TRIP_COLUMNS))
