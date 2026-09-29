# Packing Join / Unjoin / Swap on the Assignment Board — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the packing part (план поставки / Üpjünçilik bölegi) be joined to an export part any time before loading, detached again, or swapped between two trucks — on the Assignment board and on the Sheet.

**Architecture:** "Move" model: the packing fields and `block_sources` always live on the `Shipment` row that currently carries them; join / unjoin / swap move them between rows under `select_for_update`. A new service module `apps/export/services/packaging.py` owns the rules (`PRE_LOADING`, weight rule, unjoin, swap). The draft-exit barrier in `transition_to()` stops requiring blocks; a new barrier refuses `→ yuklenme` without packing, and the Sheet PATCH refuses `loading_started_at` on a pre-loading row without packing. The Assignment board's mock demand column is replaced by export parts; the Sheet's field-picking Swap becomes a packing swap.

**Tech Stack:** Django 5 / DRF on MSSQL (tests run on a local MSSQL test DB), React 18 + antd 5 + TanStack Query + react-i18next, vitest.

**Spec:** [`docs/superpowers/specs/2026-09-29-packaging-join-board-design.md`](../specs/2026-09-29-packaging-join-board-design.md) — read it first; this plan argues from it.

## Global Constraints

- **MSSQL:** no `JSONField`, no `ArrayField`, no `.distinct('field')`; every `bulk_create` / `bulk_update` gets `batch_size=500`.
- **Status changes only through `transition_to()`.** Nothing here writes `status_id`. Join / unjoin / swap write with `QuerySet.update()` so `Shipment.save()` never runs `auto_advance_if_ready()` — a packing move must never move a truck.
- **No Django signals.** Explicit calls only. Dependency direction `core ← greenhouse ← export`.
- **Business logic in services, not views** (`backend/CLAUDE.md`). Views validate the body, call the service, serialize.
- **Weight rule (spec, Terms):** a row in `draft` gets `weight_net = packaging_weight` of the packing now on it (none → `null`); a row NOT in `draft` gets it only if its `weight_net` is `null`; `weight_gross` is never touched.
- **`PRE_LOADING = {'draft', 'gumruk_girish', 'gumruk_chykysh'}`** — the only statuses where packing may move. Rows with pallets (`shipment.pallets.exists()`) never move packing.
- **Roles for join / unjoin / swap:** `JOIN_ROLES` = `admin, director, boss, export_manager, document_team, loading_dept_head, loading_dept_head_deputy` + superuser, identical on backend (`apps/core/roles.py`) and frontend (`components/sheet/joinHelpers.ts`).
- **i18n:** every user-visible string in `tk`, `ru` and `en` (`frontend/src/i18n/*.json`). Never the words "draft" / «черновик» / "garalama" in UI text — say «план поставки / план назначения», tk «Üpjünçilik bölegi / Eksport bölegi», en "supply plan / destination plan".
- **Backend error messages are English**, like every other backend error; the frontend shows them via `extractPatchError` (`hooks/useShipmentPatch.ts`).
- **Shared tree, shared index.** Before every `git add`: `git status` — if it shows deletions you did not make or far more files than you touched, STOP. Before every commit: `git diff --cached` — commit only your own paths, by name. Never `git add -A` / `git add .`.
- **Migration numbers are not fixed here.** Before writing one: `ls backend/apps/core/migrations/ | tail -3` and `git log --oneline -5`. Last committed core migration when this plan was written: `0065_greenhouseconfig_scan_base_url` → expected `0066`, verify.
- **Never commit or push without the user saying "commit".** Commit steps are written out ready to run — wait for the word. Co-author line: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- **Four code commits, as approved:** (1) barrier, (2) backend join/unjoin/swap/roles/list, (3) board, (4) Sheet. Then one docs commit.
- **Log every build:** after each code commit append `- [ ] 2026-09-29 — <what> — NEEDS TEST` to the top of `BUILD_TEST_LOG.md`.
- **Files other sessions also edit** (`BUILD_TEST_LOG.md`, `CHANGELOG.md`, `DECISIONS.md`, `docs/obsidian/**`): before staging, `git diff <file>` and confirm only your own lines are there. If another session's hunks are present, commit only your hunks through a private index (`GIT_INDEX_FILE=<scratchpad>/idx git read-tree HEAD`, apply your hunk, `git commit-tree`/`update-ref`) — see memory "Shared Worktree Sessions" — or ask the user.

## Review Focus

1. **Same block + same harvest date on both trucks in a swap** → must swap cleanly, no `IntegrityError` from `unique_together (shipment, block, harvest_date)`. Test in Task 4 (`test_swap_same_block_same_date_on_both_sides`).
2. **Supply-first packing with unweighed blocks** (`weight_kg = null`, total in `weight_net`) moved onto a `draft` row → the row gets the declared total, not `0`/`null`. Tests in Task 3 (`test_unjoin_unweighed_blocks_carry_declared_total`) and Task 4 (`test_swap_unweighed_packing_into_draft_carries_total`).
3. **Unjoin must not shift the weekly-plan actual to another day** → the new row's code encodes the export row's `date`, not today. Test in Task 3 (`test_unjoin_new_code_uses_export_row_date`).
4. **Loading entered on a customs row without packing** → 400 with `PACKING_NOT_JOINED`, status unchanged; a legacy `yola_chykdy` row without blocks can still be PATCHed. Tests in Task 1.
5. **A stale second action on the same pair** (two operators; the source was already consumed by a join) → clean 404/400, never 500 and never lost blocks. Test in Task 4 (`test_swap_with_consumed_source_returns_404`).

Known limitation, not tested: the board fetches `page_size=200` (backend max); more than 200 pre-loading rows are silently cut, same as today's `useDrafts()`.

---

## File Structure

**Backend**
- Create `backend/apps/export/services/packaging.py` — `PRE_LOADING`, `PACKING_FIELDS`, `PACKING_NOT_JOINED`, `has_packing`, `needs_packing_for_loading`, `packaging_weight`, `net_update`, `assert_can_move_packing`, `unjoin_packing`, `swap_packing`, `_notify_packing_change`.
- Modify `backend/apps/export/services/shipment.py` — the guard inside `transition_to()`.
- Modify `backend/apps/export/serializers.py` — `ShipmentPatchSerializer.validate`, `ShipmentDraftListSerializer.Meta.fields`, replace `ShipmentSwapSerializer` with `ShipmentSwapPackagingSerializer`.
- Modify `backend/apps/export/views.py` — `get_permissions` branches, `get_serializer_class`, `get_queryset` (`status_code__in`), `join` / `_validate_join` / `_execute_join`, new `unjoin` and `swap_packaging` actions, delete `swap` / `_execute_swap` / `swappable_fields`.
- Modify `backend/apps/core/roles.py` — `JOIN_ROLES`.
- Modify `backend/apps/core/management/commands/seed_permissions.py` — `export.assign` page for `loading_dept_head`.
- Create `backend/apps/core/migrations/0066_loading_dept_assign_page.py` (number verified first).
- Delete `backend/apps/export/swap_config.py`, `backend/apps/export/tests_shipment_swap.py`.
- Create `backend/apps/export/tests_packing.py` — all new backend tests (one file, classes per task).
- Modify tests: `tests_draft_promote.py`, `tests_shipment_join.py`, `tests_season_freeze.py`, `tests_task_condition_reconcile_api.py`, plus any fixture that walks `gumruk_chykysh → yuklenme` without blocks (found in Task 1).

**Frontend**
- Modify `frontend/src/components/sheet/joinHelpers.ts` (+ `.test.ts`) — `PRE_LOADING_STATUSES`, `isPreLoading`, `hasPacking`, `isJoinTarget` (renamed from `isDestinationDraft`), `explainJoinBlockers`, `explainSwapBlockers`, `JOIN_ROLES`.
- Modify `frontend/src/hooks/useDrafts.ts` — `useJoinBoard`, `useUnjoinPackaging`, `useSwapPackaging`; delete `useSwapShipments`.
- Modify `frontend/src/types/index.ts` — `IShipmentDraft` optional fields; delete `IDemandItem`.
- Create `frontend/src/pages/export/assignment/boardHelpers.ts` (+ `.test.ts`), `ExportPartCard.tsx`, `PackingActionPanel.tsx`, `BoardColumn.tsx`.
- Rewrite `frontend/src/pages/export/AssignmentBoard.tsx`.
- Delete `frontend/src/pages/export/assignment/DemandCard.tsx`, `MatchPanel.tsx`, `frontend/src/mock/demand.ts`; trim `assignmentHelpers.ts` to `FRESHNESS_BORDER`.
- Rewrite `frontend/src/components/sheet/SwapActionBar.tsx`; delete `SwapFieldsModal.tsx`, `swapFieldGroups.ts`.
- Modify `JoinActionBar.tsx`, `SheetToolbar.tsx`, `components/shipment/ShipmentDetailHero.tsx` (+ comment in its test).
- Modify `frontend/src/i18n/{tk,ru,en}.json`.

---

### Task 0: Baseline (no commit)

**Files:** none in the repo. Create `<your scratchpad>/settings_isolated.py`.

- [ ] **Step 1: Private test database settings.** Two concurrent `manage.py test` runs on this machine deadlock on the shared `test_YIGIT_PLATFROM`. Create `settings_isolated.py` in your scratchpad directory (outside the repo):

```python
from config.settings import *  # noqa: F401,F403

DATABASES['default']['NAME'] = 'master'  # required: Django opens NAME before creating the test DB
DATABASES['default']['TEST']['NAME'] = 'test_YIGIT_PACKING'
```

Every backend test command in this plan runs from `backend/` as:

```bash
PYTHONPATH=<scratchpad> ./venv/Scripts/python.exe manage.py test <labels> --noinput --keepdb --settings=settings_isolated
```

- [ ] **Step 2: Backend baseline.** Run the whole export + core suites once and save the failing test ids. The suite has pre-existing failures (see `docs/PRE_EXISTING_TEST_FAILURES.md`); only failures NOT in this baseline count as regressions later.

```bash
cd backend
PYTHONPATH=<scratchpad> ./venv/Scripts/python.exe manage.py test apps.export apps.core --noinput --keepdb --settings=settings_isolated 2>&1 | tee <scratchpad>/baseline_backend.txt
grep -E "^(FAIL|ERROR):" <scratchpad>/baseline_backend.txt | sort > <scratchpad>/baseline_failures.txt
```

Expected: ~10 min, a run that finishes with some FAIL/ERROR lines. Keep `baseline_failures.txt`.

- [ ] **Step 3: Frontend baseline.**

```bash
cd frontend
npx vitest run 2>&1 | tail -15 > <scratchpad>/baseline_frontend.txt
npx tsc --noEmit --ignoreDeprecations 5.0 2>&1 | tail -5 >> <scratchpad>/baseline_frontend.txt
```

(`npm run type-check` is broken with TS5103; use the `npx tsc` form.) Record the pass/fail counts.

---

### Task 1: Move the loading barrier (commit 1)

**Files:**
- Create: `backend/apps/export/services/packaging.py` (first part)
- Modify: `backend/apps/export/services/shipment.py` (guard in `transition_to`, ~line 287)
- Modify: `backend/apps/export/serializers.py` (`ShipmentPatchSerializer.validate`, ~line 1716)
- Modify: `backend/apps/export/tests_draft_promote.py` (`DraftLeaveGuardTests`, ~line 339)
- Create: `backend/apps/export/tests_packing.py`

**Interfaces:**
- Produces (`apps/export/services/packaging.py`): `PRE_LOADING: frozenset[str]`, `PACKING_NOT_JOINED: str`, `has_packing(shipment) -> bool`, `needs_packing_for_loading(shipment) -> bool`.

- [ ] **Step 1: Write the failing tests.** Create `backend/apps/export/tests_packing.py`:

```python
"""Packing part moves — loading barrier, late join, unjoin, swap-packaging.

Spec: docs/superpowers/specs/2026-09-29-packaging-join-board-design.md
"""
import datetime
from decimal import Decimal

from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import Country, Customer, GreenhouseBlock, Season, ShipmentStatusType, User
from apps.export.models import Notification, Shipment, ShipmentBlockSource, ShipmentStatusLog
from apps.export.services.shipment import transition_to

#: (code, step_order, phase) — same values as tests_cancel.ALL_TEST_STATUSES.
STATUSES = [
    ('draft', 0, 'DRAFT'),
    ('gumruk_girish', 1, 'CUSTOMS'),
    ('gumruk_chykysh', 2, 'CUSTOMS'),
    ('yuklenme', 3, 'LOADING'),
    ('yola_chykdy', 4, 'TRANSIT'),
    ('cancelled', 99, 'CANCELLED'),
]


def _statuses() -> None:
    for code, order, phase in STATUSES:
        ShipmentStatusType.objects.get_or_create(
            code=code,
            defaults={'name_tk': code, 'name_en': code, 'step_order': order, 'phase': phase},
        )


def _user(username: str, role: str) -> User:
    user = User(username=username, role=role)
    user.set_password('pass')
    user.save()
    return user


class PackingFixtures(TestCase):
    """Shared world: statuses, season, one destination, three blocks."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        _statuses()
        cls.season, _ = Season.objects.get_or_create(
            name='pk-test',
            defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True},
        )
        cls.country, _ = Country.objects.get_or_create(
            code='PK', defaults={'name_tk': 'PK', 'name_en': 'PK', 'name_ru': 'PK'},
        )
        cls.customer, _ = Customer.objects.get_or_create(name='PackingTestCustomer')
        cls.block_a, _ = GreenhouseBlock.objects.get_or_create(code='PA', defaults={'name': 'PA'})
        cls.block_b, _ = GreenhouseBlock.objects.get_or_create(code='PB', defaults={'name': 'PB'})
        cls.manager = _user('gadam_pk', 'export_manager')

    _seq = 0

    def make(self, status: str = 'draft', *, destination: bool = False,
             blocks: list[tuple] | None = None, weight_net=None,
             date: datetime.date = datetime.date(2026, 9, 29)) -> Shipment:
        """Create one shipment row. blocks = [(block, weight_kg, harvest_date), ...]."""
        PackingFixtures._seq += 1
        ship = Shipment.objects.create(
            shipment_code=f'{date:%d%m}{900 + PackingFixtures._seq}/{date:%y}',
            date=date,
            season=self.season,
            status=ShipmentStatusType.objects.get(code=status),
            country=self.country if destination else None,
            customer=self.customer if destination else None,
            weight_net=weight_net,
            created_by=self.manager,
        )
        for block, kg, harvest in blocks or []:
            ShipmentBlockSource.objects.create(
                shipment=ship, block=block, weight_kg=kg, harvest_date=harvest,
            )
        return ship

    def client_for(self, user: User) -> APIClient:
        client = APIClient()
        client.force_authenticate(user=user)
        return client


class LoadingBarrierTests(PackingFixtures):
    """Spec §1.1 — documents may start before packing; loading may not."""

    def test_destination_plan_without_packing_leaves_draft(self):
        ship = self.make('draft', destination=True)
        transition_to(ship, 'gumruk_girish', self.manager)
        ship.refresh_from_db()
        self.assertEqual(ship.status.code, 'gumruk_girish')

    def test_supply_plan_without_destination_still_cannot_leave_draft(self):
        ship = self.make('draft', blocks=[(self.block_a, Decimal('9000'), None)])
        with self.assertRaises(ValueError) as ctx:
            transition_to(ship, 'gumruk_girish', self.manager)
        self.assertIn('country', str(ctx.exception))
        self.assertIn('customer', str(ctx.exception))

    def test_loading_refused_without_packing(self):
        ship = self.make('gumruk_chykysh', destination=True)
        with self.assertRaises(ValueError) as ctx:
            transition_to(ship, 'yuklenme', self.manager)
        self.assertIn('Packing not joined', str(ctx.exception))
        ship.refresh_from_db()
        self.assertEqual(ship.status.code, 'gumruk_chykysh')

    def test_loading_allowed_with_packing(self):
        ship = self.make('gumruk_chykysh', destination=True,
                         blocks=[(self.block_a, Decimal('9000'), None)])
        transition_to(ship, 'yuklenme', self.manager)
        ship.refresh_from_db()
        self.assertEqual(ship.status.code, 'yuklenme')

    def test_cancel_still_allowed_without_packing(self):
        ship = self.make('gumruk_chykysh', destination=True)
        transition_to(ship, 'cancelled', self.manager)
        ship.refresh_from_db()
        self.assertEqual(ship.status.code, 'cancelled')


class LoadingStartedPatchTests(PackingFixtures):
    """Spec §1.1 — a visible 400 instead of a silent stall at gumruk_chykysh."""

    def _patch(self, ship: Shipment):
        return self.client_for(self.manager).patch(
            f'/api/v1/export/shipments/{ship.pk}/',
            {'loading_started_at': '2026-09-29T08:00:00Z'},
            format='json',
        )

    def test_loading_started_refused_on_customs_row_without_packing(self):
        ship = self.make('gumruk_chykysh', destination=True)
        resp = self._patch(ship)
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertIn('loading_started_at', resp.data)
        self.assertIn('Packing not joined', str(resp.data['loading_started_at']))
        ship.refresh_from_db()
        self.assertIsNone(ship.loading_started_at)
        self.assertEqual(ship.status.code, 'gumruk_chykysh')

    def test_loading_started_accepted_on_customs_row_with_packing(self):
        ship = self.make('gumruk_chykysh', destination=True,
                         blocks=[(self.block_a, Decimal('9000'), None)])
        resp = self._patch(ship)
        self.assertEqual(resp.status_code, 200, resp.data)

    def test_legacy_row_after_loading_without_blocks_can_still_be_edited(self):
        ship = self.make('yola_chykdy', destination=True)
        resp = self._patch(ship)
        self.assertEqual(resp.status_code, 200, resp.data)
```

