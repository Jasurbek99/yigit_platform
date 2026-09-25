# Gapy-Satyş Terminal Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Gapy-Satyş shipment completes its lifecycle the moment it leaves the greenhouse (`departed_at`), instead of jamming forever in `yola_chykdy` waiting for a border crossing that never happens.

**Architecture:** Add a predicate fork to `TRANSITIONS['yuklenme']` so `is_gapy_satys=True` routes to the existing terminal status `tamamlandy` while everything else keeps going to `yola_chykdy`. Make `allowed_transitions` predicate-aware so the UI offers one branch, not both. Mark the six post-departure Sheet rows `gapy_hidden`. No new status, no migration, no new task rule.

**Tech Stack:** Django 5 / DRF, MSSQL (`django-mssql-backend`), `manage.py test` (Django TestCase), React 18 + TypeScript on the frontend (read-only for this plan — it consumes the row map from the API).

**Spec:** `docs/superpowers/specs/2026-09-23-gapy-satys-terminal-design.md`

## Global Constraints

- **MSSQL**: no `JSONField`, no `ArrayField`, no `DISTINCT ON`, `bulk_create`/`bulk_update` always `batch_size=500`. This plan adds no model fields and no migration, so the constraint binds only if a task tempts you to add one — it should not.
- **Status transitions**: ALWAYS through `transition_to()` — never a direct `status_id` update. Tests assert on status *after* a `save()`, never by assigning status themselves.
- **AD-1**: denormalized timestamps on a shipment are written ONLY by `transition_to()`. `STATUS_TIMESTAMP_MAP` is empty in v2, so `tamamlandy` writes none. Do not add one.
- **No Django signals.** Auto-advance is called explicitly from `Shipment.save()` (`backend/apps/export/models/shipment.py:437`).
- **Dependency direction**: `core ← greenhouse ← export ← contracts ← finance`. Everything here is inside `export`; do not import `contracts` from it.
- **Never commit without the user typing the word "commit".** Every task below ends with a commit step that shows the exact command — **write the command, do not run it** until the user says so. "Done" / "ready" / "finished" are not commit instructions.
- **One commit = one logical unit.** Four tasks = four commits, never bundled.
- **Co-author line** on any commit: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Test DB collision**: two concurrent `manage.py test` runs share `test_YIGIT_PLATFROM` and deadlock. If a run hangs, that is why — do not conclude the code is broken.
- **Known baseline**: the suite has 71 pre-existing failures in 4 buckets. The bar is **no new failures**, not "all green". Report pass/fail by test-class name.

## Review Focus

Five failure modes the spec implies that no task's happy-path test would catch. Each has a test assigned to the task that owns the code.

1. **Edge ordering puts `cancelled` first** → `_resolve_next_status()` returns the first edge whose predicate is `None`, so every gapy save from `yuklenme` would silently cancel the shipment. → Task 1, Step 1, `test_gapy_does_not_cancel_on_departure`.
2. **Manual `/transition/` still offers the wrong branch** → `transition_to()` is deliberately NOT predicate-aware; a privileged role can still push a gapy truck to `yola_chykdy`. Pin it so the looseness is a decision, not a regression. → Task 2, Step 1, `test_manual_transition_is_still_permissive`.
3. **`is_gapy_satys` flipped True after departure** → a shipment already in `serhet_gechdi` must not crash, must not retro-complete, must keep walking the export chain. → Task 1, Step 1, `test_late_flag_flip_does_not_retro_complete`.
4. **`departed_at` filled while loading data is incomplete** → the `fill_loading_data` gate (`shipment_code, block_sources, variety, weight_net`) still applies to gapy; a half-filled gapy truck must stay in `yuklenme`. → Task 1, Step 1, `test_gapy_stays_when_loading_data_incomplete`.
5. **A further save on a completed gapy shipment** → `TRANSITIONS['tamamlandy']` is `[]`; a subsequent `save()` must not raise and must not move the shipment. → Task 1, Step 1, `test_completed_gapy_stays_completed_on_resave`.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `backend/apps/export/services/shipment.py` | The state machine. `TRANSITIONS['yuklenme']` gains the gapy fork. | Modify (~line 87) |
| `backend/apps/export/services/__init__.py` | Package re-exports. `_edge_predicate` must be exported for the serializer to import it. | Modify (~lines 14, 75) |
| `backend/apps/export/serializers.py` | `ShipmentDetailSerializer.get_allowed_transitions()` becomes predicate-aware. | Modify (line 1507) |
| `backend/apps/export/sheet_rows.py` | Six post-departure rows gain `gapy_hidden: True`. | Modify (rows 33, 34, 35, 41, 42, 43) |
| `backend/apps/export/tests_gapy_terminal.py` | All new tests for this feature, in one file. | Create |
| `docs/obsidian/processes/shipment-lifecycle.md` | Step table, mermaid chart, gapy note. | Modify |
| `docs/obsidian/screens/shipment-sheet.md` | The newly hidden rows. | Modify |
| `docs/ADR.md` | Decision record + rejected alternative. | Modify |
| `CHANGELOG.md`, `BUILD_TEST_LOG.md` | Standard project bookkeeping. | Modify |

