from unittest.mock import patch
from io import StringIO

from django.core.management import call_command
from django.test import TestCase


class CommandTests(TestCase):
    @patch('apps.transport.management.commands.poll_traccar_positions.sync_positions', return_value=7)
    @patch('apps.transport.management.commands.poll_traccar_positions.sync_devices', return_value=95)
    def test_poll_reports_count(self, mock_sync_devices, mock_sync_positions):
        out = StringIO()
        call_command('poll_traccar_positions', stdout=out)
        mock_sync_devices.assert_called_once()
        mock_sync_positions.assert_called_once()
        output = out.getvalue()
        self.assertIn('95', output)
        self.assertIn('7', output)

    @patch('apps.transport.management.commands.seed_traccar_devices.sync_devices', return_value=95)
    def test_seed_reports_count(self, mock_sync):
        out = StringIO()
        call_command('seed_traccar_devices', stdout=out)
        mock_sync.assert_called_once()
        self.assertIn('95', out.getvalue())

    @patch('apps.transport.management.commands.poll_traccar_positions.sync_positions')
    @patch('apps.transport.management.commands.poll_traccar_positions.sync_devices')
    def test_poll_handles_traccar_unavailable_from_sync_devices(self, mock_sync_devices, mock_sync_positions):
        from apps.transport.services.traccar_client import TraccarUnavailable
        mock_sync_devices.side_effect = TraccarUnavailable('down')
        out = StringIO()
        call_command('poll_traccar_positions', stdout=out)  # must not raise
        self.assertIn('unavailable', out.getvalue().lower())
        mock_sync_positions.assert_not_called()

    @patch('apps.transport.management.commands.poll_traccar_positions.sync_positions')
    @patch('apps.transport.management.commands.poll_traccar_positions.sync_devices', return_value=95)
    def test_poll_handles_traccar_unavailable_from_sync_positions(self, mock_sync_devices, mock_sync_positions):
        from apps.transport.services.traccar_client import TraccarUnavailable
        mock_sync_positions.side_effect = TraccarUnavailable('down')
        out = StringIO()
        call_command('poll_traccar_positions', stdout=out)  # must not raise
        self.assertIn('unavailable', out.getvalue().lower())
