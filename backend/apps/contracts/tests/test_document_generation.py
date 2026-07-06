"""Tests for invoice document generation (Slice 1 — Invoice RU/EN).

Three layers:
  * Pure context-builder unit tests (no DB; SimpleNamespace mocks).
  * Render smoke tests (fills the shipped templates; asserts no leftover tags).
  * API integration tests (real DB) for the /sales/{id}/document/ endpoint.

Reuses the fixture helpers from test_contract_sale_api.
"""
from datetime import date
from decimal import Decimal
from io import BytesIO
from types import SimpleNamespace
from unittest import mock

from docx import Document
from rest_framework.test import APIClient

from django.test import SimpleTestCase, TestCase

from apps.contracts.services import document_context as ctx
from apps.contracts.services import document_render as render
from apps.contracts.tests.test_contract_sale_api import (
    _SeededPermsMixin,
    _make_contract,
    _make_export_firm,
    _make_import_firm,
    _make_invoice,
    _make_season,
    _make_user,
)


def _preset(**kw):
    """A PackingPreset stand-in; unspecified packing fields default to None."""
    return SimpleNamespace(
        net_kg=kw.get('net_kg'), gross_kg=kw.get('gross_kg'),
        box_count=kw.get('box_count'), pallet_count=kw.get('pallet_count'),
        pallet_weight_kg=kw.get('pallet_weight_kg'),
    )


def _mock_invoice(*, with_shipment=True, truck_preset=None, firm_weights=None,
                  quantity_kg=Decimal('9000'), override=None):
    """Build a SimpleNamespace invoice mirroring the real ORM attributes used.

    ``truck_preset`` = whole-truck PackingPreset on the shipment (drives CMR and the
    per-firm derivation). ``firm_weights`` = the shipment's firm-split weights (the
    total the truck config is split across); default [] → falls back to quantity_kg.
    ``override`` = per-firm invoice override dict (gross_kg/box_count/…).
    """
    seller = SimpleNamespace(
        name_ru='Х.О «Датлы миве»', name_en='Datly miwe LLC', name_tk='',
        address_ru='г. Ашгабат', address_en='Ashgabat', address_tk='',
        bank_details_ru='Банк: АКБТ', bank_details_en='Bank: SCBT', bank_details_tk='',
    )
    country = SimpleNamespace(name_ru='Узбекистан', name_en='Uzbekistan', name_tk='Özbegistan')
    buyer = SimpleNamespace(
        name_company='ООО TRUST', address='г. Ташкент', bank_details='ИНН: 311270964',
        country=country,
    )
    splits = [SimpleNamespace(weight_kg=w) for w in (firm_weights or [])]
    shipment = SimpleNamespace(
        weight_net=Decimal('9000'), weight_gross=Decimal('10720'), box_count=1800,
        pallet_count=16, packaging_kg=Decimal('300'), pallet_weight_kg=Decimal('300'),
        truck_plate='BR1427LB', trailer_id=5311, driver_name='Ahmet A.', country=country,
        packing_preset=truck_preset,
        firm_splits=SimpleNamespace(all=lambda: splits),
    ) if with_shipment else None
    contract = SimpleNamespace(
        contract_number='93/26-DM-EXP', start_date=date(2026, 3, 16),
        export_firm=seller, import_firm=buyer, incoterm='FCA',
    )
    ov = override or {}
    return SimpleNamespace(
        invoice_number=118, invoice_date=date(2026, 3, 16), contract=contract,
        shipment=shipment, export_firm=seller, import_firm=buyer, incoterm='FCA',
        quantity_kg=quantity_kg, price_per_kg=Decimal('0.87'),
        total_usd=Decimal('7830'),
        gross_kg=ov.get('gross_kg'), box_count=ov.get('box_count'),
        pallet_count=ov.get('pallet_count'), pallet_weight_kg=ov.get('pallet_weight_kg'),
    )


