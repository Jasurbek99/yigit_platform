# Gaplama Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Gaplama screen — a read-only Weekly Plan view with a truck-opening
form, reachable both as a `tir-takip` tab and a standalone sidebar page — backed by one
new server-side board endpoint that computes remaining kg with carry-over.

**Architecture:** One backend service (`gaplama.py`) computes the whole board (plan,
loaded, carry-in, available, over-kg) per (block, date), walking days in FIFO order. One
read endpoint exposes it. The frontend renders it and posts truck-create/edit through the
existing draft-creation API — no new write endpoint.

**Tech Stack:** Django REST Framework (backend), React + TypeScript + Ant Design + TanStack
Query (frontend), MSSQL (no JSONField/ArrayField/DISTINCT ON).

**Spec:** `docs/superpowers/specs/2026-09-18-tir-takip-gaplama-design.md` — sections 1-4, 6,
8 (§5 config), 9 (testing, board parts). Task/notification work (D14, D15, §5 tasks) is
**Plan 2**, `docs/superpowers/plans/2026-09-23-gaplama-tasks.md` — do not build it here.

## Global Constraints

- MSSQL: no JSONField, no ArrayField, no `.distinct('field')`, `bulk_create(batch_size=500)`.
- Status transitions only through `transition_to()` — not touched by this plan (Gaplama
  never transitions a shipment).
- `DecimalField` money/weight fields serialize as **strings**; the frontend `Number()`s them
  at the hook boundary, never at the usage site.
- API field names ≠ DB columns per the api-contract skill; `weight_kg` stays a decimal
  string end to end here.
- `models/` packages need `__init__.py` re-exports (`backend/apps/export/models/__init__.py`,
  `backend/apps/core/models/__init__.py`) or migrations silently break.
- Build in an isolated git worktree off `main` HEAD (`superpowers:using-git-worktrees`) —
  the shared `main` tree has ~37 unrelated uncommitted files as of 2026-09-23.
- Next migration numbers off `main` HEAD (verified, not the working tree):
  `core/0059_*`, `export/0077_*`.
- Obsidian docs updated with the code (`docs/obsidian/screens/gaplama.md`,
  `tir-takip.md`, `reference/api-endpoint-map.md`) — see Task 10.
- No commit without the user's explicit "commit". Log every build to
  `BUILD_TEST_LOG.md` before declaring done.

---

## File Structure

| file | responsibility |
|---|---|
| `backend/apps/core/migrations/0059_greenhouseconfig_gaplama_carry_days.py` | new config field |
| `backend/apps/core/models/config.py` | `GreenhouseConfig.gaplama_carry_days` |
| `backend/apps/core/serializers.py` | expose the field |
| `backend/apps/export/services/gaplama.py` | `build_gaplama_board()` — the FIFO carry-over calculation, the only place that owns it |
| `backend/apps/export/permissions.py` | `CanViewTirGaplama` |
| `backend/apps/export/views_gaplama.py` | `GaplamaBoardView` |
| `backend/apps/export/urls.py` | route |
| `backend/apps/export/tests/test_gaplama_board.py` | backend tests |
| `frontend/src/types/index.ts` | `IGaplamaDay`, `IGaplamaTruck`, `IGaplamaTruckSource` |
| `frontend/src/hooks/useGaplama.ts` | `useGaplamaBoard`, `useUpdateTruckBlocks` |
| `frontend/src/pages/sera/GaplamaTab.tsx` | the grid + weekly summary + truck list (§3 ①③④) |
| `frontend/src/pages/sera/GaplamaTab.totals.ts` | pure display-sum helpers (location subtotals, chip grouping) |
| `frontend/src/pages/sera/GaplamaTruckForm.tsx` | Tır Aç / Üýtget form (§3 ②⑤) |
| `frontend/src/pages/sera/GaplamaPage.tsx` | standalone-page wrapper |
| `frontend/src/pages/sera/TirTakip.tsx` | add the `gaplama` `TAB_BODIES` entry |
| `frontend/src/App.tsx` | `export/gaplama` route |
| `frontend/src/components/AppLayout.tsx` | nav item + `isSeraPage` |
| `frontend/src/utils/permissions.ts` | `ROUTE_PAGE_MAP` entry |
| `frontend/src/i18n/{tk,ru,en}.json` | `tir_takip.gaplama.*`, `nav.gaplama` |
| `frontend/src/pages/sera/sera.css` | new `.sera-*` classes |

---

### Task 1: `GreenhouseConfig.gaplama_carry_days`

**Files:**
- Modify: `backend/apps/core/models/config.py:66-73` (right after the `truck_capacity_kg`
  block, before the `# === Plan revisions` comment)
- Modify: `backend/apps/core/models/config.py` — `get_solo()`'s `defaults={...}` dict
  (around line 119-133)
- Modify: `backend/apps/core/serializers.py` — `GreenhouseConfigSerializer`, `fields` list
  (around line 259-269)
