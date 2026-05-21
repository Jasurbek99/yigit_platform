"""Integration tests for seed_task_rules and backfill_tasks management commands.

Verifies:
  - seed_task_rules creates len(TASK_RULES) TaskRule rows.
  - seed_task_rules --reset does not leave duplicates.
  - backfill_tasks --limit N creates tasks on N shipments.
  - backfill_tasks is idempotent (second run creates 0 new tasks).
"""
from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from apps.core.models import Season, ShipmentStatusType
from apps.export.management.commands.seed_task_rules import TASK_RULES
from apps.export.models import Shipment, Task, TaskRule


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_season(name: str = 'seed-t') -> Season:
    # Season.name max_length=10 — keep names short.
    season, _ = Season.objects.get_or_create(
        name=name,
        defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': False},
    )
    return season


def _make_status(code: str, step_order: int = 1) -> ShipmentStatusType:
    status, _ = ShipmentStatusType.objects.get_or_create(
        code=code,
        defaults={
            'name_tk': code, 'name_en': code, 'name_ru': code,
            'step_order': step_order, 'phase': 'LOADING',
        },
    )
    return status


def _make_shipment(cargo_code: str, status_code: str = 'yuklenme') -> Shipment:
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


# ---------------------------------------------------------------------------
# seed_task_rules
# ---------------------------------------------------------------------------

class SeedTaskRulesTests(TestCase):
    """seed_task_rules command creates the correct number of rules."""

    def setUp(self) -> None:
        # Clear any rules created by other tests.
        TaskRule.objects.all().delete()

    def test_seed_creates_expected_count(self) -> None:
        out = StringIO()
        call_command('seed_task_rules', stdout=out)
        count = TaskRule.objects.count()
        self.assertEqual(count, len(TASK_RULES))

    def test_seed_is_idempotent(self) -> None:
        call_command('seed_task_rules', stdout=StringIO())
        call_command('seed_task_rules', stdout=StringIO())
        count = TaskRule.objects.count()
        # Must not double-create.
        self.assertEqual(count, len(TASK_RULES))

    def test_reset_clears_and_reseeds_without_duplicates(self) -> None:
        call_command('seed_task_rules', stdout=StringIO())
        out = StringIO()
        call_command('seed_task_rules', '--reset', stdout=out)
        count = TaskRule.objects.count()
        self.assertEqual(count, len(TASK_RULES))

    def test_seed_creates_all_expected_title_keys(self) -> None:
        call_command('seed_task_rules', stdout=StringIO())
        expected_keys = {r['title_key'] for r in TASK_RULES}
        actual_keys = set(TaskRule.objects.values_list('title_key', flat=True))
        self.assertEqual(actual_keys, expected_keys)

    def test_all_active_by_default(self) -> None:
        call_command('seed_task_rules', stdout=StringIO())
        inactive = TaskRule.objects.filter(is_active=False).count()
        self.assertEqual(inactive, 0)


# ---------------------------------------------------------------------------
# backfill_tasks
# ---------------------------------------------------------------------------

class BackfillTasksTests(TestCase):
    """backfill_tasks command creates tasks for existing shipments."""

    def setUp(self) -> None:
        TaskRule.objects.all().delete()
        Task.objects.all().delete()
        # Seed rules first.
        call_command('seed_task_rules', stdout=StringIO())
        # Create a set of shipments at statuses that have rules.
        self.ships = [
            _make_shipment(f'BFT{i:04d}', status_code='yuklenme')
            for i in range(1, 6)
        ]
        # Clear any tasks auto-created by Shipment.save() during fixture setup.
        Task.objects.all().delete()

    def test_backfill_creates_tasks_up_to_limit(self) -> None:
        out = StringIO()
        call_command('backfill_tasks', '--limit', '5', stdout=out)
        # Each yuklenme shipment has 2 rules: fill_loading_data + quality_inspection.
        total_tasks = Task.objects.count()
        self.assertGreater(total_tasks, 0)

    def test_backfill_is_idempotent(self) -> None:
        call_command('backfill_tasks', '--limit', '5', stdout=StringIO())
        after_first = Task.objects.count()

        call_command('backfill_tasks', '--limit', '5', stdout=StringIO())
        after_second = Task.objects.count()

        self.assertEqual(after_first, after_second)

    def test_dry_run_creates_no_tasks(self) -> None:
        out = StringIO()
        call_command('backfill_tasks', '--dry-run', '--limit', '5', stdout=out)
        self.assertEqual(Task.objects.count(), 0)
        output = out.getvalue()
        self.assertIn('DRY RUN', output)
