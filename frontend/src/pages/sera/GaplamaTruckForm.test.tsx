import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider } from 'antd';
import api from '@/services/api';
import GaplamaTruckForm from './GaplamaTruckForm';

vi.mock('@/services/api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

// The board's `carry_in_breakdown` shape plus today's own plan as a same-day
// batch (task-7-brief.md, Step 1) — block 1 carries a 21.09 batch (3 days
// old) and its own 24.09 plan; block 2 has only today's own plan. The two
// block-level caps (`availableByBlock`) are each exactly the sum of their
// own batches' caps, so a test that wants to exercise the BLOCK cap
// independently of any single batch cap overrides `availableByBlock` down.
function defaultBatchesByBlock() {
  return {
    1: [
      { harvest_date: '2026-09-21', age_days: 3, available_kg: 3000 },
      { harvest_date: '2026-09-24', age_days: 0, available_kg: 9000 },
    ],
    2: [
      { harvest_date: '2026-09-24', age_days: 0, available_kg: 6500 },
    ],
  };
}

function renderForm(overrides: Partial<React.ComponentProps<typeof GaplamaTruckForm>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const props = {
    mode: 'create' as const,
    today: '2026-09-24',
    availableByBlock: { 1: 12000, 2: 6500 },
    batchesByBlock: defaultBatchesByBlock(),
    carryDaysByBlock: { 1: 7, 2: 7 },
    blocks: [{ id: 1, code: 'A', label: 'A' }, { id: 2, code: 'B', label: 'B' }],
    truckCapacityKg: 18500,
    onDone: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<QueryClientProvider client={qc}><GaplamaTruckForm {...props} /></QueryClientProvider>);
  return props;
}

describe('GaplamaTruckForm — create', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders one input per batch, oldest first, for the default block', () => {
    renderForm();
    // Block 1 has two batches (21.09, 24.09); block 2 (not yet chosen) has
    // none on screen yet — two spinbuttons total.
    expect(screen.getAllByRole('spinbutton')).toHaveLength(2);
  });

  it('disables submit when no row has kg', () => {
    renderForm();
    expect(screen.getByRole('button', { name: 'tir_takip.gaplama.form.open_truck' })).toBeDisabled();
  });

  it('caps a batch at its own available kg and refuses more', () => {
    renderForm();
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '5000' } }); // 21.09 batch only holds 3000
    expect(inputs[0]).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'tir_takip.gaplama.form.open_truck' })).toBeDisabled();
  });

  // The per-block cap is real (a same-day sibling truck may already have
  // drawn from the block's total even though the batch breakdown itself
  // can't attribute that draw to one specific batch) — so the SUM across a
  // block's batches is still bounded by the block's own available_kg, even
  // when every individual batch is within its own cap.
  it('caps the block total even when each batch is individually within its own cap', () => {
    renderForm({ availableByBlock: { 1: 10000, 2: 6500 } }); // tighter than the 3000+9000 batch sum
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '3000' } }); // at its own cap
    fireEvent.change(inputs[1], { target: { value: '9000' } }); // at its own cap, but 3000+9000=12000 > 10000
    expect(inputs[0]).toHaveAttribute('aria-invalid', 'true');
    expect(inputs[1]).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'tir_takip.gaplama.form.open_truck' })).toBeDisabled();
  });

  it('sends one block_source per batch, each with its own harvest_date', async () => {
    (api.post as any).mockResolvedValue({ data: { id: 1, shipment_code: '2109001/26' } });
    renderForm();
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '3000' } }); // 21.09 batch
    fireEvent.change(inputs[1], { target: { value: '5000' } }); // 24.09 batch
    fireEvent.click(screen.getByRole('button', { name: 'tir_takip.gaplama.form.open_truck' }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [, body] = (api.post as any).mock.calls[0];
    expect(body.block_sources).toEqual([
      { block_id: 1, weight_kg: 3000, harvest_date: '2026-09-21' },
      { block_id: 1, weight_kg: 5000, harvest_date: '2026-09-24' },
    ]);
  });

  // Pre-batch-selection, this test typed a single 12000 into the one row a
  // block used to have. Block 1's live batches now cap at 3000 and 9000
  // individually, so reaching the same 12000 total needs both — restoring
  // the original number rather than quietly shrinking the assertion.
  it('submits with skip_forecast_check, today\'s date, weight_net = sum, no shipment_code', async () => {
    (api.post as any).mockResolvedValue({ data: { id: 1, shipment_code: '2109001/26' } });
    renderForm();
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '3000' } }); // 21.09 batch, at its cap
    fireEvent.change(inputs[1], { target: { value: '9000' } }); // 24.09 batch, at its cap
    fireEvent.click(screen.getByRole('button', { name: 'tir_takip.gaplama.form.open_truck' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [, body] = (api.post as any).mock.calls[0];
    expect(body.skip_forecast_check).toBe(true);
    expect(body.date).toBe('2026-09-24');
    expect(body.weight_net).toBe(12000);
    expect(body.shipment_code).toBeUndefined();
    expect(body.block_sources).toEqual([
      { block_id: 1, weight_kg: 3000, harvest_date: '2026-09-21' },
      { block_id: 1, weight_kg: 9000, harvest_date: '2026-09-24' },
    ]);
  });

  it('adds a second block\'s batches via + Blok goş', () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'tir_takip.gaplama.form.add_block' }));
    // Block 1's two batches plus block 2's one batch.
    expect(screen.getAllByRole('spinbutton')).toHaveLength(3);
  });

  // Round-1 review finding: `addBlock` never offers an already-chosen block,
  // but the per-card block Select (`changeBlock`) can still be pointed at a
  // block another card already shows. The two cards must collapse into one
  // (chosenBlockIds is a de-duped Set) and that block's kilograms must never
  // be double-counted — asserted on the submitted payload, not rendered
  // text, so it pins what actually reaches the server.
  it('never double-counts a block reached by pointing two cards at it', async () => {
    (api.post as any).mockResolvedValue({ data: { id: 1, shipment_code: '2109001/26' } });
    // antd's Select virtualizes its dropdown by default (rc-virtual-list),
    // which needs a real layout engine to measure item heights — happy-dom
    // has none, so a virtualized option never resolves to a clickable node
    // here. `ConfigProvider virtual={false}` is antd's own documented
    // escape hatch for exactly this; scoped to this one test only, not the
    // shared `renderForm` helper or the component itself.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const props = {
      mode: 'create' as const,
      today: '2026-09-24',
      availableByBlock: { 1: 12000, 2: 6500 },
      batchesByBlock: defaultBatchesByBlock(),
      carryDaysByBlock: { 1: 7, 2: 7 },
      blocks: [{ id: 1, code: 'A', label: 'A' }, { id: 2, code: 'B', label: 'B' }],
      truckCapacityKg: 18500,
      onDone: vi.fn(),
      onCancel: vi.fn(),
    };
    render(
      <ConfigProvider virtual={false}>
        <QueryClientProvider client={qc}><GaplamaTruckForm {...props} /></QueryClientProvider>
      </ConfigProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'tir_takip.gaplama.form.add_block' })); // adds block 2's card

    // Point the second card's own Select at block 1 too — the changeBlock
    // path, not addBlock. Scoped to the second `.sera-gaplama-form-block`
    // card specifically: the page also has non-block Selects (month, harvest
    // status, variety), so an unscoped combobox index is not reliable.
    const cards = document.querySelectorAll('.sera-gaplama-form-block');
    expect(cards).toHaveLength(2);
    const combobox = within(cards[1] as HTMLElement).getByRole('combobox');
    await userEvent.click(combobox);
    // Scoped to the open dropdown's listbox — card 1's own closed Select
    // already displays "A" as its current value, so an unscoped text query
    // matches both.
    const listbox = await screen.findByRole('listbox');
    await userEvent.click(await within(listbox).findByText('A'));

    // Collapsed to one card — only block 1's own two batches remain.
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs).toHaveLength(2);

    fireEvent.change(inputs[0], { target: { value: '3000' } });
    fireEvent.change(inputs[1], { target: { value: '9000' } });
    fireEvent.click(screen.getByRole('button', { name: 'tir_takip.gaplama.form.open_truck' }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [, body] = (api.post as any).mock.calls[0];
    expect(body.block_sources).toEqual([
      { block_id: 1, weight_kg: 3000, harvest_date: '2026-09-21' },
      { block_id: 1, weight_kg: 9000, harvest_date: '2026-09-24' },
    ]);
  });

  it('shows the oldest batch\'s age next to the total once it carries kg', () => {
    renderForm();
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '3000' } }); // 21.09, age 3
    fireEvent.change(inputs[1], { target: { value: '1000' } }); // 24.09, age 0
    expect(screen.getByText('tir_takip.gaplama.form.oldest_batch')).toBeInTheDocument();
  });

  it('shows the block\'s carry window in its header', () => {
    renderForm({ carryDaysByBlock: { 1: 7, 2: 2 } });
    expect(screen.getByText('tir_takip.gaplama.form.carry_window')).toBeInTheDocument();
  });
});

