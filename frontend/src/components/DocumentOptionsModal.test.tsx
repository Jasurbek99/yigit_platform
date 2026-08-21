import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import i18n from '@/i18n';
import {
  DocumentOptionsModal,
  applyDocumentOptions,
  type IDocumentOptions,
} from './DocumentOptionsModal';

// The modal's only external reads are the loading-point list and, via the layout
// gear, the saved layouts. Neither affects the option-plumbing under test.
vi.mock('@/hooks/useAdmin', () => ({
  useLoadingLocations: () => ({ data: [{ id: 1, name: 'Kaka' }] }),
}));
vi.mock('@/components/DocumentLayoutPopover', () => ({
  DocumentLayoutPopover: () => null,
}));

function renderModal(props: Partial<React.ComponentProps<typeof DocumentOptionsModal>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DocumentOptionsModal
        open
        isGenerating={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('applyDocumentOptions', () => {
  const base: IDocumentOptions = { highlight: true };

  it('sends nothing for red highlighting, because red is the server default', () => {
    const params = new URLSearchParams();
    applyDocumentOptions(params, base);
    expect(params.has('highlight')).toBe(false);
  });

  it('sends highlight=0 only when the operator opts out', () => {
    const params = new URLSearchParams();
    applyDocumentOptions(params, { ...base, highlight: false });
    expect(params.get('highlight')).toBe('0');
  });

  it('passes the loading point and trims the TIR carnet', () => {
    const params = new URLSearchParams();
    applyDocumentOptions(params, {
      ...base, placeLoading: 'Kaka', tirCarnet: '  TIR-42  ',
    });
    expect(params.get('place_loading')).toBe('Kaka');
    expect(params.get('tir_carnet')).toBe('TIR-42');
  });

  it('omits a blank TIR carnet rather than sending an empty value', () => {
    const params = new URLSearchParams();
    applyDocumentOptions(params, { ...base, tirCarnet: '   ' });
    expect(params.has('tir_carnet')).toBe(false);
  });
});

describe('DocumentOptionsModal', () => {
  beforeEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
  });

  it('defaults the red-highlight toggle to on', () => {
    renderModal();
    expect(screen.getByRole('checkbox', { name: /red/i })).toBeChecked();
  });

  it('reports highlight:false once the operator unticks it', async () => {
    const onConfirm = vi.fn();
    renderModal({ onConfirm });

    await userEvent.click(screen.getByRole('checkbox', { name: /red/i }));
    await userEvent.click(screen.getByRole('button', { name: /download/i }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(onConfirm.mock.calls[0][0]).toMatchObject({ highlight: false });
  });

  it('hides the TIR carnet field unless the document takes one', () => {
    renderModal();
    expect(screen.queryByLabelText(/TIR carnet/i)).not.toBeInTheDocument();

    cleanup();
    renderModal({ withTirCarnet: true });
    expect(screen.getByText(/TIR carnet/i)).toBeInTheDocument();
  });

  it('hides the loading point for the request letters', () => {
    renderModal({ withPlaceLoading: false });
    expect(screen.queryByText(/Place of loading/i)).not.toBeInTheDocument();
  });
});
