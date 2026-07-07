"""Tests for the PackingTemplate catalog endpoint (whole truck + firm shares).

Run: python manage.py test apps.export.tests_packing_template
"""
from decimal import Decimal

from django.core.management import call_command
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from apps.core.models import User
from apps.export.models import PackingTemplate


class PackingTemplateApiTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions', verbosity=0)

    def setUp(self):
        self.mgr = User.objects.create_user(username='mgr_pt', password='p', role='export_manager')
        self.reader = User.objects.create_user(username='seller_pt', password='p', role='seller')
        self.client = APIClient()

    def _list(self):
        return reverse('packing-template-list')

    def _payload(self):
        return {
            'name': '18000 (10000/8000)', 'product_type': 'tomato',
            'net_kg': '18000', 'gross_kg': '20472', 'box_count': 2912,
            'pallet_count': '33', 'pallet_weight_kg': '412',
            'shares': [
                {'net_kg': '10000', 'gross_kg': '11373', 'box_count': 1618,
                 'pallet_count': '18', 'pallet_weight_kg': '229'},
                {'net_kg': '8000', 'gross_kg': '9099', 'box_count': 1294,
                 'pallet_count': '15', 'pallet_weight_kg': '183'},
            ],
        }

    def test_create_with_nested_shares(self):
        self.client.force_authenticate(self.mgr)
        r = self.client.post(self._list(), self._payload(), format='json')
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data['share_count'], 2)
        self.assertEqual(len(r.data['shares']), 2)
        self.assertEqual(r.data['shares'][0]['share_order'], 1)
        tpl = PackingTemplate.objects.get(pk=r.data['id'])
        self.assertEqual(tpl.shares.count(), 2)

    def test_update_replaces_shares(self):
        self.client.force_authenticate(self.mgr)
        created = self.client.post(self._list(), self._payload(), format='json').data
        url = reverse('packing-template-detail', kwargs={'pk': created['id']})
        r = self.client.patch(url, {'shares': [
            {'net_kg': '9000', 'gross_kg': '10200', 'box_count': 1520,
             'pallet_count': '16.5', 'pallet_weight_kg': '190'},
        ]}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['share_count'], 1)

    def test_read_open_write_gated(self):
        self.client.force_authenticate(self.reader)
        self.assertEqual(self.client.get(self._list()).status_code, 200)
        self.assertEqual(
            self.client.post(self._list(), self._payload(), format='json').status_code, 403)
