"""Role `garawul` (gate guard): bound to one LoadingLocation.

Spec: docs/superpowers/specs/2026-09-29-garawul-gate-design.md §1.1
"""
import importlib
from pathlib import Path

from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.management.commands.seed_permissions import PAGE_DEFAULTS
from apps.core.models import LoadingLocation, RolePagePermission, RoleResourcePermission, User
from apps.core.permission_registry import PAGE_REGISTRY


class GarawulUserApiTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_superuser(username='gw_admin', password='pw', role='admin')
        cls.dusak = LoadingLocation.objects.create(name='Dusak')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def test_create_guard_without_location_is_refused(self):
        resp = self.client.post('/api/v1/export/admin/users/', {
            'username': 'g1', 'password': 'secret1', 'role': 'garawul',
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('loading_location', resp.data)

    def test_create_guard_with_location_saves_it(self):
        resp = self.client.post('/api/v1/export/admin/users/', {
            'username': 'g2', 'password': 'secret1', 'role': 'garawul',
            'loading_location': self.dusak.pk,
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['loading_location'], self.dusak.pk)
        self.assertEqual(User.objects.get(username='g2').loading_location, self.dusak)

    def test_create_with_unknown_location_is_refused(self):
        resp = self.client.post('/api/v1/export/admin/users/', {
            'username': 'g3', 'password': 'secret1', 'role': 'garawul',
            'loading_location': 999999,
        }, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_patch_to_guard_without_location_is_refused(self):
        user = User.objects.create_user(username='g4', password='pw', role='transport')
        resp = self.client.patch(f'/api/v1/export/admin/users/{user.pk}/', {'role': 'garawul'}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_patch_to_guard_with_location_saves_both(self):
        user = User.objects.create_user(username='g5', password='pw', role='transport')
        resp = self.client.patch(f'/api/v1/export/admin/users/{user.pk}/', {
            'role': 'garawul', 'loading_location': self.dusak.pk,
        }, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        user.refresh_from_db()
        self.assertEqual((user.role, user.loading_location_id), ('garawul', self.dusak.pk))

    def test_other_roles_need_no_location(self):
        resp = self.client.post('/api/v1/export/admin/users/', {
            'username': 'g6', 'password': 'secret1', 'role': 'transport',
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)

    def test_create_with_non_numeric_location_is_refused(self):
        resp = self.client.post('/api/v1/export/admin/users/', {
            'username': 'g7', 'password': 'secret1', 'role': 'garawul',
            'loading_location': 'abc',
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('loading_location', resp.data)


def _perm_migration():
    path = next(Path(__file__).parent.joinpath('migrations').glob('*_seed_garawul_perms.py'))
    return importlib.import_module(f'apps.core.migrations.{path.stem}')


class GarawulPermissionSeedTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions', verbosity=0)

    def test_guard_sees_only_the_gate_and_his_tasks(self):
        visible = set(
            RolePagePermission.objects.filter(role='garawul', is_visible=True)
            .values_list('page_code', flat=True)
        )
        self.assertEqual(visible, {'export.gate', 'me.board'})

    def test_guard_has_a_row_for_every_page(self):
        # A partial matrix loses access on the next /admin/permissions Save.
        self.assertEqual(
            RolePagePermission.objects.filter(role='garawul').count(), len(PAGE_REGISTRY),
        )

    def test_guard_holds_gate_view_edit_and_no_shipment_grant(self):
        rows = {
            r.resource_code: (r.can_view, r.can_create, r.can_edit, r.can_delete)
            for r in RoleResourcePermission.objects.filter(role='garawul')
        }
        self.assertEqual(rows, {'gate': (True, False, True, False)})

    def test_gate_is_off_for_operational_wildcard_roles(self):
        for role in ('director', 'export_manager', 'document_team'):
            with self.subTest(role=role):
                self.assertFalse(
                    RoleResourcePermission.objects.filter(role=role, resource_code='gate').exists()
                )
                self.assertFalse(
                    RolePagePermission.objects.get(role=role, page_code='export.gate').is_visible
                )

    def test_admin_and_boss_hold_the_gate(self):
        for role in ('admin', 'boss'):
            with self.subTest(role=role):
                row = RoleResourcePermission.objects.get(role=role, resource_code='gate')
                self.assertTrue(row.can_view and row.can_edit)
                self.assertTrue(
                    RolePagePermission.objects.get(role=role, page_code='export.gate').is_visible
                )

    def test_migration_visible_set_matches_the_seeded_matrix(self):
        self.assertEqual(set(_perm_migration().VISIBLE_PAGES), PAGE_DEFAULTS['garawul'])

    def test_migration_snapshot_is_a_subset_of_registered_pages(self):
        # The migration's ALL_PAGES is a frozen snapshot of PAGE_REGISTRY as of
        # 2026-09-29 (by design — see the migration's docstring): a page
        # another session registers later gets its own migration, not a rewrite
        # of this one. Strict equality broke the day 'transport.plan' was
        # added; the binding guarantees are (a) every snapshotted page still
        # exists and (b) 'export.gate', the page this migration exists for, is
        # among them (final-fix review F4).
        self.assertTrue(set(_perm_migration().ALL_PAGES) <= set(PAGE_REGISTRY))
        self.assertIn('export.gate', _perm_migration().ALL_PAGES)
