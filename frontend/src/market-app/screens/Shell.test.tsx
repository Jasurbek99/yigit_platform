import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import api from '@/services/api';
import Shell from './Shell';

vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

function mockMe(role: string) {
  vi.mocked(api.get).mockImplementation(() =>
    Promise.resolve({
      data: {
        role,
        username: 'erlan',
        first_name: 'Ерлан',
        customer: role.startsWith('agent') ? { id: 1, name: 'ТОО «Алматы Овощ»' } : null,
        bazaar: null,
      },
    }),
  );
}

function renderShell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<p>home</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Shell', () => {
  const replace = vi.fn();

  beforeAll(async () => {
    await i18n.changeLanguage('ru');
  });

  beforeEach(() => {
    replace.mockReset();
    vi.mocked(api.get).mockReset();
    vi.stubGlobal('location', { ...window.location, replace });
    return () => vi.unstubAllGlobals();
  });

  it('shows the agent its header and bottom bar', async () => {
    mockMe('agent');
    renderShell();
    expect(await screen.findByText('ТОО «Алматы Овощ»')).toBeInTheDocument();
    expect(screen.getByText('Ерлан')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(screen.getByText('home')).toBeInTheDocument();
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['Машины', 'Долги', 'Команда']);
    expect(replace).not.toHaveBeenCalled();
  });

  it('gives the seller the trucks and the debts tabs', async () => {
    mockMe('agent_seller');
    renderShell();
    expect(await screen.findByText('home')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Долги' })).toHaveAttribute('href', '/debts');
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['Машины', 'Долги']);
  });

  it('sends staff to the main app', async () => {
    mockMe('export_manager');
    renderShell();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(screen.queryByText('home')).not.toBeInTheDocument();
  });
});
