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

from apps.core.models import ShipmentStatusType
from apps.export.models import Shipment, ShipmentFirmSplit
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


def _make_packed_shipment(season, import_firm, status_code='draft', code='0101777/25'):
    """A shipment with complete packing (gross/net/boxes/pallets) — passes the guard."""
    status, _ = ShipmentStatusType.objects.get_or_create(
        code=status_code,
        defaults={'name_tk': status_code, 'name_en': status_code.title(),
                  'name_ru': status_code, 'step_order': 0, 'phase': 'PREP'},
    )
    return Shipment.objects.create(
        shipment_code=code, date='2025-10-01', season=season, status=status,
        import_firm=import_firm, weight_gross=Decimal('10720'), weight_net=Decimal('9000'),
        box_count=1800, pallet_count=16,
    )


def _preset(**kw):
    """A PackingTemplate stand-in (whole-truck values), for the CMR."""
    return SimpleNamespace(
        net_kg=kw.get('net_kg'), gross_kg=kw.get('gross_kg'),
        box_count=kw.get('box_count'), pallet_count=kw.get('pallet_count'),
        pallet_weight_kg=kw.get('pallet_weight_kg'),
    )


def _mock_invoice(*, with_shipment=True, truck_template=None,
                  quantity_kg=Decimal('9000'), packing=None):
    """Build a SimpleNamespace invoice mirroring the real ORM attributes used.

    ``truck_template`` = whole-truck PackingTemplate on the shipment (drives the CMR).
    ``packing`` = the firm's explicit packing on the sale (gross_kg/box_count/…), the
    values copied from the template share and printed on the Invoice.
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
    shipment = SimpleNamespace(
        weight_net=Decimal('9000'), weight_gross=Decimal('10720'), box_count=1800,
        pallet_count=16, packaging_kg=Decimal('300'), pallet_weight_kg=Decimal('300'),
        truck_plate='BR1427LB', trailer_id=5311, driver_name='Ahmet A.', country=country,
        packing_template=truck_template,
    ) if with_shipment else None
    contract = SimpleNamespace(
        contract_number='93/26-DM-EXP', start_date=date(2026, 3, 16),
        export_firm=seller, import_firm=buyer, incoterm='FCA',
    )
    pk = packing or {}
    return SimpleNamespace(
        invoice_number=118, invoice_date=date(2026, 3, 16), contract=contract,
        shipment=shipment, export_firm=seller, import_firm=buyer, incoterm='FCA',
        quantity_kg=quantity_kg, price_per_kg=Decimal('0.87'),
        total_usd=Decimal('7830'),
        gross_kg=pk.get('gross_kg'), box_count=pk.get('box_count'),
        pallet_count=pk.get('pallet_count'), pallet_weight_kg=pk.get('pallet_weight_kg'),
    )


def _mock_firm(name_ru, name_en, address_ru, address_en):
    return SimpleNamespace(
        name_ru=name_ru, name_en=name_en, name_tk='',
        address_ru=address_ru, address_en=address_en, address_tk='',
        bank_details_ru='', bank_details_en='', bank_details_tk='',
    )


def _mock_shipment(*, firms=None, truck_template=None):
    """A SimpleNamespace shipment mirroring the ORM attributes the CMR builder reads.

    ``firms`` = the export firms on the truck (default one); each becomes a firm
    split and a matching invoice. ``.firm_splits`` / ``.sales`` expose ``.all()``.
    """
    if firms is None:
        firms = [_mock_firm('Х.О «Датлы миве»', 'Datly miwe LLC', 'г. Ашгабат', 'Ashgabat')]
    country = SimpleNamespace(name_ru='Узбекистан', name_en='Uzbekistan', name_tk='Özbegistan')
    buyer = SimpleNamespace(
        name_company='ООО TRUST', address='г. Ташкент', bank_details='ИНН: 311270964', country=country,
    )
    splits = [SimpleNamespace(export_firm=firm) for firm in firms]
    sales = [SimpleNamespace(invoice_number=118 + i, invoice_date=date(2026, 3, 16))
             for i in range(len(firms))]
    return SimpleNamespace(
        shipment_code='0316118/25',
        firm_splits=SimpleNamespace(all=lambda: splits),
        sales=SimpleNamespace(all=lambda: sales),
        import_firm=buyer, packing_template=truck_template,
        weight_net=Decimal('9000'), weight_gross=Decimal('10720'), box_count=1800,
        pallet_count=16, packaging_kg=Decimal('300'), pallet_weight_kg=Decimal('300'),
        truck_plate='BR1427LB', trailer_id=5311, driver_name='Ahmet A.', date=date(2026, 3, 16),
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

    def test_place_loading_override(self):
        # blank by default, filled from generate-time overrides
        self.assertEqual(ctx.build_invoice_context(_mock_invoice(), 'ru')['place_loading'], '')
        c = ctx.build_invoice_context(_mock_invoice(), 'ru', {'place_loading': 'Kaka'})
        self.assertEqual(c['place_loading'], 'Kaka')

    def test_falls_back_to_invoice_qty_when_no_shipment(self):
        c = ctx.build_invoice_context(_mock_invoice(with_shipment=False), 'ru')
        # net falls back to invoice.quantity_kg; gross/transport empty
        self.assertEqual(c['line_items'][0]['net'], '9 000')
        self.assertEqual(c['line_items'][0]['gross'], '')
        self.assertEqual(c['transport'], '')
        self.assertEqual(c['pallet_note'], '')

    def test_per_firm_packing_prints_explicit_share(self):
        """The invoice prints the firm's explicit packing (copied from the share)."""
        c = ctx.build_invoice_context(
            _mock_invoice(quantity_kg=Decimal('10000'),
                          packing={'gross_kg': Decimal('11373'), 'box_count': 1618,
                                   'pallet_count': Decimal('18'), 'pallet_weight_kg': Decimal('229')}),
            'ru',
        )
        item = c['line_items'][0]
        self.assertEqual(item['net'], '10 000')    # firm's own weight (official)
        self.assertEqual(item['gross'], '11 373')  # the firm's share gross, not the truck
        self.assertEqual(item['pieces'], '1618')

    def test_per_firm_packing_falls_back_to_shipment(self):
        """With no per-firm packing set, gross/boxes fall back to the shipment."""
        c = ctx.build_invoice_context(_mock_invoice(), 'ru')  # no packing dict
        item = c['line_items'][0]
        self.assertEqual(item['gross'], '10 720')  # shipment.weight_gross
        self.assertEqual(item['pieces'], '1800')   # shipment.box_count


