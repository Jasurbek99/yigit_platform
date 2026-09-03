import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import type { IRowConfig, IShipmentSheetItem } from '@/types';
import { recordMultiEntry } from '@/hooks/undoCapture';
import { SheetCellEditor } from './SheetCellEditor';
import { MOCK_SHEET_DATA } from '@/mock/shipmentSheet';
import { parseNumberInput } from './SheetCellEditor.helpers';
import { useSheetStore } from '@/stores/sheetStore';
import { scaleSheetLayout } from '@/constants/sheetRowConfig';

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
  default: (props: {
    onCommit: (fields: { driver_id: number | null; driver_name: string; driver_phone?: string }) => void;
  }) => (
    <>
      <button onClick={() => props.onCommit({ driver_id: 7, driver_name: 'ARNAGELDIYEW ALLAYAR' })}>
        driver-commit-stub
      </button>
      <button
        onClick={() =>
          props.onCommit({
            driver_id: 7, driver_name: 'ARNAGELDIYEW ALLAYAR', driver_phone: '+99365777888',
          })
        }
      >
        driver-commit-with-phone-stub
      </button>
    </>
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
const patchMutate = vi.fn();
vi.mock('@/hooks/useShipmentPatch', () => ({
  useShipmentPatch: () => ({ mutate: patchMutate, isPending: false }),
  useShipmentPatchMulti: () => ({ mutate: patchMultiMutate, isPending: false }),
  extractPatchError: (_err: unknown, fallback: string) => fallback,
}));

// Mutable so the firm_splits tests can vary the dropdown's firm list.
const mockFirms: { id: number; code: string; name_tk: string; name_en: string | null; is_active: boolean }[] = [
  { id: 1, code: 'YGT', name_tk: 'Yigit H.J.', name_en: null, is_active: true },
  { id: 2, code: 'OY', name_tk: 'Oguz Yoly', name_en: null, is_active: true },
];

// Captures the payload the customer create modal submits, and lets a test drive
// the mutation's onSuccess as the real hook would.
const createCustomerMutate = vi.fn();
vi.mock('@/hooks/useAdmin', () => ({
  useCountries: () => ({ data: [] }),
  useCities: () => ({ data: [] }),
  useCustomers: () => ({ data: [] }),
  useAdminFirms: () => ({ data: mockFirms }),
  useAdminImportFirms: () => ({ data: [] }),
  useAdminUsers: () => ({ data: [] }),
  useGreenhouseBlocks: () => ({ data: [] }),
  useTomatoVarieties: () => ({ data: [] }),
  useBorderPoints: () => ({ data: [] }),
  useShipmentOptions: () => ({ data: [] }),
  useCreateCustomer: () => ({ mutate: createCustomerMutate, isPending: false }),
}));

// Mutable per test: undefined = still loading (no warnings, no link).
let mockBalances: Record<string, { remaining_kg: number }> | undefined;
vi.mock('@/hooks/useQuotaDashboard', () => ({
  useQuotaFirmBalances: () => ({ data: mockBalances }),
}));

// Drives the quota-page link's permission gate. Also keeps useAuth's internal
// useNavigate out of these tests (they render without a Router).
let mockUser: { is_superuser: boolean; role?: string; page_permissions: Record<string, boolean> } | null = null;
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUser, isLoading: false, isError: false }),
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

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

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

  it('a registry phone rides along in the same patch, and undo snapshots it too', async () => {
    patchMultiMutate.mockClear();
    const shipment: IShipmentSheetItem = { ...MOCK_SHEET_DATA[0], is_gapy_satys: false };
    wrap(shipment, DRIVER_NAME_ROW);

    await userEvent.click(screen.getByText('driver-commit-with-phone-stub'));

    expect(patchMultiMutate).toHaveBeenCalledWith(
      {
        id: shipment.id,
        fields: {
          driver_id: 7, driver_name: 'ARNAGELDIYEW ALLAYAR', driver_phone: '+99365777888',
        },
      },
      expect.anything(),
    );
    // The before-snapshot must carry driver_phone only when the patch writes it,
    // or undo would restore a field the PATCH never touched.
    expect(recordMultiEntry).toHaveBeenCalledWith(
      shipment.id,
      {
        driver_id: shipment.driver_id,
        driver_name: shipment.driver_name,
        driver_phone: shipment.driver_phone,
      },
      expect.objectContaining({ driver_phone: '+99365777888' }),
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

const FIRM_SPLITS_ROW: IRowConfig = {
  row_number: 9,
  field_key: 'firm_splits',
  default_who_key: 'sheet.who.export',
  label_key: 'sheet.row.firm_splits',
  input_type: 'multiselect',
  style: 'key',
};

// A firm with no quota left is disabled in the dropdown — the only way out is
// the quota page, so the footer offers a link to it.
describe('SheetCellEditor — firm_splits quota link', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    mockUser = { is_superuser: false, page_permissions: { 'export.quota': true } };
    mockBalances = undefined;
  });

  const LINK = 'Open quota page →';

  it('renders the link when a listed firm has no remaining quota', () => {
    mockBalances = { '1': { remaining_kg: 5000 }, '2': { remaining_kg: 0 } };
    wrap(MOCK_SHEET_DATA[0], FIRM_SPLITS_ROW);

    const link = screen.getByText(LINK).closest('a');
    expect(link).toHaveAttribute('href', '/export/quota');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('hides the link when every listed firm still has quota', () => {
    mockBalances = { '1': { remaining_kg: 5000 }, '2': { remaining_kg: 1200 } };
    wrap(MOCK_SHEET_DATA[0], FIRM_SPLITS_ROW);

    expect(screen.queryByText(LINK)).not.toBeInTheDocument();
  });

  it('hides the link from a user without the quota page permission', () => {
    mockUser = { is_superuser: false, page_permissions: { 'export.shipments': true } };
    mockBalances = { '1': { remaining_kg: 5000 }, '2': { remaining_kg: 0 } };
    wrap(MOCK_SHEET_DATA[0], FIRM_SPLITS_ROW);

    expect(screen.queryByText(LINK)).not.toBeInTheDocument();
  });
});

// Locks the B.1 fix: typing literal `0` in a number cell MUST persist as 0,
// not get coerced to null. Previously `Number(value) || null` was treating
// rejected_weight_kg=0 ("no rejection") as null ("not measured yet").
describe('SheetCellEditor — design variant sizing', () => {
  // The editor is also rendered OUTSIDE the Sheet (SelfBoardShipmentFieldList),
  // where the `.sheet-grid--ios` skin does not apply. It must therefore take the
  // variant as a prop and default to classic, not read the Sheet's store — or a
  // preference set on the Sheet silently resizes the Self Board drawer.
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  function editingBox(container: HTMLElement): HTMLElement {
    const el = container.querySelector('.sheet-cell--editing');
    if (!(el instanceof HTMLElement)) throw new Error('editing cell not rendered');
    return el;
  }

  it('keeps classic sizing with no variant prop, even when the Sheet is set to ios', () => {
    useSheetStore.getState().setSheetVariant('ios');
    const shipment: IShipmentSheetItem = { ...MOCK_SHEET_DATA[0], is_gapy_satys: true, truck_plate: '01ABC123' };
    const { container } = wrap(shipment, TRUCK_PLATE_ROW);

    const classic = scaleSheetLayout(1, 'classic');
    expect(editingBox(container).style.width).toBe(`${classic.colShipment}px`);
    expect(editingBox(container).style.height).toBe(`${classic.rowHeight}px`);

    useSheetStore.getState().setSheetVariant('classic');
  });

  it('takes ios sizing when the grid passes the prop', () => {
    const shipment: IShipmentSheetItem = { ...MOCK_SHEET_DATA[0], is_gapy_satys: true, truck_plate: '01ABC123' };
    const qc = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={qc}>
        <SheetCellEditor shipment={shipment} rowConfig={TRUCK_PLATE_ROW} variant="ios" />
      </QueryClientProvider>,
    );

    const ios = scaleSheetLayout(1, 'ios');
    expect(editingBox(container).style.width).toBe(`${ios.colShipment}px`);
    expect(editingBox(container).style.height).toBe(`${ios.rowHeight}px`);
  });
});

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

// ─── Customer cell (R11) — inline create ────────────────────────────────────

const CUSTOMER_ROW: IRowConfig = {
  row_number: 11,
  field_key: 'customer',
  default_who_key: 'sheet.who.gadam',
  label_key: 'sheet.row.customer',
  input_type: 'dropdown',
  style: 'base',
  options_source: 'customers',
};

describe('SheetCellEditor — customer cell create button', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    patchMutate.mockClear();
    createCustomerMutate.mockClear();
    useSheetStore.getState().setEditingCell({ shipmentId: MOCK_SHEET_DATA[0].id, rowKey: 'customer' });
  });

  it('hides the create button from roles the backend would 403', () => {
    mockUser = { is_superuser: false, role: 'logist', page_permissions: {} };
    wrap(MOCK_SHEET_DATA[0], CUSTOMER_ROW);

    expect(screen.queryByRole('button', { name: /add customer/i })).not.toBeInTheDocument();
  });

  it('shows it for a role inside REFERENCE_DATA_WRITE', () => {
    mockUser = { is_superuser: false, role: 'export_manager', page_permissions: {} };
    wrap(MOCK_SHEET_DATA[0], CUSTOMER_ROW);

    expect(screen.getByRole('button', { name: /add customer/i })).toBeInTheDocument();
  });

  it('leaves the create button off every other dropdown cell', () => {
    mockUser = { is_superuser: true, role: 'admin', page_permissions: {} };
    const countryRow: IRowConfig = { ...CUSTOMER_ROW, field_key: 'country', options_source: 'countries' };
    wrap(MOCK_SHEET_DATA[0], countryRow);

    expect(screen.queryByRole('button', { name: /add customer/i })).not.toBeInTheDocument();
  });

  it('opening the modal does NOT close the editor', async () => {
    mockUser = { is_superuser: true, role: 'admin', page_permissions: {} };
    wrap(MOCK_SHEET_DATA[0], CUSTOMER_ROW);

    await userEvent.click(screen.getByRole('button', { name: /add customer/i }));

    // The modal is up...
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    // ...and the Select's blur did not clear the editing cell out from under it.
    expect(useSheetStore.getState().editingCell).not.toBeNull();
  });

  it('a created customer is PATCHed into the cell', async () => {
    mockUser = { is_superuser: true, role: 'admin', page_permissions: {} };
    // Stand in for the real mutation: resolve straight to the created customer.
    createCustomerMutate.mockImplementation((_payload, opts) =>
      opts?.onSuccess?.({ data: { id: 77, name: 'Aybek Trading' } }),
    );
    wrap(MOCK_SHEET_DATA[0], CUSTOMER_ROW);

    await userEvent.click(screen.getByRole('button', { name: /add customer/i }));
    await userEvent.type(await screen.findByRole('textbox', { name: /name/i }), 'Aybek Trading');
    await userEvent.click(screen.getByRole('button', { name: /^ok$/i }));

    expect(createCustomerMutate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Aybek Trading' }),
      expect.anything(),
    );
    // Payload only — recordCellEntry is mocked to -1, so save() passes no options.
    expect(patchMutate.mock.calls[0][0]).toEqual({
      id: MOCK_SHEET_DATA[0].id, field: 'customer', value: 77,
    });
  });
});
