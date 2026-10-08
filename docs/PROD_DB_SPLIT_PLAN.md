# Prod / Dev DB split + prod cleaning — 2026-10-05

Snapshot of `YIGIT_PLATFROM_NEW` @ 10.10.11.233\YIGIT (110 tables, 35 333 rows). Read-only query, nothing changed.

## State now
- ONE database for dev (local `backend/.env`) and beta (10.10.11.25). Every local migration/command hits live data.
- Other DBs on the server: `YIGIT_PLATFROM` (Apr 2026, old schema, 69 tables, holds Logo import `LG_581_*` 341k rows — do not touch), `test_YIGIT_PLATFROM` (`YigitUser` cannot log in).
- `YigitUser` has NO `dbcreator` / `CREATE ANY DATABASE` → cannot create or rename a DB. Needs a sysadmin (SSMS).
- Server-wide backup of `YIGIT_PLATFROM_NEW` runs nightly (last seen 2026-10-02 03:11).

## Plan
1. Fresh `COPY_ONLY` backup of `YIGIT_PLATFROM_NEW` (sysadmin).
2. Restore it as `YIGIT_PLATFROM_DEV`; grant `YigitUser` db_owner on it (sysadmin).
3. Local `backend/.env` → `DB_NAME=YIGIT_PLATFROM_DEV`. Server `.env` stays `YIGIT_PLATFROM_NEW` (= prod). No rename (see below).
4. Clean prod (bucket B below) — only after the user confirms the list.
5. New migrations (0094, contracts 0015/0016 …) are already applied to the shared DB. After the split they apply to DEV only; prod gets them on deploy (`migrate`), new NOT NULL columns need DB DEFAULT.

## Why not rename
`ALTER DATABASE … MODIFY NAME` needs sysadmin + exclusive access (beta users kicked), then server `.env` `DB_NAME`, local `.env`, backup jobs must all change at once. Gain: fixing a typo. Keep the name.

## Composition — rows per bucket

### A. KEEP (reference / config)
users `sys_users` 83 · `core_export_firms` 25 · `core_import_firms` 118 · customers 9 (+links 5) · countries 12 · cities 28 · border points 5 · varieties 19 · greenhouse blocks 20 · product types 4 · crate types 3 · loading locations 3 · destinations 4 · status types 17 · option types 33 · legal types 12 (+25) · seasons 2 · greenhouse_config 1 · expense categories 21 · `export_task_rule` 49 · role perms (page 1071, resource 205, field 147) · `auth_permission` 436 · `django_content_type` 108 · `django_migrations` 240 · `contracts_invoice_number_base` 8 (**numbering counters**) · packing templates 9 (+15 shares) · block manager assignments 16 · truck split defaults 3 · process node links 20 · fleet: transport trucks 124, heads 92, trailers 74, drivers 153, traccar devices 125, geofences 44 · sheet row settings/triggers (53/278)

### B. CLEAN CANDIDATES (operational — decide what is real)
| Group | Tables (rows) |
|---|---|
| Shipments | shipments 168, firm_splits 165, block_sources 164, varieties_dominant 172, truck_destination_splits 650, status_log 616, comments 8, document_download 31 |
| Contracts/finance | contracts_contract 120, contract_sale 51, customs_expenses 213, finansist_advances 33 (+15), sales_reports 9 (+lines 6, expenses 29), pallets 8 |
| Quotas | quota_issuances 30, firm_allocations 200, usage_records 732 |
| Plans | weekly_harvest_plans 643, harvest_day_entries 3960, weekly_local_sell_plans 398, weekly_truck_allocations 245, destination_selections 7, plan_change_requests 2 |
| Tasks | export_task 1785, notifications 3250 |
| Quality | quality_documents 21, certificates 9 |
| Transport ops | external_trips 15, device_positions 93, driver/head documents 2/66 |
| Feedback | tickets 37, replies 6, attachments 3 |
| Per-user UI | user_sheet_row_pref 669, sheet_row_user_permission 2 |

### C. NOISE (safe to purge, no business value)
`core_work_sessions` 8837 · `export_audit_log` 5987 · JWT `outstandingtoken` 1363 / `blacklistedtoken` 591 · `axes_*` 184 · `django_session` 17

## Open questions for the user
- Which of B is real production data (staff used beta since 2026-05) and which is test?
- Are the 83 users all real?
- Wipe whole B, or only up to a date / only specific groups?
- Media files (`backend/media`, server `./backend/media`) — clean too?
