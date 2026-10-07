"""Pepper spec 2026-10-05 §4.3 — contracts carry a product."""
import datetime

from django.test import TestCase

from apps.contracts.models import Contract
from apps.contracts.tests.test_shipment_firm_contracts import (
    _SHARE_A, _apply_packing, _efirm, _ifirm, _season, _shipment, _split,
)
from apps.core.models import ProductType, User


def _contract(ef, imf, number, seq, product):
    return Contract.objects.create(
        contract_number=number, seq=seq, contract_year=2025,
        contract_type=Contract.TYPE_FRAMEWORK,
        export_firm=ef, import_firm=imf, season=_season(),
        product_type=product,
    )


class ContractProductTests(TestCase):
    def setUp(self):
        self.ef = _efirm('YGT')
        self.imf = _ifirm('B1')
        self.user = User.objects.create(username='cp_user', role='export_manager')
        self.pepper = ProductType.objects.get(code='pepper')
        self.tomato = ProductType.objects.get(code='tomato')
        self.pepper_ship = _shipment(self.imf)
        self.pepper_ship.product_type = self.pepper
        self.pepper_ship.save(update_fields=['product_type'])
        _split(self.pepper_ship, self.ef)
        _apply_packing(self.pepper_ship, _SHARE_A)
        self.t = _contract(self.ef, self.imf, '1/25-YGT-EXP', 1, self.tomato)
        self.l = _contract(self.ef, self.imf, '2/25-YGT-EXP', 2, None)
        self.p = _contract(self.ef, self.imf, '3/25-YGT-EXP', 3, self.pepper)

    def test_framework_options_follow_product(self):
        from apps.contracts.services.shipment_firm_contracts import framework_contracts_for_pair
        ids = set(framework_contracts_for_pair(self.ef.id, self.imf.id, 'pepper').values_list('id', flat=True))
        self.assertEqual(ids, {self.p.id})
        ids = set(framework_contracts_for_pair(self.ef.id, self.imf.id, 'tomato').values_list('id', flat=True))
        self.assertEqual(ids, {self.t.id, self.l.id})  # NULL ≡ tomato

    def test_link_pepper_truck_to_tomato_contract_refused(self):
        from apps.contracts.services.shipment_firm_contracts import link_split_to_contract
        with self.assertRaises(ValueError):
            link_split_to_contract(
                shipment=self.pepper_ship, export_firm_id=self.ef.id,
                mode='framework', contract_id=self.t.id, user=self.user,
            )

    def test_link_pepper_truck_to_pepper_contract_ok(self):
        from apps.contracts.services.shipment_firm_contracts import link_split_to_contract
        sale = link_split_to_contract(
            shipment=self.pepper_ship, export_firm_id=self.ef.id,
            mode='framework', contract_id=self.p.id, user=self.user,
        )
        self.assertEqual(sale.contract_id, self.p.id)

    def test_one_time_contract_inherits_pepper(self):
        from apps.contracts.services.shipment_firm_contracts import link_split_to_contract
        sale = link_split_to_contract(
            shipment=self.pepper_ship, export_firm_id=self.ef.id,
            mode='one_time', contract_id=None, user=self.user, price_per_kg='0.80',
        )
        self.assertEqual(sale.contract.product_type.code, 'pepper')

    def test_one_time_contract_without_shipment_product_is_tomato(self):
        from apps.contracts.services.shipment_firm_contracts import link_split_to_contract
        ship = _shipment(self.imf, code='0201002/25')
        _split(ship, self.ef)
        _apply_packing(ship, _SHARE_A)
        sale = link_split_to_contract(
            shipment=ship, export_firm_id=self.ef.id,
            mode='one_time', contract_id=None, user=self.user, price_per_kg='0.80',
        )
        self.assertEqual(sale.contract.product_type.code, 'tomato')

    def test_contract_context_prints_product(self):
        from apps.contracts.services.document_context import build_contract_context
        ctx = build_contract_context(self.p)
        self.assertEqual((ctx['product_name_ru'], ctx['product_name_tk']),
                         ('Перец сладкий свежий', 'Ter bolgar burç'))
        ctx = build_contract_context(self.l)
        self.assertEqual((ctx['product_name_ru'], ctx['product_name_tk']),
                         ('Помидор свежий', 'Ter pomidor'))

    def test_product_names_fallback(self):
        from apps.contracts.services.document_context import product_names
        self.assertEqual(product_names(None), ('Fresh tomatoes', 'Помидор свежий', 'Ter pomidor'))


