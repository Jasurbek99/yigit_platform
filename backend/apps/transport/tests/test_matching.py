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

    def test_messy_plate_space_before_slash_no_match(self):
        # tractor token = 'AG2236' (split on the first '/' or whitespace); no Truck
        # with that plate exists, so this must fall through to 'none', not crash.
        device, how = resolve_device_for_shipment(_shipment('AG2236/ TAH2526'))
        self.assertIsNone(device)
        self.assertEqual(how, 'none')

    def test_garbage_plate_no_match(self):
        device, how = resolve_device_for_shipment(_shipment('sadas'))
        self.assertIsNone(device)
        self.assertEqual(how, 'none')

    def test_cyrillic_plate_returns_none(self):
        # 'А' here is Cyrillic (U+0410), not Latin 'A'. normalize_plate() would
        # silently strip it, so this must be rejected before normalization runs.
        device, how = resolve_device_for_shipment(_shipment('4378АHF/2602TAH'))
        self.assertIsNone(device)
        self.assertEqual(how, 'none')

    def test_cyrillic_homoglyph_does_not_collide_with_shrunken_latin_plate(self):
        # normalize_plate() drops the Cyrillic 'А', shrinking '4378АHF' -> '4378HF',
        # which would otherwise match this DIFFERENT truck's GPS if the guard didn't
        # run before normalization.
        other = Truck.objects.create(plate='4378HF', fleet_no='TR077')
        dev = TraccarDevice.objects.create(traccar_id=401, name='4378HF TR077', truck=other)
        DevicePosition.objects.create(device=dev, latitude='40.0', longitude='60.0')
        device, how = resolve_device_for_shipment(_shipment('4378АHF/2602TAH'))  # Cyrillic А
        self.assertIsNone(device)
        self.assertEqual(how, 'none')

    def test_inactive_truck_not_matched(self):
        inactive = Truck.objects.create(plate='9001ZZZ', fleet_no='TR900', is_active=False)
        TraccarDevice.objects.create(traccar_id=402, name='9001ZZZ TR900', truck=inactive)
        device, how = resolve_device_for_shipment(_shipment('9001ZZZ'))
        self.assertIsNone(device)
        self.assertEqual(how, 'none')

    def test_truck_head_id_resolves_device_first(self):
        from apps.transport.models import TruckHead
        dev = self.device  # from setUp: device linked to a Truck with a position
        th = TruckHead.objects.create(id=500, plate_number='ZZZ999', traccar_device=dev)
        shp = _shipment('somethingelse')      # plate would NOT auto-match
        shp.truck_head_id = th.id
        shp.save(update_fields=['truck_head_id'])
        device, how = resolve_device_for_shipment(shp)
        self.assertEqual(device, dev)
        self.assertEqual(how, 'auto')

    def test_truck_head_without_device_falls_through(self):
        # Discriminating: truck_plate here WOULD auto-match self.device via the
        # plate-match fallback (see test_auto_match_extracts_tractor_before_slash),
        # so this only returns 'none' if the truck_head_id guard actually blocks
        # fall-through. A mutant that removed the guard would return
        # (self.device, 'auto') instead, failing this assertion.
        from apps.transport.models import TruckHead
        th = TruckHead.objects.create(id=501, plate_number='NOGPS1', traccar_device=None)
        shp = _shipment('4378AHF/2602TAH')    # would plate-match self.device
        shp.truck_head_id = th.id
        shp.save(update_fields=['truck_head_id'])
        device, how = resolve_device_for_shipment(shp)
        self.assertIsNone(device)
        self.assertEqual(how, 'none')


class DevicePreferenceTests(TestCase):
    """_pick_device() tier coverage: position > category='truck' > first-by-name."""

    def test_tier2_prefers_category_truck_without_position(self):
        # Neither device has a DevicePosition, so tier 1 (position) is skipped.
        # The category='truck' device is named to sort AFTER the non-truck device
        # ('Z TruckDev' > 'A Other'), so tier-3's devices[0] fallback would return
        # the WRONG device ('A Other') if the tier-2 branch were removed. Asserting
        # the resolver returns 'Z TruckDev' proves tier 2 (not name order) selected it.
        truck = Truck.objects.create(plate='TIER2AAA', fleet_no='TR200')
        TraccarDevice.objects.create(traccar_id=201, name='A Other', truck=truck, category='unknown')
        truck_device = TraccarDevice.objects.create(
            traccar_id=202, name='Z TruckDev', truck=truck, category='truck',
        )
        device, how = resolve_device_for_shipment(_shipment('TIER2AAA'))
        self.assertEqual(device, truck_device)
        self.assertEqual(how, 'auto')

    def test_tier3_falls_back_to_first_by_name(self):
        # No device has a position and none is category='truck', so both earlier
        # tiers are skipped — the resolver must fall back to devices[0], which is
        # TraccarDevice.Meta.ordering = ['name'] (alphabetically first).
        truck = Truck.objects.create(plate='TIER3BBB', fleet_no='TR300')
        first_by_name = TraccarDevice.objects.create(
            traccar_id=301, name='A First', truck=truck, category='unknown',
        )
        TraccarDevice.objects.create(traccar_id=302, name='B Second', truck=truck, category=None)
        device, how = resolve_device_for_shipment(_shipment('TIER3BBB'))
        self.assertEqual(device, first_by_name)
        self.assertEqual(how, 'auto')
