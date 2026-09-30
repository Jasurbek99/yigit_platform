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


TRUCK_DOCS = (
    'tasks.prepare_transport_docs', 'tasks.print_cmr', 'tasks.print_tir', 'tasks.print_ct1',
    'tasks.print_phyto', 'tasks.ct1_phyto_sent', 'tasks.print_customs_request', 'tasks.docs_to_stamp',
    'tasks.docs_from_stamp', 'tasks.prepare_declaration', 'tasks.docs_to_customs',
)


def walk_customs_docs(shipment, user):
    """Close the DOCS chain of gumruk_girish in order, as the buttons would,
    until the shipment is at gumruk_chykysh."""
    from apps.export.services.task_chain import after_task_done
    for _ in range(20):
        open_tasks = list(shipment.tasks.filter(step='gumruk_girish',
                                                state__in=[TaskState.OPEN, TaskState.IN_PROGRESS]))
        if not open_tasks:
            break
        Task.objects.filter(pk__in=[t.pk for t in open_tasks]).update(
            state=TaskState.DONE, completed_at=timezone.now())
        after_task_done(shipment, user, open_tasks)
        shipment.refresh_from_db()
    assert shipment.status.code == 'gumruk_chykysh', shipment.status.code


def state_of(shipment, title_key):
    return Task.objects.get(shipment=shipment, rule__title_key=title_key).state


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
        self.assertEqual(state_of(self.shipment, 'tasks.prepare_transport_docs'), TaskState.OPEN)

    def test_rollback_from_customs_exit_clears_customs_exit(self):
        walk_customs_docs(self.shipment, self.user)
        self._save(customs_exit_at=timezone.now())
        self.assertEqual(self.shipment.status.code, 'gumruk_chykysh')
        rollback_to_draft(self.shipment, self.user, 'x')
        self.shipment.refresh_from_db()
        self.assertIsNone(self.shipment.customs_exit_at)
        self.assertEqual(self.shipment.status.code, 'draft')

    def test_redone_documents_stop_at_customs_after_rollback_from_customs_exit(self):
        """The cascade must not replay gumruk_girish → gumruk_chykysh on stale DONE tasks."""
        walk_customs_docs(self.shipment, self.user)
        self._save(customs_exit_at=timezone.now())
        rollback_to_draft(self.shipment, self.user, 'x')
        self.shipment.refresh_from_db()
        transition_to(self.shipment, 'gumruk_girish', self.user)        # Promote
        self._save(documents_status='ready')
        self.assertEqual(self.shipment.status.code, 'gumruk_girish')
        self.assertEqual(state_of(self.shipment, 'tasks.docs_to_customs'), TaskState.OPEN)

    def test_rollback_reopens_the_truck_documents_and_the_advance(self):
        """Owner, 2026-09-30: 11 and everything after it, 22 and the advance are
        redone; the contract (9) and gross/net (10) do not depend on the truck."""
        walk_customs_docs(self.shipment, self.user)
        self._save(customs_exit_at=timezone.now())
        rollback_to_draft(self.shipment, self.user, 'x')
        self.shipment.refresh_from_db()
        for title in TRUCK_DOCS + ('tasks.give_advance', 'tasks.docs_from_customs'):
            self.assertEqual(state_of(self.shipment, title), TaskState.OPEN, title)
        for title in ('tasks.prepare_contract', 'tasks.fill_gross_net'):
            self.assertEqual(state_of(self.shipment, title), TaskState.DONE, title)
        self.assertIsNotNone(self.shipment.documents_reset_at)

    def test_a_download_from_before_the_rollback_does_not_count(self):
        from apps.export.services.task_chain import record_document_download
        walk_customs_docs(self.shipment, self.user)
        record_document_download(self.shipment, ['cmr'], self.user)     # the old truck's CMR
        rollback_to_draft(self.shipment, self.user, 'x')
        self.shipment.refresh_from_db()
        transition_to(self.shipment, 'gumruk_girish', self.user)
        self.shipment.refresh_from_db()
        self.assertEqual(state_of(self.shipment, 'tasks.print_cmr'), TaskState.OPEN)
        record_document_download(self.shipment, ['cmr'], self.user)     # the new truck's CMR
        self.assertEqual(state_of(self.shipment, 'tasks.print_cmr'), TaskState.DONE)

    def test_the_old_advance_is_kept_and_a_second_one_is_needed(self):
        from apps.export.models import FinansistAdvance, FinansistAdvanceShipment
        from apps.export.services.task_chain import refresh_tasks_after_write

        def give_advance():
            advance = FinansistAdvance.objects.create(
                advance_date='2026-01-15', total_amount=1000, currency='USD', issued_by=self.user)
            FinansistAdvanceShipment.objects.create(advance=advance, shipment=self.shipment)
            refresh_tasks_after_write(self.shipment, self.user)

        give_advance()
        self.assertEqual(state_of(self.shipment, 'tasks.give_advance'), TaskState.DONE)
        rollback_to_draft(self.shipment, self.user, 'x')
        self.shipment.refresh_from_db()
        refresh_tasks_after_write(self.shipment, self.user)
        self.assertEqual(state_of(self.shipment, 'tasks.give_advance'), TaskState.OPEN)
        give_advance()
        self.assertEqual(state_of(self.shipment, 'tasks.give_advance'), TaskState.DONE)
        self.assertEqual(self.shipment.advance_links.count(), 2)

    def test_sending_the_documents_to_customs_again_clears_the_mark(self):
        walk_customs_docs(self.shipment, self.user)
        rollback_to_draft(self.shipment, self.user, 'x')
        self.shipment.refresh_from_db()
        transition_to(self.shipment, 'gumruk_girish', self.user)
        self.shipment.refresh_from_db()
        walk_customs_docs(self.shipment, self.user)
        self.assertIsNone(self.shipment.documents_reset_at)

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

    def test_rollback_audits_the_cleared_fields(self):
        from apps.export.models import AuditLog
        walk_customs_docs(self.shipment, self.user)
        self._save(customs_exit_at=timezone.now(), documents_status='ready')
        rollback_to_draft(self.shipment, self.user, 'x')
        fields = set(AuditLog.objects.filter(object_id=self.shipment.pk).values_list('field_name', flat=True))
        self.assertIn('customs_exit_at', fields)
        self.assertIn('documents_status', fields)


