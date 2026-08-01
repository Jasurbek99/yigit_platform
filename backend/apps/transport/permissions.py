from rest_framework.permissions import BasePermission

SHIPMENT_EDITOR_ROLES = {'warehouse_chief', 'export_manager', 'director'}


class CanEditShipment(BasePermission):
    """Same editor set as ShipmentDetail's variety-override."""

    def has_permission(self, request, view) -> bool:
        user = request.user
        if not (user and user.is_authenticated):
            return False
        return bool(user.is_superuser or getattr(user, 'role', None) in SHIPMENT_EDITOR_ROLES)