- [ ] **Step 2: Run to see them fail.**

```bash
PYTHONPATH=<scratchpad> ./venv/Scripts/python.exe manage.py test apps.export.tests_packing --noinput --keepdb --settings=settings_isolated
```

Expected: FAIL/ERROR — `test_destination_plan_without_packing_leaves_draft` raises the old "missing block_sources", `test_loading_refused_without_packing` does not raise, the 400 PATCH test gets 200.

- [ ] **Step 3: Create the service module (first part).** `backend/apps/export/services/packaging.py`:

```python
"""Packing part (план поставки / Üpjünçilik bölegi): where it may move, and how.

Spec: docs/superpowers/specs/2026-09-29-packaging-join-board-design.md

The packing part is PACKING_FIELDS plus the shipment's block_sources and
varieties_dominant. It always lives on the Shipment row that currently carries
it; join / unjoin / swap move it between rows. Nothing in this module changes a
status — transition_to() stays the only path for that.
"""
from apps.export.models import Shipment

# Statuses in which packing may still be joined, detached or swapped.
PRE_LOADING = frozenset({'draft', 'gumruk_girish', 'gumruk_chykysh'})

PACKING_NOT_JOINED = (
    'Packing not joined: join a supply plan to this shipment before loading starts.'
)


def has_packing(shipment: Shipment) -> bool:
    """True when the shipment carries at least one block source."""
    return shipment.block_sources.exists()


def needs_packing_for_loading(shipment: Shipment) -> bool:
    """True when loading cannot be recorded yet: pre-loading row, no packing.

    Rows at yuklenme or later are never checked — legacy Excel imports may have
    no block_sources at all, and editing their loading time must keep working.
    """
    code = shipment.status.code if shipment.status_id else None
    return code in PRE_LOADING and not has_packing(shipment)
```

- [ ] **Step 4: Move the guard in `transition_to()`.** In `backend/apps/export/services/shipment.py`, replace the whole `# Two-row join guard ...` comment and `if current_code == 'draft' and new_status_code != 'cancelled':` block (it ends with the `raise ValueError(... 'Supply and destination plans must be joined first.')`) with:

```python
    # Packing guard (spec 2026-09-29-packaging-join-board-design). Documents
    # start before packing exists, so leaving 'draft' needs only the destination
    # half (country + customer). The packing half (block_sources) is required at
    # the step that starts loading. Cancel is always allowed. Applies to manual
    # /transition/, /assign/ and auto-advance alike (all funnel through here).
    if current_code == 'draft' and new_status_code != 'cancelled':
        missing = [
            name for name, value in (
                ('country', shipment.country_id), ('customer', shipment.customer_id),
            ) if not value
        ]
        if missing:
            raise ValueError(
                f'Shipment {shipment.shipment_code} in Preparation cannot advance to '
                f'{new_status_code!r}: missing {", ".join(missing)}.'
            )
    if new_status_code == 'yuklenme' and not shipment.block_sources.exists():
        from apps.export.services.packaging import PACKING_NOT_JOINED
        raise ValueError(f'Shipment {shipment.shipment_code}: {PACKING_NOT_JOINED}')
```

- [ ] **Step 5: Refuse `loading_started_at` without packing.** In `backend/apps/export/serializers.py`, `ShipmentPatchSerializer.validate` — insert at the very top of the method, before `role = self.context.get('role')`:

```python
        # Packing guard for loading (spec 2026-09-29): refuse to record the start
        # of loading on a pre-loading row with no packing. Without this the write
        # lands, auto_advance_if_ready swallows transition_to's ValueError, and
        # the truck silently stays at gumruk_chykysh. Runs before the role
        # early-return: it is a data rule, not a permission.
        if attrs.get('loading_started_at') and self.instance is not None:
            from apps.export.services.packaging import PACKING_NOT_JOINED, needs_packing_for_loading
            if needs_packing_for_loading(self.instance):
                raise serializers.ValidationError({'loading_started_at': PACKING_NOT_JOINED})
```

- [ ] **Step 6: Flip the old guard test.** In `backend/apps/export/tests_draft_promote.py`, class `DraftLeaveGuardTests`: update the class docstring to "transition_to() must block a draft with no destination from leaving 'draft'; packing is checked at loading (spec 2026-09-29)." and replace `test_destination_only_draft_cannot_leave_draft` with:

```python
    def test_destination_only_draft_leaves_draft(self):
        """Gadam's draft: destination, no blocks → documents may start (spec 2026-09-29)."""
        ship = self._draft(
            country=self.country, customer=self.customer, with_block=False, code='0101302/25',
        )
        transition_to(ship, 'gumruk_girish', self.user)
        ship.refresh_from_db()
        self.assertEqual(ship.status.code, 'gumruk_girish')
```

- [ ] **Step 7: Run the new tests.** Same command as Step 2. Expected: all 8 PASS.

- [ ] **Step 8: Find fixtures the new barrier breaks.** Run the full suites and diff against the baseline:

```bash
PYTHONPATH=<scratchpad> ./venv/Scripts/python.exe manage.py test apps.export apps.core --noinput --keepdb --settings=settings_isolated 2>&1 | tee <scratchpad>/t1.txt
grep -E "^(FAIL|ERROR):" <scratchpad>/t1.txt | sort > <scratchpad>/t1_failures.txt
comm -13 <scratchpad>/baseline_failures.txt <scratchpad>/t1_failures.txt
```

Expected new failures: tests whose shipment has **zero** `ShipmentBlockSource` rows and is expected to reach `yuklenme` or later. They show up two ways: a direct `transition_to` raising `Packing not joined`, OR a plain status mismatch (`'gumruk_chykysh' != 'yuklenme'`) because `auto_advance_if_ready` swallows that `ValueError`; a PATCH of `loading_started_at` now returns 400 instead of 200.

Triage each new failure the same way:
1. Does the test's shipment have zero block sources, and does the test expect it at `yuklenme` or later (or PATCH `loading_started_at` on it before loading)? If not → real regression, stop and report.
2. If yes, add a block to that fixture (not a code change) and re-run that test:

```python
ShipmentBlockSource.objects.create(shipment=<the shipment>, block=<any GreenhouseBlock>, weight_kg=Decimal('10000'))
```

(Create a `GreenhouseBlock.objects.get_or_create(code='FX', defaults={'name': 'FX'})` in the fixture if the test has none.)
3. It is a fixture problem only if the test then passes. If it still fails → real regression, stop and report.

- [ ] **Step 9: Re-run until `comm -13` prints nothing.**

- [ ] **Step 10: Two pre-deploy counts (read-only, do not skip).**
  1. *Cascade:* lifting the draft barrier lets destination plans stuck in `draft` with their draft tasks already done advance on their next task-resolving save.
  2. *New dead ends:* a row already at `gumruk_girish` / `gumruk_chykysh` with **zero** block sources (legacy `import_sheet_shipments` rows, or blocks removed after leaving draft) can no longer reach `yuklenme` — entering loading will now return 400 until packing is joined.

Run against **the database the deploy targets** (beta), not whatever the local `.env` points at — local and beta have diverged before. Ask the user which connection to use if unsure. Read-only; from `backend/`:

```bash
./venv/Scripts/python.exe manage.py shell -c "
from apps.export.models import Shipment
from apps.export.services.shipment import is_step_trigger_satisfied
drafts = Shipment.objects.filter(status__code='draft', country__isnull=False, customer__isnull=False,
                                 block_sources__isnull=True, deleted_at__isnull=True)
stuck = [s.shipment_code for s in drafts if is_step_trigger_satisfied(s, 'draft')]
print('cascade', len(stuck), stuck)
dead = list(Shipment.objects.filter(status__code__in=['gumruk_girish', 'gumruk_chykysh'],
                                    block_sources__isnull=True, deleted_at__isnull=True)
            .values_list('shipment_code', flat=True))
print('no_packing_in_customs', len(dead), dead)
"
```

Report both numbers and code lists to the user in the task report. Do not change any row.

- [ ] **Step 11: Commit (after the user says "commit").**

```bash
git status
git add backend/apps/export/services/packaging.py backend/apps/export/services/shipment.py backend/apps/export/serializers.py backend/apps/export/tests_packing.py backend/apps/export/tests_draft_promote.py <each fixture file fixed in Step 8>
git diff --cached --stat
git commit -m "$(cat <<'EOF'
feat(p3): documents may start before packing; loading needs packing

Leaving Preparation now needs only country + customer. The packing (block
sources) is required at gumruk_chykysh -> yuklenme instead, and the Sheet
refuses loading_started_at on a pre-loading row without packing so the truck
cannot stall silently.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

Then add `- [ ] 2026-09-29 — Loading needs packing; documents may start before it (barrier moved) — NEEDS TEST` at the top of `BUILD_TEST_LOG.md`.

---

### Task 2: Weight rule, roles, late join (part of commit 2)

**Files:**
- Modify: `backend/apps/export/services/packaging.py`
- Modify: `backend/apps/core/roles.py:124`
- Modify: `backend/apps/export/views.py` — `get_permissions` (`join` branch ~line 332), `join` (~2454), `_validate_join` (~2537), `_execute_join` (~2562)
- Modify: `backend/apps/export/tests_shipment_join.py` — `JoinPermissionTests` (~line 611)
- Modify: `backend/apps/export/tests_packing.py`

**Interfaces:**
- Consumes: `PRE_LOADING`, `has_packing` (Task 1).
- Produces (`packaging.py`): `PACKING_FIELDS: tuple[str, ...]`, `packaging_weight(shipment) -> Decimal | None`, `net_update(shipment, incoming: Decimal | None) -> dict`, `assert_can_move_packing(shipment) -> None` (raises `ValueError`). In `views.py`: module-level `_can_move_packing(user) -> bool`.

- [ ] **Step 1: Write the failing tests.** Add `from apps.export.services.packaging import net_update, packaging_weight` to the import block at the top of `backend/apps/export/tests_packing.py`, then append:

```python
class PackagingWeightTests(PackingFixtures):
    """Spec, Terms — packaging_weight and the weight rule."""

    def test_all_blocks_weighed_sums_them(self):
        ship = self.make(blocks=[(self.block_a, Decimal('6000'), None),
                                 (self.block_b, Decimal('4000'), None)])
        self.assertEqual(packaging_weight(ship), Decimal('10000'))

    def test_unweighed_draft_uses_declared_total(self):
        ship = self.make(blocks=[(self.block_a, None, None)], weight_net=Decimal('18000'))
        self.assertEqual(packaging_weight(ship), Decimal('18000'))

    def test_no_blocks_is_none(self):
        self.assertIsNone(packaging_weight(self.make()))

    def test_draft_row_takes_incoming(self):
        ship = self.make('draft', destination=True, weight_net=Decimal('1'))
        self.assertEqual(net_update(ship, Decimal('9000')), {'weight_net': Decimal('9000')})
        self.assertEqual(net_update(ship, None), {'weight_net': None})

    def test_customs_row_fills_only_empty_net(self):
        empty = self.make('gumruk_girish', destination=True)
        filled = self.make('gumruk_girish', destination=True, weight_net=Decimal('17500'))
        self.assertEqual(net_update(empty, Decimal('9000')), {'weight_net': Decimal('9000')})
        self.assertEqual(net_update(filled, Decimal('9000')), {})


class LateJoinTests(PackingFixtures):
    """Spec §1.2 — join up to gumruk_chykysh."""

    def _join(self, target: Shipment, source: Shipment, user: User | None = None):
        return self.client_for(user or self.manager).post(
            f'/api/v1/export/shipments/{target.pk}/join/', {'source_id': source.pk}, format='json',
        )

    def _supply(self, kg=Decimal('12000')) -> Shipment:
        return self.make('draft', blocks=[(self.block_a, kg, None)])

    def test_join_into_each_pre_loading_status(self):
        for code in ('draft', 'gumruk_girish', 'gumruk_chykysh'):
            with self.subTest(status=code):
                target = self.make(code, destination=True)
                resp = self._join(target, self._supply())
                self.assertEqual(resp.status_code, 200, resp.data)
                target.refresh_from_db()
                self.assertEqual(target.status.code, code)  # status never moves
                self.assertEqual(target.block_sources.count(), 1)

    def test_join_refused_once_loading_started(self):
        target = self.make('yuklenme', destination=True)
        resp = self._join(target, self._supply())
        self.assertEqual(resp.status_code, 400, resp.data)

    def test_join_refused_when_target_has_pallets(self):
        from apps.export.models import Pallet
        target = self.make('gumruk_chykysh', destination=True)
        Pallet.objects.create(**_pallet_kwargs(target, self.block_a))
        resp = self._join(target, self._supply())
        self.assertEqual(resp.status_code, 400, resp.data)

    def test_late_join_fills_empty_net(self):
        target = self.make('gumruk_girish', destination=True)
        self._join(target, self._supply(Decimal('12000')))
        target.refresh_from_db()
        self.assertEqual(target.weight_net, Decimal('12000'))

    def test_late_join_keeps_entered_net_and_gross(self):
        target = self.make('gumruk_girish', destination=True, weight_net=Decimal('17500'))
        Shipment.objects.filter(pk=target.pk).update(weight_gross=Decimal('19000'))
        self._join(target, self._supply(Decimal('12000')))
        target.refresh_from_db()
        self.assertEqual(target.weight_net, Decimal('17500'))
        self.assertEqual(target.weight_gross, Decimal('19000'))

    def test_loading_dept_head_may_join(self):
        solt = _user('solt_pk_join', 'loading_dept_head')
        target = self.make('gumruk_girish', destination=True)
        resp = self._join(target, self._supply(), user=solt)
        self.assertEqual(resp.status_code, 200, resp.data)

    def test_sales_rep_may_not_join(self):
        rep = _user('rep_pk_join', 'sales_rep')
        target = self.make('gumruk_girish', destination=True)
        resp = self._join(target, self._supply(), user=rep)
        self.assertEqual(resp.status_code, 403, resp.data)
```

Add this helper next to `_user` at the top of the file (every required field of `apps/export/models/pallet.py`):

```python
def _pallet_kwargs(shipment: Shipment, block: GreenhouseBlock) -> dict:
    """Minimal Pallet row — the model's required fields only."""
    from apps.core.models import CrateType, TomatoVariety
    crate, _ = CrateType.objects.get_or_create(name='PK crate', defaults={'weight_kg': Decimal('0.543')})
    variety, _ = TomatoVariety.objects.get_or_create(name='PK variety')
    return {
        'shipment': shipment, 'pallet_number': 1, 'crate_type': crate, 'crate_count': 10,
        'gross_weight_kg': Decimal('500'), 'pallet_weight_kg': Decimal('20'),
        'additions_kg': Decimal('0'), 'variety': variety, 'sub_block': block,
        'created_by': shipment.created_by,
    }
