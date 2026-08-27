# QA Coverage — uncommitted working tree, 2026-08-27

> **Scope: this diff only.** Everything not committed on `main` as of 2026-08-27
> (40 modified files + 20 untracked, `+1237 / -135`). Not a general test plan —
> the manual scripts are [BROWSER_TEST_SCRIPT.md](BROWSER_TEST_SCRIPT.md),
> [BROWSER_TEST_RU.md](BROWSER_TEST_RU.md), [TEST_IDEAS_RU.md](TEST_IDEAS_RU.md),
> [ROLE_PROCESS_TEST_PLAN.md](ROLE_PROCESS_TEST_PLAN.md). This file answers one
> question: *what does this diff still not test, and what must be run before it
> is committed?*

## 1. Gate — commands to run

⚠️ **The plain backend command below did not run on 2026-08-27 — see the note under
it. Every backend result in this file was produced with the `--settings` overlay,
not with this command.**

```bash
# backend — the four apps this diff touches.
#   DJANGO_TESTING=true is REQUIRED, not optional — see the note below.
#   NEVER --keepdb (see PRE_EXISTING_TEST_FAILURES.md)
cd backend && DJANGO_TESTING=true ./venv/Scripts/python.exe manage.py test apps.export apps.core apps.transport apps.greenhouse --noinput
./venv/Scripts/python.exe manage.py makemigrations --check --dry-run   # 0063 must be the only new one

# frontend
cd frontend && npx vitest run
npx tsc --noEmit --ignoreDeprecations 5.0     # `npm run type-check` is broken (TS5103)
```

> ### `DJANGO_TESTING=true` is part of the command
>
> `core.0002_seed_shipment_option_types` … `0006`, and `export.0002`, seed reference
> rows into the freshly-built test database **unless** `DJANGO_TESTING=true` is set;
> test `setUp` methods then create their own `TomatoVariety` / `ShipmentStatusType`
> rows and collide. Measured 2026-08-27: **omitting it manufactures ~48 phantom
> failures**, all shaped `pyodbc.IntegrityError … Violation of UNIQUE KEY constraint`
> — `tests_official_code_validator` (17), `tests_pallet_manifest` (15),
> `tests_season_services` (7), `tests_supply_draft` (4), `tests_completeness` (2),
> `tests_field_history` (1). That is over half of a 74-failure run, and none of them
> are real. `PRE_EXISTING_TEST_FAILURES.md` §"Category 5" documents the guard but
> the env var appears in no runbook, so the trap is easy to fall into — this note is
> the fix.
>
> **The shared `test_YIGIT_PLATFROM` could not be rebuilt on 2026-08-27** — SQL Server
> answered `Cannot drop database … because it is currently in use (3702)` while
> `sys.dm_exec_sessions` showed zero sessions, because `YigitUser` lacks
> `VIEW SERVER STATE` and therefore only ever sees its own connections. The
> database is `ONLINE`/`MULTI_USER` and dates from 2026-04-30, so something
> long-lived holds it. Rather than force a `SET SINGLE_USER WITH ROLLBACK
> IMMEDIATE` on a shared server, the runs below used a private test database
> via a settings overlay — reusable, and it leaves the shared one untouched:
>
> The overlay is **not in the repo** — it lived in the session scratchpad and must
> be recreated (or committed as `backend/config/settings_qa_test.py`, which would
> make the gate copy-pasteable; not done without an owner decision):
>
> ```python
> # anywhere on PYTHONPATH, e.g. the session scratchpad — qa_test_settings.py
> from config.settings import *          # noqa: F401,F403
> DATABASES['default'].setdefault('TEST', {})
> DATABASES['default']['TEST']['NAME'] = 'test_YGT_QA_20260827'
> ```
> ```bash
> PYTHONPATH=<dir> ./venv/Scripts/python.exe manage.py test <labels> >     --noinput --settings=qa_test_settings
> ```

