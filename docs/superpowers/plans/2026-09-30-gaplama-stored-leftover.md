# Gaplama Stored Leftover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze each block's starting Gaplama leftover into `HarvestDayEntry.yesterday_rest_value` every night, make the board use that stored number, and let people correct it by hand in Gaplama and on the harvest-board.

**Architecture:** `build_gaplama_board` reads the stored value alongside the plan and, after bucket expiry, reconciles the FIFO bucket queue to it (shortfall off the oldest bucket, surplus as a bucket dated the previous day). A new service `snapshot_gaplama_leftovers(today)`, run by Celery beat at 00:05, writes the board's own `carried_in_kg` into empty fields for T−3…T. The Gaplama day view turns the carry-in cell into the harvest-board's existing inline number cell, saving through the existing `POST /greenhouse/daily-plan/`.

**Tech Stack:** Django 5 + DRF on MSSQL (mssql-django), Celery beat, React 18 + TypeScript + antd + TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-30-gaplama-stored-leftover-design.md` — read it before starting any task.

## Global Constraints

- MSSQL: no JSONField/ArrayField/DISTINCT ON; `bulk_create`/`bulk_update` need `batch_size=500` (none planned here).
- Dependency direction `core ← greenhouse ← export`: export may import greenhouse, never the reverse. No Django signals.
- Scheduled jobs go in `CELERY_BEAT_SCHEDULE` (`backend/config/settings.py`), never host crontab.
- API decimals are strings (`"7000.00"`); the frontend coerces at the fetch boundary (`useGaplama.ts`), never at the usage site.
- No new schema migration. `yesterday_rest_value` already exists (nullable, `>= 0` check constraint).
- Every UI string in all three of `frontend/src/i18n/{tk,ru,en}.json`. UI never says "draft"/"черновик".
- **Never commit without the user's explicit word "commit".** Each task ends at a *commit point*; stop there if "commit" has not been said.
- The working tree and git index are shared with other Claude sessions. Before any commit: `git status`, and `git diff --cached` must be empty of paths that aren't yours. Commit whole files with `git commit -- <paths>` only when every hunk in them is yours. `frontend/src/i18n/*.json`, `CHANGELOG.md` and `BUILD_TEST_LOG.md` are already dirty with other sessions' hunks, so commit **only your hunks** from them. Use the private-index recipe in memory `project_shared_worktree_sessions.md`: `git apply --cached --unidiff-zero` on a `GIT_INDEX_FILE`, recompute `+start`, keep CRLF bytes.
- Backend tests run against a **private test DB** (a shared one deadlocks with other sessions). Setup is in Task 1, Step 0.
- Frontend typecheck: `npx tsc --noEmit --ignoreDeprecations 5.0` (`npm run type-check` is broken, TS5103).

## Review Focus

1. **Browsing a closed/read-only season in Gaplama.** The daily-plan endpoint writes into the ACTIVE season, so an edit from a browsed old season would stamp a row into the wrong season. The cell must not be editable when `useSeasonReadOnly()` is true (test in Task 3).
2. **A greenhouse_manager on a block they don't manage.** The backend 403s; the cell must not even offer an input (test in Task 3).
3. **Found crates on a block that shows nothing today.** Such a block is folded into the «folded blocks» row. Expanding it must still offer the carry-in input (test in Task 3).
4. **A surplus when yesterday's bucket already exists.** It must merge into that bucket, not create a second bucket with the same origin date. Otherwise the tooltip and the truck form's leftover row show duplicates (test in Task 1).
5. **The job at the start of a season.** For T−3…T, any day before `season.start_date` must be skipped. `get_or_create_day_entry` raises `ValueError` there, and one bad day would kill the whole nightly run (test in Task 2).

---

### Task 1: Board reads and reconciles to the stored leftover

**Files:**
- Modify: `backend/apps/export/services/gaplama.py` (module docstring; imports L20; new helper above `build_gaplama_board` L28; `plan_rows` ~L139-147; walk ~L184-192; `days_out.append` ~L262-275)
- Modify: `backend/apps/export/views_gaplama.py:13-15` (`_DAY_DECIMAL_FIELDS`) and `_stringify_decimals` L28-32
- Test: `backend/apps/export/tests_gaplama_stored_leftover.py` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces: every `build_gaplama_board(...)['days'][i]` gains `rest_stored_kg: Decimal | None` and `rest_calc_kg: Decimal`. Over the API these arrive as `rest_stored_kg: str | null` and `rest_calc_kg: str`. Task 2 relies on `row['carried_in_kg']` equalling the stored value whenever one exists. Task 3 relies on the two API fields.

- [ ] **Step 0: Private test DB settings (once per machine session)**

Create `C:\Temp\claude\d--projects-yigit-platform\ea6f031e-ebc7-489f-9794-312b07e28335\scratchpad\settings_isolated.py`:

```python
from config.settings import *  # noqa: F401,F403

DATABASES['default']['NAME'] = 'master'  # required — settings.py reuses the test name for NAME
DATABASES['default']['TEST']['NAME'] = 'test_YIGIT_ISOLATED_GSL'
```

Every backend test command below is run from `backend/` as:
`PYTHONPATH="C:/Temp/claude/d--projects-yigit-platform/ea6f031e-ebc7-489f-9794-312b07e28335/scratchpad" python manage.py test <label> --noinput --settings=settings_isolated`
(abbreviated below as `RUNTEST <label>`).

- [ ] **Step 1: Write the failing tests**

Create `backend/apps/export/tests_gaplama_stored_leftover.py`:

```python
"""Stored leftover (HarvestDayEntry.yesterday_rest_value) anchors Gaplama's carry-in.

Spec: docs/superpowers/specs/2026-09-30-gaplama-stored-leftover-design.md §4. The stored
value on day d's row is d's starting leftover AFTER expiry — the same figure the board
reports as carried_in_kg — so an untouched midnight snapshot never changes a number.
"""
from datetime import date, timedelta
from decimal import Decimal

from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import GreenhouseBlock, Season, User
from apps.export.services.gaplama import build_gaplama_board
from apps.greenhouse.models import HarvestDayEntry, WeeklyHarvestPlan

MON = date(2026, 6, 1)  # a Monday
TUE, WED, THU, FRI = (MON + timedelta(days=i) for i in range(1, 5))


class _StoredLeftoverBase(TestCase):
    @classmethod
    def setUpTestData(cls):
        Season.objects.update(is_active=False)
        cls.season = Season.objects.create(
            name='SL-season',
            start_date=MON - timedelta(days=200),
            end_date=MON + timedelta(days=200),
            is_active=True,
        )
        cls.block = GreenhouseBlock.objects.create(code='SL', carry_days=7, is_active=True)

    def _entry(self, block, day, **values):
        iso = day.isocalendar()
        plan, _ = WeeklyHarvestPlan.objects.get_or_create(
            season=self.season, block=block, week_number=iso.week, year=iso.year,
        )
        entry, _ = HarvestDayEntry.objects.get_or_create(
            weekly_plan=plan, entry_date=day,
            defaults={'season': self.season, 'block': block, 'weekday': day.weekday()},
        )
        for field, value in values.items():
            setattr(entry, field, value)
        entry.save()
        return entry

    def _row(self, day, block=None):
        board = build_gaplama_board(day, day, self.season)
        return next(r for r in board['days'] if r['block_id'] == (block or self.block).id)


class StoredLeftoverBoardTests(_StoredLeftoverBase):
    def test_no_stored_value_leaves_the_calculation_unchanged(self):
        self._entry(self.block, MON, plan_value=Decimal('10000'))
        row = self._row(TUE)
        self.assertEqual(row['carried_in_kg'], Decimal('10000'))
        self.assertIsNone(row['rest_stored_kg'])
        self.assertEqual(row['rest_calc_kg'], Decimal('10000'))

    def test_stored_lower_comes_off_the_oldest_bucket_first(self):
        self._entry(self.block, MON, plan_value=Decimal('4000'))
        self._entry(self.block, TUE, plan_value=Decimal('6000'))
        self._entry(self.block, WED, yesterday_rest_value=Decimal('7000'))
        row = self._row(WED)
        self.assertEqual(row['carried_in_kg'], Decimal('7000'))
        self.assertEqual(row['rest_stored_kg'], Decimal('7000'))
        self.assertEqual(row['rest_calc_kg'], Decimal('10000'))
        self.assertEqual(row['carry_in_breakdown'], [
            {'origin_date': MON, 'kg': Decimal('1000'), 'age_days': 2},
            {'origin_date': TUE, 'kg': Decimal('6000'), 'age_days': 1},
        ])
        self.assertEqual(row['available_kg'], Decimal('7000'))

    def test_stored_higher_merges_into_yesterdays_bucket(self):
        self._entry(self.block, MON, plan_value=Decimal('4000'))
        self._entry(self.block, TUE, plan_value=Decimal('2000'))
        self._entry(self.block, WED, yesterday_rest_value=Decimal('7000'))
        row = self._row(WED)
        self.assertEqual(row['carried_in_kg'], Decimal('7000'))
        self.assertEqual(row['carry_in_breakdown'], [
            {'origin_date': MON, 'kg': Decimal('4000'), 'age_days': 2},
            {'origin_date': TUE, 'kg': Decimal('3000'), 'age_days': 1},
        ])

    def test_stored_higher_adds_a_bucket_dated_yesterday(self):
        self._entry(self.block, MON, plan_value=Decimal('4000'))
        self._entry(self.block, WED, yesterday_rest_value=Decimal('5000'))
        row = self._row(WED)
        self.assertEqual(row['carry_in_breakdown'], [
            {'origin_date': MON, 'kg': Decimal('4000'), 'age_days': 2},
            {'origin_date': TUE, 'kg': Decimal('1000'), 'age_days': 1},
        ])

    def test_added_surplus_expires_on_the_blocks_carry_days(self):
        short = GreenhouseBlock.objects.create(code='SL2', carry_days=2, is_active=True)
        self._entry(short, WED, yesterday_rest_value=Decimal('5000'))
        # Bucket dated TUE: age 2 on THU (live), age 3 on FRI (expired).
        self.assertEqual(self._row(THU, short)['carried_in_kg'], Decimal('5000'))
        self.assertEqual(self._row(FRI, short)['carried_in_kg'], Decimal('0'))

    def test_nightly_snapshots_never_resurrect_expired_kg(self):
        short = GreenhouseBlock.objects.create(code='SL3', carry_days=2, is_active=True)
        self._entry(short, MON, plan_value=Decimal('10000'))
        for day in (TUE, WED, THU):  # what the midnight job does, day by day
            self._entry(short, day, yesterday_rest_value=self._row(day, short)['carried_in_kg'])
        stored = dict(
            HarvestDayEntry.objects.filter(block=short, entry_date__in=[TUE, WED, THU])
            .values_list('entry_date', 'yesterday_rest_value')
        )
        self.assertEqual(stored, {TUE: Decimal('10000'), WED: Decimal('10000'), THU: Decimal('0')})
        self.assertEqual(self._row(THU, short)['carried_in_kg'], Decimal('0'))
        self.assertEqual(self._row(FRI, short)['carried_in_kg'], Decimal('0'))

    def test_stored_value_wins_over_a_later_change_to_the_past(self):
        mon = self._entry(self.block, MON, plan_value=Decimal('10000'))
        self._entry(self.block, TUE, yesterday_rest_value=Decimal('10000'))
        mon.plan_value = Decimal('6000')
        mon.save()
        row = self._row(TUE)
        self.assertEqual(row['carried_in_kg'], Decimal('10000'))
        self.assertEqual(row['rest_calc_kg'], Decimal('6000'))

    def test_stored_zero_is_an_anchor_too(self):
        self._entry(self.block, MON, plan_value=Decimal('10000'))
        self._entry(self.block, TUE, yesterday_rest_value=Decimal('0'))
        tue = self._row(TUE)
        self.assertEqual(tue['carried_in_kg'], Decimal('0'))
        self.assertEqual(tue['available_kg'], Decimal('0'))
        self.assertEqual(tue['rest_calc_kg'], Decimal('10000'))
        self.assertEqual(self._row(WED)['carried_in_kg'], Decimal('0'))


class StoredLeftoverApiTests(_StoredLeftoverBase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.client.force_authenticate(
            User.objects.create_superuser(username='su_stored_leftover', password='p'),
        )

    def test_board_sends_both_rest_fields_as_strings(self):
        self._entry(self.block, MON, plan_value=Decimal('10000'))
        self._entry(self.block, TUE, yesterday_rest_value=Decimal('7000'))
        resp = self.client.get('/api/v1/export/gaplama/board/', {
            'from_date': MON.isoformat(), 'to_date': TUE.isoformat(),
        })
        self.assertEqual(resp.status_code, 200)
        by_date = {d['date']: d for d in resp.json()['days'] if d['block_id'] == self.block.id}
        self.assertIsNone(by_date[MON.isoformat()]['rest_stored_kg'])
        self.assertEqual(by_date[TUE.isoformat()]['rest_stored_kg'], '7000.00')
        self.assertEqual(by_date[TUE.isoformat()]['rest_calc_kg'], '10000.00')
        self.assertEqual(by_date[TUE.isoformat()]['carried_in_kg'], '7000.00')
```

- [ ] **Step 2: Run to verify they fail**

Run: `RUNTEST apps.export.tests_gaplama_stored_leftover`
Expected: failures/errors with `KeyError: 'rest_stored_kg'`. Also `test_stored_lower…` asserts `carried_in_kg` 7000 but gets 10000.

- [ ] **Step 3: Implement in `services/gaplama.py`**

3a. At the end of the module docstring, before the closing `"""`, add:

```
Stored leftover (2026-09-30, spec 2026-09-30-gaplama-stored-leftover-design.md):
HarvestDayEntry.yesterday_rest_value on day d's row is d's starting leftover AFTER
expiry. The midnight job freezes it; people may correct it by hand. When present, the
walk reconciles its bucket queue to it right after expiry. A shortfall comes off the
oldest bucket, a surplus lands in yesterday's bucket, and everything downstream (today's
bucket, drains, over_kg) runs unchanged on the reconciled queue.
```

3b. Change the import `from django.db.models import Sum` to:

```python
from django.db.models import Max, Sum
```

3c. Insert this helper directly above `def build_gaplama_board(`:

```python
def _reconcile_to_stored(buckets: deque, diff: Decimal, day: date) -> None:
    """Shift the live bucket queue's total by `diff` kg (stored − calculated), in place.

    A shortfall comes off the OLDEST buckets first. Spoilage and miscounts hit the
    oldest goods, the same order the FIFO drain uses. A surplus is found crates of
    unknown age: it joins yesterday's bucket (created if absent), so it expires on the
    block's normal carry_days from there and never shows as a second bucket with the
    same origin date.
    """
    if diff > 0:
        yesterday = day - timedelta(days=1)
        if buckets and buckets[-1][1] == yesterday:
            buckets[-1][0] += diff
        else:
            buckets.append([diff, yesterday])
        return
    to_remove = -diff
    while buckets and to_remove > 0:
        take = min(buckets[0][0], to_remove)
        buckets[0][0] -= take
        to_remove -= take
        if buckets[0][0] <= 0:
            buckets.popleft()
```

3d. Replace the `plan_rows` query and `plan_map` build (currently ~L139-150) with a materialised list read twice. Iterating an unmaterialised queryset twice would add a query and break the docstring's "5 queries" claim:

```python
    plan_rows = list(
        HarvestDayEntry.objects
        .filter(season=season, block_id__in=block_meta, entry_date__range=(walk_start, to_date))
        .values('block_id', 'entry_date')
        .annotate(plan_kg=Sum('plan_value'), rest_kg=Max('yesterday_rest_value'))
        .order_by()
    )
    plan_map: dict[tuple[int, date], Decimal] = {
        (row['block_id'], row['entry_date']): (row['plan_kg'] or Decimal(0)) for row in plan_rows
    }
    # Stored starting leftover per block-day — absent where nothing is stored (spec §3).
    rest_map: dict[tuple[int, date], Decimal] = {
        (row['block_id'], row['entry_date']): row['rest_kg']
        for row in plan_rows if row['rest_kg'] is not None
    }
```

3e. In the per-day walk, directly after the expiry `while buckets and (d - buckets[0][1]).days > block_carry_days:` loop and **before** `carried_in_kg = sum(...)`, insert:

```python
            # Stored leftover (spec 2026-09-30 §4). Reconciled AFTER expiry: the stored
            # value is post-expiry, so an untouched midnight snapshot is a no-op here and
            # can never re-add kg that just expired.
            rest_calc_kg = sum((b[0] for b in buckets), Decimal(0))
            rest_stored_kg = rest_map.get((block_id, d))
            if rest_stored_kg is not None and rest_stored_kg != rest_calc_kg:
                _reconcile_to_stored(buckets, rest_stored_kg - rest_calc_kg, d)
```

Leave the existing `carried_in_kg = sum((b[0] for b in buckets), Decimal(0))` line where it is. It now sums the reconciled queue.

3f. In the `days_out.append({...})` dict, after `'carried_out_kg': remainder_today,`, add:

```python
                    'rest_stored_kg': rest_stored_kg,
                    'rest_calc_kg': rest_calc_kg,
```

3g. In the `build_gaplama_board` docstring's `days[i] = {...}` line, add `rest_stored_kg, rest_calc_kg` to the field list.

- [ ] **Step 4: Implement in `views_gaplama.py`**

Replace `_DAY_DECIMAL_FIELDS`:

```python
_DAY_DECIMAL_FIELDS = (
    'plan_kg', 'loaded_kg', 'carried_in_kg', 'available_kg', 'over_kg', 'carried_out_kg',
    'rest_calc_kg',
)
```

and in `_stringify_decimals`, inside `for day in board['days']:` after the field loop, add:

```python
        if day['rest_stored_kg'] is not None:
            day['rest_stored_kg'] = str(day['rest_stored_kg'])
```

- [ ] **Step 5: Run the new tests and the existing Gaplama suites**

Run: `RUNTEST apps.export.tests_gaplama_stored_leftover apps.export.tests_gaplama_board apps.export.tests_gaplama_batch_consumption apps.export.tests_gaplama_carry_days`
Expected: all PASS. The three existing suites are the regression guard for "no stored value → identical numbers". If an existing test fails on an exact dict equality of a `days[]` row, add the two new keys to its expected dict. Do not change any number.

- [ ] **Step 6: Commit point** (only if the user has said "commit")

```bash
git status
git diff --cached --name-only        # must be empty or only your paths
git commit -m "feat(p3): Gaplama carry-in anchors to the stored leftover" -- \
  backend/apps/export/services/gaplama.py backend/apps/export/views_gaplama.py \
  backend/apps/export/tests_gaplama_stored_leftover.py
```

---

### Task 2: Midnight snapshot job

**Files:**
- Create: `backend/apps/export/services/gaplama_snapshot.py`
- Modify: `backend/apps/export/tasks.py` (append a task)
- Modify: `backend/config/settings.py` (`CELERY_BEAT_SCHEDULE`, ~L474-525)
- Test: `backend/apps/export/tests_gaplama_snapshot.py` (new)

**Interfaces:**
- Consumes: `build_gaplama_board(from_date, to_date, season) -> dict` and its `days[i]['block_id']`, `days[i]['carried_in_kg']` (Task 1). `apps.greenhouse.services.get_or_create_day_entry(block_id: int, entry_date: date) -> HarvestDayEntry` (existing, `legacy.py:84`; active season only; `entered_by=NULL`; raises `ValueError` outside the active season). `apps.core.seasons.get_active_season() -> Season | None`.
- Produces: `snapshot_gaplama_leftovers(today: date) -> int` (number of fields written) and Celery task `apps.export.tasks.snapshot_gaplama_leftovers`.

- [ ] **Step 1: Write the failing tests**

Create `backend/apps/export/tests_gaplama_snapshot.py`:

```python
"""Midnight snapshot of Gaplama's starting leftover (spec 2026-09-30 §5)."""
from datetime import date, timedelta
from decimal import Decimal

from django.test import TestCase

from apps.core.models import GreenhouseBlock, Season
from apps.export.models import AuditLog
from apps.export.services.gaplama_snapshot import snapshot_gaplama_leftovers
from apps.greenhouse.models import HarvestDayEntry, WeeklyHarvestPlan

MON = date(2026, 6, 1)  # a Monday
TUE, WED, THU, FRI = (MON + timedelta(days=i) for i in range(1, 5))


class SnapshotGaplamaLeftoversTests(TestCase):
    def setUp(self):
        Season.objects.update(is_active=False)
        self.season = Season.objects.create(
            name='SNAP-season',
            start_date=MON - timedelta(days=200),
            end_date=MON + timedelta(days=200),
            is_active=True,
        )
        self.block = GreenhouseBlock.objects.create(code='SNAP', carry_days=7, is_active=True)
        self._entry(MON, plan_value=Decimal('10000'))

    def _entry(self, day, **values):
        iso = day.isocalendar()
        plan, _ = WeeklyHarvestPlan.objects.get_or_create(
            season=self.season, block=self.block, week_number=iso.week, year=iso.year,
        )
        entry, _ = HarvestDayEntry.objects.get_or_create(
            weekly_plan=plan, entry_date=day,
            defaults={'season': self.season, 'block': self.block, 'weekday': day.weekday()},
        )
        for field, value in values.items():
            setattr(entry, field, value)
        entry.save()
        return entry

    def _stored(self):
        return dict(
            HarvestDayEntry.objects.filter(block=self.block)
            .values_list('entry_date', 'yesterday_rest_value')
        )

    def test_fills_today_and_the_three_days_before(self):
        self.assertEqual(snapshot_gaplama_leftovers(FRI), 4)
        stored = self._stored()
        self.assertIsNone(stored[MON])
        for day in (TUE, WED, THU, FRI):
            self.assertEqual(stored[day], Decimal('10000'), day)

    def test_hand_typed_value_survives_and_anchors_later_days(self):
        self._entry(WED, yesterday_rest_value=Decimal('500'))
        self.assertEqual(snapshot_gaplama_leftovers(FRI), 3)
        stored = self._stored()
        self.assertEqual(stored[TUE], Decimal('10000'))
        self.assertEqual(stored[WED], Decimal('500'))
        self.assertEqual(stored[THU], Decimal('500'))  # computed after WED, oldest first
        self.assertEqual(stored[FRI], Decimal('500'))

    def test_second_run_writes_nothing(self):
        snapshot_gaplama_leftovers(FRI)
        self.assertEqual(snapshot_gaplama_leftovers(FRI), 0)

    def test_stamps_no_person_and_writes_no_audit(self):
        audit_before = AuditLog.objects.count()
        snapshot_gaplama_leftovers(FRI)
        entry = HarvestDayEntry.objects.get(block=self.block, entry_date=FRI)
        self.assertIsNone(entry.daily_entered_by_id)
        self.assertIsNone(entry.daily_entered_at)
        self.assertEqual(AuditLog.objects.count(), audit_before)

    def test_no_active_season_writes_nothing(self):
        Season.objects.update(is_active=False)
        self.assertEqual(snapshot_gaplama_leftovers(FRI), 0)
        self.assertFalse(
            HarvestDayEntry.objects.filter(yesterday_rest_value__isnull=False).exists()
        )

    def test_skips_days_before_the_season_starts(self):
        self.season.start_date = WED
        self.season.save()
        self.assertEqual(snapshot_gaplama_leftovers(FRI), 3)  # WED, THU, FRI
        self.assertFalse(HarvestDayEntry.objects.filter(block=self.block, entry_date=TUE).exists())

    def test_creates_missing_rows_with_no_author(self):
        next_mon = MON + timedelta(days=7)
        self.assertEqual(snapshot_gaplama_leftovers(next_mon), 4)  # FRI..next MON
        entry = HarvestDayEntry.objects.get(block=self.block, entry_date=next_mon)
        self.assertEqual(entry.yesterday_rest_value, Decimal('10000'))  # age 7, still live
        self.assertIsNone(entry.weekly_plan.entered_by_id)
```

- [ ] **Step 2: Run to verify they fail**

Run: `RUNTEST apps.export.tests_gaplama_snapshot`
Expected: ERROR, `ModuleNotFoundError: No module named 'apps.export.services.gaplama_snapshot'`.

- [ ] **Step 3: Implement the service**

Create `backend/apps/export/services/gaplama_snapshot.py`:

```python
"""Midnight snapshot of Gaplama's starting leftover (spec 2026-09-30 §5).

Freezes each active block's starting carry-in into HarvestDayEntry.yesterday_rest_value,
computed by build_gaplama_board itself, so the stored number and the screen never use two
formulas. Only EMPTY fields are written: a hand-typed value is never overwritten, and a
rerun or a duplicate beat changes nothing. The last CATCH_UP_DAYS days are covered too,
oldest first (each day's carry-in depends on the day before), so a missed night heals.
Written straight to the field, not through upsert_daily_board: no person is stamped as
author and no audit entry is written, which is how the harvest-board tells an automatic
value from a hand-typed one.
"""
import logging
from datetime import date, timedelta

from apps.core.seasons import get_active_season
from apps.export.services.gaplama import build_gaplama_board
from apps.greenhouse.services import get_or_create_day_entry

logger = logging.getLogger(__name__)

CATCH_UP_DAYS = 3


def snapshot_gaplama_leftovers(today: date) -> int:
    """Store the starting leftover for today and the CATCH_UP_DAYS days before, where empty.

    Returns:
        How many HarvestDayEntry fields were written.
    """
    season = get_active_season()
    if season is None:
        logger.info('Gaplama leftover snapshot skipped: no active season.')
        return 0

    written = 0
    for offset in range(CATCH_UP_DAYS, -1, -1):
        day = today - timedelta(days=offset)
        # get_or_create_day_entry refuses dates outside the active season.
        if not (season.start_date <= day <= season.end_date):
            continue
        board = build_gaplama_board(day, day, season)
        for row in board['days']:
            entry = get_or_create_day_entry(row['block_id'], day)
            if entry.yesterday_rest_value is not None:
                continue
            entry.yesterday_rest_value = row['carried_in_kg']
            entry.save(update_fields=['yesterday_rest_value'])
            written += 1

    logger.info('Gaplama leftover snapshot for %s: %d field(s) written.', today, written)
    return written
```

- [ ] **Step 4: Run the tests**

Run: `RUNTEST apps.export.tests_gaplama_snapshot`
Expected: 7 PASS.

- [ ] **Step 5: Celery task + beat entry**

Append to `backend/apps/export/tasks.py`:

```python
@shared_task
def snapshot_gaplama_leftovers() -> None:
    """Daily 00:05: freeze each block's starting Gaplama leftover (today and 3 days back) where empty."""
    from apps.export.services.gaplama_snapshot import snapshot_gaplama_leftovers as run

    run(timezone.localdate())
```

In `backend/config/settings.py`, inside `CELERY_BEAT_SCHEDULE`, after the `'daily-plan-tasks'` entry, add:

```python
    # Gaplama stored leftover (spec 2026-09-30): just after a day closes, freeze each
    # block's starting carry-in into HarvestDayEntry.yesterday_rest_value. Writes only
    # empty fields and catches up 3 days, so a missed night heals on the next run.
    'snapshot-gaplama-leftovers': {
        'task': 'apps.export.tasks.snapshot_gaplama_leftovers',
        'schedule': crontab(hour=0, minute=5),
        'options': {'expires': 3600},
    },
```

- [ ] **Step 6: Smoke-check the task imports and beat config**

Run (from `backend/`): `python -c "import django,os;os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings');django.setup();from apps.export.tasks import snapshot_gaplama_leftovers;from django.conf import settings;print(settings.CELERY_BEAT_SCHEDULE['snapshot-gaplama-leftovers'])"`
Expected: prints the dict with `crontab(... 5 0 ...)`. **Do not** call the task. It would write to the shared dev/beta DB.

- [ ] **Step 7: Commit point** (only if the user has said "commit")

```bash
git status
git diff --cached --name-only
git commit -m "feat(p3): nightly snapshot of the Gaplama leftover" -- \
  backend/apps/export/services/gaplama_snapshot.py backend/apps/export/tasks.py \
  backend/config/settings.py backend/apps/export/tests_gaplama_snapshot.py
```

(`settings.py` must show only your hunk in `git diff -- backend/config/settings.py`. If it doesn't, use the hunk recipe from Global Constraints.)

---

### Task 3: Editable carry-in cell in Gaplama's day view

**Files:**
- Modify: `frontend/src/types/index.ts:1979-1996` (`IGaplamaDay`)
- Modify: `frontend/src/hooks/useGaplama.ts` (`IGaplamaDayRaw`, `coerceDay`)
- Modify: `frontend/src/hooks/useDailyBoard.ts:52-54` (`useUpsertDailyBoard.onSuccess`)
- Modify: `frontend/src/pages/sera/GaplamaTab.tsx` (imports L1-19; after `canCreate` L147; day-view row ~L369-420; folded rows ~L436-443)
- Modify: `frontend/src/pages/sera/sera.css` (after `.sera-gaplama-carry-in` ~L919)
- Modify: `frontend/src/i18n/tk.json`, `ru.json`, `en.json` (`tir_takip.gaplama`, after `formula_hint`)
- Test: `frontend/src/hooks/useGaplama.test.tsx`, `frontend/src/pages/sera/GaplamaTab.test.tsx`

**Interfaces:**
- Consumes: API `days[i].rest_stored_kg: string | null`, `days[i].rest_calc_kg: string` (Task 1). Existing `useUpsertDailyBoard()` → `POST /greenhouse/daily-plan/` with `{ block, date, yesterday_rest }`. Existing `DailyBoardNumberCell({ value: string | null, disabled?, saving?, onCommit(next: number | null) })` from `@/components/DailyBoardCell`. Existing `canSeePage(user, code)`.
- Produces: `IGaplamaDay.rest_stored_kg: number | null`, `IGaplamaDay.rest_calc_kg: number`; i18n keys `tir_takip.gaplama.rest_calc_hint` (`{{kg}}`) and `tir_takip.gaplama.rest_save_error`.

- [ ] **Step 1: Write the failing hook test**

In `frontend/src/hooks/useGaplama.test.tsx`, inside `describe('useGaplamaBoard', …)`, add:

```tsx
  it('coerces rest_stored_kg (null stays null) and rest_calc_kg', async () => {
    (api.get as any).mockResolvedValue({
      data: {
        days: [
          { date: '2026-09-22', block_id: 5, block_code: 'F', location: 'dusak',
            plan_kg: '0.00', loaded_kg: '0.00', carried_in_kg: '7000.00', carry_in_breakdown: [],
            available_kg: '7000.00', over_kg: '0.00', carried_out_kg: '0.00',
            rest_stored_kg: '7000.00', rest_calc_kg: '9000.00' },
          { date: '2026-09-23', block_id: 5, block_code: 'F', location: 'dusak',
            plan_kg: '0.00', loaded_kg: '0.00', carried_in_kg: '0.00', carry_in_breakdown: [],
            available_kg: '0.00', over_kg: '0.00', carried_out_kg: '0.00',
            rest_stored_kg: null, rest_calc_kg: '0.00' },
        ],
        trucks: [],
      },
    });
    const { result } = renderHook(() => useGaplamaBoard('2026-09-21', '2026-09-27'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.days[0].rest_stored_kg).toBe(7000);
    expect(result.current.data?.days[0].rest_calc_kg).toBe(9000);
    expect(result.current.data?.days[1].rest_stored_kg).toBeNull();
  });
```

- [ ] **Step 2: Write the failing GaplamaTab tests**

In `frontend/src/pages/sera/GaplamaTab.test.tsx`:

2a. Make the read-only mock controllable. Replace
`vi.mock('@/hooks/useSeasonReadOnly', () => ({ useSeasonReadOnly: () => false }));`
with:

```tsx
const mockSeasonReadOnly = vi.hoisted(() => ({ value: false }));
vi.mock('@/hooks/useSeasonReadOnly', () => ({ useSeasonReadOnly: () => mockSeasonReadOnly.value }));
```

2b. Append a new top-level `describe` at the end of the file:

```tsx
describe('GaplamaTab — stored leftover cell', () => {
  const TOMORROW = dayjs().add(1, 'day').format('YYYY-MM-DD');
  const EDITOR = {
    role: 'loading_dept_head', is_superuser: false, managed_block_ids: [],
    page_permissions: { 'export.harvest_board': true },
    resource_permissions: { shipment: { create: false } },
  };

  function restDay(date: string, over: Record<string, unknown> = {}) {
    return { date, block_id: 1, block_code: 'A', location: 'Dusak',
             plan_kg: '0.00', loaded_kg: '0.00', carried_in_kg: '9000.00', carry_in_breakdown: [],
             available_kg: '9000.00', over_kg: '0.00', carried_out_kg: '0.00',
             rest_stored_kg: null, rest_calc_kg: '9000.00', ...over };
  }

  function mockBoard(days: object[]) {
    (api.get as any).mockImplementation((url: string) => {
      if (url.includes('/export/gaplama/board/')) return Promise.resolve({ data: { days, trucks: [] } });
      if (url.includes('/core/blocks')) {
        return Promise.resolve({ data: { results: [
          { id: 1, code: 'A', name: 'A', parent: null, is_active: true, location_name: 'Dusak', carry_days: 7 },
        ] } });
      }
      if (url.includes('/greenhouse-config')) return Promise.resolve({ data: { truck_capacity_kg: '18500.00' } });
      if (url.includes('/core/shipment-options')) return Promise.resolve({ data: { results: [] } });
      return Promise.resolve({ data: {} });
    });
  }

  async function gridMounted(container: HTMLElement) {
    await waitFor(() => expect(container.querySelector('table.sera-gaplama-grid')).not.toBeNull());
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockSeasonReadOnly.value = false;
    (api.post as any).mockResolvedValue({ data: {} });
    mockBoard([restDay(TODAY), restDay(TOMORROW)]);
  });

  it('is an input for today with export.harvest_board', async () => {
    (useAuth as any).mockReturnValue({ user: EDITOR });
    const { container } = renderTab();
    await gridMounted(container);
    expect(digits((screen.getByRole('spinbutton') as HTMLInputElement).value)).toBe('9000');
  });

  it('saves through the daily-plan endpoint', async () => {
    (useAuth as any).mockReturnValue({ user: EDITOR });
    const { container } = renderTab();
    await gridMounted(container);
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '7000' } });
    fireEvent.blur(input);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/greenhouse/daily-plan/', { block: 1, date: TODAY, yesterday_rest: 7000 },
    ));
  });

  it('is read-only without export.harvest_board', async () => {
    (useAuth as any).mockReturnValue({ user: { ...EDITOR, page_permissions: {} } });
    const { container } = renderTab();
    await gridMounted(container);
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
  });

  it('is read-only in a read-only season', async () => {
    mockSeasonReadOnly.value = true;
    (useAuth as any).mockReturnValue({ user: EDITOR });
    const { container } = renderTab();
    await gridMounted(container);
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
  });

  it('is read-only for a greenhouse_manager on a block they do not manage', async () => {
    (useAuth as any).mockReturnValue({
      user: { ...EDITOR, role: 'greenhouse_manager', managed_block_ids: [99] },
    });
    const { container } = renderTab();
    await gridMounted(container);
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
  });

  it('is read-only for a day that has not started yet', async () => {
    (useAuth as any).mockReturnValue({ user: EDITOR });
    const { container } = renderTab();
    await gridMounted(container);
    await stepToDay(TOMORROW);
    await gridMounted(container);
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
  });

  it('is still editable on a folded (empty) block once expanded', async () => {
    mockBoard([restDay(TODAY, {
      carried_in_kg: '0.00', available_kg: '0.00', rest_calc_kg: '0.00',
    })]);
    (useAuth as any).mockReturnValue({ user: EDITOR });
    const { container } = renderTab();
    await gridMounted(container);
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
    fireEvent.click(container.querySelector('tr.sera-gaplama-folded-row') as HTMLElement);
    expect(screen.getAllByRole('spinbutton')).toHaveLength(1);
  });

  it('shows the calculated hint only when the stored value differs', async () => {
    mockBoard([restDay(TODAY, { carried_in_kg: '7000.00', rest_stored_kg: '7000.00', rest_calc_kg: '9000.00' })]);
    (useAuth as any).mockReturnValue({ user: EDITOR });
    const { container, unmount } = renderTab();
    await gridMounted(container);
    expect(screen.getByText('tir_takip.gaplama.rest_calc_hint')).toBeInTheDocument();
    unmount();

    mockBoard([restDay(TODAY, { rest_stored_kg: '9000.00', rest_calc_kg: '9000.00' })]);
    const second = renderTab();
    await gridMounted(second.container);
    expect(screen.queryByText('tir_takip.gaplama.rest_calc_hint')).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run (from `frontend/`): `npx vitest run src/hooks/useGaplama.test.tsx src/pages/sera/GaplamaTab.test.tsx`
Expected: the new cases FAIL (no spinbutton, `rest_stored_kg` undefined). Every pre-existing case still PASSES.

- [ ] **Step 4: Types and coercion**

In `frontend/src/types/index.ts`, inside `interface IGaplamaDay`, after `carried_out_kg: number;`, add:

```ts
  /** Stored starting leftover (HarvestDayEntry.yesterday_rest_value), post-expiry — null
   * when nothing is stored and the carry-in is purely calculated (spec 2026-09-30 §3). */
  rest_stored_kg: number | null;
  /** What the carry-in would be without the stored value. Stored ≠ calc → the
   * «hasap: X» hint, the only sign a frozen number went stale (spec §4). */
  rest_calc_kg: number;