```

- [ ] **Step 2: Run to see them fail.** `... manage.py test apps.export.tests_packing ...` Expected: ImportError for `net_update` / `packaging_weight`, then 400s for the late joins and 403 for loading_dept_head.

- [ ] **Step 3: Weight rule + move guard in the service.** Append to `backend/apps/export/services/packaging.py` (and add `from decimal import Decimal` at the top):

```python
# Scalar packing fields that move together with block_sources and
# varieties_dominant. variety is written through its _id column.
PACKING_FIELDS = (
    'export_code', 'variety_id', 'harvest_date', 'harvest_status', 'weight_to_load_kg',
)


def packaging_weight(shipment: Shipment) -> Decimal | None:
    """Weight of the packing on ``shipment``, read BEFORE it moves.

    All blocks weighed → their sum. Otherwise, on a draft, the row's own
    weight_net (a supply-first plan keeps its total there while its blocks
    carry no kg). Otherwise the sum of the weighed blocks, or None.
    """
    weights = list(shipment.block_sources.values_list('weight_kg', flat=True))
    if not weights:
        return None
    weighed = [w for w in weights if w is not None]
    if len(weighed) == len(weights):
        return sum(weighed, Decimal('0'))
    if shipment.status.code == 'draft' and shipment.weight_net is not None:
        return shipment.weight_net
    return sum(weighed, Decimal('0')) if weighed else None


def net_update(shipment: Shipment, incoming: Decimal | None) -> dict:
    """weight_net change for a row that just received ``incoming`` packing weight.

    Draft: the net follows the packing. After documents start: only an empty
    net is filled — documents read weight from the PackingTemplate, and the
    pallet manifest overwrites weight_net at loading anyway. weight_gross is
    never touched.
    """
    if shipment.status.code == 'draft':
        return {'weight_net': incoming}
    if shipment.weight_net is None and incoming is not None:
        return {'weight_net': incoming}
    return {}


def assert_can_move_packing(shipment: Shipment) -> None:
    """Raise ValueError unless packing on ``shipment`` may still change."""
    if shipment.status.code not in PRE_LOADING:
        raise ValueError(
            f'{shipment.shipment_code}: loading has started — packing can no longer change'
        )
    if shipment.pallets.exists():
        raise ValueError(
            f'{shipment.shipment_code}: pallets are recorded — packing can no longer change'
        )
```

- [ ] **Step 4: Roles.** `backend/apps/core/roles.py:124`:

```python
# Who may join, detach or swap packing (spec 2026-09-29): the join roles plus
# the loading department, whose packing it is. Mirrored in
# frontend/src/components/sheet/joinHelpers.ts JOIN_ROLES.
JOIN_ROLES = frozenset({
    'admin', 'director', 'boss', 'loading_dept_head', 'loading_dept_head_deputy',
}) | EXPORT_MANAGER_LIKE
```

Then `grep -rn "JOIN_ROLES" backend/apps` — expected: only `roles.py` and `export/views.py` (`join`). If anything else reads it, stop and report.

- [ ] **Step 5: Views — one role check, permission branch.** In `backend/apps/export/views.py`, add near the other module-level helpers (below the imports):

```python
def _can_move_packing(user) -> bool:
    """Join / unjoin / swap-packaging gate: JOIN_ROLES or superuser."""
    return getattr(user, 'is_superuser', False) or getattr(user, 'role', None) in JOIN_ROLES
```

In `get_permissions`, change `if action == 'join':` to `if action in ('join', 'unjoin', 'swap_packaging'):` and append to its comment: "unjoin and swap_packaging (spec 2026-09-29) edit rows the same way."

In `join`, replace the `is_super = ...` / `if not is_super and ... not in JOIN_ROLES:` block with:

```python
        if not _can_move_packing(request.user):
            return Response(
                {'error': 'Only admin, export_manager, director, boss, document_team or the '
                          'loading department can join packing'},
                status=status.HTTP_403_FORBIDDEN,
            )
```

- [ ] **Step 6: Late join rules.** In `_validate_join`, replace `if target.status.code != 'draft': return 'Target shipment is not in Preparation'` with:

```python
        if target.status.code not in PRE_LOADING:
            return 'Target shipment has started loading — packing can no longer be joined'
        if target.pallets.exists() or source.pallets.exists():
            return 'Pallets are recorded — packing can no longer be joined'
```

and add `from apps.export.services.packaging import PRE_LOADING, packaging_weight` to the imports at the top of `views.py`.

In `_execute_join`, under the lock:
- replace `if target.status.code != 'draft': raise ValueError('Target shipment is no longer in Preparation')` with `assert_can_move_packing(target)` and add `assert_can_move_packing(source)` after the source status check (import `assert_can_move_packing` too);
- next to `source_weight_net = source.weight_net`, add `source_packing_weight = packaging_weight(source)` (it must run before `source.block_sources.update(...)`);
- replace the whole weight block (`has_null_weight = ...` through the `else:` that aggregates) with:

```python
            # Weight rule (spec 2026-09-29). Draft target: today's recompute from
            # the moved blocks, falling back to the supply plan's declared total
            # while blocks are unweighed. Later target: fill an empty net only.
            if target.status.code == 'draft':
                has_null_weight = target.block_sources.filter(weight_kg__isnull=True).exists()
                if has_null_weight and source_weight_net is not None:
                    update_fields['weight_net'] = source_weight_net
                else:
                    agg = target.block_sources.aggregate(total=Sum('weight_kg'))
                    update_fields['weight_net'] = agg['total'] or Decimal('0')
            elif target.weight_net is None and source_packing_weight is not None:
                update_fields['weight_net'] = source_packing_weight
