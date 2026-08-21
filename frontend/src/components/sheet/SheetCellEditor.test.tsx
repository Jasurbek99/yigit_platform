import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import type { IRowConfig, IShipmentSheetItem } from '@/types';
import { recordMultiEntry } from '@/hooks/undoCapture';
import { SheetCellEditor } from './SheetCellEditor';
import { MOCK_SHEET_DATA } from '@/mock/shipmentSheet';
import { parseNumberInput } from './SheetCellEditor.helpers';

// Isolate the wiring under test from SheetTruckSelectEditor's own internals
// (covered by its own test file) — stub renders a single button whose click
// simulates a completed pick + commit.
vi.mock('./SheetTruckSelectEditor', () => ({
  default: (props: { onCommit: (fields: { truck_head_id: number | null; trailer_id: number | null; truck_plate: string }) => void }) => (
    <button onClick={() => props.onCommit({ truck_head_id: 1, trailer_id: 10, truck_plate: '01ABC/T-100' })}>
      commit-stub
    </button>
  ),
}));

vi.mock('./SheetDriverSelectEditor', () => ({
  default: (props: { onCommit: (fields: { driver_id: number | null; driver_name: string }) => void }) => (
    <button onClick={() => props.onCommit({ driver_id: 7, driver_name: 'ARNAGELDIYEW ALLAYAR' })}>
      driver-commit-stub
    </button>
  ),
}));

