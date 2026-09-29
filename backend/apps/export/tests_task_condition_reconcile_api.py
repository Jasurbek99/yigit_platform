"""Tests that PATCHing a condition field re-decides the shipment's tasks.

The engine itself is covered in tests_task_condition_reconcile.py. This file
covers the wiring: that the view calls it, with the submitted keys as the gate,
and that doing so never moves the shipment's status.
"""
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import Customer, Season, ShipmentStatusType, User
from apps.export.models import (
    Shipment,
    ShipmentStatusLog,
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


def _make_season(name: str = 'cond-api') -> Season:
    # Season.name is CharField(max_length=10, unique=True).
    season, _ = Season.objects.get_or_create(
        name=name,
        defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True},
    )
    return season


def _make_status(code: str, step_order: int, phase: str = 'DRAFT') -> ShipmentStatusType:
    status, _ = ShipmentStatusType.objects.get_or_create(
        code=code,
        defaults={
            'name_tk': code, 'name_en': code, 'name_ru': code,
            'step_order': step_order, 'phase': phase,
        },
    )
    return status


def _make_rule(**kwargs) -> TaskRule:
    defaults = {
        'step': 'draft',
        'title_key': 'tasks.cond_api_test',
        'assignee_role': 'transport',
        'target_fields': 'driver_name',
        'completion_rule': TaskCompletionRule.MANUAL_DONE,
        'target_value': '',
        'deadline_rule': '',
        'condition_field': '',
        'condition_value': '',
        'is_active': True,
    }
    defaults.update(kwargs)
    return TaskRule.objects.create(**defaults)


class PatchReconcilesTests(TestCase):
    def setUp(self):
        _make_status('draft', 0)
        self.admin = _make_user('cond-api-admin', 'admin', is_superuser=True)
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

        self.regular_rule = _make_rule(
            title_key='tasks.assign_driver',
            condition_field='is_gapy_satys', condition_value='False',
        )
        self.gapy_rule = _make_rule(
            title_key='tasks.assign_driver',
            condition_field='is_gapy_satys', condition_value='True',
        )
        self.shipment = Shipment.objects.create(
            shipment_code='0301001/26',
            date='2026-01-15',
            season=_make_season(),
            status=_make_status('draft', 0),
            is_gapy_satys=False,
            # A destination, or it is a packing part with no draft tasks.
            customer=Customer.objects.create(name='cond-api customer'),
        )
        self.regular_task = Task.objects.create(
            shipment=self.shipment, step='draft', rule=self.regular_rule,
            title_key='tasks.assign_driver', assignee_role='transport',
            completion_rule=TaskCompletionRule.MANUAL_DONE,
            target_fields='driver_name', target_value='',
            state=TaskState.OPEN,
        )

    def test_patching_is_gapy_satys_swaps_the_task_set(self):
        response = self.client.patch(
            f'/api/v1/export/shipments/{self.shipment.id}/',
            {'is_gapy_satys': True}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)

        self.regular_task.refresh_from_db()
        self.assertEqual(self.regular_task.state, TaskState.CANCELLED)
        self.assertEqual(self.regular_task.cancelled_reason, TaskCancelReason.RULE_MISMATCH)
        self.assertTrue(
            Task.objects.filter(
                shipment=self.shipment, rule=self.gapy_rule, state=TaskState.OPEN,
            ).exists()
        )

    def test_reconcile_never_moves_the_status(self):
        """The regression test for the whole Safety section of the spec.

        The regular task is the only open auto-task at `draft`. Cancelling it
        makes the step trigger-satisfied (is_step_trigger_satisfied counts only
        OPEN/IN_PROGRESS). If the reconciler called auto_advance_if_ready, this
        PATCH would push the shipment to gumruk_girish.
        """
        _make_status('gumruk_girish', 1, phase='CUSTOMS')
        # An auto-resolving rule, so the step is a real auto-advance candidate.
        self.regular_rule.completion_rule = TaskCompletionRule.ALL_FIELDS_FILLED
        self.regular_rule.save(update_fields=['completion_rule'])
        self.regular_task.completion_rule = TaskCompletionRule.ALL_FIELDS_FILLED
        self.regular_task.save(update_fields=['completion_rule'])
        # The gapy rule is MANUAL_DONE, so nothing replaces the cancelled gate.
        log_count_before = ShipmentStatusLog.objects.filter(
            shipment=self.shipment,
        ).count()

        response = self.client.patch(
            f'/api/v1/export/shipments/{self.shipment.id}/',
            {'is_gapy_satys': True}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)

        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.status.code, 'draft')
        self.assertEqual(
            ShipmentStatusLog.objects.filter(shipment=self.shipment).count(),
            log_count_before,
        )

    def test_patch_sends_one_tasks_changed_notification_per_recipient(self):
        from apps.export.models import Notification

        transport = _make_user('cond-api-transport', 'transport')
        self.assertTrue(transport.is_active)

        self.client.patch(
            f'/api/v1/export/shipments/{self.shipment.id}/',
            {'is_gapy_satys': True}, format='json',
        )

        notifications = Notification.objects.filter(kind='tasks_changed')
        self.assertTrue(notifications.exists())
        self.assertIn(
            'transport',
            set(notifications.values_list('user__role', flat=True)),
        )

    def test_resubmitting_an_unchanged_condition_field_does_nothing(self):
        """The gate is the fields whose value changed, not the fields sent.

        A form that toggles a checkbox and back still submits it. With no open
        task for the regular rule (a legacy-exempt draft), a reconcile would
        create one and notify three roles for a no-op edit.
        """
        from apps.export.models import Notification

        self.regular_task.delete()

        response = self.client.patch(
            f'/api/v1/export/shipments/{self.shipment.id}/',
            {'is_gapy_satys': False}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)

        self.assertFalse(Task.objects.filter(shipment=self.shipment).exists())
        self.assertFalse(Notification.objects.filter(kind='tasks_changed').exists())


