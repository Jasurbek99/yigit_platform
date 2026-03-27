# Sprint Plan — P3 Export MVP

## Phase 0: Foundation (Week 1)
- Docker Compose: Django + React + MSSQL + Redis + Nginx
- Django scaffold: `config/`, `apps/core/`, `apps/export/`
- Core models: User (AbstractUser), ShipmentStatusType, ExportFirm, Country, City
- Load DDL v5.1 seed data
- React scaffold: Vite + Ant Design + Router + Login page
- Done: `docker-compose up` works, seed data queryable

## Sprint 1: Data Import + List (Weeks 2-4)
- Shipment model matching DDL v5.1 (with AD-1 timestamps, AD-2 structured fields)
- Excel import: Export_contracts → 1,959 shipments + firms + customers
- Block reference data from Pomidor_Dükany
- **ShipmentList** page: ProTable with search, sort, 6 filters, "All / My work" toggle
- **ShipmentDetail** page: tabs (General, Firms, Timeline, Block Sources, Quality, Comments)
- JWT auth with httpOnly cookies, 3 test users
- Done: browse all shipments, filter by status/firm/country

## Sprint 2: Lifecycle + CRUD (Weeks 5-7)
- **ShipmentCreate**: step-by-step form
- Status transition API with `transition_to()` + AD-1 timestamp writes
- **KanbanBoard**: 4-5 phase columns, drag-and-drop transitions
- **SalesReportForm**: price, weight, expenses (blocks closing without report)
- **OverdueReports**: shipments >7 days without hasabat
- **QualityInspection**: 4 doc checkboxes + inspection data
- **AdvancesTracker**: Babageldi's batch advances linked to shipments
- **CommentThread**: @mentions, threading, replaces R15
- Done: full lifecycle from loading to completed

## Sprint 3: Planning + Quotas (Weeks 8-9)
- **WeeklyPlanGrid**: 15 blocks x 6 days (12-column layout)
- **TruckForecast**: planned ÷ 18,500 = trucks, RU/KZ/Gapy split
- **QuotaDashboard**: 24 firms, progress bars, 80/90/95% warnings
- **PricePanel**: 1,557-entry price DB, 7-day trend, year-over-year
- **BlockSummary** + **DomesticSales**
- Done: Gadam can plan the week end-to-end

## Sprint 4: Permissions + Polish (Weeks 10-12)
- Role-based field visibility (`editable_fields[]` per role)
- Audit log (sys_audit_log)
- Notifications (bell icon + polling, Telegram deferred)
- Mobile optimization for phone/tablet screens
- Settings/admin CRUD
- Reports/export (Excel/PDF download)
- Done: MVP deployable, each role sees only their fields

## Definition of done (per feature)
- Django model matching DDL v5.1 with migration tested on MSSQL
- DRF endpoint following api-contract.md
- TypeScript types matching API response
- Mock data with Turkmen names and edge cases
- React page with loading/error/empty states
- Tests for business logic
- Code review via `reviewer` agent
