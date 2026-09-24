"""Tests for reconcile_shipment_tasks (services/task_rules.py).

Covers the Regular <-> Gapy-Satys flip on a shipment already sitting in a step:
tasks whose rule no longer matches are cancelled, tasks whose rule now matches
are created, DONE tasks are never touched, and the reconciler never moves the
shipment's status.
"""
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from apps.core.models import Season, ShipmentStatusType, User
from apps.export.models import (
    Shipment,
    ShipmentStatusLog,
    Task,
    TaskCancelReason,
    TaskCompletionRule,
    TaskRule,
    TaskState,
)
from apps.export.services.task_rules import reconcile_shipment_tasks


def _make_season(name: str = 'cond-rec', closed=False) -> Season:
    # Season.name is CharField(max_length=10, unique=True).
    season, _ = Season.objects.get_or_create(
        name=name,
        defaults={
            'start_date': '2025-09-01', 'end_date': '2026-06-30',
            'is_active': False,
            'closed_at': timezone.now() if closed else None,
        },
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


def _make_shipment(shipment_code: str, status_code: str = 'draft', **kwargs) -> Shipment:
    defaults = {
        'date': '2026-01-15',
        'season': _make_season(),
        'status': _make_status(status_code),
    }
    defaults.update(kwargs)
    ship, _ = Shipment.objects.get_or_create(
        shipment_code=shipment_code, defaults=defaults,
    )
    return ship


def _make_rule(**kwargs) -> TaskRule:
    defaults = {
        'step': 'draft',
        'title_key': 'tasks.cond_test',
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


def _make_task(shipment: Shipment, rule: TaskRule, **kwargs) -> Task:
    defaults = {
        'shipment': shipment,
        'step': rule.step,
        'rule': rule,
        'title_key': rule.title_key,
        'assignee_role': rule.assignee_role,
        'completion_rule': rule.completion_rule,
        'target_fields': rule.target_fields,
        'target_value': rule.target_value,
        'state': TaskState.OPEN,
    }
    defaults.update(kwargs)
    return Task.objects.create(**defaults)


class GapyFlipTests(TestCase):
    """The Regular <-> Gapy pair, which is the case that motivated the feature."""

    def setUp(self):
        self.regular_rule = _make_rule(
            title_key='tasks.assign_driver',
            condition_field='is_gapy_satys', condition_value='False',
        )
        self.gapy_rule = _make_rule(
            title_key='tasks.assign_driver',
            target_fields='driver_name,driver_2_name',
            condition_field='is_gapy_satys', condition_value='True',
        )

    def test_flip_to_gapy_cancels_regular_and_creates_gapy(self):
        ship = _make_shipment('0201001/26', is_gapy_satys=False)
        regular_task = _make_task(ship, self.regular_rule)

        result = reconcile_shipment_tasks(ship)
        self.assertEqual(result['created'], [])
        self.assertEqual(result['cancelled'], [])

        ship.is_gapy_satys = True
        ship.save(update_fields=['is_gapy_satys'])

        result = reconcile_shipment_tasks(ship, changed_fields=['is_gapy_satys'])

        regular_task.refresh_from_db()
        self.assertEqual(regular_task.state, TaskState.CANCELLED)
        self.assertEqual(regular_task.cancelled_reason, TaskCancelReason.RULE_MISMATCH)

        self.assertEqual(len(result['created']), 1)
        gapy_task = result['created'][0]
        self.assertEqual(gapy_task.rule_id, self.gapy_rule.id)
        self.assertEqual(gapy_task.state, TaskState.OPEN)
        self.assertEqual(gapy_task.target_fields, 'driver_name,driver_2_name')

    def test_flip_back_reopens_the_same_row(self):
        ship = _make_shipment('0201002/26', is_gapy_satys=False)
        regular_task = _make_task(ship, self.regular_rule)

        ship.is_gapy_satys = True
        ship.save(update_fields=['is_gapy_satys'])
        reconcile_shipment_tasks(ship, changed_fields=['is_gapy_satys'])

        ship.is_gapy_satys = False
        ship.save(update_fields=['is_gapy_satys'])
        result = reconcile_shipment_tasks(ship, changed_fields=['is_gapy_satys'])

        self.assertEqual(len(result['reopened']), 1)
        self.assertEqual(result['reopened'][0].id, regular_task.id)
        self.assertEqual(result['created'], [])
        # Still exactly one row per (shipment, rule) - reopen, never duplicate.
        self.assertEqual(
            Task.objects.filter(shipment=ship, rule=self.regular_rule).count(), 1,
        )

    def test_done_task_is_never_touched(self):
        ship = _make_shipment('0201003/26', is_gapy_satys=False)
        done_task = _make_task(
            ship, self.regular_rule,
            state=TaskState.DONE, completed_at=timezone.now(),
        )

        ship.is_gapy_satys = True
        ship.save(update_fields=['is_gapy_satys'])
        result = reconcile_shipment_tasks(ship, changed_fields=['is_gapy_satys'])

        done_task.refresh_from_db()
        self.assertEqual(done_task.state, TaskState.DONE)
        self.assertEqual(done_task.cancelled_reason, '')
        self.assertEqual(result['cancelled'], [])


class GateAndIdempotencyTests(TestCase):
    def test_unrelated_changed_field_does_nothing(self):
        _make_rule(condition_field='is_gapy_satys', condition_value='True')
        ship = _make_shipment('0201010/26', is_gapy_satys=True)

        result = reconcile_shipment_tasks(ship, changed_fields=['weight_net'])

        self.assertEqual(result, {'created': [], 'cancelled': [], 'reopened': []})
        self.assertEqual(Task.objects.filter(shipment=ship).count(), 0)

    def test_none_changed_fields_reconciles_regardless(self):
        rule = _make_rule(condition_field='is_gapy_satys', condition_value='True')
        ship = _make_shipment('0201011/26', is_gapy_satys=True)

        result = reconcile_shipment_tasks(ship, changed_fields=None)

        self.assertEqual(len(result['created']), 1)
        self.assertEqual(result['created'][0].rule_id, rule.id)

    def test_second_call_is_a_no_op(self):
        _make_rule(condition_field='is_gapy_satys', condition_value='True')
        ship = _make_shipment('0201012/26', is_gapy_satys=True)

        first = reconcile_shipment_tasks(ship)
        second = reconcile_shipment_tasks(ship)

        self.assertEqual(len(first['created']), 1)
        self.assertEqual(second, {'created': [], 'cancelled': [], 'reopened': []})

    def test_closed_season_is_skipped(self):
        _make_rule(condition_field='is_gapy_satys', condition_value='True')
        closed = _make_season('cond-clsd', closed=True)
        ship = _make_shipment('0201013/26', is_gapy_satys=True, season=closed)

        result = reconcile_shipment_tasks(ship)

        self.assertEqual(result, {'created': [], 'cancelled': [], 'reopened': []})
        self.assertEqual(Task.objects.filter(shipment=ship).count(), 0)

    def test_inactive_rule_is_out_of_scope(self):
        rule = _make_rule(is_active=False)
        ship = _make_shipment('0201014/26')
        task = _make_task(ship, rule)

        result = reconcile_shipment_tasks(ship)

        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.OPEN)
        self.assertEqual(result['cancelled'], [])

    def test_earlier_step_task_is_in_scope(self):
        """tasks.submit_sales_report lives long past the step that created it."""
        _make_status('yola_chykdy', step_order=5)
        late_rule = _make_rule(
            step='yola_chykdy', title_key='tasks.submit_sales_report',
            condition_field='has_peregruz', condition_value='True',
        )
        ship = _make_shipment('0201015/26', status_code='bardy', has_peregruz=False)
        stale = _make_task(ship, late_rule, step='yola_chykdy')

        result = reconcile_shipment_tasks(ship, changed_fields=['has_peregruz'])

        stale.refresh_from_db()
        self.assertEqual(stale.state, TaskState.CANCELLED)
        self.assertEqual(stale.cancelled_reason, TaskCancelReason.RULE_MISMATCH)
        self.assertEqual(len(result['cancelled']), 1)


class WrongCaseConditionValueTests(TestCase):
    """Review Focus 1.

    str(True) == 'True'. A rule seeded or typed with condition_value='true'
    matches nothing, so every task at that step is cancelled and none created
    - leaving the step auto-advance eligible. The warning log is the only
    defence; this test is what keeps it there.
    """

    def test_lowercase_true_cancels_everything_and_warns(self):
        bad_rule = _make_rule(
            title_key='tasks.typo_rule',
            condition_field='is_gapy_satys', condition_value='true',
        )
        ship = _make_shipment('0201020/26', is_gapy_satys=True)
        task = _make_task(ship, bad_rule)

        with self.assertLogs('apps.export.services.task_rules', level='WARNING') as cm:
            result = reconcile_shipment_tasks(ship, changed_fields=['is_gapy_satys'])

        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.CANCELLED)
        self.assertEqual(len(result['cancelled']), 1)
        self.assertEqual(result['created'], [])
        self.assertTrue(
            any('no open auto-task' in line for line in cm.output),
            f'expected the lost-gate warning, got: {cm.output}',
        )
        # Assert the HAZARD, not just the log line: the step really has lost
        # its gate, which is what makes the shipment auto-advance eligible.
        from apps.export.services.shipment import is_step_trigger_satisfied
        self.assertTrue(
            is_step_trigger_satisfied(ship, 'draft'),
            'the typo should have left the step trigger-satisfied - if this is '
            'False the test no longer exercises the hazard it was written for',
        )


