# Sheet Lifecycle E2E — Playwright Walk, 2026-09-08/09

> Russian version: [SHEET_LIFECYCLE_E2E_2026-09-08.ru.md](SHEET_LIFECYCLE_E2E_2026-09-08.ru.md)

Live run against `YIGIT_PLATFROM_NEW` @ `10.10.11.233\YIGIT` via `localhost:3000`.
Footprint approved by the user: full 12-step walk, real role account per step.

**Subject:** shipment **714 / `0809002/26`**, export code `08|SP|999|A|26|02` — reached
`tamamlandy` (step 12). Supply draft **713 / `0809001/26`** was hard-deleted by the Join.
Tagged with sequence `999` so it is findable.

**Reference-data change made and reverted:** `Customer "Begjan".sales_rep` set to user 4
for the duration of steps 5–11, restored to `NULL` afterwards. Verified.

---

## 1. Result per stage

| Stage | Field(s) | Role used | Result |
|-------|----------|-----------|--------|
| Stage 0 supply | export_code, block_sources, weight-to-load, harvest_status, harvest_date | `t_loading_dept_head` | ✅ all 5 saved |
| Stage 0 dest | country, customer, import_firm | `t_export_manager` | ✅ gate 1 |
| Join | supply → destination | `t_export_manager` | ✅ merged, 713 deleted — **but 3 fields lost, see F25** |
| Gate 2 | firm_splits = YIGIT HJ | `t_document_team` | ✅ |
| Gate 3 | truck_plate, driver_name, driver_phone | `transport` | ✅ |
| Gate 4 | documents_status = ready | `t_document_team` | ✅ **auto-advance draft → gumruk_girish** |
| 1 → 2 | customs_exit_at | `t_document_team` | ✅ gumruk_chykysh |
| 2 → 3 | loading_started_at | `t_loading_dept_head` | ✅ yuklenme |
| 3 | loading_ended_at, weight_net, variety | `t_loading_dept_head` | ✅ saved |
| 3 → 4 | departed_at | `transport` | ✅ yola_chykdy |
| 4 → 5 | border_crossed_at | `transport` | ✅ serhet_gechdi |
| 5 → 6 | dest_entry_at | `sales_rep` | ✅ dest_entry |
| 6 → 7 | customs_entry_at | `sales_rep` | ✅ barysh_gumrugi |
| 7 → 8 | has_peregruz + peregruz_date | `sales_rep` | ⚠️ cell saves, but drives no transition — **F29** |
| 7 → 9 | arrived_at | `sales_rep` | ✅ barysh_gumrugi → transshipment → bardy (cascade, one save) |
| 9 → 10 | city, sale_started_at | `sales_rep` | ✅ satylyar |
| 10 → 11 | sale_ended_at | `sales_rep` | ✅ satyldy |
| 11 → 12 | sales_report_date | `sales_rep` | ⚠️ cell saves, but drives no transition — **F30** |
| 11 → 12 | sales report attached | `sales_rep` (not finansist — **F31**) | ✅ tamamlandy |

**Every transition in the chain fired** — `ShipmentStatusLog` for 714 records all twelve,
`is_auto=True`, `draft → … → tamamlandy` with no gaps.

What failed is narrower: **two cells the spec names as triggers drive nothing.**
`peregruz_date` (F29) and `sales_report_date` (F30) save fine, but no task consumes either,
so neither advances the shipment. The chain got past both by other means — `arrived_at` and
the attached sales report.

---

## 2. Findings

### F24 — Sheet row labels ignore the language toggle *(cosmetic, high visibility)*
With the header toggle on **EN** and `document.documentElement.lang === "en"`, every
col-3 label renders in **Turkmen**. The Sheet reads `current_user_lang` from the user
profile (`tk`) instead of the active i18n language:
`SheetLabelColumn.tsx:95` — `const dbLabel = setting?.labels?.[currentUserLang];`
Chrome, dropdown *options* and everything else follow the toggle, so the sheet renders
half English / half Turkmen. Reproduced on 4 accounts. May be deliberate; the
inconsistency with the rest of the UI is the defect either way.

### F25 — Join silently discards three supply fields *(data loss, confirmed in code)*
`_execute_join` (`backend/apps/export/views.py`) builds
`update_fields = {variety_id, export_code, weight_net, updated_by_id}` only. The source
row is then hard-deleted. So `harvest_date`, `harvest_status` and `rejected_weight_kg`
— three of the five cells Stage 0 asks Soltanmyrat to fill on the supply column — are
lost with no warning. Verified on 714: all three are still `NULL` at `tamamlandy`.