No frontend change. `SheetCell.tsx:214` already reads `rowConfig.gapy_hidden` from the **API** row map (`sheet_rows.py`), not from `frontend/src/constants/sheetRowConfig.ts` — that TS file now only supplies layout constants (`scaleSheetLayout`, `ROW_HEIGHT`). Its module docstring in `sheet_rows.py` still claims the frontend is "the source of truth"; that sentence is stale. Leave it, or fix it in Task 4's docs commit — do not restructure either file.

---

### Task 1: Fork `yuklenme` on `is_gapy_satys`

**Files:**
- Create: `backend/apps/export/tests_gapy_terminal.py`
- Modify: `backend/apps/export/services/shipment.py:87-88`

**Interfaces:**
- Consumes: `TRANSITIONS` (dict, `str → list[tuple]`), `_resolve_next_status(shipment, current_code) -> str | None`, `auto_advance_if_ready(shipment, resolved_tasks) -> bool` — all existing in `services/shipment.py`.
- Produces: `TRANSITIONS['yuklenme']` becomes a 3-edge list of 3-tuples `(to_code: str, roles: list[str], predicate: Callable[[Shipment], bool])` plus the plain 2-tuple `('cancelled', list(CANCEL_ROLES))` last. Task 2 relies on those edges carrying predicates.

- [ ] **Step 1: Write the failing tests**

Create `backend/apps/export/tests_gapy_terminal.py`. The shared setup mirrors `tests_auto_advance.py` — copy it rather than importing, because that module's helpers are private to it and a cross-import would couple two test files.

