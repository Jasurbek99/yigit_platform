import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import api from '@/services/api';
import ScanPage from './ScanPage';

vi.mock('@/services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    // Echo the key plus any interpolation so assertions read the contract, not
    // the wording — the same convention the other page tests use.
    t: (k: string, o?: Record<string, unknown>) =>
      o && typeof o === 'object' && !('defaultValue' in o)
        ? `${k}:${Object.values(o).join(',')}`
        : k,
    i18n: { language: 'en' },
  }),
}));

function renderAt(id = '7') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/scan/${id}`]}>
        <Routes>
          <Route path="/scan/:id" element={<ScanPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const OPEN_STEP = {
  id: 7,
  code: '0000007/26',
  export_code: '12JN121/26',
  status: 'yola_chykdy',
  field: 'border_crossed_at',
};

describe('ScanPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the truck and its current status', async () => {
    (api.get as any).mockResolvedValue({ data: OPEN_STEP });
    renderAt();
    expect(await screen.findByText('12JN121/26')).toBeInTheDocument();
    expect(screen.getByText('0000007/26')).toBeInTheDocument();
    expect(screen.getByText('shipment_status.yola_chykdy')).toBeInTheDocument();
  });

  /** The owner's rule: a scan must ask before it moves the status. */
  it('records nothing on load — only after the confirm dialog is accepted', async () => {
    (api.get as any).mockResolvedValue({ data: OPEN_STEP });
    (api.post as any).mockResolvedValue({ data: { ...OPEN_STEP, recorded: true } });
    renderAt();

    const button = await screen.findByRole('button', {
      name: /scan\.record_button/,
    });
    expect(api.post).not.toHaveBeenCalled();

    await userEvent.click(button);
    expect(await screen.findByText('scan.confirm_title')).toBeInTheDocument();
    // Still nothing written while the dialog is merely open.
    expect(api.post).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'scan.confirm_ok' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/export/shipments/7/scan/', {
        field: 'border_crossed_at',
      }),
    );
  });

  it('cancelling the dialog writes nothing', async () => {
    (api.get as any).mockResolvedValue({ data: OPEN_STEP });
    renderAt();

    await userEvent.click(
      await screen.findByRole('button', { name: /scan\.record_button/ }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'common.cancel' }));

    expect(api.post).not.toHaveBeenCalled();
  });

  it('an already-recorded step shows who and when, and offers no button', async () => {
    (api.get as any).mockResolvedValue({
      data: {
        ...OPEN_STEP,
        field: null,
        already: {
          field: 'border_crossed_at',
          occurred_at: '2026-09-29T08:30:00+05:00',
          recorded_by: 'Myrat T',
        },
      },
    });
    renderAt();

    expect(
      await screen.findByText(/scan\.already_title/),
    ).toBeInTheDocument();
    expect(screen.getByText('scan.already_by:Myrat T')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /scan\.record_button/ }),
    ).toBeNull();
  });

  it('says there is nothing to record when the truck has no open step', async () => {
    (api.get as any).mockResolvedValue({ data: { ...OPEN_STEP, field: null } });
    renderAt();
    expect(await screen.findByText('scan.nothing_to_record')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /scan\.record_button/ }),
    ).toBeNull();
  });

  it('a 403 explains the truck is not accessible instead of rendering a button', async () => {
    (api.get as any).mockRejectedValue({ response: { status: 403 } });
    renderAt();
    expect(await screen.findByText('scan.error_forbidden')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /scan\.record_button/ }),
    ).toBeNull();
  });
});
