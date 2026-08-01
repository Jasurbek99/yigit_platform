from django.test import TestCase

from apps.core.models import Season, ShipmentStatusType
from apps.export.models import Shipment
from apps.transport.models import Truck, TraccarDevice, DevicePosition, ShipmentDeviceLink
from apps.transport.services.matching import normalize_plate, resolve_device_for_shipment


def _status():
    # 'draft' is seeded by a core data migration (0006_seed_shipment_draft_status);
    # reuse it instead of colliding with the unique `code` constraint.
    status, _ = ShipmentStatusType.objects.get_or_create(
        code='draft', defaults={'name_tk': 'D', 'step_order': 1},
    )
    return status


def _shipment(truck_plate):
    season = Season.objects.create(
        name='S', start_date='2025-09-01', end_date='2026-06-30', is_active=True,
    )
    status = _status()
    return Shipment.objects.create(
        shipment_code='X', date='2025-11-01', season=season, status=status,
        truck_plate=truck_plate,
    )


class NormalizeTests(TestCase):
    def test_strips_non_alnum_and_uppercases(self):
        self.assertEqual(normalize_plate(' 4378 ahf '), '4378AHF')
        self.assertEqual(normalize_plate(None), '')


class ResolveTests(TestCase):
    def setUp(self):
        self.truck = Truck.objects.create(plate='4378AHF', fleet_no='TR050')
        self.device = TraccarDevice.objects.create(
            traccar_id=67, name='4378AHF TR050', truck=self.truck, status='online',
        )
        DevicePosition.objects.create(
            device=self.device, latitude='37.9', longitude='58.4',
        )

    def test_auto_match_extracts_tractor_before_slash(self):
        device, how = resolve_device_for_shipment(_shipment('4378AHF/2602TAH'))
        self.assertEqual(device, self.device)
        self.assertEqual(how, 'auto')

    def test_manual_link_wins_over_auto(self):
        other_truck = Truck.objects.create(plate='9999XYZ', fleet_no='TR099')
        other = TraccarDevice.objects.create(traccar_id=99, name='9999XYZ TR099', truck=other_truck)
        shp = _shipment('4378AHF/2602TAH')
        ShipmentDeviceLink.objects.create(shipment=shp, device=other)
        device, how = resolve_device_for_shipment(shp)
        self.assertEqual(device, other)
        self.assertEqual(how, 'manual')

    def test_no_match_returns_none(self):
        device, how = resolve_device_for_shipment(_shipment('7463LBE/1779TLB'))
        self.assertIsNone(device)
        self.assertEqual(how, 'none')

    def test_blank_plate_returns_none(self):
        device, how = resolve_device_for_shipment(_shipment(''))
        self.assertIsNone(device)
        self.assertEqual(how, 'none')