```

- update the comment above `Shipment.objects.filter(pk=target.pk).update(**update_fields)` to: "Use .update() to bypass the task engine: save() runs auto_advance_if_ready, and a packing move must never move the truck (spec 2026-09-29)." and the audit comment "(status unchanged — still draft)" to "(status unchanged)".
- update the `join` docstring's first lines: "Moves a supply plan's packing (source) onto a destination plan (target) that has not started loading (draft, gumruk_girish, gumruk_chykysh)."

- [ ] **Step 7: Flip the old permission test.** In `tests_shipment_join.py`, `JoinPermissionTests`: update the class docstring's role list to include the loading department, and replace `test_loading_dept_head_cannot_join` with:

```python
    def test_loading_dept_head_can_join(self):
        """The loading department may join its own packing (spec 2026-09-29)."""
        solt = _make_user('solt_perm_jn', 'loading_dept_head')
        _auth(self.client, solt)
        resp = self.client.post(
            self._join_url(self.target.pk), {'source_id': self.source.pk}, format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
```

Also search the same file for a test asserting `'Target shipment is not in Preparation'` or a non-draft target 400 and update the expected text to the new message.

- [ ] **Step 8: Run.** `... manage.py test apps.export.tests_packing apps.export.tests_shipment_join apps.export.tests_draft_promote ...` Expected: all PASS.

No commit — commit 2 lands at the end of Task 5.

---

### Task 3: Unjoin (part of commit 2)

**Files:**
- Modify: `backend/apps/export/services/packaging.py`
- Modify: `backend/apps/export/views.py` — new `unjoin` action right after `_execute_join`
- Modify: `backend/apps/export/tests_packing.py`

**Interfaces:**
- Consumes: `PACKING_FIELDS`, `packaging_weight`, `net_update`, `assert_can_move_packing` (Task 2); `generate_shipment_code(today=date) -> str` (`services/shipment.py:697`); `generate_tasks_for_status(shipment, 'draft')` (`services/task_rules.py`).
- Produces: `unjoin_packing(shipment: Shipment, user) -> Shipment` (returns the NEW supply-plan row); `_notify_packing_change(shipments: list[Shipment], user, message: str) -> None`. Endpoint `POST /api/v1/export/shipments/{id}/unjoin/` → `200 {…ShipmentDetailSerializer of the export row…, "new_supply_id": int, "new_supply_code": str}`.

- [ ] **Step 1: Write the failing tests.** Add `from apps.greenhouse.services.actual_rollup import parse_shipment_code_date` to the import block at the top of `tests_packing.py`, then append:

```python
class UnjoinTests(PackingFixtures):
    """Spec §1.3."""

    def _unjoin(self, ship: Shipment, user: User | None = None):
        return self.client_for(user or self.manager).post(
            f'/api/v1/export/shipments/{ship.pk}/unjoin/', {}, format='json',
        )

    def test_unjoin_moves_packing_to_a_new_supply_plan(self):
        ship = self.make('gumruk_girish', destination=True,
                         blocks=[(self.block_a, Decimal('9000'), datetime.date(2026, 9, 28))],
                         weight_net=Decimal('9000'))
        Shipment.objects.filter(pk=ship.pk).update(export_code='EXP-1', harvest_status='ok')
        resp = self._unjoin(ship)
        self.assertEqual(resp.status_code, 200, resp.data)
        new = Shipment.objects.get(pk=resp.data['new_supply_id'])
        self.assertEqual(resp.data['new_supply_code'], new.shipment_code)
        self.assertEqual(new.status.code, 'draft')
        self.assertIsNone(new.country_id)
        self.assertEqual(new.export_code, 'EXP-1')
        self.assertEqual(new.harvest_status, 'ok')
        self.assertEqual(list(new.block_sources.values_list('block_id', 'weight_kg', 'harvest_date')),
                         [(self.block_a.pk, Decimal('9000.00'), datetime.date(2026, 9, 28))])
        ship.refresh_from_db()
        self.assertFalse(ship.block_sources.exists())
        self.assertIsNone(ship.export_code)
        self.assertEqual(ship.status.code, 'gumruk_girish')
        self.assertEqual(ship.weight_net, Decimal('9000'))  # not draft → untouched

    def test_unjoin_from_draft_clears_net(self):
        ship = self.make('draft', destination=True,
                         blocks=[(self.block_a, Decimal('9000'), None)], weight_net=Decimal('9000'))
        self._unjoin(ship)
        ship.refresh_from_db()
        self.assertIsNone(ship.weight_net)

    def test_unjoin_unweighed_blocks_carry_declared_total(self):
        ship = self.make('draft', destination=True,
                         blocks=[(self.block_a, None, None)], weight_net=Decimal('18000'))
        resp = self._unjoin(ship)
        new = Shipment.objects.get(pk=resp.data['new_supply_id'])
        self.assertEqual(new.weight_net, Decimal('18000'))

    def test_unjoin_new_code_uses_export_row_date(self):
        ship = self.make('gumruk_girish', destination=True, date=datetime.date(2026, 9, 25),
                         blocks=[(self.block_a, Decimal('9000'), None)])
        resp = self._unjoin(ship)
        self.assertEqual(parse_shipment_code_date(resp.data['new_supply_code']),
                         datetime.date(2026, 9, 25))

    def test_unjoin_logs_both_rows_and_notifies_loading_head(self):
        solt = _user('solt_pk_unjoin', 'loading_dept_head')
        clerk = _user('sirin_pk_unjoin', 'document_team')
        ship = self.make('gumruk_girish', destination=True,
                         blocks=[(self.block_a, Decimal('9000'), None)])
        resp = self._unjoin(ship)
        new_id = resp.data['new_supply_id']
        self.assertTrue(ShipmentStatusLog.objects.filter(shipment=ship, comment__contains='detached').exists())
        self.assertTrue(ShipmentStatusLog.objects.filter(shipment_id=new_id).exists())
        self.assertTrue(Notification.objects.filter(user=solt).exists())
        self.assertTrue(Notification.objects.filter(user=clerk).exists())  # documents started
        self.assertFalse(Notification.objects.filter(user=self.manager).exists())  # actor

    def test_unjoin_refused_without_packing_after_loading_or_with_pallets(self):
        from apps.export.models import Pallet
        empty = self.make('gumruk_girish', destination=True)
        loading = self.make('yuklenme', destination=True, blocks=[(self.block_a, Decimal('1'), None)])
        palleted = self.make('gumruk_chykysh', destination=True, blocks=[(self.block_b, Decimal('1'), None)])
        Pallet.objects.create(**_pallet_kwargs(palleted, self.block_b))
        for ship in (empty, loading, palleted):
            with self.subTest(code=ship.shipment_code):
                self.assertEqual(self._unjoin(ship).status_code, 400)

    def test_unjoin_refused_on_a_free_supply_plan(self):
        free = self.make('draft', blocks=[(self.block_a, Decimal('9000'), None)])
        self.assertEqual(self._unjoin(free).status_code, 400)

    def test_sales_rep_may_not_unjoin(self):
        ship = self.make('gumruk_girish', destination=True, blocks=[(self.block_a, Decimal('1'), None)])
        self.assertEqual(self._unjoin(ship, _user('rep_pk_unjoin', 'sales_rep')).status_code, 403)
```

- [ ] **Step 2: Run to see them fail.** Expected: 404 (no route) for every `/unjoin/` call.

- [ ] **Step 3: Service.** Append to `packaging.py` (extend the model import to `from apps.export.models import Notification, Shipment, ShipmentBlockSource, ShipmentStatusLog` and add `from django.db import transaction`):

```python
def _notify_packing_change(shipments: list[Shipment], user, message: str) -> None:
    """Tell the loading department (and document_team once documents started)."""
    from apps.core.models import User

    roles = {'loading_dept_head'}
    if any(s.status.code != 'draft' for s in shipments):
        roles.add('document_team')
    user_ids = (
        User.objects.filter(role__in=roles, is_active=True)
        .exclude(pk=user.pk)
        .values_list('id', flat=True)
    )
    link = f'/export/shipments/sheet?shipment={shipments[0].pk}'
    Notification.objects.bulk_create(
        [Notification(user_id=uid, kind='action_required', message=message, link=link)
         for uid in user_ids],
        batch_size=500,
    )


def unjoin_packing(shipment: Shipment, user) -> Shipment:
    """Detach the packing of an export part into a new supply-plan row.

    The new row keeps the export row's date in its code, so the weekly-plan
    actual (keyed on the code's date) does not move to another day.

    Returns:
        The new supply-plan Shipment.

    Raises:
        ValueError: not an export part with packing, loading started, or pallets.
    """
    from apps.core.models import ShipmentStatusType
    from apps.export.services.shipment import generate_shipment_code
    from apps.export.services.task_rules import generate_tasks_for_status

    with transaction.atomic():
        row = Shipment.objects.select_for_update().select_related('status').get(pk=shipment.pk)
        if not (row.country_id and row.customer_id):
            raise ValueError(f'{row.shipment_code}: not a destination plan — nothing to detach from')
        if not has_packing(row):
            raise ValueError(f'{row.shipment_code}: has no packing to detach')
        assert_can_move_packing(row)

        draft = ShipmentStatusType.objects.get(code='draft')
        new = Shipment.objects.create(
            shipment_code=generate_shipment_code(today=row.date),
            date=row.date,
            season=row.season,
            status=draft,
            created_by=user,
            weight_net=packaging_weight(row),
            **{field: getattr(row, field) for field in PACKING_FIELDS},
        )
        ShipmentStatusLog.objects.create(
            shipment=new, status=draft, changed_by=user,
            comment=f'Created in Preparation — packing detached from {row.shipment_code}',
        )
        row.block_sources.update(shipment=new)
        new.varieties_dominant.set(row.varieties_dominant.all())
        row.varieties_dominant.clear()

        cleared = {field: None for field in PACKING_FIELDS}
        cleared.update(net_update(row, None))
        cleared['updated_by_id'] = user.pk
        # .update(): a packing move must never run auto-advance.
        Shipment.objects.filter(pk=row.pk).update(**cleared)
        ShipmentStatusLog.objects.create(
            shipment=row, status=row.status, changed_by=user,
            comment=f'Packing detached into {new.shipment_code}',
        )
        _notify_packing_change(
            [row], user,
            f'Packing of {row.shipment_code} was detached into {new.shipment_code} by {user.username}.',
        )

    # Same trade-off as the supply-plan create path: tasks after commit. Since
    # b318f0d8 a row with no destination gets no draft-step tasks.
    generate_tasks_for_status(new, 'draft')
    return new
```

- [ ] **Step 4: Endpoint.** In `views.py`, right after `_execute_join`:

```python
    @action(detail=True, methods=['post'], url_path='unjoin')
    def unjoin(self, request, pk=None):
        """POST /api/v1/export/shipments/{id}/unjoin/

        Detaches the packing of a destination plan (before loading, no pallets)
        into a NEW supply-plan row with a new code. Spec 2026-09-29 §1.3.

        Returns:
            200 — the export row's detail + new_supply_id + new_supply_code.
            400 — not allowed (message says why). 403 — role.
        """
        from apps.export.services.packaging import unjoin_packing

        if not _can_move_packing(request.user):
            return Response({'error': 'Your role cannot detach packing'},
                            status=status.HTTP_403_FORBIDDEN)
        shipment = self.get_object()
        try:
            new = unjoin_packing(shipment, request.user)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        self._sheet_poke_ids = [shipment.pk, new.pk]
        shipment.refresh_from_db()
        data = ShipmentDetailSerializer(shipment, context={'request': request}).data
        return Response({**data, 'new_supply_id': new.pk, 'new_supply_code': new.shipment_code})
```

- [ ] **Step 5: Run.** `... manage.py test apps.export.tests_packing ...` Expected: all PASS.

No commit.

---

### Task 4: Swap-packaging, and delete the field Swap (part of commit 2)

**Files:**
- Modify: `backend/apps/export/services/packaging.py`
- Modify: `backend/apps/export/serializers.py` (~line 2059)
- Modify: `backend/apps/export/views.py` — delete `swap` (~2723), `_execute_swap` (~2854), `swappable_fields` (~3002), the `if action == 'swap':` branch in `get_permissions` (~308); add `swap_packaging`
- Delete: `backend/apps/export/swap_config.py`, `backend/apps/export/tests_shipment_swap.py`
- Modify: `backend/apps/export/tests_season_freeze.py` (~line 333), `backend/apps/export/tests_task_condition_reconcile_api.py` (~line 310-431)
- Modify: `backend/apps/export/tests_packing.py`

**Interfaces:**
- Produces: `swap_packing(a: Shipment, b: Shipment, user) -> tuple[Shipment, Shipment]`. Endpoint `POST /api/v1/export/shipments/{a}/swap-packaging/` body `{"other_id": int}` → `200 {"shipments": [detail_a, detail_b]}`; `404` other not found; `400` rule broken; `403` role; `409` closed season.

- [ ] **Step 1: Write the failing tests.** Append:

```python
class SwapPackingTests(PackingFixtures):
    """Spec §1.4."""

    def _swap(self, a: Shipment, other_id: int, user: User | None = None):
        return self.client_for(user or self.manager).post(
            f'/api/v1/export/shipments/{a.pk}/swap-packaging/', {'other_id': other_id}, format='json',
        )

    def _blocks(self, ship: Shipment):
        return sorted(ship.block_sources.values_list('block_id', 'weight_kg', 'harvest_date'))

    def test_swap_exchanges_packing_only(self):
        a = self.make('gumruk_girish', destination=True, blocks=[(self.block_a, Decimal('9000'), None)])
        b = self.make('draft', destination=True, blocks=[(self.block_b, Decimal('7000'), None)])
        Shipment.objects.filter(pk=a.pk).update(export_code='A-CODE', truck_plate='AA 1111')
        Shipment.objects.filter(pk=b.pk).update(export_code='B-CODE', truck_plate='BB 2222')
        resp = self._swap(a, b.pk)
        self.assertEqual(resp.status_code, 200, resp.data)
        a.refresh_from_db(); b.refresh_from_db()
        self.assertEqual(self._blocks(a), [(self.block_b.pk, Decimal('7000.00'), None)])
        self.assertEqual(self._blocks(b), [(self.block_a.pk, Decimal('9000.00'), None)])
        self.assertEqual((a.export_code, b.export_code), ('B-CODE', 'A-CODE'))
        self.assertEqual((a.truck_plate, b.truck_plate), ('AA 1111', 'BB 2222'))  # not packing
        self.assertEqual(a.country_id, self.country.pk)

    def test_swap_same_block_same_date_on_both_sides(self):
        day = datetime.date(2026, 9, 28)
        a = self.make('gumruk_girish', destination=True, blocks=[(self.block_a, Decimal('9000'), day)])
        b = self.make('gumruk_girish', destination=True, blocks=[(self.block_a, Decimal('4000'), day)])
        resp = self._swap(a, b.pk)
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(self._blocks(a), [(self.block_a.pk, Decimal('4000.00'), day)])
        self.assertEqual(self._blocks(b), [(self.block_a.pk, Decimal('9000.00'), day)])

    def test_swap_weight_rule_per_side(self):
        a = self.make('draft', destination=True, blocks=[(self.block_a, Decimal('9000'), None)],
                      weight_net=Decimal('9000'))
        b = self.make('gumruk_girish', destination=True, blocks=[(self.block_b, Decimal('7000'), None)],
                      weight_net=Decimal('17500'))
        self._swap(a, b.pk)
        a.refresh_from_db(); b.refresh_from_db()
        self.assertEqual(a.weight_net, Decimal('7000'))   # draft follows packing
        self.assertEqual(b.weight_net, Decimal('17500'))  # documents started, entered net kept

    def test_swap_unweighed_packing_into_draft_carries_total(self):
        free = self.make('draft', blocks=[(self.block_a, None, None)], weight_net=Decimal('18000'))
        truck = self.make('draft', destination=True, blocks=[(self.block_b, Decimal('7000'), None)],
                          weight_net=Decimal('7000'))
        self._swap(truck, free.pk)
        truck.refresh_from_db()
        self.assertEqual(truck.weight_net, Decimal('18000'))

    def test_swap_with_a_free_supply_plan_replaces_the_truck_packing(self):
        truck = self.make('gumruk_chykysh', destination=True, blocks=[(self.block_a, Decimal('9000'), None)])
        free = self.make('draft', blocks=[(self.block_b, Decimal('7000'), None)])
        self.assertEqual(self._swap(truck, free.pk).status_code, 200)
        truck.refresh_from_db()
        self.assertEqual(self._blocks(truck), [(self.block_b.pk, Decimal('7000.00'), None)])

    def test_swap_refused(self):
        from apps.export.models import Pallet
        full = self.make('gumruk_girish', destination=True, blocks=[(self.block_a, Decimal('1'), None)])
        empty = self.make('gumruk_girish', destination=True)
        loading = self.make('yuklenme', destination=True, blocks=[(self.block_b, Decimal('1'), None)])
        palleted = self.make('gumruk_chykysh', destination=True, blocks=[(self.block_b, Decimal('1'), None)])
        Pallet.objects.create(**_pallet_kwargs(palleted, self.block_b))
        for other in (empty, loading, palleted):
            with self.subTest(other=other.shipment_code):
                self.assertEqual(self._swap(full, other.pk).status_code, 400)
        self.assertEqual(self._swap(full, full.pk).status_code, 400)

    def test_swap_with_consumed_source_returns_404(self):
        target = self.make('gumruk_girish', destination=True)
        source = self.make('draft', blocks=[(self.block_a, Decimal('9000'), None)])
        other = self.make('gumruk_girish', destination=True, blocks=[(self.block_b, Decimal('1'), None)])
        source_id = source.pk
        self.client_for(self.manager).post(
            f'/api/v1/export/shipments/{target.pk}/join/', {'source_id': source_id}, format='json')
        self.assertEqual(self._swap(other, source_id).status_code, 404)
        other.refresh_from_db()
        self.assertEqual(other.block_sources.count(), 1)

    def test_swap_logs_and_notifies(self):
        solt = _user('solt_pk_swap', 'loading_dept_head')
        a = self.make('draft', destination=True, blocks=[(self.block_a, Decimal('1'), None)])
        b = self.make('draft', blocks=[(self.block_b, Decimal('1'), None)])
        self._swap(a, b.pk)
        for ship in (a, b):
            self.assertTrue(ShipmentStatusLog.objects.filter(shipment=ship, comment__contains='swapped').exists())
        self.assertTrue(Notification.objects.filter(user=solt).exists())

    def test_old_swap_endpoint_is_gone(self):
        a = self.make('draft', destination=True)
        resp = self.client_for(self.manager).post(
            f'/api/v1/export/shipments/{a.pk}/swap/', {'other_id': a.pk, 'fields': ['truck_plate']},
            format='json')
        self.assertEqual(resp.status_code, 404)
```

- [ ] **Step 2: Run to see them fail.** Expected: 404 on `/swap-packaging/`; `test_old_swap_endpoint_is_gone` fails (old route answers).

- [ ] **Step 3: Service.** Append to `packaging.py`:

```python
def swap_packing(a: Shipment, b: Shipment, user) -> tuple[Shipment, Shipment]:
    """Exchange the packing of two rows (either may be a free supply plan).

    block_sources are re-created rather than re-pointed: the same block with
    the same harvest_date on both rows would collide on
    unique_together (shipment, block, harvest_date) mid-way, and there is no
    holder row to park them on (the FK is not nullable).

    Raises:
        ValueError: same row, a row without packing, loading started, pallets.
    """
    if a.pk == b.pk:
        raise ValueError('Cannot swap packing of a shipment with itself')
    with transaction.atomic():
        locked = {
            s.pk: s for s in (
                Shipment.objects.select_for_update().select_related('status')
                .filter(pk__in=[a.pk, b.pk]).order_by('pk')
            )
        }
        a, b = locked[a.pk], locked[b.pk]
        for row in (a, b):
            assert_can_move_packing(row)
            if not has_packing(row):
                raise ValueError(f'{row.shipment_code}: has no packing to swap')

        a_weight, b_weight = packaging_weight(a), packaging_weight(b)
        a_blocks = list(a.block_sources.values('block_id', 'weight_kg', 'harvest_date'))
        b_blocks = list(b.block_sources.values('block_id', 'weight_kg', 'harvest_date'))
        a_varieties = list(a.varieties_dominant.values_list('pk', flat=True))
        b_varieties = list(b.varieties_dominant.values_list('pk', flat=True))

        ShipmentBlockSource.objects.filter(shipment_id__in=[a.pk, b.pk]).delete()
        ShipmentBlockSource.objects.bulk_create(
            [ShipmentBlockSource(shipment_id=b.pk, **row) for row in a_blocks]
            + [ShipmentBlockSource(shipment_id=a.pk, **row) for row in b_blocks],
            batch_size=500,
        )
        a.varieties_dominant.set(b_varieties)
        b.varieties_dominant.set(a_varieties)

        a_update = {field: getattr(b, field) for field in PACKING_FIELDS}
        b_update = {field: getattr(a, field) for field in PACKING_FIELDS}
        a_update.update(net_update(a, b_weight), updated_by_id=user.pk)
        b_update.update(net_update(b, a_weight), updated_by_id=user.pk)
        # .update(): a packing move must never run auto-advance.
        Shipment.objects.filter(pk=a.pk).update(**a_update)
        Shipment.objects.filter(pk=b.pk).update(**b_update)

        for row, other in ((a, b), (b, a)):
            ShipmentStatusLog.objects.create(
                shipment=row, status=row.status, changed_by=user,
                comment=f'Packing swapped with {other.shipment_code}',
            )
        _notify_packing_change(
            [a, b], user,
            f'Packing was swapped between {a.shipment_code} and {b.shipment_code} by {user.username}.',
        )
    return a, b
```

- [ ] **Step 4: Serializer.** In `serializers.py`, replace the whole `ShipmentSwapSerializer` class with:

```python
class ShipmentSwapPackagingSerializer(serializers.Serializer):
    """Request body for POST /api/v1/export/shipments/{a_id}/swap-packaging/."""

    other_id = serializers.IntegerField(min_value=1)
```

and fix the import in `views.py` (`ShipmentSwapSerializer` → `ShipmentSwapPackagingSerializer`).

- [ ] **Step 5: Endpoint; delete the field Swap.** In `views.py`: delete the `# Swap action` banner, `swap`, `_execute_swap`, `swappable_fields`, and the `if action == 'swap':` branch of `get_permissions`. Add after `unjoin`:

```python
    @action(detail=True, methods=['post'], url_path='swap-packaging')
    def swap_packaging(self, request, pk=None):
        """POST /api/v1/export/shipments/{a_id}/swap-packaging/  body {"other_id": int}

        Exchanges the packing of two rows before loading (spec 2026-09-29 §1.4).
        Replaces the old field-picking /swap/.

        Returns:
            200 {"shipments": [detail_a, detail_b]}; 400 rule broken; 403 role;
            404 other row missing; 409 closed season.
        """
        from apps.export.services.packaging import swap_packing

        if not _can_move_packing(request.user):
            return Response({'error': 'Your role cannot swap packing'},
                            status=status.HTTP_403_FORBIDDEN)
        body = ShipmentSwapPackagingSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        shipment_a = self.get_object()
        try:
            shipment_b = Shipment.objects.get(pk=body.validated_data['other_id'])
        except Shipment.DoesNotExist:
            return Response({'error': 'Other shipment not found'}, status=status.HTTP_404_NOT_FOUND)
        # Write freeze (D1): only shipment_a came through get_object().
        assert_season_open(shipment_b.season)
        try:
            shipment_a, shipment_b = swap_packing(shipment_a, shipment_b, request.user)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        self._sheet_poke_ids = [shipment_a.pk, shipment_b.pk]
        shipment_a.refresh_from_db()
        shipment_b.refresh_from_db()
        return Response({'shipments': [
            ShipmentDetailSerializer(shipment_a, context={'request': request}).data,
            ShipmentDetailSerializer(shipment_b, context={'request': request}).data,
        ]})
```

Delete `backend/apps/export/swap_config.py` and `backend/apps/export/tests_shipment_swap.py`. Then `grep -rn "swap_config\|SWAPPABLE_FIELDS\|ShipmentSwapSerializer\|_execute_swap\|swappable" backend/` — expected: only the two test files handled in Step 6.

- [ ] **Step 6: Re-home the two tests that used `/swap/`.**
  - `tests_season_freeze.py` `test_swap_with_a_closed_season_partner_returns_409`: change the URL to `/swap-packaging/` and the body to `{'other_id': <partner pk>}`. The view calls `assert_season_open` before `swap_packing`, so the rows need no packing for the 409 to fire. Keep the 409 assertion.
  - `tests_task_condition_reconcile_api.py`: delete the class whose docstring starts "Found in review: the swap endpoint is a SECOND runtime writer" (it exercises `has_peregruz` via `/swap/`; packing swap never writes a condition field, so there is nothing left to reconcile). Remove imports that become unused.

- [ ] **Step 7: Run.** `... manage.py test apps.export.tests_packing apps.export.tests_season_freeze apps.export.tests_task_condition_reconcile_api ...` Expected: all PASS (except anything already in the baseline).

No commit.

---

### Task 5: Board list endpoint + page access (completes commit 2)

**Files:**
- Modify: `backend/apps/export/views.py` — `get_serializer_class` (~412), `get_queryset` (~594)
- Modify: `backend/apps/export/serializers.py` — `ShipmentDraftListSerializer.Meta.fields` (~608)
- Modify: `backend/apps/core/management/commands/seed_permissions.py` (~112)
- Create: `backend/apps/core/migrations/0066_loading_dept_assign_page.py` (verify number)
- Modify: `backend/apps/export/tests_packing.py`

**Interfaces:**
- Produces: `GET /api/v1/export/shipments/?status_code__in=draft,gumruk_girish,gumruk_chykysh` → paginated `ShipmentDraftListSerializer` rows, now also carrying `country` and `customer` (ids). Existing fields already there: `status_code`, `status_display`, `truck_plate`, `driver_name`, `country_name`, `customer_name`, `export_code`, `block_sources`, `weight_net`, `freshness`, `harvest_age_days`.

- [ ] **Step 1: Failing tests.** Append:

```python
class BoardListTests(PackingFixtures):
    """Spec Part 2 §4 — the board's one query."""

    def test_status_code_in_returns_pre_loading_rows_with_ids(self):
        wanted = [self.make(code, destination=True) for code in ('draft', 'gumruk_girish', 'gumruk_chykysh')]
        self.make('yuklenme', destination=True)
        # The exact query useJoinBoard() sends.
        resp = self.client_for(self.manager).get(
            '/api/v1/export/shipments/?status_code__in=draft,gumruk_girish,gumruk_chykysh'
            f'&page_size=200&ordering=harvest_age_desc&season={self.season.pk}')
        self.assertEqual(resp.status_code, 200, resp.data)
        rows = {r['id']: r for r in resp.data['results']}
        self.assertEqual(set(rows), {s.pk for s in wanted})
        row = rows[wanted[1].pk]
        self.assertEqual(row['country'], self.country.pk)
        self.assertEqual(row['customer'], self.customer.pk)
        self.assertEqual(row['status_code'], 'gumruk_girish')
        self.assertIn('block_sources', row)
        self.assertIn('truck_plate', row)

    def test_plain_draft_list_unchanged(self):
        self.make('draft')
        resp = self.client_for(self.manager).get(
            f'/api/v1/export/shipments/?status_code=draft&page_size=200&season={self.season.pk}')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('block_sources', resp.data['results'][0])


class AssignPageGrantTests(TestCase):
    """Migration 0066 helper grants export.assign to the loading department."""

    def test_grant_creates_or_flips_rows(self):
        import importlib
        from apps.core.models import RolePagePermission
        migration = importlib.import_module('apps.core.migrations.0066_loading_dept_assign_page')
        RolePagePermission.objects.create(role='loading_dept_head', page_code='export.assign',
                                          is_visible=False)
        migration.grant_assign_page(RolePagePermission)
        self.assertEqual(
            set(RolePagePermission.objects.filter(page_code='export.assign', is_visible=True)
                .values_list('role', flat=True)) & {'loading_dept_head', 'loading_dept_head_deputy'},
            {'loading_dept_head', 'loading_dept_head_deputy'},
        )
```

(If the migration number is not 0066, use the real name in the `import_module` string.)

- [ ] **Step 2: Run to see them fail.** Expected: the list returns every non-cancelled row (filter ignored) and has no `country` key; ImportError for the migration.

- [ ] **Step 3: List filter + serializer.** In `get_queryset`, right after the `if status_code := ...:` block:

```python
        # Join board (spec 2026-09-29): several statuses at once, same draft
        # shape (block_sources prefetched) as ?status_code=draft.
        if status_codes := self.request.query_params.get('status_code__in'):
            qs = qs.filter(status__code__in=[c for c in status_codes.split(',') if c])
            if getattr(self, 'action', None) == 'list':
                qs = qs.select_related('created_by').prefetch_related('block_sources__block')
```

In `get_serializer_class`, make the draft branch:

```python
        if self.action == 'list' and (
            self.request.query_params.get('status_code') == 'draft'
            or self.request.query_params.get('status_code__in')
        ):
            return ShipmentDraftListSerializer
```

In `ShipmentDraftListSerializer.Meta.fields`, append `'country', 'customer'` (comment: `# FK ids — the join board classifies rows by them (spec 2026-09-29).`).

- [ ] **Step 4: Page access.** `seed_permissions.py` `PAGE_DEFAULTS['loading_dept_head']`: add `'export.assign',` after `'export.drafts',` with the comment `# Assignment board: join / detach / swap packing (spec 2026-09-29).` The deputy copies the head's set below — check that it still does.

Check the number: `ls backend/apps/core/migrations/ | tail -3` and `git log --oneline -5`. Create `backend/apps/core/migrations/0066_loading_dept_assign_page.py` (set `dependencies` to the real latest core migration):

```python
"""Give the loading department the Assignment board page (2026-09-29).

The board now joins, detaches and swaps packing, and the loading department
may do all three (JOIN_ROLES). `export.assign` already exists, so the head and
deputy rows usually exist with is_visible=False — flip them, or create them.
seed_permissions only runs on a fresh install, so a live database needs this.

Post-deploy check:
    RolePagePermission.objects.filter(page_code='export.assign',
        role__in=['loading_dept_head', 'loading_dept_head_deputy'], is_visible=True).count() == 2
If it is 0, this ran as a no-op against a `test_`-prefixed database: delete the
('core', '0066_loading_dept_assign_page') row from django_migrations and re-run
`migrate core` against the real database.
"""
from django.db import migrations

PAGE_CODE = 'export.assign'
ROLES = ('loading_dept_head', 'loading_dept_head_deputy')


def grant_assign_page(RolePagePermission) -> int:
    """Make the page visible for ROLES. Returns how many rows changed."""
    changed = 0
    for role in ROLES:
        row, created = RolePagePermission.objects.get_or_create(
            role=role, page_code=PAGE_CODE, defaults={'is_visible': True},
        )
        if created:
            changed += 1
        elif not row.is_visible:
            row.is_visible = True
            row.save(update_fields=['is_visible'])
            changed += 1
    return changed


def _wipe_perm_cache() -> None:
    """Best-effort flush of the 60 s per-role page caches."""
    try:
        from django.core.cache import cache

        from apps.core.views_permissions import PERM_CACHE_PREFIX
        cache.delete_many([f'{PERM_CACHE_PREFIX}:pages:{r}' for r in ROLES])
    except Exception:
        pass


def apply(apps, schema_editor):
    # Gated on the connection name — see 0033_boss_process_visibility_perms.
    if schema_editor.connection.settings_dict['NAME'].startswith('test_'):
        return
    grant_assign_page(apps.get_model('core', 'RolePagePermission'))
    _wipe_perm_cache()


def revert(apps, schema_editor):
    apps.get_model('core', 'RolePagePermission').objects.filter(
        page_code=PAGE_CODE, role__in=ROLES,
    ).update(is_visible=False)
    _wipe_perm_cache()


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0065_greenhouseconfig_scan_base_url'),
    ]

    operations = [
        migrations.RunPython(apply, reverse_code=revert),
    ]
```

- [ ] **Step 5: Apply locally.** `./venv/Scripts/python.exe manage.py migrate core` then `./venv/Scripts/python.exe manage.py showmigrations core | tail -3` — expect `[X] 0066_loading_dept_assign_page`. Run the post-deploy check from the docstring in `manage.py shell -c` — expect `2`.

- [ ] **Step 6: Full backend run vs baseline.**

```bash
PYTHONPATH=<scratchpad> ./venv/Scripts/python.exe manage.py test apps.export apps.core --noinput --keepdb --settings=settings_isolated 2>&1 | tee <scratchpad>/t5.txt
grep -E "^(FAIL|ERROR):" <scratchpad>/t5.txt | sort > <scratchpad>/t5_failures.txt
comm -13 <scratchpad>/baseline_failures.txt <scratchpad>/t5_failures.txt
```

Expected: `comm` prints nothing except lines for deleted `tests_shipment_swap` tests disappearing (those show in `comm -23`, which is fine). Also run the Sheet permission guard the project requires after permission-chain changes: `... manage.py test apps.export.tests_sheet_authority --noinput --keepdb --settings=settings_isolated -k TestEveryRoleCanEditItsOwnSheetRow` (if `-k` is unsupported, run the whole module). Expected: PASS. `./venv/Scripts/python.exe manage.py makemigrations --check --dry-run` → "No changes detected".

- [ ] **Step 7: Commit 2 (after "commit").**

```bash
git status
git add backend/apps/export/services/packaging.py backend/apps/export/views.py backend/apps/export/serializers.py backend/apps/core/roles.py backend/apps/core/management/commands/seed_permissions.py backend/apps/core/migrations/0066_loading_dept_assign_page.py backend/apps/export/tests_packing.py backend/apps/export/tests_shipment_join.py backend/apps/export/tests_season_freeze.py backend/apps/export/tests_task_condition_reconcile_api.py
git rm backend/apps/export/swap_config.py backend/apps/export/tests_shipment_swap.py
git diff --cached --stat
git commit -m "$(cat <<'EOF'
feat(p3): join packing until loading; detach and swap packing

Join now accepts a destination plan in draft, gumruk_girish or gumruk_chykysh.
New /unjoin/ moves the packing into a new supply plan (same day in its code);
new /swap-packaging/ exchanges the packing of two rows and replaces the
field-picking /swap/. Once documents start, only an empty net weight is
filled. The loading department joins the join roles and gets the Assignment
board page. The list accepts status_code__in for the board.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

Then `- [ ] 2026-09-29 — Backend: late join, /unjoin/, /swap-packaging/ (old /swap/ removed), loading dept roles + board page — NEEDS TEST` at the top of `BUILD_TEST_LOG.md`.

---

### Task 6: Frontend shared helpers, types, hooks (part of commit 3)

**Files:**
- Modify: `frontend/src/components/sheet/joinHelpers.ts`, `joinHelpers.test.ts`
- Modify: `frontend/src/types/index.ts` (`IShipmentDraft` ~line 1819; delete `IDemandItem` ~line 2004 in Task 7)
- Modify: `frontend/src/hooks/useDrafts.ts`
- Modify: `frontend/src/components/sheet/JoinActionBar.tsx`, `frontend/src/components/shipment/ShipmentDetailHero.tsx` (+ comment at `ShipmentDetailHero.test.tsx:91`)

**Interfaces:**
- Produces (`joinHelpers.ts`): `PRE_LOADING_STATUSES`, `isPreLoading(code: string): boolean`, `hasPacking(s: IJoinClassifiable): boolean`, `isJoinTarget(s: IJoinClassifiable): boolean` (replaces `isDestinationDraft`), `explainSwapBlockers<T extends Named>(selected: T[]): IJoinBlocker[]`; `JOIN_ROLES` gains the loading roles.
- Produces (`useDrafts.ts`): `useJoinBoard(): UseQueryResult<IShipmentDraft[]>`, `useUnjoinPackaging(): UseMutation<IUnjoinResult, unknown, number>`, `useSwapPackaging(): UseMutation<unknown, unknown, { aId: number; otherId: number }>`; `IUnjoinResult = { id: number; new_supply_id: number; new_supply_code: string }`.

- [ ] **Step 1: Failing tests.** In `joinHelpers.test.ts`: change the import `isDestinationDraft` → `isJoinTarget`, add `hasPacking, isPreLoading, explainSwapBlockers` to it, rename every `isDestinationDraft(` call to `isJoinTarget(`, and:
  - replace `it('a non-draft is neither', ...)` with:

```ts
  it('a target may be in any pre-loading status, not after', () => {
    expect(isJoinTarget({ ...destination, status_code: 'gumruk_chykysh' })).toBe(true);
    expect(isJoinTarget({ ...destination, status_code: 'yuklenme' })).toBe(false);
  });
```

  - in `canUserJoin`: move `'loading_dept_head'` into the allowed list and add `'loading_dept_head_deputy'`; the deny list becomes `['warehouse_chief', 'agronom', 'sales_rep']`.
  - in `explainJoinBlockers`, the case `[{ ...dest, status_code: 'yuklenme' }, supply]` now expects `[{ key: 'target_loading', code: <dest code> }]` (copy the `code` the old expectation used); add:

```ts
  it('a source that is not in Preparation is named', () => {
    expect(explainJoinBlockers([dest, { ...supply, status_code: 'gumruk_girish' }])).toEqual([
      { key: 'source_not_draft', code: 'S-1' },
    ]);
  });
```

  (use the `shipment_code` the file's `supply` fixture has, if it is not `'S-1'`).
  - add:

```ts
describe('packing helpers', () => {
  it('isPreLoading', () => {
    expect(['draft', 'gumruk_girish', 'gumruk_chykysh'].every(isPreLoading)).toBe(true);
    expect(isPreLoading('yuklenme')).toBe(false);
  });
  it('hasPacking', () => {
    expect(hasPacking({ status_code: 'draft', country: null, customer: null, block_sources: [{ block_id: 1 }] })).toBe(true);
    expect(hasPacking({ status_code: 'draft', country: null, customer: null, block_sources: [] })).toBe(false);
  });
});

describe('explainSwapBlockers', () => {
  const a = { shipment_code: 'A', status_code: 'gumruk_girish', country: 1, customer: 2, block_sources: [{ block_id: 1 }] };
  const b = { shipment_code: 'B', status_code: 'draft', country: null, customer: null, block_sources: [{ block_id: 2 }] };
  it('two pre-loading rows with packing swap', () => {
    expect(explainSwapBlockers([a, b])).toEqual([]);
  });
  it('needs two different rows', () => {
    expect(explainSwapBlockers([a])).toEqual([{ key: 'need_two' }]);
    expect(explainSwapBlockers([a, a])).toEqual([{ key: 'same_shipment' }]);
  });
  it('names a row after loading and a row without packing', () => {
    expect(explainSwapBlockers([{ ...a, status_code: 'yuklenme' }, { ...b, block_sources: [] }])).toEqual([
      { key: 'swap_loading', code: 'A' },
      { key: 'swap_no_packing', code: 'B' },
    ]);
  });
});
```

- [ ] **Step 2: Run to see them fail.** `cd frontend && npx vitest run src/components/sheet/joinHelpers.test.ts` — expected: import errors.

- [ ] **Step 3: Implement in `joinHelpers.ts`.**
  - `JOIN_ROLES`: `['admin', 'export_manager', 'director', 'boss', 'document_team', 'loading_dept_head', 'loading_dept_head_deputy']`; update the comment above it to say it mirrors `apps.core.roles.JOIN_ROLES` and also gates detach + swap packing (spec 2026-09-29).
  - Add below the `IJoinClassifiable` interface:

```ts
// ─── Packing (spec 2026-09-29) ───────────────────────────────────────────────
// Statuses in which packing may still be joined, detached or swapped.
// Mirrors apps/export/services/packaging.py PRE_LOADING.
export const PRE_LOADING_STATUSES = ['draft', 'gumruk_girish', 'gumruk_chykysh'] as const;

export function isPreLoading(statusCode: string): boolean {
  return (PRE_LOADING_STATUSES as readonly string[]).includes(statusCode);
}

export function hasPacking(s: IJoinClassifiable): boolean {
  return s.block_sources != null && s.block_sources.length > 0;
}
```

  - Replace `isDestinationDraft` with:

```ts
/** A destination plan that may still receive packing: before loading, country +
 *  customer set, no packing yet. Mirrors the backend _validate_join target gate. */
export function isJoinTarget(s: IJoinClassifiable): boolean {
  return isPreLoading(s.status_code) && s.country !== null && s.customer !== null && !hasPacking(s);
}
```

  and use `isJoinTarget` inside `detectJoinDirection`.
  - In `explainJoinBlockers`, delete the `notDrafts` block and, after `const target = ...`, build blockers as:

```ts
  const source = withBlocks[0];
  const blockers: IJoinBlocker[] = [];
  if (source.status_code !== 'draft') blockers.push({ key: 'source_not_draft', code: label(source) });
  if (!isPreLoading(target.status_code)) blockers.push({ key: 'target_loading', code: label(target) });
  if (target.country === null) blockers.push({ key: 'target_no_country', code: label(target) });
  if (target.customer === null) blockers.push({ key: 'target_no_customer', code: label(target) });
  return blockers;
```

  - Append:

```ts
/** Why two selected rows can't swap packing ([] when they can). Mirrors the
 *  backend swap_packing gates minus pallets and role (those come back as a toast). */
export function explainSwapBlockers<T extends Named>(selected: T[]): IJoinBlocker[] {
  if (selected.length !== 2) return [{ key: 'need_two' }];
  const [a, b] = selected;
  if (a === b || (a.shipment_code != null && a.shipment_code === b.shipment_code)) {
    return [{ key: 'same_shipment' }];
  }
  const blockers: IJoinBlocker[] = [];
  for (const s of selected) {
    if (!isPreLoading(s.status_code)) blockers.push({ key: 'swap_loading', code: label(s) });
    else if (!hasPacking(s)) blockers.push({ key: 'swap_no_packing', code: label(s) });
  }
  return blockers;
}
```

- [ ] **Step 4: Rename call sites.** `JoinActionBar.tsx`: import and use `isJoinTarget` instead of `isDestinationDraft`. `ShipmentDetailHero.tsx:19,153`: same rename (the "Join supply" button now also shows on a `gumruk_*` destination plan without packing — intended). `ShipmentDetailHero.test.tsx:91`: rename in the comment. Then `grep -rn "isDestinationDraft" frontend/src` → nothing.

- [ ] **Step 5: Types.** In `IShipmentDraft` (`types/index.ts`), replace the comment block above `country_name?` (it says the serializer never sends ids — no longer true) with the following, and add the fields:

```ts
  // Destination names, and (since 2026-09-29) the raw FK ids plus status and
  // truck — ShipmentDraftListSerializer sends all of these; the join board
  // (status_code__in=…) classifies rows by them. Optional because mock literals
  // (mock/drafts.ts) don't set them.
  country_name?: string | null;
  customer_name?: string | null;
  country?: number | null;
  customer?: number | null;
  status_code?: string;
  status_display?: string;
  truck_plate?: string | null;
  driver_name?: string | null;
```

- [ ] **Step 6: Hooks.** In `useDrafts.ts`:
  - extract the block-weight coercion from `useDrafts` into a module-level function and use it there:

```ts
// block_sources[].weight_kg is a DecimalField — arrives as a string ("8000.00").
// Coerced once, at the fetch boundary.
function normalizeDraft(d: IShipmentDraft): IShipmentDraft {
  return {
    ...d,
    block_sources: (d.block_sources ?? []).map((s) => ({
      ...s,
      weight_kg: s.weight_kg != null ? Number(s.weight_kg) : null,
    })),
  };
}
```

  (keep the existing long comment in `useDrafts` pointing at it; `return (data.results ?? []).map(normalizeDraft);`).
  - add after `useDrafts`, importing `PRE_LOADING_STATUSES` from `@/components/sheet/joinHelpers`:

```ts
// ─── useJoinBoard ─────────────────────────────────────────────────────────

/**
 * Every row the Assignment board shows: all shipments before loading
 * (draft, gumruk_girish, gumruk_chykysh) in the browsed season. Keyed under
 * ['drafts'] so every join / unjoin / swap invalidation refreshes it.
 */
export function useJoinBoard() {
  const { seasonId, isReady } = useSelectedSeason();
  return useQuery({
    queryKey: ['drafts', 'join-board', seasonId],
    queryFn: async (): Promise<IShipmentDraft[]> => {
      if (USE_MOCK) return sortOldestFirst(MOCK_DRAFTS);
      const seasonParam = seasonId != null ? `&season=${seasonId}` : '';
      const { data } = await api.get<{ results: IShipmentDraft[] }>(
        `/export/shipments/?status_code__in=${PRE_LOADING_STATUSES.join(',')}`
          + `&page_size=200&ordering=harvest_age_desc${seasonParam}`,
      );
      return (data.results ?? []).map(normalizeDraft);
    },
    enabled: USE_MOCK || isReady,
    staleTime: 30_000,
  });
}
```

  - add after the `useSwapShipments` section (leave `useSwapShipments` itself in place — `SwapFieldsModal.tsx` still imports it until Task 8 deletes both, so every commit type-checks):

```ts
// ─── Packing moves (spec 2026-09-29) ──────────────────────────────────────

function invalidatePackingQueries(
  queryClient: ReturnType<typeof useQueryClient>, ids: number[],
): void {
  queryClient.invalidateQueries({ queryKey: ['drafts'] });
  queryClient.invalidateQueries({ queryKey: ['shipments'] });
  queryClient.invalidateQueries({ queryKey: ['shipments', 'sheet'] });
  ids.forEach((id) => queryClient.invalidateQueries({ queryKey: getShipmentDetailKey(id) }));
}

export interface IUnjoinResult {
  id: number;
  new_supply_id: number;
  new_supply_code: string;
}

/** POST /export/shipments/{id}/unjoin/ — packing goes to a new supply plan. */
export function useUnjoinPackaging() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number): Promise<IUnjoinResult> => {
      const { data } = await api.post<IUnjoinResult>(`/export/shipments/${id}/unjoin/`, {});
      return data;
    },
    onSuccess: (data, id) => invalidatePackingQueries(queryClient, [id, data.new_supply_id]),
  });
}

