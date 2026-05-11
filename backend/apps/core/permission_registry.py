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
    ('export.overdue',          'Overdue Reports'),
    ('export.advances',         'Advances'),
    ('export.plan',             'Weekly Plan'),
    ('export.quota',            'Quota Dashboard'),
    ('export.quota.local_sell', 'Local Sell Plan (sub-tab)'),
    ('export.prices',           'Prices'),
    ('export.trucks',           'Truck Forecast'),
    ('export.blocks',           'Block Summary'),
    ('export.domestic_sales',   'Domestic Sales'),
    # Draft / assignment workflow (Findings #1 + #2)
    ('export.drafts',           'Draft Shipments Pool'),
    ('export.assign',           'Assignment Board'),
    # Pallet manifest (Finding #4 / Phase 2)
    ('export.pallet_manifest',  'Pallet Manifest'),
    # Analytics (boss / director)
    ('analytics.boss',          'Boss Dashboard'),
    # Admin
    ('admin.users',             'Admin: Users'),
    ('admin.seasons',           'Admin: Seasons'),
    ('admin.firms',             'Admin: Export Firms'),
    ('admin.import_firms',      'Admin: Import Firms'),
    ('admin.permissions',       'Admin: Permissions'),
    ('admin.blocks',            'Admin: Blocks'),
    ('admin.customers',         'Admin: Customers'),
    ('admin.truck_dest',        'Admin: Truck Destinations'),
    ('admin.shipment_settings', 'Admin: Shipment Settings'),
])

# ── Resources ────────────────────────────────────────────────────────────
# Keys = resource_code used in RoleResourcePermission
# Values = human-readable label

RESOURCE_REGISTRY: dict[str, str] = OrderedDict([
    ('shipment',              'Shipment'),
    ('shipment_firm_split',   'Shipment Firm Split'),
    ('shipment_block_source', 'Shipment Block Source'),
    ('shipment_assign',       'Shipment Assignment (draft → yuklenme)'),
    ('quality_document',      'Quality Document'),
    ('sales_report',          'Sales Report'),
    ('shipment_comment',      'Shipment Comment'),
    ('quota_issuance',        'Quota Issuance'),
    ('quota_usage',           'Quota Usage'),
    ('local_sell_plan',       'Local Sell Plan'),
    ('weekly_plan',           'Weekly Harvest Plan'),
    ('price_entry',           'Price Entry'),
    ('advance',               'Advance'),
    ('truck_allocation',      'Truck Allocation'),
    ('domestic_sale',         'Domestic Sale'),
    ('export_firm',           'Export Firm'),
    ('import_firm',           'Import Firm'),
    ('season',                'Season'),
    ('greenhouse_block',      'Greenhouse Block'),
    ('truck_split_default',   'Truck Split Defaults (official kg per firm)'),
    # Pallet manifest resources (Finding #4 / Phase 2)
    ('pallet',                'Pallet manifest entries'),
    ('manifest_close',        'Close pallet manifest action'),
])

# ── Editable fields per resource ─────────────────────────────────────────
# Only resources that support granular field-level editing.
# Resources not listed here use '*' (all-or-nothing).

RESOURCE_FIELDS: dict[str, list[str]] = {
    'shipment': [
        # Identifiers
        # cargo_code (Export Code) is intentionally absent — server-auto-generated.
        # official_export_code (Shipment Code) is the operator-entered pallet tag.
        'official_export_code',
        # Weight / packaging
        'box_count', 'pallet_count', 'pallet_weight_kg', 'packaging_kg',
        'weight_net', 'weight_gross', 'rejected_weight_kg',
        # Geography / customer
        'country', 'city', 'customer', 'import_firm',
        'border_point', 'loading_location',
        # Product
        'product_type', 'variety',
        # Transport
        'vehicle_condition', 'vehicle_condition_note',
        'vehicle_live_status',
        'vehicle_responsible', 'truck_head_id', 'trailer_id', 'driver_id',
        'transit_days', 'transport_temp_c', 'shelf_life_days',
        'has_peregruz', 'peregruz_city', 'peregruz_date',
        # Operator-entered timestamps (NOT AD-1) — sheet R19, R20, R21
        'loading_started_at',
        'loading_ended_at',
        'departed_at',
        # Operational status
        'documents_status', 'harvest_status', 'customs_clearance_planned_day',
        # Finance
        'price_per_kg', 'total_amount_usd',
        # Flags
        'is_gapy_satys',
        # Notes
        'notes',
        'export_manager_note',
        'warehouse_note',
        'document_note',
    ],
    'shipment_firm_split': [
        'export_firm', 'weight_kg', 'amount_usd', 'invoice_number', 'split_order',
    ],
    'shipment_block_source': ['block', 'weight_kg'],
    'quality_document': [
        'azyk_maglumatnama', 'suriji_gozukdiriji', 'hil_sertifikaty', 'kalibrowka_analiz',
    ],
    'sales_report': [
        'price_per_kg', 'total_usd', 'weight_sold_kg', 'weight_rejected_kg',
        'transport_cost_usd', 'market_fee_usd', 'other_expenses_usd', 'notes',
    ],
    'weekly_plan': ['plan_kg', 'actual_kg'],
    'quota_issuance': ['issue_date', 'validity', 'notes'],
    'quota_usage': ['kg_used', 'usage_date', 'product_type', 'notes'],
    'local_sell_plan': ['planned_kg', 'actual_kg', 'buyer_name'],
}

# ── Required fields per role (for "My Tasks" Kanban) ───────────────────
# Subset of editable fields that MUST be non-null for a role's work to be
# considered "done" on a shipment. Used by the pending_my_fields filter.

ROLE_REQUIRED_FIELDS: dict[str, list[str]] = {
    'loading_dept_head': ['weight_net', 'weight_gross', 'variety', 'harvest_status'],
    'warehouse_chief':   ['weight_net', 'weight_gross', 'variety', 'harvest_status'],
    'document_team':     ['documents_status'],
    'transport':         ['truck_head_id', 'driver_id', 'border_point'],
    'sales_rep':         ['city', 'price_per_kg', 'total_amount_usd'],
    'finansist':         ['price_per_kg', 'total_amount_usd'],
}
