from unittest.mock import MagicMock

from django.test import TestCase

from apps.transport.models import Truck, TraccarDevice, DevicePosition
from apps.transport.services.sync import parse_device_name, sync_devices, sync_positions


class ParseNameTests(TestCase):
    def test_splits_plate_and_fleet(self):
        self.assertEqual(parse_device_name('2189AHF TR038'), ('2189AHF', 'TR038'))

    def test_no_fleet_token(self):
        self.assertEqual(parse_device_name('1780TAH'), ('1780TAH', None))

    def test_trims_whitespace(self):
        self.assertEqual(parse_device_name('  6247 TAH  '), ('6247 TAH', None))


class SyncTests(TestCase):
    def _client(self):
        client = MagicMock()
        client.get_devices.return_value = [
            {'id': 74, 'uniqueId': '864275077741745', 'name': '2189AHF TR038',
             'category': None, 'status': 'online', 'lastUpdate': '2026-07-12T00:27:24.226+00:00'},
        ]
        client.get_positions.return_value = [
            {'deviceId': 74, 'latitude': 37.9734, 'longitude': 58.4925, 'speed': 0,
             'course': 298, 'address': 'Artyk', 'valid': True,
             'fixTime': '2026-07-30T05:26:28.060+00:00',
             'attributes': {'ignition': True}},
        ]
        return client

    def test_sync_devices_creates_truck_and_device(self):
        count = sync_devices(client=self._client())
        self.assertEqual(count, 1)
        self.assertEqual(Truck.objects.get(plate='2189AHF').fleet_no, 'TR038')
        self.assertEqual(TraccarDevice.objects.get(traccar_id=74).status, 'online')

    def test_sync_positions_upserts_one_row_per_device(self):
        sync_devices(client=self._client())
        sync_positions(client=self._client())
        sync_positions(client=self._client())  # second poll must not duplicate
        self.assertEqual(DevicePosition.objects.count(), 1)
        pos = DevicePosition.objects.get()
        self.assertEqual(pos.ignition, True)
        self.assertEqual(str(pos.address), 'Artyk')

    def test_sync_positions_skips_position_without_device_row(self):
        # position references device 74 but no TraccarDevice exists yet
        written = sync_positions(client=self._client())
        self.assertEqual(written, 0)
        self.assertEqual(DevicePosition.objects.count(), 0)
