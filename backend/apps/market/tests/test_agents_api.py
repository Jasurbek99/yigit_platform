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
