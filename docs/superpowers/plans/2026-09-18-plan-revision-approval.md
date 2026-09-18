# Weekly Plan In-Week Revision Approval — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Once a plan week has started, a greenhouse manager's plan edit becomes a ±15%-bounded change request that an export manager (or admin/boss) approves or rejects, and every request is kept as a log.

**Architecture:** A new `greenhouse.PlanChangeRequest` table holds the pending value and doubles as the change log. `set_plan_value()` stays the single write path. For a greenhouse manager on a started week it routes to `request_plan_change()` instead of writing `plan_value`. Approve/reject live in `greenhouse/services/plan_change_service.py` behind a small read-only viewset with two POST actions. The frontend adds a pending badge to `HarvestCell` and a "Plan changes" drawer on the Weekly Plan page.

**Tech Stack:** Django 5 + DRF on MSSQL (mssql-django), React + TypeScript + AntD + TanStack Query, vitest.

**Spec:** `docs/superpowers/specs/2026-09-18-plan-revision-approval-design.md`

## Global Constraints

- MSSQL: no JSONField/ArrayField/DISTINCT ON; `bulk_create(..., batch_size=500)`; CharFields holding Cyrillic/Turkmen text get `**cyrillic_collation()`; `max_length` always set.
- Weight columns mirror the existing `HarvestDayEntry` ones: `DecimalField(max_digits=10, decimal_places=2)`.
- User FKs on greenhouse models: `on_delete=models.SET_NULL, null=True, blank=True, related_name='+'`.
- Dependencies: `core ← greenhouse ← export`. greenhouse may import `Notification`/`AuditLog` from export (documented temporary exception) but nothing else from export. No Django signals.
- Approvers: `export_manager`, `admin`, `boss` (+ superusers). **Not** `document_team`, even though it is in `EXPORT_MANAGER_LIKE`. The spec names export_manager only.
- Cap: `GreenhouseConfig.plan_change_max_pct`, default `15.00`.
- Week-start moment: Monday 00:00 in `GreenhouseConfig.timezone_name` (Asia/Ashgabat).
- **Do not touch `_plan_edit_window_closed()`.** Week start is a mode switch, not a lock (June 2026 fix: managers edit the current week's past days).
- **Commits:** CLAUDE.md forbids committing without the user's explicit word "commit". Each task ends with a *prepared* commit. Run it only if the user has said "commit" for this work. Otherwise skip the commit step and continue. Another session shares this worktree: before any commit, check `git diff --cached` is empty, then stage **only** the files the task lists.
- Co-author trailer on commits: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- Backend tests: run from `backend/`, **one `manage.py test` at a time** (two concurrent runs share the test DB and deadlock).
- Frontend typecheck: `npx tsc --noEmit --ignoreDeprecations 5.0` (`npm run type-check` is broken).
- After `makemigrations`, run `migrate <app>` yourself and confirm with `showmigrations <app>`.

## File map

| File | Status | Responsibility |
|---|---|---|
| `backend/apps/greenhouse/models/plan_change_request.py` | create | `PlanChangeRequest` model |
| `backend/apps/greenhouse/models/__init__.py` | modify | re-export |
| `backend/apps/greenhouse/models/harvest_day_entry.py` | modify | `plan_baseline_value` |
| `backend/apps/core/models/config.py` | modify | `plan_change_max_pct` |
| `backend/apps/core/serializers.py` | modify | expose the config field |
| `backend/apps/greenhouse/services/plan_change_service.py` | create | week-start check, request / approve / reject, notifications |
| `backend/apps/greenhouse/services/harvest_day_service.py` | modify | route GM in-week edits; admin baseline reset |
| `backend/apps/greenhouse/serializers.py` | modify | brief + full request serializers; day-entry fields |
| `backend/apps/greenhouse/views.py` | modify | day-entry prefetch + 202 |
| `backend/apps/greenhouse/views_plan_changes.py` | create | `PlanChangeRequestViewSet` |
| `backend/apps/greenhouse/urls.py` | modify | register route |
| `backend/apps/export/models/notification.py` | modify | 3 new kinds |
| `backend/apps/greenhouse/tests/plan_change_fixtures.py` | create | shared test world |
| `backend/apps/greenhouse/tests/test_plan_change_model.py` | create | model + config |
| `backend/apps/greenhouse/tests/test_plan_change_request.py` | create | request path |
| `backend/apps/greenhouse/tests/test_plan_change_decisions.py` | create | approve / reject / admin reset |
| `backend/apps/greenhouse/tests/test_plan_change_api.py` | create | endpoints |
| `backend/apps/greenhouse/tests/test_late_edit_extension.py` | modify | 2 tests now expect a request |
| `frontend/src/types/index.ts` | modify | types |
| `frontend/src/mock/planning.ts`, `frontend/src/hooks/useGreenhouseConfig.ts` | modify | new required fields |
| `frontend/src/hooks/usePlanning.ts` | modify | list / approve / reject hooks |
| `frontend/src/pages/export/WeeklyPlanGrid.roles.ts` (+ test) | modify | `canDecidePlanChanges` |
| `frontend/src/i18n/{en,ru,tk}.json` | modify | keys |
| `frontend/src/components/HarvestCell.helpers.ts` | modify | `planChangeRange()` |
| `frontend/src/components/HarvestCell.tsx` | modify | pending badge, range hint/check |
| `frontend/src/components/PlanChangeRequestsDrawer.tsx` | create | the log / approval drawer |
| `frontend/src/pages/export/WeeklyPlanGrid.tsx` | modify | toolbar button, drawer, toasts, new cell props |
| docs (ADR, obsidian, api-contract, CHANGELOG, BUILD_TEST_LOG) | modify | Task 9 |

---

### Task 1: Data model — `PlanChangeRequest`, baseline column, config cap

**Files:**
- Create: `backend/apps/greenhouse/models/plan_change_request.py`
- Modify: `backend/apps/greenhouse/models/__init__.py`
- Modify: `backend/apps/greenhouse/models/harvest_day_entry.py` (Plan group, after `plan_state`; `Meta.constraints`)
- Modify: `backend/apps/core/models/config.py` (after the `# === Transport ===` group)
- Modify: `backend/apps/core/serializers.py:228-255` (`GreenhouseConfigSerializer`)
- Create: `backend/apps/greenhouse/tests/plan_change_fixtures.py`
- Test: `backend/apps/greenhouse/tests/test_plan_change_model.py`
- Generated: `backend/apps/greenhouse/migrations/0007_*.py`, `backend/apps/core/migrations/0052_*.py`

**Interfaces:**
- Produces: `PlanChangeRequest` with constants `STATUS_PENDING/APPROVED/REJECTED/SUPERSEDED`, reverse accessor `HarvestDayEntry.change_requests`, property `freeze_season`; `HarvestDayEntry.plan_baseline_value`; `GreenhouseConfig.plan_change_max_pct` (Decimal).
- Produces (tests): `plan_change_fixtures.build_world(prefix) -> SimpleNamespace(season, block, plan, users)`, where `users` is a dict keyed by role: `greenhouse_manager, export_manager, admin, boss, director, document_team`. Also `make_entry(world, weekday=0, plan_value=None, baseline=None, plan_state='') -> HarvestDayEntry`, `frozen_now(now_utc)` context manager, and constants `BEFORE_WEEK_UTC`, `IN_WEEK_UTC`, `AFTER_WEEK_UTC` for ISO week 2026-W24.

- [ ] **Step 1: Write the shared fixtures**

`backend/apps/greenhouse/tests/plan_change_fixtures.py`:

```python
"""Shared fixtures for the plan-change-request test modules (ADR-024).

The plan week under test is ISO 2026-W24 = Mon 2026-06-08 … Sun 2026-06-14,
Asia/Ashgabat (UTC+5). `frozen_now` pins `timezone.now()` inside
harvest_day_service, the module `set_plan_value()` reads the clock from.
"""
from contextlib import contextmanager
from datetime import date, datetime, timezone as dt_timezone
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model

from apps.core.models import GreenhouseBlock, GreenhouseConfig, Season
from apps.greenhouse.models import BlockManagerAssignment, HarvestDayEntry, WeeklyHarvestPlan

WEEK = (2026, 24)
BEFORE_WEEK_UTC = datetime(2026, 6, 5, 7, 0, tzinfo=dt_timezone.utc)   # Fri 12:00 local — week not started
IN_WEEK_UTC = datetime(2026, 6, 10, 7, 0, tzinfo=dt_timezone.utc)      # Wed 12:00 local — week started
AFTER_WEEK_UTC = datetime(2026, 6, 14, 19, 1, tzinfo=dt_timezone.utc)  # Mon 00:01 local of W25 — week ended

ROLES = ('greenhouse_manager', 'export_manager', 'admin', 'boss', 'director', 'document_team')


def build_world(prefix: str) -> SimpleNamespace:
    """Season, block, W24 plan container, one user per role, and the manager's block assignment."""
    User = get_user_model()
    GreenhouseConfig.get_solo()
    season, _ = Season.objects.get_or_create(
        name=f'{prefix}-S',
        defaults={'start_date': '2025-09-01', 'end_date': '2026-08-31', 'is_active': True},
    )
    block, _ = GreenhouseBlock.objects.get_or_create(
        code=f'{prefix}-A', defaults={'name': f'{prefix} Block A', 'is_active': True},
    )
    users = {
        role: User.objects.create_user(username=f'{prefix}_{role}', password='pass', role=role)
        for role in ROLES
    }
    BlockManagerAssignment.objects.create(user=users['greenhouse_manager'], block=block, is_active=True)
    plan, _ = WeeklyHarvestPlan.objects.get_or_create(
        season=season, block=block, year=WEEK[0], week_number=WEEK[1],
    )
    return SimpleNamespace(season=season, block=block, plan=plan, users=users)


def make_entry(world, weekday: int = 0, plan_value=None, baseline=None, plan_state: str = '') -> HarvestDayEntry:
    """One W24 day cell for the world's block."""
    return HarvestDayEntry.objects.create(
        weekly_plan=world.plan,
        season=world.season,
        block=world.block,
        entry_date=date.fromisocalendar(WEEK[0], WEEK[1], weekday + 1),
        weekday=weekday,
        plan_value=plan_value,
        plan_baseline_value=baseline,
        plan_state=plan_state,
    )


@contextmanager
def frozen_now(now_utc: datetime):
    """Pin `timezone.now()` inside harvest_day_service for the duration of the block."""
    with patch('apps.greenhouse.services.harvest_day_service.timezone') as mock_tz:
        mock_tz.now.return_value = now_utc
        mock_tz.utc = dt_timezone.utc
        yield
```

- [ ] **Step 2: Write the failing model tests**

`backend/apps/greenhouse/tests/test_plan_change_model.py`:

```python
"""PlanChangeRequest model + GreenhouseConfig.plan_change_max_pct (ADR-024).

Usage:
    python manage.py test apps.greenhouse.tests.test_plan_change_model --verbosity=2
"""
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.test import TestCase

from apps.core.models import GreenhouseConfig
from apps.core.serializers import GreenhouseConfigSerializer
from apps.greenhouse.models import PlanChangeRequest
from apps.greenhouse.tests.plan_change_fixtures import build_world, make_entry


class TestPlanChangeRequestModel(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.w = build_world('PCM')

    def test_a_cell_can_hold_only_one_pending_request(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        PlanChangeRequest.objects.create(entry=entry, requested_value=Decimal('10500'))
        with self.assertRaises(IntegrityError), transaction.atomic():
            PlanChangeRequest.objects.create(entry=entry, requested_value=Decimal('11000'))

    def test_decided_requests_do_not_count_toward_the_one_pending_rule(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        for status in ('superseded', 'rejected', 'approved'):
            PlanChangeRequest.objects.create(entry=entry, requested_value=Decimal('10500'), status=status)
        PlanChangeRequest.objects.create(entry=entry, requested_value=Decimal('10600'))
        self.assertEqual(entry.change_requests.count(), 4)

    def test_negative_requested_value_is_rejected_by_db(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        with self.assertRaises(IntegrityError), transaction.atomic():
            PlanChangeRequest.objects.create(entry=entry, requested_value=Decimal('-1'))

    def test_freeze_season_is_the_entry_season(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        change = PlanChangeRequest.objects.create(entry=entry, requested_value=Decimal('10500'))
        self.assertEqual(change.freeze_season, self.w.season)

    def test_baseline_column_defaults_to_null(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        entry.refresh_from_db()
        self.assertIsNone(entry.plan_baseline_value)


class TestPlanChangeCapConfig(TestCase):
    def test_default_cap_is_15_percent(self):
        self.assertEqual(GreenhouseConfig.get_solo().plan_change_max_pct, Decimal('15.00'))

    def test_cap_is_exposed_on_the_config_api(self):
        data = GreenhouseConfigSerializer(GreenhouseConfig.get_solo()).data
        self.assertEqual(data['plan_change_max_pct'], '15.00')
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `cd backend && python manage.py test apps.greenhouse.tests.test_plan_change_model --verbosity=2`
Expected: ERROR, `ImportError: cannot import name 'PlanChangeRequest'`.

- [ ] **Step 4: Create the model**

`backend/apps/greenhouse/models/plan_change_request.py`:

```python
"""In-week revision requests for a HarvestDayEntry plan value (ADR-024)."""
from django.db import models
from django.utils import timezone

from apps.core.db_utils import cyrillic_collation, schema_table


class PlanChangeRequest(models.Model):
    """A greenhouse manager's request to revise one day's plan after the week started.

    Holds the pending value until an export manager (or admin/boss) decides, and
    doubles as the change log: rows are never deleted, only moved out of `pending`.
    `plan_value` on the entry keeps the last APPROVED value the whole time.

    DDL: export.plan_change_requests
    """

    STATUS_PENDING = 'pending'
    STATUS_APPROVED = 'approved'
    STATUS_REJECTED = 'rejected'
    STATUS_SUPERSEDED = 'superseded'
    STATUS_CHOICES = [
        (STATUS_PENDING, 'pending'),
        (STATUS_APPROVED, 'approved'),
        (STATUS_REJECTED, 'rejected'),
        (STATUS_SUPERSEDED, 'superseded'),
    ]

    # === Target cell ===
    entry = models.ForeignKey(
        'greenhouse.HarvestDayEntry',
        on_delete=models.CASCADE,
        related_name='change_requests',
    )

    # === Values ===
    baseline_value = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
        help_text='Week-start baseline at request time. NULL = empty cell (no % bound).',
    )
    current_value = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
        help_text='Approved plan_value at request time.',
    )
    requested_value = models.DecimalField(max_digits=10, decimal_places=2)
    change_pct = models.DecimalField(
        max_digits=6, decimal_places=2, null=True, blank=True,
        help_text='(requested - baseline) / baseline * 100. NULL when no bound applies.',
    )

    # === Workflow ===
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=STATUS_PENDING)
    reason = models.CharField(max_length=500, blank=True, default='', **cyrillic_collation())
    requested_by = models.ForeignKey(
        'core.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='+',
    )
    requested_at = models.DateTimeField(default=timezone.now)
    decided_by = models.ForeignKey(
        'core.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='+',
        help_text='Approver/rejecter, or the user whose action superseded the request.',
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_note = models.CharField(max_length=500, blank=True, default='', **cyrillic_collation())

    class Meta:
        db_table = schema_table('export', 'plan_change_requests')
        constraints = [
            models.UniqueConstraint(
                fields=['entry'],
                condition=models.Q(status='pending'),
                name='uq_pcr_one_pending',
            ),
            models.CheckConstraint(
                check=models.Q(requested_value__gte=0),
                name='chk_pcr_requested_gte0',
            ),
        ]
        indexes = [
            models.Index(fields=['status', 'requested_at'], name='ix_pcr_status_requested'),
        ]
        ordering = ['-requested_at']

    def __str__(self) -> str:
        return f'PlanChangeRequest #{self.pk} entry={self.entry_id} {self.status}'

    @property
    def freeze_season(self):
        """Season anchor for the closed-season write freeze (`core.seasons.freeze_season_of`)."""
        return self.entry.season
```

- [ ] **Step 5: Re-export it**

In `backend/apps/greenhouse/models/__init__.py` add the import after `from .domestic_sale import DomesticSale` and the name to `__all__`:

```python
from .plan_change_request import PlanChangeRequest
```
```python
    'PlanChangeRequest',
```

- [ ] **Step 6: Add the baseline column to `HarvestDayEntry`**

In `backend/apps/greenhouse/models/harvest_day_entry.py`, right after the `plan_state` field (end of the `# === Plan ===` group):

```python
    plan_baseline_value = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text='Week-start plan, frozen on the first in-week change request (ADR-024). '
                  'The ±plan_change_max_pct bound is measured against it.',
    )
```

And in `Meta.constraints`, after `chk_hde_plan_gte0`:

```python
            models.CheckConstraint(
                check=models.Q(plan_baseline_value__isnull=True) | models.Q(plan_baseline_value__gte=0),
                name='chk_hde_baseline_gte0',
            ),
```

- [ ] **Step 7: Add the cap to `GreenhouseConfig`**

In `backend/apps/core/models/config.py`, after the `truck_capacity_kg` field:

```python
    # === Plan revisions (ADR-024) ===
    plan_change_max_pct = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal('15.00'),
        help_text='Max ± % a greenhouse manager may revise a started week\'s plan cell, '
                  'measured against the cell\'s week-start baseline.',
    )
```

In `backend/apps/core/serializers.py` `GreenhouseConfigSerializer`, declare the field next to `truck_capacity_kg`:

```python
    plan_change_max_pct = serializers.DecimalField(
        max_digits=5, decimal_places=2, min_value=Decimal('0.00'), max_value=Decimal('100.00'),
    )
```

and add `'plan_change_max_pct'` to `Meta.fields` right after `'truck_capacity_kg'`.

- [ ] **Step 8: Generate and apply the migrations**

Run:
```bash
cd backend
python manage.py makemigrations greenhouse core
python manage.py migrate greenhouse
python manage.py migrate core
python manage.py showmigrations greenhouse core | tail -4
```
Expected: `greenhouse/migrations/0007_…py` (PlanChangeRequest + plan_baseline_value + constraint) and `core/migrations/0052_…py` (plan_change_max_pct), both `[X]`. Open the greenhouse migration and confirm the `UniqueConstraint` carries `condition=`. The project already ships filtered unique constraints on MSSQL (`core/models/products.py`, `contracts/models/contract_sale.py`), so this is supported.

- [ ] **Step 9: Run the tests and confirm they pass**

Run: `python manage.py test apps.greenhouse.tests.test_plan_change_model --verbosity=2`
Expected: 7 tests, OK.

- [ ] **Step 10: Prepared commit** (only if the user said "commit")

```bash
git diff --cached --quiet || { echo "index not empty — stop"; exit 1; }
git add backend/apps/greenhouse/models/plan_change_request.py backend/apps/greenhouse/models/__init__.py \
  backend/apps/greenhouse/models/harvest_day_entry.py backend/apps/core/models/config.py \
  backend/apps/core/serializers.py backend/apps/greenhouse/migrations/0007_*.py \
  backend/apps/core/migrations/0052_*.py backend/apps/greenhouse/tests/plan_change_fixtures.py \
  backend/apps/greenhouse/tests/test_plan_change_model.py
git commit -m "feat(p3): add PlanChangeRequest model and plan revision cap

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Request path — route a manager's in-week edit to a pending request

**Files:**
- Create: `backend/apps/greenhouse/services/plan_change_service.py`
- Modify: `backend/apps/greenhouse/services/harvest_day_service.py:212-301` (`set_plan_value`)
- Modify: `backend/apps/greenhouse/services/__init__.py`
- Modify: `backend/apps/greenhouse/tests/test_late_edit_extension.py:224-278` (two tests)
- Test: `backend/apps/greenhouse/tests/test_plan_change_request.py`

**Interfaces:**
- Consumes: Task 1 model, fixtures.
- Produces:
  - `plan_week_started(weekly_plan, now_utc: datetime) -> bool`
  - `request_plan_change(entry, value, user, reason: str = '') -> PlanChangeRequest | None` (None = withdrawal; raises `ValueError`)
  - `supersede_pending(entry, user) -> int`
  - `set_plan_value(...)` now returns `PlanChangeRequest | None`
  - Notification kind string `'plan_change_requested'`

- [ ] **Step 1: Write the failing tests**

`backend/apps/greenhouse/tests/test_plan_change_request.py`:

```python
"""Request path of in-week plan revisions (ADR-024).

Usage:
    python manage.py test apps.greenhouse.tests.test_plan_change_request --verbosity=2
"""
from datetime import timedelta
from decimal import Decimal

from django.test import TestCase

from apps.core.models import GreenhouseConfig
from apps.export.models import Notification
from apps.greenhouse.models import PlanChangeRequest
from apps.greenhouse.services.harvest_day_service import set_plan_value
from apps.greenhouse.services.plan_change_service import request_plan_change
from apps.greenhouse.tests.plan_change_fixtures import (
    AFTER_WEEK_UTC, BEFORE_WEEK_UTC, IN_WEEK_UTC, build_world, frozen_now, make_entry,
)


class TestRouting(TestCase):
    """set_plan_value decides direct write vs. request by the week-start moment."""

    @classmethod
    def setUpTestData(cls):
        cls.w = build_world('PCR')

    def setUp(self):
        self.gm = self.w.users['greenhouse_manager']

    def test_before_week_start_a_manager_edit_writes_directly(self):
        entry = make_entry(self.w, plan_value=None)
        with frozen_now(BEFORE_WEEK_UTC):
            result = set_plan_value(entry, Decimal('10000'), self.gm)
        entry.refresh_from_db()
        self.assertIsNone(result)
        self.assertEqual(entry.plan_value, Decimal('10000'))
        self.assertFalse(entry.change_requests.exists())

    def test_in_week_a_manager_edit_becomes_a_pending_request(self):
        entry = make_entry(self.w, weekday=2, plan_value=Decimal('10000'))
        with frozen_now(IN_WEEK_UTC):
            change = set_plan_value(entry, Decimal('11000'), self.gm, 'cold snap')
        entry.refresh_from_db()
        self.assertEqual(entry.plan_value, Decimal('10000'))          # old value stays live
        self.assertEqual(entry.plan_baseline_value, Decimal('10000'))  # baseline frozen
        self.assertEqual(change.status, PlanChangeRequest.STATUS_PENDING)
        self.assertEqual(change.requested_value, Decimal('11000'))
        self.assertEqual(change.current_value, Decimal('10000'))
        self.assertEqual(change.change_pct, Decimal('10.00'))
        self.assertEqual(change.reason, 'cold snap')
        self.assertEqual(change.requested_by, self.gm)

    def test_a_past_day_of_the_current_week_is_still_revisable(self):
        """Regression for the June 2026 fix — Monday already passed on Wednesday."""
        entry = make_entry(self.w, weekday=0, plan_value=Decimal('10000'))
        with frozen_now(IN_WEEK_UTC):
            change = set_plan_value(entry, Decimal('9000'), self.gm)
        self.assertEqual(change.change_pct, Decimal('-10.00'))

    def test_a_fully_past_week_is_still_locked(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        with frozen_now(AFTER_WEEK_UTC), self.assertRaises(PermissionError):
            set_plan_value(entry, Decimal('10500'), self.gm)

    def test_a_late_edit_grant_goes_through_the_request_path(self):
        self.w.plan.late_edit_granted_until = AFTER_WEEK_UTC + timedelta(days=1)
        self.w.plan.save(update_fields=['late_edit_granted_until'])
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        with frozen_now(AFTER_WEEK_UTC):
            change = set_plan_value(entry, Decimal('10500'), self.gm)
        self.assertEqual(change.status, PlanChangeRequest.STATUS_PENDING)


class TestBound(TestCase):
    """±plan_change_max_pct against the week-start baseline."""

    @classmethod
    def setUpTestData(cls):
        cls.w = build_world('PCB')

    def setUp(self):
        self.gm = self.w.users['greenhouse_manager']

    def test_exactly_plus_15_percent_is_allowed(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        self.assertEqual(request_plan_change(entry, Decimal('11500'), self.gm).change_pct, Decimal('15.00'))

    def test_exactly_minus_15_percent_is_allowed(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        self.assertEqual(request_plan_change(entry, Decimal('8500'), self.gm).change_pct, Decimal('-15.00'))

    def test_over_the_cap_is_refused_and_names_the_range(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        with self.assertRaises(ValueError) as ctx:
            request_plan_change(entry, Decimal('11501'), self.gm)
        self.assertIn('8,500–11,500', str(ctx.exception))
        self.assertFalse(entry.change_requests.exists())
        entry.refresh_from_db()
        self.assertIsNone(entry.plan_baseline_value)  # refused request freezes nothing

    def test_the_bound_is_cumulative_against_the_baseline(self):
        entry = make_entry(self.w, plan_value=Decimal('11500'), baseline=Decimal('10000'))
        with self.assertRaises(ValueError):
            request_plan_change(entry, Decimal('12000'), self.gm)

    def test_an_empty_cell_has_no_bound(self):
        entry = make_entry(self.w, plan_value=None)
        change = request_plan_change(entry, Decimal('50000'), self.gm)
        self.assertIsNone(change.change_pct)
        self.assertIsNone(change.baseline_value)

    def test_a_zero_baseline_has_no_bound_and_is_not_frozen(self):
        entry = make_entry(self.w, plan_value=Decimal('0'))
        change = request_plan_change(entry, Decimal('8000'), self.gm)
        self.assertIsNone(change.change_pct)
        entry.refresh_from_db()
        self.assertIsNone(entry.plan_baseline_value)  # re-derives from the approved value next time

    def test_the_configured_cap_is_used(self):
        config = GreenhouseConfig.get_solo()
        config.plan_change_max_pct = Decimal('10.00')
        config.save()
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        with self.assertRaises(ValueError):
            request_plan_change(entry, Decimal('11100'), self.gm)


class TestLifecycle(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.w = build_world('PCL')

    def setUp(self):
        self.gm = self.w.users['greenhouse_manager']

    def test_a_second_request_supersedes_the_first(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        first = request_plan_change(entry, Decimal('10500'), self.gm)
        second = request_plan_change(entry, Decimal('11000'), self.gm)
        first.refresh_from_db()
        self.assertEqual(first.status, PlanChangeRequest.STATUS_SUPERSEDED)
        self.assertEqual(first.decided_by, self.gm)
        self.assertEqual(second.status, PlanChangeRequest.STATUS_PENDING)

    def test_setting_back_to_the_approved_value_withdraws(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        first = request_plan_change(entry, Decimal('10500'), self.gm)
        self.assertIsNone(request_plan_change(entry, Decimal('10000'), self.gm))
        first.refresh_from_db()
        self.assertEqual(first.status, PlanChangeRequest.STATUS_SUPERSEDED)
        self.assertEqual(entry.change_requests.count(), 1)

    def test_clearing_a_cell_in_week_is_refused(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        with self.assertRaises(ValueError):
            request_plan_change(entry, None, self.gm)

    def test_a_request_notifies_export_managers_only(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        request_plan_change(entry, Decimal('11000'), self.gm)
        note = Notification.objects.get(user=self.w.users['export_manager'], kind='plan_change_requested')
        self.assertIn('+10.00%', note.message)
        self.assertIn('changes=1', note.link)
        self.assertFalse(
            Notification.objects.filter(user=self.w.users['document_team'], kind='plan_change_requested').exists()
        )
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `python manage.py test apps.greenhouse.tests.test_plan_change_request --verbosity=2`
Expected: ERROR, `ModuleNotFoundError: No module named 'apps.greenhouse.services.plan_change_service'`.

- [ ] **Step 3: Create the service (request half)**

`backend/apps/greenhouse/services/plan_change_service.py`:

```python
"""In-week plan revisions: request, approve, reject (ADR-024).

Once a plan week has started (Monday 00:00 local), a greenhouse manager's plan
edit no longer writes `plan_value`. It becomes a PlanChangeRequest that an
export manager (or admin/boss) approves or rejects. `set_plan_value()` stays the
single entry point and routes here; this module never bypasses it for writes
that originate from a manager.
"""
import logging
from datetime import date, datetime, time as dtime, timezone as dt_timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.db import transaction
from django.utils import timezone

from apps.greenhouse.models import PlanChangeRequest

logger = logging.getLogger(__name__)

# Who, besides admin-like users, may approve or reject. document_team is in
# EXPORT_MANAGER_LIKE elsewhere, but the owner named the export manager only.
APPROVER_ROLES = frozenset({'export_manager'})


def _config():
    from apps.core.models import GreenhouseConfig
    return GreenhouseConfig.get_solo()


def _kg(value) -> str:
    return '—' if value is None else f'{value:,.0f}'


def _display_name(user) -> str:
    if user is None:
        return '—'
    return f'{user.first_name} {user.last_name}'.strip() or user.username


def plan_week_start_utc(weekly_plan, tz) -> datetime:
    """Monday 00:00 local of the plan week, as aware UTC."""
    monday = date.fromisocalendar(weekly_plan.year, weekly_plan.week_number, 1)
    return datetime.combine(monday, dtime(0, 0)).replace(tzinfo=tz).astimezone(dt_timezone.utc)


def plan_week_started(weekly_plan, now_utc: datetime) -> bool:
    """True once the plan week has begun — manager edits switch to request mode.

    A mode switch, not a lock: `_plan_edit_window_closed()` still decides whether
    the week may be edited at all.
    """
    tz = ZoneInfo(_config().timezone_name)
    return now_utc >= plan_week_start_utc(weekly_plan, tz)


def supersede_pending(entry, user) -> int:
    """Move the cell's pending request (if any) to `superseded`. Returns rows updated."""
    return PlanChangeRequest.objects.filter(
        entry=entry, status=PlanChangeRequest.STATUS_PENDING,
    ).update(
        status=PlanChangeRequest.STATUS_SUPERSEDED, decided_by=user, decided_at=timezone.now(),
    )


def _bounded_change_pct(baseline, requested: Decimal) -> Decimal | None:
    """Return the % change vs the baseline, or None when the cell has no bound.

    Raises:
        ValueError: when |change| exceeds GreenhouseConfig.plan_change_max_pct.
    """
    if baseline is None or baseline == 0:
        return None
    max_pct = _config().plan_change_max_pct
    delta = requested - baseline
    if abs(delta) * 100 > max_pct * baseline:
        low = baseline * (100 - max_pct) / 100
        high = baseline * (100 + max_pct) / 100
        raise ValueError(
            f'Change exceeds ±{max_pct}% of the week-start plan. '
            f'Allowed range: {low:,.0f}–{high:,.0f} kg.'
        )
    return (delta * 100 / baseline).quantize(Decimal('0.01'))


def request_plan_change(entry, value, user, reason: str = '') -> PlanChangeRequest | None:
    """Record a greenhouse manager's in-week plan revision as a pending request.

    Freezes the cell's baseline on the first in-week request, enforces the
    ±plan_change_max_pct bound against it, and supersedes any earlier pending
    request. Setting the value back to the approved one withdraws instead.

    Returns:
        The new pending request, or None when the call was a withdrawal.

    Raises:
        ValueError: value is None, or outside the allowed range.
    """
    if value is None:
        raise ValueError('The plan cannot be cleared after the week has started.')
    requested = Decimal(str(value))
    if entry.plan_value is not None and requested == entry.plan_value:
        supersede_pending(entry, user)
        return None
    baseline = entry.plan_baseline_value if entry.plan_baseline_value is not None else entry.plan_value
    change_pct = _bounded_change_pct(baseline, requested)
    with transaction.atomic():
        change = _create_request(entry, user, baseline, requested, change_pct, reason)
    _notify_approvers(change)
    return change


def _create_request(entry, user, baseline, requested, change_pct, reason) -> PlanChangeRequest:
    """Freeze the baseline if needed, supersede the old pending row, insert the new one.

    The baseline is frozen only when it actually bounds the request
    (`change_pct is not None`). A zero plan would otherwise freeze as 0 and leave
    the cell unbounded forever; left NULL, it re-derives from the next approved value.
    """
    if entry.plan_baseline_value is None and change_pct is not None:
        entry.plan_baseline_value = baseline
        entry.save(update_fields=['plan_baseline_value', 'updated_at'])
    supersede_pending(entry, user)
    return PlanChangeRequest.objects.create(
        entry=entry,
        baseline_value=baseline,
        current_value=entry.plan_value,
        requested_value=requested,
        change_pct=change_pct,
        reason=(reason or '').strip(),
        requested_by=user,
    )


def _plan_link(entry) -> str:
    iso_year, iso_week, _ = entry.entry_date.isocalendar()
    return f'/export/plan?week={iso_week}&year={iso_year}&block={entry.block_id}&changes=1'


def _notify_approvers(change: PlanChangeRequest) -> None:
    """In-app notification to every active export manager."""
    from apps.core.models import User
    from apps.export.models import Notification

    entry = change.entry
    pct = f' ({change.change_pct:+}%)' if change.change_pct is not None else ''
    message = (
        f'{_display_name(change.requested_by)} requested a plan change for block '
        f'{entry.block.code} on {entry.entry_date.isoformat()}: '
        f'{_kg(change.current_value)} → {_kg(change.requested_value)} kg{pct}.'
    )
    user_ids = User.objects.filter(role__in=APPROVER_ROLES, is_active=True).values_list('id', flat=True)
    Notification.objects.bulk_create(
        [
            Notification(user_id=uid, kind='plan_change_requested', message=message, link=_plan_link(entry))
            for uid in user_ids
        ],
        batch_size=500,
    )
```

- [ ] **Step 4: Route `set_plan_value` through it**

In `backend/apps/greenhouse/services/harvest_day_service.py`:

1. Change the signature and the docstring's permission list:

```python
def set_plan_value(entry, value, user, reason: str = ''):
    """Set the plan_value on a HarvestDayEntry.

    Permissions:
    - admin: always allowed; reason required only when overriding an existing
      plan_value (writes last_override_* snapshot in that case).
    - greenhouse_manager: own blocks only (checked via active BlockManagerAssignment).
      Once the plan week has started (Monday 00:00 local) the edit does NOT write
      plan_value — it becomes a pending PlanChangeRequest (ADR-024).
    - boss: identical to admin (ADMIN_LIKE, Aug 2026).
    - warehouse_chief: NOT allowed to set plan (only forecast/actual).

    Returns:
        The PlanChangeRequest when the edit was routed to approval, else None.
```

(keep the existing Args / Raises sections).

2. At the end of the `elif role == 'greenhouse_manager':` branch, right after the `if _plan_edit_window_closed(...)` block raises, add:

```python
        # Week has started → revision needs export-manager approval (ADR-024).
        from apps.greenhouse.services.plan_change_service import (
            plan_week_started, request_plan_change,
        )
        if plan_week_started(weekly_plan, now_utc):
            return request_plan_change(entry, value, user, reason)
```

(The import is local on purpose: `plan_change_service` imports this module, so a top-level import would be circular.)

- [ ] **Step 5: Export the new public names**

In `backend/apps/greenhouse/services/__init__.py` add:

```python
from apps.greenhouse.services.plan_change_service import (
    plan_week_started,
    request_plan_change,
    supersede_pending,
)
```

and `'plan_week_started', 'request_plan_change', 'supersede_pending',` to `__all__`.

- [ ] **Step 6: Update the two late-edit tests whose behaviour changed**

In `backend/apps/greenhouse/tests/test_late_edit_extension.py`:

`test_greenhouse_manager_can_edit_during_week`: replace the call and assertions with:

```python
            # The week has started, so the edit is a pending revision (ADR-024).
            change = set_plan_value(entry, Decimal('1500.00'), self.manager_user)

        entry.refresh_from_db()
        self.assertIsNone(entry.plan_value)
        self.assertEqual(change.status, 'pending')
        self.assertEqual(change.requested_value, Decimal('1500.00'))
```

`test_greenhouse_manager_can_edit_when_extension_active`: same shape:

```python
            change = set_plan_value(entry, Decimal('900.00'), self.manager_user)

        entry.refresh_from_db()
        self.assertIsNone(entry.plan_value)
        self.assertEqual(change.status, 'pending')
        self.assertEqual(change.requested_value, Decimal('900.00'))
```

Update both docstrings: "→ edit is accepted as a pending change request".

- [ ] **Step 7: Run the tests and confirm they pass**

Run each, one at a time:
```bash
python manage.py test apps.greenhouse.tests.test_plan_change_request --verbosity=2
python manage.py test apps.greenhouse.tests.test_late_edit_extension --verbosity=2
python manage.py test apps.greenhouse --verbosity=1
```
Expected: 16 new tests OK; late-edit suite OK; the whole greenhouse app has no new failures. If some other test sets a manager's plan on a started week and expected a direct write, update it the same way as Step 6. Don't weaken the routing to make it pass.

- [ ] **Step 8: Prepared commit** (only if the user said "commit")

```bash
git diff --cached --quiet || { echo "index not empty — stop"; exit 1; }
git add backend/apps/greenhouse/services/plan_change_service.py \
  backend/apps/greenhouse/services/harvest_day_service.py backend/apps/greenhouse/services/__init__.py \
  backend/apps/greenhouse/tests/test_plan_change_request.py backend/apps/greenhouse/tests/test_late_edit_extension.py
git commit -m "feat(p3): route in-week manager plan edits to change requests

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Decisions — approve, reject, admin baseline reset

**Files:**
- Modify: `backend/apps/greenhouse/services/plan_change_service.py`
- Modify: `backend/apps/greenhouse/services/harvest_day_service.py` (`set_plan_value`, after the audit entry)
- Modify: `backend/apps/greenhouse/services/__init__.py`
- Test: `backend/apps/greenhouse/tests/test_plan_change_decisions.py`

**Interfaces:**
- Consumes: Task 2's `request_plan_change`, `supersede_pending`, `plan_week_started`, `_kg`, `_display_name`, `_plan_link`, `APPROVER_ROLES`.
- Produces:
  - `can_decide_plan_change(user) -> bool`
  - `approve_plan_change(change, user, note: str = '') -> PlanChangeRequest` (raises `PermissionError`, `ValueError`)
  - `reject_plan_change(change, user, note: str = '') -> PlanChangeRequest` (same)
  - `reset_baseline_after_direct_edit(entry, value, user, now_utc) -> None`
  - Notification kinds `'plan_change_approved'`, `'plan_change_rejected'`

- [ ] **Step 1: Write the failing tests**

`backend/apps/greenhouse/tests/test_plan_change_decisions.py`:

```python
"""Approve / reject in-week plan revisions, and admin direct-edit baseline reset (ADR-024).

Usage:
    python manage.py test apps.greenhouse.tests.test_plan_change_decisions --verbosity=2
"""
from decimal import Decimal

from django.test import TestCase

from apps.export.models import AuditLog, Notification
from apps.greenhouse.models import PlanChangeRequest
from apps.greenhouse.services.harvest_day_service import set_plan_value
from apps.greenhouse.services.plan_change_service import (
    approve_plan_change, reject_plan_change, request_plan_change,
)
from apps.greenhouse.tests.plan_change_fixtures import (
    AFTER_WEEK_UTC, BEFORE_WEEK_UTC, IN_WEEK_UTC, build_world, frozen_now, make_entry,
)


class TestApprove(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.w = build_world('PCD')

    def setUp(self):
        self.gm = self.w.users['greenhouse_manager']

    def _pending(self, weekday=0, plan_value=Decimal('10000'), requested=Decimal('11000'), plan_state='on_time'):
        entry = make_entry(self.w, weekday=weekday, plan_value=plan_value, plan_state=plan_state)
        return entry, request_plan_change(entry, requested, self.gm)

    def test_export_manager_approval_writes_the_value_and_audits(self):
        entry, change = self._pending()
        approve_plan_change(change, self.w.users['export_manager'], 'ok')
        entry.refresh_from_db()
        change.refresh_from_db()
        self.assertEqual(entry.plan_value, Decimal('11000'))
        self.assertEqual(entry.plan_submitted_by, self.gm)  # the requester authored the value
        self.assertEqual(change.status, PlanChangeRequest.STATUS_APPROVED)
        self.assertEqual(change.decided_by, self.w.users['export_manager'])
        self.assertEqual(change.decision_note, 'ok')
        self.assertTrue(AuditLog.objects.filter(
            model_name='HarvestDayEntry', object_id=str(entry.id),
            action='plan_value_set', detail__contains='APPROVED',
        ).exists())
        self.assertTrue(Notification.objects.filter(user=self.gm, kind='plan_change_approved').exists())

    def test_admin_and_boss_can_approve(self):
        for weekday, role in enumerate(('admin', 'boss')):
            with self.subTest(role=role):
                entry, change = self._pending(weekday=weekday)
                approve_plan_change(change, self.w.users[role])
                entry.refresh_from_db()
                self.assertEqual(entry.plan_value, Decimal('11000'))

    def test_other_roles_cannot_decide(self):
        for weekday, role in enumerate(('greenhouse_manager', 'director', 'document_team')):
            with self.subTest(role=role):
                _, change = self._pending(weekday=weekday)
                with self.assertRaises(PermissionError):
                    approve_plan_change(change, self.w.users[role])
                with self.assertRaises(PermissionError):
                    reject_plan_change(change, self.w.users[role])
                change.refresh_from_db()
                self.assertEqual(change.status, PlanChangeRequest.STATUS_PENDING)

    def test_a_decided_request_cannot_be_decided_again(self):
        _, change = self._pending()
        approve_plan_change(change, self.w.users['export_manager'])
        with self.assertRaises(ValueError):
            approve_plan_change(change, self.w.users['export_manager'])
        with self.assertRaises(ValueError):
            reject_plan_change(change, self.w.users['export_manager'])

    def test_approving_an_empty_cell_computes_its_plan_state(self):
        entry, change = self._pending(plan_value=None, requested=Decimal('7000'), plan_state='')
        approve_plan_change(change, self.w.users['export_manager'])
        entry.refresh_from_db()
        # requested_at defaults to the real clock, which is always past W24's
        # Monday 00:00 (the critical-late moment) — hence critical_late.
        self.assertEqual(entry.plan_state, 'critical_late')

    def test_deciding_is_not_time_gated(self):
        """Spec rule 10: a request can be approved after its week has ended."""
        entry, change = self._pending()
        with frozen_now(AFTER_WEEK_UTC):
            approve_plan_change(change, self.w.users['export_manager'])
        entry.refresh_from_db()
        self.assertEqual(entry.plan_value, Decimal('11000'))

    def test_approving_a_revision_keeps_the_original_plan_state(self):
        entry, change = self._pending(plan_state='on_time')
        approve_plan_change(change, self.w.users['export_manager'])
        entry.refresh_from_db()
        self.assertEqual(entry.plan_state, 'on_time')


class TestReject(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.w = build_world('PCJ')

    def test_reject_leaves_the_value_and_notifies(self):
        gm = self.w.users['greenhouse_manager']
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        change = request_plan_change(entry, Decimal('11000'), gm)
        reject_plan_change(change, self.w.users['export_manager'], 'too high')
        entry.refresh_from_db()
        change.refresh_from_db()
        self.assertEqual(entry.plan_value, Decimal('10000'))
        self.assertEqual(change.status, PlanChangeRequest.STATUS_REJECTED)
        self.assertEqual(change.decision_note, 'too high')
        note = Notification.objects.get(user=gm, kind='plan_change_rejected')
        self.assertIn('too high', note.message)


class TestAdminDirectEdit(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.w = build_world('PCA')

    def test_in_week_admin_edit_resets_baseline_and_supersedes_pending(self):
        gm, admin = self.w.users['greenhouse_manager'], self.w.users['admin']
        entry = make_entry(self.w, plan_value=Decimal('10000'), baseline=Decimal('10000'))
        change = request_plan_change(entry, Decimal('11000'), gm)
        with frozen_now(IN_WEEK_UTC):
            set_plan_value(entry, Decimal('20000'), admin, reason='harvest moved')
        entry.refresh_from_db()
        change.refresh_from_db()
        self.assertEqual(entry.plan_value, Decimal('20000'))
        self.assertEqual(entry.plan_baseline_value, Decimal('20000'))
        self.assertEqual(change.status, PlanChangeRequest.STATUS_SUPERSEDED)
        self.assertEqual(change.decided_by, admin)

    def test_admin_edit_before_week_start_leaves_baseline_alone(self):
        entry = make_entry(self.w, plan_value=None)
        with frozen_now(BEFORE_WEEK_UTC):
            set_plan_value(entry, Decimal('9000'), self.w.users['admin'])
        entry.refresh_from_db()
        self.assertIsNone(entry.plan_baseline_value)
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `python manage.py test apps.greenhouse.tests.test_plan_change_decisions --verbosity=2`
Expected: ERROR, `ImportError: cannot import name 'approve_plan_change'`.

- [ ] **Step 3: Add the decision half to the service**

Append to `backend/apps/greenhouse/services/plan_change_service.py` (add `from apps.core.roles import is_admin_like`, `from apps.core.services_workflow import create_audit_entry` and `from apps.greenhouse.models import HarvestDayEntry` to the imports):

```python
def can_decide_plan_change(user) -> bool:
    """export_manager, admin, boss and superusers may approve or reject."""
    return is_admin_like(user) or getattr(user, 'role', None) in APPROVER_ROLES


def _claim(change: PlanChangeRequest, user, new_status: str, note: str) -> None:
    """Atomically move a pending request to `new_status`.

    The conditional UPDATE is the race guard: two approvers clicking at once
    cannot both claim the same row.

    Raises:
        PermissionError: user may not decide plan changes.
        ValueError: the request is no longer pending.
    """
    if not can_decide_plan_change(user):
        raise PermissionError(f"Role '{getattr(user, 'role', None)}' cannot decide plan changes.")
    claimed = PlanChangeRequest.objects.filter(
        pk=change.pk, status=PlanChangeRequest.STATUS_PENDING,
    ).update(status=new_status, decided_by=user, decided_at=timezone.now(), decision_note=(note or '').strip())
    if not claimed:
        raise ValueError('Request is no longer pending.')
    change.refresh_from_db()


def approve_plan_change(change: PlanChangeRequest, user, note: str = '') -> PlanChangeRequest:
    """Approve a pending request: write its value into plan_value and notify the requester."""
    with transaction.atomic():
        _claim(change, user, PlanChangeRequest.STATUS_APPROVED, note)
        entry = HarvestDayEntry.objects.select_related('block').get(pk=change.entry_id)
        _apply_approved_value(entry, change, user)
    _notify_requester(change, 'plan_change_approved')
    return change


def reject_plan_change(change: PlanChangeRequest, user, note: str = '') -> PlanChangeRequest:
    """Reject a pending request; plan_value is untouched."""
    _claim(change, user, PlanChangeRequest.STATUS_REJECTED, note)
    _notify_requester(change, 'plan_change_rejected')
    return change


def _plan_state_at(entry, submitted_at_utc: datetime) -> str:
    from apps.greenhouse.services.harvest_day_service import compute_plan_state, plan_week_start
    config = _config()
    local = submitted_at_utc.astimezone(ZoneInfo(config.timezone_name)).replace(tzinfo=None)
    return compute_plan_state(local, plan_week_start(entry.entry_date), config)


def _apply_approved_value(entry, change: PlanChangeRequest, approver) -> None:
    """Write the approved value, crediting the requester as its author.

    plan_state (timeliness) is computed only for a first entry; a revision of an
    already-planned cell keeps the timeliness of the original submission.
    """
    old_value = entry.plan_value
    entry.plan_value = change.requested_value
    entry.plan_submitted_at = change.requested_at
    entry.plan_submitted_by_id = change.requested_by_id
    fields = ['plan_value', 'plan_submitted_at', 'plan_submitted_by', 'updated_at']
    if old_value is None:
        entry.plan_state = _plan_state_at(entry, change.requested_at)
        fields.append('plan_state')
    entry.save(update_fields=fields)
    pct = f' ({change.change_pct:+}%)' if change.change_pct is not None else ''
    create_audit_entry(
        approver, 'plan_value_set', 'HarvestDayEntry', entry.id, str(entry),
        f'APPROVED change #{change.pk}{pct} | plan_value: {old_value!r} → {change.requested_value!r}',
    )


def _notify_requester(change: PlanChangeRequest, kind: str) -> None:
    from apps.export.models import Notification

    if change.requested_by_id is None:
        return
    entry = change.entry
    verb = 'approved' if kind == 'plan_change_approved' else 'rejected'
    note = f' Note: {change.decision_note}' if change.decision_note else ''
    Notification.objects.create(
        user_id=change.requested_by_id,
        kind=kind,
        message=(
            f'Your plan change for block {entry.block.code} on {entry.entry_date.isoformat()} '
            f'({_kg(change.requested_value)} kg) was {verb} by {_display_name(change.decided_by)}.{note}'
        ),
        link=_plan_link(entry),
    )


def reset_baseline_after_direct_edit(entry, value, user, now_utc: datetime) -> None:
    """Admin/boss direct in-week edit: its value becomes the new baseline and any
    pending manager request on the cell is superseded. No-op before the week starts."""
    if not plan_week_started(entry.weekly_plan, now_utc):
        return
    entry.plan_baseline_value = value
    entry.save(update_fields=['plan_baseline_value', 'updated_at'])
    supersede_pending(entry, user)
```

- [ ] **Step 4: Call the reset from `set_plan_value`**

In `set_plan_value`, right after the `logger.info('HarvestDayEntry %d plan_value set …')` line and before the late-notification `if`:

```python
    if is_admin_like(user):
        from apps.greenhouse.services.plan_change_service import reset_baseline_after_direct_edit
        reset_baseline_after_direct_edit(entry, value, user, now_utc)
```

- [ ] **Step 5: Export the new names**

Extend the `plan_change_service` import in `services/__init__.py` with `approve_plan_change, can_decide_plan_change, reject_plan_change, reset_baseline_after_direct_edit`, and add them to `__all__`.

- [ ] **Step 6: Run the tests and confirm they pass**

```bash
python manage.py test apps.greenhouse.tests.test_plan_change_decisions --verbosity=2
python manage.py test apps.greenhouse --verbosity=1
python manage.py test apps.export.tests_weekly_plan_tasks apps.export.tests_task_attribution --verbosity=1
```
Run these one after another, never two at once. Expected: 10 new tests OK. No new failures in the greenhouse app (the boss suite still passes: boss edits just gain a baseline). No new failures in the two export suites, which read `plan_value IS NULL` for the ADR-021 weekly-plan task. The backend suite has ~71 known pre-existing failures, so compare against a run on the unchanged code before blaming this work.

- [ ] **Step 7: Prepared commit** (only if the user said "commit")

```bash
git diff --cached --quiet || { echo "index not empty — stop"; exit 1; }
git add backend/apps/greenhouse/services/plan_change_service.py \
  backend/apps/greenhouse/services/harvest_day_service.py backend/apps/greenhouse/services/__init__.py \
  backend/apps/greenhouse/tests/test_plan_change_decisions.py
git commit -m "feat(p3): approve and reject in-week plan change requests

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: API — change-request endpoints, day-entry fields, 202

**Files:**
- Modify: `backend/apps/greenhouse/serializers.py` (new serializers; `HarvestDayEntrySerializer` at line 77)
- Modify: `backend/apps/greenhouse/views.py:416-490` (`HarvestDayEntryViewSet`)
- Create: `backend/apps/greenhouse/views_plan_changes.py`
- Modify: `backend/apps/greenhouse/urls.py`
- Test: `backend/apps/greenhouse/tests/test_plan_change_api.py`

**Interfaces:**
- Consumes: Task 2/3 service functions.
- Produces (wire contract used by Tasks 6–8):
  - Day entry gains `plan_baseline_value: str|null` and `pending_change: {id, requested_value, change_pct, requested_by_name, requested_at} | null` (decimals as strings).
  - `PATCH /api/v1/greenhouse/day-entries/{id}/` → **202** + entry payload when the edit became a request.
  - `GET /api/v1/greenhouse/plan-change-requests/?status=&year=&week=&block=&season=` → paginated rows (spec shape).
  - `POST /api/v1/greenhouse/plan-change-requests/{id}/approve/` and `/reject/`, body `{note?}` → 200 row / 403 `{error}` / 400 `{error}`.

- [ ] **Step 1: Write the failing tests**

`backend/apps/greenhouse/tests/test_plan_change_api.py`:

```python
"""Plan-change endpoints and the day-entry wire additions (ADR-024).

Usage:
    python manage.py test apps.greenhouse.tests.test_plan_change_api --verbosity=2
"""
from decimal import Decimal

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from apps.greenhouse.models import PlanChangeRequest
from apps.greenhouse.services.plan_change_service import request_plan_change
from apps.greenhouse.tests.plan_change_fixtures import IN_WEEK_UTC, build_world, frozen_now, make_entry

BASE = '/api/v1/greenhouse'


def _rows(response):
    return response.data['results'] if isinstance(response.data, dict) else response.data


class TestPlanChangeApi(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.w = build_world('PCAPI')

    def setUp(self):
        self.gm = self.w.users['greenhouse_manager']
        self.client = APIClient()

    def _as(self, role):
        self.client.force_authenticate(self.w.users[role])

    def test_in_week_manager_patch_returns_202_with_the_pending_change(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        self._as('greenhouse_manager')
        with frozen_now(IN_WEEK_UTC):
            resp = self.client.patch(f'{BASE}/day-entries/{entry.id}/', {'plan_value': 11500}, format='json')
        self.assertEqual(resp.status_code, 202)
        self.assertEqual(resp.data['plan_value'], '10000.00')
        self.assertEqual(resp.data['plan_baseline_value'], '10000.00')
        self.assertEqual(resp.data['pending_change']['requested_value'], '11500.00')
        self.assertEqual(resp.data['pending_change']['change_pct'], '15.00')

    def test_patching_the_approved_value_back_withdraws_with_200(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        request_plan_change(entry, Decimal('11000'), self.gm)
        self._as('greenhouse_manager')
        with frozen_now(IN_WEEK_UTC):
            resp = self.client.patch(f'{BASE}/day-entries/{entry.id}/', {'plan_value': 10000}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.data['pending_change'])

    def test_out_of_range_patch_returns_400_with_the_range(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        self._as('greenhouse_manager')
        with frozen_now(IN_WEEK_UTC):
            resp = self.client.patch(f'{BASE}/day-entries/{entry.id}/', {'plan_value': 12000}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('8,500–11,500', resp.data['plan_value'])

    def test_list_filters_by_status_and_week(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        request_plan_change(entry, Decimal('10500'), self.gm)
        request_plan_change(entry, Decimal('11000'), self.gm)  # supersedes the first
        self._as('export_manager')
        pending = _rows(self.client.get(f'{BASE}/plan-change-requests/?status=pending&year=2026&week=24'))
        self.assertEqual([r['requested_value'] for r in pending], ['11000.00'])
        self.assertEqual(pending[0]['block_code'], self.w.block.code)
        self.assertEqual(pending[0]['requested_by_name'], self.gm.username)
        every = _rows(self.client.get(f'{BASE}/plan-change-requests/?year=2026&week=24'))
        self.assertEqual(len(every), 2)
        other_week = _rows(self.client.get(f'{BASE}/plan-change-requests/?year=2026&week=25'))
        self.assertEqual(other_week, [])

    def test_export_manager_approves_via_the_api(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        change = request_plan_change(entry, Decimal('11000'), self.gm)
        self._as('export_manager')
        resp = self.client.post(f'{BASE}/plan-change-requests/{change.id}/approve/', {'note': 'ok'}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['status'], 'approved')
        entry.refresh_from_db()
        self.assertEqual(entry.plan_value, Decimal('11000'))

    def test_export_manager_rejects_via_the_api(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        change = request_plan_change(entry, Decimal('11000'), self.gm)
        self._as('export_manager')
        resp = self.client.post(f'{BASE}/plan-change-requests/{change.id}/reject/', {}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['status'], 'rejected')

    def test_document_team_gets_403(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        change = request_plan_change(entry, Decimal('11000'), self.gm)
        self._as('document_team')
        resp = self.client.post(f'{BASE}/plan-change-requests/{change.id}/approve/', {}, format='json')
        self.assertEqual(resp.status_code, 403)
        self.assertIn('error', resp.data)

    def test_deciding_twice_returns_400(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        change = request_plan_change(entry, Decimal('11000'), self.gm)
        self._as('export_manager')
        self.client.post(f'{BASE}/plan-change-requests/{change.id}/approve/', {}, format='json')
        resp = self.client.post(f'{BASE}/plan-change-requests/{change.id}/reject/', {}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data['error'], 'Request is no longer pending.')

    def test_day_entries_list_query_count_does_not_grow_with_pending_changes(self):
        url = f'{BASE}/day-entries/?weekly_plan={self.w.plan.id}'
        self._as('export_manager')
        first = make_entry(self.w, weekday=0, plan_value=Decimal('100'))
        PlanChangeRequest.objects.create(entry=first, requested_value=Decimal('105'), requested_by=self.gm)
        with CaptureQueriesContext(connection) as one:
            self.client.get(url)
        for weekday in (1, 2):
            e = make_entry(self.w, weekday=weekday, plan_value=Decimal('100'))
            PlanChangeRequest.objects.create(entry=e, requested_value=Decimal('105'), requested_by=self.gm)
        with CaptureQueriesContext(connection) as three:
            resp = self.client.get(url)
        rows = _rows(resp)
        self.assertEqual(len(rows), 3)
        self.assertTrue(all(r['pending_change'] for r in rows))
        self.assertEqual(len(one), len(three))
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `python manage.py test apps.greenhouse.tests.test_plan_change_api --verbosity=2`
Expected: FAIL. The 202 test gets 200 and no `plan_baseline_value` key; the list tests 404.

- [ ] **Step 3: Serializers**

In `backend/apps/greenhouse/serializers.py` add `PlanChangeRequest` to the `apps.greenhouse.models` import, and **above** `HarvestDayEntrySerializer`:

```python
def _user_display(user) -> str | None:
    if user is None:
        return None
    return f'{user.first_name} {user.last_name}'.strip() or user.username


class PlanChangeBriefSerializer(serializers.ModelSerializer):
    """The pending revision embedded in a day-entry payload (ADR-024)."""

    requested_by_name = serializers.SerializerMethodField()

    class Meta:
        model = PlanChangeRequest
        fields = ['id', 'requested_value', 'change_pct', 'requested_by_name', 'requested_at']

    def get_requested_by_name(self, obj: PlanChangeRequest) -> str | None:
        return _user_display(obj.requested_by)


class PlanChangeRequestSerializer(serializers.ModelSerializer):
    """One row of the plan-change log / approval queue (ADR-024)."""

    block = serializers.IntegerField(source='entry.block_id', read_only=True)
    block_code = serializers.CharField(source='entry.block.code', read_only=True)
    entry_date = serializers.DateField(source='entry.entry_date', read_only=True)
    weekday = serializers.IntegerField(source='entry.weekday', read_only=True)
    requested_by_name = serializers.SerializerMethodField()
    decided_by_name = serializers.SerializerMethodField()

    class Meta:
        model = PlanChangeRequest
        fields = [
            'id', 'entry', 'block', 'block_code', 'entry_date', 'weekday',
            'baseline_value', 'current_value', 'requested_value', 'change_pct',
            'status', 'reason',
            'requested_by', 'requested_by_name', 'requested_at',
            'decided_by', 'decided_by_name', 'decided_at', 'decision_note',
        ]
        read_only_fields = fields

    def get_requested_by_name(self, obj: PlanChangeRequest) -> str | None:
        return _user_display(obj.requested_by)

    def get_decided_by_name(self, obj: PlanChangeRequest) -> str | None:
        return _user_display(obj.decided_by)
```

In `HarvestDayEntrySerializer`: add the method field after `last_override_by_name`:

```python
    pending_change = serializers.SerializerMethodField()
```

Append `'plan_baseline_value', 'pending_change'` to both `Meta.fields` and `Meta.read_only_fields`. Then add the method:

```python
    def get_pending_change(self, obj: HarvestDayEntry) -> dict | None:
        """The cell's pending revision. Reads the viewset's `pending_changes`
        prefetch when present (list), else queries (single-object responses)."""
        pending = getattr(obj, 'pending_changes', None)
        if pending is None:
            pending = list(
                obj.change_requests.filter(status=PlanChangeRequest.STATUS_PENDING).select_related('requested_by')
            )
        return PlanChangeBriefSerializer(pending[0]).data if pending else None
```

(If `HarvestDayEntry` is not yet imported in this file for the annotation, it is: the serializer's `Meta.model` uses it.)

- [ ] **Step 4: Day-entry viewset: prefetch + 202**

In `backend/apps/greenhouse/views.py` add `PlanChangeRequest` to the `apps.greenhouse.models` import (`Prefetch` is already imported). Change the `HarvestDayEntryViewSet.queryset` to:

```python
    queryset = HarvestDayEntry.objects.select_related(
        'block', 'season', 'weekly_plan',
        'plan_submitted_by', 'forecast_submitted_by', 'last_override_by',
    ).prefetch_related(
        Prefetch(
            'change_requests',
            queryset=PlanChangeRequest.objects.filter(
                status=PlanChangeRequest.STATUS_PENDING,
            ).select_related('requested_by'),
            to_attr='pending_changes',
        ),
    ).order_by('entry_date', 'block__code')
```

In `partial_update`: capture the return of `set_plan_value`, and replace the tail:

```python
        pending_change = None
        if 'plan_value' in data:
            try:
                pending_change = set_plan_value(entry, data['plan_value'], request.user, reason)
            except (ValueError, PermissionError) as exc:
                errors['plan_value'] = str(exc)
```

```python
        if errors:
            return Response(errors, status=http_status.HTTP_400_BAD_REQUEST)

        # Re-fetch through the queryset (not refresh_from_db): the `pending_changes`
        # to_attr prefetch is a plain attribute that refresh_from_db would leave stale.
        entry = self.get_queryset().get(pk=entry.pk)
        # 202: a manager's in-week edit is waiting for export-manager approval (ADR-024).
        code = http_status.HTTP_202_ACCEPTED if pending_change is not None else http_status.HTTP_200_OK
        return Response(self.get_serializer(entry).data, status=code)
```

Update the class docstring's PATCH line: `PATCH … — update plan/forecast/actual values (202 when a manager's in-week plan edit is sent for approval)`.

- [ ] **Step 5: The change-request viewset**

`backend/apps/greenhouse/views_plan_changes.py`:

```python
"""Plan change requests — the in-week revision queue and log (ADR-024)."""
from rest_framework import status as http_status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ReadOnlyModelViewSet

from apps.core.permissions import SeasonNotClosed
from apps.core.seasons import SeasonScopedMixin
from apps.greenhouse.models import PlanChangeRequest
from apps.greenhouse.serializers import PlanChangeRequestSerializer
from apps.greenhouse.services.plan_change_service import approve_plan_change, reject_plan_change


class PlanChangeRequestViewSet(SeasonScopedMixin, ReadOnlyModelViewSet):
    """
    GET  /api/v1/greenhouse/plan-change-requests/?status=&year=&week=&block=&season=
    GET  /api/v1/greenhouse/plan-change-requests/{id}/
    POST /api/v1/greenhouse/plan-change-requests/{id}/approve/   body {"note": "..."} (optional)
    POST /api/v1/greenhouse/plan-change-requests/{id}/reject/    body {"note": "..."} (optional)

    Reads are open to any authenticated user, like day-entries. Deciding is
    export_manager / admin / boss, enforced in the service.
    """

    permission_classes = [IsAuthenticated, SeasonNotClosed]
    serializer_class = PlanChangeRequestSerializer
    season_field = 'entry__season'
    queryset = PlanChangeRequest.objects.select_related('entry__block', 'requested_by', 'decided_by')

    def get_queryset(self):
        qs = super().get_queryset()
        if getattr(self, 'action', None) == 'list':
            qs = self.apply_season_scope(qs)
        params = self.request.query_params
        if status_filter := params.get('status'):
            qs = qs.filter(status=status_filter)
        if year := params.get('year'):
            qs = qs.filter(entry__weekly_plan__year=year)
        if week := params.get('week'):
            qs = qs.filter(entry__weekly_plan__week_number=week)
        if block := params.get('block'):
            qs = qs.filter(entry__block_id=block)
        return qs

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        return self._decide(approve_plan_change, request)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        return self._decide(reject_plan_change, request)

    def _decide(self, decide, request) -> Response:
        change = self.get_object()
        try:
            decide(change, request.user, request.data.get('note', ''))
        except PermissionError as exc:
            return Response({'error': str(exc)}, status=http_status.HTTP_403_FORBIDDEN)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=http_status.HTTP_400_BAD_REQUEST)
        return Response(self.get_serializer(change).data)
```

In `backend/apps/greenhouse/urls.py`:

```python
from apps.greenhouse.views_plan_changes import PlanChangeRequestViewSet
```
```python
router.register('plan-change-requests', PlanChangeRequestViewSet, basename='plan-change-request')
```

- [ ] **Step 6: Run the tests and confirm they pass**

```bash
python manage.py test apps.greenhouse.tests.test_plan_change_api --verbosity=2
python manage.py test apps.greenhouse --verbosity=1
```
Expected: 9 new tests OK; no new failures. If the list tests come back empty, the test season isn't resolving as active. Compare with how `test_daily_board_access.py` sets its season up before changing anything else.

- [ ] **Step 7: Prepared commit** (only if the user said "commit")

```bash
git diff --cached --quiet || { echo "index not empty — stop"; exit 1; }
git add backend/apps/greenhouse/serializers.py backend/apps/greenhouse/views.py \
  backend/apps/greenhouse/views_plan_changes.py backend/apps/greenhouse/urls.py \
  backend/apps/greenhouse/tests/test_plan_change_api.py
git commit -m "feat(p3): add plan-change-requests endpoints and pending_change on day entries

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Notification kinds (PARKED: run last, optional)

> **Skip this task when going in order, and come back to it after Task 9.** On 2026-09-18 the export migration head (`0070_customs_expense_categories_as_data.py`) is untracked work from another session. A new export migration would depend on it. Nothing else depends on this task: notifications already work without it.

**Files:**
- Modify: `backend/apps/export/models/notification.py:20-45` (`KIND_CHOICES`)
- Generated: `backend/apps/export/migrations/00NN_*.py`

**Interfaces:**
- Consumes: the kind strings used in Tasks 2–3.
- Produces: `KIND_CHOICES` entries `plan_change_requested`, `plan_change_approved`, `plan_change_rejected`.

Why a separate task: the notifications already work, because `kind` is a `CharField` and `bulk_create`/`create` don't validate choices. This task only records the choices, and its migration touches the `export` app where another session has uncommitted work.

- [ ] **Step 1: Precheck the export migration head**

Run: `git status --short backend/apps/export/migrations`
If `0070_customs_expense_categories_as_data.py` (or any other export migration) is still **untracked**, **stop and ask the user**. A new export migration would depend on uncommitted work from another session. Continue only once the export migration head is committed, or when the user says to proceed.

- [ ] **Step 2: Add the kinds**

In `KIND_CHOICES`, after `('plan_critical_late', 'Plan critical-late'),`:

```python
        # In-week plan revisions (ADR-024)
        ('plan_change_requested', 'Plan change requested'),
        ('plan_change_approved', 'Plan change approved'),
        ('plan_change_rejected', 'Plan change rejected'),
```

- [ ] **Step 3: Generate, apply, verify**

```bash
python manage.py makemigrations export
python manage.py migrate export
python manage.py showmigrations export | tail -2
python manage.py makemigrations --check --dry-run
```
Expected: one `AlterField` migration on `notification.kind`, applied `[X]`; `--check` prints "No changes detected".

- [ ] **Step 4: Run the notification-touching suites**

```bash
python manage.py test apps.greenhouse.tests.test_plan_change_request apps.greenhouse.tests.test_plan_change_decisions --verbosity=1
```
Expected: OK.

- [ ] **Step 5: Prepared commit** (only if the user said "commit")

```bash
git diff --cached --quiet || { echo "index not empty — stop"; exit 1; }
git add backend/apps/export/models/notification.py backend/apps/export/migrations/00NN_*.py
git commit -m "feat(p3): register plan change notification kinds

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Frontend plumbing — types, hooks, capability, i18n

**Files:**
- Modify: `frontend/src/types/index.ts:828-896`
- Modify: `frontend/src/mock/planning.ts` (every `MOCK_DAY_ENTRIES` row)
- Modify: `frontend/src/hooks/useGreenhouseConfig.ts:20` (default config object)
- Modify: `frontend/src/hooks/usePlanning.ts` (imports; `useUpsertDayEntry`; new hooks after it)
- Modify: `frontend/src/pages/export/WeeklyPlanGrid.roles.ts`
- Modify: `frontend/src/pages/export/WeeklyPlanGrid.roles.test.ts`
- Modify: `frontend/src/i18n/en.json`, `ru.json`, `tk.json` (inside `"plan"`, after `"toast_plan_saved"`)

**Interfaces:**
- Consumes: Task 4 wire contract.
- Produces: types `PlanChangeStatus`, `IPlanChangeBrief`, `IPlanChangeRequest`; `IHarvestDayEntry.plan_baseline_value`, `.pending_change`; `IGreenhouseConfig.plan_change_max_pct: string`. Hooks `usePlanChangeRequests(filters)`, `useApprovePlanChange()`, `useRejectPlanChange()` (mutate `{ id, note? }`). Capability `canDecidePlanChanges: boolean`. i18n keys under `plan.*` listed in Step 6.

- [ ] **Step 1: Write the failing capability test**

Append to `frontend/src/pages/export/WeeklyPlanGrid.roles.test.ts` (it already has a `caps(role, isReadOnly)`-style helper around line 23; reuse it):

```ts
describe('planGridCapabilities — plan change approvals (ADR-024)', () => {
  it.each([
    ['export_manager', true],
    ['admin', true],
    ['boss', true],
    ['document_team', false],
    ['director', false],
    ['greenhouse_manager', false],
  ])('%s → canDecidePlanChanges = %s', (role, expected) => {
    expect(planGridCapabilities({ role, isReadOnly: false }).canDecidePlanChanges).toBe(expected);
  });

  it('nobody decides over a closed season', () => {
    expect(planGridCapabilities({ role: 'export_manager', isReadOnly: true }).canDecidePlanChanges).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd frontend && npx vitest run src/pages/export/WeeklyPlanGrid.roles.test.ts`
Expected: FAIL. `canDecidePlanChanges` is `undefined`.

- [ ] **Step 3: Add the capability**

In `WeeklyPlanGrid.roles.ts`, add to `IPlanGridCapabilities`:

```ts
  /**
   * Approve / reject a manager's in-week plan revision (ADR-024): export_manager,
   * admin, boss. Deliberately NOT `isExportManagerLike` — document_team shares
   * export-manager parity elsewhere, but the owner named the export manager only.
   * Mirrors backend `can_decide_plan_change`. Dead over a closed season.
   */
  canDecidePlanChanges: boolean;
```

and to the returned object:

```ts
    canDecidePlanChanges: !isReadOnly && (isAdminLike || role === 'export_manager'),
```

Run: `npx vitest run src/pages/export/WeeklyPlanGrid.roles.test.ts`. Expected: PASS.

- [ ] **Step 4: Types**

In `frontend/src/types/index.ts`, above `IHarvestDayEntry`:

```ts
export type PlanChangeStatus = 'pending' | 'approved' | 'rejected' | 'superseded';

/** The pending revision embedded in a day entry (ADR-024). Decimals arrive as strings. */
export interface IPlanChangeBrief {
  id: number;
  requested_value: string;
  change_pct: string | null;    // null = no bound (empty or zero baseline)
  requested_by_name: string | null;
  requested_at: string;
}

/** One row of GET /greenhouse/plan-change-requests/. */
export interface IPlanChangeRequest {
  id: number;
  entry: number;
  block: number;
  block_code: string;
  entry_date: string;
  weekday: number;
  baseline_value: string | null;
  current_value: string | null;
  requested_value: string;
  change_pct: string | null;
  status: PlanChangeStatus;
  reason: string;
  requested_by: number | null;
  requested_by_name: string | null;
  requested_at: string;
  decided_by: number | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string;
}
```

Add to `IHarvestDayEntry` after `plan_state`:

```ts
  plan_baseline_value: string | null;          // week-start baseline, frozen on first in-week change
  pending_change: IPlanChangeBrief | null;     // manager revision awaiting approval
```

Add to `IGreenhouseConfig` after `truck_capacity_kg`:

```ts
  plan_change_max_pct: string;          // Decimal as string, default "15.00"
```

- [ ] **Step 5: Fix the object literals the new required fields break**

```bash
# \r? keeps CRLF files working; greedy .* survives the reason string that contains a comma.
sed -i "s/\(last_override_reason: .*\),\(\r\?\)$/\1, plan_baseline_value: null, pending_change: null,\2/" src/mock/planning.ts
# Both counts must match:
grep -c "last_override_reason:" src/mock/planning.ts; grep -c "pending_change: null" src/mock/planning.ts
```
In `src/hooks/useGreenhouseConfig.ts`, add `plan_change_max_pct: '15.00',` after `truck_capacity_kg: '18500',`.
Run `npx tsc --noEmit --ignoreDeprecations 5.0`. Fix any remaining `IHarvestDayEntry` / `IGreenhouseConfig` literal the compiler lists by adding the same fields. Test fixtures cast with `as IHarvestDayEntry` and won't complain.

- [ ] **Step 6: i18n keys**

Insert after the `"toast_plan_saved"` line inside `"plan"` in each file.

`en.json`:
```json
    "toast_sent_for_approval": "Change sent to the export manager for approval",
    "change_out_of_range": "Allowed range: {{min}}–{{max}} kg",
    "pending_badge_tooltip": "Awaiting approval — requested by {{name}}",
    "changes_button": "Plan changes",
    "changes_title": "Plan changes",
    "change_col_block": "Block",
    "change_col_day": "Day",
    "change_col_baseline": "Baseline",
    "change_col_current": "Current",
    "change_col_requested": "Requested",
    "change_col_requested_by": "Requested by",
    "change_col_reason": "Reason",
    "change_col_status": "Status",
    "change_col_decided_by": "Decided by",
    "change_col_note": "Note",
    "change_status_pending": "Pending",
    "change_status_approved": "Approved",
    "change_status_rejected": "Rejected",
    "change_status_superseded": "Superseded",
    "change_approve": "Approve",
    "change_reject": "Reject",
    "change_reject_note_placeholder": "Note (optional)",
    "change_filter_pending": "Pending",
    "change_filter_all": "All",
    "change_scope_week": "This week",
    "change_scope_all": "All weeks",
    "change_empty": "No plan changes",
    "toast_change_approved": "Change approved",
    "toast_change_rejected": "Change rejected",
```

`ru.json`:
```json
    "toast_sent_for_approval": "Изменение отправлено экспорт-менеджеру на подтверждение",
    "change_out_of_range": "Допустимый диапазон: {{min}}–{{max}} кг",
    "pending_badge_tooltip": "Ожидает подтверждения — запросил {{name}}",
    "changes_button": "Изменения плана",
    "changes_title": "Изменения плана",
    "change_col_block": "Блок",
    "change_col_day": "День",
    "change_col_baseline": "Базовый",
    "change_col_current": "Текущий",
    "change_col_requested": "Запрошено",
    "change_col_requested_by": "Запросил",
    "change_col_reason": "Причина",
    "change_col_status": "Статус",
    "change_col_decided_by": "Решение принял",
    "change_col_note": "Примечание",
    "change_status_pending": "Ожидает",
    "change_status_approved": "Подтверждено",
    "change_status_rejected": "Отклонено",
    "change_status_superseded": "Заменено",
    "change_approve": "Подтвердить",
    "change_reject": "Отклонить",
    "change_reject_note_placeholder": "Примечание (необязательно)",
    "change_filter_pending": "Ожидающие",
    "change_filter_all": "Все",
    "change_scope_week": "Эта неделя",
    "change_scope_all": "Все недели",
    "change_empty": "Нет изменений плана",
    "toast_change_approved": "Изменение подтверждено",
    "toast_change_rejected": "Изменение отклонено",
```

`tk.json`:
```json
    "toast_sent_for_approval": "Üýtgetme eksport menejere tassyklamaga iberildi",
    "change_out_of_range": "Rugsat edilýän aralyk: {{min}}–{{max}} kg",
    "pending_badge_tooltip": "Tassyklama garaşýar — {{name}} sorady",
    "changes_button": "Plan üýtgetmeleri",
    "changes_title": "Plan üýtgetmeleri",
    "change_col_block": "Blok",
    "change_col_day": "Gün",
    "change_col_baseline": "Esasy",
    "change_col_current": "Häzirki",
    "change_col_requested": "Täze",
    "change_col_requested_by": "Soran",
    "change_col_reason": "Sebäp",
    "change_col_status": "Ýagdaý",
    "change_col_decided_by": "Karar beren",
    "change_col_note": "Bellik",
    "change_status_pending": "Garaşýar",
    "change_status_approved": "Tassyklandy",
    "change_status_rejected": "Ret edildi",
    "change_status_superseded": "Çalşyryldy",
    "change_approve": "Tassykla",
    "change_reject": "Ret et",
    "change_reject_note_placeholder": "Bellik (hökmany däl)",
    "change_filter_pending": "Garaşýanlar",
    "change_filter_all": "Hemmesi",
    "change_scope_week": "Şu hepde",
    "change_scope_all": "Ähli hepdeler",
    "change_empty": "Plan üýtgetmesi ýok",
    "toast_change_approved": "Üýtgetme tassyklandy",
    "toast_change_rejected": "Üýtgetme ret edildi",
```

Validate: `node -e "['en','ru','tk'].forEach(l=>JSON.parse(require('fs').readFileSync('src/i18n/'+l+'.json','utf8')))"`. Expected: no output.

- [ ] **Step 7: Hooks**

In `frontend/src/hooks/usePlanning.ts` add `IPlanChangeRequest` and `PlanChangeStatus` to the `@/types` import. In `useUpsertDayEntry`'s `onSuccess` add:

```ts
      // A manager's in-week plan edit creates (or withdraws) a change request.
      queryClient.invalidateQueries({ queryKey: ['plan-change-requests'] });
```

After `useUpsertDayEntry`:

```ts
// ---------------------------------------------------------------------------
// Plan change requests (ADR-024) — in-week revisions awaiting approval
// ---------------------------------------------------------------------------

export function usePlanChangeRequests(
  filters: { status?: PlanChangeStatus; year?: number; week?: number } = {},
) {
  const { seasonId, isReady } = useSelectedSeason();
  return useQuery({
    queryKey: ['plan-change-requests', seasonId, filters],
    queryFn: async (): Promise<IApiListResponse<IPlanChangeRequest>> => {
      const params = new URLSearchParams();
      if (seasonId) params.set('season', String(seasonId));
      if (filters.status) params.set('status', filters.status);
      if (filters.year) params.set('year', String(filters.year));
      if (filters.week) params.set('week', String(filters.week));
      params.set('page_size', '200');
      const { data } = await api.get<IApiListResponse<IPlanChangeRequest>>(
        `/greenhouse/plan-change-requests/?${params}`,
      );
      return data;
    },
    enabled: !USE_MOCK && isReady,
    staleTime: 30_000,
  });
}

function usePlanChangeDecision(verb: 'approve' | 'reject') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, note }: { id: number; note?: string }): Promise<IPlanChangeRequest> => {
      const { data } = await api.post<IPlanChangeRequest>(
        `/greenhouse/plan-change-requests/${id}/${verb}/`,
        note ? { note } : {},
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plan-change-requests'] });
      queryClient.invalidateQueries({ queryKey: ['day-entries'] });
    },
  });
}

export function useApprovePlanChange() {
  return usePlanChangeDecision('approve');
}

export function useRejectPlanChange() {
  return usePlanChangeDecision('reject');
}
```

- [ ] **Step 8: Typecheck + tests**

```bash
npx tsc --noEmit --ignoreDeprecations 5.0
npx vitest run src/pages/export/WeeklyPlanGrid.roles.test.ts
```
Expected: no TS errors; roles suite PASS.

- [ ] **Step 9: Prepared commit** (only if the user said "commit")

```bash
git diff --cached --quiet || { echo "index not empty — stop"; exit 1; }
git add frontend/src/types/index.ts frontend/src/mock/planning.ts frontend/src/hooks/useGreenhouseConfig.ts \
  frontend/src/hooks/usePlanning.ts frontend/src/pages/export/WeeklyPlanGrid.roles.ts \
  frontend/src/pages/export/WeeklyPlanGrid.roles.test.ts frontend/src/i18n/en.json \
  frontend/src/i18n/ru.json frontend/src/i18n/tk.json
git commit -m "feat(frontend): add plan change request types, hooks and i18n

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```
Note: the three i18n files and `types/index.ts` already carry another session's uncommitted customs-expense hunks (see the starting `git status`). If `git diff` on them shows hunks that aren't yours, commit only your hunks (memory: *Shared Worktree Sessions*: build the blob from HEAD + your edits, via a private `GIT_INDEX_FILE`) or ask the user.

---

### Task 7: `HarvestCell` — pending badge and range check

**Files:**
- Modify: `frontend/src/components/HarvestCell.helpers.ts`
- Modify: `frontend/src/components/HarvestCell.tsx` (props interface; `planOnly` branch at ~line 199)
- Test: `frontend/src/components/HarvestCell.planChange.test.tsx`

**Interfaces:**
- Consumes: `IHarvestDayEntry.pending_change`, `.plan_baseline_value`; i18n `plan.pending_badge_tooltip`.
- Produces: `planChangeRange(entry, maxPct, today) -> { min: number; max: number } | null`. New optional `HarvestCell` props `maxChangePct?: number` and `onRangeError?: (min: number, max: number) => void`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/components/HarvestCell.planChange.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import dayjs from 'dayjs';
import { HarvestCell } from './HarvestCell';
import { planChangeRange } from './HarvestCell.helpers';
import type { IHarvestDayEntry } from '@/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const TODAY = dayjs().format('YYYY-MM-DD');

function entry(overrides: Partial<IHarvestDayEntry> = {}): IHarvestDayEntry {
  return {
    id: 42, block: 7, season: 1, weekly_plan: 3, entry_date: TODAY, weekday: 0,
    plan_value: '10000.00', plan_submitted_at: '2020-01-05T08:00:00Z', plan_submitted_by: null,
    plan_state: 'on_time', plan_baseline_value: null, pending_change: null,
    forecast_value: null, forecast_submitted_at: null, forecast_submitted_by: null, forecast_revision_count: 0,
    actual_value: null, actual_finalized_at: null, actual_source: '',
    last_override_at: null, last_override_by: null, last_override_reason: '',
    ...overrides,
  } as IHarvestDayEntry;
}

const managerProps = {
  canEditPlan: true, canEditActual: false, onSave: vi.fn(), onCellClick: vi.fn(),
  isAdmin: false, planOnly: true, savingKey: null, maxChangePct: 15, onRangeError: vi.fn(),
};

describe('planChangeRange', () => {
  const today = dayjs('2026-06-10'); // Wed of ISO 2026-W24

  it('is null before the plan week starts', () => {
    expect(planChangeRange(entry({ entry_date: '2026-06-17' }), 15, today)).toBeNull();
  });
  it('bounds a started week by the baseline, falling back to the plan value', () => {
    expect(planChangeRange(entry({ entry_date: '2026-06-11' }), 15, today)).toEqual({ min: 8500, max: 11500 });
    expect(
      planChangeRange(entry({ entry_date: '2026-06-11', plan_value: '11500.00', plan_baseline_value: '10000.00' }), 15, today),
    ).toEqual({ min: 8500, max: 11500 });
  });
  it('is null for an empty or zero baseline', () => {
    expect(planChangeRange(entry({ entry_date: '2026-06-11', plan_value: null }), 15, today)).toBeNull();
    expect(planChangeRange(entry({ entry_date: '2026-06-11', plan_value: '0.00' }), 15, today)).toBeNull();
  });
});

describe('HarvestCell — in-week plan change', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows the pending change with its percentage', () => {
    const pending = { id: 1, requested_value: '11500.00', change_pct: '15.00', requested_by_name: 'Myrat', requested_at: '' };
    render(<HarvestCell {...managerProps} entry={entry({ pending_change: pending })} />);
    expect(screen.getByTestId('pending-change')).toHaveTextContent('→ 11,500 (+15%)');
  });

  it('shows no badge when nothing is pending', () => {
    render(<HarvestCell {...managerProps} entry={entry()} />);
    expect(screen.queryByTestId('pending-change')).not.toBeInTheDocument();
  });

  it('refuses an out-of-range value without saving', () => {
    const { container } = render(<HarvestCell {...managerProps} entry={entry()} />);
    fireEvent.click(container.querySelector('[data-edit-cell]')!);
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '12000' } });
    fireEvent.blur(input);
    expect(managerProps.onRangeError).toHaveBeenCalledWith(8500, 11500);
    expect(managerProps.onSave).not.toHaveBeenCalled();
  });

  it('saves an in-range value', () => {
    const { container } = render(<HarvestCell {...managerProps} entry={entry()} />);
    fireEvent.click(container.querySelector('[data-edit-cell]')!);
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '11000' } });
    fireEvent.blur(input);
    expect(managerProps.onSave).toHaveBeenCalledWith(42, 'plan_value', 11000);
  });

  it('does not range-check admin-like users', () => {
    const { container } = render(<HarvestCell {...managerProps} isAdmin entry={entry({ plan_value: null })} />);
    fireEvent.click(container.querySelector('[data-edit-cell]')!);
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '99000' } });
    fireEvent.blur(input);
    expect(managerProps.onRangeError).not.toHaveBeenCalled();
    expect(managerProps.onSave).toHaveBeenCalledWith(42, 'plan_value', 99000);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/components/HarvestCell.planChange.test.tsx`
Expected: FAIL. `planChangeRange` is not exported and there's no `pending-change` element.

- [ ] **Step 3: The helper**

Append to `frontend/src/components/HarvestCell.helpers.ts` (add `IHarvestDayEntry` to its type import):

```ts
/**
 * The ±maxPct window a greenhouse manager may request once the cell's plan week
 * has started (ADR-024). Null when no bound applies: the week hasn't started,
 * or the baseline is empty or zero. The baseline is `plan_baseline_value`, or the
 * current plan when it hasn't been frozen yet (the server freezes it on the first
 * request). Mirrors backend `_bounded_change_pct`, which stays authoritative.
 */
export function planChangeRange(
  entry: Pick<IHarvestDayEntry, 'entry_date' | 'plan_value' | 'plan_baseline_value'>,
  maxPct: number,
  today: dayjs.Dayjs,
): { min: number; max: number } | null {
  const date = dayjs(entry.entry_date);
  const weekMonday = date.subtract((date.day() + 6) % 7, 'day');
  if (today.isBefore(weekMonday, 'day')) return null;
  const baseline = Number(entry.plan_baseline_value ?? entry.plan_value ?? 0);
  if (!baseline) return null;
  // Multiply before dividing: `10000 * 1.15` is 11499.999… in floating point.
  return {
    min: Math.ceil((baseline * (100 - maxPct)) / 100),
    max: Math.floor((baseline * (100 + maxPct)) / 100),
  };
}
```

- [ ] **Step 4: `HarvestCell` props, badge, range check**

1. Imports: add `fmtKg, planChangeRange` from `'./HarvestCell.helpers'`.
2. Add to `IHarvestCellProps`:

```ts
  /**
   * `GreenhouseConfig.plan_change_max_pct`. When set, a non-admin editing a cell
   * whose week has started is held to ±this % of the baseline (ADR-024).
   */
  maxChangePct?: number;
  /** Called instead of `onSave` when a non-admin's value falls outside the range. */
  onRangeError?: (min: number, max: number) => void;
```

and destructure both in the component signature.

3. Add the badge sub-render next to `ActualSourceBadge`:

```tsx
function PendingChangeBadge({ change }: { change: NonNullable<IHarvestDayEntry['pending_change']> }) {
  const { t } = useTranslation();
  const pct = change.change_pct != null ? Number(change.change_pct) : null;
  const pctText = pct == null ? '' : ` (${pct > 0 ? '+' : ''}${pct}%)`;
  return (
    <Tooltip title={t('plan.pending_badge_tooltip', { name: change.requested_by_name ?? '—' })}>
      <div
        data-testid="pending-change"
        style={{
          fontSize: 10, color: '#ad6800', background: '#fffbe6',
          borderRadius: 3, padding: '0 4px', whiteSpace: 'nowrap',
        }}
      >
        → {fmtKg(change.requested_value)}{pctText} ⏳
      </div>
    </Tooltip>
  );
}
```

4. In the `planOnly` branch, compute the range before the `if (planEditable && editingPlan)` line:

```tsx
    const range = !isAdmin && maxChangePct != null ? planChangeRange(entry, maxChangePct, today) : null;
```

Replace the plan `InputNumber`'s `onBlur` with:

```tsx
              onBlur={(e) => {
                const raw = e.target.value.replace(/,/g, '');
                const v = raw === '' ? null : Number(raw) || 0;
                if (range && v != null && (v < range.min || v > range.max)) {
                  setEditingPlan(false);
                  onRangeError?.(range.min, range.max);
                  return;
                }
                handleValueBlur('plan_value', entry.plan_value, v, setEditingPlan);
              }}
```

Right after that `InputNumber` (inside the same `<div style={{ minHeight: 24 }}>`):

```tsx
            {range && (
              <div style={{ fontSize: 10, color: COLORS.textMuted }}>
                {fmtKg(range.min)}–{fmtKg(range.max)}
              </div>
            )}
```

In the non-editing return of the `planOnly` branch, after `<ValueOrEmpty … />`:

```tsx
        {entry.pending_change && <PendingChangeBadge change={entry.pending_change} />}
```

- [ ] **Step 5: Run the new and existing cell tests**

```bash
npx vitest run src/components/HarvestCell.planChange.test.tsx src/components/HarvestCell.planOnly.test.tsx
npx tsc --noEmit --ignoreDeprecations 5.0
```
Expected: both suites PASS (planOnly unchanged), no TS errors.

- [ ] **Step 6: Prepared commit** (only if the user said "commit")

```bash
git diff --cached --quiet || { echo "index not empty — stop"; exit 1; }
git add frontend/src/components/HarvestCell.helpers.ts frontend/src/components/HarvestCell.tsx \
  frontend/src/components/HarvestCell.planChange.test.tsx
git commit -m "feat(frontend): show pending plan changes and the allowed range on HarvestCell

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: "Plan changes" drawer + Weekly Plan wiring

**Files:**
- Create: `frontend/src/components/PlanChangeRequestsDrawer.tsx`
- Test: `frontend/src/components/PlanChangeRequestsDrawer.test.tsx`
- Modify: `frontend/src/pages/export/WeeklyPlanGrid.tsx` (imports; state near line 79; capability destructure ~161; `handleCellSave` ~292; both `<HarvestCell>` usages ~396 and ~503; toolbar `<Space wrap>` ~617; drawer next to `<CellHistoryModal>` ~881)

**Interfaces:**
- Consumes: Task 6 hooks/types/capability/i18n; Task 7 props.
- Produces: `PlanChangeRequestsDrawer({ open, onClose, year, week, canDecide })`.

- [ ] **Step 1: Write the failing drawer test**

`frontend/src/components/PlanChangeRequestsDrawer.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlanChangeRequestsDrawer } from './PlanChangeRequestsDrawer';
import type { IPlanChangeRequest } from '@/types';

const approveMutate = vi.fn();
const rejectMutate = vi.fn();

const ROW: IPlanChangeRequest = {
  id: 41, entry: 1203, block: 5, block_code: 'F', entry_date: '2026-06-10', weekday: 2,
  baseline_value: '10000.00', current_value: '10000.00', requested_value: '11500.00', change_pct: '15.00',
  status: 'pending', reason: 'cold snap', requested_by: 17, requested_by_name: 'Myrat',
  requested_at: '2026-06-10T09:10:00+05:00', decided_by: null, decided_by_name: null, decided_at: null,
  decision_note: '',
};

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/usePlanning', () => ({
  usePlanChangeRequests: () => ({ data: { count: 1, next: null, previous: null, results: [ROW] }, isLoading: false }),
  useApprovePlanChange: () => ({ mutate: approveMutate, isPending: false }),
  useRejectPlanChange: () => ({ mutate: rejectMutate, isPending: false }),
}));

const props = { open: true, onClose: vi.fn(), year: 2026, week: 24 };

describe('PlanChangeRequestsDrawer', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('lists the request with its signed percentage', () => {
    render(<PlanChangeRequestsDrawer {...props} canDecide={false} />);
    expect(screen.getByText('+15%')).toBeInTheDocument();
    expect(screen.getByText('11,500')).toBeInTheDocument();
    expect(screen.getByText('cold snap')).toBeInTheDocument();
  });

  it('hides decision buttons from non-approvers', () => {
    render(<PlanChangeRequestsDrawer {...props} canDecide={false} />);
    expect(screen.queryByRole('button', { name: 'plan.change_approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'plan.change_reject' })).not.toBeInTheDocument();
  });

  it('approver: Approve → confirm calls the approve mutation', async () => {
    render(<PlanChangeRequestsDrawer {...props} canDecide />);
    fireEvent.click(screen.getByRole('button', { name: 'plan.change_approve' }));
    fireEvent.click(await screen.findByRole('button', { name: 'OK' }));
    expect(approveMutate).toHaveBeenCalledWith({ id: 41 }, expect.any(Object));
  });

  it('approver: Reject → note → OK calls the reject mutation with the note', async () => {
    render(<PlanChangeRequestsDrawer {...props} canDecide />);
    fireEvent.click(screen.getByRole('button', { name: 'plan.change_reject' }));
    fireEvent.change(await screen.findByPlaceholderText('plan.change_reject_note_placeholder'), {
      target: { value: 'too high' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(rejectMutate).toHaveBeenCalledWith({ id: 41, note: 'too high' }, expect.any(Object));
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/components/PlanChangeRequestsDrawer.test.tsx`
Expected: FAIL. The module isn't found.

- [ ] **Step 3: The drawer**

`frontend/src/components/PlanChangeRequestsDrawer.tsx`:

```tsx
import { useState } from 'react';
import { Button, Drawer, Input, Modal, Popconfirm, Segmented, Space, Table, Tag } from 'antd';
import type { TableColumnsType } from 'antd';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useApprovePlanChange, usePlanChangeRequests, useRejectPlanChange } from '@/hooks/usePlanning';
import { fmtKg } from '@/components/HarvestCell.helpers';
import type { IPlanChangeRequest, PlanChangeStatus } from '@/types';

/**
 * The in-week plan revision log and approval queue (ADR-024).
 *
 * Everyone who reaches the Weekly Plan page may read it; `canDecide`
 * (export_manager / admin / boss) adds Approve / Reject on pending rows.
 * The backend re-checks the role — this flag only decides what to render.
 */
interface IPlanChangeRequestsDrawerProps {
  open: boolean;
  onClose: () => void;
  year: number | undefined;
  week: number | undefined;
  canDecide: boolean;
}

const STATUS_COLOR: Record<PlanChangeStatus, string> = {
  pending: 'gold',
  approved: 'green',
  rejected: 'red',
  superseded: 'default',
};

function PctCell({ pct }: { pct: string | null }) {
  if (pct == null) return <span>—</span>;
  const n = Number(pct);
  const color = n > 0 ? '#389e0d' : n < 0 ? '#cf1322' : undefined;
  return <span style={{ color, fontWeight: 600 }}>{n > 0 ? '+' : ''}{n}%</span>;
}

export function PlanChangeRequestsDrawer({ open, onClose, year, week, canDecide }: IPlanChangeRequestsDrawerProps) {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<'pending' | 'all'>('pending');
  const [scope, setScope] = useState<'week' | 'all'>('week');
  const [rejecting, setRejecting] = useState<IPlanChangeRequest | null>(null);
  const [note, setNote] = useState('');

  const { data, isLoading } = usePlanChangeRequests({
    status: statusFilter === 'pending' ? 'pending' : undefined,
    ...(scope === 'week' ? { year, week } : {}),
  });
  const approve = useApprovePlanChange();
  const reject = useRejectPlanChange();

  function handleApprove(row: IPlanChangeRequest) {
    approve.mutate(
      { id: row.id },
      {
        onSuccess: () => toast.success(t('plan.toast_change_approved')),
        onError: () => toast.error(t('common.error')),
      },
    );
  }

  function closeReject() {
    setRejecting(null);
    setNote('');
  }

  function handleReject() {
    if (!rejecting) return;
    reject.mutate(
      { id: rejecting.id, note },
      {
        onSuccess: () => {
          toast.success(t('plan.toast_change_rejected'));
          closeReject();
        },
        onError: () => toast.error(t('common.error')),
      },
    );
  }

  const columns: TableColumnsType<IPlanChangeRequest> = [
    { title: t('plan.change_col_block'), dataIndex: 'block_code', width: 70 },
    {
      title: t('plan.change_col_day'), dataIndex: 'entry_date', width: 90,
      render: (d: string) => dayjs(d).format('DD.MM ddd'),
    },
    { title: t('plan.change_col_baseline'), dataIndex: 'baseline_value', align: 'right', render: fmtKg },
    { title: t('plan.change_col_current'), dataIndex: 'current_value', align: 'right', render: fmtKg },
    { title: t('plan.change_col_requested'), dataIndex: 'requested_value', align: 'right', render: fmtKg },
    { title: '±%', dataIndex: 'change_pct', align: 'right', render: (p: string | null) => <PctCell pct={p} /> },
    { title: t('plan.change_col_requested_by'), dataIndex: 'requested_by_name' },
    { title: t('plan.change_col_reason'), dataIndex: 'reason' },
    {
      title: t('plan.change_col_status'), dataIndex: 'status',
      render: (s: PlanChangeStatus) => <Tag color={STATUS_COLOR[s]}>{t(`plan.change_status_${s}`)}</Tag>,
    },
    {
      title: t('plan.change_col_decided_by'), key: 'decided',
      render: (_: unknown, row) =>
        row.decided_by_name ? `${row.decided_by_name} · ${dayjs(row.decided_at).format('DD.MM HH:mm')}` : '—',
    },
    { title: t('plan.change_col_note'), dataIndex: 'decision_note' },
    ...(canDecide
      ? [{
          key: 'actions',
          render: (_: unknown, row: IPlanChangeRequest) =>
            row.status === 'pending' && (
              <Space size={4}>
                <Popconfirm title={t('plan.change_approve')} onConfirm={() => handleApprove(row)}>
                  <Button size="small" type="primary" loading={approve.isPending}>
                    {t('plan.change_approve')}
                  </Button>
                </Popconfirm>
                <Button size="small" danger onClick={() => setRejecting(row)}>
                  {t('plan.change_reject')}
                </Button>
              </Space>
            ),
        }]
      : []),
  ];

  return (
    <Drawer open={open} onClose={onClose} width="min(1100px, 100vw)" title={t('plan.changes_title')}>
      <Space style={{ marginBottom: 12 }} wrap>
        <Segmented
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as 'pending' | 'all')}
          options={[
            { label: t('plan.change_filter_pending'), value: 'pending' },
            { label: t('plan.change_filter_all'), value: 'all' },
          ]}
        />
        <Segmented
          value={scope}
          onChange={(v) => setScope(v as 'week' | 'all')}
          options={[
            { label: t('plan.change_scope_week'), value: 'week' },
            { label: t('plan.change_scope_all'), value: 'all' },
          ]}
        />
      </Space>
      <Table
        rowKey="id"
        size="small"
        loading={isLoading}
        columns={columns}
        dataSource={data?.results ?? []}
        pagination={false}
        scroll={{ x: 1000 }}
        locale={{ emptyText: t('plan.change_empty') }}
      />
      <Modal
        open={rejecting !== null}
        title={t('plan.change_reject')}
        onOk={handleReject}
        onCancel={closeReject}
        okButtonProps={{ danger: true, loading: reject.isPending }}
      >
        <Input.TextArea
          rows={3}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('plan.change_reject_note_placeholder')}
        />
      </Modal>
    </Drawer>
  );
}
```

- [ ] **Step 4: Run the drawer tests**

Run: `npx vitest run src/components/PlanChangeRequestsDrawer.test.tsx`
Expected: PASS. If a test can't find the AntD `OK` button, check the locale: AntD's Popconfirm/Modal default `okText` is "OK" under the default `en_US` locale in tests. Match by that text rather than changing the component.

- [ ] **Step 5: Wire it into `WeeklyPlanGrid.tsx`**

1. Imports: add `Badge` to the `antd` import list, `DiffOutlined` to the `@ant-design/icons` list, `usePlanChangeRequests` to the `@/hooks/usePlanning` import, and:

```tsx
import { PlanChangeRequestsDrawer } from '@/components/PlanChangeRequestsDrawer';
```

2. State, right after `const deepLinkBlock = searchParams.get('block');`:

```tsx
  // ?changes=1 comes from plan-change notifications — open the log straight away.
  const [changesOpen, setChangesOpen] = useState(() => searchParams.get('changes') === '1');
```

3. Add `canDecidePlanChanges,` to the `planGridCapabilities(...)` destructure. After `const { data: config } = useGreenhouseConfig();` add:

```tsx
  const maxChangePct = Number(config?.plan_change_max_pct ?? 15);
  const { data: pendingChanges } = usePlanChangeRequests({ status: 'pending', year, week: weekNumber });
  const pendingChangeCount = pendingChanges?.count ?? 0;
```

4. `handleCellSave`: replace the `onSuccess` / `onError` bodies:

```tsx
        onSuccess: (saved) => {
          if (field === 'plan_value' && saved.pending_change) {
            toast.info(t('plan.toast_sent_for_approval'));
          } else {
            toast.success(
              t(field === 'plan_value' ? 'plan.toast_plan_saved' : 'plan.toast_actual_saved'),
            );
          }
          setSavingKey(null);
        },
        onError: (err: unknown) => {
          const apiErr = err as { response?: { data?: { error?: string; plan_value?: string } } };
          const serverMsg = apiErr?.response?.data?.error ?? apiErr?.response?.data?.plan_value ?? '';
          if (serverMsg.includes('Plan edits')) {
            toast.error(t('plan.edit_window_closed_toast'));
          } else if (serverMsg.includes('Allowed range')) {
            toast.error(serverMsg);
          } else {
            toast.error(t('plan.toast_save_error'));
          }
          setSavingKey(null);
        },
```

and add below `handleCellSave`:

```tsx
  function handleRangeError(min: number, max: number) {
    toast.error(t('plan.change_out_of_range', { min: fmtKg(min), max: fmtKg(max) }));
  }
```

5. Both `<HarvestCell … />` usages: add after `savingKey={savingKey}`:

```tsx
            maxChangePct={maxChangePct}
            onRangeError={handleRangeError}
```

6. Toolbar: inside `<Space wrap>`, right after the Sunday toggle button block:

```tsx
          <Badge count={pendingChangeCount} size="small">
            <Button icon={<DiffOutlined />} onClick={() => setChangesOpen(true)}>
              {t('plan.changes_button')}
            </Button>
          </Badge>
```

7. Next to `<CellHistoryModal … />`:

```tsx
      <PlanChangeRequestsDrawer
        open={changesOpen}
        onClose={() => setChangesOpen(false)}
        year={year}
        week={weekNumber}
        canDecide={canDecidePlanChanges}
      />
```

- [ ] **Step 6: Typecheck and run the frontend suites**

```bash
npx tsc --noEmit --ignoreDeprecations 5.0
npx vitest run src/components/PlanChangeRequestsDrawer.test.tsx src/components/HarvestCell.planChange.test.tsx \
  src/components/HarvestCell.planOnly.test.tsx src/pages/export/WeeklyPlanGrid.roles.test.ts
npx vitest run
```
Expected: no TS errors; the four targeted suites PASS; the full run shows no new failures compared with before this plan.

- [ ] **Step 7: Prepared commit** (only if the user said "commit")

```bash
git diff --cached --quiet || { echo "index not empty — stop"; exit 1; }
git add frontend/src/components/PlanChangeRequestsDrawer.tsx \
  frontend/src/components/PlanChangeRequestsDrawer.test.tsx frontend/src/pages/export/WeeklyPlanGrid.tsx
git commit -m "feat(frontend): add Plan changes drawer to the weekly plan

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Docs, changelog, build log

**Files:**
- Modify: `docs/ADR.md` (append after ADR-023)
- Modify: `docs/obsidian/processes/weekly-harvest-planning.md`
- Modify: `docs/obsidian/reference/api-endpoint-map.md`
- Modify: `.claude/skills/api-contract/SKILL.md`
- Modify: `CHANGELOG.md`, `BUILD_TEST_LOG.md`

- [ ] **Step 1: ADR-024**

Append to `docs/ADR.md`:

```markdown
## ADR-024: In-week plan revisions need export-manager approval (qualifies ADR-017)

**Decision**: A greenhouse manager's plan edit is still final **until the plan week starts** (Monday 00:00 in `GreenhouseConfig.timezone_name`). From then on, `set_plan_value()` does not write `plan_value` for that role. It creates a `greenhouse.PlanChangeRequest` (`export.plan_change_requests`) that an `export_manager`, `admin` or `boss` approves or rejects. The request is bounded to ±`GreenhouseConfig.plan_change_max_pct` (default 15%) of the cell's **week-start baseline**, `HarvestDayEntry.plan_baseline_value`. The baseline is frozen lazily on the first in-week request and the bound is cumulative. Empty and zero-baseline cells need approval but have no bound. One pending request per cell (filtered unique index); a newer one supersedes it, and setting the approved value again withdraws it. While a request is pending the old value stays live everywhere (totals, truck estimates). Approval writes `plan_value` credited to the requester and logs `plan_value_set` in AuditLog. Admin/boss direct in-week edits skip approval and reset the baseline. The request table is also the change log: rows are never deleted.

**Context**: ADR-017 removed the week-level approve/reject workflow ("submission is final"). The owner now wants managers to adjust a running week by 10–15% with the export manager seeing and approving the ±%. This is a different grain (per cell, per revision), so the dropped `WeeklyHarvestPlan.status/approved_*/rejected_*` columns stay dropped. Week start is a **mode switch, not a lock**: `_plan_edit_window_closed()` (open through the week's own Sunday) is unchanged, so managers still revise already-passed days of the current week, via approval.

**Consequences**: `set_plan_value()` returns the request when it routes to approval; `PATCH /day-entries/{id}/` answers 202. A pending request on an empty cell keeps the manager's `weekly_plan` task open (ADR-021) until approved. In-week revisions no longer fire `plan_late`/`plan_critical_late`; `plan_change_requested` notifies export managers instead. `document_team` is deliberately **not** an approver despite `EXPORT_MANAGER_LIKE`. The admin import commands (`import_weekly_plan`, `import_harvest_plans`) still write `plan_value` directly. Tests: `apps/greenhouse/tests/test_plan_change_*.py`.
```

- [ ] **Step 2: Obsidian process doc**

In `docs/obsidian/processes/weekly-harvest-planning.md`:
- Line 17 ("Submission is final…"): replace with "Submission is final **until the plan week starts**. After Monday 00:00 a manager's change becomes a ±15%-bounded request that the export manager approves (ADR-024, see *In-week revisions* below)."
- Add a `### PlanChangeRequest` table under **Database → Tables** (fields as in the spec), `plan_baseline_value` to the `HarvestDayEntry` Plan row, and `plan_change_max_pct` to the `GreenhouseConfig` table.
- Add a section **In-week revisions (ADR-024)**: the 11 rules from the spec, verbatim.
- Services table: add `request_plan_change`, `approve_plan_change`, `reject_plan_change`, `plan_week_started`, `reset_baseline_after_direct_edit`.
- Endpoints table: the three new routes + "PATCH day-entries → 202 when sent for approval".
- Frontend: the pending badge in `HarvestCell` (`planOnly` branch), `planChangeRange()`, `PlanChangeRequestsDrawer` (toolbar button + `?changes=1`), hooks.
- Roles table: `export_manager` column **Plan**: "View; approves in-week revisions". Same for `admin`/`boss`. `greenhouse_manager` **Plan**: add "after week start: ±15% via approval".

- [ ] **Step 3: API docs**

`.claude/skills/api-contract/SKILL.md`: add a section `### Plan change requests (ADR-024): /api/v1/greenhouse/plan-change-requests/` with the list/approve/reject shapes, error bodies, the `pending_change`/`plan_baseline_value` day-entry additions, and "PATCH `/greenhouse/day-entries/{id}/` returns **202** (same body) when a manager's in-week plan edit was sent for approval". Copy the JSON blocks from the spec's API section. State that all decimals are **strings**. List the endpoint in the season-scoped list under *Season scoping (AD-16)* (anchor `entry__season`).
`docs/obsidian/reference/api-endpoint-map.md`: add the three routes in the greenhouse block.

- [ ] **Step 4: Changelog + build log**

`CHANGELOG.md`, under `[Unreleased]` → **Added**:
```markdown
- In-week weekly-plan revisions: greenhouse managers can change a started week's plan by up to ±15%, pending export-manager approval; "Plan changes" log/approval drawer (ADR-024)
```
`BUILD_TEST_LOG.md`, newest on top:
```markdown
- [ ] 2026-09-18 — Weekly plan in-week revision approval (±15%, export manager approves, Plan changes drawer) — NEEDS TEST
```

- [ ] **Step 5: Prepared commit** (only if the user said "commit")

```bash
git diff --cached --quiet || { echo "index not empty — stop"; exit 1; }
git add docs/ADR.md docs/obsidian/processes/weekly-harvest-planning.md docs/obsidian/reference/api-endpoint-map.md \
  .claude/skills/api-contract/SKILL.md CHANGELOG.md BUILD_TEST_LOG.md
git commit -m "docs: record ADR-024 in-week plan revision approval

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```
`api-contract/SKILL.md`, `api-endpoint-map.md`, `CHANGELOG.md` and `BUILD_TEST_LOG.md` carry another session's uncommitted hunks. Commit only your own hunks (see the Task 6 note) or ask.

---

## Manual check (after all tasks)

Local app, not the live DB during working hours (memory: *E2E Tests After Hours*):
1. As a greenhouse manager, on the current week, change a filled cell by +10%. You should see the "sent for approval" toast, the cell keeps its old value, and the yellow `→ … (+10%) ⏳` badge appears.
2. Enter +20%. You should get the range toast and no save.
3. As the export manager: the bell notification opens `/export/plan?…&changes=1` with the drawer open. Approve, and the cell shows the new value with no badge.
4. Repeat and reject with a note. The manager gets a notification with the note.
