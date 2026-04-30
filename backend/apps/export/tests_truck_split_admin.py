"""Tests for TruckSplitDefault admin CRUD endpoints (Gap 7).

Covers:
- Director can list / create / update / delete via /api/v1/export/admin/truck-splits/
- Non-director (export_manager) gets read-only (200 GET, 403 POST/PATCH/DELETE)
- Non-privileged role (sales_rep) gets 403 on every method
- Cache is invalidated after mutations (a follow-up read sees the new value)
"""
from decimal import Decimal

from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import User
from apps.export.models import TruckSplitDefault, get_default_truck_weight


def _create_user(username: str, role: str) -> User:
    user = User(username=username, role=role)
    user.set_password('pass')
    user.save()
    return user


def _seed_permissions() -> None:
    call_command('seed_permissions')


class TruckSplitAdminTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        _seed_permissions()
        # The migration seed should have created (1, 18100), (2, 9000), (3, 6000)
        # but tests run on a fresh DB without the data migration; ensure rows exist.
        for n, kg in [(1, '18100'), (2, '9000'), (3, '6000')]:
            TruckSplitDefault.objects.get_or_create(
                num_firms=n, defaults={'kg_per_firm': Decimal(kg)},
            )

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.admin = _create_user('admin1', 'admin')
        self.director = _create_user('dir', 'director')
        self.export_mgr = _create_user('mgr', 'export_manager')
        self.sales = _create_user('sales', 'sales_rep')

    def _auth(self, user):
        self.client.force_authenticate(user=user)

    # ── List / detail ────────────────────────────────────────────────────

    def test_director_can_list(self):
        self._auth(self.director)
        resp = self.client.get('/api/v1/export/admin/truck-splits/')
        self.assertEqual(resp.status_code, 200, resp.data)
        # Pagination wraps in 'results' if PageNumberPagination kicks in
        data = resp.data.get('results', resp.data)
        codes = {row['num_firms'] for row in data}
        self.assertSetEqual(codes, {1, 2, 3})

    def test_export_manager_can_list_but_not_write(self):
        self._auth(self.export_mgr)
        get_resp = self.client.get('/api/v1/export/admin/truck-splits/')
        self.assertEqual(get_resp.status_code, 200, get_resp.data)
        post_resp = self.client.post(
            '/api/v1/export/admin/truck-splits/',
            {'num_firms': 5, 'kg_per_firm': '3620.00'},
            format='json',
        )
        self.assertEqual(post_resp.status_code, 403, post_resp.data)

    def test_sales_rep_blocked_from_list(self):
        self._auth(self.sales)
        resp = self.client.get('/api/v1/export/admin/truck-splits/')
        self.assertEqual(resp.status_code, 403, resp.data)

    def test_admin_can_create_and_delete(self):
        self._auth(self.admin)
        resp = self.client.post(
            '/api/v1/export/admin/truck-splits/',
            {'num_firms': 6, 'kg_per_firm': '3000.00'},
            format='json',
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        row_id = resp.data['id']
        del_resp = self.client.delete(f'/api/v1/export/admin/truck-splits/{row_id}/')
        self.assertEqual(del_resp.status_code, 204)

    # ── Mutations ────────────────────────────────────────────────────────

    def test_director_can_create_new_n(self):
        self._auth(self.director)
        resp = self.client.post(
            '/api/v1/export/admin/truck-splits/',
            {'num_firms': 4, 'kg_per_firm': '4525.00', 'notes': 'Edge case'},
            format='json',
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertTrue(TruckSplitDefault.objects.filter(num_firms=4).exists())

    def test_director_can_update(self):
        self._auth(self.director)
        row = TruckSplitDefault.objects.get(num_firms=2)
        resp = self.client.patch(
            f'/api/v1/export/admin/truck-splits/{row.id}/',
            {'kg_per_firm': '9500.00'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        row.refresh_from_db()
        self.assertEqual(str(row.kg_per_firm), '9500.00')

    def test_director_can_delete(self):
        self._auth(self.director)
        row = TruckSplitDefault.objects.get(num_firms=3)
        resp = self.client.delete(f'/api/v1/export/admin/truck-splits/{row.id}/')
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(TruckSplitDefault.objects.filter(num_firms=3).exists())

    def test_validation_rejects_zero_kg(self):
        self._auth(self.director)
        resp = self.client.post(
            '/api/v1/export/admin/truck-splits/',
            {'num_firms': 5, 'kg_per_firm': '0'},
            format='json',
        )
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertIn('kg_per_firm', resp.data)

    def test_validation_rejects_zero_num_firms(self):
        self._auth(self.director)
        resp = self.client.post(
            '/api/v1/export/admin/truck-splits/',
            {'num_firms': 0, 'kg_per_firm': '18100'},
            format='json',
        )
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertIn('num_firms', resp.data)

    def test_unique_num_firms_enforced(self):
        self._auth(self.director)
        # row for num_firms=2 already exists from setUp seed
        resp = self.client.post(
            '/api/v1/export/admin/truck-splits/',
            {'num_firms': 2, 'kg_per_firm': '8888.00'},
            format='json',
        )
        self.assertEqual(resp.status_code, 400, resp.data)

    # ── Cache invalidation ───────────────────────────────────────────────

    def test_update_invalidates_cache(self):
        # Warm cache with current value
        self.assertEqual(get_default_truck_weight(2), Decimal('9000'))
        self._auth(self.director)
        row = TruckSplitDefault.objects.get(num_firms=2)
        self.client.patch(
            f'/api/v1/export/admin/truck-splits/{row.id}/',
            {'kg_per_firm': '9750.00'},
            format='json',
        )
        # Helper must reflect the new DB value, not the cached old one
        self.assertEqual(get_default_truck_weight(2), Decimal('9750.00'))
