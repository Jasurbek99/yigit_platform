# Season Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin close an export season — freezing its data read-only and hiding it from every default view — open the next one, and let permitted users switch back to browse a closed season.

**Architecture:** `core.Season` gains `closed_at`/`closed_by`; state (`UPCOMING`/`ACTIVE`/`CLOSED`) is derived, not stored. A new `apps/core/seasons.py` splits the two jobs `is_active` currently conflates: `get_active_season()` (write target) and `resolve_season(request)` (read scope, from `?season=`). A `SeasonScopedMixin` applies the read filter so scoping is the default and opting out is the explicit act. Writes to a closed season are blocked at two layers — a DRF permission and a service-level guard inside `transition_to()`.

**Tech Stack:** Django 4.x + DRF, MSSQL via mssql-django, React 18 + TypeScript, TanStack Query, Zustand, Ant Design ProComponents, react-i18next.

**Spec:** `docs/superpowers/specs/2026-08-03-season-lifecycle-design.md` — read it before Task 1. Decisions D1–D6 in §1 are settled; do not relitigate them.

## Global Constraints

- **MSSQL**: no `JSONField`, no `ArrayField`, no `.distinct('field')`, `bulk_create`/`bulk_update` always `batch_size=500`. Full list: `.claude/rules/mssql-compat.md`.
- **Status transitions**: always through `Shipment.transition_to()` — never a direct `status_id` write.
- **Dependency direction**: `core ← greenhouse ← export ← contracts ← finance`. `core/` never imports from downstream apps. No Django signals — cross-app coordination is explicit service calls.
- **Cross-app FKs** use lazy string references: `models.ForeignKey('core.User', ...)`, never a direct import.
- **`models/` packages** must re-export in `__init__.py` or migrations silently break.
- **Reference FKs** use `on_delete=models.PROTECT`.
- **i18n**: every user-visible string exists in all three of `frontend/src/i18n/tk.json`, `ru.json`, `en.json`. Never add a key to one file only. Never use one language as a placeholder for another.
- **TypeScript**: no `any`, no `as` assertions, interfaces prefixed `I`, explicit return types on exported functions.
- **Never commit or push without an explicit instruction from the user.** The `git commit` steps in this plan are the instruction for this work only; **never `git push`.**
- **Co-author tag** on every commit must name the model actually in use.
- **After `makemigrations`, run `migrate` immediately** and confirm with `showmigrations`. Do not leave it for the user.
- Backend test command: `python manage.py test <label> --verbosity=2` from `backend/`.
- Frontend typecheck: `npx tsc --noEmit --ignoreDeprecations 5.0` from `frontend/` (`npm run type-check` is broken — TS5103).
- `docs/PRE_EXISTING_TEST_FAILURES.md` records failures that predate this work. Judge new failures against that baseline, not against zero.

---

# Phase 1 — Foundation (no behaviour change)

### Task 1: Season model gains a lifecycle

**Files:**
- Modify: `backend/apps/core/models/products.py:5-18`
- Modify: `database/ygt_platform_ddl_v5_1.sql`
- Create: `backend/apps/core/tests_seasons.py`
- Create: `backend/apps/core/migrations/00XX_season_lifecycle.py` (generated)

**Interfaces:**
- Consumes: nothing.
- Produces: `Season.closed_at: datetime | None`, `Season.closed_by: User | None`, `Season.status -> str` returning one of `'UPCOMING' | 'ACTIVE' | 'CLOSED'`, and the DB constraint `uq_season_single_active`.

- [ ] **Step 1: Write the failing test**

Create `backend/apps/core/tests_seasons.py`:

```python
"""Tests for the Season lifecycle (open / close / derived status).

Run with:
    python manage.py test apps.core.tests_seasons --verbosity=2
"""
from datetime import date

from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone

from apps.core.models import Season


class SeasonStatusTests(TestCase):
    def test_upcoming_when_not_active_and_not_closed(self):
        season = Season.objects.create(
            name='2027/2028', start_date=date(2027, 9, 1), end_date=date(2028, 8, 31),
            is_active=False,
        )
        self.assertEqual(season.status, 'UPCOMING')

    def test_active_when_is_active(self):
        season = Season.objects.create(
            name='2026/2027', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
            is_active=True,
        )
        self.assertEqual(season.status, 'ACTIVE')

    def test_closed_wins_over_active_flag(self):
        """closed_at is authoritative — a row can never read as ACTIVE once closed."""
        season = Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
            is_active=False, closed_at=timezone.now(),
        )
        self.assertEqual(season.status, 'CLOSED')


class SingleActiveSeasonTests(TestCase):
    def test_second_active_season_is_rejected(self):
        Season.objects.create(
            name='2026/2027', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
            is_active=True,
        )
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                Season.objects.create(
                    name='2027/2028', start_date=date(2027, 9, 1), end_date=date(2028, 8, 31),
                    is_active=True,
                )

    def test_many_inactive_seasons_are_allowed(self):
        Season.objects.create(
            name='2024/2025', start_date=date(2024, 9, 1), end_date=date(2025, 8, 31),
            is_active=False,
        )
        Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
            is_active=False,
        )
        self.assertEqual(Season.objects.filter(is_active=False).count(), 2)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test apps.core.tests_seasons --verbosity=2`
Expected: FAIL — `AttributeError: 'Season' object has no attribute 'status'`, and `test_second_active_season_is_rejected` fails because no `IntegrityError` is raised.

- [ ] **Step 3: Write minimal implementation**

Replace the `Season` class in `backend/apps/core/models/products.py`:

```python
from django.db import models

from apps.core.db_utils import schema_table


class Season(models.Model):
    """Export season (e.g. 2025-2026).

    State is derived from `is_active` + `closed_at`, never stored separately:

      UPCOMING  closed_at is NULL and is_active is False — created, not opened
      ACTIVE    is_active is True — the write target; exactly one at a time
      CLOSED    closed_at is not NULL — frozen and hidden

    `is_active` is the *write target* only. The *read scope* is resolved
    per-request by `apps.core.seasons.resolve_season()`.
    """

    STATUS_UPCOMING = 'UPCOMING'
    STATUS_ACTIVE = 'ACTIVE'
    STATUS_CLOSED = 'CLOSED'

    name = models.CharField(max_length=10, unique=True)
    start_date = models.DateField()
    end_date = models.DateField()
    is_active = models.BooleanField(default=False)

    # === Close lifecycle ===
    closed_at = models.DateTimeField(null=True, blank=True)
    closed_by = models.ForeignKey(
        'core.User',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='closed_seasons',
    )

    class Meta:
        db_table = schema_table('core', 'seasons')
        ordering = ['-start_date']
        constraints = [
            # Filtered unique index — at most one row may have is_active=True.
            # mssql-django emits this as a filtered index; the same pattern is
            # already in production (contracts/models/contract.py:155).
            models.UniqueConstraint(
                fields=['is_active'],
                condition=models.Q(is_active=True),
                name='uq_season_single_active',
            ),
        ]

    def __str__(self) -> str:
        return self.name

    @property
    def status(self) -> str:
        """Derived lifecycle state. `closed_at` is authoritative."""
        if self.closed_at is not None:
            return self.STATUS_CLOSED
        if self.is_active:
            return self.STATUS_ACTIVE
        return self.STATUS_UPCOMING

    @property
    def is_closed(self) -> bool:
        return self.closed_at is not None
```

- [ ] **Step 4: Generate and apply the migration**

```bash
cd backend
python manage.py makemigrations core
python manage.py migrate core
python manage.py showmigrations core | tail -5
```

Expected: the new migration appears with `[X]`. If `migrate` fails because existing data already has two `is_active=True` rows, fix the data first:

```bash
python manage.py shell -c "from apps.core.models import Season; qs=Season.objects.filter(is_active=True).order_by('-start_date'); [s.__class__.objects.filter(pk=s.pk).update(is_active=False) for s in qs[1:]]"
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python manage.py test apps.core.tests_seasons --verbosity=2`
Expected: PASS — 5 tests.

- [ ] **Step 6: Patch the DDL**

`database/ygt_platform_ddl_v5_1.sql` is the schema source of truth. Find the `core.seasons` table definition and append:

```sql
-- Season lifecycle (AD-16). closed_at is authoritative for CLOSED state.
ALTER TABLE core.seasons ADD closed_at DATETIME2 NULL;
ALTER TABLE core.seasons ADD closed_by_id INT NULL
    CONSTRAINT fk_seasons_closed_by REFERENCES core.users(id);

-- At most one active season. Filtered unique index.
CREATE UNIQUE INDEX uq_season_single_active
    ON core.seasons (is_active)
    WHERE is_active = 1;
```

- [ ] **Step 7: Commit**

```bash
git add backend/apps/core/models/products.py backend/apps/core/migrations/ backend/apps/core/tests_seasons.py database/ygt_platform_ddl_v5_1.sql
git commit -m "feat(core): add Season close lifecycle + single-active constraint"
```

---

### Task 2: `apps/core/seasons.py` — one home for season resolution

**Files:**
- Create: `backend/apps/core/seasons.py`
- Modify: `backend/apps/core/tests_seasons.py` (append)

**Interfaces:**
- Consumes: `Season.status`, `Season.is_closed` from Task 1.
- Produces:
  - `SeasonClosedError(Exception)` with `.season: Season`
  - `get_active_season() -> Season | None`
  - `resolve_season(request) -> Season | None` — raises `PermissionDenied` for a closed season without permission, `NotFound` for an unknown id
  - `can_view_closed(user) -> bool`
  - `assert_season_open(season: Season | None) -> None`
  - `SeasonScopedMixin` with class attr `season_field: str = 'season'` and method `apply_season_scope(qs) -> QuerySet`

- [ ] **Step 1: Write the failing test**

Append to `backend/apps/core/tests_seasons.py`:

```python
from types import SimpleNamespace

from rest_framework.exceptions import NotFound, PermissionDenied

from apps.core.models import RoleResourcePermission, User
from apps.core.seasons import (
    SeasonClosedError,
    assert_season_open,
    can_view_closed,
    get_active_season,
    resolve_season,
)


def _request(user, **params):
    """Minimal stand-in for a DRF request — resolve_season only reads these two."""
    return SimpleNamespace(user=user, query_params=params)


class SeasonResolutionTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.active = Season.objects.create(
            name='2026/2027', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
            is_active=True,
        )
        cls.closed = Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
            is_active=False, closed_at=timezone.now(),
        )
        cls.viewer = User.objects.create(username='viewer', role='export_manager')
        cls.operator = User.objects.create(username='operator', role='warehouse_chief')
        RoleResourcePermission.objects.create(
            role='export_manager', resource_code='closed_season', can_view=True,
        )

    def test_get_active_season_returns_the_active_row(self):
        self.assertEqual(get_active_season(), self.active)

    def test_get_active_season_returns_none_when_none_active(self):
        Season.objects.filter(pk=self.active.pk).update(is_active=False)
        self.assertIsNone(get_active_season())

    def test_resolve_defaults_to_active_when_no_param(self):
        self.assertEqual(resolve_season(_request(self.operator)), self.active)

    def test_resolve_honours_explicit_season_param(self):
        resolved = resolve_season(_request(self.viewer, season=str(self.active.pk)))
        self.assertEqual(resolved, self.active)

    def test_resolve_closed_season_allowed_with_permission(self):
        resolved = resolve_season(_request(self.viewer, season=str(self.closed.pk)))
        self.assertEqual(resolved, self.closed)

    def test_resolve_closed_season_denied_without_permission(self):
        with self.assertRaises(PermissionDenied):
            resolve_season(_request(self.operator, season=str(self.closed.pk)))

    def test_resolve_unknown_season_raises_not_found(self):
        with self.assertRaises(NotFound):
            resolve_season(_request(self.viewer, season='999999'))

    def test_resolve_ignores_blank_param(self):
        self.assertEqual(resolve_season(_request(self.operator, season='')), self.active)

    def test_can_view_closed_true_for_granted_role(self):
        self.assertTrue(can_view_closed(self.viewer))

    def test_can_view_closed_false_for_ungranted_role(self):
        self.assertFalse(can_view_closed(self.operator))

    def test_can_view_closed_true_for_superuser(self):
        su = User.objects.create(username='su', role='warehouse_chief', is_superuser=True)
        self.assertTrue(can_view_closed(su))


class AssertSeasonOpenTests(TestCase):
    def test_open_season_passes(self):
        season = Season.objects.create(
            name='2026/2027', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
            is_active=True,
        )
        assert_season_open(season)  # must not raise

    def test_none_passes(self):
        assert_season_open(None)  # must not raise

    def test_closed_season_raises(self):
        season = Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
            closed_at=timezone.now(),
        )
        with self.assertRaises(SeasonClosedError) as ctx:
            assert_season_open(season)
        self.assertEqual(ctx.exception.season, season)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test apps.core.tests_seasons --verbosity=2`
