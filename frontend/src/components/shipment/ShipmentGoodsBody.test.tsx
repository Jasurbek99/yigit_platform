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
vi.mock('@/components/shipment/ShipmentPackingActions', () => ({ ShipmentPackingActions: () => null }));
vi.mock('@/components/shipment/VarietyOverrideRow', () => ({ VarietyOverrideRow: () => null }));

/** "3,000 kg" — matches the "shipment_detail.block_sources_weight_kg" key. */
function weightLabel(kg: number): string {
  return i18n.t('shipment_detail.block_sources_weight_kg', { weight: fmtNum(kg) });
}

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
    const expected = `A: ${fmtDate('2026-09-21')} — ${weightLabel(3000)}, ${fmtDate('2026-09-24')} — ${weightLabel(5000)}`;
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
    expect(row.queryByText(weightLabel(3000), { exact: false })).not.toBeInTheDocument();
  });

  // The task named this the common case on merge day: every shipment that
  // predates batches has harvest_date = NULL on its single block-source row.
  // A single batch always renders as the bare code regardless of its date —
  // this pins that a null date on the single-batch path is no different.
  it('reads a single-batch truck with a null harvest_date exactly the same — the pre-batches norm', () => {
    const row = renderBody([
      { block_code: 'A', block_name: 'A-Ýyladyşhana', weight_kg: 3000, harvest_date: null },
    ]);
    expect(row.getByText('A')).toBeInTheDocument();
    expect(row.queryByText(weightLabel(3000), { exact: false })).not.toBeInTheDocument();
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
    const expected = `A: ${fmtDate('2026-09-21')} — ${weightLabel(3000)}, ${weightLabel(5000)}`;
    expect(row.getByText(expected)).toBeInTheDocument();
    expect(row.queryByText(/null/i)).not.toBeInTheDocument();
  });

  // A single-batch block's bare code shares "," with a multi-batch block's
  // own batch separator and fmtNum's thousands separator — so once any
  // block needs the breakdown, blocks must join on something else, or a
  // trailing bare code reads as another batch value.
  it('uses "; " between blocks once one of them has multiple batches, not ","', () => {
    const row = renderBody([
      { block_code: 'A', block_name: 'A-Ýyladyşhana', weight_kg: 3000, harvest_date: '2026-09-21' },
      { block_code: 'A', block_name: 'A-Ýyladyşhana', weight_kg: 5000, harvest_date: '2026-09-24' },
      { block_code: 'B', block_name: 'B-Ýyladyşhana', weight_kg: 6500, harvest_date: '2026-09-21' },
    ]);
    const expected = `A: ${fmtDate('2026-09-21')} — ${weightLabel(3000)}, ${fmtDate('2026-09-24')} — ${weightLabel(5000)}; B`;
    expect(row.getByText(expected)).toBeInTheDocument();
  });

  // A two-null-date sort-tie regression used to live here as a rendered-order
  // assertion, but a 2-element Array.sort doesn't reliably invoke its
  // comparator in both argument orders — that test passed identically
  // whether the comparator's null/null branch returned 0 or the old buggy 1.
  // The discriminating test is `compareBatchesByHarvestDate` in
  // `blockSourceGroups.test.ts`, which calls the comparator directly.
  it('renders two null-date batches in the same block without crashing or losing either weight', () => {
    const row = renderBody([
      { block_code: 'A', block_name: 'A-Ýyladyşhana', weight_kg: 3000, harvest_date: null },
      { block_code: 'A', block_name: 'A-Ýyladyşhana', weight_kg: 5000, harvest_date: null },
    ]);
    expect(row.getByText(weightLabel(3000), { exact: false })).toBeInTheDocument();
    expect(row.getByText(weightLabel(5000), { exact: false })).toBeInTheDocument();
  });

  it('uses "; " between two multi-batch blocks, each with its own breakdown', () => {
    const row = renderBody([
      { block_code: 'A', block_name: 'A-Ýyladyşhana', weight_kg: 3000, harvest_date: '2026-09-21' },
      { block_code: 'A', block_name: 'A-Ýyladyşhana', weight_kg: 5000, harvest_date: '2026-09-24' },
      { block_code: 'B', block_name: 'B-Ýyladyşhana', weight_kg: 1000, harvest_date: '2026-09-20' },
      { block_code: 'B', block_name: 'B-Ýyladyşhana', weight_kg: 2000, harvest_date: '2026-09-22' },
    ]);
    const expectedA = `A: ${fmtDate('2026-09-21')} — ${weightLabel(3000)}, ${fmtDate('2026-09-24')} — ${weightLabel(5000)}`;
    const expectedB = `B: ${fmtDate('2026-09-20')} — ${weightLabel(1000)}, ${fmtDate('2026-09-22')} — ${weightLabel(2000)}`;
    expect(row.getByText(`${expectedA}; ${expectedB}`)).toBeInTheDocument();
  });
});

function renderGoods(over: Partial<IShipmentDetail>) {
  const shipment: IShipmentDetail = { ...MOCK_SHIPMENT_DETAIL, ...over };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ShipmentGoodsBody shipment={shipment} missingKeys={new Set()} readOnly={false} canOverrideVariety={false} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('ShipmentGoodsBody — packaging part rows', () => {
  it('drops gross / tare / pallets / boxes (the packing panel owns them) and keeps net', () => {
    const { container } = renderGoods({});
    for (const key of ['weight_gross', 'packaging_kg', 'pallet_count', 'box_count']) {
      expect(container.querySelector(`#detail-field-${key}`)).toBeNull();
    }
    expect(container.querySelector('#detail-field-weight_net')).not.toBeNull();
    expect(container.querySelector('#detail-field-loading_started_at')).not.toBeNull();
    expect(container.querySelector('#detail-field-loading_ended_at')).not.toBeNull();
  });

  it('harvest date: block dates win and are read-only', () => {
    const { container } = renderGoods({
      harvest_date: '5-10 oktýabr',
      block_sources: [{ block_code: 'A', block_name: 'A', weight_kg: 1000, harvest_date: '2026-09-21' }],
    });
    const row = container.querySelector('#detail-field-harvest_date') as HTMLElement;
    expect(within(row).getByText(new RegExp(fmtDate('2026-09-21')))).toBeInTheDocument();
    expect(within(row).queryByText('5-10 oktýabr')).toBeNull();
  });

  it('harvest date: the shipment text when blocks carry no date', () => {
    const { container } = renderGoods({ harvest_date: '5-10 oktýabr', block_sources: [] });
    const row = container.querySelector('#detail-field-harvest_date') as HTMLElement;
    expect(within(row).getByText('5-10 oktýabr')).toBeInTheDocument();
  });
});
