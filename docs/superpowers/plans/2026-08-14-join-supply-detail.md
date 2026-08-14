# Join Supply on the Detail Page (Phase A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Join supply" button on a destination draft's Detail page opens a modal that lists supply drafts and merges the picked one into the current shipment, via the existing `POST /export/shipments/{target}/join/` endpoint.

**Architecture:** Frontend-only feature over an already-built, already-tested backend join endpoint, plus two small backend-hygiene fixes. Reuses `useJoinShipments` (unchanged) and the `joinHelpers` classifiers (parameter type widened so they work off the Detail/draft payloads, not just the Sheet payload). A new `JoinSupplyModal` owns its own local selection state — the Sheet's `JoinActionBar` is Zustand-coupled and is NOT reused.

**Tech Stack:** Django DRF (MSSQL) for the two hygiene fixes; React 18 + TypeScript + Ant Design, TanStack Query, vitest + @testing-library/react.

**Spec:** [`docs/superpowers/specs/2026-08-14-join-supply-on-detail-design.md`](../specs/2026-08-14-join-supply-on-detail-design.md)

## Global Constraints

- **i18n strict**: every user-visible string in all three of `frontend/src/i18n/{tk,ru,en}.json`, same commit, each file its own language. New namespace `join_supply.*`.
- **TypeScript strict**: no `any`, no `as` unless unavoidable, `I`-prefixed interfaces. Typecheck: `npx tsc --noEmit --ignoreDeprecations 5.0` from `frontend/` (`npm run type-check` is broken — TS5103). Tests: `npx vitest run <path>` from `frontend/`.
- **Backend tests run with `DJANGO_TESTING=true`** against a real MSSQL test DB: `cd backend && DJANGO_TESTING=true python manage.py test <module> -v 2`. If `manage.py` can't connect after a prior test run destroyed the DB, run one `--keepdb` test to recreate it. Run only the module you touch; the wider suite has ~71 pre-existing unrelated failures.
- **Max 150 lines per React component, 200 per Python file.**
- **No new backend join logic** — the endpoint is unchanged. The only backend edits are the test-harness `seed_permissions` and a one-line message fix.
- **Stage only the files each task touches.** The working tree contains unrelated uncommitted contracts WIP — never `git add -A`/`.`; stage exact paths.
- **Co-author trailer** on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- One commit per task; do not commit without the task's commit step.

---

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `backend/apps/export/tests_shipment_join.py` | Add `seed_permissions` to setUp so the join tests actually reach the view | Modify |
| `backend/apps/export/views.py` (`join` action, ~2066) | Fix the stale 403 message (`boss` also allowed) | Modify |
| `frontend/src/components/sheet/joinHelpers.ts` | Widen the classifier parameter type to a structural interface | Modify |
| `frontend/src/types/index.ts` (`IShipmentDraft`) | Declare the fields the modal renders (already sent by the backend) | Modify |
| `frontend/src/components/shipment/JoinSupplyModal.tsx` | The picker modal | Create |
| `frontend/src/components/shipment/JoinSupplyModal.test.tsx` | Modal test | Create |
| `frontend/src/components/shipment/ShipmentDetailHero.tsx` | "Join supply" button + gate + modal wiring | Modify |
| `frontend/src/i18n/{tk,ru,en}.json` | `join_supply.*` keys | Modify |
| `docs/obsidian/processes/draft-shipments.md`, `CHANGELOG.md`, `BUILD_TEST_LOG.md` | Docs | Modify |

---

## Task 1: Backend hygiene — make the join tests a real gate

