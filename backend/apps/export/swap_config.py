"""Configuration for the Swap endpoint.

Defines the SWAPPABLE_FIELDS whitelist — the only scalar and FK fields that
``POST /api/v1/export/shipments/{a_id}/swap/`` will accept.

Keep this module import-free (no Django models, no services) so it can be
imported at module load time without risk of circular imports.
"""

# ---------------------------------------------------------------------------
# FK fields: the model attribute name maps to a ``_id`` DB column.
# When swapping, the implementation swaps the ``_id`` integer values.
# ---------------------------------------------------------------------------
FK_SWAPPABLE_FIELDS: frozenset[str] = frozenset({
    'country',
    'city',
    'customer',
    'import_firm',
    'border_point',
    'variety',
})

# ---------------------------------------------------------------------------
# Full whitelist of field names accepted by the swap endpoint.
#
# Rules:
#   - Use Django model attribute names (e.g. 'country', not 'country_id').
#   - 'weight_net' is INTENTIONALLY EXCLUDED — it is recomputed from block_sources.
#   - 'cargo_code' is INTENTIONALLY EXCLUDED — it is unique and auto-generated.
#   - For FK entries in this set, the swap implementation operates on the
#     ``<field>_id`` integer to avoid unnecessary related-object fetches.
# ---------------------------------------------------------------------------
SWAPPABLE_FIELDS: frozenset[str] = frozenset({
    # Soltanmyrat (warehouse / loading dept)
    'official_export_code',
    'harvest_status',
    'warehouse_note',
    'loading_started_at',
    'loading_ended_at',
    'rejected_weight_kg',
    'variety',          # FK — swaps variety_id
    'harvest_date',
    # Transport
    'vehicle_condition',
    'vehicle_condition_note',
    'vehicle_live_status',
    'vehicle_responsible',
    'truck_plate',
    'driver_name',
    'driver_phone',
    'transport_temp_c',
    # Gadam (export_manager)
    'export_manager_note',
    'country',          # FK — swaps country_id
    'customer',         # FK — swaps customer_id
    'city',             # FK — swaps city_id
    'import_firm',      # FK — swaps import_firm_id
    # Şirin (document_team)
    'documents_status',
    'document_note',
    'customs_exit_at',
    'customs_clearance_planned_day',
    # Arap (destination / sales_rep)
    'border_point',     # FK — swaps border_point_id
    'border_crossed_at',
    'dest_entry_at',
    'customs_entry_at',
    'has_peregruz',
    'peregruz_date',
    'peregruz_city',
    'arrived_at',
    'sale_started_at',
    'sale_ended_at',
    'sales_report_date',
    'additional_notes_arap',
    # General
    'notes',
    'departed_at',
    'transit_days',
    # Weight (operator-entered)
    'weight_gross',
    'packaging_kg',
    'pallet_count',
    'box_count',
})
