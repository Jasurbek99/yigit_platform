# TIR Fleet — SP3a (Edit-Drawer Truck/Trailer Selector) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the ShipmentDetail edit surface, replace the free-text `truck_plate` with **truck-head + trailer dropdowns** (from the fleet), which write `truck_head_id`/`trailer_id` and a derived `truck_plate`. **Gapy-Satys shipments keep the plain text field.**

**Architecture:** A dedicated `ShipmentTruckSelector` (two Ant `Select`s backed by new `useTruckHeads`/`useTrailers` hooks) composes `truck_plate = "head/trailer"` and saves all three fields via `useShipmentPatchMulti`. It's injected into `ShipmentDetailStageCards` transport section, shown only when `!shipment.is_gapy_satys` (else the existing `truck_plate` text row renders).

**Tech Stack:** React + TypeScript + Ant Design + TanStack Query; Vitest.

**Scope:** SP3a only (the edit-drawer surface). SP3b (Sheet cell), SP3c (inline "+ Add"), SP4 (admin page) are separate. See `docs/superpowers/plans/2026-08-03-tir-fleet-SP3-handoff.md`.

## Global Constraints

- **WORK IN THE WORKTREE** `D:/projects/yigit_platform-transport-fleet-map` (branch `feat/transport-fleet-map`); the main dir is on another session's branch. Frontend commands from that worktree's `frontend/`.
- **HARD RULE:** `shipment.is_gapy_satys === true` → keep the plain `truck_plate` text row, NO dropdowns, no GPS. Only `!is_gapy_satys` → the selector.
- Type-check: `npx tsc --noEmit --ignoreDeprecations 5.0` (the `npm run type-check` is broken). Test: `npx vitest run <file>`.
- httpOnly-cookie auth via the shared `@/services/api` client; no tokens/localStorage.
- i18n: no hardcoded user-facing strings; add keys to `tk.json`, `ru.json`, `en.json`.
- Backend ready (on branch): `GET /api/v1/transport/truck-heads/?search=` → `[{id, plate_number, owner_type, status, has_gps}]`; `GET /api/v1/transport/trailers/?search=` → `[{id, plate_number, owner_type, status, is_active}]`. `truck_head_id`/`trailer_id` are patchable on `PATCH /export/shipments/<id>/` and present on `IShipmentDetail`.
- Existing patterns to mirror: `frontend/src/hooks/useTransportDevices.ts` (list hook), `frontend/src/hooks/useShipmentPatch.ts` `useShipmentPatchMulti()` (`{id, fields}` → `PATCH /export/shipments/{id}/`, optimistic).

---

### Task 1: `useTruckHeads` + `useTrailers` hooks

**Files:**
- Create: `frontend/src/hooks/useFleet.ts`
- Create: `frontend/src/hooks/useFleet.test.ts`

**Interfaces:**
- Produces: `useTruckHeads(search?)` → `ITruckHead[]`; `useTrailers(search?)` → `ITrailer[]`; interfaces `ITruckHead { id; plate_number; owner_type; status; has_gps }`, `ITrailer { id; plate_number; owner_type; status; is_active }`.

- [ ] **Step 1: Write the failing hook test**

`frontend/src/hooks/useFleet.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useTruckHeads, useTrailers } from './useFleet';
import api from '@/services/api';

vi.mock('@/services/api');

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useFleet', () => {
  beforeEach(() => vi.clearAllMocks());

  it('useTruckHeads fetches the list', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [{ id: 13, plate_number: '3269AHF', owner_type: 'company', status: 'idle', has_gps: true }],
    });
    const { result } = renderHook(() => useTruckHeads(), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data?.[0].plate_number).toBe('3269AHF');
    expect(api.get).toHaveBeenCalledWith('/transport/truck-heads/', { params: {} });
  });

  it('useTrailers passes the search param', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    const { result } = renderHook(() => useTrailers('2602'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith('/transport/trailers/', { params: { search: '2602' } });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/useFleet.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the hooks**

`frontend/src/hooks/useFleet.ts`:
```typescript
import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';

export interface ITruckHead {
  id: number;
  plate_number: string;
  owner_type: string;
  status: string;
  has_gps: boolean;
}

export interface ITrailer {
  id: number;
  plate_number: string;
  owner_type: string;
  status: string;
  is_active: boolean;
}

export function useTruckHeads(search?: string) {
  return useQuery<ITruckHead[]>({
    queryKey: ['transport', 'truck-heads', search ?? ''],
    queryFn: async () => {
      const params = search ? { search } : {};
      const { data } = await api.get<ITruckHead[]>('/transport/truck-heads/', { params });
      return data;
    },
    staleTime: 5 * 60_000,
  });
}