/** POST /export/shipments/{aId}/swap-packaging/ — the two rows exchange packing. */
export function useSwapPackaging() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ aId, otherId }: { aId: number; otherId: number }) => {
      const { data } = await api.post(`/export/shipments/${aId}/swap-packaging/`, { other_id: otherId });
      return data;
    },
    onSuccess: (_data, vars) => invalidatePackingQueries(queryClient, [vars.aId, vars.otherId]),
  });
}
```

  - update the `useJoinShipments` docstring gate lines to: "Caller must hold JOIN_ROLES (incl. the loading department). Target: country+customer, no packing, before loading (draft / gumruk_girish / gumruk_chykysh). Source: draft with ≥1 block."

- [ ] **Step 7: Run.** `npx vitest run src/components/sheet/joinHelpers.test.ts` → PASS. `npx tsc --noEmit --ignoreDeprecations 5.0` → no errors beyond the baseline.

No commit — commit 3 lands at the end of Task 7.

---

### Task 7: The Assignment board (completes commit 3)

**Files:**
- Create: `frontend/src/pages/export/assignment/boardHelpers.ts`, `boardHelpers.test.ts`, `ExportPartCard.tsx`, `PackingActionPanel.tsx`, `BoardColumn.tsx`
- Rewrite: `frontend/src/pages/export/AssignmentBoard.tsx`
- Modify: `frontend/src/pages/export/assignment/assignmentHelpers.ts` (keep only `FRESHNESS_BORDER`)
- Delete: `frontend/src/pages/export/assignment/DemandCard.tsx`, `MatchPanel.tsx`, `frontend/src/mock/demand.ts`; `IDemandItem` in `types/index.ts`
- Modify: `frontend/src/i18n/{tk,ru,en}.json`

**Interfaces:**
- Consumes: `hasPacking`, `isPreLoading`, `IJoinClassifiable`, `canUserJoin` (Task 6); `useJoinBoard`, `useJoinShipments`, `useUnjoinPackaging`, `useSwapPackaging` (Task 6); `extractPatchError(err: unknown, fallback: string): string` (`hooks/useShipmentPatch.ts`).
- Produces (`boardHelpers.ts`): `isFreePacking(d)`, `isExportPart(d)`, `splitBoardColumns(rows) -> { free, waiting, joined }`, `decideBoardAction(selected) -> BoardAction`, `nextSelection(current: number[], clicked: number): number[]`, type `BoardAction`.

- [ ] **Step 1: Failing tests.** Create `frontend/src/pages/export/assignment/boardHelpers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { IShipmentDraft } from '@/types';
import { decideBoardAction, nextSelection, splitBoardColumns } from './boardHelpers';

