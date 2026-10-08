"""CT-1 / Fito: one printed «Адрес:» label, whatever label was typed into the firm card."""
from io import BytesIO

from django.test import SimpleTestCase, TestCase
from docx import Document

from apps.contracts.services.document_context import (
    _strip_address_label, build_ct1_context, build_fito_context,
)
from apps.contracts.services.document_render import generate
from apps.contracts.tests.test_contract_sale_api import (
    _make_contract, _make_export_firm, _make_import_firm, _make_invoice, _make_season,
)
from apps.contracts.tests.test_document_generation import _make_packed_shipment


class StripAddressLabelTest(SimpleTestCase):
    def test_typed_labels_are_removed(self):
        for typed in ('Юридический адрес: РК, г. Шымкент', 'Юр. Адрес: РК, г. Шымкент',
                      'Юр.Адрес:РК, г. Шымкент', 'Юр адрес : РК, г. Шымкент', 'Адрес: РК, г. Шымкент',
                      'Address: РК, г. Шымкент', 'юр. адрес: РК, г. Шымкент', '  Legal address: РК, г. Шымкент'):
            self.assertEqual(_strip_address_label(typed), 'РК, г. Шымкент', typed)

    def test_plain_address_is_untouched(self):
        self.assertEqual(_strip_address_label('Туркменистан, Ахалская область'), 'Туркменистан, Ахалская область')

    def test_colon_inside_the_address_is_kept(self):
        self.assertEqual(_strip_address_label('г. Ашгабат, ул. Мира: д. 5'), 'г. Ашгабат, ул. Мира: д. 5')

    def test_blank_stays_blank(self):
        self.assertEqual(_strip_address_label(''), '')
        self.assertEqual(_strip_address_label(None), '')


class LetterAddressTest(TestCase):
    def setUp(self):
        season = _make_season()
        self.imp = _make_import_firm('IMPADDR')
        self.firm = _make_export_firm('ADDRF')
        self.firm.address_ru = 'Юр.Адрес: Туркменистан, Ахалская область'
        self.firm.save(update_fields=['address_ru'])
        self.imp.address = 'Юридический адрес: РК, г. Шымкент'
        self.imp.save(update_fields=['address'])
        contract = _make_contract('ADDR-1', self.firm, self.imp, season)
        self.sale = _make_invoice(contract, invoice_number=1)
        self.sale.shipment = _make_packed_shipment(season, self.imp, code='0909001/25')
        self.sale.save(update_fields=['shipment'])
        self.sale.refresh_from_db()

    def test_context_carries_the_bare_addresses(self):
        for builder in (build_ct1_context, build_fito_context):
            ctx = builder(self.sale, 'ru', {})
            self.assertEqual(ctx['firm_address'], 'Туркменистан, Ахалская область')
            self.assertEqual(ctx['buyer_address'], 'РК, г. Шымкент')

    def _paragraphs(self, key):
        data, _, _ = generate(key, self.sale, 'docx', {}, highlight=False)
        return [p.text for p in Document(BytesIO(data)).paragraphs]

    def test_letters_print_one_label(self):
        for key in ('ct1_ru', 'fito_ru'):
            texts = self._paragraphs(key)
            self.assertIn('Адрес: Туркменистан, Ахалская область', texts, key)
            self.assertIn('Адрес: РК, г. Шымкент', texts, key)
            self.assertFalse(any('Юр' in t for t in texts), key)

    def test_no_address_prints_no_label(self):
        self.imp.address = ''
        self.imp.save(update_fields=['address'])
        for key in ('ct1_ru', 'fito_ru'):
            self.assertFalse(any(t.strip() == 'Адрес:' for t in self._paragraphs(key)), key)
