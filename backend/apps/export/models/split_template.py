"""SplitTemplate — a reusable division of a truck into per-firm weight shares.

The Excel "gross net" section labels (`10000/8000`, `14000/3000`, `11300/6700`,
`4100/9700/4200`, …) were split templates. Picking one on a truck sets each firm's
official weight (`ShipmentFirmSplit.weight_kg`); the per-firm packing is then
derived from the whole-truck `PackingPreset` by those weights.

Weights are stored comma-separated in a CharField (NOT JSON/Array — MSSQL rules),
in firm order, e.g. ``"10000,8000"``.
"""
from decimal import Decimal

from django.db import models

from apps.core.db_utils import cyrillic_collation, schema_table


class SplitTemplate(models.Model):
    """A named list of per-firm weights that sum to a truck total."""

    name = models.CharField(max_length=120, **cyrillic_collation())
    # Comma-separated official kg per firm, in order — e.g. "10000,8000".
    weights = models.CharField(max_length=200)
    is_active = models.BooleanField(default=True)
    sort_order = models.IntegerField(default=0)

    class Meta:
        db_table = schema_table('export', 'split_template')
        ordering = ['sort_order', 'name']

    def __str__(self) -> str:
        return self.name

    def weight_list(self) -> list[Decimal]:
        """Parse ``weights`` into a list of Decimals (skips blanks)."""
        out = []
        for part in self.weights.split(','):
            part = part.strip()
            if part:
                out.append(Decimal(part))
        return out

    @property
    def part_count(self) -> int:
        return len(self.weight_list())

    @property
    def total_kg(self) -> Decimal:
        return sum(self.weight_list(), Decimal('0'))
