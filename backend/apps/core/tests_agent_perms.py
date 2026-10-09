import importlib
from pathlib import Path

from django.core.management import call_command
from django.test import TestCase

from apps.core.models.role_permissions import (
    RoleFieldPermission, RolePagePermission, RoleResourcePermission,
)
from apps.core.models.user import ROLE_CHOICES
from apps.core.permission_registry import PAGE_REGISTRY, RESOURCE_REGISTRY

MARKET_PAGES = {'market.home', 'market.team', 'market.agents'}


def _perm_migration():
    path = next(Path(__file__).parent.joinpath('migrations').glob('*_seed_agent_market_perms.py'))
    return importlib.import_module(f'apps.core.migrations.{path.stem}')


def _visible(role):
    return set(RolePagePermission.objects.filter(role=role, is_visible=True).values_list('page_code', flat=True))


def _flags(role, resource):
    row = RoleResourcePermission.objects.get(role=role, resource_code=resource)
    return (row.can_view, row.can_create, row.can_edit, row.can_delete)


class AgentPermissionSeedTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions', verbosity=0)

    def test_registry_has_market_codes(self):
        self.assertTrue(MARKET_PAGES <= set(PAGE_REGISTRY))
        self.assertTrue({'market_agent', 'market_team'} <= set(RESOURCE_REGISTRY))

    def test_agent_sees_only_market_phone_pages(self):
        self.assertEqual(_visible('agent'), {'market.home', 'market.team'})
        self.assertEqual(_visible('agent_seller'), {'market.home'})

    def test_every_role_has_a_row_for_every_page(self):
        for code, _ in ROLE_CHOICES:
            with self.subTest(role=code):
                self.assertEqual(RolePagePermission.objects.filter(role=code).count(), len(PAGE_REGISTRY))

    def test_internal_roles_do_not_see_phone_pages(self):
        for role in ('admin', 'director', 'export_manager', 'document_team', 'sales_rep', 'boss'):
            with self.subTest(role=role):
                self.assertFalse(_visible(role) & {'market.home', 'market.team'})
                self.assertIn('market.agents', _visible(role))

    def test_resource_grants(self):
        self.assertEqual(_flags('agent', 'market_team'), (True, True, True, True))
        self.assertEqual(_flags('sales_rep', 'market_agent'), (True, True, True, False))
        # boss is read-only on the market too (spec §3).
        for role in ('director', 'export_manager', 'document_team', 'boss'):
            with self.subTest(role=role):
                self.assertEqual(_flags(role, 'market_agent'), (True, False, False, False))
                self.assertEqual(_flags(role, 'market_team'), (True, False, False, False))

    def test_agent_roles_are_in_the_resource_matrix(self):
        # The admin matrix PUT rejects a missing role, so each must hold a row.
        self.assertEqual(_flags('agent_seller', 'market_team'), (False, False, False, False))
        self.assertTrue(RoleResourcePermission.objects.filter(role='agent').exists())

    def test_boss_has_field_rows_for_market_resources(self):
        for res in ('market_agent', 'market_team'):
            self.assertTrue(RoleFieldPermission.objects.filter(role='boss', resource_code=res, field_name='*').exists())

    def test_migration_snapshot_covers_every_registered_page(self):
        self.assertEqual(set(_perm_migration().ALL_PAGES), set(PAGE_REGISTRY))

    def test_migration_visible_sets_match_seed(self):
        from apps.core.management.commands.seed_permissions import PAGE_DEFAULTS
        mig = _perm_migration()
        self.assertEqual(set(mig.AGENT_VISIBLE), PAGE_DEFAULTS['agent'])
        self.assertEqual(set(mig.SELLER_VISIBLE), PAGE_DEFAULTS['agent_seller'])

    def test_fresh_seed_market_pages_match_migration(self):
        # A fresh seed_permissions DB and a migrated DB (core/0076) must agree.
        mig = _perm_migration()
        for code, _ in ROLE_CHOICES:
            if code == 'agent':
                expected = set(mig.AGENT_VISIBLE)
            elif code == 'agent_seller':
                expected = set(mig.SELLER_VISIBLE)
            else:
                expected = {'market.agents'} if code in mig.AGENTS_PAGE_ROLES else set()
            with self.subTest(role=code):
                self.assertEqual(_visible(code) & MARKET_PAGES, expected)