class ShipmentWithNoTasksTests(TestCase):
    """Review Focus 3.

    import_sheet_shipments creates shipments in bulk, bypassing
    Shipment.save(), so a live shipment can sit in a step with zero Task rows.
    A condition-field PATCH must create the matching tasks, not crash on the
    empty set.
    """

    def test_creates_tasks_for_a_shipment_that_has_none(self):
        matching = _make_rule(
            title_key='tasks.gapy_docs',
            condition_field='is_gapy_satys', condition_value='True',
        )
        _make_rule(
            title_key='tasks.regular_docs',
            condition_field='is_gapy_satys', condition_value='False',
        )
        ship = _make_shipment('0201030/26', is_gapy_satys=True)
        self.assertEqual(Task.objects.filter(shipment=ship).count(), 0)

        result = reconcile_shipment_tasks(ship, changed_fields=['is_gapy_satys'])

        self.assertEqual(len(result['created']), 1)
        self.assertEqual(result['created'][0].rule_id, matching.id)
        self.assertEqual(result['cancelled'], [])


class ScopeIsConditionedRulesOnlyTests(TestCase):
    """The reconciler must not be a backfill.

    Found in review: the create branch originally fired for EVERY active rule in
    scope with no Task row. That made `reconcile_tasks` an emitter and reversed
    the 2026-09-23 decision recorded verbatim in seed_task_rules.py: the 69
    non-gapy drafts open when `tasks.set_border_point` shipped must stay
    unblocked, because "reconcile_tasks is a mutator that never emits new
    tasks". Two independent guards, one test each.
    """

    def test_unconditional_rule_is_never_created(self):
        """A rule with no condition cannot have been affected by a condition change."""
        unconditional = _make_rule(title_key='tasks.start_documents_prep')
        gapy = _make_rule(
            title_key='tasks.gapy_driver',
            condition_field='is_gapy_satys', condition_value='True',
        )
        ship = _make_shipment('0201040/26', is_gapy_satys=True)

        result = reconcile_shipment_tasks(ship, changed_fields=['is_gapy_satys'])

        created_rule_ids = {t.rule_id for t in result['created']}
        self.assertIn(gapy.id, created_rule_ids)
        self.assertNotIn(
            unconditional.id, created_rule_ids,
            'an unconditional rule must never be emitted by the condition pass',
        )

    def test_rule_conditioned_on_an_untouched_field_is_never_created(self):
        """Ticking Gapy must not emit a task for a has_peregruz rule."""
        peregruz = _make_rule(
            title_key='tasks.trigger_transshipment',
            condition_field='has_peregruz', condition_value='False',
        )
        gapy = _make_rule(
            title_key='tasks.gapy_driver',
            condition_field='is_gapy_satys', condition_value='True',
        )
        ship = _make_shipment('0201041/26', is_gapy_satys=True, has_peregruz=False)

        result = reconcile_shipment_tasks(ship, changed_fields=['is_gapy_satys'])

        created_rule_ids = {t.rule_id for t in result['created']}
        self.assertIn(gapy.id, created_rule_ids)
        self.assertNotIn(
            peregruz.id, created_rule_ids,
            'has_peregruz was not touched, so its rules are out of scope',
        )

    def test_bulk_path_does_not_create_by_default(self):
        """The repair command must cancel stale tasks without emitting new ones.

        This is the guard on the 69 drafts: reconcile_conditions_for_shipments
        is what `reconcile_tasks` calls, and it must not become a backfill.
        """
        from apps.export.services.task_rules import reconcile_conditions_for_shipments

        regular = _make_rule(
            title_key='tasks.assign_driver',
            condition_field='is_gapy_satys', condition_value='False',
        )
        _make_rule(
            title_key='tasks.set_border_point',
            condition_field='is_gapy_satys', condition_value='False',
        )
        # Matches the shipment and has no Task row: this is what would be
        # emitted if the repair pass were a backfill.
        _make_rule(
            title_key='tasks.gapy_driver',
            condition_field='is_gapy_satys', condition_value='True',
        )
        ship = _make_shipment('0201042/26', is_gapy_satys=True)
        stale = _make_task(ship, regular)

        summary = reconcile_conditions_for_shipments(shipments=[ship], dry_run=False)

        stale.refresh_from_db()
        self.assertEqual(stale.state, TaskState.CANCELLED)
        self.assertEqual(summary['cancelled'], 1)
        self.assertEqual(
            summary['created'], 0,
            'the repair pass must not emit tasks unless explicitly asked',
        )

    def test_bulk_path_creates_when_explicitly_asked(self):
        from apps.export.services.task_rules import reconcile_conditions_for_shipments

        regular = _make_rule(
            title_key='tasks.assign_driver',
            condition_field='is_gapy_satys', condition_value='False',
        )
        gapy = _make_rule(
            title_key='tasks.gapy_driver',
            condition_field='is_gapy_satys', condition_value='True',
        )
        ship = _make_shipment('0201043/26', is_gapy_satys=True)
        _make_task(ship, regular)

        summary = reconcile_conditions_for_shipments(
            shipments=[ship], dry_run=False, create_missing=True,
        )

        self.assertEqual(summary['cancelled'], 1)
        self.assertEqual(summary['created'], 1)
        self.assertTrue(
            Task.objects.filter(shipment=ship, rule=gapy, state=TaskState.OPEN).exists()
        )


