"""Tests for the RU/TK integer→words converter used in the export contract."""
from django.test import SimpleTestCase

from apps.contracts.services.amount_words import amount_words_ru, amount_words_tk


class AmountWordsRuTests(SimpleTestCase):
    def test_sample_contract_amounts(self):
        # The two real contracts (108/26 and 230/25) are the oracle.
        self.assertEqual(amount_words_ru(7830), 'семь тысяч восемьсот тридцать')
        self.assertEqual(
            amount_words_ru(566892),
            'пятьсот шестьдесят шесть тысяч восемьсот девяносто два',
        )

    def test_thousands_gender_and_plural(self):
        self.assertEqual(amount_words_ru(1000), 'одна тысяча')
        self.assertEqual(amount_words_ru(2000), 'две тысячи')
        self.assertEqual(amount_words_ru(5000), 'пять тысяч')
        self.assertEqual(amount_words_ru(21000), 'двадцать одна тысяча')

    def test_teens_and_tens(self):
        self.assertEqual(amount_words_ru(13), 'тринадцать')
        self.assertEqual(amount_words_ru(11000), 'одиннадцать тысяч')
        self.assertEqual(amount_words_ru(115), 'сто пятнадцать')

    def test_millions(self):
        self.assertEqual(amount_words_ru(1_000_000), 'один миллион')
        self.assertEqual(amount_words_ru(2_000_000), 'два миллиона')
        self.assertEqual(
            amount_words_ru(1_234_567),
            'один миллион двести тридцать четыре тысячи '
            'пятьсот шестьдесят семь',
        )

    def test_zero(self):
        self.assertEqual(amount_words_ru(0), 'ноль')


class AmountWordsTkTests(SimpleTestCase):
    def test_sample_contract_amounts(self):
        self.assertEqual(amount_words_tk(7830), 'ýedi müň sekiz ýüz otuz')
        self.assertEqual(
            amount_words_tk(566892),
            'bäş ýüz altmyş alty müň sekiz ýüz togsan iki',
        )

    def test_drops_leading_bir_before_mun_and_yuz(self):
        # Turkmen: 1000 → "müň" (not "bir müň"), 100 → "ýüz" (not "bir ýüz").
        self.assertEqual(amount_words_tk(1000), 'müň')
        self.assertEqual(amount_words_tk(1500), 'müň bäş ýüz')
        self.assertEqual(amount_words_tk(100), 'ýüz')
        self.assertEqual(amount_words_tk(150), 'ýüz elli')

    def test_keeps_bir_before_million(self):
        self.assertEqual(amount_words_tk(1_000_000), 'bir million')

    def test_round_thousands_and_tens(self):
        self.assertEqual(amount_words_tk(30), 'otuz')
        self.assertEqual(amount_words_tk(2000), 'iki müň')
        self.assertEqual(amount_words_tk(18500), 'on sekiz müň bäş ýüz')

    def test_zero(self):
        self.assertEqual(amount_words_tk(0), 'nol')
