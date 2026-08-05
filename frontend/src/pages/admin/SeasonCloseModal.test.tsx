import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import { SeasonCloseModal } from './SeasonCloseModal';
import api from '@/services/api';
import type { ISeason, ISeasonClosePreview } from '@/types';

vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

const SEASON: ISeason = {
  id: 7,
  name: '2026/2027',
  start_date: '2026-01-01',
  end_date: '2026-12-31',
  is_active: true,
  status: 'ACTIVE',
  closed_at: null,
  closed_by: null,
  closed_by_name: null,
};

const PREVIEW: ISeasonClosePreview = {
  drafts: 3,
  in_transit: 14,
  open_tasks: 5,
  unfinished_plans: 2,
};

function renderModal(season: ISeason | null, onClose: () => void = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SeasonCloseModal season={season} onClose={onClose} />
    </QueryClientProvider>,
  );
}

describe('SeasonCloseModal', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
  });

  it('renders nothing (closed) when season is null', () => {
    renderModal(null);
    expect(screen.queryByText(/Close .*\?/)).not.toBeInTheDocument();
  });

  it('disables the confirm button while the preview is loading', async () => {
    vi.mocked(api.get).mockReturnValueOnce(new Promise(() => {})); // never resolves
    renderModal(SEASON);

    expect(await screen.findByText('Close 2026/2027?')).toBeInTheDocument();
    const confirmButton = screen.getByRole('button', { name: 'Close season' });
    expect(confirmButton).toBeDisabled();
  });

  it('renders the real preview counts in the body and enables confirm once loaded', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: PREVIEW });
    renderModal(SEASON);

    expect(
      await screen.findByText(
        'Closing 2026/2027 will hide 3 draft shipments, 14 shipments in transit, ' +
          '5 open tasks, and 2 weekly plans still missing reported actuals. Nothing is ' +
          'deleted — every record stays exactly as it is and reappears, read-only, ' +
          'whenever 2026/2027 is selected in the season switcher.',
      ),
    ).toBeInTheDocument();

    const confirmButton = screen.getByRole('button', { name: 'Close season' });
    expect(confirmButton).not.toBeDisabled();
  });

  it('disables confirm and offers retry when the preview fails to load', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('network error'));
    renderModal(SEASON);

    expect(await screen.findByText('Failed to load the close preview counts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close season' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('posts to the close endpoint and calls onClose on confirm', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: PREVIEW });
    vi.mocked(api.post).mockResolvedValueOnce({ data: { ...SEASON, status: 'CLOSED' } });
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderModal(SEASON, onClose);

    await screen.findByText(/Closing 2026\/2027 will hide/);
    await user.click(screen.getByRole('button', { name: 'Close season' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/export/admin/seasons/7/close/');
      expect(onClose).toHaveBeenCalled();
    });
  });
});
