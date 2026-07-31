from unittest.mock import patch
from io import StringIO

from django.core.management import call_command
from django.test import TestCase


class CommandTests(TestCase):
    @patch('apps.transport.management.commands.poll_traccar_positions.sync_positions', return_value=7)
    def test_poll_reports_count(self, mock_sync):
        out = StringIO()
        call_command('poll_traccar_positions', stdout=out)
        mock_sync.assert_called_once()
        self.assertIn('7', out.getvalue())

    @patch('apps.transport.management.commands.seed_traccar_devices.sync_devices', return_value=95)
    def test_seed_reports_count(self, mock_sync):
        out = StringIO()
        call_command('seed_traccar_devices', stdout=out)
        mock_sync.assert_called_once()
        self.assertIn('95', out.getvalue())

    @patch('apps.transport.management.commands.poll_traccar_positions.sync_positions')
    def test_poll_handles_traccar_unavailable(self, mock_sync):
        from apps.transport.services.traccar_client import TraccarUnavailable
        mock_sync.side_effect = TraccarUnavailable('down')
        out = StringIO()
        call_command('poll_traccar_positions', stdout=out)  # must not raise
        self.assertIn('unavailable', out.getvalue().lower())
