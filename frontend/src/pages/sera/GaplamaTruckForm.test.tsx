import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider } from 'antd';
import api from '@/services/api';
import GaplamaTruckForm, { effectiveBatches } from './GaplamaTruckForm';

vi.mock('@/services/api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

// The board's per-block batch list, post batch-selection removal
// (2026-09-25): at most two rows — the block's collapsed leftover (a null
// harvest_date, since the loading/packaging hall physically mixes carried-in
// crates and no single date describes the pile — owner + loading/packaging
// head) and today's own plan. Block 1 carries a 3000 kg leftover (up to 3
// days old) plus its own 9000 kg plan today; block 2 has only today's plan,
// no leftover.
function defaultBatchesByBlock() {
  return {
    1: [
      { harvest_date: null, age_days: 3, available_kg: 3000 },
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

  it('renders one input per batch, leftover first, for the default block', () => {
    renderForm();
    // Block 1 has two batches (leftover, today); block 2 (not yet chosen) has
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
    fireEvent.change(inputs[0], { target: { value: '5000' } }); // leftover only holds 3000
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
    fireEvent.change(inputs[0], { target: { value: '3000' } }); // at its own cap (leftover)
    fireEvent.change(inputs[1], { target: { value: '9000' } }); // at its own cap (today), but 3000+9000=12000 > 10000
    expect(inputs[0]).toHaveAttribute('aria-invalid', 'true');
    expect(inputs[1]).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'tir_takip.gaplama.form.open_truck' })).toBeDisabled();
  });

  // Test #3 of the batch-selection-removal brief: the leftover row must post
  // a null harvest_date (the backend's own null-dated load consumes it
  // FIFO, oldest-first, across the mixed pool — see set_block_sources);
  // today's own row keeps sending today's real date.
  it('sends the leftover row with a null harvest_date and today\'s row with today\'s date', async () => {
    (api.post as any).mockResolvedValue({ data: { id: 1, shipment_code: '2109001/26' } });
    renderForm();
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '3000' } }); // leftover
    fireEvent.change(inputs[1], { target: { value: '5000' } }); // today
    fireEvent.click(screen.getByRole('button', { name: 'tir_takip.gaplama.form.open_truck' }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [, body] = (api.post as any).mock.calls[0];
    expect(body.block_sources).toEqual([
      { block_id: 1, weight_kg: 3000, harvest_date: null },
      { block_id: 1, weight_kg: 5000, harvest_date: '2026-09-24' },
    ]);
  });

  // Pre-batch-selection, this test typed a single 12000 into the one row a
  // block used to have. Block 1's live batches now cap at 3000 (leftover)
  // and 9000 (today) individually, so reaching the same 12000 total needs
  // both — restoring the original number rather than quietly shrinking the
  // assertion.
  it('submits with skip_forecast_check, today\'s date, weight_net = sum, no shipment_code', async () => {
    (api.post as any).mockResolvedValue({ data: { id: 1, shipment_code: '2109001/26' } });
    renderForm();
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '3000' } }); // leftover, at its cap
    fireEvent.change(inputs[1], { target: { value: '9000' } }); // today, at its cap
    fireEvent.click(screen.getByRole('button', { name: 'tir_takip.gaplama.form.open_truck' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [, body] = (api.post as any).mock.calls[0];
    expect(body.skip_forecast_check).toBe(true);
    expect(body.date).toBe('2026-09-24');
    expect(body.weight_net).toBe(12000);
    expect(body.shipment_code).toBeUndefined();
    expect(body.block_sources).toEqual([
      { block_id: 1, weight_kg: 3000, harvest_date: null },
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
      { block_id: 1, weight_kg: 3000, harvest_date: null },
      { block_id: 1, weight_kg: 9000, harvest_date: '2026-09-24' },
    ]);
  });

  it('shows the oldest batch\'s age next to the total once it carries kg', () => {
    renderForm();
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '3000' } }); // leftover, age 3
    fireEvent.change(inputs[1], { target: { value: '1000' } }); // today, age 0
    expect(screen.getByText('tir_takip.gaplama.form.oldest_batch')).toBeInTheDocument();
  });

  it('shows the block\'s carry window in its header', () => {
    renderForm({ carryDaysByBlock: { 1: 7, 2: 2 } });
    expect(screen.getByText('tir_takip.gaplama.form.carry_window')).toBeInTheDocument();
  });

  // Test #4 of the batch-selection-removal brief.
  it('shows only today\'s row when the block has no leftover to carry', () => {
    renderForm({
      batchesByBlock: { 1: [{ harvest_date: '2026-09-24', age_days: 0, available_kg: 9000 }] },
    });
    expect(screen.getAllByRole('spinbutton')).toHaveLength(1);
  });
});