```

In `frontend/src/hooks/useGaplama.ts`, inside `interface IGaplamaDayRaw`, after `carried_out_kg: string;`, add:

```ts
  // Optional: absent on deploys older than the stored-leftover change (2026-09-30).
  rest_stored_kg?: string | null;
  rest_calc_kg?: string;
```

and inside `coerceDay`'s returned object, after `carried_out_kg: …,`, add:

```ts
    rest_stored_kg: raw.rest_stored_kg == null ? null : Number(raw.rest_stored_kg),
    rest_calc_kg: Number(raw.rest_calc_kg) || 0,
```

- [ ] **Step 5: Refresh Gaplama after any daily-plan save**

In `frontend/src/hooks/useDailyBoard.ts`, replace the `useUpsertDailyBoard` `onSuccess`:

```ts
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      // «Düýnki galyndy» is Gaplama's stored leftover too (spec 2026-09-30 §6).
      queryClient.invalidateQueries({ queryKey: ['gaplama-board'] });
    },
```

- [ ] **Step 6: The cell in `GaplamaTab.tsx`**

6a. Imports: add

```tsx
import { toast } from 'sonner';
import { useUpsertDailyBoard } from '@/hooks/useDailyBoard';
import { DailyBoardNumberCell } from '@/components/DailyBoardCell';
```

and change `import { canDoBackendGated } from '@/utils/permissions';` to
`import { canDoBackendGated, canSeePage } from '@/utils/permissions';`.

6b. Directly after `const canCreate = canDoBackendGated(user, 'shipment', 'create') && !isReadOnly;`, add:

```tsx
  // Stored leftover (spec 2026-09-30 §6). The day's carry-in IS the harvest-board's
  // «Düýnki galyndy», so the same people may edit it here: page export.harvest_board,
  // and a greenhouse_manager only on their own blocks (the daily-plan endpoint enforces
  // both). Never in a read-only season, since the endpoint writes into the ACTIVE
  // season, and never for a day that hasn't started yet.
  const upsertRest = useUpsertDailyBoard();
  const canEditRestOnDay = !isReadOnly && selectedDay <= today && canSeePage(user, 'export.harvest_board');
  function canEditRest(blockId: number): boolean {
    if (!canEditRestOnDay || !user) return false;
    if (user.is_superuser || user.role !== 'greenhouse_manager') return true;
    return user.managed_block_ids.includes(blockId);
  }
  function saveRest(blockId: number, kg: number | null) {
    upsertRest.mutate(
      { block: blockId, date: selectedDay, yesterday_rest: kg },
      {
        onError: (err: unknown) => {
          const apiErr = err as { response?: { data?: { error?: string } } };
          toast.error(apiErr?.response?.data?.error ?? t('tir_takip.gaplama.rest_save_error'));
        },
      },
    );
  }

  // Day-view carry-in cell, shared by visible rows and expanded folded rows. A block
  // with nothing to show today must still take found crates (spec §6).
  function carryCell(blockId: number, row: IGaplamaDay | undefined): JSX.Element {
    const carried = row?.carried_in_kg ?? 0;
    // Oldest bucket first, one line per origin day — matches the FIFO consumption
    // order (design spec §3①).
    const carryTooltip = (row?.carry_in_breakdown ?? [])
      .map((b) => `${dayjs(b.origin_date).format('DD.MM')}: ${fmt(b.kg)} kg (${t('tir_takip.gaplama.carry_age', { days: b.age_days })})`)
      .join('\n');
    const staleCalc = row != null && row.rest_stored_kg !== null && row.rest_stored_kg !== row.rest_calc_kg
      ? row.rest_calc_kg
      : null;
    return (
      <td
        className={carried > 0 ? 'sera-gaplama-carry-in' : undefined}
        title={carryTooltip || undefined}
      >
        {canEditRest(blockId) ? (
          <DailyBoardNumberCell
            value={String(carried)}
            saving={upsertRest.isPending && upsertRest.variables?.block === blockId}
            onCommit={(kg) => saveRest(blockId, kg)}
          />
        ) : carried > 0 ? `+${fmt(carried)}` : '—'}
        {staleCalc !== null && (
          <div className="sera-gaplama-rest-calc-hint">
            {t('tir_takip.gaplama.rest_calc_hint', { kg: fmt(staleCalc) })}
          </div>
        )}
      </td>
    );
  }