```python
"""Gapy-Satyş ends at greenhouse departure.

A Gapy Satyş shipment is a domestic gate sale: the buyer takes the goods at
the greenhouse. No border, no destination customs, no arrival, no foreign
sales report. So `yuklenme` + `departed_at` completes it outright instead of
sending it to `yola_chykdy`, where it would jam forever — `border_crossed_at`
(R30) is gapy_hidden, so nobody can fill the trigger that leaves that step.

Run:
    python manage.py test apps.export.tests_gapy_terminal --keepdb
"""
import datetime

from django.test import TestCase
from django.utils import timezone

from apps.core.models import (
    GreenhouseBlock,
    Season,
    ShipmentStatusType,
    TomatoVariety,
    User,
)
from apps.export.management.commands.seed_task_rules import (
    Command as SeedTaskRulesCommand,
)
from apps.export.models import Shipment, ShipmentBlockSource, ShipmentStatusLog


V2_STATUSES = [
    ('draft',           0,  'DRAFT'),
    ('gumruk_girish',   1,  'CUSTOMS'),
    ('gumruk_chykysh',  2,  'CUSTOMS'),
    ('yuklenme',        3,  'LOADING'),
    ('yola_chykdy',     4,  'TRANSIT'),
    ('serhet_gechdi',   5,  'BORDER'),
    ('dest_entry',      6,  'BORDER'),
    ('barysh_gumrugi',  7,  'BORDER'),
    ('transshipment',   8,  'SALES'),
    ('bardy',           9,  'SALES'),
    ('satylyar',       10,  'SALES'),
    ('satyldy',        11,  'SALES'),
    ('tamamlandy',     12,  'COMPLETE'),
]


def _ensure_statuses():
    for code, order, phase in V2_STATUSES:
        ShipmentStatusType.objects.get_or_create(
            code=code,
            defaults={
                'name_tk': code, 'name_en': code, 'name_ru': code,
                'step_order': order, 'phase': phase,
            },
        )


def _make_season() -> Season:
    season, _ = Season.objects.get_or_create(
        name='2025-2026',
        defaults={
            'start_date': '2025-09-01',
            'end_date': '2026-06-30',
            'is_active': True,
        },
    )
    return season


class GapyTerminalTests(TestCase):
    """yuklenme + departed_at completes a gapy shipment, not a normal one."""

    @classmethod
    def setUpTestData(cls):
        _ensure_statuses()
        SeedTaskRulesCommand().handle(reset=False)
        cls.user = User.objects.create_user(
            username='gapy_doc', password='pw', role='document_team',
        )
        cls.season = _make_season()
        cls.block, _ = GreenhouseBlock.objects.get_or_create(code='A')
        cls.variety, _ = TomatoVariety.objects.get_or_create(name='Tomimaru')

    def _make_loaded(self, *, is_gapy: bool, code: str,
                     with_loading_data: bool = True) -> Shipment:
        """A shipment sitting in `yuklenme` with the loading gate satisfied.

        `fill_loading_data` requires shipment_code + block_sources + variety +
        weight_net (ALL_FIELDS_FILLED). With those present, filling
        departed_at is the only thing left, so the save triggers the advance.
        """
        status = ShipmentStatusType.objects.get(code='yuklenme')
        shipment = Shipment.objects.create(
            shipment_code=code,
            date=datetime.date(2026, 1, 1),
            season=self.season,
            status=status,
            is_gapy_satys=is_gapy,
            created_by=self.user,
            updated_by=self.user,
        )
        if with_loading_data:
            ShipmentBlockSource.objects.create(
                shipment=shipment, block=self.block, weight_kg=18000,
            )
            shipment.variety = self.variety
            shipment.weight_net = 18000
            shipment.save()
        from apps.export.services.task_rules import generate_tasks_for_status
        generate_tasks_for_status(shipment, 'yuklenme')
        return shipment

    def test_gapy_completes_on_departure(self):
        shipment = self._make_loaded(is_gapy=True, code='GAPY-001/26')
        shipment.departed_at = timezone.now()
        shipment.save()

        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'tamamlandy')

    def test_non_gapy_still_departs(self):
        shipment = self._make_loaded(is_gapy=False, code='NORM-001/26')
        shipment.departed_at = timezone.now()
        shipment.save()

        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'yola_chykdy')

    def test_gapy_completion_is_one_audited_hop(self):
        """No intermediate statuses are walked, and the hop is flagged auto."""
        shipment = self._make_loaded(is_gapy=True, code='GAPY-002/26')
        shipment.departed_at = timezone.now()
        shipment.save()

        logs = list(
            ShipmentStatusLog.objects.filter(shipment=shipment)
            .order_by('changed_at')
        )
        self.assertEqual([lg.status.code for lg in logs], ['tamamlandy'])
        self.assertTrue(all(lg.is_auto for lg in logs))

    def test_gapy_does_not_cancel_on_departure(self):
        """Review Focus 1 — edge ordering.

        `_resolve_next_status` returns the first edge whose predicate is None.
        The `cancelled` edge carries no predicate, so if it is ordered before
        the two forked edges every gapy departure silently cancels the truck.
        """
        shipment = self._make_loaded(is_gapy=True, code='GAPY-003/26')
        shipment.departed_at = timezone.now()
        shipment.save()

        shipment.refresh_from_db()
        self.assertNotEqual(shipment.status.code, 'cancelled')

    def test_gapy_stays_when_loading_data_incomplete(self):
        """Review Focus 4 — the yuklenme gate still applies to gapy."""
        shipment = self._make_loaded(
            is_gapy=True, code='GAPY-004/26', with_loading_data=False,
        )
        shipment.departed_at = timezone.now()
        shipment.save()

        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'yuklenme')

    def test_completed_gapy_stays_completed_on_resave(self):
        """Review Focus 5 — TRANSITIONS['tamamlandy'] is []."""
        shipment = self._make_loaded(is_gapy=True, code='GAPY-005/26')
        shipment.departed_at = timezone.now()
        shipment.save()
        shipment.refresh_from_db()

        shipment.additional_notes_arap = 'touched again'
        shipment.save()  # must not raise, must not move

        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'tamamlandy')

    def test_late_flag_flip_does_not_retro_complete(self):
        """Review Focus 3 — flipping the flag mid-flight is accepted, unguarded.

        A shipment already past yuklenme keeps walking the export chain. It
        does not retroactively complete and it does not crash. This pins the
        documented decision, not a desirable behaviour.
        """
        status = ShipmentStatusType.objects.get(code='serhet_gechdi')
        shipment = Shipment.objects.create(
            shipment_code='GAPY-LATE/26',
            date=datetime.date(2026, 1, 1),
            season=self.season,
            status=status,
            is_gapy_satys=False,
            created_by=self.user,
            updated_by=self.user,
        )
        shipment.is_gapy_satys = True
        shipment.save()

        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'serhet_gechdi')
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && python manage.py test apps.export.tests_gapy_terminal --keepdb -v 2`

