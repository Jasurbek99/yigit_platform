import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { IRowConfig } from '@/types';
import { useSheetStore } from '@/stores/sheetStore';
import TirlarTab from './TirlarTab';

/**
 * `SheetGrid` is mocked to a prop recorder. Everything this tab decides is
 * expressed as a prop on the grid — the pinned variant, which shipments go in —
 * and the grid's own rendering is covered by the `SheetGrid.*` / `SheetCell.*`
 * suites. The store is REAL: two of the tests below are about what the tab
 * must not read from it or write to it.
 */
const gridProps = vi.fn();
vi.mock('@/components/sheet/SheetGrid', () => ({
  SheetGrid: (props: Record<string, unknown>) => {
    gridProps(props);
    return <div data-testid="sheet-grid" />;
  },
}));

const ROWS = [{ key: 'shipment_code' }, { key: 'customer' }] as unknown as IRowConfig[];
const SHIPMENTS = [
  { id: 1, shipment_code: 'A-1', country: 7 },
  { id: 2, shipment_code: 'B-2', country: 8 },
];

let sheetResult: { data: unknown; isLoading: boolean };
vi.mock('@/hooks/useShipmentSheet', () => ({
  useShipmentSheet: () => sheetResult,
}));
vi.mock('@/hooks/useSheetLiveSync', () => ({ useSheetLiveSync: () => {} }));
vi.mock('@/hooks/useUserSheetPreferences', () => ({
  useUserSheetPreferences: () => ({ data: { row_order: [], hidden_rows: [] } }),
  useSaveUserSheetPreferences: () => ({ mutate: vi.fn() }),
  useUserSheetPrefsBroadcast: () => {},
}));
vi.mock('@/components/comments/CommentsDrawer', () => ({ CommentsDrawer: () => null }));

const lastGridProps = () => {
  const { calls } = gridProps.mock;
  return calls[calls.length - 1]?.[0] as Record<string, unknown>;
};

describe('TirlarTab', () => {
  beforeEach(() => {
    gridProps.mockClear();
    localStorage.clear();
    sheetResult = {
      isLoading: false,
      data: { shipments: SHIPMENTS, rows: ROWS, row_settings: {}, current_user_lang: 'en' },
    };
    useSheetStore.setState({
      sheetVariant: 'classic',
      searchText: '',
      showGapyOnly: false,
      rows: [],
    });
    useSheetStore.getState().resetSheetFilters();
  });

  it('pins the Sera skin even when the user left the Sheet on classic', () => {
    render(<TirlarTab />);

    expect(lastGridProps().variant).toBe('ios');
  });

  it('does not carry the pinned skin back to the Sheet', () => {
    // `setSheetVariant` persists. Pinning through it would leave
    // /export/shipments/sheet in the Sera skin after one visit here.
    render(<TirlarTab />);

    expect(useSheetStore.getState().sheetVariant).toBe('classic');
    expect(localStorage.getItem('ygt-sheet-variant')).toBeNull();
  });

  it('shows every truck, ignoring a search and filters left over from the Sheet', () => {
    // The store survives client-side navigation. This tab has no toolbar, so a
    // filter applied here could not be seen or cleared from here.
    useSheetStore.setState({ searchText: 'no-such-truck', showGapyOnly: true });
    useSheetStore.getState().setSheetFilter('country', 999);

    render(<TirlarTab />);

    expect(lastGridProps().shipments).toEqual(SHIPMENTS);
  });

  it('fills the store row map the comment components read', () => {
    render(<TirlarTab />);

    expect(useSheetStore.getState().rows).toBe(ROWS);
  });

  it('shows a spinner, not the grid, while the sheet loads', () => {
    sheetResult = { isLoading: true, data: undefined };

    render(<TirlarTab />);

    expect(screen.queryByTestId('sheet-grid')).toBeNull();
    expect(gridProps).not.toHaveBeenCalled();
  });
});
