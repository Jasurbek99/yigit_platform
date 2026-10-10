// Shared setup of the debts screen tests (not imported by app code).
import { render, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import api from '@/services/api';
import DebtsScreen from '../DebtsScreen';
import { ToastHost } from '../../components/ToastHost';
import { debtsFixture } from '../../testFixtures';
import type { IDebts } from '../../types';

const ME = { role: 'agent', username: 'erlan', first_name: 'Ерлан', customer: { id: 1, name: 'ТОО «Алматы Овощ»' }, bazaar: null };

/** Reset the mocked api (vi.mock it in the test file) and answer GETs as `role` looking at `debts`. */
export function mockDebtsApi(role = 'agent', debts: IDebts = debtsFixture()): void {
  [api.get, api.post, api.delete].forEach((fn) => vi.mocked(fn).mockReset());
  vi.mocked(api.get).mockImplementation((url: string) => Promise.resolve({
    data: url === '/market/me/' ? { ...ME, role } : debts,
  }));
}

/** `/debts` with the toast host. */
export function renderDebts(): RenderResult {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/debts']}>
        <Routes><Route path="/debts" element={<DebtsScreen />} /></Routes>
      </MemoryRouter>
      <ToastHost />
    </QueryClientProvider>,
  );
}