Expected: FAIL — `ModuleNotFoundError: No module named 'apps.core.seasons'`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/apps/core/seasons.py`:

```python
"""Season resolution — the single home for "which season?".

`Season.is_active` historically did two unrelated jobs: it named the *write
target* (which season new rows are stamped with) and it was used ad-hoc as the
*read scope* (which season an endpoint returns). Closing a season splits those:
the write target moves, but a user may still choose to read a past season.

    get_active_season()      → write target
    resolve_season(request)  → read scope

`core/` is upstream of every other app, so this is the only legal home for it.
"""
from django.db.models import QuerySet
from rest_framework.exceptions import NotFound, PermissionDenied

from apps.core.models import RoleResourcePermission, Season

CLOSED_SEASON_RESOURCE = 'closed_season'


class SeasonClosedError(Exception):
    """Raised when a write is attempted against a closed season."""

    def __init__(self, season: Season) -> None:
        self.season = season
        super().__init__(f'Season {season.name} is closed and read-only.')


def get_active_season() -> Season | None:
    """The write target.

    Deterministic without a tie-break: `uq_season_single_active` guarantees at
    most one row has is_active=True. Returns None between closing one season and
    opening the next, which is a legitimate end-of-season state.
    """
    return Season.objects.filter(is_active=True).first()


def can_view_closed(user) -> bool:
    """True if `user` may select a closed season.

    Backed by RoleResourcePermission(resource_code='closed_season').can_view so
    admins can grant it per role without a code change.
    """
    if not user or not getattr(user, 'is_authenticated', False):
        return False
    if getattr(user, 'is_superuser', False):
        return True
    role = getattr(user, 'role', None)
    if not role:
        return False
    return RoleResourcePermission.objects.filter(
        role=role, resource_code=CLOSED_SEASON_RESOURCE, can_view=True,
    ).exists()


def resolve_season(request) -> Season | None:
    """The read scope for this request.

    Reads ?season=<id>; falls back to the active season. A closed season is only
    resolvable by a user holding `closed_season.can_view`.

    Raises:
        NotFound: the requested season id does not exist.
        PermissionDenied: the season is closed and the user may not view it.

    PermissionDenied rather than an empty queryset is deliberate: an empty list
    for a season the user can see in the switcher reads as "this season has no
    data", which is a lie.
    """
    raw = (request.query_params.get('season') or '').strip()
    if not raw:
        return get_active_season()

    # int(), not raw.isdigit(): str.isdigit() is True for non-ASCII digit
    # characters like U+00B2 that int() rejects, so an isdigit() guard lets a
    # malformed id through to an unhandled ValueError — a 500, not a 404.
    try:
        season = Season.objects.filter(pk=int(raw)).first()
    except ValueError:
        season = None
    if season is None:
        raise NotFound(f'Season {raw} not found.')

    if season.is_closed and not can_view_closed(request.user):
        raise PermissionDenied('You do not have permission to view closed seasons.')

    return season


def assert_season_open(season: Season | None) -> None:
    """Guard for every write path. No-op when `season` is None or open."""
    if season is not None and season.is_closed:
        raise SeasonClosedError(season)


class SeasonScopedMixin:
    """Applies the resolved read scope to a viewset queryset.

    Scoping is the default and opting out is the explicit act — with ~20
    endpoints, a hand-written filter per viewset means the one that gets
    forgotten silently leaks closed-season data, which is precisely what this
    feature exists to prevent.

    Override `season_field` when the model reaches Season through a join:

        class TaskViewSet(SeasonScopedMixin, ModelViewSet):
            season_field = 'shipment__season'
    """

    season_field: str = 'season'

    def apply_season_scope(self, qs: QuerySet) -> QuerySet:
        season = resolve_season(self.request)
        if season is None:
            return qs
        return qs.filter(**{self.season_field: season})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python manage.py test apps.core.tests_seasons --verbosity=2`
Expected: PASS — 19 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/core/seasons.py backend/apps/core/tests_seasons.py
git commit -m "feat(core): add season resolution helpers + SeasonScopedMixin"
```

---

### Task 3: Replace the nine ad-hoc `is_active=True` lookups

**Files:**
- Modify: `backend/apps/export/services/shipment.py:576`
- Modify: `backend/apps/export/views.py:1029`, `:1762`, `:3083`, `:3207-3208`
- Modify: `backend/apps/export/services/dashboard_summary.py:34`
- Modify: `backend/apps/export/services/boss_analytics.py:62`
- Modify: `backend/apps/export/services_quota.py:413`
- Modify: `backend/apps/export/management/commands/import_shipments.py:510-512`

**Interfaces:**
- Consumes: `get_active_season()` from Task 2.
- Produces: no new interface. This is a pure refactor — behaviour is identical while exactly one season is active, which the Task 1 constraint now guarantees.

- [ ] **Step 1: Write the failing test**

Append to `backend/apps/core/tests_seasons.py`:

```python
import re
from pathlib import Path


class NoAdHocActiveSeasonLookupTests(TestCase):
    """Regression guard: the write-target lookup lives in one place.

    Nine call sites used `Season.objects.filter(is_active=True)` directly, with
    inconsistent tie-breaks. New ones must not reappear — a stray lookup silently
    reintroduces the read-scope/write-target conflation this feature untangles.
    """

    ALLOWED = {
        Path('apps/core/seasons.py'),           # the one legitimate home
        Path('apps/core/tests_seasons.py'),     # this file
    }

    # Matches both the write-target form (`Season.objects.filter(is_active=True)`,
    # possibly split across lines) and the read-scope form
    # (`filter(season__is_active=True)`) that Task 5 replaces. DOTALL so the
    # multi-line call style does not slip through.
    WRITE_TARGET = re.compile(r'Season\.objects[^\n]*?\.\s*filter\s*\(.*?is_active\s*=\s*True', re.DOTALL)
    READ_SCOPE = re.compile(r'season__is_active\s*=\s*True')

    def test_no_direct_is_active_lookups_outside_core_seasons(self):
        backend = Path(__file__).resolve().parents[2]
        offenders = []
        for path in backend.glob('apps/**/*.py'):
            rel = path.relative_to(backend)
            if rel in self.ALLOWED or 'migrations' in rel.parts:
                continue
            if rel.name.startswith('tests') or rel.parts[-2:-1] == ('tests',):
                continue
            text = path.read_text(encoding='utf-8')
            if self.WRITE_TARGET.search(text) or self.READ_SCOPE.search(text):
                offenders.append(str(rel))
        self.assertEqual(
            offenders, [],
            'Use apps.core.seasons.get_active_season() (write target) or '
            f'resolve_season(request) (read scope) instead: {offenders}',
        )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test apps.core.tests_seasons.NoAdHocActiveSeasonLookupTests --verbosity=2`
Expected: FAIL listing the call sites in `services/shipment.py`, `views.py`, `dashboard_summary.py`, `boss_analytics.py`, `services_quota.py`, `import_shipments.py`.

- [ ] **Step 3: Replace each call site**

In every listed file add the import:

```python
from apps.core.seasons import get_active_season
```

Then replace, e.g. in `backend/apps/export/services/shipment.py:576`:

```python
# BEFORE
resolved_season = Season.objects.filter(is_active=True).first()

# AFTER
resolved_season = get_active_season()
```

`backend/apps/export/views.py:1762`:

```python
# BEFORE
season = Season.objects.filter(is_active=True).first()
if season is None:
    raise ValueError('No active season found. Provide a season in the request.')

# AFTER
season = get_active_season()
if season is None:
    raise ValueError('No active season found. Provide a season in the request.')
```

`backend/apps/export/services/boss_analytics.py:62`, `services/dashboard_summary.py:34`, `services_quota.py:413` — all three currently read `Season.objects.filter(is_active=True).order_by('-start_date').first()`. The `order_by` is now redundant (the unique index guarantees one row):

```python
season = get_active_season()
```

`backend/apps/export/management/commands/import_shipments.py:510-512`:

```python
# BEFORE
self._season = Season.objects.filter(is_active=True).first()
if self._season is None:
    self._season = Season.objects.order_by('-start_date').first()

# AFTER — keep the fallback; imports must work with no active season
self._season = get_active_season() or Season.objects.order_by('-start_date').first()
```

`backend/apps/export/views.py:1029` and `:3083` are read-scope filters expressed as `season__is_active=True` inside a larger filter dict. **Leave them for Task 5** — they become `resolve_season()` calls there. Add a marker comment so Task 5 finds them:

```python
# TODO(season-scope): replaced by resolve_season() in Task 5
```

`backend/apps/export/views.py:3207-3208` computes a cache key from the active season:

```python
# BEFORE
active_season_id = (
    Shipment.objects.filter(season__is_active=True)
    .values_list('season_id', flat=True)
    .first()
)

# AFTER
active_season = get_active_season()
active_season_id = active_season.id if active_season else None
```

- [ ] **Step 4: Run the guard test and the affected suites**

```bash
python manage.py test apps.core.tests_seasons --verbosity=2
python manage.py test apps.export apps.greenhouse --verbosity=2
```

Expected: the guard passes. Export/greenhouse results match the `docs/PRE_EXISTING_TEST_FAILURES.md` baseline — no *new* failures.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/export backend/apps/core/tests_seasons.py
git commit -m "refactor(export): route active-season lookups through core.seasons"
```

---

### Task 4: Backfill nullable season FKs

**Files:**
- Create: `backend/apps/export/management/commands/backfill_season_fks.py`
- Create: `backend/apps/export/tests_season_backfill.py`

**Interfaces:**
- Consumes: `Season` from Task 1.
- Produces: management command `backfill_season_fks` with `--dry-run`. Assigns `Contract.season` and `LocalSellPlan.season` where derivable; reports the rest.

**Why:** `Contract.season` (`contracts/models/contract.py:60-63`) and `LocalSellPlan.season` (`export/models/local_sell_plan.py:36-38`) are `null=True`. `filter(season=X)` silently drops NULLs, so those rows would vanish from every view — including the season they actually belong to.

- [ ] **Step 1: Write the failing test**

Create `backend/apps/export/tests_season_backfill.py`:

```python
"""Tests for the backfill_season_fks command.

Run with:
    python manage.py test apps.export.tests_season_backfill --verbosity=2
"""
from datetime import date
from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from apps.core.models import Season
from apps.export.models import LocalSellPlan


class BackfillSeasonFksTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.s2025 = Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
        )
        cls.s2026 = Season.objects.create(
            name='2026/2027', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
            is_active=True,
        )

    def test_assigns_season_by_date(self):
        plan = LocalSellPlan.objects.create(season=None, year=2026, week_number=5)
        call_command('backfill_season_fks', stdout=StringIO())
        plan.refresh_from_db()
        self.assertEqual(plan.season, self.s2025)

    def test_dry_run_writes_nothing(self):
        plan = LocalSellPlan.objects.create(season=None, year=2026, week_number=5)
        call_command('backfill_season_fks', '--dry-run', stdout=StringIO())
        plan.refresh_from_db()
        self.assertIsNone(plan.season)

    def test_unmatched_rows_are_reported_not_dropped(self):
        plan = LocalSellPlan.objects.create(season=None, year=2019, week_number=5)
        out = StringIO()
        call_command('backfill_season_fks', stdout=out)
        plan.refresh_from_db()
        self.assertIsNone(plan.season)
        self.assertIn('unmatched', out.getvalue().lower())
        self.assertIn(str(plan.pk), out.getvalue())

    def test_is_idempotent(self):
        LocalSellPlan.objects.create(season=None, year=2026, week_number=5)
        call_command('backfill_season_fks', stdout=StringIO())
        out = StringIO()
        call_command('backfill_season_fks', stdout=out)
        self.assertIn('0 updated', out.getvalue())
