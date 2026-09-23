"""Transport fills "Serhet nokady" on the draft step, before the documents go out.

The border point is read by the TIR carnet / CMR overlay
(``_border_point_name()`` in ``contracts/services/document_context.py``), so the
rule sits on ``draft`` next to the document-prep task rather than later in the
lifecycle, and it is ALL_FIELDS_FILLED — it joins the ``draft →
gumruk_girish`` gate.

The second test is the operational one: R29 carries ``gapy_hidden=True``, so a
gapy shipment has no UI path to the field. An unconditional rule would put a
permanently unresolvable gating task on every gapy draft and freeze it — the
same trap that ``weight_gross`` and the old quality rule fell into. If anyone
drops ``condition_field`` from the seed row, that test fails and says why.
"""
from django.test import TestCase

from apps.core.models import BorderPoint, Season, ShipmentStatusType, User
from apps.export.management.commands.seed_task_rules import (
    Command as SeedTaskRulesCommand,
)
from apps.export.models import Shipment, Task, TaskState
from apps.export.services.task_rules import generate_tasks_for_status

V2_STATUSES = [
    ('draft', 0, 'DRAFT'),
    ('gumruk_girish', 1, 'CUSTOMS'),
]

TITLE_KEY = 'tasks.set_border_point'


class BorderPointTaskTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        for code, order, phase in V2_STATUSES:
            ShipmentStatusType.objects.get_or_create(
                code=code,
                defaults={
                    'name_tk': code, 'name_en': code, 'name_ru': code,
                    'step_order': order, 'phase': phase,
                },
            )
        SeedTaskRulesCommand().handle(reset=False)
        cls.user = User.objects.create_user(
            username='bp_transport', password='pw', role='transport',
        )
        cls.season, _ = Season.objects.get_or_create(
            name='2025-2026',
            defaults={
                'start_date': '2025-09-01',
                'end_date': '2026-06-30',
                'is_active': True,
            },
        )
        cls.farap = BorderPoint.objects.create(name='Farap', name_ru='Фарап')

    def _draft(self, code: str, *, gapy: bool = False) -> Shipment:
        shipment = Shipment.objects.create(
            shipment_code=code,
            date='2026-01-01',
            season=self.season,
            status=ShipmentStatusType.objects.get(code='draft'),
            is_gapy_satys=gapy,
            created_by=self.user,
            updated_by=self.user,
        )
        generate_tasks_for_status(shipment, 'draft')
        return shipment

    def test_a_normal_draft_gets_the_border_point_task_for_transport(self):
        task = Task.objects.get(shipment=self._draft('BP-1'), title_key=TITLE_KEY)
        self.assertEqual(task.assignee_role, 'transport')
        self.assertEqual(task.target_fields, 'border_point')
        self.assertEqual(task.state, TaskState.OPEN)

    def test_a_gapy_draft_never_gets_it(self):
        """Gapy is a domestic sale — no border is crossed and R29 is hidden."""
        self.assertFalse(
            Task.objects.filter(
                shipment=self._draft('BP-2', gapy=True), title_key=TITLE_KEY,
            ).exists()
        )

    def test_picking_a_border_point_resolves_the_task(self):
        shipment = self._draft('BP-3')
        shipment.border_point = self.farap
        shipment.updated_by = self.user
        shipment.save()

        task = Task.objects.get(shipment=shipment, title_key=TITLE_KEY)
        self.assertEqual(task.state, TaskState.DONE)

    def test_a_draft_created_with_a_border_point_resolves_on_entry(self):
        """generate_tasks_for_status() auto-resolves already-filled targets."""
        shipment = Shipment.objects.create(
            shipment_code='BP-4',
            date='2026-01-01',
            season=self.season,
            status=ShipmentStatusType.objects.get(code='draft'),
            border_point=self.farap,
            created_by=self.user,
            updated_by=self.user,
        )
        generate_tasks_for_status(shipment, 'draft')

        task = Task.objects.get(shipment=shipment, title_key=TITLE_KEY)
        self.assertEqual(task.state, TaskState.DONE)

    def test_an_empty_border_point_holds_the_draft_gate(self):
        """ALL_FIELDS_FILLED means this task gates draft → gumruk_girish."""
        from apps.export.services.shipment import is_step_trigger_satisfied

        shipment = self._draft('BP-5')
        Task.objects.filter(shipment=shipment).exclude(
            title_key=TITLE_KEY,
        ).update(state=TaskState.DONE)

        self.assertFalse(is_step_trigger_satisfied(shipment, 'draft'))

        shipment.border_point = self.farap
        shipment.updated_by = self.user
        shipment.save()

        self.assertTrue(is_step_trigger_satisfied(shipment, 'draft'))
