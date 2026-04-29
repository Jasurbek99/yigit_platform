from django.db import models
from django.utils import timezone

from apps.core.db_utils import schema_table


class Pallet(models.Model):
    """Per-pallet manifest entry. Sent weight + variety + sub-block source of truth.

    Created during loading by weight_master (a subordinate of warehouse_chief,
    Artykow Maksat at Kaka). Aggregated values feed Shipment.weight_net,
    weight_gross, varieties_dominant via close_pallet_manifest() in services.py.

    Net weight formula (matches 10AP116 reference data):
        net_weight = gross - (crate_type.weight_kg * crate_count) - pallet_weight - additions
    """

    # === Shipment link ===
    shipment = models.ForeignKey(
        'Shipment',
        on_delete=models.CASCADE,
        related_name='pallets',
    )
    pallet_number = models.PositiveSmallIntegerField()

    # === Crate data ===
    crate_type = models.ForeignKey(
        'core.CrateType',
        on_delete=models.PROTECT,
    )
    crate_count = models.PositiveSmallIntegerField()

    # === Weight data ===
    gross_weight_kg = models.DecimalField(max_digits=8, decimal_places=2)
    pallet_weight_kg = models.DecimalField(max_digits=6, decimal_places=2)
    additions_kg = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    # additions_kg: ugalok / yup straps, typically ~4 kg per pallet

    # === Source data ===
    variety = models.ForeignKey(
        'core.TomatoVariety',
        on_delete=models.PROTECT,
    )
    sub_block = models.ForeignKey(
        'core.GreenhouseBlock',
        on_delete=models.PROTECT,
    )

    # === Audit ===
    loaded_at = models.DateTimeField(default=timezone.now)
    created_by = models.ForeignKey(
        'core.User',
        on_delete=models.PROTECT,
        related_name='+',
    )

    @property
    def crate_total_weight_kg(self):
        """Total weight of all crates on this pallet."""
        return self.crate_type.weight_kg * self.crate_count

    @property
    def net_weight_kg(self):
        """Computed net tomato weight for this pallet.

        net = gross - (crate_type.weight_kg * crate_count) - pallet_weight - additions
        This matches the formula verified from 10AP116 reference data:
        20,400 gross - 1,489.99 crates - 221 pallets - 132 additions = 18,557.01 net
        """
        return (
            self.gross_weight_kg
            - self.crate_total_weight_kg
            - self.pallet_weight_kg
            - self.additions_kg
        )

    class Meta:
        db_table = schema_table('export', 'pallets')
        unique_together = [('shipment', 'pallet_number')]
        ordering = ['shipment', 'pallet_number']

    def __str__(self) -> str:
        return f'{self.shipment.cargo_code}/P-{self.pallet_number}'
