"""Tests for notify_tasks_changed (services/shipment.py).

Recipients are the roles owning the affected tasks, union the roles
STATUS_NOTIFY_ROLES already pings for the shipment's current step. For a Gapy
flip on a draft that is transport + document_team + export_manager.
"""
from django.test import TestCase

from apps.core.models import Season, ShipmentStatusType, User
from apps.export.models import (
    Notification,
    Shipment,
    Task,
    TaskCompletionRule,
    TaskRule,
    TaskState,
)
from apps.export.services.shipment import notify_tasks_changed


def _make_user(username: str, role: str) -> User:
    user = User(username=username, role=role)
    user.set_password('pass')
    user.save()
    return user


def _make_shipment(code: str) -> Shipment:
    # Season.name is CharField(max_length=10, unique=True).
    season, _ = Season.objects.get_or_create(
        name='notif-tst',
        defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True},
    )
    status, _ = ShipmentStatusType.objects.get_or_create(
        code='draft',
        defaults={
            'name_tk': 'draft', 'name_en': 'draft', 'name_ru': 'draft',
            'step_order': 0, 'phase': 'DRAFT',
        },
    )
    return Shipment.objects.create(
        shipment_code=code, date='2026-01-15', season=season, status=status,
    )


def _make_task(shipment, role: str, title_key: str) -> Task:
    rule = TaskRule.objects.create(
        step='draft', title_key=title_key, assignee_role=role,
        target_fields='driver_name',
        completion_rule=TaskCompletionRule.MANUAL_DONE,
        target_value='', deadline_rule='',
        condition_field='', condition_value='', is_active=True,
    )
    return Task.objects.create(
        shipment=shipment, step='draft', rule=rule, title_key=title_key,
        assignee_role=role, completion_rule=TaskCompletionRule.MANUAL_DONE,
        target_fields='driver_name', target_value='', state=TaskState.OPEN,
    )


class NotifyTasksChangedTests(TestCase):
    def setUp(self):
        self.transport = _make_user('n-transport', 'transport')
        self.doc_team = _make_user('n-docteam', 'document_team')
        self.export_mgr = _make_user('n-exportmgr', 'export_manager')
        self.sales = _make_user('n-sales', 'sales_rep')
        self.shipment = _make_shipment('0401001/26')

    def test_notifies_affected_roles_plus_step_roles(self):
        created = [_make_task(self.shipment, 'transport', 'tasks.gapy_driver')]
        cancelled = [_make_task(self.shipment, 'document_team', 'tasks.give_documents')]

        count = notify_tasks_changed(
            self.shipment,
            {'created': created, 'cancelled': cancelled, 'reopened': []},
        )

        self.assertEqual(count, 3)
        notified = set(
            Notification.objects.filter(kind='tasks_changed')
            .values_list('user__role', flat=True)
        )
        self.assertEqual(notified, {'transport', 'document_team', 'export_manager'})

    def test_empty_result_notifies_nobody(self):
        count = notify_tasks_changed(
            self.shipment, {'created': [], 'cancelled': [], 'reopened': []},
        )
        self.assertEqual(count, 0)
        self.assertFalse(Notification.objects.filter(kind='tasks_changed').exists())

    def test_message_names_the_shipment_and_link_points_at_it(self):
        created = [_make_task(self.shipment, 'transport', 'tasks.gapy_driver')]

        notify_tasks_changed(
            self.shipment, {'created': created, 'cancelled': [], 'reopened': []},
        )

        notification = Notification.objects.filter(kind='tasks_changed').first()
        self.assertIn(self.shipment.shipment_code, notification.message)
        self.assertEqual(notification.link, f'/shipments/{self.shipment.id}')

    def test_completed_gate_sale_does_not_ping_finance(self):
        """STATUS_NOTIFY_ROLES pings finansist at tamamlandy, but a Gapy-Satyş
        gate sale leaves finance nothing to act on (ADR-025) — the same
        suppression _notify_action_required applies."""
        _make_user('n-finance', 'finansist')
        done, _ = ShipmentStatusType.objects.get_or_create(
            code='tamamlandy',
            defaults={
                'name_tk': 'tamamlandy', 'name_en': 'tamamlandy', 'name_ru': 'tamamlandy',
                'step_order': 12, 'phase': 'COMPLETE',
            },
        )
        self.shipment.status = done
        self.shipment.is_gapy_satys = True
        self.shipment.save(update_fields=['status', 'is_gapy_satys'])
        created = [_make_task(self.shipment, 'transport', 'tasks.gapy_driver')]

        notify_tasks_changed(
            self.shipment, {'created': created, 'cancelled': [], 'reopened': []},
        )

        notified = set(
            Notification.objects.filter(kind='tasks_changed')
            .values_list('user__role', flat=True)
        )
        self.assertEqual(notified, {'transport'})
