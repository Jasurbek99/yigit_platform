"""Tests for reconcile_open_tasks_with_rules (services/task_rules.py).

Covers:
  - Stale target_fields: task synced, task auto-closed after reconcile.
  - Stale completion_rule + target_value (start_documents_prep pattern).
  - Ad-hoc tasks (rule=None) are never touched.
  - Already-DONE / CANCELLED tasks are not candidates.
  - Dry-run mode reports diffs without writing.
  - Idempotency: second call on an already-reconciled dataset is a no-op.
  - --shipment filter on the management command accepts a cargo_code.
  - --shipment with unknown code raises CommandError.
"""
from io import StringIO

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase
from django.utils import timezone

from apps.core.models import Season, ShipmentStatusType
from apps.export.models import (
    Shipment,
    Task,
    TaskCompletionRule,
    TaskRule,
    TaskState,
)
from apps.export.services.task_rules import reconcile_open_tasks_with_rules


# ---------------------------------------------------------------------------
# Shared helpers (same minimal-fixture style as tests_task_engine.py)
# ---------------------------------------------------------------------------

def _make_season(name: str = 'rec-test') -> Season:
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
            'step_order': step_order, 'phase': 'LOADING',
        },
    )
    return status


def _make_shipment(cargo_code: str, status_code: str = 'draft') -> Shipment:
    """Create a minimal shipment without triggering auto-advance (no rules seeded)."""
    status = _make_status(status_code)
    ship, _ = Shipment.objects.get_or_create(
        cargo_code=cargo_code,
        defaults={
            'date': '2026-01-15',
            'season': _make_season(),
            'status': status,
        },
    )
    return ship


def _make_rule(**kwargs) -> TaskRule:
    defaults = {
        'step': 'draft',
        'title_key': 'tasks.reconcile_test',
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
        'title_key': 'tasks.reconcile_test',
        'assignee_role': 'transport',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'target_fields': 'driver_id',   # ← stale: should be driver_name
        'target_value': '',
        'state': TaskState.OPEN,
    }
    defaults.update(kwargs)
    return Task.objects.create(**defaults)


# ---------------------------------------------------------------------------
# 1. Core reconcile: stale target_fields → assign_driver pattern
# ---------------------------------------------------------------------------

class ReconcileTargetFieldsTests(TestCase):
    """Task with stale target_fields is synced and then auto-resolved."""

    def setUp(self) -> None:
        # Rule has current definition: target_fields='driver_name'
        self.rule = _make_rule(target_fields='driver_name')
        self.shipment = _make_shipment('REC0001')
        # Task has OLD snapshot: target_fields='driver_id'
        self.task = _make_task(
            self.shipment,
            rule=self.rule,
            target_fields='driver_id',  # stale
        )

    def test_reconcile_syncs_stale_target_fields(self) -> None:
        """Reconcile updates the task's target_fields to match the rule."""
        summary = reconcile_open_tasks_with_rules()
        self.task.refresh_from_db()
        self.assertEqual(self.task.target_fields, 'driver_name')
        self.assertEqual(summary['tasks_synced'], 1)

    def test_reconcile_reports_correct_changes(self) -> None:
        """Changes list describes the field, old value, and new value."""
        summary = reconcile_open_tasks_with_rules()
        changes = summary['changes']
        # Exactly one changed axis for this task.
        self.assertEqual(len(changes), 1)
        change = changes[0]
        self.assertEqual(change['task_id'], self.task.pk)
        self.assertEqual(change['field'], 'target_fields')
        self.assertEqual(change['old'], 'driver_id')
        self.assertEqual(change['new'], 'driver_name')
        self.assertEqual(change['shipment_code'], 'REC0001')
        self.assertEqual(change['rule_id'], self.rule.pk)

    def test_reconcile_then_resolve_closes_task_when_field_filled(self) -> None:
        """After sync, resolve_for_shipment closes the task when driver_name is set."""
        # Fill the NOW-CORRECT field (driver_name) on the shipment.
        self.shipment.driver_name = 'Ahmed Driver'
        self.shipment.save()
        # Tasks auto-resolve on Shipment.save() — but the task was stale pre-reconcile.
        # Clear it back to OPEN to simulate the scenario where stale target stopped resolution.
        self.task.state = TaskState.OPEN
        self.task.target_fields = 'driver_id'  # reset stale snapshot
        self.task.save(update_fields=['state', 'target_fields'])

        # Now reconcile — syncs target_fields to driver_name.
        summary = reconcile_open_tasks_with_rules()

        # The task should now be DONE (driver_name is already set → resolved).
        self.task.refresh_from_db()
        self.assertEqual(self.task.state, TaskState.DONE)
        self.assertEqual(summary['tasks_synced'], 1)
        self.assertEqual(summary['tasks_resolved'], 1)
        self.assertEqual(summary['shipments_reresolved'], 1)


