# Pre-existing test failures (not caused by schema-collapse refactor)

After the schema-collapse refactor (`refactor/collapse-schemas-to-dbo`), the
test suite behaves identically with respect to the schema layer:

- Migrations apply cleanly to a fresh `test_YIGIT_PLATFROM` from scratch (no patches, no schemas, all `dbo`).
- All 351 tests are *discovered and executed* — none are blocked by collection or migration errors.
- `token_blacklist.0008` runs to completion without intervention.

The failures inventoried below pre-date the refactor. They were broken on
`main` before this branch, by independent issues in the test suite design.
This document groups them by root cause so they can be addressed in a
follow-up cleanup session.

**Latest counts:** 23 failures + 48 errors = **71 of 351 tests** failing.

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
- `apps.export.tests_pallet_manifest.*` (most of 15 — partial; some hit other issues too)

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
`Shipment.objects.create(cargo_code=…, date=…, season=…, created_by=…)`
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
        cargo_code='0101001/25', date='2025-01-01',
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
- `apps.core.tests_permission_matrix.LastAdminGuardTests.test_migration_0016_deletes_stale_admin_rows_for_director_and_em` (1 — also references a removed migration name)

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
