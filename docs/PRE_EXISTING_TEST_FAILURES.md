# Pre-existing test failures (not caused by schema-collapse refactor)

> ⚠️ **2026-08-23 — do not use `--keepdb`.** A verifier run was killed mid-migration, so the shared
> `test_YIGIT_PLATFROM` database may be half-migrated. Run the suite with `--noinput` so Django rebuilds it.
> A scratch `test_YGT_VERIFY` database is also left on localhost and is safe to drop.
>
> This inventory is also **stale in the project's favour**: `tests_field_history`, `SalesReportTest`,
> `EndpointSmokeTests` and all of `test_config_api` no longer fail. Measured 2026-08-23:
> 42 failures of 1742 across `apps.export apps.core apps.greenhouse`, not 71 of 351.


After the schema-collapse refactor (`refactor/collapse-schemas-to-dbo`), the
test suite behaves identically with respect to the schema layer:

- Migrations apply cleanly to a fresh `test_YIGIT_PLATFROM` from scratch (no patches, no schemas, all `dbo`).
- All 351 tests are *discovered and executed* — none are blocked by collection or migration errors.
- `token_blacklist.0008` runs to completion without intervention.

The failures inventoried below pre-date the refactor. They were broken on
`main` before this branch, by independent issues in the test suite design.
This document groups them by root cause so they can be addressed in a
follow-up cleanup session.

**Latest counts (2026-08-27, `apps.export apps.core apps.transport apps.greenhouse`,
`DJANGO_TESTING=true`, fresh test DB):** measured at **42 of 1832**, then
**27 of those were fixed the same day** — see "Fixed 2026-08-27" below.

| | Count | Status |
|---|---|---|
| `tests_pallet_manifest` — stale `Season.year` (**was misfiled under C1**) | 15 | **FIXED** |
| `tests_comments` — C3, `_make_shipment` without `status` | 11 | **FIXED** |
| `tests_permission_matrix` — C4, deleted migration `0016` | 1 | **FIXED** |
| `tests_boss_analytics` — C2, dropped `WeeklyHarvestPlan.*_plan_kg` | 6 | open |
| `tests_shipment_sheet` / `tests_shipment_swap` / `tests_task_engine` — C6 | 9 | **7 open** — 2 were misfiled, see below |
| **Remaining** | **13** (was 15) | |

**Corrected 2026-09-01 — two of these were never a test-suite problem.**
`SwapPermissionDeniedTests.test_permission_denied_returns_403` and
`test_permission_denied_includes_field_name_in_error` authenticate as `sales_rep` and assert
the 403 names the offending field. They were getting DRF's generic *"You do not have permission
to perform this action"* because `/swap/` was gated on `shipment.can_create` (0 for `sales_rep`),
so the request died at the resource gate before the per-field check the tests are about. That is
**FINDINGS_BACKLOG F19**, a real product bug the suite was correctly reporting and this document
was filing as noise. Fixed 2026-09-01; both are green.

Also on 2026-09-01, `tests_shipment_swap.py` gained a `SwapTestBase` that seeds the permission
matrix per class. Before that, **no** class in the module seeded anything — they passed only
because an earlier module in the same run had warmed the process-wide permission cache (the same
C5/F14 hazard described below). Run alone the module was red for reasons unrelated to its
subject. It now stands on its own: 27 tests, 1 failure (`test_concurrent_swaps_do_not_crash`,
the threading smoke test).

`apps.transport` contributed zero. The older "71 of 351" figure below predates the
schema collapse and the suite's growth — kept only for the category write-ups, not
as a count.

---

## Fixed 2026-08-27

Verified together in one process: `Ran 51 tests … OK`. Test files only — no
production code, models or migrations were touched, because none of the three was
a production bug.

1. **`tests_pallet_manifest` (15).** `_make_shipment` called
   `Season.objects.get_or_create(year=2025, …)`; `Season` has no `year` field.
   Replaced with the `name` / `start_date` / `end_date` shape. Two lines.