describe('GaplamaTruckForm — edit', () => {
  beforeEach(() => vi.clearAllMocks());

  const editingTruck = {
    id: 9, shipment_code: '2109001/26', export_code: null, date: '2026-09-21',
    status: 1, status_code: 'draft', status_display: 'Draft', country: null, customer: null,
    block_sources: [{ block_id: 1, block_code: 'A', weight_kg: 8000 }],
  };

  it('seeds today\'s row from the truck\'s real per-batch data and adds its own allocation back to the block cap', () => {
    renderForm({
      mode: 'edit',
      editingTruck,
      // Real per-batch data (from the drafts endpoint, which — unlike the
      // board's own trucks[] — carries harvest_date per row). Dated exactly
      // the truck's own day, so this folds to the TODAY bucket, not leftover.
      editingTruckBatches: [{ block_id: 1, block_code: 'A', weight_kg: 8000, harvest_date: '2026-09-21' }],
      availableByBlock: { 1: 12000 },
      // Single batch on this block/date: its gross (pre-this-day's-consumption)
      // figure already equals net (12000) + this truck's own (8000) — 20000.
      batchesByBlock: { 1: [{ harvest_date: '2026-09-21', age_days: 0, available_kg: 20000 }] },
    });
    const kgInput = screen.getAllByRole('spinbutton')[0] as HTMLInputElement;
    expect(kgInput).toHaveValue(8000);
    fireEvent.change(kgInput, { target: { value: '19000' } }); // <= batch cap 20000 and block cap 12000+8000=20000
    expect(kgInput).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('keeps a seeded leftover row that has expired off the live batch list, capped at its own kg', () => {
    renderForm({
      mode: 'edit',
      editingTruck,
      // A real date OTHER than the truck's own day folds to the leftover
      // bucket. It no longer appears in the live batch list for this
      // block/date (it has expired) — the row must still show up, still
      // hold its own 4000 kg, and never flag invalid: dropping it would
      // delete that weight on save (advisor guidance).
      editingTruckBatches: [{ block_id: 1, block_code: 'A', weight_kg: 4000, harvest_date: '2026-08-01' }],
      availableByBlock: { 1: 12000 },
      batchesByBlock: { 1: [{ harvest_date: '2026-09-21', age_days: 0, available_kg: 12000 }] },
    });
    const inputs = screen.getAllByRole('spinbutton');
    // Leftover (null) sorts first: [0] is the folded 4000 kg row, [1] is
    // today's own plan, offered empty.
    expect(inputs[0]).toHaveValue(4000);
    expect(inputs[0]).not.toHaveAttribute('aria-invalid', 'true');
  });

  // The truck currently only drew from today's own plan, but the block also
  // has a live leftover bucket it hasn't touched — the operator must be able
  // to move kg onto it (the entire point of editing), not just adjust the
  // batch the truck already has.
  it('offers a block\'s leftover bucket too, not only the one the truck already drew from', () => {
    renderForm({
      mode: 'edit',
      editingTruck,
      editingTruckBatches: [{ block_id: 1, block_code: 'A', weight_kg: 8000, harvest_date: '2026-09-21' }],
      availableByBlock: { 1: 12000 },
      batchesByBlock: {
        1: [
          { harvest_date: '2026-09-21', age_days: 0, available_kg: 20000 },
          { harvest_date: null, age_days: 4, available_kg: 4000 },
        ],
      },
    });
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toHaveValue(null); // leftover, offered but empty (sorts first)
    expect(inputs[1]).toHaveValue(8000); // the seeded today row
    fireEvent.change(inputs[0], { target: { value: '2000' } });
    expect(inputs[0]).not.toHaveAttribute('aria-invalid', 'true');
  });

  // No per-row harvest_date exists at all in this fallback (the truck's
  // own block-level totals, no drafts-endpoint match) — pinned to the
  // truck's own day, same as it always was pre-collapse, NOT the leftover
  // bucket: that's a stronger signal (a specific row known to have no date)
  // this fallback doesn't have.
  it('falls back to today\'s row, dated the truck\'s own day, when no per-batch data is available', () => {
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

  // 2026-09-25 fix (original, pre-collapse): EVERY shipment on the live DB
  // had a null block-source harvest_date (pre-batch-selection data). Now
  // that null IS the leftover bucket's own canonical key, this is simply the
  // ordinary collision-merge path, not a forced/special case — the seeded
  // leftover row must still never show invalid, even when it's above the
  // leftover bucket's own live cap.
  it("never shows a null-harvest_date seeded row invalid, even over the leftover bucket's own live cap", () => {
    const localTruck = {
      id: 20, shipment_code: '2109020/26', export_code: null, date: '2026-09-21',
      status: 1, status_code: 'draft', status_display: 'Draft', country: null, customer: null,
      block_sources: [{ block_id: 1, block_code: 'A', weight_kg: 18000 }],
    };
    renderForm({
      mode: 'edit',
      editingTruck: localTruck,
      editingTruckBatches: [{ block_id: 1, block_code: 'A', weight_kg: 18000, harvest_date: null }],
      availableByBlock: { 1: 0 },
      batchesByBlock: {
        1: [
          { harvest_date: null, age_days: 1, available_kg: 8000 }, // leftover — less than what's seeded
          { harvest_date: '2026-09-21', age_days: 0, available_kg: 10000 }, // today's own plan
        ],
      },
    });
    const inputs = screen.getAllByRole('spinbutton');
    // Leftover sorts first: [0] carries the seeded 18000, [1] is today's
    // empty offered row.
    expect(inputs[0]).toHaveValue(18000);
    for (const input of inputs) {
      expect(input).not.toHaveAttribute('aria-invalid', 'true');
    }
    expect(screen.getByRole('button', { name: 'tir_takip.gaplama.form.save' })).not.toBeDisabled();
  });

  // Guard against an exact-replacement fix: the orphan's own kg is a FLOOR
  // on the leftover bucket's cap, not a ceiling — the live cap must still
  // apply above it. Already green pre-fix (this one never hit the bug);
  // exists to catch a fix that replaces the live cap outright instead of
  // taking the max.
  it('still caps the leftover row at its live bucket when raised within it', () => {
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
      batchesByBlock: { 1: [{ harvest_date: null, age_days: 2, available_kg: 10000 }] },
    });
    const kgInput = screen.getAllByRole('spinbutton')[0] as HTMLInputElement;
    expect(kgInput).toHaveValue(5000);
    fireEvent.change(kgInput, { target: { value: '8000' } });
    expect(kgInput).not.toHaveAttribute('aria-invalid', 'true');
  });

  // The no-per-batch-data fallback (editingTruckBatches unresolved) pins to
  // the truck's own day (see `foldEntriesByBlock`'s doc comment) — this is
  // the ordinary today-bucket collision-merge path, not a special case.
  it('never shows the fallback (no per-batch data) row invalid either, over today\'s own live plan', () => {
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

  // Originally: the first Save baked a forced date into a null-source row,
  // and a gate that special-cased only a literal null source broke on the
  // SECOND edit once that date was real. Post-collapse, a row saved once
  // already exists on the live DB dated the truck's own day (from the old
  // form's forced-date save) — that now folds to the TODAY bucket. This
  // pins the same "must never show as invalid on reopen" guarantee for that
  // bucket: seeded 18000 must stay valid even over today's own live plan of
  // only 10000.
  it('stays valid on a second edit of a row a previous form version dated the truck\'s own day', () => {
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
          { harvest_date: null, age_days: 1, available_kg: 8000 },
          { harvest_date: '2026-09-21', age_days: 0, available_kg: 10000 },
        ],
      },
    });
    const inputs = screen.getAllByRole('spinbutton');
    // Leftover (empty, offered) sorts first; the seeded today row is [1].
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
      batchesByBlock: { 1: [{ harvest_date: '2026-09-21', age_days: 0, available_kg: 20000 }] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'tir_takip.gaplama.form.save' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [, body] = (api.post as any).mock.calls[0];
    expect(body.blocks).toEqual([{ block_id: 1, weight_kg: 8000, harvest_date: '2026-09-21' }]);
  });

  // Test #5 of the batch-selection-removal brief: a truck saved by an
  // earlier version of this form can hold TWO real dated leftover rows
  // (neither equal to the truck's own day) — they must fold into the ONE
  // leftover row, summed, not appear separately or silently vanish.
  it('folds a truck\'s two pre-existing dated leftover rows into one row with the summed kilograms', () => {
    const legacyTruck = {
      id: 40, shipment_code: '2109040/26', export_code: null, date: '2026-09-24',
      status: 1, status_code: 'draft', status_display: 'Draft', country: null, customer: null,
      block_sources: [{ block_id: 1, block_code: 'A', weight_kg: 5000 }],
    };
    renderForm({
      mode: 'edit',
      editingTruck: legacyTruck,
      editingTruckBatches: [
        { block_id: 1, block_code: 'A', weight_kg: 2000, harvest_date: '2026-09-21' },
        { block_id: 1, block_code: 'A', weight_kg: 3000, harvest_date: '2026-09-22' },
      ],
      availableByBlock: { 1: 12000 },
      batchesByBlock: { 1: [{ harvest_date: null, age_days: 3, available_kg: 9000 }] },
    });
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs).toHaveLength(1); // folded to one row, not two
    expect(inputs[0]).toHaveValue(5000); // 2000 + 3000 summed
    expect(inputs[0]).not.toHaveAttribute('aria-invalid', 'true');
  });
});