Expected: `test_gapy_completes_on_departure` and `test_gapy_completion_is_one_audited_hop` FAIL with the status being `yola_chykdy` instead of `tamamlandy`. The other five should already pass — they pin behaviour that must *survive* the change. If any of those five fails now, stop and report it: it means the baseline is not what this plan assumes.

- [ ] **Step 3: Add the fork**

In `backend/apps/export/services/shipment.py`, replace the `'yuklenme'` entry:

```python
    # Conditional fork: a Gapy-Satyş shipment is a domestic gate sale — the
    # buyer takes the goods at the greenhouse. There is no road, no border, no
    # destination and no foreign sales report, so it is complete the moment it
    # leaves. Sending it to yola_chykdy jammed it there permanently: that
    # step's trigger is border_crossed_at (R30), which is gapy_hidden, so no
    # operator could ever fill it.
    #
    # Edge order is load-bearing. _resolve_next_status() returns the first edge
    # whose predicate is True OR which carries no predicate at all — so
    # 'cancelled' must stay last, exactly as in the barysh_gumrugi fork below,
    # or every auto-advance out of yuklenme would cancel the shipment.
    'yuklenme': [
        ('tamamlandy',  ['document_team'],
         lambda s: bool(getattr(s, 'is_gapy_satys', False))),
        ('yola_chykdy', ['document_team'],
         lambda s: not bool(getattr(s, 'is_gapy_satys', False))),
        ('cancelled',   list(CANCEL_ROLES)),
    ],
```

The edge role is `document_team` on both branches: the same person who closes loading closes a gapy truck.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && python manage.py test apps.export.tests_gapy_terminal --keepdb -v 2`
Expected: 7 tests, all PASS.

- [ ] **Step 5: Run the neighbouring suites for regressions**

Run: `cd backend && python manage.py test apps.export.tests_auto_advance apps.export.tests_cancel apps.export.tests_draft_promote apps.export.tests_boss_transitions --keepdb -v 2`

Expected: no *new* failures against the known baseline. `CascadeTests.test_cascades_when_multiple_triggers_satisfied` is the one to watch — it drives a non-gapy shipment to `yuklenme` and asserts it stops there. It must still pass unchanged; if it now reports `tamamlandy`, the predicate is inverted.

- [ ] **Step 6: Stage the commit — DO NOT RUN until the user says "commit"**

```bash
git add backend/apps/export/services/shipment.py backend/apps/export/tests_gapy_terminal.py
git commit -m "$(cat <<'EOF'
feat(p3): complete Gapy-Satyş shipments at greenhouse departure

A gapy truck is a domestic gate sale — no border, no destination, no
foreign sales report. It was walked down the full export chain and jammed
in yola_chykdy, whose trigger (border_crossed_at, R30) is gapy_hidden and
therefore unfillable. yuklenme now forks on is_gapy_satys straight to the
terminal status.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Make `allowed_transitions` predicate-aware

**Files:**
- Modify: `backend/apps/export/services/__init__.py:14` and `:75`
- Modify: `backend/apps/export/serializers.py:1507-1515`
- Modify: `backend/apps/export/tests_gapy_terminal.py` (append a second test class)

**Interfaces:**
- Consumes: `TRANSITIONS['yuklenme']` from Task 1; `_edge_predicate(edge) -> Callable | None` (exists at `services/shipment.py:156`, currently NOT re-exported from the package).
- Produces: `ShipmentDetailSerializer.get_allowed_transitions(obj) -> list[str]` now returns only the branch matching the shipment, and `apps.export.services._edge_predicate` becomes importable.

Why this is in scope rather than unrelated refactoring: today the method maps `_edge_to` over every edge and filters only `cancelled`, ignoring predicates. It therefore already over-reports — a `barysh_gumrugi` shipment is offered **both** `transshipment` and `bardy`. Left alone, Task 1 would make a gapy shipment at `yuklenme` offer `tamamlandy` **and** `yola_chykdy`, i.e. the UI would still hand the operator the dead end this work exists to remove. Same defect, fixed once.

- [ ] **Step 1: Write the failing tests**

Append to `backend/apps/export/tests_gapy_terminal.py`:

