"""Tests for Task and TaskRule model-layer behaviour (B1 sub-PR).

Scope: default values, property methods, M2M, __str__, index queries.
Out of scope: rule engine, auto-resolution, API endpoints (those are B-engine / B-api).
"""
import datetime

from django.test import TestCase
from django.utils import timezone

from apps.core.models import Season, ShipmentStatusType
from apps.export.models import Shipment, Task, TaskRule, TaskState, TaskCompletionRule


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_season(name: str = 'B1-test') -> Season:
    season, _ = Season.objects.get_or_create(
        name=name,
        defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': False},
    )
    return season


def _make_status(code: str = 'yuklenme') -> ShipmentStatusType:
    status, _ = ShipmentStatusType.objects.get_or_create(
        code=code,
        defaults={'name_tk': code, 'name_en': 'Loading', 'step_order': 1, 'phase': 'LOADING'},
    )
    return status


def _make_shipment(cargo_code: str = 'B1TEST001') -> Shipment:
    return Shipment.objects.get_or_create(
        cargo_code=cargo_code,
        defaults={
            'date': '2026-01-15',
            'season': _make_season(),
            'status': _make_status(),
        },
    )[0]


def _make_task_rule(**kwargs) -> TaskRule:
    defaults = {
        'step': 'yuklenme',
        'title_key': 'tasks.fill_loading_data',
        'assignee_role': 'warehouse_chief',
    }
    defaults.update(kwargs)
    return TaskRule.objects.create(**defaults)


def _make_task(shipment: Shipment | None = None, **kwargs) -> Task:
    if shipment is None:
        shipment = _make_shipment()
    defaults = {
        'shipment': shipment,
        'step': 'yuklenme',
        'title_key': 'tasks.fill_loading_data',
        'assignee_role': 'warehouse_chief',
    }
    defaults.update(kwargs)
    return Task.objects.create(**defaults)


# ---------------------------------------------------------------------------
# TaskRule default values
# ---------------------------------------------------------------------------

class TaskRuleDefaultsTests(TestCase):
    """TaskRule fields have the correct defaults on creation."""

    def test_is_active_defaults_true(self) -> None:
        rule = _make_task_rule()
        self.assertTrue(rule.is_active)

    def test_target_fields_defaults_empty_string(self) -> None:
        rule = _make_task_rule()
        self.assertEqual(rule.target_fields, '')

    def test_completion_rule_defaults_all_fields_filled(self) -> None:
        rule = _make_task_rule()
        self.assertEqual(rule.completion_rule, TaskCompletionRule.ALL_FIELDS_FILLED)

    def test_condition_field_and_value_default_empty(self) -> None:
        rule = _make_task_rule()
        self.assertEqual(rule.condition_field, '')
        self.assertEqual(rule.condition_value, '')

    def test_deadline_rule_defaults_empty(self) -> None:
        rule = _make_task_rule()
        self.assertEqual(rule.deadline_rule, '')


# ---------------------------------------------------------------------------
# TaskRule __str__
# ---------------------------------------------------------------------------

class TaskRuleStrTests(TestCase):
    """TaskRule.__str__ returns the expected representation."""

    def test_str_format(self) -> None:
        rule = _make_task_rule(
            step='yuklenme',
            title_key='tasks.fill_loading_data',
            assignee_role='warehouse_chief',
        )
        result = str(rule)
        self.assertIn('yuklenme', result)
        self.assertIn('tasks.fill_loading_data', result)
        self.assertIn('warehouse_chief', result)


# ---------------------------------------------------------------------------
# Task default values
# ---------------------------------------------------------------------------

class TaskDefaultsTests(TestCase):
    """Task fields have the correct defaults on creation."""

    def test_state_defaults_open(self) -> None:
        task = _make_task()
        self.assertEqual(task.state, TaskState.OPEN)

    def test_target_fields_defaults_empty_string(self) -> None:
        task = _make_task()
        self.assertEqual(task.target_fields, '')

    def test_completion_rule_defaults_all_fields_filled(self) -> None:
        task = _make_task()
        self.assertEqual(task.completion_rule, TaskCompletionRule.ALL_FIELDS_FILLED)

    def test_deadline_and_started_at_default_null(self) -> None:
        task = _make_task()
        self.assertIsNone(task.deadline)
        self.assertIsNone(task.started_at)
        self.assertIsNone(task.completed_at)

    def test_rule_can_be_null(self) -> None:
        task = _make_task()
        self.assertIsNone(task.rule)

    def test_assignee_user_defaults_null(self) -> None:
        task = _make_task()
        self.assertIsNone(task.assignee_user)


# ---------------------------------------------------------------------------
# Task.__str__
# ---------------------------------------------------------------------------

class TaskStrTests(TestCase):
    """Task.__str__ returns a sensible representation."""

    def test_str_contains_pk_title_key_and_state(self) -> None:
        task = _make_task(title_key='tasks.fill_loading_data')
        result = str(task)
        self.assertIn(str(task.pk), result)
        self.assertIn('tasks.fill_loading_data', result)
        self.assertIn('open', result)


# ---------------------------------------------------------------------------
# target_field_list property
# ---------------------------------------------------------------------------

class TargetFieldListTests(TestCase):
    """Task.target_field_list parses the CSV correctly."""

    def test_empty_string_returns_empty_list(self) -> None:
        task = _make_task(target_fields='')
        self.assertEqual(task.target_field_list, [])

    def test_simple_csv_splits_correctly(self) -> None:
        task = _make_task(target_fields='a,b,c')
        self.assertEqual(task.target_field_list, ['a', 'b', 'c'])

    def test_whitespace_is_trimmed(self) -> None:
        task = _make_task(target_fields=' a , b ,c ')
        self.assertEqual(task.target_field_list, ['a', 'b', 'c'])

    def test_empty_segments_are_skipped(self) -> None:
        task = _make_task(target_fields='a,,b')
        self.assertEqual(task.target_field_list, ['a', 'b'])

    def test_single_field_returns_one_item_list(self) -> None:
        task = _make_task(target_fields='weight_net_kg')
        self.assertEqual(task.target_field_list, ['weight_net_kg'])