```

6c. In the day-view block row (`visibleBlocksInLoc.map((block) => { … })`):
- delete `const carried = row?.carried_in_kg ?? 0;`
- delete the `carryTooltip` const and its comment (moved into `carryCell`)
- replace the whole carry `<td className={carried > 0 ? 'sera-gaplama-carry-in' : undefined} title={carryTooltip || undefined}>…</td>` with `{carryCell(block.id, row)}`.

6d. In the folded-block rows, replace `<td colSpan={6}>—</td>` with:

```tsx
                    <td colSpan={3}>—</td>
                    {carryCell(block.id, selectedDayRowByBlock[block.id])}
                    <td colSpan={2}>—</td>
```

- [ ] **Step 7: CSS**

In `frontend/src/pages/sera/sera.css`, after the `.sera-page .sera-gaplama-carry-in { … }` block, add:

```css
.sera-page .sera-gaplama-rest-calc-hint {
  font-size: 10px;
  font-weight: 400;
  color: var(--sera-text-faint);
  white-space: nowrap;
}

.sera-page .sera-gaplama-grid td .ant-input-number {
  min-width: 90px;
}
```

- [ ] **Step 8: i18n**

In each file, inside `"tir_takip"` → `"gaplama"`, directly after the `"formula_hint": …,` line, add:

`frontend/src/i18n/tk.json`:
```json
      "rest_calc_hint": "hasap: {{kg}}",
      "rest_save_error": "Galyndy ýazdyrylmady",