```python
class AllowedTransitionsPredicateTests(TestCase):
    """The UI is offered one branch of a fork, not both."""

    @classmethod
    def setUpTestData(cls):
        _ensure_statuses()
        cls.user = User.objects.create_user(
            username='gapy_mgr', password='pw', role='export_manager',
        )
        cls.season = _make_season()

    def _at(self, code: str, **kwargs) -> Shipment:
        return Shipment.objects.create(
            shipment_code=f'ALT-{code[:6]}-{kwargs.get("suffix", "0")}',
            date=datetime.date(2026, 1, 1),
            season=self.season,
            status=ShipmentStatusType.objects.get(code=code),
            is_gapy_satys=kwargs.get('is_gapy_satys', False),
            has_peregruz=kwargs.get('has_peregruz', False),
            created_by=self.user,
            updated_by=self.user,
        )

    def _transitions(self, shipment: Shipment) -> list[str]:
        from apps.export.serializers import ShipmentDetailSerializer
        return ShipmentDetailSerializer(shipment).data['allowed_transitions']

    def test_gapy_at_loading_offers_only_completion(self):
        shipment = self._at('yuklenme', is_gapy_satys=True, suffix='g')
        self.assertEqual(self._transitions(shipment), ['tamamlandy'])

    def test_normal_at_loading_offers_only_departure(self):
        shipment = self._at('yuklenme', is_gapy_satys=False, suffix='n')
        self.assertEqual(self._transitions(shipment), ['yola_chykdy'])

    def test_peregruz_fork_offers_one_branch(self):
        """Pre-existing over-report, fixed by the same change."""
        with_p = self._at('barysh_gumrugi', has_peregruz=True, suffix='p')
        without_p = self._at('barysh_gumrugi', has_peregruz=False, suffix='q')
        self.assertEqual(self._transitions(with_p), ['transshipment'])
        self.assertEqual(self._transitions(without_p), ['bardy'])

    def test_completed_shipment_has_no_transitions(self):
        """TRANSITIONS['tamamlandy'] is an explicit []: no outgoing edge at
        all, not even cancelled."""
        shipment = self._at('tamamlandy', suffix='t')
        self.assertEqual(self._transitions(shipment), [])

    def test_manual_transition_is_still_permissive(self):
        """Review Focus 2 — transition_to() is deliberately NOT made
        predicate-aware. A privileged role may still drive either branch of a
        fork explicitly; only the offered list is narrowed. Tightening this
        would silently change has_peregruz semantics, so it is pinned.
        """
        from apps.export.services import transition_to
        shipment = self._at('barysh_gumrugi', has_peregruz=False, suffix='m')
        transition_to(shipment, 'transshipment', user=self.user)

        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'transshipment')
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && python manage.py test apps.export.tests_gapy_terminal.AllowedTransitionsPredicateTests --keepdb -v 2`

Expected: the first three FAIL — each returns both branches, e.g. `['tamamlandy', 'yola_chykdy']` instead of `['tamamlandy']`. `test_completed_shipment_has_no_transitions` and `test_manual_transition_is_still_permissive` should already pass.

- [ ] **Step 3: Export `_edge_predicate` from the services package**

In `backend/apps/export/services/__init__.py`, add `_edge_predicate` to both the `from .shipment import (...)` block (next to `_edge_to`, line 14) and to `__all__` (next to `'_edge_to'`, line 75):

```python
from .shipment import (
    STATUS_TIMESTAMP_MAP,
    TRANSITIONS,
    PRIVILEGED_ROLES,
    STATUS_NOTIFY_ROLES,
    _edge_to,
    _edge_predicate,
    ...
```

```python
__all__ = [
    ...
    '_edge_to',
    '_edge_predicate',
    ...
```

- [ ] **Step 4: Make the serializer honour predicates**

In `backend/apps/export/serializers.py`, extend the import on line 14 and rewrite the method body at line 1507:

```python
from apps.export.services import TRANSITIONS, _edge_to, _edge_predicate
```

```python
    def get_allowed_transitions(self, obj: Shipment) -> list[str]:
        """Forward statuses this shipment may move to, cancellation excluded.

        Conditional edges carry a predicate (yuklenme forks on is_gapy_satys,
        barysh_gumrugi on has_peregruz). Only the matching branch is offered —
        otherwise the UI hands the operator a target the shipment can never
        satisfy, which is exactly how gapy trucks used to be steered into
        yola_chykdy and stranded there.
        """
        if obj.status is None:
            return []
        current_code = obj.status.code
        out: list[str] = []
        for edge in TRANSITIONS.get(current_code, []):
            if _edge_to(edge) == 'cancelled':
                continue
            predicate = _edge_predicate(edge)
            if predicate is not None and not predicate(obj):
                continue
            out.append(_edge_to(edge))
        return out
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && python manage.py test apps.export.tests_gapy_terminal --keepdb -v 2`
Expected: 12 tests (7 from Task 1 + 5), all PASS.

- [ ] **Step 6: Re-run `tests_cancel` specifically**

Run: `cd backend && python manage.py test apps.export.tests_cancel --keepdb -v 2`

