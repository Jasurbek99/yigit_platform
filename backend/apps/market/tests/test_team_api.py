import re

from django.apps import apps
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import Customer, User
from apps.market.models import AgentMember, Bazaar


class TeamApiTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions', verbosity=0)
        cls.cust = Customer.objects.create(name='Агент Т')
        cls.other = Customer.objects.create(name='Агент О')
        cls.agent = User.objects.create_user(username='tm_ag', password='pw', role='agent')
        AgentMember.objects.create(user=cls.agent, customer=cls.cust)
        cls.other_agent = User.objects.create_user(username='tm_ag2', password='pw', role='agent')
        AgentMember.objects.create(user=cls.other_agent, customer=cls.other)
        cls.foreign_bazaar = Bazaar.objects.create(customer=cls.other, name='Чужой')
        cls.boss = User.objects.create_user(username='tm_boss', password='pw', role='boss')
        # admin holds create on market_team, so the agent-only rule (not the matrix) refuses it.
        cls.admin = User.objects.create_user(username='tm_adm', password='pw', role='admin')

    def _as(self, user):
        c = APIClient()
        c.force_authenticate(user=user)
        return c

    def _bazaar(self, name='Зелёный'):
        return self._as(self.agent).post('/api/v1/market/team/bazaars/', {'name': name}, format='json')

    def test_agent_creates_bazaar_for_own_customer(self):
        resp = self._bazaar()
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(Bazaar.objects.get(pk=resp.json()['id']).customer, self.cust)

    def test_agent_cannot_touch_foreign_bazaar(self):
        resp = self._as(self.agent).patch(f'/api/v1/market/team/bazaars/{self.foreign_bazaar.pk}/', {'name': 'x'}, format='json')
        self.assertEqual(resp.status_code, 404)

    def test_agent_creates_seller_login(self):
        bazaar_id = self._bazaar().json()['id']
        resp = self._as(self.agent).post('/api/v1/market/team/sellers/', {
            'username': 'seller_1', 'password': 'Strong-Pass-71', 'first_name': 'Айдос', 'bazaar_id': bazaar_id,
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        user = User.objects.get(username='seller_1')
        self.assertEqual(user.role, 'agent_seller')
        self.assertEqual(user.agent_member.customer, self.cust)
        self.assertEqual(user.agent_member.bazaar_id, bazaar_id)

    def test_seller_bazaar_must_be_own(self):
        resp = self._as(self.agent).post('/api/v1/market/team/sellers/', {
            'username': 'seller_x', 'password': 'Strong-Pass-71', 'first_name': 'X', 'bazaar_id': self.foreign_bazaar.pk,
        }, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_deactivated_seller_hidden_from_active_list_and_cannot_log_in(self):
        bazaar_id = self._bazaar().json()['id']
        sid = self._as(self.agent).post('/api/v1/market/team/sellers/', {
            'username': 'seller_2', 'password': 'Strong-Pass-71', 'first_name': 'Б', 'bazaar_id': bazaar_id,
        }, format='json').json()['id']
        self._as(self.agent).patch(f'/api/v1/market/team/sellers/{sid}/', {'is_active': False}, format='json')
        active = self._as(self.agent).get('/api/v1/market/team/sellers/?active=1').json()['results']
        self.assertNotIn(sid, [row['id'] for row in active])
        self.assertTrue(User.objects.filter(pk=sid, is_active=False).exists())
        login = APIClient().post('/api/v1/auth/login/', {'username': 'seller_2', 'password': 'Strong-Pass-71'}, format='json')
        self.assertNotEqual(login.status_code, 200)

    def test_seller_and_other_agent_cannot_see_team(self):
        bazaar_id = self._bazaar().json()['id']
        sid = self._as(self.agent).post('/api/v1/market/team/sellers/', {
            'username': 'seller_3', 'password': 'Strong-Pass-71', 'first_name': 'В', 'bazaar_id': bazaar_id,
        }, format='json').json()['id']
        seller = User.objects.get(pk=sid)
        self.assertEqual(self._as(seller).get('/api/v1/market/team/sellers/').status_code, 403)
        ids = [r['id'] for r in self._as(self.other_agent).get('/api/v1/market/team/sellers/').json()['results']]
        self.assertNotIn(sid, ids)

    def test_boss_reads_but_cannot_write_team(self):
        self.assertEqual(self._as(self.boss).get('/api/v1/market/team/bazaars/').status_code, 200)
        # boss is read-only on market_team (spec §3), so the matrix refuses the write:
        resp = self._as(self.boss).post('/api/v1/market/team/bazaars/', {'name': 'x'}, format='json')
        self.assertEqual(resp.status_code, 403)

    def test_me(self):
        body = self._as(self.agent).get('/api/v1/market/me/').json()
        self.assertEqual(body, {
            'role': 'agent', 'username': 'tm_ag', 'first_name': '',
            'customer': {'id': self.cust.pk, 'name': 'Агент Т'}, 'bazaar': None,
        })
        self.assertEqual(self._as(self.boss).get('/api/v1/market/me/').json()['customer'], None)

    def _seller(self, username='seller_p'):
        bazaar_id = self._bazaar(f'Б-{username}').json()['id']
        resp = self._as(self.agent).post('/api/v1/market/team/sellers/', {
            'username': username, 'password': 'Strong-Pass-71', 'first_name': 'Айдос', 'bazaar_id': bazaar_id,
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        return resp

    def test_response_never_contains_password(self):
        created = self._seller().json()
        self.assertNotIn('password', created)
        sid = created['id']
        patched = self._as(self.agent).patch(
            f'/api/v1/market/team/sellers/{sid}/', {'password': 'Another-Pass-82'}, format='json')
        self.assertEqual(patched.status_code, 200, patched.content)
        self.assertNotIn('password', patched.json())
        self.assertTrue(User.objects.get(pk=sid).check_password('Another-Pass-82'))

    def test_patch_cannot_escalate_role_or_superuser(self):
        sid = self._seller('seller_esc').json()['id']
        resp = self._as(self.agent).patch(
            f'/api/v1/market/team/sellers/{sid}/', {'role': 'admin', 'is_superuser': True, 'is_staff': True}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        user = User.objects.get(pk=sid)
        self.assertEqual(user.role, 'agent_seller')
        self.assertFalse(user.is_superuser)
        self.assertFalse(user.is_staff)

    def test_username_is_read_only_on_update(self):
        sid = self._seller('seller_ro').json()['id']
        self._as(self.agent).patch(f'/api/v1/market/team/sellers/{sid}/', {'username': 'renamed'}, format='json')
        self.assertEqual(User.objects.get(pk=sid).username, 'seller_ro')

    def test_weak_password_rejected(self):
        bazaar_id = self._bazaar().json()['id']
        resp = self._as(self.agent).post('/api/v1/market/team/sellers/', {
            'username': 'seller_weak', 'password': '12345678', 'first_name': 'W', 'bazaar_id': bazaar_id,
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('password', resp.json())

    def test_password_similar_to_username_rejected(self):
        bazaar_id = self._bazaar().json()['id']
        resp = self._as(self.agent).post('/api/v1/market/team/sellers/', {
            'username': 'sellerpass71', 'password': 'sellerpass71', 'first_name': 'S', 'bazaar_id': bazaar_id,
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('password', resp.json())

    def test_duplicate_bazaar_name_is_400(self):
        self._bazaar('Дубль')
        self.assertEqual(self._bazaar('Дубль').status_code, 400)

    def test_unknown_city_is_400(self):
        resp = self._as(self.agent).post('/api/v1/market/team/bazaars/', {'name': 'Г', 'city_id': 999999}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_patch_moves_seller_to_another_own_bazaar(self):
        created = self._seller('seller_mv').json()
        sid = created['id']
        second = self._bazaar('Второй').json()['id']
        self.assertNotEqual(created['bazaar']['id'], second)
        resp = self._as(self.agent).patch(
            f'/api/v1/market/team/sellers/{sid}/', {'bazaar_id': second}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()['bazaar']['id'], second)
        self.assertEqual(User.objects.get(pk=sid).agent_member.bazaar_id, second)

    def test_patch_to_foreign_bazaar_is_400(self):
        created = self._seller('seller_fb').json()
        sid = created['id']
        resp = self._as(self.agent).patch(
            f'/api/v1/market/team/sellers/{sid}/', {'bazaar_id': self.foreign_bazaar.pk}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(User.objects.get(pk=sid).agent_member.bazaar_id, created['bazaar']['id'])

    def test_password_with_edge_whitespace_rejected(self):
        bazaar_id = self._bazaar().json()['id']
        resp = self._as(self.agent).post('/api/v1/market/team/sellers/', {
            'username': 'seller_ws', 'password': 'Pass-1234 ', 'first_name': 'W', 'bazaar_id': bazaar_id,
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['password'], ['Пароль не может начинаться или заканчиваться пробелом.'])
        self.assertFalse(User.objects.filter(username='seller_ws').exists())

    def test_whitespace_password_rejected_on_reset(self):
        sid = self._seller('seller_wr').json()['id']
        resp = self._as(self.agent).patch(
            f'/api/v1/market/team/sellers/{sid}/', {'password': ' Another-Pass-82'}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('password', resp.json())

    def test_created_seller_can_log_in(self):
        self._seller('seller_li')
        login = APIClient().post(
            '/api/v1/auth/login/', {'username': 'seller_li', 'password': 'Strong-Pass-71'}, format='json')
        self.assertEqual(login.status_code, 200, login.content)

    def test_errors_are_in_russian(self):
        cyrillic = re.compile('[А-Яа-яЁё]')
        bazaar_id = self._bazaar().json()['id']
        short = self._as(self.agent).post('/api/v1/market/team/sellers/', {
            'username': 'seller_sh', 'password': 'Ab-1', 'first_name': 'S', 'bazaar_id': bazaar_id,
        }, format='json')
        self.assertEqual(short.status_code, 400)
        self.assertRegex(short.json()['password'][0], cyrillic)
        # A DRF built-in message too, not only our own literals.
        missing = self._as(self.agent).patch(
            f'/api/v1/market/team/bazaars/{self.foreign_bazaar.pk}/', {'name': 'x'}, format='json')
        self.assertEqual(missing.status_code, 404)
        self.assertRegex(missing.json()['error'], cyrillic)
        anonymous = APIClient().get('/api/v1/market/me/')
        self.assertIn(anonymous.status_code, (401, 403))
        self.assertRegex(anonymous.json()['error'], cyrillic)
        denied = self._as(self.admin).post('/api/v1/market/team/bazaars/', {'name': 'x'}, format='json')
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(denied.json()['error'], 'Командой управляет только агент.')
        read_only = self._as(self.boss).post('/api/v1/market/team/bazaars/', {'name': 'x'}, format='json')
        self.assertEqual(read_only.status_code, 403)
        self.assertRegex(read_only.json()['error'], cyrillic)

    def test_seller_login_changes_are_audited_without_the_password(self):
        audit = apps.get_model('export', 'AuditLog').objects.filter(model_name='SellerLogin')
        sid = self._seller('seller_au').json()['id']
        self.assertTrue(audit.filter(action='create', object_id=sid, user=self.agent).exists())
        self._as(self.agent).patch(f'/api/v1/market/team/sellers/{sid}/', {'password': 'Another-Pass-82'}, format='json')
        self.assertTrue(audit.filter(action='update', object_id=sid, detail='password reset').exists())
        self._as(self.agent).patch(f'/api/v1/market/team/sellers/{sid}/', {'is_active': False}, format='json')
        self.assertTrue(audit.filter(action='update', object_id=sid, detail='is_active → False').exists())
        for detail in audit.values_list('detail', flat=True):
            self.assertNotIn('Pass', detail)


class MarketViewsSpeakRussianTests(TestCase):

    def test_every_market_view_uses_the_russian_mixin(self):
        from apps.market import views
        from apps.market.views.base import RussianMixin
        for name in views.__all__:
            with self.subTest(view=name):
                self.assertTrue(issubclass(getattr(views, name), RussianMixin))
