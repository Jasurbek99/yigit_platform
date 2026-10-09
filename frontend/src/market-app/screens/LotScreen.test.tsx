import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import api from '@/services/api';
import LotScreen from './LotScreen';
import { lotDetailFixture } from '../testFixtures';
import type { ILotDetail } from '../types';

vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

let me = { role: 'agent_seller', username: 'aidos', first_name: 'Айдос', customer: null, bazaar: null };
let detail: () => ILotDetail = lotDetailFixture;

function renderLot() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/lots/5']}>
        <Routes>
          <Route path="/lots/:id" element={<LotScreen />} />
          <Route path="/" element={<p>home</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LotScreen', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ru');
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 8, 16, 0));
    vi.mocked(api.get).mockReset();
    me = { ...me, role: 'agent_seller' };
    detail = lotDetailFixture;
    vi.mocked(api.get).mockImplementation((url: string) => Promise.resolve({
      data: url === '/market/me/' ? me
        : url.includes('expense-categories') ? [{ id: 3, code: 'INTERES', label: 'Комиссия' }] : detail(),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the truck, what is left and the stats', async () => {
    renderLot();
    expect(await screen.findByRole('heading', { level: 1, name: '26-0101' })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/market/lots/5/');
    expect(screen.getByRole('link', { name: /Машины/ })).toHaveAttribute('href', '/');
    expect(screen.getByRole('img')).toHaveAccessibleName('Осталось 68 из 100 ящиков');
    expect(document.querySelector('.mk-leftline')).toHaveTextContent('68 ящиков осталось из 100');
    expect(screen.getByText('Вес без ящиков').nextSibling).toHaveTextContent('210,5 кг');
    expect(screen.getByText('Продажи').nextSibling).toHaveTextContent('8 622,5 ₸');
    expect(screen.getByText('После расходов').nextSibling).toHaveTextContent('7 622,5 ₸');
    expect(screen.getByText('Разница с формулой').nextSibling).toHaveTextContent('−200 ₸');
  });

  it('groups the entries by day with the day totals', async () => {
    renderLot();
    const today = await screen.findByText('Сегодня, 8 октября');
    expect(screen.getByText('7 октября')).toBeInTheDocument();
    expect(today.nextSibling).toHaveTextContent('2 622,5 ₸');
    expect(screen.getByText('Продажи 3 622,5 ₸, расходы 1 000 ₸, 80,5 кг, средняя цена 45 ₸')).toBeInTheDocument();
    expect(screen.getByText('Продажи 5 000 ₸, 130 кг, средняя цена 38,46 ₸')).toBeInTheDocument();
  });

  it('shows each sale, the debt buyer and the expense', async () => {
    renderLot();
    expect(await screen.findByText('12 ящиков, 80,5 кг')).toBeInTheDocument();
    expect(screen.getByText('14:35, 45 ₸ за 1 кг')).toBeInTheDocument();
    expect(screen.getByText('Долг: Рустам')).toBeInTheDocument();
    expect(screen.getByText('10:00, 40 ₸ за 1 кг, по формуле 5 200 ₸ (−200 ₸)')).toBeInTheDocument();
    const expense = await screen.findByText('Расход: Комиссия');
    expect(expense.closest('.mk-sale--cost')).toHaveTextContent('15:00−1 000 ₸');
  });

  it('puts the sell form in the left column for the seller of the lot', async () => {
    renderLot();
    expect(await screen.findByRole('button', { name: 'Сохранить продажу' })).toBeInTheDocument();
    expect(document.querySelector('[data-slot="lot-form"]')).toContainElement(screen.getByText('Что продаёте?'));
  });

  it('leaves the slot empty for the agent, who does not sell', async () => {
    me = { ...me, role: 'agent' };
    renderLot();
    await screen.findByText('Сегодня, 8 октября');
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/market/me/'));
    expect(screen.queryByText('Что продаёте?')).not.toBeInTheDocument();
    expect(document.querySelector('[data-slot="lot-form"]')).toBeEmptyDOMElement();
  });

  it('shows «Машина закрыта» instead of the form on a closed lot', async () => {
    detail = () => ({ ...lotDetailFixture(), closed_at: '2026-10-08T12:00:00Z' });
    renderLot();
    expect(await screen.findByText('Машина закрыта. Ящиков не осталось.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Сохранить продажу' })).not.toBeInTheDocument();
  });

  it('shows «Пусть агент укажет…» instead of the form while the receipt is missing', async () => {
    detail = () => ({ ...lotDetailFixture(), needs_receipt: true });
    renderLot();
    expect(await screen.findByText('Пусть агент укажет, сколько ящиков пришло.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Сохранить продажу' })).not.toBeInTheDocument();
  });
});
