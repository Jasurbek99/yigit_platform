"""Stream F — draft creation auto-generates tasks; can_promote_from_draft.

Covers:
  - _create_draft_shipment generates the 5-or-6 draft-stage tasks
    (depending on the is_gapy_satys flag)
  - can_promote_from_draft is False on a fresh draft (auto tasks unfilled),
    True after target fields are filled
  - manual_done draft tasks (give_documents) do NOT block promotion
  - non-draft shipments always return can_promote_from_draft = False
  - assign() endpoint still works on a fully-prepped draft

Run:
    python manage.py test apps.export.tests_draft_promote --keepdb
"""
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

import datetime as dt

from apps.core.models import (
    Country,
    Customer,
    GreenhouseBlock,
    ImportFirm,
    Season,
    ShipmentStatusType,
    User,
)
from apps.export.management.commands.seed_task_rules import Command as SeedTaskRules
from apps.export.models import Shipment, Task, TaskState
from apps.export.serializers import ShipmentDetailSerializer


def _make_user(username: str, role: str) -> User:
    return User.objects.create_user(username=username, password='pw', role=role)


def _make_season() -> Season:
    season, _ = Season.objects.get_or_create(
        name='2025',
        defaults={'start_date': '2025-01-01', 'end_date': '2025-12-31', 'is_active': True},
    )
    return season


def _make_status(code: str, step_order: int, name_en: str) -> ShipmentStatusType:
    obj, _ = ShipmentStatusType.objects.get_or_create(
        code=code,
        defaults={
            'name_tk': code, 'name_en': name_en, 'name_ru': name_en,
            'step_order': step_order, 'phase': 'PREP',
        },
    )
    return obj


def _seed_task_rules() -> None:
    """Run seed_task_rules to populate the 13 TaskRule rows."""
    SeedTaskRules().handle(reset=False)