Expected: still passing, unchanged. In particular `BaryshGumrugiAllowedTransitionsRegressionTest.test_barysh_gumrugi_allowed_transitions_does_not_raise` asserts only `isinstance(list)`, `'cancelled' not in`, and `len >= 1` — a narrowed `['bardy']` satisfies all three, so **no edit to that test is needed**. If you find yourself editing it, you have changed something this plan did not intend.

- [ ] **Step 7: Stage the commit — DO NOT RUN until the user says "commit"**

```bash
git add backend/apps/export/services/__init__.py backend/apps/export/serializers.py backend/apps/export/tests_gapy_terminal.py
git commit -m "$(cat <<'EOF'
fix(p3): offer one branch of a conditional transition, not both

get_allowed_transitions ignored edge predicates, so barysh_gumrugi was
offered transshipment AND bardy regardless of has_peregruz, and a gapy
shipment at yuklenme would have been offered the dead-end yola_chykdy
alongside tamamlandy.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Hide the six post-departure Sheet rows for gapy

**Files:**
- Modify: `backend/apps/export/sheet_rows.py` (entries for rows 33, 34, 35, 41, 42, 43)
- Modify: `backend/apps/export/tests_gapy_terminal.py` (append a third test class)

**Interfaces:**
- Consumes: `DEFAULT_SHEET_ROWS: list[dict]` from `backend/apps/export/sheet_rows.py`.
- Produces: nothing new. Six existing dicts gain the optional key `'gapy_hidden': True`, which `SheetCell.tsx:214` and `SheetGrid.tsx:447` already consume from the API row map.

`gapy_hidden` is **frontend-only**: the cell renders blank and non-editable and keyboard navigation skips it. The backend does not reject a write to a hidden field. That is the pre-existing pattern (R29–R32 work this way today) and this task does not change it.

**Safety check before editing** — the `set_border_point` lesson (`seed_task_rules.py:103-107`): hiding a row is only safe when no auto-resolving `TaskRule` gates a gapy shipment on it, or every gapy draft gets a permanently unresolvable task. None of these six do: every rule that reads them sits on `yuklenme`'s successors (`yola_chykdy` … `satyldy`), and after Task 1 a gapy shipment never enters those steps. Verify rather than trust: `grep -n "arrived_at\|peregruz\|sale_started_at\|sale_ended_at\|sales_report" backend/apps/export/management/commands/seed_task_rules.py` and confirm every hit is on a step at or after `yola_chykdy`.

- [ ] **Step 1: Write the failing test**

Append to `backend/apps/export/tests_gapy_terminal.py`:

```python
class GapyHiddenRowTests(TestCase):
    """Rows describing events after departure are hidden in a gapy column."""

    # Everything after the truck leaves the greenhouse (R21). A gapy sale
    # happened at the gate, so there is no transshipment, no arrival and no
    # foreign sales report to record.
    EXPECTED_HIDDEN_AFTER_DEPARTURE = {
        'has_peregruz',
        'peregruz_date',
        'arrived_at',
        'sale_started_at',
        'sale_ended_at',
        'sales_report_date',
    }
    # Already hidden before this change — the road and destination rows.
    EXPECTED_HIDDEN_ALREADY = {
        'border_point',
        'border_crossed_at',
        'dest_entry_at',
        'customs_entry_at',
    }

    def test_post_departure_rows_are_gapy_hidden(self):
        from apps.export.sheet_rows import DEFAULT_SHEET_ROWS
        hidden = {
            row['field_key'] for row in DEFAULT_SHEET_ROWS
            if row.get('gapy_hidden')
        }
        self.assertEqual(
            hidden,
            self.EXPECTED_HIDDEN_AFTER_DEPARTURE | self.EXPECTED_HIDDEN_ALREADY,
        )

    def test_identity_rows_stay_visible_for_gapy(self):
        """city / country / customer are destination-block fields the draft
        join guard needs even for gapy (customer is 'ÝGT Gapy Satyş'), and
        they sit above departure. Deliberately NOT hidden."""
        from apps.export.sheet_rows import DEFAULT_SHEET_ROWS
        hidden = {
            row['field_key'] for row in DEFAULT_SHEET_ROWS
            if row.get('gapy_hidden')
        }
        for field in ('city', 'country', 'customer', 'departed_at', 'weight_net'):
            self.assertNotIn(field, hidden)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && python manage.py test apps.export.tests_gapy_terminal.GapyHiddenRowTests --keepdb -v 2`
Expected: `test_post_departure_rows_are_gapy_hidden` FAILS — the actual set contains only the four road/destination rows.

- [ ] **Step 3: Add the flag to the six rows**

In `backend/apps/export/sheet_rows.py`, add `'gapy_hidden': True,` as the last key of each of these six dicts. They are already adjacent in pairs, so this is six single-line insertions:

| Row | `field_key` |
|-----|-------------|
| 33 | `has_peregruz` |
| 34 | `peregruz_date` |
| 35 | `arrived_at` |
| 41 | `sale_started_at` |
| 42 | `sale_ended_at` |
| 43 | `sales_report_date` |

Add this comment above the row-33 entry so the next reader knows why the block is hidden:

```python
    # R33–R35 and R41–R43 describe what happens after the truck leaves the
    # greenhouse. A Gapy-Satyş shipment is complete at that moment (see
    # TRANSITIONS['yuklenme']), so these cells are unreachable for it and are
    # hidden rather than left as six cells nobody will ever fill.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && python manage.py test apps.export.tests_gapy_terminal --keepdb -v 2`
