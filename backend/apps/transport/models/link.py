from django.db import models

from apps.core.db_utils import schema_table


class ShipmentDeviceLink(models.Model):
    """Manual override pinning a shipment to a specific Traccar device.

    Only manual overrides are persisted; auto-matches are computed live by
    resolve_device_for_shipment(). Lives in transport (export must not depend
    on transport), referencing export.Shipment via a lazy FK string.
    """

    shipment = models.OneToOneField(
        'export.Shipment', on_delete=models.CASCADE, related_name='device_link',
    )
    device = models.ForeignKey(
        'transport.TraccarDevice', on_delete=models.PROTECT, related_name='shipment_links',
    )
    created_by = models.ForeignKey(
        'core.User', on_delete=models.SET_NULL, null=True, blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = schema_table('transport', 'shipment_device_links')

    def __str__(self) -> str:
        return f'shipment {self.shipment_id} -> device {self.device_id}'
