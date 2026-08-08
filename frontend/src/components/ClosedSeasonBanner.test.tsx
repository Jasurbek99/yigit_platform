import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { ClosedSeasonBanner } from './ClosedSeasonBanner';
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

function renderBanner(entry: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <QueryClientProvider client={queryClient}>
        <ClosedSeasonBanner />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('ClosedSeasonBanner', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    vi.mocked(useAuth).mockReset();
    vi.mocked(useSeasons).mockReset();
    useSeasonStore.setState({ selectedSeasonId: null });
  });

  it('renders nothing while browsing the active season', () => {
    vi.mocked(useAuth).mockReturnValue({ user: fakeUser(1), isLoading: false, isError: false });
    vi.mocked(useSeasons).mockReturnValue({
      data: [fakeSeason(1, 'ACTIVE')],
    } as ReturnType<typeof useSeasons>);

    renderBanner('/export/shipments');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a distinct, non-closed-season message during the close->open gap, with no "back to active" button', () => {
    vi.mocked(useAuth).mockReturnValue({ user: fakeUser(null), isLoading: false, isError: false });
    vi.mocked(useSeasons).mockReturnValue({ data: [] as ISeason[] } as ReturnType<typeof useSeasons>);

    renderBanner('/export/shipments');

    expect(screen.getByText(/No active season/i)).toBeInTheDocument();
    // Must NOT say "closed" — nothing is closed, there's simply no active season yet.
    expect(screen.queryByText(/Viewing closed season/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /back to active season/i })).not.toBeInTheDocument();
  });

  it('shows the closed-season message with a real name when useSeasons() resolves it', () => {
    vi.mocked(useAuth).mockReturnValue({ user: fakeUser(1), isLoading: false, isError: false });
    vi.mocked(useSeasons).mockReturnValue({
      data: [fakeSeason(1, 'ACTIVE'), fakeSeason(2, 'CLOSED')],
    } as ReturnType<typeof useSeasons>);

    renderBanner('/export/shipments?season=2');

    expect(screen.getByText(/Viewing closed season Season 2/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /back to active season/i })).toBeInTheDocument();
  });

  it('falls back to the raw season id, not a blank name, when useSeasons() 403s (finansist)', () => {
    // Regression guard for the reviewer-found bug: `useSeasons()` is gated on
    // the `season` resource permission, which `finansist` does not hold (only
    // `closed_season`, a different resource code) — so `data` stays `[]` for
    // them even though they ARE permitted to browse this closed season.
    vi.mocked(useAuth).mockReturnValue({
      user: fakeUser(1, 'finansist'),
      isLoading: false,
      isError: false,
    });
    vi.mocked(useSeasons).mockReturnValue({ data: [] as ISeason[] } as ReturnType<typeof useSeasons>);

    renderBanner('/export/shipments?season=2');

    expect(screen.getByText(/Viewing closed season #2/i)).toBeInTheDocument();
    // The button must still work even though the display name is missing.
    expect(screen.getByRole('button', { name: /back to active season/i })).toBeInTheDocument();
  });

  it('shows the partial-view notice for a role without archive access', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: fakeUser(1, 'sales_rep'),
      isLoading: false,
      isError: false,
    });
    vi.mocked(useSeasons).mockReturnValue({
      data: [fakeSeason(1, 'ACTIVE'), fakeSeason(2, 'CLOSED')],
    } as ReturnType<typeof useSeasons>);

    renderBanner('/export/shipments?season=2');

    expect(screen.getByText(/Archived records are not shown in this view/i)).toBeInTheDocument();
  });

  it('omits the partial-view notice for a role with archive access', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: fakeUser(1, 'director'),
      isLoading: false,
      isError: false,
    });
    vi.mocked(useSeasons).mockReturnValue({
      data: [fakeSeason(1, 'ACTIVE'), fakeSeason(2, 'CLOSED')],
    } as ReturnType<typeof useSeasons>);

    renderBanner('/export/shipments?season=2');

    expect(screen.queryByText(/Archived records are not shown in this view/i)).not.toBeInTheDocument();
  });
});