Expected: 14 tests, all PASS.

- [ ] **Step 5: Check no Sheet suite depended on the old row map**

Run: `cd backend && python manage.py test apps.export.tests_custom_rows apps.export.tests_cell_color apps.export.tests_completeness --keepdb -v 2`
Expected: no new failures.

- [ ] **Step 6: Stage the commit — DO NOT RUN until the user says "commit"**

```bash
git add backend/apps/export/sheet_rows.py backend/apps/export/tests_gapy_terminal.py
git commit -m "$(cat <<'EOF'
feat(p3): hide post-departure Sheet rows on Gapy-Satyş columns

Transshipment, arrival, sale start/end and sales-report rows describe
events a gate sale never has. Six cells nobody could fill are now hidden,
joining the four road/destination rows already marked gapy_hidden.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Documentation

**Files:**
- Modify: `docs/obsidian/processes/shipment-lifecycle.md`
- Modify: `docs/obsidian/screens/shipment-sheet.md`
- Modify: `docs/ADR.md`
- Modify: `CHANGELOG.md`
- Modify: `BUILD_TEST_LOG.md`

**Interfaces:** none — documentation only. Nothing consumes this task.

This is a required task, not a courtesy: CLAUDE.md makes updating `docs/obsidian/` mandatory whenever a feature, endpoint or model changes.

- [ ] **Step 1: Update the lifecycle doc**

In `docs/obsidian/processes/shipment-lifecycle.md`:

(a) In the step table, change the step-3 row so the fork is visible:

```markdown
| 3 | `yuklenme` | Loading | `document_team` | `shipment_code` + `block_sources` (R8) + `variety` (R38) + `weight_net` (R37), and `departed_at` (R21) | `tamamlandy` if `is_gapy_satys`, else `yola_chykdy` |
```

(b) Add the `yuklenme --> tamamlandy` edge to the mermaid chart near the top of the file.

(c) Add this section immediately after the "Cancellation (the one off-ramp)" section:

```markdown
### Gapy-Satyş ends at loading

A **Gapy Satyş** shipment is a domestic gate sale — the buyer takes the goods at the greenhouse.
It crosses no border, clears no destination customs, arrives nowhere and produces no foreign
sales report. So `yuklenme` forks on `is_gapy_satys`: filling `departed_at` (R21,
"Ýyladyşhanadan çykdy") sends a gapy shipment straight to **`tamamlandy`**, the same terminal
status every other shipment finishes on.

Before this, gapy shipments were walked down the full export chain and **jammed in
`yola_chykdy`**: that step's trigger is `border_crossed_at` (R30), which is `gapy_hidden`, so no
operator could ever fill it. The only way past was a privileged role hand-clicking through
three steps describing events that never happened.

