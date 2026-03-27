from django.db import models
from apps.core.db_utils import cyrillic_collation, schema_table


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
    route_description = models.CharField(max_length=500, blank=True, null=True)
    typical_transit_days = models.IntegerField(blank=True, null=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = schema_table('core', 'border_points')
        ordering = ['name']

    def __str__(self) -> str:
        return self.name


class LoadingLocation(models.Model):
    """Greenhouse loading points (Dusak, Kaka, Owadandepe)."""

    name = models.CharField(max_length=100, unique=True)

    class Meta:
        db_table = schema_table('core', 'loading_locations')
        ordering = ['name']

    def __str__(self) -> str:
        return self.name


class TomatoVariety(models.Model):
    """Tomato cultivar reference."""

    name = models.CharField(max_length=50, unique=True)
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


class GreenhouseBlock(models.Model):
    """Greenhouse blocks A–O. manager FK replaces deprecated managed_blocks on User."""

    code = models.CharField(max_length=10, unique=True)
    name = models.CharField(max_length=100, blank=True, null=True, **cyrillic_collation())
    manager = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='managed_blocks_set',
    )
    variety_main = models.CharField(max_length=50, blank=True, null=True)
    variety_secondary = models.CharField(max_length=50, blank=True, null=True)
    area_m2 = models.IntegerField(blank=True, null=True)
    location = models.CharField(max_length=50, blank=True, null=True)
    section_count = models.IntegerField(blank=True, null=True)
    sowing_date = models.DateField(blank=True, null=True)
    season_start_month = models.IntegerField(blank=True, null=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = schema_table('core', 'greenhouse_blocks')
        ordering = ['code']

    def __str__(self) -> str:
        return f'{self.code} — {self.name or ""}'


class ExportFirm(models.Model):
    """YGT export companies (legal entities for customs documents)."""

    code = models.CharField(max_length=20, unique=True)
    name_tk = models.CharField(max_length=200, **cyrillic_collation())
    name_ru = models.CharField(max_length=200, blank=True, null=True, **cyrillic_collation())
    name_en = models.CharField(max_length=200, blank=True, null=True)
    address_tk = models.CharField(max_length=500, blank=True, null=True, **cyrillic_collation())
    address_ru = models.CharField(max_length=500, blank=True, null=True, **cyrillic_collation())
    address_en = models.CharField(max_length=500, blank=True, null=True)
    bank_details_tk = models.CharField(max_length=1000, blank=True, null=True, **cyrillic_collation())
    bank_details_ru = models.CharField(max_length=1000, blank=True, null=True, **cyrillic_collation())
    bank_details_en = models.CharField(max_length=1000, blank=True, null=True)
    director = models.CharField(max_length=200, blank=True, null=True, **cyrillic_collation())
    tax_code = models.CharField(max_length=50, blank=True, null=True)
    swift_code = models.CharField(max_length=20, blank=True, null=True)
    one_c_code = models.CharField(max_length=50, blank=True, null=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = schema_table('core', 'export_firms')
        ordering = ['code']

    def __str__(self) -> str:
        return f'{self.code} — {self.name_en or self.name_tk}'


class ImportFirm(models.Model):
    """Buyer / importer companies."""

    code = models.CharField(max_length=20, unique=True, blank=True, null=True)
    name_tk = models.CharField(max_length=200, **cyrillic_collation())
    name_ru = models.CharField(max_length=200, blank=True, null=True, **cyrillic_collation())
    name_en = models.CharField(max_length=200, blank=True, null=True)
    country = models.ForeignKey(Country, on_delete=models.PROTECT, null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = schema_table('core', 'import_firms')
        ordering = ['name_en']

    def __str__(self) -> str:
        return self.name_en or self.name_tk


class ShipmentStatusType(models.Model):
    """13-step shipment lifecycle status definitions.

    Python TRANSITIONS dict (in export app) handles multi-role logic.
    required_role here is DB reference only.
    """

    code = models.CharField(max_length=30, unique=True)
    name_tk = models.CharField(max_length=100, **cyrillic_collation())
    name_en = models.CharField(max_length=100, blank=True, null=True)
    name_ru = models.CharField(max_length=100, blank=True, null=True, **cyrillic_collation())
    step_order = models.IntegerField()
    required_role = models.CharField(max_length=30, blank=True, null=True)
    phase = models.CharField(max_length=20, blank=True, null=True)

    class Meta:
        db_table = schema_table('core', 'shipment_status_types')
        ordering = ['step_order']

    def __str__(self) -> str:
        return f'{self.step_order}. {self.name_en or self.name_tk} ({self.code})'


class Customer(models.Model):
    """Individual buyer/customer (person, not company)."""

    name = models.CharField(max_length=100, unique=True, **cyrillic_collation())
    phone = models.CharField(max_length=50, blank=True, null=True)
    default_country = models.ForeignKey(
        'core.Country',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='+',
    )
    default_city = models.ForeignKey(
        'core.City',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='+',
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = schema_table('core', 'customers')
        ordering = ['name']

    def __str__(self) -> str:
        return self.name
