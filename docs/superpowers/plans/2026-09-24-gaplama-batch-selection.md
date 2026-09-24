# Gaplama Batch Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Gaplama operator see every remainder's harvest date and age, choose which ones go on a truck, and give each greenhouse block its own carry-over window instead of one global 2-day rule.

**Architecture:** `GreenhouseBlock.carry_days` replaces `GreenhouseConfig.gaplama_carry_days` as the authority; the FIFO walk in `build_gaplama_board` keeps its bucket deque but expires per block and attributes each load to the bucket named by `ShipmentBlockSource.harvest_date` instead of consuming oldest-first. `harvest_date` already means "the day these tomatoes were harvested", so a batch is a harvest date and the unique key simply widens. The board's two tables collapse into one with a `Gün`/`Hepde` toggle.

**Tech Stack:** Django 5.1 + DRF on MSSQL (`mssql-django`), React 18 + TypeScript + Ant Design 6 + TanStack Query, vitest, i18next (tk/ru/en).

**Spec:** `docs/superpowers/specs/2026-09-24-gaplama-batch-selection-design.md`

**Base branch:** `worktree-gaplama-screen`. Gaplama is **not on `main`** — do not branch from `main`. Per this repo's parallel-session rule, create an isolated worktree:
```bash
git worktree add D:/projects/ygt_gaplama_batches -b feat/gaplama-batches worktree-gaplama-screen
cp backend/.env D:/projects/ygt_gaplama_batches/backend/.env
```

## Global Constraints

- **MSSQL:** no `JSONField`, no `ArrayField`, no `.distinct('field')`; every `bulk_create`/`bulk_update` passes `batch_size=500`; money and weight are `DecimalField(max_digits=…, decimal_places=2)`, never `FloatField`; `CharField` always has `max_length`.
- **MSSQL unique indexes permit exactly one NULL row per key combination** — unlike Postgres. Any nullable column entering a unique key must be backfilled first.
- **Status transitions** go through `transition_to()`, never a direct `status_id` write. No task here touches status.
- **Dependency direction:** `core ← greenhouse ← export`. No reverse imports. No Django signals.
- **Decimals cross the API as strings** (api-contract); the frontend coerces at the fetch boundary in `useGaplama.ts`, never in components.
- **Block sources are stored at parent grain.** `write_block_sources()` is the single choke point; sub-blocks merge into their top-level ancestor.
- **i18n:** every user-facing string goes through `t()` with keys in all three of `en.json`, `ru.json`, `tk.json`.
- **Frontend typecheck:** `npx tsc --noEmit --ignoreDeprecations 5.0` (`npm run type-check` is broken, TS5103).
- **Backend tests:** `DJANGO_TESTING=true TEST_DB_NAME=test_ygt_batches python manage.py test <app> --parallel=1`. A private `TEST_DB_NAME` is required — concurrent runs share one test database and deadlock.
- **The system never blocks a choice.** No shelf-life validation, no refusal of an old batch. Show, never forbid.

## Review Focus

Five conditions the spec implies but no task's happy path exercises. Each gets a test in the task that owns the code.

1. **A shipment whose `block_sources` row has a null `harvest_date`** (every row created before this change) must produce the same board numbers as today — covered in Task 4.
2. **A `harvest_date` pointing at a bucket that has already expired** — an operator edits a truck days later. Must fall back to FIFO and not crash or double-count — covered in Task 4.
3. **Two batches from the same block on one truck** must survive `merge_to_parent` as two rows, not be collapsed into one by the old "first non-null harvest_date wins" rule — covered in Task 3.
4. **A sub-block source carrying a harvest date** must fold into its parent while keeping its own batch identity — covered in Task 3.
5. **A block whose `carry_days` is shorter than its neighbours'** must expire its buckets on its own schedule inside a single shared walk window — covered in Task 2.

---

### Task 1: `GreenhouseBlock.carry_days`