function row(id: number, over: Partial<IShipmentDraft> = {}): IShipmentDraft {
  return {
    id, shipment_code: `C${id}`, date: '2026-09-29', created_at: '2026-09-29T06:00:00Z',
    created_by_name: null, weight_net: null, block_sources: [], export_code: null,
    previous_platform_id: null, harvest_age_days: 0, freshness: 'today', variety_confidence: 'none',
    status_code: 'draft', country: null, customer: null, ...over,
  };
}
const block = [{ block_id: 1, block_code: 'A', weight_kg: 9000 }];
const free = row(1, { block_sources: block });
const waiting = row(2, { status_code: 'gumruk_girish', country: 5, customer: 6 });
const joined = row(3, { status_code: 'gumruk_chykysh', country: 5, customer: 6, block_sources: block });
const loading = row(4, { status_code: 'yuklenme', country: 5, customer: 6, block_sources: block });
const bare = row(5);

describe('splitBoardColumns', () => {
  it('sorts rows into free / waiting / joined and drops the rest', () => {
    const cols = splitBoardColumns([free, waiting, joined, loading, bare]);
    expect(cols.free.map((r) => r.id)).toEqual([1]);
    expect(cols.waiting.map((r) => r.id)).toEqual([2]);
    expect(cols.joined.map((r) => r.id)).toEqual([3]);
  });
});

describe('decideBoardAction', () => {
  it('free packing + waiting export part → join, either order', () => {
    expect(decideBoardAction([free, waiting])).toEqual({ kind: 'join', targetId: 2, sourceId: 1 });
    expect(decideBoardAction([waiting, free])).toEqual({ kind: 'join', targetId: 2, sourceId: 1 });
  });
  it('one export part with packing → unjoin', () => {
    expect(decideBoardAction([joined])).toEqual({ kind: 'unjoin', id: 3 });
  });
  it('two rows with packing → swap (incl. a free supply plan)', () => {
    expect(decideBoardAction([joined, free])).toEqual({ kind: 'swap', aId: 3, bId: 1 });
  });
  it('nothing sensible → none', () => {
    expect(decideBoardAction([])).toEqual({ kind: 'none' });
    expect(decideBoardAction([free])).toEqual({ kind: 'none' });
    expect(decideBoardAction([waiting])).toEqual({ kind: 'none' });
    expect(decideBoardAction([waiting, waiting])).toEqual({ kind: 'none' });
    expect(decideBoardAction([joined, loading])).toEqual({ kind: 'none' });
  });
});

describe('nextSelection', () => {
  it('toggles, and a third pick starts over', () => {
    expect(nextSelection([], 1)).toEqual([1]);
    expect(nextSelection([1], 2)).toEqual([1, 2]);
    expect(nextSelection([1, 2], 2)).toEqual([1]);
    expect(nextSelection([1, 2], 3)).toEqual([3]);
  });
});
```

- [ ] **Step 2: Run to see them fail.** `npx vitest run src/pages/export/assignment/boardHelpers.test.ts` — module not found.

- [ ] **Step 3: `boardHelpers.ts`.**

```ts
import type { IShipmentDraft } from '@/types';
import { hasPacking, isPreLoading, type IJoinClassifiable } from '@/components/sheet/joinHelpers';

// Assignment board classification (spec 2026-09-29, Part 2). Rows come from
// useJoinBoard(): every shipment before loading.

function classify(d: IShipmentDraft): IJoinClassifiable {
  return {
    status_code: d.status_code ?? 'draft',
    country: d.country ?? null,
    customer: d.customer ?? null,
    block_sources: d.block_sources,
  };
}

/** Left column: a supply plan on no truck — draft, has packing, no full destination. */
export function isFreePacking(d: IShipmentDraft): boolean {
  const c = classify(d);
  return c.status_code === 'draft' && hasPacking(c) && !(c.country !== null && c.customer !== null);
}

/** Right column: a destination plan that has not started loading. */
export function isExportPart(d: IShipmentDraft): boolean {
  const c = classify(d);
  return c.country !== null && c.customer !== null && isPreLoading(c.status_code);
}

function isWaiting(d: IShipmentDraft): boolean {
  return isExportPart(d) && !hasPacking(classify(d));
}

function canSwap(d: IShipmentDraft): boolean {
  const c = classify(d);
  return hasPacking(c) && isPreLoading(c.status_code);
}

export function splitBoardColumns(rows: IShipmentDraft[]) {
  const exportParts = rows.filter(isExportPart);
  return {
    free: rows.filter(isFreePacking),
    waiting: exportParts.filter((d) => !hasPacking(classify(d))),
    joined: exportParts.filter((d) => hasPacking(classify(d))),
  };
}

export type BoardAction =
  | { kind: 'join'; targetId: number; sourceId: number }
  | { kind: 'unjoin'; id: number }
  | { kind: 'swap'; aId: number; bId: number }
  | { kind: 'none' };

/** The one action the picked cards allow. */
export function decideBoardAction(selected: IShipmentDraft[]): BoardAction {
  if (selected.length === 1) {
    const [only] = selected;
    return isExportPart(only) && hasPacking(classify(only)) ? { kind: 'unjoin', id: only.id } : { kind: 'none' };
  }
  if (selected.length !== 2 || selected[0].id === selected[1].id) return { kind: 'none' };
  const [a, b] = selected;
  if (isFreePacking(a) && isWaiting(b)) return { kind: 'join', targetId: b.id, sourceId: a.id };
  if (isFreePacking(b) && isWaiting(a)) return { kind: 'join', targetId: a.id, sourceId: b.id };
  if (canSwap(a) && canSwap(b)) return { kind: 'swap', aId: a.id, bId: b.id };
  return { kind: 'none' };
}

/** Click rule: toggle; with two already picked, a new card starts over. */
export function nextSelection(current: number[], clicked: number): number[] {
  if (current.includes(clicked)) return current.filter((id) => id !== clicked);
  if (current.length >= 2) return [clicked];
  return [...current, clicked];
}
```

- [ ] **Step 4: Run the helper tests.** Expected: PASS.

- [ ] **Step 5: `BoardColumn.tsx`** (the column shell the old page repeated three times inline):

```tsx
import type { ReactNode } from 'react';
import { COLORS } from '@/constants/styles';

interface IBoardColumnProps {
  title: string;
  dotColor?: string;
  count?: number;
  children: ReactNode;
}

