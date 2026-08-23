import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import type { ReactNode } from 'react';
import { toast } from 'sonner';

import { useSeasonFallback } from './useSeasonFallback';
import { useSeasonParam } from './useSeasonParam';
import { useSeasonStore } from '@/stores/seasonStore';
import { useSeasons } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import type { ICurrentUser, ISeason, SeasonStatus, UserRole } from '@/types';

vi.mock('@/hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('@/hooks/useAdmin', () => ({ useSeasons: vi.fn() }));
vi.mock('sonner', () => ({ toast: { info: vi.fn() } }));

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

function fakeSeason(id: number, status: SeasonStatus = 'UPCOMING'): ISeason {
  return {
    id,
    name: `season-${id}`,
    start_date: '2026-08-01',
    end_date: '2027-06-30',
    is_active: status === 'ACTIVE',
    status,
    closed_at: null,
    closed_by: null,
    closed_by_name: null,
  };
}

/** Mounts the hook alongside a live useSearchParams() read, so a test can
 * assert on the URL the hook actually rewrote rather than only the store. */
function useHarness() {
  useSeasonFallback();
  const [searchParams] = useSearchParams();
  return { search: searchParams.toString() };
}

function wrapperWithEntry(entry: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>;
  };
}

/** Shape of the slice of useSeasons() this hook reads. */
function seasonsQuery(
  data: ISeason[] | undefined,
  { isSuccess = true, isFetching = false } = {},
) {
  return { data, isSuccess, isFetching };
}

describe('useSeasonFallback', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReset();
    vi.mocked(useSeasons).mockReset();
    vi.mocked(toast.info).mockReset();
    useSeasonStore.setState({ selectedSeasonId: null });
    vi.mocked(useAuth).mockReturnValue({ user: fakeUser(3), isLoading: false, isError: false });
  });

  it('falls back to the active season when the selected one no longer exists', async () => {
    // The real case: season 2 was deleted, a bookmarked ?season=2 outlived it.
    vi.mocked(useSeasons).mockReturnValue(
      seasonsQuery([fakeSeason(1), fakeSeason(3, 'ACTIVE')]) as ReturnType<typeof useSeasons>,
    );

    const { result } = renderHook(useHarness, { wrapper: wrapperWithEntry('/?season=2') });

    await waitFor(() => expect(useSeasonStore.getState().selectedSeasonId).toBe(3));
    // Active season is the default view, so the param is dropped entirely —
    // otherwise the dead id would be rewritten on the next load.
    expect(result.current.search).toBe('');
    expect(toast.info).toHaveBeenCalledTimes(1);
  });

  it('leaves a season that exists alone', async () => {
    vi.mocked(useSeasons).mockReturnValue(
      seasonsQuery([fakeSeason(1), fakeSeason(3, 'ACTIVE')]) as ReturnType<typeof useSeasons>,
    );

    const { result } = renderHook(useHarness, { wrapper: wrapperWithEntry('/?season=1') });

    await waitFor(() => expect(result.current.search).toBe('season=1'));
    expect(useSeasonStore.getState().selectedSeasonId).toBeNull();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('stays inert while the season list is refetching', async () => {
    // A season the user just created is legitimately absent from a stale
    // cache — switching away from it would look like the create failed.
    vi.mocked(useSeasons).mockReturnValue(
      seasonsQuery([fakeSeason(1), fakeSeason(3, 'ACTIVE')], {
        isFetching: true,
      }) as ReturnType<typeof useSeasons>,
    );

    const { result } = renderHook(useHarness, { wrapper: wrapperWithEntry('/?season=4') });

    await waitFor(() => expect(result.current.search).toBe('season=4'));
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('stays inert when the season list is unreadable for this role', async () => {
    // Roles without season.can_view get an error, not a list. A missing id is
    // then indistinguishable from one this role may not see.
    vi.mocked(useSeasons).mockReturnValue(
      seasonsQuery(undefined, { isSuccess: false }) as ReturnType<typeof useSeasons>,
    );

    const { result } = renderHook(useHarness, { wrapper: wrapperWithEntry('/?season=2') });

    await waitFor(() => expect(result.current.search).toBe('season=2'));
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('redirects once, not twice, with useSeasonParam() mounted alongside it', async () => {
    // AppLayout mounts both, so both sets of URL<->store effects race. This is
    // the arrangement that produced the intermediate render `handledRef`
    // exists for: the store already holds the active season while the URL
    // still holds the dead one, and the URL wins in useSelectedSeason().
    vi.mocked(useSeasons).mockReturnValue(
      seasonsQuery([fakeSeason(1), fakeSeason(3, 'ACTIVE')]) as ReturnType<typeof useSeasons>,
    );

    function useBothHooks() {
      useSeasonParam();
      return useHarness();
    }

    const { result } = renderHook(useBothHooks, { wrapper: wrapperWithEntry('/?season=2') });

    await waitFor(() => expect(result.current.search).toBe(''));
    expect(useSeasonStore.getState().selectedSeasonId).toBe(3);
    expect(toast.info).toHaveBeenCalledTimes(1);
  });

  it('stays inert during the no-active-season gap — there is nothing to fall back to', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: fakeUser(null), isLoading: false, isError: false });
    vi.mocked(useSeasons).mockReturnValue(
      seasonsQuery([fakeSeason(1)]) as ReturnType<typeof useSeasons>,
    );

    const { result } = renderHook(useHarness, { wrapper: wrapperWithEntry('/?season=2') });

    await waitFor(() => expect(result.current.search).toBe('season=2'));
    expect(toast.info).not.toHaveBeenCalled();
  });
});
