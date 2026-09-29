"""A draft with no destination (the packing part) carries no tasks.

Owner, 2026-09-29: a Gaplama / supply truck must not show up in anyone's tasks
as a shipment. The draft-step tasks appear once a destination (country or
customer) is set on it; clearing the destination cancels them again.
"""
from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from apps.core.models import Customer, Season, ShipmentStatusType, User
from apps.export.management.commands.seed_task_rules import (
    Command as SeedTaskRulesCommand,
)
from apps.export.models import Shipment, Task, TaskCancelReason, TaskState
from apps.export.serializers import ShipmentDetailSerializer
from apps.export.services.task_rules import (
    generate_tasks_for_status,
    reconcile_shipment_tasks,
)


class PackingPartTaskTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        for code, order, phase in [('draft', 0, 'DRAFT'), ('gumruk_girish', 1, 'CUSTOMS')]:
            ShipmentStatusType.objects.get_or_create(
                code=code,
                defaults={
                    'name_tk': code, 'name_en': code, 'name_ru': code,
                    'step_order': order, 'phase': phase,
                },
            )
        SeedTaskRulesCommand().handle(reset=False)
        cls.user = User.objects.create_user(
            username='pp_manager', password='pw', role='export_manager',
        )
        cls.season, _ = Season.objects.get_or_create(
            name='2025-2026',
            defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True},
        )
        cls.customer = Customer.objects.create(name='PP customer')

    def _draft(self, code: str, **extra) -> Shipment:
        shipment = Shipment.objects.create(
            shipment_code=code,
            date='2026-01-01',
            season=self.season,
            status=ShipmentStatusType.objects.get(code='draft'),
            created_by=self.user,
            updated_by=self.user,
            **extra,
        )
        generate_tasks_for_status(shipment, 'draft')
        return shipment

    def _set_customer(self, shipment: Shipment, customer) -> dict:
        shipment.customer = customer
        shipment.save()
        return reconcile_shipment_tasks(shipment, changed_fields=['customer'])

    def test_packing_part_gets_no_tasks(self):
        self.assertFalse(self._draft('PP-1').tasks.exists())

    def test_gapy_flip_on_a_packing_part_creates_nothing(self):
        shipment = self._draft('PP-2')
        shipment.is_gapy_satys = True
        shipment.save()
        result = reconcile_shipment_tasks(shipment, changed_fields=['is_gapy_satys'])
        self.assertEqual(result['created'], [])
        self.assertFalse(shipment.tasks.exists())

    def test_setting_a_destination_generates_the_draft_tasks(self):
        shipment = self._draft('PP-3')
        result = self._set_customer(shipment, self.customer)
        self.assertTrue(result['created'])
        self.assertTrue(
            shipment.tasks.filter(step='draft', title_key='tasks.set_destination').exists()
        )

    def test_clearing_the_destination_cancels_and_setting_it_again_reopens(self):
        shipment = self._draft('PP-4', customer=self.customer)
        open_before = set(
            shipment.tasks.filter(state=TaskState.OPEN).values_list('id', flat=True)
        )
        self.assertTrue(open_before)

        result = self._set_customer(shipment, None)
        self.assertEqual({t.id for t in result['cancelled']}, open_before)
        self.assertFalse(
            shipment.tasks.exclude(cancelled_reason=TaskCancelReason.RULE_MISMATCH)
            .filter(state=TaskState.CANCELLED).exists()
        )

        result = self._set_customer(shipment, self.customer)
        self.assertEqual({t.id for t in result['reopened']}, open_before)
        self.assertEqual(result['created'], [])

    def test_done_task_is_untouched_when_the_destination_is_cleared(self):
        shipment = self._draft('PP-5', customer=self.customer)
        done = shipment.tasks.first()
        done.state = TaskState.DONE
        done.save(update_fields=['state'])

        self._set_customer(shipment, None)
        done.refresh_from_db()
        self.assertEqual(done.state, TaskState.DONE)

    def test_a_destination_edit_on_a_draft_with_tasks_creates_no_missing_rule(self):
        """A legacy draft exempted from a rule stays exempt after a country edit."""
        shipment = self._draft('PP-6', customer=self.customer)
        shipment.tasks.filter(title_key='tasks.set_border_point').delete()

        other = Customer.objects.create(name='PP other customer')
        result = self._set_customer(shipment, other)
        self.assertEqual(result['created'], [])
        self.assertFalse(shipment.tasks.filter(title_key='tasks.set_border_point').exists())

    def test_packing_part_does_not_advance_and_cannot_be_promoted(self):
        shipment = self._draft('PP-7')
        shipment.notes = 'touched'
        shipment.save()
        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'draft')

        request = type('R', (), {'user': self.user})()
        data = ShipmentDetailSerializer(shipment, context={'request': request}).data
        self.assertFalse(data['can_promote_from_draft'])


