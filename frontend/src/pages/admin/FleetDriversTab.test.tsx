import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import i18n from '@/i18n';
import FleetDriversTab from './FleetDriversTab';
import { useAdminDrivers, useAdminCreateDriver, useUpdateDriver } from '@/hooks/useFleetAdmin';

vi.mock('@/hooks/useFleetAdmin', () => ({
  useAdminDrivers: vi.fn(),
  useAdminCreateDriver: vi.fn(),
  useUpdateDriver: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mutateDriver = vi.fn();
const updateMutateAsync = vi.fn();
const createMutateAsync = vi.fn();

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <FleetDriversTab />
    </QueryClientProvider>,
  );
}

describe('FleetDriversTab', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    createMutateAsync.mockResolvedValue({ id: 200, name: 'NEW DRIVER' });
    updateMutateAsync.mockResolvedValue({ id: 5 });
    vi.mocked(useAdminDrivers).mockReturnValue({
      data: [
        { id: 5, name: 'ABRAY ANNAKULYYEW', phone: null, is_active: true },
        { id: 6, name: 'ARSLAN BERDIYEW', phone: '+99365123456', is_active: false },
      ],
      isLoading: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    vi.mocked(useAdminCreateDriver).mockReturnValue({
      mutateAsync: createMutateAsync,
      isPending: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    vi.mocked(useUpdateDriver).mockReturnValue({
      mutate: mutateDriver,
      mutateAsync: updateMutateAsync,
      isPending: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  });

  it('renders drivers including an inactive one', () => {
    renderTab();
    expect(screen.getByText('ABRAY ANNAKULYYEW')).toBeInTheDocument();
    expect(screen.getByText('ARSLAN BERDIYEW')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('filters client-side by name', async () => {
    renderTab();
    fireEvent.change(screen.getByPlaceholderText('Search by name or phone'), {
      target: { value: 'arslan' },
    });
    await waitFor(() => expect(screen.queryByText('ABRAY ANNAKULYYEW')).not.toBeInTheDocument());
    expect(screen.getByText('ARSLAN BERDIYEW')).toBeInTheDocument();
  });

  it('filters client-side by phone without throwing on a null phone', async () => {
    renderTab();
    fireEvent.change(screen.getByPlaceholderText('Search by name or phone'), {
      target: { value: '99365' },
    });
    await waitFor(() => expect(screen.getByText('ARSLAN BERDIYEW')).toBeInTheDocument());
    expect(screen.queryByText('ABRAY ANNAKULYYEW')).not.toBeInTheDocument();
  });

  it('sends phone as null, not an empty string, when the field is left blank', async () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Add Driver/ }));
    fireEvent.change(await screen.findByLabelText('Full Name'), { target: { value: '  NEW DRIVER  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(createMutateAsync).toHaveBeenCalledWith({
        name: 'NEW DRIVER',
        phone: null,
        is_active: true,
      }),
    );
  });

  it('toggles active with a {id, is_active} patch only', () => {
    renderTab();
    fireEvent.click(screen.getAllByRole('button', { name: 'Deactivate' })[0]);
    expect(mutateDriver).toHaveBeenCalledWith(
      { id: 5, is_active: false },
      expect.anything(),
    );
  });
});
