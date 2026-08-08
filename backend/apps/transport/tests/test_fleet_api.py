from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.transport.models import TruckHead, TraccarDevice, Truck, DevicePosition, Trailer

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