### F26 — Two `documents_status` options both read "OK"; the wrong one stalls the truck
| code | EN | TK | renders as |
|------|----|----|------------|
| `ok` | OK | **Taýýar** | `OK OK` (its `icon` column literally contains the text "OK") |
| `ready` | OK | **OK** | `OK` |

The gate is `TaskRule(step=draft, completion_rule=field_equals, target_value='ready')`.
So the option that reads **"Taýýar" (= Ready)** in Turkmen is the one that does **not**
satisfy the gate. An operator picking it leaves the shipment in `draft` with no feedback.
This is the FIELD_EQUALS trap. Live counts: `ready` 82 · `NULL` 74 · `in_progress` 9 ·
**`ok` 3**.

**Correction (checked 2026-09-09):** an earlier draft of this report claimed those 3 are
stuck *because of* this. They are not. 639 (`1206001/26`, season 2025-2026) has no customer
and no import_firm, so gate 1 is open too; 702 (`2808009/26`) has gate 1 complete but no
driver / phone / plate, so gate 3 is open. Both would stay in `draft` regardless of the
`documents_status` value. 684 (`2008880/26`) sits on `ok` yet already reached
`gumruk_girish`, so it advanced by some other route.

So the defect is **latent, not currently blocking**: the moment those other gates are
filled, whoever picked the Turkmen-looking "Taýýar" will silently not advance. No code
references either value — `'ok'` and `'ready'` appear nowhere in `backend/apps` outside the
`TaskRule` row, so the ambiguity is entirely fixable in data.

### F27 — Empty labels in `SheetRowSetting`
`firm_contracts` (R47) — EN **and** TK blank. `packing` (R48) — owner, EN and TK all
blank. `rejected_weight_kg` (R36) — EN blank (TK reads "Ýüküň agramy", not the
"Ýüklemeli tonna" the spec expects).

### F28 — `sales_rep` sees 0 shipments on the Sheet *(data gap, blocks 7 of 12 steps)*
`views.py:1401`: `if role == 'sales_rep': qs = qs.filter(customer__sales_rep=request.user)`.
In live data **7 of 8 customers have `sales_rep = NULL`**; only customer "Arap" is
assigned, and to user `begjan`. So for almost every real shipment the Sheet is empty for
every sales rep, and steps 5–11 cannot be driven by the role that owns them.
`/shipments/` returns 16 rows for the same user — only `/shipments/sheet/` is empty.
The scoping is deliberate; the missing assignments are not.

### F29 — the Peregruz cell drives nothing once the step has been entered *(downgraded)*
Both task rules exist and are correct — `tasks.trigger_transshipment`
(`has_peregruz == 'True'` → `peregruz_date`) and `tasks.trigger_arrival_direct`
(`has_peregruz == 'False'` → `arrived_at`). The condition is evaluated **when the step is
entered**, so on entering `barysh_gumrugi` with `has_peregruz` still false only
`trigger_arrival_direct` was created. Flipping Peregruz = Yes and filling Peregruz wagty
afterwards therefore advances nothing: the task that would have consumed `peregruz_date`
was never generated. `sales_rep` also has no manual fallback — `/export/shipments/<id>`
redirects to `/` for that role.

**Correction (checked 2026-09-09):** an earlier draft of this report said filling Arrival
"jumps straight to `bardy`, skipping `transshipment` entirely". That is wrong. The
`ShipmentStatusLog` for 714 records `barysh_gumrugi → transshipment → bardy` (rows 598,
599, 600), all `is_auto=True`. `_resolve_next_status` does honour the predicate and picked
`transshipment` correctly; the cascade then passed through it in the same save because its
own trigger (`arrived_at`) was already satisfied by that write. Nothing was skipped and the
audit trail is complete.

So the real defect is narrow: **a conditional task is not regenerated when its condition
field changes after step entry**, which makes `peregruz_date` a field nobody is ever asked
for. The truck still completes its lifecycle correctly. Severity accordingly HIGH → LOW.
The fix would be to re-run task generation for the current step when a `condition_field`
value changes (`has_peregruz`, `is_gapy_satys` — the other conditional rules use the same
mechanism and have the same exposure).

### F30 — Step 11 as specified does not advance
The `satyldy` TaskRule targets `sales_report` (the attached report), **not**
`sales_report_date`. Filling Report Date (R43) saves but never fires the transition.
Steps 11 and 12 are effectively one step: attach the report.

### F31 — `t_finansist` cannot complete the lifecycle it owns
Both the spec and `ROLE_PROCESS_TEST_PLAN` give `satyldy → tamamlandy` to `finansist`.
`t_finansist` has no "Sales Reports" menu entry, and `/export/sales-reports/…` and
`/export/shipments/<id>` both redirect to `/`. The final step had to be done by
`sales_rep`.

