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
**2026-05 amendment (final)**: AD-1 is retired. Every lifecycle timestamp — `loading_started_at` (R19), `departed_at` (R21), `customs_exit_at` (R25), `border_crossed_at` (R30), `customs_entry_at` (R32), `arrived_at` (R35), `sale_started_at` (R41), `sale_ended_at` (R42) — is operator-entered on the Sheet (`input_type='datetime'`). `STATUS_TIMESTAMP_MAP` is empty; `transition_to()` still updates `status` + `status_changed_at` but no longer stamps any column. `ShipmentPatchSerializer` accepts all eight. Practical reason: warehouse / transport / document / sales staff fill these from physical events (gate stamp, door closed, customs receipt, sale concluded) that don't line up with the moment they click "Next status" — they need the actual time, not `timezone.now()`. The original AD-1 staleness mitigation ("single write path via transition_to()") is gone; data quality now depends on operators filling the cells correctly. Downstream readers (boss analytics' "loaded today", transit-day calculations) will see null for timestamps an operator hasn't filled yet.

## ADR-011: R15 Replacement (AD-2)
**Decision**: Kill `vehicle_status_note` free-text field. Replace with `vehicle_condition` (enum: OK/ISSUE/BREAKDOWN/RETURNED), `vehicle_condition_note`, `route_note`. Freeform notes go to `shipment_comments` table.
**Context**: R15 field degrades into notepad used by everyone with no attribution.
**Consequences**: Structured, queryable vehicle data. Comments system with @mentions and threading. Old R15 data migrates as first comment per shipment.

## ADR-015: Cell-Anchored Comments + Tasks
**Decision**: Extend `export.shipment_comments` with: `field_key` (cell anchor; NULL = shipment-level), `role_mentions` (CSV separate from user-ID `mentions`), and task fields `assignee`/`is_done`/`done_at`/`done_by`. Mentions fan out into the existing `Notification` model (extended with `mention`, `task_assigned`, `task_done` kinds). Sidebar UI is a right-side `Drawer` on the [[../docs/obsidian/screens/shipment-sheet|Sheet]] — not a permanent Splitter pane.
**Context**: AD-2 (ADR-011) created the `shipment_comments` table but kept comments shipment-level. Operational reality from the Sheet (rows × shipment-columns) needs comments pinned to specific cells (e.g. "wrong weight on R32") and the ability to turn a comment into a single-assignee task without spinning up a separate task service.
**Decisions locked with users (Apr 2026)**:
1. Cell mentions are **both** anchor (pin to cell, sidebar filters by selected cell) and reference (`#cell:fieldKey` token in body renders as a clickable chip).
2. Role mentions notify **every active member of the role, deduped** with explicit user mentions — one notification per recipient per comment.
3. **Tasks live on root comments only**, single assignee. Replies inherit parent's `field_key` and cannot have their own assignee.
4. Sidebar is a **toggle Drawer** (not a Splitter) — the Sheet is column-dense; permanent horizontal real-estate loss is unacceptable.
**Consequences**: One model, no separate `Task` table. CSV pattern for `role_mentions` mirrors existing `mentions` (MSSQL-safe per ADR-001). Notification fan-out is a single `bulk_create(batch_size=500)` per comment — see `apps/export/services/comments.py`. Polling cadence stays at 30s (no WebSockets — see ADR-008 for the no-cloud constraint). The legacy `POST /shipments/{id}/comment/` action delegates to the new service so callers don't break. Deep-link format `/export/shipments/sheet?shipment=&row=&comment=` is canonical for all three new notification kinds. Resolution / multi-assignee tasks / file attachments / WebSockets are explicitly **out of scope** for v1.

## ADR-012: Weekly Plan 12 Columns (AD-3)
**Decision**: `export.weekly_harvest_plans` keeps 12 columns (monday_plan_kg through saturday_actual_kg). Not normalized to rows per day.
**Context**: 15 blocks x 6 days entered once weekly. Simplicity wins.
**Consequences**: Fast 15x6 grid rendering. Sunday support = add 2 columns via migration if needed.

## ADR-013: Explicit Services, Not Signals
**Decision**: Cross-app business logic uses explicit service calls, not Django signals.
**Context**: Signals are implicit, hard to debug, fail silently.
**Consequences**: Slightly more boilerplate but fully traceable execution.

