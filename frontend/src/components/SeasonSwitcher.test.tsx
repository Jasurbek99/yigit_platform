import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { SeasonSwitcher } from './SeasonSwitcher';
import { useSeasonStore } from '@/stores/seasonStore';
import { useAuth } from '@/hooks/useAuth';
import { useSeasons } from '@/hooks/useAdmin';
import type { ICurrentUser, ISeason, UserRole } from '@/types';

vi.mock('@/hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('@/hooks/useAdmin', () => ({ useSeasons: vi.fn() }));

function fakeUser(canViewClosed: boolean, role: UserRole = 'export_manager'): ICurrentUser {
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
    active_season: { id: 1, name: '2026/2027', status: 'ACTIVE' },
    can_view_closed_seasons: canViewClosed,
  };
}

function fakeSeason(id: number, status: ISeason['status'], name?: string): ISeason {
  return {
    id,
    name: name ?? `Season ${id}`,
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    is_active: status === 'ACTIVE',
    status,
    closed_at: status === 'CLOSED' ? '2026-07-01T00:00:00Z' : null,
    closed_by: null,
    closed_by_name: null,
  };
}

function renderSwitcher() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/export/shipments']}>
      <QueryClientProvider client={queryClient}>
        <SeasonSwitcher />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('SeasonSwitcher', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    vi.mocked(useAuth).mockReset();
    vi.mocked(useSeasons).mockReset();
    useSeasonStore.setState({ selectedSeasonId: null });
  });

  it('renders nothing when only the active season exists (nothing to switch between)', () => {
    vi.mocked(useAuth).mockReturnValue({ user: fakeUser(true), isLoading: false, isError: false });
    vi.mocked(useSeasons).mockReturnValue({
      data: [fakeSeason(1, 'ACTIVE')],
    } as ReturnType<typeof useSeasons>);

    renderSwitcher();

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('lists an UPCOMING season alongside the ACTIVE one — the bug this component was fixed for', () => {
    // Regression guard: a season deactivated (is_active=False) without being
    // closed (closed_at=None) can still hold real data (see the reported
    // bug: 133 shipments unreachable because this switcher self-hid). The
    // old filter (`status === 'ACTIVE' || (CLOSED && canViewClosed)`) put
    // UPCOMING in neither branch, so `selectable.length` stayed 1 and this
    // component returned null even with two real seasons present.
    vi.mocked(useAuth).mockReturnValue({ user: fakeUser(false), isLoading: false, isError: false });
    vi.mocked(useSeasons).mockReturnValue({
      data: [fakeSeason(1, 'ACTIVE'), fakeSeason(2, 'UPCOMING', '2025-2026')],
    } as ReturnType<typeof useSeasons>);

    renderSwitcher();

    const combobox = screen.getByRole('combobox');
    expect(combobox).toBeInTheDocument();
    fireEvent.mouseDown(combobox);

    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByText('2025-2026')).toBeInTheDocument();
  });

  it('excludes a CLOSED season for a role without can_view_closed_seasons, even when an UPCOMING season is also present', () => {
    vi.mocked(useAuth).mockReturnValue({ user: fakeUser(false), isLoading: false, isError: false });
    vi.mocked(useSeasons).mockReturnValue({
      data: [fakeSeason(1, 'ACTIVE'), fakeSeason(2, 'UPCOMING'), fakeSeason(3, 'CLOSED')],
    } as ReturnType<typeof useSeasons>);

    renderSwitcher();

    fireEvent.mouseDown(screen.getByRole('combobox'));
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByText('Season 2')).toBeInTheDocument();
    expect(within(listbox).queryByText('Season 3')).not.toBeInTheDocument();
  });

  it('includes a CLOSED season for a role with can_view_closed_seasons', () => {
    vi.mocked(useAuth).mockReturnValue({ user: fakeUser(true), isLoading: false, isError: false });
    vi.mocked(useSeasons).mockReturnValue({
      data: [fakeSeason(1, 'ACTIVE'), fakeSeason(3, 'CLOSED')],
    } as ReturnType<typeof useSeasons>);

    renderSwitcher();

    fireEvent.mouseDown(screen.getByRole('combobox'));
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByText('Season 3')).toBeInTheDocument();
  });
});
