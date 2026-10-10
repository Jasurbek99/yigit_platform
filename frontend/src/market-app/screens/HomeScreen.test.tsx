import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import api from '@/services/api';
import HomeScreen from './HomeScreen';
import { lotFixture, oct, page } from '../testFixtures';

vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const closedLot = lotFixture({
  id: 6, closed_at: oct(5, 12), totals: { ...lotFixture().totals, spoiled_boxes: 3, spoiled_kg: '20.00' },
  shipment: { id: 8, code: '26-0099', export_code: null, status_code: 'satyldy', product: { code: 'pepper', name_ru: 'Перец' } },
});
const shipments = [
  { id: 11, code: '26-0120', export_code: 'EX-20', status_code: 'bardy', box_count: 900, pallet_count: 18, product: null, lot_id: null },
  { id: 9, code: '26-0101', export_code: 'EX-17', status_code: 'satylyar', box_count: 100, pallet_count: 2, product: null, lot_id: 5 },
];

function mockApi(role: string): void {
  vi.mocked(api.get).mockImplementation((url: string, config?: { params?: { state?: string } }) => {
    if (url === '/market/me/') return Promise.resolve({ data: { role, username: 'u', first_name: 'Нурлан', customer: null, bazaar: null } });
    if (url === '/market/shipments/') return Promise.resolve({ data: shipments });
    return Promise.resolve(page(config?.params?.state === 'closed' ? [closedLot] : [lotFixture()]));
  });
}

function renderHome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/lots/:id" element={<p>lot screen</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('HomeScreen', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ru');
  });

  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
  });

  it('seller: open lot cards and the closed rows, no trucks on the road', async () => {
    mockApi('agent_seller');
    renderHome();
    const card = await screen.findByRole('link', { name: /26-0101/ });
    expect(card).toHaveAttribute('href', '/lots/5');
    expect(within(card).getByText('EX-17')).toBeInTheDocument();
    expect(card.querySelector('.mk-leftline')).toHaveTextContent('68 ящиков осталось из 100');
    expect(within(card).getByText('Оплачено 3 622,5 ₸')).toBeInTheDocument();
    expect(within(card).getByText('Долг 5 000 ₸')).toBeInTheDocument();
    expect(within(card).getByText('Расходы: 1 000 ₸')).toBeInTheDocument();
    expect(await screen.findByText('Закрытые машины')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /26-0099, Перец/ })).toHaveAttribute('href', '/lots/6');
    expect(screen.getByText('Закрыта 5 окт., 32 ящика, 210,5 кг, испорчено 3 ящика, 20 кг')).toBeInTheDocument();
    expect(screen.queryByText('В пути и прибывшие')).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalledWith('/market/shipments/');
  });

  it('agent: trucks not yet opened, with «Открыть» opening the lot', async () => {
    mockApi('agent');
    vi.mocked(api.post).mockResolvedValueOnce({ data: lotFixture({ id: 77 }) });
    const user = userEvent.setup();
    renderHome();
    expect(await screen.findByText('В пути и прибывшие')).toBeInTheDocument();
    const row = screen.getByText('26-0120').closest('.mk-road');
    expect(row).not.toBeNull();
    const rowEl = row instanceof HTMLElement ? row : document.body;
    expect(within(rowEl).getByText('Прибыл в пункт назначения')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Открыть' })).toHaveLength(1);
    await user.click(within(rowEl).getByRole('button', { name: 'Открыть' }));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/market/lots/open/', { shipment_id: 11 }, expect.anything());
    });
    expect(await screen.findByText('lot screen')).toBeInTheDocument();
  });

  it('shows the empty state when there is nothing to sell', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => Promise.resolve(
      url === '/market/me/' ? { data: { role: 'agent_seller', username: 'u', first_name: '', customer: null, bazaar: null } } : page([]),
    ));
    renderHome();
    expect(await screen.findByText('Машин пока нет')).toBeInTheDocument();
  });

  function mockAgentNoLots(shipmentsAnswer: () => Promise<unknown>): void {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/market/me/') return Promise.resolve({ data: { role: 'agent', username: 'u', first_name: '', customer: null, bazaar: null } });
      if (url === '/market/shipments/') return shipmentsAnswer();
      return Promise.resolve(page([]));
    });
  }

  it('agent: a failed trucks request says so, not «Машин пока нет»', async () => {
    mockAgentNoLots(() => Promise.reject(new Error('offline')));
    renderHome();
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить');
    expect(screen.queryByText('Машин пока нет')).not.toBeInTheDocument();
  });

  it('agent: shows the loading line while the trucks load', async () => {
    mockAgentNoLots(() => new Promise(() => undefined));
    renderHome();
    // The trucks request goes out only once the lots have loaded, so this loading line is the list's own.
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/market/shipments/'));
    expect(screen.getByText('Загружаем…')).toBeInTheDocument();
    expect(screen.queryByText('Машин пока нет')).not.toBeInTheDocument();
  });
});
