"""PREP / DOCS catalog end to end (spec 2026-09-30 §2; docs/Tasks.md 5b–22)."""
from datetime import timedelta
from decimal import Decimal
from io import StringIO

from django.core.management import call_command
from django.utils import timezone

from apps.core.models import Country, Customer, ExportFirm, ImportFirm, ShipmentOptionType
from apps.export.models import (
    FinansistAdvance, FinansistAdvanceShipment, PackingTemplate, Shipment, ShipmentFirmSplit,
    ShipmentStatusLog, TaskRule, TaskState,
)
from apps.export.services.task_chain import record_document_download, refresh_tasks_after_write
from apps.export.services.task_rules import create_rule_task, generate_tasks_for_status
from apps.export.tests_task_chain import ChainFixture

DOCS_CHAIN_BUTTONS = ('tasks.ct1_phyto_sent', 'tasks.docs_to_stamp', 'tasks.docs_from_stamp',
                      'tasks.prepare_declaration')


def _seed():
    call_command('seed_task_rules', stdout=StringIO())


def _backdate(shipment, minutes=10):
    """The shipment entered its step before the catalog was deployed."""
    earlier = timezone.now() - timedelta(minutes=minutes)
    Shipment.objects.filter(pk=shipment.pk).update(created_at=earlier, status_changed_at=earlier)
    ShipmentStatusLog.objects.filter(shipment=shipment).update(changed_at=earlier)
    shipment.refresh_from_db()


def _old_task(shipment, title_key, **rule_filter):
    """A task the OLD catalog generated at step entry (its rule is inactive now)."""
    rule = TaskRule.objects.get(title_key=title_key, **rule_filter)
    return create_rule_task(
        shipment=shipment, step=rule.step, rule=rule, title_key=rule.title_key,
        assignee_role=rule.assignee_role, target_fields=rule.target_fields,
        completion_rule=rule.completion_rule, target_value=rule.target_value,
        deadline=None, deadline_rule=rule.deadline_rule, state=TaskState.OPEN,
    )