class NeverAutoAdvancesTests(TestCase):
    """The feature's most important invariant, pinned in a shape that can fail.

    Found in review: the original guard used a MANUAL_DONE replacement rule, so
    resolve_for_shipment returned [] and auto_advance_if_ready would have exited
    at its own `if not resolved_tasks` guard. The test passed whether or not the
    reconciler called it - it proved nothing.

    This shape makes a hypothetical auto_advance call actually fire:
      - barysh_gumrugi, so there is no draft two-row join guard to swallow the
        ValueError;
      - both rules ALL_FIELDS_FILLED (not MANUAL_DONE), so they are real
        auto-advance gates;
      - peregruz_date is ALREADY filled, so the task the reconcile creates
        resolves to DONE inside the reconcile's own resolve_for_shipment - which
        is what makes `resolved` non-empty;
      - has_peregruz=True after the flip, so _resolve_next_status has a legal
        edge to transshipment.

    Proven to be able to fail: temporarily appending
    `auto_advance_if_ready(shipment, resolve_for_shipment(shipment))` to the end
    of reconcile_shipment_tasks makes this test go red on both assertions.
    """

    def test_a_condition_flip_does_not_move_the_shipment(self):
        _make_status('barysh_gumrugi', step_order=8)
        _make_status('transshipment', step_order=9)

        direct = _make_rule(
            step='barysh_gumrugi', title_key='tasks.trigger_arrival_direct',
            target_fields='arrived_at',
            completion_rule=TaskCompletionRule.ALL_FIELDS_FILLED,
            condition_field='has_peregruz', condition_value='False',
        )
        _make_rule(
            step='barysh_gumrugi', title_key='tasks.trigger_transshipment',
            target_fields='peregruz_date',
            completion_rule=TaskCompletionRule.ALL_FIELDS_FILLED,
            condition_field='has_peregruz', condition_value='True',
        )

        ship = _make_shipment(
            '0201050/26', status_code='barysh_gumrugi',
            has_peregruz=False, peregruz_date='2026-02-01',
        )
        gate = _make_task(ship, direct, step='barysh_gumrugi')
        logs_before = ShipmentStatusLog.objects.filter(shipment=ship).count()

        # updated_by MUST be set, or auto_advance_if_ready exits on its own
        # `if not user` guard and this test becomes vacuous again. The real
        # PATCH path always sets it (serializer.save(updated_by=request.user)).
        actor = User(username='cond-advance-actor', role='sales_rep')
        actor.set_password('pass')
        actor.save()
        ship.updated_by = actor
        ship.has_peregruz = True
        ship.save(update_fields=['has_peregruz', 'updated_by'])

        result = reconcile_shipment_tasks(ship, changed_fields=['has_peregruz'])

        # Preconditions of the guard: the old gate is gone and the new task
        # resolved, so `resolved` was non-empty and the step is satisfied.
        gate.refresh_from_db()
        self.assertEqual(gate.state, TaskState.CANCELLED)
        self.assertEqual(len(result['created']), 1)
        self.assertEqual(
            result['created'][0].state, TaskState.DONE,
            'the created task must have auto-resolved, or this test is vacuous again',
        )

        # The invariant.
        ship.refresh_from_db()
        self.assertEqual(ship.status.code, 'barysh_gumrugi')
        self.assertEqual(
            ShipmentStatusLog.objects.filter(shipment=ship).count(), logs_before,
        )