# ---------------------------------------------------------------------------
# is_overdue property
# ---------------------------------------------------------------------------

class IsOverdueTests(TestCase):
    """Task.is_overdue returns the correct value for all cases."""

    def test_no_deadline_is_not_overdue(self) -> None:
        task = _make_task()
        self.assertFalse(task.is_overdue)

    def test_future_deadline_is_not_overdue(self) -> None:
        future = timezone.now() + datetime.timedelta(hours=1)
        task = _make_task(deadline=future)
        self.assertFalse(task.is_overdue)

    def test_past_deadline_and_open_state_is_overdue(self) -> None:
        past = timezone.now() - datetime.timedelta(hours=1)
        task = _make_task(deadline=past, state=TaskState.OPEN)
        self.assertTrue(task.is_overdue)

    def test_past_deadline_but_done_state_is_not_overdue(self) -> None:
        past = timezone.now() - datetime.timedelta(hours=1)
        task = _make_task(deadline=past, state=TaskState.DONE)
        self.assertFalse(task.is_overdue)

    def test_past_deadline_but_cancelled_state_is_not_overdue(self) -> None:
        past = timezone.now() - datetime.timedelta(hours=1)
        task = _make_task(deadline=past, state=TaskState.CANCELLED)
        self.assertFalse(task.is_overdue)

    def test_past_deadline_in_progress_is_overdue(self) -> None:
        past = timezone.now() - datetime.timedelta(hours=1)
        task = _make_task(deadline=past, state=TaskState.IN_PROGRESS)
        self.assertTrue(task.is_overdue)


# ---------------------------------------------------------------------------
# duration_seconds property
# ---------------------------------------------------------------------------

class DurationSecondsTests(TestCase):
    """Task.duration_seconds returns None or correct elapsed seconds."""

    def test_no_started_at_returns_none(self) -> None:
        task = _make_task()
        self.assertIsNone(task.duration_seconds)

    def test_started_and_completed_returns_correct_seconds(self) -> None:
        base = timezone.now() - datetime.timedelta(seconds=120)
        end = base + datetime.timedelta(seconds=90)
        task = _make_task(started_at=base, completed_at=end)
        # duration_seconds uses completed_at when set
        self.assertEqual(task.duration_seconds, 90)

    def test_started_but_not_completed_uses_now(self) -> None:
        # Started 10 seconds ago, not completed — duration should be ~10s
        started = timezone.now() - datetime.timedelta(seconds=10)
        task = _make_task(started_at=started)
        result = task.duration_seconds
        self.assertIsNotNone(result)
        self.assertGreaterEqual(result, 9)   # allow 1s slack
        self.assertLessEqual(result, 20)     # generous upper bound


# ---------------------------------------------------------------------------
# Index queries (queryable without DB errors)
# ---------------------------------------------------------------------------

class TaskIndexQueriesTests(TestCase):
    """Composite indexes are usable via ORM filter calls."""

    def setUp(self) -> None:
        self.shipment = _make_shipment('B1IDX001')
        _make_task(shipment=self.shipment, state=TaskState.OPEN)

    def test_filter_by_shipment_and_state(self) -> None:
        qs = Task.objects.filter(shipment=self.shipment, state=TaskState.OPEN)
        self.assertEqual(qs.count(), 1)

    def test_filter_by_assignee_role_and_state(self) -> None:
        qs = Task.objects.filter(assignee_role='warehouse_chief', state=TaskState.OPEN)
        self.assertGreaterEqual(qs.count(), 1)

    def test_filter_by_state_and_deadline(self) -> None:
        # Deadline is null for our test task — filter should still execute
        qs = Task.objects.filter(state=TaskState.OPEN, deadline__isnull=True)
        self.assertGreaterEqual(qs.count(), 1)


# ---------------------------------------------------------------------------
# M2M blocked_by
# ---------------------------------------------------------------------------

class TaskBlockedByTests(TestCase):
    """Task.blocked_by M2M can add blocking tasks correctly."""

    def test_add_blocking_task(self) -> None:
        shipment = _make_shipment('B1BLK001')
        blocker = _make_task(shipment=shipment, title_key='tasks.blocker')
        blocked = _make_task(shipment=shipment, title_key='tasks.blocked')

        blocked.blocked_by.add(blocker)

        self.assertIn(blocker, blocked.blocked_by.all())

    def test_reverse_relation_blocking(self) -> None:
        shipment = _make_shipment('B1BLK002')
        blocker = _make_task(shipment=shipment, title_key='tasks.blocker2')
        blocked = _make_task(shipment=shipment, title_key='tasks.blocked2')

        blocked.blocked_by.add(blocker)

        # blocker.blocking (reverse) should contain blocked
        self.assertIn(blocked, blocker.blocking.all())

    def test_blocked_by_is_non_symmetrical(self) -> None:
        """Adding A to B.blocked_by does NOT add B to A.blocked_by."""
        shipment = _make_shipment('B1BLK003')
        task_a = _make_task(shipment=shipment, title_key='tasks.a')
        task_b = _make_task(shipment=shipment, title_key='tasks.b')

        task_b.blocked_by.add(task_a)

        self.assertNotIn(task_b, task_a.blocked_by.all())
