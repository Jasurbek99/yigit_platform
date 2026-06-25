"""Slice 4a — shipment firm-split ↔ contract bridge (service + endpoint)."""
import datetime
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import ExportFirm, ImportFirm, Season, ShipmentStatusType, User
from apps.export.models import Shipment, ShipmentFirmSplit
from apps.contracts.models import Contract, ContractSale
from apps.contracts.services.shipment_firm_contracts import (
    framework_contracts_for_pair,
    link_split_to_contract,
    money_warning,
)


def _season() -> Season:
    s, _ = Season.objects.get_or_create(
        name='2025', defaults={'start_date': '2025-01-01', 'end_date': '2025-12-31', 'is_active': True},
    )
    return s


def _draft_status() -> ShipmentStatusType:
    s, _ = ShipmentStatusType.objects.get_or_create(
        code='draft',
        defaults={'name_tk': 'draft', 'name_en': 'Draft', 'name_ru': 'Draft', 'step_order': 0, 'phase': 'PREP'},
    )
    return s


def _efirm(code: str) -> ExportFirm:
    return ExportFirm.objects.create(code=code, name_tk=f'Export {code}')


def _ifirm(code: str) -> ImportFirm:
    return ImportFirm.objects.create(code=code, name_company=f'Import {code}')


def _shipment(import_firm, code='0101001/25') -> Shipment:
    return Shipment.objects.create(
        shipment_code=code,
        date=datetime.date(2025, 9, 22),
        season=_season(),
        status=_draft_status(),
        import_firm=import_firm,
    )


def _split(shipment, firm, weight='9000.00', amount='8000.00') -> ShipmentFirmSplit:
    return ShipmentFirmSplit.objects.create(
        shipment=shipment, export_firm=firm, weight_kg=weight, amount_usd=amount,
    )


class MoneyWarningTest(TestCase):
    def test_thresholds(self) -> None:
        self.assertEqual(money_warning('12000'), 'bank')
        self.assertEqual(money_warning('10000'), 'bank')
        self.assertEqual(money_warning('9999.99'), 'cash')
        self.assertIsNone(money_warning(None))


