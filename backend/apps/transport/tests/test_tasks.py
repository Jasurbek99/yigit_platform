from unittest.mock import patch

from django.test import TestCase

from apps.transport.services.traccar_client import TraccarUnavailable


class PollTraccarTaskTests(TestCase):
    @patch('apps.transport.tasks.sync_positions', return_value=7)
    @patch('apps.transport.tasks.sync_devices', return_value=95)
    def test_poll_traccar_calls_both_syncs_and_returns_counts(self, mock_sync_devices, mock_sync_positions):
        from apps.transport.tasks import poll_traccar

        result = poll_traccar()

        mock_sync_devices.assert_called_once()
        mock_sync_positions.assert_called_once()
        self.assertEqual(result, {'devices': 95, 'positions': 7, 'ok': True})

    @patch('apps.transport.tasks.sync_positions')
    @patch('apps.transport.tasks.sync_devices')
    def test_poll_traccar_handles_traccar_unavailable_without_raising(self, mock_sync_devices, mock_sync_positions):
        from apps.transport.tasks import poll_traccar

        mock_sync_devices.side_effect = TraccarUnavailable('down')

        result = poll_traccar()  # must not raise

        mock_sync_positions.assert_not_called()
        self.assertEqual(result, {'devices': 0, 'positions': 0, 'ok': False})
