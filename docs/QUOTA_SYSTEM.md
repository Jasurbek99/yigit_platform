# Quota System — Program Architecture

## Code Flow

### 1. Adding a Quota Issuance

**User action:** Manager clicks "+ Add Issuance" → navigates to `/export/quota/add-issuance`

**Frontend:** `AddQuotaIssuance.tsx`
- Renders Ant Design Form with: DatePicker (`issue_date`), Select (`product_type`), Select (`validity` — disabled until date picked, shows dynamic month names via `Form.useWatch`)
- Firm allocations: grid of `InputNumber` per active firm, stored in `useState<Record<number, number>>` (not in form state — cleaner for grid layout)
- On submit: builds payload `{ issue_date, product_type, validity, notes, allocations: [{export_firm, kg_quota}] }`, calls `useCreateQuotaIssuance()` mutation

**Hook:** `useQuotaDashboard.ts` → `useCreateQuotaIssuance()`
- POST `/api/v1/export/quota-issuances/`
- On success: invalidates `['quota-issuances']` and `['quota-dashboard']` query keys

**Backend:** `views_quota.py` → `QuotaIssuanceViewSet.perform_create()`
- Uses `QuotaIssuanceCreateSerializer` (selected by `get_serializer_class()` for POST)
- Serializer `create()` method:
  1. Pops `allocations` from validated_data
  2. `transaction.atomic()`:
     - Creates `QuotaIssuance` (model `save()` auto-computes `matched_week`/`matched_year` from `issue_date.isocalendar()`)
     - `bulk_create()` `QuotaIssuanceFirmAllocation` rows (batch_size=500)
  3. Returns response via `QuotaIssuanceSerializer` (read shape with nested allocations + computed `total_kg`)

**Models:** `quota.py`
- `QuotaIssuance.save()` — if not `is_manually_reassigned`, sets `matched_week = issue_date.isocalendar()[1]`, `matched_year = issue_date.isocalendar()[0]`
- `QuotaIssuance.total_kg` — property that runs `self.allocations.aggregate(Sum('kg_quota'))`

---

### 2. Dashboard Analytics

**User action:** Opens `/export/quota` → sees KPI cards + tabs

**Frontend:** `QuotaDashboard.tsx`
- State: `selectedSeasonId`, `period` (mode + month/week/custom dates), `productType`
- `periodToDates()` converts period state → `{date_from, date_to}` using dayjs
- Calls `useQuotaDashboard({ season, date_from, date_to, product_type })`
- Also calls `useQuotaIssuances()` to compute expired stats client-side

**Hook:** `useQuotaDashboard.ts` → `useQuotaDashboard()`
- GET `/api/v1/export/quota-dashboard/?season=1&date_from=...&date_to=...&product_type=tomato`

**Backend:** `views_quota.py` → `QuotaDashboardView.get()`
1. Validates `season` param → fetches `Season` object → uses `start_date`/`end_date` as default range
2. Overrides with `date_from`/`date_to` if provided
3. Calls `_build_dashboard(date_from, date_to, product_type)`:

**`_aggregate_local_sales(date_from, date_to)`**
- Queries `WeeklyLocalSellPlan` for year range ±1
- For each row: checks if ISO week Monday falls within date range (Python-side via `_week_in_range()`)
- Sums `monday_plan_kg` through `saturday_plan_kg` per `export_firm_id`
- Returns `{firm_id: Decimal}`

**`_aggregate_quota_issued(date_from, date_to, product_type)`**
- DB query: `QuotaIssuanceFirmAllocation.objects.filter(issuance__issue_date in range, issuance__product_type=...)` 
- `.values('export_firm_id').annotate(total=Sum('kg_quota'))`
- Returns `{firm_id: Decimal}`

**`_aggregate_quota_used(date_from, date_to)`**
- DB query: `ShipmentFirmSplit.objects.filter(shipment departed_at in range OR shipment.date in range)`
- `.values('export_firm_id').annotate(total=Sum('weight_kg'))`
- Returns `{firm_id: Decimal}`