2. **`tests_comments` (11 of the module's 13).** `_make_shipment` created a
   `Shipment` with no `status` against a NOT NULL `status_id`. Added a `draft`
   `ShipmentStatusType` fixture and passed it.
3. **`tests_permission_matrix` (1).** The test imported
   `apps.core.migrations.0016_demote_existing_director`, which the schema-collapse
   refactor (`932d950`) archived to `backend/_pre_collapse_backup/core/` along with
   all 56 pre-collapse migrations. The rule it guarded — director loses `admin.*`,
   EM loses `admin.permissions` — now lives in `seed_permissions.PAGE_DEFAULTS`, so
   the test was re-pointed at `seed_permissions --reset` and renamed
   `test_seed_permissions_reset_clears_stale_admin_rows_for_director_and_em`.
   **`--reset`, not plain seed:** plain `seed_permissions` is `get_or_create` and by
   design will not repair an already-stale `is_visible=True` row, so a plain-seed
   retarget would have duplicated the existing
   `test_director_em_have_no_admin_pages_visible_after_seed` and guarded nothing.
   Assertions moved from "row deleted" to "`is_visible=False`", since `--reset`
   recreates rows rather than removing them.

---

## Category 1 — `seed_permissions` not called in `setUpTestData`

**Symptom:** `403 Forbidden — 'You do not have permission to perform this action.'`

**Root cause:** Tests authenticate as a real role-bearing user but never run
the `seed_permissions` management command in `setUpTestData`, so
`RolePagePermission`, `RoleResourcePermission`, and `RoleFieldPermission`
tables are empty. The dynamic permission system then rejects every request.

**Fix pattern** (per `apps/export/tests_shipment_field_audit.py`):

```python
@classmethod
def setUpTestData(cls):
    from django.core.management import call_command
    call_command('seed_permissions')
    # …rest of setUpTestData
```

**Affected tests** (≈18):

- `apps.export.tests_field_history.FieldHistoryTests.*` (4)
- `apps.export.tests.SalesReportTest.test_sales_report_*` (4)
- ~~`apps.export.tests_pallet_manifest.*`~~ — **re-measured 2026-08-27: this was a
  misattribution.** All 15 fail in `setUp`, before any request, on
  `Season.objects.get_or_create(year=2025, …)` at `tests_pallet_manifest.py:42`
  — `Season` has no `year` field (`name` / `start_date` / `end_date` /
  `is_active`). `django.core.exceptions.FieldError: Cannot resolve keyword
  'year' into field`. Fixing that one line recovers all 15; it is the single
  highest-payoff repair in this document.

---

## Category 2 — Stale field references on `WeeklyHarvestPlan`

**Symptom:** `FieldError: Cannot resolve keyword 'monday_plan_kg' into field.`
or `WeeklyHarvestPlan.objects.create(monday_plan_kg=…)` raises before insert.

**Root cause:** `WeeklyHarvestPlan` had wide weekday columns
(`monday_plan_kg` … `saturday_actual_kg`) that were dropped in
`greenhouse.0004_harvestdayentry_*` (data exploded into per-day rows in
`HarvestDayEntry`). Several tests still build plans against the wide
schema.

**Fix pattern:** rewrite each test's `setUp` to create
`HarvestDayEntry` rows under a `WeeklyHarvestPlan` parent, matching the
current model.

**Affected tests** (≈8):

- `apps.export.tests_boss_analytics.BlocksHeatmapTests.test_heatmap_rolls_up_week_plan`
- `apps.export.tests_boss_analytics.EndpointSmokeTests.test_blocks_heatmap`
- `apps.export.tests_boss_analytics.EndpointSmokeTests.test_production_daily`
- `apps.export.tests_boss_analytics.EndpointSmokeTests.test_production_seasonal`
- `apps.export.tests_boss_analytics.ProductionEndpointTests.test_production_daily_pct_calculation`
- `apps.export.tests_boss_analytics.ProductionEndpointTests.test_production_daily_returns_one_row_per_block`
- `apps.export.tests_boss_analytics.ProductionEndpointTests.test_production_seasonal_scope_param`
- `apps.export.tests_boss_analytics.QuotaGridTests.test_quota_level_*` (3 — depend on harvest plan setup, surface as `assertIsNotNone(row)` failure)

---

## Category 3 — `_make_shipment` doesn't supply `status`

**Symptom:** `IntegrityError: Cannot insert the value NULL into column 'status_id', table 'test_YIGIT_PLATFROM.dbo.export_shipments'`.

**Root cause:** `tests_comments.py:_make_shipment()` does
`Shipment.objects.create(shipment_code=…, date=…, season=…, created_by=…)`
without passing `status`. The `Shipment.status` FK has no `default=` and no
`save()` override that auto-resolves to the seeded `'draft'` row. Pre-refactor
this was masked when the `0017_shipment_draft_status_seed` migration ran
during test setup AND someone-or-something set the default — but in this
codebase there is no such default, so the test must have been broken for a
while.

**Fix pattern:** make `_make_shipment` resolve a status:

```python
def _make_shipment(author):
    from apps.core.models import Season, ShipmentStatusType
    season, _ = Season.objects.get_or_create(name='2025', defaults={...})
    status, _ = ShipmentStatusType.objects.get_or_create(
        code='draft', defaults={'step_order': 0, 'phase': 'DRAFT', ...}
    )
    return Shipment.objects.create(
        shipment_code='0101001/25', date='2025-01-01',
        season=season, status=status, created_by=author,
    )
```

**Affected tests** (≈11):

- All of `apps.export.tests_comments.*` that call `_make_shipment`:
  - `TestBulkCreateBatchSize.test_bulk_create_called_with_batch_size_500`
  - `TestCreateCommentAssignee.test_assignee_gets_task_assigned_only`
  - `TestCreateCommentRoleMentionDedupes.test_role_and_user_mention_deduplicates`
  - `TestCreateCommentUserMention.test_mention_creates_notification_for_mentioned_not_author`
  - `TestLegacyCommentEndpoint.test_empty_content_returns_400`
  - `TestLegacyCommentEndpoint.test_post_creates_comment_and_returns_detail`
  - `TestMarkTaskDone.test_done_no_notification_when_author_is_assignee`
  - `TestMarkTaskDone.test_done_notifies_author_when_different_user`
  - `TestMarkTaskDoneIdempotent.test_calling_twice_does_not_create_duplicate_notifications`
  - `TestReplyInheritsFieldKey.test_reply_overrides_mismatched_field_key_to_parent`
  - `TestReplyInheritsFieldKey.test_reply_with_assignee_raises_value_error`

---

## Category 4 — `apps.core.tests.test_config_api.*` returns 404

**Symptom:** `AttributeError: 'HttpResponseNotFound' object has no attribute 'data'` —
the URL the test posts to is unrouted.

**Root cause:** Either the URL pattern was renamed without updating tests,
or the test module is using an outdated path. Need to compare
`apps/core/urls.py` against the URLs used in `test_config_api.py`.

**Affected tests** (≈14):

- `apps.core.tests.test_config_api.GreenhouseConfigGetTests.test_get_config_*` (2)
- `apps.core.tests.test_config_api.GreenhouseConfigPatchTests.test_patch_config_*` (8)
- `apps.core.tests.test_config_api.OperatingDayExceptionCreateTests.test_create_exception_*` (3)
- ~~`apps.core.tests_permission_matrix.LastAdminGuardTests.test_migration_0016_deletes_stale_admin_rows_for_director_and_em`~~
  — **FIXED 2026-08-27.** That test no longer exists; it is now
  `test_seed_permissions_reset_clears_stale_admin_rows_for_director_and_em`. See
  "Fixed 2026-08-27" above.

---

## Category 5 — `tests_official_code_validator` setUp collides with seed data (RESOLVED in this branch)

**Status:** No longer failing as of this branch. The seed migrations
`core.0002_seed_shipment_option_types` … `core.0006_seed_shipment_draft_status`
and `export.0002_seed_truck_split_defaults` now skip when
`DJANGO_TESTING=true`, so test `setUp` methods that create their own
`TomatoVariety`/`CrateType`/etc. rows no longer hit UNIQUE conflicts.

This was the only pre-existing failure category that the refactor's seed
guards mitigated. The other 4 categories are unchanged.

---

## Category 6 — tests that were never updated for a rule that landed later

**Measured 2026-08-27** on the uncommitted working tree AND re-verified against a
clean `HEAD` (`92477b6`) worktree — identical failures on both, so they are not
caused by any work in flight. 9 tests, in three unrelated groups:

**`apps.export.tests_shipment_sheet.SheetJunctionEndpointTests` (5)**
`400 {"error": "… has no remaining quota and cannot be added to the split."}`
where the test expects 200. `POST /shipments/{id}/firm-splits/` gained a quota
check; these `setUp`s allocate no quota. The CHANGELOG records fixing
`tests_shipment_join.py::test_loading_dept_head_draft_persists_firm_splits` for
the same rule — this module was missed. Fix: allocate quota in `setUp`, same
pattern as the join test.

- `test_firm_splits_auto_fill_official_kg`
- `test_firm_splits_auto_fill_official_kg_three_firms`
- `test_firm_splits_falls_back_when_no_seed_row`
- `test_firm_splits_quota_usage_matches_auto_filled_split_weight`
- `test_firm_splits_replaces_and_creates_draft_quota_usage`

**`apps.export.tests_shipment_swap` (3)**
`SwapPermissionDeniedTests` (2) assert the denied field's name appears in the
error body, but the response is DRF's generic
`'You do not have permission to perform this action.'`.
`SwapConcurrencyTest.test_concurrent_swaps_do_not_crash` asserts `0 >= 1`.

**`apps.export.tests_task_engine.TransitionToGenerationTests` (1)**
`ValueError: Cannot transition from 'draft' to 'yuklenme'. Allowed:
['gumruk_girish', 'cancelled']` — the test drives an edge `TRANSITIONS` does not
have. Fix the test, not the graph (`transition_to()` is behaving correctly).

---

## ⚠️ `DJANGO_TESTING=true` is required on the command line

Category 5's guard only fires when the env var is set, and it is in no runbook.
Omitting it on a fresh test database manufactured **~48 phantom failures** on
2026-08-27 (74 total instead of 42), every one a
`pyodbc.IntegrityError … Violation of UNIQUE KEY constraint`:
`tests_official_code_validator` (17), `tests_pallet_manifest` (15),
`tests_season_services` (7), `tests_supply_draft` (4), `tests_completeness` (2),
`tests_field_history` (1).

```bash
cd backend && DJANGO_TESTING=true ./venv/Scripts/python.exe manage.py test <labels> --noinput
```

---


## Why these are pre-existing

Spot-checks during the refactor:

- `Shipment` model has no `save()` override, no `default=` on `status` FK, and
  the `0001_initial` migration (both pre-refactor and post-refactor) creates
  `status_id` as NOT NULL. `_make_shipment` without `status` has never been
  valid against this schema.
- `WeeklyHarvestPlan` lost its wide weekday columns in
  `_pre_collapse_backup/greenhouse/0004_harvestdayentry_*` — that migration
  predates this refactor by weeks. Test files referencing those columns
  were stale before this branch existed.
- `seed_permissions` is a management command (not a migration) and has been
  the responsibility of test `setUpTestData` since `seed_permissions` was
  introduced. Tests that don't call it 403 against the dynamic permission
  system.

The schema-collapse refactor neither caused nor masked any of these issues.

---

## Recommended approach for follow-up

One PR per category, in this order:

1. **Category 1 (low effort, high impact)** — add a single `setUpTestData`
   helper / mixin that calls `seed_permissions` and use it across the
   affected test classes. ~18 tests recovered.
2. **Category 3 (low effort)** — fix `_make_shipment` in `tests_comments.py`
   to supply a status. ~11 tests recovered.
3. **Category 4 (medium effort)** — audit `apps/core/urls.py` vs. the URLs
   used in `test_config_api.py` and update either side. ~14 tests recovered.
4. **Category 2 (high effort)** — rewrite the boss-analytics tests to use
   `HarvestDayEntry` instead of the dropped wide columns. ~8 tests recovered.

After all four, expect 0 failures from this group and the test suite
becomes a clean gate again.