class InvoiceContextBuilderTest(SimpleTestCase):
    """Pure builder: formatting, language selection, shipment fallback."""

    def test_ru_context_values_and_formatting(self):
        c = ctx.build_invoice_context(_mock_invoice(), 'ru')
        self.assertEqual(c['invoice_no'], '118')
        self.assertEqual(c['invoice_date'], '16.03.2026')
        self.assertEqual(c['contract_line'], '93/26-DM-EXP, 16.03.2026')
        self.assertEqual(c['seller_name'], 'Х.О «Датлы миве»')
        self.assertEqual(c['buyer_name'], 'ООО TRUST')
        # RU convention: space-thousands + comma-decimal
        self.assertEqual(c['total_sum'], '7 830,00')
        item = c['line_items'][0]
        self.assertEqual(item['name'], 'Помидор свежий')
        self.assertEqual(item['code'], ctx.TOMATO_HS_CODE)
        self.assertEqual(item['gross'], '10 720')
        self.assertEqual(item['net'], '9 000')
        self.assertEqual(item['price'], '0,87')
        self.assertIn('2026', c['country_origin'])

    def test_en_keeps_english_number_format_and_firm_columns(self):
        c = ctx.build_invoice_context(_mock_invoice(), 'en')
        self.assertEqual(c['seller_name'], 'Datly miwe LLC')
        self.assertEqual(c['line_items'][0]['name'], 'Fresh tomatoes')
        self.assertIn('harvest', c['country_origin'])
        # EN convention unchanged: comma-thousands + dot-decimal
        self.assertEqual(c['total_sum'], '7,830.00')
        self.assertEqual(c['line_items'][0]['gross'], '10,720')
        self.assertEqual(c['line_items'][0]['price'], '0.87')

    def test_falls_back_to_invoice_qty_when_no_shipment(self):
        c = ctx.build_invoice_context(_mock_invoice(with_shipment=False), 'ru')
        # net falls back to invoice.quantity_kg; gross/transport empty
        self.assertEqual(c['line_items'][0]['net'], '9 000')
        self.assertEqual(c['line_items'][0]['gross'], '')
        self.assertEqual(c['transport'], '')
        self.assertEqual(c['pallet_note'], '')

    def test_per_firm_derives_from_truck_split(self):
        """This firm's packing = truck config split by its weight share.
        Truck 18000/20400 gross/3040 boxes; this firm 10000 of 10000+8000."""
        truck = _preset(
            net_kg=Decimal('18000'), gross_kg=Decimal('20400'), box_count=3040,
            pallet_count=Decimal('33'), pallet_weight_kg=Decimal('380'),
        )
        c = ctx.build_invoice_context(
            _mock_invoice(truck_preset=truck, firm_weights=[Decimal('10000'), Decimal('8000')],
                          quantity_kg=Decimal('10000')),
            'ru',
        )
        item = c['line_items'][0]
        self.assertEqual(item['net'], '10 000')    # firm's own weight (official)
        self.assertEqual(item['gross'], '11 333')  # 20400 × 10000/18000
        self.assertEqual(item['pieces'], '1689')   # round(3040 × 10000/18000)

    def test_per_firm_override_wins_over_derived(self):
        """A manual override on the sale beats the derived value."""
        truck = _preset(
            net_kg=Decimal('18000'), gross_kg=Decimal('20400'), box_count=3040,
            pallet_count=Decimal('33'), pallet_weight_kg=Decimal('380'),
        )
        c = ctx.build_invoice_context(
            _mock_invoice(truck_preset=truck, firm_weights=[Decimal('10000'), Decimal('8000')],
                          quantity_kg=Decimal('10000'),
                          override={'gross_kg': Decimal('11373'), 'box_count': 1618}),
            'ru',
        )
        item = c['line_items'][0]
        self.assertEqual(item['gross'], '11 373')  # override, not the derived 11333
        self.assertEqual(item['pieces'], '1618')


