"""Firm change / cancel → orphaned sales are released (spec 2026-10-03 §4-5)."""
import tempfile
from decimal import Decimal

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.contracts.models import Contract, ContractAttachment, ContractSale
from apps.contracts.services.shipment_firm_contracts import (
    link_split_to_contract, release_orphan_sales, sales_to_release,
)
from apps.contracts.tests.test_contract_sale_api import _SeededPermsMixin, _make_user
from apps.contracts.tests.test_shipment_firm_contracts import (
    _SHARE_A, _SHARE_B, _apply_packing, _efirm, _ifirm, _season, _shipment, _split,
)
from apps.core.models import ShipmentStatusType, User
from apps.export.models import Shipment, ShipmentFirmSplit


def _cancel(shipment) -> None:
    # Test setup only — production cancels through /cancel/ → transition_to().
    status, _ = ShipmentStatusType.objects.get_or_create(
        code='cancelled',
        defaults={'name_tk': 'cancelled', 'name_en': 'Cancelled', 'name_ru': 'cancelled',
                  'step_order': 99, 'phase': 'PREP'},
    )
    Shipment.objects.filter(pk=shipment.pk).update(status=status)
    shipment.refresh_from_db()


class ReleaseServiceTest(TestCase):
    def setUp(self) -> None:
        self.buyer = _ifirm('RB1')
        self.dm = _efirm('RDM')
        self.ma = _efirm('RMA')
        self.shipment = _shipment(self.buyer, code='0505001/25')
        _split(self.shipment, self.dm)
        _split(self.shipment, self.ma)
        _apply_packing(self.shipment, _SHARE_A, _SHARE_B)
        self.user = User.objects.create(username='rel_user', role='export_manager')
        self.dm_sale = self._link(self.dm)
        self.ma_sale = self._link(self.ma)

    def _link(self, firm) -> ContractSale:
        return link_split_to_contract(
            shipment=self.shipment, export_firm_id=firm.id, mode='one_time',
            contract_id=None, user=self.user, price_per_kg='0.90',
        )

    def _drop_firm(self, firm) -> None:
        ShipmentFirmSplit.objects.filter(shipment=self.shipment, export_firm=firm).delete()

    def test_removed_firm_loses_its_sale_and_one_time_contract(self) -> None:
        contract_id = self.dm_sale.contract_id
        self._drop_firm(self.dm)
        result = release_orphan_sales(self.shipment)
        self.assertEqual([r['export_firm'] for r in result.released], [self.dm.id])
        self.assertFalse(ContractSale.objects.filter(pk=self.dm_sale.pk).exists())
        self.assertFalse(Contract.objects.filter(pk=contract_id).exists())
        self.assertTrue(ContractSale.objects.filter(pk=self.ma_sale.pk).exists())
        self.assertEqual(result.contracts_deleted, 1)

    def test_framework_contract_stays(self) -> None:
        fw = Contract.objects.create(
            contract_number='7/25-RDM-EXP', seq=7, contract_year=2025,
            contract_type=Contract.TYPE_FRAMEWORK,
            export_firm=self.dm, import_firm=self.buyer, season=_season(),
        )
        link_split_to_contract(shipment=self.shipment, export_firm_id=self.dm.id,
                               mode='framework', contract_id=fw.id, user=self.user)
        self._drop_firm(self.dm)
        release_orphan_sales(self.shipment)
        self.assertTrue(Contract.objects.filter(pk=fw.pk).exists())

    @override_settings(MEDIA_ROOT=tempfile.mkdtemp())
    def test_one_time_contract_with_scans_is_cancelled_not_deleted(self) -> None:
        contract = self.dm_sale.contract
        ContractAttachment.objects.create(
            contract=contract, file=SimpleUploadedFile('scan.pdf', b'%PDF-1.4'),
            original_filename='scan.pdf', mime_type='application/pdf', size_bytes=8,
            uploaded_by=self.user,
        )
        self._drop_firm(self.dm)
        result = release_orphan_sales(self.shipment)
        contract.refresh_from_db()
        self.assertEqual(contract.status, Contract.STATUS_CANCELLED)
        self.assertEqual(result.contracts_cancelled, 1)

    def test_cancelled_truck_releases_every_sale(self) -> None:
        _cancel(self.shipment)
        release_orphan_sales(self.shipment)
        self.assertFalse(ContractSale.objects.filter(shipment=self.shipment).exists())

    def test_excel_sales_without_a_truck_are_never_touched(self) -> None:
        # Review Focus 2.
        excel = ContractSale.objects.create(
            contract=self.dm_sale.contract, invoice_number=500,
            invoice_date='2025-05-01', total_usd=Decimal('100.00'),
        )
        _cancel(self.shipment)
        release_orphan_sales(self.shipment)
        self.assertTrue(ContractSale.objects.filter(pk=excel.pk).exists())

    def test_second_call_is_a_no_op(self) -> None:
        self._drop_firm(self.dm)
        release_orphan_sales(self.shipment)
        again = release_orphan_sales(self.shipment)
        self.assertEqual(again.released, [])

    def test_unchanged_firm_set_releases_nothing(self) -> None:
        # Review Focus 4: a weight-only edit keeps every firm.
        self.assertEqual(sales_to_release(self.shipment, {self.dm.id, self.ma.id}), [])

    def test_freed_number_goes_to_the_next_link(self) -> None:
        freed = self.dm_sale.invoice_number
        self._drop_firm(self.dm)
        release_orphan_sales(self.shipment)
        _split(self.shipment, self.dm)
        self.assertEqual(self._link(self.dm).invoice_number, freed)

    def test_link_cleans_an_orphan_first(self) -> None:
        self._drop_firm(self.dm)  # nobody called release
        self._link(self.ma)       # any later link on the truck retries it
        self.assertFalse(ContractSale.objects.filter(pk=self.dm_sale.pk).exists())


