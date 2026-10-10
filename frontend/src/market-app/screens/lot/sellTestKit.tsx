// Shared setup of the sell form screen tests (not imported by app code).
import { render, screen, type RenderResult } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import api from '@/services/api';
import LotScreen from '../LotScreen';
import { ToastHost } from '../../components/ToastHost';
import { lotDetailFixture, lotFixture, saleFixture } from '../../testFixtures';
import type { ILot, ISale } from '../../types';

const ME = { role: 'agent_seller', username: 'aidos', first_name: 'Айдос', customer: null, bazaar: null };

/** Reset the mocked api (vi.mock it in the test file) and answer GETs as the lot's seller. */
export function mockSellerApi(): void {
  [api.get, api.post, api.delete].forEach((fn) => vi.mocked(fn).mockReset());
  vi.mocked(api.get).mockImplementation((url: string) => Promise.resolve({
    data: url === '/market/me/' ? ME : url.includes('/lots/') ? lotDetailFixture() : [],
  }));
}

/** `/lots/5` with the toast host, as the seller sees it. */
export function renderLot(): RenderResult {
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
export async function fillSale(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const qty = await screen.findByLabelText('Сколько ящиков?');
  await user.clear(qty);
  await user.type(qty, '10');
  await user.type(screen.getByLabelText('Вес с ящиками, кг'), '104,5');
  const price = screen.getByLabelText('Цена за 1 кг, ₸');
  await user.clear(price);
  await user.type(price, '45');
}

/** The POST …/sales/ answer for that sale (sale 9); `closedAt` when it closed the truck. */
export function saved(closedAt: string | null = null): { data: { entry: ISale; lot: ILot } } {
  return {
    data: {
      entry: saleFixture({ id: 9, qty: 10, boxes: 10, gross_kg: '104.50', net_kg: '100.00', total: '4500.00' }),
      lot: lotFixture({ closed_at: closedAt }),
    },
  };
}
