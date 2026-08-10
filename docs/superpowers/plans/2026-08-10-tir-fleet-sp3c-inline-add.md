# TIR Fleet — SP3c (Inline "+ Add" in the Truck/Trailer Selector) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the `ShipmentTruckSelector` dropdowns, when an operator types a plate that isn't in the fleet list, offer **"+ Add \"<plate>\""** to create it on the spot (POST to the SP2 endpoints), then auto-select it. Completes the "create-if-not-in-list" the user asked for (the admin page is separate, SP4).

**Architecture:** New `useCreateTruckHead`/`useCreateTrailer` mutation hooks (mirror `useCreateSeason`) POST `{plate_number}` and invalidate the list query. The selector's `Select`s get a `dropdownRender` that appends an add-button when the typed search has no match; on create success the list refetches and the new id is selected via the existing `save()`.

**Tech Stack:** React + TypeScript + Ant Design + TanStack Query; Vitest.

**Scope:** SP3c only. Extends SP3a (`ShipmentTruckSelector`, `useFleet.ts`). Backend create endpoints already exist (SP2, gated to `CanEditShipment`, plate-match a device on create).

## Global Constraints

- **WORK IN THE WORKTREE** `D:/projects/yigit_platform-transport-fleet-map` (branch `feat/transport-fleet-map`); the main dir is on another session's branch. Frontend commands from the worktree's `frontend/`.
- Type-check: `npx tsc --noEmit --ignoreDeprecations 5.0`. Test: `npx vitest run <file>`.
- httpOnly-cookie auth via `@/services/api`. i18n: no hardcoded user-facing strings (tk/ru/en).
- Commit only on `feat/transport-fleet-map` (worktree). Co-author (implementer subagents): `Claude Sonnet 5`.
- Existing (on branch): `useTruckHeads`/`useTrailers` + `ITruckHead`/`ITrailer` in `frontend/src/hooks/useFleet.ts` (queryKeys `['transport','truck-heads',search??'']` / `['transport','trailers',search??'']`). `ShipmentTruckSelector.tsx` has `save(headId, trailerId)` (PATCHes `{truck_head_id, trailer_id, truck_plate}`). Backend: `POST /api/v1/transport/truck-heads/` / `/trailers/` with `{plate_number}` → 201, returns the created row (`{id, plate_number, ...}`); gated to `CanEditShipment`; plate-matches a Traccar device on create. Mutation pattern to mirror: `useCreateSeason` in `frontend/src/hooks/useAdmin.ts:51` (`useMutation` → `api.post` → `queryClient.invalidateQueries`).

---

### Task 1: `useCreateTruckHead` + `useCreateTrailer` hooks

**Files:**
- Modify: `frontend/src/hooks/useFleet.ts`
- Modify: `frontend/src/hooks/useFleet.test.ts`

**Interfaces:**
- Produces: `useCreateTruckHead()` / `useCreateTrailer()` — `useMutation` whose `mutateAsync(plate_number: string)` POSTs and returns the created `ITruckHead`/`ITrailer`; invalidates the matching list query on success.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/hooks/useFleet.test.ts`:
```typescript
import { useCreateTruckHead, useCreateTrailer } from './useFleet';

