import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18n from '@/i18n';
import { ExportFirmSelect } from './ExportFirmSelect';

vi.mock('@/hooks/useAdmin', () => ({
  useAdminFirms: () => ({
    data: [
      { id: 1, code: 'YGT', name_tk: 'Yigit', name_ru: null, name_en: null, is_active: true },
      { id: 2, code: 'OY', name_tk: 'Oguz Yoly', name_ru: null, name_en: null, is_active: true },
    ],
    isLoading: false,
  }),
}));

// Firm 2 is out of quota in every test that opts in; undefined = still loading.
let mockBalances: Record<string, { remaining_kg: number }> | undefined;
vi.mock('@/hooks/useQuotaDashboard', () => ({
  useQuotaFirmBalances: () => ({ data: mockBalances }),
}));

// QuotaPageLink's permission gate. Mocking useAuth also keeps its internal
// useNavigate out of these tests (they render without a Router).
let mockUser: { is_superuser: boolean; page_permissions: Record<string, boolean> } | null = null;
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUser, isLoading: false, isError: false }),
}));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const LINK = 'Open quota page →';

describe('ExportFirmSelect — quota gate', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    mockUser = { is_superuser: false, page_permissions: { 'export.quota': true } };
    mockBalances = { '1': { remaining_kg: 5000 }, '2': { remaining_kg: 0 } };
  });

  it('checkQuota tags the firm with no quota and offers the quota page', async () => {
    wrap(<ExportFirmSelect checkQuota />);
    await userEvent.click(screen.getByRole('combobox'));

    expect(await screen.findByText(/Oguz Yoly · OY ⚠ no quota/)).toBeInTheDocument();
    expect(screen.getByText(LINK).closest('a')).toHaveAttribute('href', '/export/quota');
  });

  it('without checkQuota the same firm is offered plainly — contract screens must not be gated', async () => {
    wrap(<ExportFirmSelect />);
    await userEvent.click(screen.getByRole('combobox'));

    expect(await screen.findByText('Oguz Yoly · OY')).toBeInTheDocument();
    expect(screen.queryByText(LINK)).not.toBeInTheDocument();
  });

  it('no link when every firm still has quota', async () => {
    mockBalances = { '1': { remaining_kg: 5000 }, '2': { remaining_kg: 1200 } };
    wrap(<ExportFirmSelect checkQuota />);
    await userEvent.click(screen.getByRole('combobox'));

    expect(await screen.findByText('Oguz Yoly · OY')).toBeInTheDocument();
    expect(screen.queryByText(LINK)).not.toBeInTheDocument();
  });

  it('a blocked firm cannot be picked', async () => {
    const onChange = vi.fn();
    wrap(<ExportFirmSelect checkQuota onChange={onChange} />);
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByText(/Oguz Yoly · OY ⚠/));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('still offers the link when the blocked firm is the one already selected', async () => {
    // A selected firm is never disabled (so it can be swapped out) — the link
    // must not disappear with it, or that row has no way out.
    wrap(<ExportFirmSelect checkQuota value={2} />);
    await userEvent.click(screen.getByRole('combobox'));

    expect(await screen.findByText(LINK)).toBeInTheDocument();
  });

  it('hides the link from a user without the quota page permission', async () => {
    mockUser = { is_superuser: false, page_permissions: { 'export.shipments': true } };
    wrap(<ExportFirmSelect checkQuota />);
    await userEvent.click(screen.getByRole('combobox'));

    expect(await screen.findByText(/⚠ no quota/)).toBeInTheDocument();
    expect(screen.queryByText(LINK)).not.toBeInTheDocument();
  });
});
