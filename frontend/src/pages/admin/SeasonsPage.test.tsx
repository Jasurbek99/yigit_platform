import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import SeasonsPage from './SeasonsPage';
import api from '@/services/api';
import { useAuth } from '@/hooks/useAuth';
import type { ICurrentUser, ISeason, SeasonStatus, UserRole } from '@/types';

vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: vi.fn() }));

function fakeUser(role: UserRole = 'admin'): ICurrentUser {
  return {
    id: 1,
    username: 'admin',
    email: '',
    first_name: '',
    last_name: '',
    role,
    is_superuser: false,
    managed_block_ids: [],
    permissions: [],
    page_permissions: {},
    resource_permissions: {
      season: { view: true, create: true, edit: true, delete: true },
    },
    field_permissions: {},
    active_season: { id: 1, name: '2026/2027', status: 'ACTIVE' },
    can_view_closed_seasons: true,
  };
}

function seasonRow(status: SeasonStatus): ISeason {
  return {
    id: 1,
    name: '2026/2027',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    is_active: status === 'ACTIVE',
    status,
    closed_at: status === 'CLOSED' ? '2026-08-01T00:00:00Z' : null,
    closed_by: null,
    closed_by_name: null,
  };
}

function renderPage(rows: ISeason[]): { queryClient: QueryClient } {
  vi.mocked(api.get).mockResolvedValue({ data: rows });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <SeasonsPage />
    </QueryClientProvider>,
  );
  return { queryClient };
}

// Regression coverage for a reopen vector a reviewer found: `Edit` seeds a
// writable `is_active` Switch, so an unguarded Edit button on a CLOSED row
// offered an admin a route to `PATCH {is_active: true}` on a closed season,
// directly reversing the "reopening is unsupported" decision. The server now
// refuses that with a 400 from `SeasonSerializer.validate_is_active()`, but
// hiding Edit keeps the UI from offering an action it will reject.
// `Delete` had the same gap (hard-deletes the row while the close dialog's
// "nothing is deleted" copy is still on screen). Both gated on
// `record.status !== 'CLOSED'` — this test is the one that would catch a
// regression of either gate, not just Close/Open.
describe('SeasonsPage row actions by status', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(useAuth).mockReturnValue({ user: fakeUser(), isLoading: false, isError: false });
  });

  it('ACTIVE: shows Close + Edit + Delete, never Open', async () => {
    renderPage([seasonRow('ACTIVE')]);
    expect(await screen.findByRole('button', { name: 'Close season' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open season' })).not.toBeInTheDocument();
  });

  // Close used to be gated on ACTIVE, and this test pinned that: it asserted
  // UPCOMING shows "never Close". That was the defect, not a guarantee.
  // Opening next year's season demotes this year's to UPCOMING, so under the
  // old gate the season you actually meant to close lost its Close button
  // permanently, while the new season gained one — two wrong seasons were
  // closed that way on 2026-08-22. `close_season()` never required ACTIVE.
  it('UPCOMING: shows Open + Close + Edit + Delete — a deactivated season stays closable', async () => {
    renderPage([seasonRow('UPCOMING')]);
    expect(await screen.findByRole('button', { name: 'Open season' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close season' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('UPCOMING: Open is rendered before Close, so the benign action keeps the leftmost slot', async () => {
    renderPage([seasonRow('UPCOMING')]);
    await screen.findByRole('button', { name: 'Open season' });
    const labels = screen
      .getAllByRole('button')
      .map((b) => b.textContent)
      .filter((label): label is string =>
        ['Open season', 'Close season', 'Edit', 'Delete'].includes(label ?? ''),
      );
    expect(labels).toEqual(['Open season', 'Close season', 'Edit', 'Delete']);
  });

  it('CLOSED: shows none of Close / Open / Edit / Delete', async () => {
    renderPage([seasonRow('CLOSED')]);
    expect(await screen.findByText('2026/2027')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close season' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open season' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });
});

// The Active switch is back on the form (2026-08-10) after being removed in
// dbe9ad8. It is only safe because of two changes it must not regress past:
// the backend routes an `is_active` transition through `open_season()` /
// `deactivate_season()` instead of writing the column (atomic incumbent swap +
// AuditLog row, pinned by `apps.core.tests_season_services`), and
// `useCreateSeason`/`useUpdateSeason` now invalidate EVERY cached query the way
// `useOpenSeason`/`useCloseSeason` do. A targeted `['admin-seasons']`
// invalidate was defect 2: the write target moved in the database while
// `/auth/me/` and every season-scoped list kept serving the old season.
describe('SeasonsPage season form', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.patch).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(useAuth).mockReturnValue({ user: fakeUser(), isLoading: false, isError: false });
  });

  it('create modal offers an Active toggle, defaulted off', async () => {
    const user = userEvent.setup();
    renderPage([seasonRow('ACTIVE')]);
    await user.click(await screen.findByRole('button', { name: /Add season/i }));
    const dialog = await screen.findByRole('dialog');
    const toggle = within(dialog).getByRole('switch');
    expect(toggle).toBeInTheDocument();
    // Creating next year's season must not silently steal the write target.
    expect(toggle).not.toBeChecked();
  });

  it('edit modal seeds the Active toggle from the row', async () => {
    const user = userEvent.setup();
    renderPage([seasonRow('ACTIVE')]);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('switch')).toBeChecked();
  });

  it('ticking Active sends is_active and invalidates every cached query', async () => {
    const user = userEvent.setup();
    vi.mocked(api.patch).mockResolvedValue({ data: seasonRow('ACTIVE') });
    const { queryClient } = renderPage([seasonRow('UPCOMING')]);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('switch'));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => expect(api.patch).toHaveBeenCalled());
    expect(vi.mocked(api.patch).mock.calls[0][1]).toMatchObject({ is_active: true });
    // No key filter — a targeted invalidate leaves `/auth/me/` and every
    // season-scoped list on the old season (defect 2).
    await vi.waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith());
  });
});
