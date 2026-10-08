from django.test import TestCase

from apps.core.models.user import EXTERNAL_ROLES, ROLE_CHOICES


class AgentRoleChoicesTests(TestCase):

    def test_both_roles_are_choices(self):
        codes = {code for code, _ in ROLE_CHOICES}
        self.assertIn('agent', codes)
        self.assertIn('agent_seller', codes)

    def test_external_roles_are_exactly_the_agent_roles(self):
        self.assertEqual(EXTERNAL_ROLES, frozenset({'agent', 'agent_seller'}))

    def test_existing_seller_role_untouched(self):
        self.assertIn(('seller', 'Seller'), ROLE_CHOICES)
