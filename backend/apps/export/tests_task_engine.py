"""Tests for the task rule engine (B-engine sub-PR).

Covers:
  - parse_deadline_rule: all grammar forms
  - _condition_matches: blank / matching / non-matching
  - generate_tasks_for_status: idempotency, conditional generation
  - _resolve_value / _is_filled / _completion_satisfied: field resolution and
    completion logic including nested quality.* and firm_splits reverse FK
  - resolve_for_shipment: auto-DONE, manual_done stays OPEN
  - mark_started_for_changed_fields: started_at + IN_PROGRESS on overlap
  - Shipment.save() triggers resolution
  - transition_to() triggers generation

Out of scope: API endpoints, serializers, URLs (B-api PR).
"""
import datetime

from django.test import TestCase
from django.utils import timezone

from apps.core.models import Season, ShipmentStatusType
from apps.export.models import (
    QualityDocument,
    Shipment,
    ShipmentFirmSplit,
    Task,
    TaskCompletionRule,
    TaskRule,
    TaskState,
)
from apps.export.services.task_rules import (
    _completion_satisfied,
    _condition_matches,
    _is_filled,
    _resolve_value,
    generate_tasks_for_status,
    mark_started_for_changed_fields,
    parse_deadline_rule,
    resolve_for_shipment,
)

try:
    from zoneinfo import ZoneInfo
except ImportError:
    from backports.zoneinfo import ZoneInfo

TM_TZ = ZoneInfo('Asia/Ashgabat')


# ---------------------------------------------------------------------------
# Test fixtures
# ---------------------------------------------------------------------------

def _make_season(name: str = 'eng-test') -> Season:
    # Season.name max_length=10 — keep names short.
    season, _ = Season.objects.get_or_create(
        name=name,
        defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': False},
    )
    return season


def _make_status(code: str = 'yuklenme', step_order: int = 1) -> ShipmentStatusType:
    status, _ = ShipmentStatusType.objects.get_or_create(
        code=code,
        defaults={
            'name_tk': code, 'name_en': code, 'name_ru': code,
            'step_order': step_order, 'phase': 'LOADING',
        },
    )
    return status


def _make_shipment(cargo_code: str = 'ENG0001', status_code: str = 'yuklenme') -> Shipment:
    """Create a minimal shipment without triggering task generation (no rules exist yet)."""
    status = _make_status(status_code)
    # Bypass Shipment.save() override (no rules seeded in most tests so it's fine,
    # but using get_or_create avoids re-creating on each call in the same test).
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
        'step': 'yuklenme',
        'title_key': 'tasks.fill_loading_data',
        'assignee_role': 'warehouse_chief',
        'target_fields': 'cargo_code,weight_net',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'deadline_rule': '',
        'condition_field': '',
        'condition_value': '',
        'is_active': True,
    }
    defaults.update(kwargs)
    return TaskRule.objects.create(**defaults)


def _make_task(shipment, rule=None, **kwargs) -> Task:
    defaults = {
        'shipment': shipment,
        'step': 'yuklenme',
        'title_key': 'tasks.fill_loading_data',
        'assignee_role': 'warehouse_chief',
        'completion_rule': TaskCompletionRule.ALL_FIELDS_FILLED,
        'state': TaskState.OPEN,
    }
    if rule:
        defaults['rule'] = rule
    defaults.update(kwargs)
    return Task.objects.create(**defaults)


# ---------------------------------------------------------------------------
# 1. parse_deadline_rule — deadline grammar
# ---------------------------------------------------------------------------

