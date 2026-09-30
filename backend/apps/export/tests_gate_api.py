"""Gate endpoint (views_gate.py).

Spec: docs/superpowers/specs/2026-09-29-garawul-gate-design.md §1.5
"""
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import User
from apps.export.tests_gate_fixtures import GateFixtures

BROADCAST = 'apps.core.services.sheet_events.broadcast_sheet_change'

URL = '/api/v1/export/gate/'


class GateApiTests(GateFixtures, TestCase):

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions', verbosity=0)
        cls.make_gate_world()
        cls.admin = User.objects.create_user(username='gate_admin', password='pw', role='admin')
        cls.transport = User.objects.create_user(username='gate_tr', password='pw', role='transport')
        cls.unbound = User.objects.create_user(username='gate_nl', password='pw', role='garawul')

    def _as(self, user) -> APIClient:
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def test_guard_gets_his_own_location_and_ignores_the_param(self):
        mine = self.make_truck('P-1')
        self.make_truck('P-2', block=self.block_k)
        resp = self._as(self.guard).get(f'{URL}?location={self.kaka.pk}')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['location'], {'id': self.dusak.pk, 'name': 'Dusak'})
        self.assertEqual([r['id'] for r in resp.data['expected']], [mine.pk])
        self.assertEqual(resp.data['inside'], [])
        self.assertEqual(resp.data['recently_left'], [])

    def test_admin_picks_a_location(self):
        truck = self.make_truck('P-3', block=self.block_k)
        resp = self._as(self.admin).get(f'{URL}?location={self.kaka.pk}')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual([r['id'] for r in resp.data['expected']], [truck.pk])

    def test_admin_without_location_is_400(self):
        resp = self._as(self.admin).get(URL)
        self.assertEqual((resp.status_code, resp.data), (400, {'error': 'location_required'}))

    def test_guard_without_location_is_400(self):
        resp = self._as(self.unbound).get(URL)
        self.assertEqual((resp.status_code, resp.data), (400, {'error': 'no_location'}))

    def test_role_without_the_grant_is_403(self):
        self.assertEqual(self._as(self.transport).get(f'{URL}?location={self.dusak.pk}').status_code, 403)
        truck = self.make_truck('P-4')
        resp = self._as(self.transport).post(f'{URL}{truck.pk}/arrive/?location={self.dusak.pk}')
        self.assertEqual(resp.status_code, 403)

    def test_guard_cannot_reach_the_shipment_list(self):
        self.assertEqual(self._as(self.guard).get('/api/v1/export/shipments/').status_code, 403)

    def test_arrive_then_undo_round_trip(self):
        truck = self.make_truck('P-5', status='gumruk_girish')
        client = self._as(self.guard)
        resp = client.post(f'{URL}{truck.pk}/arrive/')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertIsNotNone(resp.data['greenhouse_arrived_at'])
        self.assertTrue(resp.data['can_undo'])
        resp = client.post(f'{URL}{truck.pk}/undo/', {'event': 'arrive'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertIsNone(resp.data['greenhouse_arrived_at'])

    def test_refused_mark_is_409_with_a_code(self):
        truck = self.make_truck('P-6')
        resp = self._as(self.guard).post(f'{URL}{truck.pk}/depart/')
        self.assertEqual((resp.status_code, resp.data), (409, {'error': 'not_inside'}))

    def test_bad_undo_event_is_400(self):
        truck = self.make_truck('P-7')
        resp = self._as(self.guard).post(f'{URL}{truck.pk}/undo/', {'event': 'x'}, format='json')
        self.assertEqual((resp.status_code, resp.data), (400, {'error': 'bad_event'}))

    def test_unknown_truck_is_404(self):
        resp = self._as(self.guard).post(f'{URL}999999/arrive/')
        self.assertEqual((resp.status_code, resp.data), (404, {'error': 'not_found'}))

    def test_arrive_pokes_the_sheet_for_this_truck(self):
        """F1: a successful write must tell open Sheet tabs (see SheetPokeTests
        for the pattern — this ViewSet had no finalize_response at all)."""
        truck = self.make_truck('P-8', status='gumruk_girish')
        with patch(BROADCAST) as broadcast:
            resp = self._as(self.guard).post(f'{URL}{truck.pk}/arrive/')
        self.assertEqual(resp.status_code, 200, resp.data)
        broadcast.assert_called_once_with([truck.pk], self.guard.id)

    def test_list_does_not_poke_the_sheet(self):
        self.make_truck('P-9')
        with patch(BROADCAST) as broadcast:
            resp = self._as(self.guard).get(URL)
        self.assertEqual(resp.status_code, 200)
        broadcast.assert_not_called()

    def test_undo_depart_returns_a_row_whose_arrival_can_still_be_undone(self):
        """F7: the truck is inside again after an undone departure, so its
        arrival mark may still be undoable — the response row must say so."""
        truck = self.make_truck('P-10', status='yuklenme')
        client = self._as(self.guard)
        client.post(f'{URL}{truck.pk}/arrive/')
        client.post(f'{URL}{truck.pk}/depart/')
        resp = client.post(f'{URL}{truck.pk}/undo/', {'event': 'depart'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertIsNone(resp.data['departed_at'])
        self.assertTrue(resp.data['can_undo'])

    def test_undo_arrive_returns_a_row_that_cannot_be_undone_again(self):
        truck = self.make_truck('P-11', status='gumruk_girish')
        client = self._as(self.guard)
        client.post(f'{URL}{truck.pk}/arrive/')
        resp = client.post(f'{URL}{truck.pk}/undo/', {'event': 'arrive'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertFalse(resp.data['can_undo'])

    def test_dusak_guard_cannot_reach_a_kaka_truck_even_naming_its_location(self):
        """F8: `_location_for` always uses the guard's own User.loading_location
        — a guard-sent `?location=` is ignored, so this is refused both ways."""
        truck = self.make_truck('P-12', block=self.block_k)
        for suffix in ('', f'?location={self.kaka.pk}'):
            with self.subTest(suffix=suffix or 'no query param'):
                resp = self._as(self.guard).post(f'{URL}{truck.pk}/arrive/{suffix}')
                self.assertEqual((resp.status_code, resp.data), (409, {'error': 'not_expected'}))
                truck.refresh_from_db()
                self.assertIsNone(truck.greenhouse_arrived_at)