## ADR-014: DRAFT Shipment Status (Pre-Lifecycle Step 0)
**Decision**: Add a `draft` row to `ShipmentStatusType` with `step_order=0`. A shipment with `status=draft` has block_sources and total weight fixed, but country/customer/city left null. Soltanmyrat (warehouse_chief) creates drafts; Gadam (export_manager) transitions `draft → yuklenme` via `POST /shipments/{id}/assign/`, which writes AD-1 `loading_started_at` through `transition_to()`.
**Context**: Kaka site visit (Apr 2026) revealed shipment creation is inherently two-person, two-moment: Phase 1 (Soltanmyrat ~9–10am) fixes supply composition without destination context; Phase 2 (Gadam ~10–11am) matches drafts to contracts/quotas/waiting customers. A single-form design forces one role to fabricate the other's data. `ShipmentBlockSource` already supported multi-block composition — only a new status and a dedicated assign endpoint were missing.
**Consequences**: Two-phase creation matches operational reality. `draft` has no AD-1 timestamp (lifecycle timestamps still start at `yuklenme`, preserving AD-1). Existing `ShipmentList`/`KanbanBoard`/filters are unaffected — draft shipments appear in any `?status=draft` query but are hidden from the default lifecycle Kanban by excluding that status. Does not address Findings #3 (variety-at-packaging), #4 (pallet manifest + weight_master), #5 (Soltanmyrat 5-function role + truck dispatch), #6 (received-weight productivity) — tracked separately.

## AD-15: System admin role separated from director / export_manager
**Decision**: A new top-tier `admin` role owns system-administrator capabilities only — managing the permission matrix (`/api/v1/core/admin/page-permissions/`, `resource-permissions/`, `field-permissions/`, `permission-registry/`) and managing users (`PATCH users/{id}/`, `PUT users/{id}/permissions/`). `director` and `export_manager` retain every operational capability they had before — full CRUD on shipment / quota / plan / price / report resources, wildcard `*` field edits, reference-data writes (countries, cities, customers, blocks, etc.) — and lose only the admin pages. A last-admin guard prevents demoting or deactivating the only active admin in the system. Admin promotion is operator-driven via `python manage.py bootstrap_admin` (idempotent, promotes every `is_superuser`); no auto-promotion data migration runs across environments.
**Context**: Pre-AD-15 the closest thing to a system administrator was `director`, hardcoded into `_DirectorOnlyPermission` and into reference-data writes in `core/views.py` and `greenhouse/views_admin.py`. `export_manager` was seeded with near-admin power: full CRUD on every resource, wildcard field edits, and the `admin.permissions` page in its default visibility set (the backend rejected saves but the page was reachable). The user (system administrator / developer) wanted to be the sole permission-editing principal while keeping a separate operational coordinator (`export_manager`) and the company owner (`director`) below the admin tier. Reference-data writes are operational, not administrative — adding a new customer or city should not require waking the admin.
**Consequences**: Future contributors must not gate operational capabilities behind `_ADMIN_ONLY` — only permission-matrix / user-management endpoints belong there. `REFERENCE_DATA_WRITE = frozenset({'admin', 'director', 'export_manager'})` is the canonical reference-data gate; expanding it (e.g. adding a new operational role that needs to create customers) requires updating one constant. The data migration `0016_demote_existing_director` removes the seeded admin.* rows from director and admin.permissions from EM — this runs automatically on every `migrate` so existing environments inherit the new behaviour without manual intervention. `seed_permissions` is non-destructive (`get_or_create`) — re-running it adds new admin rows but does NOT undo the migration's deletes. Director keeps the hardcoded sheet-cell trigger-gate immunity in `permissions.py:can_edit_sheet_field` (operational lead must remain immune to `SheetRowSetting` triggered_role locks); admin is added alongside, not replacing. `IsBossOrDirector` includes admin despite the name; rename filed as a follow-up. `loading_dept_head` is intentionally absent from `apps/export/services/comments.py:_VALID_ROLES` — pre-existing inconsistency, separate cleanup.

