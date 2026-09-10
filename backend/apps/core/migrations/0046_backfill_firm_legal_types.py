"""Split the legal form out of the stored firm names.

Reads each firm's name columns, works out which legal form is written into
them, points ``legal_type`` at the matching row and writes the remainder into
``name_bare*``. The original ``name_*`` columns are left exactly as they are —
they stay the fallback for firms this cannot type, and documents keep reading
them until the render path changes.

Deliberately strict: a firm is typed only when EVERY non-empty name column
parses and they all agree. Several export firms name one form in Turkmen and
another in Russian, or carry none at all; those are left null for staff to
resolve on the firms screen rather than guessed at, since a wrong guess prints
a wrong legal entity onto a customs document.
"""
import re

from django.db import migrations

# Latin letters that are visually identical to a Cyrillic one. Buyer names in
# production mix the two inside a single word ("OОО" leads with a Latin O), so
# Cyrillic patterns are matched against a normalised copy. The mapping is
# one char to one char, which keeps match offsets valid against the original.
HOMOGLYPHS = str.maketrans({
    'A': 'А', 'B': 'В', 'C': 'С', 'E': 'Е', 'H': 'Н', 'K': 'К', 'M': 'М',
    'O': 'О', 'P': 'Р', 'T': 'Т', 'X': 'Х', 'Y': 'У',
    'a': 'а', 'c': 'с', 'e': 'е', 'o': 'о', 'p': 'р', 'x': 'х', 'y': 'у',
})

QUOTES = ''.join(['"', "'", '«', '»', '“', '”', '„', '‟', '‘', '’', '‚', '‛', '`'])

# Quote characters that must stay balanced. Several names nest a second pair
# inside the outer one ("ООО «Производственная компания «Салатория»"); stripping
# the ends there would leave a dangling opener, so those are left alone.
BALANCED_PAIRS = (('«', '»'), ('“', '”'))

# (legal type code, where the form sits, pattern, match against normalised text)
# Order matters: the longest / most specific form of each family comes first,
# so "ОсОО" is not consumed by the "ООО" rule and "Hususy Telekeçi" is not
# consumed by the bare "Telekeçi" one.
PATTERNS = [
    # --- Turkmen, matched against the original text ---
    ('HT', 'prefix', r'^\s*Hususy\s+Teleke[çc]i\s+', False),
    ('HT', 'prefix', r'^\s*Teleke[çc]i\s+', False),
    ('HK', 'suffix', r'\s+H\.?\s?K\.?\s*$', False),
    ('HJ', 'suffix', r'\s+H\.?\s?J\.?\s*$', False),
    ('TOO', 'suffix', r'\s*J[ÇC]B\s*$', False),
    ('OOO', 'suffix', r'\s*J[ÇC]J\s*$', False),
    # --- Latin, matched against the original text ---
    ('HT', 'prefix', r'^\s*Individual\s+(?:entrepreneur|enterprise)\s+', False),
    ('HJ', 'prefix', r'^\s*Economic\s+society\s+', False),
    ('LLC', 'prefix', r'^\s*LLC\s+', False),
    ('LLC', 'suffix', r'\s+LLC\s*$', False),
    ('LTD', 'suffix', r'\s+LTD\s*$', False),
    # --- Cyrillic, matched against the homoglyph-normalised copy ---
    ('HT', 'prefix', r'^\s*Индивидуальн\w*\s+предпри\w+\s+', True),
    ('HT', 'prefix', r'^\s*И\.?\s?П\.?\s+', True),
    ('HJ', 'prefix', r'^\s*Хозяйственн\w*\s+обществ\w*\s+', True),
    ('HJ', 'prefix', r'^\s*Х\.?\s?О\.?\s*', True),
    ('HJ', 'suffix', r'\s+Х\.?\s?Дж\.?\s*$', True),
    ('HK', 'prefix', r'^\s*Ч\.?\s?П\.?\s+', True),
    ('FH', 'prefix', r'^\s*Фермерск\w*\s+хозяйств\w*\s*', True),
    ('FH', 'prefix', r'^\s*Ф\.?\s?Х\.?\s+', True),
    ('OSOO', 'prefix', r'^\s*ОсОО\s*', True),
    ('MCHJ', 'prefix', r'^\s*МЧЖ\s*', True),
    ('TOV', 'prefix', r'^\s*ТОВ\s*', True),
    ('TOO', 'prefix', r'^\s*ТОО\s*', True),
    ('OOO', 'prefix', r'^\s*ООО\s*', True),
]

COMPILED = [
    (code, where, re.compile(pattern, re.IGNORECASE), normalised)
    for code, where, pattern, normalised in PATTERNS
]


