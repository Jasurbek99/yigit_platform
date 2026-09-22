"""Tests for the read-only Task Rules catalog endpoint (`/export/task-rules/`).

Backs the Task Rules reference page — the page that answers "why did I get this
task, and what closes it?" straight from `export_task_rule`.

Coverage:
  - Auth required: anonymous → 401
  - Page gate: a role WITHOUT the `export.task_rules` row → 403; with it → 200
  - Superuser bypasses the matrix
  - Response is a flat array (NOT paginated) in lifecycle order
  - `target_fields` ships as a LIST, never the stored CSV string
  - `?is_active=false` returns only deactivated rules
  - A rule on an unknown status code sorts last instead of crashing
"""
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import RolePagePermission, ShipmentStatusType, User
from apps.export.models import TaskCompletionRule, TaskRule

PAGE_CODE = 'export.task_rules'


def _make_user(username: str, role: str, is_superuser: bool = False) -> User:
    user = User(username=username, role=role, is_superuser=is_superuser)
    user.set_password('pass')
    user.save()
    return user


def _grant_page(role: str, is_visible: bool = True) -> None:
    """Write the matrix row this page's gate reads, and drop the 60 s cache.

    The seeding migration (`core.0056`) returns early on a `test_`-prefixed
    database, so a test DB has NO rows and the gate fails closed for everyone —
    each test states the access it wants.
    """
    RolePagePermission.objects.update_or_create(
        role=role, page_code=PAGE_CODE, defaults={'is_visible': is_visible},
    )
    cache.clear()


def _make_status(code: str, step_order: int, phase: str = 'DOCS') -> ShipmentStatusType:
    return ShipmentStatusType.objects.get_or_create(
        code=code,
        defaults={
            'name_tk': code, 'name_en': code.title(),
            'step_order': step_order, 'phase': phase,
        },
    )[0]


class TaskRuleApiTests(TestCase):
    """The endpoint itself: shape, ordering, filtering."""

    URL = '/api/v1/export/task-rules/'

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        _make_status('draft', 0, 'DRAFT')
        _make_status('yuklenme', 5, 'LOADING')
        # Seeded out of lifecycle order on purpose — the endpoint sorts by the
        # status table's step_order, not by insertion or pk.
        self.loading_rule = TaskRule.objects.create(
            step='yuklenme',
            title_key='tasks.fill_loading_data',
            assignee_role='loading_dept_head',
            target_fields='shipment_code, weight_net',
            completion_rule=TaskCompletionRule.ALL_FIELDS_FILLED,
        )
        self.draft_rule = TaskRule.objects.create(
            step='draft',
            title_key='tasks.set_destination',
            assignee_role='export_manager',
            target_fields='country,customer,import_firm',
            completion_rule=TaskCompletionRule.ALL_FIELDS_FILLED,
            deadline_rule='24h_after_status',
        )
        self.manager = _make_user('tr_manager', 'export_manager')
        _grant_page('export_manager', True)

    def test_anonymous_is_rejected(self):
        self.assertIn(self.client.get(self.URL).status_code, (401, 403))

    def test_role_without_the_page_row_is_forbidden(self):
        transport = _make_user('tr_transport', 'transport')
        self.client.force_authenticate(user=transport)
        self.assertEqual(self.client.get(self.URL).status_code, 403)

    def test_role_with_the_row_hidden_is_forbidden(self):
        transport = _make_user('tr_transport_hidden', 'transport')
        _grant_page('transport', False)
        self.client.force_authenticate(user=transport)
        self.assertEqual(self.client.get(self.URL).status_code, 403)

    def test_granting_the_page_opens_the_endpoint(self):
        """The admin matrix is the only switch — no deploy needed."""
        transport = _make_user('tr_transport_granted', 'transport')
        _grant_page('transport', True)
        self.client.force_authenticate(user=transport)
        self.assertEqual(self.client.get(self.URL).status_code, 200)

    def test_superuser_bypasses_the_matrix(self):
        root = _make_user('tr_root', 'seller', is_superuser=True)
        self.client.force_authenticate(user=root)
        self.assertEqual(self.client.get(self.URL).status_code, 200)

    def test_response_is_a_flat_array_in_lifecycle_order(self):
        self.client.force_authenticate(user=self.manager)
        response = self.client.get(self.URL)

        self.assertEqual(response.status_code, 200)
        # Not paginated — no count/next/results envelope.
        self.assertIsInstance(response.data, list)
        self.assertEqual(
            [row['step'] for row in response.data], ['draft', 'yuklenme'],
        )

    def test_target_fields_is_a_list_not_the_stored_csv(self):
        self.client.force_authenticate(user=self.manager)
        rows = {row['id']: row for row in self.client.get(self.URL).data}

        self.assertEqual(
            rows[self.draft_rule.id]['target_fields'],
            ['country', 'customer', 'import_firm'],
        )
        # Whitespace around a CSV separator is trimmed, matching the engine's
        # own read in services/task_rules.py.
        self.assertEqual(
            rows[self.loading_rule.id]['target_fields'],
            ['shipment_code', 'weight_net'],
        )

    def test_row_carries_the_display_companions(self):
        self.client.force_authenticate(user=self.manager)
        row = next(
            r for r in self.client.get(self.URL).data if r['id'] == self.draft_rule.id
        )

        self.assertEqual(row['step_display'], 'Draft')
        self.assertEqual(row['step_order'], 0)
        self.assertEqual(row['step_phase'], 'DRAFT')
        self.assertEqual(row['assignee_role_display'], 'Export Manager')
        self.assertEqual(row['completion_rule_display'], 'All target fields filled')
        self.assertEqual(row['deadline_rule'], '24h_after_status')

    def test_inactive_rules_are_listed_by_default(self):
        """A deactivated rule is exactly what someone debugging comes here for."""
        self.draft_rule.is_active = False
        self.draft_rule.save(update_fields=['is_active'])
        self.client.force_authenticate(user=self.manager)

        ids = [row['id'] for row in self.client.get(self.URL).data]
        self.assertIn(self.draft_rule.id, ids)

    def test_is_active_filter(self):
        self.draft_rule.is_active = False
        self.draft_rule.save(update_fields=['is_active'])
        self.client.force_authenticate(user=self.manager)

        active = self.client.get(f'{self.URL}?is_active=true').data
        inactive = self.client.get(f'{self.URL}?is_active=false').data

        self.assertEqual([r['id'] for r in active], [self.loading_rule.id])
        self.assertEqual([r['id'] for r in inactive], [self.draft_rule.id])

    def test_rule_on_an_unknown_status_sorts_last(self):
        """A rule left behind by a retired status must not break the page."""
        orphan = TaskRule.objects.create(
            step='zzz_retired_step',  # no ShipmentStatusType row at all
            title_key='tasks.legacy',
            assignee_role='sales_rep',
        )
        self.client.force_authenticate(user=self.manager)
        rows = self.client.get(self.URL).data

        self.assertEqual(rows[-1]['id'], orphan.id)
        self.assertIsNone(rows[-1]['step_order'])
        self.assertEqual(rows[-1]['step_display'], 'zzz_retired_step')


