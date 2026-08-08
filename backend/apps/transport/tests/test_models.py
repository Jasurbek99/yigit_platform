from django.db import IntegrityError
from django.test import TestCase

from apps.transport.models import Truck, Driver, TraccarDevice, DevicePosition


class RegistryModelTests(TestCase):
    def test_truck_plate_unique(self):
        Truck.objects.create(plate='2189AHF', fleet_no='TR038')
        with self.assertRaises(IntegrityError):
            Truck.objects.create(plate='2189AHF', fleet_no='TR999')

    def test_device_links_to_truck_and_has_position(self):
        truck = Truck.objects.create(plate='5161AHF', fleet_no='TR071')
        device = TraccarDevice.objects.create(
            traccar_id=21, imei='864275077746496',
            name='5161AHF TR071', truck=truck, status='online',
        )
        pos = DevicePosition.objects.create(
            device=device, latitude='37.544905', longitude='59.312225',
            speed='0', course='298', address='Artyk', ignition=True,
        )
        self.assertEqual(device.position, pos)
        self.assertEqual(truck.devices.first(), device)

    def test_driver_created(self):
        d = Driver.objects.create(name='Aman', phone='+99371093227')
        self.assertTrue(d.is_active)