class ReleaseEndpointTest(_SeededPermsMixin, TestCase):
    def setUp(self) -> None:
        self.buyer = _ifirm('EB1')
        self.dm = _efirm('EDM')
        self.ma = _efirm('EMA')
        self.shipment = _shipment(self.buyer, code='0606001/25')
        _split(self.shipment, self.dm)
        _split(self.shipment, self.ma)
        _apply_packing(self.shipment, _SHARE_A, _SHARE_B)
        self.manager = _make_user('rel_em', 'export_manager')
        self.sale = link_split_to_contract(
            shipment=self.shipment, export_firm_id=self.dm.id, mode='one_time',
            contract_id=None, user=self.manager, price_per_kg='0.90',
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.manager)
        self.url = f'/api/v1/contracts/shipments/{self.shipment.pk}/release-sales/'

    def test_preview_lists_what_a_firm_change_would_release(self) -> None:
        resp = self.client.get(self.url, {'keep': str(self.ma.id)})
        self.assertEqual(resp.status_code, 200, resp.content)
        items = resp.json()['items']
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['export_firm_code'], 'EDM')
        self.assertEqual(items[0]['invoice_number'], self.sale.invoice_number)
        self.assertFalse(items[0]['invoice_printed'])
        self.assertTrue(ContractSale.objects.filter(pk=self.sale.pk).exists())  # preview only

    def test_preview_for_cancel_lists_everything(self) -> None:
        resp = self.client.get(self.url, {'cancel': '1'})
        self.assertEqual(len(resp.json()['items']), 1)

    def test_junk_keep_is_400(self) -> None:
        resp = self.client.get(self.url, {'keep': 'abc'})
        self.assertEqual(resp.status_code, 400)

    def test_post_releases_orphans(self) -> None:
        ShipmentFirmSplit.objects.filter(shipment=self.shipment, export_firm=self.dm).delete()
        resp = self.client.post(self.url)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(len(resp.json()['released']), 1)
        self.assertFalse(ContractSale.objects.filter(pk=self.sale.pk).exists())

    def test_missing_truck_is_404(self) -> None:
        resp = self.client.get('/api/v1/contracts/shipments/999999/release-sales/')
        self.assertEqual(resp.status_code, 404)
