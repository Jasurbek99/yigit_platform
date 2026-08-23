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
    # Mirrors production: Z_TIRWEB stores no phone for any driver (NULL or ''),
    # and ids 99/113 are one person under two spellings, sharing a Logo code.
    c.get_drivers.return_value = [
        {'id': 5, 'full_name': 'ABRAY ANNAKULYYEW', 'phone': '', 'is_active': True,
         'logo_ref': '318', 'driver_logo_code': '195.02.A001'},
        {'id': 7, 'full_name': 'ARNAGELDIYEW ALLAYAR', 'phone': None, 'is_active': True,
         'logo_ref': '337', 'driver_logo_code': '195.02.A003'},
        {'id': 99, 'full_name': 'SALAROW TOYLY', 'phone': None, 'is_active': True,
         'logo_ref': '1664', 'driver_logo_code': '195.02.S008'},
        {'id': 113, 'full_name': 'TOYLY SALAROW', 'phone': None, 'is_active': True,
         'logo_ref': '1664', 'driver_logo_code': '195.02.S008'},
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
        self.assertEqual(result['drivers'], 4)
        self.assertEqual(Driver.objects.get(id=5).name, 'ABRAY ANNAKULYYEW')  # id preserved
        # phone/is_active are NOT in the upsert defaults — see _import_drivers.
        self.assertIsNone(Driver.objects.get(id=5).phone)
        self.assertTrue(Driver.objects.get(id=7).is_active)
        # Logo accounting identifiers carried over.
        self.assertEqual(Driver.objects.get(id=5).logo_ref, '318')
        self.assertEqual(Driver.objects.get(id=5).driver_logo_code, '195.02.A001')

    def test_import_is_idempotent(self):
        import_fleet(client=_client())
        import_fleet(client=_client())
        self.assertEqual(TruckHead.objects.count(), 2)
        self.assertEqual(Trailer.objects.count(), 1)
        self.assertEqual(Driver.objects.count(), 4)

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

    def test_same_logo_code_duplicate_is_deactivated_keeping_lowest_id(self):
        # 99 and 113 are one person spelled two ways, both on 195.02.S008.
        import_fleet(client=_client())
        self.assertTrue(Driver.objects.get(id=99).is_active)
        self.assertFalse(Driver.objects.get(id=113).is_active)
        # The row is retired, not removed — Z_TIRWEB still holds it, so a delete
        # would come back on the next import.
        self.assertTrue(Driver.objects.filter(id=113).exists())

    def test_identical_names_with_different_logo_codes_both_stay_active(self):
        # The inverse case: BATYROW BAYRAMMYRAT is two different people (ids
        # 30/31 in production) and only the codes tell them apart.
        client = _client()
        client.get_drivers.return_value = [
            {'id': 30, 'full_name': 'BATYROW BAYRAMMYRAT', 'phone': None, 'is_active': True,
             'logo_ref': '1754', 'driver_logo_code': '195.02.B010'},
            {'id': 31, 'full_name': 'BATYROW BAYRAMMYRAT', 'phone': None, 'is_active': True,
             'logo_ref': '1841', 'driver_logo_code': '195.02.B011'},
        ]
        import_fleet(client=client)
        self.assertTrue(Driver.objects.get(id=30).is_active)
        self.assertTrue(Driver.objects.get(id=31).is_active)

    def test_blank_logo_code_is_not_treated_as_sameness(self):
        client = _client()
        client.get_drivers.return_value = [
            {'id': 60, 'full_name': 'A ONE', 'phone': None, 'is_active': True,
             'logo_ref': '', 'driver_logo_code': ''},
            {'id': 61, 'full_name': 'B TWO', 'phone': None, 'is_active': True,
             'logo_ref': '', 'driver_logo_code': ''},
        ]
        import_fleet(client=client)
        self.assertTrue(Driver.objects.get(id=60).is_active)
        self.assertTrue(Driver.objects.get(id=61).is_active)
