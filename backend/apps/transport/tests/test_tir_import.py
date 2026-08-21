from unittest.mock import MagicMock

from django.test import TestCase

from apps.transport.models import TruckHead, Trailer, Truck, TraccarDevice, DevicePosition, Driver
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
    # Mirrors production: Z_TIRWEB stores no phone for any driver (NULL or '').
    c.get_drivers.return_value = [
        {'id': 5, 'full_name': 'ABRAY ANNAKULYYEW', 'phone': '', 'is_active': True},
        {'id': 7, 'full_name': 'ARNAGELDIYEW ALLAYAR', 'phone': None, 'is_active': True},
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
        self.assertEqual(result['drivers'], 2)
        self.assertEqual(Driver.objects.get(id=5).name, 'ABRAY ANNAKULYYEW')  # id preserved
        # phone/is_active are NOT in the upsert defaults — see _import_drivers.
        self.assertIsNone(Driver.objects.get(id=5).phone)
        self.assertTrue(Driver.objects.get(id=7).is_active)

    def test_import_is_idempotent(self):
        import_fleet(client=_client())
        import_fleet(client=_client())
        self.assertEqual(TruckHead.objects.count(), 2)
        self.assertEqual(Trailer.objects.count(), 1)
        self.assertEqual(Driver.objects.count(), 2)

    def test_reimport_preserves_platform_side_driver_edits(self):
        # Mirrors the TruckHead/Trailer contract documented in the fleet-map
        # caveat: a re-import refreshes `name` from the source but must not undo
        # a manual deactivate or wipe an operator-entered phone (the source has
        # none to supply).
        import_fleet(client=_client())
        Driver.objects.filter(id=5).update(phone='+99365000000', is_active=False)
        import_fleet(client=_client())
        driver = Driver.objects.get(id=5)
        self.assertEqual(driver.phone, '+99365000000')
        self.assertFalse(driver.is_active)

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