class TaskRulesPageRegistrationTests(TestCase):
    """The page code must stay registered, or the gate hides it from everyone."""

    def test_page_code_is_in_the_registry(self):
        from apps.core.permission_registry import PAGE_REGISTRY

        self.assertIn(PAGE_CODE, PAGE_REGISTRY)

    def test_seed_migration_grants_the_management_roles(self):
        """Drive the migration's seeding helper directly (it no-ops on test DBs)."""
        import importlib

        # Module name starts with a digit, so it can only be reached by string.
        module = importlib.import_module(
            'apps.core.migrations.0056_task_rules_page_perms',
        )
        created = module.seed_task_rules_page(RolePagePermission)

        self.assertEqual(created, len(module.ALL_ROLES))
        visible = set(
            RolePagePermission.objects
            .filter(page_code=PAGE_CODE, is_visible=True)
            .values_list('role', flat=True)
        )
        self.assertEqual(visible, set(module.VISIBLE_ROLES))

    def test_migration_visible_set_matches_the_seeded_matrix(self):
        """The migration and `seed_permissions` must agree on who sees the page.

        They are two independent lists: the migration heals an existing database,
        `seed_permissions` builds a fresh one. `core/0054` shipped with a
        one-page gap between them (it missed the `transport.map` loop), so a
        fresh install and the live DB disagreed. This is that guard for this page.
        """
        import importlib

        from apps.core.management.commands.seed_permissions import PAGE_DEFAULTS

        module = importlib.import_module(
            'apps.core.migrations.0056_task_rules_page_perms',
        )
        seeded = {
            role for role, pages in PAGE_DEFAULTS.items()
            if PAGE_CODE in pages
        }

        self.assertEqual(seeded, set(module.VISIBLE_ROLES))

    def test_the_two_rule_less_roles_can_open_the_page(self):
        """greenhouse_manager and seller own no TaskRule at all.

        Their whole queue is a code-driven kind (`weekly_plan` / `local_sell_plan`),
        described only by the page's second table — so hiding the page from them
        hides the only written description of their own work.
        """
        import importlib

        module = importlib.import_module(
            'apps.core.migrations.0056_task_rules_page_perms',
        )

        self.assertIn('greenhouse_manager', module.VISIBLE_ROLES)
        self.assertIn('seller', module.VISIBLE_ROLES)