class ParseDeadlineRuleTests(TestCase):
    """parse_deadline_rule converts rule strings to absolute datetimes."""

    def _ref(self, **kwargs) -> datetime.datetime:
        """Build a reference datetime in TM_TZ with given weekday offset."""
        # Use a Monday (2026-05-04) as base.
        base = datetime.datetime(2026, 5, 4, 10, 0, 0, tzinfo=TM_TZ)
        return base + datetime.timedelta(**kwargs)

    # Empty / none
    def test_empty_string_returns_none(self) -> None:
        self.assertIsNone(parse_deadline_rule(''))

    def test_none_string_returns_none(self) -> None:
        self.assertIsNone(parse_deadline_rule('none'))

    # same_day
    def test_same_day_returns_correct_time(self) -> None:
        ref = datetime.datetime(2026, 5, 4, 9, 0, 0, tzinfo=TM_TZ)
        result = parse_deadline_rule('13:00_same_day', reference=ref)
        self.assertIsNotNone(result)
        self.assertEqual(result.hour, 13)
        self.assertEqual(result.minute, 0)
        self.assertEqual(result.date(), datetime.date(2026, 5, 4))

    def test_same_day_timezone_is_ashgabat(self) -> None:
        ref = datetime.datetime(2026, 5, 4, 9, 0, 0, tzinfo=TM_TZ)
        result = parse_deadline_rule('13:00_same_day', reference=ref)
        # UTC offset for Asia/Ashgabat is +05:00
        self.assertEqual(result.utcoffset().total_seconds(), 5 * 3600)

    # next_business_day
    def test_next_business_day_from_monday(self) -> None:
        # Monday → Tuesday
        ref = datetime.datetime(2026, 5, 4, 9, 0, 0, tzinfo=TM_TZ)  # Monday
        result = parse_deadline_rule('13:00_next_business_day', reference=ref)
        self.assertEqual(result.date(), datetime.date(2026, 5, 5))  # Tuesday
        self.assertEqual(result.weekday(), 1)

    def test_next_business_day_from_friday(self) -> None:
        # Friday → Monday
        ref = datetime.datetime(2026, 5, 8, 9, 0, 0, tzinfo=TM_TZ)  # Friday
        result = parse_deadline_rule('13:00_next_business_day', reference=ref)
        self.assertEqual(result.weekday(), 0)  # Monday
        self.assertEqual(result.date(), datetime.date(2026, 5, 11))

    def test_next_business_day_from_saturday(self) -> None:
        # Saturday → Monday
        ref = datetime.datetime(2026, 5, 9, 9, 0, 0, tzinfo=TM_TZ)  # Saturday
        result = parse_deadline_rule('13:00_next_business_day', reference=ref)
        self.assertEqual(result.weekday(), 0)  # Monday

    def test_next_business_day_from_sunday(self) -> None:
        # Sunday → Monday
        ref = datetime.datetime(2026, 5, 10, 9, 0, 0, tzinfo=TM_TZ)  # Sunday
        result = parse_deadline_rule('13:00_next_business_day', reference=ref)
        self.assertEqual(result.weekday(), 0)  # Monday

    # Nh_after_status
    def test_24h_after_status(self) -> None:
        ref = datetime.datetime(2026, 5, 4, 10, 0, 0, tzinfo=TM_TZ)
        result = parse_deadline_rule('24h_after_status', reference=ref)
        expected = ref + datetime.timedelta(hours=24)
        self.assertEqual(result, expected)

    def test_4h_after_status(self) -> None:
        ref = datetime.datetime(2026, 5, 4, 10, 0, 0, tzinfo=TM_TZ)
        result = parse_deadline_rule('4h_after_status', reference=ref)
        expected = ref + datetime.timedelta(hours=4)
        self.assertEqual(result, expected)

    def test_1h_after_status(self) -> None:
        ref = datetime.datetime(2026, 5, 4, 10, 0, 0, tzinfo=TM_TZ)
        result = parse_deadline_rule('1h_after_status', reference=ref)
        self.assertEqual(result, ref + datetime.timedelta(hours=1))

    # friday_eow
    def test_friday_eow_from_monday(self) -> None:
        # Monday → this Friday at 18:00
        ref = datetime.datetime(2026, 5, 4, 9, 0, 0, tzinfo=TM_TZ)  # Monday
        result = parse_deadline_rule('friday_eow', reference=ref)
        self.assertEqual(result.weekday(), 4)  # Friday
        self.assertEqual(result.hour, 18)
        self.assertEqual(result.minute, 0)
        self.assertEqual(result.date(), datetime.date(2026, 5, 8))

    def test_friday_eow_on_friday_returns_same_day(self) -> None:
        # On Friday, coming Friday = today
        ref = datetime.datetime(2026, 5, 8, 9, 0, 0, tzinfo=TM_TZ)  # Friday
        result = parse_deadline_rule('friday_eow', reference=ref)
        self.assertEqual(result.date(), ref.date())
        self.assertEqual(result.hour, 18)

    # Unknown rule
    def test_unknown_rule_returns_none(self) -> None:
        import logging
        with self.assertLogs('apps.export.services.task_rules', level=logging.WARNING):
            result = parse_deadline_rule('totally_invalid_rule')
        self.assertIsNone(result)