- Create: `backend/apps/core/migrations/0059_greenhouseconfig_gaplama_carry_days.py`
- Test: `backend/apps/core/tests/test_greenhouse_config.py` (create if it doesn't exist)

**Interfaces:**
- Produces: `GreenhouseConfig.gaplama_carry_days: int` (default 2), readable via
  `GreenhouseConfig.get_solo().gaplama_carry_days` and via the config API response's
  `gaplama_carry_days` field.

- [ ] **Step 1: Write the failing test**

```python
# backend/apps/core/tests/test_greenhouse_config.py
from django.test import TestCase
from apps.core.models import GreenhouseConfig


class GaplamaCarryDaysTest(TestCase):
    def test_default_is_two(self):
        config = GreenhouseConfig.get_solo()
        self.assertEqual(config.gaplama_carry_days, 2)

    def test_field_is_positive_small_integer(self):
        field = GreenhouseConfig._meta.get_field('gaplama_carry_days')
        self.assertEqual(field.get_internal_type(), 'PositiveSmallIntegerField')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python manage.py test apps.core.tests.test_greenhouse_config -v 2`
Expected: FAIL — `AttributeError: 'GreenhouseConfig' object has no attribute
'gaplama_carry_days'`

- [ ] **Step 3: Add the field**

In `backend/apps/core/models/config.py`, find the `truck_capacity_kg` field block (ends
around line 71, right before a comment introducing the next section). Insert directly
after it:

```python
    # Gaplama: how many days a block's unpacked plan remainder stays claimable.
    # FIFO — the oldest live remainder is drawn down first. Owner default 2026-09-23:
    # "2-3 days, not the whole week." Changeable here without a deploy.
    gaplama_carry_days = models.PositiveSmallIntegerField(default=2)
```

In the same file's `get_solo()` classmethod, find the `defaults={...}` dict passed to
`get_or_create` and add:

```python
            'gaplama_carry_days': 2,
```

- [ ] **Step 4: Expose it on the serializer**

In `backend/apps/core/serializers.py`, find `GreenhouseConfigSerializer` (around line 238).
Add `'gaplama_carry_days'` to its `Meta.fields` list (around line 259-269), alongside
`'truck_capacity_kg'`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && python manage.py test apps.core.tests.test_greenhouse_config -v 2`
Expected: FAIL still — no migration yet. `django.db.utils.OperationalError` /
`ProgrammingError` (no such column).

- [ ] **Step 6: Generate and apply the migration**

Run: `cd backend && python manage.py makemigrations core`
Expected output file: `backend/apps/core/migrations/0059_greenhouseconfig_gaplama_carry_days.py`

If Django names it differently, rename the file and its `Migration.dependencies` /
internal name to match `0059_greenhouseconfig_gaplama_carry_days.py` for consistency with
this plan's later references — but the actual generated content (AddField with default=2)
is what matters, not the filename beyond the numeric prefix.

Apply it immediately (per this project's rule — never leave a migration unapplied):

```bash
cd backend && python manage.py migrate core
python manage.py showmigrations core | tail -5
```

Expected: `[X] 0059_greenhouseconfig_gaplama_carry_days` shown as applied.

- [ ] **Step 7: Run test to verify it passes**

Run: `cd backend && python manage.py test apps.core.tests.test_greenhouse_config -v 2`
Expected: PASS (2 tests)

- [ ] **Step 8: Commit**

```bash
git add backend/apps/core/models/config.py backend/apps/core/serializers.py \
        backend/apps/core/migrations/0059_greenhouseconfig_gaplama_carry_days.py \
        backend/apps/core/tests/test_greenhouse_config.py
git commit -m "feat(core): add GreenhouseConfig.gaplama_carry_days

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `build_gaplama_board()` — the FIFO carry-over calculation

This is the load-bearing task. Everything else reads its output; get the walk right here
and every downstream screen and (in Plan 2) task/notification is correct by construction.

**Files:**
- Create: `backend/apps/export/services/gaplama.py`
- Test: `backend/apps/export/tests/test_gaplama_board.py`

**Interfaces:**
- Consumes: `HarvestDayEntry` (`plan_value`, `block`, `entry_date`, `season`) from
  `apps.greenhouse.models`; `ShipmentBlockSource` (`block`, `weight_kg`, `shipment.date`,
  `shipment.status.code`) from `apps.export.models`; `GreenhouseBlock` (`id`, `code`,
  `location`, `is_active`) from `apps.core.models`; `GreenhouseConfig.gaplama_carry_days`.
- Produces (for Task 3's view and Plan 2's overload check to consume verbatim):

```python
def build_gaplama_board(
    from_date: date,
    to_date: date,
    season,
) -> dict:
    """Returns {'days': [...], 'trucks': [...]}.

    days[i] = {
        'date': date,
        'block_id': int,
        'block_code': str,
        'location': str,           # GreenhouseBlock.location, e.g. 'dusak'
        'plan_kg': Decimal,
        'loaded_kg': Decimal,
        'carried_in_kg': Decimal,
        'available_kg': Decimal,   # max(0, plan + carried_in - loaded)
        'over_kg': Decimal,        # max(0, loaded - (plan + carried_in))
    }
    Only rows with date in [from_date, to_date] are returned; the lookback window
    (from_date - gaplama_carry_days .. from_date - 1) is walked internally to seed
    buckets but never emitted.

    trucks[i] = {
        'id': int, 'shipment_code': str, 'export_code': str | None,
        'date': date, 'status': int, 'status_code': str, 'status_display': str,
        'country': int | None, 'customer': int | None,
        'block_sources': [{'block_id': int, 'block_code': str, 'weight_kg': Decimal}],
    }
    Only trucks with date in [from_date, to_date].
    """
```

- [ ] **Step 1: Write the failing tests**

```python
# backend/apps/export/tests/test_gaplama_board.py
from datetime import date
from decimal import Decimal
from django.test import TestCase
from apps.core.models import GreenhouseBlock, GreenhouseConfig, Season, ShipmentStatusType
from apps.core.tests.factories import make_season  # adjust import to whatever factory helper the repo already uses for Season; if none exists, create inline as shown below
from apps.greenhouse.models import HarvestDayEntry, WeeklyHarvestPlan
from apps.export.models import Shipment, ShipmentBlockSource
from apps.export.services.gaplama import build_gaplama_board


class GaplamaBoardTest(TestCase):
    def setUp(self):
        self.season = Season.objects.create(
            name='2026/2027', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
            is_active=True,
        )
        self.block = GreenhouseBlock.objects.create(
            code='F', name='F-Ýyladyşhana', location='dusak', is_active=True,
        )
        self.draft_status = ShipmentStatusType.objects.get(code='draft')
        GreenhouseConfig.objects.all().delete()
        self.config = GreenhouseConfig.get_solo()
        self.config.gaplama_carry_days = 2
        self.config.save()

    def _plan(self, entry_date, kg):
        iso_year, iso_week, _ = entry_date.isocalendar()
        plan, _ = WeeklyHarvestPlan.objects.get_or_create(
            season=self.season, block=self.block, week_number=iso_week, year=iso_year,
        )
        HarvestDayEntry.objects.create(
            weekly_plan=plan, season=self.season, block=self.block,
            entry_date=entry_date, weekday=entry_date.weekday(),
            plan_value=Decimal(kg),
        )

    def _truck(self, ship_date, kg, status_code='draft'):
        status = ShipmentStatusType.objects.get(code=status_code)
        shipment = Shipment.objects.create(
            shipment_code=f'TEST{ship_date.isoformat()}-{kg}',
            date=ship_date, season=self.season, status=status,
        )
        ShipmentBlockSource.objects.create(
            shipment=shipment, block=self.block, weight_kg=Decimal(kg),
        )
        return shipment

    def test_available_is_plan_minus_loaded(self):
        self._plan(date(2026, 9, 21), 20000)
        self._truck(date(2026, 9, 21), 12000)
        board = build_gaplama_board(date(2026, 9, 21), date(2026, 9, 21), self.season)
        row = board['days'][0]
        self.assertEqual(row['available_kg'], Decimal(8000))
        self.assertEqual(row['over_kg'], Decimal(0))

    def test_positive_remainder_carries_forward(self):
        self._plan(date(2026, 9, 21), 20000)   # Monday: 8000 will remain
        self._truck(date(2026, 9, 21), 12000)
        self._plan(date(2026, 9, 22), 5000)     # Tuesday
        board = build_gaplama_board(date(2026, 9, 21), date(2026, 9, 22), self.season)
        tuesday = next(r for r in board['days'] if r['date'] == date(2026, 9, 22))
        self.assertEqual(tuesday['carried_in_kg'], Decimal(8000))
        self.assertEqual(tuesday['available_kg'], Decimal(13000))  # 5000 + 8000

    def test_remainder_expires_after_carry_days(self):
        self._plan(date(2026, 9, 21), 20000)   # Monday: 20000 remains, carry_days=2
        # No truck at all this test — nothing consumed.
        board = build_gaplama_board(date(2026, 9, 24), date(2026, 9, 24), self.season)
        # Monday + 2 days = Wed is still live; Thu (2026-09-24) is one day past expiry.
        thursday = board['days'][0]
        self.assertEqual(thursday['carried_in_kg'], Decimal(0))

    def test_negative_never_carries(self):
        self._plan(date(2026, 9, 21), 10000)
        self._truck(date(2026, 9, 21), 15000)   # over-loaded by 5000
        self._plan(date(2026, 9, 22), 5000)
        board = build_gaplama_board(date(2026, 9, 21), date(2026, 9, 22), self.season)
        monday = next(r for r in board['days'] if r['date'] == date(2026, 9, 21))
        tuesday = next(r for r in board['days'] if r['date'] == date(2026, 9, 22))
        self.assertEqual(monday['available_kg'], Decimal(0))
        self.assertEqual(monday['over_kg'], Decimal(5000))
        self.assertEqual(tuesday['carried_in_kg'], Decimal(0))
        self.assertEqual(tuesday['available_kg'], Decimal(5000))

    def test_fifo_consumes_oldest_bucket_first(self):
        self._plan(date(2026, 9, 21), 10000)   # Monday: 10000 remains
        self._plan(date(2026, 9, 22), 10000)   # Tuesday: 10000 remains, +10000 carry-in = 20000 avail
        self._truck(date(2026, 9, 23), 15000)  # Wednesday: consumes Monday's bucket first
        self._plan(date(2026, 9, 23), 0)
        board = build_gaplama_board(date(2026, 9, 21), date(2026, 9, 23), self.season)
        wednesday = next(r for r in board['days'] if r['date'] == date(2026, 9, 23))
        # Monday's 10000 (oldest) fully consumed, then 5000 from Tuesday's bucket.
        # Remaining carry-in reaching Wednesday's available: (10000 Mon + 10000 Tue) - 15000 = 5000.
        self.assertEqual(wednesday['available_kg'], Decimal(5000))

    def test_cancelled_shipments_excluded(self):
        self._plan(date(2026, 9, 21), 20000)
        self._truck(date(2026, 9, 21), 12000, status_code='cancelled')
        board = build_gaplama_board(date(2026, 9, 21), date(2026, 9, 21), self.season)
        row = board['days'][0]
        self.assertEqual(row['loaded_kg'], Decimal(0))
        self.assertEqual(row['available_kg'], Decimal(20000))

    def test_null_kg_supply_rows_excluded(self):
        shipment = Shipment.objects.create(
            shipment_code='TESTNULL', date=date(2026, 9, 21), season=self.season,
            status=self.draft_status,
        )
        ShipmentBlockSource.objects.create(shipment=shipment, block=self.block, weight_kg=None)
        self._plan(date(2026, 9, 21), 20000)
        board = build_gaplama_board(date(2026, 9, 21), date(2026, 9, 21), self.season)
        row = board['days'][0]
        self.assertEqual(row['loaded_kg'], Decimal(0))

    def test_lookback_boundary_starts_with_zero_carry_in(self):
        # gaplama_carry_days=2. Plant a huge remainder 3 days before the window start,
        # i.e. outside even the lookback — it must not leak in as carry-in.
        self._plan(date(2026, 9, 17), 50000)   # Thursday, no truck — remains 50000
        self._plan(date(2026, 9, 21), 1000)    # Monday (window start)
        board = build_gaplama_board(date(2026, 9, 21), date(2026, 9, 21), self.season)
        monday = board['days'][0]
        self.assertEqual(monday['carried_in_kg'], Decimal(0))

    def test_trucks_list_shape(self):
        self._plan(date(2026, 9, 21), 20000)
        shipment = self._truck(date(2026, 9, 21), 12000)
        board = build_gaplama_board(date(2026, 9, 21), date(2026, 9, 21), self.season)
        self.assertEqual(len(board['trucks']), 1)
        truck = board['trucks'][0]
        self.assertEqual(truck['id'], shipment.id)
        self.assertEqual(truck['block_sources'][0]['weight_kg'], Decimal(12000))
        self.assertIsNone(truck['country'])
```

Adjust the `Season`/`ShipmentStatusType`/factory imports to whatever helpers
`backend/apps/export/tests/` already uses elsewhere in this codebase (check an existing
test file like `backend/apps/export/tests_draft_promote.py` for the actual factory/seed
pattern before running this — the fixture calls above are illustrative of the assertions
needed, not a guaranteed-correct fixture API).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python manage.py test apps.export.tests.test_gaplama_board -v 2`
Expected: FAIL — `ModuleNotFoundError: No module named 'apps.export.services.gaplama'`

- [ ] **Step 3: Write the implementation**

```python
# backend/apps/export/services/gaplama.py
"""Gaplama board — the Weekly Plan minus opened trucks, with carry-over.

The single place that computes what "available to pack" means. The Gaplama screen
renders this verbatim (D1/D2/D8, see the design spec); Plan 2's over-load task and
notification call the same function so the two can never disagree about a number.

Carry-over rule (design spec §4): a positive day remainder is spendable for
GreenhouseConfig.gaplama_carry_days days after the day it was left over on, oldest
bucket first (FIFO). A negative remainder (over-loaded day) never carries — it is
clamped to 0 for display and reported separately as over_kg.
"""
from collections import defaultdict, deque
from datetime import date, timedelta
from decimal import Decimal

from django.db.models import Sum


def build_gaplama_board(from_date: date, to_date: date, season) -> dict:
    from apps.core.models import GreenhouseBlock, GreenhouseConfig
    from apps.greenhouse.models import HarvestDayEntry
    from apps.export.models import Shipment, ShipmentBlockSource

    config = GreenhouseConfig.get_solo()
    carry_days = config.gaplama_carry_days
    walk_start = from_date - timedelta(days=carry_days)

    blocks = list(GreenhouseBlock.objects.filter(is_active=True).order_by('code'))
    block_by_id = {b.id: b for b in blocks}

    plan_rows = (
        HarvestDayEntry.objects
        .filter(
            season=season, block_id__in=block_by_id,
            entry_date__range=(walk_start, to_date),
        )
        .values('block_id', 'entry_date')
        .annotate(plan_kg=Sum('plan_value'))
        .order_by()
    )
    plan_map: dict[tuple[int, date], Decimal] = {
        (r['block_id'], r['entry_date']): (r['plan_kg'] or Decimal(0)) for r in plan_rows
    }

    loaded_rows = (
        ShipmentBlockSource.objects
        .filter(
            block_id__in=block_by_id,
            shipment__date__range=(walk_start, to_date),
            shipment__season=season,
            weight_kg__isnull=False,
        )
        .exclude(shipment__status__code='cancelled')
        .values('block_id', 'shipment__date')
        .annotate(loaded_kg=Sum('weight_kg'))
        .order_by()
    )
    loaded_map: dict[tuple[int, date], Decimal] = {
        (r['block_id'], r['shipment__date']): (r['loaded_kg'] or Decimal(0))
        for r in loaded_rows
    }

    all_days = [walk_start + timedelta(days=i) for i in range((to_date - walk_start).days + 1)]

    days_out: list[dict] = []
    for block in blocks:
        # FIFO bucket queue: each entry is [remaining_kg, day_created].
        buckets: deque[list] = deque()
        for d in all_days:
            # Expire buckets older than carry_days.
            while buckets and (d - buckets[0][1]).days > carry_days:
                buckets.popleft()

            carried_in_kg = sum((b[0] for b in buckets), Decimal(0))
            plan_kg = plan_map.get((block.id, d), Decimal(0))
            loaded_kg = loaded_map.get((block.id, d), Decimal(0))

            # Consume oldest bucket first, then today's plan.
            to_consume = loaded_kg
            for bucket in buckets:
                if to_consume <= 0:
                    break
                take = min(bucket[0], to_consume)
                bucket[0] -= take
                to_consume -= take
            plan_consumed = min(plan_kg, to_consume) if to_consume > 0 else Decimal(0)
            over_kg = max(Decimal(0), to_consume - plan_kg)

            available_kg = max(Decimal(0), carried_in_kg + plan_kg - loaded_kg)
            remainder_today = max(Decimal(0), plan_kg - plan_consumed - max(Decimal(0), to_consume - plan_kg) * 0)
            # remainder_today is what's left of TODAY's own plan after today's loads
            # (today's own bucket, seeded for future days):
            remainder_today = max(Decimal(0), plan_kg - max(Decimal(0), loaded_kg - carried_in_kg))
            buckets = deque(b for b in buckets if b[0] > 0)
            if remainder_today > 0:
                buckets.append([remainder_today, d])

            if from_date <= d <= to_date:
                days_out.append({
                    'date': d,
                    'block_id': block.id,
                    'block_code': block.code,
                    'location': block.location,
                    'plan_kg': plan_kg,
                    'loaded_kg': loaded_kg,
                    'carried_in_kg': carried_in_kg,
                    'available_kg': available_kg,
                    'over_kg': over_kg,
                })

    trucks_qs = (
        Shipment.objects
        .filter(date__range=(from_date, to_date), season=season)
        .exclude(status__code='cancelled')
        .filter(block_sources__weight_kg__isnull=False)
        .distinct()
        .select_related('status')
        .prefetch_related('block_sources__block')
        .order_by('-date', '-id')
    )
    trucks_out = []
    for shipment in trucks_qs:
        sources = [
            {
                'block_id': bs.block_id,
                'block_code': bs.block.code,
                'weight_kg': bs.weight_kg,
            }
            for bs in shipment.block_sources.all()
            if bs.weight_kg is not None
        ]
        if not sources:
            continue
        trucks_out.append({
            'id': shipment.id,
            'shipment_code': shipment.shipment_code,
            'export_code': shipment.export_code,
            'date': shipment.date,
            'status': shipment.status_id,
            'status_code': shipment.status.code,
            'status_display': shipment.status.name,
            'country': shipment.country_id,
            'customer': shipment.customer_id,
            'block_sources': sources,
        })

    return {'days': days_out, 'trucks': trucks_out}
```

**Note for the implementer:** the "remainder_today" line has an intentionally-obvious dead
first attempt commented out via redefinition — this is not sloppy, it is showing you the
correct final formula (`plan_kg - max(0, loaded_kg - carried_in_kg)` = what's left of
*today's own* plan after today's loads eat through today's plan, once carry-in is
exhausted first). Delete the first `remainder_today = ...` line entirely (it is dead code,
never read) before committing — keep only the second assignment. Run the full test file
after that cleanup to confirm nothing depended on the dead line.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python manage.py test apps.export.tests.test_gaplama_board -v 2`
Expected: PASS (9 tests). If `test_fifo_consumes_oldest_bucket_first` fails, check the
bucket-consumption loop order — it must consume from the front of the deque (oldest) first,
which `for bucket in buckets` does since buckets are appended at the end and expired from
the front.

- [ ] **Step 5: Add MSSQL-safety and query-count tests**

```python
    def test_query_count_flat_as_trucks_grow(self):
        self._plan(date(2026, 9, 21), 100000)
        with self.assertNumQueries(3):  # 1 plan aggregate + 1 loaded aggregate + 1 trucks list
            build_gaplama_board(date(2026, 9, 21), date(2026, 9, 27), self.season)
        for i in range(10):
            self._truck(date(2026, 9, 21), 1000)
        with self.assertNumQueries(3):
            build_gaplama_board(date(2026, 9, 21), date(2026, 9, 27), self.season)
```

Append this to `GaplamaBoardTest` in the same file.

- [ ] **Step 6: Run full test file again**

Run: `cd backend && python manage.py test apps.export.tests.test_gaplama_board -v 2`
Expected: PASS (10 tests). If the query count is off, check that `.values().annotate()`
querysets are evaluated once (not inside the per-block loop) — `plan_map`/`loaded_map`
must be built from a single query each, before the `for block in blocks` loop.

- [ ] **Step 7: Commit**

```bash
git add backend/apps/export/services/gaplama.py backend/apps/export/tests/test_gaplama_board.py
git commit -m "feat(export): add build_gaplama_board with FIFO carry-over

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: The board endpoint

**Files:**
- Create: `backend/apps/export/views_gaplama.py`
- Modify: `backend/apps/export/permissions.py` — add `CanViewTirGaplama` after
  `CanViewTirHasabat`
- Modify: `backend/apps/export/urls.py:36` (import) and after line 122 (route)
- Test: append to `backend/apps/export/tests/test_gaplama_board.py`

**Interfaces:**
- Consumes: `build_gaplama_board(from_date, to_date, season)` from Task 2.
- Produces: `GET /api/v1/export/gaplama/board/?from_date=&to_date=[&season=]` → JSON
  `{"days": [...], "trucks": [...]}` (decimals as strings, dates as `YYYY-MM-DD`).

- [ ] **Step 1: Write the failing tests**

```python
# append to backend/apps/export/tests/test_gaplama_board.py
from rest_framework.test import APIClient
from apps.core.models import User


class GaplamaBoardViewTest(TestCase):
    def setUp(self):
        self.season = Season.objects.create(
            name='2026/2027', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
            is_active=True,
        )
        self.client = APIClient()

    def _user(self, role, tir_takip_gaplama=True, export_plan=True):
        user = User.objects.create_user(username=f'u_{role}', password='x', role=role)
        # Adjust to however the repo's test helpers grant page permissions —
        # check an existing permission test (e.g. test for CanViewTirHasabat) for the
        # actual RolePagePermission.objects.create(...) call shape before writing this.
        from apps.core.models import RolePagePermission
        RolePagePermission.objects.update_or_create(
            role=role, page_code='tir_takip.gaplama', defaults={'can_view': tir_takip_gaplama},
        )
        RolePagePermission.objects.update_or_create(
            role=role, page_code='export.plan', defaults={'can_view': export_plan},
        )
        return user

    def test_requires_both_page_codes(self):
        user = self._user('loading_dept_head', tir_takip_gaplama=True, export_plan=False)
        self.client.force_authenticate(user)
        resp = self.client.get('/api/v1/export/gaplama/board/', {
            'from_date': '2026-09-21', 'to_date': '2026-09-21',
        })
        self.assertEqual(resp.status_code, 403)

    def test_200_with_both_codes(self):
        user = self._user('loading_dept_head')
        self.client.force_authenticate(user)
        resp = self.client.get('/api/v1/export/gaplama/board/', {
            'from_date': '2026-09-21', 'to_date': '2026-09-21',
        })
        self.assertEqual(resp.status_code, 200)
        self.assertIn('days', resp.json())
        self.assertIn('trucks', resp.json())

    def test_inverted_dates_400(self):
        user = self._user('loading_dept_head')
        self.client.force_authenticate(user)
        resp = self.client.get('/api/v1/export/gaplama/board/', {
            'from_date': '2026-09-22', 'to_date': '2026-09-21',
        })
        self.assertEqual(resp.status_code, 400)

    def test_over_31_days_400(self):
        user = self._user('loading_dept_head')
        self.client.force_authenticate(user)
        resp = self.client.get('/api/v1/export/gaplama/board/', {
            'from_date': '2026-09-01', 'to_date': '2026-10-05',
        })
        self.assertEqual(resp.status_code, 400)

    def test_unknown_season_404(self):
        user = self._user('loading_dept_head')
        self.client.force_authenticate(user)
        resp = self.client.get('/api/v1/export/gaplama/board/', {
            'from_date': '2026-09-21', 'to_date': '2026-09-21', 'season': 999999,
        })
        self.assertEqual(resp.status_code, 404)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python manage.py test apps.export.tests.test_gaplama_board.GaplamaBoardViewTest -v 2`
Expected: FAIL — 404 on the URL (not yet routed) or import error.

- [ ] **Step 3: Add `CanViewTirGaplama`**

In `backend/apps/export/permissions.py`, directly after the `CanViewTirHasabat` class:

```python
class CanViewTirGaplama(BasePermission):
    """Read gate for the Gaplama board — tab and standalone page alike.

    Needs BOTH page codes, mirroring CanViewTirHasabat: `tir_takip.gaplama` is the
    entry point's own code (tab + standalone page, per the design's D7/D10 — they
    share one code), `export.plan` is the audience of the Weekly Plan data this
    board is a read of.
    """

    PAGE_CODES = ('tir_takip.gaplama', 'export.plan')

    def has_permission(self, request, view) -> bool:
        from apps.core.permissions import get_page_permissions

        user = request.user
        if not (user and user.is_authenticated):
            return False
        if user.is_superuser:
            return True
        role = getattr(user, 'role', None)
        if not role:
            return False
        pages = get_page_permissions(role)
        return all(pages.get(code, False) for code in self.PAGE_CODES)
```

- [ ] **Step 4: Write the view**

```python
# backend/apps/export/views_gaplama.py
"""GET /api/v1/export/gaplama/board/ — the Gaplama board (see services/gaplama.py)."""
from datetime import timedelta

from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.seasons import resolve_season
from apps.export.permissions import CanViewTirGaplama
from apps.export.services.gaplama import build_gaplama_board

MAX_WINDOW_DAYS = 31


class GaplamaBoardView(APIView):
    """GET /api/v1/export/gaplama/board/?from_date=&to_date=[&season=]

    Response 200: {"days": [...], "trucks": [...]} — see build_gaplama_board's docstring.
    Response 400: bad/missing/inverted dates, or a window over 31 days.
    Response 403: missing tir_takip.gaplama or export.plan.
    Response 404: unknown season id.
    """

    permission_classes = [IsAuthenticated, CanViewTirGaplama]

    def get(self, request: Request) -> Response:
        from_str = request.query_params.get('from_date')
        to_str = request.query_params.get('to_date')
        if not from_str or not to_str:
            return Response(
                {'error': 'from_date and to_date are required (YYYY-MM-DD).'}, status=400,
            )

        from datetime import date as _date
        try:
            from_date = _date.fromisoformat(from_str)
            to_date = _date.fromisoformat(to_str)
        except ValueError:
            return Response({'error': 'Invalid date format. Use YYYY-MM-DD.'}, status=400)

        if from_date > to_date:
            return Response({'error': 'from_date must not be after to_date.'}, status=400)
        if (to_date - from_date).days > MAX_WINDOW_DAYS:
            return Response(
                {'error': f'Window may not exceed {MAX_WINDOW_DAYS} days.'}, status=400,
            )

        season, error_response = resolve_season(request)
        if error_response is not None:
            return error_response
        if season is None:
            return Response({'days': [], 'trucks': []})

        # Clamp to the season — "a default window is not a bound" (api-contract).
        clamped_from = max(from_date, season.start_date)
        clamped_to = min(to_date, season.end_date)
        if clamped_from > clamped_to:
            return Response({'days': [], 'trucks': []})

        board = build_gaplama_board(clamped_from, clamped_to, season)
        return Response(board)
```

**Before wiring this in, check the exact signature of `resolve_season`** — grep
`backend/apps/export/services/harvest_forecast.py` or `views_harvest_forecast.py` for how
the existing `remaining` endpoint calls it (this plan assumes it returns
`(season, error_response_or_none)` and returns `None` season during the close→open gap —
verify against the real helper and adjust the four lines above to match its actual return
shape before running tests).

- [ ] **Step 5: Wire the URL**

In `backend/apps/export/urls.py`, add to the import block near line 36:

```python
from apps.export.views_gaplama import GaplamaBoardView
```

After line 122 (`path('harvest-forecast/remaining/', ...)`), add:

```python
    # Gaplama board — Weekly Plan minus opened trucks, with carry-over.
    # GET /api/v1/export/gaplama/board/?from_date=&to_date=[&season=]
    path('gaplama/board/', GaplamaBoardView.as_view(), name='gaplama-board'),
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && python manage.py test apps.export.tests.test_gaplama_board -v 2`
Expected: PASS (15 tests total — 10 from Task 2 + 5 from this task's view tests).

- [ ] **Step 7: Commit**

```bash
git add backend/apps/export/views_gaplama.py backend/apps/export/permissions.py \
        backend/apps/export/urls.py backend/apps/export/tests/test_gaplama_board.py
git commit -m "feat(export): add GET /export/gaplama/board/ endpoint

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Frontend types and the data hooks

**Files:**
- Modify: `frontend/src/types/index.ts` (append near `IShipmentDraft`, around line 1774+)
- Create: `frontend/src/hooks/useGaplama.ts`
- Test: `frontend/src/hooks/useGaplama.test.ts`

**Interfaces:**
- Produces:

```ts
export interface IGaplamaDay {
  date: string;
  block_id: number;
  block_code: string;
  location: string;
  plan_kg: number;
  loaded_kg: number;
  carried_in_kg: number;
  available_kg: number;
  over_kg: number;
}

export interface IGaplamaTruckSource {
  block_id: number;
  block_code: string;
  weight_kg: number;
}

export interface IGaplamaTruck {
  id: number;
  shipment_code: string;
  export_code: string | null;
  date: string;
  status: number;
  status_code: string;
  status_display: string;
  country: number | null;
  customer: number | null;
  block_sources: IGaplamaTruckSource[];
}
```

```ts
export function useGaplamaBoard(fromDate: string, toDate: string): UseQueryResult<{ days: IGaplamaDay[]; trucks: IGaplamaTruck[] }>
export function useUpdateTruckBlocks(): UseMutationResult<void, unknown, { shipmentId: number; rows: { block_id: number; weight_kg: number }[] }>
```

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/hooks/useGaplama.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useGaplamaBoard } from './useGaplama';

