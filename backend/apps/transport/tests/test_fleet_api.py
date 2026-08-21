from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.transport.models import TruckHead, TraccarDevice, Truck, DevicePosition, Trailer, Driver

User = get_user_model()


class TruckHeadApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.editor = User.objects.create_user(username='mgr', password='x', role='export_manager')
        self.viewer = User.objects.create_user(username='op', password='x', role='sales_rep')
        truck = Truck.objects.create(plate='4378AHF', fleet_no='TR050')
        self.device = TraccarDevice.objects.create(traccar_id=67, name='4378AHF TR050', truck=truck, status='online')
        DevicePosition.objects.create(device=self.device, latitude='37.9', longitude='58.4')
        TruckHead.objects.create(id=13, plate_number='3269AHF', owner_type='company', traccar_device=self.device)
        TruckHead.objects.create(id=14, plate_number='9999XYZ', owner_type='company', is_active=False)

    def test_list_requires_auth(self):
        self.assertEqual(self.client.get('/api/v1/transport/truck-heads/').status_code, 401)

    def test_list_returns_active_with_has_gps_and_search(self):
        self.client.force_authenticate(self.viewer)
        rows = self.client.get('/api/v1/transport/truck-heads/').json()
        plates = {r['plate_number'] for r in rows}
        self.assertIn('3269AHF', plates)
        self.assertNotIn('9999XYZ', plates)          # inactive omitted
        row = next(r for r in rows if r['plate_number'] == '3269AHF')
        self.assertTrue(row['has_gps'])
        # search
        rows2 = self.client.get('/api/v1/transport/truck-heads/?search=3269').json()
        self.assertEqual([r['plate_number'] for r in rows2], ['3269AHF'])

    def test_create_requires_editor_role(self):
        self.client.force_authenticate(self.viewer)
        r = self.client.post('/api/v1/transport/truck-heads/', {'plate_number': '5555AHF'}, format='json')
        self.assertEqual(r.status_code, 403)

    def test_create_matches_device_by_plate_and_avoids_id_collision(self):
        self.client.force_authenticate(self.editor)
        r = self.client.post('/api/v1/transport/truck-heads/', {'plate_number': '4378AHF'}, format='json')
        self.assertEqual(r.status_code, 201)
        th = TruckHead.objects.get(plate_number='4378AHF')
        self.assertEqual(th.traccar_device, self.device)   # matched by plate
        self.assertGreater(th.id, 14)                       # no collision with imported ids

    def test_deactivate_via_patch(self):
        self.client.force_authenticate(self.editor)
        r = self.client.patch('/api/v1/transport/truck-heads/13/', {'is_active': False}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertFalse(TruckHead.objects.get(id=13).is_active)

    def test_create_with_cyrillic_homoglyph_plate_does_not_match_device(self):
        self.client.force_authenticate(self.editor)
        # Distractor: a REAL Latin truck+device whose plate is what '4378АHF'
        # (Cyrillic 'А') would shrink to if normalize_plate() ran without the
        # Cyrillic guard first. Must NOT be matched.
        latin_truck = Truck.objects.create(plate='4378HF', fleet_no='TR077')
        collide_device = TraccarDevice.objects.create(
            traccar_id=402, name='4378HF TR077', truck=latin_truck, status='online',
        )
        r = self.client.post(
            '/api/v1/transport/truck-heads/', {'plate_number': '4378АHF'}, format='json',
        )  # 'А' here is Cyrillic (U+0410), not Latin 'A'
        self.assertEqual(r.status_code, 201)
        th = TruckHead.objects.get(plate_number='4378АHF')
        self.assertIsNone(th.traccar_device)
        self.assertNotEqual(th.traccar_device, collide_device)

    def test_patch_plate_change_rematches_device(self):
        self.client.force_authenticate(self.editor)
        other_truck = Truck.objects.create(plate='7777ZZZ', fleet_no='TR777')
        other_device = TraccarDevice.objects.create(
            traccar_id=777, name='7777ZZZ TR777', truck=other_truck, status='online',
        )
        r = self.client.patch(
            '/api/v1/transport/truck-heads/13/', {'plate_number': '7777ZZZ'}, format='json',
        )
        self.assertEqual(r.status_code, 200)
        th = TruckHead.objects.get(id=13)
        self.assertEqual(th.traccar_device, other_device)

    def test_include_inactive_lists_inactive_rows(self):
        self.client.force_authenticate(self.viewer)
        # default: active only
        default = self.client.get('/api/v1/transport/truck-heads/').json()
        self.assertNotIn('9999XYZ', {r['plate_number'] for r in default})
        # include_inactive=true: inactive shown
        allrows = self.client.get('/api/v1/transport/truck-heads/?include_inactive=true').json()
        self.assertIn('9999XYZ', {r['plate_number'] for r in allrows})

    def test_patch_with_unchanged_plate_does_not_rematch_device(self):
        # Admin edit modal always sends plate_number, even when only editing
        # another field. Sending the SAME plate must not re-run the matcher
        # (and must not clear a working GPS link if the matcher would return
        # None today).
        self.client.force_authenticate(self.editor)
        with patch('apps.transport.serializers.device_for_plate') as mock_match:
            r = self.client.patch(
                '/api/v1/transport/truck-heads/13/',
                {'plate_number': '3269AHF', 'capacity': '20000.00'},
                format='json',
            )
        self.assertEqual(r.status_code, 200)
        mock_match.assert_not_called()
        th = TruckHead.objects.get(id=13)
        self.assertEqual(th.traccar_device, self.device)
        self.assertEqual(str(th.capacity), '20000.00')

    def test_patch_with_changed_plate_calls_device_for_plate_once(self):
        self.client.force_authenticate(self.editor)
        with patch('apps.transport.serializers.device_for_plate') as mock_match:
            mock_match.return_value = None
            r = self.client.patch(
                '/api/v1/transport/truck-heads/13/', {'plate_number': '7777ZZZ'}, format='json',
            )
        self.assertEqual(r.status_code, 200)
        mock_match.assert_called_once_with('7777ZZZ')
        # The changed plate is saved and the device is re-matched to whatever
        # device_for_plate returned — here None, so a stale link is cleared
        # (truck 13 started linked to self.device). Asserting the effect, not
        # just the call, guards against a regression that keeps the old device.
        th = TruckHead.objects.get(id=13)
        self.assertEqual(th.plate_number, '7777ZZZ')
        self.assertIsNone(th.traccar_device)


class TrailerApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.editor = User.objects.create_user(username='mgr2', password='x', role='director')
        self.viewer = User.objects.create_user(username='op2', password='x', role='sales_rep')
        Trailer.objects.create(id=1, plate_number='2602TAH', owner_type='company')
        Trailer.objects.create(id=2, plate_number='9000ZZZ', owner_type='company', is_active=False)

    def test_list_active_only_and_search(self):
        self.client.force_authenticate(self.viewer)
        rows = self.client.get('/api/v1/transport/trailers/').json()
        plates = {r['plate_number'] for r in rows}
        self.assertIn('2602TAH', plates)
        self.assertNotIn('9000ZZZ', plates)
        rows2 = self.client.get('/api/v1/transport/trailers/?search=2602').json()
        self.assertEqual([r['plate_number'] for r in rows2], ['2602TAH'])

    def test_create_requires_editor_role(self):
        self.client.force_authenticate(self.viewer)
        self.assertEqual(
            self.client.post('/api/v1/transport/trailers/', {'plate_number': '3TAH'}, format='json').status_code,
            403,
        )

    def test_editor_creates_and_deactivates(self):
        self.client.force_authenticate(self.editor)
        r = self.client.post('/api/v1/transport/trailers/', {'plate_number': '5TAH'}, format='json')
        self.assertEqual(r.status_code, 201)
        tid = r.json()['id']
        d = self.client.patch(f'/api/v1/transport/trailers/{tid}/', {'is_active': False}, format='json')
        self.assertEqual(d.status_code, 200)
        self.assertFalse(Trailer.objects.get(id=tid).is_active)

    def test_include_inactive_lists_inactive_rows(self):
        self.client.force_authenticate(self.viewer)
        # default: active only
        default = self.client.get('/api/v1/transport/trailers/').json()
        self.assertNotIn('9000ZZZ', {r['plate_number'] for r in default})
        # include_inactive=true: inactive shown
        allrows = self.client.get('/api/v1/transport/trailers/?include_inactive=true').json()
        self.assertIn('9000ZZZ', {r['plate_number'] for r in allrows})


class DriverApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.editor = User.objects.create_user(username='mgr3', password='x', role='export_manager')
        self.viewer = User.objects.create_user(username='op3', password='x', role='sales_rep')
        # ids mirror Z_TIRWEB's preserved-id space (real rows start at 5).
        Driver.objects.create(id=5, name='ABRAY ANNAKULYYEW')
        Driver.objects.create(id=6, name='ARSLAN BERDIYEW', is_active=False)

    def test_list_requires_auth(self):
        self.assertEqual(self.client.get('/api/v1/transport/drivers/').status_code, 401)

    def test_list_active_only_and_search(self):
        self.client.force_authenticate(self.viewer)
        rows = self.client.get('/api/v1/transport/drivers/').json()
        names = {r['name'] for r in rows}
        self.assertIn('ABRAY ANNAKULYYEW', names)
        self.assertNotIn('ARSLAN BERDIYEW', names)          # inactive omitted
        rows2 = self.client.get('/api/v1/transport/drivers/?search=ANNAKUL').json()
        self.assertEqual([r['name'] for r in rows2], ['ABRAY ANNAKULYYEW'])

    def test_create_requires_editor_role(self):
        self.client.force_authenticate(self.viewer)
        self.assertEqual(
            self.client.post('/api/v1/transport/drivers/', {'name': 'NOBODY'}, format='json').status_code,
            403,
        )

    def test_editor_creates_with_phone_and_deactivates(self):
        self.client.force_authenticate(self.editor)
        r = self.client.post(
            '/api/v1/transport/drivers/',
            {'name': 'TEST SURUJI', 'phone': '+99365123456'},
            format='json',
        )
        self.assertEqual(r.status_code, 201)
        did = r.json()['id']
        self.assertEqual(r.json()['phone'], '+99365123456')
        # Must land ABOVE the IDENTITY_INSERT'd import ids. If the identity
        # counter had not advanced, a new driver would get id 1-6 — exactly the
        # range `transport_responsible` option ids occupy, which Shipment.driver_id
        # is currently mis-bound to on the frontend.
        self.assertGreater(did, 6)
        d = self.client.patch(f'/api/v1/transport/drivers/{did}/', {'is_active': False}, format='json')
        self.assertEqual(d.status_code, 200)
        self.assertFalse(Driver.objects.get(id=did).is_active)

    def test_id_is_read_only(self):
        # Shipment.driver_id points into this id space with no FK to protect it,
        # so a client must not be able to move a row to another id.
        self.client.force_authenticate(self.editor)
        r = self.client.patch('/api/v1/transport/drivers/5/', {'id': 999}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertTrue(Driver.objects.filter(id=5).exists())
        self.assertFalse(Driver.objects.filter(id=999).exists())

    def test_boss_may_write(self):
        # boss holds ['*'] in the permission matrix, but CanEditShipment is a
        # hardcoded set the matrix never consults — he was 403'd here until
        # SHIPMENT_EDITOR_ROLES was widened (2026-08-20).
        boss = User.objects.create_user(username='patron', password='x', role='boss')
        self.client.force_authenticate(boss)
        r = self.client.post('/api/v1/transport/drivers/', {'name': 'BOSS PICK'}, format='json')
        self.assertEqual(r.status_code, 201)
        p = self.client.patch(f"/api/v1/transport/drivers/{r.json()['id']}/",
                              {'is_active': False}, format='json')
        self.assertEqual(p.status_code, 200)

    def test_include_inactive_lists_inactive_rows(self):
        self.client.force_authenticate(self.viewer)
        default = self.client.get('/api/v1/transport/drivers/').json()
        self.assertNotIn('ARSLAN BERDIYEW', {r['name'] for r in default})
        allrows = self.client.get('/api/v1/transport/drivers/?include_inactive=true').json()
        self.assertIn('ARSLAN BERDIYEW', {r['name'] for r in allrows})
