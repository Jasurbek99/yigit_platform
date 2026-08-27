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
        self.doc = User.objects.create_user(username='doc_pt', password='p', role='document_team')
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

    def test_document_team_has_full_crud(self):
        """document_team owns the gross-net catalog (permission matrix, 2026-08-27).

        Guards the `packing_template` resource grant end-to-end: the seed row, the
        registry entry, and `resource_write_permission` on the ViewSet. A hardcoded
        role tuple would fail every assertion below.
        """
        self.client.force_authenticate(self.doc)
        self.assertEqual(self.client.get(self._list()).status_code, 200)

        created = self.client.post(self._list(), self._payload(), format='json')
        self.assertEqual(created.status_code, 201)

        url = reverse('packing-template-detail', kwargs={'pk': created.data['id']})
        self.assertEqual(self.client.patch(url, {'name': 'renamed'}, format='json').status_code, 200)
        self.assertEqual(self.client.delete(url).status_code, 204)

    def test_reader_role_keeps_open_read_after_matrix_gate(self):
        """Roles with NO packing_template row must still GET the catalog.

        The Sheet packing panel lists templates for every role that picks one on a
        truck, so switching the write gate to the permission matrix must not gate
        reads (that is why DynamicResourcePermission is deliberately not used here).
        """
        self.client.force_authenticate(self.reader)
        detail = PackingTemplate.objects.create(
            name='read-open', product_type='tomato', net_kg=Decimal('18000'),
            gross_kg=Decimal('20472'), box_count=2912,
            pallet_count=Decimal('33'), pallet_weight_kg=Decimal('412'),
        )
        url = reverse('packing-template-detail', kwargs={'pk': detail.pk})
        self.assertEqual(self.client.get(url).status_code, 200)
        self.assertEqual(self.client.patch(url, {'name': 'x'}, format='json').status_code, 403)
        self.assertEqual(self.client.delete(url).status_code, 403)
