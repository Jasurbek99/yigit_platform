import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import i18n from '@/i18n';
import { CmrDocumentsButton } from './CmrDocumentsButton';

const download = vi.fn(async () => true);

vi.mock('@/hooks/useDocumentDownload', () => ({
  useDocumentDownload: () => ({ isGenerating: false, download }),
}));
// The modal is exercised by its own test; here it only has to hand back options.
vi.mock('@/components/DocumentOptionsModal', () => ({
  DocumentOptionsModal: ({ open, onConfirm }: {
    open: boolean;
    onConfirm: (o: { highlight: boolean }) => void;
  }) =>
    open ? (
      <button type="button" onClick={() => onConfirm({ highlight: true })}>
        confirm
      </button>
    ) : null,
  applyDocumentOptions: () => undefined,
}));

function renderButton() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CmrDocumentsButton shipmentId={7} />
    </QueryClientProvider>,
  );
}

describe('CmrDocumentsButton', () => {
  beforeEach(async () => {
    download.mockClear();
    cleanup();
    await i18n.changeLanguage('en');
  });

  it('offers Word, PDF and Excel in both languages, Word first', async () => {
    const user = userEvent.setup();
    renderButton();
    await user.click(screen.getByRole('button', { name: /CMR/ }));

    // Six entries, and the labels are translated — a missing i18n key would
    // surface here as the raw `documents.excel`, which no other test can see.
    for (const label of [
      'Word · RU', 'PDF · RU', 'Excel · RU',
      'Word · EN', 'PDF · EN', 'Excel · EN',
    ]) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByText(/documents\./)).toBeNull();
  });

  it('asks the server for the spreadsheet overlay when Excel is picked', async () => {
    const user = userEvent.setup();
    renderButton();
    await user.click(screen.getByRole('button', { name: /CMR/ }));
    await user.click(await screen.findByText('Excel · EN'));
    await user.click(await screen.findByText('confirm'));

    expect(download).toHaveBeenCalledWith(
      expect.stringContaining('/contracts/shipments/7/cmr/?lang=en&fmt=xlsx'),
    );
  });
});