```
`frontend/src/i18n/ru.json`:
```json
      "rest_calc_hint": "расчёт: {{kg}}",
      "rest_save_error": "Не удалось сохранить остаток",
```
`frontend/src/i18n/en.json`:
```json
      "rest_calc_hint": "calculated: {{kg}}",
      "rest_save_error": "Could not save the leftover",
```

- [ ] **Step 9: Run tests + typecheck**

Run (from `frontend/`):
`npx vitest run src/hooks/useGaplama.test.tsx src/pages/sera/GaplamaTab.test.tsx src/pages/sera/GaplamaPage.test.tsx src/pages/sera/TirTakip.test.tsx`
Expected: all PASS.
Run: `npx tsc --noEmit --ignoreDeprecations 5.0`
Expected: no errors in the touched files. The repo may carry unrelated pre-existing errors, so capture the baseline list by running the same command once before Step 4, and compare against it (never `git stash` in this shared tree).

- [ ] **Step 10: Commit point** (only if the user has said "commit")

Whole files (all hunks yours; verify with `git diff -- <file>`):
`frontend/src/types/index.ts frontend/src/hooks/useGaplama.ts frontend/src/hooks/useGaplama.test.tsx frontend/src/hooks/useDailyBoard.ts frontend/src/pages/sera/GaplamaTab.tsx frontend/src/pages/sera/GaplamaTab.test.tsx frontend/src/pages/sera/sera.css`.
The three i18n files: **your 2 lines each only**, via the private-index hunk recipe. Message: `feat(frontend): edit the stored Gaplama leftover in the day view`.

---

### Task 4: Docs, changelog, build log

**Files:**
- Modify: `docs/obsidian/screens/gaplama.md`
- Modify: `docs/obsidian/processes/weekly-harvest-planning.md` (section «Daily Harvest Board», ~L449-485)
- Modify: `CHANGELOG.md`, `BUILD_TEST_LOG.md` (shared-dirty — your hunks only)

**Interfaces:** none.

- [ ] **Step 1: `gaplama.md`**

1a. Under `### The carry-over rule (no negative numbers)`, add this as the first paragraph:

