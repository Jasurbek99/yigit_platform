"""Tests for Task.completed_by attribution across every completion site."""
import datetime
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

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


class ManualCompleteAttributionTest(TestCase):
    def test_manual_complete_credits_request_user(self):
        user = User.objects.create(username='clicker', role='export_manager')
        user.set_password('x'); user.save()
        task = Task.objects.create(
            title_key='t.manual', assignee_role='export_manager',
            completion_rule=TaskCompletionRule.MANUAL_DONE, state=TaskState.OPEN,
        )
        client = APIClient()
        client.force_authenticate(user=user)
        resp = client.post(f'/api/v1/export/tasks/{task.id}/complete/')
        self.assertEqual(resp.status_code, 200)
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.DONE)
        self.assertEqual(task.completed_by_id, user.id)


class WeeklyPlanResolverAttributionTest(TestCase):
    """_resolve_task in weekly_plan_tasks.py must credit task.assignee_user."""

    def test_resolve_task_credits_assignee_user(self):
        from apps.core.models import GreenhouseBlock, Season
        from apps.export.models import TaskKind
        from apps.export.services.weekly_plan_tasks import _resolve_task
        from apps.greenhouse.models import (
            BlockManagerAssignment, HarvestDayEntry, WeeklyHarvestPlan,
        )

        year, week = 2026, 30
        monday = datetime.date.fromisocalendar(year, week, 1)
        season, _ = Season.objects.get_or_create(
            name='wpt-attr',
            defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True},
        )
        block, _ = GreenhouseBlock.objects.get_or_create(
            code='WPT-ATTR', defaults={'name': 'Attr Block', 'is_active': True},
        )
        mgr = User.objects.create(username='wpt_attr_mgr', role='greenhouse_manager')
        BlockManagerAssignment.objects.create(user=mgr, block=block)
        plan, _ = WeeklyHarvestPlan.objects.get_or_create(
            season=season, block=block, week_number=week, year=year,
        )
        for day in range(6):  # Mon..Sat filled — Sunday is not measured
            d = monday + datetime.timedelta(days=day)
            HarvestDayEntry.objects.create(
                weekly_plan=plan, season=season, block=block,
                entry_date=d, weekday=d.weekday(), plan_value=Decimal('100'),
            )
        task = Task.objects.create(
            kind=TaskKind.WEEKLY_PLAN, title_key='tasks.fill_weekly_plan',
            assignee_role='greenhouse_manager', assignee_user=mgr,
            scope_block=block, scope_year=year, scope_week=week,
            completion_rule=TaskCompletionRule.MANUAL_DONE, state=TaskState.OPEN,
        )

        resolved = _resolve_task(task)

        self.assertTrue(resolved)
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.DONE)
        self.assertEqual(task.completed_by_id, task.assignee_user_id)
        self.assertEqual(task.completed_by_id, mgr.id)
