from django.db import models

from apps.core.db_utils import cyrillic_collation, schema_table


class CompanyLegalType(models.Model):
    """Legal-entity form of a firm — HJ, HT, OOO, TOO, and so on.

    Until this table existed the form lived inside the firm's name string
    ("Ak Bulut" HJ / Х.О"Ак Булут") *and* was hardcoded a second time in
    contract_kz.docx, so every seller printed as an HJ and every buyer's form
    printed twice. Firms now point here and documents compose the form from
    the row instead of from a name or a template literal.

    Three renderings are stored per language because documents need different
    ones: ``abbr_*`` for CMR boxes and signature blocks, ``full_*`` for a
    contract preamble, ``gen_*`` for the preamble's genitive
    ("Хозяйственного общества", "hojalyk jemgyýetiniň"). The genitive is a
    stored literal, not a derivation — Turkmen vowel harmony and Russian
    declension are not worth a grammar engine for the eight positions that
    need it.

    Position is per language rather than one flag inverted for Russian: HJ is
    a Turkmen suffix ("Ak Bulut" HJ) while HT is a Turkmen prefix (Hususy
    Telekeçi Hemidow Ç. A.), so one flag would render "Хемидов ИП".
    """

    PREFIX = 'PREFIX'
    SUFFIX = 'SUFFIX'
    POSITION_CHOICES = [(PREFIX, 'Before the name'), (SUFFIX, 'After the name')]

    code = models.CharField(max_length=16, unique=True)

    # === Abbreviated form — CMR boxes, invoice headers, signature blocks ===
    abbr_tk = models.CharField(max_length=32, **cyrillic_collation())
    abbr_ru = models.CharField(max_length=32, **cyrillic_collation())
    abbr_en = models.CharField(max_length=32, blank=True, null=True)

    # === Spelled-out form — contract preamble, customs ARZA ===
    full_tk = models.CharField(max_length=200, **cyrillic_collation())
    full_ru = models.CharField(max_length=200, **cyrillic_collation())
    full_en = models.CharField(max_length=200, blank=True, null=True)

    # === Genitive form — contract preamble only, filled by hand ===
    gen_tk = models.CharField(max_length=200, blank=True, null=True, **cyrillic_collation())
    gen_ru = models.CharField(max_length=200, blank=True, null=True, **cyrillic_collation())

    # === Where the form sits relative to the name, per language ===
    position_tk = models.CharField(max_length=6, choices=POSITION_CHOICES, default=SUFFIX)
    position_ru = models.CharField(max_length=6, choices=POSITION_CHOICES, default=PREFIX)
    position_en = models.CharField(max_length=6, choices=POSITION_CHOICES, default=SUFFIX)

    # Which countries this form is valid in. M2M, not a single FK: ООО is used
    # by buyers in RU, UZ, KG, AZ and BY. No ArrayField — MSSQL has none.
    countries = models.ManyToManyField(
        'core.Country',
        blank=True,
        related_name='legal_types',
        db_table=schema_table('core', 'company_legal_type_countries'),
    )
    sort_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = schema_table('core', 'company_legal_types')
        ordering = ['sort_order', 'code']

    def __str__(self) -> str:
        return f'{self.code} — {self.full_en or self.full_tk}'
