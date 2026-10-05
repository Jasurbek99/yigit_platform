"""InvoiceNumberBase — the per-firm, per-year floor for invoice auto-numbering.

Invoice numbers run per export firm within a calendar year and restart at 1 each
January. The platform went live mid-year, after the firms had issued invoices from
Excel, so an admin records here the last number each firm used outside the system;
allocation starts above it. No row = floor 0.
See docs/superpowers/specs/2026-10-03-invoice-auto-numbering-design.md.
"""
from django.conf import settings
from django.db import models

from apps.core.db_utils import schema_table


class InvoiceNumberBase(models.Model):
    export_firm = models.ForeignKey(
        'core.ExportFirm',
        on_delete=models.PROTECT,
        related_name='invoice_number_bases',
    )
    year = models.IntegerField()
    last_number = models.IntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='+',
    )

    class Meta:
        db_table = schema_table('contracts', 'invoice_number_base')
        constraints = [
            models.UniqueConstraint(
                fields=['export_firm', 'year'], name='uq_invoice_base_firm_year',
            ),
        ]

    def __str__(self) -> str:
        return f'{self.export_firm_id}/{self.year}: {self.last_number}'
