# Daily Plan Progress Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the two daily tasks follow the truck plan. `daily_export` closes when every plan row (country / Gapy) is met and every export part has packing. `daily_loading` closes when packed trucks reach max(plan, export parts). Show plan vs fact on the task cards, on `/export/assign` and in Gaplama.

**Architecture:** One backend service `services/daily_progress.py` computes plan vs fact for a day or a Mon–Sat week, using three aggregate queries. `daily_plan_tasks.py` closes tasks with it and caches one result per date per request. `/me/tasks/` reuses that cache for a new `progress` field. A new read-only action `GET /export/truck-allocations/daily-progress/` serves the week to two frontend strips: one on the Assignment Board (with «+» per plan row) and one in Gaplama's day view.

**Tech Stack:** Django 5 + DRF on MSSQL (mssql-django), Celery beat (unchanged), React 18 + TypeScript + antd + TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-01-daily-plan-progress-tasks-design.md`. Read it before starting any task.

## Global Constraints

- MSSQL: no `JSONField`, no `DISTINCT ON`. Call `.order_by()` before every `values().annotate()` GROUP BY, because `Meta.ordering` leaks into GROUP BY.
- Dependency direction: `export` may import `core` and `greenhouse`, never the reverse. No Django signals.
- Status transitions are untouched. Nothing here calls `transition_to()` or writes `status_id`.
- A **live** shipment is `is_archived=False`, `deleted_at IS NULL`, status not `cancelled`.
- **Export part** = a live shipment with `date = D` that has `country` and `customer`. **Packing** = a live shipment with `date = D` and at least one `block_sources`. 1 row = 1 truck.
- Plan rows come from `TruckDestinationSplit.truck_count > 0` of `WeeklyTruckAllocation(season, year, week_number, day_of_week)`. Rows are grouped by country, and a destination with `country IS NULL` becomes the single `gapy` row, matched by `Shipment.is_gapy_satys`.
- "Today" comes from the **server** (`timezone.localdate()`), never from the browser.
- UI copy never uses «черновик» / «draft» / «garalama». i18n goes in all three of `tk.json`, `ru.json` and `en.json`.
- Shipment Detail route is **`/shipments/{id}`**. The spec says `/export/shipments/{id}`, which is wrong. Task 6 fixes the spec.
- Every count in the new payloads is a JSON int. No decimal strings, so the frontend needs no coercion.
- Commits: one per task, explicit paths only. Run `git status` and `git diff --cached` before each commit (shared index, see root `CLAUDE.md`). Commit only after the user has authorised commits for this plan. End messages with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Backend tests: `cd backend && python manage.py test <module> --keepdb --noinput`. If another `manage.py test` process is running, use the private test DB settings from memory "Test DB Name Collision" instead of trusting a red run.
- Frontend type-check: `cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0` (`npm run type-check` is broken). Tests: `cd frontend && npx vitest run <file>`.
- Subagent execution: Tasks 1–2 go to `backend-dev`, Tasks 3–5 to `frontend-dev`, Task 6 to the main session, and gates to `reviewer` ("stay in your lane", root `CLAUDE.md`). **Subagents treat git as read-only** (shared tree and index). They stop before the "Commit" step and report the file list; the main session runs the commit steps.
- Beta (`10.10.11.25`) runs the OLD code on the SAME database. Until beta is redeployed, its `/me/tasks/` polls run the old resolver, which closes daily tasks on the first truck, and its 06:05 beat creates `daily_export` with the old `/export/drafts` link. Testing on dev can therefore show tasks already closed by beta. That is expected, not a bug in this plan.

## Review Focus

1. **Packing joined to an export part of another day.** Join moves `block_sources` onto the export row, so the packing counts on that row's date. A Tuesday export part with packing must not count as Monday `packed`. Test in Task 1.
2. **Sunday.** `daily-progress?date=<Sunday>` returns Mon–Sat of that ISO week. Both strips render nothing, because "today" is not among the days. Tests in Task 2 (backend) and Task 4 (strip).
3. **Gapy «+» part without a country.** A row created with `is_gapy_satys=true` and no country/customer is not an export part until both are filled. Test in Task 2.
4. **A country exported but not planned.** It shows as a row with `plan = 0` and does not block closing. Test in Task 1.
5. **Browser day ≠ server day.** A UTC machine after Ashgabat midnight must still get the server's today when no `date` is sent. Test in Task 2.

---

### Task 1: `daily_progress` service + new closing rules

**Files:**
- Create: `backend/apps/export/services/daily_progress.py`
- Modify: `backend/apps/export/services/daily_plan_tasks.py` (whole file shown below)
- Create: `backend/apps/export/tests_daily_progress.py`
- Modify: `backend/apps/export/tests_daily_plan_tasks.py`

**Interfaces:**
- Produces (used by Tasks 2–5):
  - `ProgressRow(key: str, label: str, country_id: int | None, is_gapy: bool, plan: int, fact: int)`. `key` is `'country:<id>'` or `'gapy'`.
  - `DayProgress(date: date, rows: list[ProgressRow], plan_total: int, export_parts: int, export_parts_packed: int, packed: int, loading_target: int)`
  - `day_progress(day: date, season) -> DayProgress`. `season=None` gives an empty day.
  - `week_progress(day: date, season) -> list[DayProgress]`, always 6 items, Mon–Sat of `day`'s ISO week.
  - `export_done(p: DayProgress) -> bool`, `loading_done(p: DayProgress) -> bool`
  - `progress_payload(p: DayProgress) -> dict`, the JSON day object (keys: `date`, `day_of_week`, `rows`, `plan_total`, `export_parts`, `export_parts_packed`, `packed`, `loading_target`).
  - `resolve_daily_plan_tasks(progress_by_date: dict[date, DayProgress] | None = None) -> list[Task]`. It fills the dict with every open daily task's day.

- [ ] **Step 1: Write the failing service tests**

Create `backend/apps/export/tests_daily_progress.py`:

```python
"""Plan vs fact for a day — services/daily_progress.py.

Spec: docs/superpowers/specs/2026-10-01-daily-plan-progress-tasks-design.md.

Run:
    python manage.py test apps.export.tests_daily_progress --keepdb --noinput
"""
import datetime

from django.test import TestCase
from django.utils import timezone

from apps.core.models import (
    Country, Customer, GreenhouseBlock, GreenhouseConfig, Season, ShipmentStatusType,
    TruckDestination, User,
)
from apps.export.models import (
    Shipment, ShipmentBlockSource, TruckDestinationSplit, WeeklyTruckAllocation,
)
from apps.export.services.daily_progress import (
    DayProgress, ProgressRow, day_progress, export_done, loading_done, progress_payload,
    week_progress,
)

MONDAY = datetime.date(2026, 9, 28)     # ISO 2026-W40-1
TUESDAY = datetime.date(2026, 9, 29)
WEDNESDAY = datetime.date(2026, 9, 30)
SATURDAY = datetime.date(2026, 10, 3)


class DayProgressTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        GreenhouseConfig.get_solo()
        Season.objects.update(is_active=False)
        cls.season = Season.objects.create(
            name='dp', start_date='2026-08-01', end_date='2027-06-30', is_active=True,
        )
        for code, order, phase in [('draft', 0, 'DRAFT'), ('cancelled', 99, 'CANCELLED')]:
            ShipmentStatusType.objects.get_or_create(
                code=code,
                defaults={'name_tk': code, 'name_en': code, 'name_ru': code,
                          'step_order': order, 'phase': phase},
            )
        cls.user = User.objects.create_user(username='dp_em', password='pw', role='export_manager')
        cls.block = GreenhouseBlock.objects.create(code='DP-A', name='A', is_active=True)
        cls.ru = Country.objects.create(name_tk='Russiýa', name_en='Russia', code='XR')
        cls.kz = Country.objects.create(name_tk='Gazagystan', name_en='Kazakhstan', code='XK')
        cls.customer = Customer.objects.create(name='DP customer')
        cls.moskwa = TruckDestination.objects.create(name='Moskwa', country=cls.ru, sort_order=1)
        cls.piter = TruckDestination.objects.create(name='Piter', country=cls.ru, sort_order=2)
        cls.almaty = TruckDestination.objects.create(name='Almaty', country=cls.kz, sort_order=3)
        cls.gapy = TruckDestination.objects.create(name='Gapy Satys', country=None, sort_order=4)

    def setUp(self):
        self.n = 0

    def _plan(self, day, counts, season=None):
        year, week, dow = day.isocalendar()
        alloc = WeeklyTruckAllocation.objects.create(
            season=season or self.season, year=year, week_number=week, day_of_week=dow,
        )
        for dest, n in counts.items():
            TruckDestinationSplit.objects.create(truck_allocation=alloc, destination=dest, truck_count=n)

    def _ship(self, day, country=None, customer=None, packed=False, status='draft', **extra):
        self.n += 1
        s = Shipment.objects.create(
            shipment_code=f'DP-{self.n}', date=day, season=extra.pop('season', self.season),
            status=ShipmentStatusType.objects.get(code=status), country=country, customer=customer,
            created_by=self.user, updated_by=self.user, **extra,
        )
        if packed:
            ShipmentBlockSource.objects.create(shipment=s, block=self.block, weight_kg=1000)
        return s

    def _part(self, day, country, **extra):
        return self._ship(day, country=country, customer=self.customer, **extra)

    def _row(self, progress, key):
        return next(r for r in progress.rows if r.key == key)

    def test_two_destinations_of_one_country_sum_into_one_row(self):
        self._plan(MONDAY, {self.moskwa: 2, self.piter: 1})
        p = day_progress(MONDAY, self.season)
        row = self._row(p, f'country:{self.ru.id}')
        self.assertEqual((row.plan, row.label, row.is_gapy), (3, 'Moskwa + Piter', False))
        self.assertEqual(len(p.rows), 1)

    def test_gapy_row_counts_gapy_shipments_of_any_country(self):
        self._plan(MONDAY, {self.gapy: 1, self.almaty: 1})
        self._part(MONDAY, self.kz, is_gapy_satys=True)
        p = day_progress(MONDAY, self.season)
        self.assertEqual(self._row(p, 'gapy').fact, 1)
        self.assertEqual(self._row(p, f'country:{self.kz.id}').fact, 0)

    def test_country_outside_the_plan_gets_a_zero_plan_row(self):
        self._plan(MONDAY, {self.almaty: 1})
        self._part(MONDAY, self.ru)
        row = self._row(day_progress(MONDAY, self.season), f'country:{self.ru.id}')
        self.assertEqual((row.plan, row.fact, row.label), (0, 1, 'Russia'))

    def test_dead_incomplete_and_other_day_shipments_do_not_count(self):
        self._part(MONDAY, self.ru, deleted_at=timezone.now(), packed=True)
        self._part(MONDAY, self.ru, status='cancelled', packed=True)
        self._part(MONDAY, self.ru, is_archived=True, packed=True)
        self._part(TUESDAY, self.ru, packed=True)
        self._ship(MONDAY, country=self.ru)                     # no customer yet
        p = day_progress(MONDAY, self.season)
        self.assertEqual((p.export_parts, p.packed), (0, 0))

    def test_free_and_joined_packing_both_count_as_packed(self):
        self._ship(MONDAY, packed=True)                          # free packing
        self._part(MONDAY, self.ru, packed=True)                 # joined
        self._part(MONDAY, self.ru)                              # waits for packing
        p = day_progress(MONDAY, self.season)
        self.assertEqual((p.packed, p.export_parts, p.export_parts_packed), (2, 2, 1))

    def test_packing_joined_to_another_days_part_counts_on_that_day(self):
        self._part(TUESDAY, self.ru, packed=True)
        self.assertEqual(day_progress(MONDAY, self.season).packed, 0)
        self.assertEqual(day_progress(TUESDAY, self.season).packed, 1)

    def test_loading_target_is_the_larger_of_plan_and_export_parts(self):
        self._plan(MONDAY, {self.almaty: 3})
        self._part(MONDAY, self.kz)
        self.assertEqual(day_progress(MONDAY, self.season).loading_target, 3)
        self._plan(TUESDAY, {self.almaty: 1})
        self._part(TUESDAY, self.kz)
        self._part(TUESDAY, self.kz)
        self.assertEqual(day_progress(TUESDAY, self.season).loading_target, 2)

    def test_other_season_rows_do_not_count(self):
        old = Season.objects.create(name='dp-old', start_date='2025-08-01', end_date='2026-06-30')
        self._plan(MONDAY, {self.almaty: 2}, season=old)
        self._part(MONDAY, self.kz, season=old)
        p = day_progress(MONDAY, self.season)
        self.assertEqual((p.rows, p.export_parts), ([], 0))

    def test_no_season_is_an_empty_day(self):
        self._part(MONDAY, self.kz, packed=True)
        p = day_progress(MONDAY, None)
        self.assertEqual((p.rows, p.export_parts, p.packed, p.loading_target), ([], 0, 0, 0))

    def test_week_is_monday_to_saturday_of_the_iso_week(self):
        self._plan(TUESDAY, {self.almaty: 2})
        week = week_progress(WEDNESDAY, self.season)
        self.assertEqual([d.date for d in week][0], MONDAY)
        self.assertEqual(week[-1].date, SATURDAY)
        self.assertEqual(len(week), 6)
        self.assertEqual(week[1].plan_total, 2)
        self.assertEqual(week[0].plan_total, 0)

    def test_payload_is_plain_json_ints(self):
        self._plan(MONDAY, {self.almaty: 1})
        payload = progress_payload(day_progress(MONDAY, self.season))
        self.assertEqual(payload['date'], '2026-09-28')
        self.assertEqual(payload['day_of_week'], 1)
        self.assertEqual(payload['rows'][0], {
            'key': f'country:{self.kz.id}', 'label': 'Almaty', 'country_id': self.kz.id,
            'is_gapy': False, 'plan': 1, 'fact': 0,
        })


