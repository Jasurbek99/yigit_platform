import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import i18n from '@/i18n';
import { TirCarnetButton } from './TirCarnetButton';

// Typed parameter so the assertions below can read back the requested URL.
const download = vi.fn(async (_path: string) => true);

vi.mock('@/hooks/useDocumentDownload', () => ({
  useDocumentDownload: () => ({ isGenerating: false, download }),
}));

function renderButton() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TirCarnetButton shipmentId={7} />
    </QueryClientProvider>,
  );
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /TIR/ }));
}

describe('TirCarnetButton', () => {
  beforeEach(async () => {
    download.mockClear();
    cleanup();
    await i18n.changeLanguage('en');
  });

  it('offers Excel and PDF only, with no Word variant', async () => {
    const user = userEvent.setup();
    renderButton();
    await openMenu(user);

    expect(await screen.findByText('Excel')).toBeInTheDocument();
    expect(await screen.findByText('PDF')).toBeInTheDocument();
    // The carnet has no Word form — the source sheet has no borders to derive one.
    expect(screen.queryByText('Word')).toBeNull();
    // A missing i18n key would surface here as the raw `documents.tir`.
    expect(screen.queryByText(/documents\./)).toBeNull();
  });

  it('defaults to the spreadsheet, which is the carnet overlay itself', async () => {
    const user = userEvent.setup();
    renderButton();
    await openMenu(user);
    await user.click(await screen.findByText('Excel'));
    await user.click(await screen.findByRole('button', { name: /Download/i }));

    expect(download).toHaveBeenCalledWith('/contracts/shipments/7/tir/?fmt=xlsx');
  });

  it('sends the typed values, including the border-point fallback', async () => {
    const user = userEvent.setup();
    renderButton();
    await openMenu(user);
    await user.click(await screen.findByText('Excel'));

    await user.type(await screen.findByLabelText('Border point'), 'Farap');
    await user.type(screen.getByLabelText('CMR №'), 'DA1301245');
    await user.type(screen.getByLabelText('Driver passport №'), 'A3192661');
    await user.click(screen.getByRole('button', { name: /Download/i }));

    const url = download.mock.calls[0][0];
    expect(url).toContain('border_point=Farap');
    expect(url).toContain('cmr_number=DA1301245');
    expect(url).toContain('driver_passport=A3192661');
  });

  it('omits blank fields rather than sending empty params', async () => {
    const user = userEvent.setup();
    renderButton();
    await openMenu(user);
    await user.click(await screen.findByText('PDF'));
    await user.click(await screen.findByRole('button', { name: /Download/i }));

    expect(download).toHaveBeenCalledWith('/contracts/shipments/7/tir/?fmt=pdf');
  });

  it('sends the opt-out only when red highlighting is unchecked', async () => {
    const user = userEvent.setup();
    renderButton();
    await openMenu(user);
    await user.click(await screen.findByText('Excel'));
    await user.click(await screen.findByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /Download/i }));

    expect(download.mock.calls[0][0]).toContain('highlight=0');
  });
});