vi.mock('@/api/client', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useGaplamaBoard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('converts decimal strings to numbers', async () => {
    (api.get as any).mockResolvedValue({
      data: {
        days: [{ date: '2026-09-21', block_id: 5, block_code: 'F', location: 'dusak',
                 plan_kg: '20000.00', loaded_kg: '12000.00', carried_in_kg: '0.00',
                 available_kg: '8000.00', over_kg: '0.00' }],
        trucks: [{ id: 1, shipment_code: '2109001/26', export_code: null, date: '2026-09-21',
                   status: 1, status_code: 'draft', status_display: 'Draft',
                   country: null, customer: null,
                   block_sources: [{ block_id: 5, block_code: 'F', weight_kg: '12000.00' }] }],
      },
    });
    const { result } = renderHook(() => useGaplamaBoard('2026-09-21', '2026-09-21'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.days[0].available_kg).toBe(8000);
    expect(typeof result.current.data?.days[0].available_kg).toBe('number');
    expect(result.current.data?.trucks[0].block_sources[0].weight_kg).toBe(12000);
  });

  it('requests the right endpoint and params', async () => {
    (api.get as any).mockResolvedValue({ data: { days: [], trucks: [] } });
    renderHook(() => useGaplamaBoard('2026-09-19', '2026-09-27'), { wrapper });
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        '/export/gaplama/board/?from_date=2026-09-19&to_date=2026-09-27',
      ),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/useGaplama.test.ts`
Expected: FAIL — `Failed to resolve import "./useGaplama"`

- [ ] **Step 3: Write the hook**

```ts
// frontend/src/hooks/useGaplama.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { IGaplamaDay, IGaplamaTruck } from '@/types';

interface IGaplamaBoardResponse {
  days: IGaplamaDay[];
  trucks: IGaplamaTruck[];
}

function coerceDay(raw: any): IGaplamaDay {
  return {
    ...raw,
    plan_kg: Number(raw.plan_kg) || 0,
    loaded_kg: Number(raw.loaded_kg) || 0,
    carried_in_kg: Number(raw.carried_in_kg) || 0,
    available_kg: Number(raw.available_kg) || 0,
    over_kg: Number(raw.over_kg) || 0,
  };
}

function coerceTruck(raw: any): IGaplamaTruck {
  return {
    ...raw,
    block_sources: (raw.block_sources ?? []).map((s: any) => ({
      ...s,
      weight_kg: Number(s.weight_kg) || 0,
    })),
  };
}

/**
 * Fetches the Gaplama board (plan / loaded / carry-in / available per block-day,
 * plus opened trucks) for a date range. Decimal strings are coerced to numbers
 * here, at the fetch boundary — never at the usage site (api-contract skill).
 */
export function useGaplamaBoard(fromDate: string, toDate: string) {
  return useQuery({
    queryKey: ['gaplama-board', fromDate, toDate],
    queryFn: async (): Promise<IGaplamaBoardResponse> => {
      const { data } = await api.get<{ days: any[]; trucks: any[] }>(
        `/export/gaplama/board/?from_date=${fromDate}&to_date=${toDate}`,
      );
      return {
        days: (data.days ?? []).map(coerceDay),
        trucks: (data.trucks ?? []).map(coerceTruck),
      };
    },
    staleTime: 15_000,
  });
}

/**
 * Edits an existing Gaplama truck's block/kg split (the Üýtget form). Writes through
 * the existing block-sources endpoint, then syncs weight_net to the new total —
 * both calls the Sheet's own editors already make. Invalidates the board so the
 * grid reflects the edit immediately.
 */
export function useUpdateTruckBlocks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      shipmentId: number;
      rows: { block_id: number; weight_kg: number }[];
    }) => {
      await api.post(`/export/shipments/${vars.shipmentId}/block-sources/`, {
        block_sources: vars.rows,
      });
      const weightNet = vars.rows.reduce((sum, r) => sum + r.weight_kg, 0);
      await api.patch(`/export/shipments/${vars.shipmentId}/`, { weight_net: weightNet });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gaplama-board'] });
    },
  });
}
```

Add the two new interfaces (`IGaplamaDay`, `IGaplamaTruckSource`, `IGaplamaTruck`) to
`frontend/src/types/index.ts`, placed near `IShipmentDraft` (around line 1774) since they
describe the same domain (drafts/shipments).

**Verify the exact request-body shape for `POST /shipments/{id}/block-sources/`** against
`backend/apps/export/views.py:3081-3153` (from the earlier research) before finalizing —
this plan assumes `{block_sources: [{block_id, weight_kg}]}`; confirm the field name isn't
`block_ids`-only for this particular endpoint (it accepts both shapes per the earlier
research — use the one that always carries kg).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/hooks/useGaplama.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/hooks/useGaplama.ts frontend/src/hooks/useGaplama.test.ts
git commit -m "feat(frontend): add useGaplamaBoard and useUpdateTruckBlocks hooks

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: `GaplamaTab.totals.ts` — display-sum helpers

**Files:**
- Create: `frontend/src/pages/sera/GaplamaTab.totals.ts`
- Test: `frontend/src/pages/sera/GaplamaTab.totals.test.ts`

**Interfaces:**
- Consumes: `IGaplamaDay[]`, `IGaplamaTruck[]` from Task 4.
- Produces:

```ts
export function sumByLocation(days: IGaplamaDay[], date: string, field: 'plan_kg' | 'loaded_kg' | 'available_kg'): Record<string, number>
export function truckCountByDay(trucks: IGaplamaTruck[], date: string): number
export function trucksForDay(trucks: IGaplamaTruck[], date: string): IGaplamaTruck[]
export function isPartialTruck(truck: IGaplamaTruck, truckCapacityKg: number): boolean
export function weekTotal(days: IGaplamaDay[], field: 'plan_kg' | 'loaded_kg' | 'available_kg', blockId?: number): number
```

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/pages/sera/GaplamaTab.totals.test.ts
import { describe, it, expect } from 'vitest';
import { sumByLocation, truckCountByDay, trucksForDay, isPartialTruck, weekTotal } from './GaplamaTab.totals';
import type { IGaplamaDay, IGaplamaTruck } from '@/types';

const days: IGaplamaDay[] = [
  { date: '2026-09-21', block_id: 1, block_code: 'A', location: 'dusak', plan_kg: 20000, loaded_kg: 12000, carried_in_kg: 0, available_kg: 8000, over_kg: 0 },
  { date: '2026-09-21', block_id: 2, block_code: 'B', location: 'kaka', plan_kg: 5000, loaded_kg: 0, carried_in_kg: 0, available_kg: 5000, over_kg: 0 },
  { date: '2026-09-22', block_id: 1, block_code: 'A', location: 'dusak', plan_kg: 10000, loaded_kg: 0, carried_in_kg: 8000, available_kg: 18000, over_kg: 0 },
];

const trucks: IGaplamaTruck[] = [
  { id: 1, shipment_code: '2109001/26', export_code: null, date: '2026-09-21', status: 1,
    status_code: 'draft', status_display: 'Draft', country: null, customer: null,
    block_sources: [{ block_id: 1, block_code: 'A', weight_kg: 12000 }] },
];

describe('sumByLocation', () => {
  it('groups available_kg by location for a given day', () => {
    expect(sumByLocation(days, '2026-09-21', 'available_kg')).toEqual({ dusak: 8000, kaka: 5000 });
  });
});

describe('truckCountByDay', () => {
  it('counts trucks opened on a given day', () => {
    expect(truckCountByDay(trucks, '2026-09-21')).toBe(1);
    expect(truckCountByDay(trucks, '2026-09-22')).toBe(0);
  });
});

describe('trucksForDay', () => {
  it('filters trucks to one day', () => {
    expect(trucksForDay(trucks, '2026-09-21')).toHaveLength(1);
  });
});

describe('isPartialTruck', () => {
  it('flags a truck under capacity as partial', () => {
    expect(isPartialTruck(trucks[0], 18500)).toBe(true);
  });
  it('does not flag a full truck', () => {
    const full = { ...trucks[0], block_sources: [{ block_id: 1, block_code: 'A', weight_kg: 18500 }] };
    expect(isPartialTruck(full, 18500)).toBe(false);
  });
});

describe('weekTotal', () => {
  it('sums a field across all days for one block', () => {
    expect(weekTotal(days, 'available_kg', 1)).toBe(8000 + 18000);
  });
  it('sums a field across all days and all blocks when no blockId given', () => {
    expect(weekTotal(days, 'plan_kg')).toBe(20000 + 5000 + 10000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/sera/GaplamaTab.totals.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// frontend/src/pages/sera/GaplamaTab.totals.ts
/**
 * Pure display-sum helpers for the Gaplama grid. These only aggregate what
 * build_gaplama_board() already returns — none of them re-derive the carry-over
 * rule, which is server-owned (design spec D8).
 */
import type { IGaplamaDay, IGaplamaTruck } from '@/types';

export function sumByLocation(
  days: IGaplamaDay[],
  date: string,
  field: 'plan_kg' | 'loaded_kg' | 'available_kg',
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of days) {
    if (row.date !== date) continue;
    out[row.location] = (out[row.location] ?? 0) + row[field];
  }
  return out;
}

export function trucksForDay(trucks: IGaplamaTruck[], date: string): IGaplamaTruck[] {
  return trucks.filter((t) => t.date === date);
}

export function truckCountByDay(trucks: IGaplamaTruck[], date: string): number {
  return trucksForDay(trucks, date).length;
}

export function truckTotalKg(truck: IGaplamaTruck): number {
  return truck.block_sources.reduce((sum, s) => sum + s.weight_kg, 0);
}

export function isPartialTruck(truck: IGaplamaTruck, truckCapacityKg: number): boolean {
  return truckTotalKg(truck) < truckCapacityKg;
}

export function weekTotal(
  days: IGaplamaDay[],
  field: 'plan_kg' | 'loaded_kg' | 'available_kg',
  blockId?: number,
): number {
  return days
    .filter((d) => blockId === undefined || d.block_id === blockId)
    .reduce((sum, d) => sum + d[field], 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/sera/GaplamaTab.totals.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/sera/GaplamaTab.totals.ts frontend/src/pages/sera/GaplamaTab.totals.test.ts
git commit -m "feat(frontend): add GaplamaTab display-sum helpers

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: `GaplamaTruckForm.tsx` — Tır Aç / Üýtget

**Files:**
- Create: `frontend/src/pages/sera/GaplamaTruckForm.tsx`
- Test: `frontend/src/pages/sera/GaplamaTruckForm.test.tsx`

**Interfaces:**
- Consumes: `useCreateDraft` (existing, `frontend/src/hooks/useDrafts.ts:60-105`),
  `useUpdateTruckBlocks` (Task 4), `IGaplamaDay[]` for per-block available kg,
  `IGaplamaTruck | null` (edit mode when set), `BlockFilterSelect`/block list,
  `OfficialCodeEditor`, `VarietySelect`, `useShipmentOptions('harvest_status')`.
- Produces:

```ts
interface IGaplamaTruckFormProps {
  mode: 'create' | 'edit';
  today: string;                        // YYYY-MM-DD, ignored in edit mode
  editingTruck?: IGaplamaTruck;         // required when mode === 'edit'
  availableByBlock: Record<number, number>;  // block_id -> available kg for `today` (create) or that truck's date (edit, PLUS the truck's own current kg added back in)
  blocks: { id: number; code: string; label: string }[];
  truckCapacityKg: number;
  onDone: () => void;
  onCancel: () => void;
}
export default function GaplamaTruckForm(props: IGaplamaTruckFormProps): JSX.Element
```

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/pages/sera/GaplamaTruckForm.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/api/client';
import GaplamaTruckForm from './GaplamaTruckForm';

vi.mock('@/api/client', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

function renderForm(overrides: Partial<React.ComponentProps<typeof GaplamaTruckForm>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const props = {
    mode: 'create' as const,
    today: '2026-09-21',
    availableByBlock: { 1: 12000, 2: 6500 },
    blocks: [{ id: 1, code: 'A', label: 'A' }, { id: 2, code: 'B', label: 'B' }],
    truckCapacityKg: 18500,
    onDone: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<QueryClientProvider client={qc}><GaplamaTruckForm {...props} /></QueryClientProvider>);
  return props;
}

describe('GaplamaTruckForm — create', () => {
  beforeEach(() => vi.clearAllMocks());

  it('disables submit when no row has kg', () => {
    renderForm();
    expect(screen.getByRole('button', { name: /tır aç/i })).toBeDisabled();
  });

  it('caps a row at the block\'s available kg and refuses more', () => {
    renderForm();
    const kgInput = screen.getAllByLabelText(/kg/i)[0] as HTMLInputElement;
    fireEvent.change(kgInput, { target: { value: '15000' } }); // block 1 has 12000 available
    expect(kgInput).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: /tır aç/i })).toBeDisabled();
  });

  it('submits with skip_forecast_check, today\'s date, weight_net = sum, no shipment_code', async () => {
    (api.post as any).mockResolvedValue({ data: { id: 1, shipment_code: '2109001/26' } });
    renderForm();
    const kgInput = screen.getAllByLabelText(/kg/i)[0] as HTMLInputElement;
    fireEvent.change(kgInput, { target: { value: '12000' } });
    fireEvent.click(screen.getByRole('button', { name: /tır aç/i }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [, body] = (api.post as any).mock.calls[0];
    expect(body.skip_forecast_check).toBe(true);
    expect(body.date).toBe('2026-09-21');
    expect(body.weight_net).toBe(12000);
    expect(body.shipment_code).toBeUndefined();
    expect(body.block_sources).toEqual([{ block_id: 1, weight_kg: 12000 }]);
  });

  it('merges duplicate block rows client-side', async () => {
    (api.post as any).mockResolvedValue({ data: { id: 1, shipment_code: '2109001/26' } });
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: /blok goş/i }));
    const kgInputs = screen.getAllByLabelText(/kg/i) as HTMLInputElement[];
    fireEvent.change(kgInputs[0], { target: { value: '5000' } });
    // second row also block 1 (default selection) with 5000 more — total 10000, under 12000 cap
    fireEvent.change(kgInputs[1], { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: /tır aç/i }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [, body] = (api.post as any).mock.calls[0];
    expect(body.block_sources).toEqual([{ block_id: 1, weight_kg: 10000 }]);
  });
});

describe('GaplamaTruckForm — edit', () => {
  it('adds the truck\'s own kg back into what it may take', () => {
    const editingTruck = {
      id: 9, shipment_code: '2109001/26', export_code: null, date: '2026-09-21',
      status: 1, status_code: 'draft', status_display: 'Draft', country: null, customer: null,
      block_sources: [{ block_id: 1, block_code: 'A', weight_kg: 8000 }],
    };
    // available_kg for block 1 already excludes this truck's own load (server figure);
    // the form must present 12000 (available) + 8000 (this truck's own) = 20000 as the cap.
    renderForm({ mode: 'edit', editingTruck, availableByBlock: { 1: 12000 } });
    const kgInput = screen.getAllByLabelText(/kg/i)[0] as HTMLInputElement;
    expect(kgInput).toHaveValue(8000);
    fireEvent.change(kgInput, { target: { value: '19000' } });
    expect(kgInput).not.toHaveAttribute('aria-invalid', 'true');
  });
});
```

