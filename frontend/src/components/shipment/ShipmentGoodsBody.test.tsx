import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { ShipmentGoodsBody } from './ShipmentGoodsBody';
import { fmtDate, fmtNum } from '@/pages/export/ShipmentDetailHelpers.helpers';
import { MOCK_SHIPMENT_DETAIL } from '@/mock/shipmentDetail';
import type { IBlockSource, IShipmentDetail } from '@/types';

// DetailFieldRow (rendered for HARVEST_STATUS_FIELD and the goods field group)
// wires up useShipmentPatchMulti on a real Axios instance, so `api` must exist
// as a mock or the import chain throws — same pattern as DetailFieldRow.test.tsx.
vi.mock('@/services/api', () => ({
  default: { patch: vi.fn(), get: vi.fn(), post: vi.fn() },
}));

function renderBody(blockSources: IBlockSource[]) {
  const shipment: IShipmentDetail = { ...MOCK_SHIPMENT_DETAIL, block_sources: blockSources };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const utils = render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ShipmentGoodsBody
          shipment={shipment}
          missingKeys={new Set()}
          readOnly={false}
          canOverrideVariety={false}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const section = utils.container.querySelector('#section-block-sources');
  if (!section) throw new Error('block-sources section not rendered');
  return within(section as HTMLElement);
}

describe('ShipmentGoodsBody block sources', () => {
  beforeAll(async () => {
    // Pin language so this suite doesn't depend on happy-dom's detected locale.
    await i18n.changeLanguage('en');
  });

  it('renders a two-batch truck from one block once, with both dates and both weights', () => {
    const row = renderBody([
      { block_code: 'A', block_name: 'A-Ýyladyşhana', weight_kg: 3000, harvest_date: '2026-09-21' },
      { block_code: 'A', block_name: 'A-Ýyladyşhana', weight_kg: 5000, harvest_date: '2026-09-24' },
    ]);
    const expected = `A: ${fmtDate('2026-09-21')} — ${fmtNum(3000)}, ${fmtDate('2026-09-24')} — ${fmtNum(5000)}`;
    expect(row.getByText(expected)).toBeInTheDocument();
    // The old bug this replaces: a bare "A, A" from one entry per row.
    expect(row.queryByText('A, A')).not.toBeInTheDocument();
  });

  it('reads a single-batch truck exactly as it did before — bare block code, no date/weight noise', () => {
    const row = renderBody([
      { block_code: 'A', block_name: 'A-Ýyladyşhana', weight_kg: 3000, harvest_date: '2026-09-21' },
    ]);
    expect(row.getByText('A')).toBeInTheDocument();
    expect(row.queryByText(fmtDate('2026-09-21'), { exact: false })).not.toBeInTheDocument();
    expect(row.queryByText(fmtNum(3000), { exact: false })).not.toBeInTheDocument();
  });

  it('two single-batch blocks still read as the plain comma-joined list', () => {
    const row = renderBody([
      { block_code: 'A', block_name: 'A-Ýyladyşhana', weight_kg: 3000, harvest_date: '2026-09-21' },
      { block_code: 'B', block_name: 'B-Ýyladyşhana', weight_kg: 6500, harvest_date: '2026-09-21' },
    ]);
    expect(row.getByText('A, B')).toBeInTheDocument();
  });

  it('drops a null harvest_date rather than rendering it empty or as "null"', () => {
    const row = renderBody([
      { block_code: 'A', block_name: 'A-Ýyladyşhana', weight_kg: 3000, harvest_date: '2026-09-21' },
      { block_code: 'A', block_name: 'A-Ýyladyşhana', weight_kg: 5000, harvest_date: null },
    ]);
    const expected = `A: ${fmtDate('2026-09-21')} — ${fmtNum(3000)}, ${fmtNum(5000)}`;
    expect(row.getByText(expected)).toBeInTheDocument();
    expect(row.queryByText(/null/i)).not.toBeInTheDocument();
  });
});
