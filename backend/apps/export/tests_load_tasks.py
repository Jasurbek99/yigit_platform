"""LOAD part of docs/Tasks.md (items 23–27), owner's decisions 2026-09-30.

23 / 27 are the garawul gate marks (services/gate.py), 24 / 25 existed. New: 26
«Ýükleme gutardy» — the loading department writes when loading ended; it holds
`yuklenme`, so a truck the guard already let out waits there until it is filled.
"""
import datetime
from datetime import timedelta
from io import StringIO

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from apps.core.models import GreenhouseBlock, ShipmentStatusType, TomatoVariety, User
from apps.export.models import (
    Shipment, ShipmentBlockSource, TaskCompletionRule, TaskRule, TaskState,
)
from apps.export.services.task_rules import generate_tasks_for_status
from apps.export.tests_auto_advance import _ensure_statuses, _make_season


class LoadingEndedTaskTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        _ensure_statuses()
        cls.user = User.objects.create_user(username='load_head', password='pw', role='loading_dept_head')
        cls.season = _make_season()
        cls.block, _ = GreenhouseBlock.objects.get_or_create(code='LD')
        cls.variety, _ = TomatoVariety.objects.get_or_create(name='Loadvar')

    def _loaded(self, code, *, gapy=False):
        """In `yuklenme` with 24 done (blocks, variety, net) — only 26 and the
        departure are left."""
        shipment = Shipment.objects.create(
            shipment_code=code, date=datetime.date(2026, 1, 1), season=self.season,
            status=ShipmentStatusType.objects.get(code='yuklenme'), is_gapy_satys=gapy,
            variety=self.variety, weight_net=18000, created_by=self.user, updated_by=self.user,
        )
        ShipmentBlockSource.objects.create(shipment=shipment, block=self.block, weight_kg=18000)
        generate_tasks_for_status(shipment, 'yuklenme')
        return shipment

    def _save(self, shipment, **fields):
        for name, value in fields.items():
            setattr(shipment, name, value)
        shipment.updated_by = self.user
        shipment.save()
        shipment.refresh_from_db()

    def test_the_rule(self):
        call_command('seed_task_rules', stdout=StringIO())
        rule = TaskRule.objects.get(step='yuklenme', title_key='tasks.loading_ended')
        self.assertEqual(
            (rule.assignee_role, rule.target_fields, rule.completion_rule, rule.is_active, rule.gates_step),
            ('loading_dept_head', 'loading_ended_at', TaskCompletionRule.ALL_FIELDS_FILLED, True, True),
        )
        self.assertIsNotNone(rule.effective_from)

    def test_a_truck_that_left_waits_for_the_loading_end(self):
        call_command('seed_task_rules', stdout=StringIO())
        shipment = self._loaded('LD-1')
        self._save(shipment, departed_at=timezone.now())            # the guard let it out
        self.assertEqual(shipment.status.code, 'yuklenme')
        self.assertEqual(shipment.tasks.get(title_key='tasks.loading_ended').state, TaskState.OPEN)
        self._save(shipment, loading_ended_at=timezone.now())       # the loading head writes R20
        self.assertEqual(shipment.status.code, 'yola_chykdy')

    def test_gapy_waits_too_then_closes(self):
        call_command('seed_task_rules', stdout=StringIO())
        shipment = self._loaded('LD-2', gapy=True)
        self._save(shipment, departed_at=timezone.now())
        self.assertEqual(shipment.status.code, 'yuklenme')
        self._save(shipment, loading_ended_at=timezone.now())
        self.assertEqual(shipment.status.code, 'tamamlandy')

    def test_a_truck_already_loading_at_deploy_leaves_as_before(self):
        shipment = self._loaded('LD-3')
        earlier = timezone.now() - timedelta(minutes=10)
        Shipment.objects.filter(pk=shipment.pk).update(created_at=earlier, status_changed_at=earlier)
        shipment.refresh_from_db()
        call_command('seed_task_rules', stdout=StringIO())
        generate_tasks_for_status(shipment, 'yuklenme')
        self.assertFalse(shipment.tasks.filter(title_key='tasks.loading_ended').exists())
        self._save(shipment, departed_at=timezone.now())
        self.assertEqual(shipment.status.code, 'yola_chykdy')