```markdown
**Stored leftover (2026-09-30).** The carry-in is no longer only calculated. Every night at
00:05 (`snapshot-gaplama-leftovers`, `apps/export/services/gaplama_snapshot.py`), each block's
starting carry-in is frozen into `HarvestDayEntry.yesterday_rest_value`, the same field as the
harvest-board's «Düýnki galyndy». The job fills empty fields only, for today and the 3 days
before. When a stored value exists, `build_gaplama_board` reconciles its bucket queue to it
**after** expiry: a shortfall comes off the oldest bucket, a surplus joins yesterday's bucket.
Stored values change only by hand; nothing recomputes them, not weighing, not a corrected
earlier day. Each `days[]` row carries `rest_stored_kg` (null = nothing stored) and
`rest_calc_kg`, and the day view shows «hasap: X» when they differ. Spec:
`docs/superpowers/specs/2026-09-30-gaplama-stored-leftover-design.md`.
```

1b. Under `## What it shows`, at the end of the **Day view** paragraph, add:

```markdown
The carry-in cell is an inline kg input for anyone who can write the harvest-board (page
`export.harvest_board`; a greenhouse_manager only on their own blocks), for today and past days
only, never in a read-only season. It saves through `POST /greenhouse/daily-plan/`
(`yesterday_rest`). Clearing it returns that day to the calculated value. Expanded folded blocks
get the same input. The week view stays read-only.
```