def _day(rows=(), export_parts=0, export_parts_packed=0, packed=0, loading_target=0):
    rows = list(rows)
    return DayProgress(
        date=MONDAY, rows=rows, plan_total=sum(r.plan for r in rows), export_parts=export_parts,
        export_parts_packed=export_parts_packed, packed=packed, loading_target=loading_target,
    )


def _r(plan, fact, key='country:1'):
    return ProgressRow(key=key, label=key, country_id=None, is_gapy=False, plan=plan, fact=fact)


class DoneRuleTests(TestCase):
    def test_export_needs_every_row_met_every_part_packed_and_one_part(self):
        self.assertFalse(export_done(_day()))
        self.assertFalse(export_done(_day([_r(2, 1)], export_parts=1, export_parts_packed=1)))
        self.assertFalse(export_done(_day([_r(1, 1)], export_parts=1, export_parts_packed=0)))
        self.assertTrue(export_done(_day([_r(1, 1), _r(0, 1, 'country:2')], export_parts=2, export_parts_packed=2)))

    def test_loading_needs_target_and_one_truck(self):
        self.assertFalse(loading_done(_day(packed=0, loading_target=0)))
        self.assertFalse(loading_done(_day(packed=2, loading_target=3)))
        self.assertTrue(loading_done(_day(packed=1, loading_target=0)))
        self.assertTrue(loading_done(_day(packed=3, loading_target=3)))
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd backend && python manage.py test apps.export.tests_daily_progress --keepdb --noinput`
Expected: ERROR `ModuleNotFoundError: No module named 'apps.export.services.daily_progress'`.

- [ ] **Step 3: Write the service**

Create `backend/apps/export/services/daily_progress.py`:

```python
"""Plan vs fact for one day — the truck allocation against that day's shipments.

Three readers share it: the daily task resolver (daily_plan_tasks.py), the
`progress` field on /me/tasks/, and GET /truck-allocations/daily-progress/.

- Export part: a live shipment dated the day with a country AND a customer.
- Packing: a live shipment dated the day with ≥1 block_sources, free or
  joined. One row = one truck.
- Plan rows: the day's TruckDestinationSplit (truck_count > 0), grouped by
  country. Destinations with no country (Gapy Satys) form one 'gapy' row,
  matched by Shipment.is_gapy_satys instead of a country.

Spec: docs/superpowers/specs/2026-10-01-daily-plan-progress-tasks-design.md.
"""
from dataclasses import dataclass
from datetime import date, timedelta

from django.db.models import Count, Q

from apps.export.models import Shipment, TruckDestinationSplit

PLAN_DAYS = 6  # Mon–Sat
GAPY_KEY = 'gapy'
GAPY_LABEL = 'Gapy Satys'


@dataclass(frozen=True)
class ProgressRow:
    key: str
    label: str
    country_id: int | None
    is_gapy: bool
    plan: int
    fact: int


@dataclass(frozen=True)
class DayProgress:
    date: date
    rows: list[ProgressRow]
    plan_total: int
    export_parts: int
    export_parts_packed: int
    packed: int
    loading_target: int


@dataclass
class _Bucket:
    label: str
    country_id: int | None
    is_gapy: bool
    count: int = 0
    packed: int = 0


def day_progress(day: date, season) -> DayProgress:
    """Plan vs fact for one day inside `season` (None → an empty day)."""
    return _progress_for([day], season)[0]


def week_progress(day: date, season) -> list[DayProgress]:
    """Plan vs fact for Mon–Sat of the ISO week that contains `day`."""
    monday = day - timedelta(days=day.weekday())
    return _progress_for([monday + timedelta(days=i) for i in range(PLAN_DAYS)], season)


def export_done(p: DayProgress) -> bool:
    """daily_export: every plan row met, every export part packed, ≥1 export part."""
    return (
        p.export_parts >= 1
        and all(r.fact >= r.plan for r in p.rows)
        and p.export_parts_packed == p.export_parts
    )


def loading_done(p: DayProgress) -> bool:
    """daily_loading: packed trucks reach max(plan, export parts), and ≥1."""
    return p.packed >= 1 and p.packed >= p.loading_target


def progress_payload(p: DayProgress) -> dict:
    """The JSON day object shared by the endpoint and /me/tasks/ — ints only."""
    return {
        'date': p.date.isoformat(),
        'day_of_week': p.date.isoweekday(),
        'rows': [
            {'key': r.key, 'label': r.label, 'country_id': r.country_id,
             'is_gapy': r.is_gapy, 'plan': r.plan, 'fact': r.fact}
            for r in p.rows
        ],
        'plan_total': p.plan_total,
        'export_parts': p.export_parts,
        'export_parts_packed': p.export_parts_packed,
        'packed': p.packed,
        'loading_target': p.loading_target,
    }


def _progress_for(days: list[date], season) -> list[DayProgress]:
    # Every caller passes days of ONE ISO week (a single day, or Mon–Sat).
    if season is None:
        return [_assemble(d, {}, {}, 0) for d in days]
    plans = _plan_buckets(days, season)
    parts = _export_part_buckets(days, season)
    packed = _packed_counts(days, season)
    return [_assemble(d, plans.get(d, {}), parts.get(d, {}), packed.get(d, 0)) for d in days]


def _key(country_id: int | None, is_gapy: bool) -> str:
    return GAPY_KEY if is_gapy else f'country:{country_id}'


def _plan_buckets(days: list[date], season) -> dict[date, dict[str, _Bucket]]:
    year, week, _ = days[0].isocalendar()
    by_weekday = {d.isoweekday(): d for d in days}
    rows = (
        TruckDestinationSplit.objects
        .filter(
            truck_allocation__season=season, truck_allocation__year=year,
            truck_allocation__week_number=week,
            truck_allocation__day_of_week__in=list(by_weekday), truck_count__gt=0,
        )
        .order_by('destination__sort_order', 'destination__name')
        .values_list('truck_allocation__day_of_week', 'destination__country_id',
                     'destination__name', 'truck_count')
    )
    out: dict[date, dict[str, _Bucket]] = {}
    for dow, country_id, name, trucks in rows:
        is_gapy = country_id is None
        buckets = out.setdefault(by_weekday[dow], {})
        bucket = buckets.setdefault(_key(country_id, is_gapy), _Bucket(name, country_id, is_gapy))
        if name not in bucket.label.split(' + '):
            bucket.label = f'{bucket.label} + {name}'
        bucket.count += trucks
    return out


def _live(days: list[date], season):
    return (
        Shipment.objects
        .filter(date__in=days, season=season, is_archived=False, deleted_at__isnull=True)
        .exclude(status__code='cancelled')
        .order_by()  # strip Meta.ordering so it doesn't join the GROUP BY
    )


def _export_part_buckets(days: list[date], season) -> dict[date, dict[str, _Bucket]]:
    rows = (
        _live(days, season)
        .filter(country__isnull=False, customer__isnull=False)
        .values('date', 'country_id', 'country__name_en', 'country__name_tk', 'is_gapy_satys')
        .annotate(
            n=Count('id', distinct=True),
            n_packed=Count('id', distinct=True, filter=Q(block_sources__isnull=False)),
        )
    )
    out: dict[date, dict[str, _Bucket]] = {}
    for r in rows:
        is_gapy = r['is_gapy_satys']
        label = GAPY_LABEL if is_gapy else (r['country__name_en'] or r['country__name_tk'])
        country_id = None if is_gapy else r['country_id']
        bucket = out.setdefault(r['date'], {}).setdefault(
            _key(country_id, is_gapy), _Bucket(label, country_id, is_gapy),
        )
        bucket.count += r['n']
        bucket.packed += r['n_packed']
    return out


