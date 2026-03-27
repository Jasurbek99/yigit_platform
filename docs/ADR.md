# Architecture Decision Records

## ADR-001: MSSQL Database
**Decision**: Use MSSQL via `mssql-django`. Required for Logo Tiger ERP compatibility.
**Consequences**: No JSONField/ArrayField, no DISTINCT ON, 2,100 param limit. Workarounds in `mssql-compat.md`.

## ADR-002: Shared Core App
**Decision**: `core/` Django app holds shared reference models. All other apps import from core, never reverse.
**Consequences**: core/ changes affect all modules. Core models should be stable.

## ADR-003: Status Machine via FK + Log Table
**Decision**: `status_id` FK on shipment + `shipment_status_log` audit table. Transitions via `transition_to()` method. Transition rules in Python TRANSITIONS dict (DB `shipment_status_types` for reference data only).
**Consequences**: Single source of truth. Full audit history. Business logic centralized.

## ADR-004: API-First Design
**Decision**: Every feature has a REST API. React frontend is one consumer. Mobile CRM will reuse same API.

## ADR-005: Mock Data Development Mode
**Decision**: `VITE_USE_MOCK=true` flag. Frontend hooks return mock data from `src/mock/`.

## ADR-006: Ant Design 5 + ProTable
**Decision**: Ant Design 5 for all UI. ProTable for data tables. Enterprise data-heavy use case.

## ADR-007: TanStack Query for Server State
**Decision**: TanStack Query for API data. Zustand only for UI state (sidebar, locale, filters).

## ADR-008: Docker Compose Deployment
**Decision**: 5 services: Django, React (Nginx), MSSQL, Redis, Nginx. Company server, no cloud.

## ADR-009: httpOnly Cookie Authentication
**Decision**: JWT stored in httpOnly cookie, not localStorage. Backend sets cookie with `httpOnly=True, Secure=True, SameSite=Lax`. CSRF token on mutations.
**Context**: Sales reps in KZ/RU use public networks. httpOnly cookies cannot be stolen via XSS.
**Consequences**: Frontend never touches the token. Need CSRF protection. Mobile CRM will need separate token flow.

## ADR-010: Denormalized Timestamps (AD-1)
**Decision**: 8 timestamp columns on `export.shipments` (`loading_started_at` through `sale_ended_at`). Written ONLY by `transition_to()`, never directly.
**Context**: List views need departure/arrival dates without joining to status_log.
**Consequences**: Fast list queries. Small staleness risk (mitigated by single write path via `transition_to()`).

## ADR-011: R15 Replacement (AD-2)
**Decision**: Kill `vehicle_status_note` free-text field. Replace with `vehicle_condition` (enum: OK/ISSUE/BREAKDOWN/RETURNED), `vehicle_condition_note`, `route_note`. Freeform notes go to `shipment_comments` table.
**Context**: R15 field degrades into notepad used by everyone with no attribution.
**Consequences**: Structured, queryable vehicle data. Comments system with @mentions and threading. Old R15 data migrates as first comment per shipment.

## ADR-012: Weekly Plan 12 Columns (AD-3)
**Decision**: `export.weekly_harvest_plans` keeps 12 columns (monday_plan_kg through saturday_actual_kg). Not normalized to rows per day.
**Context**: 15 blocks x 6 days entered once weekly. Simplicity wins.
**Consequences**: Fast 15x6 grid rendering. Sunday support = add 2 columns via migration if needed.

## ADR-013: Explicit Services, Not Signals
**Decision**: Cross-app business logic uses explicit service calls, not Django signals.
**Context**: Signals are implicit, hard to debug, fail silently.
**Consequences**: Slightly more boilerplate but fully traceable execution.
