"""Tests for the boss process-doc endpoint.

Covers:
- Boss user gets 200 + text/html + distinctive body content for each valid slug
- Unknown slug -> 404
- Path-traversal attempts -> 404, no content leak
- Non-boss/director role -> 403 (permission class regression guard)
- Missing ?doc= -> 404 (see report for rationale)

GET /api/v1/export/boss/process-doc/?doc=<slug>
"""
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import User


def _create_user(username: str, role: str) -> User:
    user = User(username=username, role=role)
    user.set_password('pass')
    user.save()
    return user


class ProcessDocEndpointTests(TestCase):

    URL = '/api/v1/export/boss/process-doc/'

    def setUp(self):
        self.client = APIClient()
        self.boss = _create_user('boss_pd', 'boss')
        self.export_mgr = _create_user('mgr_pd', 'export_manager')

    def _get(self, user, query: str):
        self.client.force_authenticate(user=user)
        return self.client.get(f'{self.URL}{query}')

    # -- happy path: two valid slugs, distinct content ------------------

    def test_shipment_process_boss_returns_correct_document(self):
        resp = self._get(self.boss, '?doc=shipment-process-boss')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp['Content-Type'], 'text/html; charset=utf-8')
        body = resp.content.decode('utf-8')
        self.assertIn('How a Shipment Works', body)
        self.assertNotIn('Export Shipment — BPMN', body)

    def test_shipment_bpmn_returns_correct_document(self):
        resp = self._get(self.boss, '?doc=shipment-bpmn')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp['Content-Type'], 'text/html; charset=utf-8')
        body = resp.content.decode('utf-8')
        self.assertIn('Export Shipment — BPMN', body)
        self.assertNotIn('How a Shipment Works', body)

    # -- unknown slug -----------------------------------------------------

    def test_unknown_slug_returns_404(self):
        resp = self._get(self.boss, '?doc=nonexistent-doc')
        self.assertEqual(resp.status_code, 404)

    # -- path traversal ---------------------------------------------------

    def test_path_traversal_dotdot_rejected(self):
        resp = self._get(self.boss, '?doc=../../manage.py')
        self.assertEqual(resp.status_code, 404)
        self.assertNotIn(b'BASE_DIR', resp.content)

    def test_path_traversal_encoded_dotdot_rejected(self):
        resp = self._get(self.boss, '?doc=..%2f..%2fmanage.py')
        self.assertEqual(resp.status_code, 404)
        self.assertNotIn(b'BASE_DIR', resp.content)

    def test_path_traversal_absolute_path_rejected(self):
        resp = self._get(self.boss, '?doc=/etc/passwd')
        self.assertEqual(resp.status_code, 404)

    def test_slug_case_mismatch_rejected(self):
        resp = self._get(self.boss, '?doc=Shipment-Process-Boss')
        self.assertEqual(resp.status_code, 404)

    # -- permission regression guard --------------------------------------

    def test_non_boss_non_director_gets_403(self):
        resp = self._get(self.export_mgr, '?doc=shipment-bpmn')
        self.assertEqual(resp.status_code, 403)

    # -- missing param ------------------------------------------------------

    def test_missing_doc_param_returns_404(self):
        resp = self._get(self.boss, '')
        self.assertEqual(resp.status_code, 404)