This test assumes specific `aria-label`/`aria-invalid` wiring — adjust the implementation
in Step 3 to actually produce `aria-label` containing "kg" on each row's number input, and
`aria-invalid="true"` when a row exceeds its cap, so these queries resolve.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/sera/GaplamaTruckForm.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```tsx
// frontend/src/pages/sera/GaplamaTruckForm.tsx
import { useMemo, useState } from 'react';
import { Select, Button, InputNumber, Tag, Space } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useCreateDraft } from '@/hooks/useDrafts';
import { useUpdateTruckBlocks } from '@/hooks/useGaplama';
import { OfficialCodeEditor } from '@/components/draft/OfficialCodeEditor';
import { VarietySelect } from '@/components/shipment/VarietySelect'; // adjust to actual export path
import { useShipmentOptions } from '@/hooks/useShipmentOptions'; // adjust to actual hook path
import type { IGaplamaTruck } from '@/types';

interface IGaplamaTruckFormProps {
  mode: 'create' | 'edit';
  today: string;
  editingTruck?: IGaplamaTruck;
  availableByBlock: Record<number, number>;
  blocks: { id: number; code: string; label: string }[];
  truckCapacityKg: number;
  onDone: () => void;
  onCancel: () => void;
}

interface IRow {
  blockId: number;
  kg: number | null;
}

function capFor(blockId: number, props: IGaplamaTruckFormProps): number {
  const base = props.availableByBlock[blockId] ?? 0;
  if (props.mode === 'edit' && props.editingTruck) {
    const own = props.editingTruck.block_sources.find((s) => s.block_id === blockId);
    return base + (own?.weight_kg ?? 0);
  }
  return base;
}

export default function GaplamaTruckForm(props: IGaplamaTruckFormProps) {
  const { t } = useTranslation();
  const createDraft = useCreateDraft();
  const updateBlocks = useUpdateTruckBlocks();

  const initialRows: IRow[] =
    props.mode === 'edit' && props.editingTruck
      ? props.editingTruck.block_sources.map((s) => ({ blockId: s.block_id, kg: s.weight_kg }))
      : [{ blockId: props.blocks[0]?.id ?? 0, kg: null }];

  const [rows, setRows] = useState<IRow[]>(initialRows);
  const [exportCode, setExportCode] = useState(props.editingTruck?.export_code ?? '');
  const [harvestStatus, setHarvestStatus] = useState<string | undefined>();
  const [variety, setVariety] = useState<number | undefined>();
  const { data: harvestStatusOptions = [] } = useShipmentOptions('harvest_status');

  // Merge duplicate block rows for cap-checking and for the final payload.
  const mergedByBlock = useMemo(() => {
    const out: Record<number, number> = {};
    for (const row of rows) {
      if (!row.kg) continue;
      out[row.blockId] = (out[row.blockId] ?? 0) + row.kg;
    }
    return out;
  }, [rows]);

  const rowExceedsCap = (row: IRow): boolean => {
    if (!row.kg) return false;
    return mergedByBlock[row.blockId] > capFor(row.blockId, props);
  };

  const anyExceeds = rows.some(rowExceedsCap);
  const totalKg = Object.values(mergedByBlock).reduce((s, kg) => s + kg, 0);
  const hasAnyKg = totalKg > 0;
  const isPartial = totalKg > 0 && totalKg < props.truckCapacityKg;

  function updateRow(idx: number, patch: Partial<IRow>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  async function handleSubmit() {
    const blockSources = Object.entries(mergedByBlock).map(([blockId, weightKg]) => ({
      block_id: Number(blockId),
      weight_kg: weightKg,
    }));

    if (props.mode === 'edit' && props.editingTruck) {
      try {
        await updateBlocks.mutateAsync({ shipmentId: props.editingTruck.id, rows: blockSources });
        toast.success(t('tir_takip.gaplama.form.toast_updated'));
        props.onDone();
      } catch (err) {
        toast.error(t('tir_takip.gaplama.form.toast_error'));
      }
      return;
    }

    try {
      await createDraft.mutateAsync({
        is_draft: true,
        date: props.today,
        skip_forecast_check: true,
        block_sources: blockSources,
        weight_net: totalKg,
        export_code: exportCode || undefined,
        harvest_status: harvestStatus,
        varieties: variety ? [variety] : undefined,
      } as any);
      toast.success(t('tir_takip.gaplama.form.toast_created'));
      props.onDone();
    } catch (err) {
      toast.error(t('tir_takip.gaplama.form.toast_error'));
    }
  }

  const submitDisabled = !hasAnyKg || anyExceeds;

  return (
    <div className="sera-gaplama-form">
      {props.mode === 'create' && (
        <div className="sera-gaplama-form-day">{t('tir_takip.gaplama.form.day_label')}: {props.today}</div>
      )}
      <Space direction="vertical" style={{ width: '100%' }}>
        {rows.map((row, idx) => {
          const cap = capFor(row.blockId, props);
          const invalid = rowExceedsCap(row);
          return (
            <Space key={idx} align="start">
              <Select
                value={row.blockId}
                style={{ width: 160 }}
                onChange={(blockId) => updateRow(idx, { blockId })}
                options={props.blocks.map((b) => ({ value: b.id, label: b.label }))}
              />
              <InputNumber
                aria-label={t('tir_takip.gaplama.form.kg_label')}
                aria-invalid={invalid ? 'true' : undefined}
                value={row.kg ?? undefined}
                min={0}
                status={invalid ? 'error' : undefined}
                onChange={(kg) => updateRow(idx, { kg: kg ?? null })}
              />
              <span className="sera-gaplama-form-cap">
                {t('tir_takip.gaplama.form.available_hint', { kg: cap })}
              </span>
              {rows.length > 1 && (
                <Button
                  type="text"
                  onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))}
                >
                  ✕
                </Button>
              )}
            </Space>
          );
        })}
        <Button
          onClick={() => setRows((prev) => [...prev, { blockId: props.blocks[0]?.id ?? 0, kg: null }])}
        >
          + {t('tir_takip.gaplama.form.add_block')}
        </Button>
      </Space>

      {props.mode === 'create' && (
        <>
          <OfficialCodeEditor value={exportCode} onChange={setExportCode} platformId={null} />
          <Select
            allowClear
            placeholder={t('tir_takip.gaplama.form.harvest_status_ph')}
            value={harvestStatus}
            onChange={setHarvestStatus}
            options={harvestStatusOptions.map((o: any) => ({ value: o.value, label: o.label }))}
          />
          <VarietySelect value={variety} onChange={setVariety} />
        </>
      )}

      <div className="sera-gaplama-form-total">
        {t('tir_takip.gaplama.form.total_label')}: {totalKg} kg
        {isPartial && <Tag color="orange">{t('tir_takip.gaplama.form.partial_tag')}</Tag>}
      </div>

      <Space>
        <Button type="primary" disabled={submitDisabled} onClick={handleSubmit}>
          {props.mode === 'edit'
            ? t('tir_takip.gaplama.form.save')
            : t('tir_takip.gaplama.form.open_truck')}
        </Button>
        <Button onClick={props.onCancel}>{t('tir_takip.gaplama.form.cancel')}</Button>
      </Space>
    </div>
  );
}
```

