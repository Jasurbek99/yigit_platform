"""Pepper spec 2026-10-05 §4.3 — invoice, CMR and customs letter print the
shipment's product name and HS code instead of hardcoded tomato."""
from django.test import TestCase

from apps.contracts.services.document_context import (
    build_cmr_context, build_customs_context, build_invoice_context,
)
from apps.contracts.tests.test_contract_sale_api import (
    _make_contract, _make_export_firm, _make_import_firm, _make_invoice, _make_season,
)
from apps.contracts.tests.test_document_generation import _make_packed_shipment
from apps.core.models import ProductType


class DocumentProductTests(TestCase):
    def setUp(self):
        season = _make_season('docprod')
        ef = _make_export_firm('DPEF')
        imf = _make_import_firm('DPIF')
        self.pepper = ProductType.objects.get(code='pepper')
        self.shipment = _make_packed_shipment(season, imf, code='0101888/25')
        self.shipment.product_type = self.pepper
        self.shipment.save(update_fields=['product_type'])
        self.shipment.refresh_from_db()  # date str -> date
        contract = _make_contract('DP-1/25', ef, imf, season)
        self.invoice = _make_invoice(contract)
        self.invoice.shipment = self.shipment
        self.invoice.save(update_fields=['shipment'])
        self.invoice.refresh_from_db()  # invoice_date str -> date

    def test_invoice_pepper(self):
        ctx = build_invoice_context(self.invoice, 'en')
        self.assertEqual(ctx['line_items'][0]['code'], '0709601000')
        self.assertEqual(ctx['line_items'][0]['name'], 'Fresh sweet peppers')

    def test_invoice_ru_pepper(self):
        self.assertEqual(
            build_invoice_context(self.invoice, 'ru')['line_items'][0]['name'],
            'Перец сладкий свежий',
        )

    def test_invoice_falls_back_to_contract_product(self):
        self.shipment.product_type = None
        self.shipment.save(update_fields=['product_type'])
        self.invoice.contract.product_type = self.pepper
        self.invoice.contract.save(update_fields=['product_type'])
        self.invoice.refresh_from_db()
        ctx = build_invoice_context(self.invoice, 'en')
        self.assertEqual(ctx['line_items'][0]['code'], '0709601000')

    def test_invoice_without_product_is_tomato(self):
        self.shipment.product_type = None
        self.shipment.save(update_fields=['product_type'])
        self.invoice.refresh_from_db()
        ctx = build_invoice_context(self.invoice, 'en')
        self.assertEqual(ctx['line_items'][0]['code'], '070200000')
        self.assertEqual(ctx['line_items'][0]['name'], 'Fresh tomatoes')

    def test_cmr_cargo_pepper(self):
        self.assertEqual(
            build_cmr_context(self.shipment, 'en')['cargo_name'], 'FRESH SWEET PEPPERS',
        )

    def test_cmr_cargo_pepper_ru(self):
        self.assertEqual(
            build_cmr_context(self.shipment, 'ru')['cargo_name'], 'ПЕРЕЦ СЛАДКИЙ СВЕЖИЙ',
        )

    def test_cmr_cargo_tomato_unchanged(self):
        self.shipment.product_type = ProductType.objects.get(code='tomato')
        self.shipment.save(update_fields=['product_type'])
        self.assertEqual(build_cmr_context(self.shipment, 'en')['cargo_name'], 'FRESH TOMATOES')
        self.assertEqual(build_cmr_context(self.shipment, 'ru')['cargo_name'], 'Помидоры свежие')

    def test_customs_letter_pepper(self):
        self.assertEqual(build_customs_context(self.invoice)['product'], 'Ter bolgar burç')

    def test_blank_admin_fields_fall_back_to_tomato(self):
        ProductType.objects.filter(code='pepper').update(hs_code='', name_en='', name_tk='')
        self.shipment.refresh_from_db()
        self.invoice.refresh_from_db()
        ctx = build_invoice_context(self.invoice, 'en')
        self.assertEqual(ctx['line_items'][0]['code'], '070200000')
        self.assertEqual(ctx['line_items'][0]['name'], 'Fresh tomatoes')
