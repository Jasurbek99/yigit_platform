"""Tests for Task.cancelled_reason and the two existing cancel paths.

Covers:
  - The enum values and the column default.
  - _cancel_open_tasks writes 'shipment_cancelled'.
  - TaskViewSet.cancel writes 'manual'.
  - A cancelled shipment's tasks are never resurrected (Review Focus 4).
  - A manually cancelled task is never resurrected either.
"""
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import Season, ShipmentStatusType, User
from apps.export.models import (
    Shipment,
    Task,
    TaskCancelReason,
    TaskCompletionRule,
    TaskRule,
    TaskState,
)


def _make_user(username: str, role: str, is_superuser: bool = False) -> User:
    user = User(username=username, role=role, is_superuser=is_superuser)
    user.set_password('pass')
    user.save()
    return user


def _make_season(name: str = 'cr-test') -> Season:   # Season.name is max_length=10
    season, _ = Season.objects.get_or_create(
        name=name,
        defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': False},
    )
    return season


def _make_status(code: str = 'draft', step_order: int = 0) -> ShipmentStatusType:
    status, _ = ShipmentStatusType.objects.get_or_create(
        code=code,
        defaults={
            'name_tk': code, 'name_en': code, 'name_ru': code,
            'step_order': step_order, 'phase': 'DRAFT',
        },
    )
    return status


def _make_shipment(shipment_code: str, status_code: str = 'draft') -> Shipment:
    ship, _ = Shipment.objects.get_or_create(
        shipment_code=shipment_code,
        defaults={
            'date': '2026-01-15',
            'season': _make_season(),
            'status': _make_status(status_code),
        },
    )
    return ship


def _make_rule(**kwargs) -> TaskRule:
    defaults = {
        'step': 'draft',
        'title_key': 'tasks.cancel_reason_test',
        'assignee_role': 'transport',
        'target_fields': 'driver_name',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'target_value': '',
        'deadline_rule': '',
        'condition_field': '',
        'condition_value': '',
        'is_active': True,
    }
    defaults.update(kwargs)
    return TaskRule.objects.create(**defaults)


def _make_task(shipment: Shipment, rule: TaskRule | None = None, **kwargs) -> Task:
    defaults = {
        'shipment': shipment,
        'step': 'draft',
        'rule': rule,
        'title_key': 'tasks.cancel_reason_test',
        'assignee_role': 'transport',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'target_fields': 'driver_name',
        'target_value': '',
        'state': TaskState.OPEN,
    }
    defaults.update(kwargs)
    return Task.objects.create(**defaults)


class CancelReasonColumnTests(TestCase):
    def test_default_is_blank(self):
        ship = _make_shipment('0101001/26')
        task = _make_task(ship, _make_rule())
        self.assertEqual(task.cancelled_reason, '')

    def test_enum_values(self):
        self.assertEqual(TaskCancelReason.MANUAL, 'manual')
        self.assertEqual(TaskCancelReason.SHIPMENT_CANCELLED, 'shipment_cancelled')
        self.assertEqual(TaskCancelReason.RULE_MISMATCH, 'rule_mismatch')
        self.assertEqual(TaskCancelReason.RULE_DEACTIVATED, 'rule_deactivated')


class ExistingCancelPathsTests(TestCase):
    def test_cancel_open_tasks_writes_shipment_cancelled(self):
        from apps.export.services.shipment import _cancel_open_tasks

        ship = _make_shipment('0101002/26')
        rule = _make_rule(title_key='tasks.a')
        open_task = _make_task(ship, rule, state=TaskState.OPEN)
        blocked_task = _make_task(
            ship, _make_rule(title_key='tasks.b'), state=TaskState.BLOCKED,
        )
        done_task = _make_task(
            ship, _make_rule(title_key='tasks.c'),
            state=TaskState.DONE, completed_at=timezone.now(),
        )

        updated = _cancel_open_tasks(ship)

        self.assertEqual(updated, 2)
        for task in (open_task, blocked_task):
            task.refresh_from_db()
            self.assertEqual(task.state, TaskState.CANCELLED)
            self.assertEqual(task.cancelled_reason, TaskCancelReason.SHIPMENT_CANCELLED)
        done_task.refresh_from_db()
        self.assertEqual(done_task.state, TaskState.DONE)
        self.assertEqual(done_task.cancelled_reason, '')

    def test_task_cancel_endpoint_writes_manual(self):
        admin = _make_user('cr-admin', 'admin', is_superuser=True)
        ship = _make_shipment('0101003/26')
        task = _make_task(ship, _make_rule(title_key='tasks.d'))

        client = APIClient()
        client.force_authenticate(user=admin)
        response = client.post(f'/api/v1/export/tasks/{task.id}/cancel/')

        self.assertEqual(response.status_code, 200)
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.CANCELLED)
        self.assertEqual(task.cancelled_reason, TaskCancelReason.MANUAL)