class CmrContextBuilderTest(SimpleTestCase):
    """Pure CMR builder: gross-with-pallet math, transport, refs, blanks."""

    def test_ru_cmr_values(self):
        c = ctx.build_cmr_context(_mock_invoice(), 'ru')
        self.assertEqual(c['sender_name'], 'Х.О «Датлы миве»')
        self.assertEqual(c['consignee_name'], 'ООО TRUST')
        self.assertEqual(c['country_dispatch'], 'Туркменистан')
        self.assertEqual(c['cargo_name'], 'Помидоры свежие')
        self.assertEqual(c['boxes'], '1800')
        self.assertEqual(c['pallets'], '16')
        # weight_gross is BRUT (with pallet): with = 10720, without = 10720 - 300
        self.assertEqual(c['gross_with_pallet'], '10 720')
        self.assertEqual(c['gross_without_pallet'], '10 420')
        self.assertEqual(c['net'], '9 000')
        self.assertIn('118', c['invoice_refs'])
        self.assertIn('Ahmet A.', c['transport'])
        # unmapped sources stay blank in v1
        self.assertEqual(c['route'], '')
        self.assertEqual(c['tir_carnet'], '')

    def test_en_cmr_localization(self):
        c = ctx.build_cmr_context(_mock_invoice(), 'en')
        self.assertEqual(c['cargo_name'], 'FRESH TOMATOES')
        self.assertEqual(c['country_dispatch'], 'Turkmenistan')
        self.assertEqual(c['gross_with_pallet'], '10,720')

    def test_no_shipment_blanks_transport_and_cargo(self):
        c = ctx.build_cmr_context(_mock_invoice(with_shipment=False), 'ru')
        self.assertEqual(c['transport'], '')
        self.assertEqual(c['boxes'], '')
        self.assertEqual(c['gross_without_pallet'], '')
        # net still falls back to invoice.quantity_kg
        self.assertEqual(c['net'], '9 000')


class CmrPresetTest(SimpleTestCase):
    """CMR reads the whole-truck preset on the shipment; BRUT = gross WITH pallet."""

    def test_whole_truck_preset_drives_cmr(self):
        # gross-net row 152 right block: BRUT 20450, NET 18000, boxes 2984, 33 pal, pallet 446.
        truck = _preset(
            net_kg=Decimal('18000'), gross_kg=Decimal('20450'), box_count=2984,
            pallet_count=Decimal('33'), pallet_weight_kg=Decimal('446'),
        )
        c = ctx.build_cmr_context(_mock_invoice(truck_preset=truck), 'ru')
        self.assertEqual(c['boxes'], '2984')
        self.assertEqual(c['pallets'], '33')                 # _num drops the .0
        self.assertEqual(c['net'], '18 000')
        self.assertEqual(c['pallet_weight'], '446')
        self.assertEqual(c['gross_with_pallet'], '20 450')   # BRUT as-is
        self.assertEqual(c['gross_without_pallet'], '20 004')  # BRUT − pallet weight


class LetterContextBuilderTest(SimpleTestCase):
    """Pure builders for the CT-1 / phyto / customs request letters."""

    def test_ct1_needs_only_firm_and_contract(self):
        c = ctx.build_ct1_context(_mock_invoice(), 'ru')
        self.assertEqual(c['firm_name'], 'Х.О «Датлы миве»')
        self.assertIn('93/26-DM-EXP', c['contract_line'])
        self.assertEqual(c['product'], 'Свежие Помидоры')

    def test_fito_resolves_country_weight_boxes(self):
        c = ctx.build_fito_context(_mock_invoice(), 'ru')
        self.assertEqual(c['country'], 'Узбекистан')
        self.assertEqual(c['net'], '9 000')   # RU space-thousands
        self.assertEqual(c['boxes'], '1800')

    def test_customs_is_turkmen_with_both_firms(self):
        c = ctx.build_customs_context(_mock_invoice(), 'tk')
        self.assertEqual(c['buyer_name'], 'ООО TRUST')
        self.assertEqual(c['country'], 'Özbegistan')  # tk country name
        self.assertIn('93/26-DM-EXP', c['contract_line'])

    def test_country_falls_back_when_no_shipment(self):
        # No shipment → resolver falls back to buyer firm's country
        c = ctx.build_fito_context(_mock_invoice(with_shipment=False), 'ru')
        self.assertEqual(c['country'], 'Узбекистан')


