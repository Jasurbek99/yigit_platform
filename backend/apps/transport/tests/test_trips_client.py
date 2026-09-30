from datetime import datetime, timezone as dt_tz
from unittest import mock

import requests
from django.test import TestCase, override_settings

from apps.core.models import Country
from apps.transport.services.trip_parsing import parse_trip, visa_country_codes
from apps.transport.services.trips_client import (
    MockTripsClient, TripsApiUnavailable, TripsClient, get_trips_client,
)


class ParseTripTests(TestCase):
    def setUp(self):
        self.item = MockTripsClient().list_trips(None, page=1)['items'][0]

    def test_maps_nested_blocks_to_flat_fields(self):
        fields = parse_trip(self.item)
        self.assertEqual(fields['tractor_plate'], '2563AHF')
        self.assertEqual(fields['trailer_plate'], '2251TAH')
        self.assertEqual(fields['driver_passport_number'], 'A2510574')
        self.assertEqual(str(fields['driver_passport_expiry']), '2029-04-08')
        self.assertEqual(fields['driver_visas'], 'Gazagystan:2026-10-28;Russiýa:2026-10-28')
        self.assertEqual(fields['destination_country_code'], 'RU')

    def test_third_party_driver_without_passport(self):
        item = MockTripsClient().list_trips(None, page=1)['items'][2]
        fields = parse_trip(item)
        self.assertIsNone(fields['driver_passport_number'])
        self.assertIsNone(fields['driver_passport_expiry'])
        self.assertEqual(fields['driver_visas'], '')


class VisaCountryTests(TestCase):
    def setUp(self):
        Country.objects.create(code='KZ', name_tk='GAZAGYSTAN')
        Country.objects.create(code='RU', name_tk='RUSSIYA')
        Country.objects.create(code='UZ', name_tk='OZBEKYSTAN')

    def test_maps_turkmen_names_including_alias(self):
        self.assertEqual(
            visa_country_codes('Gazagystan:2027-01-31;Özbegistan:2027-03-07;Russiýa:2027-06-07'),
            ['KZ', 'UZ', 'RU'],
        )

    def test_unrecognised_visa_is_reported(self):
        from apps.transport.services.trip_parsing import has_unrecognised_visa
        self.assertTrue(has_unrecognised_visa('Eýran Yslam Respublikasy:2999-01-01'))
        self.assertFalse(has_unrecognised_visa('Gazagystan:2999-01-01'))
        self.assertFalse(has_unrecognised_visa(''))

    def test_expired_visa_does_not_count(self):
        self.assertEqual(visa_country_codes('Russiýa:2000-01-01;Gazagystan:2999-01-01'), ['KZ'])

    def test_unknown_name_is_skipped_not_guessed(self):
        self.assertEqual(visa_country_codes('Eýran Yslam Respublikasy:2026-12-18'), [])


class LiveClientTests(TestCase):
    @override_settings(TRANSPORT_API_KEY='Bearer abc', TRANSPORT_API_URL='https://x/api/v1/external')
    @mock.patch('apps.transport.services.trips_client.requests.request')
    def test_strips_bearer_prefix_and_sends_changed_since(self, request):
        request.return_value = mock.Mock(status_code=200, json=lambda: {'items': [], 'total': 0})
        TripsClient().list_trips(datetime(2026, 9, 29, 10, 0, tzinfo=dt_tz.utc), page=2)
        _, kwargs = request.call_args
        self.assertEqual(kwargs['headers']['Authorization'], 'Bearer abc')
        self.assertEqual(kwargs['params']['page'], 2)
        self.assertEqual(kwargs['params']['changedSince'], '2026-09-29T10:00:00+00:00')

    @mock.patch('apps.transport.services.trips_client.requests.request',
                side_effect=requests.ConnectionError('down'))
    def test_network_error_raises_unavailable(self, _):
        with self.assertRaises(TripsApiUnavailable):
            TripsClient().get_trip('x')

    @mock.patch('apps.transport.services.trips_client.requests.request')
    def test_post_op_returns_4xx_instead_of_raising(self, request):
        request.return_value = mock.Mock(status_code=409, json=lambda: {'code': 'TRIP_CLOSED'})
        status, body = TripsClient().post_op('u', 'export-code', {}, 'k')
        self.assertEqual((status, body['code']), (409, 'TRIP_CLOSED'))


class FactoryTests(TestCase):
    @override_settings(TRANSPORT_API_MODE='mock')
    def test_mock_mode_returns_mock_client(self):
        self.assertTrue(get_trips_client().is_mock)

    def test_mock_filters_by_changed_since(self):
        since = datetime(2026, 9, 29, 11, 0, tzinfo=dt_tz.utc)
        items = MockTripsClient().list_trips(since, page=1)['items']
        self.assertEqual(len(items), 3)  # 11:00:30, 11:01:10, 11:02:11


class TlsVerifySettingTests(TestCase):
    def test_true_false_and_path(self):
        from apps.transport.services.trips_client import tls_verify
        self.assertIs(tls_verify('true'), True)
        self.assertIs(tls_verify('1'), True)
        self.assertIs(tls_verify('false'), False)
        self.assertIs(tls_verify(''), False)
        self.assertEqual(tls_verify('C:/certs/planning.pem'), 'C:/certs/planning.pem')