def _packed_counts(days: list[date], season) -> dict[date, int]:
    rows = (
        _live(days, season)
        .filter(block_sources__isnull=False)
        .values('date')
        .annotate(n=Count('id', distinct=True))
    )
    return {r['date']: r['n'] for r in rows}


def _assemble(day: date, plan: dict[str, _Bucket], parts: dict[str, _Bucket], packed: int) -> DayProgress:
    rows = [
        ProgressRow(key=k, label=b.label, country_id=b.country_id, is_gapy=b.is_gapy,
                    plan=b.count, fact=parts[k].count if k in parts else 0)
        for k, b in plan.items()
    ] + [
        ProgressRow(key=k, label=b.label, country_id=b.country_id, is_gapy=b.is_gapy,
                    plan=0, fact=b.count)
        for k, b in parts.items() if k not in plan
    ]
    plan_total = sum(r.plan for r in rows)
    export_parts = sum(b.count for b in parts.values())
    return DayProgress(
        date=day, rows=rows, plan_total=plan_total, export_parts=export_parts,
        export_parts_packed=sum(b.packed for b in parts.values()),
        packed=packed, loading_target=max(plan_total, export_parts),
    )
```

Note on `_plan_buckets`: `setdefault` creates the bucket with the first name. The `if name not in …` line then sees that name already in the label and skips it, so only a second destination of the same country is appended.

- [ ] **Step 4: Run the service tests and confirm they pass**

Run: `cd backend && python manage.py test apps.export.tests_daily_progress --keepdb --noinput`
Expected: `OK` (13 tests).

- [ ] **Step 5: Update the daily task tests for the new rules (failing first)**

In `backend/apps/export/tests_daily_plan_tasks.py`:

1. Extend the imports:

```python
from unittest import mock

from apps.core.models import (
    Country, Customer, GreenhouseBlock, GreenhouseConfig, Season, ShipmentStatusType,
    TruckDestination, User,
)
from apps.export.models import (
    Shipment, ShipmentBlockSource, Task, TaskCancelReason, TaskKind, TaskState,
    TruckDestinationSplit, WeeklyTruckAllocation,
)
from apps.export.services import daily_progress as daily_progress_module
```

2. In `setUpTestData`, after `cls.customer = ...`, add:

```python
        cls.dest = TruckDestination.objects.create(name='DPT dest', country=cls.country, sort_order=1)
```

3. Add a helper method under `_task`:

```python
    def _plan(self, day, trucks):
        year, week, dow = day.isocalendar()
        alloc = WeeklyTruckAllocation.objects.create(
            season=self.season, year=year, week_number=week, day_of_week=dow,
        )
        TruckDestinationSplit.objects.create(truck_allocation=alloc, destination=self.dest, truck_count=trucks)
```

4. In `test_generates_two_tasks_monday_to_saturday_not_sunday`, change the export link assertion to:

```python
        self.assertEqual((export.assignee_role, export.link), ('export_manager', '/export/assign'))
```

5. Replace `test_export_done_needs_country_and_customer` with:

```python
    def test_export_done_needs_country_customer_and_packing(self):
        generate_daily_plan_tasks(MONDAY)
        self._shipment(MONDAY, country=self.country)      # no customer yet
        resolve_daily_plan_tasks()
        self.assertEqual(self._task(TaskKind.DAILY_EXPORT, MONDAY).state, TaskState.OPEN)
        part = self._shipment(MONDAY, country=self.country, customer=self.customer)
        resolve_daily_plan_tasks()
        self.assertEqual(self._task(TaskKind.DAILY_EXPORT, MONDAY).state, TaskState.OPEN)
        ShipmentBlockSource.objects.create(shipment=part, block=self.block, weight_kg=1000)
        resolve_daily_plan_tasks()
        self.assertEqual(self._task(TaskKind.DAILY_EXPORT, MONDAY).state, TaskState.DONE)

    def test_export_waits_until_every_planned_truck_is_opened(self):
        self._plan(MONDAY, 2)
        generate_daily_plan_tasks(MONDAY)
        self._truck(MONDAY, country=self.country, customer=self.customer)
        resolve_daily_plan_tasks()
        self.assertEqual(self._task(TaskKind.DAILY_EXPORT, MONDAY).state, TaskState.OPEN)
        self._truck(MONDAY, country=self.country, customer=self.customer)
        resolve_daily_plan_tasks()
        self.assertEqual(self._task(TaskKind.DAILY_EXPORT, MONDAY).state, TaskState.DONE)

    def test_loading_waits_for_the_plan_even_when_packing_comes_first(self):
        self._plan(MONDAY, 2)
        generate_daily_plan_tasks(MONDAY)
        self._truck(MONDAY)                                # free packing, no export part yet
        resolve_daily_plan_tasks()
        self.assertEqual(self._task(TaskKind.DAILY_LOADING, MONDAY).state, TaskState.OPEN)
        self._truck(MONDAY)
        resolve_daily_plan_tasks()
        self.assertEqual(self._task(TaskKind.DAILY_LOADING, MONDAY).state, TaskState.DONE)

    def test_loading_target_grows_with_export_parts_above_plan(self):
        self._plan(MONDAY, 1)
        generate_daily_plan_tasks(MONDAY)
        self._shipment(MONDAY, country=self.country, customer=self.customer)
        self._shipment(MONDAY, country=self.country, customer=self.customer)
        self._truck(MONDAY)
        resolve_daily_plan_tasks()
        self.assertEqual(self._task(TaskKind.DAILY_LOADING, MONDAY).state, TaskState.OPEN)

    def test_resolver_computes_each_day_once_and_hands_it_back(self):
        generate_daily_plan_tasks(MONDAY)                 # two open tasks, same day
        cache = {}
        with mock.patch(
            'apps.export.services.daily_plan_tasks.day_progress',
            wraps=daily_progress_module.day_progress,
        ) as spy:
            resolve_daily_plan_tasks(cache)
        self.assertEqual(spy.call_count, 1)
        self.assertEqual(list(cache), [MONDAY])
```

- [ ] **Step 6: Run the daily task tests and confirm the new ones fail**

Run: `cd backend && python manage.py test apps.export.tests_daily_plan_tasks --keepdb --noinput`
Expected: FAIL. `test_generates…` fails (link is still `/export/drafts`), and the new tests fail (closing on the first truck; `resolve_daily_plan_tasks()` takes no argument).

- [ ] **Step 7: Rewrite `daily_plan_tasks.py`**

Replace the whole file `backend/apps/export/services/daily_plan_tasks.py` with:

```python
"""Daily planning tasks — docs/Tasks.md items 4 and 5a.

daily_loading  loading_dept_head (+ deputy via TASK_ROLE_EQUIVALENTS)
               «Şu güne ýük, maşyn planla» → /export/gaplama. Done when the
               day's packed trucks reach max(planned trucks, export parts),
               and at least one.
daily_export   export_manager
               «Eksport planla» → /export/assign. Done when every plan row
               (country / Gapy) has fact ≥ plan, every export part of the day
               has packing, and there is at least one export part.

Plan vs fact comes from services/daily_progress.py (spec
docs/superpowers/specs/2026-10-01-daily-plan-progress-tasks-design.md).

"Dated today" (owner, 2026-09-29): a truck opened yesterday FOR today counts.
Mon–Sat only. Red after 23:59 local (Task.deadline). The 06:05 beat first
resolves, then cancels every earlier open one as `missed` (history only — KPI
ignores cancelled tasks), then opens today's. /me/tasks/ resolves lazily but
never creates.

Spec: docs/superpowers/specs/2026-09-29-planning-tasks-design.md.
"""
import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.export.models import Task, TaskCancelReason, TaskCompletionRule, TaskKind, TaskState
from apps.export.services.daily_progress import DayProgress, day_progress, export_done, loading_done
from apps.export.services.plan_task_common import end_of_local_day, local_today

logger = logging.getLogger(__name__)

SUNDAY = 6
OPEN_STATES = (TaskState.OPEN, TaskState.IN_PROGRESS)


@dataclass(frozen=True)
class DailySpec:
    role: str
    title_key: str
    link: str
    is_done: Callable[[DayProgress], bool]


SPECS: dict[str, DailySpec] = {
    TaskKind.DAILY_LOADING: DailySpec(
        'loading_dept_head', 'tasks.daily_loading_plan', '/export/gaplama', loading_done,
    ),
    TaskKind.DAILY_EXPORT: DailySpec(
        'export_manager', 'tasks.daily_export_plan', '/export/assign', export_done,
    ),
}


def generate_daily_plan_tasks(today: date) -> list[Task]:
    from apps.core.seasons import get_active_season

    if today.weekday() == SUNDAY or get_active_season() is None:
        return []
    created: list[Task] = []
    for kind, spec in SPECS.items():
        if Task.objects.filter(kind=kind, scope_date=today).exists():
            continue
        try:
            with transaction.atomic():
                created.append(Task.objects.create(
                    shipment=None, kind=kind, step=kind, rule=None,
                    title_key=spec.title_key, assignee_role=spec.role, assignee_user=None,
                    completion_rule=TaskCompletionRule.MANUAL_DONE, link=spec.link,
                    scope_date=today, deadline=end_of_local_day(today), state=TaskState.OPEN,
                ))
        except IntegrityError:
            continue      # a concurrent run created it (export_task_one_daily_per_kind)
    return created


def resolve_daily_plan_tasks(progress_by_date: dict[date, DayProgress] | None = None) -> list[Task]:
    """Close every open daily task whose day now meets its rule.

    Global and lazy (/me/tasks/, beat). Each day is computed once per call and
    left in `progress_by_date` when the caller passes a dict — /me/tasks/ hands
    it to TaskListSerializer so the cards don't recompute it.
    """
    from apps.core.seasons import get_active_season

    cache = {} if progress_by_date is None else progress_by_date
    season = get_active_season()
    resolved: list[Task] = []
    for task in Task.objects.filter(kind__in=list(SPECS), state__in=OPEN_STATES, scope_date__isnull=False):
        if task.scope_date not in cache:
            cache[task.scope_date] = day_progress(task.scope_date, season)
        if SPECS[task.kind].is_done(cache[task.scope_date]):
            _mark_done(task)
            resolved.append(task)
    return resolved


def _mark_done(task: Task) -> None:
    now = timezone.now()
    task.state = TaskState.DONE
    task.completed_at = now
    task.started_at = task.started_at or now
    task.save(update_fields=['state', 'completed_at', 'started_at'])