class MyTasksHidesPackingPartsTests(TestCase):
    """GET /me/tasks/ never lists a packing part's tasks, in any state."""

    @classmethod
    def setUpTestData(cls):
        draft, _ = ShipmentStatusType.objects.get_or_create(
            code='draft',
            defaults={
                'name_tk': 'draft', 'name_en': 'draft', 'name_ru': 'draft',
                'step_order': 0, 'phase': 'DRAFT',
            },
        )
        season, _ = Season.objects.get_or_create(
            name='2025-2026',
            defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True},
        )
        cls.user = User.objects.create_user(username='pp_me', password='pw', role='transport')
        packing = Shipment.objects.create(
            shipment_code='ME-PP', date='2026-01-01', season=season, status=draft,
        )
        export_part = Shipment.objects.create(
            shipment_code='ME-EX', date='2026-01-01', season=season, status=draft,
            customer=Customer.objects.create(name='ME customer'),
        )

        def task(shipment, state):
            return Task.objects.create(
                shipment=shipment, step='draft', title_key='tasks.assign_driver',
                assignee_role='transport', completion_rule='manual_done',
                target_fields='', target_value='', state=state,
            )

        cls.packing_open = task(packing, TaskState.OPEN)
        cls.packing_cancelled = task(packing, TaskState.CANCELLED)
        cls.export_open = task(export_part, TaskState.OPEN)
        cls.no_shipment = task(None, TaskState.OPEN)

    def test_packing_part_tasks_are_hidden(self):
        from rest_framework.test import APIClient
        client = APIClient()
        client.force_authenticate(user=self.user)
        resp = client.get('/api/v1/me/tasks/')
        self.assertEqual(resp.status_code, 200)
        ids = {t['id'] for t in resp.data['results']}
        self.assertNotIn(self.packing_open.id, ids)
        self.assertNotIn(self.packing_cancelled.id, ids)
        self.assertIn(self.export_open.id, ids)
        self.assertIn(self.no_shipment.id, ids)


class CancelPackingPartTasksCommandTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        ShipmentStatusType.objects.get_or_create(
            code='draft',
            defaults={
                'name_tk': 'draft', 'name_en': 'draft', 'name_ru': 'draft',
                'step_order': 0, 'phase': 'DRAFT',
            },
        )
        SeedTaskRulesCommand().handle(reset=False)
        season, _ = Season.objects.get_or_create(
            name='2025-2026',
            defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True},
        )
        customer = Customer.objects.create(name='Cmd customer')
        draft = ShipmentStatusType.objects.get(code='draft')
        # Both built with a destination so they get tasks the pre-2026-09-29
        # way, then the packing part loses it by a bulk update (no reconcile).
        cls.packing = Shipment.objects.create(
            shipment_code='CMD-1', date='2026-01-01', season=season, status=draft,
            customer=customer,
        )
        cls.export_part = Shipment.objects.create(
            shipment_code='CMD-2', date='2026-01-01', season=season, status=draft,
            customer=customer,
        )
        for shipment in (cls.packing, cls.export_part):
            generate_tasks_for_status(shipment, 'draft')
        Shipment.objects.filter(pk=cls.packing.pk).update(customer=None)

    def _active(self, shipment: Shipment) -> int:
        return shipment.tasks.filter(state__in=[TaskState.OPEN, TaskState.IN_PROGRESS]).count()

    def test_dry_run_writes_nothing(self):
        before = self._active(self.packing)
        out = StringIO()
        call_command('cancel_packing_part_tasks', '--dry-run', stdout=out)
        self.assertIn(f'would cancel {before} task(s) on 1 draft(s)', out.getvalue())
        self.assertEqual(self._active(self.packing), before)

    def test_cancels_only_the_packing_part(self):
        export_before = self._active(self.export_part)
        call_command('cancel_packing_part_tasks', stdout=StringIO())
        self.assertEqual(self._active(self.packing), 0)
        self.assertEqual(self._active(self.export_part), export_before)