export function useTrailers(search?: string) {
  return useQuery<ITrailer[]>({
    queryKey: ['transport', 'trailers', search ?? ''],
    queryFn: async () => {
      const params = search ? { search } : {};
      const { data } = await api.get<ITrailer[]>('/transport/trailers/', { params });
      return data;
    },
    staleTime: 5 * 60_000,
  });
}
```

- [ ] **Step 4: Run test + type-check**

Run:
```bash
cd frontend
npx vitest run src/hooks/useFleet.test.ts
npx tsc --noEmit --ignoreDeprecations 5.0
```
Expected: test PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useFleet.ts frontend/src/hooks/useFleet.test.ts
git commit -m "feat(transport): useTruckHeads + useTrailers fleet hooks"
```

---

### Task 2: `ShipmentTruckSelector` + drawer injection (gapy-satys-aware)

**Files:**
- Create: `frontend/src/components/shipment/ShipmentTruckSelector.tsx`
- Create: `frontend/src/components/shipment/ShipmentTruckSelector.test.tsx`
- Modify: `frontend/src/components/shipment/ShipmentDetailStageCards.tsx` (inject the selector in the transport section, conditional on `is_gapy_satys`)
- Modify: `frontend/src/i18n/tk.json`, `ru.json`, `en.json`

**Interfaces:**
- Consumes: `useTruckHeads`, `useTrailers`, `useShipmentPatchMulti`, `IShipmentDetail`.
- Produces: `<ShipmentTruckSelector shipment={IShipmentDetail} readOnly={boolean} />`.

- [ ] **Step 1: Write the failing component test**

`frontend/src/components/shipment/ShipmentTruckSelector.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ShipmentTruckSelector } from './ShipmentTruckSelector';

const mutate = vi.fn();
vi.mock('@/hooks/useShipmentPatch', () => ({
  useShipmentPatchMulti: () => ({ mutate }),
}));
vi.mock('@/hooks/useFleet', () => ({
  useTruckHeads: () => ({ data: [
    { id: 13, plate_number: '3269AHF', owner_type: 'company', status: 'idle', has_gps: true },
    { id: 14, plate_number: '4378AHF', owner_type: 'company', status: 'idle', has_gps: true },
  ] }),
  useTrailers: () => ({ data: [{ id: 1, plate_number: '2602TAH', owner_type: 'company', status: 'idle', is_active: true }] }),
}));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const shipment = { id: 7, truck_head_id: 13, trailer_id: 1, is_gapy_satys: false } as any;

describe('ShipmentTruckSelector', () => {
  beforeEach(() => mutate.mockClear());

  it('shows the current head + trailer and derives truck_plate on change', async () => {
    wrap(<ShipmentTruckSelector shipment={shipment} readOnly={false} />);
    // change the truck head to 4378AHF
    const heads = screen.getByLabelText(/truck head/i);
    await userEvent.click(heads);
    await userEvent.click(await screen.findByText('4378AHF'));
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith({
        id: 7,
        fields: { truck_head_id: 14, trailer_id: 1, truck_plate: '4378AHF/2602TAH' },
      }),
    );
  });

  it('is read-only when readOnly', () => {
    wrap(<ShipmentTruckSelector shipment={shipment} readOnly={true} />);
    expect(screen.getByLabelText(/truck head/i)).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/shipment/ShipmentTruckSelector.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 3: Build the selector**

`frontend/src/components/shipment/ShipmentTruckSelector.tsx`:
```tsx
import { useMemo } from 'react';
import { Select, Space, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { IShipmentDetail } from '@/types';
import { useTruckHeads, useTrailers } from '@/hooks/useFleet';
import { useShipmentPatchMulti } from '@/hooks/useShipmentPatch';

export function ShipmentTruckSelector({
  shipment,
  readOnly,
}: {
  shipment: IShipmentDetail;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const { data: heads } = useTruckHeads();
  const { data: trailers } = useTrailers();
  const { mutate } = useShipmentPatchMulti();

  const headOpts = useMemo(
    () => (heads ?? []).map((h) => ({ value: h.id, label: h.plate_number })),
    [heads],
  );
  const trailerOpts = useMemo(
    () => (trailers ?? []).map((r) => ({ value: r.id, label: r.plate_number })),
    [trailers],
  );

  function plateFor(headId: number | null, trailerId: number | null): string {
    const head = heads?.find((h) => h.id === headId)?.plate_number ?? '';
    const trailer = trailers?.find((r) => r.id === trailerId)?.plate_number ?? '';
    return [head, trailer].filter(Boolean).join('/');
  }

  function save(headId: number | null, trailerId: number | null) {
    mutate({
      id: shipment.id,
      fields: {
        truck_head_id: headId,
        trailer_id: trailerId,
        truck_plate: plateFor(headId, trailerId),
      },
    });
  }

  const headId = (shipment.truck_head_id as number | null) ?? null;
  const trailerId = (shipment.trailer_id as number | null) ?? null;

  return (
    <Space direction="vertical" size={4} style={{ width: '100%' }}>
      <div>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('shipment_edit_drawer.field.truck_head')}
        </Typography.Text>
        <Select
          aria-label={t('shipment_edit_drawer.field.truck_head')}
          showSearch
          allowClear
          disabled={readOnly}
          style={{ width: '100%' }}
          value={headId ?? undefined}
          options={headOpts}
          optionFilterProp="label"
          onChange={(v) => save((v as number) ?? null, trailerId)}
          placeholder={t('shipment_edit_drawer.field.truck_head')}
        />
      </div>
      <div>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('shipment_edit_drawer.field.trailer')}
        </Typography.Text>
        <Select
          aria-label={t('shipment_edit_drawer.field.trailer')}
          showSearch
          allowClear
          disabled={readOnly}
          style={{ width: '100%' }}
          value={trailerId ?? undefined}
          options={trailerOpts}
          optionFilterProp="label"
          onChange={(v) => save(headId, (v as number) ?? null)}
          placeholder={t('shipment_edit_drawer.field.trailer')}
        />
      </div>
    </Space>
  );
}
```

- [ ] **Step 4: Inject into the drawer transport section (gapy-satys-aware)**

Open `frontend/src/components/shipment/ShipmentDetailStageCards.tsx`. Find where the `truck_plate` field renders (a `DetailFieldRow` with `config.key === 'truck_plate'` in the transport section). Replace **just that row** with a conditional:
```tsx
{shipment.is_gapy_satys ? (
  <DetailFieldRow shipment={shipment} config={/* the existing truck_plate config */} readOnly={readOnly} .../>
) : (
  <ShipmentTruckSelector shipment={shipment} readOnly={readOnly} />
)}
```
- Import `ShipmentTruckSelector`.
- Reuse whatever `readOnly`/permission flag the neighbouring transport rows already use (do NOT invent a new gate — match the existing `truck_plate` row's readOnly).
- Leave `driver_name`/`driver_phone` and the other transport rows untouched.

> NOTE: keep the existing `truck_plate` `DetailFieldRow` for the Gapy-Satys branch exactly as it is today (same config, same readOnly) — only the non-Gapy-Satys branch swaps in the selector.

- [ ] **Step 5: i18n keys**

Add to `frontend/src/i18n/en.json` under `shipment_edit_drawer.field` (and real ru/tk translations):
```json
"truck_head": "Truck (tractor)",
"trailer": "Trailer"
```
(ru: «Тягач» / «Прицеп»; tk: pick the correct Turkmen terms consistent with the file.)

- [ ] **Step 6: Test + type-check**

Run:
```bash
cd frontend
npx vitest run src/components/shipment/ShipmentTruckSelector.test.tsx
npx tsc --noEmit --ignoreDeprecations 5.0
```
Expected: tests PASS; no type errors.

- [ ] **Step 7: Manual smoke (optional)**

Open a non-Gapy-Satys ShipmentDetail whose truck is in the fleet → two dropdowns showing the current head/trailer; changing one PATCHes ids + `truck_plate`, and the GPS card resolves via `truck_head_id`. Open a Gapy-Satys shipment → plain text field, no dropdowns.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/shipment/ShipmentTruckSelector.tsx frontend/src/components/shipment/ShipmentTruckSelector.test.tsx frontend/src/components/shipment/ShipmentDetailStageCards.tsx frontend/src/i18n/tk.json frontend/src/i18n/ru.json frontend/src/i18n/en.json
git commit -m "feat(transport): truck-head/trailer selector on ShipmentDetail (gapy-satys keeps text)"
```

