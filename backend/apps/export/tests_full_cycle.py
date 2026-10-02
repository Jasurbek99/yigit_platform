"""The whole docs/Tasks.md cycle, driven only through tasks (2026-09-30).

A regular and a gapy shipment go from «Подготовка» to closed. At every step
the test checks which tasks are open, then does exactly what the owner of each
task would do — fill the field on the Sheet (Shipment.save), press the task's
button (POST /tasks/{id}/complete/), download a document, give an advance
(POST /advances/), the guard's gate marks, save and approve the sales report.
No status is ever set by hand: every move is the engine's auto-advance.
"""
import datetime
from decimal import Decimal
from io import StringIO

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import (
    City, Country, Customer, ExportFirm, GreenhouseBlock, ImportFirm, LoadingLocation,
    ShipmentOptionType, TomatoVariety, User,
)
from apps.export.models import PackingTemplate, Shipment, ShipmentBlockSource, ShipmentFirmSplit, TaskState
from apps.export.services import gate
from apps.export.services.task_chain import record_document_download
from apps.export.services.task_rules import generate_tasks_for_status
from apps.export.tests_auto_advance import _ensure_statuses, _make_season

PRINT_DOCS = ['cmr', 'tir', 'ct1', 'phyto', 'customs_request']
# The guard's «mark arrival» card: open from the moment the plated truck has its
# packing (owner, 2026-10-01) until the gate arrival.
ARRIVE = 'tasks.gate_arrive'


class FullCycleThroughTasksTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        _ensure_statuses()
        call_command('seed_permissions', stdout=StringIO())
        call_command('seed_task_rules', stdout=StringIO())
        cls.season = _make_season()
        mk = User.objects.create_user
        cls.em = mk(username='fc_em', password='pw', role='export_manager')
        cls.doc = mk(username='fc_doc', password='pw', role='document_team')
        cls.fin = mk(username='fc_fin', password='pw', role='finansist')
        cls.head = mk(username='fc_head', password='pw', role='loading_dept_head')
        cls.transport = mk(username='fc_tr', password='pw', role='transport')
        cls.rep = mk(username='fc_rep', password='pw', role='sales_rep')
        cls.qi = mk(username='fc_qi', password='pw', role='quality_inspector')
        cls.dusak = LoadingLocation.objects.create(name='FC Dusak')
        cls.guard = mk(username='fc_guard', password='pw', role='garawul', loading_location=cls.dusak)
        cls.block = GreenhouseBlock.objects.create(code='FCB', location=cls.dusak)
        cls.country, _ = Country.objects.get_or_create(
            code='FC', defaults={'name_tk': 'Fc', 'name_en': 'Fc', 'name_ru': 'Fc'})
        cls.city = City.objects.create(country=cls.country, name='FC City')
        cls.customer = Customer.objects.create(name='FC customer')
        cls.import_firm = ImportFirm.objects.create(name_company='FC import', country=cls.country)
        cls.export_firm = ExportFirm.objects.create(code='FCX', name_tk='FC export')
        cls.template = PackingTemplate.objects.create(name='FC 18t', net_kg=Decimal('18000'))
        cls.variety = TomatoVariety.objects.create(name='FC Pink')
        ShipmentOptionType.objects.get_or_create(
            category='documents_status', code='Gümrükden geldi',
            defaults={'label_tk': 'Gümrükden geldi', 'is_active': True})

    # ── how people act ────────────────────────────────────────────────────────
    def open_tasks(self, s):
        return set(s.tasks.filter(state__in=[TaskState.OPEN, TaskState.IN_PROGRESS])
                   .values_list('title_key', flat=True))

    def fill(self, s, user, **fields):
        """A Sheet cell edit: the field is written and the shipment saved."""
        for name, value in fields.items():
            setattr(s, name, value)
        s.updated_by = user
        s.save()
        s.refresh_from_db()

    def press(self, s, title, user):
        """The task's own button on My Tasks."""
        client = APIClient()
        client.force_authenticate(user)
        task = s.tasks.get(title_key=title)
        resp = client.post(f'/api/v1/export/tasks/{task.pk}/complete/')
        self.assertEqual(resp.status_code, 200, (title, resp.content[:300]))
        s.refresh_from_db()

    def start(self, s, title, user):
        """A card button that starts the task first (quality: «Upload certificates»)."""
        client = APIClient()
        client.force_authenticate(user)
        task = s.tasks.get(title_key=title)
        resp = client.post(f'/api/v1/export/tasks/{task.pk}/start/')
        self.assertEqual(resp.status_code, 200, (title, resp.content[:300]))

    def api(self, user, path, data=None):
        client = APIClient()
        client.force_authenticate(user)
        resp = client.post(path, data or {}, format='json')
        self.assertIn(resp.status_code, (200, 201), (path, resp.content[:300]))
        return resp

    def expect(self, s, status, open_now):
        s.refresh_from_db()
        self.assertEqual(s.status.code, status)
        self.assertEqual(self.open_tasks(s), set(open_now), status)

    # ── the shared part: DOCS (9–22) and LOAD (23–27) ─────────────────────────
    def docs_and_load(self, s, *, transport_task):
        self.expect(s, 'gumruk_girish', {'tasks.prepare_contract', 'tasks.fill_gross_net',
                                         'tasks.prepare_transport_docs', 'tasks.give_advance',
                                         ARRIVE})
        self.fill(s, self.doc, packing_template=self.template)                  # 10
        self.press(s, 'tasks.prepare_contract', self.doc)                      # 9
        self.press(s, 'tasks.prepare_transport_docs', self.doc)                # 11
        self.assertEqual(s.documents_status, 'in_progress')
        self.expect(s, 'gumruk_girish', {'tasks.give_advance', 'tasks.print_cmr', 'tasks.print_tir', ARRIVE})
        record_document_download(s, PRINT_DOCS, self.doc)                      # 12–15, 17
        self.expect(s, 'gumruk_girish', {'tasks.give_advance', 'tasks.ct1_phyto_sent', ARRIVE})
        for title in ('tasks.ct1_phyto_sent', 'tasks.docs_to_stamp', 'tasks.docs_from_stamp',
                      'tasks.prepare_declaration'):                            # 16, 18, 19, 21a
            self.press(s, title, self.doc)
        self.expect(s, 'gumruk_girish', {'tasks.give_advance', ARRIVE})       # 21b waits for 20
        self.api(self.fin, '/api/v1/export/advances/', {                       # 20
            'advance_date': '2026-01-15', 'total_amount': '1000', 'currency': 'USD', 'shipment_ids': [s.pk]})
        self.expect(s, 'gumruk_girish', {'tasks.docs_to_customs', ARRIVE})
        self.press(s, 'tasks.docs_to_customs', self.doc)                       # 21b
        self.expect(s, 'gumruk_chykysh', {'tasks.docs_from_customs', ARRIVE})
        self.fill(s, self.doc, customs_exit_at=timezone.now())                 # 22
        self.assertEqual(s.documents_status, 'Gümrükden geldi')
        self.expect(s, 'gumruk_chykysh', {ARRIVE})                             # loading waits for 23

        gate.arrive(s.pk, self.dusak, self.guard)                              # 23
        self.expect(s, 'gumruk_chykysh', {'tasks.trigger_loading_start',
                                          'tasks.gate_depart'})         # the guard's own card
        self.fill(s, self.head, loading_started_at=timezone.now())             # 24 start
        self.expect(s, 'yuklenme', {'tasks.fill_loading_data', 'tasks.quality_inspection',
                                    'tasks.trigger_departure', 'tasks.gate_depart'})
        self.fill(s, self.head, variety=self.variety, weight_net=Decimal('18000'))   # 24 data
        self.expect(s, 'yuklenme', {'tasks.loading_ended', 'tasks.quality_inspection',
                                    'tasks.trigger_departure', 'tasks.gate_depart'})
        self.start(s, 'tasks.quality_inspection', self.qi)                     # 25 «Upload certificates»
        self.press(s, 'tasks.quality_inspection', self.qi)                     # 25
        gate.depart(s.pk, self.dusak, self.guard)                              # 27 before 26
        self.expect(s, 'yuklenme', {'tasks.loading_ended'})
        self.fill(s, self.head, loading_ended_at=timezone.now())               # 26 → leaves

    def new_shipment(self, code, **extra):
        """«Подготовка»: the export manager opens it with the destination (5b)."""
        s = Shipment.objects.create(
            shipment_code=code, date=timezone.localdate(), season=self.season,
            status_id=Shipment._meta.get_field('status').related_model.objects.get(code='draft').pk,
            country=self.country, customer=self.customer, import_firm=self.import_firm,
            truck_plate='FC 1234', created_by=self.em, updated_by=self.em, **extra,
        )
        generate_tasks_for_status(s, 'draft')
        return s

    def prep(self, s, *, transport_task, transport_fields):
        self.expect(s, 'draft', {'tasks.join_supply', 'tasks.pick_export_firms', transport_task})
        ShipmentBlockSource.objects.create(shipment=s, block=self.block, weight_kg=Decimal('18000'))
        ShipmentFirmSplit.objects.create(shipment=s, export_firm=self.export_firm, weight_kg=Decimal('18000'))
        self.fill(s, self.doc)                                                 # 6, 7 close on save
        self.expect(s, 'draft', {transport_task, ARRIVE})   # plated truck + packing: on the gate
        self.fill(s, self.em, **transport_fields)                              # 8
        self.assertEqual(s.status.code, 'gumruk_girish')

    # ── the two paths ─────────────────────────────────────────────────────────
    def test_a_regular_shipment_closes_through_tasks_only(self):
        s = self.new_shipment('FC-1')
        self.prep(s, transport_task='tasks.choose_truck', transport_fields={'trip_id': 77})
        self.docs_and_load(s, transport_task='tasks.choose_truck')

        self.expect(s, 'yola_chykdy', {'tasks.trigger_border_crossing'})
        self.fill(s, self.transport, border_crossed_at=timezone.now())         # 28
        self.fill(s, self.rep, dest_entry_at=timezone.now())                   # 29
        self.expect(s, 'dest_entry', {'tasks.trigger_dest_customs'})
        self.fill(s, self.rep, customs_entry_at=timezone.now())                # 30
        self.expect(s, 'dest_entry', {'tasks.ask_peregruz'})
        self.fill(s, self.rep, has_peregruz=False)                             # 31
        self.fill(s, self.rep, arrived_at=timezone.now())                      # 33
        self.expect(s, 'bardy', {'tasks.trigger_sale_start'})
        self.fill(s, self.rep, sale_started_at=timezone.now())                 # 34
        self.expect(s, 'bardy', {'tasks.confirm_destination'})                # city after 34
        self.fill(s, self.rep, city=self.city)
        self.expect(s, 'satylyar', {'tasks.trigger_sale_end', 'tasks.submit_sales_report'})
        self.fill(s, self.rep, sale_ended_at=timezone.now())                   # 35
        self.expect(s, 'satyldy', {'tasks.submit_sales_report'})          # 37 waits for 36
        self.api(self.rep, f'/api/v1/export/shipments/{s.pk}/sales-report/', {})   # 36
        self.expect(s, 'satyldy', {'tasks.approve_sales_report'})
        self.api(self.em, f'/api/v1/export/shipments/{s.pk}/sales-report/approve/')   # 37
        self.expect(s, 'tamamlandy', set())

    def test_a_gapy_shipment_closes_at_the_gate(self):
        s = self.new_shipment('FC-2', is_gapy_satys=True)
        self.prep(s, transport_task='tasks.assign_driver',
                  transport_fields={'driver_name': 'Aman', 'driver_phone': '+99365000000'})
        self.docs_and_load(s, transport_task='tasks.assign_driver')
        self.expect(s, 'tamamlandy', set())
