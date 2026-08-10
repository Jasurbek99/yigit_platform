import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useSeasonReadOnly } from './useSeasonReadOnly';
import { useSeasonStore } from '@/stores/seasonStore';
import { useAuth } from '@/hooks/useAuth';
import { useSeasons } from '@/hooks/useAdmin';
import type { ICurrentUser, ISeason, UserRole } from '@/types';

vi.mock('@/hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('@/hooks/useAdmin', () => ({ useSeasons: vi.fn() }));

function fakeUser(activeSeasonId: number | null, role: UserRole = 'export_manager'): ICurrentUser {
  return {
    id: 1,
    username: 'gadam',
    email: '',
    first_name: '',
    last_name: '',
    role,
    is_superuser: false,
    managed_block_ids: [],
    permissions: [],
    page_permissions: {},
    resource_permissions: {},
    field_permissions: {},
    active_season:
      activeSeasonId === null
        ? null
        : { id: activeSeasonId, name: '2026/2027', status: 'ACTIVE' },
    can_view_closed_seasons: true,
  };
}

function fakeSeason(id: number, status: ISeason['status']): ISeason {
  return {
    id,
    name: `Season ${id}`,
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    is_active: status === 'ACTIVE',
    status,
    closed_at: status === 'CLOSED' ? '2026-07-01T00:00:00Z' : null,
    closed_by: null,
    closed_by_name: null,
  };
}

function mockSeasons(data: ISeason[] | undefined, isPending = false): void {
  vi.mocked(useSeasons).mockReturnValue({ data, isPending } as ReturnType<typeof useSeasons>);
}

function wrapperWithEntry(entry: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return (
      <MemoryRouter initialEntries={[entry]}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </MemoryRouter>
    );
  };
}

describe('useSeasonReadOnly', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReset();
    vi.mocked(useSeasons).mockReset();
    useSeasonStore.setState({ selectedSeasonId: null });
  });

  it('is false when browsing the active season (the default, no ?season=) — fast path, no seasons list needed', () => {
    vi.mocked(useAuth).mockReturnValue({ user: fakeUser(1), isLoading: false, isError: false });
    mockSeasons(undefined);

    const { result } = renderHook(() => useSeasonReadOnly(), {
      wrapper: wrapperWithEntry('/export/shipments'),
    });

    expect(result.current).toBe(false);
  });

  it('is true when a pasted ?season= link pins a CLOSED season', () => {
    vi.mocked(useAuth).mockReturnValue({ user: fakeUser(1), isLoading: false, isError: false });
    mockSeasons([fakeSeason(1, 'ACTIVE'), fakeSeason(2, 'CLOSED')]);

    const { result } = renderHook(() => useSeasonReadOnly(), {
      wrapper: wrapperWithEntry('/export/shipments?season=2'),
    });

    expect(result.current).toBe(true);
  });

  it('is false — editable — for an UPCOMING season even though it is not the active one', () => {
    // The bug this hook was rewritten to fix: a season that was deactivated
    // (is_active=False) without being closed (closed_at=None) is still
    // writable on the backend (assert_season_open() keys on closed_at only —
    // see apps/core/seasons.py), so "not active" must not mean read-only.
    vi.mocked(useAuth).mockReturnValue({ user: fakeUser(1), isLoading: false, isError: false });
    mockSeasons([fakeSeason(1, 'ACTIVE'), fakeSeason(2, 'UPCOMING')]);

    const { result } = renderHook(() => useSeasonReadOnly(), {
      wrapper: wrapperWithEntry('/export/shipments?season=2'),
    });

    expect(result.current).toBe(false);
  });

  it('is true after a store-driven switch to a CLOSED season', () => {
    vi.mocked(useAuth).mockReturnValue({ user: fakeUser(1), isLoading: false, isError: false });
    mockSeasons([fakeSeason(1, 'ACTIVE'), fakeSeason(2, 'CLOSED')]);
    useSeasonStore.setState({ selectedSeasonId: 2 });

    const { result } = renderHook(() => useSeasonReadOnly(), {
      wrapper: wrapperWithEntry('/export/shipments'),
    });

    expect(result.current).toBe(true);
  });

  it('fails CLOSED (read-only) while the seasons list is still fetching for a non-active season', () => {
    // Deliberate, and the opposite of the resolved-error case below: a cold
    // load into a pasted ?season=<closed id> must not render editable cells
    // for the length of the request — typing in that window would PATCH,
    // 409, and roll back (ShipmentDetail.tsx documents this as the reason
    // the gate exists). Flips to the real answer once the query resolves —
    // a harmless disabled-then-enabled flicker, never the reverse.
    vi.mocked(useAuth).mockReturnValue({ user: fakeUser(1), isLoading: false, isError: false });
    mockSeasons(undefined, true);

    const { result } = renderHook(() => useSeasonReadOnly(), {
      wrapper: wrapperWithEntry('/export/shipments?season=2'),
    });

    expect(result.current).toBe(true);
  });

  it('fails OPEN (editable) once the seasons list has resolved with an error (403) for a non-active season', () => {
    // Deliberate: `closed_season.can_view` (required to browse a CLOSED
    // season at all — resolve_season() in apps/core/seasons.py) is held by
    // exactly the same five roles that also hold `season.can_view`
    // (seed_permissions.py RESOURCE_DEFAULTS: admin/director/export_manager/
    // boss via blanket grant, finansist explicitly). So a role for whom
    // useSeasons() has RESOLVED a 403 provably cannot be looking at a CLOSED
    // season — failing closed here would only ever misfire on a
    // legitimately-open (UPCOMING) season, reproducing the bug this hook
    // exists to fix for a different role (e.g. warehouse_chief opening a
    // pasted link into the UPCOMING season).
    vi.mocked(useAuth).mockReturnValue({
      user: fakeUser(1, 'warehouse_chief'),
      isLoading: false,
      isError: false,
    });
    mockSeasons(undefined, false);

    const { result } = renderHook(() => useSeasonReadOnly(), {
      wrapper: wrapperWithEntry('/export/shipments?season=2'),
    });

    expect(result.current).toBe(false);
  });

  it("is true during the close->open gap (no active season, nothing explicitly selected) — fails closed, matching the backend's empty read scope", () => {
    vi.mocked(useAuth).mockReturnValue({ user: fakeUser(null), isLoading: false, isError: false });
    mockSeasons([]);

    const { result } = renderHook(() => useSeasonReadOnly(), {
      wrapper: wrapperWithEntry('/export/shipments'),
    });

    expect(result.current).toBe(true);
  });
});
