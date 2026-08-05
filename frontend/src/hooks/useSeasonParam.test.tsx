import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { useRef } from 'react';
import type { ReactNode } from 'react';
import { useSeasonParam } from './useSeasonParam';
import { useSeasonStore } from '@/stores/seasonStore';
import { useAuth } from '@/hooks/useAuth';
import type { ICurrentUser, UserRole } from '@/types';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

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
    can_view_closed_seasons: false,
  };
}

/** Mounts useSeasonParam() alongside a live useSearchParams() read, so the
 * test can assert on the URL the hook actually wrote (not just its return
 * value) without reaching into router internals. */
function useHarness() {
  const seasonParam = useSeasonParam();
  const [searchParams] = useSearchParams();
  return { ...seasonParam, search: searchParams.toString() };
}

/** Same as useHarness, plus a render counter — used to assert the two
 * effects settle instead of oscillating forever (the exact failure mode
 * the brief warned this hook had never been exercised against). */
function useCountingHarness() {
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;
  const harness = useHarness();
  return { ...harness, renderCount: renderCountRef.current };
}

function wrapperWithEntry(entry: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>;
  };
}

describe('useSeasonParam — mount safety (first real caller of Task 13s hook)', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReset();
    useSeasonStore.setState({ selectedSeasonId: null });
  });

  it('(a) mounts safely while auth is unresolved: no crash, seasonId null, URL untouched', () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, isLoading: true, isError: false });

    const { result } = renderHook(() => useHarness(), {
      wrapper: wrapperWithEntry('/export/shipments'),
    });

    expect(result.current.seasonId).toBeNull();
    expect(result.current.isReady).toBe(false);
    expect(result.current.search).toBe('');
  });

  it('(b) a pasted ?season= link wins over the resolved active season', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: fakeUser(1),
      isLoading: false,
      isError: false,
    });

    const { result } = renderHook(() => useHarness(), {
      wrapper: wrapperWithEntry('/export/shipments?season=99'),
    });

    expect(result.current.seasonId).toBe(99);
    expect(result.current.isReady).toBe(true);
    // Not the active season -> the effect that would strip a default value
    // must not fire; the pasted link stays reproducible.
    expect(result.current.search).toBe('season=99');
  });

  it('(c) a store-driven switch to a non-default season writes ?season= to the URL', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: fakeUser(1),
      isLoading: false,
      isError: false,
    });

    const { result } = renderHook(() => useHarness(), {
      wrapper: wrapperWithEntry('/export/shipments'),
    });

    expect(result.current.search).toBe('');

    act(() => {
      useSeasonStore.getState().setSelectedSeasonId(7);
    });

    expect(result.current.seasonId).toBe(7);
    expect(result.current.search).toBe('season=7');
  });

  it('(d) switching back to the active season removes ?season= — no back-button pollution', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: fakeUser(1),
      isLoading: false,
      isError: false,
    });

    const { result } = renderHook(() => useHarness(), {
      wrapper: wrapperWithEntry('/export/shipments?season=7'),
    });

    expect(result.current.seasonId).toBe(7);
    expect(result.current.search).toBe('season=7');

    act(() => {
      useSeasonStore.getState().setSelectedSeasonId(1);
    });

    expect(result.current.seasonId).toBe(1);
    expect(result.current.search).toBe('');
  });

  it('settles within a bounded number of renders instead of oscillating forever', () => {
    // Regression guard for the exact bug (d) above caught: effect 1 (URL ->
    // store) re-firing on every selectedSeasonId change and stomping a
    // store-driven switch back to the stale URL value, which — combined
    // with effect 2 (store -> URL) firing right back — is a two-effect
    // ping-pong that never settles. A few renders per state transition is
    // expected (store update -> URL update -> one more read); dozens would
    // mean the effects are fighting each other again.
    vi.mocked(useAuth).mockReturnValue({
      user: fakeUser(1),
      isLoading: false,
      isError: false,
    });

    const { result } = renderHook(() => useCountingHarness(), {
      wrapper: wrapperWithEntry('/export/shipments?season=7'),
    });

    act(() => {
      useSeasonStore.getState().setSelectedSeasonId(1);
    });
    act(() => {
      useSeasonStore.getState().setSelectedSeasonId(42);
    });
    act(() => {
      useSeasonStore.getState().setSelectedSeasonId(1);
    });

    expect(result.current.seasonId).toBe(1);
    expect(result.current.search).toBe('');
    expect(result.current.renderCount).toBeLessThan(20);
  });
});
