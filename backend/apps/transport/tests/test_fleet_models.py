from django.db import IntegrityError
from django.test import TestCase

from apps.transport.models import TruckHead, Trailer, TraccarDevice


class FleetModelTests(TestCase):
    def test_truck_head_links_device_and_plate_unique(self):
        dev = TraccarDevice.objects.create(traccar_id=67, name='4378AHF TR050', status='online')
        th = TruckHead.objects.create(
            id=13, plate_number='4378AHF', owner_type='company',
            capacity='20.00', traccar_device=dev,
        )
        self.assertEqual(th.traccar_device, dev)
        self.assertTrue(th.is_active)
        with self.assertRaises(IntegrityError):
            TruckHead.objects.create(id=14, plate_number='4378AHF')

    def test_truck_head_device_set_null_on_device_delete(self):
        dev = TraccarDevice.objects.create(traccar_id=68, name='X', status='offline')
        th = TruckHead.objects.create(id=15, plate_number='9999XYZ', traccar_device=dev)
        dev.delete()
        th.refresh_from_db()
        self.assertIsNone(th.traccar_device)

    def test_trailer_plate_unique(self):
        Trailer.objects.create(id=1, plate_number='2602TAH', owner_type='company')
        with self.assertRaises(IntegrityError):
            Trailer.objects.create(id=2, plate_number='2602TAH')
