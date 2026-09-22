import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import apiModule from '@/services/api';
import { ShipmentQualityBody } from './ShipmentQualityBody';
import { MOCK_SHIPMENT_DETAIL } from '@/mock/shipmentDetail';
import type { IQualityCertificate } from '@/types';

// vi.mock is hoisted above every const, so the factory must build the mock
// itself; the module is then imported back and read through vi.mocked.
vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const api = vi.mocked(apiModule);

const AZYK: IQualityCertificate = {
  id: 7,
  doc_type: 'azyk_maglumatnama',
  original_filename: 'azyk-scan.pdf',
  mime_type: 'application/pdf',
  size_bytes: 204_800,
  uploaded_at: '2026-09-22T08:00:00Z',
  uploaded_by_name: 'Hil Gözegçi',
  download_url: '/api/v1/export/shipments/1/quality-certificates/7/download/',
};

function renderBody(canEditQuality = true, certificates: IQualityCertificate[] = [AZYK]) {
  api.get.mockResolvedValue({ data: certificates });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ShipmentQualityBody shipment={MOCK_SHIPMENT_DETAIL} canEditQuality={canEditQuality} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('ShipmentQualityBody', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists an uploaded scan as a link to the authenticated download route', async () => {
    renderBody();
    const link = await screen.findByRole('link', { name: 'azyk-scan.pdf' });
    // Never a raw /media/ URL — nginx serves that path unauthenticated.
    expect(link).toHaveAttribute('href', AZYK.download_url);
    expect(link.getAttribute('href')).not.toContain('/media/');
  });

  it('sends the certificate type with the file, as multipart', async () => {
    api.post.mockResolvedValue({ data: [] });
    const { container } = renderBody();
    await screen.findByRole('link', { name: 'azyk-scan.pdf' });

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(
      input,
      new File(['x'], 'hil.pdf', { type: 'application/pdf' }),
    );

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [url, body] = api.post.mock.calls[0];
    expect(url).toBe('/export/shipments/1/quality-certificates/');
    expect(body).toBeInstanceOf(FormData);
    // The first slot rendered is azyk_maglumatnama.
    expect((body as FormData).get('doc_type')).toBe('azyk_maglumatnama');
    expect((body as FormData).getAll('files')).toHaveLength(1);
  });

  it('removes a scan by POST, not DELETE — the ViewSet forbids DELETE', async () => {
    api.post.mockResolvedValue({ data: [] });
    renderBody();
    await screen.findByRole('link', { name: 'azyk-scan.pdf' });

    await userEvent.click(screen.getAllByRole('button')[0]);
    // The Popconfirm's OK label is whatever `common.delete` says in the active
    // language, so target it structurally rather than by text.
    const confirm = await waitFor(() => {
      const button = document.querySelector<HTMLElement>('.ant-popconfirm .ant-btn-primary');
      if (!button) throw new Error('confirm button not rendered');
      return button;
    });
    await userEvent.click(confirm);

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post.mock.calls[0][0]).toBe(
      '/export/shipments/1/quality-certificates/7/delete/',
    );
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('offers no upload or delete control without edit rights', async () => {
    const { container } = renderBody(false);
    await screen.findByRole('link', { name: 'azyk-scan.pdf' });

    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('shows no checkbox anywhere — a flag needs a file now', async () => {
    const { container } = renderBody();
    await screen.findByRole('link', { name: 'azyk-scan.pdf' });

    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });
});
