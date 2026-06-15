"""Tests for delegated user management (ADR-022).

A loading_dept_head may create/edit/delete/reset-password ONLY the
loading_dept_head_deputy + weight_master roles, and may grant those roles a
subset of his own visible (non-admin) pages. The backend is the security
boundary; these tests pin the bounds and the privilege-escalation guards.

Covers:
- List endpoint is scoped to managed roles for the head; full for admin.
- Create / patch-role / delete / set-password allowed within the set, blocked
  outside it (no escalation to admin or sideways to unmanaged roles).
- A non-manager role (sales_rep / weight_master) is denied entirely.
- managed-page-permissions GET returns only managed roles + grantable
  (own-visible, non-admin) pages.
- managed-page-permissions PUT is a surgical upsert: it never touches rows for
  other roles or pages outside the grantable set, and rejects out-of-bounds
  roles/pages and admin.* pages.
"""
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import RolePagePermission, User

USERS_URL = '/api/v1/export/admin/users/'
MPP_URL = '/api/v1/export/admin/managed-page-permissions/'


def _create_user(username: str, role: str) -> User:
    user = User(username=username, role=role)
    user.set_password('pass12345')
    user.save()
    return user


class DelegatedUserMgmtTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.admin = _create_user('admin1', 'admin')
        self.superuser = User(username='su', role='admin', is_superuser=True, is_staff=True)
        self.superuser.set_password('pass12345')
        self.superuser.save()
        self.head = _create_user('head', 'loading_dept_head')
        self.deputy = _create_user('deputy', 'loading_dept_head_deputy')
        self.weigh = _create_user('weigh', 'weight_master')
        self.export_mgr = _create_user('mgr', 'export_manager')
        self.sales = _create_user('sales', 'sales_rep')
        # Deterministic grantable page for the head regardless of seed contents.
        RolePagePermission.objects.update_or_create(
            role='loading_dept_head', page_code='export.shipments',
            defaults={'is_visible': True},
        )

    def _auth(self, user):
        self.client.force_authenticate(user=user)

    # ── List scoping ─────────────────────────────────────────────────────

    def test_head_sees_only_managed_roles(self):
        self._auth(self.head)
        resp = self.client.get(USERS_URL + '?page_size=200')
        self.assertEqual(resp.status_code, 200, resp.data)
        rows = resp.data.get('results', resp.data)
        roles = {r['role'] for r in rows}
        self.assertSetEqual(roles, {'loading_dept_head_deputy', 'weight_master'})

    def test_admin_sees_all_roles(self):
        self._auth(self.admin)
        resp = self.client.get(USERS_URL + '?page_size=200')
        self.assertEqual(resp.status_code, 200, resp.data)
        rows = resp.data.get('results', resp.data)
        roles = {r['role'] for r in rows}
        self.assertIn('admin', roles)
        self.assertIn('export_manager', roles)

    def test_non_manager_denied_list(self):
        self._auth(self.sales)
        resp = self.client.get(USERS_URL)
        self.assertEqual(resp.status_code, 403, resp.data)

    # ── Create ───────────────────────────────────────────────────────────

    def test_head_can_create_weight_master(self):
        self._auth(self.head)
        resp = self.client.post(USERS_URL, {
            'username': 'newweigh', 'password': 'pass12345', 'role': 'weight_master',
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertTrue(User.objects.filter(username='newweigh', role='weight_master').exists())

    def test_superuser_can_create_any_role(self):
        self._auth(self.superuser)
        resp = self.client.post(USERS_URL, {
            'username': 'anymgr', 'password': 'pass12345', 'role': 'export_manager',
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)

    def test_admin_role_without_superuser_cannot_create(self):
        # AD-15 preserved: create stays superuser-only for the admin tier — the
        # plain admin role is NOT widened by ADR-022 (only delegated managers are).
        self._auth(self.admin)
        resp = self.client.post(USERS_URL, {
            'username': 'nope', 'password': 'pass12345', 'role': 'weight_master',
        }, format='json')
        self.assertEqual(resp.status_code, 403, resp.data)
        self.assertFalse(User.objects.filter(username='nope').exists())

    def test_head_cannot_create_outside_set(self):
        self._auth(self.head)
        for role in ('export_manager', 'admin', 'loading_dept_head'):
            resp = self.client.post(USERS_URL, {
                'username': f'x_{role}', 'password': 'pass12345', 'role': role,
            }, format='json')
            self.assertEqual(resp.status_code, 403, f'{role}: {resp.data}')
            self.assertFalse(User.objects.filter(username=f'x_{role}').exists())

    # ── Patch role / is_active ───────────────────────────────────────────

    def test_head_can_toggle_active_on_managed_user(self):
        self._auth(self.head)
        resp = self.client.patch(f'{USERS_URL}{self.weigh.id}/', {'is_active': False}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.weigh.refresh_from_db()
        self.assertFalse(self.weigh.is_active)

    def test_head_cannot_escalate_managed_user_to_admin(self):
        self._auth(self.head)
        resp = self.client.patch(f'{USERS_URL}{self.weigh.id}/', {'role': 'admin'}, format='json')
        self.assertEqual(resp.status_code, 403, resp.data)
        self.weigh.refresh_from_db()
        self.assertEqual(self.weigh.role, 'weight_master')

    def test_head_cannot_patch_unmanaged_user(self):
        # export_manager is outside the head's scoped queryset → not found.
        self._auth(self.head)
        resp = self.client.patch(f'{USERS_URL}{self.export_mgr.id}/', {'is_active': False}, format='json')
        self.assertEqual(resp.status_code, 404, resp.data)

    # ── Delete ───────────────────────────────────────────────────────────

    def test_head_can_delete_managed_user(self):
        self._auth(self.head)
        resp = self.client.delete(f'{USERS_URL}{self.deputy.id}/')
        self.assertEqual(resp.status_code, 204, getattr(resp, 'data', None))
        self.assertFalse(User.objects.filter(id=self.deputy.id).exists())

    def test_head_cannot_delete_unmanaged_user(self):
        self._auth(self.head)
        resp = self.client.delete(f'{USERS_URL}{self.export_mgr.id}/')
        self.assertEqual(resp.status_code, 404, getattr(resp, 'data', None))
        self.assertTrue(User.objects.filter(id=self.export_mgr.id).exists())

    # ── Set password ─────────────────────────────────────────────────────

    def test_head_can_reset_managed_password(self):
        self._auth(self.head)
        resp = self.client.post(f'{USERS_URL}{self.weigh.id}/set-password/', {'password': 'brandnew1'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.weigh.refresh_from_db()
        self.assertTrue(self.weigh.check_password('brandnew1'))

    def test_head_cannot_reset_unmanaged_password(self):
        self._auth(self.head)
        resp = self.client.post(f'{USERS_URL}{self.export_mgr.id}/set-password/', {'password': 'brandnew1'}, format='json')
        self.assertEqual(resp.status_code, 404, getattr(resp, 'data', None))

    # ── Managed page permissions GET ─────────────────────────────────────

    def test_mpp_get_returns_managed_roles_and_grantable_pages(self):
        self._auth(self.head)
        resp = self.client.get(MPP_URL)
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertSetEqual(set(resp.data['roles']), {'loading_dept_head_deputy', 'weight_master'})
        page_codes = {p['code'] for p in resp.data['pages']}
        self.assertIn('export.shipments', page_codes)
        # No admin.* page may be grantable (privilege-leak guard).
        self.assertFalse(any(c.startswith('admin.') for c in page_codes))

    def test_mpp_get_denied_for_non_manager(self):
        self._auth(self.sales)
        resp = self.client.get(MPP_URL)
        self.assertEqual(resp.status_code, 403, resp.data)

    # ── Managed page permissions PUT ─────────────────────────────────────

    def test_mpp_put_surgical_grant(self):
        # A pre-existing admin-granted row OUTSIDE the grantable set must survive.
        RolePagePermission.objects.update_or_create(
            role='weight_master', page_code='admin.users',
            defaults={'is_visible': True},
        )
        self._auth(self.head)
        resp = self.client.put(MPP_URL, {
            'matrix': {'weight_master': {'export.shipments': True}},
        }, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        # The grant landed.
        self.assertTrue(
            RolePagePermission.objects.get(role='weight_master', page_code='export.shipments').is_visible
        )
        # The out-of-band admin row is untouched (no delete-all).
        self.assertTrue(
            RolePagePermission.objects.get(role='weight_master', page_code='admin.users').is_visible
        )

    def test_mpp_put_rejects_admin_page(self):
        self._auth(self.head)
        resp = self.client.put(MPP_URL, {
            'matrix': {'weight_master': {'admin.users': True}},
        }, format='json')
        self.assertEqual(resp.status_code, 403, resp.data)

    def test_mpp_put_rejects_unmanaged_role(self):
        self._auth(self.head)
        resp = self.client.put(MPP_URL, {
            'matrix': {'export_manager': {'export.shipments': True}},
        }, format='json')
        self.assertEqual(resp.status_code, 403, resp.data)

    def test_mpp_put_rejects_ungrantable_page(self):
        # A page the head's own role cannot see is not grantable.
        RolePagePermission.objects.filter(
            role='loading_dept_head', page_code='export.prices',
        ).update(is_visible=False)
        self._auth(self.head)
        resp = self.client.put(MPP_URL, {
            'matrix': {'weight_master': {'export.prices': True}},
        }, format='json')
        self.assertEqual(resp.status_code, 403, resp.data)
