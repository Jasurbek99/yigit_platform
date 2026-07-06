"""PackingPreset — the digital "gross net" catalog.

The document team prepares export documents (Invoice, CMR) BEFORE a truck is
loaded, so the real weighbridge numbers don't exist yet. They pick a standard
packing configuration from the `gross net` sheet — matching product type, pallet
count and split share — and the documents fill from it.

This model is that catalog. One row = one packing config (five numbers). It is
picked in two places:
  * ``Shipment.packing_preset``     — the WHOLE-TRUCK config → feeds the CMR.
  * ``ContractSale.packing_preset`` — the FIRM-SHARE config → feeds the Invoice.

So a 2-firm ``9000/9000`` truck picks an "18 000 / 33 pallets" whole-truck config
on the shipment, and each firm's sale picks a "9 000 / 16.5 pallets" firm-share
config. An uneven ``14000/3000`` truck: firm A picks the 14 000 config, firm B the
3 000 config — which is why per-firm numbers can't be derived from the truck total.

NET is the OFFICIAL cap (see ``TruckSplitDefault``), not the real weight. BRUT is
gross WITH pallets (the CMR derives "without pallet" as ``gross_kg - pallet_weight_kg``).
"""
from django.db import models

from apps.core.db_utils import cyrillic_collation, schema_table


PRODUCT_TYPE_CHOICES = [
    ('tomato', 'Tomato'),
    ('pepper', 'Pepper'),
]


class PackingPreset(models.Model):
    """One selectable packing configuration in the gross-net catalog."""

    # === Identity / selection ===
    name = models.CharField(max_length=120, **cyrillic_collation())
    # product_type = tomato | pepper. "Bulgar" (bell pepper, Turkmen) rows on the
    # gross-net sheet are simply product_type='pepper'.
    product_type = models.CharField(
        max_length=10, choices=PRODUCT_TYPE_CHOICES, default='tomato',
    )

    # === Packing (one config; BRUT = gross WITH pallets) ===
    net_kg = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    gross_kg = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    box_count = models.IntegerField(null=True, blank=True)
    # Decimal: a 2-firm firm-share config is 16.5 pallets.
    pallet_count = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    pallet_weight_kg = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)

    # === Catalog housekeeping ===
    is_active = models.BooleanField(default=True)
    sort_order = models.IntegerField(default=0)

    class Meta:
        db_table = schema_table('export', 'packing_preset')
        ordering = ['sort_order', 'name']

    def __str__(self) -> str:
        return self.name