def _tidy(value: str) -> str:
    """Trim whitespace, surrounding quotes and a trailing full stop.

    Quotes come off because they are decoration, not part of the name, and they
    appear in five different styles across the live rows. The render path adds
    the pair the target language wants.
    """
    text = (value or '').strip()
    previous = None
    while text and text != previous:
        previous = text
        candidate = text.strip().strip(QUOTES).strip()
        if candidate != text and all(
            candidate.count(opener) == candidate.count(closer)
            for opener, closer in BALANCED_PAIRS
        ):
            text = candidate
        if text.endswith('.'):
            # Strip a stray full stop, but never the one closing a set of
            # initials — "Довранов Э.А." and "ТУРСЫНБАЕВ О.Б." keep theirs,
            # while "Эко Агро Продукт." loses its.
            last = text.rsplit(None, 1)[-1]
            if last.count('.') == 1 and len(last.rstrip('.')) > 2:
                text = text[:-1]
    return text


def parse_name(name):
    """Return ``(legal type code, bare name)`` for one stored name string.

    ``(None, tidied name)`` when no known form is present — the caller treats
    that as unresolved rather than as "this firm has no legal form".
    """
    # Tidy first: some names wrap the whole thing in quotes, form included
    # ("ALFA FRESH TRADING LLC"), which would otherwise hide the suffix.
    original = _tidy(name)
    if not original:
        return None, ''
    normalised = original.translate(HOMOGLYPHS)

    for code, where, pattern, use_normalised in COMPILED:
        match = pattern.search(normalised if use_normalised else original)
        if not match:
            continue
        if where == 'prefix':
            bare = original[match.end():]
        else:
            bare = original[:match.start()]
        bare = _tidy(bare)
        if not bare:
            # A name that is *only* a legal form is degenerate data; keep the
            # original rather than emptying the row.
            return code, _tidy(original)
        return code, bare

    return None, _tidy(original)


def resolve_firm(names):
    """Reconcile the parses of one firm's name columns.

    ``names`` is a list of ``(column, value)``. Returns ``(code or None,
    {column: bare})``. The code is set only when every non-empty column parsed
    and they all named the same form.
    """
    values = dict(names)
    parsed = {column: parse_name(value) for column, value in names}
    codes = {
        parsed[column][0]
        for column, value in names
        if (value or '').strip()
    }
    agreed = codes.pop() if len(codes) == 1 else None
    if agreed is None:
        # Unresolved: keep the stored names verbatim as the bare values, so the
        # render fallback is a no-op for these rows.
        return None, {column: (values[column] or '') for column in values}
    return agreed, {column: parsed[column][1] for column in values}


def backfill(apps, schema_editor):
    CompanyLegalType = apps.get_model('core', 'CompanyLegalType')
    ExportFirm = apps.get_model('core', 'ExportFirm')
    ImportFirm = apps.get_model('core', 'ImportFirm')

    types = {t.code: t for t in CompanyLegalType.objects.all()}
    if not types:
        return

    # A Turkmen sole trader is HT; the same person in a foreign register is IP.
    # Both parse to 'HT' because the written forms are shared, so map the buyer
    # side across — otherwise a Kazakh sole trader becomes a Turkmen one.
    buyer_alias = {'HT': 'IP', 'HK': 'IP'}

    export_updates = []
    for firm in ExportFirm.objects.all():
        code, bare = resolve_firm([
            ('name_tk', firm.name_tk),
            ('name_ru', firm.name_ru),
            ('name_en', firm.name_en),
        ])
        firm.legal_type = types.get(code) if code else None
        firm.name_bare_tk = bare['name_tk'] or None
        firm.name_bare_ru = bare['name_ru'] or None
        firm.name_bare_en = bare['name_en'] or None
        export_updates.append(firm)

    if export_updates:
        ExportFirm.objects.bulk_update(
            export_updates,
            ['legal_type', 'name_bare_tk', 'name_bare_ru', 'name_bare_en'],
            batch_size=500,
        )

    import_updates = []
    for firm in ImportFirm.objects.all():
        code, bare = parse_name(firm.name_company)
        code = buyer_alias.get(code, code)
        firm.legal_type = types.get(code) if code else None
        firm.name_bare = bare or None
        import_updates.append(firm)

    if import_updates:
        ImportFirm.objects.bulk_update(
            import_updates, ['legal_type', 'name_bare'], batch_size=500,
        )

    typed_exports = sum(1 for f in export_updates if f.legal_type_id)
    typed_imports = sum(1 for f in import_updates if f.legal_type_id)
    print(
        '  legal types: export firms {}/{} typed, import firms {}/{} typed; '
        'the rest need a form picked by hand on the firms screen.'.format(
            typed_exports, len(export_updates), typed_imports, len(import_updates),
        )
    )


def unbackfill(apps, schema_editor):
    for model_name, fields in (
        ('ExportFirm', ['legal_type', 'name_bare_tk', 'name_bare_ru', 'name_bare_en']),
        ('ImportFirm', ['legal_type', 'name_bare']),
    ):
        model = apps.get_model('core', model_name)
        model.objects.update(**{field: None for field in fields})


class Migration(migrations.Migration):

    dependencies = [('core', '0045_seed_company_legal_types')]

    operations = [migrations.RunPython(backfill, unbackfill)]