```

> **Note for the implementer:** `LocalSellPlan` may require additional non-null fields. Read `backend/apps/export/models/local_sell_plan.py` first and add whatever the model demands to these `objects.create()` calls. Do not change the assertions.

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test apps.export.tests_season_backfill --verbosity=2`
Expected: FAIL — `CommandError: Unknown command: 'backfill_season_fks'`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/apps/export/management/commands/backfill_season_fks.py`:

```python
"""Assign Season to rows whose season FK is nullable and NULL.

Contract.season and LocalSellPlan.season are null=True. `filter(season=X)`
silently drops NULLs, so an unassigned row would disappear from every view once
season scoping lands. This assigns them by date and *reports* — never silently
drops — the rows it cannot match.

    python manage.py backfill_season_fks --dry-run
    python manage.py backfill_season_fks
"""
import datetime

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.core.models import Season

BATCH_SIZE = 500


def _iso_week_monday(year: int, week: int) -> datetime.date:
    """Monday of ISO week `week` in `year`."""
    return datetime.date.fromisocalendar(year, week, 1)


class Command(BaseCommand):
    help = 'Backfill NULL season FKs on Contract and LocalSellPlan.'

    def add_arguments(self, parser) -> None:
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **options) -> None:
        dry_run: bool = options['dry_run']
        seasons = list(Season.objects.order_by('start_date'))

        total_updated = 0
        unmatched: list[str] = []

        total_updated += self._backfill_local_sell_plans(seasons, dry_run, unmatched)
        total_updated += self._backfill_contracts(seasons, dry_run, unmatched)

        prefix = '[dry-run] ' if dry_run else ''
        self.stdout.write(f'{prefix}{total_updated} updated')
        if unmatched:
            self.stdout.write(
                self.style.WARNING(
                    f'{len(unmatched)} unmatched rows need manual assignment: '
                    + ', '.join(unmatched)
                )
            )

    @staticmethod
    def _season_for(seasons: list[Season], day: datetime.date | None) -> Season | None:
        if day is None:
            return None
        for season in seasons:
            if season.start_date <= day <= season.end_date:
                return season
        return None

    def _backfill_local_sell_plans(
        self, seasons: list[Season], dry_run: bool, unmatched: list[str]
    ) -> int:
        from apps.export.models import LocalSellPlan

        rows = list(LocalSellPlan.objects.filter(season__isnull=True))
        to_update = []
        for row in rows:
            try:
                day = _iso_week_monday(row.year, row.week_number)
            except ValueError:
                day = None
            season = self._season_for(seasons, day)
            if season is None:
                unmatched.append(f'LocalSellPlan#{row.pk}')
                continue
            row.season = season
            to_update.append(row)

        if to_update and not dry_run:
            with transaction.atomic():
                LocalSellPlan.objects.bulk_update(
                    to_update, ['season'], batch_size=BATCH_SIZE
                )
        return len(to_update)

    def _backfill_contracts(
        self, seasons: list[Season], dry_run: bool, unmatched: list[str]
    ) -> int:
        from apps.contracts.models import Contract

        rows = list(Contract.objects.filter(season__isnull=True))
        to_update = []
        for row in rows:
            season = self._season_for(seasons, getattr(row, 'contract_date', None))
            if season is None:
                unmatched.append(f'Contract#{row.pk}')
                continue
            row.season = season
            to_update.append(row)

        if to_update and not dry_run:
            with transaction.atomic():
                Contract.objects.bulk_update(
                    to_update, ['season'], batch_size=BATCH_SIZE
                )
        return len(to_update)
```

> **Dependency note:** `export/` may not import `contracts/` (dependency direction is `export → contracts`). The `Contract` import is function-local and inside a *management command*, not runtime code, which keeps the module-level import graph clean. If the reviewer objects, move `_backfill_contracts` into a sibling command under `backend/apps/contracts/management/commands/` and have this one call it — do not add a module-level `contracts` import to `export/`.
>
> Read `backend/apps/contracts/models/contract.py` and confirm the date field name before implementing; `contract_date` is the assumption. Adjust `getattr(row, 'contract_date', None)` to the real field.

- [ ] **Step 4: Run test to verify it passes**

Run: `python manage.py test apps.export.tests_season_backfill --verbosity=2`
Expected: PASS — 4 tests.

- [ ] **Step 5: Confirm what `LocalSellPlan.year` actually means — before writing anything**

`_iso_week_monday(2026, 5)` is late January 2026, which belongs to the **2025/2026** season.
That is correct if `year` is the *calendar* year. If any rows store the *season-start* year
instead (`2025` for a January-2026 week), the backfill stamps them one season too early and
silently mis-assigns historical data — the exact failure this task exists to prevent.

```bash
python manage.py shell -c "from apps.export.models import LocalSellPlan; print(sorted(set(LocalSellPlan.objects.values_list('year', 'week_number'))))"
```

Look at the (year, week) pairs. Calendar-year semantics show weeks 1–52 spread across each
year. Season-start-year semantics show weeks clustering oddly — e.g. `year=2025, week=5`
present with no `year=2026, week=5`. If it is season-start-year, change `_iso_week_monday`
to resolve against the season whose `start_date.year == row.year` and stop here to tell the
user before running anything non-dry.

- [ ] **Step 6: Run against the real database**

```bash
python manage.py backfill_season_fks --dry-run
```

Read the output. If any rows are unmatched, report the list to the user — do **not** guess assignments. Then:

```bash
python manage.py backfill_season_fks
```

- [ ] **Step 7: Commit**

```bash
git add backend/apps/export/management/commands/backfill_season_fks.py backend/apps/export/tests_season_backfill.py
git commit -m "data(export): backfill nullable season FKs on contracts + local sell plans"
```

---

# Phase 2 — Read scoping

### Task 5: Apply `SeasonScopedMixin` to direct-FK viewsets

**Files:**
- Modify: `backend/apps/export/views.py` — `ShipmentViewSet`, `SalesRepCoverageViewSet`, `ClientsReportViewSet`
- Modify: `backend/apps/export/views_planning.py` — `WeeklyTruckAllocationViewSet`, `WeeklyDestinationSelectionViewSet`, `WeeklyLocalSellPlanViewSet`
- Modify: `backend/apps/greenhouse/views.py` — `WeeklyHarvestPlanViewSet`, `HarvestDayEntryViewSet`, `DailyHarvestBoardViewSet`
- Modify: `backend/apps/contracts/views.py` — `ContractViewSet`

**Interfaces:**
- Consumes: `SeasonScopedMixin`, `resolve_season` from Task 2.
- Produces: every listed endpoint accepts `?season=<id>` and defaults to the active season.

- [ ] **Step 1: Write the failing test**

Create `backend/apps/export/tests_season_scoping.py`:

```python
"""Season read-scoping across every scoped endpoint.

The table below IS the spec's §4.1/§4.2 checklist. An endpoint that scopes data
but is absent from ENDPOINTS is a leak; add it here when you add the mixin.

Run with:
    python manage.py test apps.export.tests_season_scoping --verbosity=2
"""
from datetime import date

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import (
    Country, RoleResourcePermission, Season, ShipmentStatusType, User,
)
from apps.export.models import Shipment

# (url, factory_attr) — factory_attr names the setUpTestData helper that creates
# one row in a given season.
ENDPOINTS = [
    ('/api/v1/export/shipments/', 'make_shipment'),
]


def _make_status() -> ShipmentStatusType:
    return ShipmentStatusType.objects.create(
        code='draft', name_tk='Draft', phase='DRAFT', step_order=1,
    )


class SeasonScopingTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.active = Season.objects.create(
            name='2026/2027', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
            is_active=True,
        )
        cls.closed = Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
            closed_at=timezone.now(),
        )
        cls.status = _make_status()
        cls.country = Country.objects.create(name_en='Kazakhstan', name_tk='Gazagystan')

        cls.manager = User.objects.create(username='mgr', role='export_manager')
        cls.manager.set_password('pass')
        cls.manager.save()
        cls.operator = User.objects.create(username='op', role='warehouse_chief')
        cls.operator.set_password('pass')
        cls.operator.save()

        RoleResourcePermission.objects.update_or_create(
            role='export_manager', resource_code='closed_season',
            defaults={'can_view': True},
        )

        cls.active_shipment = cls.make_shipment(cls.active, 'ACT-001')
        cls.closed_shipment = cls.make_shipment(cls.closed, 'CLS-001')

    @classmethod
    def make_shipment(cls, season: Season, code: str) -> Shipment:
        return Shipment.objects.create(
            shipment_code=code, date=season.start_date, season=season,
            status=cls.status, country=cls.country,
        )

    def _login(self, user) -> APIClient:
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def _codes(self, response) -> set[str]:
        results = response.json()
        rows = results['results'] if isinstance(results, dict) else results
        return {r['code'] for r in rows}

    def test_default_view_excludes_closed_season(self):
        response = self._login(self.manager).get('/api/v1/export/shipments/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('ACT-001', self._codes(response))
        self.assertNotIn('CLS-001', self._codes(response))

    def test_closed_season_visible_with_permission(self):
        response = self._login(self.manager).get(
            f'/api/v1/export/shipments/?season={self.closed.pk}'
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn('CLS-001', self._codes(response))
        self.assertNotIn('ACT-001', self._codes(response))

    def test_closed_season_denied_without_permission(self):
        response = self._login(self.operator).get(
            f'/api/v1/export/shipments/?season={self.closed.pk}'
        )
        self.assertEqual(response.status_code, 403)

    def test_unknown_season_returns_404(self):
        response = self._login(self.manager).get('/api/v1/export/shipments/?season=999999')
        self.assertEqual(response.status_code, 404)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test apps.export.tests_season_scoping --verbosity=2`
Expected: FAIL — `test_default_view_excludes_closed_season` finds `CLS-001` in the default list.

- [ ] **Step 3: Add the mixin to `ShipmentViewSet`**

`ShipmentViewSet` is the **one** viewset that does not use `SeasonScopedMixin`. It needs the
resolved `Season` object itself (to decide whether to bypass the archive split), not just a
filter, so it calls `resolve_season()` directly. Adding the mixin here would leave
`apply_season_scope()` defined but never called — misleading for the next reader.

In `backend/apps/export/views.py`:

```python
from apps.core.seasons import resolve_season
```

In `get_queryset()`, apply the scope **before** the archive filter — season scope answers *which season*, archive answers *which slice within it*:

Two rules interact here and both matter:

1. **Detail routes bypass season scoping entirely.** Spec §4.5 already exempts
   shipment-detail-by-ID — a direct link must resolve. It is also what makes the write
   freeze return 409 rather than 404: if `get_object()` could not find a closed-season
   row, `has_object_permission` would never run.
2. **Inside a closed season the archive split is bypassed** (spec §9) — but as a *flag*,
   not an early `return`. Returning early would skip the `deleted_at` clause and the stuck
   filter, resurfacing soft-deleted rows in the historical view.

```python
    def get_queryset(self):
        qs = super().get_queryset()
        ...  # existing deleted_at handling stays exactly where it is

        # ── Season scope ────────────────────────────────────────────────────
        # List actions only. Detail routes resolve by ID across every season so
        # a direct link works (spec §4.5) and so the write freeze can return 409
        # instead of a misleading 404.
        skip_archive_split = False
        if self.action == 'list':
            season = resolve_season(self.request)
            if season is not None:
                qs = qs.filter(season=season)
                # "Operational" is meaningless for a frozen season — nothing is
                # in flight. A second hide-filter here would produce
                # "the row exists but nothing shows it" (spec §9).
                skip_archive_split = season.is_closed

        # ── Operational vs Archive split (Phase 3, ADR-0005) ─────────────────
        archived_param = self.request.query_params.get('archived')
        if not skip_archive_split:
            ...  # existing archive block unchanged
        ...
```

> **Implementer:** read `views.py:264-300` before editing. Confirm exactly which clauses
> follow the archive block (`deleted_at`, the stuck filter, anything else) and make sure
> `skip_archive_split` gates **only** the archive block — nothing after it.

- [ ] **Step 4: Run test to verify it passes**

Run: `python manage.py test apps.export.tests_season_scoping --verbosity=2`
Expected: PASS — 4 tests.

- [ ] **Step 5: Replace the two marker comments from Task 3**

`backend/apps/export/views.py:1018-1029` (the Sheet action) currently builds `season_filter` by hand. Replace:

```python
        # BEFORE
        season_filter = {}
        season_id = request.query_params.get('season')
        if <single-shipment fetch>:
            ...
        elif season_id:
            season_filter['season_id'] = season_id
        else:
            season_filter['season__is_active'] = True

        # AFTER — single-shipment fetch still bypasses scoping (a direct link
        # must resolve); otherwise resolve_season handles param + permission.
        season_filter = {}
        if <single-shipment fetch>:
            ...
        else:
            season = resolve_season(request)
            if season is not None:
                season_filter['season'] = season
```

`backend/apps/export/views.py:3083` (the board action) — same substitution for `season__is_active=True`.

- [ ] **Step 6: Add the mixin to the remaining direct-FK viewsets**

Repeat Step 3's pattern for each, all with `season_field = 'season'`:

| File | ViewSet |
|---|---|
| `apps/export/views.py` | `SalesRepCoverageViewSet`, `ClientsReportViewSet` |
| `apps/export/views_planning.py` | `WeeklyTruckAllocationViewSet`, `WeeklyDestinationSelectionViewSet`, `WeeklyLocalSellPlanViewSet` |
| `apps/greenhouse/views.py` | `WeeklyHarvestPlanViewSet`, `HarvestDayEntryViewSet`, `DailyHarvestBoardViewSet` |
| `apps/contracts/views.py` | `ContractViewSet` |

`greenhouse/views.py:73` and `:407` already read `?season=` by hand (`qs.filter(season_id=season)`). Delete those lines — `apply_season_scope` replaces them, and the hand-written version has no permission check on closed seasons.

`contracts/views.py:112` likewise (`qs.filter(season_id=season_id)`).

- [ ] **Step 7: Run the full affected suites**

```bash
python manage.py test apps.export apps.greenhouse apps.contracts --verbosity=2
```

Expected: no new failures against the `docs/PRE_EXISTING_TEST_FAILURES.md` baseline.

- [ ] **Step 8: Commit**

```bash
git add backend/apps/export backend/apps/greenhouse backend/apps/contracts
git commit -m "feat(export): scope direct-FK endpoints to the resolved season"
```

---

### Task 6: Apply the mixin to join-scoped viewsets

**Files:**
- Modify: `backend/apps/export/views.py` — `CommentViewSet`, `TaskViewSet`, `QuotaUsageViewSet`, `FinansistAdvanceViewSet`, `CustomsExpenseViewSet`
- Modify: `backend/apps/contracts/views.py` — `ContractSaleViewSet`
- Modify: `backend/apps/export/tests_season_scoping.py` (append)

**Interfaces:**
- Consumes: `SeasonScopedMixin` from Task 2.
- Produces: each listed viewset sets `season_field = 'shipment__season'` and calls `apply_season_scope()`.

**Why these:** they have no season column. They reach Season only through `shipment`. Skip one and closed-season data stays visible through the child list — these are the leak paths.

| ViewSet | Model | Anchor field | Source |
|---|---|---|---|
| `CommentViewSet` | `ShipmentComment` | `shipment` | — |
| `TaskViewSet` | `Task` | `shipment` | `export/models/task.py:101` |
| `QuotaUsageViewSet` | `QuotaUsageRecord` | `shipment` | `export/models/quota.py:238` |
| `FinansistAdvanceViewSet` | advance model | `shipment` | `export/models/finance.py:66` |
| `CustomsExpenseViewSet` | expense model | `shipment` | `export/models/finance.py:135` |
| `ContractSaleViewSet` | `ContractSale` | `shipment` (**nullable**) | — |

- [ ] **Step 1: Write the failing test**

Append to `backend/apps/export/tests_season_scoping.py`:

```python
from apps.export.models import ShipmentComment


class JoinScopedEndpointTests(SeasonScopingTests):
    """Child endpoints must inherit their shipment's season scope."""

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.active_comment = ShipmentComment.objects.create(
            shipment=cls.active_shipment, author=cls.manager, body='active-note',
        )
        cls.closed_comment = ShipmentComment.objects.create(
            shipment=cls.closed_shipment, author=cls.manager, body='closed-note',
        )

    def _bodies(self, response) -> set[str]:
        payload = response.json()
        rows = payload['results'] if isinstance(payload, dict) else payload
        return {r['body'] for r in rows}

    def test_comments_exclude_closed_season_by_default(self):
        response = self._login(self.manager).get('/api/v1/export/comments/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('active-note', self._bodies(response))
        self.assertNotIn('closed-note', self._bodies(response))

    def test_comments_visible_when_closed_season_selected(self):
        response = self._login(self.manager).get(
            f'/api/v1/export/comments/?season={self.closed.pk}'
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn('closed-note', self._bodies(response))
```

> **Note for the implementer:** read `backend/apps/export/models/` for `ShipmentComment`'s real field names (`body` vs `text`, whether `author` is required) and adjust the `create()` call and `_bodies()` key. Do not change the assertions.

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test apps.export.tests_season_scoping.JoinScopedEndpointTests --verbosity=2`
Expected: FAIL — `closed-note` appears in the default list.

- [ ] **Step 3: Write minimal implementation**

For each viewset in the table except `ContractSaleViewSet`:

```python
from apps.core.seasons import SeasonScopedMixin


class CommentViewSet(SeasonScopedMixin, ModelViewSet):
    season_field = 'shipment__season'

    def get_queryset(self):
        return self.apply_season_scope(super().get_queryset())
```

`ContractSaleViewSet` needs one extra clause — `ContractSale.shipment` is nullable for legacy 2-Sales rows, and `filter(shipment__season=X)` drops NULLs. It calls `resolve_season()` directly rather than `apply_season_scope()` because the filter is no longer a plain equality:

```python
from django.db.models import Q

from apps.core.seasons import SeasonScopedMixin, resolve_season


class ContractSaleViewSet(SeasonScopedMixin, ModelViewSet):
    season_field = 'shipment__season'

    def get_queryset(self):
        qs = super().get_queryset()
        season = resolve_season(self.request)
        if season is None:
            return qs
        # Legacy 2-Sales rows have shipment=NULL and belong to no season.
        # An inner-join filter would drop them from every view; surface them
        # alongside the active season only.
        unlinked = Q(shipment__isnull=True) if not season.is_closed else Q(pk__in=[])
        return qs.filter(Q(shipment__season=season) | unlinked)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python manage.py test apps.export.tests_season_scoping --verbosity=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/export backend/apps/contracts
git commit -m "feat(export): scope shipment-child endpoints to the resolved season"
```

---

### Task 7: Parameterise `boss` analytics; leave the opt-out list alone

**Files:**
- Modify: `backend/apps/export/services/boss_analytics.py:62`, `:325-355`
- Create: `backend/apps/export/tests_season_optout.py`

**Interfaces:**
- Consumes: `resolve_season` from Task 2.
- Produces: `weekly_revenue_comparison(season)` returns `current_season` for `season` and `previous_season` for the season immediately preceding it by `start_date`, **regardless of whether either is closed**.

**Critical:** `boss` is the one endpoint the mixin must never touch. Spec §4.3 — the resolved season **parameterises** the comparison rather than filtering it. Applying `SeasonScopedMixin` here empties `previous_season` and silently breaks every comparison chart, plus `boss_pdf.py:273` and `boss_excel.py:108/245`.

- [ ] **Step 1: Write the failing test**

Create `backend/apps/export/tests_season_optout.py`:

```python
"""Endpoints that must NOT be season-scoped (spec §4.5).

Each test asserts results are identical before and after closing a season.
A failure here means the mixin was applied somewhere it must not be.

Run with:
    python manage.py test apps.export.tests_season_optout --verbosity=2
"""
from datetime import date

from django.test import TestCase
from django.utils import timezone

from apps.core.models import Season
from apps.export.services.boss_analytics import weekly_revenue_comparison


class BossComparisonSurvivesCloseTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.older = Season.objects.create(
            name='2024/2025', start_date=date(2024, 9, 1), end_date=date(2025, 8, 31),
        )
        cls.newer = Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
            is_active=True,
        )

    def test_previous_season_resolves_to_the_preceding_season(self):
        result = weekly_revenue_comparison(self.newer)
        self.assertIn('current_season', result)
        self.assertIn('previous_season', result)

    def test_previous_season_still_resolves_when_both_are_closed(self):
        """Selecting a closed season as 'current' must still yield a comparison."""
        Season.objects.filter(pk=self.older.pk).update(closed_at=timezone.now())
        Season.objects.filter(pk=self.newer.pk).update(
            closed_at=timezone.now(), is_active=False,
        )
        self.newer.refresh_from_db()
        result = weekly_revenue_comparison(self.newer)
        self.assertIn('previous_season', result)

    def test_oldest_season_yields_empty_previous_not_an_error(self):
        result = weekly_revenue_comparison(self.older)
        self.assertEqual(result['previous_season'], [])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test apps.export.tests_season_optout --verbosity=2`
Expected: FAIL — `weekly_revenue_comparison` does not exist or does not take a season argument.

- [ ] **Step 3: Write minimal implementation**

In `backend/apps/export/services/boss_analytics.py`, replace the `is_active=True` lookup at line 62 and refactor the comparison at `:325-355`:

```python
from apps.core.models import Season
from apps.core.seasons import get_active_season


def _previous_season(season: Season) -> Season | None:
    """The season immediately preceding `season` by start_date.

    Deliberately ignores closed_at — a comparison against last year is the whole
    point of the chart, and last year is by definition closed.
    """
    return (
        Season.objects.filter(start_date__lt=season.start_date)
        .order_by('-start_date')
        .first()
    )


def weekly_revenue_comparison(season: Season | None = None) -> dict:
    """Weekly revenue for `season` and the one before it.

    `season` parameterises the comparison; it never filters it. Passing a closed
    season is valid and expected — that is what the switcher does.
    """
    season = season or get_active_season()
    if season is None:
        return {'current_season': [], 'previous_season': []}

    previous = _previous_season(season)
    return {
        'current_season': _weekly_revenue(season.start_date, season.end_date),
        'previous_season': (
            _weekly_revenue(previous.start_date, previous.end_date) if previous else []
        ),
    }
```

Update `BossAnalyticsViewSet` to pass `resolve_season(request)` into this function. Do **not** add `SeasonScopedMixin` to it.

- [ ] **Step 4: Run test to verify it passes**

```bash
python manage.py test apps.export.tests_season_optout --verbosity=2
python manage.py test apps.export.tests_boss_analytics --verbosity=2
```

Expected: PASS. The existing boss test at `tests_boss_analytics.py:504` asserting the `['current_season', 'previous_season']` keys must still pass.

- [ ] **Step 5: Verify the export consumers still render**

`boss_pdf.py:273` and `boss_excel.py:108/245` read `revenue.get('current_season', [])`. Confirm the shape is unchanged:

```bash
python manage.py test apps.export --verbosity=2 2>&1 | grep -i "boss\|pdf\|excel"
```

- [ ] **Step 6: Commit**

```bash
git add backend/apps/export/services/boss_analytics.py backend/apps/export/views.py backend/apps/export/tests_season_optout.py
git commit -m "feat(export): parameterise boss comparison by resolved season"
```

---

# Phase 3 — Write freeze and lifecycle

### Task 8: The `closed_season` permission resource

**Files:**
- Modify: `backend/apps/core/permission_registry.py:101` (area)
- Modify: `backend/apps/export/management/commands/seed_permissions.py`
- Modify: `backend/apps/core/tests_seasons.py` (append)

**Interfaces:**
- Consumes: `can_view_closed()` from Task 2, which already reads this resource.
- Produces: `'closed_season'` in `RESOURCE_REGISTRY`, seeded `can_view=True` for `admin`, `director`, `boss`, `export_manager`, `finansist`.

**Why a resource and not an action:** `RoleResourcePermission` has a fixed vocabulary — `can_view`/`can_create`/`can_edit`/`can_delete` (`core/models/role_permissions.py:45-48`). A custom `view_closed` action would need a schema change. A new resource needs none.

- [ ] **Step 1: Write the failing test**

Append to `backend/apps/core/tests_seasons.py`:

```python
from django.core.management import call_command

from apps.core.permission_registry import RESOURCE_REGISTRY


class ClosedSeasonResourceTests(TestCase):
    def test_resource_is_registered(self):
        self.assertIn('closed_season', RESOURCE_REGISTRY)

    def test_label_warns_about_archive_coupling(self):
        """The registry label is the only text an admin sees when granting it.

        Rule §9(3) bypasses the is_archived split inside a closed season, so this
        grant confers archive-level read — including historical buyer prices.
        """
        label = RESOURCE_REGISTRY['closed_season'].lower()
        self.assertIn('archived', label)

    def test_seed_grants_management_roles(self):
        call_command('seed_permissions')
        granted = set(
            RoleResourcePermission.objects.filter(
                resource_code='closed_season', can_view=True,
            ).values_list('role', flat=True)
        )
        self.assertEqual(
            granted, {'admin', 'director', 'boss', 'export_manager', 'finansist'},
        )

    def test_seed_grants_no_write_actions(self):
        """Closed seasons are read-only (D1) — write flags are meaningless here."""
        call_command('seed_permissions')
        writes = RoleResourcePermission.objects.filter(
            resource_code='closed_season',
        ).filter(Q(can_create=True) | Q(can_edit=True) | Q(can_delete=True))
        self.assertFalse(writes.exists())
```

Add `from django.db.models import Q` to the imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test apps.core.tests_seasons.ClosedSeasonResourceTests --verbosity=2`
Expected: FAIL — `'closed_season'` not in `RESOURCE_REGISTRY`.

- [ ] **Step 3: Write minimal implementation**

In `backend/apps/core/permission_registry.py`, add to `RESOURCE_REGISTRY` immediately after the `('season', 'Season')` entry:

```python
    ('season',                'Season'),
    # Grants read access to CLOSED seasons via the season switcher. Note the
    # coupling: inside a closed season the is_archived split is bypassed
    # (spec §9.1), so this grant also confers archive-level read. The label
    # says so because the registry label is the only text an admin sees.
    ('closed_season',         'Browse closed seasons (includes archived rows and historical prices)'),
```

In `seed_permissions.py`, find `RESOURCE_DEFAULTS` and add — mirroring `_ARCHIVE_VIEW_ROLES` at `export/views.py:190`:

```python
    'closed_season': {
        'view': ['admin', 'director', 'boss', 'export_manager', 'finansist'],
        'create': [],
        'edit': [],
        'delete': [],
    },
```

> Read the existing `RESOURCE_DEFAULTS` entries first and match their exact shape — it may use a different key naming (`can_view` vs `view`) or a tuple form.

- [ ] **Step 4: Run test and seed**

```bash
python manage.py test apps.core.tests_seasons.ClosedSeasonResourceTests --verbosity=2
python manage.py seed_permissions
```

Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/core/permission_registry.py backend/apps/export/management/commands/seed_permissions.py backend/apps/core/tests_seasons.py
git commit -m "feat(core): add closed_season permission resource"
```

---

### Task 9: Write freeze — both layers

**Files:**
- Modify: `backend/apps/core/permissions.py` (append `SeasonNotClosed`)
- Modify: `backend/apps/export/models/shipment.py` — `transition_to()`
- Modify: `backend/apps/export/services/shipment.py` — create/promote/join/bulk-update services
- Modify: `backend/config/settings.py` or the DRF exception handler — map `SeasonClosedError` → 409
- Create: `backend/apps/export/tests_season_freeze.py`

**Interfaces:**
- Consumes: `assert_season_open`, `SeasonClosedError`, `resolve_season` from Task 2.
- Produces: `SeasonNotClosed(BasePermission)`; every write path raises `SeasonClosedError`; the API returns `409 {"error": "season_closed", "season": "...", "closed_at": "..."}`.

- [ ] **Step 1: Write the failing test**

Create `backend/apps/export/tests_season_freeze.py`:

```python
"""A closed season is immutable (D1).

Two layers are under test: the DRF permission (early rejection) and the service
guard inside transition_to() (the one that actually holds the invariant).

Run with:
    python manage.py test apps.export.tests_season_freeze --verbosity=2
"""
from datetime import date

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import Country, Season, ShipmentStatusType, User
from apps.core.seasons import SeasonClosedError
from apps.export.models import Shipment


class SeasonFreezeTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.closed = Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
            closed_at=timezone.now(),
        )
        cls.active = Season.objects.create(
            name='2026/2027', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
            is_active=True,
        )
        cls.draft = ShipmentStatusType.objects.create(
            code='draft', name_tk='Draft', phase='DRAFT', step_order=1,
        )
        cls.loading = ShipmentStatusType.objects.create(
            code='yuklenme', name_tk='Loading', phase='LOADING', step_order=2,
        )
        cls.country = Country.objects.create(name_en='Kazakhstan', name_tk='Gazagystan')
        cls.admin = User.objects.create(username='adm', role='admin', is_superuser=True)

        cls.frozen_shipment = Shipment.objects.create(
            shipment_code='CLS-001', date=date(2025, 10, 1), season=cls.closed,
            status=cls.draft, country=cls.country,
        )
        cls.live_shipment = Shipment.objects.create(
            shipment_code='ACT-001', date=date(2026, 10, 1), season=cls.active,
            status=cls.draft, country=cls.country,
        )

    def _client(self) -> APIClient:
        client = APIClient()
        client.force_authenticate(user=self.admin)
        return client

    # ── Layer 2: the service guard ──────────────────────────────────────────

    def test_transition_on_closed_season_raises(self):
        with self.assertRaises(SeasonClosedError):
            self.frozen_shipment.transition_to(self.loading.id, self.admin)

    def test_transition_on_active_season_still_works(self):
        self.live_shipment.transition_to(self.loading.id, self.admin)
        self.live_shipment.refresh_from_db()
        self.assertEqual(self.live_shipment.status_id, self.loading.id)

    # ── Layer 1: the API contract ───────────────────────────────────────────

    def test_patch_closed_season_shipment_returns_409(self):
        response = self._client().patch(
            f'/api/v1/export/shipments/{self.frozen_shipment.pk}/'
            f'?season={self.closed.pk}',
            {'notes': 'edit attempt'}, format='json',
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['error'], 'season_closed')
        self.assertEqual(response.json()['season'], '2025/2026')

    def test_patch_closed_season_shipment_without_season_param_returns_409(self):
        """The frontend omits ?season= when the selection equals the active
        season, so the guard must read obj.season — never the query param."""
        response = self._client().patch(
            f'/api/v1/export/shipments/{self.frozen_shipment.pk}/',
            {'notes': 'edit attempt'}, format='json',
        )
        self.assertEqual(response.status_code, 409)

    def test_delete_closed_season_shipment_returns_409(self):
        response = self._client().delete(
            f'/api/v1/export/shipments/{self.frozen_shipment.pk}/'
            f'?season={self.closed.pk}'
        )
        self.assertEqual(response.status_code, 409)

    def test_patch_active_season_shipment_still_works(self):
        response = self._client().patch(
            f'/api/v1/export/shipments/{self.live_shipment.pk}/',
            {'notes': 'fine'}, format='json',
        )
        self.assertIn(response.status_code, (200, 202))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test apps.export.tests_season_freeze --verbosity=2`
Expected: FAIL — no `SeasonClosedError` raised; PATCH returns 200.

- [ ] **Step 3: Add the DRF permission (layer 1)**

Append to `backend/apps/core/permissions.py`:

```python
class SeasonNotClosed(BasePermission):
    """Blocks mutating requests against a closed season.

    Layer 1 of the write freeze. Layer 2 (`assert_season_open` inside the
    service layer) is what actually holds the invariant, since the Sheet
    bulk-edit, the two-row Join, and status transitions do not all pass through
    DRF object permissions.

    Deliberately implements ONLY has_object_permission. A request-level check
    would have to guess the target row's season from `?season=`, and the
    frontend omits that param whenever the selection equals the active season
    (see the URL-sync hook) — so a PATCH on a closed-season row would resolve to
    the *active* season and pass. `obj.season` is the only authoritative source.

    Creates need no request-level check either: new rows are stamped with
    `get_active_season()`, which can never be closed. A POST body carrying an
    explicit `season` is caught by layer 2 inside the create service.
    """

    SAFE = ('GET', 'HEAD', 'OPTIONS')

    def has_object_permission(self, request, view, obj) -> bool:
        if request.method in self.SAFE:
            return True
        from apps.core.seasons import assert_season_open

        season = getattr(obj, 'season', None)
        if season is None:
            # Join-scoped children (comments, tasks, advances…) reach Season
            # through shipment.
            shipment = getattr(obj, 'shipment', None)
            season = getattr(shipment, 'season', None)
        assert_season_open(season)
        return True
```

Add `SeasonNotClosed` to `permission_classes` on every viewset touched in Tasks 5 and 6.

- [ ] **Step 4: Add the service guard (layer 2)**

In `backend/apps/export/models/shipment.py`, at the top of `transition_to()`:

```python
    def transition_to(self, new_status_id: int, user, notes: str = '') -> None:
        """Execute a validated status transition.

        Raises:
            SeasonClosedError: If this shipment belongs to a closed season.
            ValueError: If the transition is not allowed from the current status.
        """
        from apps.core.seasons import assert_season_open

        assert_season_open(self.season)
        ...
```

Add the same guard to, in `backend/apps/export/services/shipment.py`:
- the create-shipment service
- the draft-promotion service
- the Sheet bulk-update service
- the two-row Join service

- [ ] **Step 5: Map the exception to 409**

In the project's DRF exception handler (search `EXCEPTION_HANDLER` in `backend/config/settings.py`; if none is configured, create `backend/apps/core/exception_handler.py` and point `REST_FRAMEWORK['EXCEPTION_HANDLER']` at it):

```python
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

from apps.core.seasons import SeasonClosedError


def exception_handler(exc, context):
    """Adds SeasonClosedError → 409 to DRF's default handling.

    409 rather than 403: the request is well-formed and the user is authorised
    in principle — it conflicts with the resource's state. The frontend treats
    it as a banner, not a permission error.
    """
    if isinstance(exc, SeasonClosedError):
        return Response(
            {
                'error': 'season_closed',
                'season': exc.season.name,
                'closed_at': exc.season.closed_at.isoformat()
                if exc.season.closed_at else None,
            },
            status=status.HTTP_409_CONFLICT,
        )
    return drf_exception_handler(exc, context)
```

- [ ] **Step 6: Run test to verify it passes**

```bash
python manage.py test apps.export.tests_season_freeze --verbosity=2
python manage.py test apps.export apps.greenhouse apps.contracts --verbosity=2
```

Expected: freeze tests PASS. No new failures elsewhere against the baseline.

- [ ] **Step 7: Commit**

```bash
git add backend/apps/core backend/apps/export backend/config
git commit -m "feat(export): freeze writes against closed seasons (409)"
```

---

### Task 10: `close_season` / `open_season` / `close_preview`

**Files:**
- Create: `backend/apps/core/services/season.py`
- Create: `backend/apps/core/services/__init__.py` (if absent — must re-export)
- Modify: `backend/apps/export/views_admin.py:138-141` (`SeasonSerializer`), `:301-318` (`SeasonViewSet`)
- Create: `backend/apps/core/tests_season_services.py`

**Interfaces:**
- Consumes: `Season`, `get_active_season`, `SeasonClosedError` from Tasks 1–2.
- Produces:
  - `close_season(season: Season, user: User) -> None`
  - `open_season(season: Season, user: User) -> None`
  - `close_preview(season: Season) -> dict` with keys `drafts`, `in_transit`, `open_tasks`, `unfinished_plans` (all `int`)
  - `POST /api/v1/export/admin/seasons/{id}/close/`, `.../open/`, `GET .../close-preview/`
  - `SeasonSerializer` gains `status`, `closed_at`, `closed_by`

- [ ] **Step 1: Write the failing test**

Create `backend/apps/core/tests_season_services.py`:

```python
"""Tests for close_season / open_season / close_preview.

Run with:
    python manage.py test apps.core.tests_season_services --verbosity=2
"""
from datetime import date

from django.test import TestCase

from apps.core.models import Season, User
from apps.core.services.season import close_preview, close_season, open_season


class CloseSeasonTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create(username='adm', role='admin')

    def setUp(self):
        self.season = Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
            is_active=True,
        )

    def test_close_sets_closed_at_and_by(self):
        close_season(self.season, self.user)
        self.season.refresh_from_db()
        self.assertIsNotNone(self.season.closed_at)
        self.assertEqual(self.season.closed_by, self.user)
        self.assertEqual(self.season.status, 'CLOSED')

    def test_close_clears_is_active(self):
        close_season(self.season, self.user)
        self.season.refresh_from_db()
        self.assertFalse(self.season.is_active)

    def test_close_twice_raises(self):
        close_season(self.season, self.user)
        with self.assertRaises(ValueError):
            close_season(self.season, self.user)

    def test_close_does_not_touch_shipment_rows(self):
        """D2: unfinished rows are left as-is and hidden, never mutated."""
        from apps.core.models import Country, ShipmentStatusType
        from apps.export.models import Shipment

        status = ShipmentStatusType.objects.create(
            code='draft', name_tk='Draft', phase='DRAFT', step_order=1,
        )
        country = Country.objects.create(name_en='KZ', name_tk='KZ')
        shipment = Shipment.objects.create(
            shipment_code='X-1', date=date(2025, 10, 1), season=self.season,
            status=status, country=country,
        )
        before = Shipment.objects.values('updated_at', 'status_id').get(pk=shipment.pk)
        close_season(self.season, self.user)
        after = Shipment.objects.values('updated_at', 'status_id').get(pk=shipment.pk)
        self.assertEqual(before, after)


class OpenSeasonTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create(username='adm', role='admin')

    def test_open_deactivates_the_incumbent(self):
        incumbent = Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
            is_active=True,
        )
        successor = Season.objects.create(
            name='2026/2027', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
        )
        open_season(successor, self.user)
        incumbent.refresh_from_db()
        successor.refresh_from_db()
        self.assertFalse(incumbent.is_active)
        self.assertTrue(successor.is_active)

    def test_open_a_closed_season_is_refused(self):
        from django.utils import timezone
        closed = Season.objects.create(
            name='2024/2025', start_date=date(2024, 9, 1), end_date=date(2025, 8, 31),
            closed_at=timezone.now(),
        )
        with self.assertRaises(ValueError):
            open_season(closed, self.user)

    def test_open_with_no_incumbent_works(self):
        season = Season.objects.create(
            name='2026/2027', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
        )
        open_season(season, self.user)
        season.refresh_from_db()
        self.assertTrue(season.is_active)


class ClosePreviewTests(TestCase):
    def test_preview_returns_all_four_counters(self):
        season = Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
            is_active=True,
        )
        preview = close_preview(season)
        self.assertEqual(
            set(preview), {'drafts', 'in_transit', 'open_tasks', 'unfinished_plans'},
        )
        self.assertTrue(all(isinstance(v, int) for v in preview.values()))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test apps.core.tests_season_services --verbosity=2`
Expected: FAIL — `ModuleNotFoundError: No module named 'apps.core.services.season'`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/apps/core/services/season.py`:

```python
"""Season lifecycle operations.

Closing does not move, delete, or modify any data row (D2) — it flips two
columns on the Season and lets the read scope hide the rest.
"""
from django.db import transaction
from django.utils import timezone

from apps.core.models import Season


def close_season(season: Season, user) -> None:
    """Freeze and hide `season`.

    Atomic: sets closed_at/closed_by and clears is_active. Does NOT touch any
    shipment, plan, or contract row — unfinished work stays unfinished and
    becomes visible again only when the season is selected.

    Raises:
        ValueError: If `season` is already closed.
    """
    if season.is_closed:
        raise ValueError(f'Season {season.name} is already closed.')

    with transaction.atomic():
        Season.objects.filter(pk=season.pk).update(
            closed_at=timezone.now(), closed_by=user, is_active=False,
        )
        _audit(season, user, 'close')
    season.refresh_from_db()


def open_season(season: Season, user) -> None:
    """Make `season` the write target.

    Atomic: deactivates the incumbent and activates `season` in one transaction,
    so `uq_season_single_active` is never transiently violated.

    Raises:
        ValueError: If `season` is closed. Reopening is not supported — a season
            that can be reopened is not frozen, and every downstream report would
            have to assume its inputs can still change.
    """
    if season.is_closed:
        raise ValueError(
            f'Season {season.name} is closed and cannot be reopened.'
        )

    with transaction.atomic():
        Season.objects.filter(is_active=True).exclude(pk=season.pk).update(
            is_active=False,
        )
        Season.objects.filter(pk=season.pk).update(is_active=True)
        _audit(season, user, 'open')
    season.refresh_from_db()


def close_preview(season: Season) -> dict:
    """Counts of rows that closing `season` will hide.

    Advisory only — never blocks the close (D2). The confirmation dialog's copy
    is the entire mitigation for "14 trucks vanished from every board", so these
    numbers matter more than usual.
    """
    from apps.export.models import Shipment, Task
    from apps.greenhouse.models import WeeklyHarvestPlan

    shipments = Shipment.objects.filter(
        season=season, deleted_at__isnull=True, is_archived=False,
    )
    return {
        'drafts': shipments.filter(status__code='draft').count(),
        'in_transit': shipments.exclude(status__code='draft')
        .exclude(status__phase='COMPLETE').count(),
        'open_tasks': Task.objects.filter(
            shipment__season=season, completed_at__isnull=True,
        ).count(),
        'unfinished_plans': WeeklyHarvestPlan.objects.filter(
            season=season, submitted_at__isnull=True,
        ).count(),
    }


def _audit(season: Season, user, action: str) -> None:
    """Write an AuditLog row for the lifecycle change.

    AuditLog currently lives in `export/` (root CLAUDE.md notes it is slated to
    move to core). The import is function-local so `core/` keeps a clean
    module-level import graph.
    """
    from apps.export.models import AuditLog

    AuditLog.objects.create(
        user=user,
        action='update',
        model_name='Season',
        object_id=season.pk,
        object_repr=season.name,
        field_name='status',
        detail=f'Season {action}ed',
    )
```

> **Implementer notes:** `close_preview` guesses at field names — `Task.completed_at`, `WeeklyHarvestPlan.submitted_at`, `ShipmentStatusType.phase == 'COMPLETE'`. Read `export/models/task.py`, `greenhouse/models/harvest_plan.py`, and the `phase` choices before implementing; correct them to whatever the models actually use. The four dict keys must not change — the frontend and the tests depend on them.
>
> `AuditLog.action` choices are at `export/models/audit.py:33`. Use a real choice value.

Ensure `backend/apps/core/services/__init__.py` exists and re-exports:

```python
from .season import close_preview, close_season, open_season

__all__ = ['close_preview', 'close_season', 'open_season']
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python manage.py test apps.core.tests_season_services --verbosity=2`
Expected: PASS — 9 tests.

- [ ] **Step 5: Expose the endpoints**

In `backend/apps/export/views_admin.py`, extend the serializer at `:138-141`:

```python
class SeasonSerializer(serializers.ModelSerializer):
    status = serializers.CharField(read_only=True)
    closed_by_name = serializers.CharField(source='closed_by.username', read_only=True)

    class Meta:
        model = Season
        fields = [
            'id', 'name', 'start_date', 'end_date', 'is_active',
            'status', 'closed_at', 'closed_by', 'closed_by_name',
        ]
        read_only_fields = ['status', 'closed_at', 'closed_by', 'closed_by_name']
```

And the viewset at `:301-318`:

```python
class SeasonViewSet(ModelViewSet):
    resource_code = 'season'
    permission_classes = [IsAuthenticated, DynamicResourcePermission]
    serializer_class = SeasonSerializer
    queryset = Season.objects.all().order_by('-start_date')

    @action(detail=True, methods=['get'], url_path='close-preview')
    def close_preview_action(self, request, pk=None):
        """GET .../{id}/close-preview/ — counts for the confirm dialog."""
        return Response(close_preview(self.get_object()))

    @action(detail=True, methods=['post'])
    def close(self, request, pk=None):
        """POST .../{id}/close/ — freeze and hide the season."""
        season = self.get_object()
        try:
            close_season(season, request.user)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_409_CONFLICT)
        return Response(self.get_serializer(season).data)

    @action(detail=True, methods=['post'])
    def open(self, request, pk=None):
        """POST .../{id}/open/ — make this the write target."""
        season = self.get_object()
        try:
            open_season(season, request.user)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_409_CONFLICT)
        return Response(self.get_serializer(season).data)
```

`DynamicResourcePermission` maps POST → `can_create`. `close`/`open` are edits, not creations, so override the mapping for these two actions — the simplest correct approach is an explicit check at the top of each:

```python
        if not user_can(request.user, 'season', 'edit'):
            raise PermissionDenied('season.edit required.')
```

Read `core/permissions.py:108 get_resource_permissions()` and use the existing helper rather than adding a new one.

- [ ] **Step 6: Test the endpoints**

Append to `backend/apps/core/tests_season_services.py`:

```python
class SeasonEndpointTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        from django.core.management import call_command
        call_command('seed_permissions')
        cls.admin = User.objects.create(
            username='adm', role='admin', is_superuser=True,
        )
        cls.season = Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
            is_active=True,
        )

    def _client(self):
        from rest_framework.test import APIClient
        client = APIClient()
        client.force_authenticate(user=self.admin)
        return client

    def test_close_preview_returns_counters(self):
        response = self._client().get(
            f'/api/v1/export/admin/seasons/{self.season.pk}/close-preview/'
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn('in_transit', response.json())

    def test_close_endpoint_closes(self):
        response = self._client().post(
            f'/api/v1/export/admin/seasons/{self.season.pk}/close/'
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['status'], 'CLOSED')

    def test_close_twice_returns_409(self):
        client = self._client()
        client.post(f'/api/v1/export/admin/seasons/{self.season.pk}/close/')
        response = client.post(f'/api/v1/export/admin/seasons/{self.season.pk}/close/')
        self.assertEqual(response.status_code, 409)

    def test_open_endpoint_activates(self):
        successor = Season.objects.create(
            name='2026/2027', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
        )
        response = self._client().post(
            f'/api/v1/export/admin/seasons/{successor.pk}/open/'
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['status'], 'ACTIVE')
        self.season.refresh_from_db()
        self.assertFalse(self.season.is_active)
```

Run: `python manage.py test apps.core.tests_season_services --verbosity=2`
Expected: PASS — 13 tests.

- [ ] **Step 7: Commit**

```bash
git add backend/apps/core/services backend/apps/core/tests_season_services.py backend/apps/export/views_admin.py
git commit -m "feat(core): add close/open season services + admin endpoints"
```

---

### Task 11: Stop generators emitting into closed seasons

**Files:**
- Modify: `backend/apps/export/services/` — the task/notification generator (find via `grep -rn "reconcile_tasks" backend/apps/export/`)
- Modify: `backend/apps/export/tests_season_freeze.py` (append)

**Interfaces:**
- Consumes: `Season.is_closed` from Task 1.
- Produces: task and notification generators skip shipments whose season is closed.

**Why:** D2 leaves unfinished tasks unfinished at close. `Notification` cannot be season-scoped (spec §4.6 — it has no shipment FK, only `user` and a `link` string at `export/models/notification.py:52-68`). Without this guard, `reconcile_tasks` and the auto-close rules keep emitting fresh notifications linking into hidden data indefinitely.

- [ ] **Step 1: Write the failing test**

Append to `backend/apps/export/tests_season_freeze.py`:

```python
class GeneratorsSkipClosedSeasonsTests(SeasonFreezeTests):
    def test_reconcile_tasks_ignores_closed_season_shipments(self):
        from apps.export.models import Task

        before = Task.objects.filter(shipment__season=self.closed).count()
        call_command('reconcile_tasks')
        after = Task.objects.filter(shipment__season=self.closed).count()
        self.assertEqual(before, after)

    def test_reconcile_tasks_still_processes_active_season(self):
        """The guard must exclude closed seasons WITHOUT excluding open ones."""
        from apps.export.models import Task, TaskRule

        # Seed one rule that matches the active-season shipment's current state,
        # so reconcile_tasks has something concrete to create. Read
        # export/models/task.py for TaskRule's real required fields and adjust —
        # the assertion below must stay an exact count, never >= 0.
        TaskRule.objects.create(
            trigger_status=self.draft,
            assigned_role='warehouse_chief',
            title_tk='Test task',
        )
        call_command('reconcile_tasks')
        self.assertEqual(
            Task.objects.filter(shipment__season=self.active).count(), 1,
        )
        self.assertEqual(
            Task.objects.filter(shipment__season=self.closed).count(), 0,
        )
```

Add `from django.core.management import call_command` to the imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test apps.export.tests_season_freeze.GeneratorsSkipClosedSeasonsTests --verbosity=2`
Expected: FAIL if `reconcile_tasks` currently creates tasks for closed-season shipments. If it passes immediately, the generator already filters them out — verify by reading the source, then note it and move to Step 4.

- [ ] **Step 3: Write minimal implementation**

Locate the shipment queryset inside the generator and add the filter:

```python
        # Closed seasons are frozen (D1). Generating tasks or notifications for
        # them would surface links into data the user cannot reach — and
        # Notification has no season FK, so those rows can never be scoped away
        # afterwards (spec §4.6).
        shipments = shipments.filter(season__closed_at__isnull=True)
```

Apply the same filter to any notification-emitting poller found by:

```bash
grep -rn "Notification.objects.create" backend/apps/export/ | grep -v tests
```

- [ ] **Step 4: Run test to verify it passes**

```bash
python manage.py test apps.export.tests_season_freeze --verbosity=2
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/export
git commit -m "fix(export): stop task/notification generators from targeting closed seasons"
```

---

### Task 12: `/auth/me/` exposes the active season and permission

**Files:**
- Modify: the `/auth/me/` view (find via `grep -rn "def me" backend/apps/core/views*.py`)
- Modify: `backend/apps/core/tests_seasons.py` (append)

**Interfaces:**
- Consumes: `get_active_season`, `can_view_closed` from Task 2.
- Produces: `/api/v1/auth/me/` response gains `active_season: {id, name, status} | null` and `can_view_closed_seasons: bool`.

**Why here and not a second request:** this is what seeds the frontend season store on load. A second round-trip means the first render happens with no season selected, and every query fires twice.

- [ ] **Step 1: Write the failing test**

Append to `backend/apps/core/tests_seasons.py`:

```python
class AuthMeSeasonFieldsTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.season = Season.objects.create(
            name='2026/2027', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
            is_active=True,
        )
        cls.manager = User.objects.create(username='mgr', role='export_manager')
        cls.operator = User.objects.create(username='op', role='warehouse_chief')

    def _get_me(self, user):
        from rest_framework.test import APIClient
        client = APIClient()
        client.force_authenticate(user=user)
        return client.get('/api/v1/auth/me/')

    def test_me_returns_active_season(self):
        payload = self._get_me(self.manager).json()
        self.assertEqual(payload['active_season']['name'], '2026/2027')
        self.assertEqual(payload['active_season']['status'], 'ACTIVE')

    def test_me_returns_null_active_season_when_none_open(self):
        Season.objects.filter(pk=self.season.pk).update(is_active=False)
        payload = self._get_me(self.manager).json()
        self.assertIsNone(payload['active_season'])

    def test_me_reports_closed_season_permission(self):
        self.assertTrue(self._get_me(self.manager).json()['can_view_closed_seasons'])
        self.assertFalse(self._get_me(self.operator).json()['can_view_closed_seasons'])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test apps.core.tests_seasons.AuthMeSeasonFieldsTests --verbosity=2`
Expected: FAIL — `KeyError: 'active_season'`.

- [ ] **Step 3: Write minimal implementation**

In the `/auth/me/` view, add to the response dict:

```python
from apps.core.seasons import can_view_closed, get_active_season

    active = get_active_season()
    payload['active_season'] = (
        {'id': active.id, 'name': active.name, 'status': active.status}
        if active else None
    )
    payload['can_view_closed_seasons'] = can_view_closed(request.user)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python manage.py test apps.core --verbosity=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/core
git commit -m "feat(core): expose active_season + closed-season permission on /auth/me/"
```

---

# Phase 4 — Frontend

### Task 13: Season store, URL param, and types

**Files:**
- Create: `frontend/src/stores/seasonStore.ts`
- Create: `frontend/src/hooks/useSeasonParam.ts`
- Modify: `frontend/src/types/index.ts` (or wherever `ISeason` lives)
- Modify: `frontend/src/hooks/useAuth.ts`

**Interfaces:**
- Consumes: `/auth/me/` fields from Task 12.
- Produces:
  - `ISeason` gains `status: 'UPCOMING' | 'ACTIVE' | 'CLOSED'`, `closed_at: string | null`, `closed_by_name: string | null`
  - `useSeasonStore()` → `{ selectedSeasonId: number | null, setSelectedSeasonId: (id: number | null) => void }`
  - `useSeasonParam()` → `{ seasonId: number | null }`, mirrors the store to `?season=`

- [ ] **Step 1: Extend the types**

In `frontend/src/types/`, find `ISeason` and extend it:

```typescript
export type SeasonStatus = 'UPCOMING' | 'ACTIVE' | 'CLOSED';

export interface ISeason {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
  status: SeasonStatus;
  closed_at: string | null;
  closed_by: number | null;
  closed_by_name: string | null;
}

export interface ISeasonClosePreview {
  drafts: number;
  in_transit: number;
  open_tasks: number;
  unfinished_plans: number;
}
```

Extend the `/auth/me/` response interface:

```typescript
  active_season: { id: number; name: string; status: SeasonStatus } | null;
  can_view_closed_seasons: boolean;
```

- [ ] **Step 2: Create the store**

`frontend/src/stores/seasonStore.ts` — Zustand, because the selected season is cross-component UI state (per `frontend/CLAUDE.md`'s state-management table). It is **not** server data, so it does not belong in TanStack Query.

```typescript
import { create } from 'zustand';

interface ISeasonState {
  selectedSeasonId: number | null;
  setSelectedSeasonId: (id: number | null) => void;
}

export const useSeasonStore = create<ISeasonState>((set) => ({
  selectedSeasonId: null,
  setSelectedSeasonId: (id) => set({ selectedSeasonId: id }),
}));
```

- [ ] **Step 3: Create the URL-mirroring hook**

`frontend/src/hooks/useSeasonParam.ts`:

```typescript
import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSeasonStore } from '@/stores/seasonStore';
import { useAuth } from '@/hooks/useAuth';

interface IUseSeasonParamResult {
  seasonId: number | null;
}

/**
 * Keeps the selected season in the URL as `?season=<id>`.
 *
 * Without this, a shared link renders whatever season the recipient last
 * selected — silently wrong data with no visual difference.
 */
export function useSeasonParam(): IUseSeasonParamResult {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { selectedSeasonId, setSelectedSeasonId } = useSeasonStore();

  const urlSeason = searchParams.get('season');

  // URL wins on mount; the active season from /me/ is the fallback.
  useEffect(() => {
    const fromUrl = urlSeason ? Number(urlSeason) : null;
    if (fromUrl !== null && !Number.isNaN(fromUrl)) {
      if (fromUrl !== selectedSeasonId) setSelectedSeasonId(fromUrl);
      return;
    }
    if (selectedSeasonId === null && user?.active_season) {
      setSelectedSeasonId(user.active_season.id);
    }
  }, [urlSeason, selectedSeasonId, user, setSelectedSeasonId]);

  // Store → URL, but only once it diverges from the active season, so the
  // default view keeps a clean URL.
  useEffect(() => {
    if (selectedSeasonId === null) return;
    const isDefault = selectedSeasonId === user?.active_season?.id;
    const current = searchParams.get('season');
    if (isDefault && current === null) return;
    if (String(selectedSeasonId) === current) return;

    const next = new URLSearchParams(searchParams);
    if (isDefault) next.delete('season');
    else next.set('season', String(selectedSeasonId));
    setSearchParams(next, { replace: true });
  }, [selectedSeasonId, user, searchParams, setSearchParams]);

  return { seasonId: selectedSeasonId };
}
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/stores/seasonStore.ts frontend/src/hooks/useSeasonParam.ts frontend/src/types frontend/src/hooks/useAuth.ts
git commit -m "feat(frontend): add season store + URL-reflected season param"
```

---

### Task 14: Thread `seasonId` through every query key

**Files:**
- Modify: every hook in `frontend/src/hooks/` that queries a season-scoped endpoint

**Interfaces:**
- Consumes: `useSeasonParam()` from Task 13.
- Produces: every affected `queryKey` array includes `seasonId`, and every request sends `?season=<id>`.

**Why non-negotiable:** without `seasonId` in the key, switching seasons renders the previous season's cached rows until refetch. That looks exactly like the feature not working, and it is the single most likely bug in this phase.

- [ ] **Step 1: Enumerate the hooks to change**

```bash
cd frontend
grep -rln "useQuery" src/hooks/
```

Every hook backing an endpoint from spec §4.1 or §4.2 is in scope: shipments, sheet, board, comments, tasks, harvest plans, day entries, truck allocations, destination selections, local sell plans, contracts, sales, quota usage, advances, customs expenses, clients report, sales-rep coverage.

Hooks backing §4.5 opt-out endpoints are **not** in scope: seasons, firms, users, blocks, varieties, expense categories, packing templates, prices, quota issuances, domestic sales, audit log, notifications.

- [ ] **Step 2: Apply the pattern to each hook**

```typescript
// BEFORE
export function useShipments(filters: IShipmentFilters) {
  return useQuery({
    queryKey: ['shipments', filters],
    queryFn: () => api.get('/export/shipments/', { params: filters }),
  });
}

// AFTER
export function useShipments(filters: IShipmentFilters) {
  const { seasonId } = useSeasonParam();
  return useQuery({
    queryKey: ['shipments', seasonId, filters],
    queryFn: () =>
      api.get('/export/shipments/', {
        params: { ...filters, ...(seasonId ? { season: seasonId } : {}) },
      }),
    enabled: seasonId !== null,
  });
}
```

`enabled: seasonId !== null` prevents a first render firing an unscoped request before `/me/` resolves — otherwise every list flashes the wrong season's data.

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0`
Expected: no errors.

- [ ] **Step 4: Verify manually**

Start the dev server, log in, and confirm in the Network tab that `?season=` is present on a shipments request. Then close a season via the API and confirm the list drops its rows.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks
git commit -m "feat(frontend): scope every season-aware query key by seasonId"
```

---

### Task 15: Header switcher and read-only mode

**Files:**
- Create: `frontend/src/components/SeasonSwitcher.tsx`
- Create: `frontend/src/hooks/useSeasonReadOnly.ts`
- Create: `frontend/src/components/ClosedSeasonBanner.tsx`
- Modify: the app header/layout component
- Modify: `frontend/src/i18n/tk.json`, `ru.json`, `en.json`

**Interfaces:**
- Consumes: `useSeasons()` (`hooks/useAdmin.ts`), `useSeasonStore`, `useSeasonParam` from Task 13.
- Produces: `<SeasonSwitcher />`, `<ClosedSeasonBanner />`, `useSeasonReadOnly(): boolean`.

- [ ] **Step 1: Add the i18n keys**

Add to all three of `tk.json`, `ru.json`, `en.json` under a `season` namespace:

| Key | en | ru | tk |
|---|---|---|---|
| `season.switcher_label` | Season | Сезон | Möwsüm |
| `season.status_active` | Active | Активный | Işjeň |
| `season.status_closed` | Closed | Закрыт | Ýapyk |
| `season.status_upcoming` | Upcoming | Предстоящий | Öňümizdäki |
| `season.readonly_banner` | Viewing closed season {{name}} — read-only | Просмотр закрытого сезона {{name}} — только чтение | Ýapyk möwsüm {{name}} görülýär — diňe okamak |
| `season.back_to_active` | Back to active season | К активному сезону | Işjeň möwsüme dolan |
| `season.closed_error` | This season is closed and cannot be edited | Сезон закрыт, редактирование недоступно | Bu möwsüm ýapyk, üýtgedip bolmaýar |

- [ ] **Step 2: Write the switcher**

`frontend/src/components/SeasonSwitcher.tsx`:

```tsx
import { Select, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import { useSeasons } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import { useSeasonStore } from '@/stores/seasonStore';
import type { ISeason } from '@/types';

export function SeasonSwitcher(): JSX.Element | null {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data: seasons = [] } = useSeasons();
  const { selectedSeasonId, setSelectedSeasonId } = useSeasonStore();

  const canViewClosed = user?.can_view_closed_seasons ?? false;

  // Upcoming seasons are never listed — there is nothing in them to show.
  const selectable = seasons.filter(
    (s: ISeason) =>
      s.status === 'ACTIVE' || (s.status === 'CLOSED' && canViewClosed),
  );

  if (selectable.length <= 1) return null;

  return (
    <Select
      value={selectedSeasonId}
      onChange={setSelectedSeasonId}
      style={{ minWidth: 180 }}
      aria-label={t('season.switcher_label')}
      options={selectable.map((s: ISeason) => ({
        value: s.id,
        label: (
          <span>
            {s.name}{' '}
            {s.status === 'CLOSED' && (
              <Tag color="default">{t('season.status_closed')}</Tag>
            )}
          </span>
        ),
      }))}
    />
  );
}
```

- [ ] **Step 3: Write the read-only hook and banner**

`frontend/src/hooks/useSeasonReadOnly.ts`:

```typescript
import { useSeasons } from '@/hooks/useAdmin';
import { useSeasonStore } from '@/stores/seasonStore';
import type { ISeason } from '@/types';

/**
 * True when the selected season is closed.
 *
 * Drives the banner and every disabled control. The 409 from the API is the
 * safety net, not the mechanism — a user should never be able to click
 * something that 409s.
 */
export function useSeasonReadOnly(): boolean {
  const { selectedSeasonId } = useSeasonStore();
  const { data: seasons = [] } = useSeasons();
  const selected = seasons.find((s: ISeason) => s.id === selectedSeasonId);
  return selected?.status === 'CLOSED';
}
```

`frontend/src/components/ClosedSeasonBanner.tsx`:

```tsx
import { Alert, Button } from 'antd';
import { useTranslation } from 'react-i18next';
import { useSeasons } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import { useSeasonReadOnly } from '@/hooks/useSeasonReadOnly';
import { useSeasonStore } from '@/stores/seasonStore';
import type { ISeason } from '@/types';

export function ClosedSeasonBanner(): JSX.Element | null {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isReadOnly = useSeasonReadOnly();
  const { selectedSeasonId, setSelectedSeasonId } = useSeasonStore();
  const { data: seasons = [] } = useSeasons();

  if (!isReadOnly) return null;

  const selected = seasons.find((s: ISeason) => s.id === selectedSeasonId);
  const activeId = user?.active_season?.id ?? null;

  return (
    <Alert
      type="warning"
      showIcon
      banner
      message={t('season.readonly_banner', { name: selected?.name ?? '' })}
      action={
        activeId !== null && (
          <Button size="small" onClick={() => setSelectedSeasonId(activeId)}>
            {t('season.back_to_active')}
          </Button>
        )
      }
    />
  );
}
```

- [ ] **Step 4: Mount both in the layout**

Add `<SeasonSwitcher />` to the header next to the locale switcher, and `<ClosedSeasonBanner />` directly above the routed content. Call `useSeasonParam()` once in the layout so the URL sync runs app-wide.

- [ ] **Step 5: Disable controls in read-only mode**

In every page with create/edit/delete controls over season-scoped data, gate on the hook:

```tsx
const isReadOnly = useSeasonReadOnly();
<Button disabled={isReadOnly} onClick={handleCreate}>{t('...')}</Button>
```

Sheet cells: pass `isReadOnly` into the cell-editable check so no cell accepts focus.

- [ ] **Step 6: Typecheck and verify**

```bash
cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0
```

Then in the browser: switch to a closed season, confirm the banner appears, the list shows that season's rows, and every create/edit button is disabled.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components frontend/src/hooks frontend/src/i18n
git commit -m "feat(frontend): season switcher + closed-season read-only mode"
```

---

### Task 16: Close / Open on the admin Seasons page

**Files:**
- Modify: `frontend/src/pages/admin/SeasonsPage.tsx`
- Modify: `frontend/src/hooks/useAdmin.ts`
- Modify: `frontend/src/i18n/tk.json`, `ru.json`, `en.json`

**Interfaces:**
- Consumes: the endpoints from Task 10, `ISeasonClosePreview` from Task 13.
- Produces: `useCloseSeason()`, `useOpenSeason()`, `useSeasonClosePreview(id)` and the corresponding UI.

- [ ] **Step 1: Add the i18n keys**

| Key | en |
|---|---|
| `seasons.close_button` | Close season |
| `seasons.open_button` | Open season |
| `seasons.close_confirm_title` | Close {{name}}? |
| `seasons.close_confirm_body` | Closing {{name}} will hide {{drafts}} drafts, {{in_transit}} shipments in transit, and {{open_tasks}} open tasks. They are not deleted and remain visible when this season is selected. |
| `seasons.toast_closed` | Season closed |
| `seasons.toast_opened` | Season opened |
| `seasons.status_column` | Status |

Add Russian and Turkmen translations for each. **Never** copy the English into `ru.json`/`tk.json` as a placeholder.

- [ ] **Step 2: Add the hooks**

In `frontend/src/hooks/useAdmin.ts`, following the existing `useCreateSeason`/`useUpdateSeason` pattern:

```typescript
export function useSeasonClosePreview(seasonId: number | null) {
  return useQuery({
    queryKey: ['season-close-preview', seasonId],
    queryFn: () =>
      api.get<ISeasonClosePreview>(
        `/export/admin/seasons/${seasonId}/close-preview/`,
      ).then((r) => r.data),
    enabled: seasonId !== null,
  });
}

export function useCloseSeason(options?: IMutationOptions) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      api.post(`/export/admin/seasons/${id}/close/`).then((r) => r.data),
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: ['seasons'] });
      options?.onSuccess?.(...args);
    },
    onError: options?.onError,
  });
}
```

`useOpenSeason` is identical with `/open/`.

- [ ] **Step 3: Add the status column and action buttons**

In `SeasonsPage.tsx`, add a status column with the sorter pattern from `frontend/CLAUDE.md`:

```tsx
{
  title: t('seasons.status_column'),
  dataIndex: 'status',
  sorter: (a: ISeason, b: ISeason) => a.status.localeCompare(b.status),
  render: (_, record: ISeason) => {
    const color =
      record.status === 'ACTIVE' ? 'green'
      : record.status === 'CLOSED' ? 'default'
      : 'blue';
    return <Tag color={color}>{t(`season.status_${record.status.toLowerCase()}`)}</Tag>;
  },
},
```

Action buttons per row:
- `status === 'ACTIVE'` → **Close season** (opens the confirm modal)
- `status === 'UPCOMING'` → **Open season**
- `status === 'CLOSED'` → neither (reopening is not supported)

Both gated on `canEditSeason`, which the page already computes at line 38.

- [ ] **Step 4: Add the confirm modal**

The modal fetches `useSeasonClosePreview(closeTarget?.id ?? null)` and renders the interpolated body. Per D2 the close is never blocked — this copy is the entire mitigation for "14 trucks vanished from every board", so it must show real numbers, not a generic warning.

- [ ] **Step 5: Typecheck and verify end to end**

```bash
cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0
```

In the browser: close a season, confirm the counts in the dialog are real, confirm the shipment list immediately drops those rows, switch to the closed season, confirm the rows reappear read-only, then open the next season and confirm new shipments land in it.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/admin/SeasonsPage.tsx frontend/src/hooks/useAdmin.ts frontend/src/i18n
git commit -m "feat(frontend): close/open season actions on the admin Seasons page"
```

