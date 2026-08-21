from rest_framework.permissions import BasePermission

from apps.core.roles import PRIVILEGED_ROLES

# Same editor set as export.views ShipmentDetail's variety-override (~line 2987):
# PRIVILEGED_ROLES (admin/export_manager/director) plus warehouse_chief, the
# loading-department head/deputy pair, and boss.
#
# `boss` holds ['*'] in the permission matrix, but this gate is a hardcoded set
# the matrix never consults — the same layer that had to be widened for the
# weekly plan (apps/core/roles.py ADMIN_LIKE) and for POST /shipments/{id}/join/.
# Added here 2026-08-20 so the boss can reach the Fleet Admin page at all.
# Scope: this set gates ONLY apps/transport/views.py — the GPS device-link
# override plus TruckHead/Trailer/Driver CRUD. Nothing else imports it.
SHIPMENT_EDITOR_ROLES = PRIVILEGED_ROLES | {
    'warehouse_chief', 'loading_dept_head', 'loading_dept_head_deputy', 'boss',
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
