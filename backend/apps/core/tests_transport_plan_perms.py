"""transport.plan page + transport's view grant on truck_allocation (planning tasks, 2026-09-29)."""
import importlib

from django.apps import apps as django_apps
from django.test import TestCase

from apps.core.models import RolePagePermission, RoleResourcePermission
from apps.core.permission_registry import PAGE_REGISTRY

migration = importlib.import_module('apps.core.migrations.0069_transport_plan_page')


def _seed():
    return migration.seed_transport_plan(
        django_apps.get_model('core', 'RolePagePermission'),
        django_apps.get_model('core', 'RoleResourcePermission'),
    )


class TransportPlanPermsTests(TestCase):
    def test_page_is_registered(self):
        self.assertIn('transport.plan', PAGE_REGISTRY)

    def test_seed_writes_every_role_and_the_view_grant(self):
        RoleResourcePermission.objects.update_or_create(
            role='transport', resource_code='truck_allocation',
            defaults={'can_view': False, 'can_create': False, 'can_edit': False, 'can_delete': False},
        )
        _seed()
        rows = dict(RolePagePermission.objects.filter(page_code='transport.plan')
                    .values_list('role', 'is_visible'))
        self.assertEqual(set(rows), set(migration.ALL_ROLES))
        self.assertTrue(rows['transport'])
        self.assertTrue(rows['boss'])
        self.assertFalse(rows['sales_rep'])
        grant = RoleResourcePermission.objects.get(role='transport', resource_code='truck_allocation')
        self.assertEqual((grant.can_view, grant.can_edit), (True, False))

    def test_seed_does_not_stomp_an_admin_toggle(self):
        RolePagePermission.objects.create(role='transport', page_code='transport.plan', is_visible=False)
        _seed()
        self.assertFalse(
            RolePagePermission.objects.get(role='transport', page_code='transport.plan').is_visible,
        )

    def test_seed_permissions_defaults_include_the_page_and_grant(self):
        from apps.core.management.commands.seed_permissions import PAGE_DEFAULTS, RESOURCE_DEFAULTS

        self.assertIn('transport.plan', PAGE_DEFAULTS['transport'])
        self.assertIn('transport.plan', PAGE_DEFAULTS['boss'])
        self.assertEqual(RESOURCE_DEFAULTS['transport']['truck_allocation'], (True, False, False, False))
