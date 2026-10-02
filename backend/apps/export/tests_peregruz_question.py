"""«Peregruz barmy?» — docs/Tasks.md item 31 (owner, 2026-09-29).

has_peregruz is tri-state: None = the sales rep has not answered yet. A new
dest_entry rule (completion `field_set`, so an explicit «No» counts) keeps the
truck at dest_entry until the question is answered, so the barysh_gumrugi fork
(transshipment vs direct arrival) is always taken on a real answer.
"""
from django.test import TestCase
from django.utils import timezone

from apps.core.models import Season, ShipmentStatusType, User
from apps.export.management.commands.seed_task_rules import Command as SeedTaskRulesCommand
from apps.export.models import Shipment, Task, TaskCompletionRule, TaskState
from apps.export.services.task_rules import generate_tasks_for_status

STATUSES = [
    ('dest_entry', 6, 'BORDER'), ('barysh_gumrugi', 7, 'BORDER'),
    ('transshipment', 8, 'SALES'), ('bardy', 9, 'SALES'),
]


class PeregruzQuestionTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        for code, order, phase in STATUSES:
            ShipmentStatusType.objects.get_or_create(
                code=code,
                defaults={'name_tk': code, 'name_en': code, 'name_ru': code,
                          'step_order': order, 'phase': phase},
            )
        SeedTaskRulesCommand().handle(reset=False)
        cls.user = User.objects.create_user(username='pq_rep', password='pw', role='sales_rep')
        cls.season, _ = Season.objects.get_or_create(
            name='2025-2026',
            defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True},
        )

    def _at_dest_entry(self, code='PQ-1') -> Shipment:
        shipment = Shipment.objects.create(
            shipment_code=code, date='2026-01-01', season=self.season,
            status=ShipmentStatusType.objects.get(code='dest_entry'),
            created_by=self.user, updated_by=self.user,
        )
        generate_tasks_for_status(shipment, 'dest_entry')
        return shipment

    def _ask_task(self, shipment) -> Task:
        return shipment.tasks.get(title_key='tasks.ask_peregruz')

    def test_new_shipment_has_no_answer_yet(self):
        self.assertIsNone(self._at_dest_entry().has_peregruz)

    def _customs_done(self, shipment) -> Shipment:
        shipment.customs_entry_at = timezone.now()
        shipment.save()
        return shipment

    def test_the_question_opens_after_the_customs_task(self):
        # 31 after 30 — one task at a time (owner, 2026-10-01).
        shipment = self._at_dest_entry()
        self.assertFalse(shipment.tasks.filter(title_key='tasks.ask_peregruz').exists())
        task = self._ask_task(self._customs_done(shipment))
        self.assertEqual(task.assignee_role, 'sales_rep')
        self.assertEqual(task.completion_rule, TaskCompletionRule.FIELD_SET)
        self.assertEqual(task.target_field_list, ['has_peregruz'])
        self.assertEqual(task.state, TaskState.OPEN)

    def test_an_explicit_no_answers_the_question(self):
        shipment = self._customs_done(self._at_dest_entry())
        shipment.has_peregruz = False
        shipment.save()
        self.assertEqual(self._ask_task(shipment).state, TaskState.DONE)

    def test_truck_waits_for_the_answer_then_takes_the_right_branch(self):
        shipment = self._at_dest_entry()
        shipment.customs_entry_at = timezone.now()
        shipment.save()
        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'dest_entry')        # not answered yet

        shipment.has_peregruz = False
        shipment.save()
        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'barysh_gumrugi')
        titles = set(shipment.tasks.filter(step='barysh_gumrugi').values_list('title_key', flat=True))
        self.assertEqual(titles, {'tasks.trigger_arrival_direct'})

    def test_yes_leads_to_the_transshipment_task(self):
        shipment = self._at_dest_entry('PQ-2')
        shipment.has_peregruz = True
        shipment.customs_entry_at = timezone.now()
        shipment.save()
        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'barysh_gumrugi')
        titles = set(shipment.tasks.filter(step='barysh_gumrugi').values_list('title_key', flat=True))
        self.assertEqual(titles, {'tasks.trigger_transshipment'})
