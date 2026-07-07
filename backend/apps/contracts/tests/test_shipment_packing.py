"""Unified per-truck packing endpoint (ShipmentPackingView) — apply template.

Pick one PackingTemplate → whole-truck (CMR) + copy each share onto a firm's sale
(Invoice) + set firm weights (quota). Firm values editable; two firms swappable.

Run: python manage.py test apps.contracts.tests.test_shipment_packing
"""
import datetime
from decimal import Decimal

from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import ExportFirm, ImportFirm, Season, ShipmentStatusType, User
from apps.export.models import (
    PackingTemplate, PackingTemplateShare, Shipment, ShipmentFirmSplit,
)
from apps.contracts.models import Contract, ContractSale

_URL = '/api/v1/contracts/shipment-packing/'


def _season():
    s, _ = Season.objects.get_or_create(
        name='2025', defaults={'start_date': '2025-01-01', 'end_date': '2025-12-31', 'is_active': True},
    )
    return s


def _draft():
    s, _ = ShipmentStatusType.objects.get_or_create(
        code='draft',
        defaults={'name_tk': 'd', 'name_en': 'Draft', 'name_ru': 'd', 'step_order': 0, 'phase': 'PREP'},
    )
    return s


class ShipmentPackingApiTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions', verbosity=0)

    def setUp(self):
        self.buyer = ImportFirm.objects.create(code='B1', name_company='Buyer 1')
        self.ygt = ExportFirm.objects.create(code='YGT', name_tk='YGT')
        self.hj = ExportFirm.objects.create(code='HJ', name_tk='HJ')
        self.shipment = Shipment.objects.create(
            shipment_code='0101001/25', date=datetime.date(2025, 9, 22),
            season=_season(), status=_draft(), import_firm=self.buyer,
        )
        ShipmentFirmSplit.objects.create(shipment=self.shipment, export_firm=self.ygt, weight_kg='9000', split_order=1)
        ShipmentFirmSplit.objects.create(shipment=self.shipment, export_firm=self.hj, weight_kg='9000', split_order=2)
        self.contract = Contract.objects.create(
            contract_number='1/25-YGT-EXP', seq=1, contract_year=2025,
            export_firm=self.ygt, import_firm=self.buyer, season=_season(),
        )
        self.ygt_sale = ContractSale.objects.create(
            contract=self.contract, shipment=self.shipment, export_firm=self.ygt, quantity_kg=Decimal('9000'))
        self.hj_sale = ContractSale.objects.create(
            contract=self.contract, shipment=self.shipment, export_firm=self.hj, quantity_kg=Decimal('9000'))
        # Template: 18000 truck, 2 shares 10000 / 8000.
        self.tpl = PackingTemplate.objects.create(
            name='18000 (10000/8000)', net_kg=Decimal('18000'), gross_kg=Decimal('20472'),
            box_count=2912, pallet_count=Decimal('33'), pallet_weight_kg=Decimal('412'))
        PackingTemplateShare.objects.create(
            template=self.tpl, share_order=1, net_kg=Decimal('10000'), gross_kg=Decimal('11373'),
            box_count=1618, pallet_count=Decimal('18'), pallet_weight_kg=Decimal('229'))
        PackingTemplateShare.objects.create(
            template=self.tpl, share_order=2, net_kg=Decimal('8000'), gross_kg=Decimal('9099'),
            box_count=1294, pallet_count=Decimal('15'), pallet_weight_kg=Decimal('183'))

        self.mgr = User.objects.create_user(username='mgr_pk', password='p', role='export_manager')
        self.reader = User.objects.create_user(username='seller_pk', password='p', role='seller')
        self.client = APIClient()

    def test_apply_template_copies_shares_and_sets_weights(self):
        self.client.force_authenticate(self.mgr)
        r = self.client.post(_URL, {
            'shipment': self.shipment.id, 'scope': 'template', 'packing_template': self.tpl.id,
        }, format='json')
        self.assertEqual(r.status_code, 200)
        # Firm weights set from share nets (order = split_order)
        self.ygt_sale.refresh_from_db(); self.hj_sale.refresh_from_db()
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.packing_template_id, self.tpl.id)
        ygt_split = ShipmentFirmSplit.objects.get(shipment=self.shipment, export_firm=self.ygt)
        self.assertEqual(ygt_split.weight_kg, Decimal('10000.00'))
        # Share packing copied onto the sale
        self.assertEqual(self.ygt_sale.gross_kg, Decimal('11373.00'))
        self.assertEqual(self.ygt_sale.box_count, 1618)
        self.assertEqual(self.hj_sale.gross_kg, Decimal('9099.00'))

    def test_apply_mismatched_share_count_rejected(self):
        # Third firm → 3 firms but the template has 2 shares.
        arap = ExportFirm.objects.create(code='ARAP', name_tk='Arap')
        ShipmentFirmSplit.objects.create(shipment=self.shipment, export_firm=arap, weight_kg='6000', split_order=3)
        self.client.force_authenticate(self.mgr)
        r = self.client.post(_URL, {
            'shipment': self.shipment.id, 'scope': 'template', 'packing_template': self.tpl.id,
        }, format='json')
        self.assertEqual(r.status_code, 400)

    def test_edit_one_firm_value(self):
        self.client.force_authenticate(self.mgr)
        r = self.client.post(_URL, {
            'shipment': self.shipment.id, 'scope': 'firm', 'export_firm': self.ygt.id, 'box_count': 1700,
        }, format='json')
        self.assertEqual(r.status_code, 200)
        self.ygt_sale.refresh_from_db()
        self.assertEqual(self.ygt_sale.box_count, 1700)

    def test_swap_exchanges_weight_and_packing(self):
        self.client.force_authenticate(self.mgr)
        self.client.post(_URL, {
            'shipment': self.shipment.id, 'scope': 'template', 'packing_template': self.tpl.id,
        }, format='json')
        r = self.client.post(_URL, {
            'shipment': self.shipment.id, 'scope': 'swap',
            'export_firm_a': self.ygt.id, 'export_firm_b': self.hj.id,
        }, format='json')
        self.assertEqual(r.status_code, 200)
        self.ygt_sale.refresh_from_db()
        ygt_split = ShipmentFirmSplit.objects.get(shipment=self.shipment, export_firm=self.ygt)
        self.assertEqual(ygt_split.weight_kg, Decimal('8000.00'))   # got HJ's weight
        self.assertEqual(self.ygt_sale.gross_kg, Decimal('9099.00'))  # got HJ's packing

    def test_swap_on_three_firm_truck_keeps_third(self):
        # Regression: swapping two firms must NOT drop the third firm's split.
        arap = ExportFirm.objects.create(code='ARAP', name_tk='Arap')
        ShipmentFirmSplit.objects.create(shipment=self.shipment, export_firm=arap, weight_kg='6000', split_order=3)
        self.client.force_authenticate(self.mgr)
        r = self.client.post(_URL, {
            'shipment': self.shipment.id, 'scope': 'swap',
            'export_firm_a': self.ygt.id, 'export_firm_b': self.hj.id,
        }, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(ShipmentFirmSplit.objects.filter(shipment=self.shipment).count(), 3)
        self.assertTrue(ShipmentFirmSplit.objects.filter(shipment=self.shipment, export_firm=arap).exists())

    def test_write_blocked_for_reader(self):
        self.client.force_authenticate(self.reader)
        r = self.client.post(_URL, {
            'shipment': self.shipment.id, 'scope': 'template', 'packing_template': self.tpl.id,
        }, format='json')
        self.assertEqual(r.status_code, 403)
