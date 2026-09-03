import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import '@/i18n';
import type { IRowConfig, IShipmentSheetItem } from '@/types';
import { MOCK_SHEET_DATA } from '@/mock/shipmentSheet';
import { SheetCell } from './SheetCell';

// The two synthetic document cells (packing / firm_contracts) render one icon
// whose glyph IS the state — these pin that mapping, since a wrong glyph tells
// the operator the work is done when it isn't.

vi.mock('@/hooks/useAdmin', () => ({ useShipmentOptions: () => ({ data: [] }) }));
vi.mock('@/hooks/useSheetCellWrite', () => ({
  useSheetCellWrite: () => ({ clearCell: vi.fn() }),
  isClearableField: () => true,
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), Link: () => null }));
vi.mock('@/hooks/useShipmentSheet', () => ({ useSetCellColor: () => ({ mutate: vi.fn() }) }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 1, role: 'export_manager', resource_permissions: { sale: { view: true } } } }),
}));

let contractCounts: Record<string, number> | undefined = {};
vi.mock('@/hooks/useShipmentFirmContracts', () => ({
  useShipmentContractStatus: () => ({ data: contractCounts }),
  useShipmentFirmContracts: () => ({ data: undefined, isLoading: false }),
  useLinkFirmContract: () => ({ mutate: vi.fn(), isPending: false }),
}));

const row = (field_key: string): IRowConfig => ({
  row_number: 47,
  field_key,
  default_who_key: 'sheet.who.export',
  label_key: `sheet.row.${field_key}`,
  input_type: 'readonly',
  style: 'base',
});

function renderCell(shipment: IShipmentSheetItem, fieldKey: string) {
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <SheetCell shipment={shipment} rowConfig={row(fieldKey)} isEditable={false} />
    </QueryClientProvider>,
  );
  return container;
}

function iconOf(container: HTMLElement): string | null {
  const icon = container.querySelector('.sheet-cell [role="img"]');
  return icon?.getAttribute('aria-label') ?? null;
}

const base = MOCK_SHEET_DATA[0] as IShipmentSheetItem;
const split = { firm_code: 'YGT', firm_name: 'YGT', weight_kg: 9000, amount_usd: 8000 };

describe('packing cell icon', () => {
  it('offers "add" while no template is picked', () => {
    const s = { ...base, packing_template: null, packing_template_name: null };
    expect(iconOf(renderCell(s, 'packing'))).toBe('file-add');
  });

  it('turns "done" once a template is set', () => {
    const s = { ...base, packing_template: 3, packing_template_name: '2x9500' };
    expect(iconOf(renderCell(s, 'packing'))).toBe('file-done');
  });
});

describe('firm_contracts cell icon', () => {
  it('offers "add" when no firm has a contract yet', () => {
    contractCounts = {};
    const s = { ...base, firm_splits: [split, split] };
    expect(iconOf(renderCell(s, 'firm_contracts'))).toBe('file-add');
  });

  it('shows "sync" while only some firms are linked', () => {
    const s = { ...base, firm_splits: [split, split] };
    contractCounts = { [String(s.id)]: 1 };
    expect(iconOf(renderCell(s, 'firm_contracts'))).toBe('file-sync');
  });

  it('shows "done" once every firm is linked', () => {
    const s = { ...base, firm_splits: [split, split] };
    contractCounts = { [String(s.id)]: 2 };
    expect(iconOf(renderCell(s, 'firm_contracts'))).toBe('file-done');
  });

  it('falls back to the neutral icon when the counts are unavailable (no `sale` grant)', () => {
    contractCounts = undefined;
    const s = { ...base, firm_splits: [split] };
    expect(iconOf(renderCell(s, 'firm_contracts'))).toBe('file-text');
  });

  it('renders a dash — not an icon — when the truck has no firms', () => {
    contractCounts = {};
    const s = { ...base, firm_splits: [] };
    const container = renderCell(s, 'firm_contracts');
    expect(iconOf(container)).toBeNull();
    expect(container.querySelector('.sheet-cell')?.textContent).toBe('—');
  });
});
