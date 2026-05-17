# UI/UX Audit — Frontend

Date: 2026-05-15
Scope: all React pages under `frontend/src/pages/` + shared components (`AppLayout`, `ProtectedRoute`)
Branch: `claude/test-ui-ux-T10Ph`

## Test suite

| Check | Result |
|---|---|
| `npm run test:run` | 13/13 passing (3 test files: `StatusTag.test.tsx`, `useShipmentPatch.test.ts`, `SheetCellEditor.test.tsx`) |
| `npm run type-check` | Clean — no TypeScript errors |
| `npm run lint` | **FAILS — no ESLint config file present** |

### ESLint config missing (P0)

ESLint v9.39 requires a flat `eslint.config.js`; the repo has neither flat nor legacy `.eslintrc*`. The `lint` script is effectively dead — no rules are being enforced on commits, and pre-commit checks listed in `git-conventions.md` cannot run. Add `eslint.config.js` with `@typescript-eslint/parser`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`.

### Test coverage gap

Only 3 test files for 73 page files + 30+ shared components. Top-priority pages with zero tests: `LoginPage`, `ShipmentList`, `ShipmentSheet`, `AppLayout` (auth + permissions), `SelfBoard` (drag-drop logic).

---

## Findings by severity

### P0 — Blocking / accessibility

| # | File | Line | Issue |
|---|---|---|---|
| 1 | `frontend/src/pages/export/QuotaUsageTab.tsx` | 84, 90 | Grid/list view toggle buttons are icon-only with no `aria-label`. High-traffic control. |
| 2 | `frontend/src/pages/export/WeeklyPlanGrid.tsx` | 452, 463 | Week prev/next icon-only buttons missing `aria-label` |
| 3 | `frontend/src/pages/export/QuotaUsageGrid.tsx` | 356, 367 | Week prev/next icon-only buttons missing `aria-label` |
| 4 | `frontend/src/pages/export/AddQuotaIssuance.tsx` | 111 | Back arrow icon-only button missing `aria-label` |
| 5 | `frontend/src/pages/me/SelfBoard.tsx` | drag-drop logic | Kanban drag-drop is mouse-only; not keyboard accessible. Add arrow-key alternative. |
| 6 | `frontend/src/pages/boss/RevenueChart.tsx`, `BlocksHeatmap.tsx` | EChart containers | Charts lack `aria-label`/`title` — screen-reader users get nothing. Heatmap is color-only with no text alternative. |
| 7 | `frontend/src/pages/feedback/AdminInboxPage.tsx` | 167–203 | Filter dropdowns (status, category, author, RangePicker) have no visible/aria labels — placeholder is not a label. |

### P1 — i18n violations (hardcoded user-visible strings)

| File | Line | String | Notes |
|---|---|---|---|
| `pages/export/AdvancesTracker.tsx` | 171 | `placeholder="ADV-2026-XXX"` | Example code — wrap or move to constant |
| `pages/export/LocalSellPlanGrid.tsx` | 107 | `title="Double-click to edit"` | Tooltip — must be `t()` |
| `pages/admin/AuditLogPage.tsx` | 191 | `placeholder="Shipment"` | English-only placeholder |
| `pages/admin/AuditLogPage.tsx` | 198 | `placeholder="123"` | OK as numeric example; still flagged |
| `pages/admin/shipment-settings/SheetRowsTab.tsx` | 134 | `placeholder="kz_remarks"` | Field-key example |
| `pages/admin/shipment-settings/SheetRowsTab.tsx` | 141 | `placeholder="Remarks"` | English |
| `pages/admin/shipment-settings/SheetRowsTab.tsx` | 144 | `placeholder="Замечания"` | Russian — hardcoded in one language |
| `pages/admin/shipment-settings/StatusesTab.tsx` | 152, 155 | `placeholder="e.g. document_team"`, `"e.g. loading"` | |
| `pages/admin/shipment-settings/OptionListsTab.tsx` | 227, 243 | `placeholder="e.g. OK"`, `"e.g. check-circle"` | |
| `pages/boss/ReportsGrid.tsx` | 80, 88 | Button labels `Excel`, `PDF` | High-visibility buttons |
| `pages/boss/HeroKpiStrip.tsx` | 95 | `<Tag>Demo</Tag>` | Same `Demo` tag also in `DebtBreakdown.tsx:50` and `FirmRiskMatrix.tsx:38` |
| `components/AppLayout.tsx` | 430 | `YGT Platform` | Sidebar brand text |

### P1 — Wrong table component (architecture violation)

`frontend-arch.md` requires Ant Design `ProTable` for ALL data tables. Nine pages use `mantine-datatable` (a separate library, inconsistent UX, no built-in search/sort/filter that ProTable provides):

```
pages/admin/AuditLogPage.tsx
pages/admin/SeasonsPage.tsx
pages/admin/UsersPage.tsx
pages/DashboardPage.tsx
pages/export/AdvancesTracker.tsx
pages/export/BlockSummary.tsx
pages/export/DomesticSales.tsx
pages/export/OverdueReports.tsx
pages/export/TruckForecast.tsx
```

Additionally:
- `pages/export/PricePanel.tsx` uses native Mantine `Table`
- `pages/admin/PermissionsPage.tsx` uses basic Ant `Table` (not ProTable) at lines 235, 348, 491 — no sorters, no `defaultSortOrder`

### P2 — Component size (`>200` lines; rule says max 150)

Top offenders — extract sub-components:

| File | Lines | Suggested extracts |
|---|---|---|
| `pages/export/AssignmentBoard.tsx` | 709 | `SupplyCard`, `DemandCard`, assignment-service hook |
| `components/HarvestCell.tsx` | 678 | Editor/cell-state machinery into separate file |
| `pages/export/WeeklyPlanGrid.tsx` | 622 | `PlanCell`, week toolbar, summary section |
| `pages/export/PalletManifest.tsx` | 613 | `ManifestStats`, `DistributionPills`, `VarietyRollup` |
| `pages/admin/PermissionsPage.tsx` | 589 | Per-table tabs into separate components |
| `pages/admin/shipment-settings/SheetRowsTab.tsx` | 581 | Move row-editor + status logic into hook/component |
| `components/AppLayout.tsx` | 581 | Extract `NotificationBell`, menu-building logic |
| `components/sheet/SheetCellEditor.tsx` | 555 | Per-type editors (date, number, select, text) |
| `components/sheet/SheetGrid.tsx` | 535 | Header logic, virtualization wrapper |
| `pages/me/SelfBoard.tsx` | 496 | `KpiStrip`, `BlockModal`, column helpers |
| `pages/feedback/AdminInboxPage.tsx` | 483 | `TicketListPanel`, `TicketDetailPanel`, `TicketCard` |
| `pages/admin/ImportFirmDetailPage.tsx` | 460 | Tabs into separate files |

12 more files between 200–410 lines. The pattern is universal — page-level files do too much.

### P2 — Hardcoded colors / theme tokens

These bypass Ant Design's design tokens (breaks theming/dark-mode/contrast):

- `pages/DashboardPage.tsx` — `#e6f4ff`, `#1677ff`, `#fffbe6` inline throughout (also non-Ant `DM Sans` font on line 186)
- `pages/boss/ProductionResults.tsx:32–38` — yellow `#fffbe6`/`#ffe58f`/`#614700` header
- `pages/boss/BlocksHeatmap.tsx:9–15` — `BAND_COLORS` record of hex pairs
- `pages/boss/QuotaGrid.tsx:9–13` — `LEVEL_COLORS` semantic but hardcoded
- `pages/director/StuckShipments.tsx:165–169` — row CSS with `#fff2f0`/`#fff7e6`/`#fffbe6`
- `pages/boss/DebtBreakdown.tsx:65` and `DashboardPage.tsx:335,359,366` — `fontFamily: 'var(--font-mono, monospace)'` referencing a CSS variable that isn't defined globally

