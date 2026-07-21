"""Tests for Task.completed_by attribution across every completion site."""
from django.test import TestCase

from apps.core.models import User
from apps.export.models import Task, TaskState, TaskCompletionRule
from apps.export.services.task_rules import resolve_for_shipment, close_sales_report_task


class TaskCompletedByFieldTest(TestCase):
    def test_completed_by_defaults_null_and_accepts_user(self):
        user = User.objects.create(username='editor1', role='loading_dept_head')
        task = Task.objects.create(
            title_key='t.x', assignee_role='loading_dept_head',
            completion_rule=TaskCompletionRule.MANUAL_DONE, state=TaskState.OPEN,
        )
        self.assertIsNone(task.completed_by)

        task.completed_by = user
        task.save(update_fields=['completed_by'])
        task.refresh_from_db()
        self.assertEqual(task.completed_by_id, user.id)
        # reverse accessor name
        self.assertIn(task, user.completed_tasks.all())


class AutoCompleteAttributionTest(TestCase):
    def _make_shipment_with_open_task(self, editor):
        """Create a shipment + one ANY_FIELD_FILLED task on an editable field.
        Mirror the FK setup used in tests_sales_report_task.py."""
        from apps.export.tests_task_attribution_helpers import make_basic_shipment
        shipment = make_basic_shipment(created_by=editor)
        task = Task.objects.create(
            shipment=shipment, title_key='t.fill_weight',
            assignee_role='loading_dept_head',
            target_fields='weight_net',
            completion_rule=TaskCompletionRule.ANY_FIELD_FILLED,
            state=TaskState.OPEN,
        )
        return shipment, task

    def test_resolve_credits_shipment_updated_by(self):
        editor = User.objects.create(username='ed_resolve', role='loading_dept_head')
        shipment, task = self._make_shipment_with_open_task(editor)
        shipment.weight_net = 18500
        shipment.updated_by = editor           # set by the view before save()
        resolve_for_shipment(shipment)
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.DONE)
        self.assertEqual(task.completed_by_id, editor.id)

    def test_resolve_no_user_credits_nobody(self):
        editor = User.objects.create(username='ed_none', role='loading_dept_head')
        shipment, task = self._make_shipment_with_open_task(editor)
        shipment.weight_net = 18500
        shipment.updated_by = None             # no actor in scope
        resolve_for_shipment(shipment)
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.DONE)
        self.assertIsNone(task.completed_by_id)

    def test_close_sales_report_credits_user(self):
        user = User.objects.create(username='sr_user', role='export_manager')
        shipment, _ = self._make_shipment_with_open_task(user)
        reminder = Task.objects.create(
            shipment=shipment, title_key='tasks.submit_sales_report',
            assignee_role='export_manager',
            completion_rule=TaskCompletionRule.MANUAL_DONE, state=TaskState.OPEN,
        )
        close_sales_report_task(shipment, user)
        reminder.refresh_from_db()
        self.assertEqual(reminder.state, TaskState.DONE)
        self.assertEqual(reminder.completed_by_id, user.id)