**Files:**
- Modify: `backend/apps/core/models/greenhouse_block.py` (after `is_active`, line ~58)
- Create: `backend/apps/core/migrations/0060_greenhouseblock_carry_days.py`
- Modify: `backend/apps/core/serializers.py` (the `GreenhouseBlock` serializer's `fields`)
- Test: `backend/apps/core/tests_block_carry_days.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `GreenhouseBlock.carry_days: int` (default 7). Task 2 reads it. The API field name is `carry_days` on the blocks list endpoint; Task 6 reads it in the frontend.

- [ ] **Step 1: Write the failing test**

Create `backend/apps/core/tests_block_carry_days.py`:

```python
"""`carry_days` per block replaces the one global gaplama_carry_days (2026-09-24)."""
from django.test import TestCase

from apps.core.models import GreenhouseBlock


class BlockCarryDaysTests(TestCase):
    def test_defaults_to_seven(self):
        """Every block starts at 7 — the owner's decision, not a cold-storage flag."""
        block = GreenhouseBlock.objects.create(code='CD1', name='Carry test')
        self.assertEqual(block.carry_days, 7)

    def test_is_settable_per_block(self):
        a = GreenhouseBlock.objects.create(code='CD2', carry_days=2)
        b = GreenhouseBlock.objects.create(code='CD3', carry_days=7)
        self.assertEqual(
            list(
                GreenhouseBlock.objects.filter(code__in=['CD2', 'CD3'])
                .order_by('code').values_list('carry_days', flat=True)
            ),
            [2, 7],
        )
        self.assertNotEqual(a.carry_days, b.carry_days)
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd backend
DJANGO_TESTING=true TEST_DB_NAME=test_ygt_batches python manage.py test apps.core.tests_block_carry_days --parallel=1
```
Expected: FAIL — `TypeError: GreenhouseBlock() got unexpected keyword arguments: 'carry_days'`.

- [ ] **Step 3: Add the field**

In `backend/apps/core/models/greenhouse_block.py`, directly after the `is_active` field:

```python
    # How many days a leftover from this block stays loadable. Blocks with cold
    # storage hold tomatoes for days; blocks without do not. Replaces the single
    # GreenhouseConfig.gaplama_carry_days, which applied 2 days to everything
    # (owner report 2026-09-24). Everyone starts at 7 and is tuned later.
    carry_days = models.PositiveSmallIntegerField(default=7)
```

- [ ] **Step 4: Generate and apply the migration**

```bash
cd backend
python manage.py makemigrations core --name greenhouseblock_carry_days
python manage.py migrate core
python manage.py showmigrations core | tail -3
```
Expected: `0060_greenhouseblock_carry_days` present and `[X]`. Existing rows take the default 7 — no data migration needed, `PositiveSmallIntegerField(default=7)` is not nullable and Django writes the default.

- [ ] **Step 5: Expose it on the blocks API**

In `backend/apps/core/serializers.py`, add `'carry_days'` to the `fields` list of the serializer used by the greenhouse-blocks list endpoint (the one `useGreenhouseBlocks` reads). Grep for `class GreenhouseBlockSerializer` to find it.

- [ ] **Step 6: Run the tests**

```bash
cd backend
DJANGO_TESTING=true TEST_DB_NAME=test_ygt_batches python manage.py test apps.core.tests_block_carry_days --parallel=1
```
Expected: 2 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/apps/core/models/greenhouse_block.py \
        backend/apps/core/migrations/0060_greenhouseblock_carry_days.py \
        backend/apps/core/serializers.py \
        backend/apps/core/tests_block_carry_days.py
git commit -m "feat(core): give each greenhouse block its own carry window"
```

---

### Task 2: per-block expiry and `age_days` in the walk

**Files:**
- Modify: `backend/apps/export/services/gaplama.py` (the `carry_days` lookup ~line 80, `walk_start`, the expiry `while` ~line 163, `carry_in_breakdown` ~line 169)
- Test: `backend/apps/export/tests_gaplama_carry_days.py`

**Interfaces:**
- Consumes: `GreenhouseBlock.carry_days` from Task 1.
- Produces: `carry_in_breakdown` entries gain `age_days: int`. The walk still returns the same `days`/`trucks`/`week_totals` keys. Task 5 serializes `age_days`; Task 6 renders it.

- [ ] **Step 1: Write the failing test**

Create `backend/apps/export/tests_gaplama_carry_days.py`:

```python
"""Each block expires its own buckets; the walk window is shared (2026-09-24)."""
from datetime import date, timedelta
from decimal import Decimal

from django.test import TestCase

from apps.core.models import GreenhouseBlock, Season
from apps.export.services.gaplama import build_gaplama_board
from apps.greenhouse.models import HarvestDayEntry, WeeklyHarvestPlan


class PerBlockCarryDaysTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.monday = date(2026, 6, 1)
        Season.objects.update(is_active=False)
        cls.season = Season.objects.create(
            name='CD-season',
            start_date=cls.monday - timedelta(days=200),
            end_date=cls.monday + timedelta(days=200),
            is_active=True,
        )
        # Short keeps a leftover for 2 days, long for 7. Same plan, same day.
        cls.short = GreenhouseBlock.objects.create(code='SHORT', carry_days=2, is_active=True)
        cls.long = GreenhouseBlock.objects.create(code='LONG', carry_days=7, is_active=True)
        for block in (cls.short, cls.long):
            plan = WeeklyHarvestPlan.objects.create(
                season=cls.season, block=block,
                week_number=cls.monday.isocalendar().week, year=cls.monday.isocalendar().year,
            )
            HarvestDayEntry.objects.create(
                weekly_plan=plan, season=cls.season, block=block,
                entry_date=cls.monday, weekday=0, plan_value=Decimal('10000'),
            )

    def _available_on(self, day, block_id):
        board = build_gaplama_board(day, day, self.season)
        row = next(r for r in board['days'] if r['block_id'] == block_id)
        return row['available_kg']

    def test_short_block_expires_before_the_long_one(self):
        """Monday's 10 000 is still live on Thursday for LONG, gone for SHORT."""
        thursday = self.monday + timedelta(days=3)
        self.assertEqual(self._available_on(thursday, self.long.id), Decimal('10000'))
        self.assertEqual(self._available_on(thursday, self.short.id), Decimal('0'))

    def test_breakdown_carries_the_age_in_days(self):
        wednesday = self.monday + timedelta(days=2)
        board = build_gaplama_board(wednesday, wednesday, self.season)
        row = next(r for r in board['days'] if r['block_id'] == self.long.id)
        self.assertEqual(
            row['carry_in_breakdown'],
            [{'origin_date': self.monday, 'kg': Decimal('10000'), 'age_days': 2}],
        )
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd backend
DJANGO_TESTING=true TEST_DB_NAME=test_ygt_batches python manage.py test apps.export.tests_gaplama_carry_days --parallel=1
```
Expected: both FAIL — SHORT still holds 10 000 on Thursday (the global 2-day rule is not being read per block; whichever value `GreenhouseConfig` holds applies to both), and `carry_in_breakdown` has no `age_days` key.

- [ ] **Step 3: Read `carry_days` per block**

In `build_gaplama_board`, replace the global lookup:

```python
    config = GreenhouseConfig.get_solo()
    carry_days = config.gaplama_carry_days
```

with a per-block map and a shared window based on the widest one:

```python
    # Per block since 2026-09-24: a block with cold storage holds a leftover for
    # days, one without does not. The walk window is sized by the WIDEST block so
    # a single pass serves them all; each block then expires on its own schedule
    # inside that window, so a short block is not kept alive by a long neighbour.
    carry_days_by_block: dict[int, int] = dict(
        GreenhouseBlock.objects.values_list('id', 'carry_days')
    )
    max_carry_days = max(carry_days_by_block.values(), default=2)
```

Then change `walk_start` to use `max_carry_days` wherever it currently uses `carry_days` (the `2 *` factor and the reasoning in the surrounding comment are unchanged — keep that comment, it explains the 2× depth).

- [ ] **Step 4: Expire per block and record the age**

Inside the `for block_id in block_ids:` loop, before the day loop, bind this block's window:

```python
        block_carry_days = carry_days_by_block.get(block_id, max_carry_days)
```

Change the expiry condition from `> carry_days` to `> block_carry_days`:

```python
            while buckets and (d - buckets[0][1]).days > block_carry_days:
                buckets.popleft()
```

And give each breakdown entry its age:

```python
            carry_in_breakdown = [
                {'origin_date': b[1], 'kg': b[0], 'age_days': (d - b[1]).days}
                for b in buckets
            ]
```

- [ ] **Step 5: Run the tests**

```bash
cd backend
DJANGO_TESTING=true TEST_DB_NAME=test_ygt_batches python manage.py test apps.export.tests_gaplama_carry_days apps.export.tests_gaplama_board --parallel=1
```
Expected: the 2 new tests PASS **and** every existing `tests_gaplama_board` test still passes. Those older tests were written against the global 2-day rule; with all blocks now defaulting to 7 some may legitimately need their fixture to set `carry_days=2` on the block they create. Update the fixture, never the assertion — if an assertion about kg has to change, stop and re-read the walk, because the arithmetic should not have moved.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/export/services/gaplama.py backend/apps/export/tests_gaplama_carry_days.py
git commit -m "feat(p3): expire gaplama buckets per block and report batch age"
```

---

### Task 3: one `ShipmentBlockSource` row per batch

**Files:**
- Modify: `backend/apps/export/models/shipment.py:443-445` (the `Meta` of `ShipmentBlockSource`)
- Modify: `backend/apps/export/services/block_sources.py` (`merge_to_parent`)
- Create: `backend/apps/export/migrations/0078_block_source_batch_key.py`
- Test: `backend/apps/export/tests_block_source_batches.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ShipmentBlockSource` rows keyed `(shipment, block, harvest_date)`; `merge_to_parent(entries, parent_map)` now returns `OrderedDict[tuple[int, date | None], dict]` keyed by `(parent_id, harvest_date)` with each value `{'weight_kg': Decimal}`. Task 4 reads the rows; Task 7 writes them from the form.

**The backfill decision:** the spec leaves this open. This plan assumes **`shipment.harvest_date` when set, else `shipment.date`**. Confirm with the owner before running Step 4 — it writes a date onto rows an operator deliberately left blank, and that date shows on Sheet R39.

- [ ] **Step 1: Write the failing test**

Create `backend/apps/export/tests_block_source_batches.py`:

```python
"""A truck may take two batches from one block (2026-09-24)."""
from datetime import date
from decimal import Decimal

from django.test import TestCase

from apps.core.models import GreenhouseBlock
from apps.export.services.block_sources import build_block_parent_map, merge_to_parent


class MergeToParentBatchTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.parent = GreenhouseBlock.objects.create(code='BP', is_active=True)
        cls.child = GreenhouseBlock.objects.create(code='BP1', parent=cls.parent, is_active=True)

    def test_two_batches_from_one_block_stay_two_rows(self):
        """The old rule summed them and kept the first harvest_date, losing a batch."""
        merged = merge_to_parent(
            [
                {'block': self.parent.id, 'weight_kg': '3000', 'harvest_date': date(2026, 6, 1)},
                {'block': self.parent.id, 'weight_kg': '5000', 'harvest_date': date(2026, 6, 3)},
            ],
            build_block_parent_map(),
        )
        self.assertEqual(
            dict(merged),
            {
                (self.parent.id, date(2026, 6, 1)): {'weight_kg': Decimal('3000')},
                (self.parent.id, date(2026, 6, 3)): {'weight_kg': Decimal('5000')},
            },
        )

    def test_same_batch_twice_is_still_summed(self):
        merged = merge_to_parent(
            [
                {'block': self.parent.id, 'weight_kg': '1000', 'harvest_date': date(2026, 6, 1)},
                {'block': self.parent.id, 'weight_kg': '2000', 'harvest_date': date(2026, 6, 1)},
            ],
            build_block_parent_map(),
        )
        self.assertEqual(
            dict(merged),
            {(self.parent.id, date(2026, 6, 1)): {'weight_kg': Decimal('3000')}},
        )

    def test_sub_block_folds_to_parent_but_keeps_its_batch(self):
        """Review Focus 4 — grain normalization must not erase batch identity."""
        merged = merge_to_parent(
            [
                {'block': self.child.id, 'weight_kg': '1500', 'harvest_date': date(2026, 6, 2)},
                {'block': self.parent.id, 'weight_kg': '500', 'harvest_date': date(2026, 6, 4)},
            ],
            build_block_parent_map(),
        )
        self.assertEqual(
            dict(merged),
            {
                (self.parent.id, date(2026, 6, 2)): {'weight_kg': Decimal('1500')},
                (self.parent.id, date(2026, 6, 4)): {'weight_kg': Decimal('500')},
            },
        )

    def test_null_harvest_date_is_its_own_key(self):
        merged = merge_to_parent(
            [
                {'block': self.parent.id, 'weight_kg': '900'},
                {'block': self.parent.id, 'weight_kg': '100', 'harvest_date': date(2026, 6, 1)},
            ],
            build_block_parent_map(),
        )
        self.assertEqual(
            dict(merged),
            {
                (self.parent.id, None): {'weight_kg': Decimal('900')},
                (self.parent.id, date(2026, 6, 1)): {'weight_kg': Decimal('100')},
            },
        )
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd backend
DJANGO_TESTING=true TEST_DB_NAME=test_ygt_batches python manage.py test apps.export.tests_block_source_batches --parallel=1
```
Expected: FAIL — the current `merge_to_parent` keys on `top_id` alone, so it returns one summed entry per block.

- [ ] **Step 3: Rewrite `merge_to_parent`**

Replace the function body in `backend/apps/export/services/block_sources.py`:

```python
def merge_to_parent(entries, parent_map: dict[int, int]) -> "OrderedDict[tuple, dict]":
    """Collapse (block, weight, harvest_date) entries to {(parent_id, harvest_date): {...}}.

    Keyed on the BATCH, not the block (2026-09-24). A truck may take two harvest
    days from the same block — the operator picks them by date in Gaplama — and the
    old key summed those into one row, keeping the first non-null harvest_date and
    silently losing the other batch. Weights within one batch are still summed and
    input order is still kept.
    """
    merged: "OrderedDict[tuple, dict]" = OrderedDict()
    for entry in entries:
        top_id = parent_map.get(_block_id(entry['block']), _block_id(entry['block']))
        key = (top_id, entry.get('harvest_date'))
        weight = Decimal(str(entry['weight_kg']))
        if key in merged:
            merged[key]['weight_kg'] += weight
        else:
            merged[key] = {'weight_kg': weight}
    return merged
```

Then update `write_block_sources` to unpack the new key. Read the function first — it iterates `merged.items()` and builds `ShipmentBlockSource(...)`; the loop variable becomes `for (block_id, harvest_date), row in merged.items():` and `harvest_date=harvest_date` comes from the key rather than `row['harvest_date']`. Keep `batch_size=500` on the `bulk_create`.

- [ ] **Step 4: Backfill, then widen the key**

Create `backend/apps/export/migrations/0078_block_source_batch_key.py`:

```python
"""Widen the block-source key to (shipment, block, harvest_date).

MSSQL permits exactly ONE null row per unique key combination, unlike Postgres, so
every null harvest_date must be filled before the constraint is applied or the
migration fails on the first shipment/block pair with two null rows.

Backfill rule (owner-confirmed): the shipment's own harvest_date when set, else the
shipment date. This writes a date onto rows an operator left blank, which is visible
on Sheet R39.
"""
from django.db import migrations, models


def backfill_harvest_dates(apps, schema_editor):
    ShipmentBlockSource = apps.get_model('export', 'ShipmentBlockSource')
    rows = ShipmentBlockSource.objects.filter(harvest_date__isnull=True).select_related('shipment')
    to_update = []
    for row in rows:
        row.harvest_date = row.shipment.harvest_date or row.shipment.date
        to_update.append(row)
    if to_update:
        ShipmentBlockSource.objects.bulk_update(to_update, ['harvest_date'], batch_size=500)


def noop_reverse(apps, schema_editor):
    """Not reversible in data: which dates were originally blank is not recorded."""


class Migration(migrations.Migration):

    dependencies = [
        ("export", "0077_gapy_driver_passports"),
    ]

    operations = [
        migrations.RunPython(backfill_harvest_dates, noop_reverse),
        migrations.AlterUniqueTogether(
            name="shipmentblocksource",
            unique_together={("shipment", "block", "harvest_date")},
        ),
    ]
```

Check the real latest export migration before writing `dependencies` — `ls backend/apps/export/migrations/ | tail -3`. Then update the model's `Meta`:

```python
    class Meta:
        db_table = schema_table('export', 'shipment_block_sources')
        # (shipment, block) until 2026-09-24. A truck may carry two harvest days
        # from one block; harvest_date is the batch identity, so it joins the key.
        unique_together = [('shipment', 'block', 'harvest_date')]
```

Run it:
```bash
cd backend
python manage.py migrate export
python manage.py showmigrations export | tail -3
```

- [ ] **Step 5: Run the tests**

```bash
cd backend
DJANGO_TESTING=true TEST_DB_NAME=test_ygt_batches python manage.py test apps.export.tests_block_source_batches apps.export --parallel=1 2>&1 | tail -25
```
Expected: the 4 new tests PASS. Compare the rest against the pre-change failure list — capture it first with `git stash` if you have not already. Only **new** failures matter; this suite has known pre-existing reds.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/export/models/shipment.py \
        backend/apps/export/services/block_sources.py \
        backend/apps/export/migrations/0078_block_source_batch_key.py \
        backend/apps/export/tests_block_source_batches.py
git commit -m "feat(p3): key block sources by batch, not just by block"
```

---

### Task 4: attribute loads to the chosen batch

**Files:**
- Modify: `backend/apps/export/services/gaplama.py` (the `loaded_rows` query ~line 138 and the consumption loop ~line 175)
- Test: `backend/apps/export/tests_gaplama_batch_consumption.py`

**Interfaces:**
- Consumes: batch rows from Task 3, per-block expiry from Task 2.
- Produces: no signature change. `days[].loaded_kg`, `available_kg` and `over_kg` keep their meaning; only which bucket a load drains changes.

- [ ] **Step 1: Write the failing test**

Create `backend/apps/export/tests_gaplama_batch_consumption.py`:

```python
"""Loads drain the batch the operator picked, not the oldest one (2026-09-24)."""
from datetime import date, timedelta
from decimal import Decimal

from django.test import TestCase

from apps.core.models import GreenhouseBlock, Season, ShipmentStatusType
from apps.export.models import Shipment, ShipmentBlockSource
from apps.export.services.gaplama import build_gaplama_board
from apps.greenhouse.models import HarvestDayEntry, WeeklyHarvestPlan


class BatchConsumptionTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.mon = date(2026, 6, 1)
        cls.wed = cls.mon + timedelta(days=2)
        Season.objects.update(is_active=False)
        cls.season = Season.objects.create(
            name='BC-season',
            start_date=cls.mon - timedelta(days=200),
            end_date=cls.mon + timedelta(days=200),
            is_active=True,
        )
        cls.block = GreenhouseBlock.objects.create(code='BC', carry_days=7, is_active=True)
        plan = WeeklyHarvestPlan.objects.create(
            season=cls.season, block=cls.block,
            week_number=cls.mon.isocalendar().week, year=cls.mon.isocalendar().year,
        )
        for offset, kg in ((0, '4000'), (2, '9000')):
            HarvestDayEntry.objects.create(
                weekly_plan=plan, season=cls.season, block=cls.block,
                entry_date=cls.mon + timedelta(days=offset), weekday=offset,
                plan_value=Decimal(kg),
            )
        cls.status = ShipmentStatusType.objects.filter(code='draft').first()

    def _truck(self, harvest_date, kg):
        shipment = Shipment.objects.create(
            season=self.season, date=self.wed, status=self.status, is_draft=True,
        )
        ShipmentBlockSource.objects.create(
            shipment=shipment, block=self.block,
            weight_kg=Decimal(kg), harvest_date=harvest_date,
        )
        return shipment

    def _breakdown(self, day):
        board = build_gaplama_board(day, day, self.season)
        row = next(r for r in board['days'] if r['block_id'] == self.block.id)
        return {b['origin_date']: b['kg'] for b in row['carry_in_breakdown']}

    def test_picking_the_fresh_batch_leaves_the_old_one_alone(self):
        """4 000 from Monday stays whole; Wednesday's own 9 000 takes the hit."""
        self._truck(self.wed, '9000')
        thursday = self.mon + timedelta(days=3)
        self.assertEqual(self._breakdown(thursday).get(self.mon), Decimal('4000'))

    def test_picking_the_old_batch_drains_it(self):
        self._truck(self.mon, '4000')
        thursday = self.mon + timedelta(days=3)
        self.assertNotIn(self.mon, self._breakdown(thursday))

    def test_null_harvest_date_falls_back_to_fifo(self):
        """Review Focus 1 — every pre-2026-09-24 row has a null harvest_date."""
        self._truck(None, '4000')
        thursday = self.mon + timedelta(days=3)
        self.assertNotIn(self.mon, self._breakdown(thursday))

    def test_expired_batch_date_falls_back_to_fifo(self):
        """Review Focus 2 — an edit days later can name a bucket that is gone."""
        long_ago = self.mon - timedelta(days=60)
        self._truck(long_ago, '4000')
        thursday = self.mon + timedelta(days=3)
        board = build_gaplama_board(thursday, thursday, self.season)
        row = next(r for r in board['days'] if r['block_id'] == self.block.id)
        self.assertNotIn(long_ago, {b['origin_date'] for b in row['carry_in_breakdown']})
        self.assertGreaterEqual(row['available_kg'], Decimal('0'))
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd backend
DJANGO_TESTING=true TEST_DB_NAME=test_ygt_batches python manage.py test apps.export.tests_gaplama_batch_consumption --parallel=1
```
Expected: `test_picking_the_fresh_batch_leaves_the_old_one_alone` FAILS — FIFO drains Monday's 4 000 first. The other three may already pass; they guard the fallback you are about to write.

- [ ] **Step 3: Carry the harvest date through the loaded query**

In `build_gaplama_board`, add `harvest_date` to the grouping:

```python
        .values('block_id', 'shipment__date', 'harvest_date')
        .annotate(loaded_kg=Sum('weight_kg'))
        .order_by()
```

and build a per-batch map alongside the existing total:

```python
    loaded_map: dict[tuple[int, date], Decimal] = {}
    # Which batch each load named, so the walk can drain that bucket instead of the
    # oldest one (2026-09-24). None groups every unattributed row — rows written
    # before batches existed, and rows naming a bucket that has since expired.
    loaded_by_batch: dict[tuple[int, date], dict] = {}
    for row in loaded_rows:
        block_id = parent_of.get(row['block_id'], row['block_id'])
        key = (block_id, row['shipment__date'])
        kg = row['loaded_kg'] or Decimal(0)
        loaded_map[key] = loaded_map.get(key, Decimal(0)) + kg
        batches = loaded_by_batch.setdefault(key, {})
        origin = row['harvest_date']
        batches[origin] = batches.get(origin, Decimal(0)) + kg
```

- [ ] **Step 4: Drain the named bucket first, then fall back**

Replace the consumption block inside the day loop:

```python
            # Consume oldest bucket first, then today's plan.
            to_consume = loaded_kg
            for bucket in buckets:
                if to_consume <= 0:
                    break
                take = min(bucket[0], to_consume)
                bucket[0] -= take
                to_consume -= take
```

with:

```python
            # Drain the bucket each load NAMED (2026-09-24). An operator who picked
            # the fresh batch must not have the four-day-old one drained instead.
            by_batch = dict(loaded_by_batch.get((block_id, d), {}))
            unattributed = by_batch.pop(None, Decimal(0))
            for bucket in buckets:
                want = by_batch.get(bucket[1])
                if not want:
                    continue
                take = min(bucket[0], want)
                bucket[0] -= take
                by_batch[bucket[1]] = want - take
            # A named batch with no live bucket left — a row written before batches
            # existed, or one naming a bucket that has since expired — rejoins the
            # FIFO pool rather than vanishing, so loaded_kg still balances.
            to_consume = unattributed + sum(by_batch.values(), Decimal(0))
            for bucket in buckets:
                if to_consume <= 0:
                    break
                take = min(bucket[0], to_consume)
                bucket[0] -= take
                to_consume -= take
```

`available_kg`, `over_kg` and `remainder_today` below are unchanged — they read `loaded_kg`, `carried_in_kg` and `to_consume`, all of which still mean what they did.

- [ ] **Step 5: Run the tests**

```bash
cd backend
DJANGO_TESTING=true TEST_DB_NAME=test_ygt_batches python manage.py test apps.export.tests_gaplama_batch_consumption apps.export.tests_gaplama_board apps.export.tests_gaplama_carry_days --parallel=1
```
Expected: all PASS, including every pre-existing board test. If a board test fails on kg arithmetic, the fallback is dropping weight — check that `to_consume` still receives the unattributed remainder.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/export/services/gaplama.py backend/apps/export/tests_gaplama_batch_consumption.py
git commit -m "feat(p3): drain the batch the operator picked, not the oldest"
```

---

### Task 5: serialize `age_days` and the block's window

**Files:**
- Modify: `backend/apps/export/views_gaplama.py` (the board serializer)
- Modify: `frontend/src/types/index.ts:1886-1889` (`IGaplamaCarryInBucket`) and the `IGreenhouseBlock` interface
- Modify: `frontend/src/hooks/useGaplama.ts:13-16` (`IGaplamaCarryInBucketRaw`) and its coercion
- Test: `backend/apps/export/tests_gaplama_board.py` (add one case), `frontend/src/hooks/useGaplama.test.tsx` (add one case)

**Interfaces:**
- Consumes: `age_days` from Task 2, `carry_days` from Task 1.
- Produces: `IGaplamaCarryInBucket { origin_date: string; kg: number; age_days: number }` and `IGreenhouseBlock.carry_days: number`. Tasks 6 and 7 render both.

- [ ] **Step 1: Write the failing frontend test**

Append to `frontend/src/hooks/useGaplama.test.tsx`:

```tsx
it('coerces the batch age alongside kg', async () => {
  vi.mocked(api.get).mockResolvedValue({
    data: {
      days: [{
        date: '2026-06-03', block_id: 1, block_code: 'A', location: 'Duşak',
        plan_kg: '9000', loaded_kg: '0', carried_in_kg: '4000',
        carry_in_breakdown: [{ origin_date: '2026-06-01', kg: '4000', age_days: 2 }],
        available_kg: '13000', over_kg: '0', carried_out_kg: '9000',
      }],
      trucks: [], week_totals: [],
    },
  });
  const { result } = renderHook(() => useGaplamaBoard('2026-06-03', '2026-06-03'), {
    wrapper: wrapperFor(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
  });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.days[0].carry_in_breakdown[0]).toEqual({
    origin_date: '2026-06-01', kg: 4000, age_days: 2,
  });
});
```

Match the file's existing imports and `wrapperFor` helper — read the top of the file first rather than copying this block's imports.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd frontend
npx vitest run src/hooks/useGaplama.test.tsx
```
Expected: FAIL — the received object has no `age_days`.

- [ ] **Step 3: Add the field on both sides**

In `backend/apps/export/views_gaplama.py`, add `age_days` to whatever shape serializes `carry_in_breakdown` (it is a plain dict passthrough — confirm by reading the view; if it uses an explicit serializer class, add an `IntegerField`).

In `frontend/src/types/index.ts`:

```ts
export interface IGaplamaCarryInBucket {
  origin_date: string;
  kg: number;
  /** Days between this bucket's harvest day and the board day it is shown on. */
  age_days: number;
}
```

and on `IGreenhouseBlock`:

```ts
  /** How many days a leftover from this block stays loadable (default 7). */
  carry_days: number;
```

In `frontend/src/hooks/useGaplama.ts`, add `age_days: number;` to `IGaplamaCarryInBucketRaw` and carry it through the coercion that builds `carry_in_breakdown` — `age_days` is an integer and needs no `Number()` wrapping, but pass it explicitly rather than spreading, to match the file's style.

- [ ] **Step 4: Run the tests**

```bash
cd frontend
npx vitest run src/hooks/useGaplama.test.tsx
npx tsc --noEmit --ignoreDeprecations 5.0
```
Expected: tests PASS, 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/export/views_gaplama.py frontend/src/types/index.ts frontend/src/hooks/useGaplama.ts frontend/src/hooks/useGaplama.test.tsx
git commit -m "feat(p3): expose batch age and the block carry window to the client"
```

---

### Task 6: the board becomes one table with two modes

**Files:**
- Modify: `frontend/src/pages/sera/GaplamaTab.tsx` (whole render, ~line 195 to end)
- Modify: `frontend/src/pages/sera/sera.css:805-811` and the grid rules below it
- Modify: `frontend/src/i18n/en.json`, `ru.json`, `tk.json` (`tir_takip.gaplama.*`)
- Test: `frontend/src/pages/sera/GaplamaTab.test.tsx`

**Interfaces:**
- Consumes: `age_days` and `carry_days` from Task 5.
- Produces: no exported API change — `GaplamaTab` stays the default export mounted by both `TirTakip.tsx` and `GaplamaPage.tsx`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/pages/sera/GaplamaTab.test.tsx` (reuse the file's existing render helper and mock data shape):

```tsx
it('opens on the day mode with the block rows, not the week grid', async () => {
  renderTab();
  expect(await screen.findByRole('columnheader', { name: /Boş/i })).toBeInTheDocument();
  // The week grid's date columns must not be on screen in day mode.
  expect(screen.queryByRole('columnheader', { name: /22\.09/ })).not.toBeInTheDocument();
});

it('switches to the week grid and back', async () => {
  renderTab();
  await userEvent.click(screen.getByRole('button', { name: /Hepde/i }));
  expect(await screen.findByRole('columnheader', { name: /22\.09/ })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /Gün/i }));
  expect(screen.queryByRole('columnheader', { name: /22\.09/ })).not.toBeInTheDocument();
});

it('folds away blocks with nothing available', async () => {
  renderTab();
  expect(await screen.findByText(/boş ýok/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd frontend
npx vitest run src/pages/sera/GaplamaTab.test.tsx
```
Expected: the three new tests FAIL — there is no mode toggle and the week grid renders unconditionally.

- [ ] **Step 3: Add the mode state and the filter bar**

In `GaplamaTab.tsx`, next to the existing `useState` calls:

```tsx
const [mode, setMode] = useState<'day' | 'week'>('day');
```

Replace the `sera-gaplama-header` block with a full-width bar holding, in order: the location filter, the existing `BlockFilterSelect`, a day stepper (`◀` / the current day / `▶`) that writes `selectedDay`, a `Gün` / `Hepde` segmented control bound to `mode`, a spacer, and the existing `+ Tır Aç` button moved up from the bottom. The day stepper replaces clicking a column header, which was never discoverable.

- [ ] **Step 4: Render the day table**

When `mode === 'day'`, render one table with columns `Blok | Boş | Plan | Ýüklenen | Geçen | Tir`, grouped by location with a subtotal per group, from the `board.days` rows whose `date === selectedDay`. `Tir` is `Math.floor(available_kg / truckCapacityKg)`. Rows whose `available_kg` is 0 collapse behind a single `▸ {{count}} blok — boş ýok` row that expands on click. Delete the separate `sera-gaplama-summary` table and its `weekHasTrucks` guard entirely — this table replaces it.

- [ ] **Step 5: Keep the week grid behind the toggle**

When `mode === 'week'`, render today's grid, with three changes: weekday name above each date, `sera-gaplama-day-today` on the column whose date equals `today` (the `today` const at line 35 is currently computed and never used for styling), and one cell value — `available_kg`, or `artyk` when `over_kg > 0`. Green background when `available_kg >= truckCapacityKg`, red when `over_kg > 0`, nothing otherwise. The four stacked numbers move to the cell's title attribute.

- [ ] **Step 6: Collapse the footer**

Replace the `Jemi plan` / per-location `Tir sany` / `Düýnki galyndy` / `Galan` rows with a single footer row: `Tir sany` per day, computed from `week_totals`. Keep the `📦 Açylan tirler` row in both modes.

- [ ] **Step 7: Add the i18n keys**

Add to `tir_takip.gaplama` in all three locale files: `mode_day`, `mode_week`, `col_loaded`, `col_carry`, `col_trucks`, `folded_blocks`, `formula_hint`, `carry_window`. Turkmen is the source language; `en` and `ru` must have every key `tk` has.

- [ ] **Step 8: Run the tests**

```bash
cd frontend
npx vitest run src/pages/sera/GaplamaTab.test.tsx
npx tsc --noEmit --ignoreDeprecations 5.0
```
Expected: all PASS including the file's pre-existing tests, 0 type errors. Pre-existing tests that assert on the old summary table need rewriting against the day table — that table is deliberately gone.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/sera/GaplamaTab.tsx frontend/src/pages/sera/sera.css \
        frontend/src/pages/sera/GaplamaTab.test.tsx frontend/src/i18n/
git commit -m "feat(p3): one gaplama table with a day and week mode"
```

---

### Task 7: batch rows in the truck form

**Files:**
- Modify: `frontend/src/pages/sera/GaplamaTruckForm.tsx` (the `IRow` shape, `capFor`, `initialRowsFor`, `mergedByBlock`, the rows render, `handleSubmit`)
- Modify: `frontend/src/pages/sera/GaplamaTab.tsx` (pass the per-batch data down)
- Modify: `frontend/src/i18n/en.json`, `ru.json`, `tk.json`
- Test: `frontend/src/pages/sera/GaplamaTruckForm.test.tsx`

**Interfaces:**
- Consumes: `IGaplamaCarryInBucket.age_days` and `IGreenhouseBlock.carry_days` from Task 5; `carry_in_breakdown` from `board.days`.
- Produces: `block_sources` payload entries now carry `harvest_date`, consumed by `write_block_sources` from Task 3.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/pages/sera/GaplamaTruckForm.test.tsx`:

```tsx
it('sends one block_source per batch, each with its harvest_date', async () => {
  renderForm();
  const inputs = screen.getAllByRole('spinbutton');
  await userEvent.type(inputs[0], '3000');   // 21.09 batch
  await userEvent.type(inputs[1], '5000');   // 24.09 batch
  await userEvent.click(screen.getByRole('button', { name: /Tır aç/i }));

  await waitFor(() => expect(createDraftMock).toHaveBeenCalled());
  expect(createDraftMock.mock.calls[0][0].block_sources).toEqual([
    { block: 1, weight_kg: 3000, harvest_date: '2026-09-21' },
    { block: 1, weight_kg: 5000, harvest_date: '2026-09-24' },
  ]);
});

it('caps each batch at its own available kg, not the block total', async () => {
  renderForm();
  const inputs = screen.getAllByRole('spinbutton');
  await userEvent.type(inputs[0], '9999');   // the 21.09 batch only holds 3 000
  expect(inputs[0]).toHaveAttribute('aria-invalid', 'true');
});
```

`renderForm` must supply a `batchesByBlock` prop shaped like the board's `carry_in_breakdown` plus today's own plan as a batch dated today. Write that helper in the test file alongside the existing one.

- [ ] **Step 2: Run them and watch them fail**

```bash
cd frontend
npx vitest run src/pages/sera/GaplamaTruckForm.test.tsx
```
Expected: FAIL — the form renders one input per block and sends no `harvest_date`.

- [ ] **Step 3: Change the row model**

In `GaplamaTruckForm.tsx`:

```tsx
interface IRow {
  blockId: number;
  /** The batch's harvest day, `YYYY-MM-DD`. Today's own plan is a batch dated today,
   *  so every kg on a truck has an origin — there is no unattributed weight. */
  harvestDate: string;
  kg: number | null;
}
```

Add a prop `batchesByBlock: Record<number, { harvest_date: string; age_days: number; available_kg: number }[]>` and `carryDaysByBlock: Record<number, number>`. `capFor` takes `(blockId, harvestDate)` and returns that batch's `available_kg`, plus the truck's own current allocation when editing.

- [ ] **Step 4: Render batch rows inside each block card**

Keep `+ Blok goş` and the block select — the operator still chooses which blocks. Inside each chosen block, render its batches as rows: harvest date, `age_days` as a chip, that batch's available kg, and an `InputNumber`. The block header shows `carryDaysByBlock[blockId]` as `❄ {{days}} gün`. A per-block subtotal sits under the batch rows.

- [ ] **Step 5: Send batches in the payload**

In `handleSubmit`, build `block_sources` from the rows with a non-zero `kg`:

```tsx
const blockSources = rows
  .filter((r) => r.kg)
  .map((r) => ({ block: r.blockId, weight_kg: r.kg as number, harvest_date: r.harvestDate }));
```

The total and the partial-truck tag are unchanged. Add `iň köne: {{days}} gün` next to the total, computed as the maximum `age_days` across rows with a non-zero `kg`.

- [ ] **Step 6: Add the i18n keys**

`tir_takip.gaplama.form`: `batch_col_date`, `batch_col_age`, `batch_col_available`, `batch_col_take`, `batch_age_fresh`, `batch_age_days`, `carry_window`, `oldest_batch`. All three locales.

- [ ] **Step 7: Run the tests**

```bash
cd frontend
npx vitest run src/pages/sera/GaplamaTruckForm.test.tsx src/pages/sera/
npx tsc --noEmit --ignoreDeprecations 5.0
```
Expected: all PASS, 0 type errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/sera/GaplamaTruckForm.tsx frontend/src/pages/sera/GaplamaTab.tsx \
        frontend/src/pages/sera/GaplamaTruckForm.test.tsx frontend/src/i18n/
git commit -m "feat(p3): pick which harvest batch goes on the truck"
```

---

### Task 8: the two display sites that assume one row per block

**Files:**
- Modify: `backend/apps/export/serializers.py` (`SheetBlockSourceInlineSerializer` and the `DraftBlockSourceInlineSerializer` around lines 602 and 727)
- Modify: `backend/apps/export/management/commands/normalize_block_sources.py`
- Test: `backend/apps/export/tests_block_source_batches.py` (extend)

**Interfaces:**
- Consumes: batch rows from Task 3.
- Produces: no new interface. Sheet chips group by block; the command keeps working.

- [ ] **Step 1: Write the failing test**

Append to `backend/apps/export/tests_block_source_batches.py`:

```python
class SheetChipGroupingTests(TestCase):
    """Review Focus 3's display half — a two-batch truck is still ONE block chip.

    `SheetBlockSourceInlineSerializer` (serializers.py:632) is a plain
    ModelSerializer over ShipmentBlockSource, so `block_sources` is one entry per
    ROW. Two batches from block A therefore render the chip twice on the Sheet
    unless the sheet serializer groups them.
    """

    @classmethod
    def setUpTestData(cls):
        from apps.core.models import Season, ShipmentStatusType
        from apps.export.models import Shipment, ShipmentBlockSource
        cls.block = GreenhouseBlock.objects.create(code='SC', is_active=True)
        Season.objects.update(is_active=False)
        cls.season = Season.objects.create(
            name='SC-season', start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31), is_active=True,
        )
        cls.shipment = Shipment.objects.create(
            season=cls.season, date=date(2026, 6, 3),
            status=ShipmentStatusType.objects.filter(code='draft').first(), is_draft=True,
        )
        for harvest_date, kg in ((date(2026, 6, 1), '3000'), (date(2026, 6, 3), '5000')):
            ShipmentBlockSource.objects.create(
                shipment=cls.shipment, block=cls.block,
                weight_kg=Decimal(kg), harvest_date=harvest_date,
            )

    def test_two_batches_render_one_chip_per_block(self):
        from apps.export.serializers import ShipmentSheetSerializer
        chips = ShipmentSheetSerializer(self.shipment).data['block_sources']
        self.assertEqual(
            [c['block_id'] for c in chips], [self.block.id],
            f'block rendered {len(chips)} times, expected once: {chips}',
        )
        self.assertEqual(Decimal(str(chips[0]['weight_kg'])), Decimal('8000'))
```

The test file needs `from datetime import date` and `from decimal import Decimal` at the
top if Task 3 did not already add them.

- [ ] **Step 2: Read both sites before changing them**

```bash
cd backend
grep -n 'class SheetBlockSourceInlineSerializer' -A20 apps/export/serializers.py
sed -n '1,60p' apps/export/management/commands/normalize_block_sources.py
```
Decide for each: does it need grouping, or is a repeated block harmless there? Record the answer in the commit message.

- [ ] **Step 3: Group the Sheet chips by block**

Where chips are built from `block_sources`, sum `weight_kg` per `block_id` and emit one entry per block. The batch detail belongs in Gaplama, not in a Sheet cell.

- [ ] **Step 4: Fix `normalize_block_sources`**

The command merges duplicate rows. With batches, duplicates are legitimate when their `harvest_date` differs. Its merge key becomes `(shipment, block, harvest_date)`, matching `merge_to_parent`.

- [ ] **Step 5: Run the tests**

```bash
cd backend
DJANGO_TESTING=true TEST_DB_NAME=test_ygt_batches python manage.py test apps.export apps.core --parallel=1 2>&1 | tail -20
```
Expected: no new failures against the list captured before Task 3.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/export/serializers.py \
        backend/apps/export/management/commands/normalize_block_sources.py \
        backend/apps/export/tests_block_source_batches.py
git commit -m "fix(p3): group sheet block chips now that a block can appear twice"
```

---

### Task 9: docs and the build log

**Files:**
- Modify: `docs/obsidian/screens/gaplama.md`
- Modify: `CHANGELOG.md`
- Modify: `BUILD_TEST_LOG.md`

- [ ] **Step 1: Rewrite the carry-over section of the screen doc**

`docs/obsidian/screens/gaplama.md` currently documents `GreenhouseConfig.gaplama_carry_days`, the FIFO rule and the two-table layout. Update: the window is `GreenhouseBlock.carry_days`, loads drain the named batch with a FIFO fallback, the board is one table with `Gün`/`Hepde`, and the truck form picks batches. Keep the existing §4 bounded-approximation caveat — it is unchanged and still true.

- [ ] **Step 2: Add the CHANGELOG entry**

Under `## [Unreleased]` → `### Added`, one entry covering: per-block carry days, batch selection, the board redesign, migrations `core/0060` and `export/0078`, and the backfill's effect on Sheet R39.

- [ ] **Step 3: Add the build-log entry**

Newest on top in `BUILD_TEST_LOG.md`:

```markdown
- [ ] 2026-09-24 — Gaplama: per-block carry days, batch selection in the truck form, one board table with Gün/Hepde — NEEDS TEST
  To test: (1) a block with carry_days=2 drops its leftover two days later while a 7-day block still shows it;
  (2) open a truck taking the fresh batch only — the older batch is still available tomorrow;
  (3) a shipment created before today still shows the same board numbers;
  (4) the Sheet shows one chip for a block a truck took two batches from.
```

- [ ] **Step 4: Commit**

```bash
git add docs/obsidian/screens/gaplama.md CHANGELOG.md BUILD_TEST_LOG.md
git commit -m "docs: record gaplama batch selection and the board redesign"
```

---

## Before handing back

Run the full affected suites and compare against the baseline captured before Task 3:

```bash
cd backend
DJANGO_TESTING=true TEST_DB_NAME=test_ygt_batches python manage.py test apps.core apps.export apps.greenhouse --parallel=1 2>&1 | tail -20
cd ../frontend
npx vitest run
npx tsc --noEmit --ignoreDeprecations 5.0
```

Report the numbers honestly: which suites, how many passed, and which failures are pre-existing rather than caused by this work.
