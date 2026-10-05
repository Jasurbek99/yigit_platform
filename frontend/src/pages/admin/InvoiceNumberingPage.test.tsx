import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import api from '@/services/api';
import InvoiceNumberingPage from './InvoiceNumberingPage';

vi.mock('@/services/api');
const authUser = { current: { role: 'admin', is_superuser: false } };
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: authUser.current }) }));

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>;
const mockPut = api.put as unknown as ReturnType<typeof vi.fn>;

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><InvoiceNumberingPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('InvoiceNumberingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({
      data: { year: 2026, rows: [{ export_firm: 3, export_firm_code: 'DM', export_firm_name: 'DM', year: 2026, last_number: 288 }] },
    });
  });

  it('admin edits a floor and it is saved', async () => {
    authUser.current = { role: 'admin', is_superuser: false };
    mockPut.mockResolvedValue({ data: { export_firm: 3, year: 2026, last_number: 310 } });
    renderPage();
    const input = await screen.findByDisplayValue('288');
    fireEvent.change(input, { target: { value: '310' } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(mockPut).toHaveBeenCalledWith('/contracts/invoice-number-bases/', {
        export_firm: 3, year: expect.any(Number), last_number: 310,
      }),
    );
  });

  it('a non-admin sees the number read-only', async () => {
    authUser.current = { role: 'export_manager', is_superuser: false };
    renderPage();
    expect(await screen.findByText('288')).toBeTruthy();
    expect(screen.queryByDisplayValue('288')).toBeNull();
  });

  it('clearing the field and pressing Enter does not PUT a zero', async () => {
    authUser.current = { role: 'admin', is_superuser: false };
    renderPage();
    const input = await screen.findByDisplayValue('288');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13 });
    fireEvent.blur(input);
    await waitFor(() => expect(mockPut).not.toHaveBeenCalled());
  });

  it('typing a value and pressing Enter commits exactly once', async () => {
    authUser.current = { role: 'admin', is_superuser: false };
    mockPut.mockResolvedValue({ data: { export_firm: 3, year: 2026, last_number: 310 } });
    renderPage();
    const input = await screen.findByDisplayValue('288');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '310' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13 });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(mockPut).toHaveBeenCalledWith('/contracts/invoice-number-bases/', {
        export_firm: 3, year: expect.any(Number), last_number: 310,
      }),
    );
    expect(mockPut).toHaveBeenCalledTimes(1);
  });
});

describe('InvoiceNumberingPage — letter floors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authUser.current = { role: 'admin', is_superuser: false };
    mockGet.mockImplementation((url: string) => Promise.resolve({
      data: url.startsWith('/contracts/letter-number-bases/')
        ? { year: 2026, rows: [{ export_firm: 3, export_firm_code: 'DM', export_firm_name: 'DM', year: 2026, ct1: 31, fito: 42, customs: 53 }] }
        : { year: 2026, rows: [{ export_firm: 3, export_firm_code: 'DM', export_firm_name: 'DM', year: 2026, last_number: 288 }] },
    }));
  });

  it('shows each letter floor of the firm', async () => {
    renderPage();
    expect(await screen.findByDisplayValue('31')).toBeTruthy();
    expect(screen.getByDisplayValue('42')).toBeTruthy();
    expect(screen.getByDisplayValue('53')).toBeTruthy();
  });

  it('admin edits the CT-1 floor and it is saved by letter type', async () => {
    mockPut.mockResolvedValue({ data: { export_firm: 3, year: 2026, ct1: 12, fito: 42, customs: 53 } });
    renderPage();
    const input = await screen.findByDisplayValue('31');
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(mockPut).toHaveBeenCalledWith('/contracts/letter-number-bases/', {
        export_firm: 3, year: expect.any(Number), letter_type: 'ct1', last_number: 12,
      }),
    );
  });
});
