import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import api from '@/services/api';
import ExportFirmDetailPage from './ExportFirmDetailPage';

vi.mock('@/services/api');
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { role: 'admin', is_superuser: true } }) }));
vi.mock('@/utils/permissions', () => ({ canDo: () => true }));

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>;
const mockPatch = api.patch as unknown as ReturnType<typeof vi.fn>;

const FIRM = {
  id: 1, code: 'YGT', name_short: 'YGT', name_tk: 'Ýigit', name_en: null, name_ru: null,
  legal_type: null, legal_type_code: null, legal_type_display: null,
  name_bare_tk: null, name_bare_ru: null, name_bare_en: null,
  address_tk: null, address_en: null, address_ru: null,
  bank_details_tk: null, bank_details_en: null, bank_details_ru: null,
  director: null, director_tk: null, tax_code: null, swift_code: null, one_c_code: null,
  is_active: true, is_gapy_satys: false,
  director_signature: null, director_seal: null, director_stamp: null,
  letterhead: null as string | null,
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/export-firms/1']}>
        <Routes><Route path="/admin/export-firms/:id" element={<ExportFirmDetailPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const DOCX_INPUT = 'input[type="file"][accept*=".docx"]';

describe('ExportFirmDetailPage — letterhead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FIRM.letterhead = null;
    mockGet.mockImplementation(() => Promise.resolve({ data: FIRM }));
  });

  it('uploads a .docx letterhead to the firm', async () => {
    mockPatch.mockResolvedValue({ data: FIRM });
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelector(DOCX_INPUT)).not.toBeNull());
    const file = new File(['x'], 'blank.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    fireEvent.change(container.querySelector(DOCX_INPUT)!, { target: { files: [file] } });
    await waitFor(() => expect(mockPatch).toHaveBeenCalled());
    const [url, body] = mockPatch.mock.calls[0];
    expect(url).toBe('/export/admin/firms/1/');
    expect((body as FormData).get('letterhead')).toBe(file);
  });

  it('shows the current letterhead as a link, not an image', async () => {
    FIRM.letterhead = '/media/export_firms/letterheads/a.docx';
    const { container } = renderPage();
    await waitFor(() =>
      expect(container.querySelector('a[href="/media/export_firms/letterheads/a.docx"]')).not.toBeNull(),
    );
    expect(container.querySelector('img[src="/media/export_firms/letterheads/a.docx"]')).toBeNull();
  });
});