describe('useFleet create', () => {
  beforeEach(() => vi.clearAllMocks());

  it('useCreateTruckHead POSTs the plate and returns the created row', async () => {
    (api.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { id: 300, plate_number: '5555AHF', owner_type: '', status: '', has_gps: false },
    });
    const { result } = renderHook(() => useCreateTruckHead(), { wrapper });
    const created = await result.current.mutateAsync('5555AHF');
    expect(created.id).toBe(300);
    expect(api.post).toHaveBeenCalledWith('/transport/truck-heads/', { plate_number: '5555AHF' });
  });

  it('useCreateTrailer POSTs the plate', async () => {
    (api.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { id: 80, plate_number: '9TAH', owner_type: '', status: '', is_active: true },
    });
    const { result } = renderHook(() => useCreateTrailer(), { wrapper });
    await result.current.mutateAsync('9TAH');
    expect(api.post).toHaveBeenCalledWith('/transport/trailers/', { plate_number: '9TAH' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/useFleet.test.ts`
Expected: FAIL — `useCreateTruckHead`/`useCreateTrailer` missing.

- [ ] **Step 3: Implement**

Append to `frontend/src/hooks/useFleet.ts`:
```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';

export function useCreateTruckHead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (plate_number: string) => {
      const { data } = await api.post<ITruckHead>('/transport/truck-heads/', { plate_number });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transport', 'truck-heads'] }),
  });
}

export function useCreateTrailer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (plate_number: string) => {
      const { data } = await api.post<ITrailer>('/transport/trailers/', { plate_number });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transport', 'trailers'] }),
  });
}
```
(Add `useMutation`/`useQueryClient` to the existing `@tanstack/react-query` import if not already present.)

- [ ] **Step 4: Run test + type-check**

Run:
```bash
cd frontend
npx vitest run src/hooks/useFleet.test.ts
npx tsc --noEmit --ignoreDeprecations 5.0
```
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useFleet.ts frontend/src/hooks/useFleet.test.ts
git commit -m "feat(transport): useCreateTruckHead + useCreateTrailer mutation hooks"
```

---

### Task 2: inline "+ Add" in `ShipmentTruckSelector`

**Files:**
- Modify: `frontend/src/components/shipment/ShipmentTruckSelector.tsx`
- Modify: `frontend/src/components/shipment/ShipmentTruckSelector.test.tsx`
- Modify: `frontend/src/i18n/tk.json`, `ru.json`, `en.json`

**Interfaces:**
- Consumes: `useCreateTruckHead`, `useCreateTrailer`, existing `save()`.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/components/shipment/ShipmentTruckSelector.test.tsx` (the file already mocks `@/hooks/useFleet` — extend that mock with the create hooks and `@/hooks/useShipmentPatch`):
```tsx
// extend the existing vi.mock('@/hooks/useFleet', ...) to also export:
//   useCreateTruckHead: () => ({ mutateAsync: createHead }),
//   useCreateTrailer: () => ({ mutateAsync: vi.fn() }),
// where `const createHead = vi.fn().mockResolvedValue({ id: 300, plate_number: '5555AHF', has_gps: false });`
// (declare createHead at module scope alongside the other mock fns)

it('offers "+ Add" for an unknown plate and creates + selects it', async () => {
  wrap(<ShipmentTruckSelector shipment={shipment} readOnly={false} />);
  const heads = screen.getByLabelText(/truck head/i);
  await userEvent.click(heads);
  await userEvent.type(heads, '5555AHF');
  await userEvent.click(await screen.findByText(/add.*5555AHF/i));
  await waitFor(() => expect(createHead).toHaveBeenCalledWith('5555AHF'));
  // after create, the new id is saved onto the shipment
  await waitFor(() =>
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7, fields: expect.objectContaining({ truck_head_id: 300 }) }),
    ),
  );
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/shipment/ShipmentTruckSelector.test.tsx`
Expected: FAIL — no add affordance.

- [ ] **Step 3: Implement the inline-add**

In `ShipmentTruckSelector.tsx`: add `useState` for each select's search text, the two create hooks, and a `dropdownRender` per Select. Concretely:
```tsx
import { useMemo, useState } from 'react';
import { Select, Space, Typography, Button, Divider } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
// ...
import { useTruckHeads, useTrailers, useCreateTruckHead, useCreateTrailer } from '@/hooks/useFleet';
```
Inside the component:
```tsx
  const [headSearch, setHeadSearch] = useState('');
  const [trailerSearch, setTrailerSearch] = useState('');
  const createHead = useCreateTruckHead();
  const createTrailer = useCreateTrailer();

  const norm = (s: string) => s.trim().toUpperCase();
  const headExists = (heads ?? []).some((h) => norm(h.plate_number) === norm(headSearch));
  const trailerExists = (trailers ?? []).some((r) => norm(r.plate_number) === norm(trailerSearch));

  async function addHead() {
    const plate = headSearch.trim();
    if (!plate) return;
    const created = await createHead.mutateAsync(plate);
    setHeadSearch('');
    save(created.id, trailerId);        // link the new truck to the shipment
  }
  async function addTrailer() {
    const plate = trailerSearch.trim();
    if (!plate) return;
    const created = await createTrailer.mutateAsync(plate);
    setTrailerSearch('');
    save(headId, created.id);
  }
