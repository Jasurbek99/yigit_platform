import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import api from '@/services/api';
import { hideToast } from '../../components/toastStore';
import { oct } from '../../testFixtures';
import { mockDebtsApi, renderDebts } from './debtsTestKit';

vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const saved = {
  data: {
    payment: { id: 41, buyer: { id: 4, name: 'Рустам' }, currency: 'KZT', amount: '5000.00', paid_at: oct(9, 11) },
    debts_total: { KZT: '1245000.00', RUB: '40000.00' },
  },
};

async function openSheet(user: ReturnType<typeof userEvent.setup>): Promise<HTMLInputElement> {
  const cards = await screen.findAllByRole('button', { name: 'Принять оплату' });
  await user.click(cards[0]);
  const input = within(screen.getByRole('dialog')).getByLabelText('Сколько заплатил?');
  if (!(input instanceof HTMLInputElement)) throw new Error('no amount input');
  return input;
}

describe('PaymentSheet', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ru');
  });

  afterEach(() => act(() => hideToast()));

  it('opens with the whole due, selected, and says the debt will close', async () => {
    mockDebtsApi();
    const user = userEvent.setup();
    renderDebts();
    const input = await openSheet(user);
    const sheet = within(screen.getByRole('dialog'));
    expect(sheet.getByRole('heading')).toHaveTextContent('Оплата: Рустам');
    expect(sheet.getByText(/^Должен: 1\s250\s000\s₸$/)).toBeInTheDocument();
    expect(input.value).toBe('1 250 000');
    expect(input).toHaveFocus();
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]);
    expect(sheet.getByText('Долг будет закрыт полностью.')).toBeInTheDocument();
  });

  it('posts the typed amount, toasts it, and undo deletes the payment', async () => {
    mockDebtsApi();
    vi.mocked(api.post).mockResolvedValueOnce(saved);
    vi.mocked(api.delete).mockResolvedValueOnce({ data: { deleted: 41 } });
    const user = userEvent.setup();
    renderDebts();
    const input = await openSheet(user);
    await user.clear(input);
    await user.type(input, '5000');
    expect(screen.getByText(/^Останется долг: 1\s245\s000\s₸$/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Сохранить оплату' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/market/payments/', { buyer_id: 4, currency: 'KZT', amount: '5000.00' }, expect.anything(),
    ));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByText(/^Оплата 5\s000\s₸, Рустам$/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Отменить' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/market/payments/41/', expect.anything()));
  });

  it('warns on more than the due and records only the due', async () => {
    mockDebtsApi();
    vi.mocked(api.post).mockResolvedValueOnce(saved);
    const user = userEvent.setup();
    renderDebts();
    const input = await openSheet(user);
    await user.clear(input);
    await user.type(input, '2000000');
    expect(screen.getByText(/^Это больше долга\. Запишу 1\s250\s000\s₸\.$/)).toHaveClass('mk-hint--warn');
    await user.click(screen.getByRole('button', { name: 'Сохранить оплату' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/market/payments/', { buyer_id: 4, currency: 'KZT', amount: '1250000.00' }, expect.anything(),
    ));
  });

  it('refuses an empty amount without posting', async () => {
    mockDebtsApi();
    const user = userEvent.setup();
    renderDebts();
    const input = await openSheet(user);
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: 'Сохранить оплату' }));
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveFocus();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('shows the server refusal in the sheet', async () => {
    mockDebtsApi();
    vi.mocked(api.post).mockRejectedValueOnce({ response: { status: 400, data: { error: 'У покупателя нет долга.' } } });
    const user = userEvent.setup();
    renderDebts();
    await openSheet(user);
    await user.click(screen.getByRole('button', { name: 'Сохранить оплату' }));
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('У покупателя нет долга.');
  });
});