### F32 — Owner disagreements between the three sources
`departed_at` (R21): spec says transport (Mergen) · TaskRule says `document_team` ·
`SheetRowSetting.who` says "Soltanmyrad". `firm_contracts` (R47): spec says Gadam,
row setting says "Shohrat". `vehicle_condition` (R3): i18n default "Logist", row
setting "Transport". Typo "Soltanmyra**d**" vs "Soltanmyra**t**" on R21 and R36.

### F33 — Sheet cells under the sticky frozen band are unclickable
Rows in `sheet-scrollable-bottom` scroll *under* the sticky frozen section and stay
hit-testable in the DOM while a frozen row sits on top. Clicking activates the
overlaying row instead. Reaching those cells needed keyboard navigation throughout.

### F34 — Minor
- 21 of 25 export firms are disabled ("⚠ no quota") for season 2026-2027 — expected under the quota rules, but only 4 firms are selectable.
- Datetime cells: typing a value then confirming stamps *now*, discarding the typed value.
- Column headers carry `aria-disabled="true"` in join mode (a11y).
- Sheet fires `/admin/seasons/` and `/admin/firms/` as `loading_dept_head` → 403 ×2 each, twice per load.
- `status_step` does not track the real order (`yuklenme` reports step 1) — already documented in `ROLE_PROCESS_TEST_PLAN` §1.

---

## 2b. Delta vs the spec table you supplied

Rows where the label that actually renders differs from the spec (rendered value wins):

