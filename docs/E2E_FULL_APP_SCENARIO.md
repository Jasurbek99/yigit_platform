# Full-App E2E Scenario — every role, one truck, every screen

> Written 2026-09-17 for a Playwright-driving agent. Facts below were read from the code on
> `main` (1a0ec82) and from the live DB that `backend/.env` points at (`YIGIT_PLATFROM_NEW`).
> Companions: [TEST_ACCOUNTS.md](TEST_ACCOUNTS.md) (logins, gitignored),
> [ROLE_PROCESS_TEST_PLAN.md](ROLE_PROCESS_TEST_PLAN.md) (lifecycle graph),
> [SHEET_LIFECYCLE_E2E_2026-09-08.md](SHEET_LIFECYCLE_E2E_2026-09-08.md) (last real walk),
> [FINDINGS_BACKLOG.md](FINDINGS_BACKLOG.md) (known defects).

Step IDs are stable. Report every one as **PASS / FAIL / BLOCKED / SKIP** with the actual
result (section 9). Never skip silently.

---

## 0. Rules for the agent — read before the first click

### 0.1 Environment

| Item | Value |
|------|-------|
| Frontend (local dev) | http://localhost:3000 |
| Backend (local dev) | http://localhost:8000 — API root `/api/v1/` |
| Beta server | http://10.10.11.25:8080 |
| Database behind the local backend | **live** `YIGIT_PLATFROM_NEW` @ `10.10.11.233\YIGIT` (per `backend/.env`) |
| Active season | `2026-2027` (2026-08-01 → 2027-07-01) |
| Today's date logic | Ashgabat time, not the machine clock |

**Every write in this scenario is real data** unless the user has pointed the backend at
`test_YIGIT_PLATFROM` (see ROLE_PROCESS_TEST_PLAN §4). Before starting, confirm with the user
which stack you are on and that it is outside working hours if it is the live DB.

### 0.2 Accounts

Read **docs/TEST_ACCOUNTS.md §A** for passwords. Only these 15 accounts may be used:

| Role | Username | Notes |
|------|----------|-------|
| admin | `admin` | superuser; lands on `/` |
| boss | `t_boss` | lands on `/boss/dashboard`; header View/Edit toggle |
| director | `t_director` | |
| export_manager | `t_export_manager` | privileged: bypasses every per-step role gate |
| document_team | `t_document_team` | since 2026-09-09 same access as export_manager |
| loading_dept_head | `t_loading_dept_head` | |
| loading_dept_head_deputy | `t_loading_dept_head_deputy` | = head minus Users + Staff Page Access |
| warehouse_chief | `warehouse_chief` | legacy account, own password |
| weight_master | `t_weight_master` | |
| transport | `transport` | legacy account, own password |
| sales_rep | `sales_rep` | legacy account, own password |
| finansist | `t_finansist` | |
| accountant | `t_accountant` | |
| greenhouse_manager | `t_greenhouse_manager` | owns **no block** until setup S-05 |
| seller | `t_seller` | narrowest role |

Hard rules:

1. **One failed login = stop that account.** `django-axes` locks username+IP after 3 failures
   for 30 min, then 5 h, then 24 h. Never retry a password. Never try `document_team`/`dt123`
   or `export_manager`/`em123` (documented as wrong).
2. Never touch any account that is not in the table. Never run `seed_data`.
3. Never open/close a season, never press **Initialize Week** anywhere, never **Delete**
   reference data you did not create.
4. On the **beta** server do not press **Save all** on `/admin/permissions` until the user
   confirms `main` is deployed there (BUILD_TEST_LOG 2026-09-16). On local it is fine.
5. Tag everything you create with `E2E` (notes, names) and export-code sequence **998** so it
   can be found and removed.

### 0.3 Browser handling

- One role at a time in one browser context. Log out with the header **Sign Out** icon button
  (`aria-label="Sign Out"`) and confirm you are on `/login` before the next login.
- Login form: **Username**, **Password**, button **Sign In**. Success toast "Welcome, …".
- Immediately after the first login, set the header language segmented control to **EN**
  (options `TM` / `RU` / `EN`). All labels in this document are the EN ones. The choice is
  stored in the browser and survives logout.
