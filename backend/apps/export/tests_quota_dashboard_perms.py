"""Regression tests for QuotaDashboardView permission gating.

Guards against the cc28108 regression where QuotaDashboardView used
``resource_code = 'quota'`` — a resource that does not exist in
RESOURCE_REGISTRY — so DynamicResourcePermission returned 403 for every
non-superuser role (export_manager, document_team, director), surfacing as
"Failed to load quota data" on the frontend.

The dashboard is now gated by ``quota_issuance`` view access, which exactly
matches the roles that can see the export.quota page.
"""
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import Season, User

URL = '/api/v1/export/quota-dashboard/'


def _make_user(username: str, role: str) -> User:
    user = User(username=username, role=role)
    user.set_password('pass')
    user.save()
    return user


class QuotaDashboardPermissionTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.season = Season.objects.create(
            name='qd25', start_date='2025-09-01', end_date='2026-06-30', is_active=True,
        )

    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def test_export_manager_can_load_dashboard(self):
        """The named bug: export_manager must get 200, not 403."""
        self.client.force_authenticate(user=_make_user('gadam', 'export_manager'))
        resp = self.client.get(URL, {'season': self.season.id})
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertIn('kpis', resp.data)

    def test_document_team_can_load_dashboard(self):
        """document_team has the export.quota page + quota_issuance view → 200."""
        self.client.force_authenticate(user=_make_user('sulgun', 'document_team'))
        resp = self.client.get(URL, {'season': self.season.id})
        self.assertEqual(resp.status_code, 200, resp.content)

    def test_role_without_quota_access_is_forbidden(self):
        """seller has no quota_issuance perm → 403 (frontend gates the query)."""
        self.client.force_authenticate(user=_make_user('seller1', 'seller'))
        resp = self.client.get(URL, {'season': self.season.id})
        self.assertEqual(resp.status_code, 403, resp.content)

    def test_anonymous_is_unauthorized(self):
        resp = self.client.get(URL, {'season': self.season.id})
        self.assertEqual(resp.status_code, 401, resp.content)
