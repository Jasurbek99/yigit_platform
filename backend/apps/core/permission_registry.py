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
    ('export.shipments.board',  'Shipment Board (Kanban)'),
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
    # Personal workspace
    ('me.board',                'My Tasks'),
    # Analytics (boss / director)
    ('analytics.boss',          'Boss Dashboard'),
    # Director / oversight
    ('director.stuck_shipments', 'Stuck Shipments'),
    # System (NOT admin.* — visible to director/export_manager too, so it must
    # not carry the admin. prefix that AD-15 reserves for admin-only pages).
    ('audit_log',               'Audit Log'),
    # Feedback module
    ('feedback.submit',         'Feedback: Submit'),
    ('feedback.my_tickets',     'Feedback: My Tickets'),
    ('feedback.public',         'Feedback: Public Feed'),
    ('feedback.admin_inbox',    'Feedback: Admin Inbox'),
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
        # Operator-entered transport details — sheet R23, R27, R28
        'truck_plate', 'driver_name', 'driver_phone',
        'transit_days', 'transport_temp_c', 'shelf_life_days',
        'has_peregruz', 'peregruz_city', 'peregruz_date',
        # Operator-entered timestamps — sheet R19/R20/R21/R25/R30/R31/R32/R35/R41/R42.
        # AD-1 retired; every lifecycle timestamp here is now operator-entered.
        'loading_started_at',
        'loading_ended_at',
        'departed_at',
        'customs_exit_at',
        'border_crossed_at',
        'dest_entry_at',
        'customs_entry_at',
        'arrived_at',
        'sale_started_at',
        'sale_ended_at',
        # Operator-entered date — sheet R43 (sales rep files the report)
        'sales_report_date',
        # Operator-entered date — sheet R39 (warehouse logs harvest day)
        'harvest_date',
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
        # R44 — Arap's destination-side freeform note (sales_rep)
        'additional_notes_arap',
        # Sheet column tint — admin + export_manager via wildcard grants
        'column_color',
    ],
    'shipment_firm_split': [
        'export_firm', 'weight_kg', 'amount_usd', 'invoice_number', 'split_order',
    ],
    'shipment_block_source': ['block', 'weight_kg', 'harvest_date'],
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