/** One Assignment-board column: header with a dot and a count, scrolling body. */
export function BoardColumn({ title, dotColor, count, children }: IBoardColumnProps) {
  return (
    <div style={{ background: COLORS.white, border: '1px solid #f0f0f0', borderRadius: 8,
      display: 'flex', flexDirection: 'column', minHeight: 600 }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', display: 'flex',
        alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          {dotColor && (
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: dotColor, display: 'inline-block' }} />
          )}
          {title}
        </div>
        {count != null && (
          <div style={{ background: COLORS.border, padding: '2px 9px', borderRadius: 12, fontSize: 12,
            fontWeight: 600, color: COLORS.textTertiary }}>
            {count}
          </div>
        )}
      </div>
      <div style={{ padding: 10, flex: 1, overflowY: 'auto', maxHeight: 680 }}>{children}</div>
    </div>
  );
}
```

- [ ] **Step 6: `ExportPartCard.tsx`.**

```tsx
import { Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import type { IShipmentDraft } from '@/types';
import { COLORS, FONT } from '@/constants/styles';

interface IExportPartCardProps {
  part: IShipmentDraft;
  selected: boolean;
  onSelect: () => void;
}

/** Right-column card: a destination plan before loading, its truck and packing. */
export function ExportPartCard({ part, selected, onSelect }: IExportPartCardProps) {
  const { t } = useTranslation();
  const blocks = part.block_sources.map((s) => s.block_code).join(' + ');
  const truck = [part.truck_plate, part.driver_name].filter(Boolean).join(' · ');

  return (
    <div
      onClick={onSelect}
      style={{
        background: selected ? COLORS.bgBlue : COLORS.white,
        border: selected ? '2px solid #1677ff' : '1px solid #f0f0f0',
        borderRadius: 6, padding: 10, marginBottom: 8, cursor: 'pointer',
        boxShadow: selected ? '0 0 0 2px rgba(22,119,255,0.2)' : undefined,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
        <span style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: 12, color: COLORS.primary }}>
          {part.shipment_code}
        </span>
        <Tag style={{ marginInlineEnd: 0, fontSize: 10 }}>
          {t(`shipment_status.${part.status_code}`, { defaultValue: part.status_display ?? part.status_code })}
        </Tag>
      </div>
      <div style={{ fontSize: 11, marginTop: 4 }}>
        {[part.customer_name, part.country_name].filter(Boolean).join(', ')}
      </div>
      <div style={{ fontSize: 11, color: COLORS.textSecondary, marginTop: 2 }}>
        {truck || t('assign.no_truck')}
      </div>
      {blocks && (
        <div style={{ fontSize: 11, color: '#08979c', marginTop: 4 }}>
          {t('assign.packing_label')}: {blocks}{part.export_code ? ` · ${part.export_code}` : ''}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: `PackingActionPanel.tsx`.**

```tsx
import { Button, Modal, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { IShipmentDraft } from '@/types';
import type { BoardAction } from './boardHelpers';
import { COLORS, FONT } from '@/constants/styles';

const { Text } = Typography;

const BUTTON_KEY = {
  join: 'packing.btn_join',
  unjoin: 'packing.btn_unjoin',
  swap: 'packing.btn_swap',
} as const;

interface IPackingActionPanelProps {
  selected: IShipmentDraft[];
  action: BoardAction;
  canAct: boolean;
  isPending: boolean;
  onRun: () => void;
  onClear: () => void;
}

/** Centre column: the picked cards and the one action they allow. */
export function PackingActionPanel({ selected, action, canAct, isPending, onRun, onClear }: IPackingActionPanelProps) {
  const { t } = useTranslation();

  function confirmThenRun() {
    if (action.kind === 'join') {
      onRun();
      return;
    }
    const [a, b] = selected.map((s) => s.shipment_code);
    const kind = action.kind === 'swap' ? 'swap' : 'unjoin';
    Modal.confirm({
      title: t(`packing.confirm_${kind}_title`),
      content: t(`packing.confirm_${kind}_body`, { a, b }),
      okText: t('packing.confirm_ok'),
      cancelText: t('packing.confirm_cancel'),
      onOk: onRun,
    });
  }

  if (selected.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <Text type="secondary">{t('assign.hint_pick')}</Text>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {selected.map((s) => (
        <div key={s.id} style={{ border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: 8 }}>
          <span style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: 12 }}>{s.shipment_code}</span>
          <div style={{ fontSize: 11, color: COLORS.textSecondary }}>
            {[s.customer_name, s.country_name].filter(Boolean).join(', ')
              || s.block_sources.map((b) => b.block_code).join(' + ')}
          </div>
        </div>
      ))}
      {action.kind === 'none' ? (
        <Text type="warning" style={{ fontSize: 12 }}>
          {t(selected.length === 1 ? 'assign.hint_pick_second' : 'assign.hint_invalid')}
        </Text>
      ) : (
        <Button type="primary" block loading={isPending} disabled={!canAct} onClick={confirmThenRun}>
          {t(BUTTON_KEY[action.kind])}
        </Button>
      )}
      <Button block onClick={onClear}>{t('assign.btn_clear')}</Button>
    </div>
  );
}
```

- [ ] **Step 8: Rewrite `AssignmentBoard.tsx`.**

```tsx
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Spin, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useJoinBoard, useJoinShipments, useSwapPackaging, useUnjoinPackaging } from '@/hooks/useDrafts';
import { useSeasonReadOnly } from '@/hooks/useSeasonReadOnly';
import { useAuth } from '@/hooks/useAuth';
import { extractPatchError } from '@/hooks/useShipmentPatch';
import { canUserJoin } from '@/components/sheet/joinHelpers';
import { COLORS } from '@/constants/styles';
import type { IShipmentDraft } from '@/types';
import { BoardColumn } from './assignment/BoardColumn';
import { SupplyCard } from './assignment/SupplyCard';
import { ExportPartCard } from './assignment/ExportPartCard';
import { PackingActionPanel } from './assignment/PackingActionPanel';
import { decideBoardAction, nextSelection, splitBoardColumns } from './assignment/boardHelpers';

const { Text, Title } = Typography;

/** Assignment board (spec 2026-09-29): join, detach and swap packing before loading. */
export default function AssignmentBoard() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const isReadOnly = useSeasonReadOnly();
  const { data: rows = [], isLoading } = useJoinBoard();
  const joinMutation = useJoinShipments();
  const unjoinMutation = useUnjoinPackaging();
  const swapMutation = useSwapPackaging();
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // Deep link from the supply-plan pool: /export/assign?draftId=123 preselects it.
  useEffect(() => {
    const draftId = searchParams.get('draftId');
    if (draftId) setSelectedIds([Number(draftId)]);
  }, [searchParams]);

  const { free, waiting, joined } = splitBoardColumns(rows);
  const selected = selectedIds
    .map((id) => rows.find((r) => r.id === id))
    .filter((r): r is IShipmentDraft => r !== undefined);
  const action = decideBoardAction(selected);
  const canAct = canUserJoin(user) && !isReadOnly;
  const isPending = joinMutation.isPending || unjoinMutation.isPending || swapMutation.isPending;

  const toggle = (id: number) => setSelectedIds((current) => nextSelection(current, id));
  const onError = (err: unknown) => toast.error(extractPatchError(err, t('packing.toast_error')));
  const done = () => setSelectedIds([]);

  function run() {
    if (action.kind === 'join') {
      joinMutation.mutate(
        { targetId: action.targetId, sourceId: action.sourceId },
        { onSuccess: () => { toast.success(t('packing.toast_joined')); done(); }, onError },
      );
    } else if (action.kind === 'unjoin') {
      unjoinMutation.mutate(action.id, {
        onSuccess: (res) => { toast.success(t('packing.toast_unjoined', { code: res.new_supply_code })); done(); },
        onError,
      });
    } else if (action.kind === 'swap') {
      swapMutation.mutate(
        { aId: action.aId, otherId: action.bId },
        { onSuccess: () => { toast.success(t('packing.toast_swapped')); done(); }, onError },
      );
    }
  }

  const groupHeader = (label: string, count: number) => (
    <div style={{ padding: '7px 14px', fontSize: 10, fontWeight: 600, color: COLORS.textSecondary,
      textTransform: 'uppercase', letterSpacing: '0.06em', background: COLORS.bgLayout,
      borderBottom: '1px solid #f0f0f0', margin: '8px -10px 6px' }}>
      {label} · {count}
    </div>
  );
  const empty = (key: string) => (
    <Text type="secondary" style={{ fontSize: 12, padding: 12, display: 'block', textAlign: 'center' }}>
      {t(key)}
    </Text>
  );

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>{t('assign.page_title')}</Title>
        <Text type="secondary" style={{ fontSize: 13 }}>{t('assign.page_subtitle')}</Text>
      </div>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 48 }}><Spin /></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr 340px', gap: 14 }}>
          <BoardColumn title={t('assign.col_supply')} dotColor="#13c2c2" count={free.length}>
            {free.length === 0 ? empty('assign.supply_empty') : free.map((d) => (
              <SupplyCard key={d.id} draft={d} selected={selectedIds.includes(d.id)} onSelect={() => toggle(d.id)} />
            ))}
          </BoardColumn>

          <BoardColumn title={t('assign.col_action')}>
            <PackingActionPanel
              selected={selected}
              action={action}
              canAct={canAct}
              isPending={isPending}
              onRun={run}
              onClear={done}
            />
            {isReadOnly && <Tag style={{ margin: 16 }}>{t('assign.read_only')}</Tag>}
          </BoardColumn>

          <BoardColumn title={t('assign.col_export')} dotColor="#d4380d" count={waiting.length + joined.length}>
            {waiting.length + joined.length === 0 ? empty('assign.export_empty') : (
              <>
                {groupHeader(t('assign.group_waiting'), waiting.length)}
                {waiting.map((d) => (
                  <ExportPartCard key={d.id} part={d} selected={selectedIds.includes(d.id)} onSelect={() => toggle(d.id)} />
                ))}
                {groupHeader(t('assign.group_joined'), joined.length)}
                {joined.map((d) => (
                  <ExportPartCard key={d.id} part={d} selected={selectedIds.includes(d.id)} onSelect={() => toggle(d.id)} />
                ))}
              </>
            )}
          </BoardColumn>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 9: Delete the mock-demand leftovers.** Delete `assignment/DemandCard.tsx`, `assignment/MatchPanel.tsx`, `mock/demand.ts`, the `IDemandItem` interface in `types/index.ts`, and `getDemandGroups` (+ its `IDemandItem` import) in `assignmentHelpers.ts`. Update the comment in `components/shipment/blockSourceGroups.ts:18` that lists `MatchPanel.tsx` (drop that name). `grep -rn "MOCK_DEMAND\|IDemandItem\|DemandCard\|MatchPanel\|getDemandGroups" frontend/src` → nothing.

- [ ] **Step 10: Translations.** First check the JSON round-trips unchanged (so a script edit makes a clean diff):

```bash
cd frontend/src/i18n
python -c "
import json
for lang in ('tk','ru','en'):
    p=lang+'.json'; s=open(p,encoding='utf-8').read()
    assert json.dumps(json.loads(s),ensure_ascii=False,indent=2)+'\n'==s, p
print('roundtrip ok')"
```

If it asserts, edit the three files by hand with the Edit tool instead. Otherwise write this script to your scratchpad as `i18n_board.py` and run it from `frontend/src/i18n`:

```python
import json
import os

NEW = {
    'assign': {
        'page_subtitle': {'tk': 'Sol: üpjünçilik bölegi · Sag: ýüklemä çenli eksport bölegi',
                          'ru': 'Слева: план поставки · Справа: план назначения до погрузки',
                          'en': 'Left: supply plans · Right: destination plans before loading'},
        'col_supply': {'tk': 'Üpjünçilik bölegi', 'ru': 'План поставки', 'en': 'Supply plans'},
        'col_action': {'tk': 'Hereket', 'ru': 'Действие', 'en': 'Action'},
        'col_export': {'tk': 'Eksport bölegi', 'ru': 'План назначения', 'en': 'Destination plans'},
        'group_waiting': {'tk': 'Üpjünçilige garaşýar', 'ru': 'Ждут упаковку', 'en': 'Waiting for supply'},
        'group_joined': {'tk': 'Üpjünçilik birleşdirildi', 'ru': 'С упаковкой', 'en': 'Supply joined'},
        'supply_empty': {'tk': 'Boş üpjünçilik bölegi ýok', 'ru': 'Свободных планов поставки нет',
                         'en': 'No free supply plans'},
        'export_empty': {'tk': 'Ýüklemä çenli eksport bölegi ýok', 'ru': 'Планов назначения до погрузки нет',
                         'en': 'No destination plans before loading'},
        'hint_pick': {'tk': 'Üpjünçilik we eksport bölegini saýlaň — ýa-da üpjünçiligi bolan bir ýa-da iki kartoçkany',
                      'ru': 'Выберите план поставки и план назначения — или одну-две карточки с упаковкой',
                      'en': 'Pick a supply plan and a destination plan — or one or two cards with supply'},
        'hint_pick_second': {'tk': 'Ikinji kartoçkany saýlaň', 'ru': 'Выберите вторую карточку',
                             'en': 'Pick a second card'},
        'hint_invalid': {'tk': 'Bu jübüti birleşdirip ýa-da çalşyp bolmaýar',
                         'ru': 'Эту пару нельзя присоединить или поменять',
                         'en': "This pair can't be joined or swapped"},
        'no_truck': {'tk': 'maşyn ýok', 'ru': 'машины нет', 'en': 'no truck'},
        'packing_label': {'tk': 'Üpjünçilik', 'ru': 'Упаковка', 'en': 'Supply'},
        'read_only': {'tk': 'Möwsüm ýapyk — diňe okamak', 'ru': 'Сезон закрыт — только просмотр',
                      'en': 'Season closed — read only'},
    },
    'packing': {
        'btn_join': {'tk': 'Birleşdir', 'ru': 'Присоединить', 'en': 'Join'},
        'btn_unjoin': {'tk': 'Aýyr', 'ru': 'Отсоединить', 'en': 'Detach'},
        'btn_swap': {'tk': 'Üpjünçiligi çalyş', 'ru': 'Поменять упаковку', 'en': 'Swap supply'},
        'confirm_unjoin_title': {'tk': 'Üpjünçiligi aýyrmalymy?', 'ru': 'Отсоединить упаковку?',
                                 'en': 'Detach the supply?'},
        'confirm_unjoin_body': {
            'tk': '{{a}} üpjünçiligi täze kodly aýratyn üpjünçilik bölegi bolar. QR-ýazgylar eýýäm çap edilen bolsa, täzeden çap ediň.',
            'ru': 'Упаковка {{a}} станет отдельным планом поставки с новым кодом. Если QR-наклейки уже напечатаны — перепечатайте.',
            'en': 'The supply of {{a}} becomes a separate supply plan with a new code. If QR labels are already printed, reprint them.'},
        'confirm_swap_title': {'tk': 'Üpjünçiligi çalyşmalymy?', 'ru': 'Поменять упаковку?',
                               'en': 'Swap the supply?'},
        'confirm_swap_body': {
            'tk': '{{a}} we {{b}} üpjünçiligini çalyşar. QR-ýazgylar eýýäm çap edilen bolsa, täzeden çap ediň.',
            'ru': '{{a}} и {{b}} обменяются упаковкой. Если QR-наклейки уже напечатаны — перепечатайте.',
            'en': '{{a}} and {{b}} exchange their supply. If QR labels are already printed, reprint them.'},
        'confirm_ok': {'tk': 'Hawa', 'ru': 'Да', 'en': 'Yes'},
        'confirm_cancel': {'tk': 'Ýok', 'ru': 'Нет', 'en': 'No'},
        'toast_joined': {'tk': 'Üpjünçilik birleşdirildi', 'ru': 'Упаковка присоединена', 'en': 'Supply joined'},
        'toast_unjoined': {'tk': 'Üpjünçilik aýryldy → {{code}}', 'ru': 'Упаковка отсоединена → {{code}}',
                           'en': 'Supply detached → {{code}}'},
        'toast_swapped': {'tk': 'Üpjünçilik çalşyldy', 'ru': 'Упаковка поменяна', 'en': 'Supply swapped'},
        'toast_error': {'tk': 'Amal ýerine ýetirilmedi', 'ru': 'Операция не выполнена', 'en': 'Action failed'},
    },
    # Emitted by explainJoinBlockers / explainSwapBlockers since Task 6.
    'join_blockers': {
        'need_two': {'tk': 'Takyk 2 sütün saýlaň', 'ru': 'Выберите ровно 2 колонки',
                     'en': 'Select exactly 2 columns'},
        'source_not_draft': {'tk': '{{code}} — üpjünçilik bölegi taýýarlykda bolmaly',
                             'ru': '{{code}} — план поставки должен быть в подготовке',
                             'en': '{{code}} — the supply plan must be in Preparation'},
        'target_loading': {'tk': '{{code}} — ýükleme başlady, birleşdirip bolmaýar',
                           'ru': '{{code}} — погрузка началась, присоединить нельзя',
                           'en': '{{code}} — loading has started, supply can no longer be joined'},
        'swap_loading': {'tk': '{{code}} — ýükleme başlady, çalşyp bolmaýar',
                         'ru': '{{code}} — погрузка началась, поменять нельзя',
                         'en': '{{code}} — loading has started, supply can no longer be swapped'},
        'swap_no_packing': {'tk': '{{code}} — üpjünçilik ýok', 'ru': '{{code}} — нет упаковки',
                            'en': '{{code}} — has no supply'},
    },
}

# assign.* keys only the mock-demand board used. Each is deleted only if no
# source file outside i18n/ still mentions it (checked by the grep step below).
OBSOLETE_ASSIGN = [
    'role_label', 'banner_title', 'banner_body', 'col_match', 'col_demand', 'demand_empty',
    'match_empty_primary', 'match_empty_secondary', 'match_title', 'match_supply', 'match_demand',
    'match_both_required', 'not_selected', 'compat_any_variety', 'compat_strict_label',
    'compat_strict_body', 'compat_soft', 'compat_old_title', 'compat_old_body',
    'compat_yesterday_title', 'compat_yesterday_body', 'btn_confirm', 'toast_confirmed',
    'confirm_navigate_title', 'confirm_navigate_body', 'confirm_navigate_ok',
    'confirm_navigate_cancel', 'group_contracts', 'group_quota', 'group_queue', 'label_firm',
    'label_remaining', 'label_days_suffix', 'label_pref', 'label_strict', 'demand_label_contract',
    'demand_label_quota', 'demand_label_queue', 'demand_label_local',
    'variety_pending_warning_title', 'variety_pending_warning_body', 'center_select_draft',
]
# Obsolete keys some other file still uses (written by the grep loop below).
KEEP = set(open('keep_assign.txt').read().split()) if os.path.exists('keep_assign.txt') else set()

for lang in ('tk', 'ru', 'en'):
    path = f'{lang}.json'
    data = json.load(open(path, encoding='utf-8'))
    for ns, keys in NEW.items():
        section = data.setdefault(ns, {})
        for key, texts in keys.items():
            section[key] = texts[lang]
    for key in OBSOLETE_ASSIGN:
        if key not in KEEP:
            data['assign'].pop(key, None)
    # explainJoinBlockers no longer emits 'not_draft' (Task 6).
    data['join_blockers'].pop('not_draft', None)
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
print('ok')
```

Before running it, find obsolete keys still used elsewhere and list them in `frontend/src/i18n/keep_assign.txt` (one per line; delete that file after the run):

```bash
cd frontend/src
for k in role_label banner_title banner_body col_match col_demand demand_empty match_empty_primary match_empty_secondary match_title match_supply match_demand match_both_required not_selected compat_any_variety compat_strict_label compat_strict_body compat_soft compat_old_title compat_old_body compat_yesterday_title compat_yesterday_body btn_confirm toast_confirmed confirm_navigate_title confirm_navigate_body confirm_navigate_ok confirm_navigate_cancel group_contracts group_quota group_queue label_firm label_remaining label_days_suffix label_pref label_strict demand_label_contract demand_label_quota demand_label_queue demand_label_local variety_pending_warning_title variety_pending_warning_body center_select_draft; do
  grep -rq --include=*.ts --include=*.tsx "assign\.$k" . && echo $k
done > i18n/keep_assign.txt; cat i18n/keep_assign.txt
```

Then run the script, delete `keep_assign.txt`, and `git diff --stat frontend/src/i18n` — three files changed, similar line counts.

- [ ] **Step 11: Verify.** `npx vitest run` → no new failures vs baseline. `npx tsc --noEmit --ignoreDeprecations 5.0` → no new errors from board files (Sheet swap errors are fixed in Task 8). Then look at it: start the dev servers the usual way (backend `runserver`, frontend `npm run dev`) — or use the project's `run` skill — log in as `export_manager`, open `/export/assign`: supply plans left, destination plans right in two groups, picking a pair shows the right button. **Do not click Join/Detach/Swap on the shared live DB** during working hours (browser tests write to it; see memory "E2E Tests After Hours") — use a local DB or agree the footprint with the user.

- [ ] **Step 12: Commit 3 (after "commit").**

```bash
git status
git add frontend/src/components/sheet/joinHelpers.ts frontend/src/components/sheet/joinHelpers.test.ts frontend/src/components/sheet/JoinActionBar.tsx frontend/src/components/shipment/ShipmentDetailHero.tsx frontend/src/components/shipment/ShipmentDetailHero.test.tsx frontend/src/components/shipment/blockSourceGroups.ts frontend/src/hooks/useDrafts.ts frontend/src/types/index.ts frontend/src/pages/export/AssignmentBoard.tsx frontend/src/pages/export/assignment/boardHelpers.ts frontend/src/pages/export/assignment/boardHelpers.test.ts frontend/src/pages/export/assignment/BoardColumn.tsx frontend/src/pages/export/assignment/ExportPartCard.tsx frontend/src/pages/export/assignment/PackingActionPanel.tsx frontend/src/pages/export/assignment/assignmentHelpers.ts frontend/src/i18n/tk.json frontend/src/i18n/ru.json frontend/src/i18n/en.json
git rm frontend/src/pages/export/assignment/DemandCard.tsx frontend/src/pages/export/assignment/MatchPanel.tsx frontend/src/mock/demand.ts
git diff --cached --stat
git commit -m "$(cat <<'EOF'
feat(frontend): Assignment board joins, detaches and swaps packing

Left: free supply plans. Right: destination plans before loading, split into
waiting for supply and supply joined, with truck and driver when set. The
centre offers the one action the picked cards allow. Mock demand removed.
The shared join helpers now accept a destination plan in customs, so the
Sheet Join bar and the detail page's Join supply follow the backend.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

Then `- [ ] 2026-09-29 — Assignment board: join / detach / swap packing, mock demand removed — NEEDS TEST` at the top of `BUILD_TEST_LOG.md`.

---

### Task 8: Sheet — Swap is packing only, Join until loading (commit 4)

**Files:**
- Rewrite: `frontend/src/components/sheet/SwapActionBar.tsx`
- Delete: `frontend/src/components/sheet/SwapFieldsModal.tsx`, `frontend/src/components/sheet/swapFieldGroups.ts`
- Modify: `frontend/src/hooks/useDrafts.ts` (delete `useSwapShipments`)
- Modify: `frontend/src/components/sheet/SheetToolbar.tsx` (~line 169-174)
- Modify: `frontend/src/i18n/{tk,ru,en}.json` (`sheet.swap`, `sheet.swap_bar`, `sheet.join_bar.only_drafts`)

**Interfaces:**
- Consumes: `explainSwapBlockers`, `canUserJoin` (Task 6); `useSwapPackaging` (Task 6); `packing.*` i18n keys (Task 7); `extractPatchError`.

- [ ] **Step 1: Rewrite `SwapActionBar.tsx`.**

```tsx
import { Button, Modal, Typography } from 'antd';
import { SwapOutlined, WarningOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useSheetStore } from '@/stores/sheetStore';
import { useSwapPackaging } from '@/hooks/useDrafts';
import { extractPatchError } from '@/hooks/useShipmentPatch';
import { explainSwapBlockers } from './joinHelpers';
import { FONT } from '@/constants/styles';
import type { IShipmentSheetItem } from '@/types';

const { Text } = Typography;

interface ISwapActionBarProps {
  shipments: IShipmentSheetItem[];
}

/** Sheet Swap (spec 2026-09-29): two columns exchange their packing, nothing else. */
export function SwapActionBar({ shipments }: ISwapActionBarProps) {
  const { t } = useTranslation();
  const swapSelection = useSheetStore((s) => s.swapSelection);
  const setSwapMode = useSheetStore((s) => s.setSwapMode);
  const swapMutation = useSwapPackaging();

  const selected = swapSelection
    .map((id) => shipments.find((s) => s.id === id))
    .filter((s): s is IShipmentSheetItem => s !== undefined);
  const blockers = selected.length === 0 ? [] : explainSwapBlockers(selected);
  const canSwap = selected.length === 2 && blockers.length === 0;

  function handleSwap() {
    if (!canSwap) return;
    const [a, b] = selected;
    Modal.confirm({
      title: t('packing.confirm_swap_title'),
      content: t('packing.confirm_swap_body', { a: a.shipment_code, b: b.shipment_code }),
      okText: t('packing.confirm_ok'),
      cancelText: t('packing.confirm_cancel'),
      onOk: () => swapMutation.mutate(
        { aId: a.id, otherId: b.id },
        {
          onSuccess: () => { toast.success(t('packing.toast_swapped')); setSwapMode(false); },
          onError: (err) => toast.error(extractPatchError(err, t('packing.toast_error'))),
        },
      ),
    });
  }

  return (
    <div className="sheet-join-bar" style={{ background: '#fff7ed', borderBottomColor: '#fed7aa' }}>
      <SwapOutlined style={{ color: '#ea580c', fontSize: 14, flexShrink: 0 }} />
      <Text style={{ fontSize: 12, flexShrink: 0 }}>{t('sheet.swap_bar.instruction')}</Text>

      {canSwap && (
        <div className="sheet-join-bar__preview">
          {selected.map((s, i) => (
            <span key={s.id} style={{ display: 'contents' }}>
              {i === 1 && <span style={{ color: '#ea580c', fontSize: 14 }}>⇄</span>}
              <div className="sheet-join-bar__preview-chip" style={{ background: '#fff7ed', border: '1px solid #fdba74' }}>
                <span style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: 11 }}>{s.shipment_code}</span>
                <span style={{ fontSize: 11, color: '#475467' }}>
                  {s.block_sources.map((b) => b.block_code).join(', ')}
                </span>
              </div>
            </span>
          ))}
        </div>
      )}

      {blockers.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', minWidth: 0 }}>
          {blockers.map((b) => (
            <Text key={`${b.key}:${b.code ?? ''}`} type="warning" style={{ fontSize: 12 }}>
              <WarningOutlined style={{ marginRight: 4 }} />
              {t(`join_blockers.${b.key}`, { code: b.code })}
            </Text>
          ))}
        </div>
      )}

      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexShrink: 0 }}>
        <Button size="small" onClick={() => setSwapMode(false)}>{t('sheet.swap_bar.cancel')}</Button>
        <Button
          size="small"
          type="primary"
          disabled={!canSwap}
          loading={swapMutation.isPending}
          icon={<SwapOutlined />}
          onClick={handleSwap}
          style={canSwap ? { background: '#ea580c', borderColor: '#ea580c' } : undefined}
        >
          {t('packing.btn_swap')}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Gate the Swap button like Join.** In `SheetToolbar.tsx`, replace the `// Swap: mirrors the backend gate, which is shipment.can_edit (F19). ...` comment and `const canSwap = canDo(user, 'shipment', 'edit') && !isReadOnly;` with:

```tsx
  // Swap exchanges packing only (spec 2026-09-29) and the backend gates it on
  // JOIN_ROLES, exactly like Join.
  const canSwap = canUserJoin(user) && !isReadOnly;
```

If `canDo` is now unused in the file, remove its import.

- [ ] **Step 3: Delete the field Swap UI.** Delete `SwapFieldsModal.tsx` and `swapFieldGroups.ts`, and in `hooks/useDrafts.ts` delete the `useSwapShipments` section with `ISwapShipmentsResponse` and `ISwapShipmentsArgs`. `grep -rn "SwapFieldsModal\|swapFieldGroups\|SWAPPABLE_FIELD_KEYS\|useSwapShipments\|swappable-fields" frontend/src` → nothing. Remove any `sheet.swap_modal.*` / `swap_fields.*` i18n namespace those files used: find the namespace with `grep -o "t('[a-z_.]*" SwapFieldsModal.tsx` BEFORE deleting, and drop exactly those keys from all three JSON files if nothing else uses them.

- [ ] **Step 4: Sheet translations.** Same round-trip check, then a script like Task 7's with:

```python
SET = {
    ('sheet', 'swap', 'tooltip'): {'tk': 'Iki sütüniň üpjünçiligini çalyş', 'ru': 'Поменять упаковку двух колонок',
                                   'en': 'Swap the supply of two columns'},
    ('sheet', 'swap_bar', 'instruction'): {'tk': 'Üpjünçiligini çalyşmak üçin iki sütüne basyň',
                                           'ru': 'Нажмите на две колонки, чтобы поменять упаковку',
                                           'en': 'Click two columns to swap their supply'},
    ('sheet', 'join_bar', 'only_drafts'): {'tk': 'Diňe ýüklemä çenli birleşdirip bolýar',
                                           'ru': 'Присоединять можно только до начала погрузки',
                                           'en': 'Supply can be joined only before loading starts'},
}
DROP = [('sheet', 'swap_bar', 'swap'), ('sheet', 'swap_bar', 'need_pair')]
```

(the `join_blockers` keys already landed in Task 7; set each path in all three files; pop each `DROP` path after confirming with `grep -rn "swap_bar.swap'\|swap_bar.need_pair" frontend/src --include=*.tsx --include=*.ts` that nothing uses it — the new `SwapActionBar` uses `packing.btn_swap` and `join_blockers.*` instead). Check `sheet.join_bar.only_drafts` is still referenced somewhere (`grep -rn "only_drafts" frontend/src --include=*.tsx`); if not, drop it instead of rewording.

- [ ] **Step 5: Verify.** `npx vitest run` → no new failures vs baseline. `npx tsc --noEmit --ignoreDeprecations 5.0` → no new errors. `npm run lint` on the touched files if the baseline lint is clean.

- [ ] **Step 6: Commit 4 (after "commit").**

```bash
git status
git add frontend/src/components/sheet/SwapActionBar.tsx frontend/src/components/sheet/SheetToolbar.tsx frontend/src/hooks/useDrafts.ts frontend/src/i18n/tk.json frontend/src/i18n/ru.json frontend/src/i18n/en.json
git rm frontend/src/components/sheet/SwapFieldsModal.tsx frontend/src/components/sheet/swapFieldGroups.ts
git diff --cached --stat
git commit -m "$(cat <<'EOF'
feat(frontend): Sheet Swap exchanges packing only; Join works until loading

Swap no longer picks fields: two columns exchange their supply through
/swap-packaging/, gated on the join roles. The Join bar accepts a
destination plan in customs, not only in Preparation.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

Then `- [ ] 2026-09-29 — Sheet: Swap = packing only, Join until loading — NEEDS TEST` at the top of `BUILD_TEST_LOG.md`.

---

### Task 9: Docs (docs commit)

**Files:** `docs/obsidian/processes/assignment-board.md`, `docs/obsidian/processes/draft-shipments.md`, every other `docs/obsidian/` hit below, `.claude/skills/api-contract/SKILL.md`, `CHANGELOG.md`, `DECISIONS.md`, `docs/SHIPMENT_THREE_PARTS_RU.md`, `BUILD_TEST_LOG.md`.

- [ ] **Step 1: Check the shared docs are free.** `git status docs/obsidian`. If `assignment-board.md` or `draft-shipments.md` still show as modified and you did not modify them, another session owns uncommitted edits there — **stop and ask the user** before touching them.

- [ ] **Step 2: `assignment-board.md`.** Rewrite "What Is This Process?", "Layout", "Compatibility Rules", "Confirm Flow", "Demand Data Sources", "Files", "Permissions" for the new board: three columns (supply plans / action / destination plans before loading in two groups), the three actions and their endpoints (`/join/`, `/unjoin/`, `/swap-packaging/`), the weight rule, the pallet and loading limits, the QR reprint reminder, roles (`JOIN_ROLES` incl. the loading department; page `export.assign` granted to it by core migration 0066), data (`?status_code__in=`). Link the spec. Keep the Navigation line the other session wrote.

- [ ] **Step 3: Other Obsidian notes.** `grep -rln "joined first\|join guard\|Two-row\|two-row\|/swap/\|swappable\|SwapFieldsModal\|cannot leave draft\|must be joined" docs/obsidian` and update each hit: leaving Preparation needs only country + customer; loading needs packing; Swap = packing only. In `draft-shipments.md` add a short "Late join, detach, swap (2026-09-29)" section.

- [ ] **Step 4: `api-contract` skill.** In `.claude/skills/api-contract/SKILL.md` add contracts for `POST /shipments/{id}/join/` (target statuses), `POST /shipments/{id}/unjoin/` (response adds `new_supply_id`, `new_supply_code`), `POST /shipments/{id}/swap-packaging/` (`{other_id}` → `{shipments: [a, b]}`), and `?status_code__in=` on the list (draft shape + `country`, `customer`); remove `/swap/` and `/swappable-fields/`.

- [ ] **Step 5: CHANGELOG, DECISIONS, three-parts note.**
  - `CHANGELOG.md` `[Unreleased]`: **Added** — Assignment board joins / detaches / swaps packing; `/unjoin/`, `/swap-packaging/`, `?status_code__in=`. **Changed** — Preparation exit needs only country + customer; loading needs packing; Join works until loading; late join fills only an empty net weight; loading department may join. **Removed** — field-picking Sheet Swap (`/swap/`, `/swappable-fields/`), mock demand on the board.
  - `DECISIONS.md`: one entry dated 2026-09-29 — packing moves between shipment rows (move model, not a link); barrier moved to loading; weights frozen after documents start except an empty net; Sheet Swap narrowed to packing. Link the spec.
  - `docs/SHIPMENT_THREE_PARTS_RU.md` §6: mark (b) «сделано 2026-09-29, спек …» and §4.1/§4.2 as resolved by it.

- [ ] **Step 6: Commit (after "commit").**

```bash
git status
git add docs/obsidian/processes/assignment-board.md docs/obsidian/processes/draft-shipments.md <other obsidian files from Step 3> .claude/skills/api-contract/SKILL.md CHANGELOG.md DECISIONS.md docs/SHIPMENT_THREE_PARTS_RU.md BUILD_TEST_LOG.md
git diff --cached --stat
git commit -m "$(cat <<'EOF'
docs: packing join, detach and swap — board, API contract, decisions

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Tell the user, plainly:** which commits landed, which backend/frontend suites ran and their result vs baseline, the pre-deploy cascade count from Task 1 Step 10, that core migration 0066 must run on beta, and "Built — NOT tested yet. Did you test it?"
