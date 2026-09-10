import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
  useAdminDrivers,
  useAdminCreateDriver,
  useUpdateDriver,
  useTruckHeadDocuments,
  useUploadTruckHeadDocuments,
  useDeleteTruckHeadDocument,
} from '@/hooks/useFleetAdmin';

vi.mock('@/hooks/useFleetAdmin', () => ({
  useAdminTruckHeads: vi.fn(),
  useAdminTrailers: vi.fn(),
  useUpdateTruckHead: vi.fn(),
  useUpdateTrailer: vi.fn(),
  useAdminCreateTruckHead: vi.fn(),
  useAdminCreateTrailer: vi.fn(),
  useAdminDrivers: vi.fn(),
  useAdminCreateDriver: vi.fn(),
  useUpdateDriver: vi.fn(),
  useDriverDocuments: vi.fn(() => ({ data: [], isLoading: false })),
  useUploadDriverDocuments: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteDriverDocument: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  driverDocumentUrl: (driverId: number, documentId: number) =>
    `/api/v1/transport/drivers/${driverId}/documents/${documentId}/download/`,
  useTruckHeadDocuments: vi.fn(() => ({ data: [], isLoading: false })),
  useUploadTruckHeadDocuments: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteTruckHeadDocument: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  truckHeadDocumentUrl: (truckHeadId: number, documentId: number) =>
    `/api/v1/transport/truck-heads/${truckHeadId}/documents/${documentId}/download/`,
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
const uploadTruckDocsMutateAsync = vi.fn();
const deleteTruckDocMutateAsync = vi.fn();

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
    uploadTruckDocsMutateAsync.mockResolvedValue([]);
    deleteTruckDocMutateAsync.mockResolvedValue(undefined);
    vi.mocked(useTruckHeadDocuments).mockReturnValue({
      data: [
        { id: 70, original_filename: 'tehpasport.pdf', mime_type: 'application/pdf',
          size_bytes: 307200, uploaded_by: 1, uploaded_by_name: 'mgr',
          uploaded_at: '2026-09-10T10:00:00+05:00' },
      ],
      isLoading: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    vi.mocked(useUploadTruckHeadDocuments).mockReturnValue({
      mutateAsync: uploadTruckDocsMutateAsync,
      isPending: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    vi.mocked(useDeleteTruckHeadDocument).mockReturnValue({
      mutateAsync: deleteTruckDocMutateAsync,
      isPending: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    createTruckMutateAsync.mockResolvedValue({ id: 99, plate_number: '09NEW999' });
    createTrailerMutateAsync.mockResolvedValue({ id: 98, plate_number: '09TRL998' });
    vi.mocked(useAdminTruckHeads).mockReturnValue({
      data: [
        { id: 1, plate_number: '01ABC123', owner_type: 'company', owner_name: '', truck_model: 'MAN TGX', document_count: 1, status: 'idle', has_gps: true, is_active: true },
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
    // FleetDriversTab pulls these from the same mocked module — the Tabs pane is
    // lazy, but a test that activates it would otherwise call undefined.
    vi.mocked(useAdminDrivers).mockReturnValue({
      data: [{ id: 5, name: 'ABRAY ANNAKULYYEW', phone: null, is_active: true }],
      isLoading: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    vi.mocked(useAdminCreateDriver).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    vi.mocked(useUpdateDriver).mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  });

  it('mounts the Drivers tab when its tab is clicked', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Drivers' }));
    await waitFor(() => expect(screen.getByText('ABRAY ANNAKULYYEW')).toBeInTheDocument());
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
    fireEvent.change(screen.getByLabelText('Truck Model'), { target: { value: 'MAN TGX' } });
    fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: '20' } });

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    await waitFor(() => expect(createTruckMutateAsync).toHaveBeenCalledTimes(1));
    expect(createTruckMutateAsync).toHaveBeenCalledWith({
      plate_number: '07TEST999',
      owner_type: 'company',
      owner_name: 'YGT Holding',
      truck_model: 'MAN TGX',
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
        // `truck_model` is required as of 2026-09-10, so the row carries one —
        // otherwise the form blocks on it and never reaches the assertion this
        // test is about (the Cyrillic owner name surviving a capacity edit).
        { id: 5, plate_number: '05CYR555', owner_type: 'leased', owner_name: 'Иванов Пётр', truck_model: 'MAN TGX', capacity: '20.00', status: 'idle', has_gps: true, is_active: true },
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

  it('shows the truck model in the table and carries it through an edit', async () => {
    renderPage();
    expect(screen.getByText('MAN TGX')).toBeInTheDocument();

    const row = screen.getByText('01ABC123').closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: /Edit/ }));
    const field = await screen.findByLabelText('Truck Model');
    expect(field).toHaveValue('MAN TGX');

    fireEvent.change(field, { target: { value: 'DAF XF 480' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() =>
      expect(updateTruckMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, truck_model: 'DAF XF 480' }),
      ),
    );
  });

  it('lists the tech passport scans when editing, linked to the authenticated download', async () => {
    renderPage();
    const row = screen.getByText('01ABC123').closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: /Edit/ }));

    const link = await screen.findByRole('link', { name: 'tehpasport.pdf' });
    // Never a /media/ path: nginx serves that directory with no auth.
    expect(link).toHaveAttribute(
      'href',
      '/api/v1/transport/truck-heads/1/documents/70/download/',
    );
  });

  it('holds a scan chosen in the Add dialog and uploads it after the truck is created', async () => {
    // A file needs a truck id to hang off, and the create form has none yet.
    createTruckMutateAsync.mockResolvedValue({ id: 99, plate_number: '09NEW999' });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Add Truck/i }));
    expect(screen.queryByRole('link', { name: 'tehpasport.pdf' })).not.toBeInTheDocument();

    const scan = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'tehpasport.pdf', {
      type: 'application/pdf',
    });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [scan] } });
    await screen.findByText('tehpasport.pdf');

    fireEvent.change(screen.getByLabelText('Plate Number'), { target: { value: '09new999' } });
    fireEvent.change(screen.getByLabelText('Truck Model'), { target: { value: 'MAN TGX' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    await waitFor(() =>
      expect(uploadTruckDocsMutateAsync).toHaveBeenCalledWith({
        truckHeadId: 99,
        files: [scan],
      }),
    );
  });
});
