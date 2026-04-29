# Changelog

All notable changes to the YGT Platform.

## [Unreleased]

### Added
- **Truck split defaults — admin-configurable official kg-per-firm table** (Gap 7, ADR-016) (feat(p3))
  - New `TruckSplitDefault` model (`backend/apps/export/models/quota.py`) keyed by `num_firms`; migration `0023_truck_split_defaults` seeds (1 → 18,100), (2 → 9,000), (3 → 6,000)
  - `get_default_truck_weight(N)` now reads from the DB with a 5-min cache; `invalidate_truck_split_cache()` helper
  - Director-only CRUD endpoints `/api/v1/export/admin/truck-splits/` (`TruckSplitDefaultViewSet` + `TruckSplitDefaultSerializer`); new `truck_split_default` resource registered in `permission_registry.py` and seeded so director gets full CRUD, export_manager read-only
  - New "Truck Split Defaults" tab on `/admin/shipment-settings` (`TruckSplitsTab.tsx`); hooks `useTruckSplits`, `useCreateTruckSplit`, `useUpdateTruckSplit`, `useDeleteTruckSplit` in `useAdmin.ts`
  - i18n: new `truck_split.*` namespace + `shipment_settings.tab_truck_splits` in tk/ru/en
  - 6 new sheet tests + 10 admin CRUD tests (`tests_truck_split_admin.py`); covers auto-fill, fallback, explicit override, cache invalidation, role gates, validation
  - ADR-016 documents the official-vs-real distinction so future contributors don't try to "fix" the gap between `Sum(firm_splits.weight_kg) ≈ 18,100` and the real `Shipment.weight_net ≈ 18,500–21,000` — that gap is intentional

### Fixed
- **Sheet R8/R9 multiselect saved `weight_kg = 0`** (Gap 7) — selecting blocks/firms in the multiselect cells now persists correct weights (feat(p3))
  - Frontend (`SheetCellEditor.tsx`) drops the hardcoded `weight_kg: 0` literal; sends only IDs
  - Backend `set_block_sources` auto-fills with `(weight_net or 18,100) / N`, last entry takes the rounding remainder
  - Backend `set_firm_splits` auto-fills with the OFFICIAL `TruckSplitDefault[N]` value (capped at 18,100 — see ADR-016)
  - Explicit non-zero `weight_kg` from the client is honoured (admin override path)
  - Updated Obsidian doc `screens/shipment-sheet.md` with the new auto-split behaviour and link to the admin tab

### Added
- **Configurable freeze panes on the Shipment Sheet** — Google Sheets-style freeze for both rows and columns (feat(frontend))
  - `Freeze` dropdown in `SheetToolbar` with row/column options (No, 1, 2, Up to current, Default 13 rows)
  - State in `sheetStore` (`frozenRowCount`, `frozenColCount`) persisted to `localStorage` under `ygt-sheet-freeze`
  - Frozen data columns rendered as `position: sticky; left: <offset>` cells between the label band and the virtualizer; remaining shipments are passed to `@tanstack/react-virtual`
  - Header row's left labels (`#`/Who/Field name) are now sticky-left so they stay visible during horizontal scrolling — fixes a long-standing bug where they would scroll out of view
  - Blue 2px line on the trailing edge of the last frozen row/column marks the freeze boundary; freeze counts clamp against visible rows/columns each render so stale localStorage values still produce a coherent layout
  - i18n: 14 new `sheet.freeze.*` keys added to all three locales

