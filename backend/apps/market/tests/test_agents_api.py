from django.apps import apps
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import Customer, User
from apps.market.models import AgentMember

URL = '/api/v1/market/agents/'


class AgentLoginsApiTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions', verbosity=0)
        cls.rep = User.objects.create_user(username='al_rep', password='pw', role='sales_rep')
        cls.other_rep = User.objects.create_user(username='al_rep2', password='pw', role='sales_rep')
        cls.admin = User.objects.create_user(username='al_adm', password='pw', role='admin')
        cls.director = User.objects.create_user(username='al_dir', password='pw', role='director')
        cls.cust = Customer.objects.create(name='Агент К', sales_rep=cls.rep)
        cls.foreign = Customer.objects.create(name='Агент Ч', sales_rep=cls.other_rep)

    def _as(self, user):
        c = APIClient()
        c.force_authenticate(user=user)
        return c

    def _body(self, customer, username='agent_k'):
        return {'customer_id': customer.pk, 'username': username, 'password': 'Strong-Pass-71', 'first_name': 'Канат'}

    def test_rep_creates_login_for_own_customer(self):
        resp = self._as(self.rep).post(URL, self._body(self.cust), format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        user = User.objects.get(username='agent_k')
        self.assertEqual(user.role, 'agent')
        self.assertTrue(user.check_password('Strong-Pass-71'))
        self.assertEqual(AgentMember.objects.get(user=user).customer, self.cust)
        self.assertEqual(resp.json()['customer'], {'id': self.cust.pk, 'name': 'Агент К'})

    def test_rep_cannot_create_for_foreign_customer(self):
        resp = self._as(self.rep).post(URL, self._body(self.foreign), format='json')
        self.assertEqual(resp.status_code, 403)
        self.assertFalse(User.objects.filter(username='agent_k').exists())

    def test_director_is_read_only(self):
        self.assertEqual(self._as(self.director).get(URL).status_code, 200)
        self.assertEqual(self._as(self.director).post(URL, self._body(self.cust), format='json').status_code, 403)

    def test_list_is_scoped_for_rep(self):
        self._as(self.admin).post(URL, self._body(self.cust, 'a1'), format='json')
        self._as(self.admin).post(URL, self._body(self.foreign, 'a2'), format='json')
        names = {row['username'] for row in self._as(self.rep).get(URL).json()['results']}
        self.assertEqual(names, {'a1'})

    def test_patch_deactivates_and_resets_password(self):
        uid = self._as(self.admin).post(URL, self._body(self.cust), format='json').json()['id']
        resp = self._as(self.rep).patch(f'{URL}{uid}/', {'is_active': False, 'password': 'New-Pass-9932'}, format='json')
        self.assertEqual(resp.status_code, 200)
        user = User.objects.get(pk=uid)
        self.assertFalse(user.is_active)
        self.assertTrue(user.check_password('New-Pass-9932'))

    def test_weak_password_rejected(self):
        body = self._body(self.cust) | {'password': '123'}
        self.assertEqual(self._as(self.rep).post(URL, body, format='json').status_code, 400)

    def test_duplicate_username_rejected(self):
        self._as(self.rep).post(URL, self._body(self.cust), format='json')
        self.assertEqual(self._as(self.rep).post(URL, self._body(self.cust), format='json').status_code, 400)

    def _agent_id(self, customer=None, username='agent_k'):
        resp = self._as(self.admin).post(URL, self._body(customer or self.cust, username), format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        return resp.json()['id']

    def test_rep_cannot_patch_another_reps_agent(self):
        uid = self._agent_id(self.foreign)
        resp = self._as(self.rep).patch(f'{URL}{uid}/', {'is_active': False}, format='json')
        self.assertEqual(resp.status_code, 404)
        self.assertTrue(User.objects.get(pk=uid).is_active)

    def test_role_and_flags_cannot_be_set(self):
        body = self._body(self.cust) | {'role': 'admin', 'is_superuser': True, 'is_staff': True}
        uid = self._as(self.rep).post(URL, body, format='json').json()['id']
        resp = self._as(self.rep).patch(
            f'{URL}{uid}/', {'role': 'admin', 'is_superuser': True, 'is_staff': True}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        user = User.objects.get(pk=uid)
        self.assertEqual(user.role, 'agent')
        self.assertFalse(user.is_superuser)
        self.assertFalse(user.is_staff)

    def test_response_never_contains_password(self):
        created = self._as(self.rep).post(URL, self._body(self.cust), format='json').json()
        self.assertNotIn('password', created)
        patched = self._as(self.rep).patch(f'{URL}{created["id"]}/', {'password': 'New-Pass-9932'}, format='json')
        self.assertEqual(patched.status_code, 200, patched.content)
        self.assertNotIn('password', patched.json())
        for row in self._as(self.rep).get(URL).json()['results']:
            self.assertNotIn('password', row)

    def test_weak_password_on_patch_rejected(self):
        uid = self._agent_id()
        resp = self._as(self.rep).patch(f'{URL}{uid}/', {'password': '12345678'}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('password', resp.json())
        self.assertTrue(User.objects.get(pk=uid).check_password('Strong-Pass-71'))

    def test_password_similar_to_username_rejected(self):
        body = self._body(self.cust, 'agentpass71') | {'password': 'agentpass71'}
        resp = self._as(self.rep).post(URL, body, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('password', resp.json())

    def test_password_with_edge_whitespace_rejected(self):
        resp = self._as(self.rep).post(URL, self._body(self.cust) | {'password': 'Pass-1234 '}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['password'], ['Пароль не может начинаться или заканчиваться пробелом.'])

    def test_created_agent_can_log_in(self):
        self._agent_id()
        login = APIClient().post(
            '/api/v1/auth/login/', {'username': 'agent_k', 'password': 'Strong-Pass-71'}, format='json')
        self.assertEqual(login.status_code, 200, login.content)

    def test_username_is_read_only_on_update(self):
        uid = self._agent_id()
        self._as(self.rep).patch(f'{URL}{uid}/', {'username': 'renamed'}, format='json')
        self.assertEqual(User.objects.get(pk=uid).username, 'agent_k')

    def test_agent_login_changes_are_audited_without_the_password(self):
        audit = apps.get_model('export', 'AuditLog').objects.filter(model_name='AgentLogin')
        uid = self._agent_id()
        self.assertTrue(audit.filter(action='create', object_id=uid, user=self.admin).exists())
        self._as(self.rep).patch(f'{URL}{uid}/', {'password': 'New-Pass-9932'}, format='json')
        self.assertTrue(audit.filter(action='update', object_id=uid, detail='password reset', user=self.rep).exists())
        self._as(self.rep).patch(f'{URL}{uid}/', {'is_active': False}, format='json')
        self.assertTrue(audit.filter(action='update', object_id=uid, detail='is_active → False').exists())
        self.assertEqual(audit.filter(object_id=uid).count(), 3)
        for detail in audit.values_list('detail', flat=True):
            self.assertNotIn('Pass', detail)