**The suite is not a pass/fail gate — it is a differential.** ~42 of ~1742 fail on
`main` for four documented reasons (`PRE_EXISTING_TEST_FAILURES.md`). The only
number that means anything is *new* failures against that baseline:

| Baseline bucket | Where | Ignore |
|---|---|---|
| C1 — `seed_permissions` missing from `setUpTestData` | `tests_field_history`, `tests.SalesReportTest`, `tests_pallet_manifest` | yes |
| C2 — dropped `WeeklyHarvestPlan.*_plan_kg` columns | `tests_boss_analytics` (≈8) | yes |
| C3 — `_make_shipment` without `status` | `tests_comments` (≈11) | yes |
| C4 — stale URLs | `core.tests.test_config_api` (≈13), `tests_permission_matrix.LastAdminGuardTests` | yes |
| anything else | — | **regression — stop** |

### Results, 2026-08-27

| Suite | Result |
|---|---|
| frontend `vitest` | **504 / 504 pass**, 67 files |
| backend `apps.export apps.core apps.transport apps.greenhouse` (`DJANGO_TESTING=true`) | **42 failures / 1832** — see the differential below |
| …after the same-day cleanup (`tests_pallet_manifest` + `tests_comments` + `tests_permission_matrix`, 51 tests, one process) | **OK** — 27 of the 42 fixed, **15 remain** |
| backend baseline, HEAD `92477b6` worktree vs working tree | **0 regressions** — every working-tree failure also fails at HEAD |
| backend `tests_sheet_settings_admin` + `tests_sheet_row_role_group` (new) | **55 / 55 pass** |
| `tsc --noEmit --ignoreDeprecations 5.0` | **clean**, exit 0 |
| `makemigrations --check` | **No changes detected** — 0063 is the only new migration |

### The differential — 0 regressions

42 failures of 1832. Matches the documented baseline (42 of 1742, measured
2026-08-23) almost exactly. Attribution:

| Count | Where | Bucket |
|---|---|---|
| ~~15~~ 0 | `tests_pallet_manifest` | **not C1** — one stale line, see below · **FIXED 2026-08-27** |
| ~~11~~ 0 | `tests_comments` | C3 — `_make_shipment` without `status` · **FIXED 2026-08-27** |
| 6 | `tests_boss_analytics` | C2 — dropped `WeeklyHarvestPlan.*_plan_kg` · open |
| ~~1~~ 0 | `tests_permission_matrix.LastAdminGuardTests` | C4 — stale migration name · **FIXED 2026-08-27** |
| **9** | **see below** | **undocumented — but all 9 fail at HEAD too** |

