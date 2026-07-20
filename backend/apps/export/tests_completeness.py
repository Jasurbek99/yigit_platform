"""Tests for the shipment completeness service.

Covers:
  - fields required by the current step and by already-passed steps
  - future-step fields are NOT counted
  - rule conditions are honoured (condition_field / condition_value)
  - duplicate field keys across rules are counted once
  - rules with empty target_fields surface as manual_tasks, not missing_fields
  - cancelled shipments report nothing
  - manual_tasks positive path: open Task on an empty-target_fields rule
    appears with correct id/title_key/role/is_overdue; a Task on a
    field-targeted rule or in a terminal state does not appear
"""
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from apps.core.models import Season, ShipmentStatusType
from apps.export.models import Shipment, Task, TaskRule, TaskState
from apps.export.services.completeness import compute_completeness


class CompletenessTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.draft = ShipmentStatusType.objects.create(
            code='draft', name_tk='Draft', step_order=0,
        )
        cls.loading = ShipmentStatusType.objects.create(
            code='yuklenme', name_tk='Loading', step_order=3,
        )
        cls.transit = ShipmentStatusType.objects.create(
            code='yola_chykdy', name_tk='Departed', step_order=4,
        )
        cls.cancelled = ShipmentStatusType.objects.create(
            code='cancelled', name_tk='Cancelled', step_order=99,
        )
        cls.season = Season.objects.create(
            name='2025-2026', start_date='2025-09-01', end_date='2026-06-30',
            is_active=True,
        )

    def _shipment(self, status):
        return Shipment.objects.create(
            shipment_code='0101001/26', date='2026-01-01',
            status=status, season=self.season,
        )

    def test_counts_current_step_fields(self):
        TaskRule.objects.create(
            step='yuklenme', title_key='tasks.fill_loading_data',
            assignee_role='loading_dept_head', target_fields='weight_net,pallet_count',
        )
        shipment = self._shipment(self.loading)
        shipment.weight_net = 18500
        shipment.save()

        result = compute_completeness(shipment)

        self.assertEqual(result['required_total'], 2)
        self.assertEqual(result['filled_count'], 1)
        self.assertEqual([m['key'] for m in result['missing_fields']], ['pallet_count'])

    def test_includes_passed_steps_excludes_future(self):
        TaskRule.objects.create(
            step='draft', title_key='tasks.set_destination',
            assignee_role='export_manager', target_fields='country',
        )
        TaskRule.objects.create(
            step='tamamlandy', title_key='tasks.future',
            assignee_role='export_manager', target_fields='price_per_kg',
        )
        ShipmentStatusType.objects.create(
            code='tamamlandy', name_tk='Done', step_order=12,
        )
        shipment = self._shipment(self.loading)

        result = compute_completeness(shipment)

        keys = [m['key'] for m in result['missing_fields']]
        self.assertIn('country', keys)          # passed step — still owed
        self.assertNotIn('price_per_kg', keys)  # future step — not yet owed

    def test_dedupes_field_across_rules(self):
        TaskRule.objects.create(
            step='draft', title_key='tasks.a',
            assignee_role='export_manager', target_fields='country',
        )
        TaskRule.objects.create(
            step='yuklenme', title_key='tasks.b',
            assignee_role='loading_dept_head', target_fields='country',
        )
        shipment = self._shipment(self.loading)

        result = compute_completeness(shipment)

        self.assertEqual(result['required_total'], 1)
        self.assertEqual(len(result['missing_fields']), 1)

    def test_condition_gates_rule(self):
        TaskRule.objects.create(
            step='yuklenme', title_key='tasks.gapy_only',
            assignee_role='document_team', target_fields='pallet_count',
            condition_field='is_gapy_satys', condition_value='True',
        )
        shipment = self._shipment(self.loading)   # is_gapy_satys defaults False

        result = compute_completeness(shipment)

        self.assertEqual(result['required_total'], 0)

    def test_empty_target_fields_not_counted(self):
        TaskRule.objects.create(
            step='yuklenme', title_key='tasks.give_documents',
            assignee_role='transport', target_fields='',
        )
        shipment = self._shipment(self.loading)

        result = compute_completeness(shipment)

        self.assertEqual(result['required_total'], 0)
        self.assertEqual(result['missing_fields'], [])

    def test_cancelled_reports_nothing(self):
        TaskRule.objects.create(
            step='draft', title_key='tasks.set_destination',
            assignee_role='export_manager', target_fields='country',
        )
        shipment = self._shipment(self.cancelled)

        result = compute_completeness(shipment)

        self.assertEqual(result['required_total'], 0)
        self.assertEqual(result['filled_count'], 0)
        self.assertEqual(result['missing_fields'], [])
        self.assertEqual(result['manual_tasks'], [])

    def test_manual_task_appears_with_correct_fields(self):
        rule = TaskRule.objects.create(
            step='yuklenme', title_key='tasks.give_documents',
            assignee_role='transport', target_fields='',
        )
        shipment = self._shipment(self.loading)
        past_deadline = timezone.now() - timedelta(hours=2)
        task = Task.objects.create(
            shipment=shipment, step='yuklenme', rule=rule,
            title_key=rule.title_key, assignee_role=rule.assignee_role,
            target_fields='', state=TaskState.OPEN, deadline=past_deadline,
        )

        result = compute_completeness(shipment)

        self.assertEqual(len(result['manual_tasks']), 1)
        manual_task = result['manual_tasks'][0]
        self.assertEqual(manual_task['id'], task.id)
        self.assertEqual(manual_task['title_key'], 'tasks.give_documents')
        self.assertEqual(manual_task['role'], 'transport')
        self.assertTrue(manual_task['is_overdue'])

    def test_manual_task_excludes_field_targeted_rule(self):
        rule = TaskRule.objects.create(
            step='yuklenme', title_key='tasks.fill_loading_data',
            assignee_role='loading_dept_head', target_fields='weight_net',
        )
        shipment = self._shipment(self.loading)
        Task.objects.create(
            shipment=shipment, step='yuklenme', rule=rule,
            title_key=rule.title_key, assignee_role=rule.assignee_role,
            target_fields='weight_net', state=TaskState.OPEN,
        )

        result = compute_completeness(shipment)

        self.assertEqual(result['manual_tasks'], [])
        self.assertEqual(result['required_total'], 1)

    def test_manual_task_excludes_terminal_states(self):
        rule = TaskRule.objects.create(
            step='yuklenme', title_key='tasks.give_documents',
            assignee_role='transport', target_fields='',
        )
        shipment = self._shipment(self.loading)
        Task.objects.create(
            shipment=shipment, step='yuklenme', rule=rule,
            title_key=rule.title_key, assignee_role=rule.assignee_role,
            target_fields='', state=TaskState.DONE,
        )
        Task.objects.create(
            shipment=shipment, step='yuklenme', rule=rule,
            title_key=rule.title_key, assignee_role=rule.assignee_role,
            target_fields='', state=TaskState.CANCELLED,
        )

        result = compute_completeness(shipment)

        self.assertEqual(result['manual_tasks'], [])
