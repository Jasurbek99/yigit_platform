import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import i18n from '@/i18n';
import FleetDriversTab from './FleetDriversTab';
import {
  useAdminDrivers,
  useAdminCreateDriver,
  useUpdateDriver,
  useDriverDocuments,
  useUploadDriverDocuments,
  useDeleteDriverDocument,
} from '@/hooks/useFleetAdmin';

vi.mock('@/hooks/useFleetAdmin', () => ({
  useAdminDrivers: vi.fn(),
  useAdminCreateDriver: vi.fn(),
  useUpdateDriver: vi.fn(),
  useDriverDocuments: vi.fn(),
  useUploadDriverDocuments: vi.fn(),
  useDeleteDriverDocument: vi.fn(),
  driverDocumentUrl: (driverId: number, documentId: number) =>
    `/api/v1/transport/drivers/${driverId}/documents/${documentId}/download/`,
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mutateDriver = vi.fn();
const updateMutateAsync = vi.fn();
const createMutateAsync = vi.fn();
const uploadMutateAsync = vi.fn();
const deleteDocMutateAsync = vi.fn();

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <FleetDriversTab />
    </QueryClientProvider>,
  );
}

/**
 * Open the edit modal for one named driver. Row order is not insertion order:
 * the status column sorts inactive-first by default, so indexing into the Edit
 * buttons picks the wrong driver.
 */
function openEditFor(name: string) {
  const row = screen.getByText(name).closest('tr') as HTMLElement;
  fireEvent.click(within(row).getByRole('button', { name: /Edit/ }));
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
        { id: 5, name: 'ABRAY ANNAKULYYEW', phone: null, logo_ref: '318',
          driver_logo_code: '195.02.A001', is_active: true,
          passport_serial: 'I-AN 1234567', passport_issue_date: '2021-04-15',
          document_count: 2 },
        { id: 6, name: 'ARSLAN BERDIYEW', phone: '+99365123456', logo_ref: '334',
          driver_logo_code: '195.02.A002', is_active: false,
          passport_serial: '', passport_issue_date: null, document_count: 0 },
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
    uploadMutateAsync.mockResolvedValue([]);
    deleteDocMutateAsync.mockResolvedValue(undefined);
    vi.mocked(useDriverDocuments).mockReturnValue({
      data: [
        { id: 90, original_filename: 'passport-front.jpg', mime_type: 'image/jpeg',
          size_bytes: 204800, uploaded_by: 1, uploaded_by_name: 'mgr',
          uploaded_at: '2026-09-09T10:00:00+05:00' },
      ],
      isLoading: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    vi.mocked(useUploadDriverDocuments).mockReturnValue({
      mutateAsync: uploadMutateAsync,
      isPending: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    vi.mocked(useDeleteDriverDocument).mockReturnValue({
      mutateAsync: deleteDocMutateAsync,
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
    fireEvent.change(screen.getByPlaceholderText('Search by name, phone or passport'), {
      target: { value: 'arslan' },
    });
    await waitFor(() => expect(screen.queryByText('ABRAY ANNAKULYYEW')).not.toBeInTheDocument());
    expect(screen.getByText('ARSLAN BERDIYEW')).toBeInTheDocument();
  });

  it('filters client-side by phone without throwing on a null phone', async () => {
    renderTab();
    fireEvent.change(screen.getByPlaceholderText('Search by name, phone or passport'), {
      target: { value: '99365' },
    });
    await waitFor(() => expect(screen.getByText('ARSLAN BERDIYEW')).toBeInTheDocument());
    expect(screen.queryByText('ABRAY ANNAKULYYEW')).not.toBeInTheDocument();
  });

  it('sends phone as null, not an empty string, when the field is left blank', async () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Add Driver/ }));
    fireEvent.change(await screen.findByLabelText('Full Name'), { target: { value: '  NEW DRIVER  ' } });
    // Passport serial and issue date are required as of 2026-09-10; phone is
    // the only optional field left, which is what this test is about.
    fireEvent.change(screen.getByLabelText('Passport Serial'), { target: { value: 'I-AN 7654321' } });
    fireEvent.change(screen.getByLabelText('Passport Issue Date'), { target: { value: '2020-05-01' } });
    fireEvent.keyDown(screen.getByLabelText('Passport Issue Date'), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(createMutateAsync).toHaveBeenCalledWith({
        name: 'NEW DRIVER',
        phone: null,
        passport_serial: 'I-AN 7654321',
        passport_issue_date: '2020-05-01',
        is_active: true,
      }),
    );
  });

  it('blocks Save when the passport fields are empty', async () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Add Driver/ }));
    fireEvent.change(await screen.findByLabelText('Full Name'), { target: { value: 'NO PASSPORT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findAllByText('Required')).toHaveLength(2);
    expect(createMutateAsync).not.toHaveBeenCalled();
  });

  it('toggles active with a {id, is_active} patch only', () => {
    renderTab();
    fireEvent.click(screen.getAllByRole('button', { name: 'Deactivate' })[0]);
    expect(mutateDriver).toHaveBeenCalledWith(
      { id: 5, is_active: false },
      expect.anything(),
    );
  });

  it('shows the Logo code column and filters on it', async () => {
    // Two drivers can share a name (ids 30/31 in production are both
    // BATYROW BAYRAMMYRAT); the code is the only thing telling them apart.
    renderTab();
    expect(screen.getByText('195.02.A001')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search by name, phone or passport'), {
      target: { value: '195.02.A002' },
    });
    await waitFor(() => expect(screen.queryByText('ABRAY ANNAKULYYEW')).not.toBeInTheDocument());
    expect(screen.getByText('ARSLAN BERDIYEW')).toBeInTheDocument();
  });
  it('shows the passport serial and scan count in the table', () => {
    renderTab();
    expect(screen.getByText('I-AN 1234567')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('filters client-side by passport serial', async () => {
    renderTab();
    fireEvent.change(screen.getByPlaceholderText('Search by name, phone or passport'), {
      target: { value: '1234567' },
    });
    await waitFor(() => expect(screen.queryByText('ARSLAN BERDIYEW')).not.toBeInTheDocument());
    expect(screen.getByText('ABRAY ANNAKULYYEW')).toBeInTheDocument();
  });

  it('sends the passport serial and issue date as a plain date string', async () => {
    renderTab();
    openEditFor('ABRAY ANNAKULYYEW');
    fireEvent.change(await screen.findByLabelText('Passport Serial'), {
      target: { value: 'I-AN 7777777' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(updateMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 5,
          passport_serial: 'I-AN 7777777',
          passport_issue_date: '2021-04-15',
        }),
      ),
    );
  });

  it('lists the passport scans when editing, linked to the authenticated download', async () => {
    renderTab();
    openEditFor('ABRAY ANNAKULYYEW');
    const link = await screen.findByRole('link', { name: 'passport-front.jpg' });
    // Never a /media/ path: nginx serves that directory with no auth.
    expect(link).toHaveAttribute(
      'href',
      '/api/v1/transport/drivers/5/documents/90/download/',
    );
  });

  it('uploads a whole selection as one request, not one request per file', async () => {
    // The per-driver cap and the all-or-nothing validation are enforced per
    // request, so a request per file would let two uploads slip past the cap.
    renderTab();
    openEditFor('ABRAY ANNAKULYYEW');
    await screen.findByRole('button', { name: /Upload passport/ });

    const front = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'front.jpg', {
      type: 'image/jpeg',
    });
    const back = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'back.pdf', {
      type: 'application/pdf',
    });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [front, back] } });

    await waitFor(() => expect(uploadMutateAsync).toHaveBeenCalledTimes(1));
    // The driver id rides in the variables now, so one hook serves both the
    // edit panel (id known) and the Add dialog (id known only after saving).
    expect(uploadMutateAsync).toHaveBeenCalledWith({ driverId: 5, files: [front, back] });
  });

  // Until 2026-09-10 the Add dialog had no upload at all, because a file needs
  // an existing driver row to hang off. Files are staged in the browser now and
  // POSTed the moment the create call returns an id.
  it('stages a scan chosen while creating, then uploads it against the new id', async () => {
    createMutateAsync.mockResolvedValue({ id: 900, name: 'NEW DRIVER' });
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Add Driver/ }));
    await screen.findByLabelText('Full Name');

    const scan = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'front.jpg', { type: 'image/jpeg' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [scan] } });

    // Staged, not sent: there is no driver id to POST against yet.
    expect(await screen.findByText('front.jpg')).toBeInTheDocument();
    expect(uploadMutateAsync).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'NEW DRIVER' } });
    fireEvent.change(screen.getByLabelText('Passport Serial'), { target: { value: 'I-AN 7654321' } });
    fireEvent.change(screen.getByLabelText('Passport Issue Date'), { target: { value: '2020-05-01' } });
    fireEvent.keyDown(screen.getByLabelText('Passport Issue Date'), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(uploadMutateAsync).toHaveBeenCalledWith({ driverId: 900, files: [scan] }),
    );
  });
});