**Correction to `PRE_EXISTING_TEST_FAILURES.md`'s C1 attribution:** all 15
`tests_pallet_manifest` failures are a single stale line, not a permission
problem — `_make_shipment` at [tests_pallet_manifest.py:42](../backend/apps/export/tests_pallet_manifest.py#L42)
calls `Season.objects.get_or_create(year=2025, …)` and `Season` has no `year`
field (it carries `name`/`start_date`/`end_date`/`is_active`), so every test in
the module dies in `setUp` with `FieldError: Cannot resolve keyword 'year'`.
**One line fixes 15 tests** — the largest single bucket in the run.

Every one of the 9 was re-run against a clean `HEAD` (`92477b6`) worktree and
fails there identically, so **nothing in the uncommitted diff caused them**.
They belong in `PRE_EXISTING_TEST_FAILURES.md` as a fifth category:

- `tests_shipment_sheet.SheetJunctionEndpointTests` ×5 — `400 … has no remaining
  quota and cannot be added to the split`. These predate the quota block on
  `POST /firm-splits/` and were never given quota in `setUp`. The CHANGELOG
  records updating `tests_shipment_join.py` for that rule; this module was
  missed.
- `tests_shipment_swap` ×3 — two `SwapPermissionDeniedTests` assert the denied
  *field name* appears in the error, but DRF answers with its generic
  `'You do not have permission to perform this action.'`; one concurrency test
  asserts `0 >= 1`.
- `tests_task_engine.TransitionToGenerationTests` ×1 —
  `ValueError: Cannot transition from 'draft' to 'yuklenme'`. The test drives an
  edge `TRANSITIONS` does not have.

`apps.transport` was **not** in the 2026-08-23 baseline measurement (it covered
export/core/greenhouse only). It contributed **zero** failures here, so the
comparison holds.

## 2. Coverage map — diff area → test → verdict

| # | Changed area | Files | Tests today | Verdict |
|---|---|---|---|---|
| 1 | Local sell plan lock + autosave/auto-submit | `models/local_sell_plan.py`, `views_planning.py`, `LocalSellPlanGrid.tsx` | `tests_local_sell_plan_lock.py` (24), `LocalSellPlanGrid.cells.test.ts` | **covered** — backend truth table + frontend mirror |
| 2 | Quota firm summary + expiry maths | `services_quota.py`, `views_quota.py`, `QuotaDashboard.tsx` | `tests_quota_firm_summary.py` (15), `QuotaFirmSummary.helpers.test.ts` | **covered** — service + endpoint + role gate |
| 3 | Fleet Map seller deny | `transport/permissions.py`, `transport/views.py` | `transport/tests/test_fleet_map_access.py` (8), `AppLayout.menuGroups.test.tsx` | **covered** — incl. a "gate did not widen" pair |
| 4 | Lifecycle / role gates | (regression harness) | `tests_role_lifecycle.py` (30) | **covered** |
| 5 | `seed_permissions` — `departed_at` grant for `transport` | `seed_permissions.py` | `tests_sheet_perms.TestEveryRoleCanEditItsOwnSheetRow` | **covered** — whole-sheet sweep, the test that would have caught both August incidents |
| 6 | Junction-resource perms (`firm_splits` / `block_sources`) | `views.py`, `tests_sheet_perms.py` | `tests_sheet_perms.py` (+55 lines, 4 seed-backed cases) | **covered** |
| 7 | **`SheetRowSetting.role_group`** — new field, migration 0063, `/sheet/rows/` payload, admin PATCH | `models/sheet_settings.py`, `migrations/0063_*`, `views.py:1495-1523`, `views_sheet_settings.py` | frontend `sheetRoleBlocks.test.ts` (19) only | **GAP — zero backend tests** |
| 8 | who-key → role map, now in 3 hand-synced copies | migration `0063._WHO_SLUG_TO_ROLE`, `backfill_sheet_row_defaults.WHO_TO_ROLE`, `sheetRoleBlocks.ts:WHO_KEY_ROLE` | none compares them | **GAP — no drift guard** (they agree today; verified by hand 2026-08-27) |
| 9 | New components `SheetRoleBandRow.tsx`, `QuotaFirmSummaryTable.tsx` | — | helper-level only | gap, low risk |
| 10 | `seed_test_users.py` (new management command) | — | none | gap, low risk (dev-only command) |

## 3. Write-list — ranked

> **P1–P3 written 2026-08-27** — 21 new backend tests, all green. Files:
> `apps/export/tests_sheet_settings_admin.py::SheetRowRoleGroupTests` (9) and
> the new `apps/export/tests_sheet_row_role_group.py` (12). P4 not built.

### P1 — `role_group` backend tests — DONE (9 cases)

Slot into `apps/export/tests_sheet_settings_admin.py` next to
`SheetRowSettingWhoOverrideTests.test_who_overrides_appear_in_sheet_payload`,
which is the same shape:

1. `GET /api/v1/export/shipments/sheet/` carries `role_group` for a **default** row.
2. …and for an **`is_custom`** row whose `role_group` an admin set (this is the
   whole point of the feature — putting a custom row into a real block).
3. `PATCH` with a valid `ROLE_CHOICES` code persists and bumps `version`.
4. `PATCH` with a garbage code → **400** (relies on model `choices`; pin it).
5. A blank `role_group` leaves the payload key `None`, so the frontend falls back
   to `WHO_KEY_ROLE` — the branch `sheetRoleBlocks.ts` assumes.

### P2 — migration 0063 backfill test — DONE (6 cases)

`apps/export/tests_sheet_settings_admin.py` or a new
`tests_sheet_row_role_group.py` — call the two `RunPython` functions directly:

1. Backfill maps `default_who_key` → the expected role for every default row.
2. Backfill is update-only: a row that already has `role_group` set is untouched,
   and no `SheetRowSetting` rows are created.
3. **Reverse is not a true inverse — see §4.** Test the fixed behaviour, not today's.

### P3 — who-key map drift guard — DONE (6 cases)

Both August permission incidents were this class of bug. A backend test that
parses `frontend/src/components/sheet/sheetRoleBlocks.ts` and asserts
`WHO_KEY_ROLE == WHO_TO_ROLE` (flattened, `sheet.who.` prefix stripped) fails the
moment someone edits one copy. Precedent for a cross-language mirror assertion is
already in `tests_local_sell_plan_lock.py`'s docstring. The migration's frozen
third copy is deliberately excluded — a migration must not drift with the org chart.

### P4 — component render tests (optional) — NOT BUILT

`SheetRoleBandRow.tsx` and `QuotaFirmSummaryTable.tsx` follow the repo's existing
`SheetCellEditor.test.tsx` convention. Low risk; the logic is in tested helpers.

## 4. Finding — migration 0063's reverse silently discards admin config

`clear_role_group` ([0063_sheet_row_role_group.py:65](../backend/apps/export/migrations/0063_sheet_row_role_group.py#L65))
blanks **every** row whose `role_group` is in the seeded role set — it cannot tell
a value it wrote from one an admin chose. An admin who moves a custom row into,
say, the `transport` block loses that setting on any rollback of 0063, and a
re-apply then backfills the *default* over it. No data loss on the forward path;
reverse-only.

Fix: restrict the reverse to rows whose `role_group` still equals the default
mapping for their own `field_key`, and skip `is_custom` rows entirely.

**Pinned by** `tests_sheet_row_role_group.SheetRowRoleGroupBackfillTests.
test_reverse_also_blanks_an_admin_set_override`, which asserts today's *defective*
behaviour so it is visible rather than silent. **That test must be inverted as part
of the fix** — its assertion message says so, and this is the other end of the link.

## 5. Manual items worth automating

`BUILD_TEST_LOG.md` has 11 unchecked `NEEDS TEST` items. These four still need a
human (real browser, real login, real DB state):

- Sheet role-block bands re-group after an admin changes **Role Block** (2026-08-27)
- Soltanmyrat's Harvest Block cell opens **and saves** (2026-08-27) — needs the
  live-DB grant fix, which the sweep test cannot see
- "Reset to role blocks" button (2026-08-24)
- Fleet Map seller 403 — **requires a backend restart** to take effect (2026-08-23)

Everything else in that log is now pinned by an automated test above.

## 6. Incidental findings from writing the tests

**`sheet.who.malik` is a dead mapping.** Both live who-key → role tables still
carry it, but no `DEFAULT_SHEET_ROWS` row uses it — R4 was repurposed from
Malik's "Goşmaça bellik" (`Shipment.notes`) to Şirin's `transport_docs_given_at`.
Harmless, and deliberately **not** removed: the two copies must stay byte-equal
and dropping a key from one is the drift the guard exists to catch. Recorded as
a known-dead entry in `test_no_new_dead_who_key_mappings`, so a *new* one fails.

**Django's `.distinct()` does not dedupe a `values_list()` on a model with
`Meta.ordering`** — the sort column joins the SELECT list, so DISTINCT applies
to the pair. Cost one red test here; worth knowing before it is written into
production code against MSSQL.