# ---------------------------------------------------------------------------
# 2. _condition_matches
# ---------------------------------------------------------------------------

class ConditionMatchTests(TestCase):
    """_condition_matches tests."""

    def setUp(self) -> None:
        self.shipment = _make_shipment('COND0001')

    def test_blank_condition_field_always_matches(self) -> None:
        rule = _make_rule(condition_field='', condition_value='')
        self.assertTrue(_condition_matches(rule, self.shipment))

    def test_is_gapy_satys_true_matches_when_true(self) -> None:
        self.shipment.is_gapy_satys = True
        self.shipment.save()
        rule = _make_rule(condition_field='is_gapy_satys', condition_value='True')
        self.assertTrue(_condition_matches(rule, self.shipment))

    def test_is_gapy_satys_true_does_not_match_when_false(self) -> None:
        self.shipment.is_gapy_satys = False
        self.shipment.save()
        rule = _make_rule(condition_field='is_gapy_satys', condition_value='True')
        self.assertFalse(_condition_matches(rule, self.shipment))

    def test_is_gapy_satys_false_matches_when_false(self) -> None:
        self.shipment.is_gapy_satys = False
        self.shipment.save()
        rule = _make_rule(condition_field='is_gapy_satys', condition_value='False')
        self.assertTrue(_condition_matches(rule, self.shipment))

    def test_is_gapy_satys_false_does_not_match_when_true(self) -> None:
        self.shipment.is_gapy_satys = True
        self.shipment.save()
        rule = _make_rule(condition_field='is_gapy_satys', condition_value='False')
        self.assertFalse(_condition_matches(rule, self.shipment))

    def test_nonexistent_field_does_not_match(self) -> None:
        rule = _make_rule(condition_field='nonexistent_field_xyz', condition_value='something')
        # getattr returns None; str(None) != 'something'
        self.assertFalse(_condition_matches(rule, self.shipment))


# ---------------------------------------------------------------------------
# 3. generate_tasks_for_status — idempotency and conditional generation
# ---------------------------------------------------------------------------

class GenerateTasksTests(TestCase):
    """generate_tasks_for_status creates tasks and is idempotent."""

    def setUp(self) -> None:
        self.shipment = _make_shipment('GEN0001')
        # Clear any tasks that may have been created by Shipment.save() if rules exist.
        Task.objects.filter(shipment=self.shipment).delete()

    def test_creates_task_for_matching_rule(self) -> None:
        _make_rule(step='yuklenme', title_key='tasks.fill_loading_data')
        tasks = generate_tasks_for_status(self.shipment, 'yuklenme')
        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0].title_key, 'tasks.fill_loading_data')

    def test_idempotent_second_call_creates_no_tasks(self) -> None:
        _make_rule(step='yuklenme', title_key='tasks.idempotent_test')
        generate_tasks_for_status(self.shipment, 'yuklenme')
        # Second call — should skip the existing task.
        second = generate_tasks_for_status(self.shipment, 'yuklenme')
        self.assertEqual(len(second), 0)
        self.assertEqual(Task.objects.filter(shipment=self.shipment).count(), 1)

    def test_inactive_rule_not_triggered(self) -> None:
        _make_rule(step='yuklenme', title_key='tasks.inactive_test', is_active=False)
        tasks = generate_tasks_for_status(self.shipment, 'yuklenme')
        self.assertEqual(len(tasks), 0)

    def test_no_rules_returns_empty_list(self) -> None:
        tasks = generate_tasks_for_status(self.shipment, 'bardy')
        self.assertEqual(len(tasks), 0)

    def test_reseed_adds_new_rules_without_duplicating(self) -> None:
        rule1 = _make_rule(step='yuklenme', title_key='tasks.rule_one')
        generate_tasks_for_status(self.shipment, 'yuklenme')
        # Add a second rule and regenerate.
        _make_rule(step='yuklenme', title_key='tasks.rule_two')
        new_tasks = generate_tasks_for_status(self.shipment, 'yuklenme')
        # Only the new rule's task was created.
        self.assertEqual(len(new_tasks), 1)
        self.assertEqual(new_tasks[0].title_key, 'tasks.rule_two')
        # Total: 2 tasks.
        self.assertEqual(Task.objects.filter(shipment=self.shipment).count(), 2)

    def test_multiple_rules_all_created(self) -> None:
        _make_rule(step='yuklenme', title_key='tasks.a')
        _make_rule(step='yuklenme', title_key='tasks.b')
        tasks = generate_tasks_for_status(self.shipment, 'yuklenme')
        self.assertEqual(len(tasks), 2)