## ADR-016: Official vs Real Truck Weight (Firm Splits)
**Decision**: `ShipmentFirmSplit.weight_kg` is the **OFFICIAL** kg per firm written on export documents — it is **not** the real truck weight. The official cap is 18,100 kg per truck. Real trucks carry 20,000–21,000 kg, but the cap is what regulators see, so the cap is what the platform persists. The per-firm-count split is admin-configurable via the `TruckSplitDefault` model (defaults: 1→18,100 · 2→9,000 · 3→6,000), edited at `/admin/shipment-settings → Truck Split Defaults`. The `set_firm_splits` action endpoint auto-fills `weight_kg` from this table when the client omits it. `ShipmentBlockSource.weight_kg` follows a different rule — it splits the **real** `Shipment.weight_net` evenly (last entry takes the remainder), because blocks track real harvest contribution, not regulatory paperwork.
**Context**: User confirmed (Apr 2026) that the platform's previous behaviour — frontend hardcoding `weight_kg: 0` on the Sheet's R8/R9 multiselect — was breaking every Sum-of-block-weight aggregation in the Boss dashboard. The fix needed two distinct rules because the two cells have different meanings: blocks are real, firms are regulatory. The `get_default_truck_weight()` helper already encoded the firm rule for `QuotaUsageRecord` auto-creation but was hardcoded in Python; the requirement was to make it admin-editable without a deploy.
**Consequences**: Future contributors must not "fix" the gap between `Sum(firm_splits.weight_kg)` ≈ 18,100 and the real `Shipment.weight_net` ≈ 18,500–21,000 — that gap is intentional. `get_default_truck_weight(N)` now reads from `TruckSplitDefault` with a 5-min cache; admin saves invalidate via `invalidate_truck_split_cache()`. Director gets full CRUD on `truck_split_default`; export_manager is read-only. Existing client code that explicitly sends `weight_kg` is honoured (admin override path). A new `truck_split_default` resource is added to `permission_registry.py` and seeded in `seed_permissions`. Replaces the previous hardcoded `DEFAULT_TRUCK_WEIGHTS` Python dict.


## ADR-017: Daily-Grain `HarvestDayEntry` (supersedes ADR-012)
**Decision**: The daily harvest data — Plan, Forecast, Actual — moves from twelve wide columns on `WeeklyHarvestPlan` (`monday_plan_kg` … `saturday_actual_kg`) into a daily-grain table `export.harvest_day_entries`, one row per `(weekly_plan, entry_date)`. Each row holds `plan_value` / `forecast_value` / `actual_value` plus per-layer audit columns: `*_submitted_at`, `*_submitted_by`, `plan_state`, `forecast_window`, `forecast_revision_count`, `actual_finalized_at`, `actual_source`, `last_override_at` / `_by` / `_reason`. `weekday` allows 0–6 so end-of-season Sunday harvesting is supported. `WeeklyHarvestPlan` survives as the per-week submission container (id, season, block, week_number, year, submitted_at, submitted_by, locked_at, entered_by, created_at, updated_at) — the approval workflow (status / approved_at / approved_by / rejected_at / rejected_by / rejection_note) is removed.

**Context**: ADR-012 chose 12 wide columns "for fast 15×6 grid rendering" with the explicit note that "Sunday support = add 2 columns via migration if needed". The Forecast Layer feature (Apr 2026) needed three values per cell (Plan, Forecast, Actual) plus per-cell audit fields (timestamps, submitters, submission-window state, revision counts) so that historical data needed for KPIs is captured from day one. Extending the wide-column design would add 60+ columns to the table; the alternative — JSONField — is forbidden per ADR-001 (MSSQL). A daily-grain row matches the per-cell audit requirement directly and makes the cell-history modal a simple key lookup. The user also chose "remove approval workflow — submission is final" and "atomic cutover migration", so the wide columns and approval fields ship out in the same migration that introduces the new table.

**Consequences**: ADR-012 is superseded. Future contributors must not "optimize" by re-flattening to wide columns — the audit fields cannot fit. Plan vs. Forecast vs. Actual semantics are decoupled per cell: empty (`value IS NULL`) renders as em-dash; explicit zero (`value = 0 AND *_submitted_at IS NOT NULL`) renders italic with confirmation indicator. `plan_state` (`on_time` / `late` / `critical_late`) is computed by `compute_plan_state(submitted_at, plan_week_start, config)` from `GreenhouseConfig`-driven deadlines; `forecast_window` (`primary` / `fallback` / `same_day_red_flag`) is computed by `compute_forecast_window(submitted_at, entry_date, config)`. Admin overrides (with required `reason`) write to `AuditLog` AND to the `last_override_*` snapshot for fast cell-history modal access. Time-based notification dispatch runs via `python manage.py run_harvest_dispatcher` from system cron every 5 minutes, idempotent via `HarvestDispatchLog(trigger_kind, target_user, scope_date)` UNIQUE — chosen over Celery+Redis (overkill for ≤90 trigger events/day) and Django-Q2 (introduces a queue concept nothing else needs yet); revisit when pallet rollup arrives. The personal kanban auto-task hook is a TODO no-op call site in the dispatcher — the five harvest auto-task rules land in a follow-up commit when the parallel kanban work ships. `truck_capacity_kg` (was hardcoded 18,500 in frontend) moves to `GreenhouseConfig` so it's admin-tunable without a deploy. Existing data backfill (greenhouse migration `0004`): explodes 333 weekly rows into 1,998 day-entry rows, preserving the "never entered" semantic by leaving `plan_value=NULL` where the wide column was 0 AND `submitted_at IS NULL` (257 NULL / 1,741 valid). KPI computation is deferred to a later phase but every audit field needed is captured from day one.