describe('GaplamaTruckForm — edit', () => {
  beforeEach(() => vi.clearAllMocks());

  const editingTruck = {
    id: 9, shipment_code: '2109001/26', export_code: null, date: '2026-09-21',
    status: 1, status_code: 'draft', status_display: 'Draft', country: null, customer: null,
    block_sources: [{ block_id: 1, block_code: 'A', weight_kg: 8000 }],
  };

  it('seeds the row from the truck\'s real per-batch data and adds its own allocation back to the block cap', () => {
    renderForm({
      mode: 'edit',
      editingTruck,
      // Real per-batch data (from the drafts endpoint, which — unlike the
      // board's own trucks[] — carries harvest_date per row).
      editingTruckBatches: [{ block_id: 1, block_code: 'A', weight_kg: 8000, harvest_date: '2026-09-21' }],
      availableByBlock: { 1: 12000 },
      // Single batch on this block/date: its gross (pre-this-day's-consumption)
      // figure already equals net (12000) + this truck's own (8000) — 20000.
      batchesByBlock: { 1: [{ harvest_date: '2026-09-21', age_days: 3, available_kg: 20000 }] },
    });
    const kgInput = screen.getAllByRole('spinbutton')[0] as HTMLInputElement;
    expect(kgInput).toHaveValue(8000);
    fireEvent.change(kgInput, { target: { value: '19000' } }); // <= batch cap 20000 and block cap 12000+8000=20000
    expect(kgInput).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('keeps a seeded batch that has expired off the live batch list, capped at its own kg', () => {
    renderForm({
      mode: 'edit',
      editingTruck,
      // 2026-08-01 no longer appears in the live batch list for this
      // block/date (it has expired) — the row must still show up, still
      // hold its own 4000 kg, and never flag invalid: dropping it would
      // delete that weight on save (advisor guidance).
      editingTruckBatches: [{ block_id: 1, block_code: 'A', weight_kg: 4000, harvest_date: '2026-08-01' }],
      availableByBlock: { 1: 12000 },
      batchesByBlock: { 1: [{ harvest_date: '2026-09-21', age_days: 0, available_kg: 12000 }] },
    });
    const kgInput = screen.getAllByRole('spinbutton')[0] as HTMLInputElement;
    expect(kgInput).toHaveValue(4000);
    expect(kgInput).not.toHaveAttribute('aria-invalid', 'true');
  });

  // The truck currently only drew from the 21.09 batch, but the block also
  // has a fresh 24.09 batch today — the operator must be able to move kg
  // onto it (the entire point of editing), not just adjust the batch the
  // truck already has.
  it('offers a block\'s other live batches too, not only the ones the truck already has', () => {
    renderForm({
      mode: 'edit',
      editingTruck,
      editingTruckBatches: [{ block_id: 1, block_code: 'A', weight_kg: 8000, harvest_date: '2026-09-21' }],
      availableByBlock: { 1: 12000 },
      batchesByBlock: {
        1: [
          { harvest_date: '2026-09-21', age_days: 3, available_kg: 20000 },
          { harvest_date: '2026-09-24', age_days: 0, available_kg: 4000 },
        ],
      },
    });
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toHaveValue(8000); // the seeded 21.09 batch
    expect(inputs[1]).toHaveValue(null); // the 24.09 batch, offered but empty
    fireEvent.change(inputs[1], { target: { value: '2000' } });
    expect(inputs[1]).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('falls back to the block-level total dated the truck\'s own day when no per-batch data is available', () => {
    renderForm({
      mode: 'edit',
      editingTruck,
      editingTruckBatches: undefined, // the truck wasn't found among the drafts (edge case)
      availableByBlock: { 1: 12000 },
      batchesByBlock: { 1: [{ harvest_date: '2026-09-21', age_days: 0, available_kg: 17000 }] },
    });
    const kgInput = screen.getAllByRole('spinbutton')[0] as HTMLInputElement;
    expect(kgInput).toHaveValue(8000);
  });

  // 2026-09-25 fix: EVERY shipment on the live DB has a null block-source
  // harvest_date (pre-batch-selection data). The seeded row falls back onto
  // the truck's own day, landing on the SAME date as that day's own-plan
  // batch — so its kg (which may include carry-in this legacy row can't
  // attribute to any one date) was measured against that day's plan ALONE,
  // not the block's real available headroom. A draft that loaded more than
  // the day's own plan opened already red, before the operator touched
  // anything.
  it("never shows a null-harvest_date seeded row invalid, even over that day's own plan", () => {
    const localTruck = {
      id: 20, shipment_code: '2109020/26', export_code: null, date: '2026-09-21',
      status: 1, status_code: 'draft', status_display: 'Draft', country: null, customer: null,
      block_sources: [{ block_id: 1, block_code: 'A', weight_kg: 18000 }],
    };
    renderForm({
      mode: 'edit',
      editingTruck: localTruck,
      editingTruckBatches: [{ block_id: 1, block_code: 'A', weight_kg: 18000, harvest_date: null }],
      availableByBlock: { 1: 0 }, // 8000 carry-in + 10000 today's plan - 18000 already loaded
      batchesByBlock: {
        1: [
          { harvest_date: '2026-09-20', age_days: 1, available_kg: 8000 },
          { harvest_date: '2026-09-21', age_days: 0, available_kg: 10000 },
        ],
      },
    });
    const inputs = screen.getAllByRole('spinbutton');
    // Oldest-first: [0] is the empty 20.09 carry-in row offered alongside it,
    // [1] is the seeded 21.09 row actually carrying the truck's 18000.
    expect(inputs[1]).toHaveValue(18000);
    for (const input of inputs) {
      expect(input).not.toHaveAttribute('aria-invalid', 'true');
    }
    expect(screen.getByRole('button', { name: 'tir_takip.gaplama.form.save' })).not.toBeDisabled();
  });

  // Guard against an exact-replacement fix: the orphan's own kg is a FLOOR
  // on that date's cap, not a ceiling — the live cap must still apply above
  // it. Already green pre-fix (this one never hit the bug); exists to catch
  // a fix that replaces the live cap outright instead of taking the max.
  it('still caps a null-harvest_date row at the live batch when raised within it', () => {
    const localTruck = {
      id: 21, shipment_code: '2109021/26', export_code: null, date: '2026-09-21',
      status: 1, status_code: 'draft', status_display: 'Draft', country: null, customer: null,
      block_sources: [{ block_id: 1, block_code: 'A', weight_kg: 5000 }],
    };
    renderForm({
      mode: 'edit',
      editingTruck: localTruck,
      editingTruckBatches: [{ block_id: 1, block_code: 'A', weight_kg: 5000, harvest_date: null }],
      availableByBlock: { 1: 5000 },
      batchesByBlock: { 1: [{ harvest_date: '2026-09-21', age_days: 0, available_kg: 10000 }] },
    });
    const kgInput = screen.getAllByRole('spinbutton')[0] as HTMLInputElement;
    expect(kgInput).toHaveValue(5000);
    fireEvent.change(kgInput, { target: { value: '8000' } });
    expect(kgInput).not.toHaveAttribute('aria-invalid', 'true');
  });

  // The degrade-to-block-level-totals fallback (editingTruckBatches
  // unresolved) has the identical bug: it dates every row the truck's own
  // day with no real per-batch attribution — the same situation as an
  // explicit null harvest_date.
  it("never shows the fallback (no per-batch data) row invalid either, over that day's own plan", () => {
    const localTruck = {
      id: 22, shipment_code: '2109022/26', export_code: null, date: '2026-09-21',
      status: 1, status_code: 'draft', status_display: 'Draft', country: null, customer: null,
      block_sources: [{ block_id: 1, block_code: 'A', weight_kg: 18000 }],
    };
    renderForm({
      mode: 'edit',
      editingTruck: localTruck,
      editingTruckBatches: undefined,
      availableByBlock: { 1: 0 },
      batchesByBlock: { 1: [{ harvest_date: '2026-09-21', age_days: 0, available_kg: 10000 }] },
    });
    const kgInput = screen.getAllByRole('spinbutton')[0] as HTMLInputElement;
    expect(kgInput).toHaveValue(18000);
    expect(kgInput).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'tir_takip.gaplama.form.save' })).not.toBeDisabled();
  });

  // The first Save bakes the fallback date in: handleSubmit sends
  // row.harvestDate, which the null-date fallback set to the truck's own
  // day — so the row is written with a real (non-null) harvest_date. On the
  // SECOND Üýtget it is no longer null, so a fix that only special-cases a
  // null SOURCE harvest_date stops treating it as an orphan and the row
  // goes red again, breaking "a seeded row must never show as invalid" on
  // reopen (2026-09-25, found in re-review of the null-harvest_date fix).
  it('stays valid on a second edit, after saving baked the fallback date in', () => {
    const localTruck = {
      id: 23, shipment_code: '2109023/26', export_code: null, date: '2026-09-21',
      status: 1, status_code: 'draft', status_display: 'Draft', country: null, customer: null,
      block_sources: [{ block_id: 1, block_code: 'A', weight_kg: 18000 }],
    };
    renderForm({
      mode: 'edit',
      editingTruck: localTruck,
      editingTruckBatches: [{ block_id: 1, block_code: 'A', weight_kg: 18000, harvest_date: '2026-09-21' }],
      availableByBlock: { 1: 0 },
      batchesByBlock: {
        1: [
          { harvest_date: '2026-09-20', age_days: 1, available_kg: 8000 },
          { harvest_date: '2026-09-21', age_days: 0, available_kg: 10000 },
        ],
      },
    });
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs[1]).toHaveValue(18000);
    for (const input of inputs) {
      expect(input).not.toHaveAttribute('aria-invalid', 'true');
    }
    expect(screen.getByRole('button', { name: 'tir_takip.gaplama.form.save' })).not.toBeDisabled();
  });

  it('sends block_id and harvest_date for each row on save', async () => {
    (api.post as any).mockResolvedValue({ data: {} });
    (api.patch as any).mockResolvedValue({ data: {} });
    renderForm({
      mode: 'edit',
      editingTruck,
      editingTruckBatches: [{ block_id: 1, block_code: 'A', weight_kg: 8000, harvest_date: '2026-09-21' }],
      availableByBlock: { 1: 12000 },
      batchesByBlock: { 1: [{ harvest_date: '2026-09-21', age_days: 3, available_kg: 20000 }] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'tir_takip.gaplama.form.save' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [, body] = (api.post as any).mock.calls[0];
    expect(body.blocks).toEqual([{ block_id: 1, weight_kg: 8000, harvest_date: '2026-09-21' }]);
  });
});
