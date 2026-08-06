import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useSeasonReadOnly } from './useSeasonReadOnly';
import { useSeasonStore } from '@/stores/seasonStore';
import { useAuth } from '@/hooks/useAuth';
import type { ICurrentUser, UserRole } from '@/types';

vi.mock('@/hooks/useAuth', () => ({ useAuth: vi.fn() }));

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

function wrapperWithEntry(entry: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>;
  };
}

describe('useSeasonReadOnly', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReset();
    useSeasonStore.setState({ selectedSeasonId: null });
  });

  it('is false when browsing the active season (the default, no ?season=)', () => {
    vi.mocked(useAuth).mockReturnValue({ user: fakeUser(1), isLoading: false, isError: false });

    const { result } = renderHook(() => useSeasonReadOnly(), {
      wrapper: wrapperWithEntry('/export/shipments'),
    });

    expect(result.current).toBe(false);
  });

  it('is true when a pasted ?season= link pins a season other than the active one', () => {
    vi.mocked(useAuth).mockReturnValue({ user: fakeUser(1), isLoading: false, isError: false });

    const { result } = renderHook(() => useSeasonReadOnly(), {
      wrapper: wrapperWithEntry('/export/shipments?season=2'),
    });

    expect(result.current).toBe(true);
  });

  it('is true after a store-driven switch to a non-active season', () => {
    vi.mocked(useAuth).mockReturnValue({ user: fakeUser(1), isLoading: false, isError: false });
    useSeasonStore.setState({ selectedSeasonId: 2 });

    const { result } = renderHook(() => useSeasonReadOnly(), {
      wrapper: wrapperWithEntry('/export/shipments'),
    });

    expect(result.current).toBe(true);
  });

  it('does not depend on any resource-permission-gated data — true for a role with no `season` resource permission at all', () => {
    // Regression guard for the bug this hook was rewritten to avoid: an
    // earlier version resolved the browsed season's `status` via
    // `useSeasons()` (`/export/admin/seasons/`, gated on the `season`
    // resource code). Per `seed_permissions.py`, most operational roles —
    // `finansist` included — hold NO permission on `season` at all (only
    // `admin`/`director`/`export_manager`/`boss` do), so that version would
    // have silently resolved to `false` (fail-OPEN) for them regardless of
    // what season was actually browsed. This hook now needs nothing beyond
    // `/auth/me/`'s `active_season`, which every authenticated role gets.
    vi.mocked(useAuth).mockReturnValue({
      user: fakeUser(1, 'finansist'),
      isLoading: false,
      isError: false,
    });

    const { result } = renderHook(() => useSeasonReadOnly(), {
      wrapper: wrapperWithEntry('/export/shipments?season=2'),
    });

    expect(result.current).toBe(true);
  });

  it("is true during the close->open gap (no active season) — fails closed, matching the backend", () => {
    vi.mocked(useAuth).mockReturnValue({ user: fakeUser(null), isLoading: false, isError: false });

    const { result } = renderHook(() => useSeasonReadOnly(), {
      wrapper: wrapperWithEntry('/export/shipments'),
    });

    expect(result.current).toBe(true);
  });
});