def cancel_missed_daily_tasks(today: date) -> int:
    return Task.objects.filter(
        kind__in=list(SPECS), state__in=OPEN_STATES, scope_date__lt=today,
    ).update(state=TaskState.CANCELLED, cancelled_reason=TaskCancelReason.MISSED)


def run_daily_plan_tasks(today: date | None = None) -> None:
    """Beat, daily 06:05 local."""
    today = today or local_today()
    resolve_daily_plan_tasks()
    missed = cancel_missed_daily_tasks(today)
    created = generate_daily_plan_tasks(today)
    resolve_daily_plan_tasks()        # a truck already dated today closes the fresh task
    logger.info('Daily plan tasks %s: %d created, %d missed', today, len(created), missed)
```

- [ ] **Step 8: Run both test modules and the `/me/tasks/` suites**

Run: `cd backend && python manage.py test apps.export.tests_daily_progress apps.export.tests_daily_plan_tasks apps.export.tests_plan_task_model --keepdb --noinput`
Expected: `OK`. If `tests_plan_task_model` asserts the old `/export/drafts` link, update that one assertion to `/export/assign`.

- [ ] **Step 9: Commit**

```bash
git status
git add backend/apps/export/services/daily_progress.py backend/apps/export/services/daily_plan_tasks.py \
  backend/apps/export/tests_daily_progress.py backend/apps/export/tests_daily_plan_tasks.py
git diff --cached --name-only
git commit -m "feat(p3): daily tasks close by the truck plan, not the first truck

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

(Add `backend/apps/export/tests_plan_task_model.py` to `git add` only if Step 8 changed it.)

---

### Task 2: `daily-progress` endpoint, `progress` on `/me/tasks/`, `is_gapy_satys` on create

**Files:**
- Modify: `backend/apps/export/views_planning.py`. Add an action after `transport_plan` (~line 222).
- Modify: `backend/apps/core/views_me.py:115` (resolver call) and `:212-216` (serializer calls)
- Modify: `backend/apps/export/serializers.py`: `TaskListSerializer` (~line 2422) and `ShipmentCreateSerializer` (~line 1910)
- Modify: `backend/apps/export/views.py`: `_create_draft_shipment`, the `Shipment.objects.create(...)` at ~line 2278
- Create: `backend/apps/export/tests_daily_progress_api.py`

**Interfaces:**
- Consumes: `week_progress`, `progress_payload`, `resolve_daily_plan_tasks(progress_by_date)` from Task 1.
- Produces:
  - `GET /api/v1/export/truck-allocations/daily-progress/?date=YYYY-MM-DD[&season=]` → `{"date": "YYYY-MM-DD", "days": [<progress_payload>×6]}`. `days: []` during the season gap; `400 {"error": "date must be YYYY-MM-DD."}` on a malformed date.
  - `TaskListSerializer.progress`: a `progress_payload` dict or `null`. The serializer context key is `'daily_progress'` (`dict[date, DayProgress]`).
  - `POST /export/shipments/` accepts `is_gapy_satys: bool` (default `false`) on the draft path.

- [ ] **Step 1: Write the failing API tests**

Create `backend/apps/export/tests_daily_progress_api.py`:

```python
"""GET /truck-allocations/daily-progress/, /me/tasks/ progress, gapy on create.

Spec: docs/superpowers/specs/2026-10-01-daily-plan-progress-tasks-design.md.

Run:
    python manage.py test apps.export.tests_daily_progress_api --keepdb --noinput
"""
import datetime as dt
from unittest import mock

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import (
    Country, Customer, GreenhouseConfig, Season, ShipmentStatusType, TruckDestination, User,
)
from apps.export.models import (
    Shipment, Task, TaskKind, TaskState, TruckDestinationSplit, WeeklyTruckAllocation,
)
from apps.export.services.daily_plan_tasks import generate_daily_plan_tasks

URL = '/api/v1/export/truck-allocations/daily-progress/'
MONDAY = dt.date(2026, 9, 28)
SUNDAY = dt.date(2026, 10, 4)
# 00:10 on Thu 1 Oct in Ashgabat (UTC+5) is still Wed 30 Sep in UTC.
AFTER_LOCAL_MIDNIGHT = dt.datetime(2026, 9, 30, 19, 10, tzinfo=dt.timezone.utc)


class DailyProgressApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        GreenhouseConfig.get_solo()
        Season.objects.update(is_active=False)
        cls.season = Season.objects.create(
            name='dpa', start_date='2026-08-01', end_date='2027-06-30', is_active=True,
        )
        ShipmentStatusType.objects.get_or_create(
            code='draft',
            defaults={'name_tk': 'draft', 'name_en': 'Draft', 'name_ru': 'Draft', 'step_order': 0, 'phase': 'DRAFT'},
        )
        cls.em = User.objects.create_user(username='dpa_em', password='pw', role='export_manager')
        cls.loading = User.objects.create_user(username='dpa_ld', password='pw', role='loading_dept_head')
        cls.rep = User.objects.create_user(username='dpa_rep', password='pw', role='sales_rep')
        cls.kz = Country.objects.create(name_tk='Gazagystan', name_en='Kazakhstan', code='XQ')
        cls.customer = Customer.objects.create(name='DPA customer')
        cls.almaty = TruckDestination.objects.create(name='Almaty', country=cls.kz, sort_order=1)
        alloc = WeeklyTruckAllocation.objects.create(season=cls.season, year=2026, week_number=40, day_of_week=1)
        TruckDestinationSplit.objects.create(truck_allocation=alloc, destination=cls.almaty, truck_count=2)

    def _client(self, user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def _part(self, day=MONDAY, **extra):
        n = Shipment.objects.count() + 1
        return Shipment.objects.create(
            shipment_code=f'DPA-{n}', date=day, season=self.season,
            status=ShipmentStatusType.objects.get(code='draft'),
            created_by=self.em, updated_by=self.em, **extra,
        )

    def test_week_of_six_days_with_plan_and_fact(self):
        self._part(country=self.kz, customer=self.customer)
        resp = self._client(self.loading).get(URL, {'date': '2026-09-30'})
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['date'], '2026-09-30')
        self.assertEqual([d['date'] for d in resp.data['days']][0], '2026-09-28')
        self.assertEqual(len(resp.data['days']), 6)
        monday = resp.data['days'][0]
        self.assertEqual(monday['rows'][0]['plan'], 2)
        self.assertEqual(monday['rows'][0]['fact'], 1)
        self.assertEqual(monday['loading_target'], 2)

    def test_no_date_means_the_servers_local_today(self):
        with mock.patch('django.utils.timezone.now', return_value=AFTER_LOCAL_MIDNIGHT):
            resp = self._client(self.em).get(URL)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['date'], '2026-10-01')

    def test_sunday_returns_that_weeks_monday_to_saturday(self):
        resp = self._client(self.em).get(URL, {'date': SUNDAY.isoformat()})
        self.assertEqual([d['date'] for d in resp.data['days']][-1], '2026-10-03')
        self.assertNotIn(SUNDAY.isoformat(), [d['date'] for d in resp.data['days']])

    def test_malformed_date_is_400(self):
        resp = self._client(self.em).get(URL, {'date': '01.10.2026'})
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data, {'error': 'date must be YYYY-MM-DD.'})

    def test_role_without_truck_allocation_view_is_403(self):
        self.assertEqual(self._client(self.rep).get(URL).status_code, 403)

    def test_closed_season_without_permission_is_403(self):
        closed = Season.objects.create(
            name='dpa-old', start_date='2025-08-01', end_date='2026-06-30', closed_at=timezone.now(),
        )
        resp = self._client(self.loading).get(URL, {'date': '2026-01-05', 'season': closed.id})
        self.assertEqual(resp.status_code, 403)

    def test_season_gap_is_an_empty_week(self):
        Season.objects.update(is_active=False)
        resp = self._client(self.em).get(URL, {'date': '2026-09-28'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['days'], [])

    def test_gapy_part_without_country_is_not_an_export_part(self):
        self._part(is_gapy_satys=True)
        resp = self._client(self.em).get(URL, {'date': '2026-09-28'})
        self.assertEqual(resp.data['days'][0]['export_parts'], 0)

    def test_me_tasks_carries_progress_on_open_daily_tasks_only(self):
        generate_daily_plan_tasks(MONDAY)
        Task.objects.filter(kind=TaskKind.DAILY_LOADING).update(state=TaskState.DONE)
        resp = self._client(self.em).get('/api/v1/me/tasks/')
        self.assertEqual(resp.status_code, 200, resp.content)
        rows = resp.data['results'] if isinstance(resp.data, dict) else resp.data
        by_kind = {r['kind']: r for r in rows if r['kind'] in ('daily_export', 'daily_loading')}
        self.assertEqual(by_kind['daily_export']['progress']['rows'][0]['plan'], 2)
        self.assertIsNone(by_kind['daily_loading']['progress'])

    def test_create_accepts_the_gapy_flag(self):
        resp = self._client(self.em).post(
            '/api/v1/export/shipments/', {'is_draft': True, 'is_gapy_satys': True}, format='json',
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertTrue(Shipment.objects.get(pk=resp.data['id']).is_gapy_satys)
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd backend && python manage.py test apps.export.tests_daily_progress_api --keepdb --noinput`
Expected: FAIL. The endpoint returns 404 or 405, there is no `progress` key, and `is_gapy_satys` is ignored on create.

- [ ] **Step 3: Add the endpoint**

In `backend/apps/export/views_planning.py`, inside `WeeklyTruckAllocationViewSet`, right after the `transport_plan` action:

```python
    @action(detail=False, methods=['get'], url_path='daily-progress')
    def daily_progress(self, request):
        """GET /api/v1/export/truck-allocations/daily-progress/?date=YYYY-MM-DD

        Plan vs fact for Mon–Sat of `date`'s ISO week (spec 2026-10-01). No
        date → the server's local today (users sit in KZ/RU). Season-scoped,
        unlike review/transport-plan: it counts shipments by date, so ?season=
        follows resolve_season (404 / 403) and the close→open gap is empty.
        """
        from apps.core.seasons import resolve_season
        from apps.export.services.daily_progress import progress_payload, week_progress

        raw = (request.query_params.get('date') or '').strip()
        try:
            day = datetime.date.fromisoformat(raw) if raw else timezone.localdate()
        except ValueError:
            return Response({'error': 'date must be YYYY-MM-DD.'}, status=http_status.HTTP_400_BAD_REQUEST)
        season = resolve_season(request)
        days = [] if season is None else [progress_payload(p) for p in week_progress(day, season)]
        return Response({'date': day.isoformat(), 'days': days})
```