class DraftCreationGeneratesTasksTests(TestCase):
    """_create_draft_shipment fires generate_tasks_for_status('draft')."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        _seed_task_rules()
        _make_status('draft', 0, 'Draft')
        _make_status('yuklenme', 1, 'Loading')
        cls.user = _make_user('soltanmyrat', 'warehouse_chief')
        cls.season = _make_season()
        cls.block = GreenhouseBlock.objects.create(code='F-A', name='Test block A')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_draft_creation_generates_tasks(self):
        """A POST with is_draft=True spawns the draft-step tasks."""
        resp = self.client.post('/api/v1/export/shipments/', {
            'cargo_code': '0101001/25',
            'date': '2025-01-01',
            'is_draft': True,
            'block_sources': [{'block_id': self.block.id, 'weight_kg': 1000}],
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        ship_id = resp.data['id']
        tasks = Task.objects.filter(shipment_id=ship_id, step='draft')
        # Default is_gapy_satys=False → 5 tasks generate (gapy variant gated out)
        self.assertEqual(tasks.count(), 5)
        title_keys = set(tasks.values_list('title_key', flat=True))
        self.assertIn('tasks.set_destination', title_keys)
        self.assertIn('tasks.pick_export_firms', title_keys)
        self.assertIn('tasks.assign_driver', title_keys)
        self.assertIn('tasks.give_documents', title_keys)
        self.assertIn('tasks.start_documents_prep', title_keys)
        # Conditional out:
        self.assertNotIn('tasks.give_documents_gapy', title_keys)

    def test_draft_without_block_sources_allowed(self):
        """Stream F relaxed the validation — drafts can be created without
        block_sources from the standard ShipmentCreateModal. They can be
        added later via the Sheet edit path."""
        resp = self.client.post('/api/v1/export/shipments/', {
            'cargo_code': '0101002/25',
            'date': '2025-01-02',
            'is_draft': True,
            'block_sources': [],
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        # Tasks still generate even without block_sources.
        ship_id = resp.data['id']
        self.assertEqual(
            Task.objects.filter(shipment_id=ship_id, step='draft').count(),
            5,
        )


class CanPromoteFromDraftTests(TestCase):
    """can_promote_from_draft reflects auto-resolving draft-task completion."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        _seed_task_rules()
        _make_status('draft', 0, 'Draft')
        _make_status('yuklenme', 1, 'Loading')
        cls.user = _make_user('gadam', 'export_manager')
        cls.season = _make_season()
        cls.country = Country.objects.create(name_tk='Kazakhstan', name_en='Kazakhstan', name_ru='Казахстан', code='KZ')
        cls.customer = Customer.objects.create(name='TestCustomer')
        cls.import_firm = ImportFirm.objects.create(name_company='TestFirm')

    def _make_draft(self) -> Shipment:
        return Shipment.objects.create(
            cargo_code='0101099/25',
            date=dt.date(2025, 1, 1),
            season=self.season,
            status=ShipmentStatusType.objects.get(code='draft'),
            created_by=self.user,
        )

    def test_fresh_draft_not_promotable(self):
        """A new draft with all auto tasks open → can_promote_from_draft is False."""
        ship = self._make_draft()
        from apps.export.services.task_rules import generate_tasks_for_status
        generate_tasks_for_status(ship, 'draft')
        ship.refresh_from_db()
        ser = ShipmentDetailSerializer(ship, context={'request': type('R', (), {'user': self.user})()})
        self.assertFalse(ser.data['can_promote_from_draft'])

    def test_non_draft_never_promotable(self):
        """A shipment in yuklenme returns False — only draft is promotable."""
        ship = Shipment.objects.create(
            cargo_code='0101100/25',
            date=dt.date(2025, 1, 1),
            season=self.season,
            status=ShipmentStatusType.objects.get(code='yuklenme'),
            created_by=self.user,
        )
        ser = ShipmentDetailSerializer(ship, context={'request': type('R', (), {'user': self.user})()})
        self.assertFalse(ser.data['can_promote_from_draft'])

    def test_promotable_when_auto_tasks_done(self):
        """Mark all auto-resolving draft tasks DONE → promotable, even with manual tasks open."""
        ship = self._make_draft()
        from apps.export.services.task_rules import generate_tasks_for_status
        generate_tasks_for_status(ship, 'draft')
        # Mark all non-manual draft tasks DONE.
        from apps.export.models import TaskCompletionRule
        Task.objects.filter(
            shipment=ship, step='draft',
        ).exclude(
            completion_rule=TaskCompletionRule.MANUAL_DONE,
        ).update(state=TaskState.DONE)
        ser = ShipmentDetailSerializer(ship, context={'request': type('R', (), {'user': self.user})()})
        self.assertTrue(
            ser.data['can_promote_from_draft'],
            'Should be promotable: every auto-resolving draft task is DONE',
        )

    def test_manual_done_tasks_dont_block_promote(self):
        """tasks.give_documents (manual_done) being OPEN must NOT block promotion."""
        ship = self._make_draft()
        from apps.export.services.task_rules import generate_tasks_for_status
        from apps.export.models import TaskCompletionRule
        generate_tasks_for_status(ship, 'draft')
        # Resolve every auto task; explicitly leave manual ones OPEN.
        Task.objects.filter(
            shipment=ship, step='draft',
        ).exclude(
            completion_rule=TaskCompletionRule.MANUAL_DONE,
        ).update(state=TaskState.DONE)
        # Sanity: a manual_done task is still OPEN
        manual_open = Task.objects.filter(
            shipment=ship, step='draft',
            completion_rule=TaskCompletionRule.MANUAL_DONE,
            state=TaskState.OPEN,
        ).exists()
        self.assertTrue(manual_open, 'Test setup: manual task should remain open')
        ser = ShipmentDetailSerializer(ship, context={'request': type('R', (), {'user': self.user})()})
        self.assertTrue(ser.data['can_promote_from_draft'])


class PromoteEndpointStillWorksTests(TestCase):
    """The existing /assign/ endpoint promotes a draft to yuklenme."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        _seed_task_rules()
        _make_status('draft', 0, 'Draft')
        _make_status('yuklenme', 1, 'Loading')
        cls.user = _make_user('gadam_p', 'export_manager')
        cls.season = _make_season()
        cls.country = Country.objects.create(name_tk='Kazakhstan2', name_en='Kazakhstan2', name_ru='Казахстан2', code='K2')
        cls.customer = Customer.objects.create(name='TestCustomer2')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_assign_promotes_draft(self):
        """POST /shipments/:id/assign/ on a draft transitions it to yuklenme."""
        ship = Shipment.objects.create(
            cargo_code='0101200/25',
            date=dt.date(2025, 1, 1),
            season=self.season,
            status=ShipmentStatusType.objects.get(code='draft'),
            country=self.country,
            customer=self.customer,
            created_by=self.user,
        )
        resp = self.client.post(
            f'/api/v1/export/shipments/{ship.pk}/assign/', {}, format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        ship.refresh_from_db()
        self.assertEqual(ship.status.code, 'yuklenme')
        # Yuklenme tasks should now exist (transition_to triggers generate_tasks_for_status)
        self.assertTrue(
            Task.objects.filter(shipment=ship, step='yuklenme').exists(),
        )