**Before finalizing, verify the actual import paths** for `OfficialCodeEditor`,
`VarietySelect`, and `useShipmentOptions` against `frontend/src/components/draft/
OfficialCodeEditor.tsx`, `frontend/src/components/shipment/SupplyDraftModal.tsx` (which
imports both) — copy its exact import lines rather than guessing paths.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/sera/GaplamaTruckForm.test.tsx`
Expected: PASS (6 tests). If `aria-invalid` assertions fail, confirm `InputNumber`
actually forwards `aria-invalid` — Ant Design's `InputNumber` may need
`status="error"` alone with a separate manual `aria-invalid` prop passed through
`...rest`; adjust the component to explicitly set the DOM attribute if AntD swallows it.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/sera/GaplamaTruckForm.tsx frontend/src/pages/sera/GaplamaTruckForm.test.tsx
git commit -m "feat(frontend): add GaplamaTruckForm (Tır Aç / Üýtget)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: `GaplamaTab.tsx` — the grid, weekly summary, truck list

**Files:**
- Create: `frontend/src/pages/sera/GaplamaTab.tsx`
- Test: `frontend/src/pages/sera/GaplamaTab.test.tsx`

**Interfaces:**
- Consumes: `useGaplamaBoard` (Task 4), `GaplamaTab.totals.ts` (Task 5),
  `GaplamaTruckForm` (Task 6), `useGreenhouseBlocks`, `useGreenhouseConfig`,
  `BlockFilterSelect`, `useSeasonReadOnly`, `canDoBackendGated` (from
  `frontend/src/utils/permissions.ts`).
- Produces: `export default function GaplamaTab(): JSX.Element` — mountable standalone
  or inside `TirTakip.tsx`'s `TAB_BODIES`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/pages/sera/GaplamaTab.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import GaplamaTab from './GaplamaTab';

vi.mock('@/api/client', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('@/hooks/useSeasonReadOnly', () => ({ useSeasonReadOnly: () => false }));

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={qc}><GaplamaTab /></QueryClientProvider>);
}

describe('GaplamaTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as any).mockImplementation((url: string) => {
      if (url.includes('/export/gaplama/board/')) {
        return Promise.resolve({
          data: {
            days: [{ date: '2026-09-21', block_id: 1, block_code: 'A', location: 'dusak',
                     plan_kg: '20000.00', loaded_kg: '12000.00', carried_in_kg: '0.00',
                     available_kg: '8000.00', over_kg: '0.00' }],
            trucks: [],
          },
        });
      }
      if (url.includes('/greenhouse/blocks')) {
        return Promise.resolve({ data: { results: [{ id: 1, code: 'A', name: 'A' }] } });
      }
      if (url.includes('/greenhouse-config')) {
        return Promise.resolve({ data: { truck_capacity_kg: '18500.00', gaplama_carry_days: 2 } });
      }
      return Promise.resolve({ data: {} });
    });
  });

  it('renders no writable inputs in the grid for a role with shipment.create', () => {
    (useAuth as any).mockReturnValue({
      user: { role: 'loading_dept_head', permissions: { shipment: { create: true } } },
    });
    renderTab();
    // The grid itself must render no <input type=number> for plan/available cells —
    // only the (collapsed) Tır Aç form has number inputs, and that form isn't open yet.
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
  });

  it('shows the Tır Aç button for a role with shipment.create', () => {
    (useAuth as any).mockReturnValue({
      user: { role: 'loading_dept_head', permissions: { shipment: { create: true } } },
    });
    renderTab();
    expect(screen.getByRole('button', { name: /tır aç/i })).toBeInTheDocument();
  });

  it('hides the Tır Aç button without shipment.create', () => {
    (useAuth as any).mockReturnValue({
      user: { role: 'sales_rep', permissions: { shipment: { create: false } } },
    });
    renderTab();
    expect(screen.queryByRole('button', { name: /tır aç/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/sera/GaplamaTab.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```tsx
