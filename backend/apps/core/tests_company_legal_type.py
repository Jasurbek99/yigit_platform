"""Legal-entity forms on firms: the name parser, and the reference endpoint.

The parser is the part worth pinning. It ran once as migration `core.0046`
against 25 export and 119 import firms whose names were written by hand over
several years, in two alphabets, with five styles of quotation mark. The cases
below are real strings from that registry, not invented ones.
"""
import importlib.util
from pathlib import Path

from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import CompanyLegalType, Country, ExportFirm, ImportFirm, User


def _load_backfill():
    """Import the migration module directly — its parser is the unit under test."""
    path = Path(__file__).resolve().parent / 'migrations' / '0046_backfill_firm_legal_types.py'
    spec = importlib.util.spec_from_file_location('backfill_legal_types', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


backfill = _load_backfill()


class ParseNameTests(TestCase):
    """One stored name string in, (legal form, bare name) out."""

    def assertParses(self, stored, expected_code, expected_bare):
        code, bare = backfill.parse_name(stored)
        self.assertEqual(
            (code, bare), (expected_code, expected_bare),
            f'{stored!r} parsed as {(code, bare)!r}',
        )

    def test_turkmen_suffix_forms(self):
        self.assertParses('“Ak Bulut” HJ', 'HJ', 'Ak Bulut')
        self.assertParses('Dürli Miweler H.J.', 'HJ', 'Dürli Miweler')
        self.assertParses('"Ata-Melhem" HK', 'HK', 'Ata-Melhem')

    def test_turkmen_prefix_forms_the_old_stripper_missed(self):
        """The regex this replaces only matched a trailing H.J., so these ten
        firms printed as economic societies on every contract."""
        self.assertParses('Hususy Telekeçi Döwranow J.A.', 'HT', 'Döwranow J.A.')
        self.assertParses('Telekeçi Amangeldiýew G.', 'HT', 'Amangeldiýew G.')

    def test_russian_prefix_forms(self):
        self.assertParses('Х.О"Ак Булут"', 'HJ', 'Ак Булут')
        self.assertParses('Хозяйственное общество «Йумак»', 'HJ', 'Йумак')
        self.assertParses('ИП «Кервенли иллер»', 'HT', 'Кервенли иллер')
        self.assertParses('ООО «Гринтек»', 'OOO', 'Гринтек')
        self.assertParses('ТОО "Нур-Алем"', 'TOO', 'Нур-Алем')
        self.assertParses('ОсОО «КРАСНЫЙ АПЕЛЬСИН»', 'OSOO', 'КРАСНЫЙ АПЕЛЬСИН')
        self.assertParses('МЧЖ «GOLD LEMON STERELIS »', 'MCHJ', 'GOLD LEMON STERELIS')
        self.assertParses('ТОВ "МУЛЬТІФРУКТ"', 'TOV', 'МУЛЬТІФРУКТ')
        self.assertParses('Фермерское хозяйство “Yusuf-Diyor”', 'FH', 'Yusuf-Diyor')

    def test_osoo_is_not_eaten_by_the_ooo_rule(self):
        """Both start with a Cyrillic О; the longer form has to be tried first."""
        self.assertParses('ОсОО "Ариес Лайн"', 'OSOO', 'Ариес Лайн')
        self.assertParses('ООО "Прогресс"', 'OOO', 'Прогресс')

    def test_latin_homoglyphs_in_a_cyrillic_form(self):
        """"OОО «Havvo Group»" leads with a LATIN O — a real row, and it looks
        identical to the Cyrillic one on screen."""
        self.assertParses('OОО «Havvo Group»', 'OOO', 'Havvo Group')
        self.assertParses('TОО «Араншы-KZ»', 'TOO', 'Араншы-KZ')

    def test_latin_forms(self):
        self.assertParses('LLC "Bukhorzoda"', 'LLC', 'Bukhorzoda')
        self.assertParses('“DURAKHSHI OSIYO” LLC', 'LLC', 'DURAKHSHI OSIYO')
        self.assertParses('Individual entrepreneur Hemidov P.', 'HT', 'Hemidov P.')
        self.assertParses('Economic society “Ishgar”', 'HJ', 'Ishgar')

    def test_a_form_wrapped_in_quotes_with_the_name(self):
        self.assertParses('"ALFA FRESH TRADING LLC"', 'LLC', 'ALFA FRESH TRADING')

    def test_missing_space_and_doubled_space(self):
        self.assertParses('ООО"TRUST INDUSTRY"', 'OOO', 'TRUST INDUSTRY')
        self.assertParses('ТОО  EDMART GROUP', 'TOO', 'EDMART GROUP')

    def test_mismatched_quote_styles(self):
        self.assertParses('ООО ‘’FADAK-1974”', 'OOO', 'FADAK-1974')

    def test_stray_full_stop_goes_but_initials_keep_theirs(self):
        self.assertParses('ОсОО Эко Агро Продукт.', 'OSOO', 'Эко Агро Продукт')
        self.assertParses('И.П Довранов Э.А.', 'HT', 'Довранов Э.А.')
        self.assertParses('ИП Джумамырадов Г.Дж.', 'HT', 'Джумамырадов Г.Дж.')

    def test_a_nested_quote_pair_is_left_alone(self):
        """Stripping the ends here would leave a dangling opener, so it doesn't."""
        self.assertParses(
            'ООО «Производственная компания «Салатория»',
            'OOO', '«Производственная компания «Салатория»',
        )

    def test_names_with_no_form_are_unresolved_not_empty(self):
        for stored in ('Mähriban A.', 'Tel Guwanc A.', 'Glawryba', '"J.D.MM. Dargo-88"'):
            code, bare = backfill.parse_name(stored)
            self.assertIsNone(code, stored)
            self.assertTrue(bare)

    def test_junk_rows_are_not_force_fitted(self):
        """A form buried mid-string is not a legal form — these need a human."""
        self.assertParses(
            'Грузополучатель: ИП ТУРСЫНБАЕВ О.Б.', None,
            'Грузополучатель: ИП ТУРСЫНБАЕВ О.Б.',
        )
        self.assertParses(
            'CUSTOMER «Masoud Behrooz LTD»', None, 'CUSTOMER «Masoud Behrooz LTD»',
        )

    def test_a_name_that_is_only_a_form_keeps_itself(self):
        """Degenerate data, but never render an empty «»."""
        self.assertParses('ООО', 'OOO', 'ООО')

    def test_blank(self):
        self.assertEqual(backfill.parse_name(''), (None, ''))
        self.assertEqual(backfill.parse_name(None), (None, ''))


class ResolveFirmTests(TestCase):
    """An export firm is typed only when every filled column agrees."""

    def resolve(self, tk, ru, en=None):
        return backfill.resolve_firm([('name_tk', tk), ('name_ru', ru), ('name_en', en)])

    def test_agreeing_columns_type_the_firm(self):
        code, bare = self.resolve('Ýigit H.J.', 'Йигит Х.Дж.', 'YIGIT HJ')
        self.assertEqual(code, 'HJ')
        self.assertEqual(bare['name_tk'], 'Ýigit')
        self.assertEqual(bare['name_ru'], 'Йигит')
        self.assertEqual(bare['name_en'], 'YIGIT')

    def test_turkmen_and_russian_naming_different_forms_stays_unresolved(self):
        """Firm BK: partnership in Turkmen, sole proprietor in Russian. One of
        the two is wrong and the migration must not pick."""
        code, bare = self.resolve(
            '"Bereketli Kerwensaraý" HJ',
            'Индивидуальное предприятия «Берекетли кервенсарай»',
        )
        self.assertIsNone(code)

    def test_an_unresolved_firm_keeps_its_names_verbatim(self):
        """So the document fallback is a no-op for exactly these rows."""
        code, bare = self.resolve('"Kerwenli Iller" HJ', 'ИП «Кервенли иллер»')
        self.assertIsNone(code)
        self.assertEqual(bare['name_tk'], '"Kerwenli Iller" HJ')
        self.assertEqual(bare['name_ru'], 'ИП «Кервенли иллер»')

    def test_one_unparsable_column_blocks_the_others(self):
        """Firm YE carries an unrecognised 'JH' in Turkmen. Typing it from the
        Russian alone would leave 'JH' sitting inside the bare Turkmen name."""
        code, _ = self.resolve(
            '“Ygtybarly enjamlar” JH',
            'ИП “Ыгтыбарлы энджамлар”',
            'Individual Enterprise "Ygtybarly enjamlar"',
        )
        self.assertIsNone(code)

    def test_an_empty_column_is_not_a_disagreement(self):
        code, _ = self.resolve('"Ýumak" HJ', 'Хозяйственное общество «Йумак»', '')
        self.assertEqual(code, 'HJ')

    def test_a_firm_with_no_form_anywhere_is_unresolved(self):
        code, _ = self.resolve('Mähriban A.', 'Мэхрибан А.', 'Mehriban A')
        self.assertIsNone(code)


class CompanyLegalTypeApiTests(TestCase):
    """The reference endpoint the settings screen and both selectors read."""

    def setUp(self):
        # The seed migration already created these on a real database, so every
        # fixture here is upserted rather than inserted.
        CompanyLegalType.objects.all().delete()
        self.kz, _ = Country.objects.get_or_create(
            code='KZ', defaults={'name_tk': 'Gazagystan', 'name_en': 'Kazakhstan'},
        )
        self.tm, _ = Country.objects.get_or_create(
            code='TM', defaults={'name_tk': 'Türkmenistan', 'name_en': 'Turkmenistan'},
        )

        self.hj = CompanyLegalType.objects.create(
            code='HJ', abbr_tk='HJ', abbr_ru='ХО', abbr_en='HJ',
            full_tk='Hojalyk jemgyýeti', full_ru='Хозяйственное общество',
            position_tk='SUFFIX', position_ru='PREFIX', sort_order=10,
        )
        self.hj.countries.set([self.tm])

        self.too = CompanyLegalType.objects.create(
            code='TOO', abbr_tk='JÇB', abbr_ru='ТОО',
            full_tk='Jogapkärçiligi çäklendirilen birleşme',
            full_ru='Товарищество с ограниченной ответственностью',
            position_tk='SUFFIX', position_ru='PREFIX', sort_order=50,
        )
        self.too.countries.set([self.kz])

        self.user = User.objects.create_user(
            username='ref-admin', password='x', role='admin', is_superuser=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_list_returns_every_form_with_its_country_codes(self):
        resp = self.client.get('/api/v1/core/company-legal-types/')
        self.assertEqual(resp.status_code, 200)
        rows = {r['code']: r for r in resp.json()['results']}
        self.assertEqual(set(rows), {'HJ', 'TOO'})
        self.assertEqual(rows['HJ']['country_codes'], ['TM'])
        self.assertEqual(rows['HJ']['position_tk'], 'SUFFIX')
        self.assertEqual(rows['HJ']['position_ru'], 'PREFIX')

    def test_country_filter_keeps_a_turkmen_form_off_a_kazakh_buyer(self):
        resp = self.client.get(f'/api/v1/core/company-legal-types/?country={self.kz.id}')
        self.assertEqual([r['code'] for r in resp.json()['results']], ['TOO'])

        resp = self.client.get(f'/api/v1/core/company-legal-types/?country={self.tm.id}')
        self.assertEqual([r['code'] for r in resp.json()['results']], ['HJ'])

    def test_anonymous_is_refused(self):
        client = APIClient()
        self.assertIn(client.get('/api/v1/core/company-legal-types/').status_code, (401, 403))


class FirmSerializerLegalTypeTests(TestCase):
    """Both admin firm endpoints carry the FK plus a display companion."""

    def setUp(self):
        ExportFirm.objects.all().delete()
        ImportFirm.objects.all().delete()
        CompanyLegalType.objects.all().delete()
        self.hj = CompanyLegalType.objects.create(
            code='HJ', abbr_tk='HJ', abbr_ru='ХО',
            full_tk='Hojalyk jemgyýeti', full_ru='Хозяйственное общество',
        )
        self.user = User.objects.create_user(
            username='firm-admin', password='x', role='admin', is_superuser=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_export_firm_exposes_the_form_and_the_bare_name(self):
        ExportFirm.objects.create(
            code='YGT', name_tk='Ýigit H.J.', legal_type=self.hj, name_bare_tk='Ýigit',
        )
        row = self.client.get('/api/v1/export/admin/firms/').json()['results'][0]
        self.assertEqual(row['legal_type'], self.hj.id)
        self.assertEqual(row['legal_type_code'], 'HJ')
        self.assertEqual(row['legal_type_display'], 'HJ')
        self.assertEqual(row['name_bare_tk'], 'Ýigit')
        # The stored name is untouched — documents still read it.
        self.assertEqual(row['name_tk'], 'Ýigit H.J.')

    def test_an_untyped_firm_reports_nulls_rather_than_failing(self):
        ExportFirm.objects.create(code='MA', name_tk='Mähriban A.')
        row = self.client.get('/api/v1/export/admin/firms/').json()['results'][0]
        self.assertIsNone(row['legal_type'])
        self.assertIsNone(row['legal_type_code'])
        self.assertIsNone(row['legal_type_display'])

    def test_import_firm_exposes_the_form(self):
        ImportFirm.objects.create(
            name_company='ТОО «Нур-Алем»', legal_type=self.hj, name_bare='Нур-Алем',
        )
        row = self.client.get('/api/v1/export/admin/import-firms/').json()['results'][0]
        self.assertEqual(row['legal_type'], self.hj.id)
        self.assertEqual(row['legal_type_display'], 'ХО')
        self.assertEqual(row['name_bare'], 'Нур-Алем')

    def test_the_form_can_be_set_through_a_patch(self):
        firm = ExportFirm.objects.create(code='AB', name_tk='“Ak Bulut” HJ')
        resp = self.client.patch(
            f'/api/v1/export/admin/firms/{firm.id}/',
            {'legal_type': self.hj.id}, format='json',
        )
        self.assertEqual(resp.status_code, 200)
        firm.refresh_from_db()
        self.assertEqual(firm.legal_type_id, self.hj.id)
