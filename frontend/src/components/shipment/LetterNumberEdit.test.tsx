import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import api from '@/services/api';
import { toast } from 'sonner';
import { LetterNumberEdit } from './LetterNumberEdit';

vi.mock('@/services/api');
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mockPatch = api.patch as unknown as ReturnType<typeof vi.fn>;

function renderEdit(props: Partial<Parameters<typeof LetterNumberEdit>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LetterNumberEdit saleId={7} field="ct1_number" value={15} canEdit {...props} />
    </QueryClientProvider>,
  );
}

const editButton = () => screen.getByRole('button', { name: i18n.t('shipment_detail.docs.letter_number_edit') });

describe('LetterNumberEdit', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows the number', () => {
    renderEdit();
    expect(screen.getByText('№ 15')).toBeTruthy();
  });

  it('renders nothing without a number', () => {
    const { container } = renderEdit({ value: null });
    expect(container.textContent).toBe('');
  });

  it('saves a corrected number', async () => {
    mockPatch.mockResolvedValue({ data: { id: 7, ct1_number: 20 } });
    renderEdit();
    fireEvent.click(editButton());
    fireEvent.change(await screen.findByRole('spinbutton'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.save') }));
    await waitFor(() =>
      expect(mockPatch).toHaveBeenCalledWith('/contracts/sales/7/letter-numbers/', { ct1_number: 20 }),
    );
  });

  it('shows the server reason when the number is taken', async () => {
    mockPatch.mockRejectedValue({ response: { data: { error: 'taken' } } });
    renderEdit();
    fireEvent.click(editButton());
    fireEvent.change(await screen.findByRole('spinbutton'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.save') }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('taken'));
  });

  it('offers no edit without the right', () => {
    renderEdit({ canEdit: false });
    expect(screen.getByText('№ 15')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
