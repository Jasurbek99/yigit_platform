"""Legacy DB-only rules that duplicate the PREP/DOCS chain (owner, 2026-09-30).

`send_documents_to_customs` (≈ 21b), `docs_back_to_office` (≈ 22) and
`finalize_sale` were never in seed_task_rules, so seeding left them active and
they kept creating Mark Done cards next to the new chain. The seed now carries
them inactive, and `cancel_retired_duplicate_tasks` cancels their open cards.
"""
from io import StringIO

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from apps.core.models import Season, ShipmentStatusType, User
from apps.export.models import Shipment, Task, TaskCancelReason, TaskRule, TaskState
from apps.export.services.task_rules import create_rule_task
from apps.export.tests_auto_advance import _ensure_statuses

DUPLICATES = ('tasks.send_documents_to_customs', 'tasks.docs_back_to_office', 'tasks.finalize_sale')


class RetiredDuplicatesTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        _ensure_statuses()
        call_command('seed_task_rules', stdout=StringIO())
        cls.user = User.objects.create_user(username='rd_doc', password='pw', role='document_team')
        cls.season, _ = Season.objects.get_or_create(
            name='rd-26', defaults={'start_date': '2025-09-01', 'end_date': '2026-12-31', 'is_active': True})

    def _task(self, shipment, title_key, state=TaskState.OPEN, **rule_filter):
        rule = TaskRule.objects.get(title_key=title_key, **rule_filter)
        return create_rule_task(
            shipment=shipment, step=rule.step, rule=rule, title_key=title_key,
            assignee_role=rule.assignee_role, target_fields=rule.target_fields,
            completion_rule=rule.completion_rule, target_value='', deadline=None,
            deadline_rule=rule.deadline_rule, state=state,
        )

    def _shipment(self, code, season=None):
        return Shipment.objects.create(
            shipment_code=code, date='2026-01-01', season=season or self.season,
            status=ShipmentStatusType.objects.get(code='gumruk_girish'),
            created_by=self.user, updated_by=self.user,
        )

    def test_the_seed_keeps_the_duplicates_inactive(self):
        for title_key in DUPLICATES:
            self.assertFalse(TaskRule.objects.get(title_key=title_key).is_active, title_key)

    def test_the_command_cancels_only_the_duplicates_open_cards(self):
        s = self._shipment('RD-1')
        open_dup = [self._task(s, t) for t in DUPLICATES]
        done_dup = self._task(self._shipment('RD-2'), 'tasks.send_documents_to_customs', TaskState.DONE)
        # An in-flight shipment's old GATE must stay: cancelling it would free the step.
        old_gate = self._task(self._shipment('RD-3'), 'tasks.trigger_customs_exit')

        call_command('cancel_retired_duplicate_tasks', '--dry-run', stdout=StringIO())
        self.assertTrue(all(Task.objects.get(pk=t.pk).state == TaskState.OPEN for t in open_dup))

        out = StringIO()
        call_command('cancel_retired_duplicate_tasks', stdout=out)
        for task in open_dup:
            task.refresh_from_db()
            self.assertEqual((task.state, task.cancelled_reason),
                             (TaskState.CANCELLED, TaskCancelReason.RULE_DEACTIVATED))
        self.assertEqual(Task.objects.get(pk=done_dup.pk).state, TaskState.DONE)
        self.assertEqual(Task.objects.get(pk=old_gate.pk).state, TaskState.OPEN)
        self.assertIn('3', out.getvalue())

    def test_a_closed_season_is_left_alone(self):
        closed = Season.objects.create(name='rd-old', start_date='2024-09-01', end_date='2025-06-30',
                                       is_active=False, closed_at=timezone.now())
        task = self._task(self._shipment('RD-4', season=closed), 'tasks.docs_back_to_office')
        call_command('cancel_retired_duplicate_tasks', stdout=StringIO())
        self.assertEqual(Task.objects.get(pk=task.pk).state, TaskState.OPEN)
