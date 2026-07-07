"""PackingTemplate — the digital "gross net" row: whole truck + firm shares.

One template = one Excel `gross net` row. The parent holds the WHOLE-TRUCK packing
(→ CMR); each `PackingTemplateShare` is one firm's share (→ that firm's Invoice),
with its own net/gross/boxes/pallets — all explicit, nothing derived.

Applying a template to a truck copies each share onto the matching firm's
`ContractSale` packing fields (editable per truck) and sets each firm's weight
(= the share's net) via `set_firm_splits` (quota-safe). NET per firm is the share
net; the whole-truck line feeds the CMR.
"""
from django.db import models

from apps.core.db_utils import cyrillic_collation, schema_table

PRODUCT_TYPE_CHOICES = [
    ('tomato', 'Tomato'),
    ('pepper', 'Pepper'),
]


class PackingTemplate(models.Model):
    """Whole-truck packing (→ CMR) + a set of firm shares (→ Invoices)."""

    name = models.CharField(max_length=120, **cyrillic_collation())
    product_type = models.CharField(
        max_length=10, choices=PRODUCT_TYPE_CHOICES, default='tomato',
    )
    # === Whole truck (→ CMR); BRUT = gross WITH pallets ===
    net_kg = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    gross_kg = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    box_count = models.IntegerField(null=True, blank=True)
    pallet_count = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    pallet_weight_kg = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)

    is_active = models.BooleanField(default=True)
    sort_order = models.IntegerField(default=0)

    class Meta:
        db_table = schema_table('export', 'packing_template')
        ordering = ['sort_order', 'name']

    def __str__(self) -> str:
        return self.name

    @property
    def share_count(self) -> int:
        return self.shares.count()


class PackingTemplateShare(models.Model):
    """One firm's share within a PackingTemplate (→ that firm's Invoice)."""

    template = models.ForeignKey(
        PackingTemplate, on_delete=models.CASCADE, related_name='shares',
    )
    share_order = models.IntegerField(default=0)
    net_kg = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    gross_kg = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    box_count = models.IntegerField(null=True, blank=True)
    pallet_count = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    pallet_weight_kg = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)

    class Meta:
        db_table = schema_table('export', 'packing_template_share')
        ordering = ['share_order']

    def __str__(self) -> str:
        return f'{self.template_id}/{self.share_order}: {self.net_kg}'