# ---------------------------------------------------------------------------
# 2. Multi-axis diff: start_documents_prep pattern
# ---------------------------------------------------------------------------

class ReconcileMultiAxisTests(TestCase):
    """Task with three stale axes (target_fields, completion_rule, target_value)."""

    def setUp(self) -> None:
        # Current rule: FIELD_EQUALS documents_status == 'in_progress'
        self.rule = _make_rule(
            title_key='tasks.start_documents_prep',
            assignee_role='document_team',
            target_fields='documents_status',
            completion_rule=TaskCompletionRule.FIELD_EQUALS,
            target_value='in_progress',
        )
        self.shipment = _make_shipment('REC0002')
        # Task has OLD snapshot: ALL_FIELDS_FILLED on two fields, no target_value
        self.task = _make_task(
            self.shipment,
            rule=self.rule,
            title_key='tasks.start_documents_prep',
            assignee_role='document_team',
            target_fields='documents_status,customs_clearance_planned_day',
            completion_rule=TaskCompletionRule.ALL_FIELDS_FILLED,
            target_value='',
        )

    def test_reconcile_updates_all_three_stale_axes(self) -> None:
        summary = reconcile_open_tasks_with_rules()
        self.task.refresh_from_db()
        self.assertEqual(self.task.target_fields, 'documents_status')
        self.assertEqual(self.task.completion_rule, TaskCompletionRule.FIELD_EQUALS)
        self.assertEqual(self.task.target_value, 'in_progress')
        self.assertEqual(summary['tasks_synced'], 1)
        # Three axes changed → three entries in changes.
        self.assertEqual(len(summary['changes']), 3)

    def test_reconcile_returns_correct_change_fields(self) -> None:
        summary = reconcile_open_tasks_with_rules()
        changed_fields = {ch['field'] for ch in summary['changes']}
        self.assertIn('target_fields', changed_fields)
        self.assertIn('completion_rule', changed_fields)
        self.assertIn('target_value', changed_fields)


# ---------------------------------------------------------------------------
# 3. Ad-hoc tasks (rule=None) are never touched
# ---------------------------------------------------------------------------

class ReconcileAdHocTaskTests(TestCase):
    """Tasks with rule=None must not be touched by the reconciler."""

    def test_ad_hoc_task_not_synced(self) -> None:
        shipment = _make_shipment('REC0003')
        adhoc_task = _make_task(
            shipment,
            rule=None,
            target_fields='driver_id',  # stale-looking value but no rule
        )
        summary = reconcile_open_tasks_with_rules()
        self.assertEqual(summary['tasks_synced'], 0)
        self.assertEqual(summary['changes'], [])
        adhoc_task.refresh_from_db()
        # Untouched.
        self.assertEqual(adhoc_task.target_fields, 'driver_id')


# ---------------------------------------------------------------------------
# 4. Terminal tasks are excluded
# ---------------------------------------------------------------------------

class ReconcileTerminalStateTests(TestCase):
    """DONE and CANCELLED tasks are not candidates for reconciliation."""

    def setUp(self) -> None:
        self.rule = _make_rule(target_fields='driver_name')
        self.shipment = _make_shipment('REC0004')

    def test_done_task_not_touched(self) -> None:
        task = _make_task(
            self.shipment,
            rule=self.rule,
            target_fields='driver_id',  # would be stale if open
            state=TaskState.DONE,
            completed_at=timezone.now(),
        )
        summary = reconcile_open_tasks_with_rules()
        self.assertEqual(summary['tasks_synced'], 0)
        task.refresh_from_db()
        self.assertEqual(task.target_fields, 'driver_id')  # unchanged

    def test_cancelled_task_not_touched(self) -> None:
        task = _make_task(
            self.shipment,
            rule=self.rule,
            target_fields='driver_id',
            state=TaskState.CANCELLED,
        )
        summary = reconcile_open_tasks_with_rules()
        self.assertEqual(summary['tasks_synced'], 0)
        task.refresh_from_db()
        self.assertEqual(task.target_fields, 'driver_id')  # unchanged


# ---------------------------------------------------------------------------
# 5. Dry-run mode
# ---------------------------------------------------------------------------

