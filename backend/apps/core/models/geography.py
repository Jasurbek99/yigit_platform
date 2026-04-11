from django.db import models
from apps.core.db_utils import cyrillic_collation, schema_table


class Country(models.Model):
    """Destination countries for shipments."""

    name_tk = models.CharField(max_length=100, **cyrillic_collation())
    name_ru = models.CharField(max_length=100, blank=True, null=True, **cyrillic_collation())
    name_en = models.CharField(max_length=100, blank=True, null=True)
    code = models.CharField(max_length=5, unique=True, blank=True, null=True)

    class Meta:
        db_table = schema_table('core', 'countries')
        ordering = ['name_en']
        verbose_name_plural = 'Countries'

    def __str__(self) -> str:
        return self.name_en or self.name_tk


class City(models.Model):
    """Cities within countries."""

    country = models.ForeignKey(Country, on_delete=models.PROTECT, related_name='cities')
    name = models.CharField(max_length=100, **cyrillic_collation())
    name_local = models.CharField(max_length=100, blank=True, null=True, **cyrillic_collation())

    class Meta:
        db_table = schema_table('core', 'cities')
        unique_together = [('country', 'name')]
        verbose_name_plural = 'Cities'

    def __str__(self) -> str:
        return f'{self.name} ({self.country})'


class BorderPoint(models.Model):
    """Border crossing points used in shipment routing."""

    name = models.CharField(max_length=100, unique=True, **cyrillic_collation())
    route_description = models.CharField(max_length=500, blank=True, null=True, **cyrillic_collation())
    typical_transit_days = models.IntegerField(blank=True, null=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = schema_table('core', 'border_points')
        ordering = ['name']

    def __str__(self) -> str:
        return self.name
