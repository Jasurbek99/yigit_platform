import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import api from '@/services/api';
import ScanClaimScreen from './ScanClaimScreen';

vi.mock('@/services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

function Where(): JSX.Element {
  return <p>at {useLocation().pathname}</p>;
}

function renderAt(path = '/scan/5') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/scan/:id" element={<ScanClaimScreen />} />
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}

describe('ScanClaimScreen', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ru');
  });

  beforeEach(() => vi.mocked(api.post).mockReset());

  it('opens the lot once and goes to its screen', async () => {
    vi.mocked(api.post).mockResolvedValue({ status: 201, data: { id: 7 } });
    renderAt();
    expect(await screen.findByText('at /lots/7')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(1);
    const [url, body, config] = vi.mocked(api.post).mock.calls[0];
    expect(url).toBe('/market/lots/open/');
    expect(body).toEqual({ shipment_id: 5 });
    expect(config?.headers?.['Idempotency-Key']).toEqual(expect.any(String));
  });

  it('shows the server message on 403 and offers the way back to the trucks', async () => {
    vi.mocked(api.post).mockRejectedValueOnce({
      response: { status: 403, data: { error: 'Машина назначена другому продавцу.' } },
    });
    renderAt();
    expect(await screen.findByText('Машина назначена другому продавцу.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'К машинам' }));
    await waitFor(() => expect(screen.getByText('at /')).toBeInTheDocument());
  });

  it('falls back to its own text when there is no server message', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('Network Error'));
    renderAt();
    expect(await screen.findByText('Не удалось открыть машину. Проверьте интернет.')).toBeInTheDocument();
  });
});
