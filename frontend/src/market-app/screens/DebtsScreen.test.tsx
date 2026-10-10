import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import api from '@/services/api';
import { hideToast } from '../components/toastStore';
import { mockDebtsApi, renderDebts } from './debts/debtsTestKit';

vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

function card(name: string): HTMLElement {
  const el = screen.getByRole('heading', { name }).closest('section');
  if (!(el instanceof HTMLElement)) throw new Error(`no card for ${name}`);
  return el;
}

describe('DebtsScreen', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ru');
  });

  afterEach(() => act(() => hideToast()));

  it('shows one big sum per currency and a card per buyer', async () => {
    mockDebtsApi();
    renderDebts();
    expect(await screen.findByRole('heading', { name: 'Долги клиентов' })).toBeInTheDocument();
    expect(screen.getByText('Всего должны')).toBeInTheDocument();
    const sums = document.querySelectorAll('.mk-bigdue');
    expect(Array.from(sums, (s) => s.textContent?.replace(/\s/g, ' '))).toEqual(['1 250 000 ₸', '40 000 ₽']);

    const rustam = within(card('Рустам'));
    expect(rustam.getByText(/^1\s250\s000\s₸$/, { selector: '.mk-client-sum' })).toBeInTheDocument();
    expect(rustam.getByRole('button', { name: 'Принять оплату' })).toBeInTheDocument();
    const sales = card('Рустам').querySelectorAll('.mk-sale');
    expect(sales).toHaveLength(2);
    // Oldest first; the part-paid one says what the whole sale was.
    expect(sales[0]).toHaveTextContent('20 ящиков, 130 кг');
    expect(sales[0]).toHaveTextContent(/26-0101, 7 окт\. 10:00, из 300\s000\s₸/);
    expect(sales[0]).toHaveTextContent(/250\s000\s₸/);
    expect(sales[1]).toHaveTextContent('26-0099, 8 окт. 14:35');
    expect(sales[1]).not.toHaveTextContent('из ');
    expect(rustam.getByText('Оплаты')).toBeInTheDocument();
    expect(rustam.getByText(/^50\s000\s₸, 8 окт\.$/)).toBeInTheDocument();

    const bakyt = card('Бакыт');
    expect(within(bakyt).getByText('Вся машина (68 ящиков)')).toBeInTheDocument();
    expect(within(bakyt).queryByText('Оплаты')).not.toBeInTheDocument();
  });

  it('shows the empty state when nobody owes', async () => {
    mockDebtsApi('agent_seller', { totals: {}, buyers: [] });
    renderDebts();
    expect(await screen.findByText('Долгов нет')).toBeInTheDocument();
    expect(screen.getByText('Никто не должен. Когда продадите в долг, клиент появится здесь.')).toBeInTheDocument();
    expect(screen.queryByText('Всего должны')).not.toBeInTheDocument();
  });

  it('deletes a payment after confirming and refetches the debts', async () => {
    mockDebtsApi();
    vi.mocked(api.delete).mockResolvedValueOnce({ data: { deleted: 35 } });
    const user = userEvent.setup();
    renderDebts();
    await screen.findByRole('heading', { name: 'Рустам' });
    const getsBefore = vi.mocked(api.get).mock.calls.filter(([url]) => url === '/market/debts/').length;
    await user.click(within(card('Рустам')).getByRole('button', { name: 'Удалить' }));
    const sheet = within(screen.getByRole('dialog'));
    expect(sheet.getByRole('heading')).toHaveTextContent('Удалить эту оплату?');
    expect(sheet.getByText(/^Оплата 50\s000\s₸, 8 окт\., Рустам$/)).toBeInTheDocument();
    await user.click(sheet.getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/market/payments/35/', expect.anything()));
    await waitFor(() => {
      const gets = vi.mocked(api.get).mock.calls.filter(([url]) => url === '/market/debts/').length;
      expect(gets).toBeGreaterThan(getsBefore);
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('puts a refused delete into a toast', async () => {
    mockDebtsApi('agent_seller');
    vi.mocked(api.delete).mockRejectedValueOnce({
      response: { status: 403, data: { error: 'Отменить оплату могут её автор или агент.' } },
    });
    const user = userEvent.setup();
    renderDebts();
    await screen.findByRole('heading', { name: 'Рустам' });
    // Sellers see delete on every payment; the server decides (403 for someone else's).
    await user.click(within(card('Рустам')).getByRole('button', { name: 'Удалить' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Удалить' }));
    expect(await screen.findByText('Отменить оплату могут её автор или агент.')).toBeInTheDocument();
  });
});