1c. In the `## Files` table, add rows:

```markdown
| Stored-leftover job | `backend/apps/export/services/gaplama_snapshot.py` (`snapshot_gaplama_leftovers`), task `apps.export.tasks.snapshot_gaplama_leftovers`, beat `snapshot-gaplama-leftovers` (00:05) |
| Stored-leftover tests | `backend/apps/export/tests_gaplama_stored_leftover.py`, `tests_gaplama_snapshot.py` |
```

- [ ] **Step 2: `weekly-harvest-planning.md`**

At the end of the «Daily Harvest Board» section, add:

```markdown
**Since 2026-09-30, «Düýnki galyndy» is also Gaplama's stored leftover.** A nightly job
(00:05) fills empty `yesterday_rest_value` cells with Gaplama's calculated starting carry-in,
with no author and no audit entry. That is how an automatic value differs from a typed one on
this screen. A typed value is never overwritten, and Gaplama uses it as that day's carry-in.
See [[../screens/gaplama]].
```

- [ ] **Step 3: CHANGELOG + BUILD_TEST_LOG**

`CHANGELOG.md`, under `## [Unreleased]` → `### Added`, add one line:

```markdown
- **Gaplama stored leftover (feat(p3)).** A nightly job (00:05) freezes each block's starting carry-in into `HarvestDayEntry.yesterday_rest_value` (harvest-board «Düýnki galyndy»), filling empty fields for today and 3 days back. The board anchors its carry-in to the stored value (shortfall off the oldest bucket, surplus into yesterday's). The day view's carry-in cell is editable (page `export.harvest_board`) and shows «hasap: X» when stored ≠ calculated. No migration. **Deploy:** rebuild `celery-worker` + `celery-beat`. Spec: `docs/superpowers/specs/2026-09-30-gaplama-stored-leftover-design.md`.
```

