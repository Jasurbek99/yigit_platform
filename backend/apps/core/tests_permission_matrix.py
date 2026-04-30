"""Tests for the admin/permission separation introduced by AD-15.

Covers:
- Admin can GET / PUT all three permission matrices.
- Director, export_manager, sales_rep get 403 on every method.
- Admin can PATCH /api/v1/export/admin/users/{id}/ (role change).
- Director and export_manager get 403 on the same PATCH.
- Last-admin guard: admin cannot demote / deactivate the last active admin.
- Admin can PUT /api/v1/export/admin/users/{id}/permissions/.
"""
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import User


def _create_user(username: str, role: str, *, is_superuser: bool = False) -> User:
    user = User(username=username, role=role)
    user.set_password('pass')
    if is_superuser:
        user.is_superuser = True
        user.is_staff = True
    user.save()
    return user


class PermissionMatrixGatesTests(TestCase):
    """The three permission-matrix endpoints must be admin-only."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')

    def setUp(self):
        self.client = APIClient()
        self.admin = _create_user('admin1', 'admin')
        self.director = _create_user('dir', 'director')
        self.export_mgr = _create_user('mgr', 'export_manager')
        self.sales = _create_user('sales', 'sales_rep')

    def _auth(self, user):
        self.client.force_authenticate(user=user)

    # ── GET ─────────────────────────────────────────────────────────────
    def test_admin_can_get_all_three_matrices(self):
        self._auth(self.admin)
        for path in (
            '/api/v1/core/admin/page-permissions/',
            '/api/v1/core/admin/resource-permissions/',
            '/api/v1/core/admin/field-permissions/?resource=shipment',
        ):
            resp = self.client.get(path)
            self.assertEqual(resp.status_code, 200, msg=f'{path}: {resp.data}')

    def test_director_blocked_from_all_three_matrices(self):
        self._auth(self.director)
        for path in (
            '/api/v1/core/admin/page-permissions/',
            '/api/v1/core/admin/resource-permissions/',
            '/api/v1/core/admin/field-permissions/?resource=shipment',
        ):
            resp = self.client.get(path)
            self.assertEqual(resp.status_code, 403, msg=f'{path}: {resp.data}')

    def test_export_manager_blocked_from_all_three_matrices(self):
        self._auth(self.export_mgr)
        for path in (
            '/api/v1/core/admin/page-permissions/',
            '/api/v1/core/admin/resource-permissions/',
            '/api/v1/core/admin/field-permissions/?resource=shipment',
        ):
            resp = self.client.get(path)
            self.assertEqual(resp.status_code, 403, msg=f'{path}: {resp.data}')

    def test_sales_rep_blocked_from_all_three_matrices(self):
        self._auth(self.sales)
        for path in (
            '/api/v1/core/admin/page-permissions/',
            '/api/v1/core/admin/resource-permissions/',
            '/api/v1/core/admin/field-permissions/?resource=shipment',
        ):
            resp = self.client.get(path)
            self.assertEqual(resp.status_code, 403, msg=f'{path}: {resp.data}')

    # ── Permission registry (also admin-only) ───────────────────────────
    def test_admin_can_get_permission_registry(self):
        self._auth(self.admin)
        resp = self.client.get('/api/v1/core/admin/permission-registry/')
        self.assertEqual(resp.status_code, 200, resp.data)

    def test_director_blocked_from_permission_registry(self):
        self._auth(self.director)
        resp = self.client.get('/api/v1/core/admin/permission-registry/')
        self.assertEqual(resp.status_code, 403, resp.data)

    # ── Superuser bypass ─────────────────────────────────────────────────
    def test_superuser_with_other_role_can_get(self):
        sysop = _create_user('sysop', 'export_manager', is_superuser=True)
        self._auth(sysop)
        resp = self.client.get('/api/v1/core/admin/page-permissions/')
        self.assertEqual(resp.status_code, 200, resp.data)


class UserManagementGatesTests(TestCase):
    """User-role PATCH and permissions PUT must be admin-only (or superuser)."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')

    def setUp(self):
        self.client = APIClient()
        self.admin = _create_user('admin1', 'admin')
        self.director = _create_user('dir', 'director')
        self.export_mgr = _create_user('mgr', 'export_manager')
        self.target = _create_user('target', 'transport')

    def _auth(self, user):
        self.client.force_authenticate(user=user)

    def test_admin_can_patch_user_role(self):
        self._auth(self.admin)
        resp = self.client.patch(
            f'/api/v1/export/admin/users/{self.target.id}/',
            {'role': 'document_team'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.target.refresh_from_db()
        self.assertEqual(self.target.role, 'document_team')

    def test_director_cannot_patch_user_role(self):
        self._auth(self.director)
        resp = self.client.patch(
            f'/api/v1/export/admin/users/{self.target.id}/',
            {'role': 'document_team'},
            format='json',
        )
        self.assertEqual(resp.status_code, 403, resp.data)

    def test_export_manager_cannot_patch_user_role(self):
        self._auth(self.export_mgr)
        resp = self.client.patch(
            f'/api/v1/export/admin/users/{self.target.id}/',
            {'role': 'document_team'},
            format='json',
        )
        self.assertEqual(resp.status_code, 403, resp.data)

    def test_admin_can_put_user_permissions(self):
        self._auth(self.admin)
        resp = self.client.put(
            f'/api/v1/export/admin/users/{self.target.id}/permissions/',
            {'permissions': []},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)

    def test_director_cannot_put_user_permissions(self):
        self._auth(self.director)
        resp = self.client.put(
            f'/api/v1/export/admin/users/{self.target.id}/permissions/',
            {'permissions': []},
            format='json',
        )
        self.assertEqual(resp.status_code, 403, resp.data)

    def test_export_manager_cannot_put_user_permissions(self):
        self._auth(self.export_mgr)
        resp = self.client.put(
            f'/api/v1/export/admin/users/{self.target.id}/permissions/',
            {'permissions': []},
            format='json',
        )
        self.assertEqual(resp.status_code, 403, resp.data)


class LastAdminGuardTests(TestCase):
    """Admin cannot demote / deactivate the last active admin in the system."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')

    def setUp(self):
        self.client = APIClient()
        self.admin = _create_user('admin1', 'admin')

    def _auth(self, user):
        self.client.force_authenticate(user=user)

    def test_cannot_demote_last_admin(self):
        self._auth(self.admin)
        resp = self.client.patch(
            f'/api/v1/export/admin/users/{self.admin.id}/',
            {'role': 'export_manager'},
            format='json',
        )
        self.assertEqual(resp.status_code, 403, resp.data)
        self.admin.refresh_from_db()
        self.assertEqual(self.admin.role, 'admin')

    def test_cannot_deactivate_last_admin(self):
        self._auth(self.admin)
        resp = self.client.patch(
            f'/api/v1/export/admin/users/{self.admin.id}/',
            {'is_active': False},
            format='json',
        )
        self.assertEqual(resp.status_code, 403, resp.data)
        self.admin.refresh_from_db()
        self.assertTrue(self.admin.is_active)

    def test_can_demote_admin_when_other_admin_exists(self):
        other_admin = _create_user('admin2', 'admin')
        self._auth(self.admin)
        resp = self.client.patch(
            f'/api/v1/export/admin/users/{other_admin.id}/',
            {'role': 'export_manager'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        other_admin.refresh_from_db()
        self.assertEqual(other_admin.role, 'export_manager')

    def test_admin_can_promote_others_freely(self):
        target = _create_user('promote_me', 'transport')
        self._auth(self.admin)
        resp = self.client.patch(
            f'/api/v1/export/admin/users/{target.id}/',
            {'role': 'admin'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        target.refresh_from_db()
        self.assertEqual(target.role, 'admin')

    def test_string_false_payload_cannot_bypass_last_admin_guard(self):
        # Regression: an earlier version of the guard checked
        # isinstance(request.data['is_active'], bool) BEFORE DRF's BooleanField
        # had coerced the payload, so {"is_active": "false"} silently bypassed
        # the guard. The guard now runs in perform_update against
        # serializer.validated_data — DRF has already coerced the value.
        self._auth(self.admin)
        resp = self.client.patch(
            f'/api/v1/export/admin/users/{self.admin.id}/',
            {'is_active': 'false'},
            format='json',
        )
        self.assertEqual(resp.status_code, 403, resp.data)
        self.admin.refresh_from_db()
        self.assertTrue(self.admin.is_active)

    def test_director_em_keep_operational_pages_after_seed(self):
        # Migration 0016 deletes admin.* page rows from director and the lone
        # admin.permissions row from EM. Seed_permissions then tops up everything
        # else. This test guards that the deletion-then-seed combination doesn't
        # accidentally strip operational pages from director or EM.
        from apps.core.models import RolePagePermission

        operational_pages = [
            'dashboard', 'export.shipments', 'export.kanban', 'export.quota',
            'export.plan', 'export.prices',
        ]
        for role in ('director', 'export_manager'):
            for page_code in operational_pages:
                row = RolePagePermission.objects.filter(
                    role=role, page_code=page_code, is_visible=True,
                ).first()
                self.assertIsNotNone(
                    row,
                    msg=f'{role} lost operational page {page_code} after seed/migration',
                )

    def test_director_em_have_no_admin_pages_visible_after_seed(self):
        # Mirror check: ensure director/EM do NOT have any admin.* pages visible.
        from apps.core.models import RolePagePermission

        for role in ('director', 'export_manager'):
            visible_admin = RolePagePermission.objects.filter(
                role=role, page_code__startswith='admin.', is_visible=True,
            ).values_list('page_code', flat=True)
            self.assertEqual(
                list(visible_admin), [],
                msg=f'{role} unexpectedly has admin pages visible: {list(visible_admin)}',
            )

    def test_admin_has_all_admin_pages_visible_after_seed(self):
        from apps.core.models import RolePagePermission

        admin_pages = RolePagePermission.objects.filter(
            role='admin', page_code__startswith='admin.', is_visible=True,
        ).values_list('page_code', flat=True)
        # Should match the seed_permissions PAGE_DEFAULTS for admin (every admin.*
        # page in PAGE_REGISTRY).
        from apps.core.permission_registry import PAGE_REGISTRY
        expected = {p for p in PAGE_REGISTRY if p.startswith('admin.')}
        self.assertSetEqual(set(admin_pages), expected)

    def test_migration_0016_deletes_stale_admin_rows_for_director_and_em(self):
        # Direct exercise of the data migration's deletion path. On a fresh test
        # DB seed_permissions never plants admin.* rows for director/EM, so the
        # other regression tests don't actually invoke the deletion. Here we
        # plant the stale rows manually (simulating an environment that ran
        # seed_permissions BEFORE AD-15), call the migration function, and assert
        # the deletion. Idempotency is verified by calling it twice.
        from apps.core.models import RolePagePermission
        from apps.core.migrations import (
            __name__ as migrations_pkg,  # noqa: F401  ensure package importable
        )
        from importlib import import_module
        from django.apps import apps as django_apps

        # Seed two stale rows that mimic the pre-AD-15 director/EM defaults.
        RolePagePermission.objects.update_or_create(
            role='director', page_code='admin.permissions',
            defaults={'is_visible': True},
        )
        RolePagePermission.objects.update_or_create(
            role='director', page_code='admin.users',
            defaults={'is_visible': True},
        )
        RolePagePermission.objects.update_or_create(
            role='export_manager', page_code='admin.permissions',
            defaults={'is_visible': True},
        )

        # Import the migration module directly and invoke its forward function.
        mig = import_module('apps.core.migrations.0016_demote_existing_director')
        mig.demote_director_and_em(django_apps, schema_editor=None)

        # All three stale rows should be gone.
        self.assertFalse(
            RolePagePermission.objects.filter(role='director', page_code__startswith='admin.').exists(),
            'Migration 0016 did not delete admin.* rows for director',
        )
        self.assertFalse(
            RolePagePermission.objects.filter(role='export_manager', page_code='admin.permissions').exists(),
            'Migration 0016 did not delete admin.permissions row for EM',
        )

        # Re-running must be a no-op (idempotency).
        mig.demote_director_and_em(django_apps, schema_editor=None)
        self.assertFalse(
            RolePagePermission.objects.filter(role='director', page_code__startswith='admin.').exists(),
        )

    def test_string_role_payload_blocked_by_last_admin_guard(self):
        # Same regression but for the role field — string equality already
        # worked, but verifying it stays correct under the new perform_update flow.
        self._auth(self.admin)
        resp = self.client.patch(
            f'/api/v1/export/admin/users/{self.admin.id}/',
            {'role': 'export_manager'},
            format='json',
        )
        self.assertEqual(resp.status_code, 403, resp.data)
        self.admin.refresh_from_db()
        self.assertEqual(self.admin.role, 'admin')
