from rest_framework.permissions import BasePermission

from apps.core.roles import PRIVILEGED_ROLES

# Same editor set as export.views ShipmentDetail's variety-override (~line 2987):
# PRIVILEGED_ROLES (admin/export_manager/director) plus warehouse_chief and the
# loading-department head/deputy pair.
SHIPMENT_EDITOR_ROLES = PRIVILEGED_ROLES | {
    'warehouse_chief', 'loading_dept_head', 'loading_dept_head_deputy',
}


class CanEditShipment(BasePermission):
    """Same editor set as ShipmentDetail's variety-override."""

    def has_permission(self, request, view) -> bool:
        user = request.user
        if not (user and user.is_authenticated):
            return False
        return bool(
            user.is_superuser or getattr(user, 'role', None) in SHIPMENT_EDITOR_ROLES
        )
