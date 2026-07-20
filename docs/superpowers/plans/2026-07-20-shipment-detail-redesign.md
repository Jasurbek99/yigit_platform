# Shipment Detail Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/export/shipments/:id` so every field is visible at once, overdue-empty fields are highlighted, and editing is click-to-edit with visible save confirmation.

**Architecture:** The "which field is required at which step" rule set already exists as `TaskRule.target_fields`. A new read-only backend service reads those rules live and returns a `completeness` block on the shipment detail payload. The frontend replaces the accordion with always-expanded stage cards plus a summary bar driven by that block. No new models, no new migrations.

**Tech Stack:** Django 5 + DRF (MSSQL), React 18 + TypeScript + Ant Design, TanStack Query, vitest + @testing-library/react, Django `TestCase`.

**Spec:** [`docs/superpowers/specs/2026-07-20-shipment-detail-redesign-design.md`](../specs/2026-07-20-shipment-detail-redesign-design.md)

## Global Constraints

- **MSSQL**: no `JSONField`, no `ArrayField`, no `DISTINCT ON`, `bulk_create`/`bulk_update` always `batch_size=500`. (The `completeness` block is serializer output, not a DB column — this is fine.)
- **No Django signals.** Cross-app coordination is explicit service calls only.
- **No reverse imports.** `core ← greenhouse ← export ← contracts ← finance`.
- **i18n is mandatory**: every user-visible string must be added to all three of `frontend/src/i18n/tk.json`, `ru.json`, `en.json` in the same commit. Never leave a key in one file only, never use one language as a placeholder for another.
- **Status transitions only through `transition_to()`** — this plan never writes `status_id` directly.
- **Component size**: max 150 lines per React component, max 200 lines per Python file. `ShipmentDetail.tsx` is currently 562 lines and gets split by this plan.
- **Typecheck command is `npx tsc --noEmit --ignoreDeprecations 5.0`** — `npm run type-check` is broken in this repo (TS5103).
- **Do not commit** unless the task's commit step says to. One commit per task.
- **Log every built feature** to `BUILD_TEST_LOG.md` (newest on top, `- [ ] YYYY-MM-DD — <what> — NEEDS TEST`) — see Task 12.

---

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `backend/apps/export/services/completeness.py` | Compute required/missing fields + manual tasks from `TaskRule` | Create |
| `backend/apps/export/tests_completeness.py` | Tests for the above | Create |
| `backend/apps/export/serializers.py` | Expose `completeness` on `ShipmentDetailSerializer` | Modify |
| `frontend/src/types/index.ts` | `ICompleteness`, `IMissingField`, `IManualTask` | Modify |
| `frontend/src/constants/shipmentEditConfig.ts` | Add driver fields | Modify |
| `frontend/src/components/shipment/DetailFieldRow.tsx` | Click-to-edit, save states, comment icon | Modify |
| `frontend/src/components/shipment/DetailFieldRow.helpers.ts` | Pure save-state logic (unit-testable) | Create |
| `frontend/src/components/shipment/ShipmentCompletenessBar.tsx` | Progress + missing chips + manual task checklist | Create |
| `frontend/src/components/shipment/ShipmentStageCard.tsx` | One always-open field group | Create |
| `frontend/src/components/shipment/ShipmentSaleSection.tsx` | Full-width sale section | Create |
| `frontend/src/components/shipment/RouteTimelineRail.tsx` | Restyle only — logic untouched | Modify |
| `frontend/src/components/comments/CommentsDrawer.tsx` | Moved from `components/sheet/` | Move |
| `frontend/src/pages/export/ShipmentDetail.tsx` | Page assembly only, ≤150 lines | Rewrite |
| `frontend/src/components/shipment/LifecycleStage.tsx` | Superseded by `ShipmentStageCard` | Delete |

---

## Task 1: Backend — completeness service

**Files:**
- Create: `backend/apps/export/services/completeness.py`
- Test: `backend/apps/export/tests_completeness.py`

**Interfaces:**
- Consumes: `_condition_matches(rule, shipment)`, `_resolve_value(shipment, path)`, `_is_filled(value)` — all already in `backend/apps/export/services/task_rules.py` (lines 143, 231, 270). **Reuse them, do not reimplement.**
- Produces: `compute_completeness(shipment) -> dict` with keys `required_total: int`, `filled_count: int`, `missing_fields: list[dict]`, `manual_tasks: list[dict]`.

**Semantics (from spec §3):**
- A rule applies if `rule.is_active` and `rule.step` is a status whose `step_order <= shipment.status.step_order` and `_condition_matches(rule, shipment)`.
- Rules with **non-empty** `target_fields` contribute to the counts; each unfilled field becomes a `missing_fields` entry.
- Rules with **empty** `target_fields` cannot be highlighted — their open `Task` rows become `manual_tasks`.
- A **cancelled** shipment returns all-zero/empty: nothing is overdue on a cancelled truck.
- A field appearing in several applicable rules is counted **once** (dedupe by field key).

- [ ] **Step 1: Write the failing test**

Create `backend/apps/export/tests_completeness.py`:

```python
"""Tests for the shipment completeness service.

Covers:
  - fields required by the current step and by already-passed steps
  - future-step fields are NOT counted
  - rule conditions are honoured (condition_field / condition_value)
  - duplicate field keys across rules are counted once
  - rules with empty target_fields surface as manual_tasks, not missing_fields
  - cancelled shipments report nothing
"""
from django.test import TestCase

from apps.core.models import Season, ShipmentStatusType
from apps.export.models import Shipment, TaskRule
from apps.export.services.completeness import compute_completeness


class CompletenessTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.draft = ShipmentStatusType.objects.create(
            code='draft', name_tk='Draft', step_order=0,
        )
        cls.loading = ShipmentStatusType.objects.create(
            code='yuklenme', name_tk='Loading', step_order=3,
        )
        cls.transit = ShipmentStatusType.objects.create(
            code='yola_chykdy', name_tk='Departed', step_order=4,
        )
        cls.cancelled = ShipmentStatusType.objects.create(
            code='cancelled', name_tk='Cancelled', step_order=99,
        )
        cls.season = Season.objects.create(name='2025-2026', is_active=True)

    def _shipment(self, status):
        return Shipment.objects.create(
            shipment_code='0101001/26', status=status, season=self.season,
        )

    def test_counts_current_step_fields(self):
        TaskRule.objects.create(
            step='yuklenme', title_key='tasks.fill_loading_data',
            assignee_role='loading_dept_head', target_fields='weight_net,pallet_count',
        )
        shipment = self._shipment(self.loading)
        shipment.weight_net = 18500
        shipment.save()

        result = compute_completeness(shipment)

        self.assertEqual(result['required_total'], 2)
        self.assertEqual(result['filled_count'], 1)
        self.assertEqual([m['key'] for m in result['missing_fields']], ['pallet_count'])

    def test_includes_passed_steps_excludes_future(self):
        TaskRule.objects.create(
            step='draft', title_key='tasks.set_destination',
            assignee_role='export_manager', target_fields='country',
        )
        TaskRule.objects.create(
            step='tamamlandy', title_key='tasks.future',
            assignee_role='export_manager', target_fields='price_per_kg',
        )
        ShipmentStatusType.objects.create(
            code='tamamlandy', name_tk='Done', step_order=12,
        )
        shipment = self._shipment(self.loading)

        result = compute_completeness(shipment)

        keys = [m['key'] for m in result['missing_fields']]
        self.assertIn('country', keys)          # passed step — still owed
        self.assertNotIn('price_per_kg', keys)  # future step — not yet owed

    def test_dedupes_field_across_rules(self):
        TaskRule.objects.create(
            step='draft', title_key='tasks.a',
            assignee_role='export_manager', target_fields='country',
        )
        TaskRule.objects.create(
            step='yuklenme', title_key='tasks.b',
            assignee_role='loading_dept_head', target_fields='country',
        )
        shipment = self._shipment(self.loading)

        result = compute_completeness(shipment)

        self.assertEqual(result['required_total'], 1)
        self.assertEqual(len(result['missing_fields']), 1)

    def test_condition_gates_rule(self):
        TaskRule.objects.create(
            step='yuklenme', title_key='tasks.gapy_only',
            assignee_role='document_team', target_fields='pallet_count',
            condition_field='is_gapy_satys', condition_value='True',
        )
        shipment = self._shipment(self.loading)   # is_gapy_satys defaults False

        result = compute_completeness(shipment)

        self.assertEqual(result['required_total'], 0)

    def test_empty_target_fields_not_counted(self):
        TaskRule.objects.create(
            step='yuklenme', title_key='tasks.give_documents',
            assignee_role='transport', target_fields='',
        )
        shipment = self._shipment(self.loading)

        result = compute_completeness(shipment)

        self.assertEqual(result['required_total'], 0)
        self.assertEqual(result['missing_fields'], [])

    def test_cancelled_reports_nothing(self):
        TaskRule.objects.create(
            step='draft', title_key='tasks.set_destination',
            assignee_role='export_manager', target_fields='country',
        )
        shipment = self._shipment(self.cancelled)

        result = compute_completeness(shipment)

        self.assertEqual(result['required_total'], 0)
        self.assertEqual(result['filled_count'], 0)
        self.assertEqual(result['missing_fields'], [])
        self.assertEqual(result['manual_tasks'], [])
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && python manage.py test apps.export.tests_completeness -v 2
```

Expected: `ModuleNotFoundError: No module named 'apps.export.services.completeness'`

- [ ] **Step 3: Write the implementation**

Create `backend/apps/export/services/completeness.py`:

```python
"""Per-shipment data completeness, derived from TaskRule.

Answers one question for the Detail page: which fields SHOULD be filled by
now, and which of those are still empty.

Source of truth is TaskRule.target_fields, read LIVE. We deliberately do not
read Task rows: editing a TaskRule leaves already-generated Tasks holding a
stale snapshot until `reconcile_tasks` runs, which would make the highlight
disagree with the rules an admin just edited. Task rows ARE used for the
manual-task list, because rules with an empty target_fields have no field to
check and only exist as Task instances.

Read-only. Never writes. No new model.
"""
from apps.core.models import ShipmentStatusType
from apps.export.models import Task, TaskRule, TaskState
from apps.export.services.task_rules import (
    _condition_matches,
    _is_filled,
    _resolve_value,
)

# A cancelled shipment owes nothing — no field on it is "overdue".
_CANCELLED = 'cancelled'


def _split_fields(csv_value: str) -> list[str]:
    """Parse TaskRule.target_fields (CSV CharField, not JSON — see CLAUDE.md)."""
    return [f.strip() for f in csv_value.split(',') if f.strip()]


def compute_completeness(shipment) -> dict:
    """Return the completeness block for one shipment.

    Keys:
        required_total:  count of distinct fields owed by now
        filled_count:    how many of those are filled
        missing_fields:  [{key, title_key, step, role}] for the unfilled ones
        manual_tasks:    [{id, title_key, role, is_overdue}] for open tasks
                         whose rule has no target_fields

    Ordering is stable: missing_fields follows the lifecycle step order, then
    the field's position within the rule, so the UI does not reshuffle chips
    between renders.
    """
    empty = {
        'required_total': 0,
        'filled_count': 0,
        'missing_fields': [],
        'manual_tasks': [],
    }

    if not shipment.status_id:
        return empty

    current_code = shipment.status.code
    if current_code == _CANCELLED:
        return empty

    current_order = shipment.status.step_order

    # Every status the shipment is at or has already passed. Using step_order
    # (rather than walking status_log) deliberately also covers steps skipped
    # by the auto-advance cascade — their fields are still owed.
    passed_codes = list(
        ShipmentStatusType.objects
        .filter(step_order__lte=current_order, is_active=True)
        .exclude(code=_CANCELLED)
        .order_by('step_order')
        .values_list('code', flat=True)
    )
    order_by_code = {code: i for i, code in enumerate(passed_codes)}

    rules = (
        TaskRule.objects
        .filter(is_active=True, step__in=passed_codes)
        .order_by('id')
    )

    seen: set[str] = set()
    required: list[dict] = []

    for rule in rules:
        if not _condition_matches(rule, shipment):
            continue
        for field_key in _split_fields(rule.target_fields):
            if field_key in seen:
                continue
            seen.add(field_key)
            required.append({
                'key': field_key,
                'title_key': rule.title_key,
                'step': rule.step,
                'role': rule.assignee_role,
                '_sort': (order_by_code.get(rule.step, 0), rule.id),
            })

    required.sort(key=lambda item: item['_sort'])

    missing = []
    filled_count = 0
    for item in required:
        if _is_filled(_resolve_value(shipment, item['key'])):
            filled_count += 1
        else:
            missing.append({
                'key': item['key'],
                'title_key': item['title_key'],
                'step': item['step'],
                'role': item['role'],
            })

    manual_tasks = [
        {
            'id': task.id,
            'title_key': task.title_key,
            'role': task.assignee_role,
            'is_overdue': task.is_overdue,
        }
        for task in (
            Task.objects
            .filter(
                shipment=shipment,
                state__in=[TaskState.OPEN, TaskState.IN_PROGRESS],
                rule__target_fields='',
            )
            .select_related('rule')
            .order_by('id')
        )
    ]

    return {
        'required_total': len(required),
        'filled_count': filled_count,
        'missing_fields': missing,
        'manual_tasks': manual_tasks,
    }
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && python manage.py test apps.export.tests_completeness -v 2
```

Expected: `OK` — 6 tests.

All three attributes used above are verified to exist: `Task.title_key` and `Task.assignee_role` are model fields, and `Task.is_overdue` is a model property (`backend/apps/export/models/task.py:203`, already exposed read-only by the task serializer). Use them as written.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/export/services/completeness.py backend/apps/export/tests_completeness.py
git commit -m "feat(p3): add shipment completeness service derived from TaskRule