class TwoConditionFieldsInOnePatchTests(TestCase):
    """Review Focus 2.

    One PATCH can carry both is_gapy_satys and has_peregruz. Both rule
    families must be reconciled in the same pass, not just whichever the gate
    happened to match first.
    """

    def test_both_families_reconcile(self):
        _make_status('draft', 0)
        admin = _make_user('cond-api-two', 'admin', is_superuser=True)
        client = APIClient()
        client.force_authenticate(user=admin)

        gapy_false = _make_rule(
            title_key='tasks.regular_driver',
            condition_field='is_gapy_satys', condition_value='False',
        )
        peregruz_false = _make_rule(
            title_key='tasks.direct_arrival',
            condition_field='has_peregruz', condition_value='False',
        )
        gapy_true = _make_rule(
            title_key='tasks.gapy_driver',
            condition_field='is_gapy_satys', condition_value='True',
        )
        peregruz_true = _make_rule(
            title_key='tasks.transshipment',
            condition_field='has_peregruz', condition_value='True',
        )

        shipment = Shipment.objects.create(
            shipment_code='0301002/26', date='2026-01-15',
            season=_make_season(), status=_make_status('draft', 0),
            is_gapy_satys=False, has_peregruz=False,
            # A destination, or it is a packing part with no draft tasks.
            customer=Customer.objects.create(name='cond-api customer 2'),
        )
        old_tasks = [
            Task.objects.create(
                shipment=shipment, step='draft', rule=rule,
                title_key=rule.title_key, assignee_role=rule.assignee_role,
                completion_rule=TaskCompletionRule.MANUAL_DONE,
                target_fields=rule.target_fields, target_value='',
                state=TaskState.OPEN,
            )
            for rule in (gapy_false, peregruz_false)
        ]

        response = client.patch(
            f'/api/v1/export/shipments/{shipment.id}/',
            {'is_gapy_satys': True, 'has_peregruz': True}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)

        for task in old_tasks:
            task.refresh_from_db()
            self.assertEqual(task.state, TaskState.CANCELLED, task.title_key)
            self.assertEqual(task.cancelled_reason, TaskCancelReason.RULE_MISMATCH)

        for rule in (gapy_true, peregruz_true):
            self.assertTrue(
                Task.objects.filter(
                    shipment=shipment, rule=rule, state=TaskState.OPEN,
                ).exists(),
                f'no task created for {rule.title_key}',
            )


class OrdinaryPatchIsFreeTests(TestCase):
    """Review Focus 5.

    The overwhelmingly common PATCH touches no condition field. It must not
    write to any Task row - otherwise every Sheet cell edit churns tasks and
    spams three roles.
    """

    def test_patching_an_unrelated_field_touches_no_task(self):
        _make_status('draft', 0)
        admin = _make_user('cond-api-plain', 'admin', is_superuser=True)
        client = APIClient()
        client.force_authenticate(user=admin)

        rule = _make_rule(
            title_key='tasks.regular_driver',
            condition_field='is_gapy_satys', condition_value='False',
        )
        shipment = Shipment.objects.create(
            shipment_code='0301003/26', date='2026-01-15',
            season=_make_season(), status=_make_status('draft', 0),
            is_gapy_satys=False,
        )
        task = Task.objects.create(
            shipment=shipment, step='draft', rule=rule,
            title_key=rule.title_key, assignee_role='transport',
            completion_rule=TaskCompletionRule.MANUAL_DONE,
            target_fields='driver_name', target_value='',
            state=TaskState.OPEN,
        )
        state_before = (task.state, task.cancelled_reason)
        count_before = Task.objects.filter(shipment=shipment).count()

        # `notes` is in the Sheet's patchable field set and no rule conditions
        # on it - verified against serializers.py. The point is "a field no
        # rule cares about".
        response = client.patch(
            f'/api/v1/export/shipments/{shipment.id}/',
            {'notes': 'ordinary edit'}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)

        task.refresh_from_db()
        self.assertEqual((task.state, task.cancelled_reason), state_before)
        self.assertEqual(Task.objects.filter(shipment=shipment).count(), count_before)
        # The other half of the requirement, missed in the first draft: zero
        # writes AND zero notifications. Otherwise every Sheet cell edit pings
        # three roles.
        from apps.export.models import Notification
        self.assertFalse(
            Notification.objects.filter(kind='tasks_changed').exists(),
            'an ordinary edit must not notify anybody',
        )
