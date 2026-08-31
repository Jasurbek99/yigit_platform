import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import '@/i18n';
import type { IRowConfig, IShipmentSheetItem, IShipmentOptionType } from '@/types';
import { MOCK_SHEET_DATA } from '@/mock/shipmentSheet';
import { SheetCell } from './SheetCell';

// The option list drives the per-value (conditional-formatting) colors.
const OPTIONS: IShipmentOptionType[] = [
  {
    id: 1, category: 'harvest_status', code: 'ok', color: '#bceba7',
    label_tk: 'Taýýar', label_ru: 'Готово', label_en: 'Ready',
    icon: null, sort_order: 10, is_active: true,
  } as unknown as IShipmentOptionType,
];

vi.mock('@/hooks/useAdmin', () => ({
  useShipmentOptions: () => ({ data: OPTIONS }),
}));

vi.mock('@/hooks/useSheetCellWrite', () => ({
  useSheetCellWrite: () => ({ clearCell: vi.fn() }),
  isClearableField: () => true,
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

const setCellColorMutate = vi.fn();
vi.mock('@/hooks/useShipmentSheet', () => ({
  useSetCellColor: () => ({ mutate: setCellColorMutate }),
}));

const COUNTRY_ROW: IRowConfig = {
  row_number: 2,
  field_key: 'country',
  default_who_key: 'sheet.who.export',
  label_key: 'sheet.row.country',
  input_type: 'dropdown',
  style: 'base',
};

const HARVEST_ROW: IRowConfig = {
  row_number: 29,
  field_key: 'harvest_status',
  default_who_key: 'sheet.who.harvest',
  label_key: 'sheet.row.harvest_status',
  input_type: 'dropdown',
  style: 'status',
};

function renderCell(
  shipment: IShipmentSheetItem,
  rowConfig: IRowConfig,
  cellColor: string | null = null,
) {
  const qc = new QueryClient();
  const { container } = render(
    <QueryClientProvider client={qc}>
      <SheetCell
        shipment={shipment}
        rowConfig={rowConfig}
        isEditable={false}
        cellColor={cellColor}
      />
    </QueryClientProvider>,
  );
  return container.querySelector('.sheet-cell') as HTMLElement;
}

describe('SheetCell auto-coloring', () => {
  it('paints the country cell with the FK color from the payload', () => {
    const shipment = { ...MOCK_SHEET_DATA[0], country_color: '#ff00c8' } as IShipmentSheetItem;
    const cell = renderCell(shipment, COUNTRY_ROW);
    expect(cell.style.backgroundColor).toBe('#ff00c8');
  });

  it('paints a dropdown cell with the matching option color', () => {
    const shipment = { ...MOCK_SHEET_DATA[0], harvest_status: 'ok' } as IShipmentSheetItem;
    const cell = renderCell(shipment, HARVEST_ROW);
    expect(cell.style.backgroundColor).toBe('#bceba7');
  });

  it('leaves the cell unpainted when the value has no color', () => {
    const shipment = { ...MOCK_SHEET_DATA[0], harvest_status: 'not_ready' } as IShipmentSheetItem;
    const cell = renderCell(shipment, HARVEST_ROW);
    expect(cell.style.backgroundColor).toBe('');
  });

  it('lets the per-cell color win over the per-value color', () => {
    const shipment = { ...MOCK_SHEET_DATA[0], harvest_status: 'ok' } as IShipmentSheetItem;
    const cell = renderCell(shipment, HARVEST_ROW, '#123456');
    expect(cell.style.backgroundColor).toBe('#123456');
  });

  it('offers Cell color on the right-click menu and saves a picked swatch', async () => {
    const shipment = { ...MOCK_SHEET_DATA[0] } as IShipmentSheetItem;
    const cell = renderCell(shipment, HARVEST_ROW);
    fireEvent.contextMenu(cell);

    const item = await screen.findByText('Cell color');
    fireEvent.click(item);

    const swatches = document.querySelectorAll('.sheet-cell-color-swatch');
    expect(swatches.length).toBe(10);
    fireEvent.click(swatches[0]);
    expect(setCellColorMutate).toHaveBeenCalledWith({
      shipmentId: shipment.id,
      fieldKey: 'harvest_status',
      color: '#fee2e2',
    });
  });
});
