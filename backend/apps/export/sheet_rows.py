"""Backend mirror of the frontend SHEET_ROW_CONFIG constant.

This is the canonical list of shipment sheet rows. The frontend
``frontend/src/constants/sheetRowConfig.ts`` is the source of truth for display
order and field definitions; this file mirrors it verbatim so the backend can
serve the row map via the /sheet/ API (plan D1) and gate edits via
``can_edit_sheet_field`` without re-reading the JS file at runtime.

Row 16 is intentionally absent (skipped in the original Excel layout).

Each entry keys:
    row_number       int   — display ordinal (mirrors Excel row numbers)
    field_key        str   — DB / serializer field name
    default_who_key  str   — i18n key for the "Who" label column
    label_key        str   — i18n key for the row label
    input_type       str   — 'text' | 'number' | 'date' | 'datetime' | 'dropdown'
                             | 'multiselect' | 'status' | 'readonly'
    style            str   — 'base' | 'key' | 'transport' | 'status' | 'report' | 'separator'
    options_source   str?  — (optional) registry key for dropdown options
    gapy_hidden      bool? — (optional) True when row is hidden for Gapy Satys shipments
"""

DEFAULT_SHEET_ROWS: list[dict] = [
    # === Frozen Section (Rows 3-14) — Shipment Identity & Planning ===
    # Row 2 (route_note) dropped in A1. Row 5 (customs_clearance) replaced by
    # export_manager_note. Row 40 (cmr_status readonly orphan) dropped in A1.
    {
        'row_number': 3,
        'field_key': 'vehicle_condition',
        'default_who_key': 'sheet.who.logist',
        'label_key': 'sheet.row.truck_status',
        'input_type': 'dropdown',
        'style': 'transport',
        'options_source': 'vehicleCondition',
    },
    {
        # R4 repurposed (feedback #9): used to be Malik's "Goşmaça bellik" /
        # Shipment.notes — now Şirin logs the time the transport department
        # handed over the docs. Null = "Berilmedi"; set = "Berildi at <time>".
        # Legacy Shipment.notes column still exists (Detail view / serializer)
        # so historical data isn't lost.
        'row_number': 4,
        'field_key': 'transport_docs_given_at',
        'default_who_key': 'sheet.who.sirin',
        'label_key': 'sheet.row.transport_docs_given',
        'input_type': 'datetime',
        'style': 'base',
    },
    {
        'row_number': 5,
        'field_key': 'export_manager_note',
        'default_who_key': 'sheet.who.gadam',
        'label_key': 'sheet.row.export_manager_note',
        'input_type': 'text',
        'style': 'base',
    },
    {
        'row_number': 6,
        'field_key': 'documents_status',
        'default_who_key': 'sheet.who.sirin',
        'label_key': 'sheet.row.documents',
        'input_type': 'status',
        'style': 'status',
    },
    {
        # Stream G: cargo_code is the platform-internal Export Code, auto-generated
        # at create time. Read-only here. Soltanmyrat's pallet-tag code lives on
        # the separate official_export_code row below.
        'row_number': 7,
        'field_key': 'cargo_code',
        'default_who_key': 'sheet.who.soltanmyrat',
        'label_key': 'sheet.row.export_code',
        'input_type': 'readonly',
        'style': 'key',
    },
    {
        # Stream G: official_export_code is the operator-entered Shipment Code —
        # the 6-field DD|MM|NNN|BLK|YY|VV pallet tag. Validated server-side by
        # validate_official_export_code on every PATCH. Logical position is
        # right next to the Export Code (row 7); display_order on
        # SheetRowSetting can pin it there. row_number 46 keeps it clear of
        # the original Excel 1-44 numbering convention.
        'row_number': 46,
        'field_key': 'official_export_code',
        'default_who_key': 'sheet.who.soltanmyrat',
        'label_key': 'sheet.row.shipment_code',
        'input_type': 'text',
        'style': 'key',
    },
    {
        'row_number': 8,
        'field_key': 'block_sources',
        'default_who_key': 'sheet.who.soltanmyrat',
        'label_key': 'sheet.row.harvest_block',
        'input_type': 'multiselect',
        'style': 'base',
        'options_source': 'blocks',
    },
    {
        'row_number': 9,
        'field_key': 'firm_splits',
        'default_who_key': 'sheet.who.sulgun',
        'label_key': 'sheet.row.export_firm',
        'input_type': 'multiselect',
        'style': 'base',
        'options_source': 'exportFirms',
    },
    {
        'row_number': 10,
        'field_key': 'country',
        'default_who_key': 'sheet.who.gadam',
        'label_key': 'sheet.row.country',
        'input_type': 'dropdown',
        'style': 'key',
        'options_source': 'countries',
    },
    {
        'row_number': 11,
        'field_key': 'customer',
        'default_who_key': 'sheet.who.gadam',
        'label_key': 'sheet.row.customer',
        'input_type': 'dropdown',
        'style': 'base',
        'options_source': 'customers',
    },
    {
        'row_number': 12,
        'field_key': 'city',
        'default_who_key': 'sheet.who.arap',
        'label_key': 'sheet.row.city',
        'input_type': 'dropdown',
        'style': 'base',
        'options_source': 'cities',
    },
    {
        'row_number': 13,
        'field_key': 'import_firm',
        'default_who_key': 'sheet.who.gadam',
        'label_key': 'sheet.row.import_firm',
        'input_type': 'dropdown',
        'style': 'base',
        'options_source': 'importFirms',
    },
    {
        'row_number': 14,
        'field_key': 'harvest_status',
        'default_who_key': 'sheet.who.soltanmyrat',
        'label_key': 'sheet.row.harvest_status',
        'input_type': 'status',
        'style': 'status',
    },

    # === Scrollable Section (Rows 15-44) — Operations & Logistics ===
    # Row 16 is intentionally absent (skipped in the original Excel layout).
    # State machine v2: every lifecycle timestamp is operator-entered on the
    # Sheet — they are the trigger fields for auto-advance. Only cargo_code
    # (R7) remains structurally readonly (auto-generated).
    # All previously-orphan rows (15, 23, 27, 28, 31, 44) are now backed by real
    # Shipment columns (migrations 0019/0020) and are inline-editable.
    {
        'row_number': 15,
        'field_key': 'vehicle_live_status',
        'default_who_key': 'sheet.who.haltac',
        'label_key': 'sheet.row.vehicle_live_status',
        'input_type': 'text',
        'style': 'transport',
    },
    {
        'row_number': 17,
        'field_key': 'warehouse_note',
        'default_who_key': 'sheet.who.soltanmyrat',
        'label_key': 'sheet.row.warehouse_notes',
        'input_type': 'text',
        'style': 'base',
    },
    {
        'row_number': 18,
        'field_key': 'document_note',
        'default_who_key': 'sheet.who.sirin',
        'label_key': 'sheet.row.document_notes',
        'input_type': 'text',
        'style': 'base',
    },
    {
        'row_number': 19,
        'field_key': 'loading_started_at',
        'default_who_key': 'sheet.who.soltanmyrat',
        'label_key': 'sheet.row.loading_start',
        'input_type': 'datetime',
        'style': 'base',
    },
    {
        'row_number': 20,
        'field_key': 'loading_ended_at',
        'default_who_key': 'sheet.who.soltanmyrat',
        'label_key': 'sheet.row.loading_end',
        'input_type': 'datetime',
        'style': 'base',
    },
    {
        'row_number': 21,
        'field_key': 'departed_at',
        'default_who_key': 'sheet.who.mergen',
        'label_key': 'sheet.row.greenhouse_departure',
        'input_type': 'datetime',
        'style': 'base',
    },
    {
        'row_number': 22,
        'field_key': 'vehicle_responsible',
        'default_who_key': 'sheet.who.transport',
        'label_key': 'sheet.row.vehicle_responsible',
        'input_type': 'dropdown',
        'style': 'transport',
        'options_source': 'transportUsers',
    },
    {
        'row_number': 23,
        'field_key': 'truck_plate',
        'default_who_key': 'sheet.who.transport',
        'label_key': 'sheet.row.truck_plate',
        'input_type': 'text',
        'style': 'transport',
    },
    {
        'row_number': 24,
        'field_key': 'has_doc_advance',
        'default_who_key': 'sheet.who.babageldi',
        'label_key': 'sheet.row.doc_advance',
        'input_type': 'readonly',
        'style': 'report',
    },
    {
        'row_number': 25,
        'field_key': 'customs_exit_at',
        'default_who_key': 'sheet.who.sirin',
        'label_key': 'sheet.row.customs_exit_tm',
        'input_type': 'datetime',
        'style': 'key',
    },
    {
        'row_number': 26,
        'field_key': 'transit_days_temp',
        'default_who_key': 'sheet.who.quality',
        'label_key': 'sheet.row.transit_temp',
        'input_type': 'readonly',
        'style': 'base',
    },
    {
        'row_number': 27,
        'field_key': 'driver_name',
        'default_who_key': 'sheet.who.transport',
        'label_key': 'sheet.row.driver_name',
        'input_type': 'text',
        'style': 'transport',
    },
    {
        'row_number': 28,
        'field_key': 'driver_phone',
        'default_who_key': 'sheet.who.transport',
        'label_key': 'sheet.row.driver_phone',
        'input_type': 'phone',
        'style': 'transport',
    },
    {
        'row_number': 29,
        'field_key': 'border_point',
        'default_who_key': 'sheet.who.transport',
        'label_key': 'sheet.row.border_point',
        'input_type': 'dropdown',
        'style': 'base',
        'options_source': 'borderPoints',
        'gapy_hidden': True,
    },
    {
        'row_number': 30,
        'field_key': 'border_crossed_at',
        'default_who_key': 'sheet.who.haltac',
        'label_key': 'sheet.row.border_exit',
        'input_type': 'datetime',
        'style': 'base',
        'gapy_hidden': True,
    },
    {
        'row_number': 31,
        'field_key': 'dest_entry_at',
        'default_who_key': 'sheet.who.arap',
        'label_key': 'sheet.row.dest_entry',
        'input_type': 'datetime',
        'style': 'base',
        'gapy_hidden': True,
    },
    {
        'row_number': 32,
        'field_key': 'customs_entry_at',
        'default_who_key': 'sheet.who.arap',
        'label_key': 'sheet.row.dest_customs',
        'input_type': 'datetime',
        'style': 'base',
        'gapy_hidden': True,
    },
    {
        'row_number': 33,
        'field_key': 'has_peregruz',
        'default_who_key': 'sheet.who.arap',
        'label_key': 'sheet.row.peregruz_status',
        'input_type': 'dropdown',
        'style': 'base',
        'options_source': 'peregruz',
    },
    {
        'row_number': 34,
        'field_key': 'peregruz_date',
        'default_who_key': 'sheet.who.arap',
        'label_key': 'sheet.row.peregruz_time',
        'input_type': 'datetime',
        'style': 'base',
    },
    {
        'row_number': 35,
        'field_key': 'arrived_at',
        'default_who_key': 'sheet.who.arap',
        'label_key': 'sheet.row.arrival',
        'input_type': 'datetime',
        'style': 'base',
    },
    {
        'row_number': 36,
        'field_key': 'rejected_weight_kg',
        'default_who_key': 'sheet.who.soltanmyrat',
        'label_key': 'sheet.row.weight_received',
        'input_type': 'number',
        'style': 'base',
    },
    {
        'row_number': 37,
        'field_key': 'weight_net',
        'default_who_key': 'sheet.who.soltanmyrat',
        'label_key': 'sheet.row.weight_shipped',
        'input_type': 'number',
        'style': 'key',
    },
    {
        'row_number': 38,
        'field_key': 'variety',
        'default_who_key': 'sheet.who.soltanmyrat',
        'label_key': 'sheet.row.variety',
        'input_type': 'dropdown',
        'style': 'base',
        'options_source': 'varieties',
    },
    {
        # R39 was an orphan readonly cell (no harvest_date column existed).
        # Now backed by Shipment.harvest_date — operator-entered DateField.
        'row_number': 39,
        'field_key': 'harvest_date',
        'default_who_key': 'sheet.who.soltanmyrat',
        'label_key': 'sheet.row.harvest_date',
        'input_type': 'date',
        'style': 'base',
    },
    {
        'row_number': 41,
        'field_key': 'sale_started_at',
        'default_who_key': 'sheet.who.arap',
        'label_key': 'sheet.row.sale_start',
        'input_type': 'datetime',
        'style': 'report',
    },
    {
        'row_number': 42,
        'field_key': 'sale_ended_at',
        'default_who_key': 'sheet.who.arap',
        'label_key': 'sheet.row.sale_end',
        'input_type': 'datetime',
        'style': 'report',
    },
    {
        # R43 used to point at has_sales_report (a derived boolean) with
        # input_type='date', so picking a date silently dropped the save.
        # Now backed by a real Shipment.sales_report_date column.
        'row_number': 43,
        'field_key': 'sales_report_date',
        'default_who_key': 'sheet.who.aganazar',
        'label_key': 'sheet.row.report_date',
        'input_type': 'date',
        'style': 'report',
    },
    {
        'row_number': 44,
        'field_key': 'additional_notes_arap',
        'default_who_key': 'sheet.who.arap',
        'label_key': 'sheet.row.additional_notes_arap',
        'input_type': 'text',
        'style': 'base',
    },

    # === A2: Sirin's customs clearance planning field ===
    # Placed at row 45 (new; no available gap in existing 3-44 layout adjacent
    # to documents_status / R6). Owner: document_team (Sirin).
    {
        'row_number': 45,
        'field_key': 'customs_clearance_planned_day',
        'default_who_key': 'sheet.who.sirin',
        'label_key': 'sheet.row.customs_clearance_planned_day',
        'input_type': 'dropdown',
        'style': 'status',
        'options_source': 'weekdays',
    },
    # Görnüşi — shipment type flag (Adaty export vs Gapy Satyş domestic sale).
    # Backed by Shipment.is_gapy_satys (boolean). Two-option dropdown styled
    # like has_peregruz: value=0 → False (Adaty), value=1 → True (Gapy Satyş).
    # Default is Adaty (False). Toggling to Gapy Satyş hides all rows marked
    # gapy_hidden=True (border_point, customs_*, dest_*) on the affected
    # shipment column. Logical position is the identity section near country
    # (R10); admin can pin via SheetRowSetting.display_order.
    {
        'row_number': 47,
        'field_key': 'is_gapy_satys',
        'default_who_key': 'sheet.who.gadam',
        'label_key': 'sheet.row.gornushi',
        'input_type': 'dropdown',
        'style': 'status',
        'options_source': 'gornushi',
    },
]