vi.mock('@/hooks/useFleet', () => ({
  useTruckHeads: () => ({ data: [] }),
  useTrailers: () => ({ data: [] }),
  useDrivers: () => ({ data: [] }),
  useCreateDriver: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

// Shared spy so the test can assert on the same mock instance the component
// calls (each fresh arrow-fn-per-render would otherwise be a different mock).
const patchMultiMutate = vi.fn();
vi.mock('@/hooks/useShipmentPatch', () => ({
  useShipmentPatch: () => ({ mutate: vi.fn(), isPending: false }),
  useShipmentPatchMulti: () => ({ mutate: patchMultiMutate, isPending: false }),
  extractPatchError: (_err: unknown, fallback: string) => fallback,
}));

vi.mock('@/hooks/useAdmin', () => ({
  useCountries: () => ({ data: [] }),
  useCities: () => ({ data: [] }),
  useCustomers: () => ({ data: [] }),
  useAdminFirms: () => ({ data: [] }),
  useAdminImportFirms: () => ({ data: [] }),
  useGreenhouseBlocks: () => ({ data: [] }),
  useTomatoVarieties: () => ({ data: [] }),
  useBorderPoints: () => ({ data: [] }),
  useShipmentOptions: () => ({ data: [] }),
}));

vi.mock('@/hooks/useQuotaDashboard', () => ({
  useQuotaFirmBalances: () => ({ data: undefined }),
}));

vi.mock('@/hooks/undoCapture', () => ({
  recordCellEntry: vi.fn(() => -1),
  recordMultiEntry: vi.fn(() => 1),
  recordJunctionEntry: vi.fn(() => -1),
  recordVarietiesEntry: vi.fn(() => -1),
  setEntryAfter: vi.fn(),
  dropEntry: vi.fn(),
  reconciledCellValue: vi.fn(() => null),
  cascadeFrom: vi.fn(() => undefined),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const TRUCK_PLATE_ROW: IRowConfig = {
  row_number: 23,
  field_key: 'truck_plate',
  default_who_key: 'sheet.who.transport',
  label_key: 'sheet.row.truck_plate',
  input_type: 'text',
  style: 'transport',
};

const DRIVER_NAME_ROW: IRowConfig = {
  row_number: 27,
  field_key: 'driver_name',
  default_who_key: 'sheet.who.transport',
  label_key: 'sheet.row.driver_name',
  input_type: 'text',
  style: 'transport',
};

function wrap(shipment: IShipmentSheetItem, rowConfig: IRowConfig) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <SheetCellEditor shipment={shipment} rowConfig={rowConfig} />
    </QueryClientProvider>,
  );
}

describe('SheetCellEditor — truck_plate cell', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('non-gapy: renders the fleet overlay; committing it multi-patches + records undo', async () => {
    patchMultiMutate.mockClear();
    const shipment: IShipmentSheetItem = { ...MOCK_SHEET_DATA[0], is_gapy_satys: false };
    wrap(shipment, TRUCK_PLATE_ROW);

    expect(screen.getByText('commit-stub')).toBeInTheDocument();

    await userEvent.click(screen.getByText('commit-stub'));

    expect(patchMultiMutate).toHaveBeenCalledWith(
      {
        id: shipment.id,
        fields: { truck_head_id: 1, trailer_id: 10, truck_plate: '01ABC/T-100' },
      },
      expect.anything(),
    );
    expect(recordMultiEntry).toHaveBeenCalledWith(
      shipment.id,
      {
        truck_head_id: shipment.truck_head_id,
        trailer_id: shipment.trailer_id,
        truck_plate: shipment.truck_plate,
      },
      { truck_head_id: 1, trailer_id: 10, truck_plate: '01ABC/T-100' },
    );
  });

  it('gapy: renders a plain text input, NOT the fleet overlay', () => {
    const shipment: IShipmentSheetItem = { ...MOCK_SHEET_DATA[0], is_gapy_satys: true, truck_plate: '01ABC123' };
    wrap(shipment, TRUCK_PLATE_ROW);

    expect(screen.queryByText('commit-stub')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('01ABC123')).toBeInTheDocument();
  });
});

describe('SheetCellEditor — driver_name cell', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('non-gapy: renders the registry overlay; committing multi-patches id + name only', async () => {
    patchMultiMutate.mockClear();
    const shipment: IShipmentSheetItem = { ...MOCK_SHEET_DATA[0], is_gapy_satys: false };
    wrap(shipment, DRIVER_NAME_ROW);

    expect(screen.getByText('driver-commit-stub')).toBeInTheDocument();
    await userEvent.click(screen.getByText('driver-commit-stub'));

    // Exactly two fields — driver_phone (R28) is its own cell and must not be
    // written from here.
    expect(patchMultiMutate).toHaveBeenCalledWith(
      {
        id: shipment.id,
        fields: { driver_id: 7, driver_name: 'ARNAGELDIYEW ALLAYAR' },
      },
      expect.anything(),
    );
    expect(recordMultiEntry).toHaveBeenCalledWith(
      shipment.id,
      { driver_id: shipment.driver_id, driver_name: shipment.driver_name },
      { driver_id: 7, driver_name: 'ARNAGELDIYEW ALLAYAR' },
    );
  });

  it('gapy: renders a plain text input, NOT the registry overlay', () => {
    // Local buyers bring their own truck AND their own driver — same HARD RULE
    // as truck_plate. Picking from the company registry here would pollute it.
    const shipment: IShipmentSheetItem = {
      ...MOCK_SHEET_DATA[0],
      is_gapy_satys: true,
      driver_name: 'Ashyr Ashyrow',
    };
    wrap(shipment, DRIVER_NAME_ROW);

    expect(screen.queryByText('driver-commit-stub')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('Ashyr Ashyrow')).toBeInTheDocument();
  });
});

// Locks the B.1 fix: typing literal `0` in a number cell MUST persist as 0,
// not get coerced to null. Previously `Number(value) || null` was treating
// rejected_weight_kg=0 ("no rejection") as null ("not measured yet").
describe('parseNumberInput', () => {
  it('preserves literal zero', () => {
    expect(parseNumberInput('0')).toBe(0);
    expect(parseNumberInput(' 0 ')).toBe(0);
    expect(parseNumberInput('0.0')).toBe(0);
  });

  it('parses positive numbers', () => {
    expect(parseNumberInput('42')).toBe(42);
    expect(parseNumberInput('18500.5')).toBe(18500.5);
  });

  it('parses negative numbers', () => {
    expect(parseNumberInput('-3')).toBe(-3);
  });

  it('returns null for empty input (cell clear)', () => {
    expect(parseNumberInput('')).toBeNull();
    expect(parseNumberInput('   ')).toBeNull();
  });

  it('returns null for non-numeric garbage', () => {
    expect(parseNumberInput('abc')).toBeNull();
    expect(parseNumberInput('12abc')).toBeNull();
    expect(parseNumberInput('NaN')).toBeNull();
  });
});