- **No new status.** `is_gapy_satys` already marks these rows; a 14th status would have carried
  no extra information while every kanban phase map, archive query, KPI and i18n file learned
  about it. See [[../../ADR#ADR-025]].
- **Known wart**: `tamamlandy` is labelled "Report received & Completed". A gapy shipment reaches
  it without a sales report, so for gapy rows half that label is untrue. The flag is what
  distinguishes them.
- **Flipping `is_gapy_satys` late** (on a shipment already past `yuklenme`) does **not**
  retro-complete it — accepted operator error, deliberately unguarded. Cancel and re-create.
- Ten Sheet rows are hidden on a gapy column: R29–R32 (road, destination) plus R33–R35 and
  R41–R43 (transshipment, arrival, sale, report).
```

- [ ] **Step 2: Update the Sheet screen doc**

In `docs/obsidian/screens/shipment-sheet.md`, find the passage describing `gapy_hidden` and extend the listed rows from four to ten (R29, R30, R31, R32, R33, R34, R35, R41, R42, R43), noting that the last six were added because a gapy shipment now completes at departure.

- [ ] **Step 3: Add the ADR entry**

Append to `docs/ADR.md`. The file uses `## ADR-NNN` at heading level 2 and the last entry is `ADR-024`, so this is **ADR-025**:

```markdown
## ADR-025: Gapy-Satyş completes at greenhouse departure

**Context**: `Gapy Satyş` is a domestic gate sale. The 13-step chain had zero gapy branching, so
gapy trucks were routed toward a border they never cross. `yola_chykdy`'s auto-advance trigger is
`border_crossed_at` (R30), which is `gapy_hidden` — unfillable — so every gapy shipment that got
that far stopped permanently. This was never decided; it was the absence of a decision.

**Decision**: `TRANSITIONS['yuklenme']` forks on `is_gapy_satys`. Filling `departed_at` completes
a gapy shipment into the existing terminal status `tamamlandy`; everything else still goes to
`yola_chykdy`. `get_allowed_transitions()` was made predicate-aware in the same change so the UI
offers one branch of a fork rather than both (it previously over-reported on `barysh_gumrugi`
too). Six post-departure Sheet rows became `gapy_hidden`.

**Rejected**: a 14th terminal status `gapy_satyldy`. It would carry no information the
`is_gapy_satys` flag does not, while every kanban phase map, archive query, dashboard KPI, status
filter and three i18n files would need updating. Reusing `tamamlandy` (`phase='COMPLETE'`) keeps
archiving, board grouping and every "done" count working untouched.

**Accepted costs**: (1) `tamamlandy` is labelled "Report received & Completed" and a gapy shipment
has no sales report, so the label is half untrue for those rows — if this confuses operators, change
the label, not the status. (2) `_compute_status_avg_seconds` now includes gapy shipments in its
`tamamlandy` population; they contribute real measurements for the four steps they did pass
through, so averages stay honest, the sample simply widens. (3) Flipping `is_gapy_satys` to True on
a shipment already past `yuklenme` leaves it walking the export chain with six blank cells; no
guard was added, because refusing the edit blocks a legitimate draft correction and force-completing
a truck that is demonstrably abroad is worse.

**Migration**: none. Four gapy shipments existed at decision time, all still in `draft`.

**Out of scope**: whether gapy consumes government quota (still the open question recorded in
AD-16's amendment) and where a gate sale's money is recorded.
```

- [ ] **Step 4: Update CHANGELOG and BUILD_TEST_LOG**

In `CHANGELOG.md`, under `[Unreleased]` → `Changed`:

```markdown
- Gapy-Satyş shipments now complete at greenhouse departure (`yuklenme` → `tamamlandy`) instead of jamming in `yola_chykdy`; six post-departure Sheet rows hidden for them (ADR-025)
```

In `CHANGELOG.md`, under `[Unreleased]` → `Fixed`:

```markdown
- `allowed_transitions` no longer offers both branches of a conditional transition (`barysh_gumrugi` reported `transshipment` and `bardy` regardless of `has_peregruz`)
```

At the **top** of `BUILD_TEST_LOG.md`:

```markdown
- [ ] 2026-09-24 — Gapy-Satyş ends at greenhouse departure (yuklenme → tamamlandy fork, predicate-aware allowed_transitions, 6 hidden Sheet rows) — NEEDS TEST
```

- [ ] **Step 5: Stage the commit — DO NOT RUN until the user says "commit"**

```bash
git add docs/obsidian/processes/shipment-lifecycle.md docs/obsidian/screens/shipment-sheet.md docs/ADR.md CHANGELOG.md BUILD_TEST_LOG.md
git commit -m "$(cat <<'EOF'
docs: record Gapy-Satyş terminal decision (ADR-025)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Report honestly**

State which test classes passed by name, and say plainly: **"Built — NOT tested in the real app yet. Did you test it?"** Four commits are staged but NOT run; the user must type "commit".

---

## Verification before claiming done

Run the whole export suite once and compare against the known baseline (71 pre-existing failures, 4 buckets — see the `project_beta_test_suite_failures` note):

```bash
cd backend && python manage.py test apps.export --keepdb -v 1
```

The bar is **no new failures**, not zero failures. If the count moved, name the tests that moved it.

A gapy shipment cannot be driven end-to-end by the test suite alone — the real check is on the Sheet: set Görnüşi (R47) to Gapy Satyş on a draft, walk it to `yuklenme`, fill R21, and confirm the column turns Completed and the six lower rows go blank.