class GenerateTasksConditionalTests(TestCase):
    """Conditional rule matching via condition_field / condition_value."""

    def test_gapy_satys_true_gets_gapy_task_not_regular(self) -> None:
        _make_rule(
            step='draft',
            title_key='tasks.give_documents',
            condition_field='is_gapy_satys',
            condition_value='False',
        )
        _make_rule(
            step='draft',
            title_key='tasks.give_documents_gapy',
            condition_field='is_gapy_satys',
            condition_value='True',
        )
        ship = _make_shipment('GAPY0001', status_code='draft')
        ship.is_gapy_satys = True
        ship.save()
        # Clear auto-created tasks from save() hook.
        Task.objects.filter(shipment=ship).delete()

        tasks = generate_tasks_for_status(ship, 'draft')
        titles = {t.title_key for t in tasks}
        self.assertIn('tasks.give_documents_gapy', titles)
        self.assertNotIn('tasks.give_documents', titles)

    def test_gapy_satys_false_gets_regular_task_not_gapy(self) -> None:
        _make_rule(
            step='draft',
            title_key='tasks.give_documents',
            condition_field='is_gapy_satys',
            condition_value='False',
        )
        _make_rule(
            step='draft',
            title_key='tasks.give_documents_gapy',
            condition_field='is_gapy_satys',
            condition_value='True',
        )
        ship = _make_shipment('GAPY0002', status_code='draft')
        ship.is_gapy_satys = False
        ship.save()
        Task.objects.filter(shipment=ship).delete()

        tasks = generate_tasks_for_status(ship, 'draft')
        titles = {t.title_key for t in tasks}
        self.assertIn('tasks.give_documents', titles)
        self.assertNotIn('tasks.give_documents_gapy', titles)


# ---------------------------------------------------------------------------
# 4. _resolve_value and _is_filled
# ---------------------------------------------------------------------------

class ResolveValueTests(TestCase):
    """_resolve_value walks dotted attribute paths correctly."""

    def setUp(self) -> None:
        self.shipment = _make_shipment('RESV0001')

    def test_simple_field_returns_value(self) -> None:
        self.shipment.cargo_code = 'RESV0001'
        result = _resolve_value(self.shipment, 'cargo_code')
        self.assertEqual(result, 'RESV0001')

    def test_none_field_returns_none(self) -> None:
        self.shipment.weight_net = None
        result = _resolve_value(self.shipment, 'weight_net')
        self.assertIsNone(result)

    def test_nonexistent_field_returns_none(self) -> None:
        result = _resolve_value(self.shipment, 'totally_does_not_exist')
        self.assertIsNone(result)

    def test_quality_dot_path_missing_related_returns_none(self) -> None:
        # No QualityDocument row — OneToOne accessor raises DoesNotExist.
        result = _resolve_value(self.shipment, 'quality.azyk_maglumatnama')
        self.assertIsNone(result)

    def test_quality_dot_path_with_related_returns_field(self) -> None:
        QualityDocument.objects.create(
            shipment=self.shipment,
            azyk_maglumatnama=True,
            suriji_gozukdiriji=False,
        )
        result = _resolve_value(self.shipment, 'quality.azyk_maglumatnama')
        self.assertTrue(result)

    def test_reverse_fk_manager_exists_returns_false_when_empty(self) -> None:
        result = _resolve_value(self.shipment, 'firm_splits')
        self.assertFalse(result)

    def test_reverse_fk_manager_exists_returns_true_when_populated(self) -> None:
        from apps.core.models import ExportFirm
        firm, _ = ExportFirm.objects.get_or_create(
            code='TSTF',
            defaults={'name_tk': 'Test Firm', 'name_en': 'Test Firm'},
        )
        ShipmentFirmSplit.objects.create(
            shipment=self.shipment,
            export_firm=firm,
            weight_kg=1000,
        )
        result = _resolve_value(self.shipment, 'firm_splits')
        self.assertTrue(result)


