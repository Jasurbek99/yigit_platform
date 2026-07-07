"""Tests for the SplitTemplate catalog endpoint (firm-split divisions).

Run: python manage.py test apps.export.tests_split_template
"""
from django.core.management import call_command
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from apps.core.models import User
from apps.export.models import SplitTemplate


class SplitTemplateApiTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions', verbosity=0)

    def setUp(self):
        self.mgr = User.objects.create_user(username='mgr_st', password='p', role='export_manager')
        self.reader = User.objects.create_user(username='seller_st', password='p', role='seller')
        self.tpl = SplitTemplate.objects.create(name='10000 / 8000', weights='10000,8000', sort_order=1)
        self.client = APIClient()

    def _list(self):
        return reverse('split-template-list')

    def test_list_open_and_shape(self):
        self.client.force_authenticate(self.reader)
        r = self.client.get(self._list())
        self.assertEqual(r.status_code, 200)
        row = r.data['results'][0]
        self.assertEqual(row['weights_list'], ['10000', '8000'])
        self.assertEqual(row['part_count'], 2)
        self.assertEqual(str(row['total_kg']), '18000.00')

    def test_create_gated(self):
        self.client.force_authenticate(self.reader)
        r = self.client.post(self._list(), {'name': 'x', 'weights': '9000,9000'}, format='json')
        self.assertEqual(r.status_code, 403)

    def test_create_and_normalises_weights(self):
        self.client.force_authenticate(self.mgr)
        r = self.client.post(self._list(), {
            'name': '14000 / 3000', 'weights': ' 14000 , 3000 ',
        }, format='json')
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data['weights'], '14000,3000')
        self.assertEqual(r.data['part_count'], 2)

    def test_rejects_single_or_bad_weights(self):
        self.client.force_authenticate(self.mgr)
        self.assertEqual(self.client.post(self._list(), {'name': 'a', 'weights': '9000'}, format='json').status_code, 400)
        self.assertEqual(self.client.post(self._list(), {'name': 'b', 'weights': '9000,abc'}, format='json').status_code, 400)
        self.assertEqual(self.client.post(self._list(), {'name': 'c', 'weights': '9000,-1'}, format='json').status_code, 400)