class ContractProductMismatchApiTests(TestCase):
    """I3: a shipment and the contracts it is sold under carry the same product
    (NULL ≡ tomato on both sides) — guarded from the shipment PATCH and the sale API."""

    @classmethod
    def setUpTestData(cls):
        from django.core.management import call_command
        call_command('seed_permissions')

    def setUp(self):
        from django.core.cache import cache
        from rest_framework.test import APIClient
        cache.clear()
        self.client = APIClient()
        self.admin = User.objects.create(username='cpm_admin', role='admin')
        self.client.force_authenticate(self.admin)
        self.ef = _efirm('CPM')
        self.imf = _ifirm('CB')
        self.pepper = ProductType.objects.get(code='pepper')
        self.tomato = ProductType.objects.get(code='tomato')
        self.ship = _shipment(self.imf, code='0301001/25')
        self.ship.product_type = self.pepper
        self.ship.save(update_fields=['product_type'])
        self.t = _contract(self.ef, self.imf, '11/25-CPM-EXP', 11, self.tomato)
        self.legacy = _contract(self.ef, self.imf, '12/25-CPM-EXP', 12, None)
        self.p = _contract(self.ef, self.imf, '13/25-CPM-EXP', 13, self.pepper)

    def _sale(self, contract, **extra):
        from apps.contracts.models import ContractSale
        return ContractSale.objects.create(
            contract=contract, shipment=self.ship, export_firm=self.ef,
            total_usd='1000.00', **extra,
        )

    def _patch_ship(self, product):
        return self.client.patch(
            f'/api/v1/export/shipments/{self.ship.id}/', {'product_type': product.id}, format='json',
        )

    # --- shipment PATCH --------------------------------------------------------

    def test_patch_product_away_from_linked_contract_refused(self):
        self._sale(self.p)
        resp = self._patch_ship(self.tomato)
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertEqual(resp.data['product_type'], ['contract_product_mismatch'])
        self.ship.refresh_from_db()
        self.assertEqual(self.ship.product_type.code, 'pepper')

    def test_patch_to_pepper_with_legacy_null_contract_refused(self):
        self.ship.product_type = self.tomato
        self.ship.save(update_fields=['product_type'])
        self._sale(self.legacy)
        resp = self._patch_ship(self.pepper)
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertEqual(resp.data['product_type'], ['contract_product_mismatch'])

    def test_void_sale_does_not_block(self):
        self._sale(self.p, status='void')
        resp = self._patch_ship(self.tomato)
        self.assertEqual(resp.status_code, 200, resp.data)

    def test_patch_to_contract_product_allowed(self):
        self.ship.product_type = self.tomato
        self.ship.save(update_fields=['product_type'])
        self._sale(self.p)
        resp = self._patch_ship(self.pepper)
        self.assertEqual(resp.status_code, 200, resp.data)

    # --- contract-sale API -----------------------------------------------------

    def test_create_sale_on_other_product_contract_refused(self):
        resp = self.client.post('/api/v1/contracts/sales/', {
            'contract': self.t.pk, 'shipment': self.ship.pk, 'export_firm': self.ef.pk,
            'total_usd': '1000.00',
        }, format='json')
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertEqual(resp.data['contract'], ['contract_product_mismatch'])

    def test_create_sale_pepper_on_legacy_null_contract_refused(self):
        resp = self.client.post('/api/v1/contracts/sales/', {
            'contract': self.legacy.pk, 'shipment': self.ship.pk, 'export_firm': self.ef.pk,
            'total_usd': '1000.00',
        }, format='json')
        self.assertEqual(resp.status_code, 400, resp.data)

    def test_create_sale_same_product_ok(self):
        resp = self.client.post('/api/v1/contracts/sales/', {
            'contract': self.p.pk, 'shipment': self.ship.pk, 'export_firm': self.ef.pk,
            'total_usd': '1000.00',
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)

    def test_patch_sale_onto_other_product_contract_refused(self):
        sale = self._sale(self.p)
        resp = self.client.patch(
            f'/api/v1/contracts/sales/{sale.pk}/', {'contract': self.t.pk}, format='json',
        )
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertEqual(resp.data['contract'], ['contract_product_mismatch'])

    def test_status_only_patch_on_legacy_mismatched_sale_ok(self):
        sale = self._sale(self.t)  # pre-guard data: pepper truck on a tomato contract
        resp = self.client.patch(
            f'/api/v1/contracts/sales/{sale.pk}/', {'status': 'sent'}, format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