**Files:**
- Modify: `backend/apps/export/tests_shipment_join.py` (setUp/setUpTestData)
- Modify: `backend/apps/export/views.py` (the `join` action's 403 message, ~line 2066)

**Why:** `tests_shipment_join.py` never calls `seed_permissions`, so `DynamicResourcePermission` 403s every non-superuser POST before the view body runs — ~28/34 tests are pre-existing RED for a harness reason, not a logic reason. Seeding permissions makes them a trustworthy regression gate before we build on the endpoint. Separately, the 403 message says "Only export_manager or director" but `boss` is also in `PRIVILEGED_ROLES`.

**Interfaces:**
- Produces: a green `tests_shipment_join` suite (the endpoint's regression net).

- [ ] **Step 1: Establish the RED baseline (document, don't write a new test)**

```bash
cd backend && DJANGO_TESTING=true python manage.py test apps.export.tests_shipment_join -v 2 2>&1 | tail -8
```
Expected: many failures/errors (403s on success-path tests). Record the failed count in your report — this is the baseline the fix must clear.

- [ ] **Step 2: Add `seed_permissions` to the test setUp**

Read `tests_shipment_join.py`'s class structure. Add, in the shared `setUpTestData` (or `setUp` if that's the file's pattern — match the ~54 other test files, e.g. `tests_supply_draft.py`'s `SupplyDraftCreateTests`):
```python
from django.core.management import call_command
# ...
call_command('seed_permissions')
```
Place it once so every test in the file benefits. If the file has multiple test classes each with their own `setUpTestData`, add it to each (or a shared base). Do not change any test's assertions.

- [ ] **Step 3: Run the suite — expect green (or only unrelated residue)**

```bash
cd backend && DJANGO_TESTING=true python manage.py test apps.export.tests_shipment_join -v 2 2>&1 | tail -8
```
Expected: the permission-403 failures are gone; the success-path tests (`JoinSuccessTests`, `LoadingDeptHeadDraftCreateTests`, `JoinMultiVarietyTests`, etc.) now pass. If any test still fails for a NON-permission reason, investigate and report it — do not weaken an assertion to make it pass. Report the before→after counts.

- [ ] **Step 4: Fix the stale 403 message**

In `views.py`'s `join` action (~line 2066), the 403 returns `{'error': 'Only export_manager or director can join draft shipments'}`. Change the text to reflect the real allowed set, e.g. `'Only export_manager, director or boss can join draft shipments'`. Do NOT change the gate logic (`request.user.role not in PRIVILEGED_ROLES`) — text only. If a test asserts on the old exact string, update that assertion to the new text.

- [ ] **Step 5: Re-run — still green**

```bash
cd backend && DJANGO_TESTING=true python manage.py test apps.export.tests_shipment_join -v 2 2>&1 | tail -5
```
Expected: OK.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/export/tests_shipment_join.py backend/apps/export/views.py
git commit -m "test(p3): seed permissions in tests_shipment_join; fix stale join 403 text

The file never seeded RoleResourcePermission rows, so every non-superuser POST
403'd before the view ran — ~28 tests were pre-existing RED for a harness reason.
Now a real regression gate. Also: the 403 message omitted boss (which is in
PRIVILEGED_ROLES).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Widen the classifiers and the draft type

**Files:**
- Modify: `frontend/src/components/sheet/joinHelpers.ts`
- Modify: `frontend/src/types/index.ts` (`IShipmentDraft`)

**Why:** `isDestinationDraft`/`isSupplyDraft` are typed against `IShipmentSheetItem`; the Detail hero and the modal need them against `IShipmentDetail`/`IShipmentDraft`. Widen the parameter to a minimal structural interface. And `IShipmentDraft` under-declares fields the backend already sends that the modal will render.

**Interfaces:**
- Produces: `isDestinationDraft(s: IJoinClassifiable)` / `isSupplyDraft(s: IJoinClassifiable)` where `IJoinClassifiable = { status_code: string; country: number | null; customer: number | null; block_sources?: { block_id?: number }[] | null; created_by_role?: string | null }`. `SUPPLY_ROLES` export unchanged.
- Produces: `IShipmentDraft` with `block_sources`, `weight_net`, `shipment_code`, `country`, `customer`, `country_name`, `customer_name` available for the modal.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/sheet/joinHelpers.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { isDestinationDraft, isSupplyDraft } from './joinHelpers';

describe('join classifiers accept the structural shape', () => {
  const destination = { status_code: 'draft', country: 1, customer: 2, block_sources: [] };
  const supply = { status_code: 'draft', country: null, customer: null, block_sources: [{ block_id: 5 }] };

  it('classifies a destination draft', () => {
    expect(isDestinationDraft(destination)).toBe(true);
    expect(isSupplyDraft(destination)).toBe(false);
  });
  it('classifies a supply draft', () => {
    expect(isSupplyDraft(supply)).toBe(true);
    expect(isDestinationDraft(supply)).toBe(false);
  });
  it('a non-draft is neither', () => {
    expect(isDestinationDraft({ ...destination, status_code: 'yuklenme' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd frontend && npx vitest run src/components/sheet/joinHelpers.test.ts
```
Expected: FAIL if the current signature rejects the plain object shape at type-check/runtime (or passes trivially — in that case the widening is the real deliverable; keep the test as a regression guard).

- [ ] **Step 3: Widen the classifier signature**

In `joinHelpers.ts`, define and export the structural type and use it:
```typescript
export interface IJoinClassifiable {
  status_code: string;
  country: number | null;
  customer: number | null;
  block_sources?: { block_id?: number }[] | null;
  created_by_role?: string | null;
}

export function isDestinationDraft(s: IJoinClassifiable): boolean {
  return (
    s.status_code === 'draft' &&
    s.country !== null &&
    s.customer !== null &&
    (s.block_sources == null || s.block_sources.length === 0)
  );
}

export function isSupplyDraft(s: IJoinClassifiable): boolean {
  return (
    s.status_code === 'draft' &&
    s.block_sources != null &&
    s.block_sources.length > 0 &&
    (s.country === null || SUPPLY_ROLES.has(s.created_by_role ?? ''))
  );
}
```
Keep `SUPPLY_ROLES` as-is. `IShipmentSheetItem` structurally satisfies `IJoinClassifiable`, so the Sheet's existing callers keep compiling.

- [ ] **Step 4: Widen `IShipmentDraft`**

In `types/index.ts`, ensure `IShipmentDraft` declares (add any missing): `shipment_code: string`, `block_sources: IBlockSource[]`, `weight_net: number | null`, `country: number | null`, `customer: number | null`, `country_name: string | null`, `customer_name: string | null`. Match `ShipmentDraftListSerializer`'s actual output — do not add `created_by_role` (the backend doesn't send it on this endpoint).

- [ ] **Step 5: Typecheck + test**

```bash
cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0 && npx vitest run src/components/sheet/joinHelpers.test.ts
```
Expected: no type errors (the Sheet's existing `JoinActionBar` still compiles against the widened signature); test passes.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/sheet/joinHelpers.ts frontend/src/components/sheet/joinHelpers.test.ts frontend/src/types/index.ts
git commit -m "refactor(p3): widen join classifiers to a structural type; complete IShipmentDraft

isDestinationDraft/isSupplyDraft now accept any {status_code,country,customer,
block_sources,created_by_role?} so the Detail page can use them, not just the
Sheet. IShipmentDraft gains the fields the join picker renders.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `JoinSupplyModal`

**Files:**
- Create: `frontend/src/components/shipment/JoinSupplyModal.tsx`
- Create: `frontend/src/components/shipment/JoinSupplyModal.test.tsx`
- Modify: `frontend/src/i18n/{tk,ru,en}.json`

**Interfaces:**
- Consumes: `useDrafts()` (`@/hooks/useDrafts`) → `IShipmentDraft[]`; `useJoinShipments()` (`@/hooks/useDrafts`) → `.mutate({ targetId, sourceId }, { onSuccess, onError })`; `IShipmentDraft` fields (Task 2).
- Produces: `<JoinSupplyModal open targetId onClose onSuccess? />`.

**Candidate filter:** `d.id !== targetId && d.block_sources.length > 0 && !(d.country_name != null && d.customer_name != null)`.

> **Correction (found in Task 2):** the draft-list endpoint (`ShipmentDraftListSerializer`) does NOT send raw `country`/`customer` FK ids — only `country_name`/`customer_name` strings. So the "not a complete destination" clause MUST key off `country_name`/`customer_name` (which are present), not `country`/`customer` (which are `undefined` on the draft payload, making the check silently never fire). `isDestinationDraft`/`isSupplyDraft` are NOT usable directly on a raw `IShipmentDraft` (it lacks `status_code`; `country`/`customer` are optional) — do the filtering with inline field checks in the modal, not by calling the classifiers on the draft.

- [ ] **Step 1: Write the failing test**

Create `JoinSupplyModal.test.tsx` on the `DocumentOptionsModal.test.tsx` harness (QueryClientProvider retry:false, i18n en, mock the hooks):
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import { JoinSupplyModal } from './JoinSupplyModal';

const mutate = vi.fn();
vi.mock('@/hooks/useDrafts', () => ({
  useDrafts: () => ({
    data: [
      // supply candidate — has blocks, no destination name → included
      { id: 10, shipment_code: '0101010/26', weight_net: 22000, country_name: null, customer_name: null,
        block_sources: [{ block_id: 1, block_code: 'JA', weight_kg: null }] },
      // has blocks BUT a complete destination (both names set) → excluded
      { id: 20, shipment_code: '0202020/26', weight_net: 5000, country_name: 'KZ', customer_name: 'Begjan',
        block_sources: [{ block_id: 3, block_code: 'JC', weight_kg: null }] },
      // no blocks (destination-shaped) → excluded
      { id: 30, shipment_code: '0303030/26', weight_net: null, country_name: 'KZ', customer_name: 'Begjan',
        block_sources: [] },
      // is the target → excluded
      { id: 99, shipment_code: 'SELF/26', weight_net: null, country_name: null, customer_name: null,
        block_sources: [{ block_id: 2, block_code: 'JB', weight_kg: null }] },
    ],
    isLoading: false,
  }),
  useJoinShipments: () => ({ mutate, isPending: false }),
}));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('JoinSupplyModal', () => {
  beforeEach(() => { mutate.mockClear(); i18n.changeLanguage('en'); });

  it('lists only supply candidates (has blocks, not a destination, not the target)', () => {
    wrap(<JoinSupplyModal open targetId={99} onClose={() => {}} />);
    expect(screen.getByText(/0101010\/26/)).toBeInTheDocument();       // supply — included
    expect(screen.queryByText(/0202020\/26/)).not.toBeInTheDocument(); // blocks+destination → excluded
    expect(screen.queryByText(/0303030\/26/)).not.toBeInTheDocument(); // no blocks → excluded
    expect(screen.queryByText(/SELF\/26/)).not.toBeInTheDocument();    // target → excluded
  });

  it('joins the picked supply into the target', async () => {
    wrap(<JoinSupplyModal open targetId={99} onClose={() => {}} />);
    await userEvent.click(screen.getByText(/0101010\/26/));
    await userEvent.click(screen.getByRole('button', { name: /join|birleş|объедин/i }));
    expect(mutate).toHaveBeenCalledWith(
      { targetId: 99, sourceId: 10 },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });
});
```

- [ ] **Step 2: Run — expect failure** (`vitest run src/components/shipment/JoinSupplyModal.test.tsx`) — module missing.

- [ ] **Step 3: Build the modal**

Ant `Modal`. Inside: `useDrafts()` → filter to candidates per the filter above. Render each candidate as a selectable row (Ant `List` or radio group) showing `shipment_code`, block codes (`block_sources.map(b => b.block_code).join(', ')`), and weight (`weight_net`). Local `useState<number | null>(selectedId)`. Footer: Cancel + a primary "Join" button, disabled until a candidate is selected. On Join, call `useJoinShipments().mutate({ targetId, sourceId: selectedId }, { onSuccess, onError })`:
- `onSuccess`: `toast.success(t('join_supply.toast_success'))`, `onSuccess?.()`, `onClose()`.
- `onError`: `const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error; toast.error(msg ?? t('join_supply.toast_error'))` — matching `JoinActionBar`'s extraction.
Empty candidate list → render `t('join_supply.empty')` and disable Join.

Add `join_supply.*` i18n keys (title, join button, cancel, empty, toast_success, toast_error, column labels) to all three files, each own language.

- [ ] **Step 4: Run — expect pass** (`vitest run src/components/shipment/JoinSupplyModal.test.tsx`).

- [ ] **Step 5: Typecheck + commit**

```bash
cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0
git add frontend/src/components/shipment/JoinSupplyModal.tsx frontend/src/components/shipment/JoinSupplyModal.test.tsx frontend/src/i18n/
git commit -m "feat(p3): JoinSupplyModal — pick a supply draft to merge into a destination

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: The "Join supply" button on the hero

**Files:**
- Modify: `frontend/src/components/shipment/ShipmentDetailHero.tsx`
- Modify: `frontend/src/i18n/{tk,ru,en}.json` (button label)

**Interfaces:**
- Consumes: `JoinSupplyModal` (Task 3); `isDestinationDraft` (Task 2, `@/components/sheet/joinHelpers`).

- [ ] **Step 1: Add the gate + button + modal**

In `ShipmentDetailHero.tsx`, near the existing `canPromote`/`canCancel` booleans (~lines 106-112), add:
```tsx
// Join supply: only on a destination draft (has destination, no blocks yet),
// gated to the backend's PRIVILEGED_ROLES (apps/export/services/shipment.py:44 —
// includes boss, unlike canPromote).
const JOIN_ROLES: ReadonlyArray<string> = ['export_manager', 'director', 'boss'];
const canJoinSupply =
  isDestinationDraft(shipment) &&
  !!user &&
  (JOIN_ROLES.includes(user.role) || user.is_superuser === true) &&
  !isReadOnly;
```
Add local state `const [joinOpen, setJoinOpen] = useState(false);`. In the action cluster `<Flex>` (near the Promote button, ~line 210), add:
```tsx
{canJoinSupply && (
  <Button onClick={() => setJoinOpen(true)}>{t('join_supply.open_button')}</Button>
)}
```
Render the modal (once): `<JoinSupplyModal open={joinOpen} targetId={shipment.id} onClose={() => setJoinOpen(false)} />`. The join hook already invalidates the detail key, so the hero refetches and `canJoinSupply` flips off automatically once the shipment has blocks — no manual refetch.

Add `join_supply.open_button` to all three i18n files (each own language), distinct from `join_supply.title`.

- [ ] **Step 2: Verify the gate (test or trace)**

If `ShipmentDetailHero` has an existing test, add a case: the button renders for a destination-draft + `export_manager`, and does NOT render for the same shipment with `block_sources.length > 0`. If there's no hero test harness, state in your report that you verified the gate by code trace and confirm the four conditions (`isDestinationDraft`, role, `!isReadOnly`, has-destination-no-blocks). Do not build a heavy new harness just for this.

- [ ] **Step 3: Typecheck + full suite**

```bash
cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0 && npx vitest run
```
Expected: no type errors; all tests green.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/shipment/ShipmentDetailHero.tsx frontend/src/i18n/
git commit -m "feat(p3): Join-supply button on the destination-draft Detail hero

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Docs

**Files:**
- Modify: `docs/obsidian/processes/draft-shipments.md`, `CHANGELOG.md`, `BUILD_TEST_LOG.md`

- [ ] **Step 1: Update `draft-shipments.md`**

In the join section, note that Join is now also reachable from a **destination draft's Detail page** (a "Join supply" button → pick a supply draft), not only the Sheet — reusing the same `/join/` endpoint. Keep the Sheet flow description intact.

- [ ] **Step 2: CHANGELOG**

Under `[Unreleased]` → `### Added`: a "Join supply" button on the destination-draft Detail page opens a picker of supply drafts and merges the chosen one via the existing join endpoint (feat(p3)). Under `### Fixed` (or Changed): `tests_shipment_join` now seeds permissions (was pre-existing RED); the join 403 message now names `boss`.

- [ ] **Step 3: BUILD_TEST_LOG**

Prepend: `- [ ] 2026-08-14 — Join supply on the Detail page (Phase A): destination-draft "Join supply" button + supply picker modal — NEEDS TEST`.

- [ ] **Step 4: Commit**

```bash
git add docs/obsidian/processes/draft-shipments.md CHANGELOG.md BUILD_TEST_LOG.md
git commit -m "docs(p3): document Join-supply on the Detail page (Phase A)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Report honestly** — state: *"Built — NOT tested in a browser yet. Did you test it?"* Do not tick the build-log item until the user confirms.

---

## Manual acceptance (product owner)
- On a destination draft's Detail page, a "Join supply" button appears (for export_manager/director/boss); absent on a non-draft, a draft that already has blocks, or a supply draft.
- Clicking lists supply drafts (blocks + weight shown); destination drafts and the current shipment are not offered.
- Picking one and confirming merges its blocks into the current shipment (the page refreshes and shows the blocks; the button disappears since it now has blocks).
- A backend rejection (e.g. target already has blocks, racing another join) shows the backend's error message.
- All new strings appear in tk/ru/en.

---

## Self-review notes
**Spec coverage:** §3 button/gate → Task 4. §4 modal → Task 3. §5 reuse/classifier widening → Task 2. §6 type fix → Task 2. §7 backend hygiene → Task 1. §8 testing → each task is TDD. §9 out-of-scope (Phase B) not built.
**Deferred:** Phase B (List join) is a separate spec/plan. The candidate filter excludes complete-destination drafts (spec decision), so the "blocks + destination" edge can't be mis-picked.