---

## Self-Review

**Spec coverage (SP3a slice):**
- Fleet dropdowns replace `truck_plate` text on the drawer → Task 2 ✓
- Gapy-Satys keeps text, no GPS → Task 2 conditional ✓
- Writes `truck_head_id`/`trailer_id` + derived `truck_plate` → `ShipmentTruckSelector.save` via `useShipmentPatchMulti` ✓
- Data from the SP2 endpoints → Task 1 hooks ✓
- GPS auto-resolves (resolver's truck_head_id step) — no frontend work needed, it just happens ✓

**Placeholder scan:** Task 2 Step 4 says "find the truck_plate DetailFieldRow" rather than pasting exact line numbers, because that row's surrounding JSX is read at implementation time (the file is large and may have shifted); the change itself (wrap in the `is_gapy_satys` ternary) is fully specified.

**Type consistency:** `ITruckHead`/`ITrailer` (Task 1) match the SP2 response shapes and the selector's option mapping. `useShipmentPatchMulti({id, fields})` matches its real signature (`PATCH /export/shipments/{id}/`). `shipment.truck_head_id`/`trailer_id`/`is_gapy_satys` are on `IShipmentDetail` (confirm the exact field types when implementing; they're in the serializer).

**Open confirmations for the implementer:**
1. The exact `truck_plate` `DetailFieldRow` location + the `readOnly`/permission expression used by the neighbouring transport rows in `ShipmentDetailStageCards.tsx` — reuse it verbatim, don't invent a gate.
2. `IShipmentDetail` exposes `truck_head_id`, `trailer_id`, `is_gapy_satys` (in the serializer `_ALL_PATCHABLE_FIELDS` + fields lists) — confirm the TS type has them; add to the type if missing.