class ReconcileDryRunTests(TestCase):
    """Dry-run reports diffs without writing to the database."""

    def setUp(self) -> None:
        self.rule = _make_rule(target_fields='driver_name')
        self.shipment = _make_shipment('REC0005')
        self.task = _make_task(
            self.shipment,
            rule=self.rule,
            target_fields='driver_id',
        )

    def test_dry_run_does_not_write_task(self) -> None:
        summary = reconcile_open_tasks_with_rules(dry_run=True)
        self.task.refresh_from_db()
        # The task still has the stale value — nothing was written.
        self.assertEqual(self.task.target_fields, 'driver_id')
        self.assertEqual(summary['tasks_synced'], 0)

    def test_dry_run_still_reports_changes(self) -> None:
        summary = reconcile_open_tasks_with_rules(dry_run=True)
        self.assertEqual(len(summary['changes']), 1)
        self.assertEqual(summary['changes'][0]['field'], 'target_fields')
        self.assertEqual(summary['changes'][0]['old'], 'driver_id')
        self.assertEqual(summary['changes'][0]['new'], 'driver_name')

    def test_dry_run_reresolved_count_is_zero(self) -> None:
        summary = reconcile_open_tasks_with_rules(dry_run=True)
        self.assertEqual(summary['tasks_resolved'], 0)


# ---------------------------------------------------------------------------
# 6. Idempotency
# ---------------------------------------------------------------------------

class ReconcileIdempotencyTests(TestCase):
    """Second call on an already-reconciled dataset is a no-op."""

    def test_idempotent(self) -> None:
        rule = _make_rule(target_fields='driver_name')
        shipment = _make_shipment('REC0006')
        _make_task(shipment, rule=rule, target_fields='driver_id')

        first = reconcile_open_tasks_with_rules()
        self.assertEqual(first['tasks_synced'], 1)

        second = reconcile_open_tasks_with_rules()
        self.assertEqual(second['tasks_synced'], 0)
        self.assertEqual(second['changes'], [])


# ---------------------------------------------------------------------------
# 7. Shipment-scoped reconcile
# ---------------------------------------------------------------------------

class ReconcileScopedTests(TestCase):
    """shipments= argument scopes reconciliation to a specific set."""

    def test_only_scoped_shipment_is_synced(self) -> None:
        rule = _make_rule(target_fields='driver_name')
        ship_a = _make_shipment('REC0007A')
        ship_b = _make_shipment('REC0007B')
        task_a = _make_task(ship_a, rule=rule, target_fields='driver_id')
        task_b = _make_task(ship_b, rule=rule, target_fields='driver_id')

        # Scope to ship_a only.
        summary = reconcile_open_tasks_with_rules(shipments=[ship_a])
        task_a.refresh_from_db()
        task_b.refresh_from_db()

        self.assertEqual(task_a.target_fields, 'driver_name')  # synced
        self.assertEqual(task_b.target_fields, 'driver_id')    # untouched
        self.assertEqual(summary['tasks_synced'], 1)


# ---------------------------------------------------------------------------
# 8. Management command: --shipment flag and unknown-code error
# ---------------------------------------------------------------------------

class ReconcileCommandTests(TestCase):
    """Management command integration tests."""

    def setUp(self) -> None:
        self.rule = _make_rule(target_fields='driver_name')
        self.shipment = _make_shipment('REC0008')
        self.task = _make_task(
            self.shipment,
            rule=self.rule,
            target_fields='driver_id',
        )

    def test_command_dry_run_flag(self) -> None:
        out = StringIO()
        call_command('reconcile_tasks', '--dry-run', stdout=out)
        output = out.getvalue()
        self.assertIn('DRY RUN', output)
        # Task must not have been modified.
        self.task.refresh_from_db()
        self.assertEqual(self.task.target_fields, 'driver_id')

    def test_command_dry_run_shows_diff(self) -> None:
        out = StringIO()
        call_command('reconcile_tasks', '--dry-run', stdout=out)
        output = out.getvalue()
        self.assertIn('driver_id', output)
        self.assertIn('driver_name', output)

    def test_command_shipment_flag_scopes_correctly(self) -> None:
        # A second shipment with a stale task — should NOT be touched.
        ship_b = _make_shipment('REC0008B')
        task_b = _make_task(ship_b, rule=self.rule, target_fields='driver_id')

        out = StringIO()
        call_command('reconcile_tasks', '--shipment', 'REC0008', stdout=out)
        self.task.refresh_from_db()
        task_b.refresh_from_db()
        self.assertEqual(self.task.target_fields, 'driver_name')  # synced
        self.assertEqual(task_b.target_fields, 'driver_id')       # untouched

    def test_command_unknown_cargo_code_raises(self) -> None:
        with self.assertRaises(CommandError):
            call_command('reconcile_tasks', '--shipment', 'DOESNOTEXIST/99', stdout=StringIO())

    def test_command_no_stale_tasks_reports_clean(self) -> None:
        # Sync the task first so there is nothing stale left.
        reconcile_open_tasks_with_rules()
        out = StringIO()
        call_command('reconcile_tasks', stdout=out)
        output = out.getvalue()
        self.assertIn('No stale tasks found', output)
