"""System rollback to Preparation when a Planning trip's truck changes.

Spec: docs/superpowers/specs/2026-09-29-transport-trips-design.md §6.1.
"""
from django.test import TestCase
from django.utils import timezone

from apps.core.models import (
    BorderPoint, Country, Customer, ExportFirm, GreenhouseBlock, ImportFirm, ShipmentStatusType,
)
from apps.export.models import Shipment, ShipmentBlockSource, ShipmentFirmSplit, Task, TaskState
from apps.export.services.rollback import is_transport_locked, reopen_rule_task, rollback_to_draft
from apps.export.services.shipment import TRANSITIONS, transition_to
from apps.export.tests_auto_advance import _ensure_statuses, _make_season, _make_user, _seed_rules


def make_advanced_shipment(user) -> Shipment:
    """A regular shipment that auto-advanced out of draft into gumruk_girish.

    Module-level so apps.transport.tests.test_trip_change can reuse it.
    """
    country, _ = Country.objects.get_or_create(code='KZ', defaults={'name_tk': 'GAZAGYSTAN'})
    customer = Customer.objects.create(name='Berik')
    import_firm = ImportFirm.objects.create(name_company='Test IF', country=country)
    export_firm = ExportFirm.objects.create(code='Y', name_tk='YGT', name_en='YGT')
    block = GreenhouseBlock.objects.create(code='AA-1', name='AA-1')
    shipment = Shipment.objects.create(
        shipment_code='0101001/26', date='2026-01-01', season=_make_season(),
        status=ShipmentStatusType.objects.get(code='draft'),
        country=country, customer=customer, import_firm=import_firm,
        created_by=user, updated_by=user,
    )
    ShipmentFirmSplit.objects.create(shipment=shipment, export_firm=export_firm, weight_kg=10000)
    ShipmentBlockSource.objects.create(shipment=shipment, block=block, weight_kg=10000)
    from apps.export.services.task_rules import generate_tasks_for_status
    generate_tasks_for_status(shipment, 'draft')
    shipment.is_gapy_satys = False
    shipment.trip_id = 1
    shipment.truck_plate = '2563AHF/2251TAH'
    shipment.driver_name = 'Amandurdyyew Atajan'
    shipment.driver_phone = '99361202698'
    shipment.border_point = BorderPoint.objects.create(name='Farap')
    shipment.documents_status = 'ready'
    shipment.updated_by = user
    shipment.save()
    shipment.refresh_from_db()
    assert shipment.status.code == 'gumruk_girish', [
        (t.rule.title_key if t.rule else t.title_key, t.state) for t in shipment.tasks.all()
    ]
    return shipment


class RollbackTests(TestCase):
    """Builds a shipment that auto-advanced out of draft, then rolls it back."""

    def setUp(self):
        _ensure_statuses()
        _seed_rules()
        self.user = _make_user('doc', 'document_team')
        self.shipment = make_advanced_shipment(self.user)

    def _save(self, **fields):
        for name, value in fields.items():
            setattr(self.shipment, name, value)
        self.shipment.updated_by = self.user
        self.shipment.save()
        self.shipment.refresh_from_db()

    def test_backward_edge_is_not_in_the_public_table(self):
        self.assertNotIn('draft', [edge[0] for edge in TRANSITIONS['gumruk_girish']])

    def test_rollback_flag_required(self):
        with self.assertRaises(ValueError):
            transition_to(self.shipment, 'draft', self.user, is_auto=True)

    def test_rollback_needs_is_auto(self):
        with self.assertRaises(ValueError):
            transition_to(self.shipment, 'draft', self.user, rollback=True)

    def test_rollback_lands_in_draft_and_logs_reason(self):
        rollback_to_draft(self.shipment, self.user, 'Transport changed: A → B')
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.status.code, 'draft')
        self.assertEqual(self.shipment.documents_status, 'in_progress')
        self.assertEqual(self.shipment.status_log.latest('id').comment, 'Transport changed: A → B')

    def test_save_after_rollback_does_not_auto_advance(self):
        rollback_to_draft(self.shipment, self.user, 'x')
        self.shipment.refresh_from_db()
        self._save(driver_phone='99365000000')
        self.assertEqual(self.shipment.status.code, 'draft')
        task = Task.objects.get(shipment=self.shipment, rule__title_key='tasks.start_documents_prep')
        self.assertEqual(task.state, TaskState.OPEN)

    def test_rollback_from_customs_exit_clears_customs_exit(self):
        self._save(customs_exit_at=timezone.now())
        self.assertEqual(self.shipment.status.code, 'gumruk_chykysh')
        rollback_to_draft(self.shipment, self.user, 'x')
        self.shipment.refresh_from_db()
        self.assertIsNone(self.shipment.customs_exit_at)
        self.assertEqual(self.shipment.status.code, 'draft')

    def test_redone_documents_stop_at_customs_after_rollback_from_customs_exit(self):
        """The cascade must not replay gumruk_girish → gumruk_chykysh on stale DONE tasks."""
        self._save(customs_exit_at=timezone.now())
        self.assertEqual(self.shipment.status.code, 'gumruk_chykysh')
        rollback_to_draft(self.shipment, self.user, 'x')
        self.shipment.refresh_from_db()
        self._save(documents_status='ready')
        self.assertEqual(self.shipment.status.code, 'gumruk_girish')
        task = Task.objects.get(shipment=self.shipment, rule__title_key='tasks.trigger_customs_exit')
        self.assertEqual(task.state, TaskState.OPEN)

    def test_locked_rules(self):
        self.assertFalse(is_transport_locked(self.shipment))
        self.shipment.status = ShipmentStatusType.objects.get(code='yuklenme')
        self.assertFalse(is_transport_locked(self.shipment))
        self.shipment.loading_started_at = timezone.now()
        self.assertTrue(is_transport_locked(self.shipment))
        self.shipment.loading_started_at = None
        self.shipment.status = ShipmentStatusType.objects.get(code='yola_chykdy')
        self.assertTrue(is_transport_locked(self.shipment))

    def test_reopen_rule_task_returns_false_when_absent(self):
        self.assertFalse(reopen_rule_task(self.shipment, 'tasks.no_such_task'))
