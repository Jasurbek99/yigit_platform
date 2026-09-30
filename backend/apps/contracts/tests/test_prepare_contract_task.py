"""PREP/DOCS chain hooks in the contracts views (spec 2026-09-30 §3, §5)."""
from decimal import Decimal

from django.utils import timezone
from rest_framework.test import APIClient

from django.test import TestCase

from apps.contracts.tests.test_contract_sale_api import (
    _SeededPermsMixin, _make_contract, _make_export_firm, _make_import_firm, _make_invoice,
    _make_season, _make_user,
)
from apps.contracts.tests.test_document_generation import _make_packed_shipment
from apps.core.models import LoadingLocation
from apps.export.models import ShipmentFirmSplit, TaskCompletionRule, TaskRule, TaskState
from apps.export.services.task_rules import generate_tasks_for_status

PRINT_TASKS = ('tasks.print_cmr', 'tasks.print_ct1', 'tasks.print_phyto', 'tasks.print_customs_request')


def _print_rules():
    for title in PRINT_TASKS + ('tasks.hold',):
        TaskRule.objects.create(step='draft', title_key=title, assignee_role='document_team',
                                completion_rule=TaskCompletionRule.CONFIRM)


class DocumentDownloadEndpointTests(_SeededPermsMixin, TestCase):
    def setUp(self) -> None:
        self.client = APIClient()
        self.user = _make_user('dl_doc', 'export_manager')
        self.client.force_authenticate(user=self.user)
        self.season = _make_season()
        self.imp = _make_import_firm('IMPDL')
        self.ef = _make_export_firm('DLA')
        LoadingLocation.objects.get_or_create(name='Kaka', defaults={'name_ru': 'Кака'})
        self.shipment = _make_packed_shipment(self.season, self.imp, code='0303001/25')
        ShipmentFirmSplit.objects.create(
            shipment=self.shipment, export_firm=self.ef,
            weight_kg=Decimal('9000'), amount_usd=Decimal('8000'),
        )
        contract = _make_contract('DL-C1', self.ef, self.imp, self.season)
        sale = _make_invoice(contract, invoice_number=1)
        sale.shipment = self.shipment
        sale.export_firm = self.ef
        sale.save(update_fields=['shipment', 'export_firm'])
        _print_rules()
        generate_tasks_for_status(self.shipment, 'draft')

    def _states(self):
        return dict(self.shipment.tasks.values_list('title_key', 'state'))

    def test_packet_zip_closes_every_print_task(self):
        resp = self.client.get(f'/api/v1/contracts/shipments/{self.shipment.pk}/packet.zip?place_loading=Kaka')
        self.assertEqual(resp.status_code, 200, resp.content[:200])
        states = self._states()
        self.assertEqual({t: states[t] for t in PRINT_TASKS}, {t: TaskState.DONE for t in PRINT_TASKS})

    def test_cmr_download_closes_print_cmr(self):
        resp = self.client.get(f'/api/v1/contracts/shipments/{self.shipment.pk}/cmr/?place_loading=Kaka')
        self.assertEqual(resp.status_code, 200, resp.content[:200])
        states = self._states()
        self.assertEqual(states['tasks.print_cmr'], TaskState.DONE)
        self.assertEqual(states['tasks.print_ct1'], TaskState.OPEN)

    def test_ct1_letter_closes_print_ct1(self):
        sale = self.shipment.sales.get()
        resp = self.client.get(f'/api/v1/contracts/sales/{sale.pk}/document/?type=ct1_ru')
        self.assertEqual(resp.status_code, 200, resp.content[:200])
        self.assertEqual(self._states()['tasks.print_ct1'], TaskState.DONE)

    def test_closed_season_download_serves_the_file_and_closes_nothing(self):
        type(self.season).objects.filter(pk=self.season.pk).update(closed_at=timezone.now())
        resp = self.client.get(f'/api/v1/contracts/shipments/{self.shipment.pk}/cmr/?place_loading=Kaka')
        self.assertEqual(resp.status_code, 200, resp.content[:200])
        self.assertEqual(self._states()['tasks.print_cmr'], TaskState.OPEN)

    def test_a_task_chain_error_never_costs_the_user_the_file(self):
        from unittest import mock
        from django.db import DatabaseError
        with mock.patch('apps.export.services.task_chain.close_auto_satisfied',
                        side_effect=DatabaseError('boom')):
            resp = self.client.get(f'/api/v1/contracts/shipments/{self.shipment.pk}/cmr/?place_loading=Kaka')
            self.assertEqual(resp.status_code, 200, resp.content[:200])
            resp = self.client.get(f'/api/v1/contracts/shipments/{self.shipment.pk}/packet.zip?place_loading=Kaka')
            self.assertEqual(resp.status_code, 200, resp.content[:200])

    def test_packet_with_only_void_sales_closes_only_print_cmr(self):
        from apps.contracts.models import ContractSale
        ContractSale.objects.filter(shipment=self.shipment).update(status=ContractSale.STATUS_VOID)
        resp = self.client.get(f'/api/v1/contracts/shipments/{self.shipment.pk}/packet.zip?place_loading=Kaka')
        self.assertEqual(resp.status_code, 200, resp.content[:200])
        states = self._states()
        self.assertEqual((states['tasks.print_cmr'], states['tasks.print_ct1']), (TaskState.DONE, TaskState.OPEN))


