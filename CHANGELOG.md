# Changelog

All notable changes to the YGT Platform.

## [Unreleased]

### Added
- Shipment model (DDL v5.1 `export.shipments`) with all fields: AD-1 timestamps, AD-2 vehicle_condition, 13-step status FK (feat(p3))
- ShipmentStatusLog, ShipmentFirmSplit, ShipmentBlockSource, ShipmentComment models (feat(p3))
- Customer core reference model with read-only API endpoint (feat(core))
- `transition_to()` service — sole write path for status + AD-1 timestamps; enforces TRANSITIONS dict (feat(p3))
- Shipment list + detail serializers with API-contract field names (cargo_code, weight_net) (feat(p3))
- ShipmentViewSet: paginated list, detail, POST transition/ with role-based 403 guard (feat(p3))
- ShipmentList page: ProTable, All/My Work toggle, status filters, StatusTag colour mapping (feat(frontend))
- useShipments TanStack Query hook with VITE_USE_MOCK toggle (feat(frontend))
- StatusTag component mapping all 13 status names to Ant Design Tag colours (feat(frontend))
- 10 transition service tests: lifecycle, AD-1 timestamp, invalid transitions, log entries (test(p3))

### Changed
- `schema_table()` helper added to db_utils — all model db_table values now use MSSQL schema-qualified format `"schema"."table"` (SQLite fallback: `schema_table`) (fix(core))
- All Cyrillic text fields in Shipment models now use `cyrillic_collation()`: vehicle_condition_note, route_note, notes, ShipmentComment.content (fix(p3))
- ShipmentViewSet restricted to GET/POST only; permission_classes = [IsAuthenticated] (fix(p3))

### Fixed

### Data

---

## [0.0.1] - 2026-03-27 (Phase 0 — Scaffold)

### Added
- Django 5.1 project: config, MSSQL settings, CORS, JWT httpOnly cookies (feat(core))
- Core models: User, ShipmentStatusType (13 steps), ExportFirm, Country, City,
  GreenhouseBlock, BorderPoint, LoadingLocation, ImportFirm, Season + initial migration (feat(core))
- Auth API: POST /api/v1/auth/login/, POST /logout/, GET /me/ with CookieJWT (feat(core))
- Core read-only API: countries, export-firms, status-types viewsets (feat(core))
- `seed_data` management command loads all DDL v5.1 reference data (13 statuses, 8 countries, 15 blocks) (feat(core))
- React 18 + Vite + TypeScript frontend scaffold: App, AppLayout (sidebar), LoginPage, DashboardPage (feat(frontend))
- TanStack Query, Zustand authStore, Axios with httpOnly cookie + CSRF support (feat(frontend))
- ProtectedRoute with role-based access guard (feat(frontend))
- Docker Compose: MSSQL 2022 (Cyrillic_General_CI_AS), Redis, backend, frontend, nginx (chore(docker))
- USE_SQLITE=true env flag for local dev without MSSQL ODBC driver (chore)
