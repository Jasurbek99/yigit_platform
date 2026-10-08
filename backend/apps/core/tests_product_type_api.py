from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import GreenhouseBlock, ProductType, TomatoVariety, User


def _user(username, role):
    u = User(username=username, role=role)
    u.set_password('pass')
    u.save()
    return u


class ProductTypeApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')

    def setUp(self):
        self.client = APIClient()
        self.pepper = ProductType.objects.get(code='pepper')

    def test_any_user_reads(self):
        self.client.force_authenticate(_user('s1', 'sales_rep'))
        resp = self.client.get('/api/v1/core/product-types/')
        self.assertEqual(resp.status_code, 200)
        rows = resp.data['results'] if isinstance(resp.data, dict) else resp.data
        pepper = next(r for r in rows if r['code'] == 'pepper')
        self.assertEqual(pepper['hs_code'], '0709601000')

    def test_admin_edits_hs_code(self):
        self.client.force_authenticate(_user('a1', 'admin'))
        resp = self.client.patch(f'/api/v1/core/product-types/{self.pepper.id}/', {'hs_code': '0709601001'}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.pepper.refresh_from_db()
        self.assertEqual(self.pepper.hs_code, '0709601001')

    def test_code_is_locked_after_create(self):
        """The code drives quota, documents and filters — renaming it would orphan them."""
        self.client.force_authenticate(_user('a3', 'admin'))
        resp = self.client.patch(
            f'/api/v1/core/product-types/{self.pepper.id}/',
            {'code': 'paprika', 'hs_code': '0709601002'}, format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.pepper.refresh_from_db()
        self.assertEqual(self.pepper.code, 'pepper')
        self.assertEqual(self.pepper.hs_code, '0709601002')

    def test_code_is_writable_on_create(self):
        self.client.force_authenticate(_user('a4', 'admin'))
        resp = self.client.post(
            '/api/v1/core/product-types/', {'name': 'Hyyar', 'code': 'cucumber'}, format='json',
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(ProductType.objects.get(name='Hyyar').code, 'cucumber')

    def test_sales_rep_cannot_write(self):
        self.client.force_authenticate(_user('s2', 'sales_rep'))
        resp = self.client.patch(f'/api/v1/core/product-types/{self.pepper.id}/', {'hs_code': 'x'}, format='json')
        self.assertEqual(resp.status_code, 403)

    def test_delete_in_use_is_refused(self):
        self.client.force_authenticate(_user('a2', 'admin'))
        resp = self.client.delete(f'/api/v1/core/product-types/{self.pepper.id}/')
        self.assertEqual(resp.status_code, 400)

    def test_variety_and_block_expose_product_code(self):
        self.client.force_authenticate(_user('a3', 'admin'))
        maranella = TomatoVariety.objects.get(name='Maranella')
        GreenhouseBlock.objects.create(code='ZP', variety_main=maranella)
        v = self.client.get(f'/api/v1/core/tomato-varieties/{maranella.id}/').data
        self.assertEqual(v['product_type_code'], 'pepper')
        blocks = self.client.get('/api/v1/core/blocks/?page_size=200').data
        rows = blocks['results'] if isinstance(blocks, dict) else blocks
        self.assertEqual(next(b for b in rows if b['code'] == 'ZP')['product_type_code'], 'pepper')
