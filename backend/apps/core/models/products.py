from django.db import models
from apps.core.db_utils import schema_table


class Season(models.Model):
    """Export season (e.g. 2025-2026)."""

    name = models.CharField(max_length=10, unique=True)
    start_date = models.DateField()
    end_date = models.DateField()
    is_active = models.BooleanField(default=False)

    class Meta:
        db_table = schema_table('core', 'seasons')
        ordering = ['-start_date']

    def __str__(self) -> str:
        return self.name


class TomatoVariety(models.Model):
    """Tomato cultivar reference.

    Official variety codes (01-10) and experimental codes (E1-E3) are assigned
    by the signed 15.04.2026 departmental document. code=None means legacy
    row not yet mapped to the official registry.
    """

    name = models.CharField(max_length=50, unique=True)
    code = models.CharField(max_length=5, unique=True, null=True, blank=True)
    is_experimental = models.BooleanField(default=False)
    scientific_name = models.CharField(max_length=50, blank=True)
    type = models.CharField(max_length=30, blank=True, null=True)
    avg_fruit_weight_gr = models.DecimalField(max_digits=6, decimal_places=2, blank=True, null=True)

    class Meta:
        db_table = schema_table('core', 'tomato_varieties')
        verbose_name_plural = 'Tomato varieties'

    def __str__(self) -> str:
        return self.name


class ProductType(models.Model):
    """Product types (Pomidor, Bolgar burç, etc.)."""

    name = models.CharField(max_length=50, unique=True)

    class Meta:
        db_table = schema_table('core', 'product_types')

    def __str__(self) -> str:
        return self.name
