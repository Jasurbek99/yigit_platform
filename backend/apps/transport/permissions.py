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


# Roles denied the Fleet Map (live GPS) read. Deny-list, not allow-list, on
# purpose:
#   * The owner's request is literally "the seller must not have the map"
#     (2026-08-23). A deny-list encodes exactly that; an allow-list would be a
#     second copy of the 14-role array in AppLayout.tsx that silently drifts
#     apart the next time a role is added.
#   * A role added to ROLE_CHOICES later must not lose the map by omission.
# There is no `transport.map` page_code (see docs/obsidian/processes/fleet-map.md
# "Out of Scope") — registering one would put a brand-new code in the matrix with
# zero rows in the live DB, which hides the map from every role until a data
# migration lands. Deliberately not done for a one-role restriction.
FLEET_MAP_DENIED_ROLES = frozenset({'seller'})


class CanViewFleetMap(BasePermission):
    """Everyone authenticated except the roles in FLEET_MAP_DENIED_ROLES.

    Gates ONLY ``LivePositionViewSet`` — the single endpoint the Fleet Map page
    reads. The rest of the transport module stays open to all authenticated
    users; that is pre-existing finding F5 and is not widened or narrowed here.
    """

    def has_permission(self, request, view) -> bool:
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if user.is_superuser:
            return True
        return getattr(user, 'role', None) not in FLEET_MAP_DENIED_ROLES
