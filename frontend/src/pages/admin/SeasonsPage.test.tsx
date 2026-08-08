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

function renderPage(rows: ISeason[]) {
  vi.mocked(api.get).mockResolvedValue({ data: rows });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SeasonsPage />
    </QueryClientProvider>,
  );
}

// Regression coverage for a reopen vector a reviewer found: `Edit` seeds a
// writable `is_active` Switch, and the backend serializer only marks
// `status`/`closed_at`/`closed_by`/`closed_by_name` read-only — so an
// unguarded Edit button on a CLOSED row let an admin PATCH `is_active: true`
// on a closed season, bypassing `open_season()`'s atomicity/audit-log
// entirely and directly reversing the "reopening is unsupported" decision.
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

  it('UPCOMING: shows Open + Edit + Delete, never Close', async () => {
    renderPage([seasonRow('UPCOMING')]);
    expect(await screen.findByRole('button', { name: 'Open season' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close season' })).not.toBeInTheDocument();
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

// `is_active` is server-set. The form used to carry an Active switch defaulted
// to on, which (a) 400'd every create against `uq_season_single_active` while a
// season was already active, and (b) let Edit move the write target through a
// plain PATCH — which never runs `open_season()`/`close_season()`, so there was
// no atomic incumbent swap, no audit row, and `useUpdateSeason` invalidates only
// `['admin-seasons']` so `/auth/me/` and every season-scoped list stayed cached
// on the old season. Open and Close are now the only routes.
describe('SeasonsPage season form', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(useAuth).mockReturnValue({ user: fakeUser(), isLoading: false, isError: false });
  });

  it('create modal has no Active toggle', async () => {
    const user = userEvent.setup();
    renderPage([seasonRow('ACTIVE')]);
    await user.click(await screen.findByRole('button', { name: /Add season/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('switch')).not.toBeInTheDocument();
  });

  it('edit modal has no Active toggle', async () => {
    const user = userEvent.setup();
    renderPage([seasonRow('ACTIVE')]);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('switch')).not.toBeInTheDocument();
  });
});
