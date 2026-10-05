"""LetterNumberBase — per-firm, per-letter-type, per-year floor for request-letter numbers.

CT-1 / Fito / ARZA letters are numbered per export firm, per letter type, within
a calendar year, restarting at 1 each January. An admin records the last number
each firm used outside the system; allocation starts above it. No row = floor 0.
See docs/superpowers/specs/2026-10-05-firm-letterhead-letter-numbers-design.md.
"""
from django.conf import settings
from django.db import models

from apps.core.db_utils import schema_table

LETTER_TYPES = ('ct1', 'fito', 'customs')


class LetterNumberBase(models.Model):
    LETTER_TYPE_CHOICES = [(t, t) for t in LETTER_TYPES]

    export_firm = models.ForeignKey(
        'core.ExportFirm', on_delete=models.PROTECT, related_name='letter_number_bases',
    )
    letter_type = models.CharField(max_length=10, choices=LETTER_TYPE_CHOICES)
    year = models.IntegerField()
    last_number = models.IntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name='+',
    )

    class Meta:
        db_table = schema_table('contracts', 'letter_number_base')
        constraints = [
            models.UniqueConstraint(
                fields=['export_firm', 'letter_type', 'year'], name='uq_letter_base_firm_type_year',
            ),
        ]

    def __str__(self) -> str:
        return f'{self.export_firm_id}/{self.letter_type}/{self.year}: {self.last_number}'
