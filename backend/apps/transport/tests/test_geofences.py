"""Current geofence per truck: Traccar sync + GET /transport/geofences/current/."""
from datetime import timedelta
from unittest.mock import MagicMock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.test import APIClient

from apps.transport.models import DevicePosition, TraccarDevice, TraccarGeofence, Truck
from apps.transport.services.sync import sync_geofences, sync_positions

User = get_user_model()

URL = '/api/v1/transport/geofences/current/'
FIX_1 = '2026-09-18T06:00:00+00:00'
FIX_2 = '2026-09-18T06:02:00+00:00'


def _position(geofence_ids, fix_time=FIX_1):
    return {
        'deviceId': 74, 'latitude': 37.9734, 'longitude': 58.4925, 'speed': 0,
        'course': 0, 'address': None, 'valid': True, 'fixTime': fix_time,
        'attributes': {}, 'geofenceIds': geofence_ids,
    }


def _client(positions=(), geofences=()):
    client = MagicMock()
    client.get_positions.return_value = list(positions)
    client.get_geofences.return_value = list(geofences)
    return client


class SyncGeofencesTests(TestCase):
    def test_upserts_id_and_name(self):
        count = sync_geofences(client=_client(geofences=[
            {'id': 3, 'name': 'Garaž', 'area': 'POLYGON ((...))'},
            {'id': 14, 'name': 'Farap gumruk', 'area': 'POLYGON ((...))'},
        ]))
        self.assertEqual(count, 2)
        self.assertEqual(TraccarGeofence.objects.get(traccar_id=3).name, 'Garaž')

    def test_rename_in_traccar_updates_the_row(self):
        sync_geofences(client=_client(geofences=[{'id': 3, 'name': 'Garaz'}]))
        sync_geofences(client=_client(geofences=[{'id': 3, 'name': 'Garaž'}]))
        self.assertEqual(TraccarGeofence.objects.count(), 1)
        self.assertEqual(TraccarGeofence.objects.get().name, 'Garaž')


class PositionGeofenceTests(TestCase):
    def setUp(self):
        truck = Truck.objects.create(plate='2189AHF', fleet_no='TR038')
        TraccarDevice.objects.create(traccar_id=74, name='2189AHF TR038', truck=truck)
        self.garaz = TraccarGeofence.objects.create(traccar_id=3, name='Garaž')
        self.gumruk = TraccarGeofence.objects.create(traccar_id=21, name='Gumruk')

    def test_sets_current_geofence_and_since_from_the_fix(self):
        sync_positions(client=_client([_position([3])]))
        pos = DevicePosition.objects.get()
        self.assertEqual(pos.current_geofence, self.garaz)
        self.assertEqual(pos.geofence_since, parse_datetime(FIX_1))

    def test_since_is_kept_while_the_truck_stays_in_the_same_geofence(self):
        # Regression guard: update_or_create would otherwise reset it every poll.
        sync_positions(client=_client([_position([3], FIX_1)]))
        sync_positions(client=_client([_position([3], FIX_2)]))
        self.assertEqual(DevicePosition.objects.get().geofence_since, parse_datetime(FIX_1))

    def test_since_resets_when_the_truck_moves_to_another_geofence(self):
        sync_positions(client=_client([_position([3], FIX_1)]))
        sync_positions(client=_client([_position([21], FIX_2)]))
        pos = DevicePosition.objects.get()
        self.assertEqual(pos.current_geofence, self.gumruk)
        self.assertEqual(pos.geofence_since, parse_datetime(FIX_2))

    def test_leaving_every_geofence_clears_both_fields(self):
        sync_positions(client=_client([_position([3])]))
        sync_positions(client=_client([_position(None, FIX_2)]))
        pos = DevicePosition.objects.get()
        self.assertIsNone(pos.current_geofence)
        self.assertIsNone(pos.geofence_since)

    def test_geofence_not_yet_synced_is_treated_as_none(self):
        sync_positions(client=_client([_position([999])]))
        self.assertIsNone(DevicePosition.objects.get().current_geofence)

    def test_overlapping_geofences_take_the_first_and_warn(self):
        with self.assertLogs('apps.transport.services.sync', level='WARNING'):
            sync_positions(client=_client([_position([21, 3])]))
        self.assertEqual(DevicePosition.objects.get().current_geofence, self.gumruk)


@override_settings(TRACCAR_STALE_MINUTES=15)
class CurrentGeofencesApiTests(TestCase):
    def setUp(self):
        call_command('seed_permissions')  # CanViewFleetMap reads the page matrix
        cache.clear()
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user(username='op', password='x'))
        self.garaz = TraccarGeofence.objects.create(traccar_id=3, name='Garaž')
        self.olot = TraccarGeofence.objects.create(traccar_id=15, name='Olot gumruk')
        self.now = timezone.now()

    def _truck(self, device_id, plate, geofence=None, since=None, **extra):
        truck = Truck.objects.create(plate=plate, fleet_no=f'TR{device_id:03d}')
        device = TraccarDevice.objects.create(
            traccar_id=device_id, name=plate, truck=truck, status='online',
        )
        return DevicePosition.objects.create(
            device=device, latitude='37.97', longitude='58.49', fix_time=self.now,
            current_geofence=geofence, geofence_since=since, **extra,
        )

    def test_requires_auth(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(URL).status_code, 401)

    def test_seller_is_denied_like_the_fleet_map(self):
        self.client.force_authenticate(
            User.objects.create_user(username='sell', password='x', role='seller')
        )
        self.assertEqual(self.client.get(URL).status_code, 403)

    def test_groups_trucks_by_geofence_busiest_first(self):
        since = self.now - timedelta(hours=6)
        self._truck(1, '1111AHF', self.garaz, since)
        self._truck(2, '2222AHF', self.garaz, since)
        self._truck(3, '3333AHF', self.olot, since)
        resp = self.client.get(URL)
        self.assertEqual(resp.status_code, 200)
        groups = resp.json()
        self.assertEqual([g['geofence_name'] for g in groups], ['Garaž', 'Olot gumruk'])
        self.assertEqual(groups[0]['geofence_id'], 3)
        self.assertEqual(groups[0]['truck_count'], 2)
        truck = groups[1]['trucks'][0]
        self.assertEqual(truck['device_id'], 3)
        self.assertEqual(truck['plate'], '3333AHF')
        self.assertEqual(truck['fleet_no'], 'TR003')
        self.assertEqual(parse_datetime(truck['since']), since)
        self.assertTrue(truck['is_online'])
        self.assertFalse(truck['is_stale'])

    def test_trucks_outside_every_geofence_come_last_under_null(self):
        self._truck(1, '1111AHF')
        self._truck(2, '2222AHF', self.olot, self.now)
        groups = self.client.get(URL).json()
        self.assertEqual(groups[-1]['geofence_id'], None)
        self.assertEqual(groups[-1]['geofence_name'], None)
        self.assertEqual(groups[-1]['trucks'][0]['plate'], '1111AHF')

    def test_invalid_positions_are_excluded(self):
        self._truck(1, '1111AHF', self.garaz, self.now, valid=False)
        self.assertEqual(self.client.get(URL).json(), [])