class RollbackMarkFieldsTests(TestCase):
    """The rollback mark reaches the Sheet, «Подготовка», the card and My tasks
    (owner, 2026-09-30)."""

    def setUp(self):
        _ensure_statuses()
        _seed_rules()
        self.user = _make_user('doc_mark', 'document_team')
        self.shipment = make_advanced_shipment(self.user)
        walk_customs_docs(self.shipment, self.user)
        rollback_to_draft(self.shipment, self.user, 'x')
        self.shipment.refresh_from_db()

    def test_list_detail_and_sheet_carry_the_stamp(self):
        from apps.export.serializers import (
            ShipmentDetailSerializer, ShipmentListSerializer, ShipmentSheetSerializer,
        )
        context = {'request': type('R', (), {'user': self.user})()}
        for serializer in (ShipmentListSerializer, ShipmentDetailSerializer, ShipmentSheetSerializer):
            self.assertIsNotNone(serializer(self.shipment, context=context).data['documents_reset_at'],
                                 serializer.__name__)

    def test_only_the_reopened_document_tasks_are_marked(self):
        from apps.export.serializers import TaskListSerializer
        marks = {t.title_key: TaskListSerializer(t).data['documents_redo'] for t in self.shipment.tasks.all()}
        self.assertTrue(marks['tasks.print_cmr'])
        self.assertTrue(marks['tasks.give_advance'])
        self.assertFalse(marks['tasks.prepare_contract'])
        self.assertFalse(marks['tasks.set_destination'])