class CancelledShipmentStaysCancelledTests(TestCase):
    """Review Focus 4: a shipment cancelled wholesale must not come back to life.

    _cancel_open_tasks stamps shipment_cancelled, which is outside the
    rule_mismatch reopen filter by construction. These tests are the guard on
    that construction, so a later widening of the filter fails loudly here.
    """

    def test_shipment_cancelled_tasks_are_not_reopened_by_reconcile(self):
        from apps.export.services.shipment import _cancel_open_tasks
        from apps.export.services.task_rules import reconcile_shipment_tasks

        ship = _make_shipment('0101004/26')
        rule = _make_rule(title_key='tasks.e')      # unconditional: always matches
        task = _make_task(ship, rule, state=TaskState.OPEN)

        _cancel_open_tasks(ship)
        task.refresh_from_db()
        self.assertEqual(task.cancelled_reason, TaskCancelReason.SHIPMENT_CANCELLED)

        reconcile_shipment_tasks(ship)

        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.CANCELLED)
        self.assertEqual(task.cancelled_reason, TaskCancelReason.SHIPMENT_CANCELLED)
        self.assertEqual(Task.objects.filter(shipment=ship, rule=rule).count(), 1)

    def test_manually_cancelled_task_is_not_reopened_by_reconcile(self):
        """The spec's other reopen-filter guarantee: a human's cancel is final.

        Separate from the shipment_cancelled case above, because it goes
        through a different writer (TaskViewSet.cancel) and a different
        reason value.
        """
        from apps.export.services.task_rules import reconcile_shipment_tasks

        admin = _make_user('cr-admin-reopen', 'admin', is_superuser=True)
        ship = _make_shipment('0101005/26')
        rule = _make_rule(title_key='tasks.f')   # unconditional: always matches
        task = _make_task(ship, rule, state=TaskState.OPEN)

        client = APIClient()
        client.force_authenticate(user=admin)
        response = client.post(f'/api/v1/export/tasks/{task.id}/cancel/')
        self.assertEqual(response.status_code, 200)
        task.refresh_from_db()
        self.assertEqual(task.cancelled_reason, TaskCancelReason.MANUAL)

        reconcile_shipment_tasks(ship)

        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.CANCELLED)
        self.assertEqual(task.cancelled_reason, TaskCancelReason.MANUAL)


class ManualCancelUpgradesTheReasonTests(TestCase):
    """Found in review: TaskViewSet.cancel's idempotent early return fires
    BEFORE cancelled_reason is written.

    So an admin cancelling a task the reconciler had already cancelled as
    rule_mismatch gets 200 OK and changes nothing - and the next condition flip
    reopens it, silently reverting their decision. The spec promises the
    opposite: "manual and shipment_cancelled therefore never get resurrected,
    which is the point of the column."
    """

    def test_cancelling_a_rule_mismatch_task_upgrades_it_to_manual(self):
        from apps.export.models import TaskCancelReason as R

        admin = _make_user('cr-upgrade-admin', 'admin', is_superuser=True)
        ship = _make_shipment('0101010/26')
        rule = _make_rule(title_key='tasks.g')
        task = _make_task(
            ship, rule,
            state=TaskState.CANCELLED, cancelled_reason=R.RULE_MISMATCH,
        )

        client = APIClient()
        client.force_authenticate(user=admin)
        response = client.post(f'/api/v1/export/tasks/{task.id}/cancel/')

        self.assertEqual(response.status_code, 200)
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.CANCELLED)
        self.assertEqual(
            task.cancelled_reason, R.MANUAL,
            'a human cancel must claim the row, or the reconciler will reopen it',
        )

    def test_cancelling_a_legacy_blank_reason_task_upgrades_it_to_manual(self):
        """Rows cancelled before the migration have reason ''. A human cancel
        must claim those too, not leave them ambiguous."""
        from apps.export.models import TaskCancelReason as R

        admin = _make_user('cr-upgrade-admin2', 'admin', is_superuser=True)
        ship = _make_shipment('0101011/26')
        task = _make_task(
            ship, _make_rule(title_key='tasks.h'),
            state=TaskState.CANCELLED, cancelled_reason='',
        )

        client = APIClient()
        client.force_authenticate(user=admin)
        client.post(f'/api/v1/export/tasks/{task.id}/cancel/')

        task.refresh_from_db()
        self.assertEqual(task.cancelled_reason, R.MANUAL)

    def test_cancelling_a_shipment_cancelled_task_leaves_its_reason_alone(self):
        """shipment_cancelled is already un-reopenable and is the truer record
        of why the task died. A human cancel must not overwrite it."""
        from apps.export.models import TaskCancelReason as R

        admin = _make_user('cr-upgrade-admin3', 'admin', is_superuser=True)
        ship = _make_shipment('0101012/26')
        task = _make_task(
            ship, _make_rule(title_key='tasks.i'),
            state=TaskState.CANCELLED, cancelled_reason=R.SHIPMENT_CANCELLED,
        )

        client = APIClient()
        client.force_authenticate(user=admin)
        client.post(f'/api/v1/export/tasks/{task.id}/cancel/')

        task.refresh_from_db()
        self.assertEqual(task.cancelled_reason, R.SHIPMENT_CANCELLED)