class PrepDocsCatalogTests(ChainFixture):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.country, _ = Country.objects.get_or_create(
            code='PD', defaults={'name_tk': 'Pd', 'name_en': 'Pd', 'name_ru': 'Pd'})
        cls.customer, _ = Customer.objects.get_or_create(name='PD customer')
        cls.import_firm, _ = ImportFirm.objects.get_or_create(code='PDIMP', defaults={'name_company': 'PD imp'})
        cls.export_firm, _ = ExportFirm.objects.get_or_create(code='PDEXP', defaults={'name_tk': 'PD exp'})
        cls.template = PackingTemplate.objects.create(name='PD 18t', net_kg=Decimal('18000'))
        ShipmentOptionType.objects.get_or_create(
            category='documents_status', code='Gümrükden geldi',
            defaults={'label_tk': 'Gümrükden geldi', 'is_active': True})

    def _destination(self, code='draft', **extra):
        return self._at(code, country=self.country, customer=self.customer, import_firm=self.import_firm, **extra)

    def _titles(self, s, state=None):
        qs = s.tasks.all() if state is None else s.tasks.filter(state=state)
        return set(qs.values_list('title_key', flat=True))

    def _save(self, s, **fields):
        for name, value in fields.items():
            setattr(s, name, value)
        s.updated_by = self.user
        s.save()
        s.refresh_from_db()

    def _walk_docs(self, s):
        """gumruk_girish → gumruk_chykysh through the new chain."""
        self._save(s, packing_template=self.template)
        self._press(s, 'tasks.prepare_contract')
        self._press(s, 'tasks.prepare_transport_docs')
        self.assertEqual(s.documents_status, 'in_progress')
        record_document_download(s, ['cmr', 'tir', 'ct1', 'phyto', 'customs_request'], self.user)
        for title in DOCS_CHAIN_BUTTONS:
            self._press(s, title)
        self.assertEqual(s.status.code, 'gumruk_girish')          # waits for the advance
        advance = FinansistAdvance.objects.create(
            advance_date='2026-01-15', total_amount=Decimal('1000'), currency='USD', issued_by=self.user)
        FinansistAdvanceShipment.objects.create(advance=advance, shipment=s)
        refresh_tasks_after_write(s, self.user)
        self.assertEqual(s.tasks.get(title_key='tasks.docs_to_customs').state, TaskState.OPEN)
        self._press(s, 'tasks.docs_to_customs')
        self.assertEqual(s.status.code, 'gumruk_chykysh')

    def test_regular_path_draft_to_gumruk_chykysh(self):
        _seed()
        s = self._destination()
        generate_tasks_for_status(s, 'draft')
        self.assertEqual(
            self._titles(s),
            {'tasks.set_destination', 'tasks.pick_export_firms', 'tasks.choose_truck', 'tasks.join_supply'},
        )
        ShipmentFirmSplit.objects.create(shipment=s, export_firm=self.export_firm, weight_kg=Decimal('18000'))
        self._save(s, truck_head_id=7)
        self.assertEqual(s.status.code, 'gumruk_girish')
        self.assertEqual(
            self._titles(s, TaskState.OPEN),
            {'tasks.join_supply', 'tasks.prepare_contract', 'tasks.fill_gross_net',
             'tasks.prepare_transport_docs', 'tasks.give_advance'},
        )

        self._walk_docs(s)
        self.assertIn('tasks.docs_from_customs', self._titles(s, TaskState.OPEN))
        self._save(s, customs_exit_at=timezone.now())
        self.assertEqual(s.tasks.get(title_key='tasks.docs_from_customs').state, TaskState.DONE)
        self.assertEqual(s.documents_status, 'Gümrükden geldi')

    def test_gapy_path_uses_assign_driver(self):
        _seed()
        s = self._destination(is_gapy_satys=True)
        generate_tasks_for_status(s, 'draft')
        self.assertEqual(
            self._titles(s),
            {'tasks.set_destination', 'tasks.pick_export_firms', 'tasks.assign_driver', 'tasks.join_supply'},
        )
        self.assertEqual(s.tasks.get(title_key='tasks.assign_driver').assignee_role, 'document_team')
        ShipmentFirmSplit.objects.create(shipment=s, export_firm=self.export_firm, weight_kg=Decimal('18000'))
        self._save(s, driver_name='Aman', truck_plate='AG 1234')
        self.assertEqual(s.status.code, 'draft')                    # phone still missing
        self._save(s, driver_phone='+99365000000')
        self.assertEqual(s.status.code, 'gumruk_girish')
        self.assertIn('tasks.prepare_transport_docs', self._titles(s, TaskState.OPEN))

    def test_deploy_crossing_shipment_reaches_customs_exit_on_the_new_chain(self):
        s = self._destination()
        _backdate(s)
        _seed()
        # What the old catalog gave this draft at step entry.
        for title, extra in (('tasks.set_destination', {}), ('tasks.pick_export_firms', {}),
                             ('tasks.assign_driver', {'condition_value': 'False'}),
                             ('tasks.set_border_point', {}), ('tasks.start_documents_prep', {})):
            _old_task(s, title, **extra)
        generate_tasks_for_status(s, 'draft')
        self.assertNotIn('tasks.choose_truck', self._titles(s))     # not effective for it
        ShipmentFirmSplit.objects.create(shipment=s, export_firm=self.export_firm, weight_kg=Decimal('18000'))
        from apps.core.models import BorderPoint
        border = BorderPoint.objects.create(name='PD border')
        self._save(s, driver_name='Aman', driver_phone='+99365000000', truck_plate='AG 1234',
                   border_point=border, documents_status='ready')
        self.assertEqual(s.status.code, 'gumruk_girish')
        self.assertTrue({'tasks.prepare_contract', 'tasks.fill_gross_net', 'tasks.prepare_transport_docs'}
                        <= self._titles(s, TaskState.OPEN))
        self._walk_docs(s)

    def test_in_flight_customs_shipment_finishes_on_its_old_task(self):
        s = self._at('gumruk_girish')
        ShipmentStatusLog.objects.create(shipment=s, status=s.status, changed_by=self.user)
        _backdate(s)
        _seed()
        _old_task(s, 'tasks.trigger_customs_exit')
        generate_tasks_for_status(s, 'gumruk_girish')
        self.assertEqual(self._titles(s), {'tasks.trigger_customs_exit'})
        self._save(s, customs_exit_at=timezone.now())
        self.assertEqual(s.status.code, 'gumruk_chykysh')

    def test_a_packing_move_on_an_in_flight_customs_truck_adds_no_new_tasks(self):
        s = self._at('gumruk_girish')
        _backdate(s)
        _seed()
        _old_task(s, 'tasks.trigger_customs_exit')
        generate_tasks_for_status(s, 'gumruk_girish')
        # A swap / join after deploy writes a same-status log row (packaging.swap_packing).
        ShipmentStatusLog.objects.create(shipment=s, status=s.status, changed_by=self.user,
                                         comment='Packing swapped with X')
        self._save(s, customs_exit_at=timezone.now())
        self.assertEqual(s.status.code, 'gumruk_chykysh')
        self.assertEqual(set(s.tasks.filter(step='gumruk_girish').values_list('title_key', flat=True)),
                         {'tasks.trigger_customs_exit'})

    def test_a_join_on_an_in_flight_draft_does_not_hold_it(self):
        from apps.export.services.task_chain import has_pending_dependents
        s = self._destination()
        _backdate(s)
        _seed()
        for title in ('tasks.set_destination', 'tasks.pick_export_firms'):
            _old_task(s, title)
        s.tasks.update(state=TaskState.DONE)
        ShipmentStatusLog.objects.create(shipment=s, status=s.status, changed_by=self.user,
                                         comment='Joined supply from X')
        self.assertFalse(has_pending_dependents(s))