// Owner's 2026-09-25 asymmetric rule: reducing, or leaving untouched, is
// always allowed even above what the block currently has (the kg return to
// the block's derived remainder on their own); only an INCREASE past
// max(seeded, liveCap) is refused. The motivating case: a truck recorded at
// 18000 kg whose block now has only 10000 available (another truck took the
// stock, or an in-week plan cut landed after this truck was built).
describe('GaplamaTruckForm — overdraw guard (seeded floor)', () => {
  beforeEach(() => vi.clearAllMocks());

  const overdrawnTruck = {
    id: 30, shipment_code: '2109030/26', export_code: null, date: '2026-09-21',
    status: 1, status_code: 'draft', status_display: 'Draft', country: null, customer: null,
    block_sources: [{ block_id: 1, block_code: 'A', weight_kg: 18000 }],
  };

  function renderOverdrawn() {
    return renderForm({
      mode: 'edit',
      editingTruck: overdrawnTruck,
      // Dated exactly the truck's own day — this is the TODAY bucket.
      editingTruckBatches: [{ block_id: 1, block_code: 'A', weight_kg: 18000, harvest_date: '2026-09-21' }],
      // The block genuinely only has 10000 available today (the motivating
      // example) — same figure at both block and batch granularity, since
      // there is only one batch. `available_kg` is clamped at >= 0 on the
      // backend (gaplama.py: `max(Decimal(0), carried_in + plan - loaded)`),
      // so blockCapFor (base + this truck's own 18000 added back = 28000)
      // can never fall below what this truck itself already carries —
      // these tests isolate the per-batch cap the motivating example is
      // about; the block-level gate is exercised separately in test 6.
      availableByBlock: { 1: 10000 },
      batchesByBlock: { 1: [{ harvest_date: '2026-09-21', age_days: 0, available_kg: 10000 }] },
    });
  }

  it('1. opens valid with Save enabled — a row seeded above its live cap must not regress the legacy-draft fix', () => {
    renderOverdrawn();
    const kgInput = screen.getAllByRole('spinbutton')[0] as HTMLInputElement;
    expect(kgInput).toHaveValue(18000);
    expect(kgInput).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'tir_takip.gaplama.form.save' })).not.toBeDisabled();
  });

  it('2. reducing to a value still above the live cap is allowed and saves', async () => {
    (api.post as any).mockResolvedValue({ data: {} });
    (api.patch as any).mockResolvedValue({ data: {} });
    renderOverdrawn();
    const kgInput = screen.getAllByRole('spinbutton')[0] as HTMLInputElement;
    fireEvent.change(kgInput, { target: { value: '15000' } }); // still > liveCap 10000, < seeded 18000
    expect(kgInput).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'tir_takip.gaplama.form.save' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'tir_takip.gaplama.form.save' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [, body] = (api.post as any).mock.calls[0];
    expect(body.blocks).toEqual([{ block_id: 1, weight_kg: 15000, harvest_date: '2026-09-21' }]);
  });

  it('3. increasing beyond its seeded value is refused and shows the message', () => {
    renderOverdrawn();
    const kgInput = screen.getAllByRole('spinbutton')[0] as HTMLInputElement;
    fireEvent.change(kgInput, { target: { value: '19000' } }); // > seeded 18000 and > liveCap 10000
    expect(kgInput).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('tir_takip.gaplama.form.insufficient_harvest')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'tir_takip.gaplama.form.save' })).toBeDisabled();
  });

  it('4. on a new row, increasing beyond the live cap is refused and shows the message', () => {
    renderForm(); // create mode — every row is new, seeded 0. Block 1's leftover batch caps at 3000.
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '3500' } });
    expect(inputs[0]).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('tir_takip.gaplama.form.insufficient_harvest')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'tir_takip.gaplama.form.open_truck' })).toBeDisabled();
  });

  it('5. increasing within the live cap is allowed', () => {
    renderForm(); // Block 1's today batch caps at 9000.
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[1], { target: { value: '5000' } }); // <= 9000
    expect(inputs[1]).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText('tir_takip.gaplama.form.insufficient_harvest')).not.toBeInTheDocument();
  });

  // The block-level total check gets the same seeded floor as the per-batch
  // one — sum(seeded rows) becomes the floor, not a replacement for the
  // block's real cap. Row-level caps are deliberately loose here (live cap
  // 6000, well above what either row asks for) so only the block-level
  // check can bind. The two seeded rows are the leftover bucket (a real
  // date earlier than the truck's own day) and today's own bucket.
  it("6. block-level total check still refuses an increase that pushes a block's sum past its available kilograms", () => {
    const truck = {
      id: 31, shipment_code: '2109031/26', export_code: null, date: '2026-09-21',
      status: 1, status_code: 'draft', status_display: 'Draft', country: null, customer: null,
      block_sources: [{ block_id: 1, block_code: 'A', weight_kg: 8000 }],
    };
    renderForm({
      mode: 'edit',
      editingTruck: truck,
      editingTruckBatches: [
        { block_id: 1, block_code: 'A', weight_kg: 5000, harvest_date: '2026-09-20' }, // leftover (not truck's own day)
        { block_id: 1, block_code: 'A', weight_kg: 3000, harvest_date: '2026-09-21' }, // today
      ],
      availableByBlock: { 1: 0 }, // blockCapFor = 0 + own(8000) = 8000, same as the seeded total
      batchesByBlock: {
        1: [
          { harvest_date: null, age_days: 1, available_kg: 5000 }, // leftover, loose row cap (not binding)
          { harvest_date: '2026-09-21', age_days: 0, available_kg: 6000 }, // today, loose row cap (not binding)
        ],
      },
    });
    const inputs = screen.getAllByRole('spinbutton');
    // Leftover first: [0] = leftover (seeded 5000), [1] = today (seeded 3000).
    expect(inputs[0]).toHaveValue(5000);
    expect(inputs[1]).toHaveValue(3000);
    fireEvent.change(inputs[1], { target: { value: '4000' } }); // within its own row cap (6000), pushes block total to 9000 > 8000
    expect(inputs[1]).toHaveAttribute('aria-invalid', 'true');
    // The untouched leftover row (still at its seeded 5000) must NOT be
    // dragged down with it — only the row actually increased is flagged.
    expect(inputs[0]).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.getAllByText('tir_takip.gaplama.form.insufficient_harvest')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'tir_takip.gaplama.form.save' })).toBeDisabled();
  });

  // Round-1 fix: test 5 only covered create mode (seeded 0 for every row),
  // where the row-level cap is just the plain live batch cap — the same
  // path as before this change entirely. Edit mode is where the seeded
  // floor and the orphan merge actually exist, so it is the path that
  // matters: a row seeded BELOW the live cap, raised to somewhere within
  // that cap, must stay valid, not just a row raised to exactly its seeded
  // value or below.
  it('7. edit mode: a row seeded below the live cap, raised within the cap, is allowed', () => {
    const truck = {
      id: 32, shipment_code: '2109032/26', export_code: null, date: '2026-09-21',
      status: 1, status_code: 'draft', status_display: 'Draft', country: null, customer: null,
      block_sources: [{ block_id: 1, block_code: 'A', weight_kg: 5000 }],
    };
    renderForm({
      mode: 'edit',
      editingTruck: truck,
      editingTruckBatches: [{ block_id: 1, block_code: 'A', weight_kg: 5000, harvest_date: '2026-09-21' }],
      // Block genuinely has headroom above what this truck already carries.
      availableByBlock: { 1: 10000 },
      batchesByBlock: { 1: [{ harvest_date: '2026-09-21', age_days: 0, available_kg: 10000 }] },
    });
    const kgInput = screen.getAllByRole('spinbutton')[0] as HTMLInputElement;
    expect(kgInput).toHaveValue(5000);
    fireEvent.change(kgInput, { target: { value: '8000' } }); // > seeded 5000, <= live cap 10000
    expect(kgInput).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText('tir_takip.gaplama.form.insufficient_harvest')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'tir_takip.gaplama.form.save' })).not.toBeDisabled();
  });
});

