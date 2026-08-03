from django.db import models

from apps.core.db_utils import cyrillic_collation, schema_table


class TruckHead(models.Model):
    """Company tractor — the shipment's selectable truck. Seeded once from the
    TIR system (Z_TIRWEB.truck_heads), platform-owned thereafter. Linked to a
    Traccar device (by plate) for GPS.

    NOTE: `id` is assigned explicitly on import (preserving the Z_TIRWEB id, so
    Shipment.truck_head_id lines up). See the import command for how new ids are
    allocated above the imported max.
    """

    plate_number = models.CharField(max_length=50, unique=True)
    owner_type = models.CharField(max_length=20, blank=True, default='')
    owner_name = models.CharField(max_length=200, blank=True, default='', **cyrillic_collation())
    status = models.CharField(max_length=20, blank=True, default='')
    capacity = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    traccar_device = models.ForeignKey(
        'transport.TraccarDevice', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='truck_heads',
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = schema_table('transport', 'truck_heads')
        ordering = ['plate_number']

    def __str__(self) -> str:
        return self.plate_number


class Trailer(models.Model):
    """Trailer — seeded once from Z_TIRWEB.trailers, platform-owned thereafter."""

    plate_number = models.CharField(max_length=50, unique=True)
    owner_type = models.CharField(max_length=20, blank=True, default='')
    status = models.CharField(max_length=20, blank=True, default='')
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = schema_table('transport', 'trailers')
        ordering = ['plate_number']

    def __str__(self) -> str:
        return self.plate_number
