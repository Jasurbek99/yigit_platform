import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useSeasonReadOnly } from './useSeasonReadOnly';
import { useSeasonStore } from '@/stores/seasonStore';
import { useAuth } from '@/hooks/useAuth';
import { useSeasons } from '@/hooks/useAdmin';
import type { ICurrentUser, ISeason, UserRole } from '@/types';

vi.mock('@/hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('@/hooks/useAdmin', () => ({ useSeasons: vi.fn() }));

function fakeUser(activeSeasonId: number | null): ICurrentUser {
  return {
    id: 1,
    username: 'gadam',
    email: '',
    first_name: '',
    last_name: '',
    role: 'export_manager' as UserRole,
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

function wrapperWithEntry(entry: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>;
  };
}

describe('useSeasonReadOnly', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReset();
    vi.mocked(useSeasons).mockReset();
    useSeasonStore.setState({ selectedSeasonId: null });
  });

  it('is false when browsing the active season (the default)', () => {
    vi.mocked(useAuth).mockReturnValue({ user: fakeUser(1), isLoading: false, isError: false });
    vi.mocked(useSeasons).mockReturnValue({
      data: [fakeSeason(1, 'ACTIVE'), fakeSeason(2, 'CLOSED')],
    } as ReturnType<typeof useSeasons>);

    const { result } = renderHook(() => useSeasonReadOnly(), {
      wrapper: wrapperWithEntry('/export/shipments'),
    });

    expect(result.current).toBe(false);
  });

  it('is true when a pasted ?season= link pins a closed season', () => {
    vi.mocked(useAuth).mockReturnValue({ user: fakeUser(1), isLoading: false, isError: false });
    vi.mocked(useSeasons).mockReturnValue({
      data: [fakeSeason(1, 'ACTIVE'), fakeSeason(2, 'CLOSED')],
    } as ReturnType<typeof useSeasons>);

    const { result } = renderHook(() => useSeasonReadOnly(), {
      wrapper: wrapperWithEntry('/export/shipments?season=2'),
    });

    // Resolves from useSelectedSeason() (URL wins), not the raw store value
    // (still null pre-effect) — this is the exact case the docstring calls
    // out: reading the store directly would answer `false` here for a frame.
    expect(result.current).toBe(true);
  });

  it('is true after a store-driven switch to a closed season', () => {
    vi.mocked(useAuth).mockReturnValue({ user: fakeUser(1), isLoading: false, isError: false });
    vi.mocked(useSeasons).mockReturnValue({
      data: [fakeSeason(1, 'ACTIVE'), fakeSeason(2, 'CLOSED')],
    } as ReturnType<typeof useSeasons>);
    useSeasonStore.setState({ selectedSeasonId: 2 });

    const { result } = renderHook(() => useSeasonReadOnly(), {
      wrapper: wrapperWithEntry('/export/shipments'),
    });

    expect(result.current).toBe(true);
  });

  it('is false when the season list has not loaded yet (no false positive on an empty list)', () => {
    vi.mocked(useAuth).mockReturnValue({ user: fakeUser(1), isLoading: false, isError: false });
    vi.mocked(useSeasons).mockReturnValue({ data: undefined } as ReturnType<typeof useSeasons>);

    const { result } = renderHook(() => useSeasonReadOnly(), {
      wrapper: wrapperWithEntry('/export/shipments?season=2'),
    });

    expect(result.current).toBe(false);
  });
});