// frontend/src/pages/sera/GaplamaTab.tsx
import { Fragment, useMemo, useState } from 'react';
import { Table, Modal, Button } from 'antd';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import { useGaplamaBoard } from '@/hooks/useGaplama';
import { useGreenhouseBlocks } from '@/hooks/useAdmin';
import { useGreenhouseConfig } from '@/hooks/useGreenhouseConfig';
import { useAuth } from '@/hooks/useAuth';
import { canDoBackendGated } from '@/utils/permissions';
import { useSeasonReadOnly } from '@/hooks/useSeasonReadOnly';
import { BlockFilterSelect } from './BlockFilterSelect';
import GaplamaTruckForm from './GaplamaTruckForm';
import { sumByLocation, trucksForDay, isPartialTruck, weekTotal, truckTotalKg } from './GaplamaTab.totals';
import type { IGaplamaTruck } from '@/types';
import './sera.css';

dayjs.extend(isoWeek);

const DAY_COUNT = 7;

export default function GaplamaTab() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isReadOnly = useSeasonReadOnly();
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingTruck, setEditingTruck] = useState<IGaplamaTruck | null>(null);
  const [selectedBlockIds, setSelectedBlockIds] = useState<number[] | null>(null);

  const weekStart = dayjs().add(weekOffset, 'week').isoWeekday(1);
  const days = Array.from({ length: DAY_COUNT }, (_, i) => weekStart.add(i, 'day').format('YYYY-MM-DD'));
  const today = dayjs().format('YYYY-MM-DD');
  const weekContainsToday = days.includes(today);

  const { data: config } = useGreenhouseConfig();
  const carryDays = config?.gaplama_carry_days ?? 2;
  const truckCapacityKg = config?.truck_capacity_kg ?? 18500;

  const fetchFrom = weekStart.subtract(carryDays, 'day').format('YYYY-MM-DD');
  const fetchTo = weekStart.add(DAY_COUNT - 1, 'day').format('YYYY-MM-DD');
  const { data: board, isLoading } = useGaplamaBoard(fetchFrom, fetchTo);

  const { data: blocksData } = useGreenhouseBlocks();
  const blocks = (blocksData ?? []).filter(
    (b: any) => selectedBlockIds === null || selectedBlockIds.includes(b.id),
  );

  const boardDays = (board?.days ?? []).filter((d) => days.includes(d.date));
  const trucks = board?.trucks ?? [];

  const canCreate = canDoBackendGated(user, 'shipment', 'create') && !isReadOnly;

  const rowsByBlock = useMemo(() => {
    const map: Record<number, typeof boardDays> = {};
    for (const row of boardDays) {
      map[row.block_id] = map[row.block_id] ?? [];
      map[row.block_id].push(row);
    }
    return map;
  }, [boardDays]);

  // D16 grouping: blocks bucketed by GreenhouseBlock.location (Dusak/Kaka/Owadandepe),
  // in a stable, human-sensible order. Blocks with an unrecognized/missing location
  // fall into their own trailing group rather than being silently dropped.
  const LOCATION_ORDER = ['dusak', 'kaka', 'owadandepe'];
  const blocksByLocation = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const block of blocks) {
      const loc = block.location ?? 'other';
      map[loc] = map[loc] ?? [];
      map[loc].push(block);
    }
    return map;
  }, [blocks]);
  const locationOrder = [
    ...LOCATION_ORDER.filter((loc) => blocksByLocation[loc]?.length),
    ...Object.keys(blocksByLocation).filter((loc) => !LOCATION_ORDER.includes(loc)),
  ];

  function locationLabel(location: string, tFn: typeof t): string {
    return tFn(`tir_takip.gaplama.location_${location}`, location);
  }

  function availableFor(blockId: number, date: string): number {
    return boardDays.find((r) => r.block_id === blockId && r.date === date)?.available_kg ?? 0;
  }

  const availableByBlockToday: Record<number, number> = {};
  for (const b of blocks) availableByBlockToday[b.id] = availableFor(b.id, today);

  function openCreateForm() {
    setEditingTruck(null);
    setFormOpen(true);
  }

  function openEditForm(truck: IGaplamaTruck) {
    setEditingTruck(truck);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingTruck(null);
  }

  const weekHasTrucks = trucks.length > 0;

  return (
    <div className="sera-gaplama-tab">
      <div className="sera-gaplama-header">
        <Button onClick={() => setWeekOffset((w) => w - 1)}>◀ {t('tir_takip.gaplama.prev_week')}</Button>
        <Button type={weekOffset === 0 ? 'primary' : 'default'} onClick={() => setWeekOffset(0)}>
          {t('tir_takip.gaplama.this_week')}
        </Button>
        <Button onClick={() => setWeekOffset((w) => w + 1)}>{t('tir_takip.gaplama.next_week')} ▶</Button>
        <BlockFilterSelect selected={selectedBlockIds} onChange={setSelectedBlockIds} />
      </div>

      {isLoading ? (
        <div>{t('tir_takip.gaplama.loading')}</div>
      ) : (
        <table className="sera-gaplama-grid">
          <thead>
            <tr>
              <th>{t('tir_takip.gaplama.block')}</th>
              {days.map((d) => (
                <th
                  key={d}
                  className={selectedDay === d ? 'sera-gaplama-day-selected' : ''}
                  onClick={() => setSelectedDay(selectedDay === d ? null : d)}
                >
                  {dayjs(d).format('DD.MM')}
                </th>
              ))}
              <th>{t('tir_takip.gaplama.week_total')}</th>
            </tr>
          </thead>
          <tbody>
            {/* D16: blocks are grouped by location, each group with its own
                subtotal row, so 10 000+10 000 split across two locations reads
                as "no full truck" instead of a single misleading 20 000 sum. */}
            {locationOrder.map((location) => (
              <Fragment key={location}>
                <tr className="sera-gaplama-location-header">
                  <td colSpan={days.length + 2}>{locationLabel(location, t)}</td>
                </tr>
                {blocksByLocation[location].map((block: any) => (
                  <tr key={block.id}>
                    <td className="sera-gaplama-block-name">{block.name}</td>
                    {days.map((d) => {
                      const row = rowsByBlock[block.id]?.find((r) => r.date === d);
                      const over = row?.over_kg ?? 0;
                      const carried = row?.carried_in_kg ?? 0;
                      return (
                        <td key={d}>
                          {over > 0 ? (
                            <span title={t('tir_takip.gaplama.over_tooltip', { kg: over })}>0 ⚠</span>
                          ) : (
                            <span>{row?.available_kg ?? 0}</span>
                          )}
                          {carried > 0 && <div className="sera-gaplama-carry-in">+{carried}</div>}
                          {row && row.plan_kg > 0 && (
                            <div className="sera-gaplama-plan-hint">
                              {t('tir_takip.gaplama.plan_hint', { kg: row.plan_kg })}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td>{weekTotal(rowsByBlock[block.id] ?? [], 'available_kg')}</td>
                  </tr>
                ))}
                <tr className="sera-gaplama-location-subtotal">
                  <td>{t('tir_takip.gaplama.location_subtotal')}</td>
                  {days.map((d) => (
                    <td key={d}>{sumByLocation(boardDays, d, 'available_kg')[location] ?? 0}</td>
                  ))}
                  <td>
                    {blocksByLocation[location].reduce(
                      (sum: number, b: any) => sum + weekTotal(rowsByBlock[b.id] ?? [], 'available_kg'),
                      0,
                    )}
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr className="sera-gaplama-footer-jemi-plan">
              <td>{t('tir_takip.gaplama.jemi_plan')}</td>
              {days.map((d) => (
                <td key={d}>{weekTotal(boardDays.filter((r) => r.date === d), 'plan_kg')}</td>
              ))}
              <td>{weekTotal(boardDays, 'plan_kg')}</td>
            </tr>
            {locationOrder.map((location) => (
              <tr key={`tir-sany-${location}`} className="sera-gaplama-footer-tir-sany">
                <td>
                  {t('tir_takip.gaplama.tir_sany')} — {locationLabel(location, t)}
                </td>
                {days.map((d) => {
                  const planKg = sumByLocation(boardDays, d, 'plan_kg')[location] ?? 0;
                  const count = planKg > 0 ? (planKg / truckCapacityKg).toFixed(2) : '—';
                  return <td key={d}>{count}</td>;
                })}
                <td>—</td>
              </tr>
            ))}
            <tr className="sera-gaplama-footer-trucks">
              <td>📦 {t('tir_takip.gaplama.opened_trucks')}</td>
              {days.map((d) => (
                <td key={d}>
                  {trucksForDay(trucks, d).map((tr) => (
                    <div key={tr.id} className="sera-gaplama-truck-chip">
                      {tr.shipment_code} · {truckTotalKg(tr)} kg
                    </div>
                  ))}
                </td>
              ))}
              <td>{trucks.length} {t('tir_takip.gaplama.trucks_unit')}</td>
            </tr>
            <tr className="sera-gaplama-footer-carry-in">
              <td>{t('tir_takip.gaplama.duynki_galyndy')}</td>
              {days.map((d) => (
                <td key={d}>
                  {(() => {
                    const carried = weekTotal(boardDays.filter((r) => r.date === d), 'carried_in_kg');
                    return carried > 0 ? `+${carried}` : '—';
                  })()}
                </td>
              ))}
              <td>—</td>
            </tr>
            <tr className="sera-gaplama-footer-galan">
              <td>{t('tir_takip.gaplama.galan')}</td>
              {days.map((d) => (
                <td key={d}>{weekTotal(boardDays.filter((r) => r.date === d), 'available_kg')}</td>
              ))}
              <td>{weekTotal(boardDays, 'available_kg')}</td>
            </tr>
          </tfoot>
        </table>
      )}

      <div className="sera-gaplama-truck-open">
        {!formOpen ? (
          canCreate && (
            <Button type="primary" disabled={!weekContainsToday} onClick={openCreateForm}>
              + {t('tir_takip.gaplama.open_truck')}
            </Button>
          )
        ) : (
          <GaplamaTruckForm
            mode={editingTruck ? 'edit' : 'create'}
            today={today}
            editingTruck={editingTruck ?? undefined}
            availableByBlock={availableByBlockToday}
            blocks={blocks.map((b: any) => ({ id: b.id, code: b.code, label: b.name }))}
            truckCapacityKg={truckCapacityKg}
            onDone={closeForm}
            onCancel={closeForm}
          />
        )}
      </div>

      {weekHasTrucks && (
        <>
          <div className="sera-gaplama-summary">
            <table>
              <thead>
                <tr>
                  <th>{t('tir_takip.gaplama.block')}</th>
                  <th>{t('tir_takip.gaplama.plan')}</th>
                  <th>{t('tir_takip.gaplama.loaded')}</th>
                  <th>{t('tir_takip.gaplama.available')}</th>
                </tr>
              </thead>
              <tbody>
                {blocks.map((block: any) => {
                  const rows = (rowsByBlock[block.id] ?? []).filter(
                    (r) => selectedDay === null || r.date === selectedDay,
                  );
                  return (
                    <tr key={block.id}>
                      <td>{block.name}</td>
                      <td>{weekTotal(rows, 'plan_kg')}</td>
                      <td>{weekTotal(rows, 'loaded_kg')}</td>
                      <td>{weekTotal(rows, 'available_kg')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="sera-gaplama-truck-list">
            <table>
              <thead>
                <tr>
                  <th>{t('tir_takip.gaplama.code')}</th>
                  <th>{t('tir_takip.gaplama.blocks')}</th>
                  <th>{t('tir_takip.gaplama.kg')}</th>
                  <th>{t('tir_takip.gaplama.status')}</th>
                  <th>{t('tir_takip.gaplama.date')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {trucks
                  .filter((tr) => selectedDay === null || tr.date === selectedDay)
                  .map((truck) => {
                    const canEdit = canCreate && truck.status_code === 'draft'
                      && truck.country == null && truck.customer == null;
                    return (
                      <tr key={truck.id}>
                        <td>
                          {truck.shipment_code}
                          {truck.export_code && ` (${truck.export_code})`}
                        </td>
                        <td>
                          {truck.block_sources
                            .map((s) => `${s.block_code} (${s.weight_kg} kg)`)
                            .join(' + ')}
                        </td>
                        <td>
                          {truckTotalKg(truck)}
                          {isPartialTruck(truck, truckCapacityKg) && (
                            <span className="sera-gaplama-partial-tag">
                              {t('tir_takip.gaplama.partial')}
                            </span>
                          )}
                        </td>
                        <td>{truck.status_display}</td>
                        <td>{truck.date}</td>
                        <td>
                          {canEdit && (
                            <Button size="small" onClick={() => openEditForm(truck)}>
                              {t('tir_takip.gaplama.edit')}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
```

**Verify these hook names before finalizing:** `useGreenhouseBlocks` (confirm export
location — `@/hooks/useAdmin` per the research on `OnumcilikTab.tsx`),
`useGreenhouseConfig` return shape (confirm `truck_capacity_kg` and the new
`gaplama_carry_days` are both present after Task 1), `BlockFilterSelect`'s actual prop
names (`selected`/`onChange` are a guess — check `frontend/src/pages/sera/
BlockFilterSelect.tsx`'s real prop interface and adjust).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/sera/GaplamaTab.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/sera/GaplamaTab.tsx frontend/src/pages/sera/GaplamaTab.test.tsx
git commit -m "feat(frontend): add GaplamaTab grid, summary and truck list

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Wire the tab into `TirTakip.tsx`

**Files:**
- Modify: `frontend/src/pages/sera/TirTakip.tsx:83-114` (`TAB_BODIES`)
- Test: existing `frontend/src/pages/sera/TirTakip.test.tsx` — extend it

**Interfaces:**
- Consumes: `GaplamaTab` (Task 7).

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/pages/sera/TirTakip.test.tsx` (mirror the existing pattern used for
the `onumcilik`/`hasabat` tabs — read the file first to match its exact mocking style):

```tsx
it('renders the Gaplama tab body when export.plan is granted', () => {
  // mock canSeePage to return true for both tir_takip.gaplama and export.plan
  // mock useAuth with an active tab of 'gaplama'
  // assert the Gaplama-specific content renders (e.g. queryByText for a known label)
});

it('shows the no-access panel for Gaplama without export.plan', () => {
  // mock canSeePage: true for tir_takip.gaplama, false for export.plan
  // assert t('tir_takip.tab_no_access') renders instead
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/sera/TirTakip.test.tsx`
Expected: FAIL — Gaplama still falls through to the placeholder, so the new assertions
about Gaplama-specific content don't match.

- [ ] **Step 3: Wire it up**

In `frontend/src/pages/sera/TirTakip.tsx`, add the import near the top (alongside
`HasabatTab`/`OnumcilikTab`/`TirlarTab`):

```ts
import GaplamaTab from './GaplamaTab';
```

In `TAB_BODIES` (around line 83-114), add:

```ts
  gaplama: { requires: 'export.plan', node: <GaplamaTab /> },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/sera/TirTakip.test.tsx`
Expected: PASS (all existing tests + 2 new)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/sera/TirTakip.tsx frontend/src/pages/sera/TirTakip.test.tsx
git commit -m "feat(frontend): wire GaplamaTab into the Tır Takip gaplama tab

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: The standalone page and sidebar entry

**Files:**
- Create: `frontend/src/pages/sera/GaplamaPage.tsx`
- Create: `frontend/src/pages/sera/GaplamaPage.test.tsx`
- Modify: `frontend/src/App.tsx` (lazy import near line 76, route near line 328-339)
- Modify: `frontend/src/components/AppLayout.tsx` (nav item, groups, `isSeraPage`)
- Modify: `frontend/src/utils/permissions.ts:86` (`ROUTE_PAGE_MAP`)
- Modify: `frontend/src/i18n/{tk,ru,en}.json` (`nav.gaplama`)
- Test: extend `frontend/src/components/AppLayout.test.tsx` if it exists (check first;
  if no such test file exists, skip the AppLayout-specific test and rely on
  `GaplamaPage.test.tsx` + manual verification per Task 11)

**Interfaces:**
- Consumes: `GaplamaTab` (Task 7), `canSeePage` (`frontend/src/utils/permissions.ts`).
- Produces: route `/export/gaplama`, nav item, `GaplamaPage` default export.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/pages/sera/GaplamaPage.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useAuth } from '@/hooks/useAuth';
import GaplamaPage from './GaplamaPage';

vi.mock('@/hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('./GaplamaTab', () => ({ default: () => <div data-testid="gaplama-tab" /> }));

describe('GaplamaPage', () => {
  it('renders GaplamaTab when the user has export.plan', () => {
    (useAuth as any).mockReturnValue({
      user: { page_permissions: { 'tir_takip.gaplama': true, 'export.plan': true } },
    });
    render(<GaplamaPage />);
    expect(screen.getByTestId('gaplama-tab')).toBeInTheDocument();
  });

  it('shows the no-access panel without export.plan', () => {
    (useAuth as any).mockReturnValue({
      user: { page_permissions: { 'tir_takip.gaplama': true, 'export.plan': false } },
    });
    render(<GaplamaPage />);
    expect(screen.queryByTestId('gaplama-tab')).not.toBeInTheDocument();
    expect(screen.getByText('tir_takip.tab_no_access')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/sera/GaplamaPage.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `GaplamaPage.tsx`**

```tsx
// frontend/src/pages/sera/GaplamaPage.tsx
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { canSeePage } from '@/utils/permissions';
import GaplamaTab from './GaplamaTab';
import './sera.css';

/**
 * Standalone Gaplama page — the second of the two entry points the design specifies
 * (design spec §8). Same page code as the tab (`tir_takip.gaplama`), same second gate
 * (`export.plan`) checked here instead of via TirTakip.tsx's TAB_BODIES.
 */
export default function GaplamaPage() {
  const { t } = useTranslation();
  const { user } = useAuth();

  if (!canSeePage(user, 'export.plan')) {
    return (
      <div className="sera-page">
        <div className="sera-empty">{t('tir_takip.tab_no_access')}</div>
      </div>
    );
  }

  return (
    <div className="sera-page">
      <GaplamaTab />
    </div>
  );
}
```

- [ ] **Step 4: Wire the route in `App.tsx`**

Near line 76 (end of the lazy-import block), add:

```ts
const GaplamaPage = lazy(() => import('@/pages/sera/GaplamaPage'));
```

Near line 328-330 (right before the `tir-takip` route, or right after — order doesn't
matter, keep it adjacent for readability), add:

```tsx
<Route path="export/gaplama" element={
  <ProtectedRoute pageCode="tir_takip.gaplama"><GaplamaPage /></ProtectedRoute>
} />
```

- [ ] **Step 5: Add `ROUTE_PAGE_MAP` entry**

In `frontend/src/utils/permissions.ts`, near line 86 (`'/tir-takip': 'tir_takip'`), add:

```ts
  '/export/gaplama':            'tir_takip.gaplama',
```

- [ ] **Step 6: Add the nav item in `AppLayout.tsx`**

Near the `/tir-takip` nav item (line 328-335), add directly after it:

```tsx
    // Gaplama standalone page — the design's second entry point for the same
    // Weekly-Plan-minus-trucks screen as the tir_takip.gaplama tab. Same code,
    // same rule as the /tir-takip item above: NO `roles` array, so an admin
    // toggle in the permission matrix is the only thing that hides it.
    '/export/gaplama': { key: '/export/gaplama', icon: <IconTruckDelivery size={15} />, label: t('nav.gaplama') },
```

Add `'/export/gaplama'` to both `group('nav.group_shipping', [...])` (BOSS_MENU_GROUPS,
line 377-380) and `group('nav.group_export', [...])` (STAFF_MENU_GROUPS, line 398-404),
placed right beside the existing `'/tir-takip'` entry in each array.

Extend `isSeraPage` (line 444) so the standalone page also gets the sera header gradient:

```ts
const isSeraPage = location.pathname === '/tir-takip' || location.pathname === '/export/gaplama';
```

- [ ] **Step 7: Add `nav.gaplama` to the three i18n files**

In `frontend/src/i18n/tk.json`, `ru.json`, `en.json`, find the `nav.tir_takip` key
(reported at `tk.json:131`) and add a sibling `gaplama` key in the same `nav` object:

```json
"gaplama": "Gaplama"
```

(tk: `"Gaplama"`; ru: `"Гаплама"`; en: `"Packing"`.)

- [ ] **Step 8: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/sera/GaplamaPage.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 9: Type-check**

Run: `cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0`
(per `project_frontend_typecheck_gotcha` — `npm run type-check` is broken on this repo)
Expected: no new errors attributable to Gaplama files.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/pages/sera/GaplamaPage.tsx frontend/src/pages/sera/GaplamaPage.test.tsx \
        frontend/src/App.tsx frontend/src/components/AppLayout.tsx \
        frontend/src/utils/permissions.ts frontend/src/i18n/tk.json frontend/src/i18n/ru.json frontend/src/i18n/en.json
git commit -m "feat(frontend): add standalone /export/gaplama page and sidebar entry

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: i18n content, CSS, and docs

**Files:**
- Modify: `frontend/src/i18n/{tk,ru,en}.json` — full `tir_takip.gaplama.*` block
- Modify: `frontend/src/pages/sera/sera.css`
- Create: `docs/obsidian/screens/gaplama.md`
- Modify: `docs/obsidian/screens/tir-takip.md`
- Modify: `docs/obsidian/reference/api-endpoint-map.md`
- Modify: `.claude/skills/api-contract/SKILL.md`
- Modify: `CHANGELOG.md`
- Modify: `BUILD_TEST_LOG.md`

**Interfaces:**
- Consumes: every `t('tir_takip.gaplama.*')` key referenced across Tasks 6-9.

- [ ] **Step 1: Add the i18n block**

In each of `tk.json`, `ru.json`, `en.json`, add a `tir_takip.gaplama` object with every
key used in Tasks 6-9. Collect them by grepping the new files for `t('tir_takip.gaplama.`:

```bash
grep -oh "t('tir_takip\.gaplama\.[a-zA-Z_.]*'" frontend/src/pages/sera/GaplamaTab.tsx \
  frontend/src/pages/sera/GaplamaTruckForm.tsx frontend/src/pages/sera/GaplamaPage.tsx \
  | sort -u
```

Add every key found (`prev_week`, `this_week`, `next_week`, `loading`, `block`,
`week_total`, `open_truck`, `edit`, `partial`, `code`, `blocks`, `kg`, `status`, `date`,
`plan`, `loaded`, `available`, `over_tooltip`, `plan_hint`, `location_subtotal`,
`jemi_plan`, `tir_sany`, `opened_trucks`, `trucks_unit`, `duynki_galyndy`, `galan`, and
the `form.*` sub-keys: `day_label`, `kg_label`, `available_hint`, `add_block`,
`harvest_status_ph`, `total_label`, `partial_tag`, `save`, `open_truck`, `cancel`,
`toast_created`, `toast_updated`, `toast_error`) — write real tk/ru/en text for each,
following the voice of the existing `tir_takip.*` block in the same file (Turkmen for tk,
matching the register the other Sera tabs use).

**The `location_*` keys need adding by hand, not by grep**: `GaplamaTab.tsx`'s
`locationLabel()` builds the key as a template literal
(`` `tir_takip.gaplama.location_${location}` ``), which the grep pattern above (a literal
`'...'` string match) will not catch. Add `location_dusak`, `location_kaka`,
`location_owadandepe` explicitly (values: "Dusak", "Kaka", "Owadandepe" — same three names
`OnumcilikTab.tsx`'s block-group chip selector already uses, per `feedback_sera_copies_leave_originals`
memory — copy them verbatim rather than re-translating). Also add `location_other` as a
fallback label for a block with no/unrecognized `location` value.

- [ ] **Step 2: Add minimal `.sera-*` CSS**

Append to `frontend/src/pages/sera/sera.css`, scoped under `.sera-page` per the
containment rule at the top of that file:

```css
.sera-gaplama-header { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
.sera-gaplama-grid { width: 100%; border-collapse: collapse; }
.sera-gaplama-grid th, .sera-gaplama-grid td { border: 1px solid #e5e5e5; padding: 6px 8px; text-align: center; }
.sera-gaplama-day-selected { background: #fef3c7; }
.sera-gaplama-carry-in { font-size: 10px; color: #059669; }
.sera-gaplama-plan-hint { font-size: 10px; color: #9ca3af; }
.sera-gaplama-partial-tag { margin-left: 4px; font-size: 10px; color: #d97706; }
.sera-gaplama-truck-open { margin: 12px 0; }
.sera-gaplama-summary, .sera-gaplama-truck-list { margin-top: 16px; }
.sera-gaplama-summary table, .sera-gaplama-truck-list table { width: 100%; border-collapse: collapse; }
```

- [ ] **Step 3: Write `docs/obsidian/screens/gaplama.md`**

```markdown
---
title: Gaplama
tags: [screen, export, sera-design, tir-takip]
related: [[tir-takip]], [[weekly-harvest-planning]], [[../processes/permissions-system]]
---

# Gaplama — packing view over the Weekly Plan

Two entry points, one screen: the `gaplama` tab of `/tir-takip`, and its own page at
`/export/gaplama`. Both render `frontend/src/pages/sera/GaplamaTab.tsx` behind the same
page code, `tir_takip.gaplama`, plus `export.plan` as a second gate.

## What it shows

A read-only copy of the Weekly Plan (`HarvestDayEntry.plan_value`) per block and day,
minus kg already put on opened trucks (`ShipmentBlockSource.weight_kg`), plus a carried-in
remainder from earlier days. See `docs/superpowers/specs/2026-09-18-tir-takip-gaplama-design.md`
for the full design (D1-D16) and `backend/apps/export/services/gaplama.py` for the
calculation itself.

## Opening a truck

The `+ Tır Aç` button (shown to any role holding `shipment.create`, same check as the
Sheet's own "+" button) opens a form: block + kg rows, capped at each block's available
kg for **today only** — a truck's date is fixed to the day it is created because
`shipment_code`'s date prefix and the actuals rollup both derive from the creation day,
and `Shipment.date` cannot be edited after the fact.

This creates the same kind of supply draft the Sheet's `SupplyDraftModal` creates
(`skip_forecast_check: true`, `block_sources` with real kg), so it appears on the Sheet
as a supply column and is joined to a destination as usual.

## Editing a truck

The `Üýtget` button on an opened truck (visible only while it is still a supply row —
`status_code == 'draft'`, no country, no customer) reopens the same form and saves through
`POST /shipments/{id}/block-sources/` + a `weight_net` sync. Once joined, the truck is
edited on the Sheet like any other row.

## Not built in this screen

Task and notification wiring for a daily "open today's trucks" reminder and an over-load
alert (D14/D15) is a separate feature; see
`docs/superpowers/plans/2026-09-23-gaplama-tasks.md`.
```

- [ ] **Step 4: Update `docs/obsidian/screens/tir-takip.md`**

Add a `## The Gaplama tab` section (mirroring the existing `## The Önümçilik tab` section
in the same file) that links to the new `gaplama.md` doc and updates the "N of 9 tabs
filled" status line at the top of the file.

- [ ] **Step 5: Update `docs/obsidian/reference/api-endpoint-map.md`**

Add a row for `GET /api/v1/export/gaplama/board/` alongside the existing
`harvest-forecast` entries.

- [ ] **Step 6: Update the `api-contract` skill**

Add a `### Gaplama board: GET /api/v1/export/gaplama/board/` section to
`.claude/skills/api-contract/SKILL.md`, following the format of the existing
`harvest-forecast` documentation in the same file — request params, response shape with
decimal-as-string note, error codes.

- [ ] **Step 7: Update `CHANGELOG.md`**

Add an `[Unreleased]` → `Added` entry: "Gaplama screen (Weekly Plan minus opened trucks,
with carry-over) — `tir_takip.gaplama` tab and `/export/gaplama` standalone page."

- [ ] **Step 8: Log the build**

Prepend to `BUILD_TEST_LOG.md`:

```markdown
- [ ] 2026-09-23 — Gaplama screen (board endpoint, grid, Tır Aç/Üýtget form, tab + standalone page) — NEEDS TEST
```

- [ ] **Step 9: Commit**

```bash
git add frontend/src/i18n/tk.json frontend/src/i18n/ru.json frontend/src/i18n/en.json \
        frontend/src/pages/sera/sera.css docs/obsidian/screens/gaplama.md \
        docs/obsidian/screens/tir-takip.md docs/obsidian/reference/api-endpoint-map.md \
        .claude/skills/api-contract/SKILL.md CHANGELOG.md BUILD_TEST_LOG.md
git commit -m "docs(gaplama): i18n copy, CSS, obsidian docs, changelog

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: Full-suite verification

**Files:** none created — this task runs the existing suites end to end.

- [ ] **Step 1: Run the full backend test suite for the touched apps**

```bash
cd backend
python manage.py test apps.export apps.core --verbosity=2
```

Expected: PASS, or only pre-existing failures already tracked in
`project_beta_test_suite_failures` memory — no NEW failures outside `test_gaplama_board.py`.

- [ ] **Step 2: Confirm migrations are all applied**

```bash
python manage.py showmigrations core export | grep -v '\[X\]'
```

Expected: no output (everything applied). If anything unapplied shows, run
`python manage.py migrate` and re-check.

- [ ] **Step 3: Run `makemigrations --check`**

```bash
python manage.py makemigrations --check
```

Expected: "No changes detected" — confirms Task 1's migration fully captures the model
change.

- [ ] **Step 4: Run the full frontend test suite**

```bash
cd frontend
npx vitest run
```

Expected: PASS, or only pre-existing failures unrelated to Gaplama.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit --ignoreDeprecations 5.0
```

Expected: no errors in any `Gaplama*` file.

- [ ] **Step 6: State results plainly**

Report exactly which suites passed, which pre-existing failures (if any) were seen and
where they're tracked, and confirm: "Built — NOT tested yet. Did you test it?" per this
project's standing rule — automated tests passing is not the same as the user having
exercised the feature.

- [ ] **Step 7: Do not commit and do not merge**

Per project rules, stop here. Report readiness to the user and wait for their explicit
"commit"/"merge" instruction before integrating this worktree's branch back into `main`.