`BUILD_TEST_LOG.md`, newest on top:

```markdown
- [ ] 2026-09-30 — Gaplama stored leftover: nightly snapshot into «Düýnki galyndy», board anchors to it, carry-in cell editable in Gaplama day view — NEEDS TEST
  To test (as superuser; real roles can't open Gaplama until `tir_takip.gaplama` is restored):
  (1) Gaplama → Gün, today: click «perenos» of a block, type a lower number, Enter → the cell
  keeps it, available drops by the difference, «hasap: X» shows the old calculated number;
  (2) harvest-board, same date: «Düýnki galyndy» shows the typed number with your name as
  author; (3) type a higher number → available rises, the tooltip shows the extra dated
  yesterday; (4) clear the cell → back to the calculated number, no hint; (5) step to tomorrow →
  the cell is not editable; (6) next morning after 00:05 (celery beat running): harvest-board
  shows filled «Düýnki galyndy» cells with an empty author.
```

- [ ] **Step 4: Commit point** (only if the user has said "commit")

Whole files: the two obsidian docs. `CHANGELOG.md` / `BUILD_TEST_LOG.md`: your hunks only (private-index recipe). Message: `docs: Gaplama stored leftover`.

---

### Task 5: One-off cleanup of the 49 test values (shared DB)

Approved by the owner on 2026-09-30 (spec §7). This writes to the shared dev/beta DB. Run it once, and only after Tasks 1–3 pass.

