"""Role-based field-level edit permissions for Shipment.

ROLE_EDITABLE_FIELDS maps each role to the list of Shipment fields they may
PATCH directly. '*' means unrestricted (export_manager / director).

Used by:
  - apps.core.serializers.UserMeSerializer (editable_fields in /auth/me/)
  - apps.export.serializers.ShipmentPatchSerializer (field validation)
"""

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