class LinkServiceTest(TestCase):
    def setUp(self) -> None:
        self.buyer = _ifirm('B1')
        self.ygt = _efirm('YGT')
        self.shipment = _shipment(self.buyer)
        self.split = _split(self.shipment, self.ygt)
        self.user = User.objects.create(username='shohrat', role='export_manager')

    def test_one_time_creates_contract_and_bridge(self) -> None:
        sale = link_split_to_contract(
            shipment=self.shipment, export_firm_id=self.ygt.id,
            mode='one_time', contract_id=None, user=self.user,
        )
        self.assertEqual(sale.contract.contract_type, Contract.TYPE_ONE_TIME)
        self.assertEqual(sale.contract.export_firm_id, self.ygt.id)
        self.assertEqual(sale.contract.import_firm_id, self.buyer.id)
        self.assertEqual(sale.contract.passport_sdelka, '')
        self.assertTrue(sale.contract.contract_number)  # auto-numbered
        self.assertEqual(sale.shipment_id, self.shipment.id)
        self.assertEqual(sale.quantity_kg, Decimal('9000.00'))
        self.assertEqual(sale.total_usd, Decimal('8000.00'))
        self.assertIsNone(sale.invoice_number)  # filled later by a person

    def test_framework_link_reuses_existing(self) -> None:
        fw = Contract.objects.create(
            contract_number='177/25-YGT-EXP', seq=177, contract_year=2025,
            contract_type=Contract.TYPE_FRAMEWORK,
            export_firm=self.ygt, import_firm=self.buyer, season=_season(),
        )
        before = Contract.objects.count()
        sale = link_split_to_contract(
            shipment=self.shipment, export_firm_id=self.ygt.id,
            mode='framework', contract_id=fw.id, user=self.user,
        )
        self.assertEqual(sale.contract_id, fw.id)
        self.assertEqual(Contract.objects.count(), before)  # no new contract

    def test_framework_options_only_active_pair(self) -> None:
        Contract.objects.create(
            contract_number='1/25-YGT-EXP', seq=1, contract_year=2025,
            contract_type=Contract.TYPE_FRAMEWORK,
            export_firm=self.ygt, import_firm=self.buyer, season=_season(),
        )
        # one_time + a different buyer must not appear
        other = _ifirm('B2')
        Contract.objects.create(
            contract_number='2/25-YGT-EXP', seq=2, contract_year=2025,
            contract_type=Contract.TYPE_ONE_TIME,
            export_firm=self.ygt, import_firm=self.buyer, season=_season(),
        )
        Contract.objects.create(
            contract_number='3/25-YGT-EXP', seq=3, contract_year=2025,
            contract_type=Contract.TYPE_FRAMEWORK,
            export_firm=self.ygt, import_firm=other, season=_season(),
        )
        opts = framework_contracts_for_pair(self.ygt.id, self.buyer.id)
        self.assertEqual([c.contract_number for c in opts], ['1/25-YGT-EXP'])

    def test_relink_framework_is_idempotent(self) -> None:
        fw = Contract.objects.create(
            contract_number='5/25-YGT-EXP', seq=5, contract_year=2025,
            contract_type=Contract.TYPE_FRAMEWORK,
            export_firm=self.ygt, import_firm=self.buyer, season=_season(),
        )
        link_split_to_contract(shipment=self.shipment, export_firm_id=self.ygt.id,
                               mode='framework', contract_id=fw.id, user=self.user)
        link_split_to_contract(shipment=self.shipment, export_firm_id=self.ygt.id,
                               mode='framework', contract_id=fw.id, user=self.user)
        self.assertEqual(
            ContractSale.objects.filter(shipment=self.shipment, export_firm=self.ygt).count(), 1,
        )

    def test_no_buyer_raises(self) -> None:
        shipment = _shipment(None, code='0101002/25')
        _split(shipment, self.ygt)
        with self.assertRaises(ValueError):
            link_split_to_contract(shipment=shipment, export_firm_id=self.ygt.id,
                                   mode='one_time', contract_id=None, user=self.user)

    def test_bad_framework_contract_raises(self) -> None:
        other_pair = Contract.objects.create(
            contract_number='9/25-YGT-EXP', seq=9, contract_year=2025,
            contract_type=Contract.TYPE_FRAMEWORK,
            export_firm=self.ygt, import_firm=_ifirm('BX'), season=_season(),
        )
        with self.assertRaises(ValueError):
            link_split_to_contract(shipment=self.shipment, export_firm_id=self.ygt.id,
                                   mode='framework', contract_id=other_pair.id, user=self.user)


class EndpointSmokeTest(TestCase):
    def setUp(self) -> None:
        self.buyer = _ifirm('B1')
        self.ygt = _efirm('YGT')
        self.shipment = _shipment(self.buyer)
        _split(self.shipment, self.ygt, amount='12000.00')
        self.admin = User.objects.create(username='admin1', role='admin', is_superuser=True)
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def test_get_lists_rows_with_options_and_warning(self) -> None:
        r = self.client.get(f'/api/v1/contracts/shipment-firm-contracts/?shipment={self.shipment.id}')
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(len(body['rows']), 1)
        row = body['rows'][0]
        self.assertEqual(row['export_firm'], self.ygt.id)
        self.assertEqual(row['money_warning'], 'bank')
        self.assertIsNone(row['linked'])

    def test_post_one_time_then_get_shows_linked(self) -> None:
        r = self.client.post('/api/v1/contracts/shipment-firm-contracts/', {
            'shipment': self.shipment.id, 'export_firm': self.ygt.id, 'mode': 'one_time',
        }, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()['contract_type'], 'ONE_TIME')

        r2 = self.client.get(f'/api/v1/contracts/shipment-firm-contracts/?shipment={self.shipment.id}')
        self.assertIsNotNone(r2.json()['rows'][0]['linked'])