- Blocked route → the app redirects to `/unauthorized` (text "You do not have permission to
  access this page."). Unknown route → redirects to `/`.
- Toasts are `sonner` toasts bottom/top of the viewport; read them right after the action.
- On FAIL: take a screenshot named `<STEP-ID>.png`, capture console errors, record the
  failing network request (URL + status) if there is one.

### 0.4 Editing a Sheet cell (used throughout Part B)

The Sheet (`/export/shipments/sheet`) is transposed: **rows are fields, columns are trucks**.
Column 3 (class `sheet-label-col--field`) holds the field label; the column header shows
a sequence number and the shipment code.

1. Type the shipment code into **Search by code...** so only that column is visible.
2. Find the row by its EN label (table in §2.3). Cells are `.sheet-cell`; an editable one
   also carries `sheet-cell--editable`. If a cell is not editable for your role you will see
   no editor when you press Enter — that is a valid "refused" result.
3. Click the cell (it gets `sheet-cell--active`), press **Enter** or double-click to open the
   editor. Text/number: type, **Enter** commits, **Escape** cancels. Selects: type to filter,
   pick, Enter. Booleans: pick Yes/No. **Date-time cells: opening the editor and confirming
   stamps "now"** (typed values are discarded, F34) — that is what every lifecycle timestamp
   below wants.
4. Success toast **Saved**. Failure toast **Failed to save**.
5. If a cell sits under the frozen band and clicks land on the wrong row (F33): toolbar
   **Settings** → Freeze panes → **No freeze**, or navigate with arrow keys.
6. Truck plate and driver cells open dedicated pickers (`data-testid="sheet-truck-select-editor"`,
   `data-testid="sheet-driver-select-editor"`).

### 0.5 Known defects — expected, record but do not re-investigate

| Where you will hit it | What you see | Finding |
|------|-----|----|
| Sheet row labels | Labels follow the profile language (TK) even with EN selected | F24 |
| Sheet, Packing cell | Roles without `firm_splits` see the icon but the save 403s | F23 |
| Sheet, cells under sticky band | Click activates the row above | F33 |
| Sheet, date-time cells | Typed value ignored, "now" saved | F34 |
| sales_rep on the Sheet | Empty unless a customer is assigned to the rep — setup S-04 fixes it | F28 |
| Transshipment after entering Dest Customs | Flipping Peregruz later drives nothing; set it **before** | F29 |
| Report Date cell | Saves but never advances; only the attached sales report does | F30 |
| t_finansist | Cannot open the sales-report page; the rep closes the lifecycle | F31 |
| t_boss shipment list | No row checkboxes until header toggle = Edit, may need navigate away/back | known |
| Transport module | Several `/transport/*` read endpoints open to all roles | F5 |
| Contract documents (PDF) | PDF needs `LIBREOFFICE_BIN` in `backend/.env`; Word always works | env |

Blocked-step protocol: if the **owning** role cannot perform a lifecycle step, record BLOCKED
with the exact toast/status, then perform the step as `t_export_manager` and mark the
continuation "driven by EM". Do not stop the chain.

---

## 1. Setup — as `admin`

| ID | Do | Expected |
|----|----|----------|
| S-01 | Log in as `admin`, switch language to EN | Lands on `/` Dashboard; nav shows all groups incl. **Users**, **Permissions**, **Staff Page Access**, **Feedback Inbox** |
| S-02 | Header season switcher | Shows `2026-2027` with status **Active**; at least one other (closed) season in the list — note its name for X-02 |
| S-03 | `/admin/users` | All 15 accounts from §0.2 listed, **Active** = yes, role column matches the table |
| S-04 | `/admin/sales-rep-coverage` | Find a customer whose rep is empty (not **Arap**, which belongs to `arap`). Assign it to user **sales_rep**. Record `CUSTOMER_SR` = that customer's name and its previous rep (should be empty) |
| S-05 | `/admin/blocks` (or `/admin/permissions` → tab **Block Assignments**) | Assign block **OG** to `t_greenhouse_manager`. Record the previous manager of OG (`PREV_MGR_OG`) — you restore it in cleanup. If OG already has a real manager and the UI only allows one, use **OD** instead; if both are taken, SKIP and mark every C-GM edit step BLOCKED-SETUP |
| S-06 | `/export/drafts` | Page loads; record `DRAFTS_BEFORE` (count shown next to "drafts") |
| S-07 | `/admin/shipment-settings` | Sheet-rows table loads; rows **Harvest Block**, **Destination Country**, **Customer**, **Documents (13:00)**, **Loading Start**, **Greenhouse Departure** exist and are visible |
| S-08 | `/admin/feedback` | Inbox loads (may be empty) |
| S-09 | Bottom-right floating button (tooltip "Send feedback or report a bug") | Present on every page |
| S-10 | Sign Out | On `/login` |

---

## 2. Reference tables

### 2.1 Route ↔ nav label ↔ page code

| Route | EN nav label | Page code |
|-------|--------------|-----------|
| `/` | Dashboard | `dashboard` |
| `/boss/dashboard` | Boss Dashboard | `analytics.boss` |
| `/analytics/clients-report` | Clients Report | `analytics.clients` |
| `/director/stuck-shipments` | Stuck Shipments | `director.stuck_shipments` |
| `/me/board` | My tasks | `me.board` (everyone) |
| `/export/shipments` | Shipments | `export.shipments` |
| `/export/shipments/sheet` | Sheet | `export.shipments_sheet` |
| `/export/shipments/dashboard` | Dashboard (under Shipments) | `export.shipments_dashboard` |
| `/export/shipments/board` | Board | `export.shipments.board` |
| `/shipments/:id` | Shipment Detail | via `export.shipments` |
| `/shipments/:id/manifest`, `/export/weightmaster` | Weightmaster / Pallet manifest | `export.pallet_manifest` |
| `/shipments/:id/activity` | activity log | via `export.shipments` |
| `/export/drafts` | Draft Shipments | `export.drafts` |
| `/export/assign` | Assignment Board | `export.assign` |
| `/export/harvest-board` | Cargo Plan & Remainder | `export.harvest_board` |
| `/export/plan` | Weekly Plan | `export.plan` |
| `/export/quota` (+`/add-issuance`) | Quota | `export.quota` / `export.quota.local_sell` |
| `/export/prices` | Prices | `export.prices` |
| `/export/advances` | Advances | `export.advances` |
| `/export/overdue` | Overdue | `export.overdue` |
| `/export/trucks` | Trucks | `export.trucks` |
| `/export/blocks` | Block Summary | `export.blocks` |
| `/export/pomidor-dukany` | Pomidor Dükany | `export.pomidor_dukany` |
| `/export/domestic-sales` | Domestic Sales | `export.domestic_sales` |
| `/export/my-reports`, `/export/sales-reports/:shipmentId` | Sales Reports | `export.sales_reports` |
| `/admin/sales-rep-coverage` | Sales Rep Coverage | `export.sales_rep_coverage` |
| `/admin/expense-template` | Expense Template | `export.expense_template` |
| `/admin/packing-templates` | Packing Templates | `export.packing_presets` |
| `/contracts`, `/contracts/:id` | Contract list | `contracts.list` |
| `/sales` | Sales | `contracts.sales` |
| `/documents` | Documents | `contracts.documents` |
| `/transport/map` | Fleet Map | `transport.map` |
| `/admin/fleet` | Fleet Management | `transport.fleet` |
| `/worklog` | Work hours | `worklog` (everyone) |
| `/team/kpi` | Team leaderboard | `team_kpi` (everyone) |
| `/feedback/submit` · `/feedback/my-tickets` · `/feedback/public` | Feedback · My Tickets · Public Suggestions | everyone |
| `/admin/feedback` | Feedback Inbox | `feedback.admin_inbox` (admin only) |
| `/admin/users` | Users | `admin.users` |
| `/admin/staff-access` | Staff Page Access | `admin.staff_access` |
| `/admin/permissions` | Permissions | `admin.permissions` (admin only) |
| `/admin/seasons` | Seasons | `admin.seasons` |
| `/admin/firms`, `/admin/firms/:id` | Export Firms | `admin.firms` |
| `/admin/import-firms`, `/admin/import-firms/:id` | Import Firms | `admin.import_firms` |
| `/admin/customers` | Customers | `admin.customers` |
| `/admin/blocks`, `/admin/blocks/:id` | Block Management | `admin.blocks` |
| `/admin/truck-destinations` | Truck Destinations | `admin.truck_dest` |
| `/admin/shipment-settings` | Shipment Settings | `admin.shipment_settings` |
| `/admin/audit-log` | Audit Log | `audit_log` |
| `/admin/process-links` | Process Diagram Links | admin bundle |
| `/admin/legal-forms` | (legal forms, reached from Export Firms) | admin bundle |

### 2.2 Expected page visibility per role

Source: seeded defaults in `seed_permissions.py` plus the live deltas noted in
TEST_ACCOUNTS.md §D. The matrix is admin-editable data, so a mismatch is a **finding to record**,
not automatically a bug. "Universal" = My tasks, Feedback, My Tickets, Public Suggestions,
Work hours, Team leaderboard.

| Role | Must be able to open | Must NOT see / must be denied by URL |
|------|----------------------|--------------------------------------|
| admin | everything in §2.1 | — |
| boss | everything except → | Permissions, Users, Staff Page Access, Feedback Inbox |
| director | Boss Dashboard, Clients Report, Stuck Shipments, Audit Log, Advances, Prices, Overdue, all export pages, Contracts/Sales/Documents, Fleet Map, Fleet Management | every `/admin/*` reference page, Permissions, Feedback Inbox |
| export_manager | all export pages, Contracts/Sales/Documents, Sales Rep Coverage, Expense Template, Packing Templates, Shipment Settings, Audit Log, Fleet Map, Fleet Management | Permissions, Users, Staff Page Access, Feedback Inbox, Stuck Shipments; live matrix also hides Advances, Prices, Overdue — record which |
| document_team | **same list as export_manager** (parity build 2026-09-09, untested) | same as export_manager |
| loading_dept_head | Dashboard, Shipments, Sheet, Shipments Dashboard, Board, Draft Shipments, Weightmaster, Weekly Plan, Cargo Plan & Remainder, Fleet Map, Fleet Management, **Users**, **Staff Page Access**, **Block Management** + universal | Permissions, Contracts, Advances, Prices, Quota |
| loading_dept_head_deputy | same as head | **Users, Staff Page Access** additionally denied |
| warehouse_chief | Dashboard, Shipments, Sheet, Shipments Dashboard, Board, Draft Shipments, Weightmaster, Cargo Plan & Remainder, Fleet Map, Fleet Management + universal | any admin page, Weekly Plan |
| weight_master | Dashboard, Shipments, Sheet, Shipments Dashboard, Board, Weightmaster, Cargo Plan & Remainder, Fleet Map + universal | any admin page, Draft Shipments, Weekly Plan |
| transport | Dashboard, Shipments, Sheet, Shipments Dashboard, Board, Cargo Plan & Remainder, Fleet Map + universal | any admin page, Fleet Management (record if visible) |
| sales_rep | Shipments, Sheet, Shipments Dashboard, Board, Advances, Cargo Plan & Remainder, Sales Reports, Fleet Map + universal | **Dashboard** (live), any admin page |
| finansist | Dashboard, Shipments, Sheet, Shipments Dashboard, Board, **Prices**, **Advances**, Cargo Plan & Remainder, Fleet Map + universal | any admin page, Sales Reports |
| accountant | Dashboard, Shipments, Sheet, Shipments Dashboard, Board, Cargo Plan & Remainder, Fleet Map + universal | Advances, Prices, any admin page |
| greenhouse_manager | Dashboard, Weekly Plan, Domestic Sales, Cargo Plan & Remainder, Fleet Map + universal | **Shipments, Sheet, Board** (F6 closed 2026-09-01) |
| seller | Dashboard, Quota (Local Sell Plan grid only) + universal | Fleet Map, Shipments, everything else |

### 2.3 Sheet rows — EN label, field, and who may edit (live triggers, 2026-09-17)

| EN label (column 3) | field_key | Editable by (besides admin / boss / director / export_manager) |
|---|---|---|
| Truck Status | `vehicle_condition` | transport |
| Documents (13:00) | `documents_status` | document_team |
| Gadam's note | `export_manager_note` | — |
| Transport dept documents | `transport_docs_given_at` | document_team |
| Shipment Code | `shipment_code` | loading heads |
| Harvest Block | `block_sources` | document_team, loading heads, warehouse_chief |
| Export Firm | `firm_splits` | document_team |
| Destination Country | `country` | document_team |
| Customer | `customer` | document_team |
| Destination City | `city` | document_team, sales_rep |
| Import Firm | `import_firm` | document_team |
| Harvest Status | `harvest_status` | loading heads, warehouse_chief |
| Vehicle Current Position / ETA | `vehicle_live_status` | transport (map pin `data-testid="truck-map-pin"`) |
| Loading Start | `loading_started_at` | loading heads, warehouse_chief |
| Loading End | `loading_ended_at` | loading heads, warehouse_chief |
| Notes (Soltanmyrat) | `warehouse_note` | loading heads, warehouse_chief |
| Greenhouse Departure | `departed_at` | loading heads, warehouse_chief, transport |
| Notes (Şirin) | `document_note` | document_team |
| Vehicle Responsible | `vehicle_responsible` | transport |
| Truck / Trailer Plate | `truck_plate` | transport |
| Doc Advance Issued | `has_doc_advance` | finansist |
| TM Export Customs Done | `customs_exit_at` | document_team |
| Transit Days & Temp | `transit_days_temp` | loading heads, transport |
| Driver Name / Driver Phone | `driver_name` / `driver_phone` | transport |
| Border Point | `border_point` | transport |
| TM Border Exit | `border_crossed_at` | transport |
| Destination Entry | `dest_entry_at` | sales_rep |
| Destination Customs | `customs_entry_at` | sales_rep |
| Transshipment | `has_peregruz` | sales_rep |
| Transshipment Time | `peregruz_date` | sales_rep |
| Arrival | `arrived_at` | sales_rep |
| Planned customs day | `customs_clearance_planned_day` | document_team |
| Weight to load | `weight_to_load_kg` | loading heads, warehouse_chief, sales_rep |
| Net Weight (shipped) | `weight_net` | document_team, loading heads, warehouse_chief |
| Tomato Variety | `variety` | loading heads, warehouse_chief |
| Harvest Date | `harvest_date` | loading heads, warehouse_chief |
| Sale Start / Sale End | `sale_started_at` / `sale_ended_at` | sales_rep |
| Type (Gapy Satys) | `is_gapy_satys` | — |
| Export Code | `export_code` | loading heads, warehouse_chief |
| Notes (Arap) | `additional_notes_arap` | sales_rep |
| Contracts | `firm_contracts` | document_team |
| Packing (gross-net) | `packing` | document_team, loading heads, warehouse_chief |
| Report Date | `sales_report_date` | sales_rep |

### 2.4 Lifecycle: status, trigger cell, owning role

| # | Status (EN) | code | Leaves it when | Owner |
|---|---|---|---|---|
| 0 | Draft | `draft` | all four gates: destination (Country + Customer), Export Firm, driver (Plate + Driver Name + Driver Phone), Documents (13:00) = ready | EM / document_team / transport / document_team |
| 1 | Customs Entry | `gumruk_girish` | TM Export Customs Done | document_team |
| 2 | Customs Exit | `gumruk_chykysh` | Loading Start | loading_dept_head (+deputy) |
| 3 | Loading | `yuklenme` | Greenhouse Departure | document_team by rule, transport/loading by Sheet row (F32) |
| 4 | Departed | `yola_chykdy` | TM Border Exit | transport |
| 5 | Border Crossed | `serhet_gechdi` | Destination Entry | sales_rep |
| 6 | Destination Entry | `dest_entry` | Destination Customs | sales_rep |
| 7 | Dest Customs | `barysh_gumrugi` | Transshipment Time (if Transshipment = Yes) **or** Arrival | sales_rep |
| 8 | Transshipment | `transshipment` | Arrival | sales_rep |
| 9 | Arrived | `bardy` | Sale Start | sales_rep |
| 10 | Being Sold | `satylyar` | Sale End | sales_rep |
| 11 | Sold | `satyldy` | a sales report exists | sales_rep |
| 12 | Completed | `tamamlandy` | terminal | — |
| — | Cancelled | `cancelled` | via **Cancel shipment** only | admin, director, export_manager |

Every transition fires automatically on save (`is_auto`) and cascades through any step whose
trigger is already satisfied. Check the status in the Sheet column header / Board after each
save and expect a fresh entry in the shipment's History tab.

---

## 3. Part A — Access smoke, every role

Run A-01…A-07 for **each** of the 15 roles, in the order of §0.2. Prefix results with the
role, e.g. `A-03[transport]`.

| ID | Do | Expected |
|----|----|----------|
| A-01 | Log in | Success toast; landing route as in §0.2 (boss → `/boss/dashboard`, others `/`; sales_rep has no Dashboard — record where `/` lands) |
| A-02 | Read the sidebar | Contains every "must open" item of §2.2 and none of the "must NOT" items. Record the full list of labels |
| A-03 | Click every sidebar item once | Each page renders its heading; no "Failed to load…" toast; no `/unauthorized` redirect; no red error box. Record any page that fails |
| A-04 | Type each "must NOT" route from §2.2 in the URL bar (max 3 per role) | Redirect to `/unauthorized` |
| A-05 | `/me/board` | Kanban with columns To do / In progress / Blocked / Done today / History and KPI tiles; may be empty |
| A-06 | Header | Worklog chip "Today: …", season switcher, language control, notification bell, connection dot present; boss additionally sees the **View / Edit** toggle |
| A-07 | Sign Out | `/login` |

Extra per-role assertions inside Part A:

| ID | Role | Check |
|----|------|-------|
| A-10 | document_team vs export_manager | Sidebar label lists are identical apart from **Stuck Shipments** / **Feedback Inbox** (neither should have them). Any other difference → FAIL (parity build 2026-09-09) |
| A-11 | loading_dept_head vs deputy | Lists differ by exactly **Users** and **Staff Page Access** |
| A-12 | seller | Sidebar is exactly: Dashboard, Quota, My tasks, Work hours, Team leaderboard, Feedback, My Tickets, Public Suggestions. `/export/quota` shows the **Local Sell Plan grid only** — no tab strip, no KPI cards, no "Failed to load quota data" toast |
| A-13 | greenhouse_manager | No **Shipments / Sheet / Board** links; `/export/shipments` → `/unauthorized` |
| A-14 | sales_rep | Sidebar has **Sales Reports** and no **Dashboard** |
| A-15 | accountant | Sidebar has no **Advances** / **Prices** |
| A-16 | boss | `/admin/permissions`, `/admin/users`, `/admin/staff-access`, `/admin/feedback` all → `/unauthorized` |

---

## 4. Part B — Lifecycle walk: one truck, role by role

Create the truck on **2026-09-17**; system codes look like `1709NNN/26`. Keep a scratch note:
`CODE_A` (supply column), `CODE_B` (destination column, the survivor), `ID_B` (numeric id
from the detail URL).

### B0 — Two columns and a Join (draft)

| ID | Role | Where | Do | Expected |
|----|------|-------|----|----------|
| L-01 | t_loading_dept_head | Sheet toolbar | **Add shipment** | Toast "Empty shipment column created: `<code>`". Record `CODE_A`. Column status **Draft**, supply tint. The button is gated on the `shipment` create grant: if it is absent for the loading head, record BLOCKED, create the column as t_export_manager, and continue L-02/L-03 as the loading head |
| L-02 | t_loading_dept_head | Sheet, column CODE_A | **Harvest Block** → block `A`, 18100 kg → Enter | Saved; cell shows `A` |
| L-03 | t_loading_dept_head | same | **Weight to load** = `18100`; **Harvest Status** = any option; **Harvest Date** = confirm (today); **Export Code** → editor Day `17`, Month `SP`/09, Seq `998`, Block `A`, Year `26` → Combined preview shows `17|SP|998|A|26…` → save | Each cell Saved. Note all 5 values |
| L-04 | t_export_manager | Sheet toolbar | **Add shipment** | Toast with a second code. Record `CODE_B` |
| L-05 | t_export_manager | Sheet, column CODE_B | **Destination Country** = `Kazakhstan` (or any), **Customer** = `CUSTOMER_SR` (from S-04), **Import Firm** = any | Saved ×3 |
| L-06 | t_export_manager | Sheet toolbar | **Join** → bar "Click a supply column, then a destination column to join" → click CODE_A header, then CODE_B header | Bar shows **Kept: CODE_B**, **Removed: CODE_A** |
| L-07 | t_export_manager | join bar | **Join** | Toast "Drafts merged successfully". CODE_A column gone. CODE_B now shows Harvest Block `A`, Weight to load, Export Code, **Harvest Date and Harvest Status** (F25 fix, untested — FAIL if either is empty) |
| L-08 | t_export_manager | `/export/shipments` → search CODE_B → open | Detail hero shows Draft; stage cards; **Promote to TM Customs Entry** visible but stays for later; record `ID_B` from the URL |
| L-09 | t_export_manager | header bell | Notification for CODE_B ("your fields need filling" or task assigned) present; **Mark all read** clears the badge |
| L-10 | t_export_manager | `/me/board` | Card **Set destination** for CODE_B is in Done today (or absent) because Country + Customer are filled |

### B1 — Draft gates

| ID | Role | Do | Expected |
|----|------|----|----------|
| L-11 | t_document_team | Sheet CODE_B → **Export Firm** → pick a firm that is not greyed "⚠ no quota" | Saved; firm chip shown. `/me/board`: **Pick export firms** moves to Done today |
| L-12 | t_document_team | Sheet → **Packing (gross-net)** icon → panel → choose a packing template → save | Icon changes to the "filled" variant; firm share weight shown from the template (build 2026-09-12) |
| L-13 | t_document_team | Sheet → **Contracts** icon → panel → create a **one-time** contract for the firm | Form asks **price per kg**; contract created and linked; icon changes to filled. Record `CONTRACT_E2E` number |
| L-14 | transport | Sheet CODE_B → **Truck / Trailer Plate** → truck picker → pick a truck head (GPS-linked if available) + trailer → commit | Plate string written; `sheet-fleet-warning` absent |
| L-15 | transport | **Driver Name** → driver picker → pick a driver; **Driver Phone** filled or type one | Both saved. `/me/board`: **Assign driver** → Done today |
| L-16 | transport | `/me/board` → card **Hand over documents** → open → **Mark task done** | Card moves to Done today (manual task, non-gating) |
| L-17 | transport | Sheet → **Truck Status**, **Vehicle Responsible**, **Border Point**, **Transit Days & Temp** (`3 / 4`) | All Saved |
| L-18 | t_document_team | Sheet → **Documents (13:00)** dropdown | Options are unambiguous: exactly one reads as "ready/OK" (F26 fix, untested). Pick the ready option → Saved |
| L-19 | — | Sheet header / Board | CODE_B status is now **Customs Entry**. If still Draft: open `/shipments/ID_B` as t_export_manager, read "Tasks open" / **Missing:** and record which gate is open. Then (BLOCKED protocol) press **Promote to TM Customs Entry** |

### B2 — Customs, loading, departure

| ID | Role | Do | Expected |
|----|------|----|----------|
| L-20 | t_document_team | `/me/board` → **Send documents to customs** → Mark task done | Done today |
| L-21 | t_document_team | Sheet → **TM Export Customs Done** → confirm now | Status → **Customs Exit** |
| L-22 | t_loading_dept_head | `/me/board` | Card **Record loading start** for CODE_B in To do |
| L-23 | t_loading_dept_head | Sheet → **Loading Start** → confirm | Status → **Loading**; card → Done today |
| L-24 | t_weight_master | `/export/weightmaster` | Queue "Trucks in loading" lists CODE_B; pick it → Pallet manifest opens |
| L-25 | t_weight_master | **+ Add pallet** ×2 → Pallet №1/2, crate type, gross `1200`, crate count `100`, variety, sub-block `A` → **Save** | Toast "Pallets saved"; stats Pallets = 2, Net computed; "Block breakdown (block × variety)" shows block A |
| L-26 | t_weight_master | **Close manifest** | Either toast "Manifest closed — variety auto-computed" or refusal — record. If refused, repeat as t_loading_dept_head |
| L-27 | t_loading_dept_head | Sheet → **Loading End** (now), **Net Weight (shipped)** `18100`, **Tomato Variety** pick, **Notes (Soltanmyrat)** `E2E` | Saved; `/me/board` **Fill loading data** → Done today |
| L-28 | t_document_team | Sheet → **Greenhouse Departure** → confirm | Status → **Departed**. If document_team is refused, do it as **transport** and record which role worked (F32) |
| L-29 | sales_rep | `/me/board` | Reminder card **Submit sales report** for CODE_B appears (manual, non-gating) |

### B3 — Transport

| ID | Role | Do | Expected |
|----|------|----|----------|
| L-30 | transport | Sheet → **Vehicle Current Position / ETA** = `E2E on the road`; click the map pin icon next to it | Truck map modal opens (position or "no GPS" state) |
| L-31 | transport | Sheet → **TM Border Exit** → confirm | Status → **Border Crossed** |
| L-32 | transport | `/transport/map` → search the plate from L-14 | Map with pins renders; "Last sync" shown; the truck is found or reported as no-GPS |

### B4 — Destination and sale (sales_rep)

| ID | Role | Do | Expected |
|----|------|----|----------|
| L-33 | sales_rep | Sheet | CODE_B is visible (customer scoping via S-04). Record how many columns the Sheet shows in total |
| L-34 | sales_rep | **Destination Entry** → confirm | Status → **Destination Entry** |
| L-35 | sales_rep | **Transshipment** = Yes **first**, then **Destination Customs** → confirm | Status → **Dest Customs**; `/me/board` shows **Record transshipment** (not "Record arrival") |
| L-36 | sales_rep | **Transshipment Time** → confirm | Status → **Transshipment** |
| L-37 | sales_rep | **Arrival** → confirm | Status → **Arrived** |
| L-38 | sales_rep | **Destination City** pick; **Sale Start** → confirm | Status → **Being Sold** |
| L-39 | sales_rep | **Sale End** → confirm | Status → **Sold** |
| L-40 | sales_rep | **Report Date** → confirm | Saved, status unchanged (F30, expected) |
| L-41 | sales_rep | `/export/my-reports` → tab **Needs report** | CODE_B listed with Report = Missing → **Open report** |
| L-42 | sales_rep | `/export/sales-reports/ID_B` → tab **Sale**: Currency (defaults from country), Exchange Rate `1`, **Add Line** (product, `18100` kg, price `1.2`), **Add Expense** (category, `100`) → tab **Processing** → **Save Report** | Toast "Sales report saved"; Gross/Net totals shown; status → **Completed**; reminder card from L-29 → Done today |
| L-43 | sales_rep | `/shipments/ID_B` | Record: opens read-only or redirects to `/` (F31 pattern) |

### B5 — Finance, oversight, read-only

| ID | Role | Do | Expected |
|----|------|----|----------|
| L-44 | t_finansist | Sheet → **Doc Advance Issued** = Yes | Saved |
| L-45 | t_finansist | `/export/advances` → **New advance**: amount `500`, currency, purpose `E2E`, batch code `E2E-998`, link CODE_B → save → **Reconcile** | Toasts; advance status Reconciled; CODE_B in linked shipments |
| L-46 | t_finansist | `/export/prices` → range 7/14/30 toggle; enter a price for the destination city today | Pivot updates; trend arrow appears next day (just check it saved) |
| L-47 | t_finansist | `/export/sales-reports/ID_B` | Redirects to `/` (F31, expected) |
| L-48 | t_director | `/director/stuck-shipments` | Table with buckets; CODE_B absent (it moved today) |
| L-49 | t_director | `/admin/audit-log` → Model `Shipment`, Object ID `ID_B` | 12+ **Transition** rows draft → … → tamamlandy plus Update rows with user names |
| L-50 | t_director | `/analytics/clients-report` | Three charts + matrix load for season 2026-2027 |
| L-51 | t_boss | `/boss/dashboard` → change **period**; **Excel** and **PDF** export buttons | KPIs, revenue chart, top customers, quota grid, blocks heat-map load; exports download (PDF may need LibreOffice — record) |
| L-52 | t_boss | Header toggle **View → Edit** → confirm dialog → `/export/shipments` | Row checkboxes appear. If not, navigate to `/` and back. Record which it took |
| L-53 | t_accountant | `/export/shipments` search CODE_B; Sheet CODE_B → press Enter on **Loading Start** | Row visible; **no editor opens** on any cell; no **New Shipment** button on the list |
| L-54 | admin | `/shipments/ID_B` | Hero **Completed**; every stage card "complete"; completeness bar full; tab **History** lists all transitions with actor; tab **Comments**; `/shipments/ID_B/activity` loads |
| L-55 | admin | `/export/plan` → current week → block A row → **Loaded/Exported** column for today | Shows 18 100 (roll-up from block sources) |

### B6 — Documents for the truck (document_team, any time after L-13)

| ID | Do | Expected |
|----|----|----------|
| D-01 | `/documents` → filter Truck date = today → row CODE_B | Status **Ready** (else **Setup needed** with a "Complete on the Sheet first: …" hint — record the fields and fill them, then retry) |
| D-02 | Expand CODE_B → **CMR** menu | Exactly **six** entries: Word / PDF / Excel × RU / EN. Download Word RU → file arrives (`.docx`) |
| D-03 | **TIR carnet** button beside CMR → menu | Offers Excel (and Word/PDF); Excel downloads |
| D-04 | **Download packet** | A zip downloads |
| D-05 | Any **PDF** entry | Downloads, or fails with a server error → record as env (LibreOffice) not as a bug |
| D-06 | `/contracts` → open `CONTRACT_E2E` → **Download contract** | Modal has **Stamps** dropdown with 4 options (No stamps / Both / Export only / Import only), Format, Buyer's director pre-filled; Word downloads |
| D-07 | `/contracts` → **+ New contract** | **Type** (Framework / One-time) is the first field with an explanatory sentence; **Cancel** |
| D-08 | `/sales` | Look for a sale row for CODE_B / CONTRACT_E2E: quantity and price should come from the packing share (build 2026-09-10). Record present/absent and the values |

---

## 5. Part C — Per-role feature checks

### C-ADM — admin

| ID | Do | Expected |
|----|----|----------|
| C-ADM-01 | `/admin/users` → **+ New User**: `t_e2e_tmp`, role Packer (weight_master), password `Test1234!`, name `E2E Tmp` | Toast "User created"; row appears |
| C-ADM-02 | Row → **Edit Role** → Loading Dept Deputy → save; **Reset Password** → `Test1234!` → Set | Toasts "User updated" / "Password updated" |
| C-ADM-03 | Sign out, log in as `t_e2e_tmp` once (X-10 uses it for the wrong-password test **before** this) | Lands on `/`; sidebar = deputy set. Sign out, back to admin |
| C-ADM-04 | `/admin/permissions` → role **accountant** → Pages → untick **Work Hours** → **Save all** | Toast saved; "0 unsaved". Later (C-ACC-01) t_accountant has no **Work hours** link. Then re-tick + Save |
| C-ADM-05 | Same page → **Resources** section | Badge "Resources the matrix does not enforce" visible with reasons |
| C-ADM-06 | `/admin/staff-access` | Loads for admin (page → role grid) |
| C-ADM-07 | `/admin/seasons` | `2026-2027` **Active**; do not press Close/Open |
| C-ADM-08 | `/admin/firms` | **Doc Fields** column shows Complete / Missing N; hover shows the missing fields |
| C-ADM-09 | Open a firm named `Tel …` | Three extra rows for Tassyknama; **Signature & Seal** card = three equal upload slots in one row incl. **Seal + Signature (one photo)** |
| C-ADM-10 | Upload a small PNG into "Seal + Signature (one photo)" → reload | Image renders (not broken); then delete it |
| C-ADM-11 | `/admin/import-firms` → open one | Same completeness warnings; Director's Full Name field present |
| C-ADM-12 | `/admin/customers` | List loads; `CUSTOMER_SR` visible |
| C-ADM-13 | `/admin/blocks` → open block A | Detail with manager, sub-blocks (F1/F2 under F) |
| C-ADM-14 | `/admin/truck-destinations`, `/admin/process-links`, `/admin/legal-forms`, `/admin/expense-template`, `/admin/packing-templates` | Each loads; open a packing template modal and **Cancel** |
| C-ADM-15 | `/admin/shipment-settings` → sheet rows → move **Notes (Arap)** one position up → reload | Order persists; move it back |
| C-ADM-16 | Same → toggle **lock** on **Gadam's note** → as t_export_manager the Sheet cell is read-only → unlock | Lock respected |
| C-ADM-17 | `/admin/fleet` → **Trucks** → **Add Truck**: plate `E2E-998`, model `MAN TGX`, upload a JPG under **Tech Passport** → save | Truck listed; file listed under Tech Passport; delete the file; **Deactivate** |
| C-ADM-18 | **Trailers** → Add Trailer `E2E-T998` → Deactivate | Works |
| C-ADM-19 | **Drivers** → **Add Driver** `E2E Driver`, phone, **Passport Serial** `I-AN 9999998`, **Passport Issue Date**, upload JPG | Saved; scan listed; search finds it by passport; Deactivate |
| C-ADM-20 | `/admin/feedback` (after X-05) | Ticket "E2E test ticket" from t_seller: screenshot thumbnail opens; **Reply** → status In Review; mark public; **Resolved** |
| C-ADM-21 | `/` Dashboard → **Export Excel**; **New Shipment** → modal → Cancel | `.xlsx` downloads; modal fields Country, Customer, Skip prep switch |
| C-ADM-22 | `/export/shipments` → Filters drawer (country / customer / firm / pending) → chips → Clear all; **My Work**; **Show cancelled** / **Show deleted** | Table updates each time; export `xlsx` works |
| C-ADM-23 | `/export/shipments` → select 2 rows → **Transition selected** → modal → Cancel | Modal lists target status + comment |
| C-ADM-24 | `/export/shipments` → **New Shipment** → Country `Kazakhstan`, Customer any → **Create** | Toast "Draft created — assign destination…"; record `SCRATCH_1` |
| C-ADM-25 | `/shipments/<SCRATCH_1>` → **Delete draft** → confirm | Toast "Draft deleted"; gone from list |
| C-ADM-26 | `/export/shipments/board` | Columns by phase, filters (country, customer, owner role, Gapy); card click opens detail |
| C-ADM-27 | `/export/shipments/dashboard` | Loads with filter and detail slide |

### C-BOSS — t_boss

| ID | Do | Expected |
|----|----|----------|
| C-BOSS-01 | Land on `/boss/dashboard`; **Edit mode** off by default | Header shows **View** selected; dashboard read-only badge |
| C-BOSS-02 | `/export/quota` → all tabs (Issuance Log, Firm Breakdown, Firm Chart, Weekly Trend, Local Sell Plan, Quota Usage) + period filter Full Season / Month / Week / Custom | Every tab renders data, no error toast |
| C-BOSS-03 | `/shipments/ID_B` | No **Cancel shipment** button (or it 403s) — boss is not in the cancel set |
| C-BOSS-04 | `/admin/firms` | Reference screens open read-only: no Add/Edit/Delete controls rendered |
| C-BOSS-05 | Sheet → edit **Gadam's note** on CODE_B after switching to Edit mode | Saved (boss bypasses per-step gates); audit row shows t_boss |

### C-DIR — t_director

| ID | Do | Expected |
|----|----|----------|
| C-DIR-01 | `/export/overdue` → click a row | Overdue report drawer opens |
| C-DIR-02 | `/export/shipments` → **New Shipment** → create `SCRATCH_2` | Draft created |
| C-DIR-03 | `/shipments/<SCRATCH_2>` → **Cancel shipment** → reason `E2E` → confirm | Toast; status **Cancelled**; list shows it only with **Show cancelled** |
| C-DIR-04 | `/shipments/<SCRATCH_2>` → **Delete draft** | Button absent or refused (admin-only, and it is no longer a draft) |
| C-DIR-05 | `/admin/permissions`, `/admin/users` | `/unauthorized` |
| C-DIR-06 | `/export/advances`, `/export/prices` | Open with data |

### C-EM — t_export_manager

| ID | Do | Expected |
|----|----|----------|
| C-EM-01 | `/export/drafts` → **Enter Forecast** → Today → block `B` = `20000` → Save | Toast "1 block(s) saved" |
| C-EM-02 | **Create Draft** → composer: Shipment Code (or leave auto), add row block `B` allocate `18100` → **✓ Save as Draft** | Toast "Draft created: <code>"; card with freshness **today** (green). Record `DRAFT_POOL` |
| C-EM-03 | `/export/assign` | DRAFT_POOL in Supply column; Demand column lists contracts / quota gaps / waiting; select supply + a demand → Match panel shows compatibility text; **Clear** (do not Assign) |
| C-EM-04 | `/export/plan` → current week → block A **Plan** cell for tomorrow → `5000` | Toast "Plan saved" (EM may edit); **Truck Allocation** and **Pivot** toggles work; **Initialize Week** must NOT be pressed |
| C-EM-05 | `/export/trucks`, `/export/blocks`, `/export/pomidor-dukany`, `/export/domestic-sales` | Each loads with season data |
| C-EM-06 | `/export/quota/add-issuance` | Form opens; **Cancel** without saving |
| C-EM-07 | Sheet → **Settings** → Design **iOS (Tırlar)** → Done → Classic again | Skin switches; same rows and permissions |
| C-EM-08 | Sheet → Settings → **Group rows by role** on/off; **Show the "Who" column** off/on; Freeze rows/cols | Layout follows each setting; persists on reload |
| C-EM-09 | Sheet → select CODE_B column → **Comments** → write `E2E @t_document_team please check` (use the @ mention popover) → Send | Toast "Comment added"; comment marker on the column; t_document_team later gets a "You were mentioned" notification (check in C-DOC-04) |
| C-EM-10 | Sheet → cell menu → **Cell color** → pick a preset → reload | Colour persists; **Clear color** removes it |
| C-EM-11 | Sheet → cell **Gadam's note** `E2E copy` → Ctrl+C → another editable text cell → Ctrl+V | Value pasted and saved; Ctrl+Z shows "This change can't be undone" or undoes — record |
| C-EM-12 | Sheet → cell menu → **Show edit history** on **Loading Start** of CODE_B | Modal lists the L-23 edit with `t_loading_dept_head` |
| C-EM-13 | `/admin/sales-rep-coverage` | Table loads; shows `CUSTOMER_SR → sales_rep` |
| C-EM-14 | `/admin/shipment-settings` | Opens (EM holds this one admin page) |
| C-EM-15 | `/admin/users`, `/admin/permissions`, `/director/stuck-shipments` | `/unauthorized` |

### C-DOC — t_document_team

| ID | Do | Expected |
|----|----|----------|
| C-DOC-01 | Sidebar | Same as export_manager (A-10) |
| C-DOC-02 | `/admin/firms` → open a firm → edit a text field → save → revert | Saves (document_team holds reference-data write) |
| C-DOC-03 | `/admin/packing-templates` → **Add** a template `E2E-PACK` → save → delete it | Create + delete allowed |
| C-DOC-04 | Bell | Notification "You were mentioned" from C-EM-09; click opens the Sheet/comment |
| C-DOC-05 | Sheet → **Truck / Trailer Plate** on CODE_B → Enter | No editor (transport row) — expected refusal |
| C-DOC-06 | `/documents` → a truck with **Setup needed** → **Fill packing** / **Link contract** links | Each navigates to the Sheet cell / contract picker |

### C-LDH — t_loading_dept_head (then repeat marked rows as deputy)

| ID | Do | Expected |
|----|----|----------|
| C-LDH-01 | `/export/harvest-board` → today → block A **Today's Planned Harvest** = `18000`, **Note** `E2E` | Toast "Saved"; Entered / Entered Date filled; Prev/Next day navigate |
| C-LDH-02 | `/export/plan` | Grid visible; own edits allowed as per role (record whether Plan cells are editable) |
| C-LDH-03 | `/admin/fleet` → Trailers → Add `E2E-LD998` → Deactivate | Allowed (fleet editor) |
| C-LDH-04 | `/admin/users` → **+ New User** | Role dropdown offers **only** Loading Dept Deputy and Packer; create `t_e2e_wm` (Packer) → appears → **Delete** |
| C-LDH-05 | `/admin/staff-access` → grant **Trucks** to role Loading Dept Deputy → Save | Toast saved; deputy sees **Trucks** in A-02 re-check; revoke and Save |
| C-LDH-06 | `/export/drafts` → **Enter Forecast** | Allowed |
| C-LDD-01 | as `t_loading_dept_head_deputy`: `/admin/users`, `/admin/staff-access` | `/unauthorized` |
| C-LDD-02 | deputy: Sheet → **Loading Start** on a draft column | Editor opens (deputy holds the row) |

### C-WC — warehouse_chief

| ID | Do | Expected |
|----|----|----------|
| C-WC-01 | `/export/shipments` → **Supply Draft** button → weight `18100`, blocks `C`, variety, harvest status → **Create Supply Draft** | Toast "Supply draft created: <code>" (F13 was a doc error, not a bug). Record `SCRATCH_3` |
| C-WC-02 | `/shipments/<SCRATCH_3>` → **Join supply** | Modal lists supply drafts; Cancel |
| C-WC-03 | `/export/weightmaster` | Queue visible; pallet manifest editable |
| C-WC-04 | `/export/harvest-board` | Editable as in C-LDH-01 |
| C-WC-05 | any `/admin/*` except `/admin/fleet` | `/unauthorized`; `/admin/fleet` opens |

### C-WM — t_weight_master

| ID | Do | Expected |
|----|----|----------|
| C-WM-01 | `/export/weightmaster` → **Upload weightmaster Excel** | File chooser opens. No sample file in the repo → SKIP the upload unless the user supplies one |
| C-WM-02 | `/shipments/ID_B` | Detail read-only; **no** Change Status / Promote / Cancel controls |
| C-WM-03 | `/export/shipments` | No row checkboxes / no **Transition selected** |
| C-WM-04 | Sheet | No cell opens an editor |

### C-TR — transport

| ID | Do | Expected |
|----|----|----------|
| C-TR-01 | Sheet → **Documents (13:00)** on any column | No editor |
| C-TR-02 | `/export/shipments/board` | Board loads; filter by owner role **Transport** |
| C-TR-03 | `/admin/fleet` | Record: `/unauthorized` (seeded) or opens (build note lists transport as fleet editor) |
| C-TR-04 | `/transport/map` → search box → a plate | Pin highlighted; "Last fix" shown |

### C-SR — sales_rep

| ID | Do | Expected |
|----|----|----------|
| C-SR-01 | `/export/my-reports` → tab **All my shipments** | Only shipments of `CUSTOMER_SR` (and none of others) |
| C-SR-02 | `/export/shipments` vs Sheet | Both scoped to the rep's customers; record the two counts |
| C-SR-03 | `/export/sales-reports/ID_B` → **Processing** tab | Per-block loss table shows block A; USD totals |
| C-SR-04 | `/export/advances` | Opens (rep holds Advances) — record whether create is offered |
| C-SR-05 | `/` | Record: redirect or blank Dashboard (live matrix has no dashboard for the rep) |

### C-FIN — t_finansist

| ID | Do | Expected |
|----|----|----------|
| C-FIN-01 | `/export/advances` → filter All / Pending / Reconciled | Lists; totals update |
| C-FIN-02 | `/export/prices` → enter a second city price | Saved (finansist in PRICE_WRITE) |
| C-FIN-03 | `/export/my-reports` | `/unauthorized` |
| C-FIN-04 | Sheet → **Sale Start** on CODE_B | No editor |

### C-ACC — t_accountant

| ID | Do | Expected |
|----|----|----------|
| C-ACC-01 | Sidebar while C-ADM-04 is un-ticked | No **Work hours**; after re-tick it is back |
| C-ACC-02 | `/export/advances`, `/export/prices` | `/unauthorized` |
| C-ACC-03 | `/export/harvest-board` → try to edit block A | Read-only |

### C-GM — t_greenhouse_manager (needs S-05)

| ID | Do | Expected |
|----|----|----------|
| C-GM-01 | `/export/plan` → current week | Row for block **OG** editable (Plan cell → `3000` → "Plan saved"); every other block row read-only |
| C-GM-02 | `/export/harvest-board` | Only OG editable (or all read-only — record) |
| C-GM-03 | `/export/domestic-sales` | Loads; totals and unique buyers |
| C-GM-04 | `/export/shipments/sheet`, `/export/shipments/board` | `/unauthorized` |
| C-GM-05 | `/me/board` | Weekly-plan task card (**Fill the weekly plan**) if the week is open; opening it goes to the plan, not a shipment |

### C-SEL — t_seller

| ID | Do | Expected |
|----|----|----------|
| C-SEL-01 | `/export/quota` → current week grid | If the week has rows: double-click one firm/day cell → `500` → leave the cell → autosave; status chip becomes **Submitted**, hint "Sent for approval". If the week is not initialised: **do not** press Initialize Week → SKIP |
| C-SEL-02 | Same page | No Issuance/Firm tabs, no KPI cards, no Add issuance |
| C-SEL-03 | `/transport/map`, `/export/shipments`, `/export/plan` | `/unauthorized` ×3 |
| C-SEL-04 | Feedback FAB → see X-05 | |

---

## 6. Part D — Cross-cutting

| ID | Role | Do | Expected |
|----|------|----|----------|
| X-01 | any | Language control TM → RU → EN | Sidebar labels change each time; reload keeps the last choice; Sheet row labels stay in profile language (F24, record) |
| X-02 | t_export_manager | Season switcher → the closed season from S-02 | Banner "Viewing closed season … — read-only"; Sheet cells not editable; **Back to active season** restores |
| X-03 | t_document_team | Bell after L-01/L-04 | Unread badge; list shows action-required items with shipment codes; **Mark all read** → badge 0 |
| X-04 | any | Worklog chip | "Today: hh:mm" grows after ~2 min of activity; `/worklog` shows "My last 7 days" and the team table; `/team/kpi` ranking with period filter |
| X-05 | t_seller | Floating button → modal **Submit Feedback** → Type **Bug**, Description `E2E test ticket`, attach a PNG → **Submit** | Success; `/feedback/my-tickets` lists it as **New**; after C-ADM-20 the reply and status **Resolved** show; `/feedback/public` shows it once marked public |
| X-06 | t_seller | `/feedback/submit` | Same form as a page, with screenshot instructions |
| X-07 | any | Header connection dot | Green/connected; a Sheet open in the same session shows presence avatars for the current user |
| X-08 | any | Resize viewport to 400 px | Login page and Dashboard usable; sidebar collapses behind **Toggle navigation** |
| X-09 | any | `/does-not-exist` | Redirects to `/` |
| X-10 | logged out | Log in as `t_e2e_tmp` with a wrong password **once** (before C-ADM-03) | Toast "Sign in failed" + "Invalid username or password"; then log in correctly. Never a third failure |
| X-11 | logged in | Visit `/login` | Redirected away from the login page |
| X-12 | logged in | `browser_evaluate`: `Object.keys(localStorage).join(',')` | No token/JWT key; auth is the httpOnly cookie only |
| X-13 | logged out | `GET http://localhost:8000/api/v1/auth/me/` without cookies | 401 |
| X-14 | t_export_manager | `/shipments/ID_B` → **Discussion** → post a comment with Ctrl+Enter | Comment listed with role badge; count in **Comments (n)** tab increments |

---

## 7. Part E — Negative / security checks (each must be refused)

A success here is a security finding. Record loudly.

| ID | Role | Attempt | Expected |
|----|------|---------|----------|
| N-01 | t_weight_master, t_accountant, t_seller, t_greenhouse_manager | `/shipments/<any draft id>` → any **Change Status** / **Promote** control | Absent, or error toast "Transition failed / not allowed" |
| N-02 | t_document_team, t_boss | **Cancel shipment** on `SCRATCH_3` | Absent or 403 |
| N-03 | t_boss, t_director, t_export_manager | **Delete draft** on `SCRATCH_3` | Absent or 403 (admin only) |
| N-04 | admin | **Delete draft** on `ID_B` (Completed) | Absent — nobody hard-deletes a non-draft |
| N-05 | t_boss, t_director, t_export_manager, t_document_team | `/admin/permissions` by URL | `/unauthorized` |
| N-06 | t_loading_dept_head_deputy | `/admin/users`, `/admin/staff-access` | `/unauthorized` |
| N-07 | t_accountant | `/export/advances` | `/unauthorized` |
| N-08 | t_seller | `/transport/map` | `/unauthorized` |
| N-09 | t_greenhouse_manager | `/export/shipments` | `/unauthorized` |
| N-10 | t_greenhouse_manager | Weekly plan cell of block A | Read-only |
| N-11 | sales_rep | Sheet cell **Loading Start**; a shipment of a customer that is not `CUSTOMER_SR` | No editor; the other shipment is not listed at all |
| N-12 | transport | Sheet **Export Firm** cell | No editor |
| N-13 | t_weight_master | `/export/shipments` → **Deactivate (soft delete)** on `SCRATCH_3` | **Succeeds** (open action by design) — record; then admin **Show deleted** → **Restore** |
| N-14 | t_loading_dept_head | `/admin/users` → try to create a user with role Export Manager | Role not offered / 403 |
| N-15 | t_export_manager | `/admin/permissions` → any Save | Never reached (page denied) |
| N-16 | any non-admin | `/admin/feedback` | `/unauthorized` (boss: record if it instead shows an empty inbox — misleading, known) |

---

## 8. Cleanup — as `admin` (then the delegated roles where noted)

| ID | Do | Expected |
|----|----|----------|
| K-01 | `/export/shipments` → **Show deleted** → restore anything you soft-deleted; then **Delete draft** on `SCRATCH_3` and any other draft you created (`DRAFT_POOL`) | Gone |
| K-02 | `SCRATCH_2` (cancelled by director) cannot be hard-deleted — leave it and list it in the report | — |
| K-03 | `ID_B` (`CODE_B`, Completed, export seq 998) stays as a real completed row | List it; ask the user whether to cancel/archive |
| K-04 | `/admin/sales-rep-coverage` → set `CUSTOMER_SR` back to its previous rep (empty) | Reverted |
| K-05 | `/admin/blocks` → restore `PREV_MGR_OG` on block OG | Reverted |
| K-06 | `/admin/permissions` → accountant → **Work Hours** ticked → Save | Matches the state before C-ADM-04 |
| K-07 | `/admin/users` → delete `t_e2e_tmp` (and `t_e2e_wm` if C-LDH-04 left it) | Gone |
| K-08 | `/admin/fleet` → E2E truck, trailer(s), driver are deactivated | Yes |
| K-09 | `/contracts` → delete `CONTRACT_E2E` if the Delete control is enabled; if the tooltip says it is in use, leave it and list it | — |
| K-10 | `/admin/firms` → the PNG from C-ADM-10 removed; `/admin/packing-templates` → `E2E-PACK` removed | — |
| K-11 | Forecast (C-EM-01), harvest board (C-LDH-01), plan cells (C-EM-04, C-GM-01), price entries (L-46, C-FIN-02), the advance (L-45) and the seller's sell-plan cell (C-SEL-01) have no delete UI | List every value you wrote with page + cell so the user can revert by hand |
| K-12 | `/admin/feedback` → E2E ticket resolved | Yes |

---

## 9. Reporting

Write `docs/E2E_RESULTS_<YYYY-MM-DD>.md` with:

1. Header: stack used (local/beta), DB, commit hash, start/end time, agent + browser.
2. One table row per step ID, in order: `ID | Role | Result | Actual / evidence`. Result ∈
   PASS / FAIL / BLOCKED / SKIP. For FAIL: toast text, URL + HTTP status of the failing call,
   screenshot filename, console error if any.
3. "Left in the database": every object from section 8 that could not be removed, with codes
   and ids.
4. "Findings": each FAIL that is not in §0.5, written as `F<next number> — <severity> —
   <one sentence> — <step id>`, appended under a new dated heading in
   [FINDINGS_BACKLOG.md](FINDINGS_BACKLOG.md).
5. Which `BUILD_TEST_LOG.md` entries were exercised (2026-09-16 permissions save, 2026-09-12
   packing weight, 2026-09-11 CMR six entries + TIR carnet, 2026-09-10 firm doc fields /
   Signature & Seal / one-time contract type first / stamps dropdown / invoice packing share,
   2026-09-09 driver passport + truck model / document_team parity / F25-F26-F27 fixes,
   2026-09-01 harvest board write gate / F12 / F18 / F19) and their result. Do **not** tick
   them off — the user does that.

Do not summarise PASS rows in prose; the table is the deliverable.