`datetime`, `timezone`, `Response` and `http_status` are already imported at the top of the file.

`datetime.date.fromisoformat` accepts `20260930` as well as `2026-09-30` on Python 3.11+. The test only checks that `01.10.2026` is rejected.

- [ ] **Step 4: Pass the progress cache from `/me/tasks/` to the serializer**

In `backend/apps/core/views_me.py`, replace the line `resolve_daily_plan_tasks()` (~line 115) with:

```python
        # Daily loading/export tasks: resolve only — creation belongs to the
        # 06:05 beat (a GET that creates would race on every badge poll). The
        # day's plan vs fact is computed once here and reused by the cards.
        daily_progress: dict = {}
        resolve_daily_plan_tasks(daily_progress)
```

(The two comment lines above the old call are replaced by these three.)

At the end of `get()`, replace the two serializer constructions:

```python
        context = {'daily_progress': daily_progress}
        paginator = TaskBoardPagination()
        page = paginator.paginate_queryset(qs, request)
        if page is not None:
            serializer = TaskListSerializer(page, many=True, context=context)
            return paginator.get_paginated_response(serializer.data)

        serializer = TaskListSerializer(qs, many=True, context=context)
        return Response(serializer.data)
```

- [ ] **Step 5: Add `progress` to `TaskListSerializer`**

In `backend/apps/export/serializers.py`, inside `TaskListSerializer`, after the `truck_plate` field:

```python
    # Plan vs fact for an open daily_loading / daily_export task. Computed once
    # per day by resolve_daily_plan_tasks and handed in through the context
    # ('daily_progress', set by MeTaskListView); null everywhere else.
    progress = serializers.SerializerMethodField()
```

After `get_documents_redo`:

```python
    def get_progress(self, obj) -> dict | None:
        if obj.kind not in (TaskKind.DAILY_LOADING, TaskKind.DAILY_EXPORT):
            return None
        if obj.state not in (TaskState.OPEN, TaskState.IN_PROGRESS):
            return None
        day = self.context.get('daily_progress', {}).get(obj.scope_date)
        if day is None:
            return None
        from apps.export.services.daily_progress import progress_payload
        return progress_payload(day)
```

In `Meta.fields`, add `'progress',` after `'documents_redo',`.

- [ ] **Step 6: Accept `is_gapy_satys` on create**

In `ShipmentCreateSerializer` (`backend/apps/export/serializers.py`), after `is_draft = serializers.BooleanField(default=False)`:

```python
    # «+» on the Gapy row of the /export/assign plan strip (spec 2026-10-01):
    # the export part is born gapy; country/customer are filled on its page.
    is_gapy_satys = serializers.BooleanField(default=False)
```

In `backend/apps/export/views.py`, in `_create_draft_shipment`'s `Shipment.objects.create(...)` (~line 2278), add after `harvest_status=...`:

```python
                is_gapy_satys=data.get('is_gapy_satys', False),
```

- [ ] **Step 7: Run the tests and confirm they pass**

Run: `cd backend && python manage.py test apps.export.tests_daily_progress_api apps.export.tests_daily_progress apps.export.tests_daily_plan_tasks apps.export.tests_local_date_codes --keepdb --noinput`
Expected: `OK`.

- [ ] **Step 8: Run the suites that read `/me/tasks/`**

Run: `cd backend && python manage.py test apps.core apps.export.tests_plan_task_model apps.export.tests_truck_allocation_tasks apps.export.tests_plan_ack_tasks --keepdb --noinput`
Expected: no new failures. Compare with memory "Backend Test Suite Failures". Pre-existing failures in other buckets are not yours.

- [ ] **Step 9: Commit**

```bash
git status
git add backend/apps/export/views_planning.py backend/apps/core/views_me.py \
  backend/apps/export/serializers.py backend/apps/export/views.py \
  backend/apps/export/tests_daily_progress_api.py
git diff --cached --name-only
git commit -m "feat(p3): daily-progress endpoint, task progress field, gapy flag on create

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Types, hook, progress line on the task card, Task Rules wording

**Files:**
- Modify: `frontend/src/types/index.ts` (add new interfaces before `ITaskListItem`, ~line 1818; add the `progress` field to `ITaskListItem`, ~line 1859)
- Create: `frontend/src/hooks/useDailyProgress.ts`
- Create: `frontend/src/components/me/planTaskProgress.ts`
- Modify: `frontend/src/components/me/PlanTaskCard.tsx`
- Modify: `frontend/src/components/me/PlanTaskCard.test.tsx`
- Modify: `frontend/src/i18n/tk.json`, `ru.json`, `en.json` (`tasks.*`, `task_rules.kind_daily_*_completes`)

**Interfaces:**
- Consumes: the `/me/tasks/` `progress` field (Task 2).
- Produces (used by Tasks 4–5):
  - `IDailyProgressRow`, `IDailyProgressDay`, `IDailyProgress` in `@/types`
  - `useDailyProgress(date?: string)` → `UseQueryResult<IDailyProgress>`, query key `['daily-progress', date ?? 'today', seasonId]`
  - i18n `tasks.progress_packing` (`{{done}}`, `{{total}}`), `tasks.progress_packed` (`{{done}}`, `{{total}}`)

- [ ] **Step 1: Add the types**

In `frontend/src/types/index.ts`, immediately before `export interface ITaskListItem`:

```ts
/** One plan row of a day: a country (its destinations summed) or Gapy. */
export interface IDailyProgressRow {
  /** 'country:<id>' | 'gapy' */
  key: string;
  label: string;
  country_id: number | null;
  is_gapy: boolean;
  plan: number;
  fact: number;
}

/** Plan vs fact for one day (spec 2026-10-01). Every count is a JSON int. */
export interface IDailyProgressDay {
  date: string;
  day_of_week: number;
  rows: IDailyProgressRow[];
  plan_total: number;
  export_parts: number;
  export_parts_packed: number;
  packed: number;
  /** max(plan_total, export_parts) — what the loading department must pack. */
  loading_target: number;
}

/** GET /export/truck-allocations/daily-progress/ — Mon–Sat of `date`'s ISO week. */
export interface IDailyProgress {
  /** The day asked for, or the server's local today when none was sent. */
  date: string;
  days: IDailyProgressDay[];
}
```

Inside `ITaskListItem`, after `cancelled_reason: string;`:

```ts
  /** Plan vs fact for an open daily_loading / daily_export task; null otherwise. */
  progress?: IDailyProgressDay | null;
```

- [ ] **Step 2: Add the hook**

Create `frontend/src/hooks/useDailyProgress.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import { useSelectedSeason } from '@/hooks/useSeasonParam';
import type { IDailyProgress } from '@/types';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

/**
 * Plan vs fact for Mon–Sat of a day's ISO week (spec 2026-10-01).
 * Without `date` the server picks its own local today — users sit in KZ/RU,
 * so the browser's day can differ. Counts are JSON ints: no coercion.
 */
export function useDailyProgress(date?: string) {
  const { seasonId, isReady } = useSelectedSeason();
  return useQuery<IDailyProgress>({
    queryKey: ['daily-progress', date ?? 'today', seasonId],
    queryFn: async () => {
      if (USE_MOCK) return { date: date ?? '', days: [] };
      const params = new URLSearchParams();
      if (date) params.set('date', date);
      if (seasonId != null) params.set('season', String(seasonId));
      const { data } = await api.get<IDailyProgress>(`/export/truck-allocations/daily-progress/?${params}`);
      return data;
    },
    enabled: USE_MOCK || isReady,
    staleTime: 30_000,
  });
}
```

- [ ] **Step 3: Add the i18n keys**

In each locale's `tasks` object, add:

| key | en | ru | tk |
|---|---|---|---|
| `progress_packing` | `packing {{done}}/{{total}}` | `упаковка {{done}}/{{total}}` | `gaplama {{done}}/{{total}}` |
| `progress_packed` | `Packed {{done}} of {{total}}` | `Упаковано {{done}} из {{total}}` | `Gaplandy {{done}} / {{total}}` |

In each locale's `task_rules` object, replace the two values:

| key | en | ru | tk |
|---|---|---|---|
| `kind_daily_loading_completes` | `Trucks packed for today reach the larger of the day's planned trucks and the export parts opened, and at least one.` | `Упаковок на сегодня не меньше большего из двух: план машин на день или открытые экспортные части (и хотя бы одна).` | `Şu güne gaplanan maşynlar günüň plan maşynlaryndan ýa-da açylan eksport böleklerinden (haýsysy köp bolsa) az däl, iň azyndan bir.` |
| `kind_daily_export_completes` | `For every country and Gapy in today's truck plan, export parts ≥ plan, every export part of today has packing, and there is at least one export part.` | `По каждой стране и Gapy в плане машин на сегодня факт ≥ плана, у каждой экспортной части на сегодня есть упаковка (и хотя бы одна экспортная часть).` | `Şu günüň maşyn planyndaky her ýurt we Gapy üçin fakt ≥ plan, şu günüň her eksport böleginiň gaplamasy bar, iň azyndan bir eksport bölegi.` |

- [ ] **Step 4: Write the failing card tests**

Append to `frontend/src/components/me/PlanTaskCard.test.tsx` inside `describe('PlanTaskCard', …)`:

```tsx
  const day = {
    date: '2026-09-28', day_of_week: 1,
    rows: [
      { key: 'country:3', label: 'Russia', country_id: 3, is_gapy: false, plan: 4, fact: 3 },
      { key: 'gapy', label: 'Gapy Satys', country_id: null, is_gapy: true, plan: 1, fact: 1 },
    ],
    plan_total: 5, export_parts: 4, export_parts_packed: 3, packed: 3, loading_target: 6,
  };

  it('shows plan vs fact per row and the packing count on an export task', () => {
    renderCard(task({ progress: day }));
    expect(screen.getByText('Russia 3/4 · Gapy Satys 1/1 · packing 3/4')).toBeInTheDocument();
  });

  it('shows packed of target on a loading task', () => {
    renderCard(task({ kind: 'daily_loading', title_key: 'tasks.daily_loading_plan', progress: day }));
    expect(screen.getByText('Packed 3 of 6')).toBeInTheDocument();
  });

  it('shows no progress line on a done task', () => {
    renderCard(task({ state: 'done', progress: day }));
    expect(screen.queryByTestId('plan-task-progress')).not.toBeInTheDocument();
  });
```

- [ ] **Step 5: Run the card tests and confirm the new ones fail**

Run: `cd frontend && npx vitest run src/components/me/PlanTaskCard.test.tsx`
Expected: the 2 new text tests FAIL ("Unable to find an element with the text").

- [ ] **Step 6: Add the formatting helpers**