class ReopenRefreshesTheClockTests(TestCase):
    """Found in review: reopen kept the original deadline and started_at.

    A task cancelled six days ago and reopened today reported is_overdue the
    instant it came back, polluting the overdue board and the owning role's KPI
    with work nobody could have done. Created tasks get a fresh deadline from
    now, so the two branches were inconsistent. Spec rule 4 says a reopen is a
    no-op for the operator - an instant overdue is not.
    """

    def test_reopen_recomputes_the_deadline_and_clears_started_at(self):
        rule = _make_rule(
            title_key='tasks.assign_driver', deadline_rule='24h_after_status',
            condition_field='is_gapy_satys', condition_value='False',
        )
        _make_rule(
            title_key='tasks.gapy_driver',
            condition_field='is_gapy_satys', condition_value='True',
        )
        ship = _make_shipment('0201060/26', is_gapy_satys=False)

        stale_deadline = timezone.now() - timedelta(days=6)
        task = _make_task(
            ship, rule,
            deadline=stale_deadline, deadline_rule='24h_after_status',
            started_at=timezone.now() - timedelta(days=7),
        )
        self.assertTrue(task.is_overdue)

        ship.is_gapy_satys = True
        ship.save(update_fields=['is_gapy_satys'])
        reconcile_shipment_tasks(ship, changed_fields=['is_gapy_satys'])

        ship.is_gapy_satys = False
        ship.save(update_fields=['is_gapy_satys'])
        result = reconcile_shipment_tasks(ship, changed_fields=['is_gapy_satys'])

        self.assertEqual(len(result['reopened']), 1)
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.OPEN)
        self.assertGreater(
            task.deadline, timezone.now(),
            'a reopened task must not be born overdue',
        )
        self.assertFalse(task.is_overdue)
        self.assertIsNone(
            task.started_at,
            'nobody has started the reopened task yet',
        )

    def test_reopen_of_a_deadlineless_task_stays_deadlineless(self):
        rule = _make_rule(
            title_key='tasks.assign_driver', deadline_rule='',
            condition_field='is_gapy_satys', condition_value='False',
        )
        _make_rule(
            title_key='tasks.gapy_driver',
            condition_field='is_gapy_satys', condition_value='True',
        )
        ship = _make_shipment('0201061/26', is_gapy_satys=False)
        task = _make_task(ship, rule, deadline=None, deadline_rule='')

        ship.is_gapy_satys = True
        ship.save(update_fields=['is_gapy_satys'])
        reconcile_shipment_tasks(ship, changed_fields=['is_gapy_satys'])
        ship.is_gapy_satys = False
        ship.save(update_fields=['is_gapy_satys'])
        reconcile_shipment_tasks(ship, changed_fields=['is_gapy_satys'])

        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.OPEN)
        self.assertIsNone(task.deadline)


