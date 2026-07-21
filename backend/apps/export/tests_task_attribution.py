"""Tests for Task.completed_by attribution across every completion site."""
from django.test import TestCase

from apps.core.models import User
from apps.export.models import Task, TaskState, TaskCompletionRule


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
