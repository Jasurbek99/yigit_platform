import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import api from '@/services/api';
import GaplamaTruckForm from './GaplamaTruckForm';

vi.mock('@/services/api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

function renderForm(overrides: Partial<React.ComponentProps<typeof GaplamaTruckForm>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const props = {
    mode: 'create' as const,
    today: '2026-09-21',
    availableByBlock: { 1: 12000, 2: 6500 },
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

  it('disables submit when no row has kg', () => {
    renderForm();
    expect(screen.getByRole('button', { name: /tır aç/i })).toBeDisabled();
  });

  it('caps a row at the block\'s available kg and refuses more', () => {
    renderForm();
    const kgInput = screen.getAllByLabelText(/kg/i)[0] as HTMLInputElement;
    fireEvent.change(kgInput, { target: { value: '15000' } }); // block 1 has 12000 available
    expect(kgInput).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: /tır aç/i })).toBeDisabled();
  });

  it('submits with skip_forecast_check, today\'s date, weight_net = sum, no shipment_code', async () => {
    (api.post as any).mockResolvedValue({ data: { id: 1, shipment_code: '2109001/26' } });
    renderForm();
    const kgInput = screen.getAllByLabelText(/kg/i)[0] as HTMLInputElement;
    fireEvent.change(kgInput, { target: { value: '12000' } });
    fireEvent.click(screen.getByRole('button', { name: /tır aç/i }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [, body] = (api.post as any).mock.calls[0];
    expect(body.skip_forecast_check).toBe(true);
    expect(body.date).toBe('2026-09-21');
    expect(body.weight_net).toBe(12000);
    expect(body.shipment_code).toBeUndefined();
    expect(body.block_sources).toEqual([{ block_id: 1, weight_kg: 12000 }]);
  });

  it('merges duplicate block rows client-side', async () => {
    (api.post as any).mockResolvedValue({ data: { id: 1, shipment_code: '2109001/26' } });
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: /blok goş/i }));
    const kgInputs = screen.getAllByLabelText(/kg/i) as HTMLInputElement[];
    fireEvent.change(kgInputs[0], { target: { value: '5000' } });
    // second row also block 1 (default selection) with 5000 more — total 10000, under 12000 cap
    fireEvent.change(kgInputs[1], { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: /tır aç/i }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [, body] = (api.post as any).mock.calls[0];
    expect(body.block_sources).toEqual([{ block_id: 1, weight_kg: 10000 }]);
  });
});

describe('GaplamaTruckForm — edit', () => {
  it('adds the truck\'s own kg back into what it may take', () => {
    const editingTruck = {
      id: 9, shipment_code: '2109001/26', export_code: null, date: '2026-09-21',
      status: 1, status_code: 'draft', status_display: 'Draft', country: null, customer: null,
      block_sources: [{ block_id: 1, block_code: 'A', weight_kg: 8000 }],
    };
    // available_kg for block 1 already excludes this truck's own load (server figure);
    // the form must present 12000 (available) + 8000 (this truck's own) = 20000 as the cap.
    renderForm({ mode: 'edit', editingTruck, availableByBlock: { 1: 12000 } });
    const kgInput = screen.getAllByLabelText(/kg/i)[0] as HTMLInputElement;
    expect(kgInput).toHaveValue(8000);
    fireEvent.change(kgInput, { target: { value: '19000' } });
    expect(kgInput).not.toHaveAttribute('aria-invalid', 'true');
  });
});