```
On the truck-head `<Select>`, add:
```tsx
  onSearch={setHeadSearch}
  dropdownRender={(menu) => (
    <>
      {menu}
      {headSearch.trim() && !headExists && (
        <>
          <Divider style={{ margin: '4px 0' }} />
          <Button type="text" icon={<PlusOutlined />} loading={createHead.isPending}
            style={{ width: '100%', textAlign: 'left' }}
            onMouseDown={(e) => e.preventDefault()} onClick={addHead}>
            {t('shipment_edit_drawer.add_truck', { plate: headSearch.trim() })}
          </Button>
        </>
      )}
    </>
  )}
```
And the analogous block on the trailer `<Select>` (`onSearch={setTrailerSearch}`, `trailerExists`, `addTrailer`, `createTrailer.isPending`, key `add_trailer`). Keep everything else (value/options/onChange/allowClear/disabled) unchanged.

> NOTE: `onMouseDown preventDefault` on the add-button keeps the Select's dropdown from closing/blurring before the click registers — standard AntD dropdownRender pattern.

- [ ] **Step 4: i18n keys**

Add to `en.json` under `shipment_edit_drawer` (and real ru/tk):
```json
"add_truck": "+ Add truck \"{{plate}}\"",
"add_trailer": "+ Add trailer \"{{plate}}\""
```
(ru: «+ Добавить тягач "{{plate}}"» / «+ Добавить прицеп "{{plate}}"»; tk consistent with the file.)

- [ ] **Step 5: Test + type-check**

Run:
```bash
cd frontend
npx vitest run src/components/shipment/ShipmentTruckSelector.test.tsx
npx tsc --noEmit --ignoreDeprecations 5.0
```
Expected: tests PASS; no type errors. Also run the existing `useFleet.test.ts` to confirm still green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/shipment/ShipmentTruckSelector.tsx frontend/src/components/shipment/ShipmentTruckSelector.test.tsx frontend/src/i18n/tk.json frontend/src/i18n/ru.json frontend/src/i18n/en.json
git commit -m "feat(transport): inline + Add for truck-head/trailer in the shipment selector"
```

---

## Self-Review

**Spec coverage (SP3c):**
- Inline "+ Add" for an unknown plate in BOTH selects → Task 2 `dropdownRender` ✓
- Creates via the SP2 endpoints (plate-matches a device automatically) → Task 1 hooks ✓
- After create, auto-selects/links the new truck onto the shipment → `addHead`/`addTrailer` call `save()` ✓
- Editor-only: the selector renders only when `!readOnly` (editor), and the backend `POST` is `CanEditShipment`-gated → inherited, no new gate ✓

**Placeholder scan:** No TBD/TODO. Task 2 Step 1 describes extending the existing mock (the file structure is read at implementation time) but specifies exactly what to add.

**Type consistency:** `useCreateTruckHead().mutateAsync(string) -> Promise<ITruckHead>` / `useCreateTrailer -> Promise<ITrailer>` (Task 1) consumed by `addHead`/`addTrailer` (Task 2). `save(headId, trailerId)` signature unchanged from SP3a. queryKeys match the SP3a list hooks so invalidation refetches the right list.

**Open confirmations for the implementer:**
1. The existing `ShipmentTruckSelector.test.tsx` mock of `@/hooks/useFleet` must be extended (not duplicated) to add the two create hooks; keep the existing `useTruckHeads`/`useTrailers` mock returns.
2. AntD `Select` `onSearch` fires only with `showSearch` (already set); confirm `dropdownRender` is supported in the project's antd version (it is used elsewhere — grep if unsure).
