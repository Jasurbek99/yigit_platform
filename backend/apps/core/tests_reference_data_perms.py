"""Reference-data write-permission regression tests.

AD-15 separates `admin` (system administrator) from `director` and
`export_manager` (operational), but reference-data writes — countries,
cities, customers, blocks, etc. — remain operational. These tests prevent
a future change from accidentally narrowing them to admin-only.

Covers:
- admin, director, export_manager can each write every reference-data resource
- sales_rep gets 403 on every reference-data write
"""
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import Country, User


def _create_user(username: str, role: str) -> User:
    user = User(username=username, role=role)
    user.set_password('pass')
    user.save()
    return user


class ReferenceDataPermsTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')

    def setUp(self):
        self.client = APIClient()
        self.admin = _create_user('admin1', 'admin')
        self.director = _create_user('director1', 'director')
        self.export_mgr = _create_user('mgr1', 'export_manager')
        self.sales = _create_user('sales1', 'sales_rep')

    def _auth(self, user):
        self.client.force_authenticate(user=user)

    def _post_country(self, code: str, suffix: str) -> int:
        return self.client.post(
            '/api/v1/core/countries/',
            {'name_en': f'X{suffix}', 'name_ru': f'X{suffix}', 'name_tk': f'X{suffix}', 'code': code},
            format='json',
        ).status_code

    # ── Country: representative reference-data resource ─────────────────
    def test_admin_can_create_country(self):
        self._auth(self.admin)
        self.assertEqual(self._post_country('AA', 'A'), 201)

    def test_director_can_create_country(self):
        # MUST stay green — director keeps reference-data write power per AD-15.
        self._auth(self.director)
        self.assertEqual(self._post_country('BB', 'B'), 201)

    def test_export_manager_can_create_country(self):
        # MUST stay green — EM keeps reference-data write power per AD-15.
        self._auth(self.export_mgr)
        self.assertEqual(self._post_country('CC', 'C'), 201)

    def test_sales_rep_cannot_create_country(self):
        self._auth(self.sales)
        self.assertEqual(self._post_country('DD', 'D'), 403)

    # ── BorderPoint ─────────────────────────────────────────────────────
    def test_admin_can_create_border_point(self):
        self._auth(self.admin)
        resp = self.client.post('/api/v1/core/border-points/', {'name': 'BP-Admin'}, format='json')
        self.assertIn(resp.status_code, (200, 201), resp.data)

    def test_director_can_create_border_point(self):
        self._auth(self.director)
        resp = self.client.post('/api/v1/core/border-points/', {'name': 'BP-Dir'}, format='json')
        self.assertIn(resp.status_code, (200, 201), resp.data)

    def test_export_manager_can_create_border_point(self):
        self._auth(self.export_mgr)
        resp = self.client.post('/api/v1/core/border-points/', {'name': 'BP-EM'}, format='json')
        self.assertIn(resp.status_code, (200, 201), resp.data)

    def test_sales_rep_cannot_create_border_point(self):
        self._auth(self.sales)
        resp = self.client.post('/api/v1/core/border-points/', {'name': 'BP-Sales'}, format='json')
        self.assertEqual(resp.status_code, 403, resp.data)

    # ── Customer ────────────────────────────────────────────────────────
    def test_admin_can_create_customer(self):
        self._auth(self.admin)
        resp = self.client.post('/api/v1/core/customers/', {'name': 'C-Admin'}, format='json')
        self.assertIn(resp.status_code, (200, 201), resp.data)

    def test_director_can_create_customer(self):
        self._auth(self.director)
        resp = self.client.post('/api/v1/core/customers/', {'name': 'C-Dir'}, format='json')
        self.assertIn(resp.status_code, (200, 201), resp.data)

    def test_export_manager_can_create_customer(self):
        self._auth(self.export_mgr)
        resp = self.client.post('/api/v1/core/customers/', {'name': 'C-EM'}, format='json')
        self.assertIn(resp.status_code, (200, 201), resp.data)

    def test_sales_rep_cannot_create_customer(self):
        self._auth(self.sales)
        resp = self.client.post('/api/v1/core/customers/', {'name': 'C-Sales'}, format='json')
        self.assertEqual(resp.status_code, 403, resp.data)

    # ── City ────────────────────────────────────────────────────────────
    def _post_city(self, name: str, country: 'Country') -> int:
        return self.client.post(
            '/api/v1/core/cities/',
            {'name': name, 'country': country.id},
            format='json',
        ).status_code

    def test_admin_director_em_can_create_city(self):
        country, _ = Country.objects.get_or_create(
            code='TM', defaults={'name_en': 'TM', 'name_ru': 'TM', 'name_tk': 'TM'},
        )
        for user, name in (
            (self.admin, 'CityA'), (self.director, 'CityD'), (self.export_mgr, 'CityE'),
        ):
            self._auth(user)
            self.assertIn(self._post_city(name, country), (200, 201))

    def test_sales_rep_cannot_create_city(self):
        country, _ = Country.objects.get_or_create(
            code='ZZ', defaults={'name_en': 'Z', 'name_ru': 'Z', 'name_tk': 'Z'},
        )
        self._auth(self.sales)
        self.assertEqual(self._post_city('Forbidden', country), 403)

    # ── ShipmentStatusType ──────────────────────────────────────────────
    def _post_status_type(self, code: str) -> int:
        return self.client.post(
            '/api/v1/core/status-types/',
            {'code': code, 'name_en': 'X', 'name_ru': 'X', 'name_tk': 'X', 'step_order': 99, 'phase': 'LOADING'},
            format='json',
        ).status_code

    def test_admin_director_em_can_create_status_type(self):
        for user, code in (
            (self.admin, 'sta1'), (self.director, 'std1'), (self.export_mgr, 'ste1'),
        ):
            self._auth(user)
            self.assertIn(self._post_status_type(code), (200, 201))

    def test_sales_rep_cannot_create_status_type(self):
        self._auth(self.sales)
        self.assertEqual(self._post_status_type('sts1'), 403)

    # ── TruckDestination ────────────────────────────────────────────────
    def _post_truck_dest(self, name: str) -> int:
        return self.client.post(
            '/api/v1/core/truck-destinations/',
            {'name': name},
            format='json',
        ).status_code

    def test_admin_director_em_can_create_truck_destination(self):
        for user, name in (
            (self.admin, 'TD-A'), (self.director, 'TD-D'), (self.export_mgr, 'TD-E'),
        ):
            self._auth(user)
            self.assertIn(self._post_truck_dest(name), (200, 201))

    def test_sales_rep_cannot_create_truck_destination(self):
        self._auth(self.sales)
        self.assertEqual(self._post_truck_dest('TD-S'), 403)

    # ── ShipmentOptionType ──────────────────────────────────────────────
    def _post_option(self, code: str) -> int:
        return self.client.post(
            '/api/v1/core/shipment-options/',
            {
                'code': code, 'category': 'vehicle_condition',
                'label_tk': 'X', 'label_en': 'X', 'label_ru': 'X',
            },
            format='json',
        ).status_code

    def test_admin_director_em_can_create_option(self):
        for user, code in (
            (self.admin, 'opta'), (self.director, 'optd'), (self.export_mgr, 'opte'),
        ):
            self._auth(user)
            self.assertIn(self._post_option(code), (200, 201))

    def test_sales_rep_cannot_create_option(self):
        self._auth(self.sales)
        self.assertEqual(self._post_option('opts'), 403)

    # ── GreenhouseBlock + BlockManagerAssignment (under /greenhouse/) ────
    def _post_block(self, code: str) -> int:
        return self.client.post(
            '/api/v1/greenhouse/admin/blocks/',
            {'code': code, 'name': f'Block-{code}'},
            format='json',
        ).status_code

    def test_admin_director_em_can_create_block(self):
        for user, code in (
            (self.admin, 'BA'), (self.director, 'BD'), (self.export_mgr, 'BE'),
        ):
            self._auth(user)
            self.assertIn(self._post_block(code), (200, 201))

    def test_sales_rep_cannot_create_block(self):
        self._auth(self.sales)
        self.assertEqual(self._post_block('BS'), 403)

    # ── Reads remain open to all authenticated users ────────────────────
    def test_sales_rep_can_still_read_countries(self):
        Country.objects.get_or_create(
            code='RD', defaults={'name_en': 'ReadOnly', 'name_ru': 'ReadOnly', 'name_tk': 'ReadOnly'},
        )
        self._auth(self.sales)
        resp = self.client.get('/api/v1/core/countries/')
        self.assertEqual(resp.status_code, 200, resp.data)
