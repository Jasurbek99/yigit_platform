-- ============================================================
-- YGT HOLDING — MSSQL DDL SCRIPT v5.1
-- Database: YGT_Platform
-- Run order: core → sys → export → contracts → finance → greenhouse
-- Existing Trip Management tables: DO NOT run those sections
--
-- Changes from v5.0:
--   AD-1: 8 denormalized timestamp columns on export.shipments
--   AD-2: vehicle_condition structured fields (R15 replacement)
--   NEW:  export.shipment_comments table
--   FIX:  shipment_id FK on greenhouse.daily_harvest_records
--   NOTE: sys_users.managed_blocks marked for removal
--   NOTE: sys_users.password_hash marked for Django AbstractUser migration
-- ============================================================

-- CREATE DATABASE YGT_Platform;
-- GO
-- USE YGT_Platform;
-- GO

-- ████████ SCHEMAS ████████
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = 'core') EXEC('CREATE SCHEMA core');
GO
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = 'export') EXEC('CREATE SCHEMA export');
GO
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = 'contracts') EXEC('CREATE SCHEMA contracts');
GO
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = 'finance') EXEC('CREATE SCHEMA finance');
GO
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = 'greenhouse') EXEC('CREATE SCHEMA greenhouse');
GO


-- ████████ CORE MODULE ████████

CREATE TABLE core.seasons (
    id INT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(10) NOT NULL UNIQUE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_active BIT DEFAULT 0
);

CREATE TABLE core.countries (
    id INT IDENTITY(1,1) PRIMARY KEY,
    name_tk NVARCHAR(100) NOT NULL,
    name_ru NVARCHAR(100),
    name_en NVARCHAR(100),
    code NVARCHAR(5) UNIQUE
);

CREATE TABLE core.cities (
    id INT IDENTITY(1,1) PRIMARY KEY,
    country_id INT NOT NULL REFERENCES core.countries(id),
    name NVARCHAR(100) NOT NULL,
    name_local NVARCHAR(100),
    CONSTRAINT uq_city_country UNIQUE (country_id, name)
);

CREATE TABLE core.border_points (
    id INT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(100) NOT NULL UNIQUE,
    route_description NVARCHAR(500),
    typical_transit_days INT,
    is_active BIT DEFAULT 1
);

