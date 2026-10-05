"""Blocks admin «Менеджер» column reads active BlockManagerAssignment rows,
not the stale GreenhouseBlock.manager FK (D/M15/M5 showed a departed manager).

Usage:
    python manage.py test apps.greenhouse.tests_block_admin_manager_name --keepdb
"""
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import GreenhouseBlock, User
from apps.greenhouse.models import BlockManagerAssignment


def _make_user(username: str, role: str, first_name: str = '', last_name: str = '') -> User:
    user = User(username=username, role=role, first_name=first_name, last_name=last_name)
    user.set_password('testpass123')
    user.save()
    return user


class BlockAdminManagerNameTests(TestCase):

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=_make_user('mn_director', 'director'))
        self.old = _make_user('mn_old', 'greenhouse_manager', 'Old', 'Manager')
        self.new = _make_user('mn_new', 'greenhouse_manager', 'New', 'Manager')
        self.gone = _make_user('mn_gone', 'greenhouse_manager', 'Gone', 'Manager')
        self.block = GreenhouseBlock.objects.create(code='MN_A', manager=self.old)
        BlockManagerAssignment.objects.create(user=self.new, block=self.block)
        BlockManagerAssignment.objects.create(user=self.gone, block=self.block, is_active=False)

    def test_list_shows_active_assignments_not_stale_fk(self):
        resp = self.client.get('/api/v1/greenhouse/admin/blocks/?page_size=200')
        self.assertEqual(resp.status_code, 200)
        rows = resp.data['results'] if isinstance(resp.data, dict) else resp.data
        row = next(r for r in rows if r['code'] == 'MN_A')
        self.assertEqual(row['manager_name'], 'New Manager')

    def test_detail_null_when_no_active_assignment(self):
        block = GreenhouseBlock.objects.create(code='MN_B', manager=self.old)
        resp = self.client.get(f'/api/v1/greenhouse/admin/blocks/{block.id}/')
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.data['manager_name'])
