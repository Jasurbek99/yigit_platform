# Join Two Drafts from the List Page (Phase B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the Shipment List, let a privileged user tick two draft rows and click **Join drafts** to merge the supply half into the destination half via the existing join endpoint.

**Architecture:** Frontend-only over the unchanged `POST /export/shipments/{target}/join/`. A pure `detectJoinDirection` helper (built on Phase A's `joinHelpers` classifiers) decides target-vs-source; a new `JoinDraftsModal` fetches the two selected drafts' details, auto-detects direction, previews, and confirms via `useJoinShipments`; a pure `canJoinDrafts` gate decides when the bulk-bar button shows.

**Tech Stack:** React 18 + TypeScript (strict), Ant Design, TanStack Query, react-i18next, vitest + @testing-library/react, sonner toasts.

## Global Constraints

- **Frontend-only.** No backend change, no endpoint change, no migration. The join endpoint and its guards are unchanged and already covered (`tests_shipment_join.py`, 34/34).
- **Reuse, do not fork:** `isDestinationDraft`/`isSupplyDraft` from `frontend/src/components/sheet/joinHelpers.ts` (take `IJoinClassifiable`; `IShipmentDetail` satisfies it), `useJoinShipments()` from `frontend/src/hooks/useDrafts.ts` (`{ targetId, sourceId } → { id }`, `isPending`), `useShipmentDetail(id)` from `frontend/src/hooks/useShipmentDetail.ts`.
- **Role gate mirrors backend `PRIVILEGED_ROLES` = `{export_manager, director, boss}`** (`apps/export/services/shipment.py:44`) plus `is_superuser`. INCLUDES `boss`.
- **Button also requires:** exactly 2 selected rows, **both** `status_code === 'draft'`, and `!isReadOnly`.
- **i18n strict:** every user-facing string in all three of `tk.json`/`ru.json`/`en.json`, each its own language. New namespace `join_drafts.*`. Reuse `common.cancel` for the modal's Cancel.
- **TS strict:** no `any`; the only `as` in production code is the established error-extraction cast `(err as { response?: { data?: { error?: string } } }).response?.data?.error` (copied verbatim from `JoinSupplyModal`). Test fixtures may cast (consistent with existing test files).
- **≤150 lines per component.**
- **Co-author tag (verbatim, matches Phase A commits):** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

## File Structure

- `frontend/src/components/sheet/joinHelpers.ts` — MODIFY: add pure `detectJoinDirection`. (Task 1)
- `frontend/src/components/sheet/joinHelpers.test.ts` — MODIFY: add direction tests. (Task 1)
- `frontend/src/components/shipment/JoinDraftsModal.tsx` — CREATE: the modal. (Task 2)
- `frontend/src/components/shipment/JoinDraftsModal.test.tsx` — CREATE: modal tests. (Task 2)
- `frontend/src/pages/export/joinDraftsGate.ts` — CREATE: pure `canJoinDrafts` gate. (Task 3)
- `frontend/src/pages/export/joinDraftsGate.test.ts` — CREATE: gate tests. (Task 3)
- `frontend/src/pages/export/ShipmentList.tsx` — MODIFY: bulk-bar button + modal wiring. (Task 3)
- `frontend/src/i18n/{tk,ru,en}.json` — MODIFY: `join_drafts.*` (modal keys Task 2, button key Task 3).
- `docs/obsidian/processes/draft-shipments.md`, `CHANGELOG.md`, `BUILD_TEST_LOG.md` — docs. (Task 4)

---

### Task 1: `detectJoinDirection` pure helper

**Files:**
- Modify: `frontend/src/components/sheet/joinHelpers.ts` (append after `isSupplyDraft`, ends at line 39)
- Test: `frontend/src/components/sheet/joinHelpers.test.ts` (append a new `describe`)

**Interfaces:**
- Consumes: `isDestinationDraft`, `isSupplyDraft`, `IJoinClassifiable` (all already in the file).
- Produces: `export type JoinDirection<T>` and `export function detectJoinDirection<T extends IJoinClassifiable>(a: T, b: T): JoinDirection<T>`. Task 2 consumes `detectJoinDirection`.

- [ ] **Step 1: Write the failing tests** — append to `joinHelpers.test.ts`:

```ts
import { detectJoinDirection } from './joinHelpers';

describe('detectJoinDirection', () => {
  const destination = { status_code: 'draft', country: 1, customer: 2, block_sources: [] };
  const supply = { status_code: 'draft', country: null, customer: null, block_sources: [{ block_id: 5 }] };

  it('detects target=destination, source=supply regardless of argument order', () => {
    expect(detectJoinDirection(destination, supply)).toEqual({ target: destination, source: supply });
    expect(detectJoinDirection(supply, destination)).toEqual({ target: destination, source: supply });
  });
  it('two supplies → ambiguous', () => {
    const supply2 = { status_code: 'draft', country: null, customer: null, block_sources: [{ block_id: 7 }] };
    expect(detectJoinDirection(supply, supply2)).toEqual({ error: 'ambiguous' });
  });
  it('two destinations → ambiguous', () => {
    const dest2 = { status_code: 'draft', country: 3, customer: 4, block_sources: [] };
    expect(detectJoinDirection(destination, dest2)).toEqual({ error: 'ambiguous' });
  });
  it('destination + empty draft (no blocks, no country) → ambiguous', () => {
    const empty = { status_code: 'draft', country: null, customer: null, block_sources: [] };
    expect(detectJoinDirection(destination, empty)).toEqual({ error: 'ambiguous' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/sheet/joinHelpers.test.ts`
Expected: FAIL — `detectJoinDirection is not a function` / import error.

- [ ] **Step 3: Implement** — append to `joinHelpers.ts` (after line 39):

```ts
// ─── Two-draft join direction ────────────────────────────────────────────────

export type JoinDirection<T extends IJoinClassifiable> =
  | { target: T; source: T }
  | { error: 'ambiguous' };

/**
 * Decide which of two drafts is the destination (target, survives) and which is
 * the supply (source, hard-deleted). A clean pair has exactly one destination
 * (country+customer, no blocks) and one supply (has blocks); anything else is
 * ambiguous. Argument order is irrelevant. A single draft can never be both
 * (blocks length can't be 0 and >0 at once), so no over-match is possible.
 */
export function detectJoinDirection<T extends IJoinClassifiable>(a: T, b: T): JoinDirection<T> {
  if (isDestinationDraft(a) && isSupplyDraft(b)) return { target: a, source: b };
  if (isDestinationDraft(b) && isSupplyDraft(a)) return { target: b, source: a };
  return { error: 'ambiguous' };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/components/sheet/joinHelpers.test.ts`
Expected: PASS (existing 3 + new 4 = 7).

Also: `cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0` → clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/sheet/joinHelpers.ts frontend/src/components/sheet/joinHelpers.test.ts
git commit -m "feat(p3): detectJoinDirection helper for two-draft join

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `JoinDraftsModal`

**Files:**
- Create: `frontend/src/components/shipment/JoinDraftsModal.tsx`
- Test: `frontend/src/components/shipment/JoinDraftsModal.test.tsx`
- Modify: `frontend/src/i18n/{tk,ru,en}.json` (add the `join_drafts.*` MODAL keys — not the button key)

**Interfaces:**
- Consumes: `detectJoinDirection` (Task 1); `useShipmentDetail(id)` → `{ data: IShipmentDetail | undefined, isLoading, isError }` (enabled when `id != null`); `useJoinShipments()` → `.mutate({targetId, sourceId}, {onSuccess, onError})`, `.isPending`.
- Produces: `export function JoinDraftsModal(props: { open: boolean; draftIds: readonly [number, number]; onClose: () => void; onSuccess?: () => void })`. Task 3 renders it.
- Field facts: `IShipmentDetail extends IShipmentListItem`, so it carries `id`, `shipment_code`, `country_name`, `customer_name`, `status_code`, `weight_net`, and its own `block_sources: IBlockSource[]` (each `{ block_code: string; weight_kg: number | null; block_id?: number }`). It also carries raw `country`/`customer` FK ids → satisfies `IJoinClassifiable`.

- [ ] **Step 1: Write the failing tests** — `JoinDraftsModal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import { JoinDraftsModal } from './JoinDraftsModal';

const mutate = vi.fn();
vi.mock('@/hooks/useDrafts', () => ({ useJoinShipments: () => ({ mutate, isPending: false }) }));
vi.mock('@/hooks/useShipmentDetail');
import { useShipmentDetail } from '@/hooks/useShipmentDetail';

const destination = {
  id: 1, shipment_code: 'DEST/26', status_code: 'draft',
  country: 10, customer: 20, country_name: 'KZ', customer_name: 'Almaty',
  block_sources: [], weight_net: null,
};
const supply = {
  id: 2, shipment_code: 'SUP/26', status_code: 'draft',
  country: null, customer: null, country_name: null, customer_name: null,
  block_sources: [{ block_id: 5, block_code: 'B1', weight_kg: null }], weight_net: 9000,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stubDetail(byId: Record<number, any>) {
  vi.mocked(useShipmentDetail).mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((id: any) => ({ data: id == null ? undefined : byId[id], isLoading: false, isError: false })) as any,
  );
}

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('JoinDraftsModal', () => {
  beforeEach(() => { mutate.mockReset(); i18n.changeLanguage('en'); });

  it('auto-detects direction and joins supply into destination regardless of id order', async () => {
    stubDetail({ 1: destination, 2: supply });
    // draftIds order [supply, destination] — direction must still resolve correctly
    wrap(<JoinDraftsModal open draftIds={[2, 1]} onClose={() => {}} />);
    expect(screen.getByText('DEST/26')).toBeInTheDocument();
    expect(screen.getByText('SUP/26')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^join$|birleş|объедин/i }));
    expect(mutate).toHaveBeenCalledWith(
      { targetId: 1, sourceId: 2 },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it('two supply-shaped drafts → ambiguity message, confirm disabled, no mutate', async () => {
    const supply2 = { ...supply, id: 3, shipment_code: 'SUP2/26', block_sources: [{ block_id: 8, block_code: 'B2', weight_kg: null }] };
    stubDetail({ 2: supply, 3: supply2 });
    wrap(<JoinDraftsModal open draftIds={[2, 3]} onClose={() => {}} />);
    expect(screen.getByText(/can't tell which draft is the destination/i)).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: /^join$|birleş|объедин/i });
    expect(confirm).toBeDisabled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('surfaces the backend error message on failure', async () => {
    const { toast } = await import('sonner');
    const errorSpy = vi.spyOn(toast, 'error').mockImplementation(() => 'id');
    mutate.mockImplementation((_args, opts) => {
      opts.onError({ response: { data: { error: 'Target already has supply blocks' } } });
    });
    stubDetail({ 1: destination, 2: supply });
    wrap(<JoinDraftsModal open draftIds={[1, 2]} onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /^join$|birleş|объедин/i }));
    expect(errorSpy).toHaveBeenCalledWith('Target already has supply blocks');
  });

  it('shows a spinner while the details are loading', () => {
    vi.mocked(useShipmentDetail).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (() => ({ data: undefined, isLoading: true, isError: false })) as any,
    );
    const { container } = wrap(<JoinDraftsModal open draftIds={[1, 2]} onClose={() => {}} />);
    expect(container.querySelector('.ant-spin')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/shipment/JoinDraftsModal.test.tsx`
Expected: FAIL — cannot resolve `./JoinDraftsModal`.

- [ ] **Step 3a: Add the modal i18n keys** to `frontend/src/i18n/en.json` (new `join_drafts` object; keep alphabetical-ish placement near `join_supply`):

```json
"join_drafts": {
  "title": "Join two drafts",
  "confirm": "Join",
  "destination_label": "Destination (kept)",
  "supply_label": "Supply (deleted)",
  "ambiguous": "Can't tell which draft is the destination. Pick one destination draft (country + customer, no blocks) and one supply draft (with blocks).",
  "fetch_error": "Couldn't load the selected drafts.",
  "toast_success": "Drafts joined.",
  "toast_error": "Couldn't join the drafts."
}
```

`frontend/src/i18n/ru.json`:

```json
"join_drafts": {
  "title": "Объединить два черновика",
  "confirm": "Объединить",
  "destination_label": "Назначение (остаётся)",
  "supply_label": "Поставка (удаляется)",
  "ambiguous": "Не удаётся определить, какой черновик является назначением. Выберите один черновик назначения (страна + клиент, без блоков) и один черновик поставки (с блоками).",
  "fetch_error": "Не удалось загрузить выбранные черновики.",
  "toast_success": "Черновики объединены.",
  "toast_error": "Не удалось объединить черновики."
}
```

`frontend/src/i18n/tk.json`:

```json
"join_drafts": {
  "title": "Iki taslamany birleşdir",
  "confirm": "Birleşdir",
  "destination_label": "Barmaly ýer (galýar)",
  "supply_label": "Üpjünçilik (pozulýar)",
  "ambiguous": "Haýsy taslamanyň barmaly ýerdigini kesgitläp bolmady. Bir barmaly ýer taslamasyny (ýurt + müşderi, bloklar ýok) we bir üpjünçilik taslamasyny (bloklar bilen) saýlaň.",
  "fetch_error": "Saýlanan taslamalary ýükläp bolmady.",
  "toast_success": "Taslamalar birleşdirildi.",
  "toast_error": "Taslamalary birleşdirip bolmady."
}
```

- [ ] **Step 3b: Implement the modal** — `JoinDraftsModal.tsx`:

```tsx
import { Modal, Spin, Typography, Alert } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useShipmentDetail } from '@/hooks/useShipmentDetail';
import { useJoinShipments } from '@/hooks/useDrafts';
import { detectJoinDirection } from '@/components/sheet/joinHelpers';
import { FONT } from '@/constants/styles';

interface IJoinDraftsModalProps {
  readonly open: boolean;
  readonly draftIds: readonly [number, number];
  readonly onClose: () => void;
  readonly onSuccess?: () => void;
}

/** Merge two selected drafts: auto-detects which is the destination (kept) vs the supply (deleted). */
export function JoinDraftsModal({ open, draftIds, onClose, onSuccess }: IJoinDraftsModalProps) {
  const { t } = useTranslation();
  const [idA, idB] = draftIds;
  // Two FIXED hook calls (never in a loop — Rules of Hooks). Gated on `open` so
  // no detail fetch fires until the modal is actually shown.
  const a = useShipmentDetail(open ? idA : undefined);
  const b = useShipmentDetail(open ? idB : undefined);
  const joinMutation = useJoinShipments();

  const loading = a.isLoading || b.isLoading;
  const fetchError = a.isError || b.isError;
  const direction = a.data != null && b.data != null ? detectJoinDirection(a.data, b.data) : null;
  const resolved = direction != null && 'target' in direction ? direction : null;

  function handleJoin() {
    if (resolved == null) return;
    joinMutation.mutate(
      { targetId: resolved.target.id, sourceId: resolved.source.id },
      {
        onSuccess: () => {
          toast.success(t('join_drafts.toast_success'));
          onSuccess?.();
          onClose();
        },
        onError: (err) => {
          const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
          toast.error(msg ?? t('join_drafts.toast_error'));
        },
      },
    );
  }

  return (
    <Modal
      title={t('join_drafts.title')}
      open={open}
      onCancel={onClose}
      onOk={handleJoin}
      okText={t('join_drafts.confirm')}
      cancelText={t('common.cancel')}
      okButtonProps={{ disabled: resolved == null }}
      confirmLoading={joinMutation.isPending}
      destroyOnHidden
    >
      {loading ? (
        <Spin style={{ display: 'block', margin: '24px auto' }} />
      ) : fetchError ? (
        <Alert type="error" showIcon message={t('join_drafts.fetch_error')} />
      ) : resolved == null ? (
        <Alert type="warning" showIcon message={t('join_drafts.ambiguous')} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <Typography.Text type="secondary">{t('join_drafts.destination_label')}</Typography.Text>
            <div>
              <Typography.Text style={{ fontFamily: FONT.mono, fontWeight: 600 }}>
                {resolved.target.shipment_code}
              </Typography.Text>
              <span style={{ marginLeft: 8, color: '#475467', fontSize: 12 }}>
                {resolved.target.country_name ?? '—'} · {resolved.target.customer_name ?? '—'}
              </span>
            </div>
          </div>
          <div>
            <Typography.Text type="secondary">{t('join_drafts.supply_label')}</Typography.Text>
            <div>
              <Typography.Text style={{ fontFamily: FONT.mono, fontWeight: 600 }}>
                {resolved.source.shipment_code}
              </Typography.Text>
              <span style={{ marginLeft: 8, color: '#475467', fontSize: 12 }}>
                {resolved.source.block_sources.map((bs) => bs.block_code).join(', ')}
                {resolved.source.weight_net != null &&
                  ` · ${Number(resolved.source.weight_net).toLocaleString('ru-RU')} kg`}
              </span>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/components/shipment/JoinDraftsModal.test.tsx`
Expected: PASS (4 tests).
Also: `cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0` → clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shipment/JoinDraftsModal.tsx frontend/src/components/shipment/JoinDraftsModal.test.tsx frontend/src/i18n/tk.json frontend/src/i18n/ru.json frontend/src/i18n/en.json
git commit -m "feat(p3): JoinDraftsModal — auto-detect direction + merge two drafts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: List-page gate + wiring

**Files:**
- Create: `frontend/src/pages/export/joinDraftsGate.ts`
- Test: `frontend/src/pages/export/joinDraftsGate.test.ts`
- Modify: `frontend/src/pages/export/ShipmentList.tsx`
- Modify: `frontend/src/i18n/{tk,ru,en}.json` (add `join_drafts.button`)

**Interfaces:**
- Consumes: `JoinDraftsModal` (Task 2); `IShipmentListItem` (has `id`, `status_code`, ...); the page's existing `user` (`ICurrentUser | null` from `useAuth`), `isReadOnly` (`useSeasonReadOnly`), `selectedRowKeys` (`number[]`), `data.results` (`IShipmentListItem[]`), `setSelectedRowKeys`. (`ICurrentUser` has `role: UserRole` and `is_superuser: boolean`.)
- Produces: `export function canJoinDrafts(selectedRows: IShipmentListItem[], user: Pick<ICurrentUser, 'role' | 'is_superuser'> | null, isReadOnly: boolean): boolean`.

- [ ] **Step 1: Write the failing gate tests** — `joinDraftsGate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { canJoinDrafts } from './joinDraftsGate';
import type { ICurrentUser, IShipmentListItem } from '@/types';

const draft = (id: number): IShipmentListItem => ({ id, status_code: 'draft' } as unknown as IShipmentListItem);
const nonDraft = (id: number): IShipmentListItem => ({ id, status_code: 'yuklenme' } as unknown as IShipmentListItem);
// Annotate so `role` stays a UserRole literal (an unannotated const widens it to
// string, which won't assign to Pick<ICurrentUser,'role'>).
const mgr: Pick<ICurrentUser, 'role' | 'is_superuser'> = { role: 'export_manager', is_superuser: false };
const boss: Pick<ICurrentUser, 'role' | 'is_superuser'> = { role: 'boss', is_superuser: false };
const superuser: Pick<ICurrentUser, 'role' | 'is_superuser'> = { role: 'document_team', is_superuser: true };
const clerk: Pick<ICurrentUser, 'role' | 'is_superuser'> = { role: 'document_team', is_superuser: false };

describe('canJoinDrafts', () => {
  it('true for exactly two drafts + a privileged role (incl. boss) when writable', () => {
    expect(canJoinDrafts([draft(1), draft(2)], mgr, false)).toBe(true);
    expect(canJoinDrafts([draft(1), draft(2)], boss, false)).toBe(true);
    expect(canJoinDrafts([draft(1), draft(2)], superuser, false)).toBe(true);
  });
  it('false for a non-privileged role', () => {
    expect(canJoinDrafts([draft(1), draft(2)], clerk, false)).toBe(false);
  });
  it('false when the season is read-only', () => {
    expect(canJoinDrafts([draft(1), draft(2)], mgr, true)).toBe(false);
  });
  it('false when a selected row is not a draft', () => {
    expect(canJoinDrafts([draft(1), nonDraft(2)], mgr, false)).toBe(false);
  });
  it('false when the resolved-row count is not exactly two (≠2 selected or one off-page)', () => {
    expect(canJoinDrafts([draft(1)], mgr, false)).toBe(false);
    expect(canJoinDrafts([draft(1), draft(2), draft(3)], mgr, false)).toBe(false);
  });
  it('false for a null user', () => {
    expect(canJoinDrafts([draft(1), draft(2)], null, false)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/pages/export/joinDraftsGate.test.ts`
Expected: FAIL — cannot resolve `./joinDraftsGate`.

- [ ] **Step 3a: Implement the gate** — `joinDraftsGate.ts`:

```ts
import type { IShipmentListItem, ICurrentUser } from '@/types';

// Mirrors backend PRIVILEGED_ROLES (apps/export/services/shipment.py:44) — the
// only roles the /join/ endpoint accepts. INCLUDES boss.
const JOIN_ROLES: ReadonlyArray<string> = ['export_manager', 'director', 'boss'];

/**
 * Whether the "Join drafts" bulk-bar button should show. True only when a
 * privileged user has resolved exactly two selected rows, both drafts, in a
 * writable season. `selectedRows` are the rows RESOLVED from the current page's
 * data — a selection whose row isn't on the current page resolves to <2 and
 * correctly hides the button (cross-page selection is out of scope).
 */
export function canJoinDrafts(
  selectedRows: IShipmentListItem[],
  user: Pick<ICurrentUser, 'role' | 'is_superuser'> | null,
  isReadOnly: boolean,
): boolean {
  if (isReadOnly || !user) return false;
  if (!(JOIN_ROLES.includes(user.role) || user.is_superuser === true)) return false;
  if (selectedRows.length !== 2) return false;
  return selectedRows.every((r) => r.status_code === 'draft');
}
```

- [ ] **Step 3b: Run gate tests**

Run: `cd frontend && npx vitest run src/pages/export/joinDraftsGate.test.ts`
Expected: PASS.

- [ ] **Step 3c: Add the button i18n key** — add to the existing `join_drafts` object in each file:
  - en: `"button": "Join drafts"`
  - ru: `"button": "Объединить черновики"`
  - tk: `"button": "Taslamalary birleşdir"`

- [ ] **Step 3d: Wire into `ShipmentList.tsx`**

Add import (with the other component imports, ~line 16):

```tsx
import { JoinDraftsModal } from '@/components/shipment/JoinDraftsModal';
import { canJoinDrafts } from './joinDraftsGate';
```

Add state (next to the other `useState`s, ~line 168):

```tsx
const [joinDraftsOpen, setJoinDraftsOpen] = useState(false);
```

Derive the selected rows + gate (after `data` is available, e.g. just after the `const { data, isLoading } = useShipments(...)` block, ~line 244):

```tsx
const selectedRows = (data?.results ?? []).filter((r) => selectedRowKeys.includes(r.id));
const showJoinDrafts = canJoinDrafts(selectedRows, user, isReadOnly);
```

Add the button INSIDE the existing bulk-action bar (the `selectedRowKeys.length > 0` block, before the "Clear" button at ~line 930):

```tsx
{showJoinDrafts && (
  <Button
    size="small"
    onClick={() => setJoinDraftsOpen(true)}
  >
    {t('join_drafts.button')}
  </Button>
)}
```

Render the modal, gated so it only mounts (and only then fetches) when eligible — alongside the other modals (~after the `ShipmentBulkTransitionModal`, ~line 1006):

```tsx
{showJoinDrafts && (
  <JoinDraftsModal
    open={joinDraftsOpen}
    draftIds={[selectedRows[0].id, selectedRows[1].id]}
    onClose={() => setJoinDraftsOpen(false)}
    onSuccess={() => setSelectedRowKeys([])}
  />
)}
```

(`showJoinDrafts` guarantees `selectedRows.length === 2`, so the tuple indices are safe.)

- [ ] **Step 4: Verify typecheck + full suite**

Run: `cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0` → clean.
Run: `cd frontend && npx vitest run src/pages/export/joinDraftsGate.test.ts src/components/shipment/JoinDraftsModal.test.tsx src/components/sheet/joinHelpers.test.ts` → all green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/export/joinDraftsGate.ts frontend/src/pages/export/joinDraftsGate.test.ts frontend/src/pages/export/ShipmentList.tsx frontend/src/i18n/tk.json frontend/src/i18n/ru.json frontend/src/i18n/en.json
git commit -m "feat(p3): Join-drafts button in the Shipment List bulk bar

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Docs

**Files:**
- Modify: `docs/obsidian/processes/draft-shipments.md`, `CHANGELOG.md`, `BUILD_TEST_LOG.md`

- [ ] **Step 1: Update `draft-shipments.md`**

In the join section (right after the Phase A "Join supply outside the Sheet" paragraph added on 2026-08-14), add a paragraph: Join is now ALSO reachable from the **Shipment List** — tick two draft rows, click **Join drafts** in the bulk-action bar; the system auto-detects which is the destination (kept) vs the supply (deleted) and merges via the same `/join/` endpoint. Same role gate (`export_manager`/`director`/`boss`). Keep the Sheet and Detail descriptions intact.

- [ ] **Step 2: CHANGELOG**

Under `[Unreleased]` → `### Added`: a "Join drafts" button in the Shipment List bulk-action bar merges two selected drafts (auto-detected supply→destination) via the existing join endpoint; new `join_drafts.*` i18n block (9 keys) in tk/ru/en (feat(p3) + feat(frontend), Phase B).

- [ ] **Step 3: BUILD_TEST_LOG**

Prepend: `- [ ] 2026-08-15 — Join two drafts from the List page (Phase B): bulk-bar "Join drafts" button + auto-detect JoinDraftsModal — NEEDS TEST`.

- [ ] **Step 4: Commit**

```bash
git add docs/obsidian/processes/draft-shipments.md CHANGELOG.md BUILD_TEST_LOG.md
git commit -m "docs(p3): document Join-drafts on the List page (Phase B)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Report honestly** — state: *"Built — NOT tested in a browser yet. Did you test it?"* Do not tick the build-log item until the user confirms.

---

## Manual acceptance (product owner)
- Filter the list to Drafts (or select any two draft rows). The **Join drafts** button appears in the blue bulk-action bar only when exactly two drafts are selected and you're `export_manager`/`director`/`boss`.
- Click it: a modal shows the auto-detected destination (kept) and supply (deleted) with codes/blocks/weight; confirm merges them — the list refreshes, the supply row is gone, the destination now has the blocks.
- Select two supply drafts (both with blocks) → the modal shows the "can't tell which is the destination" message and Confirm is disabled.
- A backend rejection (racing another join) shows the backend's error message.
- All new strings appear in tk/ru/en; the button is absent for a non-privileged role and when the season is read-only.

## Self-review notes
**Spec coverage:** §2/§3 gate → Task 3 (`canJoinDrafts` + wiring). §4 modal (fetch, auto-detect, preview, states, errors, i18n) → Task 2. §5 reuse + `detectJoinDirection` → Task 1. §6 data source (2 detail fetches) → Task 2. §7 testing → each task is TDD (direction helper, modal, gate). §8 out-of-scope respected (no backend, no reverse/manual, no same-season guard). §9 risks: cross-page selection handled by resolved-row count in the gate.
**Deferred/known:** no `ShipmentList.test.tsx` exists; the gate is verified via the pure `canJoinDrafts` unit test rather than a full-page render (better test design, avoids mocking the page's ~8 hooks). The same-season backend guard gap is out of scope (pre-existing).