class IsFillledTests(TestCase):
    """_is_filled returns correct booleans."""

    def test_none_not_filled(self) -> None:
        self.assertFalse(_is_filled(None))

    def test_false_not_filled(self) -> None:
        self.assertFalse(_is_filled(False))

    def test_zero_is_filled(self) -> None:
        # 0 is a valid field value (e.g. weight_net=0 is a real entry).
        self.assertTrue(_is_filled(0))

    def test_empty_string_not_filled(self) -> None:
        self.assertFalse(_is_filled(''))

    def test_nonempty_string_filled(self) -> None:
        self.assertTrue(_is_filled('hello'))

    def test_true_filled(self) -> None:
        self.assertTrue(_is_filled(True))

    def test_positive_int_filled(self) -> None:
        self.assertTrue(_is_filled(42))

    def test_negative_int_filled(self) -> None:
        # -1 is truthy in this context
        self.assertTrue(_is_filled(-1))


# ---------------------------------------------------------------------------
# 5. Auto-resolution via resolve_for_shipment
# ---------------------------------------------------------------------------

class ResolveForShipmentTests(TestCase):
    """resolve_for_shipment marks tasks DONE when completion rule is satisfied."""

    def setUp(self) -> None:
        self.shipment = _make_shipment('RES0001')
        Task.objects.filter(shipment=self.shipment).delete()

    def test_all_fields_filled_resolves_to_done(self) -> None:
        # cargo_code is always set; weight_net needs to be set.
        self.shipment.weight_net = 18000
        self.shipment.save()
        Task.objects.filter(shipment=self.shipment).delete()

        task = _make_task(
            self.shipment,
            target_fields='cargo_code,weight_net',
            completion_rule=TaskCompletionRule.ALL_FIELDS_FILLED,
        )
        resolved = resolve_for_shipment(self.shipment)
        self.assertEqual(len(resolved), 1)
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.DONE)
        self.assertIsNotNone(task.completed_at)

    def test_partial_fill_does_not_resolve_all_fields_rule(self) -> None:
        # weight_net is None — should not resolve.
        self.shipment.weight_net = None
        self.shipment.save()
        Task.objects.filter(shipment=self.shipment).delete()

        _make_task(
            self.shipment,
            target_fields='cargo_code,weight_net',
            completion_rule=TaskCompletionRule.ALL_FIELDS_FILLED,
        )
        resolved = resolve_for_shipment(self.shipment)
        self.assertEqual(len(resolved), 0)

    def test_any_field_filled_resolves_on_first_fill(self) -> None:
        # cargo_code is set; weight_net is None. With ANY_FIELD_FILLED, should resolve.
        self.shipment.weight_net = None
        self.shipment.save()
        Task.objects.filter(shipment=self.shipment).delete()

        task = _make_task(
            self.shipment,
            target_fields='cargo_code,weight_net',
            completion_rule=TaskCompletionRule.ANY_FIELD_FILLED,
        )
        resolved = resolve_for_shipment(self.shipment)
        self.assertEqual(len(resolved), 1)
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.DONE)

    def test_manual_done_task_does_not_auto_resolve(self) -> None:
        # Even with all fields filled, MANUAL_DONE stays OPEN.
        self.shipment.weight_net = 18000
        self.shipment.save()
        Task.objects.filter(shipment=self.shipment).delete()

        task = _make_task(
            self.shipment,
            target_fields='cargo_code,weight_net',
            completion_rule=TaskCompletionRule.MANUAL_DONE,
        )
        resolved = resolve_for_shipment(self.shipment)
        self.assertEqual(len(resolved), 0)
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.OPEN)

    def test_started_at_set_when_none_on_resolution(self) -> None:
        self.shipment.weight_net = 18000
        self.shipment.save()
        Task.objects.filter(shipment=self.shipment).delete()

        task = _make_task(
            self.shipment,
            target_fields='cargo_code,weight_net',
            completion_rule=TaskCompletionRule.ALL_FIELDS_FILLED,
            started_at=None,
        )
        resolve_for_shipment(self.shipment)
        task.refresh_from_db()
        self.assertIsNotNone(task.started_at)

    def test_already_done_task_not_touched(self) -> None:
        self.shipment.weight_net = 18000
        self.shipment.save()
        Task.objects.filter(shipment=self.shipment).delete()

        task = _make_task(
            self.shipment,
            target_fields='cargo_code,weight_net',
            completion_rule=TaskCompletionRule.ALL_FIELDS_FILLED,
            state=TaskState.DONE,
            completed_at=timezone.now(),
        )
        resolved = resolve_for_shipment(self.shipment)
        self.assertEqual(len(resolved), 0)
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.DONE)

    def test_no_tasks_returns_empty_list(self) -> None:
        resolved = resolve_for_shipment(self.shipment)
        self.assertEqual(resolved, [])


