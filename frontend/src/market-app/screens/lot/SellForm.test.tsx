import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import api from '@/services/api';
import LotScreen from '../LotScreen';
import { ToastHost } from '../../components/ToastHost';
import { hideToast } from '../../components/toastStore';
import { lotDetailFixture, lotFixture, saleFixture } from '../../testFixtures';

vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const ME = { role: 'agent_seller', username: 'aidos', first_name: 'Айдос', customer: null, bazaar: null };

function renderLot() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/lots/5']}>
        <Routes><Route path="/lots/:id" element={<LotScreen />} /></Routes>
      </MemoryRouter>
      <ToastHost />
    </QueryClientProvider>,
  );
}

/** Ten boxes, 104,5 kg on the scale, 45 a kilo. */
async function fillSale(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const qty = await screen.findByLabelText('Сколько ящиков?');
  await user.clear(qty);
  await user.type(qty, '10');
  await user.type(screen.getByLabelText('Вес с ящиками, кг'), '104,5');
  const price = screen.getByLabelText('Цена за 1 кг, ₸');
  await user.clear(price);
  await user.type(price, '45');
}

const saved = (closedAt: string | null = null) => ({
  data: {
    entry: saleFixture({ id: 9, qty: 10, boxes: 10, gross_kg: '104.50', net_kg: '100.00', total: '4500.00' }),
    lot: lotFixture({ closed_at: closedAt }),
  },
});

describe('SellForm', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ru');
  });

  beforeEach(() => {
    [api.get, api.post, api.delete].forEach((fn) => vi.mocked(fn).mockReset());
    vi.mocked(api.get).mockImplementation((url: string) => Promise.resolve({
      data: url === '/market/me/' ? ME : url.includes('/lots/') ? lotDetailFixture() : [],
    }));
  });

  afterEach(() => act(() => hideToast()));

  it('saves a sale, resets the form, and undoes it from the toast', async () => {
    vi.mocked(api.post).mockResolvedValueOnce(saved());
    vi.mocked(api.delete).mockResolvedValueOnce({ data: { lot: lotFixture() } });
    const user = userEvent.setup();
    renderLot();
    await fillSale(user);
    expect(screen.getByText('Чистый вес: 100 кг (минус 10 ящиков по 450 г)')).toBeInTheDocument();
    expect(screen.getByLabelText('Итого, ₸ (можно исправить)')).toHaveValue('4 500');

    const save = screen.getByRole('button', { name: 'Сохранить продажу' });
    act(() => { save.click(); save.click(); }); // same tick: the second press must not post again
    expect(await screen.findByText(/^Сохранено: 10 ящиков, 100 кг, 4\s500\s₸$/)).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/market/lots/5/sales/',
      { unit: 'box', qty: 10, gross_kg: '104.50', price_kg: '45.00', paid_on_spot: true }, expect.anything());
    expect(save).toBeDisabled();
    expect(screen.getByLabelText('Сколько ящиков?')).toHaveValue('1');
    expect(screen.getByLabelText('Вес с ящиками, кг')).toHaveValue('');
    expect(screen.getByLabelText('Цена за 1 кг, ₸')).toHaveValue('45');
    await waitFor(() => expect(save).toBeEnabled());

    await user.click(screen.getByRole('button', { name: 'Отменить' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/market/lots/5/sales/9/', expect.anything()));
  });

  it('shows a server 400 on the weight under the weight field', async () => {
    vi.mocked(api.post).mockRejectedValueOnce({ response: { status: 400, data: { gross_kg: ['Сервер: вес не тот.'] } } });
    const user = userEvent.setup();
    renderLot();
    await fillSale(user);
    await user.click(screen.getByRole('button', { name: 'Сохранить продажу' }));
    const err = await screen.findByText('Сервер: вес не тот.');
    expect(screen.getByLabelText('Вес с ящиками, кг')).toHaveAttribute('aria-describedby', err.id);
    expect(screen.getByRole('button', { name: 'Сохранить продажу' })).toBeEnabled();
  });

  it('asks for the buyer of a debt sale, then creates the buyer and sends its id', async () => {
    vi.mocked(api.post)
      .mockResolvedValueOnce({ data: { id: 4, name: 'Рустам', phone: '' } })
      .mockResolvedValueOnce(saved());
    const user = userEvent.setup();
    renderLot();
    await fillSale(user);
    await user.click(screen.getByRole('button', { name: 'В долг' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить продажу' }));
    expect(await screen.findByText('Укажите покупателя.')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Кто покупает?'), 'Рустам');
    await user.click(screen.getByRole('button', { name: 'Сохранить продажу' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(api.post).toHaveBeenNthCalledWith(1, '/market/buyers/', { name: 'Рустам' }, expect.anything());
    expect(api.post).toHaveBeenNthCalledWith(2, '/market/lots/5/sales/',
      { unit: 'box', qty: 10, gross_kg: '104.50', price_kg: '45.00', paid_on_spot: false, buyer_id: 4 },
      expect.anything());
  });

  it('closes the truck on the last boxes and still undoes from the toast', async () => {
    vi.mocked(api.post).mockResolvedValueOnce(saved('2026-10-08T12:00:00Z'));
    vi.mocked(api.delete).mockResolvedValueOnce({ data: { lot: lotFixture() } });
    const user = userEvent.setup();
    renderLot();
    await fillSale(user);
    await user.click(screen.getByRole('button', { name: 'Сохранить продажу' }));
    expect(await screen.findByText(/Машина закрыта\.$/, { selector: '.mk-toast span' })).toBeInTheDocument();
    expect(screen.getByText('Машина закрыта. Ящиков не осталось.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Сохранить продажу' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Отменить' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/market/lots/5/sales/9/', expect.anything()));
  });

  it('caps the stepper at what is left', async () => {
    const user = userEvent.setup();
    renderLot();
    const qty = await screen.findByLabelText('Сколько ящиков?');
    await user.clear(qty);
    await user.type(qty, '99');
    expect(qty).toHaveValue('68');
    expect(screen.getByText('В машине осталось только 68 ящиков')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Паллета' }));
    expect(screen.getByLabelText('Сколько паллет?')).toHaveValue('1');
    await user.click(screen.getByRole('button', { name: 'На один больше' }));
    expect(screen.getByLabelText('Сколько паллет?')).toHaveValue('1');
    await user.click(screen.getByRole('button', { name: 'Вся машина' }));
    expect(screen.getByText('Всё, что осталось: 68 ящиков')).toBeInTheDocument();
  });
});
