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
  vi.mocked(api.get).mockImplementation((url: string) =>
    Promise.resolve({
      data: url.includes('/market/me/')
        ? { role, customer: role.startsWith('agent') ? { id: 1, name: 'ТОО «Алматы Овощ»' } : null, bazaar: null }
        : { first_name: 'Ерлан', username: 'erlan' },
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
    expect(screen.getByText('home')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Команда' })).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('sends staff to the main app', async () => {
    mockMe('export_manager');
    renderShell();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(screen.queryByText('home')).not.toBeInTheDocument();
  });
});
