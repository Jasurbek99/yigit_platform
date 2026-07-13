"""Integer amount → words, in Russian and Turkmen.

Used to spell out a contract's total sum in the bilingual export contract
(e.g. ``7830`` → RU ``семь тысяч восемьсот тридцать`` / TK
``ýedi müň sekiz ýüz otuz``). No third-party dependency (``num2words`` is not
installed and would need a deploy) — the range is bounded (a truck contract is
well under a billion USD) and both languages are regular enough to hand-roll.

Only the whole-dollar part is spelled; callers format cents separately. Russian
applies gender/number agreement for the thousands group; Turkmen is
concatenative and drops the leading ``bir`` before ``ýüz``/``müň``.
"""
from __future__ import annotations

# ─── Russian ─────────────────────────────────────────────────────────────────

_RU_ONES_M = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь',
              'восемь', 'девять']
_RU_ONES_F = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь',
              'восемь', 'девять']
_RU_TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать',
             'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать']
_RU_TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят',
            'семьдесят', 'восемьдесят', 'девяносто']
_RU_HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот',
                'семьсот', 'восемьсот', 'девятьсот']


def _ru_below_1000(n: int, feminine: bool = False) -> list[str]:
    """Spell 1..999 as a list of Russian words (empty for 0)."""
    words: list[str] = []
    if n >= 100:
        words.append(_RU_HUNDREDS[n // 100])
        n %= 100
    if n >= 20:
        words.append(_RU_TENS[n // 10])
        n %= 10
    if n >= 10:
        words.append(_RU_TEENS[n - 10])
        n = 0
    if n > 0:
        words.append((_RU_ONES_F if feminine else _RU_ONES_M)[n])
    return words


def _ru_plural(n: int, forms: tuple[str, str, str]) -> str:
    """Pick the Russian plural form: (1, 2-4, 5+) with the 11-14 exception."""
    n = abs(n) % 100
    if 11 <= n <= 14:
        return forms[2]
    last = n % 10
    if last == 1:
        return forms[0]
    if 2 <= last <= 4:
        return forms[1]
    return forms[2]


def amount_words_ru(amount: int) -> str:
    """Spell a non-negative integer in Russian (e.g. ``7830`` → ``семь тысяч …``)."""
    if amount < 0:
        raise ValueError('amount must be non-negative')
    if amount == 0:
        return 'ноль'

    words: list[str] = []
    millions, rest = divmod(amount, 1_000_000)
    thousands, units = divmod(rest, 1000)

    if millions:
        words += _ru_below_1000(millions)
        words.append(_ru_plural(millions, ('миллион', 'миллиона', 'миллионов')))
    if thousands:
        words += _ru_below_1000(thousands, feminine=True)
        words.append(_ru_plural(thousands, ('тысяча', 'тысячи', 'тысяч')))
    if units:
        words += _ru_below_1000(units)

    return ' '.join(words)


# ─── Turkmen ─────────────────────────────────────────────────────────────────

_TK_ONES = ['', 'bir', 'iki', 'üç', 'dört', 'bäş', 'alty', 'ýedi', 'sekiz', 'dokuz']
_TK_TENS = ['', 'on', 'ýigrimi', 'otuz', 'kyrk', 'elli', 'altmyş', 'ýetmiş',
            'segsen', 'togsan']


def _tk_below_1000(n: int) -> list[str]:
    """Spell 1..999 in Turkmen. Drops the leading ``bir`` before ``ýüz`` (100 → ``ýüz``)."""
    words: list[str] = []
    if n >= 100:
        hundreds = n // 100
        if hundreds > 1:
            words.append(_TK_ONES[hundreds])
        words.append('ýüz')
        n %= 100
    if n >= 10:
        words.append(_TK_TENS[n // 10])
        n %= 10
    if n > 0:
        words.append(_TK_ONES[n])
    return words


def amount_words_tk(amount: int) -> str:
    """Spell a non-negative integer in Turkmen (e.g. ``7830`` → ``ýedi müň sekiz …``).

    ``müň``/``ýüz`` shed a leading ``bir`` (``1000`` → ``müň``, not ``bir müň``);
    ``million`` keeps it (``1_000_000`` → ``bir million``).
    """
    if amount < 0:
        raise ValueError('amount must be non-negative')
    if amount == 0:
        return 'nol'

    words: list[str] = []
    millions, rest = divmod(amount, 1_000_000)
    thousands, units = divmod(rest, 1000)

    if millions:
        words += _tk_below_1000(millions)
        words.append('million')
    if thousands:
        if thousands > 1:
            words += _tk_below_1000(thousands)
        words.append('müň')
    if units:
        words += _tk_below_1000(units)

    return ' '.join(words)
