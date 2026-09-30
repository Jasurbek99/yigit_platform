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
from decimal import Decimal

from apps.core.models import (
    Country,
    Customer,
    GreenhouseBlock,
    GreenhouseConfig,
    ImportFirm,
    Season,
    ShipmentStatusType,
    User,
)
from apps.export.management.commands.seed_task_rules import Command as SeedTaskRules
from apps.export.models import Shipment, ShipmentBlockSource, Task, TaskState
from apps.export.serializers import ShipmentDetailSerializer
from apps.export.services import transition_to
from apps.greenhouse.models import HarvestDayEntry, WeeklyHarvestPlan


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
        cls.customer = Customer.objects.create(name='DraftTasksCustomer')

        # The forecast-first model requires a forecast entry for a block+date
        # before a draft with block_sources can be created against it.
        # Seed a forecast so test_draft_creation_generates_tasks can POST with
        # block_sources=[{block, 1000}] for 2025-01-01.
        GreenhouseConfig.get_solo()  # ensure singleton
        draft_date = dt.date(2025, 1, 1)
        iso_year, iso_week, _ = draft_date.isocalendar()
        plan, _ = WeeklyHarvestPlan.objects.get_or_create(
            season=cls.season,
            block=cls.block,
            week_number=iso_week,
            year=iso_year,
        )
        entry, _ = HarvestDayEntry.objects.get_or_create(
            weekly_plan=plan,
            entry_date=draft_date,
            defaults={'season': cls.season, 'block': cls.block, 'weekday': draft_date.weekday()},
        )
        entry.forecast_value = Decimal('20000')
        entry.save(update_fields=['forecast_value'])

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_packing_part_gets_no_tasks(self):
        """A draft with blocks and no destination is the packing part (Gaplama /
        supply truck). Owner, 2026-09-29: it must not appear in anyone's tasks."""
        resp = self.client.post('/api/v1/export/shipments/', {
            'shipment_code': '0101001/25',
            'date': '2025-01-01',
            'is_draft': True,
            'block_sources': [{'block_id': self.block.id, 'weight_kg': 1000}],
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertFalse(Task.objects.filter(shipment_id=resp.data['id']).exists())

    def test_draft_with_a_destination_generates_tasks(self):
        """A POST with is_draft=True and a destination spawns the draft-step tasks."""
        resp = self.client.post('/api/v1/export/shipments/', {
            'shipment_code': '0101003/25',
            'date': '2025-01-01',
            'is_draft': True,
            'customer': self.customer.id,
            'block_sources': [],
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        ship_id = resp.data['id']
        tasks = Task.objects.filter(shipment_id=ship_id, step='draft')
        # PREP chain (2026-09-30): only 5b exists until it is done — country and
        # import firm are still empty; the rest are created after it.
        self.assertEqual(set(tasks.values_list('title_key', flat=True)), {'tasks.set_destination'})

    def test_draft_without_block_sources_allowed(self):
        """Stream F relaxed the validation — drafts can be created without
        block_sources from the standard ShipmentCreateModal. They can be
        added later via the Sheet edit path."""
        resp = self.client.post('/api/v1/export/shipments/', {
            'shipment_code': '0101002/25',
            'date': '2025-01-02',
            'is_draft': True,
            'block_sources': [],
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        # No destination either, so it is a packing part: no tasks.
        ship_id = resp.data['id']
        self.assertFalse(Task.objects.filter(shipment_id=ship_id).exists())

    def test_draft_creation_without_shipment_code_auto_generates(self):
        """Stream F-followup: shipment_code is optional. Server generates one
        in DDMMNNN/YY format when omitted."""
        import re
        resp = self.client.post('/api/v1/export/shipments/', {
            # No shipment_code, no date — let the server fill them in.
            'is_draft': True,
            'block_sources': [],
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        shipment_code = resp.data['shipment_code']
        self.assertRegex(
            shipment_code, r'^\d{7}/\d{2}$',
            f'Auto-generated shipment_code {shipment_code!r} does not match DDMMNNN/YY',
        )
        # And the shipment landed in DRAFT, not Loading. The label is read from
        # the row: seeded test DBs hold the core/0064 name, DJANGO_TESTING ones
        # hold _make_status's.
        draft = ShipmentStatusType.objects.get(code='draft')
        self.assertEqual(resp.data['status_display'], draft.name_en)

    def test_two_drafts_same_day_get_distinct_codes(self):
        """The auto-generator increments the sequence so codes don't collide
        on the same day."""
        codes = []
        for _ in range(2):
            resp = self.client.post('/api/v1/export/shipments/', {
                'is_draft': True,
                'block_sources': [],
            }, format='json')
            self.assertEqual(resp.status_code, 201, resp.data)
            codes.append(resp.data['shipment_code'])
        self.assertEqual(len(set(codes)), 2, f'Duplicate codes generated: {codes}')

    def test_loading_started_at_NOT_set_when_creating_draft(self):
        """When a shipment is created as draft, loading_started_at must remain
        null. It's only set when the user explicitly promotes to Loading."""
        resp = self.client.post('/api/v1/export/shipments/', {
            'is_draft': True,
            'block_sources': [],
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        ship = Shipment.objects.get(pk=resp.data['id'])
        self.assertIsNone(ship.loading_started_at)
        self.assertEqual(ship.status.code, 'draft')


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
            shipment_code='0101099/25',
            date=dt.date(2025, 1, 1),
            season=self.season,
            status=ShipmentStatusType.objects.get(code='draft'),
            customer=self.customer,
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
            shipment_code='0101100/25',
            date=dt.date(2025, 1, 1),
            season=self.season,
            status=ShipmentStatusType.objects.get(code='yuklenme'),
            created_by=self.user,
        )
        ser = ShipmentDetailSerializer(ship, context={'request': type('R', (), {'user': self.user})()})
        self.assertFalse(ser.data['can_promote_from_draft'])

    def _close_auto_tasks(self, ship):
        """Mark every non-manual draft task DONE, including the ones each
        closure makes due (PREP chain, 2026-09-30)."""
        from apps.export.models import TaskCompletionRule
        from apps.export.services.task_chain import spawn_ready_tasks
        from apps.export.services.task_rules import generate_tasks_for_status
        generate_tasks_for_status(ship, 'draft')
        while True:
            Task.objects.filter(shipment=ship, step='draft').exclude(
                completion_rule=TaskCompletionRule.MANUAL_DONE,
            ).update(state=TaskState.DONE)
            if not spawn_ready_tasks(ship):
                break

    def test_promotable_when_auto_tasks_done(self):
        """Mark all auto-resolving draft tasks DONE → promotable, even with manual tasks open."""
        ship = self._make_draft()
        self._close_auto_tasks(ship)
        ser = ShipmentDetailSerializer(ship, context={'request': type('R', (), {'user': self.user})()})
        self.assertTrue(
            ser.data['can_promote_from_draft'],
            'Should be promotable: every auto-resolving draft task is DONE',
        )

    def test_manual_done_tasks_dont_block_promote(self):
        """A manual_done draft task being OPEN must NOT block promotion."""
        from apps.export.models import TaskCompletionRule, TaskRule
        # The catalog has no manual draft task since 2026-09-30 (give_documents
        # is inactive), so the test brings its own.
        TaskRule.objects.create(step='draft', title_key='tasks.test_manual', assignee_role='transport',
                                completion_rule=TaskCompletionRule.MANUAL_DONE)
        ship = self._make_draft()
        self._close_auto_tasks(ship)
        # Sanity: a manual_done task is still OPEN
        manual_open = Task.objects.filter(
            shipment=ship, step='draft',
            completion_rule=TaskCompletionRule.MANUAL_DONE,
            state=TaskState.OPEN,
        ).exists()
        self.assertTrue(manual_open, 'Test setup: manual task should remain open')
        ser = ShipmentDetailSerializer(ship, context={'request': type('R', (), {'user': self.user})()})
        self.assertTrue(ser.data['can_promote_from_draft'])

    def test_an_open_join_supply_does_not_block_promote(self):
        """E4 (2026-09-30): join_supply never holds draft — documents may start first."""
        ship = self._make_draft()
        self._close_auto_tasks(ship)
        Task.objects.filter(shipment=ship, title_key='tasks.join_supply').update(state=TaskState.OPEN)
        ser = ShipmentDetailSerializer(ship, context={'request': type('R', (), {'user': self.user})()})
        self.assertTrue(ser.data['can_promote_from_draft'])

    def test_a_task_still_waiting_to_be_created_blocks_promote(self):
        """5b done, 7 and 8 not created yet: the draft is not ready (E3)."""
        from apps.export.services.task_rules import generate_tasks_for_status
        ship = self._make_draft()
        generate_tasks_for_status(ship, 'draft')
        Task.objects.filter(shipment=ship, title_key='tasks.set_destination').update(state=TaskState.DONE)
        ser = ShipmentDetailSerializer(ship, context={'request': type('R', (), {'user': self.user})()})
        self.assertFalse(ser.data['can_promote_from_draft'])


class PromoteEndpointStillWorksTests(TestCase):
    """The existing /assign/ endpoint promotes a draft to gumruk_girish (v2)."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        _seed_task_rules()
        _make_status('draft', 0, 'Draft')
        _make_status('gumruk_girish', 1, 'Customs Entry')
        _make_status('yuklenme', 3, 'Loading')
        cls.user = _make_user('gadam_p', 'export_manager')
        cls.season = _make_season()
        cls.country = Country.objects.create(name_tk='Kazakhstan2', name_en='Kazakhstan2', name_ru='Казахстан2', code='K2')
        cls.customer = Customer.objects.create(name='TestCustomer2')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_assign_promotes_draft(self):
        """POST /shipments/:id/assign/ on a draft transitions it to gumruk_girish."""
        block = GreenhouseBlock.objects.create(code='ZZ-1', name='ZZ-1')
        ship = Shipment.objects.create(
            shipment_code='0101200/25',
            date=dt.date(2025, 1, 1),
            season=self.season,
            status=ShipmentStatusType.objects.get(code='draft'),
            country=self.country,
            customer=self.customer,
            created_by=self.user,
        )
        # Draft-leave guard requires block_sources too — assign() funnels
        # through transition_to() which now enforces both halves are present.
        ShipmentBlockSource.objects.create(
            shipment=ship, block=block, weight_kg=10000,
        )
        resp = self.client.post(
            f'/api/v1/export/shipments/{ship.pk}/assign/', {}, format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        ship.refresh_from_db()
        self.assertEqual(ship.status.code, 'gumruk_girish')
        # gumruk_girish tasks should now exist (transition_to triggers generate_tasks_for_status)
        self.assertTrue(
            Task.objects.filter(shipment=ship, step='gumruk_girish').exists(),
        )


class DraftLeaveGuardTests(TestCase):
    """transition_to() must block a draft with no destination from leaving
    'draft'; packing is checked at loading (spec 2026-09-29).
    """

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        _seed_task_rules()
        _make_status('draft', 0, 'Draft')
        _make_status('gumruk_girish', 1, 'Customs Entry')
        _make_status('cancelled', 99, 'Cancelled')
        cls.user = _make_user('gadam_guard', 'export_manager')
        cls.season = _make_season()
        cls.country = Country.objects.create(
            name_tk='KZ_G', name_en='Kazakhstan_G', name_ru='KZ_G', code='KG',
        )
        cls.customer = Customer.objects.create(name='GuardCustomer')
        cls.block = GreenhouseBlock.objects.create(code='GA-1', name='GA-1')

    def _draft(self, *, country=None, customer=None, with_block: bool, code: str) -> Shipment:
        ship = Shipment.objects.create(
            shipment_code=code,
            date=dt.date(2025, 1, 1),
            season=self.season,
            status=ShipmentStatusType.objects.get(code='draft'),
            country=country,
            customer=customer,
            created_by=self.user,
        )
        if with_block:
            ShipmentBlockSource.objects.create(
                shipment=ship, block=self.block, weight_kg=10000,
            )
        return ship

    def test_supply_only_draft_cannot_leave_draft(self):
        """Soltanmyrat's draft: has blocks, no destination → must join first."""
        ship = self._draft(country=None, customer=None, with_block=True, code='0101301/25')
        with self.assertRaises(ValueError) as ctx:
            transition_to(ship, 'gumruk_girish', self.user)
        msg = str(ctx.exception)
        self.assertIn('country', msg)
        self.assertIn('customer', msg)
        self.assertNotIn('block_sources', msg)

    def test_destination_only_draft_leaves_draft(self):
        """Gadam's draft: destination, no blocks → documents may start (spec 2026-09-29)."""
        ship = self._draft(
            country=self.country, customer=self.customer, with_block=False, code='0101302/25',
        )
        transition_to(ship, 'gumruk_girish', self.user)
        ship.refresh_from_db()
        self.assertEqual(ship.status.code, 'gumruk_girish')

    def test_complete_draft_advances(self):
        """A draft with both halves filled advances normally."""
        ship = self._draft(
            country=self.country, customer=self.customer, with_block=True, code='0101303/25',
        )
        transition_to(ship, 'gumruk_girish', self.user)
        ship.refresh_from_db()
        self.assertEqual(ship.status.code, 'gumruk_girish')

    def test_half_draft_can_still_be_cancelled(self):
        """Cancel is exempt from the guard — abandoned half-drafts must be
        cancellable, otherwise they'd be unreachable forever."""
        ship = self._draft(country=None, customer=None, with_block=True, code='0101304/25')
        transition_to(ship, 'cancelled', self.user)
        ship.refresh_from_db()
        self.assertEqual(ship.status.code, 'cancelled')