Reads TaskRule.target_fields live (not Task snapshots, which go stale until
reconcile_tasks runs) to answer which fields are owed by the shipment's
current step. Cancelled shipments report nothing.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Backend — expose `completeness` on the detail payload

**Files:**
- Modify: `backend/apps/export/serializers.py` (class `ShipmentDetailSerializer`, line ~1104)
- Test: `backend/apps/export/tests_completeness.py` (append)

**Interfaces:**
- Consumes: `compute_completeness(shipment)` from Task 1.
- Produces: `GET /api/v1/export/shipments/{id}/` response gains a `completeness` object.

- [ ] **Step 1: Write the failing test**

Append to `backend/apps/export/tests_completeness.py`:

```python
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.core.models import User


class CompletenessApiTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.season = Season.objects.create(name='2025-2026', is_active=True)
        cls.loading = ShipmentStatusType.objects.create(
            code='yuklenme', name_tk='Loading', step_order=3,
        )
        cls.user = User.objects.create_user(
            username='manager', password='pw', role='export_manager',
        )
        TaskRule.objects.create(
            step='yuklenme', title_key='tasks.fill_loading_data',
            assignee_role='loading_dept_head', target_fields='weight_net,pallet_count',
        )

    def test_detail_includes_completeness(self):
        shipment = Shipment.objects.create(
            shipment_code='0101002/26', status=self.loading, season=self.season,
        )
        self.client.force_authenticate(user=self.user)

        response = self.client.get(f'/api/v1/export/shipments/{shipment.id}/')

        self.assertEqual(response.status_code, 200)
        block = response.data['completeness']
        self.assertEqual(block['required_total'], 2)
        self.assertEqual(block['filled_count'], 0)
        self.assertEqual(
            sorted(m['key'] for m in block['missing_fields']),
            ['pallet_count', 'weight_net'],
        )
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && python manage.py test apps.export.tests_completeness.CompletenessApiTests -v 2
```

Expected: `KeyError: 'completeness'`

- [ ] **Step 3: Add the serializer field**

In `backend/apps/export/serializers.py`, inside `ShipmentDetailSerializer`:

```python
    completeness = serializers.SerializerMethodField()

    def get_completeness(self, obj) -> dict:
        """Which fields are owed by this shipment's current step — see
        services/completeness.py. Computed, never stored."""
        from apps.export.services.completeness import compute_completeness
        return compute_completeness(obj)
```

Add `'completeness'` to that serializer's `Meta.fields` list.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd backend && python manage.py test apps.export.tests_completeness -v 2
```

Expected: `OK` — 7 tests.

- [ ] **Step 5: Verify no migration was created**

```bash
cd backend && python manage.py makemigrations --check --dry-run
```

Expected: `No changes detected`. If a migration appears, something was added as a model field — revert it; `completeness` must be computed only.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/export/serializers.py backend/apps/export/tests_completeness.py
git commit -m "feat(p3): expose completeness block on shipment detail endpoint

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Frontend — types + driver fields

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/constants/shipmentEditConfig.ts`
- Modify: `frontend/src/i18n/tk.json`, `ru.json`, `en.json`

**Interfaces:**
- Produces: `ICompleteness`, `IMissingField`, `IManualTask` — consumed by Tasks 6, 7, 8.

**Why the driver fields:** `TaskRule` seeds require `driver_name`, `driver_phone`, `truck_plate` (see `seed_task_rules.py`, rule `tasks.assign_driver`), but `EDIT_FIELD_GROUPS` has no such fields. Today the system demands data the page cannot accept.

- [ ] **Step 1: Add the types**

In `frontend/src/types/index.ts`:

```typescript
export interface IMissingField {
  key: string;
  title_key: string;
  step: string;
  role: string;
}

export interface IManualTask {
  id: number;
  title_key: string;
  role: string;
  is_overdue: boolean;
}

export interface ICompleteness {
  required_total: number;
  filled_count: number;
  missing_fields: IMissingField[];
  manual_tasks: IManualTask[];
}
```

Add to `IShipmentDetail`:

```typescript
  completeness: ICompleteness;
```

- [ ] **Step 2: Add the driver fields to the transport group**

In `frontend/src/constants/shipmentEditConfig.ts`, inside the `transport` group's `fields` array, before `vehicle_responsible`:

```typescript
      { key: 'truck_plate', labelKey: 'shipment_edit_drawer.field.truck_plate', inputType: 'text' },
      { key: 'driver_name', labelKey: 'shipment_edit_drawer.field.driver_name', inputType: 'text' },
      { key: 'driver_phone', labelKey: 'shipment_edit_drawer.field.driver_phone', inputType: 'text' },
```

- [ ] **Step 3: Add the i18n keys to all three files**

`frontend/src/i18n/tk.json` → under `shipment_edit_drawer.field`:
```json
"truck_plate": "Ulag belgisi",
"driver_name": "Sürüjiniň ady",
"driver_phone": "Sürüjiniň telefony"
```

`frontend/src/i18n/ru.json`:
```json
"truck_plate": "Номер машины",
"driver_name": "Имя водителя",
"driver_phone": "Телефон водителя"
```

`frontend/src/i18n/en.json`:
```json
"truck_plate": "Truck plate",
"driver_name": "Driver name",
"driver_phone": "Driver phone"
```

- [ ] **Step 4: Verify the backend accepts these fields**

```bash
cd backend && grep -n "driver_name\|driver_phone\|truck_plate" apps/export/serializers.py | head
```

Expected: all three appear in the patchable field set. If any is missing, add it there — a field in `EDIT_FIELD_GROUPS` that the backend will not PATCH silently no-ops (see the header comment in `shipmentEditConfig.ts`).

- [ ] **Step 5: Typecheck**

```bash
cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/constants/shipmentEditConfig.ts frontend/src/i18n/
git commit -m "feat(p3): add completeness types and the missing driver fields

TaskRule requires driver_name/driver_phone/truck_plate but the detail page
had no inputs for them.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: DetailFieldRow — save states

**Files:**
- Create: `frontend/src/components/shipment/DetailFieldRow.helpers.ts`
- Create: `frontend/src/components/shipment/DetailFieldRow.helpers.test.ts`
- Modify: `frontend/src/components/shipment/DetailFieldRow.tsx`
- Modify: `frontend/src/i18n/{tk,ru,en}.json`

**Interfaces:**
- Produces: `type SaveState = 'idle' | 'pending' | 'saved' | 'error'` and `deriveSaveState(...)`, consumed by Task 5.

**Why:** today the only feedback is a `<Spin>` that vanishes when the request ends (`DetailFieldRow.tsx:173`). On a slow KZ/RU link an operator types a weight, watches a spinner disappear, and has no evidence it persisted. Errors are invisible entirely.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/shipment/DetailFieldRow.helpers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { deriveSaveState } from './DetailFieldRow.helpers';

// The row must never silently return to "no feedback" after a successful
// save — "Saved" persists until the user edits again. NN/g: display the word
// Saved beside each field so the user knows no further action is required.
describe('deriveSaveState', () => {
  it('is idle before anything happens', () => {
    expect(deriveSaveState({ isPending: false, isError: false, hasSavedOnce: false }))
      .toBe('idle');
  });

  it('is pending while the request is in flight', () => {
    expect(deriveSaveState({ isPending: true, isError: false, hasSavedOnce: false }))
      .toBe('pending');
  });

  it('stays saved after a successful save', () => {
    expect(deriveSaveState({ isPending: false, isError: false, hasSavedOnce: true }))
      .toBe('saved');
  });

  it('reports error even when a previous save succeeded', () => {
    expect(deriveSaveState({ isPending: false, isError: true, hasSavedOnce: true }))
      .toBe('error');
  });

  it('pending wins over a stale error', () => {
    expect(deriveSaveState({ isPending: true, isError: true, hasSavedOnce: false }))
      .toBe('pending');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend && npx vitest run src/components/shipment/DetailFieldRow.helpers.test.ts
```

