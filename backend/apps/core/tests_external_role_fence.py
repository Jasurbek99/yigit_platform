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