CREATE TABLE core.loading_locations (
    id INT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE core.tomato_varieties (
    id INT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(50) NOT NULL UNIQUE,
    type NVARCHAR(30),
    avg_fruit_weight_gr DECIMAL(6,2)
);

CREATE TABLE core.product_types (
    id INT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE core.shipment_status_types (
    id INT IDENTITY(1,1) PRIMARY KEY,
    code NVARCHAR(30) NOT NULL UNIQUE,
    name_tk NVARCHAR(100) NOT NULL,
    name_en NVARCHAR(100),
    name_ru NVARCHAR(100),
    step_order INT NOT NULL,
    required_role NVARCHAR(30),      -- NOTE: single role only; Python TRANSITIONS dict handles multi-role
    phase NVARCHAR(20)
);

-- Users table
-- NOTE: In Django, replace with AbstractUser extension. password_hash → Django handles auth.
-- NOTE: managed_blocks is DEPRECATED — greenhouse_blocks.manager_id FK handles this relationship.
CREATE TABLE sys_users (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    username NVARCHAR(150) NOT NULL UNIQUE,
    email NVARCHAR(254),
    password_hash NVARCHAR(128) NOT NULL,   -- DEPRECATED: Django AbstractUser handles password hashing
    first_name NVARCHAR(100),
    last_name NVARCHAR(100),
    phone NVARCHAR(20),
    telegram_chat_id NVARCHAR(50),
    role NVARCHAR(30) NOT NULL,
    managed_blocks NVARCHAR(200),           -- DEPRECATED: use greenhouse_blocks.manager_id FK instead
    is_active BIT DEFAULT 1,
    last_login DATETIMEOFFSET,
    created_at DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET()
);

CREATE TABLE core.greenhouse_blocks (
    id INT IDENTITY(1,1) PRIMARY KEY,
    code NVARCHAR(10) NOT NULL UNIQUE,
    name NVARCHAR(100),
    manager_id BIGINT REFERENCES sys_users(id),  -- THIS is the correct block→manager relationship
    variety_main NVARCHAR(50),
    variety_secondary NVARCHAR(50),
    area_m2 INT,
    location NVARCHAR(50),
    section_count INT,
    sowing_date DATE,
    season_start_month INT,
    is_active BIT DEFAULT 1
);

CREATE TABLE core.export_firms (
    id INT IDENTITY(1,1) PRIMARY KEY,
    code NVARCHAR(20) NOT NULL UNIQUE,
    name_tk NVARCHAR(200) NOT NULL,
    name_ru NVARCHAR(200),
    name_en NVARCHAR(200),
    address_tk NVARCHAR(500),
    address_ru NVARCHAR(500),
    address_en NVARCHAR(500),
    bank_details_tk NVARCHAR(1000),
    bank_details_ru NVARCHAR(1000),
    bank_details_en NVARCHAR(1000),
    director NVARCHAR(200),
    tax_code NVARCHAR(50),
    swift_code NVARCHAR(20),
    one_c_code NVARCHAR(50),
    is_active BIT DEFAULT 1
);

CREATE TABLE core.import_firms (
    id INT IDENTITY(1,1) PRIMARY KEY,
    code NVARCHAR(50),
    name_company NVARCHAR(300) NOT NULL,
    name_short NVARCHAR(100),
    country_id INT REFERENCES core.countries(id),
    city_id INT REFERENCES core.cities(id),
    address NVARCHAR(500),
    bank_details NVARCHAR(1000),
    contact_person NVARCHAR(200),
    phone NVARCHAR(50),
    is_active BIT DEFAULT 1
);

CREATE TABLE core.customers (
    id INT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(100) NOT NULL UNIQUE,
    phone NVARCHAR(50),
    default_country_id INT REFERENCES core.countries(id),
    default_city_id INT REFERENCES core.cities(id),
    is_active BIT DEFAULT 1
);

CREATE TABLE core.domestic_buyers (
    id INT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(100) NOT NULL UNIQUE,
    contact_person NVARCHAR(100),
    phone NVARCHAR(50),
    is_active BIT DEFAULT 1
);


-- ████████ EXPORT MODULE ████████

CREATE TABLE export.shipments (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    code NVARCHAR(20) NOT NULL UNIQUE,
    date DATE NOT NULL,
    season_id INT NOT NULL REFERENCES core.seasons(id),
    country_id INT REFERENCES core.countries(id),
    city_id INT REFERENCES core.cities(id),
    customer_id INT REFERENCES core.customers(id),
    import_firm_id INT REFERENCES core.import_firms(id),
    border_point_id INT REFERENCES core.border_points(id),
    loading_location_id INT REFERENCES core.loading_locations(id),
    product_type_id INT REFERENCES core.product_types(id) DEFAULT 1,
    weight_gross_kg DECIMAL(10,2),
    weight_net_kg DECIMAL(10,2),
    packaging_kg DECIMAL(8,2),
    pallet_count INT,
    pallet_weight_kg DECIMAL(8,2),
    box_count INT,
    variety_id INT REFERENCES core.tomato_varieties(id),
    truck_head_id BIGINT, -- FK to trip_mgmt.truck_heads
    trailer_id BIGINT,    -- FK to trip_mgmt.trailers
    driver_id BIGINT,     -- FK to trip_mgmt.drivers
    trip_id BIGINT,       -- FK to trip_mgmt.trips
    vehicle_responsible NVARCHAR(50),
    transport_temp_c DECIMAL(4,1),
    transit_days INT,
    shelf_life_days INT,
    rejected_weight_kg DECIMAL(10,2),
    status_id INT NOT NULL REFERENCES core.shipment_status_types(id),
    is_gapy_satys BIT DEFAULT 0,
    price_per_kg DECIMAL(8,4),
    total_amount_usd DECIMAL(12,2),
    has_peregruz BIT DEFAULT 0,
    peregruz_city NVARCHAR(100),
    peregruz_date DATETIMEOFFSET,

    -- v5.1 AD-1: Denormalized timestamps (written ONLY by transition_to(), never directly)
    loading_started_at DATETIMEOFFSET,      -- set when status → yuklenme
    customs_entry_at DATETIMEOFFSET,        -- set when status → gumruk_girish
    customs_exit_at DATETIMEOFFSET,         -- set when status → gumruk_chykysh
    departed_at DATETIMEOFFSET,             -- set when status → yola_chykdy
    border_crossed_at DATETIMEOFFSET,       -- set when status → serhet_gechdi
    arrived_at DATETIMEOFFSET,              -- set when status → bardy
    sale_started_at DATETIMEOFFSET,         -- set when status → satylyar
    sale_ended_at DATETIMEOFFSET,           -- set when status → satyldy

    -- v5.1 AD-2: Structured vehicle fields (replaces vehicle_status_note)
    vehicle_condition NVARCHAR(20),         -- OK / ISSUE / BREAKDOWN / RETURNED
    vehicle_condition_note NVARCHAR(300),   -- short description of the issue
    route_note NVARCHAR(300),              -- route-specific instructions

    -- DEPRECATED: R15 free-text field. Kept for data migration only. New notes → shipment_comments.
    vehicle_status_note NVARCHAR(500),

    created_by BIGINT REFERENCES sys_users(id),
    updated_by BIGINT REFERENCES sys_users(id),
    created_at DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
    updated_at DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
    notes NVARCHAR(MAX),

    CONSTRAINT chk_vehicle_condition CHECK (
        vehicle_condition IN ('OK', 'ISSUE', 'BREAKDOWN', 'RETURNED') OR vehicle_condition IS NULL
    )
);

CREATE INDEX ix_shipment_season_date ON export.shipments(season_id, date);
CREATE INDEX ix_shipment_status ON export.shipments(status_id);
CREATE INDEX ix_shipment_country ON export.shipments(country_id);
CREATE INDEX ix_shipment_customer ON export.shipments(customer_id);
-- v5.1: filtered indexes for common list view sorts
CREATE INDEX ix_shipment_departed ON export.shipments(departed_at) WHERE departed_at IS NOT NULL;
CREATE INDEX ix_shipment_arrived ON export.shipments(arrived_at) WHERE arrived_at IS NOT NULL;

CREATE TABLE export.shipment_status_log (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    shipment_id BIGINT NOT NULL REFERENCES export.shipments(id),
    status_id INT NOT NULL REFERENCES core.shipment_status_types(id),
    changed_by BIGINT NOT NULL REFERENCES sys_users(id),
    changed_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    comment NVARCHAR(500),
    is_manual_override BIT DEFAULT 0
);

CREATE INDEX ix_status_log_shipment ON export.shipment_status_log(shipment_id, status_id);

CREATE TABLE export.shipment_firm_splits (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    shipment_id BIGINT NOT NULL REFERENCES export.shipments(id),
    export_firm_id INT NOT NULL REFERENCES core.export_firms(id),
    weight_kg DECIMAL(10,2) NOT NULL,
    amount_usd DECIMAL(12,2),
    invoice_number NVARCHAR(20),
    split_order INT DEFAULT 1,
    CONSTRAINT uq_split_shipment_firm UNIQUE (shipment_id, export_firm_id)
);

CREATE TABLE export.shipment_block_sources (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    shipment_id BIGINT NOT NULL REFERENCES export.shipments(id),
    block_id INT NOT NULL REFERENCES core.greenhouse_blocks(id),
    weight_kg DECIMAL(10,2) NOT NULL,
    CONSTRAINT uq_blocksource_shipment_block UNIQUE (shipment_id, block_id)
);

-- v5.1: Comments system (replaces R15 for freeform notes)
CREATE TABLE export.shipment_comments (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    shipment_id BIGINT NOT NULL REFERENCES export.shipments(id),
    user_id BIGINT NOT NULL REFERENCES sys_users(id),
    content NVARCHAR(2000) NOT NULL,
    mentions NVARCHAR(500),             -- comma-separated user IDs mentioned with @
    parent_comment_id BIGINT REFERENCES export.shipment_comments(id),  -- for threaded replies
    is_system BIT DEFAULT 0,            -- TRUE for auto-generated comments (status changes, etc.)
    created_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    updated_at DATETIMEOFFSET
);

CREATE INDEX ix_comments_shipment ON export.shipment_comments(shipment_id, created_at);
CREATE INDEX ix_comments_user ON export.shipment_comments(user_id);

CREATE TABLE export.sales_reports (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    shipment_id BIGINT NOT NULL REFERENCES export.shipments(id),
    reported_by BIGINT REFERENCES sys_users(id),
    report_date DATE NOT NULL,
    arrival_date DATE,
    sale_start_date DATE,
    sale_end_date DATE,
    sold_weight_kg DECIMAL(10,2),
    sale_price_per_kg DECIMAL(8,4),
    total_revenue_usd DECIMAL(12,2),
    total_revenue_local DECIMAL(15,2),
    local_currency NVARCHAR(10),
    exchange_rate DECIMAL(12,4),
    customs_expenses DECIMAL(10,2),
    transport_expenses DECIMAL(10,2),
    storage_expenses DECIMAL(10,2),
    other_expenses DECIMAL(10,2),
    expense_notes NVARCHAR(500),
    waste_kg DECIMAL(10,2),
    quality_notes NVARCHAR(500),
    created_at DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
    updated_at DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET()
);

CREATE TABLE export.quality_documents (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    shipment_id BIGINT NOT NULL REFERENCES export.shipments(id),
    inspector_id BIGINT REFERENCES sys_users(id),
    inspection_date DATETIMEOFFSET,
    azyk_maglumatnama BIT DEFAULT 0,
    suriji_gozukdiriji BIT DEFAULT 0,
    hil_sertifikaty BIT DEFAULT 0,
    kalibrowka_analiz BIT DEFAULT 0,
    set_temperature_c DECIMAL(4,1),
    transit_days INT,
    shelf_life_days INT,
    rejected_kg DECIMAL(10,2),
    inspection_notes NVARCHAR(500),
    created_at DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET()
);

CREATE TABLE export.quota_allocations (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    export_firm_id INT NOT NULL REFERENCES core.export_firms(id),
    -- Domestic sale basis
    domestic_sale_kg DECIMAL(12,2) NOT NULL,
    domestic_sale_date DATE NULL,
    -- Quota amounts
    expected_kg DECIMAL(12,2) NOT NULL,       -- domestic_sale_kg × 10
    granted_kg DECIMAL(12,2) NOT NULL,        -- actual government grant
    used_kg DECIMAL(12,2) DEFAULT 0,          -- consumed by shipments (FIFO)
    -- Validity window
    valid_from DATE NOT NULL,
    valid_to DATE NOT NULL,
    -- Warning flags
    warning_80_sent BIT DEFAULT 0,
    warning_90_sent BIT DEFAULT 0,
    warning_95_sent BIT DEFAULT 0,
    -- Audit
    created_at DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
    created_by BIGINT NULL REFERENCES sys_users(id),
    notes NVARCHAR(500) DEFAULT '',
    CONSTRAINT chk_quota_valid_range CHECK (valid_to >= valid_from),
    CONSTRAINT chk_quota_domestic_sale_gt0 CHECK (domestic_sale_kg > 0),
    CONSTRAINT chk_quota_granted_kg_gt0 CHECK (granted_kg > 0),
    CONSTRAINT chk_quota_used_kg_gte0 CHECK (used_kg >= 0)
);

CREATE TABLE export.domestic_sales (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    date DATE NOT NULL,
    buyer_id INT NOT NULL REFERENCES core.domestic_buyers(id),
    block_id INT NOT NULL REFERENCES core.greenhouse_blocks(id),
    export_firm_id INT REFERENCES core.export_firms(id),
    weight_kg DECIMAL(10,2) NOT NULL,
    variety NVARCHAR(50),
    price_per_kg DECIMAL(8,2),
    tabel_no NVARCHAR(20),
    notes NVARCHAR(500),
    created_by BIGINT REFERENCES sys_users(id),
    created_at DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET()
);

CREATE TABLE export.weekly_harvest_plans (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    season_id INT NOT NULL REFERENCES core.seasons(id),
    block_id INT NOT NULL REFERENCES core.greenhouse_blocks(id),
    week_number INT NOT NULL,
    year INT NOT NULL,
    monday_plan_kg DECIMAL(10,2) DEFAULT 0,
    tuesday_plan_kg DECIMAL(10,2) DEFAULT 0,
    wednesday_plan_kg DECIMAL(10,2) DEFAULT 0,
    thursday_plan_kg DECIMAL(10,2) DEFAULT 0,
    friday_plan_kg DECIMAL(10,2) DEFAULT 0,
    saturday_plan_kg DECIMAL(10,2) DEFAULT 0,
    monday_actual_kg DECIMAL(10,2),
    tuesday_actual_kg DECIMAL(10,2),
    wednesday_actual_kg DECIMAL(10,2),
    thursday_actual_kg DECIMAL(10,2),
    friday_actual_kg DECIMAL(10,2),
    saturday_actual_kg DECIMAL(10,2),
    entered_by BIGINT REFERENCES sys_users(id),
    created_at DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
    updated_at DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT uq_weekly_plan UNIQUE (season_id, block_id, week_number, year)
);

CREATE TABLE export.weekly_truck_allocations (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    season_id INT NOT NULL REFERENCES core.seasons(id),
    week_number INT NOT NULL,
    year INT NOT NULL,
    day_of_week INT NOT NULL,
    total_planned_kg DECIMAL(12,2),
    total_trucks_calc DECIMAL(6,2),
    russia_trucks INT DEFAULT 0,
    kazakhstan_trucks INT DEFAULT 0,
    gapy_satys_trucks INT DEFAULT 0,
    decided_by BIGINT REFERENCES sys_users(id),
    created_at DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT uq_truck_alloc UNIQUE (season_id, week_number, year, day_of_week)
);

CREATE TABLE export.price_entries (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    date DATE NOT NULL,
    city_id INT NOT NULL REFERENCES core.cities(id),
    price_local DECIMAL(10,2),
    price_usd DECIMAL(8,4),
    currency NVARCHAR(10),
    source NVARCHAR(30),
    entered_by BIGINT REFERENCES sys_users(id),
    created_at DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT uq_price_date_city UNIQUE (date, city_id)
);

CREATE TABLE export.domestic_market_prices (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    date DATE NOT NULL,
    market_name NVARCHAR(100) NOT NULL,
    price_type NVARCHAR(30),
    variety_type NVARCHAR(30),
    price DECIMAL(8,2) NOT NULL,
    entered_by BIGINT REFERENCES sys_users(id),
    created_at DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET()
);

CREATE INDEX ix_domestic_price ON export.domestic_market_prices(date, market_name, price_type, variety_type);

CREATE TABLE export.finansist_advances (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    batch_code NVARCHAR(50),
    advance_date DATE NOT NULL,
    total_amount DECIMAL(12,2) NOT NULL,
    currency NVARCHAR(10) DEFAULT 'USD',
    purpose NVARCHAR(200),
    issued_by BIGINT REFERENCES sys_users(id),
    reconciled BIT DEFAULT 0,
    reconciled_at DATETIMEOFFSET,
    notes NVARCHAR(500),
    created_at DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET()
);

CREATE TABLE export.finansist_advance_shipments (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    advance_id BIGINT NOT NULL REFERENCES export.finansist_advances(id),
    shipment_id BIGINT NOT NULL REFERENCES export.shipments(id),
    allocated_amount DECIMAL(12,2),
    CONSTRAINT uq_advance_shipment UNIQUE (advance_id, shipment_id)
);


-- ████████ CONTRACTS MODULE ████████

CREATE TABLE contracts.contracts (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    contract_number NVARCHAR(100) NOT NULL UNIQUE,
    season_id INT REFERENCES core.seasons(id),
    export_firm_id INT NOT NULL REFERENCES core.export_firms(id),
    import_firm_id INT NOT NULL REFERENCES core.import_firms(id),
    customer_id INT REFERENCES core.customers(id),
    contract_type NVARCHAR(20) NOT NULL,
    incoterm NVARCHAR(10),
    start_date DATE,
    end_date DATE,
    planned_trucks INT,
    planned_quantity_kg DECIMAL(12,2),
    planned_amount_usd DECIMAL(12,2),
    exported_trucks INT DEFAULT 0,
    exported_quantity_kg DECIMAL(12,2) DEFAULT 0,
    exported_amount_usd DECIMAL(12,2) DEFAULT 0,
    payment_received_usd DECIMAL(12,2) DEFAULT 0,
    remaining_usd DECIMAL(12,2) DEFAULT 0,
    last_invoice_number INT,
    sent_to_unk BIT DEFAULT 0,
    status NVARCHAR(20) DEFAULT 'active',
    created_by BIGINT REFERENCES sys_users(id),
    created_at DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
    updated_at DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET()
);

CREATE TABLE contracts.invoices (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    contract_id BIGINT NOT NULL REFERENCES contracts.contracts(id),
    shipment_id BIGINT REFERENCES export.shipments(id),
    invoice_number INT NOT NULL,
    invoice_date DATE NOT NULL,
    serial_truck_number INT,
    export_firm_id INT REFERENCES core.export_firms(id),
    import_firm_id INT REFERENCES core.import_firms(id),
    incoterm NVARCHAR(10),
    quantity_kg DECIMAL(10,2),
    price_per_kg DECIMAL(8,4),
    total_usd DECIMAL(12,2),
    passport_sdelka NVARCHAR(100),
    scan_uploaded BIT DEFAULT 0,
    status NVARCHAR(20) DEFAULT 'draft',
    created_at DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
    updated_at DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT uq_invoice_contract UNIQUE (contract_id, invoice_number)
);

CREATE TABLE contracts.invoice_payments (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    invoice_id BIGINT NOT NULL REFERENCES contracts.invoices(id),
    payment_date DATE NOT NULL,
    amount_usd DECIMAL(12,2) NOT NULL,
    payment_method NVARCHAR(20),
    reference NVARCHAR(200),
    received_by BIGINT REFERENCES sys_users(id),
    created_at DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET()
);

CREATE TABLE contracts.pasport_sdelki (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    contract_id BIGINT REFERENCES contracts.contracts(id),
    number NVARCHAR(100) NOT NULL,
    issue_date DATE,
    total_value DECIMAL(12,2),
    used_value DECIMAL(12,2) DEFAULT 0,
    remaining_value DECIMAL(12,2),
    trucks_used INT DEFAULT 0
);

CREATE TABLE contracts.document_templates (
    id INT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(100) NOT NULL UNIQUE,
    template_type NVARCHAR(30),
    language NVARCHAR(5),
    description NVARCHAR(500),
    is_active BIT DEFAULT 1
);

CREATE TABLE contracts.generated_documents (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    shipment_id BIGINT NOT NULL REFERENCES export.shipments(id),
    template_id INT NOT NULL REFERENCES contracts.document_templates(id),
    document_status NVARCHAR(20) NOT NULL DEFAULT 'pending',
    generated_at DATETIMEOFFSET,
    sent_at DATETIMEOFFSET,
    generated_by BIGINT REFERENCES sys_users(id),
    file_path NVARCHAR(500),
    notes NVARCHAR(500)
);

CREATE INDEX ix_gendoc_shipment ON contracts.generated_documents(shipment_id, template_id);

CREATE TABLE contracts.firm_documents (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    firm_type NVARCHAR(20) NOT NULL,
    export_firm_id INT REFERENCES core.export_firms(id),
    import_firm_id INT REFERENCES core.import_firms(id),
    document_type NVARCHAR(50) NOT NULL,
    document_name NVARCHAR(200),
    file_path NVARCHAR(500),
    expiry_date DATE,
    uploaded_by BIGINT REFERENCES sys_users(id),
    uploaded_at DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET()
);

CREATE TABLE contracts.transport_documents (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    shipment_id BIGINT REFERENCES export.shipments(id),
    truck_head_id BIGINT,
    driver_id BIGINT,
    document_type NVARCHAR(50) NOT NULL,
    is_own_transport BIT DEFAULT 1,
    file_path NVARCHAR(500),
    verified BIT DEFAULT 0,
    verified_by BIGINT REFERENCES sys_users(id)
);


-- ████████ FINANCE MODULE ████████

CREATE TABLE finance.payment_tracking (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    export_firm_id INT NOT NULL REFERENCES core.export_firms(id),
    month DATE NOT NULL,
    amount_received DECIMAL(12,2) DEFAULT 0,
    amount_expected DECIMAL(12,2) DEFAULT 0,
    currency NVARCHAR(10) DEFAULT 'USD',
    notes NVARCHAR(500),
    created_at DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT uq_payment_firm_month UNIQUE (export_firm_id, month)
);

CREATE TABLE finance.cash_planning (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    week_start DATE NOT NULL,
    planned_income_usd DECIMAL(12,2),
    planned_expense_usd DECIMAL(12,2),
    actual_income_usd DECIMAL(12,2),
    actual_expense_usd DECIMAL(12,2),
    notes NVARCHAR(500),
    created_by BIGINT REFERENCES sys_users(id),
    created_at DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET()
);

CREATE TABLE finance.customer_ledgers (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    customer_id INT NOT NULL REFERENCES core.customers(id),
    season_id INT NOT NULL REFERENCES core.seasons(id),
    city_id INT REFERENCES core.cities(id),
    trucks_with_report INT DEFAULT 0,
    amount_reported DECIMAL(12,2) DEFAULT 0,
    trucks_without_report INT DEFAULT 0,
    amount_unreported DECIMAL(12,2) DEFAULT 0,
    trucks_in_transit INT DEFAULT 0,
    amount_in_transit DECIMAL(12,2) DEFAULT 0,
    total_outstanding DECIMAL(12,2) DEFAULT 0,
    exchange_rate DECIMAL(12,6),
    CONSTRAINT uq_ledger_customer_season UNIQUE (customer_id, season_id)
);

CREATE TABLE finance.route_profitability (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    season_id INT NOT NULL REFERENCES core.seasons(id),
    country_id INT NOT NULL REFERENCES core.countries(id),
    city_id INT REFERENCES core.cities(id),
    month DATE,
    total_shipments INT,
    total_weight_kg DECIMAL(12,2),
    total_revenue_usd DECIMAL(12,2),
    total_costs_usd DECIMAL(12,2),
    profit_usd DECIMAL(12,2),
    avg_price_per_kg DECIMAL(8,4)
);


-- ████████ GREENHOUSE MODULE ████████

CREATE TABLE greenhouse.plant_registrations (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    scan_code NVARCHAR(20),
    date DATE NOT NULL,
    block_id INT NOT NULL REFERENCES core.greenhouse_blocks(id),
    variety_id INT REFERENCES core.tomato_varieties(id),
    compartment INT,
    crop_number INT,
    line INT,
    post NVARCHAR(10),
    plant_number INT,
    leaves INT,
    trusses INT,
    new_truss_nr INT,
    total_fruits INT,
    length_pw DECIMAL(6,2),
    fruit_occupation DECIMAL(6,2),
    leaf_length DECIMAL(6,2),
    leaf_width DECIMAL(6,2),
    head_width DECIMAL(6,2),
    top_to_flower DECIMAL(6,2),
    buds_new_truss INT,
    flowers_flowering INT,
    stem_thickness_10cm DECIMAL(6,2),
    stem_thickness_mark DECIMAL(6,2),
    is_head_removed BIT DEFAULT 0,
    created_at DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET()
);

CREATE TABLE greenhouse.pest_monitoring (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    block_id INT NOT NULL REFERENCES core.greenhouse_blocks(id),
    date DATE NOT NULL,
    pest_type NVARCHAR(50) NOT NULL,
    section NVARCHAR(20),
    qr_code NVARCHAR(20),
    count INT NOT NULL,
    severity NVARCHAR(20),
    treatment_applied NVARCHAR(200),
    notes NVARCHAR(500)
);

CREATE INDEX ix_pest_block_date ON greenhouse.pest_monitoring(block_id, date, pest_type);

CREATE TABLE greenhouse.fertilizer_applications (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    block_id INT NOT NULL REFERENCES core.greenhouse_blocks(id),
    date DATE NOT NULL,
    day_of_month INT NOT NULL,
    fertilizer_name NVARCHAR(100) NOT NULL,
    amount_kg DECIMAL(10,2),
    unit NVARCHAR(10) DEFAULT 'kg',
    applied_by NVARCHAR(100),
    notes NVARCHAR(500)
);

CREATE INDEX ix_fert_block_date ON greenhouse.fertilizer_applications(block_id, date);

CREATE TABLE greenhouse.chemical_applications (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    block_id INT NOT NULL REFERENCES core.greenhouse_blocks(id),
    date DATE NOT NULL,
    day_of_month INT NOT NULL,
    chemical_name NVARCHAR(100) NOT NULL,
    amount DECIMAL(10,2),
    unit NVARCHAR(10),
    target_pest NVARCHAR(100),
    phi_days INT,
    applied_by NVARCHAR(100)
);

CREATE INDEX ix_chem_block_date ON greenhouse.chemical_applications(block_id, date);

CREATE TABLE greenhouse.irrigation_records (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    block_id INT NOT NULL REFERENCES core.greenhouse_blocks(id),
    date DATE NOT NULL,
    section NVARCHAR(20),
    solar_radiation_watt DECIMAL(10,2),
    solar_radiation_j DECIMAL(10,2),
    installed_volume_ml DECIMAL(10,2),
    installed_ec DECIMAL(6,2),
    installed_ph DECIMAL(4,2),
    drip_ml DECIMAL(10,2),
    drip_ec DECIMAL(6,2),
    drip_ph DECIMAL(4,2),
    drainage_ml DECIMAL(10,2),
    drainage_ec DECIMAL(6,2),
    drainage_ph DECIMAL(4,2),
    drainage_percent DECIMAL(5,2)
);

CREATE INDEX ix_irrig_block_date ON greenhouse.irrigation_records(block_id, date, section);

CREATE TABLE greenhouse.temperature_records (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    block_id INT NOT NULL REFERENCES core.greenhouse_blocks(id),
    date DATE NOT NULL,
    section NVARCHAR(20),
    part NVARCHAR(10),
    avg_day_temp DECIMAL(5,2),
    avg_night_temp DECIMAL(5,2),
    avg_daily_temp DECIMAL(5,2),
    min_temp DECIMAL(5,2),
    max_temp DECIMAL(5,2),
    humidity_percent DECIMAL(5,2)
);

CREATE INDEX ix_temp_block_date ON greenhouse.temperature_records(block_id, date, section);

CREATE TABLE greenhouse.fruit_weight_samples (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    date DATE NOT NULL,
    block_id INT NOT NULL REFERENCES core.greenhouse_blocks(id),
    qr_code NVARCHAR(20),
    truss_number INT,
    tomatoes_count INT,
    weight_netto_gr INT,
    weight_with_box_gr INT,
    box_weight_gr INT DEFAULT 450,
    box_count INT DEFAULT 1,
    avg_fruit_weight_gr DECIMAL(8,2)
);

CREATE INDEX ix_fruit_block_date ON greenhouse.fruit_weight_samples(date, block_id);

CREATE TABLE greenhouse.daily_harvest_records (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    date DATE NOT NULL,
    block_id INT NOT NULL REFERENCES core.greenhouse_blocks(id),
    season_id INT REFERENCES core.seasons(id),
    harvest_type NVARCHAR(20) NOT NULL,
    shipment_code NVARCHAR(20),        -- legacy text link (kept for migration)
    shipment_id BIGINT REFERENCES export.shipments(id),  -- v5.1 FIX: proper FK
    destination_country NVARCHAR(50),
    weight_kg DECIMAL(10,2) NOT NULL,
    buyer_name NVARCHAR(100),
    variety NVARCHAR(50),
    price_per_kg DECIMAL(8,2),
    waste_type NVARCHAR(50),
    created_at DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET()
);

CREATE INDEX ix_harvest_block_date ON greenhouse.daily_harvest_records(date, block_id);
-- v5.1: index for FK lookup
CREATE INDEX ix_harvest_shipment ON greenhouse.daily_harvest_records(shipment_id) WHERE shipment_id IS NOT NULL;

CREATE TABLE greenhouse.production_plans (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    season_id INT NOT NULL REFERENCES core.seasons(id),
    block_id INT NOT NULL REFERENCES core.greenhouse_blocks(id),
    month INT NOT NULL,
    planned_kg DECIMAL(12,2) NOT NULL,
    actual_kg DECIMAL(12,2),
    CONSTRAINT uq_production_plan UNIQUE (season_id, block_id, month)
);

CREATE TABLE greenhouse.gapy_satys_entrepreneurs (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(200) NOT NULL,
    contact_person NVARCHAR(100),
    phone NVARCHAR(50),
    season_id INT REFERENCES core.seasons(id),
    total_delivered_kg DECIMAL(12,2) DEFAULT 0,
    is_active BIT DEFAULT 1
);


-- ████████ SYSTEM TABLES ████████

CREATE TABLE sys_audit_log (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    user_id BIGINT REFERENCES sys_users(id),
    table_name NVARCHAR(100) NOT NULL,
    record_id BIGINT NOT NULL,
    action NVARCHAR(10) NOT NULL,
    field_name NVARCHAR(100),
    old_value NVARCHAR(MAX),
    new_value NVARCHAR(MAX),
    ip_address NVARCHAR(50),
    created_at DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET()
);

CREATE TABLE sys_notifications (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    user_id BIGINT REFERENCES sys_users(id),
    type NVARCHAR(30) NOT NULL,
    title NVARCHAR(200),
    message NVARCHAR(1000),
    reference_table NVARCHAR(50),
    reference_id BIGINT,
    is_read BIT DEFAULT 0,
    sent_telegram BIT DEFAULT 0,
    created_at DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET()
);


-- ████████ SEED DATA ████████

-- Seasons
INSERT INTO core.seasons (name, start_date, end_date, is_active)
VALUES ('2025-2026', '2025-09-01', '2026-06-30', 1);

-- Countries
INSERT INTO core.countries (name_tk, name_ru, name_en, code) VALUES
('GAZAGYSTAN', N'Казахстан', 'Kazakhstan', 'KZ'),
('RUSSIYA', N'Россия', 'Russia', 'RU'),
('OZBEKYSTAN', N'Узбекистан', 'Uzbekistan', 'UZ'),
('GYRGYSYSTAN', N'Кыргызстан', 'Kyrgyzstan', 'KG'),
('TAJIGISTAN', N'Таджикистан', 'Tajikistan', 'TJ'),
('BELARUS', N'Беларусь', 'Belarus', 'BY'),
('OWGANYSTAN', N'Афганистан', 'Afghanistan', 'AF'),
('TURKMENISTAN', N'Туркменистан', 'Turkmenistan', 'TM');

-- Shipment status types (13 steps)
INSERT INTO core.shipment_status_types (code, name_tk, name_en, name_ru, step_order, required_role, phase) VALUES
('yuklenme', N'Ýüklenme', 'Loading', N'Загрузка', 1, 'warehouse_chief', 'LOADING'),
('gumruk_girish', N'Gümrük giriş', 'Customs Entry', N'Таможня вход', 2, 'document_team', 'CUSTOMS'),
('gumruk_chykysh', N'Gümrük çykyş', 'Customs Exit', N'Таможня выход', 3, 'document_team', 'CUSTOMS'),
('yola_chykdy', N'Ýola çykdy', 'Departed', N'Выехал', 4, 'transport', 'TRANSIT'),
('serhet_tm', N'Serhet TM', 'TM Border', N'Граница ТМ', 5, 'transport', 'BORDER'),
('serhet_gechdi', N'Serhet geçdi', 'Border Crossed', N'Пересёк границу', 6, 'transport', 'BORDER'),
('barysh_gumrugi', N'Baryş gümrügi', 'Dest Customs', N'Таможня назначения', 7, 'sales_rep', 'BORDER'),
('yolda', N'Ýolda', 'In Transit', N'В пути', 8, 'sales_rep', 'TRANSIT'),
('bardy', N'Bardy', 'Arrived', N'Прибыл', 9, 'sales_rep', 'SALES'),
('satylyar', N'Satylyar', 'Being Sold', N'Продаётся', 10, 'sales_rep', 'SALES'),
('satyldy', N'Satyldy', 'Sold', N'Продан', 11, 'sales_rep', 'SALES'),
('hasabat', N'Hasabat', 'Report', N'Отчёт', 12, 'sales_rep', 'COMPLETE'),
('tamamlandy', N'Tamamlandy', 'Completed', N'Завершено', 13, 'finansist', 'COMPLETE');

-- Product types
INSERT INTO core.product_types (name) VALUES
('Pomidor'), ('Bolgar burç'), ('Badamjan'), ('Hyyar');

-- Tomato varieties
INSERT INTO core.tomato_varieties (name, type) VALUES
('Defensiosa', 'Salkym'), ('Midelyce', 'Salkym'), ('Mahitos', 'Salkym'),
('Torero', 'Salkym'), ('Meralice', 'Salkym'), ('Cherry', 'Cherri');

-- Border points
INSERT INTO core.border_points (name, route_description, typical_transit_days) VALUES
('Farap', 'Land route: TM → UZ → KZ', 3),
('Sarahs', 'Land route: TM → Iran border', 2),
('Garabogaz', 'Caspian ferry: TM → KZ → RU', 5),
('Bekdas', 'Northern route', 4),
('Dasoguz', 'Northern land route', 3);

-- Loading locations
INSERT INTO core.loading_locations (name) VALUES ('Dusak'), ('Kaka'), ('Owadandepe');

-- Document templates
INSERT INTO contracts.document_templates (name, template_type, language) VALUES
('CMR_RU', 'transport', 'RU'), ('CMR_EN', 'transport', 'EN'),
('Invoice_RU', 'financial', 'RU'), ('Invoice_EN', 'financial', 'EN'),
('TIR_CARNET', 'customs', 'EN'), ('Customs_Declaration', 'customs', 'RU'),
('Fito_Certificate', 'certificate', 'RU'), ('Letter_CT1', 'certificate', 'RU'),
('Gross_Net', 'transport', 'TK');

-- Greenhouse blocks (15 blocks)
INSERT INTO core.greenhouse_blocks (code, name, variety_main, area_m2, location) VALUES
('A', N'A-Ýyladyşhana', 'Midelyce', 93171, 'Dusak'),
('B', N'B-Ýyladyşhana', 'Defensiosa', 95897, 'Dusak'),
('C', N'C-Ýyladyşhana', 'Mahitos', NULL, 'Dusak'),
('D', N'D-Ýyladyşhana', 'Defensiosa', NULL, 'Dusak'),
('E', N'E-Ýyladyşhana', 'Torero', NULL, 'Dusak'),
('F', N'F-Ýyladyşhana', 'Defensiosa', NULL, 'Dusak'),
('G', N'G-Ýyladyşhana', 'Meralice', NULL, 'Dusak'),
('H', N'H-Ýyladyşhana', 'Defensiosa', NULL, 'Dusak'),
('I', N'I-Ýyladyşhana', 'Defensiosa', NULL, 'Dusak'),
('J', N'J-Ýyladyşhana', 'Midelyce', NULL, 'Dusak'),
('K', N'K-Ýyladyşhana', 'Defensiosa', NULL, 'Kaka'),
('L', N'L-Ýyladyşhana', 'Defensiosa', NULL, 'Kaka'),
('M15', N'M15-Ýyladyşhana', 'Defensiosa', NULL, 'Dusak'),
('M5', N'M5-Ýyladyşhana', 'Mahitos', NULL, 'Dusak'),
('O', N'O-Ýyladyşhana', 'Defensiosa', NULL, 'Owadandepe');

PRINT 'YGT Platform database schema v5.1 created successfully.';
GO


/*
████████ v5.1 CHANGE LOG ████████

Status-to-timestamp mapping (reference for transition_to() method):
  yuklenme       → loading_started_at
  gumruk_girish  → customs_entry_at
  gumruk_chykysh → customs_exit_at
  yola_chykdy    → departed_at
  serhet_gechdi  → border_crossed_at
  bardy          → arrived_at
  satylyar       → sale_started_at
  satyldy        → sale_ended_at
  (serhet_tm, barysh_gumrugi, yolda, hasabat, tamamlandy → no dedicated column, logged in status_log only)

Django migration notes:
  - sys_users: Replace with AbstractUser extension. password_hash column handled by Django.
  - sys_users.managed_blocks: Remove. Use greenhouse_blocks.manager_id FK instead.
  - shipment_status_types.required_role: Keep for DB reference. Python TRANSITIONS dict handles multi-role.
  - vehicle_status_note: Migrate existing data to shipment_comments, then drop column.
*/