Create `frontend/src/components/me/planTaskProgress.ts`:

```ts
import type { TFunction } from 'i18next';
import type { IDailyProgressDay } from '@/types';

/** daily_export card line: «Russia 3/4 · Gapy Satys 1/1 · packing 3/4». */
export function exportProgressLine(day: IDailyProgressDay, t: TFunction): string {
  const rows = day.rows.map((r) => `${r.label} ${r.fact}/${r.plan}`);
  const packing = t('tasks.progress_packing', { done: day.export_parts_packed, total: day.export_parts });
  return [...rows, packing].join(' · ');
}

/** daily_loading card line: «Packed 3 of 6». */
export function loadingProgressLine(day: IDailyProgressDay, t: TFunction): string {
  return t('tasks.progress_packed', { done: day.packed, total: day.loading_target });
}
```

- [ ] **Step 7: Render the line on the card**

In `frontend/src/components/me/PlanTaskCard.tsx`, add the import:

```tsx
import { exportProgressLine, loadingProgressLine } from './planTaskProgress';
```

Insert between "Row 2" and "Row 3: deadline":

```tsx
      {/* Row 2b: plan vs fact (open daily tasks only) */}
      {!isDone && task.progress && (
        <div style={{ marginTop: 4 }} data-testid="plan-task-progress">
          <Text style={{ fontSize: 11 }}>
            {task.kind === 'daily_loading'
              ? loadingProgressLine(task.progress, t)
              : exportProgressLine(task.progress, t)}
          </Text>
        </div>
      )}
```

- [ ] **Step 8: Run the tests and the type-check**

Run: `cd frontend && npx vitest run src/components/me/PlanTaskCard.test.tsx && npx tsc --noEmit --ignoreDeprecations 5.0`
Expected: all PlanTaskCard tests PASS, tsc exits 0.

- [ ] **Step 9: Commit**

```bash
git status
git add frontend/src/types/index.ts frontend/src/hooks/useDailyProgress.ts \
  frontend/src/components/me/planTaskProgress.ts frontend/src/components/me/PlanTaskCard.tsx \
  frontend/src/components/me/PlanTaskCard.test.tsx \
  frontend/src/i18n/tk.json frontend/src/i18n/ru.json frontend/src/i18n/en.json
git diff --cached --name-only
git commit -m "feat(frontend): daily task cards show plan vs fact

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Plan strip on `/export/assign` (today, «+», week)

**Files:**
- Create: `frontend/src/pages/export/assignment/DailyPlanStrip.tsx`
- Create: `frontend/src/pages/export/assignment/DailyPlanStrip.test.tsx`
- Modify: `frontend/src/hooks/useDrafts.ts` (add `useCreateExportPart` after `useCreateEmptyColumn`, ~line 328)
- Modify: `frontend/src/pages/export/AssignmentBoard.tsx`
- Modify: `frontend/src/i18n/tk.json`, `ru.json`, `en.json` (`assign.*`)

**Interfaces:**
- Consumes: `useDailyProgress()` and the types from Task 3; `tasks.progress_packing`; the `is_gapy_satys` create field from Task 2.
- Produces: `DailyPlanStrip({ canCreate: boolean })`; `useCreateExportPart()` → mutation taking `{ country?: number | null; isGapy?: boolean }` and returning `IShipmentDraft`.

- [ ] **Step 1: Add the i18n keys**

In each locale's `assign` object:

| key | en | ru | tk |
|---|---|---|---|
| `today_plan` | `Today` | `Сегодня` | `Şu gün` |
| `week_plan` | `Week` | `Неделя` | `Hepde` |
| `no_plan_today` | `No truck plan for today` | `На сегодня плана машин нет` | `Şu güne maşyn plany ýok` |
| `add_export_part` | `Open export part` | `Открыть экспортную часть` | `Eksport bölegini aç` |
| `add_export_part_failed` | `Could not open the export part` | `Не удалось открыть экспортную часть` | `Eksport bölegini açyp bolmady` |

- [ ] **Step 2: Write the failing strip tests**

Create `frontend/src/pages/export/assignment/DailyPlanStrip.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useDailyProgress } from '@/hooks/useDailyProgress';
import { DailyPlanStrip } from './DailyPlanStrip';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('@/hooks/useDailyProgress', () => ({ useDailyProgress: vi.fn() }));
const mutate = vi.fn();
vi.mock('@/hooks/useDrafts', () => ({ useCreateExportPart: () => ({ mutate, isPending: false }) }));
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

const WEEK = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'];

function day(date: string, rows = [] as object[]) {
  return { date, day_of_week: 1, rows, plan_total: 0, export_parts: 4, export_parts_packed: 3,
    packed: 3, loading_target: 4 };
}

const ROWS = [
  { key: 'country:3', label: 'Russia', country_id: 3, is_gapy: false, plan: 4, fact: 3 },
  { key: 'gapy', label: 'Gapy Satys', country_id: null, is_gapy: true, plan: 1, fact: 1 },
];

function withData(today = '2026-09-28') {
  vi.mocked(useDailyProgress).mockReturnValue({
    data: { date: today, days: WEEK.map((d) => day(d, d === '2026-09-28' ? ROWS : [])) },
  } as unknown as ReturnType<typeof useDailyProgress>);
}

