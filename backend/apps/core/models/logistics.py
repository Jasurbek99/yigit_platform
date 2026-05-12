from django.db import models
from apps.core.db_utils import cyrillic_collation, schema_table


class LoadingLocation(models.Model):
    """Greenhouse loading points (Dusak, Kaka, Owadandepe)."""

    name = models.CharField(max_length=100, unique=True)

    class Meta:
        db_table = schema_table('core', 'loading_locations')
        ordering = ['name']

    def __str__(self) -> str:
        return self.name


class TruckDestination(models.Model):
    """Admin-managed truck destination for weekly truck allocation.

    Real countries (Russia, Kazakhstan) link to Country via country FK.
    Non-country categories (Gapy Satys) have country=NULL.
    """

    name = models.CharField(max_length=100, **cyrillic_collation())
    country = models.ForeignKey(
        'core.Country',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='truck_destinations',
    )
    sort_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = schema_table('core', 'truck_destinations')
        ordering = ['sort_order', 'name']

    def __str__(self) -> str:
        return self.name


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
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = schema_table('core', 'shipment_status_types')
        ordering = ['step_order']

    def __str__(self) -> str:
        return f'{self.step_order}. {self.name_en or self.name_tk} ({self.code})'


class ShipmentOptionType(models.Model):
    """Configurable dropdown options for shipment sheet fields.

    Categories: documents_status, harvest_status,
    vehicle_condition, transport_responsible.
    """

    category = models.CharField(max_length=30, db_index=True)
    code = models.CharField(max_length=30)
    label_tk = models.CharField(max_length=100, **cyrillic_collation())
    label_en = models.CharField(max_length=100, blank=True, null=True)
    label_ru = models.CharField(max_length=100, blank=True, null=True, **cyrillic_collation())
    icon = models.CharField(max_length=10, blank=True, null=True)
    sort_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = schema_table('core', 'shipment_option_types')
        unique_together = [('category', 'code')]
        ordering = ['category', 'sort_order']

    def __str__(self) -> str:
        return f'{self.category}/{self.code}'
