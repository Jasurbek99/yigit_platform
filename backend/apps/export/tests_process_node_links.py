"""Tests for ProcessNodeLink — BPMN node -> app screen mapping.

Covers:
- The 0060 data migration seeds exactly 20 rows with the expected node_ids.
- GET /api/v1/export/boss/process-doc-links/ returns a flat {node_id: route}
  object of active, non-blank-route rows; boss/director/admin only.
- The admin CRUD endpoint: admin can PATCH route; a non-admin gets 403.
- node_id cannot be changed via PATCH (read-only on the serializer).
- The seed migration's reverse function runs cleanly.
"""
import importlib

from django.apps import apps as global_apps
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import User
from apps.export.models import ProcessNodeLink

# Expected 20 rows verified against docs/how_works/shipment-bpmn.html's N array.
EXPECTED_NODE_IDS = {
    'em_weekly', 'load_fc', 'destB', 'supplyA', 'transA', 'join', 'onetime',
    'invoice', 'docgen', 'customs', 'loadtruck', 'departed', 'border',
    'destcust', 'peregruz', 'arrived', 'sell', 'report', 'accept', 'fin_close',
}

_SEED_MODULE = 'apps.export.migrations.0060_seed_process_node_links'


def _create_user(username: str, role: str) -> User:
    user = User(username=username, role=role)
    user.set_password('pass')
    user.save()
    return user


class ProcessNodeLinkMigrationSeedTests(TestCase):
    """The data migration ran while building the test DB — assert its result."""

    def test_seeds_exactly_20_rows(self):
        self.assertEqual(ProcessNodeLink.objects.count(), 20)

    def test_seeds_expected_node_ids(self):
        actual = set(ProcessNodeLink.objects.values_list('node_id', flat=True))
        self.assertEqual(actual, EXPECTED_NODE_IDS)

    def test_em_weekly_seeded_correctly(self):
        row = ProcessNodeLink.objects.get(node_id='em_weekly')
        self.assertEqual(row.label, 'Hepdelik maşyn planlamak')
        self.assertEqual(row.route, '/export/plan')
        self.assertTrue(row.is_active)

    def test_reverse_migration_runs_cleanly(self):
        mod = importlib.import_module(_SEED_MODULE)
        mod.unseed_process_node_links(global_apps, None)
        self.assertEqual(
            ProcessNodeLink.objects.filter(node_id__in=EXPECTED_NODE_IDS).count(), 0,
        )
        # Re-seed so later tests in the same run still see the 20 rows.
        mod.seed_process_node_links(global_apps, None)
        self.assertEqual(ProcessNodeLink.objects.count(), 20)


class ProcessDocLinksEndpointTests(TestCase):
    """GET /api/v1/export/boss/process-doc-links/"""

    URL = '/api/v1/export/boss/process-doc-links/'

    def setUp(self):
        self.client = APIClient()
        self.boss = _create_user('boss_pnl', 'boss')
        self.export_mgr = _create_user('mgr_pnl', 'export_manager')

    def _get(self, user):
        self.client.force_authenticate(user=user)
        return self.client.get(self.URL)

    def test_boss_gets_flat_node_id_to_route_object(self):
        resp = self._get(self.boss)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['em_weekly'], '/export/plan')
        self.assertEqual(resp.data['fin_close'], '/export/advances')
        self.assertEqual(len(resp.data), 20)

    def test_inactive_row_absent(self):
        ProcessNodeLink.objects.filter(node_id='onetime').update(is_active=False)
        resp = self._get(self.boss)
        self.assertNotIn('onetime', resp.data)

    def test_blank_route_row_absent(self):
        ProcessNodeLink.objects.filter(node_id='onetime').update(route='')
        resp = self._get(self.boss)
        self.assertNotIn('onetime', resp.data)

    def test_non_boss_non_director_gets_403(self):
        resp = self._get(self.export_mgr)
        self.assertEqual(resp.status_code, 403)


