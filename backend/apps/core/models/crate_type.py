from django.db import models

from apps.core.db_utils import schema_table


class CrateType(models.Model):
    """Reference table for crate types used in pallet manifests.

    Each crate type has a fixed empty weight in kg used to compute pallet net weight:
        pallet.net_weight = gross - (crate_type.weight_kg * crate_count) - pallet_weight - additions

    Real data verified from 10AP116_CEKIM_GAPAN.xlsx:
        LEBIZ PLAST 18 = 0.543 kg (confirmed)
        AGAÇ and PLASMAS weights are placeholders pending Soltanmyrat confirmation
        (marked is_active=False until confirmed).
    """

    name = models.CharField(max_length=30, unique=True)
    weight_kg = models.DecimalField(max_digits=6, decimal_places=3)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = schema_table('core', 'crate_types')
        ordering = ['name']

    def __str__(self) -> str:
        return f'{self.name} ({self.weight_kg} kg)'