class PrepareContractTaskTests(_SeededPermsMixin, TestCase):
    """docs/Tasks.md item 9: closes when every firm on the truck has a contract
    whose agreement has been downloaded."""

    def setUp(self) -> None:
        from apps.contracts.tests.test_document_generation import _make_country

        self.client = APIClient()
        self.user = _make_user('pc_doc', 'export_manager')
        self.client.force_authenticate(user=self.user)
        self.season = _make_season()
        self.imp = _make_import_firm('IMPPC')
        self.imp.country = _make_country()
        self.imp.save(update_fields=['country'])
        self.ef_a, self.ef_b = _make_export_firm('PCA'), _make_export_firm('PCB')
        self.shipment = _make_packed_shipment(self.season, self.imp, status_code='gumruk_girish', code='0404001/25')
        for ef in (self.ef_a, self.ef_b):
            ShipmentFirmSplit.objects.create(
                shipment=self.shipment, export_firm=ef, weight_kg=Decimal('9000'), amount_usd=Decimal('8000'),
            )
        for title in ('tasks.prepare_contract', 'tasks.hold'):
            TaskRule.objects.create(step='gumruk_girish', title_key=title, assignee_role='export_manager',
                                    completion_rule=TaskCompletionRule.CONFIRM)
        generate_tasks_for_status(self.shipment, 'gumruk_girish')
        self.contracts = {}

    def _sale(self, ef, n):
        contract = _make_contract(f'PC-{ef.code}', ef, self.imp, self.season)
        sale = _make_invoice(contract, invoice_number=n)
        sale.shipment, sale.export_firm = self.shipment, ef
        sale.save(update_fields=['shipment', 'export_firm'])
        self.contracts[ef.code] = contract
        return sale

    def _state(self):
        return self.shipment.tasks.get(title_key='tasks.prepare_contract').state

    def test_one_firm_covered_keeps_the_task_open(self):
        from apps.contracts.services.task_checks import sync_prepare_contract
        self._sale(self.ef_a, 1)
        type(self.contracts['PCA']).objects.update(agreement_downloaded_at=timezone.now())
        sync_prepare_contract(self.shipment, self.user)
        self.assertEqual(self._state(), TaskState.OPEN)

    def test_contracts_without_a_downloaded_agreement_keep_it_open(self):
        from apps.contracts.services.task_checks import contracts_ready, sync_prepare_contract
        self._sale(self.ef_a, 1)
        self._sale(self.ef_b, 2)
        self.assertFalse(contracts_ready(self.shipment))
        sync_prepare_contract(self.shipment, self.user)
        self.assertEqual(self._state(), TaskState.OPEN)

    def test_downloading_both_agreements_closes_the_task(self):
        self._sale(self.ef_a, 1)
        self._sale(self.ef_b, 2)
        resp = self.client.get(f'/api/v1/contracts/contracts/{self.contracts["PCA"].pk}/agreement/')
        self.assertEqual(resp.status_code, 200, resp.content[:200])
        self.assertEqual(self._state(), TaskState.OPEN)
        resp = self.client.get(f'/api/v1/contracts/contracts/{self.contracts["PCB"].pk}/agreement/')
        self.assertEqual(resp.status_code, 200, resp.content[:200])
        self.assertEqual(self._state(), TaskState.DONE)

    def test_an_agreement_download_survives_a_task_chain_error(self):
        from unittest import mock
        from django.db import DatabaseError
        self._sale(self.ef_a, 1)
        with mock.patch('apps.export.services.task_chain.close_auto_satisfied',
                        side_effect=DatabaseError('boom')):
            resp = self.client.get(f'/api/v1/contracts/contracts/{self.contracts["PCA"].pk}/agreement/')
        self.assertEqual(resp.status_code, 200, resp.content[:200])

    def test_a_void_sale_does_not_cover_its_firm(self):
        from apps.contracts.models import ContractSale
        from apps.contracts.services.task_checks import contracts_ready
        self._sale(self.ef_a, 1)
        sale_b = self._sale(self.ef_b, 2)
        type(self.contracts['PCA']).objects.update(agreement_downloaded_at=timezone.now())
        ContractSale.objects.filter(pk=sale_b.pk).update(status=ContractSale.STATUS_VOID)
        self.assertFalse(contracts_ready(self.shipment))