class ProcessNodeLinkAdminViewSetTests(TestCase):
    """Admin CRUD: GET/PATCH under /api/v1/export/admin/process-node-links/"""

    LIST_URL = '/api/v1/export/admin/process-node-links/'

    def setUp(self):
        self.client = APIClient()
        self.admin = _create_user('admin_pnl', 'admin')
        self.export_mgr = _create_user('mgr_pnl_admin', 'export_manager')
        self.row = ProcessNodeLink.objects.get(node_id='onetime')

    def _detail_url(self, pk: int) -> str:
        return f'{self.LIST_URL}{pk}/'

    def test_admin_can_patch_route(self):
        self.client.force_authenticate(user=self.admin)
        resp = self.client.patch(self._detail_url(self.row.pk), {'route': '/contracts/new'}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.row.refresh_from_db()
        self.assertEqual(self.row.route, '/contracts/new')

    def test_non_admin_cannot_patch(self):
        self.client.force_authenticate(user=self.export_mgr)
        resp = self.client.patch(self._detail_url(self.row.pk), {'route': '/contracts/new'}, format='json')
        self.assertEqual(resp.status_code, 403)

    def test_non_admin_cannot_list(self):
        self.client.force_authenticate(user=self.export_mgr)
        resp = self.client.get(self.LIST_URL)
        self.assertEqual(resp.status_code, 403)

    def test_node_id_is_read_only_on_patch(self):
        """A PATCH attempting to change node_id must be silently ignored —
        this test must fail if node_id is ever made writable on the serializer."""
        self.client.force_authenticate(user=self.admin)
        original_node_id = self.row.node_id
        resp = self.client.patch(
            self._detail_url(self.row.pk),
            {'node_id': 'hijacked', 'route': '/contracts/new'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.row.refresh_from_db()
        self.assertEqual(self.row.node_id, original_node_id)


class ProcessNodeLinkRouteValidationTests(TestCase):
    """Stored-XSS guard: `route` is written into a diagram <a href> the boss
    clicks (docs/how_works/shipment-bpmn.html), so it must be constrained to
    an in-app absolute path server-side — the frontend's client-side check is
    bypassed by calling the API directly.

    These tests assert against the DATABASE ROW, not just the response
    status: a 400 with the value written anyway would still be a stored-XSS
    hole. They are designed to fail if ProcessNodeLink.route's RegexValidator
    is ever removed (verified manually — see task-14-report.md).
    """

    LIST_URL = '/api/v1/export/admin/process-node-links/'

    def setUp(self):
        self.client = APIClient()
        self.admin = _create_user('admin_pnl_route', 'admin')
        self.row = ProcessNodeLink.objects.get(node_id='onetime')
        self.original_route = self.row.route
        self.client.force_authenticate(user=self.admin)

    def _detail_url(self, pk: int) -> str:
        return f'{self.LIST_URL}{pk}/'

    def _patch(self, route: str):
        return self.client.patch(self._detail_url(self.row.pk), {'route': route}, format='json')

    def test_javascript_scheme_rejected_and_row_unchanged(self):
        resp = self._patch('javascript:alert(1)')
        self.assertEqual(resp.status_code, 400)
        self.row.refresh_from_db()
        self.assertEqual(self.row.route, self.original_route)

    def test_protocol_relative_url_rejected_and_row_unchanged(self):
        resp = self._patch('//evil.example')
        self.assertEqual(resp.status_code, 400)
        self.row.refresh_from_db()
        self.assertEqual(self.row.route, self.original_route)

    def test_value_with_scheme_rejected_and_row_unchanged(self):
        resp = self._patch('https://evil.example/phish')
        self.assertEqual(resp.status_code, 400)
        self.row.refresh_from_db()
        self.assertEqual(self.row.route, self.original_route)

    def test_value_not_starting_with_slash_rejected_and_row_unchanged(self):
        resp = self._patch('evil.example')
        self.assertEqual(resp.status_code, 400)
        self.row.refresh_from_db()
        self.assertEqual(self.row.route, self.original_route)

    def test_data_scheme_rejected_and_row_unchanged(self):
        resp = self._patch('data:text/html,<script>alert(1)</script>')
        self.assertEqual(resp.status_code, 400)
        self.row.refresh_from_db()
        self.assertEqual(self.row.route, self.original_route)

    def test_legitimate_route_still_saves(self):
        resp = self._patch('/export/plan')
        self.assertEqual(resp.status_code, 200)
        self.row.refresh_from_db()
        self.assertEqual(self.row.route, '/export/plan')

    def test_empty_route_still_saves(self):
        """Blank route is a supported state — 'not linked'."""
        resp = self._patch('')
        self.assertEqual(resp.status_code, 200)
        self.row.refresh_from_db()
        self.assertEqual(self.row.route, '')
