from unittest.mock import MagicMock

from django.test import TestCase

from apps.transport.models import TruckHead, Trailer, Truck, TraccarDevice, DevicePosition
from apps.transport.services.tir_import import import_fleet


def _client():
    c = MagicMock()
    c.get_truck_heads.return_value = [
        {'id': 13, 'plate_number': '3269AHF', 'owner_type': 'company',
         'owner_name': '', 'status': 'idle', 'capacity': 20},
        {'id': 124, 'plate_number': '4470AHF', 'owner_type': 'company',
         'owner_name': '', 'status': 'idle', 'capacity': None},
    ]
    c.get_trailers.return_value = [
        {'id': 1, 'plate_number': '2602TAH', 'owner_type': 'company', 'status': 'idle'},
    ]
    return c


class ImportFleetTests(TestCase):
    def test_import_preserves_ids_and_links_device_by_plate(self):
        # In production, sync_devices() always attaches a Truck to every
        # TraccarDevice — mirror that here rather than an orphan device.
        truck = Truck.objects.create(plate='3269AHF', fleet_no='TR013')
        TraccarDevice.objects.create(traccar_id=999, name='3269AHF TR013', truck=truck, status='online')
        result = import_fleet(client=_client())
        self.assertEqual(result['truck_heads'], 2)
        self.assertEqual(result['trailers'], 1)
        th = TruckHead.objects.get(id=13)  # id preserved
        self.assertEqual(th.plate_number, '3269AHF')
        self.assertIsNotNone(th.traccar_device)          # matched by plate
        self.assertIsNone(TruckHead.objects.get(id=124).traccar_device)  # no device
        self.assertEqual(Trailer.objects.get(id=1).plate_number, '2602TAH')

    def test_import_is_idempotent(self):
        import_fleet(client=_client())
        import_fleet(client=_client())
        self.assertEqual(TruckHead.objects.count(), 2)
        self.assertEqual(Trailer.objects.count(), 1)

    def test_new_create_after_import_does_not_collide(self):
        import_fleet(client=_client())  # imports ids 13, 124
        fresh = TruckHead.objects.create(plate_number='5555AHF')  # app-assigned id
        self.assertGreater(fresh.id, 124)

    def test_multi_device_truck_binds_position_bearing_device(self):
        # One Truck with two devices. 'Z Other' sorts AFTER 'A Positioned'
        # alphabetically (TraccarDevice.Meta.ordering = ['name']), so the old
        # last-write-wins-by-name index would have bound 'Z Other'. The new
        # _pick_device() resolution must prefer the device WITH a position,
        # regardless of name order.
        truck = Truck.objects.create(plate='3269AHF', fleet_no='TR013')
        positioned = TraccarDevice.objects.create(traccar_id=1001, name='A Positioned', truck=truck)
        DevicePosition.objects.create(device=positioned, latitude='40.0', longitude='60.0')
        TraccarDevice.objects.create(traccar_id=1002, name='Z Other', truck=truck)
        import_fleet(client=_client())
        th = TruckHead.objects.get(id=13)
        self.assertEqual(th.traccar_device_id, positioned.id)
