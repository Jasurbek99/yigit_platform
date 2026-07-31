from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.transport.models import Truck, TraccarDevice, DevicePosition

User = get_user_model()


@override_settings(TRACCAR_STALE_MINUTES=15)
class LivePositionsApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username='op', password='x')
        self.client.force_authenticate(self.user)
        truck = Truck.objects.create(plate='2189AHF', fleet_no='TR038')
        self.device = TraccarDevice.objects.create(
            traccar_id=74, name='2189AHF TR038', truck=truck, status='online',
        )

    def _make_position(self, minutes_old):
        DevicePosition.objects.create(
            device=self.device, latitude='37.97', longitude='58.49',
            speed='0', course='298', address='Artyk', ignition=True,
            fix_time=timezone.now() - timedelta(minutes=minutes_old),
        )

    def test_requires_auth(self):
        self.client.force_authenticate(None)
        resp = self.client.get('/api/v1/transport/live-positions/')
        self.assertEqual(resp.status_code, 401)

    def test_returns_renamed_fields(self):
        self._make_position(minutes_old=1)
        resp = self.client.get('/api/v1/transport/live-positions/')
        self.assertEqual(resp.status_code, 200)
        row = resp.json()[0]
        self.assertEqual(row['device_id'], 74)
        self.assertEqual(row['plate'], '2189AHF')
        self.assertEqual(row['fleet_no'], 'TR038')
        self.assertEqual(row['status'], 'online')
        self.assertEqual(row['lat'], 37.97)
        self.assertEqual(row['lon'], 58.49)
        self.assertTrue(row['is_online'])
        self.assertFalse(row['is_stale'])

    def test_stale_flag_by_fix_time_age(self):
        self._make_position(minutes_old=30)
        row = self.client.get('/api/v1/transport/live-positions/').json()[0]
        self.assertTrue(row['is_stale'])

    def test_device_without_position_is_omitted(self):
        # no position created
        resp = self.client.get('/api/v1/transport/live-positions/')
        self.assertEqual(resp.json(), [])

    def test_invalid_gps_fix_is_omitted(self):
        DevicePosition.objects.create(
            device=self.device, latitude='37.97', longitude='58.49',
            speed='0', course='298', address='Artyk', ignition=True,
            fix_time=timezone.now(), valid=False,
        )
        resp = self.client.get('/api/v1/transport/live-positions/')
        self.assertEqual(resp.json(), [])

    def test_null_speed_and_course_serialize_as_null(self):
        DevicePosition.objects.create(
            device=self.device, latitude='37.97', longitude='58.49',
            speed=None, course=None, address='Artyk', ignition=True,
            fix_time=timezone.now(),
        )
        row = self.client.get('/api/v1/transport/live-positions/').json()[0]
        self.assertIsNone(row['speed'])
        self.assertIsNone(row['course'])