---

# Phase 5 — Documentation

### Task 17: ADR, Obsidian vault, CHANGELOG, build log

**Files:**
- Modify: `docs/ADR.md`
- Modify: `docs/obsidian/` — the relevant model/endpoint/component notes plus `00-index.md`
- Modify: `CHANGELOG.md`
- Modify: `BUILD_TEST_LOG.md`
- Modify: `.claude/skills/api-contract/SKILL.md`

- [ ] **Step 1: Add the ADR**

Append to `docs/ADR.md` as **AD-16: Season lifecycle**. Cover: the `is_active` split into write-target vs read-scope; why state is derived rather than stored; the `closed_season` resource and its archive coupling (spec §9.1); why closing does not mutate rows (D2); and why reopening is unsupported. Link to `docs/superpowers/specs/2026-08-03-season-lifecycle-design.md`.

- [ ] **Step 2: Update the Obsidian vault**

Per the root `CLAUDE.md` rule, every changed feature, component, endpoint, and model gets its doc updated. At minimum: the `Season` model note, the shipments endpoint note, a new `SeasonSwitcher` component note, and the permissions note (new `closed_season` resource). Add any new note to `docs/obsidian/00-index.md`.

- [ ] **Step 3: Update the API contract skill**

Add to `.claude/skills/api-contract/SKILL.md`: the `?season=<id>` param convention, the `409 season_closed` error shape, and the new `/auth/me/` fields.

