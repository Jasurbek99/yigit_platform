"""Unified per-truck packing endpoint (ShipmentPackingView) — derive + override.

Poka-yoke model: pick ONE whole-truck config; each firm's packing derives from it
by weight share (always sums to the truck). NET per firm = its weight. Override optional.

Run: python manage.py test apps.contracts.tests.test_shipment_packing
"""
import datetime
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import ExportFirm, ImportFirm, Season, ShipmentStatusType, User
from apps.export.models import PackingPreset, Shipment, ShipmentFirmSplit
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
    def setUp(self):
        self.buyer = ImportFirm.objects.create(code='B1', name_company='Buyer 1')
        self.ygt = ExportFirm.objects.create(code='YGT', name_tk='YGT')
        self.hj = ExportFirm.objects.create(code='HJ', name_tk='HJ')
        self.shipment = Shipment.objects.create(
            shipment_code='0101001/25', date=datetime.date(2025, 9, 22),
            season=_season(), status=_draft(), import_firm=self.buyer,
        )
        # Uneven split: 10000 (YGT) + 8000 (HJ) = 18000 whole truck.
        ShipmentFirmSplit.objects.create(shipment=self.shipment, export_firm=self.ygt, weight_kg='10000')
        ShipmentFirmSplit.objects.create(shipment=self.shipment, export_firm=self.hj, weight_kg='8000')
        self.contract = Contract.objects.create(
            contract_number='1/25-YGT-EXP', seq=1, contract_year=2025,
            export_firm=self.ygt, import_firm=self.buyer, season=_season(),
        )
        # A linked sale for YGT (bridge); HJ has none yet.
        self.ygt_sale = ContractSale.objects.create(
            contract=self.contract, shipment=self.shipment, export_firm=self.ygt,
            quantity_kg=Decimal('10000'),
        )
        self.truck = PackingPreset.objects.create(
            name='Truck 18000', net_kg=Decimal('18000'), gross_kg=Decimal('20400'),
            box_count=3040, pallet_count=Decimal('33'), pallet_weight_kg=Decimal('380'),
        )
        self.mgr = User.objects.create_user(username='mgr_pk', password='p', role='export_manager')
        self.reader = User.objects.create_user(username='seller_pk', password='p', role='seller')
        self.client = APIClient()

    def test_get_totals_and_rows(self):
        self.client.force_authenticate(self.reader)  # read open
        r = self.client.get(_URL, {'shipment': self.shipment.id})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(Decimal(r.data['total_firm_weight']), Decimal('18000'))
        self.assertEqual(len(r.data['rows']), 2)
        rows = {row['export_firm_code']: row for row in r.data['rows']}
        self.assertEqual(rows['YGT']['sale_id'], self.ygt_sale.id)
        self.assertIsNone(rows['HJ']['sale_id'])  # no bridge sale yet

    def test_pick_truck_derives_per_firm_and_is_consistent(self):
        self.client.force_authenticate(self.mgr)
        r1 = self.client.post(_URL, {
            'shipment': self.shipment.id, 'scope': 'truck', 'packing_preset': self.truck.id,
        }, format='json')
        self.assertEqual(r1.status_code, 200)
        r = self.client.get(_URL, {'shipment': self.shipment.id})
        self.assertTrue(r.data['consistent'])  # 18000 firms == 18000 truck
        rows = {row['export_firm_code']: row for row in r.data['rows']}
        # YGT 10000/18000 of a 20400 gross → 11333.33; 3040 boxes → 1689
        self.assertEqual(Decimal(rows['YGT']['derived']['gross_kg']), Decimal('11333.33'))
        self.assertEqual(rows['YGT']['derived']['box_count'], 1689)

    def test_firm_override_sets_and_reads_back(self):
        self.client.force_authenticate(self.mgr)
        self.client.post(_URL, {
            'shipment': self.shipment.id, 'scope': 'truck', 'packing_preset': self.truck.id,
        }, format='json')
        r2 = self.client.post(_URL, {
            'shipment': self.shipment.id, 'scope': 'firm', 'export_firm': self.ygt.id,
            'gross_kg': '11373', 'box_count': 1618,
        }, format='json')
        self.assertEqual(r2.status_code, 200)
        self.ygt_sale.refresh_from_db()
        self.assertEqual(self.ygt_sale.gross_kg, Decimal('11373.00'))
        self.assertEqual(self.ygt_sale.box_count, 1618)

    def test_firm_without_sale_is_rejected(self):
        self.client.force_authenticate(self.mgr)
        r = self.client.post(_URL, {
            'shipment': self.shipment.id, 'scope': 'firm',
            'export_firm': self.hj.id, 'gross_kg': '9000',
        }, format='json')
        self.assertEqual(r.status_code, 400)

    def test_write_blocked_for_reader(self):
        self.client.force_authenticate(self.reader)
        r = self.client.post(_URL, {
            'shipment': self.shipment.id, 'scope': 'truck', 'packing_preset': self.truck.id,
        }, format='json')
        self.assertEqual(r.status_code, 403)
