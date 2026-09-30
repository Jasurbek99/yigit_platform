import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import { InvoiceDocumentsButton } from './InvoiceDocumentsButton';

vi.mock('@/hooks/useDocumentDownload', () => ({
  useDocumentDownload: () => ({ isGenerating: false, download: vi.fn() }),
}));

describe('InvoiceDocumentsButton — one document (task card, 2026-09-30)', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });

  it('with docType it is labelled and offers only that document', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <InvoiceDocumentsButton invoiceId={11} docType="ct1_ru" />
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: /CT-1/ }));
    expect(await screen.findByText('Word · RU')).toBeInTheDocument();
    expect(screen.queryByText('Invoice')).toBeNull();
    expect(screen.queryByText('Phytosanitary')).toBeNull();
  });
});