**Response assembly:**
- KPIs: `local_sales_kg`, `expected_kg` (×10), `issued_kg`, `not_given_kg`, `used_kg`, `unused_kg` + percentages
- Per firm: merges all three dicts by firm_id, computes per-firm metrics, skips zero-activity firms
- Weekly flow: groups plan rows + issuances by ISO week, computes per-week metrics with per-firm breakdown

---

### 3. All Quotas Tab (Flat List)

**Frontend:** `QuotaDashboard.tsx` → `QuotaIssuancesList` component
- Fetches all issuances via `useQuotaIssuances()`
- Flattens: `issuances.flatMap(iss → iss.allocations.map(a → flat row))`
- Each flat row gets computed fields:
  - `expiry_date` = `computeExpiry(issue_date, validity)` → end of month (this_month) or end of next month (this_and_next/next_month)
  - `status` = 'expired' if `expiry < today`, 'expiring' if `≤ 7 days`, else 'active'
  - `days_left` = `expiry.diff(today, 'day')`
- Sorted: active first → expiring → expired, then by issue_date desc
- Ant Design Table with sortable columns, colored Status tags

**`computeExpiry(issueDate, validity)` function:**
```
if validity == 'this_month': dayjs(issueDate).endOf('month')
else: dayjs(issueDate).add(1, 'month').endOf('month')
```

---

### 4. Expired Unused Stats

**Frontend:** `QuotaDashboard.tsx` main component
- `useMemo` loops through all issuances
- For each issuance: computes expiry via `computeExpiry()`
- If expired: sums `kg_quota` per firm into `expiredStats.perFirmExpired` dict
- `expiredStats.totalExpiredKg` = grand total
- Passed to:
  - KPI card "Expired Unused" (7th card, red)
  - `QuotaPerFirmTable` as `expiredPerFirm` prop → renders as last column

---

### 5. Local Sell Plan

**User action:** Tab "Local Sell Plan" → week picker → edit cells → submit → approve

**Frontend:** `LocalSellPlanGrid.tsx`
- Uses Ant Design Table (same pattern as `WeeklyPlanGrid.tsx` for harvest)
- Rows = export firms, Columns = Mon–Sat
- `useLocalSellPlans({ year, week })` fetches data
- Cell editing: `PlanCell` component with 3 modes:
  - `editable=true` → always shows InputNumber (for draft/rejected + correct role)
  - `lockedEditable=true` → shows plain text, double-click unlocks InputNumber (for admin on approved/submitted)
  - Neither → read-only text
- On blur: `useUpsertLocalSellPlan().mutate({ id, [day_plan_kg]: value })`
- Keyboard navigation: arrow keys + Enter via `handleCellKeyDown` from `utils/tableNavigation.ts`

**Backend:** `views_planning.py` → `WeeklyLocalSellPlanViewSet`
- `perform_update()`:
  - Seller: can only edit draft/rejected
  - Manager: can edit any status. If editing approved/submitted → creates `AuditLog` entry with field-by-field diff
- Workflow actions: `/submit/`, `/approve/`, `/reject/`, `/bulk-submit/`, `/bulk-approve/`
- `/initialize-week/`: creates draft rows for all active `ExportFirm` where no row exists for that week

---

### 6. Period Selector

**Frontend:** `QuotaDashboard.tsx`

State machine:
```
IPeriodState {
  mode: 'season' | 'month' | 'week' | 'custom'
  monthKey: "YYYY-M" | null
  weekKey: "YYYY-WW" | null  
  customFrom/customTo: "YYYY-MM-DD" | null
}
```