Recommend a `src/theme/colors.ts` exporting semantic tokens (`status.warning`, `status.danger`, `band.high`, etc.) used everywhere.

### P3 — Keyboard accessibility on row/card clicks

- `pages/feedback/PublicFeedPage.tsx:158` — clickable `Card` without `role="button"` / `tabIndex={0}` / Enter handler
- `pages/feedback/MyTicketsPage.tsx:230` — `onRow.onClick` without keyboard fallback (Ant rows are not keyboard-focusable by default)

---

## Positives (what's working well)

- LoginPage: clean i18n, loading state on submit, password visibility via `Input.Password`, polished gradient/centered card. No issues.
- UnauthorizedPage: minimal, fully i18n'd.
- `ProtectedRoute`: properly handles loading + permission checks.
- Self-fetching `Select` rule: no inline `useQuery` violations found in export pages — `CountrySelect`/`CitySelect`/`CustomerSelect` are used consistently.
- Reference-list ProTables (`BlocksPage`, `StatusesTab`, `OptionListsTab`, `BorderPointsTab`) follow the sorter + `defaultSortOrder` pattern from `frontend-arch.md`.
- i18n coverage on user-facing copy is strong — the violations above are limited to placeholders, tooltips, and decoration tags (`Demo`).
- Most data-fetching pages have proper loading + empty states.
- Sidebar (`AppLayout`) handles responsive collapse correctly via `breakpoint="lg"`.

---

## Recommended action plan

**This sprint (P0/P1):**
1. Create `frontend/eslint.config.js` so `npm run lint` actually runs.
2. Add `aria-label` to the 7 icon-only buttons listed in P0.
3. Add `aria-label`/`role` + text alternative to EChart containers (RevenueChart, BlocksHeatmap) and to heatmap tiles.
4. Add visible labels to filter controls in `AdminInboxPage` (or `aria-label` on each `Select`/`RangePicker`).
5. Wrap the 12 hardcoded strings in `t()` and add keys to all three i18n files (tk, ru, en).
6. Migrate the 9 mantine-datatable pages + 1 native Mantine `Table` page + 3 PermissionsPage basic `Table`s to Ant `ProTable`.

**Next sprint (P2):**
7. Split the 12 oversized files starting with `AssignmentBoard`, `AppLayout`, `SelfBoard`, `AdminInboxPage`.
8. Introduce `src/theme/colors.ts` and refactor hardcoded hex usage.
9. Define `--font-mono`/`--font` CSS variables in `index.css` or remove the references.
10. Add keyboard handlers to clickable cards/rows in `PublicFeedPage`, `MyTicketsPage`.

**Continuous (P3):**
11. Expand test coverage — target high-risk pages first (`LoginPage`, `ShipmentList`, `SelfBoard`, `AppLayout` permission gates).
12. Add a SelfBoard keyboard-drag fallback (arrow keys + Enter to move cards between columns).