| R | Spec said | Renders as (TK) |
|--:|-----------|-----------------|
| 7 | Shipment Code / **Iberiş kody** | **Ýük kody awto** (EN "Shipment Code auto"; owner is "System", not Soltanmyrat) |
| 9 | Export Firm / **Eksport eden Firma** | **Eksport eden Firmalar** (plural) |
| 15 | — | **Maşynyň ýerleşýän ýeri** (i18n default was "Maşynyň şuwagtky ýagdaýy") |
| 23 | Maşyn**–**Tyr belgisi | Maşyn **/** Tyr belgisi |
| 36 | Weight to load / **Ýüklemeli tonna** | EN **blank**, TK **Ýüküň agramy**; owner "Soltanmyra**d**" |
| 37 | Net Weight / **Arassa agramy** | Net Weight **(shipped)** / Arassa agramy **(h)** |
| 46 | **Eksport** kody | **Export** kody |
| 47 | Contracts / **Şertnamalar** | **blank / blank**; owner "Shohrat", not Gadam |
| 21 | Mergen (transport) | owner reads "Soltanmyra**d**" |

Everything else in your table matched. R47 does carry two rows as you listed
(`firm_contracts` + `is_gapy_satys`), and R16 is intentionally absent.

---

## 2c. What this run leaves in live data

- Shipment **714** is a complete, real `tamamlandy` row in season 2026-2027.
- Its **18 100 kg on block A** now rolls up as *exported* into the week of 2026-09-08
  weekly-plan actuals.
- It carries `has_peregruz = true` and **`transshipment` is recorded** in its status log
  (rows 598→599→600), so this is an ordinary completed row, not an impossible state.
- `harvest_date`, `harvest_status`, `rejected_weight_kg` are permanently `NULL` (F25).
- A `SalesReport` exists: 1 line, `quantity_kg` 18 100, `price_local` 1.20,
  `amount_local` / `total_sales_local` / `net_income_local` 21 720 KZT, expenses 0,
  `product_name` NULL. Values verified after saving — nothing landed in a margin or
  expense column.
- Audit rows, ~16 Tasks and Notifications across all 12 steps.
- Supply draft **713** is gone (hard-deleted by Join, as designed).

Say the word if you want it cancelled or archived.

---

## 3. Every row, its owner, and the col-3 label (EN / TK)

Authoritative source is `SheetRowSetting` (DB), which **overrides** the i18n keys in
`sheet_rows.py`. `pos` = display order; `R` = the `row_number` used by the spec.
Row 16 is intentionally absent. R47 genuinely holds two rows (`firm_contracts`, `is_gapy_satys`).

| pos | R | field_key | Owner (col 2) | Label EN (col 3) | Label TK (col 3) |
|----:|--:|-----------|---------------|------------------|------------------|
| 1 | 3 | `vehicle_condition` | Transport | Truck Status | Maşynyň ýagdaýy |
| 3 | 6 | `documents_status` | Sirin | Documents (13:00) | Resminamalar (13:00) |
| 4 | 5 | `export_manager_note` | Gadam J | Gadam's note | Gadam J belligi |
| 5 | 4 | `transport_docs_given_at` | Sirin | Transport dept documents | Transport bölümiň resminamalary |
| 6 | 7 | `shipment_code` | System | Shipment Code auto | Ýük kody awto |
| 7 | 8 | `block_sources` | Soltanmyrat | Harvest Block | Ýygylan bölümi |
| 8 | 9 | `firm_splits` | Sulgun | Export Firm | Eksport eden Firmalar |
| 9 | 10 | `country` | Gadam J | Destination Country | Eksport ýurdy |
| 10 | 11 | `customer` | Gadam J | Customer | Müşderi |
| 11 | 12 | `city` | Arap | Destination City | Şäheri |
| 12 | 13 | `import_firm` | Gadam J | Import Firm | Import Firma |
| 13 | 14 | `harvest_status` | Soltanmyrat | Harvest Status | Ýygym ýagdaýy |
| 14 | 15 | `vehicle_live_status` | Haltac | Vehicle Current Position / ETA | Maşynyň ýerleşýän ýeri |
| 17 | 19 | `loading_started_at` | Soltanmyrat | Loading Start | Ýükleme başlady |
| 18 | 20 | `loading_ended_at` | Soltanmyrat | Loading End | Ýükleme gutardy |
| 19 | 17 | `warehouse_note` | Soltanmyrat | Notes (Soltanmyrat) | Bellikler (Soltanmyrat) |
| 20 | 21 | `departed_at` | Soltanmyrad | Greenhouse Departure | Ýyladyşhanadan çykdy |
| 21 | 18 | `document_note` | Sirin | Notes (Şirin) | Bellikler (Şirin) |
| 22 | 22 | `vehicle_responsible` | Transport | Vehicle Responsible | Jogapkär adam |
| 23 | 23 | `truck_plate` | Transport | Truck / Trailer Plate | Maşyn / Tyr belgisi |
| 24 | 24 | `has_doc_advance` | Babageldi | Doc Advance Issued | Resminama puly berildi |
| 25 | 25 | `customs_exit_at` | Sirin | TM Export Customs Done | TM eksport gümrük gutardy |
| 26 | 26 | `transit_days_temp` | Transport | Transit Days & Temp | Ýol güni we temp. |
| 27 | 27 | `driver_name` | Transport | Driver Name | Sürüjiniň ady |
| 28 | 28 | `driver_phone` | Transport | Driver Phone | Sürüji telefony |
| 29 | 29 | `border_point` | Transport | Border Point | Serhet nokady |
| 30 | 30 | `border_crossed_at` | Haltac | TM Border Exit | TM serhedinden çykdy |
| 31 | 31 | `dest_entry_at` | Arap | Destination Entry | Barmaly ýurda girdi |
| 32 | 32 | `customs_entry_at` | Arap | Destination Customs | Baryş gümrügi |
| 33 | 33 | `has_peregruz` | Arap | Transshipment | Peregruz |
| 34 | 34 | `peregruz_date` | Arap | Transshipment Time | Peregruz wagty |
| 35 | 35 | `arrived_at` | Arap | Arrival | Baryp ýetdi |
| 36 | 45 | `customs_clearance_planned_day` | Sirin | Planned customs day | Plan boýunça gümrükleme güni |
| 37 | 36 | `rejected_weight_kg` | Soltanmyrad | **(empty)** | Ýüküň agramy |
| 38 | 37 | `weight_net` | Soltanmyrat | Net Weight (shipped) | Arassa agramy (h) |
| 39 | 38 | `variety` | Soltanmyrat | Tomato Variety | Pomidoryň görnüşi |
| 40 | 39 | `harvest_date` | Soltanmyrat | Harvest Date | Ýygylan senesi |
| 41 | 41 | `sale_started_at` | Arap | Sale Start | Satylyp başlady |
| 42 | 47 | `is_gapy_satys` | Gadam J | Type | Görnüşi |
| 43 | 42 | `sale_ended_at` | Arap | Sale End | Satylyp gutardy |
| 44 | 46 | `export_code` | Soltanmyrat | Export Code | Export kody |
| 46 | 44 | `additional_notes_arap` | Arap | Notes (Arap) | Bellik (Arap) |
| 47 | 47 | `firm_contracts` | Shohrat | **(empty)** | **(empty)** |
| 48 | 48 | `packing` | **(empty)** | **(empty)** | **(empty)** |
| 49 | 43 | `sales_report_date` | Aganazar | Report Date | Hasabat senesi |