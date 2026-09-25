"""At most one Task per (shipment, rule), enforced by the database.

The task generators check "does this rule's task exist?" and then create it.
Two requests running at once could both see "no task" and both create one;
the unique constraint makes the second insert fail, and create_rule_task()
turns that failure into "already there".
"""
from django.db import IntegrityError, transaction
from django.test import TestCase

from apps.core.models import Season, ShipmentStatusType
from apps.export.models import Shipment, Task, TaskCompletionRule, TaskRule, TaskState
from apps.export.services.task_rules import create_rule_task


def _task_fields(shipment, rule) -> dict:
    return {
        'shipment': shipment, 'step': 'draft', 'rule': rule,
        'title_key': rule.title_key if rule else 'tasks.adhoc',
        'assignee_role': 'transport',
        'completion_rule': TaskCompletionRule.MANUAL_DONE,
        'target_fields': 'driver_name', 'target_value': '',
        'state': TaskState.OPEN,
    }


class TaskUniquenessTests(TestCase):
    def setUp(self):
        season, _ = Season.objects.get_or_create(
            name='uniq-tst',
            defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True},
        )
        status, _ = ShipmentStatusType.objects.get_or_create(
            code='draft',
            defaults={
                'name_tk': 'draft', 'name_en': 'draft', 'name_ru': 'draft',
                'step_order': 0, 'phase': 'DRAFT',
            },
        )
        self.shipment = Shipment.objects.create(
            shipment_code='0501001/26', date='2026-01-15', season=season, status=status,
        )
        self.rule = TaskRule.objects.create(
            step='draft', title_key='tasks.assign_driver', assignee_role='transport',
            target_fields='driver_name',
            completion_rule=TaskCompletionRule.MANUAL_DONE,
            target_value='', deadline_rule='',
            condition_field='', condition_value='', is_active=True,
        )

    def test_database_refuses_a_second_task_for_the_same_rule(self):
        Task.objects.create(**_task_fields(self.shipment, self.rule))
        with self.assertRaises(IntegrityError), transaction.atomic():
            Task.objects.create(**_task_fields(self.shipment, self.rule))

    def test_ad_hoc_tasks_without_a_rule_are_not_limited(self):
        Task.objects.create(**_task_fields(self.shipment, None))
        Task.objects.create(**_task_fields(self.shipment, None))
        self.assertEqual(Task.objects.filter(rule__isnull=True).count(), 2)

    def test_create_rule_task_returns_none_when_the_task_already_exists(self):
        first = create_rule_task(**_task_fields(self.shipment, self.rule))
        second = create_rule_task(**_task_fields(self.shipment, self.rule))

        self.assertIsNotNone(first)
        self.assertIsNone(second)
        self.assertEqual(Task.objects.filter(rule=self.rule).count(), 1)
        # The savepoint keeps the surrounding transaction usable.
        self.assertTrue(Task.objects.filter(pk=first.pk).exists())