describe('DailyPlanStrip', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows each plan row as fact/plan and the packing count', () => {
    withData();
    render(<DailyPlanStrip canCreate />);
    expect(screen.getByText('Russia 3/4')).toBeInTheDocument();
    expect(screen.getByText('Gapy Satys 1/1')).toBeInTheDocument();
    expect(screen.getByText('tasks.progress_packing')).toBeInTheDocument();
  });

  it('«+» on a country row creates with that country and opens the new part', () => {
    withData();
    render(<DailyPlanStrip canCreate />);
    fireEvent.click(screen.getByRole('button', { name: 'assign.add_export_part: Russia' }));
    expect(mutate.mock.calls[0][0]).toEqual({ country: 3 });
    mutate.mock.calls[0][1].onSuccess({ id: 77 });
    expect(navigate).toHaveBeenCalledWith('/shipments/77');
  });

  it('«+» on the Gapy row creates a gapy part without a country', () => {
    withData();
    render(<DailyPlanStrip canCreate />);
    fireEvent.click(screen.getByRole('button', { name: 'assign.add_export_part: Gapy Satys' }));
    expect(mutate.mock.calls[0][0]).toEqual({ isGapy: true });
  });

  it('hides «+» without the create right', () => {
    withData();
    render(<DailyPlanStrip canCreate={false} />);
    expect(screen.queryByRole('button', { name: /assign.add_export_part/ })).not.toBeInTheDocument();
  });

  it('opens a Mon–Sat week table', () => {
    withData();
    render(<DailyPlanStrip canCreate />);
    fireEvent.click(screen.getByRole('button', { name: 'assign.week_plan' }));
    expect(screen.getByTestId('plan-week').querySelectorAll('thead th')).toHaveLength(7);
  });

  it('renders nothing on a day outside Mon–Sat (Sunday) or without data', () => {
    withData('2026-10-04');
    const { container } = render(<DailyPlanStrip canCreate />);
    expect(container).toBeEmptyDOMElement();
    vi.mocked(useDailyProgress).mockReturnValue({ data: undefined } as unknown as ReturnType<typeof useDailyProgress>);
    const second = render(<DailyPlanStrip canCreate />);
    expect(second.container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `cd frontend && npx vitest run src/pages/export/assignment/DailyPlanStrip.test.tsx`
Expected: FAIL. `Failed to resolve import "./DailyPlanStrip"`.

- [ ] **Step 4: Add `useCreateExportPart`**

In `frontend/src/hooks/useDrafts.ts`, after `useCreateEmptyColumn`:

```ts
// ─── useCreateExportPart ──────────────────────────────────────────────────

/**
 * «+» on the /export/assign plan strip (spec 2026-10-01): an export part for
 * today carrying the plan row's country, or the Gapy flag. No `date` — the
 * server stamps its own local today. The caller opens the new row's page.
 */
export function useCreateExportPart() {
  const queryClient = useQueryClient();
  const idem = useIdempotencyKey();

  return useMutation({
    mutationFn: async ({ country, isGapy }: { country?: number | null; isGapy?: boolean }): Promise<IShipmentDraft> => {
      const body: Record<string, unknown> = { is_draft: true };
      if (country != null) body.country = country;
      if (isGapy) body.is_gapy_satys = true;
      const { data } = await api.post<IShipmentDraft>('/export/shipments/', body, {
        headers: { [IDEMPOTENCY_HEADER]: idem.key },
      });
      return data;
    },
    onSuccess: () => {
      idem.reset();
      queryClient.invalidateQueries({ queryKey: ['drafts'] });
      queryClient.invalidateQueries({ queryKey: ['shipments'] });
      queryClient.invalidateQueries({ queryKey: ['daily-progress'] });
    },
  });
}
```

- [ ] **Step 5: Write the strip**

Create `frontend/src/pages/export/assignment/DailyPlanStrip.tsx`:

```tsx
import { useState } from 'react';
import { Button, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useDailyProgress } from '@/hooks/useDailyProgress';
import { useCreateExportPart } from '@/hooks/useDrafts';
import { extractPatchError } from '@/hooks/useShipmentPatch';
import { COLORS } from '@/constants/styles';
import type { IDailyProgressDay, IDailyProgressRow } from '@/types';

const { Text } = Typography;

interface IDailyPlanStripProps {
  /** shipment.create is held and the season is writable. */
  readonly canCreate: boolean;
}

/**
 * Top of /export/assign (spec 2026-10-01): today's truck plan against the
 * export parts opened, «+» per plan row, and the Mon–Sat week on demand.
 * "Today" is the server's day (response `date`), not the browser's.
 */
export function DailyPlanStrip({ canCreate }: IDailyPlanStripProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data } = useDailyProgress();
  const createPart = useCreateExportPart();
  const [showWeek, setShowWeek] = useState(false);

  const today = data?.days?.find((d) => d.date === data.date);
  if (!data || !today) return null;

  function add(row: IDailyProgressRow) {
    createPart.mutate(row.is_gapy ? { isGapy: true } : { country: row.country_id }, {
      onSuccess: (part) => navigate(`/shipments/${part.id}`),
      onError: (err) => toast.error(extractPatchError(err, t('assign.add_export_part_failed'))),
    });
  }

  return (
    <div style={{ background: COLORS.white, border: '1px solid #f0f0f0', borderRadius: 8,
      padding: '10px 14px', marginBottom: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        <Text strong>{t('assign.today_plan')}:</Text>
        {today.rows.length === 0 && <Text type="secondary">{t('assign.no_plan_today')}</Text>}
        {today.rows.map((row) => (
          <span key={row.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Text style={{ color: row.fact >= row.plan ? COLORS.success : undefined }}>
              {`${row.label} ${row.fact}/${row.plan}`}
            </Text>
            {canCreate && (
              <Button
                size="small"
                icon={<PlusOutlined />}
                aria-label={`${t('assign.add_export_part')}: ${row.label}`}
                disabled={createPart.isPending}
                onClick={() => add(row)}
              />
            )}
          </span>
        ))}
        <Text type="secondary">
          {t('tasks.progress_packing', { done: today.export_parts_packed, total: today.export_parts })}
        </Text>
        <Button type="link" size="small" onClick={() => setShowWeek((v) => !v)}>
          {t('assign.week_plan')}
        </Button>
      </div>
      {showWeek && <WeekTable days={data.days} todayDate={data.date} />}
    </div>
  );
}

function WeekTable({ days, todayDate }: { readonly days: IDailyProgressDay[]; readonly todayDate: string }) {
  const labels = new Map<string, string>();
  for (const d of days) for (const r of d.rows) if (!labels.has(r.key)) labels.set(r.key, r.label);
  const shade = (date: string) => (date === todayDate ? COLORS.bgLayout : undefined);
  const cell = (d: IDailyProgressDay, key: string) => {
    const r = d.rows.find((x) => x.key === key);
    return r ? `${r.fact}/${r.plan}` : '—';
  };

  return (
    <div style={{ overflowX: 'auto', marginTop: 10 }}>
      <table data-testid="plan-week" style={{ borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th />
            {days.map((d) => (
              <th key={d.date} style={{ padding: '2px 8px', background: shade(d.date) }}>
                {dayjs(d.date).format('DD.MM')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...labels].map(([key, label]) => (
            <tr key={key}>
              <td style={{ paddingRight: 8 }}>{label}</td>
              {days.map((d) => (
                <td key={d.date} style={{ padding: '2px 8px', textAlign: 'center', background: shade(d.date) }}>
                  {cell(d, key)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 6: Mount the strip on the board**

In `frontend/src/pages/export/AssignmentBoard.tsx`:

```tsx
import { canDoBackendGated } from '@/utils/permissions';
import { DailyPlanStrip } from './assignment/DailyPlanStrip';
```

After `const canAct = …`:

```tsx
  const canCreate = canDoBackendGated(user, 'shipment', 'create') && !isReadOnly;
```

Directly after the title `<div style={{ marginBottom: 16 }}>…</div>` block:

```tsx
      <DailyPlanStrip canCreate={canCreate} />
```

- [ ] **Step 7: Run the tests and the type-check**

Run: `cd frontend && npx vitest run src/pages/export/assignment && npx tsc --noEmit --ignoreDeprecations 5.0`
Expected: the DailyPlanStrip tests and the existing assignment tests PASS, tsc exits 0.

- [ ] **Step 8: Commit**

```bash
git status
git add frontend/src/pages/export/assignment/DailyPlanStrip.tsx \
  frontend/src/pages/export/assignment/DailyPlanStrip.test.tsx \
  frontend/src/hooks/useDrafts.ts frontend/src/pages/export/AssignmentBoard.tsx \
  frontend/src/i18n/tk.json frontend/src/i18n/ru.json frontend/src/i18n/en.json
git diff --cached --name-only
git commit -m "feat(frontend): truck plan strip on the assignment board

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Plan strip in Gaplama's day view

**Files:**
- Create: `frontend/src/pages/sera/GaplamaPlanStrip.tsx`
- Create: `frontend/src/pages/sera/GaplamaPlanStrip.test.tsx`
- Modify: `frontend/src/pages/sera/GaplamaTab.tsx` (compute `availableOnDay`; render under the formula hint, ~line 397)
- Modify: `frontend/src/pages/sera/sera.css` (two rules next to `.sera-gaplama-formula`, ~line 837)
- Modify: `frontend/src/i18n/tk.json`, `ru.json`, `en.json` (`tir_takip.gaplama.*`)

**Interfaces:**
- Consumes: `useDailyProgress(date)` from Task 3; board `days[].available_kg` (already a number from `useGaplamaBoard`); `truckCapacityKg` already computed in `GaplamaTab`.
- Produces: `GaplamaPlanStrip({ day, availableKg, truckCapacityKg })`; `stockShortfall({ packed, loadingTarget, availableKg, capacityKg }) → { remaining, stockTrucks, shortfall }`.

- [ ] **Step 1: Add the i18n keys**

In each locale's `tir_takip.gaplama` object:

| key | en | ru | tk |
|---|---|---|---|
| `plan_packed` | `Packed {{done}} of {{total}}` | `Упаковано {{done}} из {{total}}` | `Gaplandy {{done}} / {{total}}` |
| `plan_stock` | `stock for {{count}} more trucks` | `на складе ещё на {{count}} машин` | `ammarda ýene {{count}} maşynlyk` |
| `plan_short` | `{{count}} trucks short` | `не хватает на {{count}} машин` | `{{count}} maşyn ýetmeýär` |

- [ ] **Step 2: Write the failing tests**

Create `frontend/src/pages/sera/GaplamaPlanStrip.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useDailyProgress } from '@/hooks/useDailyProgress';
import { GaplamaPlanStrip, stockShortfall } from './GaplamaPlanStrip';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
}));
vi.mock('@/hooks/useDailyProgress', () => ({ useDailyProgress: vi.fn() }));

function withDay(packed: number, loadingTarget: number) {
  vi.mocked(useDailyProgress).mockReturnValue({
    data: { date: '2026-09-28', days: [{ date: '2026-09-28', day_of_week: 1, rows: [], plan_total: loadingTarget,
      export_parts: 0, export_parts_packed: 0, packed, loading_target: loadingTarget }] },
  } as unknown as ReturnType<typeof useDailyProgress>);
}

describe('stockShortfall', () => {
  it('compares what is left to pack with whole trucks in stock', () => {
    expect(stockShortfall({ packed: 3, loadingTarget: 6, availableKg: 37000, capacityKg: 18500 }))
      .toEqual({ remaining: 3, stockTrucks: 2, shortfall: 1 });
  });

  it('never goes negative when packing is ahead of the target', () => {
    expect(stockShortfall({ packed: 7, loadingTarget: 6, availableKg: 0, capacityKg: 18500 }))
      .toEqual({ remaining: 0, stockTrucks: 0, shortfall: 0 });
  });
});

describe('GaplamaPlanStrip', () => {
  it('shows packed of target, the stock and the shortfall', () => {
    withDay(3, 6);
    render(<GaplamaPlanStrip day="2026-09-28" availableKg={37000} truckCapacityKg={18500} />);
    expect(screen.getByText('tir_takip.gaplama.plan_packed:{"done":3,"total":6}')).toBeInTheDocument();
    expect(screen.getByText(/tir_takip.gaplama.plan_stock:\{"count":2\}/)).toBeInTheDocument();
    expect(screen.getByText(/tir_takip.gaplama.plan_short:\{"count":1\}/)).toBeInTheDocument();
  });

  it('hides the shortfall when stock covers what is left', () => {
    withDay(5, 6);
    render(<GaplamaPlanStrip day="2026-09-28" availableKg={18500} truckCapacityKg={18500} />);
    expect(screen.queryByText(/plan_short/)).not.toBeInTheDocument();
  });

  it('renders nothing when the day is not in the response', () => {
    withDay(1, 1);
    const { container } = render(<GaplamaPlanStrip day="2026-10-04" availableKg={0} truckCapacityKg={18500} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `cd frontend && npx vitest run src/pages/sera/GaplamaPlanStrip.test.tsx`
Expected: FAIL. `Failed to resolve import "./GaplamaPlanStrip"`.

- [ ] **Step 4: Write the strip**

Create `frontend/src/pages/sera/GaplamaPlanStrip.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { useDailyProgress } from '@/hooks/useDailyProgress';

interface IStockInput {
  readonly packed: number;
  readonly loadingTarget: number;
  /** Σ available_kg of the day — already net of trucks loaded that day. */
  readonly availableKg: number;
  readonly capacityKg: number;
}

/** Trucks the day still needs vs whole trucks the stock can still fill. */
export function stockShortfall({ packed, loadingTarget, availableKg, capacityKg }: IStockInput) {
  const remaining = Math.max(0, loadingTarget - packed);
  const stockTrucks = capacityKg > 0 ? Math.floor(availableKg / capacityKg) : 0;
  return { remaining, stockTrucks, shortfall: Math.max(0, remaining - stockTrucks) };
}

interface IGaplamaPlanStripProps {
  /** The board's selected day (YYYY-MM-DD). */
  readonly day: string;
  readonly availableKg: number;
  readonly truckCapacityKg: number;
}

/** Gaplama day view (spec 2026-10-01): packed vs the loading target, and whether stock covers the rest. */
export function GaplamaPlanStrip({ day, availableKg, truckCapacityKg }: IGaplamaPlanStripProps) {
  const { t } = useTranslation();
  const { data } = useDailyProgress(day);
  const progress = data?.days?.find((d) => d.date === day);
  if (!progress) return null;

  const { stockTrucks, shortfall } = stockShortfall({
    packed: progress.packed,
    loadingTarget: progress.loading_target,
    availableKg,
    capacityKg: truckCapacityKg,
  });

  return (
    <div className="sera-gaplama-plan-strip" data-testid="gaplama-plan-strip">
      <span>{t('tir_takip.gaplama.plan_packed', { done: progress.packed, total: progress.loading_target })}</span>
      <span>{` · ${t('tir_takip.gaplama.plan_stock', { count: stockTrucks })}`}</span>
      {shortfall > 0 && (
        <span className="sera-gaplama-plan-short">
          {` · ${t('tir_takip.gaplama.plan_short', { count: shortfall })}`}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Mount it in `GaplamaTab`**

In `frontend/src/pages/sera/GaplamaTab.tsx`, add the import:

```tsx
import { GaplamaPlanStrip } from './GaplamaPlanStrip';
```

After the line `const { data: board, isLoading, isError, dataUpdatedAt } = useGaplamaBoard(fetchFrom, fetchTo);` add:

```tsx
  // The plan strip's stock: every block's available kg on the selected day,
  // ignoring the location/block filters (stock is the whole greenhouse's).
  const availableOnDay = (board?.days ?? [])
    .filter((r) => r.date === selectedDay)
    .reduce((sum, r) => sum + r.available_kg, 0);
```

Directly after the `<div className="sera-gaplama-formula">…</div>` element:

```tsx
      {mode === 'day' && board && (
        <GaplamaPlanStrip day={selectedDay} availableKg={availableOnDay} truckCapacityKg={truckCapacityKg} />
      )}
```

- [ ] **Step 6: Add the CSS**

In `frontend/src/pages/sera/sera.css`, after the `.sera-page .sera-gaplama-formula { … }` rule:

```css
/* Plan strip (spec 2026-10-01) — packed vs target, stock, shortfall. */
.sera-page .sera-gaplama-plan-strip {
  margin-bottom: 8px;
  font-size: 13px;
}

/* Same red as .sera-gaplama-cell-over. */
.sera-page .sera-gaplama-plan-short {
  color: #dc2626;
  font-weight: 600;
}
```

- [ ] **Step 7: Run the new and existing Gaplama tests and the type-check**

Run: `cd frontend && npx vitest run src/pages/sera && npx tsc --noEmit --ignoreDeprecations 5.0`
Expected: all PASS, tsc exits 0. `GaplamaTab.test.tsx`'s `api.get` fallback returns `{ data: {} }` for the new URL, so the strip renders nothing there and the old assertions are unaffected.

- [ ] **Step 8: Commit**

```bash
git status
git add frontend/src/pages/sera/GaplamaPlanStrip.tsx frontend/src/pages/sera/GaplamaPlanStrip.test.tsx \
  frontend/src/pages/sera/GaplamaTab.tsx frontend/src/pages/sera/sera.css \
  frontend/src/i18n/tk.json frontend/src/i18n/ru.json frontend/src/i18n/en.json
git diff --cached --name-only
git commit -m "feat(frontend): Gaplama day view shows packed vs target and stock shortfall

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Docs, contract, changelog, test log

**Files:**
- Modify: `.claude/skills/api-contract/SKILL.md`
- Modify: `docs/obsidian/processes/truck-allocation.md`, `docs/obsidian/reference/task.md`, `docs/obsidian/screens/gaplama.md`, `docs/obsidian/processes/assignment-board.md`
- Modify: `docs/superpowers/specs/2026-10-01-daily-plan-progress-tasks-design.md` (route fix), `docs/superpowers/specs/2026-09-29-planning-tasks-design.md` (superseded note)
- Modify: `CHANGELOG.md`, `BUILD_TEST_LOG.md`

- [ ] **Step 1: API contract**

In `.claude/skills/api-contract/SKILL.md`, after the "Planning tasks: review, transport plan, acknowledge" section's last paragraph (the `scope_date` / `cancelled_reason` one), add:

````markdown
### Daily plan progress (2026-10-01)

`GET /api/v1/export/truck-allocations/daily-progress/?date=YYYY-MM-DD[&season=]` — plan vs fact
for Mon–Sat of `date`'s ISO week. Spec: `docs/superpowers/specs/2026-10-01-daily-plan-progress-tasks-design.md`.
Gate: `truck_allocation.can_view`. No `date` → the **server's** local today. Malformed →
`400 {"error": "date must be YYYY-MM-DD."}`. **Season-scoped** (unlike `review` / `transport-plan`,
because it counts shipments): `?season=` per `resolve_season`, `days: []` during the gap. Every count
is a JSON int.

```json
{ "date": "2026-10-01",
  "days": [ { "date": "2026-09-28", "day_of_week": 1,
    "rows": [ { "key": "country:3", "label": "Moskwa + Piter", "country_id": 3, "is_gapy": false, "plan": 4, "fact": 3 },
              { "key": "gapy", "label": "Gapy Satys", "country_id": null, "is_gapy": true, "plan": 1, "fact": 1 } ],
    "plan_total": 5, "export_parts": 4, "export_parts_packed": 3, "packed": 3, "loading_target": 5 } ] }
```

- Rows: the day's splits grouped by country (labels joined with « + »); destinations with no country
  form the `gapy` row, matched by `is_gapy_satys`. A country exported but not planned → `plan: 0`,
  label = `Country.name_en`.
- `fact` = live shipments dated that day with country + customer (gapy row: `is_gapy_satys=true`;
  country rows: `false`). `packed` = live rows with `block_sources`, free or joined.
  `loading_target` = `max(plan_total, export_parts)`.

`/me/tasks/` items gain `progress` — the same day object for an **open** `daily_export` /
`daily_loading` task, `null` otherwise. `POST /export/shipments/` (draft path) accepts
`is_gapy_satys` (bool, default `false`).
````

- [ ] **Step 2: Obsidian**

`docs/obsidian/processes/truck-allocation.md`: add a section before "## Roles & Permissions":

```markdown
## Daily tasks follow the plan (2026-10-01)

Spec `docs/superpowers/specs/2026-10-01-daily-plan-progress-tasks-design.md`. Service
`backend/apps/export/services/daily_progress.py` compares a day's splits with that day's shipments
(rows by country; `country=NULL` destinations = the Gapy row ↔ `is_gapy_satys`).
- `daily_export` («Eksport planla», export_manager, link `/export/assign`) closes when every row has
  fact ≥ plan, every export part has packing, and there is ≥1 export part. The export manager joins.
- `daily_loading` («Ýük planla», loading) closes when packed trucks ≥ max(plan, export parts), ≥1.
- Editing today's allocation is allowed (and reopens transport's «Tanyşdym» for that day).
- Endpoint `GET /export/truck-allocations/daily-progress/`; strips on [[assignment-board]] and
  [[../screens/gaplama|Gaplama]]; task cards show the same numbers.
```

`docs/obsidian/reference/task.md`: replace the last cell of the two rows:
- `daily_loading`: `packed trucks dated that day ≥ max(planned trucks, export parts) and ≥1 — services/daily_progress.py (2026-10-01)`
- `daily_export`: `every plan row (country / Gapy) fact ≥ plan, every export part has packing, ≥1 part; link /export/assign (2026-10-01)`

`docs/obsidian/processes/assignment-board.md`: add a section:

```markdown
## Plan strip (2026-10-01)

`assignment/DailyPlanStrip.tsx` above the columns: «Today: <row> fact/plan [+] … · packing n/m»
from `GET /export/truck-allocations/daily-progress/` (server's today), «Week» toggles a Mon–Sat ×
row table. «+» (needs `shipment.create`, writable season) creates an export part for today with the
row's country — or `is_gapy_satys=true` on the Gapy row — and opens `/shipments/{id}`.
```

`docs/obsidian/screens/gaplama.md`: add a section:

```markdown
## Plan strip (2026-10-01)

Day view only, under the formula hint: «Packed X of Y · stock for N more trucks», plus red
«K trucks short» when what is left to pack (`loading_target − packed`) exceeds
`⌊Σ available_kg of the day / truck_capacity_kg⌋`. Stock ignores the location/block filters.
`GaplamaPlanStrip.tsx`, data from `GET /export/truck-allocations/daily-progress/?date=<selected day>`.
Shows in both entry points (Tır Takip tab and `/export/gaplama`).
```

- [ ] **Step 3: Spec fixes**

In `docs/superpowers/specs/2026-10-01-daily-plan-progress-tasks-design.md`, replace both occurrences of `` `/export/shipments/{id}` `` with `` `/shipments/{id}` ``.

In the same spec, add to the end of "## Known effects":

```markdown
- Beta runs the old code on the same DB: until it is redeployed, its `/me/tasks/` polls close daily tasks on the first truck and its 06:05 beat creates `daily_export` with `/export/drafts`. Deploy together and rebuild `celery-worker` + `celery-beat`.
```

In `docs/superpowers/specs/2026-09-29-planning-tasks-design.md`, directly under the table row of item 5a (line ~57), add:

```markdown
> **2026-10-01:** the "done" rules of 4 and 5a are replaced by `2026-10-01-daily-plan-progress-tasks-design.md` (plan-driven); 5a's link is now `/export/assign`.
```

- [ ] **Step 4: CHANGELOG and test log**

`CHANGELOG.md`, top of `### Added` under `[Unreleased]`:

```markdown
- **Daily tasks follow the truck plan (feat(p3), feat(frontend)).** «Eksport planla» now closes when every country / Gapy in today's truck allocation has enough export parts and each has packing (the export manager joins); «Ýük planla» when packed trucks reach max(plan, export parts). Cards show «Russia 3/4 · Gapy 1/1 · packing 3/4» / «Packed 3 of 6»; `/export/assign` gets a «Today» strip with «+» per row and a Mon–Sat week; Gaplama's day view shows packed vs target, stock and the shortfall. New `GET /export/truck-allocations/daily-progress/` (season-scoped, server's today), `progress` on `/me/tasks/`, `is_gapy_satys` on draft create. No migration. **Deploy:** beta shares the DB and closes these tasks by the old rule until redeployed — deploy, then rebuild `celery-worker` + `celery-beat` (the 06:05 `run_daily_plan_tasks` runs there). Spec: `docs/superpowers/specs/2026-10-01-daily-plan-progress-tasks-design.md`.
```

`BUILD_TEST_LOG.md`, at the very top:

```markdown
- [ ] 2026-10-01 — Дневные задачи по плану машин: «Eksport planla» закрывается по плану truck allocation + упаковка у каждой экспортной части; «Ýük planla» — упаковок ≥ max(план, экспортные части); полоса «Сегодня» с «+» и неделей на /export/assign; полоса склада в Gaplama — NEEDS TEST
  To test: (0) пока beta не обновлён, он работает по старому правилу на той же БД и может сам закрыть задачи первой машиной — проверять после деплоя на beta или на свежем дне; (1) /export/plan → на сегодня поставить RU 2, Gapy 1; (2) «Моя доска» export_manager → карточка «Eksport planla» показывает «… 0/2 · Gapy Satys 0/1 · упаковка 0/0»; (3) /export/assign → «+» у RU → открылась карточка отгрузки со страной → заполнить клиента → полоса RU 1/2; (4) Gaplama «+ Tır Aç» дважды → карточка loading «Упаковано 2 из 3», полоса Gaplama «на складе ещё на N машин», красное «не хватает», если склада мало; (5) присоединить упаковки к экспортным частям → после всех машин по плану обе задачи «выполнена»; (6) задача loading в Tır Takip-вкладке Gaplama — та же полоса.
```

- [ ] **Step 5: Commit**

```bash
git status
git add .claude/skills/api-contract/SKILL.md docs/obsidian/processes/truck-allocation.md \
  docs/obsidian/reference/task.md docs/obsidian/screens/gaplama.md docs/obsidian/processes/assignment-board.md \
  docs/superpowers/specs/2026-10-01-daily-plan-progress-tasks-design.md \
  docs/superpowers/specs/2026-09-29-planning-tasks-design.md CHANGELOG.md BUILD_TEST_LOG.md
git diff --cached --name-only
git commit -m "docs: changelog, test log, contract and vault for plan-driven daily tasks

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