- **Comment + task system (backend)** — cell-anchored threaded comments with @user / @role mentions and single-assignee task assignment on `export.shipment_comments`. New fields: `field_key`, `role_mentions`, `assignee`, `is_done`, `done_at`, `done_by`, `is_deleted`. Indexes: `ix_comments_shipment_field`, `ix_comments_assignee_open`. Migration `0021_comment_cells_tasks` (feat(p3))
- `Notification.KIND_CHOICES` extended with `mention`, `task_assigned`, `task_done` (feat(p3))
- `apps/export/services/comments.py` — `create_comment()`, `mark_task_done()`, `reopen_task()`, `_fan_out_notifications()` service layer; all mutations wrapped in `transaction.atomic()`, bulk_create with `batch_size=500` (feat(p3))
- `CommentViewSet` at `GET/POST /api/v1/export/comments/` + `PATCH/DELETE /{id}/` + `POST /{id}/done/` + `POST /{id}/reopen/`. Filters: `shipment`, `field_key`, `assignee` (accepts `me`), `is_done`, `parent_comment=null`. Soft-delete via `is_deleted=True` (feat(p3))
- `CommentSerializer` (read) extended with `field_key`, `assignee`, `assignee_name`, `is_done`, `done_at`, `done_by_name`, `mentions_ids`, `role_mentions_list`, `replies_count`, `is_deleted`. `CommentCreateSerializer` (write) with int ID fields to avoid DRF PrimaryKeyRelatedField queryset=None issue on MSSQL (feat(p3))
- `GET /api/v1/export/shipments/sheet/` response now wraps `results` array with `comment_counts` and `task_counts` top-level dicts (keyed by shipment_id) — three extra queries, no N+1 (feat(p3))
- `GET /api/v1/core/users/mentionable/?q=&limit=10` — mixed users+roles autocomplete endpoint for the @mention popover (feat(p3))
- `MentionUserSerializer`, `MentionRoleSerializer` serializer classes (feat(p3))
- `SHEET_FIELD_KEYS` frozenset in `services/comments.py` (42 keys, derived from `sheetRowConfig.ts`) — field_key allowlist validation (feat(p3))
- 11 backend tests in `apps/export/tests_comments.py` covering: user mention creates notification, role mention deduplication, assignee gets task_assigned only, reply inherits field_key, task done idempotent, bulk_create batch_size check, legacy endpoint backward compat (test(p3))
- `IShipmentSheetResponse`, `ISheetCommentCounts`, `ISheetTaskCounts` TypeScript interfaces in `frontend/src/types/index.ts` (feat(frontend))
- **Comment + task system (frontend)** — right-side `CommentsDrawer` on `/export/shipments/sheet` (`mask=false`, 360px) with filter chips (This cell / All cells / My tasks), composer with `@`/`#` mention popovers, cell-anchor toggle, and single-assignee task picker (feat(frontend))
- New components under `frontend/src/components/sheet/`: `CommentsDrawer`, `CommentList`, `CommentItem`, `CommentComposer`, `MentionPopover`, `CommentMarker` — no mention library, custom popover in ~80 lines per `mssql-compat.md` "no heavy deps" stance (feat(frontend))
- `useComments(filters)`, `useCreateComment`, `useUpdateComment`, `useDeleteComment`, `useMarkTaskDone`, `useReopenTask` hooks with `staleTime: 30_000` (matches notification polling). Mutations invalidate `['comments']` and `['sheet']` so per-cell markers refresh (feat(frontend))
- `useMentionable(query)` debounced (150ms) autocomplete hook hitting `/api/v1/core/users/mentionable/` (feat(frontend))
- `CommentMarker` overlay in `SheetCell` corners — blue (comment), orange (open task), green (done task); click opens drawer filtered to that cell (feat(frontend))
- Comments button in `SheetToolbar` with badge showing total open tasks assigned to me (feat(frontend))
- `ShipmentSheet.tsx` deep-link parser — `?shipment=&row=&comment=` selects the cell, opens the drawer, scrolls comment into view with a 2s highlight ring (feat(frontend))
- Mention chip renderer in `CommentItem` parses `@user:42` / `@role:X` / `#cell:Y` tokens via regex and renders clickable Tags (feat(frontend))
- `KIND_COLOR` map in `AppLayout.tsx` extended with `mention` (#1677ff blue), `task_assigned` (#fa8c16 orange), `task_done` (#52c41a green) (feat(frontend))
- Zustand `sheetStore` extended with `commentsDrawerOpen`, `commentsFilter`, `pendingHighlightCommentId` + `openCommentsForCell(shipmentId, fieldKey)` action (feat(frontend))
- Mock data at `frontend/src/mock/comments.ts` for `VITE_USE_MOCK=true` mode (feat(frontend))
- `comments.*` namespace keys (24 keys: title, compose_placeholder, pin_to_cell, mark_done, reopen, mention_user, mention_role, mention_cell, role_member_count, filter_*, tab_*, etc.) added to all three locale files simultaneously per the strict i18n rule (feat(frontend))
- `notifications.kind_mention`, `notifications.kind_task_assigned`, `notifications.kind_task_done` keys (feat(frontend))

### Changed
- `useShipmentSheet` hook updated to unpack wrapped `{results, comment_counts, task_counts}` response; returns `{shipments, comment_counts, task_counts}` — breaks old `data[i]` access pattern (feat(frontend))
- `ShipmentSheet.tsx` updated to read `data?.shipments` from the new hook return shape (feat(frontend))
- `SheetCell.tsx` R17/R18 click handler now opens the Comments Drawer (filtered by role) instead of navigating away to `ShipmentDetail?tab=changes` — keeps users in the Sheet workflow (feat(frontend))
- `TestLegacyCommentEndpoint` test: `is_superuser=True` on test user to bypass `DynamicResourcePermission` in integration test (fix(p3))

### Fixed
- **i18n key collision (blocker)** — `comments.*` namespace was duplicated in `en.json`/`ru.json`/`tk.json` (legacy 4-key block at line 436 + new 24-key block); JSON parsers keep the last occurrence so the legacy `placeholder`/`toast_success`/`toast_error` keys silently dropped, breaking the existing `ShipmentDetail` Comments tab in production. Merged both blocks into the new namespace and kept the legacy keys (fix(frontend))
- **Race condition in `mark_task_done`** — two concurrent requests could both pass the `is_done=False` guard before either saved, creating duplicate `task_done` notifications. Added `select_for_update()` re-read at the top of the transaction (fix(p3))
- **N+1 in `MentionableView`** — per-role `User.objects.filter(role=code).count()` ran 12 times per autocomplete keystroke. Replaced with a single grouped `.values('role').annotate(Count('id'))` query (fix(p3))
- **`reopen` action lacked admin bypass** — directors couldn't reopen tasks they didn't author and weren't assigned to, unlike `done`/`edit`/`delete` which all had `PRIVILEGED_ROLES` bypass. Added matching bypass to `reopen` (fix(p3))
- **`replies_count` inconsistency** — viewset's `prefetch_related('replies')` didn't filter `is_deleted=False` while the fallback branch did, so list-view counts diverged from detail-view counts. Switched to `Prefetch('replies', queryset=ShipmentComment.objects.filter(is_deleted=False))` (fix(p3))
- **Mention chips rendered raw token text** — `@user:42` displayed as the literal token because `CommentSerializer` returned `mentions_ids` (IDs only). Renamed serializer field to `mentions_users: [{id, name, role}]` and `role_mentions_list: [{code, label}]`; `CommentItem` now renders chips with the user's display name and role's translated label (fix(p3) + fix(frontend))
- **Toolbar Comments button opened an empty drawer** — button only toggled `commentsDrawerOpen`, never seeded `commentsShipmentId`, so the composer was disabled and no comment ever got a `field_key` (which is why no cell markers showed). New `toggleCommentsDrawer` store action prefills shipment + filter from `activeCell` when opening (fix(frontend))
- **Cell click did not seed the drawer's shipment** — `setActiveCell` now also updates `commentsShipmentId` so the composer is wired the moment the user opens the drawer from the toolbar (fix(frontend))
- **Hover comment-icon posted shipment-level comments** — `openCommentsForCell` set the drawer filter but not `activeCell`, and the composer reads `activeCell.rowKey` to compute the pin target. Comments authored from the hover icon now correctly persist with `field_key`, so the cell badge appears (fix(frontend))
- **`CommentCreateSerializer` rejected the documented payload** — fields were named `shipment_id`/`assignee_id`/`parent_comment_id` but the API contract uses bare names `shipment`/`assignee`/`parent_comment`; every POST returned 400. Renamed fields and added `to_representation` delegation to `CommentSerializer` so the create response matches the read shape (fix(p3))

### Added
- **Hover comment affordance on every cell** — faint chat icon appears in the top-right corner of any cell on hover (when no existing comments). Click opens the drawer pinned to that cell. New `comments.add_to_cell` i18n key in tk/ru/en (feat(frontend))
- New `comments.no_shipment_selected` placeholder state in the drawer body when no shipment column is active (feat(frontend))

### Docs
- New `docs/obsidian/processes/comments-tasks.md` — full process doc for the comment + task system (mention semantics, fan-out rules, task lifecycle, deep-link format, v1 limits) (docs)
- `docs/obsidian/screens/shipment-sheet.md` extended with a "Comments Drawer" section and link to the new process (docs)
- `docs/obsidian/00-index.md` indexes `comments-tasks` under Core Processes (docs)
- `docs/ADR.md` ADR-015 added: Cell-Anchored Comments + Tasks — codifies the four user-locked decisions (anchor + reference, dedup, single assignee, drawer not splitter) (docs)
- `.claude/rules/api-contract.md` documents the wrapped sheet endpoint shape, full `/comments/` CRUD + custom actions surface, mentionable autocomplete, and new notification kinds (docs)

### Changed
- `POST /api/v1/export/shipments/{id}/comment/` (legacy) refactored to delegate to `services.comments.create_comment` — behaviour identical, fan-out now active for backward-compat callers (feat(p3))
- `GET /api/v1/export/shipments/sheet/` response shape changed from flat array to `{results, comment_counts, task_counts}` dict — **breaking for frontend consumers reading `response.data` directly** (changed(p3))
- **Shipment List inline edit (permission-gated)** — `weight_net`, `departed_at`, `arrived_at` cells now edit in place when the user has the corresponding `field_permissions['shipment']` grant. New `ListEditableCell` component (click-to-edit with hover affordance, stops row click navigation, Esc cancels). `useShipmentPatch` extended to optimistically update both sheet and paginated list caches and invalidate all `['shipments']` queries on settle, so the same hook drives both views (feat(frontend))
- **Shipment Sheet** — Excel-style spreadsheet view at `/export/shipments/sheet/` with virtualised columns (`@tanstack/react-virtual`), frozen top section (rows 2–14, identity & planning) and scrollable bottom (rows 15–45, ops & logistics); 7 input types (text, number, date, datetime, dropdown, multiselect, status); inline create button, search, and "gapy only" filter (feat(p3))
- `GET /api/v1/export/shipments/sheet/` action — flat per-season payload, no pagination, `select_related` + `prefetch_related` + `Exists()` annotation for `has_sales_report` (feat(p3))
- `useShipmentPatch` hook with optimistic update + rollback on error (feat(frontend))
- `useShipmentSheet`, `SheetGrid`, `SheetCell`, `SheetCellEditor`, `SheetToolbar`, `SheetLabelColumn` components plus `sheetRowConfig.ts` driving 44 rows (feat(frontend))
- 13 backend tests in `apps/export/tests_shipment_sheet.py` — auth gate, active-season default + `?season=` override, `has_sales_report` annotation, inline firm/block splits, PATCH field-level grants/denies, AD-1 timestamp rejection, junction-table replace + auto-draft `QuotaUsageRecord`, approved-quota safeguard (test(p3))
- Obsidian doc `docs/obsidian/screens/shipment-sheet.md`; `00-index.md` linked under "Operational Screens" (docs)

### Changed
- **Sheet permissions migrated to dynamic registry** — `SheetGrid` and `SheetToolbar` no longer rely on hardcoded `ROLE_EDITABLE_FIELDS` / `CREATE_ROLES` sets; they now read from `canEditField('shipment', fieldKey)` and `canDo('shipment', 'create')` so directors can re-grant per role from `/admin/permissions`. Junction-table edits (`firm_splits`, `block_sources`) gate on `shipment_firm_split` / `shipment_block_source` resource edit. AD-1 timestamps become non-editable in the sheet (consistent with backend's `_ALL_PATCHABLE_FIELDS`) (feat(frontend))
- **Sheet rows R17, R18, R25 wired up.** R17 = warehouse_chief comment count (Soltanmyrat's notes), R18 = document_team comment count (Şirin's notes) — read-only `comment_count` cells with a chat-bubble icon; click navigates to `/export/shipments/{id}?tab=changes`. R25 = `customs_exit_at` (TM customs exit, Şirin) — moved from R26, which is now a gap. Backend annotates `warehouse_comment_count` and `document_comment_count` via `Count(... filter=Q(comments__user__role=...))` on the sheet queryset; `ShipmentSheetSerializer` exposes both. `ShipmentDetail` now reads `?tab=` from the URL to switch the active tab so deep-links land on the right pane (feat(p3))
- **Sheet row numbers re-aligned with the original Excel.** Earlier versions had a uniform `+1` offset on rows 20+ (loading_started_at rendered on R20 instead of R19, transit_days_temp on R27 instead of R26, etc.). All rows from R19 down have been shifted by `-1` so the platform's row numbers now match the user's spreadsheet for cross-reference. Total rows now 2–44 (was 2–45) (feat(frontend))
- **Sheet R24 = finansist documentation-advance tracker (Babageldi).** Read-only ✓/❌ cell — true once a `FinansistAdvanceShipment` row links the shipment to a `FinansistAdvance`. Backend annotates `has_doc_advance` via `Exists(FinansistAdvanceShipment...)` on the sheet queryset; `ShipmentSheetSerializer` exposes the flag. Frontend renders coloured ✓/❌ and click navigates to `/export/advances?shipment={id}`. Adds `who.babageldi` and `row.doc_advance` to all three i18n locales. Test added (15 tests total in `tests_shipment_sheet.py`); existing tests refactored to use a `_sheet_results` helper that handles the new wrapped response shape (feat(p3))

### Added
- **Boss Dashboard** — new `/boss/dashboard` executive analytics page for `boss` and `director` roles (feat(p3))
- New `boss` role added to `ROLE_CHOICES` (migration `0013_add_boss_role.py`); `analytics.boss` page registered in `permission_registry.py`; seeded as visible-only-page for boss + auto-granted to director (feat(p3))
- `IsBossOrDirector` DRF permission class in `apps/core/permissions.py` (feat(p3))
- `BossAnalyticsViewSet` at `/api/v1/export/boss/` with 13 read-only data endpoints (`summary`, `revenue`, `debt`, `route_pnl`, `compliance`, `ops_pulse`, `quota_grid`, `blocks_heatmap`, `top_customers`, `risk_matrix`, `alerts`, `production`, `export_market`) — all 60s cached, all MSSQL-safe aggregations (feat(p3))
- `apps/export/services/boss_analytics.py` — period helpers + 12 private aggregator functions, one per widget cluster (feat(p3))
- `apps/export/exports/` package with `boss_excel.py` (openpyxl) and `boss_pdf.py` (reportlab) — 6 report sections each: monthly, firms, routes, blocks, seasons_compare, audit (feat(p3))
- Two new export endpoints: `GET /api/v1/export/boss/export_excel/?section=...` and `export_pdf/?section=...` (feat(p3))
- 43 backend smoke + integration tests in `apps/export/tests_boss_analytics.py` covering role gating, period math, MSSQL safety, threshold thresholds, 1:10 quota rule, alerts ordering, cache, and absence of Içerki/Sowgatlyk fields (test(p3))
- `reportlab>=4.4` added to backend `requirements.txt` (chore(docker))
- Frontend `BossDashboard` page at `frontend/src/pages/boss/` with 13 widget components: HeroKpiStrip, RevenueChart, DebtBreakdown, RoutePnlTable, ComplianceStrip, QuotaGrid, BlocksHeatmap, TopCustomers, FirmRiskMatrix, AlertsPanel, ProductionResults, ExportMarketByBlock, ReportsGrid (feat(frontend))
- `frontend/src/components/EChart.tsx` — shared ECharts wrapper with loading skeleton, ResizeObserver, and theme tokens (feat(frontend))
- `frontend/src/hooks/useBossDashboard.ts` — 13 TanStack Query hooks (`useBossSummary`, `useBossRevenue`, `useBossDebt`, …, `useBossProduction`, `useBossExportMarket`) with `staleTime: 60_000` (feat(frontend))
- Period switcher (Şu gün / Hepde / Aý / Möwsüm / 5 ýyl) URL-backed via `useSearchParams` (feat(frontend))
- Drill-down navigation on every chart click → existing list pages with filter params (feat(frontend))
- Excel + PDF download tiles wired to backend export endpoints (feat(frontend))
- Login redirect: `boss` role lands on `/boss/dashboard` instead of `/` (feat(frontend))
- Sidebar entry "Boss Dashboard" gated by `analytics.boss`; route-to-page mapping added in `utils/permissions.ts` (feat(frontend))
- `IconChartPie` icon used for the new sidebar entry (feat(frontend))
- i18n: `roles.boss`, `nav.boss_dashboard`, plus 84-key `boss_dashboard.*` namespace in tk/ru/en (feat(frontend))
- Obsidian docs: `docs/obsidian/roles/boss.md`, `docs/obsidian/screens/boss-dashboard.md`; `roles-matrix.md` extended with the `boss` column; `00-index.md` linked (docs)
- ECharts dependencies: `echarts`, `echarts-for-react` (chore(frontend))
- Kaka Findings #1 + #2 — two-phase shipment creation with DRAFT status (step 0) and multi-block composer (feat(p3))
- `ShipmentStatusType` `draft` row seeded via data migration `0017_shipment_draft_status_seed.py`; `draft → yuklenme` edge added to `TRANSITIONS` in `services.py` (feat(p3))
- `ShipmentCreateSerializer` accepts `is_draft` + `block_sources[]`; new `_create_draft_shipment()` path creates draft + `ShipmentBlockSource` rows in one transaction (feat(p3))
- `POST /api/v1/export/shipments/{id}/assign/` endpoint — export_manager transitions a draft to `yuklenme`, writing AD-1 `loading_started_at` via `transition_to()` (feat(p3))
- New page codes: `export.drafts` (warehouse_chief + export_manager), `export.assign` (export_manager only); new resource permission `shipment_assign` (feat(p3))
- Frontend `DraftPool` page — grid of unassigned draft cards with freshness colours (today/yesterday/2+ days) (feat(frontend))
- Frontend `AssignmentBoard` page — 3-column supply/match/demand layout; selecting a draft + demand confirms and transitions to `yuklenme` (feat(frontend))
- `DraftComposerModal` — 1–11 block composer with live sum validation against 18,500 kg target (feat(frontend))
- `BlockSelect` self-fetching control supporting `excludeIds` for multi-row dedup (feat(frontend))
- `useDrafts`, `useCreateDraft`, `useAssignDraft` hooks with `VITE_USE_MOCK` fallback; `mock/drafts.ts` with 5 fixtures (feat(frontend))
- i18n: `draft.*` (37 keys) and `assign.*` (29 keys) namespaces in tk/ru/en (feat(frontend))
- Dynamic admin-configurable permission system — directors can manage page visibility, resource CRUD, and field-level edit permissions per role from a single admin page (feat(p3))
- 3 new Django models: `RolePagePermission`, `RoleResourcePermission`, `RoleFieldPermission` in `core` app with DDL v5.1 tables (feat(p3))
- `DynamicResourcePermission` DRF class — replaces hardcoded `write_permission()` on ViewSets; reads from DB with 60s cache (feat(p3))
- `seed_permissions` management command — populates defaults matching current hardcoded behavior; `--reset` flag for full re-seed (feat(p3))
- Admin permission endpoints: `GET/PUT /api/v1/core/admin/page-permissions/`, `resource-permissions/`, `field-permissions/` — director-only (feat(p3))
- `/auth/me/` now returns `page_permissions`, `resource_permissions`, `field_permissions` for the logged-in user (feat(p3))
- Frontend `canSeePage()`, `canDo()`, `canEditField()` helpers in `src/utils/permissions.ts` (feat(frontend))
- Admin Permissions page: 3 new matrix tabs (Page Visibility, Resource Permissions, Field Permissions) with checkbox grids (feat(frontend))
- `ProtectedRoute` now supports `pageCode` prop for dynamic route protection; `string | string[]` for OR logic (feat(frontend))
- Sidebar menu dynamically filtered by `page_permissions` instead of hardcoded role checks (feat(frontend))
- QuotaDashboard tabs filtered by permission — `seller` sees only Local Sell Plan tab (feat(frontend))
- `/unauthorized` page with 403 Result component (feat(frontend))
- `seller` role added to `ROLE_CHOICES` in User model, i18n translations in all 3 languages (feat(p3))
- 6 ViewSets migrated to `DynamicResourcePermission`: Shipment, QuotaIssuance, LocalSellPlan, PriceEntry, TruckAllocation, Advance (feat(p3))

### Changed
- AppLayout: sidebar now collapses to zero-width on mobile (<768px), renders as a fixed overlay drawer with a dark mask; clicking outside or navigating closes it; `breakpoint="lg"` on Sider auto-collapses on smaller viewports; header is now `position: sticky` so it stays visible while scrolling (feat(frontend))
- AppLayout: username text hidden on mobile to save header space; content padding reduced to `12px 8px` on mobile (feat(frontend))
- LoginPage: card changed from fixed `width: 380` to `width: 100%; maxWidth: 380; margin: 0 16px` so it fits inside 375px screens without overflow (feat(frontend))
- ShipmentCreateModal: Modal width set to `min(480px, 95vw)` so the form is fully usable on phone screens (feat(frontend))
- ShipmentList: toolbar buttons reduced to `size="small"` and wrapped with `flexWrap: wrap` so they stack cleanly on narrow viewports (feat(frontend))
- ShipmentDetail: sales report form grid changed from fixed `1fr 1fr` to `repeat(auto-fit, minmax(200px, 1fr))` so fields stack vertically on mobile; firm splits and block sources tables given `scroll={{ x }}` (feat(frontend))
- KanbanBoard: column min-width increased to 250px, flex-basis to 280px, container uses `-webkit-overflow-scrolling: touch` for smooth horizontal scroll on iOS (feat(frontend))
- WeeklyPlanGrid: DatePicker given `maxWidth: 220` and `width: 100%`; table scroll bumped to `x: 1400` to accommodate 6-day plan/actual columns (feat(frontend))
- QuotaDashboard: summary `Row` gutter changed to `[16, 12]` so cards have vertical spacing when they wrap on mobile (feat(frontend))
- TruckForecast: DatePicker given `maxWidth: 220`; stat cards gutter changed to `[16, 12]`; ProTable given `scroll={{ x: 600 }}` (feat(frontend))
- BlockSummary: DatePicker given `maxWidth: 220`; stat cards gutter changed to `[16, 12]`; table given `scroll={{ x: 640 }}` (feat(frontend))
- DomesticSales: summary cards changed from `xs={8}` (too narrow on 375px) to `xs={24}` / `xs={12}` with `gutter={[16, 12]}`; ProTable given `scroll={{ x: 700 }}` (feat(frontend))
- OverdueReports: ProTable given `scroll={{ x: 600 }}` (feat(frontend))
- AdvancesTracker: ProTable given `scroll={{ x: 700 }}`; page header given `flexWrap: wrap` and `gap: 8`; expanded row indent reduced from 48px to 16px for narrow screens (feat(frontend))
- PricePanel: header gap reduced from 16 to 12 for tighter wrapping on mobile (feat(frontend))

### Data
- Imported 318 weekly harvest plans + 173 truck allocations + 446 destination splits from `weekly_plan.xlsx` (data(p3))
- Added `actual_weekly_total_kg` field to WeeklyHarvestPlan for weekly-only actual totals (db)

### Added
- AdvancesTracker page (`/export/advances`) — ProTable with 4 summary cards, Segmented All/Pending/Reconciled filter, expandable rows showing linked shipments, "New Advance" modal for finansist/export_manager/director, "Reconcile" inline action (feat(frontend))
- `IFinansistAdvanceListItem`, `IFinansistAdvanceDetail`, `IAdvanceShipmentLink` types in `src/types/index.ts` (feat(frontend))
- `useAdvances`, `useAdvanceDetail`, `useReconcileAdvance`, `useCreateAdvance` hooks — `GET/POST /api/v1/export/advances/`, `PATCH .../reconcile/`, MOCK toggle, staleTime 30s (feat(frontend))
- `src/mock/advances.ts` — 5 advances (3 pending, 2 reconciled) with Turkmen context, realistic dates, linked shipment cargo codes (feat(frontend))
- `advances` i18n section in all three locale files (tk/ru/en); `nav.advances` key added (feat(frontend))
- `BankOutlined` nav item for Advances after Overdue in sidebar (feat(frontend))
- `FinansistAdvance` + `FinansistAdvanceShipment` models (`export.finansist_advances`, `export.finansist_advance_shipments`); export migration 0007 (feat(p3))
- `FinansistAdvanceViewSet` at `GET|POST /api/v1/export/advances/` with list/detail/create, reconcile, link-shipment, unlink-shipment custom actions (feat(p3))
- `FinansistAdvanceListSerializer`, `FinansistAdvanceDetailSerializer`, `FinansistAdvanceCreateSerializer`, `AdvanceShipmentSerializer` (feat(p3))
- OverdueReports page (`/export/overdue`) — ProTable with summary cards (total/avg/critical), threshold Segmented (5/7/10/14d), color-coded days column (green/orange/red), `WarningOutlined` nav item (feat(frontend))
- `IOverdueShipment` type extending `IShipmentListItem` with `days_overdue` and `has_sales_report` fields (feat(frontend))
- `useOverdueShipments(threshold)` hook — `GET /api/v1/export/shipments/overdue/?threshold=N`, staleTime 60s, MOCK toggle (feat(frontend))
- `src/mock/overdue.ts` — 5 edge-case overdue shipments (8d/15d/22d/10d/30d, Gapy Satys, Russia, Kazakhstan) (feat(frontend))
- `overdue` i18n section in all three locale files (tk/ru/en); `nav.overdue` key added (feat(frontend))
- `GET /api/v1/export/shipments/overdue/?threshold=N` endpoint — MSSQL-safe Python-computed days, `Exists` subquery for has_sales_report, role-gated (export_manager/director/sales_rep/finansist) (feat(p3))
- `OverdueShipmentSerializer` extending `ShipmentListSerializer` with `days_overdue` + `has_sales_report` (feat(p3))
- `DomesticBuyer` model (`core.domestic_buyers`) — TM bazaar buyers for domestic sales tracking; core migration 0002 (feat(core))
- `DomesticMarketPrice` model (`export.domestic_market_prices`) — daily TM bazaar prices per market/price_type/variety with DDL index; export migration 0004 (feat(p3))
- `QualityDocument` model (`export.quality_documents`) with 4 boolean document flags; migration 0003 (fix(p3))
- Quality tab in ShipmentDetail — 4 checkboxes, role-gated editing (export_manager/document_team/director), PATCH `/shipments/{id}/quality/` (feat(frontend))
- ShipmentCreate modal — `+` button in ShipmentList toolbar (export_manager/director only), cargo_code validation, country/customer/season selects (feat(frontend))
- Language switcher in AppLayout header — `Segmented` TМ/RU/EN, session-cookie persistence (feat(frontend))
- `PATCH /api/v1/export/shipments/{id}/quality/` endpoint — role-gated quality document updates (feat(p3))
- `POST /api/v1/export/shipments/` create endpoint — cargo_code validated, AD-1 `loading_started_at` set, ShipmentStatusLog written (feat(p3))

### Fixed
- `transition_to()` now includes `'updated_at'` in `update_fields` — was silently not saving `auto_now` timestamp (fix(p3))
- Role enforcement moved inside `transition_to()` service — previously only checked in view, now enforced at the service layer with `PermissionError` (fix(p3))
- `TRANSITIONS` dict restructured to carry allowed roles per arc; export_manager/director bypass as PRIVILEGED_ROLES (fix(p3))
- `partial_update` (PATCH) now calls `refresh_from_db()` before building detail response — ensures fresh timestamps (fix(p3))
- `get_total_plan_kg` / `get_total_actual_kg` return `Decimal` not `float` — prevents precision loss (fix(p3))
- `vehicle_status_note` marked `readonly_fields` in ShipmentAdmin — AD-2 compliance (fix(p3))
- `BorderPoint.route_description` and `GreenhouseBlock.location` now use `**cyrillic_collation()` (fix(core))
- `TransitionButton` gated on `shipment.allowed_transitions.length > 0` — no longer shown to all roles (fix(frontend))
- `get_allowed_transitions` returned tuples instead of strings — was breaking TransitionButton (fix(p3))
- AD-1: `loading_started_at` now set on shipment creation via explicit write + ShipmentStatusLog entry (fix(p3))
- `QualityDocument` field names corrected to match DDL v5.1 (`hil_sertifikaty`, `kalibrowka_analiz`); migration 0005 (fix(p3))
- `notes` field added to `ROLE_EDITABLE_FIELDS['document_team']` — was unreachable via PATCH (fix(p3))
- `comment` action now returns full `ShipmentDetailSerializer` response — consistent with transition/set_quality (fix(p3))
- `create()` and `set_quality()` use `PRIVILEGED_ROLES` constant instead of hard-coded role strings (fix(p3))
- `updated_at` explicitly assigned before `save()` in `transition_to()` — clear intent, prevents silent regression (fix(p3))
- Back button in ShipmentDetail navigated to wrong route — fixed to `/export/shipments` (fix(frontend))
- Cargo code `maxLength` corrected from 10 to 20 to match DDL `NVARCHAR(20)` (fix(frontend))
- Dashboard nav label and cargo_code format error translated through `t()` — no hardcoded English (fix(frontend))
- KanbanBoard reduced from 10 to 5 API calls — parent no longer duplicates child `useShipments` calls (fix(frontend))
- ShipmentDetail all labels/tabs through `t()` — no hardcoded English strings remain (fix(frontend))
- KanbanBoard overdue banner translated via `t('kanban.overdue_banner')` in all 3 languages (fix(frontend))
- `ICurrentUser` removed from Zustand — now served purely by TanStack Query; Zustand holds UI state only (fix(frontend))
- i18n locale stored in session cookie instead of localStorage — shared warehouse devices won't bleed user language preference (fix(frontend))

### Added
- `core/permissions.py` — `ROLE_EDITABLE_FIELDS`, `can_edit_field()`, `get_editable_fields()` as single source of truth for field-level permissions (feat(core))
- `PATCH /api/v1/export/shipments/{id}/` — field-level enforcement: forbidden fields return 403, logs patched fields to Django logger (feat(p3))
- `ShipmentPatchSerializer` — validates submitted fields against role's allowed set (feat(p3))
- Excel export button in ShipmentList toolbar — exports current page to `.xlsx` with translated headers (feat(frontend))
- Print/PDF support — `window.print()` with `@media print` CSS hiding sidebar, header, pagination (feat(frontend))
- ShipmentList fully translated: column titles, toggle labels, total count, export dropdown (feat(frontend))
- WeeklyHarvestPlan, QuotaAllocation, PriceEntry models matching DDL v5.1; migration 0002 (feat(p3))
- `GET /api/v1/export/harvest-plans/` — filterable by season/block/year/week; plan vs actual totals (feat(p3))
- `GET /api/v1/export/quotas/dashboard/` — firm list with remaining_kg + used_pct annotations (feat(p3))
- `GET /api/v1/export/prices/` — filterable by city and ?days= lookback (feat(p3))
- WeeklyPlanGrid page: week picker, per-block plan vs actual for Mon–Sat, diff highlighting (green/red), weekly totals summary row (feat(frontend))
- QuotaDashboard page: 4 summary stat cards, ProTable with Progress bar per firm, colour-coded ≥80/90/95% thresholds (feat(frontend))
- PricePanel page: pivoted city × date table, 7/14/30 day range toggle, ↑↓ trend tags (feat(frontend))
- Nav items for Plan, Quota, Prices with icons in all 3 languages (feat(frontend))
- KanbanBoard page: 5 phase columns (LOADING/CUSTOMS/TRANSIT/BORDER/SALES), shipment cards with status badge + days stuck + weight, overdue highlight (red left border + warning tag) per phase threshold, global overdue Alert banner (feat(frontend))
- `?phase=LOADING` filter on shipments API (feat(p3))
- `updated_at` field on ShipmentList API response — used by kanban to compute days stuck (feat(p3))
- Sidebar nav translated with `useTranslation`; Kanban item added with AppstoreOutlined icon (feat(frontend))
- TransitionButton component: modal with status selector + optional comment, role-aware (only shown when transitions exist), toasts on success/error (feat(frontend))
- CommentComposer component: textarea + Send button, Ctrl+Enter shortcut, invalidates detail cache on post (feat(frontend))
- `status_code` + `allowed_transitions[]` fields on ShipmentDetail API response — backend computes allowed transitions from TRANSITIONS dict (feat(p3))
- `POST /api/v1/export/shipments/{id}/comment/` endpoint — creates ShipmentComment, returns updated comments list (feat(p3))
- i18n scaffold: tk/ru/en translation files, i18next + LanguageDetector, `ygt_lang` localStorage key (feat(frontend))
- All LoginPage strings + toast messages through `t()` in all 3 languages (feat(frontend))
- ShipmentDetail page: 6-tab layout (Overview, Logistics, Comments, History) with Descriptions grid, firm splits table, block sources table, and status Timeline (feat(frontend))
- `useShipmentDetail` TanStack Query hook with VITE_USE_MOCK toggle (feat(frontend))
- `/shipments/:id` route lazy-loaded in App.tsx (feat(frontend))
- `editable_fields[]` in `/api/v1/auth/me/` response via `ROLE_EDITABLE_FIELDS` dict per role (feat(core))
- 5 role-based test users created by `seed_data` command: warehouse_chief, document_team, transport, sales_rep, export_manager (feat(core))
- ShipmentList row click navigates to ShipmentDetail (fix(frontend))
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
