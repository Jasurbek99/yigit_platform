import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import '@/i18n';
import type { IRowConfig } from '@/types';
import { MOCK_SHEET_DATA } from '@/mock/shipmentSheet';
import { scaleSheetLayout } from '@/constants/sheetRowConfig';
import { useSheetStore } from '@/stores/sheetStore';
import { SheetCell } from './SheetCell';

/**
 * The Tır Takip → Tırlar tab pins `variant="ios"` on `SheetGrid` while the
 * store may still say `classic`. The variant sets the shipment column width and
 * the row height, and the grid lays its slots out with the pinned one — so the
 * cell must size itself with the pin too, or it drifts out of line with the
 * grid. The store stays `classic` in every test here on purpose.
 *
 * (The label row is not covered: `scaleSheetLayout` does not scale the label
 * columns by variant, so it has nothing to get wrong.)
 */
vi.mock('@/hooks/useAdmin', () => ({ useShipmentOptions: () => ({ data: [] }) }));
vi.mock('@/hooks/useSheetCellWrite', () => ({
  useSheetCellWrite: () => ({ clearCell: vi.fn() }),
  isClearableField: () => true,
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/hooks/useShipmentSheet', () => ({ useSetCellColor: () => ({ mutate: vi.fn() }) }));

const ROW: IRowConfig = {
  row_number: 2,
  field_key: 'country',
  default_who_key: 'sheet.who.export',
  label_key: 'sheet.row.country',
  input_type: 'dropdown',
  style: 'base',
};

const IOS = scaleSheetLayout(1, 'ios');
const CLASSIC = scaleSheetLayout(1, 'classic');

function cellStyle(variant?: 'ios' | 'classic') {
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <SheetCell shipment={MOCK_SHEET_DATA[0]} rowConfig={ROW} isEditable={false} variant={variant} />
    </QueryClientProvider>,
  );
  return (container.querySelector('.sheet-cell') as HTMLElement).style;
}

describe('pinned design variant', () => {
  beforeEach(() => {
    useSheetStore.setState({ sheetVariant: 'classic', sheetZoom: 1, whoColumnHidden: false });
  });

  it('the two variants really differ in size — otherwise the tests below prove nothing', () => {
    expect(IOS.rowHeight).not.toBe(CLASSIC.rowHeight);
    expect(IOS.colShipment).not.toBe(CLASSIC.colShipment);
  });

  it('sizes a cell with the pinned variant, not the store', () => {
    const style = cellStyle('ios');
    expect(style.height).toBe(`${IOS.rowHeight}px`);
    expect(style.width).toBe(`${IOS.colShipment}px`);
  });

  it('still follows the store when nothing is pinned', () => {
    const style = cellStyle(undefined);
    expect(style.height).toBe(`${CLASSIC.rowHeight}px`);
    expect(style.width).toBe(`${CLASSIC.colShipment}px`);
  });
});