`periodToDates(state, season)` converts to `{date_from?, date_to?}`:
- `season` mode → returns `{}` (backend uses season's full range)
- `month` mode → `dayjs month start/end`
- `week` mode → `dayjs isoWeek Monday + 5 days`
- `custom` mode → raw dates

Period dropdown: single Select with options = ["All Season", ...months from season, ...weeks from weekly_flow data]

---

### 7. Weekly Auto-Matching

When `QuotaIssuance` is saved:
- `model.save()` computes `matched_week = issue_date.isocalendar()[1]`
- This links the issuance to the ISO sales week
- In `_build_weekly_flow()`: groups plan rows by `(year, week)`, groups issuances by `(matched_year, matched_week)`
- Merges both into weekly cards with sales/issued/gap/coverage metrics

Manual reassignment: PATCH `/quota-issuances/{id}/reassign/` → sets `matched_week`, `matched_year`, `is_manually_reassigned=True`

---

### 8. Data Import Commands

**`import_quotas.py`**
- Reads `data/quota.xlsx` Sheet "Kwota-2"
- Parses mixed date formats (datetime objects, DD.MM.YY, DD.MM.YYYY, dates with trailing text)
- Groups per-firm amounts by `(issue_date, product_type)`
- Creates `QuotaIssuance` per date + `QuotaIssuanceFirmAllocation` per firm via `bulk_create(batch_size=500)`
- Auto-creates missing `ExportFirm` records using `FIRM_NAME_MAP`
- Idempotent: deletes rows with `notes='Imported from quota.xlsx'` before re-inserting

**`import_local_sales.py`**
- Reads `data/quota.xlsx` Sheet "Kwota ucin icerki bazara berlen"
- Row 3 = dates (129 columns), Rows 4-18 = firms
- Groups daily values by ISO week + weekday → maps to `monday_plan_kg`...`saturday_plan_kg`
- Creates `WeeklyLocalSellPlan` rows with `status='approved'` (historical data)
- Preserves current week's manual entries (skips if exists)

---

### 9. File Map

```
backend/apps/export/
  models/
    quota.py                 → QuotaIssuance, QuotaIssuanceFirmAllocation
    planning.py              → WeeklyLocalSellPlan (+ harvest, truck, price models)
    __init__.py              → re-exports all models
  serializers_quota.py       → QuotaIssuanceSerializer, QuotaIssuanceCreateSerializer
  views_quota.py             → QuotaIssuanceViewSet, QuotaDashboardView
  views_planning.py          → WeeklyLocalSellPlanViewSet (+ harvest, truck, price, domestic viewsets)
  urls.py                    → router.register('quota-issuances', ...) + path('quota-dashboard/', ...)
  management/commands/
    import_quotas.py         → Excel → QuotaIssuance
    import_local_sales.py    → Excel → WeeklyLocalSellPlan

frontend/src/
  pages/export/
    QuotaDashboard.tsx       → Main page: period selector, KPIs, 5 tabs, QuotaIssuancesList
    AddQuotaIssuance.tsx     → Full-page issuance entry form
    QuotaPerFirmTable.tsx    → Per Firm tab
    QuotaVisualBars.tsx      → Visual Bars tab  
    QuotaWeeklyFlow.tsx      → Weekly Flow tab
    LocalSellPlanGrid.tsx    → Local Sell Plan tab
  hooks/
    useQuotaDashboard.ts     → useQuotaDashboard, useQuotaIssuances, useCreateQuotaIssuance, useDeleteQuotaIssuance
    usePlanning.ts           → useLocalSellPlans, useUpsertLocalSellPlan, useInitializeLocalSellWeek, submit/approve/reject hooks
  utils/
    tableNavigation.ts       → handleCellKeyDown (shared keyboard nav for grid cells)
  types/
    index.ts                 → IQuotaIssuance, IQuotaIssuanceFirmAllocation, IQuotaDashboardResponse, IWeeklyLocalSellPlan, etc.

database/
  ygt_platform_ddl_v5_1.sql → export.quota_issuances, export.quota_issuance_firm_allocations, export.weekly_local_sell_plans
```