class PackingGuardTest(SimpleTestCase):
    """missing_packing_on: raw cells OR an applied PackingTemplate satisfy the guard."""

    def test_complete_raw_cells_pass(self):
        self.assertEqual(ctx.missing_packing_on(_mock_shipment()), [])

    def test_no_shipment_all_missing(self):
        self.assertEqual(len(ctx.missing_packing_on(None)), 4)

    def test_missing_raw_cell_reported(self):
        ship = _mock_shipment()
        ship.box_count = None
        self.assertEqual(ctx.missing_packing_on(ship), ['box_count'])

    def test_template_fills_null_raw_cells(self):
        # Template-configured truck: raw cells null, but the template supplies all.
        ship = _mock_shipment(truck_template=_preset(
            net_kg=Decimal('18000'), gross_kg=Decimal('20450'),
            box_count=2984, pallet_count=Decimal('33'), pallet_weight_kg=Decimal('446'),
        ))
        ship.weight_gross = ship.weight_net = ship.box_count = ship.pallet_count = None
        self.assertEqual(ctx.missing_packing_on(ship), [])

    def test_neither_source_blocks(self):
        ship = _mock_shipment()  # no template
        ship.weight_gross = ship.weight_net = ship.box_count = ship.pallet_count = None
        self.assertEqual(sorted(ctx.missing_packing_on(ship)), sorted(ctx.REQUIRED_PACKING_FIELDS))


class CmrContextBuilderTest(SimpleTestCase):
    """Pure CMR builder (truck-level): gross-with-pallet math, transport, refs."""

    def test_ru_cmr_values(self):
        c = ctx.build_cmr_context(_mock_shipment(), 'ru')
        self.assertEqual(c['sender_name'], 'Х.О «Датлы миве»')
        # forwarder is the export firm(s) (same as the sender box)
        self.assertEqual(c['forwarder'], 'Х.О «Датлы миве»')
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
        # generate-time fields stay blank when no overrides are supplied
        self.assertEqual(c['tir_carnet'], '')
        self.assertEqual(c['place_loading'], '')

    def test_multi_firm_lists_all_senders(self):
        firms = [
            _mock_firm('Х.О «Датлы миве»', 'Datly miwe LLC', 'г. Ашгабат', 'Ashgabat'),
            _mock_firm('Х.О «Ýigit»', 'Yigit LLC', 'г. Мары', 'Mary'),
        ]
        c = ctx.build_cmr_context(_mock_shipment(firms=firms), 'ru')
        # both export firms appear in the single sender box (newline-joined)
        self.assertIn('Датлы миве', c['sender_name'])
        self.assertIn('Ýigit', c['sender_name'])
        # both invoices referenced on the one truck CMR
        self.assertIn('118', c['invoice_refs'])
        self.assertIn('119', c['invoice_refs'])

    def test_generate_time_overrides(self):
        c = ctx.build_cmr_context(
            _mock_shipment(), 'ru',
            {'place_loading': 'Dusak', 'tir_carnet': 'RU 82345678'},
        )
        self.assertEqual(c['place_loading'], 'Dusak')
        self.assertEqual(c['tir_carnet'], 'RU 82345678')

    def test_en_cmr_localization(self):
        c = ctx.build_cmr_context(_mock_shipment(), 'en')
        self.assertEqual(c['cargo_name'], 'FRESH TOMATOES')
        self.assertEqual(c['country_dispatch'], 'Turkmenistan')
        self.assertEqual(c['gross_with_pallet'], '10,720')


