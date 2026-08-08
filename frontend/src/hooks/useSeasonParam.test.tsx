import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { useRef } from 'react';
import type { ReactNode } from 'react';
import { useSeasonParam, useSelectedSeason, useSwitchSeason } from './useSeasonParam';
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

  it('(e) a logout-style reset to null is NOT written back from a stale ?season=', () => {
    // AppLayout's logout handler resets useSeasonStore so the next user on a
    // shared terminal does not inherit the previous user's season. It runs
    // while AppLayout — and therefore this hook — is still mounted, with the
    // old `?season=` still in the address bar, because navigate('/login') is
    // an SPA transition. If the URL->store effect re-seeded from that stale
    // param, the reset would be silently undone.
    vi.mocked(useAuth).mockReturnValue({
      user: fakeUser(1),
      isLoading: false,
      isError: false,
    });

    const { result } = renderHook(() => useHarness(), {
      wrapper: wrapperWithEntry('/export/shipments?season=7'),
    });

    expect(result.current.seasonId).toBe(7);

    act(() => {
      useSeasonStore.setState({ selectedSeasonId: null });
    });

    expect(result.current.seasonId).toBeNull();
    expect(useSeasonStore.getState().selectedSeasonId).toBeNull();
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

describe('useSelectedSeason — resolves synchronously, independent of useSeasonParam()', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReset();
    useSeasonStore.setState({ selectedSeasonId: null });
  });

  // Every test here deliberately does NOT mount useSeasonParam() — the store
  // is left exactly as AppLayout's effect would find it BEFORE it has run
  // (selectedSeasonId: null, per the beforeEach reset). If useSelectedSeason()
  // depended on that effect having already seeded the store, these would see
  // seasonId: null and fail — proving the double-fetch/flash-of-wrong-season
  // bug (a page's query hook mounts and reads a season before AppLayout's
  // child-before-parent effect ordering lets the sync effect run) is fixed.

  it('resolves the active season from `user` directly on first render, no store seed needed', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: fakeUser(3),
      isLoading: false,
      isError: false,
    });

    const { result } = renderHook(() => useSelectedSeason(), {
      wrapper: wrapperWithEntry('/export/shipments'),
    });

    expect(useSeasonStore.getState().selectedSeasonId).toBeNull(); // store still unseeded
    expect(result.current.seasonId).toBe(3); // but the hook already resolved it
    expect(result.current.isReady).toBe(true);
  });

  it('resolves a pasted ?season= link from the URL directly, no store seed needed', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: fakeUser(1),
      isLoading: false,
      isError: false,
    });

    const { result } = renderHook(() => useSelectedSeason(), {
      wrapper: wrapperWithEntry('/export/shipments?season=99'),
    });

    expect(useSeasonStore.getState().selectedSeasonId).toBeNull(); // store still unseeded
    expect(result.current.seasonId).toBe(99); // URL wins over the (unseeded) store and over `user`
  });

  it('the URL wins over an already-seeded store value', () => {
    useSeasonStore.setState({ selectedSeasonId: 5 });
    vi.mocked(useAuth).mockReturnValue({
      user: fakeUser(1),
      isLoading: false,
      isError: false,
    });

    const { result } = renderHook(() => useSelectedSeason(), {
      wrapper: wrapperWithEntry('/export/shipments?season=99'),
    });

    expect(result.current.seasonId).toBe(99);
  });

  it('an already-seeded store value wins over the active season when the URL is bare', () => {
    useSeasonStore.setState({ selectedSeasonId: 5 });
    vi.mocked(useAuth).mockReturnValue({
      user: fakeUser(1),
      isLoading: false,
      isError: false,
    });

    const { result } = renderHook(() => useSelectedSeason(), {
      wrapper: wrapperWithEntry('/export/shipments'),
    });

    expect(result.current.seasonId).toBe(5);
  });

  it('returns null with isReady false while auth is unresolved, even with a store value seeded', () => {
    useSeasonStore.setState({ selectedSeasonId: 5 });
    vi.mocked(useAuth).mockReturnValue({ user: null, isLoading: true, isError: false });

    const { result } = renderHook(() => useSelectedSeason(), {
      wrapper: wrapperWithEntry('/export/shipments'),
    });

    // seasonId still resolves from the store (isReady, not seasonId, is the
    // gate a query's `enabled` should read) — but isReady is false.
    expect(result.current.seasonId).toBe(5);
    expect(result.current.isReady).toBe(false);
  });
});

/** Mounts useSwitchSeason() alongside a live useSearchParams() read, mirroring
 * useHarness() above — the test asserts on the URL the switch actually wrote. */
function useSwitchHarness() {
  const switchSeason = useSwitchSeason();
  const [searchParams] = useSearchParams();
  return { switchSeason, search: searchParams.toString() };
}

describe('useSwitchSeason — Task 15: updates the store and the URL together, in one commit', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReset();
    useSeasonStore.setState({ selectedSeasonId: null });
  });

  it('switching to a non-active season sets both the store and ?season=', () => {
    vi.mocked(useAuth).mockReturnValue({ user: fakeUser(1), isLoading: false, isError: false });
    const { result } = renderHook(() => useSwitchHarness(), {
      wrapper: wrapperWithEntry('/export/shipments'),
    });

    act(() => {
      result.current.switchSeason(7);
    });

    expect(useSeasonStore.getState().selectedSeasonId).toBe(7);
    expect(result.current.search).toBe('season=7');
  });

  it('switching back to the active season clears the store AND the URL together — no stale ?season= for a render', () => {
    // This is the carried-forward item #2 case: a switch back to the active
    // season implemented as a bare `setSelectedSeasonId(activeId)` (the
    // brief's original ClosedSeasonBanner sample) would leave `?season=7` in
    // the URL for one render, and `useSelectedSeason()` resolves URL-first —
    // so the closed season would keep rendering for that render.
    // `useSwitchSeason()` clears the param in the same handler instead of
    // waiting for `useSeasonParam()`'s store->URL effect to catch up a tick
    // later.
    vi.mocked(useAuth).mockReturnValue({ user: fakeUser(1), isLoading: false, isError: false });
    const { result } = renderHook(() => useSwitchHarness(), {
      wrapper: wrapperWithEntry('/export/shipments?season=7'),
    });
    expect(result.current.search).toBe('season=7');

    act(() => {
      result.current.switchSeason(1);
    });

    expect(useSeasonStore.getState().selectedSeasonId).toBe(1);
    expect(result.current.search).toBe('');
  });

  it('switching to a different non-active season overwrites an existing ?season=, does not append', () => {
    vi.mocked(useAuth).mockReturnValue({ user: fakeUser(1), isLoading: false, isError: false });
    const { result } = renderHook(() => useSwitchHarness(), {
      wrapper: wrapperWithEntry('/export/shipments?season=7'),
    });

    act(() => {
      result.current.switchSeason(9);
    });

    expect(result.current.search).toBe('season=9');
  });
});