Expected: FAIL — cannot resolve `./DetailFieldRow.helpers`.

- [ ] **Step 3: Write the helper**

Create `frontend/src/components/shipment/DetailFieldRow.helpers.ts`:

```typescript
export type SaveState = 'idle' | 'pending' | 'saved' | 'error';

interface IDeriveSaveStateArgs {
  isPending: boolean;
  isError: boolean;
  hasSavedOnce: boolean;
}

/**
 * Collapse the mutation flags into the one state the row renders.
 *
 * Precedence is pending > error > saved > idle: an in-flight retry must not
 * keep showing the previous failure, and a success must not be erased by a
 * later unrelated render.
 */
export function deriveSaveState({
  isPending,
  isError,
  hasSavedOnce,
}: IDeriveSaveStateArgs): SaveState {
  if (isPending) return 'pending';
  if (isError) return 'error';
  if (hasSavedOnce) return 'saved';
  return 'idle';
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd frontend && npx vitest run src/components/shipment/DetailFieldRow.helpers.test.ts
```

Expected: PASS — 5 tests.

- [ ] **Step 5: Render the state in the row**

In `frontend/src/components/shipment/DetailFieldRow.tsx`, replace the `{patch.isPending && <Spin size="small" />}` line (currently line 173) with a status indicator driven by `deriveSaveState`. Track `hasSavedOnce` in local state, set it in the mutation's `onSuccess` and clear it in `handleChange` so editing resets the badge:

```tsx
const [hasSavedOnce, setHasSavedOnce] = useState(false);
const saveState = deriveSaveState({
  isPending: patch.isPending,
  isError: patch.isError,
  hasSavedOnce,
});
```

Render, after the editor:

```tsx
{saveState === 'pending' && <Spin size="small" />}
{saveState === 'saved' && (
  <Text style={{ fontSize: 11, color: COLORS.success }}>{t('shipment.detail.saved')}</Text>
)}
{saveState === 'error' && (
  <Text style={{ fontSize: 11, color: COLORS.error }}>
    {t('shipment.detail.save_failed')}{' '}
    <a onClick={() => commit(draft)}>{t('shipment.detail.retry')}</a>
  </Text>
)}
```

In `handleChange`, add `setHasSavedOnce(false);` as the first statement. In `commit`, pass `{ onSuccess: () => setHasSavedOnce(true) }` as the mutate options.

- [ ] **Step 6: Add the three i18n keys to all three files**

`tk.json` → `shipment.detail`: `"saved": "Ýatda saklandy"`, `"save_failed": "Saklanmady"`, `"retry": "Gaýtala"`
`ru.json`: `"saved": "Сохранено"`, `"save_failed": "Не сохранилось"`, `"retry": "Повторить"`
`en.json`: `"saved": "Saved"`, `"save_failed": "Not saved"`, `"retry": "Retry"`

- [ ] **Step 7: Typecheck and test**

```bash
cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0 && npx vitest run src/components/shipment/
```

Expected: no type errors, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/shipment/DetailFieldRow.helpers.ts frontend/src/components/shipment/DetailFieldRow.helpers.test.ts frontend/src/components/shipment/DetailFieldRow.tsx frontend/src/i18n/
git commit -m "feat(p3): persistent save confirmation and visible errors on detail fields

Replaces the transient spinner with idle/pending/saved/error. Saved stays
visible until the next edit; errors offer a retry instead of silence.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: DetailFieldRow — click-to-edit

**Files:**
- Modify: `frontend/src/components/shipment/DetailFieldRow.tsx`
- Modify: `frontend/src/components/shipment/DetailFieldRow.helpers.ts`
- Modify: `frontend/src/components/shipment/DetailFieldRow.helpers.test.ts`

**Interfaces:**
- Consumes: `SaveState` from Task 4.
- Produces: `shouldAutoOpenEditor(inputType)` — used to decide which input types skip the read state.

**Behaviour (spec §5):** the value renders as plain text; clicking it turns the row into an editor. `select`/`option_select`/`date` open their popup immediately on the same click. `boolean` toggles directly and never enters an edit state. Tab moves to the next row and opens it (desktop only). A `readOnly` row never becomes editable.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/components/shipment/DetailFieldRow.helpers.test.ts`:

```typescript
import { shouldAutoOpenEditor } from './DetailFieldRow.helpers';