class CmrPresetTest(SimpleTestCase):
    """CMR reads the whole-truck template on the shipment; BRUT = gross WITH pallet."""

    def test_whole_truck_template_drives_cmr(self):
        # gross-net row 152 right block: BRUT 20450, NET 18000, boxes 2984, 33 pal, pallet 446.
        truck = _preset(
            net_kg=Decimal('18000'), gross_kg=Decimal('20450'), box_count=2984,
            pallet_count=Decimal('33'), pallet_weight_kg=Decimal('446'),
        )
        c = ctx.build_cmr_context(_mock_shipment(truck_template=truck), 'ru')
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
        # two firms on the truck → both sender names must survive into the docx
        firms = [
            _mock_firm('Х.О «Датлы миве»', 'Datly miwe LLC', 'г. Ашгабат', 'Ashgabat'),
            _mock_firm('Х.О «Ýigit»', 'Yigit LLC', 'г. Мары', 'Mary'),
        ]
        for key, names in (('cmr_ru', ('Датлы миве', 'Ýigit')), ('cmr_en', ('Datly miwe', 'Yigit'))):
            data, filename, content_type = render.generate(key, _mock_shipment(firms=firms), 'docx')
            text = self._text(data)
            self.assertNotIn('{{', text, f'{key}: unrendered tag')
            self.assertNotIn('{%', text, f'{key}: unrendered tag')
            self.assertIn('CMR', text)
            self.assertIn('CMR_', filename)
            for name in names:
                self.assertIn(name, text, f'{key}: sender {name!r} missing from render')
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
        # Documents require complete shipment packing; link a fully-packed shipment.
        self.invoice.shipment = _make_packed_shipment(self.season, self.imp)
        self.invoice.save(update_fields=['shipment'])

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

    def test_cmr_type_rejected_on_invoice_endpoint(self):
        # CMR is now truck-level (shipment scope); the per-invoice endpoint rejects it.
        resp = self.client.get(
            f'/api/v1/contracts/sales/{self.invoice.pk}/document/?type=cmr_ru'
        )
        self.assertEqual(resp.status_code, 400)

    def test_ct1_letter_type(self):
        resp = self.client.get(
            f'/api/v1/contracts/sales/{self.invoice.pk}/document/?type=ct1_ru'
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIn('CT1_', resp['Content-Disposition'])

    def test_incomplete_packing_returns_400(self):
        # clear a required packing cell → generation is blocked with a clear error
        self.invoice.shipment.pallet_count = None
        self.invoice.shipment.save(update_fields=['pallet_count'])
        resp = self.client.get(f'/api/v1/contracts/sales/{self.invoice.pk}/document/')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('pallet_count', resp.json()['missing_packing'])

    def test_no_shipment_returns_400(self):
        invoice = _make_invoice(self.contract, invoice_number=2)  # no shipment linked
        resp = self.client.get(f'/api/v1/contracts/sales/{invoice.pk}/document/')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(len(resp.json()['missing_packing']), 4)

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


class ShipmentCmrEndpointTest(_SeededPermsMixin, TestCase):
    """API: GET /api/v1/contracts/shipments/{id}/cmr/ — truck-level CMR."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.user = _make_user('cmr_doc', 'export_manager')
        self.client.force_authenticate(user=self.user)
        self.season = _make_season()
        self.imp = _make_import_firm('IMPCMR')
        self.shipment = _make_packed_shipment(self.season, self.imp)
        # Two export firms on the one truck → both are senders on the CMR.
        for code in ('YGTA', 'YGTB'):
            ShipmentFirmSplit.objects.create(
                shipment=self.shipment, export_firm=_make_export_firm(code),
                weight_kg=Decimal('9000'), amount_usd=Decimal('8000'),
            )

    def test_truck_cmr_docx(self):
        resp = self.client.get(f'/api/v1/contracts/shipments/{self.shipment.pk}/cmr/')
        self.assertEqual(resp.status_code, 200, resp.content[:200])
        self.assertEqual(resp['Content-Type'], render.DOCX_CONTENT_TYPE)
        self.assertIn('CMR_', resp['Content-Disposition'])

    def test_en_lang_filename(self):
        resp = self.client.get(
            f'/api/v1/contracts/shipments/{self.shipment.pk}/cmr/?lang=en'
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIn('_EN.docx', resp['Content-Disposition'])

    def test_incomplete_packing_returns_400(self):
        self.shipment.box_count = None
        self.shipment.save(update_fields=['box_count'])
        resp = self.client.get(f'/api/v1/contracts/shipments/{self.shipment.pk}/cmr/')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('box_count', resp.json()['missing_packing'])

    def test_missing_shipment_returns_404(self):
        resp = self.client.get('/api/v1/contracts/shipments/999999/cmr/')
        self.assertEqual(resp.status_code, 404)


class DocumentPacketEndpointTest(_SeededPermsMixin, TestCase):
    """API: GET /api/v1/contracts/document-packets/ — one row per truck."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.user = _make_user('pkt_doc', 'export_manager')
        self.client.force_authenticate(user=self.user)
        self.season = _make_season()
        self.season.is_active = True
        self.season.save(update_fields=['is_active'])
        self.imp = _make_import_firm('IMPPKT')
        self.ef1 = _make_export_firm('PKTA')
        self.ef2 = _make_export_firm('PKTB')
        self.shipment = _make_packed_shipment(
            self.season, self.imp, status_code='yola_chykdy', code='0101701/25',
        )
        for firm in (self.ef1, self.ef2):
            ShipmentFirmSplit.objects.create(
                shipment=self.shipment, export_firm=firm,
                weight_kg=Decimal('9000'), amount_usd=Decimal('8000'),
            )
        # ef1 has a linked sale (invoice); ef2 does not yet.
        contract = _make_contract('PKT-C1', self.ef1, self.imp, self.season)
        sale = _make_invoice(contract, invoice_number=1)
        sale.shipment = self.shipment
        sale.export_firm = self.ef1
        sale.save(update_fields=['shipment', 'export_firm'])

    def test_lists_truck_packet(self):
        resp = self.client.get('/api/v1/contracts/document-packets/')
        self.assertEqual(resp.status_code, 200)
        results = resp.json()['results']
        self.assertEqual(len(results), 1)
        pkt = results[0]
        self.assertEqual(pkt['id'], self.shipment.id)
        self.assertTrue(pkt['packing_complete'])
        self.assertEqual(pkt['buyer_name'], self.imp.name_short or self.imp.name_company)
        by_firm = {f['export_firm_id']: f for f in pkt['firms']}
        self.assertEqual(len(by_firm), 2)
        self.assertIsNotNone(by_firm[self.ef1.id]['sale_id'])   # ef1 has a sale
        self.assertIsNone(by_firm[self.ef2.id]['sale_id'])      # ef2 does not

    def test_excludes_draft_truck(self):
        draft = _make_packed_shipment(
            self.season, self.imp, status_code='draft', code='0101702/25',
        )
        ShipmentFirmSplit.objects.create(
            shipment=draft, export_firm=self.ef1,
            weight_kg=Decimal('9000'), amount_usd=Decimal('8000'),
        )
        ids = [p['id'] for p in self.client.get('/api/v1/contracts/document-packets/').json()['results']]
        self.assertIn(self.shipment.id, ids)
        self.assertNotIn(draft.id, ids)

    def test_incomplete_packing_flag(self):
        self.shipment.box_count = None
        self.shipment.save(update_fields=['box_count'])
        pkt = self.client.get('/api/v1/contracts/document-packets/').json()['results'][0]
        self.assertFalse(pkt['packing_complete'])
        self.assertIn('box_count', pkt['missing_packing'])

    def test_firm_filter(self):
        on = self.client.get(f'/api/v1/contracts/document-packets/?firm={self.ef1.id}')
        self.assertEqual(len(on.json()['results']), 1)
        other = _make_export_firm('PKTC')
        off = self.client.get(f'/api/v1/contracts/document-packets/?firm={other.id}')
        self.assertEqual(len(off.json()['results']), 0)
