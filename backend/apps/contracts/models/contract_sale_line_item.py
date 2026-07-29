"""ContractSaleLineItem — one product line on a firm's invoice.

A ContractSale's invoice usually prints ONE line (fresh tomatoes) synthesized
from the sale's own fields. When explicit line items exist, the invoice lists
them instead — different varieties / grades / products at their own price. The
lines **break down** the sale: ``sum(quantity_kg) == sale.quantity_kg`` and
``sum(total_usd) == sale.total_usd`` (enforced in the serializer), so the quota
and contract rollups — which read the sale's own totals — stay correct.
"""
from decimal import Decimal

from django.db import models

from apps.core.db_utils import cyrillic_collation, schema_table


class ContractSaleLineItem(models.Model):
    """One invoice line: name × quantity × price → amount, under a ContractSale."""

    sale = models.ForeignKey(
        'contracts.ContractSale',
        on_delete=models.CASCADE,
        related_name='line_items',
    )
    line_number = models.PositiveSmallIntegerField()

    # Blank → the invoice falls back to the localized default ('Помидор свежий' /
    # 'Fresh tomatoes'); hs_code blank → the module TOMATO_HS_CODE.
    product_name = models.CharField(
        max_length=200, blank=True, default='', **cyrillic_collation(),
    )
    hs_code = models.CharField(max_length=20, blank=True, default='')

    quantity_kg = models.DecimalField(max_digits=10, decimal_places=2)   # this line's NET
    gross_kg = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    box_count = models.IntegerField(null=True, blank=True)
    price_per_kg = models.DecimalField(max_digits=8, decimal_places=4)
    total_usd = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    class Meta:
        db_table = schema_table('contracts', 'contract_sale_line_item')
        ordering = ['sale_id', 'line_number']
        constraints = [
            models.UniqueConstraint(
                fields=['sale', 'line_number'], name='uq_sale_line_number',
            ),
        ]

    def save(self, *args, **kwargs) -> None:
        """Auto-compute ``total_usd = quantity_kg × price_per_kg`` when unset."""
        if (
            (self.total_usd is None or self.total_usd == Decimal('0'))
            and self.quantity_kg is not None
            and self.price_per_kg is not None
        ):
            self.total_usd = self.quantity_kg * self.price_per_kg
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f'{self.sale_id} #{self.line_number} {self.product_name or "tomato"}'
