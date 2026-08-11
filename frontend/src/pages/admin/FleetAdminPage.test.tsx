import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';
import i18n from '@/i18n';
import FleetAdminPage from './FleetAdminPage';
import {
  useAdminTruckHeads,
  useAdminTrailers,
  useUpdateTruckHead,
  useUpdateTrailer,
  useAdminCreateTruckHead,
  useAdminCreateTrailer,
} from '@/hooks/useFleetAdmin';

vi.mock('@/hooks/useFleetAdmin', () => ({
  useAdminTruckHeads: vi.fn(),
  useAdminTrailers: vi.fn(),
  useUpdateTruckHead: vi.fn(),
  useUpdateTrailer: vi.fn(),
  useAdminCreateTruckHead: vi.fn(),
  useAdminCreateTrailer: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mutateTruck = vi.fn();
const mutateTrailer = vi.fn();
const updateTruckMutateAsync = vi.fn();
const updateTrailerMutateAsync = vi.fn();
const createTruckMutateAsync = vi.fn();
const createTrailerMutateAsync = vi.fn();

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin/fleet']}>
        <FleetAdminPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('FleetAdminPage', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    createTruckMutateAsync.mockResolvedValue({ id: 99, plate_number: '09NEW999' });
    createTrailerMutateAsync.mockResolvedValue({ id: 98, plate_number: '09TRL998' });
    vi.mocked(useAdminTruckHeads).mockReturnValue({
      data: [
        { id: 1, plate_number: '01ABC123', owner_type: 'company', owner_name: '', status: 'idle', has_gps: true, is_active: true },
        { id: 2, plate_number: '02XYZ456', owner_type: '', owner_name: '', status: '', has_gps: false, is_active: false },
      ],
      isLoading: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    vi.mocked(useAdminTrailers).mockReturnValue({
      data: [],
      isLoading: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    vi.mocked(useUpdateTruckHead).mockReturnValue({
      mutate: mutateTruck,
      mutateAsync: updateTruckMutateAsync,
      isPending: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    vi.mocked(useUpdateTrailer).mockReturnValue({
      mutate: mutateTrailer,
      mutateAsync: updateTrailerMutateAsync,
      isPending: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    vi.mocked(useAdminCreateTruckHead).mockReturnValue({
      mutateAsync: createTruckMutateAsync,
      isPending: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    vi.mocked(useAdminCreateTrailer).mockReturnValue({
      mutateAsync: createTrailerMutateAsync,
      isPending: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  });

  it('renders the trucks table with rows, including an inactive one shown with a status tag', () => {
    renderPage();
    expect(screen.getByText('01ABC123')).toBeInTheDocument();
    expect(screen.getByText('02XYZ456')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('opens the create modal when "Add Truck" is clicked', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Add Truck/i }));
    expect(screen.getByLabelText('Plate Number')).toBeInTheDocument();
  });

  it('calls useUpdateTruckHead().mutate with {id, is_active} when Deactivate is clicked, and shows a success toast', () => {
    renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: 'Deactivate' })[0]);
    expect(mutateTruck.mock.calls[0][0]).toEqual({ id: 1, is_active: false });

    // Simulate the mutation resolving, the way the real react-query mutate() would.
    const options = mutateTruck.mock.calls[0][1];
    options.onSuccess();
    expect(toast.success).toHaveBeenCalledWith('Vehicle deactivated');
  });

  it('submits a single admin-create call with all fields when adding a truck (no two-step create+patch)', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Add Truck/i }));

    fireEvent.change(screen.getByLabelText('Plate Number'), { target: { value: '07test999' } });
    fireEvent.change(screen.getByLabelText('Owner Type'), { target: { value: 'company' } });
    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'YGT Holding' } });
    fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: '20' } });

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    await waitFor(() => expect(createTruckMutateAsync).toHaveBeenCalledTimes(1));
    expect(createTruckMutateAsync).toHaveBeenCalledWith({
      plate_number: '07TEST999',
      owner_type: 'company',
      owner_name: 'YGT Holding',
      capacity: 20,
      is_active: true,
    });
    // Proves the two-step create-then-patch window is gone: no follow-up
    // update call of any kind (mutate or mutateAsync) after the single create.
    expect(mutateTruck).not.toHaveBeenCalled();
    expect(updateTruckMutateAsync).not.toHaveBeenCalled();
    expect(mutateTrailer).not.toHaveBeenCalled();
    expect(updateTrailerMutateAsync).not.toHaveBeenCalled();
  });

  it('preserves an imported Cyrillic owner_name when editing only the capacity (no silent blanking)', async () => {
    // A single imported truck carrying a non-empty Cyrillic owner name.
    vi.mocked(useAdminTruckHeads).mockReturnValue({
      data: [
        { id: 5, plate_number: '05CYR555', owner_type: 'leased', owner_name: 'Иванов Пётр', capacity: '20.00', status: 'idle', has_gps: true, is_active: true },
      ],
      isLoading: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    renderPage();

    // Open Edit and change ONLY the capacity — owner_name is left untouched (relies on prefill).
    // The Edit button carries an EditOutlined icon (aria-label "edit") + text,
    // so its accessible name is "edit Edit" — match by regex, not exact string.
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    await waitFor(() => expect(updateTruckMutateAsync).toHaveBeenCalledTimes(1));
    const payload = updateTruckMutateAsync.mock.calls[0][0];
    expect(payload.id).toBe(5);
    expect(payload.capacity).toBe(25);
    // The Cyrillic owner name must survive a capacity-only edit, not be wiped to ''.
    expect(payload.owner_name).toBe('Иванов Пётр');
    expect(payload.owner_type).toBe('leased');
  });
});