- [ ] **Step 4: Update CHANGELOG**

Under `[Unreleased]`, Keep-a-Changelog style:

```markdown
### Added
- Season lifecycle: close a season (frozen + hidden), open the next one, switch to a past season via the header switcher (AD-16)
- `closed_season` permission resource — admin-configurable per role
- `?season=<id>` on every season-scoped endpoint; `409 season_closed` on writes to a closed season

### Changed
- `Season.is_active` is now the write target only; read scope resolves per-request
- At most one season may be active — enforced by a filtered unique index
- Inside a closed season the `is_archived` operational/archive split is bypassed

### Data
- Backfilled nullable `season` FKs on contracts and local sell plans
```

- [ ] **Step 5: Log the build for testing**

Add to the top of `BUILD_TEST_LOG.md`:

```markdown
- [ ] 2026-08-03 — Season lifecycle: close/open season, read scoping, read-only mode, header switcher — NEEDS TEST
```

- [ ] **Step 6: Run the full suite one last time**

```bash
cd backend && python manage.py test apps.core apps.export apps.greenhouse apps.contracts --verbosity=2
cd ../frontend && npx tsc --noEmit --ignoreDeprecations 5.0
```

Report which suites passed and how the results compare to the `docs/PRE_EXISTING_TEST_FAILURES.md` baseline. State plainly: **"Built — NOT tested by a human yet. Did you test it?"**

- [ ] **Step 7: Commit**

```bash
git add docs CHANGELOG.md BUILD_TEST_LOG.md .claude/skills/api-contract/SKILL.md
git commit -m "docs: document season lifecycle (AD-16)"
```

---

## Open items for the user

These are decisions made on the user's behalf during design. Each is cheap to flip; none blocks implementation.

1. **D2 — unfinished rows are hidden, not blocked.** Closing a season with 14 trucks in transit makes them vanish from every board at once. The close-preview dialog is the only mitigation. The alternative (block the close until every row is resolved) is a small change to `close_season`.
2. **§9.1 — `closed_season.can_view` implies archive-level read** for closed seasons, including historical buyer prices. Harmless at seed time (same five roles as `_ARCHIVE_VIEW_ROLES`); it bites the first time an admin grants the permission to a sixth role.
3. **Reopening a closed season is unsupported.** Adding it later is an `open_season()` variant that clears `closed_at` behind an admin-only permission.
4. **`Notification` and `AuditLog` are not season-scoped** — structurally impossible (no FK). Task 11 stops *new* notifications about closed-season shipments, but pre-existing ones keep their links.
