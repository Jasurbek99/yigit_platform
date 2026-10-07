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
