import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { TaskCardEditor } from './TaskCardEditor';
import { MOCK_SHIPMENT_DETAIL } from '@/mock/shipmentDetail';
import type { IShipmentDetail } from '@/types';

vi.mock('@/services/api', () => ({
  default: { patch: vi.fn(), get: vi.fn(), post: vi.fn() },
}));

function renderEditor(shipment: IShipmentDetail) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <TaskCardEditor shipment={shipment} targetFields={['block_sources']} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('TaskCardEditor read-only block_sources row', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('shows one code per block for a two-batch truck, not a duplicate', () => {
    const shipment: IShipmentDetail = {
      ...MOCK_SHIPMENT_DETAIL,
      block_sources: [
        { block_code: 'A', block_name: 'A-Ýyladyşhana', weight_kg: 3000, harvest_date: '2026-09-21' },
        { block_code: 'A', block_name: 'A-Ýyladyşhana', weight_kg: 5000, harvest_date: '2026-09-24' },
      ],
    };
    renderEditor(shipment);
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.queryByText('A, A')).not.toBeInTheDocument();
  });

  it('shows one code per block, comma-joined, for a multi-block truck', () => {
    const shipment: IShipmentDetail = {
      ...MOCK_SHIPMENT_DETAIL,
      block_sources: [
        { block_code: 'A', block_name: 'A-Ýyladyşhana', weight_kg: 3000, harvest_date: '2026-09-21' },
        { block_code: 'B', block_name: 'B-Ýyladyşhana', weight_kg: 6500, harvest_date: '2026-09-21' },
      ],
    };
    renderEditor(shipment);
    expect(screen.getByText('A, B')).toBeInTheDocument();
  });
});