class StepLosesItsLastGateWarningTests(TestCase):
    """Found in review: the warning guarded on a single global
    `if cancelled and not created`, so any create ANYWHERE silenced it.

    The case that matters is per-step: a step can lose its last open auto-task
    while a different step gains one. is_step_trigger_satisfied excludes
    MANUAL_DONE, so creating a MANUAL_DONE task at the same step does not
    replace a gate either.
    """

    def test_warns_when_a_step_loses_its_gate_even_though_something_was_created(self):
        # draft: a gating ALL_FIELDS_FILLED rule is cancelled, and the
        # replacement is MANUAL_DONE - which does NOT gate. The step is now
        # trigger-satisfied, so the operator must be told.
        gating = _make_rule(
            title_key='tasks.assign_driver', target_fields='driver_name',
            completion_rule=TaskCompletionRule.ALL_FIELDS_FILLED,
            condition_field='is_gapy_satys', condition_value='False',
        )
        _make_rule(
            title_key='tasks.give_documents_gapy',
            completion_rule=TaskCompletionRule.MANUAL_DONE,
            condition_field='is_gapy_satys', condition_value='True',
        )
        ship = _make_shipment('0201070/26', is_gapy_satys=False)
        _make_task(ship, gating)

        ship.is_gapy_satys = True
        ship.save(update_fields=['is_gapy_satys'])

        with self.assertLogs('apps.export.services.task_rules', level='WARNING') as cm:
            result = reconcile_shipment_tasks(ship, changed_fields=['is_gapy_satys'])

        self.assertEqual(len(result['created']), 1)      # something WAS created
        self.assertEqual(len(result['cancelled']), 1)
        self.assertTrue(
            any('no open auto-task' in line for line in cm.output),
            f'expected the lost-gate warning despite a create, got: {cm.output}',
        )


class GateIsOneQueryTests(TestCase):
    """The gate runs on EVERY Sheet cell edit - the hottest path in the product,
    used by people on public networks in KZ/RU. It must be as close to free as
    possible.

    Found in review: the season check and the full rule load both ran BEFORE the
    gate decided to bail, so an ordinary weight edit paid two queries for a
    feature it never used. (refresh_from_db in partial_update clears the season
    relation cache, so that one is a real round trip.)
    """

    def test_an_unrelated_field_costs_one_query(self):
        _make_rule(condition_field='is_gapy_satys', condition_value='True')
        ship = _make_shipment('0201080/26', is_gapy_satys=True)
        ship.refresh_from_db()          # clear relation caches, as the view does

        with self.assertNumQueries(1):
            reconcile_shipment_tasks(ship, changed_fields=['weight_net'])
