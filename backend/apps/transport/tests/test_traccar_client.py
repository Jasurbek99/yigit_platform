from unittest.mock import patch, MagicMock

from django.test import TestCase, override_settings

from apps.transport.services.traccar_client import TraccarClient, TraccarUnavailable


@override_settings(TRACCAR_BASE_URL='http://traccar.test', TRACCAR_TOKEN='tok')
class TraccarClientTests(TestCase):
    @patch('apps.transport.services.traccar_client.requests.get')
    def test_get_devices_returns_json(self, mock_get):
        mock_get.return_value = MagicMock(status_code=200, json=lambda: [{'id': 1}])
        mock_get.return_value.raise_for_status = lambda: None
        devices = TraccarClient().get_devices()
        self.assertEqual(devices, [{'id': 1}])
        called_url = mock_get.call_args[0][0]
        self.assertIn('/api/devices', called_url)

    @patch('apps.transport.services.traccar_client.requests.get')
    def test_network_error_raises_unavailable(self, mock_get):
        import requests
        mock_get.side_effect = requests.RequestException('boom')
        with self.assertRaises(TraccarUnavailable):
            TraccarClient().get_positions()

    @patch('apps.transport.services.traccar_client.requests.get')
    def test_non_json_response_raises_unavailable(self, mock_get):
        # requests.exceptions.JSONDecodeError (raised by response.json() on a
        # 200 with a non-JSON body) is itself a RequestException subclass, so
        # this is already caught by `except requests.RequestException` in
        # _get(). This test proves the REAL exception type from the requests
        # library converts to TraccarUnavailable end-to-end.
        import requests

        response = MagicMock(status_code=200)
        response.raise_for_status = lambda: None
        response.json.side_effect = requests.exceptions.JSONDecodeError(
            'Expecting value', 'doc', 0
        )
        mock_get.return_value = response
        with self.assertRaises(TraccarUnavailable):
            TraccarClient().get_devices()