# ---------------------------------------------------------------------------
# 6. Nested quality.* paths
# ---------------------------------------------------------------------------

class QualityPathResolutionTests(TestCase):
    """Quality document dotted-path resolution in auto-resolve."""

    def setUp(self) -> None:
        self.shipment = _make_shipment('QUAL0001')
        Task.objects.filter(shipment=self.shipment).delete()

    def test_no_quality_doc_not_filled(self) -> None:
        task = _make_task(
            self.shipment,
            target_fields='quality.azyk_maglumatnama',
            completion_rule=TaskCompletionRule.ALL_FIELDS_FILLED,
        )
        resolved = resolve_for_shipment(self.shipment)
        self.assertEqual(len(resolved), 0)
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.OPEN)

    def test_quality_doc_all_true_resolves_task(self) -> None:
        QualityDocument.objects.create(
            shipment=self.shipment,
            azyk_maglumatnama=True,
            suriji_gozukdiriji=True,
            hil_sertifikaty=True,
            kalibrowka_analiz=True,
        )
        task = _make_task(
            self.shipment,
            target_fields=(
                'quality.azyk_maglumatnama,'
                'quality.suriji_gozukdiriji,'
                'quality.hil_sertifikaty,'
                'quality.kalibrowka_analiz'
            ),
            completion_rule=TaskCompletionRule.ALL_FIELDS_FILLED,
        )
        resolved = resolve_for_shipment(self.shipment)
        self.assertEqual(len(resolved), 1)
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.DONE)

    def test_quality_doc_partial_does_not_resolve(self) -> None:
        QualityDocument.objects.create(
            shipment=self.shipment,
            azyk_maglumatnama=True,
            suriji_gozukdiriji=False,
        )
        task = _make_task(
            self.shipment,
            target_fields=(
                'quality.azyk_maglumatnama,'
                'quality.suriji_gozukdiriji'
            ),
            completion_rule=TaskCompletionRule.ALL_FIELDS_FILLED,
        )
        resolved = resolve_for_shipment(self.shipment)
        self.assertEqual(len(resolved), 0)


# ---------------------------------------------------------------------------
# 7. firm_splits reverse FK
# ---------------------------------------------------------------------------

class FirmSplitsResolutionTests(TestCase):
    """firm_splits reverse-FK treated as filled when .exists() is True."""

    def setUp(self) -> None:
        self.shipment = _make_shipment('FIRM0001')
        Task.objects.filter(shipment=self.shipment).delete()

    def _make_firm_split(self):
        from apps.core.models import ExportFirm
        firm, _ = ExportFirm.objects.get_or_create(
            code='TSTA',
            defaults={'name_tk': 'Test A Firm', 'name_en': 'Test A Firm'},
        )
        return ShipmentFirmSplit.objects.create(
            shipment=self.shipment,
            export_firm=firm,
            weight_kg=5000,
        )

    def test_no_splits_not_filled(self) -> None:
        task = _make_task(
            self.shipment,
            target_fields='firm_splits',
            completion_rule=TaskCompletionRule.ANY_FIELD_FILLED,
        )
        resolved = resolve_for_shipment(self.shipment)
        self.assertEqual(len(resolved), 0)

    def test_with_split_resolves_task(self) -> None:
        self._make_firm_split()
        task = _make_task(
            self.shipment,
            target_fields='firm_splits',
            completion_rule=TaskCompletionRule.ANY_FIELD_FILLED,
        )
        resolved = resolve_for_shipment(self.shipment)
        self.assertEqual(len(resolved), 1)
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.DONE)


# ---------------------------------------------------------------------------
# 8. mark_started_for_changed_fields
# ---------------------------------------------------------------------------

