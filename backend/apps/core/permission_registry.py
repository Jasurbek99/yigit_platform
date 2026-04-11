"""Registry of all pages, resources, and field sets for the dynamic permission system.

Source of truth for valid page_codes, resource_codes, and editable fields.
Used by:
- seed_permissions management command (initial data population)
- admin CRUD endpoints (validation)
- /auth/me/ serializer (building the permission response)
"""
from collections import OrderedDict

# ── Pages ────────────────────────────────────────────────────────────────
# Keys = page_code used in RolePagePermission
# Values = human-readable label for the admin UI

PAGE_REGISTRY: dict[str, str] = OrderedDict([
    # Main
    ('dashboard',               'Dashboard'),
    # Export
    ('export.shipments',        'Shipments'),
    ('export.kanban',           'Kanban Board'),
    ('export.overdue',          'Overdue Reports'),
    ('export.advances',         'Advances'),
    ('export.plan',             'Weekly Plan'),
    ('export.quota',            'Quota Dashboard'),
    ('export.quota.local_sell', 'Local Sell Plan (sub-tab)'),
    ('export.prices',           'Prices'),
    ('export.trucks',           'Truck Forecast'),
    ('export.blocks',           'Block Summary'),
    ('export.domestic_sales',   'Domestic Sales'),
    # Admin
    ('admin.users',             'Admin: Users'),
    ('admin.seasons',           'Admin: Seasons'),
    ('admin.firms',             'Admin: Export Firms'),
    ('admin.import_firms',      'Admin: Import Firms'),
    ('admin.permissions',       'Admin: Permissions'),
    ('admin.blocks',            'Admin: Blocks'),
    ('admin.truck_dest',        'Admin: Truck Destinations'),
])

# ── Resources ────────────────────────────────────────────────────────────
# Keys = resource_code used in RoleResourcePermission
# Values = human-readable label

RESOURCE_REGISTRY: dict[str, str] = OrderedDict([
    ('shipment',         'Shipment'),
    ('quota_issuance',   'Quota Issuance'),
    ('local_sell_plan',  'Local Sell Plan'),
    ('weekly_plan',      'Weekly Harvest Plan'),
    ('price_entry',      'Price Entry'),
    ('advance',          'Advance'),
    ('truck_allocation', 'Truck Allocation'),
    ('domestic_sale',    'Domestic Sale'),
    ('export_firm',      'Export Firm'),
    ('import_firm',      'Import Firm'),
    ('season',           'Season'),
    ('greenhouse_block', 'Greenhouse Block'),
])

# ── Editable fields per resource ─────────────────────────────────────────
# Only resources that support granular field-level editing.
# Resources not listed here use '*' (all-or-nothing).

RESOURCE_FIELDS: dict[str, list[str]] = {
    'shipment': [
        'box_count', 'pallet_count', 'weight_net', 'weight_gross',
        'price_per_kg', 'total_amount_usd', 'notes',
        'vehicle_condition', 'vehicle_condition_note', 'route_note',
    ],
    'weekly_plan': ['plan_kg', 'actual_kg'],
    'quota_issuance': ['quantity_kg', 'expires_at'],
    'local_sell_plan': ['planned_kg', 'actual_kg', 'buyer_name'],
}
