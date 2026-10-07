"""Pepper spec 2026-10-05: explicit shipment product on create + list filter."""
import datetime

from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import (
    Country, Customer, GreenhouseBlock, ProductType, Season, ShipmentStatusType,
    TomatoVariety, User,
)
from apps.export.models import Shipment


def _user(username, role):
    user = User(username=username, role=role)
    user.set_password('pass')
    user.save()
    return user


class ShipmentProductCreateTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')

    def setUp(self):
        self.client = APIClient()
        self.em = _user('sp_em', 'export_manager')
        self.loading = _user('sp_load', 'loading_dept_head')
        self.season, _ = Season.objects.get_or_create(
            name='sp-test',
            defaults={'start_date': '2026-08-01', 'end_date': '2027-07-01', 'is_active': True},
        )
        self.draft, _ = ShipmentStatusType.objects.get_or_create(
            code='draft',
            defaults={'name_tk': 'd', 'name_en': 'd', 'step_order': 0, 'phase': 'DRAFT'},
        )
        self.tomato = ProductType.objects.get(code='tomato')
        self.pepper = ProductType.objects.get(code='pepper')
        tv = TomatoVariety.objects.create(name='SP-Tom', product_type=self.tomato)
        self.pb = GreenhouseBlock.objects.create(
            code='QP', variety_main=TomatoVariety.objects.get(name='Maranella'),
        )
        self.tb = GreenhouseBlock.objects.create(code='QT', variety_main=tv)
        self.country, _ = Country.objects.get_or_create(
            code='PZ', defaults={'name_tk': 'P', 'name_en': 'P', 'name_ru': 'P'},
        )
        self.customer, _ = Customer.objects.get_or_create(name='SPCustomer')

    def _supply(self, blocks, **extra):
        return self.client.post('/api/v1/export/shipments/', {
            'is_draft': True, 'skip_forecast_check': True,
            'block_sources': [{'block_id': b.id, 'weight_kg': w} for b, w in blocks],
            **extra,
        }, format='json')

    def test_supply_draft_from_pepper_block_is_pepper(self):
        self.client.force_authenticate(self.loading)
        resp = self._supply([(self.pb, '16800')])
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['product_type_code'], 'pepper')

    def test_supply_draft_from_tomato_block_is_tomato(self):
        self.client.force_authenticate(self.loading)
        resp = self._supply([(self.tb, '16800')])
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['product_type_code'], 'tomato')

    def test_supply_draft_mixed_blocks_is_400(self):
        self.client.force_authenticate(self.loading)
        resp = self._supply([(self.pb, '8000'), (self.tb, '8000')])
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data['error'], 'mixed_product')
        self.assertEqual(Shipment.objects.count(), 0)

    def test_supply_draft_requested_product_conflicts_with_blocks(self):
        self.client.force_authenticate(self.loading)
        resp = self._supply([(self.pb, '16800')], product_type=self.tomato.id)
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data['error'], 'product_mismatch')
        self.assertEqual(Shipment.objects.count(), 0)

    def test_destination_row_defaults_to_tomato(self):
        self.client.force_authenticate(self.em)
        resp = self.client.post('/api/v1/export/shipments/', {
            'is_draft': True, 'block_sources': [],
            'country': self.country.id, 'customer': self.customer.id,
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['product_type_code'], 'tomato')

    def test_destination_row_can_be_created_as_pepper(self):
        self.client.force_authenticate(self.em)
        resp = self.client.post('/api/v1/export/shipments/', {
            'is_draft': True, 'block_sources': [],
            'country': self.country.id, 'customer': self.customer.id,
            'product_type': self.pepper.id,
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['product_type_code'], 'pepper')
        self.assertEqual(resp.data['product_type'], self.pepper.id)

    def test_non_draft_create_accepts_product(self):
        self.client.force_authenticate(self.em)
        resp = self.client.post('/api/v1/export/shipments/', {
            'country': self.country.id, 'customer': self.customer.id,
            'product_type': self.pepper.id,
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['product_type_code'], 'pepper')

    def test_non_draft_create_defaults_to_tomato(self):
        self.client.force_authenticate(self.em)
        resp = self.client.post('/api/v1/export/shipments/', {
            'country': self.country.id, 'customer': self.customer.id,
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['product_type_code'], 'tomato')

    def _make(self, code, product):
        return Shipment.objects.create(
            shipment_code=code, date=datetime.date(2026, 10, 1), season=self.season,
            status=self.draft, created_by=self.em, product_type=product,
        )

    def test_list_filter_by_product(self):
        self._make('0110001/26', self.tomato)
        self._make('0110002/26', self.pepper)
        self._make('0110003/26', None)
        self.client.force_authenticate(self.em)

        resp = self.client.get('/api/v1/export/shipments/?product_type=pepper')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual({r['product_type_code'] for r in resp.data['results']}, {'pepper'})

        resp = self.client.get('/api/v1/export/shipments/?product_type=tomato')
        codes = {r['shipment_code'] for r in resp.data['results']}
        self.assertEqual(codes, {'0110001/26', '0110003/26'})

    def test_sheet_serializer_exposes_product(self):
        self._make('0110002/26', self.pepper)
        self.client.force_authenticate(self.em)
        resp = self.client.get('/api/v1/export/shipments/sheet/')
        self.assertEqual(resp.status_code, 200, resp.data)
        rows = resp.data['results'] if isinstance(resp.data, dict) and 'results' in resp.data else resp.data
        row = next(r for r in rows if r['shipment_code'] == '0110002/26')
        self.assertEqual(row['product_type_code'], 'pepper')
        self.assertEqual(row['product_type'], self.pepper.id)