class InvoiceRenderSmokeTest(SimpleTestCase):
    """Fill the shipped templates and assert clean, value-bearing output."""

    def _text(self, data: bytes) -> str:
        doc = Document(BytesIO(data))
        parts = [p.text for p in doc.paragraphs]
        for t in doc.tables:
            for row in t.rows:
                parts.append(' | '.join(c.text for c in row.cells))
        return '\n'.join(parts)

    def test_render_docx_ru_and_en(self):
        expected_total = {'invoice_ru': '7 830,00', 'invoice_en': '7,830.00'}
        for key in ('invoice_ru', 'invoice_en'):
            data, filename, content_type = render.generate(key, _mock_invoice(), 'docx')
            text = self._text(data)
            self.assertNotIn('{{', text, f'{key}: unrendered tag')
            self.assertNotIn('{%', text, f'{key}: unrendered tag')
            self.assertIn('118', text)
            self.assertIn(expected_total[key], text)
            self.assertTrue(filename.endswith('.docx'))
            self.assertEqual(content_type, render.DOCX_CONTENT_TYPE)
            self.assertIn('118', filename)

    def test_render_cmr_ru_and_en(self):
        for key in ('cmr_ru', 'cmr_en'):
            data, filename, content_type = render.generate(key, _mock_invoice(), 'docx')
            text = self._text(data)
            self.assertNotIn('{{', text, f'{key}: unrendered tag')
            self.assertNotIn('{%', text, f'{key}: unrendered tag')
            self.assertIn('CMR', text)
            self.assertIn('CMR_', filename)
            self.assertEqual(content_type, render.DOCX_CONTENT_TYPE)

    def test_render_request_letters(self):
        expected = {'ct1_ru': 'СТ-1', 'fito_ru': 'Фитосанитарный', 'customs_tk': 'ARZA'}
        for key, marker in expected.items():
            data, filename, content_type = render.generate(key, _mock_invoice(), 'docx')
            text = self._text(data)
            self.assertNotIn('{{', text, f'{key}: unrendered tag')
            self.assertNotIn('{%', text, f'{key}: unrendered tag')
            self.assertIn(marker, text)
            self.assertEqual(content_type, render.DOCX_CONTENT_TYPE)

    def test_unsupported_format_raises(self):
        with self.assertRaises(ValueError):
            render.generate('invoice_ru', _mock_invoice(), 'xlsx')

    def test_pdf_without_libreoffice_raises_clear_error(self):
        with mock.patch.object(render, '_libreoffice_bin', return_value=None):
            with self.assertRaises(render.DocumentRenderError):
                render.generate('invoice_ru', _mock_invoice(), 'pdf')


class InvoiceDocumentEndpointTest(_SeededPermsMixin, TestCase):
    """API: GET /api/v1/contracts/sales/{id}/document/."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.user = _make_user('inv_doc', 'export_manager')
        self.client.force_authenticate(user=self.user)
        self.season = _make_season()
        self.ef = _make_export_firm('YGTDOC')
        self.imp = _make_import_firm('IMPDOC')
        self.contract = _make_contract('INV-DOC-001', self.ef, self.imp, self.season)
        self.invoice = _make_invoice(self.contract, invoice_number=1)

    def test_default_docx_download(self):
        resp = self.client.get(f'/api/v1/contracts/sales/{self.invoice.pk}/document/')
        self.assertEqual(resp.status_code, 200, resp.content[:200])
        self.assertEqual(resp['Content-Type'], render.DOCX_CONTENT_TYPE)
        self.assertIn('attachment;', resp['Content-Disposition'])
        self.assertIn('.docx', resp['Content-Disposition'])
        self.assertGreater(len(resp.content), 1000)

    def test_invoice_en_type(self):
        resp = self.client.get(
            f'/api/v1/contracts/sales/{self.invoice.pk}/document/?type=invoice_en'
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIn('_EN.docx', resp['Content-Disposition'])

    def test_cmr_ru_type(self):
        resp = self.client.get(
            f'/api/v1/contracts/sales/{self.invoice.pk}/document/?type=cmr_ru'
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIn('CMR_', resp['Content-Disposition'])
        self.assertEqual(resp['Content-Type'], render.DOCX_CONTENT_TYPE)

    def test_ct1_letter_type(self):
        resp = self.client.get(
            f'/api/v1/contracts/sales/{self.invoice.pk}/document/?type=ct1_ru'
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIn('CT1_', resp['Content-Disposition'])

    def test_unknown_type_returns_400(self):
        resp = self.client.get(
            f'/api/v1/contracts/sales/{self.invoice.pk}/document/?type=bogus'
        )
        self.assertEqual(resp.status_code, 400)

    def test_pdf_without_libreoffice_returns_503(self):
        with mock.patch.object(render, '_libreoffice_bin', return_value=None):
            resp = self.client.get(
                f'/api/v1/contracts/sales/{self.invoice.pk}/document/?fmt=pdf'
            )
        self.assertEqual(resp.status_code, 503)