- [ ] **Step 1: Count first**

Run (from `backend/`):

```bash
python manage.py shell -c "from datetime import date; from apps.greenhouse.models import HarvestDayEntry as H; print(H.objects.filter(yesterday_rest_value__isnull=False, entry_date__lte=date(2026, 8, 21)).count())"
```

Expected: `49`. **Any other number → stop and ask the user.** It would mean someone has typed real values since.

- [ ] **Step 2: Clear**

```bash
python manage.py shell -c "from datetime import date; from apps.greenhouse.models import HarvestDayEntry as H; print(H.objects.filter(yesterday_rest_value__isnull=False, entry_date__lte=date(2026, 8, 21)).update(yesterday_rest_value=None))"
```

Expected: `49`.

- [ ] **Step 3: Record it**

Add a `### Data` line to `CHANGELOG.md` `[Unreleased]`:
`- Cleared 49 test values from «Düýnki galyndy» (HarvestDayEntry.yesterday_rest_value, 2026-06-01…2026-08-21) on the shared DB before the stored-leftover change (data).`

---

## Deploy (after all tasks, when the user asks)

1. Deploy code; rebuild `celery-worker` and `celery-beat` (new beat entry).
2. Task 5 has already cleaned the shared DB. Beta shares it, so there is nothing more to clean.
3. The next morning, check the harvest-board: cells filled, author empty.