class MarkStartedTests(TestCase):
    """mark_started_for_changed_fields transitions OPEN tasks to IN_PROGRESS."""

    def setUp(self) -> None:
        self.shipment = _make_shipment('MKS0001')
        Task.objects.filter(shipment=self.shipment).delete()

    def test_overlapping_field_sets_in_progress(self) -> None:
        task = _make_task(
            self.shipment,
            target_fields='weight_net,weight_gross',
            state=TaskState.OPEN,
        )
        mark_started_for_changed_fields(self.shipment, ['weight_net'])
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.IN_PROGRESS)
        self.assertIsNotNone(task.started_at)

    def test_non_overlapping_field_leaves_task_open(self) -> None:
        task = _make_task(
            self.shipment,
            target_fields='weight_net,weight_gross',
            state=TaskState.OPEN,
        )
        mark_started_for_changed_fields(self.shipment, ['cargo_code'])
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.OPEN)

    def test_empty_changed_keys_is_noop(self) -> None:
        task = _make_task(
            self.shipment,
            target_fields='weight_net',
            state=TaskState.OPEN,
        )
        mark_started_for_changed_fields(self.shipment, [])
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.OPEN)

    def test_already_in_progress_task_not_re_set(self) -> None:
        already_started = timezone.now() - datetime.timedelta(hours=1)
        task = _make_task(
            self.shipment,
            target_fields='weight_net',
            state=TaskState.IN_PROGRESS,
            started_at=already_started,
        )
        mark_started_for_changed_fields(self.shipment, ['weight_net'])
        task.refresh_from_db()
        # State unchanged, started_at unchanged.
        self.assertEqual(task.state, TaskState.IN_PROGRESS)
        self.assertAlmostEqual(
            task.started_at.timestamp(), already_started.timestamp(), delta=1
        )

    def test_started_at_preserved_if_already_set(self) -> None:
        original_started = timezone.now() - datetime.timedelta(hours=2)
        task = _make_task(
            self.shipment,
            target_fields='weight_net',
            state=TaskState.OPEN,
            started_at=original_started,
        )
        mark_started_for_changed_fields(self.shipment, ['weight_net'])
        task.refresh_from_db()
        # started_at must not be overwritten.
        self.assertAlmostEqual(
            task.started_at.timestamp(), original_started.timestamp(), delta=1
        )


# ---------------------------------------------------------------------------
# 9. Shipment.save() triggers resolution
# ---------------------------------------------------------------------------

class ShipmentSaveResolutionTests(TestCase):
    """Shipment.save() auto-resolves open tasks."""

    def test_direct_save_triggers_resolution(self) -> None:
        shipment = _make_shipment('SAVR0001')
        Task.objects.filter(shipment=shipment).delete()

        task = _make_task(
            shipment,
            target_fields='cargo_code,weight_net',
            completion_rule=TaskCompletionRule.ALL_FIELDS_FILLED,
            state=TaskState.OPEN,
        )

        # Set both required fields and save — should resolve.
        shipment.weight_net = 18000
        shipment.save()

        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.DONE)

    def test_partial_save_does_not_resolve_unfilled_task(self) -> None:
        shipment = _make_shipment('SAVR0002')
        Task.objects.filter(shipment=shipment).delete()

        task = _make_task(
            shipment,
            target_fields='cargo_code,weight_net',
            completion_rule=TaskCompletionRule.ALL_FIELDS_FILLED,
            state=TaskState.OPEN,
        )

        # weight_net stays None — task should stay OPEN.
        shipment.notes = 'some update'
        shipment.save()

        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.OPEN)


# ---------------------------------------------------------------------------
# 10. transition_to() integration trigger
# ---------------------------------------------------------------------------

class TransitionToGenerationTests(TestCase):
    """transition_to() calls generate_tasks_for_status for the new status."""

    def setUp(self) -> None:
        from apps.core.models import User as CoreUser

        self.user = CoreUser.objects.create_user(
            username='trans_test_user', password='pass', role='export_manager',
        )
        # Create all needed statuses.
        self.draft_status = _make_status('draft', step_order=0)
        self.yuklenme_status = _make_status('yuklenme', step_order=1)

    def test_transition_creates_tasks_for_new_status(self) -> None:
        from apps.export.services.shipment import transition_to

        rule = _make_rule(
            step='yuklenme',
            title_key='tasks.fill_loading_data',
        )

        shipment = Shipment.objects.create(
            cargo_code='TRANS0001',
            date='2026-01-15',
            season=_make_season('trn-test'),
            status=self.draft_status,
        )
        Task.objects.filter(shipment=shipment).delete()

        transition_to(shipment, 'yuklenme', self.user)

        tasks = Task.objects.filter(shipment=shipment, rule=rule)
        self.assertEqual(tasks.count(), 1)
        self.assertEqual(tasks.first().step, 'yuklenme')