// Booleans must never enter an "editing" state — a checkbox click IS the
// edit. Selects and dates should open their popup on the same click that
// enters edit mode, so the user does not have to click twice.
describe('shouldAutoOpenEditor', () => {
  it('auto-opens pickers', () => {
    expect(shouldAutoOpenEditor('select')).toBe(true);
    expect(shouldAutoOpenEditor('option_select')).toBe(true);
    expect(shouldAutoOpenEditor('date')).toBe(true);
    expect(shouldAutoOpenEditor('datetime')).toBe(true);
  });

  it('does not auto-open free-text inputs', () => {
    expect(shouldAutoOpenEditor('text')).toBe(false);
    expect(shouldAutoOpenEditor('textarea')).toBe(false);
    expect(shouldAutoOpenEditor('number')).toBe(false);
  });

  it('does not auto-open booleans', () => {
    expect(shouldAutoOpenEditor('boolean')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend && npx vitest run src/components/shipment/DetailFieldRow.helpers.test.ts
```

Expected: FAIL — `shouldAutoOpenEditor is not a function`.

- [ ] **Step 3: Write the helper**

Append to `frontend/src/components/shipment/DetailFieldRow.helpers.ts`:

```typescript
import type { FieldInputType } from '@/constants/shipmentEditConfig';

const AUTO_OPEN_TYPES = new Set<FieldInputType>([
  'select',
  'option_select',
  'date',
  'datetime',
]);

/**
 * Should entering edit mode immediately open this input's popup?
 *
 * True for pickers, so one click both enters edit mode and opens the list.
 * False for free text (the user still has to type) and for booleans, which
 * are toggled directly and never enter an edit state at all.
 */
export function shouldAutoOpenEditor(inputType: FieldInputType): boolean {
  return AUTO_OPEN_TYPES.has(inputType);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd frontend && npx vitest run src/components/shipment/DetailFieldRow.helpers.test.ts
```

Expected: PASS — 8 tests total in the file.

- [ ] **Step 5: Wire click-to-edit into the row**

In `DetailFieldRow.tsx`:

```tsx
const [isEditing, setIsEditing] = useState(false);
const isBoolean = config.inputType === 'boolean';
const canEdit = !readOnly;
const showEditor = canEdit && (isEditing || isBoolean);

function enterEdit() {
  if (!canEdit || isBoolean) return;
  setIsEditing(true);
}
```

Render the value side as:

```tsx
{showEditor ? (
  <div style={{ flex: 1, minWidth: 0 }}>
    <FieldEditor
      config={config}
      value={draft}
      onChange={handleChange}
      countryId={countryId}
      autoFocus
      defaultOpen={shouldAutoOpenEditor(config.inputType)}
    />
  </div>
) : (
  <Text
    onClick={enterEdit}
    tabIndex={canEdit ? 0 : -1}
    onFocus={enterEdit}
    style={{
      fontSize: 13,
      flex: 1,
      cursor: canEdit ? 'text' : 'default',
      color: persisted == null || persisted === '' ? COLORS.textTertiary : undefined,
    }}
  >
    {format ? format(persisted) : (persisted as string | number | null) ?? '—'}
  </Text>
)}
```

Leave edit mode on the existing `handleBlur` (which already detects focus leaving the row): add `setIsEditing(false);` after `flushPending();`.

`onFocus={enterEdit}` on a `tabIndex={0}` element is what makes Tab open the next row — no keyboard handler needed.

If `FieldEditor` does not accept `autoFocus` / `defaultOpen`, add them as optional pass-through props to `frontend/src/components/FieldEditor.tsx` and forward them to the underlying Ant component. Do not fake it with a `setTimeout`.

- [ ] **Step 6: Typecheck and test**

```bash
cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0 && npx vitest run src/components/shipment/
```

Expected: no type errors, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/shipment/ frontend/src/components/FieldEditor.tsx
git commit -m "feat(p3): click-to-edit detail rows

Values render as text until clicked, so the page reads as a table. Tab moves
to the next row and opens it. Pickers open on the same click; booleans toggle
directly.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: ShipmentCompletenessBar

**Files:**
- Create: `frontend/src/components/shipment/ShipmentCompletenessBar.tsx`
- Modify: `frontend/src/i18n/{tk,ru,en}.json`

**Interfaces:**
- Consumes: `ICompleteness` (Task 3).
- Produces: `<ShipmentCompletenessBar completeness={…} onJumpToField={(key) => void} />`, consumed by Task 7.

**Behaviour (spec §4):** progress line, chips for missing fields, checklist for manual tasks. Clicking a chip calls `onJumpToField`. Renders nothing at all when `required_total === 0` and `manual_tasks` is empty — a fully complete shipment shows no bar.

- [ ] **Step 1: Write the component**

```tsx
import { Card, Progress, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ICompleteness } from '@/types';
import { COLORS } from '@/constants/styles';

const { Text } = Typography;

interface IShipmentCompletenessBarProps {
  completeness: ICompleteness;
  onJumpToField: (fieldKey: string) => void;
}

/**
 * "What is still owed on this shipment" — driven entirely by the backend
 * completeness block (TaskRule-derived). Two parts, because rules with no
 * target_fields have nothing to highlight and would otherwise vanish:
 *   - chips  → fields that should be filled by now but are empty
 *   - checks → open tasks that are marked done by hand
 */
export function ShipmentCompletenessBar({
  completeness,
  onJumpToField,
}: IShipmentCompletenessBarProps) {
  const { t } = useTranslation();
  const { required_total, filled_count, missing_fields, manual_tasks } = completeness;

  if (required_total === 0 && manual_tasks.length === 0) return null;

  const percent = required_total === 0
    ? 100
    : Math.round((filled_count / required_total) * 100);

  return (
    <Card size="small" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text strong style={{ fontSize: 13 }}>
          {t('shipment.detail.completeness', { filled: filled_count, total: required_total })}
        </Text>
        <Text type="secondary" style={{ fontSize: 12 }}>{percent}%</Text>
      </div>

      <Progress
        percent={percent}
        showInfo={false}
        size="small"
        strokeColor={percent === 100 ? COLORS.success : COLORS.warning}
        style={{ margin: '6px 0 8px' }}
      />

      {missing_fields.length > 0 && (
        <div style={{ marginBottom: manual_tasks.length > 0 ? 10 : 0 }}>
          <Text type="secondary" style={{ fontSize: 12, marginRight: 6 }}>
            {t('shipment.detail.missing_label')}
          </Text>
          {missing_fields.map((field) => (
            <Tag
              key={field.key}
              color="warning"
              style={{ cursor: 'pointer', marginBottom: 4 }}
              onClick={() => onJumpToField(field.key)}
            >
              {t(`shipment_edit_drawer.field.${field.key}`)}
            </Tag>
          ))}
        </div>
      )}

      {manual_tasks.length > 0 && (
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('shipment.detail.manual_tasks_label')}
          </Text>
          {manual_tasks.map((task) => (
            <div key={task.id} style={{ fontSize: 12, padding: '3px 0' }}>
              ☐ {t(task.title_key)}
              <Tag style={{ marginLeft: 6, fontSize: 10 }}>{t(`role.${task.role}`)}</Tag>
              {task.is_overdue && (
                <Text type="danger" style={{ fontSize: 11 }}>
                  {t('shipment.detail.overdue')}
                </Text>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Add the i18n keys to all three files**

`tk.json` → `shipment.detail`:
```json
"completeness": "{{total}} meýdandan {{filled}} dolduryldy",
"missing_label": "Ýetmeýän maglumat:",
"manual_tasks_label": "El bilen bellenýän işler:",
"overdue": "möhleti geçdi"
```

`ru.json`:
```json
"completeness": "Заполнено {{filled}} из {{total}} полей этого этапа",
"missing_label": "Не хватает:",
"manual_tasks_label": "Задачи, отмечаются вручную:",
"overdue": "просрочено"
```

`en.json`:
```json
"completeness": "{{filled}} of {{total}} fields filled",
"missing_label": "Missing:",
"manual_tasks_label": "Manual tasks:",
"overdue": "overdue"
```

- [ ] **Step 3: Typecheck**

```bash
cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/shipment/ShipmentCompletenessBar.tsx frontend/src/i18n/
git commit -m "feat(p3): add shipment completeness summary bar

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: ShipmentStageCard + page layout rewrite

**Files:**
- Create: `frontend/src/components/shipment/ShipmentStageCard.tsx`
- Rewrite: `frontend/src/pages/export/ShipmentDetail.tsx`
- Delete: `frontend/src/components/shipment/LifecycleStage.tsx`

**Interfaces:**
- Consumes: `ShipmentCompletenessBar` (Task 6), `DetailFieldRow` (Tasks 4–5), `RouteTimelineRail` (existing).
- Produces: `<ShipmentStageCard title={…} missingCount={n} isFutureStage={bool}>{children}</ShipmentStageCard>`.

**Layout (spec §4):** hero → completeness bar → 2-column grid of stage cards with the route rail in a right column → full-width sale section → customs expenses → activity link. **No accordion**: every stage card is always open. A stage whose step has not been reached renders greyed with a "not yet" note but still shows its rows.

- [ ] **Step 1: Write ShipmentStageCard**

```tsx
import { Card, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { COLORS } from '@/constants/styles';

const { Text } = Typography;

interface IShipmentStageCardProps {
  title: string;
  missingCount: number;
  isFutureStage: boolean;
  children: React.ReactNode;
}

/**
 * One always-open group of fields, named after the journey stage it belongs
 * to (Destination / Documents / Loading / In transit / Sale).
 *
 * Replaces LifecycleStage: there is no collapse here by design — the page is
 * meant to show everything at once.
 */
export function ShipmentStageCard({
  title,
  missingCount,
  isFutureStage,
  children,
}: IShipmentStageCardProps) {
  const { t } = useTranslation();

  return (
    <Card
      size="small"
      style={{ opacity: isFutureStage ? 0.65 : 1 }}
      title={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text strong style={{ fontSize: 13 }}>{title}</Text>
          {isFutureStage ? (
            <Text type="secondary" style={{ fontSize: 11 }}>
              {t('shipment.detail.stage_not_reached')}
            </Text>
          ) : missingCount > 0 ? (
            <Tag color="warning" style={{ fontSize: 10, margin: 0 }}>
              {t('shipment.detail.stage_missing', { count: missingCount })}
            </Tag>
          ) : (
            <Tag color="success" style={{ fontSize: 10, margin: 0 }}>
              {t('shipment.detail.stage_complete')}
            </Tag>
          )}
        </div>
      }
      styles={{ body: { padding: '4px 12px' } }}
    >
      {children}
    </Card>
  );
}
```

- [ ] **Step 2: Add the i18n keys to all three files**

`tk.json` → `shipment.detail`: `"stage_not_reached": "bu tapgyr entek gelmedi"`, `"stage_missing": "{{count}} doldurylmadyk"`, `"stage_complete": "doly"`
`ru.json`: `"stage_not_reached": "этап ещё не наступил"`, `"stage_missing": "{{count}} не заполнено"`, `"stage_complete": "готово"`
`en.json`: `"stage_not_reached": "stage not reached yet"`, `"stage_missing": "{{count}} missing"`, `"stage_complete": "complete"`

- [ ] **Step 3: Rewrite the page**

`ShipmentDetail.tsx` keeps its data fetching, permission flags and the existing field-group bodies, but the render becomes assembly only. Replace the `STAGES` accordion block (currently lines ~300–405) with:

```tsx
const missingKeys = new Set(shipment.completeness.missing_fields.map((f) => f.key));

function countMissing(groupKey: string): number {
  const group = EDIT_FIELD_GROUPS.find((g) => g.key === groupKey);
  if (!group) return 0;
  return group.fields.filter((f) => missingKeys.has(f.key)).length;
}

function jumpToField(fieldKey: string) {
  const el = document.getElementById(`detail-field-${fieldKey}`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
}
```

and render:

```tsx
<ShipmentDetailHero shipment={shipment} />

<ShipmentCompletenessBar
  completeness={shipment.completeness}
  onJumpToField={jumpToField}
/>

<div
  style={{
    display: 'grid',
    gridTemplateColumns: screens.md ? '1fr 1fr 320px' : '1fr',
    gap: 16,
    alignItems: 'start',
  }}
>
  <ShipmentStageCard
    title={t('shipment.detail.stage.destination')}
    missingCount={countMissing('logistics')}
    isFutureStage={false}
  >
    {logisticsBody}
  </ShipmentStageCard>

  <ShipmentStageCard
    title={t('shipment.detail.stage.documents')}
    missingCount={countMissing('status')}
    isFutureStage={false}
  >
    {documentsBody}
  </ShipmentStageCard>

  <ShipmentStageCard
    title={t('shipment.detail.stage.loading')}
    missingCount={countMissing('goods')}
    isFutureStage={false}
  >
    {goodsBody}
  </ShipmentStageCard>

  <ShipmentStageCard
    title={t('shipment.detail.stage.transit')}
    missingCount={countMissing('transport')}
    isFutureStage={false}
  >
    {transportBody}
  </ShipmentStageCard>

  <ShipmentStageCard
    title={t('shipment_edit_drawer.section_notes')}
    missingCount={countMissing('notes')}
    isFutureStage={false}
  >
    {notesBody}
  </ShipmentStageCard>

  <div style={{ gridColumn: screens.md ? 3 : 'auto', gridRow: screens.md ? '1 / span 3' : 'auto' }}>
    <RouteTimelineRail shipment={shipment} />
  </div>
</div>
```

The `notes` group (a single `notes` textarea, `shipmentEditConfig.ts` group key `notes`) must be rendered — it exists in `EDIT_FIELD_GROUPS` and would otherwise silently disappear from the page. If `ShipmentDetail.tsx` has no `notesBody` yet, build it the same way the other group bodies are built, mapping `DetailFieldRow` over that group's fields.

Keep the guidance line, the customs-expenses card and the activity-log link exactly as they are, placed after this grid. The sale section is Task 8.

**Highlight the missing rows:** pass `isMissing={missingKeys.has(config.key)}` into `DetailFieldRow` from each group body, and in `DetailFieldRow.tsx` apply to the row wrapper when true:

```tsx
background: isMissing ? COLORS.bgGold : undefined,
boxShadow: isMissing ? `inset 3px 0 0 ${COLORS.warning}` : undefined,
```

- [ ] **Step 4: Delete the superseded component**

```bash
cd frontend && rm src/components/shipment/LifecycleStage.tsx
grep -rn "LifecycleStage" src/ || echo "no references remain"
```

Expected: `no references remain`. If any reference remains, remove it before continuing.

- [ ] **Step 5: Verify the file is under the size limit**

```bash
cd frontend && wc -l src/pages/export/ShipmentDetail.tsx
```

Expected: ≤ 150 lines. If it is longer, extract the remaining group bodies into their own components — the repo rule is 150 lines per component.

- [ ] **Step 6: Typecheck and test**

```bash
cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0 && npx vitest run
```

Expected: no type errors, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/shipment/ frontend/src/pages/export/ShipmentDetail.tsx frontend/src/i18n/
git commit -m "feat(p3): replace detail accordion with always-open stage cards

Every field group is now visible without a click, with overdue-empty rows
highlighted. LifecycleStage is removed.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Full-width sale section

**Files:**
- Create: `frontend/src/components/shipment/ShipmentSaleSection.tsx`
- Modify: `frontend/src/pages/export/ShipmentDetail.tsx`

**Interfaces:**
- Consumes: `ShipmentStageCard` (Task 7) and the existing `financeBody` / sales-report form already in `ShipmentDetail.tsx`.

**Why full width:** when the shipment is actually being sold, this section contains the sales-report form — line items plus the expense-category table. That does not fit a half-width grid column. Before the sale step is reached it collapses to a single grey line.

- [ ] **Step 1: Write the component**

```tsx
import { Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { ShipmentStageCard } from './ShipmentStageCard';

const { Text } = Typography;

interface IShipmentSaleSectionProps {
  /** False until the shipment has departed — the report cannot be filled before then. */
  isReached: boolean;
  children: React.ReactNode;
}

/**
 * The sale stage, rendered full width below the two-column grid because the
 * sales report (line items + expense table) cannot fit a half-width column.
 */
export function ShipmentSaleSection({ isReached, children }: IShipmentSaleSectionProps) {
  const { t } = useTranslation();

  if (!isReached) {
    return (
      <div
        style={{
          padding: '10px 14px',
          marginBottom: 16,
          borderRadius: 6,
          background: '#fafafa',
          border: '1px solid #f0f0f0',
        }}
      >
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('shipment.detail.stage.sale')} — {t('shipment.detail.stage_not_reached')}
        </Text>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <ShipmentStageCard
        title={t('shipment.detail.stage.sale')}
        missingCount={0}
        isFutureStage={false}
      >
        {children}
      </ShipmentStageCard>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the page**

In `ShipmentDetail.tsx`, immediately after the stage grid:

```tsx
<ShipmentSaleSection
  isReached={DEPARTED_OR_LATER.has(shipment.status_code)}
>
  {financeBody}
</ShipmentSaleSection>
```

Define the gate near the other constants — the sales report opens at departure, because the system status lags the real sale (see `.claude/rules/api-contract.md`, sales-report section):

```tsx
const DEPARTED_OR_LATER = new Set([
  'yola_chykdy', 'serhet_tm', 'serhet_gechdi', 'barysh_gumrugi', 'yolda',
  'bardy', 'satylyar', 'satyldy', 'hasabat', 'tamamlandy',
]);
```

- [ ] **Step 3: Typecheck and test**

```bash
cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0 && npx vitest run
```

Expected: no type errors, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/shipment/ShipmentSaleSection.tsx frontend/src/pages/export/ShipmentDetail.tsx
git commit -m "feat(p3): render the sale section full width below the stage grid

The sales report (line items + expenses) does not fit a half-width column.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Comments on the detail page

**Files:**
- Move: `frontend/src/components/sheet/CommentsDrawer.tsx` → `frontend/src/components/comments/CommentsDrawer.tsx`
- Modify: `frontend/src/pages/export/ShipmentSheet.tsx`, `frontend/src/components/sheet/SheetToolbar.tsx` (import paths)
- Modify: `frontend/src/components/shipment/ShipmentDetailHero.tsx` (discussion button)
- Modify: `frontend/src/components/shipment/DetailFieldRow.tsx` (per-field comment icon)

**Interfaces:**
- Consumes: the existing `CommentsDrawer` props — read them from the file before wiring; do not guess the prop names.
- Produces: nothing new. This task is placement only.

**Why a move:** the drawer stops being Sheet-specific once the Detail page uses it. Everything else — the comments API, mention tokens (`@user:42`, `@role:transport`, `#cell:<key>`) and `comment_counts` — already exists and is reused unchanged.

- [ ] **Step 1: Move the file and fix imports**

```bash
cd frontend && mkdir -p src/components/comments && git mv src/components/sheet/CommentsDrawer.tsx src/components/comments/CommentsDrawer.tsx
grep -rln "components/sheet/CommentsDrawer" src/ | xargs sed -i 's#components/sheet/CommentsDrawer#components/comments/CommentsDrawer#g'
grep -rn "sheet/CommentsDrawer" src/ || echo "all imports updated"
```

Expected: `all imports updated`.

- [ ] **Step 2: Verify the Sheet still typechecks (nothing else changed yet)**

```bash
cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0
```

Expected: no errors.

- [ ] **Step 3: Add the hero discussion button**

In `ShipmentDetailHero.tsx`, add to the action cluster:

```tsx
<Badge count={shipment.comment_count ?? 0} size="small">
  <Button icon={<MessageOutlined />} onClick={() => onOpenComments(null)}>
    {t('shipment.detail.discussion')}
  </Button>
</Badge>
```

`onOpenComments: (fieldKey: string | null) => void` is a new prop on the hero, owned by `ShipmentDetail.tsx`, which holds the drawer's open state. If `IShipmentDetail` has no `comment_count`, add it to the detail serializer as a count of non-deleted root comments — do not compute it client-side.

- [ ] **Step 4: Add the per-field comment icon**

In `DetailFieldRow.tsx`, after the save-state indicator:

```tsx
{onOpenComments && (
  <span
    onClick={() => onOpenComments(config.key)}
    style={{
      fontSize: 11,
      cursor: 'pointer',
      color: commentCount > 0 ? COLORS.primary : COLORS.textMuted,
      opacity: commentCount > 0 ? 1 : 0,
    }}
    className="detail-row-comment"
  >
    💬{commentCount > 0 ? ` ${commentCount}` : ''}
  </span>
)}
```

Add a CSS rule so the icon appears on hover when there are no comments yet:

```css
.detail-row:hover .detail-row-comment { opacity: 1 !important; }
```

- [ ] **Step 5: Render the drawer from the page**

In `ShipmentDetail.tsx`:

```tsx
const [commentsField, setCommentsField] = useState<string | null | undefined>(undefined);
// undefined = closed; null = whole-shipment thread; string = that field's thread
```

Render `<CommentsDrawer … />` when `commentsField !== undefined`, passing `shipmentId={shipment.id}` and `fieldKey={commentsField}`. Match the prop names the drawer actually declares.

- [ ] **Step 6: Add the i18n key to all three files**

`tk.json`: `"discussion": "Ara alyp maslahatlaşma"` · `ru.json`: `"discussion": "Обсуждение"` · `en.json`: `"discussion": "Discussion"`

- [ ] **Step 7: Typecheck and test**

```bash
cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0 && npx vitest run
```

Expected: no type errors, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/ frontend/src/pages/export/ frontend/src/i18n/
git commit -m "feat(p3): bring comments onto the shipment detail page

Reuses the Sheet's CommentsDrawer (moved to components/comments/) with a
whole-shipment thread in the hero and a per-field thread on each row.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: RouteTimelineRail — restyle and show on mobile

**Files:**
- Modify: `frontend/src/components/shipment/RouteTimelineRail.tsx`
- Modify: `frontend/src/pages/export/ShipmentDetail.tsx`

**Interfaces:** none change. This is presentation only.

**Hard boundary (spec §7) — the product owner approved the current look. DO NOT change:** vertical top-to-bottom orientation; round dots showing ✓ / ● / step number; green = done, blue = active, grey outline = pending; the green connector line; the monospace timestamp under each step name; the transition comment line; the red cancelled tile; 13 steps plus the conditional transshipment insert; the `📍` title.

**Only these may change:** dot diameter 32 → 24 px; font sizes; padding and gaps; card border/header treatment; column width.

- [ ] **Step 1: Apply the style changes**

In `RouteTimelineRail.tsx` only: change the dot `width`/`height` from `32` to `24`, the connector `left` from `15` to `11` and `top` from `32` to `24`, `paddingBottom` from `20` to `14`, step-name `fontSize` from `13` to `12`, and timestamp `fontSize` from `11` to `10`. Change nothing else — no restructuring, no logic edits, no changes to the state calculation.

- [ ] **Step 2: Render it on mobile**

In `ShipmentDetail.tsx`, the rail currently only exists inside the `screens.md` branch. Move it so it renders in both cases — on mobile it goes directly under the completeness bar and above the stage cards, full width. The grid placement from Task 7 already handles desktop; for mobile add:

```tsx
{!screens.md && <RouteTimelineRail shipment={shipment} />}
```

- [ ] **Step 3: Verify the logic is untouched**

```bash
cd frontend && git diff src/components/shipment/RouteTimelineRail.tsx | grep -E "^[-+]" | grep -vE "^[-+]\s*(width|height|left|top|paddingBottom|fontSize|padding|gap)" | grep -vE "^(\+\+\+|---)"
```

Expected: no output. Any line here means logic changed — revert it.

- [ ] **Step 4: Typecheck**

```bash
cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shipment/RouteTimelineRail.tsx frontend/src/pages/export/ShipmentDetail.tsx
git commit -m "style(p3): tighten route rail spacing and show it on mobile

Logic untouched — spacing and font sizes only, so the approved design stays
recognisable. The rail previously disappeared entirely below md.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Remove the placeholder Links card and the stale comment

**Files:**
- Modify: `frontend/src/pages/export/ShipmentDetail.tsx`

- [ ] **Step 1: Delete the Links card**

Remove the "Links" card entirely (Logo Tiger / Trip Management / GPS — three hardcoded rows with no backing data, formerly `ShipmentDetail.tsx:510-525`). It occupies prime secondary-column space and shows nothing real.

- [ ] **Step 2: Delete the stale comment**

Remove the code comment claiming *"always visible. No accordion — operators see everything in one scroll."* (formerly lines 157-161). It described the opposite of what the code did; after Task 7 the page genuinely has no accordion, so the comment is redundant either way.

- [ ] **Step 3: Typecheck and test**

```bash
cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0 && npx vitest run
```

Expected: no type errors, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/export/ShipmentDetail.tsx
git commit -m "chore(p3): drop the placeholder Links card and a stale code comment

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Documentation and build log

**Files:**
- Modify: `docs/obsidian/screens/shipment-list-vs-sheet.md`
- Modify: `docs/SPRINT_PLAN.md`
- Modify: `CHANGELOG.md`
- Modify: `BUILD_TEST_LOG.md`

- [ ] **Step 1: Fix the stale screen doc**

`docs/obsidian/screens/shipment-list-vs-sheet.md` still describes tabs (`overview` / `document` / `finance` / `changes`), a `ShipmentEditDrawer`, an inline comment thread and `?tab=` deep-links — none of which exist. Line 14 also claims "5 collapsible sections, all expanded by default". Rewrite the Detail section to describe what this plan built: hero → completeness bar → 2-column always-open stage cards + route rail → full-width sale → customs expenses → activity link, with click-to-edit rows and per-field comments.

- [ ] **Step 2: Fix the sprint plan**

`docs/SPRINT_PLAN.md:16` specifies tabs for the Detail page. Replace that with the accordion-free stage-card layout and note why: operators reconcile weights against firm splits against timestamps, which tabs would force them to do from memory.

- [ ] **Step 3: Add the CHANGELOG entry**

Under `## [Unreleased]` → `### Changed`:

```markdown
- ShipmentDetail rebuilt: always-open stage cards, completeness summary driven by TaskRule, click-to-edit rows with persistent save confirmation, comments on the page (feat(p3))
```

Under `### Added`:

```markdown
- `completeness` block on the shipment detail endpoint — required/missing fields derived live from TaskRule (feat(p3))
- driver_name / driver_phone / truck_plate inputs, previously required by TaskRule but absent from the page (feat(p3))
```

Under `### Fixed`:

```markdown
- RouteTimelineRail no longer disappears on mobile (fix(p3))
```

- [ ] **Step 4: Add the build-test log entry**

Prepend to `BUILD_TEST_LOG.md`:

```markdown
- [ ] 2026-07-20 — ShipmentDetail redesign: completeness bar, stage cards, click-to-edit, comments, route rail restyle — NEEDS TEST
```

- [ ] **Step 5: Commit**

```bash
git add docs/ CHANGELOG.md BUILD_TEST_LOG.md
git commit -m "docs(p3): update screen docs, sprint plan and changelog for the detail redesign

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Report honestly**

State plainly in the final reply: **"Built — NOT tested yet. Did you test it?"** Do not mark the `BUILD_TEST_LOG.md` item `- [x]` until the user confirms they exercised the page in a browser. Report which test suites actually ran and their results; if any step was skipped, say so.

---

## Manual acceptance checklist (spec §12)

Run against a real shipment after Task 12. This is the user's list — do not tick it on their behalf.

- [ ] Shipment in transit: all field groups visible with no clicks; empty pallets/boxes highlighted; sale section grey "not reached"
- [ ] Draft: empty destination fields are **not** highlighted (step not passed)
- [ ] Clicking a chip in the summary scrolls to the field and opens it for editing
- [ ] Editing a field shows "Saved" and it **stays** visible
- [ ] Network drop mid-save shows the error state with Retry; the typed value is not lost
- [ ] Tab walks the rows in order, each opening for input
- [ ] Route rail side by side with an old screenshot reads as the same design
- [ ] Route rail visible on a phone
- [ ] 💬 on a row opens the thread scoped to that field
- [ ] A role without edit rights sees plain text and clicking does nothing
- [ ] All new strings present in `tk.json`, `ru.json` and `en.json`

---

## Self-review notes

**Spec coverage:** §3 completeness rules → Tasks 1–2. §4 layout → Tasks 6–8. §5 entry → Tasks 4–5. §6 comments → Task 9. §7 route rail → Task 10. §8 bugs: driver fields → Task 3, mobile rail → Task 10, Links card + stale comment → Task 11, stale docs → Task 12. §9 component split → Task 7. §12 acceptance → checklist above.

**Known gaps, deliberately left to the user:** spec §11 open questions (rule completeness audit, whether historical shipments surface too many gaps, real mobile usage) are product questions that require real data and real operators — they are not implementable steps and are not assigned to a task.
