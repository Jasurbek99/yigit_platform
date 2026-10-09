from django.conf import settings
from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.core.models import User


def _cookie_client(user) -> APIClient:
    """Real cookie auth — force_authenticate would skip the authentication class."""
    client = APIClient()
    client.cookies[settings.SIMPLE_JWT['AUTH_COOKIE']] = str(RefreshToken.for_user(user).access_token)
    return client


class ExternalRoleFenceTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.seller = User.objects.create_user(username='fence_s', password='pw', role='agent_seller')
        cls.agent = User.objects.create_user(username='fence_a', password='pw', role='agent')
        cls.admin = User.objects.create_user(username='fence_adm', password='pw', role='admin')

    def test_external_roles_blocked_outside_market(self):
        for user in (self.seller, self.agent):
            for url in ('/api/v1/export/shipments/', '/api/v1/core/countries/', '/api/v1/me/tasks/'):
                with self.subTest(user=user.role, url=url):
                    self.assertEqual(_cookie_client(user).get(url).status_code, 403)

    def test_external_roles_reach_auth_me(self):
        resp = _cookie_client(self.seller).get('/api/v1/auth/me/')
        self.assertEqual(resp.status_code, 200)

    def test_internal_roles_not_fenced(self):
        self.assertNotEqual(_cookie_client(self.admin).get('/api/v1/core/countries/').status_code, 403)


class ExternalRolesLeftOutOfStaffRostersTests(TestCase):
    """Agent-market logins are not staff: no @mention, team KPI or worklog row."""

    @classmethod
    def setUpTestData(cls):
        cls.staff = User.objects.create_user(
            username='roster_staff', password='pw', role='document_team', first_name='Zarina')
        cls.seller = User.objects.create_user(
            username='roster_seller', password='pw', role='agent_seller', first_name='Zarema')
        cls.agent = User.objects.create_user(
            username='roster_agent', password='pw', role='agent', first_name='Zaur')

    def _client(self):
        client = APIClient()
        client.force_authenticate(user=self.staff)
        return client

    def test_mentionable_skips_external_users_and_roles(self):
        rows = self._client().get('/api/v1/core/users/mentionable/?q=Za&limit=50').json()
        user_ids = {r['id'] for r in rows if r['type'] == 'user'}
        self.assertIn(self.staff.id, user_ids)
        self.assertNotIn(self.seller.id, user_ids)
        self.assertNotIn(self.agent.id, user_ids)
        roles = {r['code'] for r in self._client().get('/api/v1/core/users/mentionable/?q=agent').json()
                 if r['type'] == 'role'}
        self.assertFalse(roles & {'agent', 'agent_seller'})

    def test_team_kpi_roster_skips_external_users(self):
        from apps.core.services_team_kpi import compute_team_kpi
        ids = {r['user_id'] for r in compute_team_kpi('week')}
        self.assertIn(self.staff.id, ids)
        self.assertNotIn(self.seller.id, ids)
        self.assertNotIn(self.agent.id, ids)

    def test_worklog_team_skips_external_users(self):
        names = {r['user_name'] for r in self._client().get('/api/v1/core/worklog/team/').json()['results']}
        self.assertIn('Zarina', names)
        self.assertNotIn('Zarema', names)
        self.assertNotIn('Zaur', names)
