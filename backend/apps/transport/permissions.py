from rest_framework.permissions import BasePermission

from apps.core.permissions import get_page_permissions, resource_write_permission
from apps.core.roles import PRIVILEGED_ROLES

# Same editor set as export.views ShipmentDetail's variety-override (~line 2987):
# PRIVILEGED_ROLES (admin/export_manager/director) plus warehouse_chief, the
# loading-department head/deputy pair, and boss.
#
# `boss` holds ['*'] in the permission matrix, but this gate is a hardcoded set
# the matrix never consults — the same layer that had to be widened for the
# weekly plan (apps/core/roles.py ADMIN_LIKE) and for POST /shipments/{id}/join/.
# Added here 2026-08-20 so the boss can reach the Fleet Admin page at all.
# Scope: this set gates ONLY ShipmentDeviceLinkView — the GPS device-link
# override. TruckHead/Trailer/Driver CRUD moved to CanEditFleet (the
# `transport.fleet` page permission) on 2026-09-03; the device-link override is
# a shipment edit, not a fleet edit, so it keeps the shipment editor set.
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


class CanEditFleet(resource_write_permission('fleet')):
    """Writes to the fleet catalog (truck heads, trailers, drivers).

    Gated on the `fleet` **resource** in the permission matrix — `can_create` for
    POST, `can_edit` for PUT/PATCH. Reads stay open to any authenticated user:
    the truck / trailer / driver selectors on the Sheet and the shipment drawer
    list the same catalog. No `can_delete` path exists to gate — none of the
    three ViewSets expose `destroy`.

    Replaces the hardcoded `SHIPMENT_EDITOR_ROLES` gate (2026-09-03) so an admin
    can grant or revoke fleet editing from the Resources tab of the permission
    screen instead of needing a deploy. Seeded defaults reproduce that role set
    exactly. Fail-closed: a role with no `fleet` row gets no writes.

    Page vs resource: `transport.fleet` (page) decides who SEES the Fleet
    Management screen; this resource decides who may WRITE — the same split
    every other admin screen in the matrix uses.
    """


class CanViewFleetMap(BasePermission):
    """Read gate for the Fleet Map's live positions.

    Gated on the ``transport.map`` page permission — the same row the nav item
    and the route guard read, so hiding the page in the matrix also closes the
    endpoint behind it.

    Was a hardcoded deny-list (``FLEET_MAP_DENIED_ROLES = {'seller'}``) until
    2026-09-03. The seller exclusion survives as a seeded matrix row
    (seed_permissions grants ``transport.map`` to every role but the seller);
    it is now an admin-flippable data row rather than a constant.

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
        role = getattr(user, 'role', None)
        if not role:
            return False
        return get_page_permissions(role).get('transport.map', False)
