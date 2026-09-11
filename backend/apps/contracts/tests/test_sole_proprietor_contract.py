"""The export contract's seller clause, which differs by legal form.

A Hususy telekeçi acts on a certificate (Tassyknama), not on a charter, so the
contract's opening sentence about the seller is a different sentence — not the
same sentence with different words. Everything else must keep the wording the
template carried before, character for character, which is what most of these
tests actually guard.
"""
import datetime

from django.test import SimpleTestCase

from apps.contracts.services import document_context as dc


class _Form:
    """Stand-in for a CompanyLegalType row."""

    def __init__(self, code, full_tk='', full_ru='', abbr_ru=''):
        self.code = code
        self.full_tk = full_tk
        self.full_ru = full_ru
        self.abbr_ru = abbr_ru


class _Firm:
    """Stand-in for an ExportFirm; only the fields the clause reads."""

    def __init__(self, **kwargs):
        defaults = {
            'legal_type': None,
            'name_tk': '', 'name_ru': '',
            'name_bare_tk': '', 'name_bare_ru': '',
            'patent_series': '', 'patent_number': '', 'patent_date': None,
            'director': '', 'director_tk': '',
        }
        defaults.update(kwargs)
        for key, value in defaults.items():
            setattr(self, key, value)


HT = _Form('HT', full_tk='Hususy Telekeçi',
           full_ru='Индивидуальный предприниматель', abbr_ru='И.П.')
HJ = _Form('HJ', full_tk='Hojalyk jemgyýeti',
           full_ru='Хозяйственное общество', abbr_ru='ХО')


def sole_proprietor(**overrides):
    firm = _Firm(
        legal_type=HT,
        name_tk='Hususy Telekeçi Döwranow J.A.',
        name_ru='И.П Довранов Дж.А.',
        name_bare_tk='Döwranow J.A.',
        name_bare_ru='Довранов Дж.А.',
        patent_series='A',
        patent_number='0037564',
        patent_date=datetime.date(2022, 12, 7),
        director='И.П Довранов Дж.А.',
    )
    for key, value in overrides.items():
        setattr(firm, key, value)
    return firm


def economic_society(**overrides):
    firm = _Firm(
        legal_type=HJ,
        name_tk='Ýigit H.J.',
        name_ru='Йигит Х.Дж.',
        name_bare_tk='Ýigit',
        name_bare_ru='Йигит',
        director='Чarыew A.',
        director_tk='Çaryýew A.',
    )
    for key, value in overrides.items():
        setattr(firm, key, value)
    return firm


class SoleProprietorClauseTests(SimpleTestCase):
    """The sentence the office asked for, word for word."""

    def test_turkmen_preamble_cites_the_certificate(self):
        self.assertEqual(
            dc._seller_clause(sole_proprietor(), 'tk'),
            '07.12.2022ý. senesindäki A seriýaly №0037564 Tassyknama esasynda '
            'hereket edýän Hususy Telekeçi Döwranow J.A.',
        )

    def test_russian_preamble_cites_the_certificate(self):
        self.assertEqual(
            dc._seller_clause(sole_proprietor(), 'ru'),
            'Индивидуальный предприниматель Довранов Дж.А., действующий на '
            'основании Свидетельства серии A №0037564 от 07.12.2022 г.',
        )

    def test_the_charter_and_the_hj_suffix_are_gone(self):
        """Both were hardcoded in the template and wrong for this firm."""
        for lang in ('tk', 'ru'):
            clause = dc._seller_clause(sole_proprietor(), lang)
            self.assertNotIn('HJ', clause)
            self.assertNotIn('Tertipnama', clause)
            self.assertNotIn('Устава', clause)
            self.assertNotIn('Хозяйственное общество', clause)

    def test_the_series_word_follows_the_language(self):
        firm = sole_proprietor()
        self.assertEqual(dc._patent_reference(firm, 'tk'), 'A seriýaly №0037564')
        self.assertEqual(dc._patent_reference(firm, 'ru'), 'серии A №0037564')

    def test_signature_block_names_the_person_not_a_company(self):
        firm = sole_proprietor()
        self.assertEqual(dc._seller_block(firm, 'tk'), 'Hususy Telekeçi Döwranow J.A.')
        self.assertEqual(
            dc._seller_block(firm, 'ru'), 'Индивидуальный предприниматель Довранов Дж.А.'
        )

    def test_signature_label_is_the_legal_form_not_director(self):
        firm = sole_proprietor()
        self.assertEqual(dc._seller_title(firm, 'tk'), 'Hususy Telekeçi')
        self.assertEqual(dc._seller_title(firm, 'ru'), 'И.П.')

    def test_signature_line_does_not_repeat_the_form(self):
        """`director` stores "И.П Довранов Дж.А." — using it would print the
        form twice under a label that already says И.П."""
        firm = sole_proprietor()
        self.assertEqual(dc._seller_director_for(firm, 'tk'), 'Döwranow J.A.')
        self.assertEqual(dc._seller_director_for(firm, 'ru'), 'Довранов Дж.А.')

    def test_appendix_footer_carries_both_languages(self):
        self.assertEqual(
            dc._seller_footer(sole_proprietor()),
            'Индивидуальный предприниматель Довранов Дж.А./Hususy Telekeçi Döwranow J.A.',
        )


