"""Role-based field-level edit permissions for Shipment.

ROLE_EDITABLE_FIELDS maps each role to the list of Shipment fields they may
PATCH directly. '*' means unrestricted (export_manager / director).

Used by:
  - apps.core.serializers.UserMeSerializer (editable_fields in /auth/me/)
  - apps.export.serializers.ShipmentPatchSerializer (field validation)
"""
from rest_framework.permissions import BasePermission, SAFE_METHODS

ROLE_EDITABLE_FIELDS: dict[str, list[str]] = {
    'warehouse_chief':    ['box_count', 'pallet_count', 'weight_net', 'weight_gross'],
    'document_team':      ['box_count', 'pallet_count', 'weight_net', 'weight_gross', 'notes'],
    'transport':          ['vehicle_condition', 'vehicle_condition_note', 'route_note'],
    'sales_rep':          ['price_per_kg', 'total_amount_usd'],
    'finansist':          ['price_per_kg', 'total_amount_usd'],
    'accountant':         [],
    'greenhouse_manager': [],
    'export_manager':     ['*'],
    'director':           ['*'],
}

PRIVILEGED_ROLES: frozenset[str] = frozenset({'export_manager', 'director'})


def get_editable_fields(role: str | None) -> list[str]:
    """Return the list of Shipment fields editable by the given role."""
    return ROLE_EDITABLE_FIELDS.get(role or '', [])


def can_edit_field(role: str | None, field: str) -> bool:
    """Return True if the role may edit the given Shipment field."""
    allowed = get_editable_fields(role)
    return '*' in allowed or field in allowed


def write_permission(*roles: str) -> type:
    """Return a DRF permission class that allows reads to all but writes only to the given roles.

    Usage:
        permission_classes = [IsAuthenticated, write_permission('export_manager', 'director')]
    """
    _allowed = frozenset(roles)

    class _WriteRolePermission(BasePermission):
        def has_permission(self, request, view) -> bool:
            if not request.user or not request.user.is_authenticated:
                return False
            if request.method in SAFE_METHODS:
                return True
            return getattr(request.user, 'role', None) in _allowed

    return _WriteRolePermission
