"""Tests for parsing the real date out of an operator export code."""
from datetime import date

from django.test import SimpleTestCase

from apps.export.services.export_code import parse_export_code_date


class ParseExportCodeDateTests(SimpleTestCase):
    def test_june_code(self):
        self.assertEqual(parse_export_code_date('12JN121/26'), date(2026, 6, 12))

    def test_zero_padded_day(self):
        self.assertEqual(parse_export_code_date('04JN038/26'), date(2026, 6, 4))

    def test_november_is_nv(self):
        self.assertEqual(parse_export_code_date('03NV007/26'), date(2026, 11, 3))

    def test_all_months_resolve(self):
        cases = {
            'JA': 1, 'FB': 2, 'MR': 3, 'AP': 4, 'MY': 5, 'JN': 6,
            'JL': 7, 'AG': 8, 'SP': 9, 'OC': 10, 'NV': 11, 'DC': 12,
        }
        for code, month in cases.items():
            self.assertEqual(
                parse_export_code_date(f'15{code}001/26'),
                date(2026, month, 15),
                msg=code,
            )

    def test_lowercase_month_accepted(self):
        self.assertEqual(parse_export_code_date('12jn121/26'), date(2026, 6, 12))

    def test_blank_and_none(self):
        self.assertIsNone(parse_export_code_date(''))
        self.assertIsNone(parse_export_code_date(None))

    def test_unknown_month_returns_none(self):
        # 'NO' is the Turkmen-validator code; operators use 'NV' for November.
        self.assertIsNone(parse_export_code_date('03NO007/26'))

    def test_malformed_returns_none(self):
        for bad in ['random text', '12JN121-26', 'JN121/26', '1JN121/26', '12JN/26']:
            self.assertIsNone(parse_export_code_date(bad), msg=bad)

    def test_impossible_day_returns_none(self):
        self.assertIsNone(parse_export_code_date('32JN001/26'))