class MissingCertificateTests(SimpleTestCase):
    """A blank certificate must not print a sentence with a hole in it."""

    def test_no_certificate_at_all_names_the_person_alone(self):
        firm = sole_proprietor(patent_series='', patent_number='', patent_date=None)
        self.assertEqual(dc._seller_clause(firm, 'tk'), 'Hususy Telekeçi Döwranow J.A.')
        self.assertEqual(
            dc._seller_clause(firm, 'ru'), 'Индивидуальный предприниматель Довранов Дж.А.'
        )

    def test_a_date_with_no_number_still_reads(self):
        firm = sole_proprietor(patent_series='', patent_number='')
        self.assertEqual(
            dc._seller_clause(firm, 'tk'),
            '07.12.2022ý. senesindäki Tassyknama esasynda hereket edýän '
            'Hususy Telekeçi Döwranow J.A.',
        )

    def test_a_number_with_no_date_still_reads(self):
        firm = sole_proprietor(patent_date=None)
        self.assertEqual(
            dc._seller_clause(firm, 'ru'),
            'Индивидуальный предприниматель Довранов Дж.А., действующий на '
            'основании Свидетельства серии A №0037564',
        )

    def test_an_unsplit_name_falls_back_to_the_stored_one(self):
        firm = sole_proprietor(name_bare_tk='', name_bare_ru='')
        self.assertIn('Hususy Telekeçi Döwranow J.A.', dc._seller_clause(firm, 'tk'))


class EveryOtherFormIsUnchangedTests(SimpleTestCase):
    """The wording these produce is what the template used to hardcode."""

    def test_economic_society_keeps_the_charter_sentence(self):
        firm = economic_society()
        self.assertEqual(
            dc._seller_clause(firm, 'tk'),
            '“Ýigit” HJ-iň (Türkmenistan), Tertipnama laýyklykda hereket edýän '
            'Direktor Çaryýew A.',
        )
        self.assertEqual(
            dc._seller_clause(firm, 'ru'),
            'Хозяйственное общество «Йигит» (Туркменистан), в лице Директора '
            'Чarыew A., действующего на основании Устава',
        )

    def test_economic_society_keeps_its_signature_block(self):
        firm = economic_society()
        self.assertEqual(dc._seller_block(firm, 'tk'), '"Ýigit" hojalyk jemgyýeti')
        self.assertEqual(dc._seller_block(firm, 'ru'), 'Хозяйственное общество «Йигит»')
        self.assertEqual(dc._seller_footer(firm), 'ХО «Йигит»/"Ýigit" HJ')
        self.assertEqual(dc._seller_title(firm, 'tk'), 'Direktor')
        self.assertEqual(dc._seller_title(firm, 'ru'), 'Директор')

    def test_a_firm_with_no_legal_form_set_reads_as_before(self):
        """Seven export firms are deliberately untyped; they must not move."""
        firm = _Firm(
            name_tk='Mähriban A.', name_ru='Мэхрибан А.',
            director='Аллабердыев Ш.К.',
        )
        self.assertEqual(
            dc._seller_clause(firm, 'tk'),
            '“Mähriban A.” HJ-iň (Türkmenistan), Tertipnama laýyklykda hereket '
            'edýän Direktor Аллабердыев Ш.К.',
        )
        self.assertEqual(dc._seller_title(firm, 'tk'), 'Direktor')

    def test_a_quoted_stored_name_still_doubles_its_quotes(self):
        """Pre-existing and deliberately left alone.

        `_bare_seller_name` strips the legal form but never the quote marks, and
        the clause adds its own pair, so a firm stored as '“Ak Bulut” HJ' has
        always printed '““Ak Bulut””'. Eleven firms are stored that way. Fixing
        it changes what 18 firms print, which was not part of this change.
        """
        firm = economic_society(name_tk='“Ak Bulut” HJ', name_bare_tk='Ak Bulut')
        self.assertIn('““Ak Bulut””', dc._seller_clause(firm, 'tk'))

    def test_a_certificate_on_a_non_sole_proprietor_is_ignored(self):
        """Data entered on the wrong firm must not change its contract."""
        firm = economic_society(
            patent_series='A', patent_number='0037564',
            patent_date=datetime.date(2022, 12, 7),
        )
        self.assertNotIn('Tassyknama', dc._seller_clause(firm, 'tk'))
        self.assertNotIn('Свидетельства', dc._seller_clause(firm, 'ru'))


class TemplateWiringTests(SimpleTestCase):
    """The .docx must ask for the keys the builder now produces."""

    def test_the_template_carries_the_new_placeholders(self):
        import re
        import zipfile
        from pathlib import Path

        path = (
            Path(dc.__file__).resolve().parent.parent
            / 'document_templates' / 'contract_kz.docx'
        )
        xml = zipfile.ZipFile(path).read('word/document.xml').decode('utf-8')
        text = ''.join(re.findall(r'<w:t[^>]*>(.*?)</w:t>', xml, re.S))

        for key in (
            'seller_clause_tk', 'seller_clause_ru', 'seller_block_tk',
            'seller_block_ru', 'seller_footer', 'seller_title_tk', 'seller_title_ru',
        ):
            self.assertIn('{{ %s }}' % key, text, key)

        # The seller's legal form is no longer written into the template.
        for hardcoded in (
            'hojalyk jemgyýeti', 'Хозяйственное общество', 'HJ-iň',
            'Tertipnama laýyklykda',
        ):
            self.assertNotIn(hardcoded, text, hardcoded)

        # The buyer's wording is deliberately left alone for now.
        self.assertIn('JÇB', text)
