from django.test import TestCase

from apps.core.models import Customer, User
from apps.market.models import AgentMember, Bazaar
from apps.market.scoping import customer_ids_for, member_of


class ScopingTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.rep = User.objects.create_user(username='sc_rep', password='pw', role='sales_rep')
        cls.cust_a = Customer.objects.create(name='Агент А', sales_rep=cls.rep)
        cls.cust_b = Customer.objects.create(name='Агент Б')
        cls.agent = User.objects.create_user(username='sc_ag', password='pw', role='agent')
        AgentMember.objects.create(user=cls.agent, customer=cls.cust_a)
        cls.bazaar = Bazaar.objects.create(customer=cls.cust_a, name='Алтын Орда')
        cls.seller = User.objects.create_user(username='sc_se', password='pw', role='agent_seller')
        AgentMember.objects.create(user=cls.seller, customer=cls.cust_a, bazaar=cls.bazaar)
        cls.orphan = User.objects.create_user(username='sc_or', password='pw', role='agent')
        cls.boss = User.objects.create_user(username='sc_boss', password='pw', role='boss')
        cls.wm = User.objects.create_user(username='sc_wm', password='pw', role='weight_master')

    def test_agent_and_seller_see_own_customer(self):
        self.assertEqual(customer_ids_for(self.agent), [self.cust_a.pk])
        self.assertEqual(customer_ids_for(self.seller), [self.cust_a.pk])

    def test_agent_without_member_sees_nothing(self):
        self.assertIsNone(member_of(self.orphan))
        self.assertEqual(customer_ids_for(self.orphan), [])

    def test_sales_rep_sees_own_customers(self):
        self.assertEqual(customer_ids_for(self.rep), [self.cust_a.pk])

    def test_staff_sees_all_and_others_nothing(self):
        self.assertIsNone(customer_ids_for(self.boss))
        self.assertEqual(customer_ids_for(self.wm), [])
