"""Model-level guarantees for the planning tasks (spec 2026-09-29-planning-tasks-design)."""
from datetime import date

from django.db import IntegrityError, transaction
from django.test import TestCase

from apps.export.models import Task, TaskCancelReason, TaskCompletionRule, TaskKind, TaskState
from apps.export.serializers import TaskListSerializer


def _task(**kw) -> Task:
    base = dict(
        shipment=None, rule=None, title_key='t', assignee_role='export_manager',
        completion_rule=TaskCompletionRule.MANUAL_DONE,
    )
    base.update(kw)
    base.setdefault('step', base['kind'])
    return Task.objects.create(**base)


class PlanTaskModelTests(TestCase):
    def test_new_kind_codes_fit_the_column(self):
        for kind in (TaskKind.ALLOC_REVIEW, TaskKind.TRANSPORT_PLAN,
                     TaskKind.DAILY_LOADING, TaskKind.DAILY_EXPORT):
            self.assertLessEqual(len(kind.value), Task._meta.get_field('kind').max_length)

    def test_one_daily_task_per_kind_and_day(self):
        d = date(2026, 9, 28)
        _task(kind=TaskKind.DAILY_EXPORT, scope_date=d)
        with self.assertRaises(IntegrityError), transaction.atomic():
            _task(kind=TaskKind.DAILY_EXPORT, scope_date=d)
        # The other daily kind on the same day is allowed.
        _task(kind=TaskKind.DAILY_LOADING, scope_date=d, assignee_role='loading_dept_head')

    def test_one_open_ack_task_per_week_but_done_ones_repeat(self):
        _task(kind=TaskKind.TRANSPORT_PLAN, scope_year=2026, scope_week=40,
              assignee_role='transport', state=TaskState.DONE)
        _task(kind=TaskKind.TRANSPORT_PLAN, scope_year=2026, scope_week=40, assignee_role='transport')
        with self.assertRaises(IntegrityError), transaction.atomic():
            _task(kind=TaskKind.TRANSPORT_PLAN, scope_year=2026, scope_week=40, assignee_role='transport')

    def test_list_serializer_exposes_scope_date_and_cancelled_reason(self):
        t = _task(kind=TaskKind.DAILY_EXPORT, scope_date=date(2026, 9, 28),
                  state=TaskState.CANCELLED, cancelled_reason=TaskCancelReason.MISSED)
        data = TaskListSerializer(t).data
        self.assertEqual(data['scope_date'], '2026-09-28')
        self.assertEqual(data['cancelled_reason'], 'missed')
        self.assertEqual(Task.objects.get(pk=t.pk).ack_snapshot, '')

