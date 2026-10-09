from django.test import TestCase

from apps.core.models import Customer, User
from apps.market.models import AgentMember, Bazaar
from apps.market.services import (
    MarketAccessError, build_me_payload, check_customer_in_scope, own_team_customer,
)


class MarketServicesTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.rep = User.objects.create_user(username='sv_rep', password='pw', role='sales_rep')
        cls.cust = Customer.objects.create(name='Агент С', sales_rep=cls.rep)
        cls.foreign = Customer.objects.create(name='Агент Ф')
        cls.agent = User.objects.create_user(username='sv_ag', password='pw', role='agent', first_name='Канат')
        AgentMember.objects.create(user=cls.agent, customer=cls.cust)
        cls.bazaar = Bazaar.objects.create(customer=cls.cust, name='Алтын Орда')
        cls.seller = User.objects.create_user(username='sv_se', password='pw', role='agent_seller')
        AgentMember.objects.create(user=cls.seller, customer=cls.cust, bazaar=cls.bazaar)
        cls.admin = User.objects.create_user(username='sv_adm', password='pw', role='admin')

    def test_only_the_agent_owns_its_team(self):
        self.assertEqual(own_team_customer(self.agent), self.cust)
        for user in (self.seller, self.admin):
            with self.subTest(user=user.username), self.assertRaisesMessage(
                    MarketAccessError, 'Командой управляет только агент.'):
                own_team_customer(user)

    def test_customer_scope(self):
        check_customer_in_scope(self.rep, self.cust)
        check_customer_in_scope(self.admin, self.foreign)
        with self.assertRaisesMessage(MarketAccessError, 'Это не ваш клиент.'):
            check_customer_in_scope(self.rep, self.foreign)

    def test_me_payload(self):
        self.assertEqual(build_me_payload(self.agent), {
            'role': 'agent', 'username': 'sv_ag', 'first_name': 'Канат',
            'customer': {'id': self.cust.pk, 'name': 'Агент С'}, 'bazaar': None,
        })
        self.assertEqual(build_me_payload(self.seller)['bazaar'], {'id': self.bazaar.pk, 'name': 'Алтын Орда'})
        self.assertIsNone(build_me_payload(self.admin)['customer'])
