"""Tests for the PackingPreset catalog endpoint (digital gross-net presets).

Covers:
- List is open to any authenticated user (operators need to pick presets).
- Create/update/delete are gated to management (admin/director/export_manager).
- product_type filter narrows results.

Run specifically:
    python manage.py test apps.export.tests_packing_preset
"""
from decimal import Decimal

from django.core.management import call_command
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from apps.core.models import User
from apps.export.models import PackingPreset


class PackingPresetApiTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions', verbosity=0)

    def setUp(self):
        self.writer = User.objects.create_user(
            username='mgr_pp', password='pass', role='export_manager'
        )
        self.reader = User.objects.create_user(
            username='seller_pp', password='pass', role='seller'
        )
        self.tomato = PackingPreset.objects.create(
            name='Tomato · half (9000)', product_type='tomato',
            net_kg=Decimal('9000'), gross_kg=Decimal('10225'), box_count=1492,
            pallet_count=Decimal('16.5'), pallet_weight_kg=Decimal('223'), sort_order=1,
        )
        self.pepper = PackingPreset.objects.create(
            name='Pepper · placeholder', product_type='pepper',
            net_kg=Decimal('9000'), sort_order=2,
        )
        self.client = APIClient()

    def _list_url(self):
        return reverse('packing-preset-list')

    def _detail_url(self, pk):
        return reverse('packing-preset-detail', kwargs={'pk': pk})

    def test_list_open_to_any_authenticated(self):
        self.client.force_authenticate(user=self.reader)
        resp = self.client.get(self._list_url())
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['count'], 2)

    def test_product_type_filter(self):
        self.client.force_authenticate(user=self.reader)
        resp = self.client.get(self._list_url(), {'product_type': 'pepper'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['count'], 1)
        self.assertEqual(resp.data['results'][0]['name'], 'Pepper · placeholder')

    def test_create_blocked_for_non_write_role(self):
        self.client.force_authenticate(user=self.reader)
        resp = self.client.post(self._list_url(), {
            'name': 'X', 'product_type': 'tomato', 'net_kg': '9000',
        }, format='json')
        self.assertEqual(resp.status_code, 403)

    def test_create_and_patch_allowed_for_management(self):
        self.client.force_authenticate(user=self.writer)
        resp = self.client.post(self._list_url(), {
            'name': 'Tomato · full (18100)', 'product_type': 'tomato',
            'net_kg': '18100', 'gross_kg': '20400', 'box_count': 3100,
            'pallet_count': '33', 'pallet_weight_kg': '380',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        new_id = resp.data['id']
        patch = self.client.patch(self._detail_url(new_id), {'is_active': False}, format='json')
        self.assertEqual(patch.status_code, 200)
        self.assertFalse(patch.data['is_active'])
