import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import api from '@/services/api';
import LotScreen from '../LotScreen';
import { ToastHost } from '../../components/ToastHost';
import { hideToast } from '../../components/toastStore';
import { lotDetailFixture, lotFixture, saleFixture } from '../../testFixtures';
import type { ILotDetail } from '../../types';

vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const ME = { role: 'agent_seller', username: 'aidos', first_name: 'Айдос', customer: null, bazaar: null };
let role = 'agent_seller';
let detail: () => ILotDetail = lotDetailFixture;

function renderLot(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/lots/5']}>
        <Routes><Route path="/lots/:id" element={<LotScreen />} /></Routes>
      </MemoryRouter>
      <ToastHost />
    </QueryClientProvider>,
  );
}

/** The sale row holding `text`. */
function row(text: string | RegExp): HTMLElement {
  const el = screen.getByText(text).closest('.mk-sale');
  if (!(el instanceof HTMLElement)) throw new Error('no sale row');
  return el;
}

const PAYMENT = { id: 41, buyer: { id: 4, name: 'Рустам' }, currency: 'KZT', amount: '5000.00', paid_at: '2026-10-08T11:00:00Z' };

describe('«Отметить оплату» on the lot screen', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ru');
  });

  beforeEach(() => {
    [api.get, api.post, api.delete].forEach((fn) => vi.mocked(fn).mockReset());
    role = 'agent_seller';
    detail = lotDetailFixture;
    vi.mocked(api.get).mockImplementation((url: string) => Promise.resolve({
      data: url === '/market/me/' ? { ...ME, role }
        : url.includes('expense-categories') ? [] : url === '/market/debts/' ? { totals: {}, buyers: [] } : detail(),
    }));
  });

  afterEach(() => act(() => hideToast()));

  it('shows the button to the seller on a debt sale only', async () => {
    renderLot();
    await screen.findByText('Долг: Рустам');
    expect(within(row('Долг: Рустам')).getByRole('button', { name: 'Отметить оплату' })).toBeInTheDocument();
    expect(within(row('12 ящиков, 80,5 кг')).queryByRole('button', { name: 'Отметить оплату' })).not.toBeInTheDocument();
  });

  it('hides the button on a debt sale without a buyer (the server refuses it)', async () => {
    detail = () => ({ ...lotDetailFixture(), sales: [saleFixture({ paid_on_spot: false, due: '3622.50', paid_amount: '0.00' })] });
    renderLot();
    expect(await screen.findByText('Долг', { selector: '.mk-tag' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Отметить оплату' })).not.toBeInTheDocument();
  });

  it('shows the button to the agent', async () => {
    role = 'agent';
    renderLot();
    await screen.findByText('Долг: Рустам');
    expect(screen.getAllByRole('button', { name: 'Отметить оплату' })).toHaveLength(1);
  });

  it('shows «Оплачено» without the button on a debt sale paid off, and what is left on a part-paid one', async () => {
    detail = () => ({
      ...lotDetailFixture(),
      sales: [
        saleFixture({ id: 3, paid_on_spot: false, buyer: { id: 4, name: 'Рустам' }, paid_amount: '3622.50', due: '0.00' }),
        saleFixture({
          id: 4, qty: 20, boxes: 20, net_kg: '130.00', total: '5000.00', paid_on_spot: false,
          buyer: { id: 9, name: 'Бакыт' }, paid_amount: '3500.00', due: '1500.00',
        }),
      ],
    });
    renderLot();
    const paid = await screen.findByText('Оплачено', { selector: '.mk-tag' });
    expect(within(paid.closest('.mk-sale') ?? document.body).queryByRole('button', { name: 'Отметить оплату' }))
      .not.toBeInTheDocument();
    expect(screen.getByText(/^Долг: Бакыт, осталось 1\s500\s₸$/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Отметить оплату' })).toHaveLength(1);
  });

  it('marks the sale paid, shows the toast, and «Отменить» deletes the payment', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ data: { payment: PAYMENT, lot: lotFixture() } });
    vi.mocked(api.delete).mockResolvedValueOnce({ data: { deleted: 41 } });
    const user = userEvent.setup();
    renderLot();
    await screen.findByText('Долг: Рустам');
    await user.click(screen.getByRole('button', { name: 'Отметить оплату' }));
    expect(api.post).toHaveBeenCalledWith('/market/sales/2/mark-paid/', undefined, expect.anything());
    expect(await screen.findByText(/^Оплачено: 5\s000\s₸, Рустам$/)).toBeInTheDocument();
    expect(screen.getByText('Оплачено', { selector: '.mk-tag' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Отметить оплату' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Отменить' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/market/payments/41/', expect.anything()));
  });

  it('disables the button while the request runs', async () => {
    let answer: (v: { data: unknown }) => void = () => undefined;
    vi.mocked(api.post).mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const user = userEvent.setup();
    renderLot();
    await screen.findByText('Долг: Рустам');
    const button = screen.getByRole('button', { name: 'Отметить оплату' });
    await user.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    await user.click(button);
    expect(api.post).toHaveBeenCalledTimes(1);
    await act(async () => answer({ data: { payment: PAYMENT, lot: lotFixture() } }));
    expect(await screen.findByText(/^Оплачено: 5\s000\s₸, Рустам$/)).toBeInTheDocument();
  });

  it('shows the server message when there is nothing to pay', async () => {
    vi.mocked(api.post).mockRejectedValueOnce({
      isAxiosError: true, response: { status: 400, data: { error: 'У покупателя нет долга.' } },
    });
    const user = userEvent.setup();
    renderLot();
    await screen.findByText('Долг: Рустам');
    await user.click(screen.getByRole('button', { name: 'Отметить оплату' }));
    expect(await screen.findByText('У покупателя нет долга.')).toBeInTheDocument();
  });
});
