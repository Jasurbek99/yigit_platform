"""AD-15 boundary: 'boss' holds operational admin authority but NOT user admin.

The Aug 2026 widening (`apps.core.roles.ADMIN_LIKE` / `is_admin_like`) folded
'boss' into the admin branch of every OPERATIONAL gate — the weekly plan, the
harvest forecast, late-edit extensions. AD-15 deliberately stops there: user
management and the permission matrix stay admin-only.

Nothing pinned that stop line at the HTTP layer. `tests_boss_access.py` covers
the permission-matrix DATA (seed rows + migration), and the greenhouse suite
covers the widened operational gates — but no test asserted that boss still
gets a 403 from the two endpoints that hand out authority. Those two are the
whole point of AD-15, and a future `role == 'admin'` → `is_admin_like(...)`
sweep over `views_admin.py` would break them silently.

`seed_permissions` runs first on purpose: it grants boss '*' on every unnarrowed
resource, so these tests prove the role gate holds even when the permission
matrix says boss owns everything.

Usage:
    python manage.py test apps.export.tests_ad15_boss_boundary --verbosity=2
"""
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import User
from apps.core.roles import ADMIN_LIKE, can_manage_users, is_admin_like, manageable_roles
from apps.export.views_admin import _is_full_admin

USERS_URL = '/api/v1/export/admin/users/'
MPP_URL = '/api/v1/export/admin/managed-page-permissions/'


def _create_user(username: str, role: str) -> User:
    user = User(username=username, role=role)
    user.set_password('pass12345')
    user.save()
    return user


class BossAd15BoundaryTests(TestCase):
    """Boss is admin-like on operations, and nobody at all on user admin."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.admin = _create_user('ad15_admin', 'admin')
        self.boss = _create_user('ad15_boss', 'boss')
        self.target = _create_user('ad15_target', 'weight_master')

    def _auth(self, user):
        self.client.force_authenticate(user=user)

    # ── The two escape hatches on the role-change gate ───────────────────

    def test_boss_passes_neither_escape_hatch_on_the_role_gate(self):
        """`partial_update` lets a caller through on `_is_full_admin` OR `can_manage_users`.

        Boss must fail both. `_is_full_admin` is a separate helper from
        `is_admin_like` — this pins that they have NOT been unified.
        """
        self.assertTrue(is_admin_like(self.boss))          # operational: yes
        self.assertFalse(_is_full_admin(self.boss))        # user admin: no
        self.assertFalse(can_manage_users(self.boss))      # delegated: no
        self.assertEqual(manageable_roles(self.boss), frozenset())

    def test_admin_still_passes_the_full_admin_hatch(self):
        self.assertTrue(_is_full_admin(self.admin))
        self.assertTrue(can_manage_users(self.admin))

    def test_boss_is_admin_like_but_admin_like_is_not_the_user_admin_set(self):
        self.assertIn('boss', ADMIN_LIKE)
        self.assertNotIn('boss', manageable_roles(self.boss))

    # ── PATCH /admin/users/{id}/ — changing someone's role ───────────────

    def test_boss_cannot_change_a_users_role(self):
        self._auth(self.boss)
        resp = self.client.patch(
            f'{USERS_URL}{self.target.id}/', {'role': 'admin'}, format='json',
        )
        self.assertEqual(resp.status_code, 403, resp.data)
        self.target.refresh_from_db()
        self.assertEqual(self.target.role, 'weight_master')

    def test_boss_cannot_promote_himself_to_admin(self):
        """The escalation that would make the whole AD-15 line moot."""
        self._auth(self.boss)
        resp = self.client.patch(
            f'{USERS_URL}{self.boss.id}/', {'role': 'admin'}, format='json',
        )
        self.assertEqual(resp.status_code, 403, resp.data)
        self.boss.refresh_from_db()
        self.assertEqual(self.boss.role, 'boss')

    def test_admin_can_change_a_users_role(self):
        """Control: the 403s above are the gate, not a broken endpoint."""
        self._auth(self.admin)
        resp = self.client.patch(
            f'{USERS_URL}{self.target.id}/', {'role': 'sales_rep'}, format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.target.refresh_from_db()
        self.assertEqual(self.target.role, 'sales_rep')

    # ── PUT /admin/users/{id}/permissions/ ───────────────────────────────

    def test_boss_cannot_replace_a_users_permissions(self):
        self._auth(self.boss)
        resp = self.client.put(
            f'{USERS_URL}{self.target.id}/permissions/',
            {'permissions': []},
            format='json',
        )
        self.assertEqual(resp.status_code, 403, resp.data)

    def test_admin_can_replace_a_users_permissions(self):
        """Control for the 403 above."""
        self._auth(self.admin)
        resp = self.client.put(
            f'{USERS_URL}{self.target.id}/permissions/',
            {'permissions': []},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)

    # ── PUT /admin/managed-page-permissions/ ─────────────────────────────

    def test_boss_cannot_use_the_delegated_page_permission_endpoint(self):
        """ADR-022's delegation is keyed on `manageable_roles`, which boss has none of."""
        self._auth(self.boss)
        resp = self.client.put(
            MPP_URL,
            {'role': 'weight_master', 'pages': []},
            format='json',
        )
        self.assertEqual(resp.status_code, 403, resp.data)