// Fix round 1 (2026-09-25 review): three cases where the screen previously
// stated something untrue or hid something outright.
describe('GaplamaTruckForm — leftover-collapse fix round 1', () => {
  beforeEach(() => vi.clearAllMocks());

  // Item 3: on a collision, `effectiveBatches` used to keep only the LIVE
  // bucket's age, discarding the orphan's own (older) age — the reviewer's
  // own reproduction: a truck holding 2000 kg dated 2026-09-15 (9 days
  // before the truck's own 2026-09-24) merging with a live leftover bucket
  // of age 2 rendered "up to 2 days", understating the row's real age by a
  // week. The merge must keep the OLDER of the two — pinned directly on
  // `effectiveBatches` (exported for this), since the shared t-mock
  // swallows interpolation args and can't distinguish rendered ages.
  it('keeps the older of the live bucket age and the orphan (seeded) age on a collision', () => {
    const result = effectiveBatches(
      1,
      { batchesByBlock: { 1: [{ harvest_date: null, age_days: 2, available_kg: 5000 }] } },
      { 1: [{ harvest_date: null, age_days: 9, available_kg: 2000 }] },
    );
    expect(result).toEqual([{ harvest_date: null, age_days: 9, available_kg: 5000 }]);
  });

  // Item 2: the row said "age unknown" while the total line said "oldest: 0
  // d" — 0 reads as fresh, the opposite of unknown. Both must agree.
  it('does not claim a known "oldest: 0 d" total when the leftover row\'s age is genuinely unknown', () => {
    const truck = {
      id: 61, shipment_code: '2109061/26', export_code: null, date: '2026-09-24',
      status: 1, status_code: 'draft', status_display: 'Draft', country: null, customer: null,
      block_sources: [{ block_id: 1, block_code: 'A', weight_kg: 18000 }],
    };
    renderForm({
      mode: 'edit',
      editingTruck: truck,
      editingTruckBatches: [{ block_id: 1, block_code: 'A', weight_kg: 18000, harvest_date: null }],
      availableByBlock: { 1: 0 },
      // No live leftover bucket at all — the seeded row is a non-colliding
      // orphan with no real date, i.e. genuinely unknown age.
      batchesByBlock: { 1: [{ harvest_date: '2026-09-24', age_days: 0, available_kg: 9000 }] },
    });
    // Row tag: unknown.
    const rowTag = document.querySelector('.sera-gaplama-batch-age');
    expect(rowTag?.textContent).toBe('tir_takip.gaplama.form.batch_leftover_unknown_age');
    // Total line: must say the SAME thing, not "oldest_batch" (which would
    // render as "oldest: 0 d" under the real i18n interpolation).
    const totalLine = document.querySelector('.sera-gaplama-form-oldest');
    expect(totalLine?.textContent).toBe('tir_takip.gaplama.form.batch_leftover_unknown_age');
    expect(screen.queryByText('tir_takip.gaplama.form.oldest_batch')).not.toBeInTheDocument();
  });

  // Item 4: `foldEntriesByBlock` used to skip a source row with a null
  // weight_kg entirely, so a block whose only data is a null-weight row
  // (a supply-first draft's source before a weight was assigned,
  // views.py:2231 — the declared frontend type says `number` but the API
  // can send null) rendered NO card at all. The operator had no way to see
  // the block was even on the truck.
  it('still renders a block card when its only source row has a null weight_kg', () => {
    const truck = {
      id: 62, shipment_code: '2109062/26', export_code: null, date: '2026-09-24',
      status: 1, status_code: 'draft', status_display: 'Draft', country: null, customer: null,
      // Declared type says `number`; the runtime cast mirrors the real API
      // shape this fallback branch was written to tolerate.
      block_sources: [{ block_id: 1, block_code: 'A', weight_kg: null as unknown as number }],
    };
    renderForm({
      mode: 'edit',
      editingTruck: truck,
      editingTruckBatches: undefined, // unresolved — the fallback branch
      availableByBlock: { 1: 5000 },
      batchesByBlock: { 1: [{ harvest_date: '2026-09-24', age_days: 0, available_kg: 5000 }] },
    });
    const cards = document.querySelectorAll('.sera-gaplama-form-block');
    expect(cards).toHaveLength(1);
    expect(screen.getByRole('spinbutton')).toHaveValue(null);
  });
});
