import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { SelfBoardShipmentFieldList } from './SelfBoardShipmentFieldList';
import { MOCK_SHIPMENT_DETAIL } from '@/mock/shipmentDetail';
import type { IRowConfig, ISheetRowSettingForUser, IShipmentSheetItem } from '@/types';

vi.mock('@/services/api', () => ({
  default: { patch: vi.fn(), get: vi.fn(() => Promise.resolve({ data: [] })), post: vi.fn() },
}));

beforeAll(async () => { await i18n.changeLanguage('en'); });

function renderTaskFields(fields: string[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <SelfBoardShipmentFieldList
          shipmentId={MOCK_SHIPMENT_DETAIL.id}
          shipment={{ ...MOCK_SHIPMENT_DETAIL, shelf_life_days: 14 }}
          sheetItem={{ id: MOCK_SHIPMENT_DETAIL.id } as IShipmentSheetItem}
          rows={[]}
          rowSettings={{}}
          fields={fields}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

// E2E 2026-10-01: shelf life has no Sheet row, so the quality inspector's task
// card showed it as a read-only stub ("—", "Edit in shipment detail") even
// after it was saved on the Detail page.
describe('SelfBoardShipmentFieldList — shelf life on the task card', () => {
  it('shows the saved value without the edit-elsewhere hint', () => {
    renderTaskFields(['shelf_life_days']);
    const row = document.getElementById('detail-field-shelf_life_days');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('14')).toBeInTheDocument();
    expect(screen.queryByText('Fill on the shipment page')).not.toBeInTheDocument();
  });

  it('opens a number editor on click', () => {
    renderTaskFields(['shelf_life_days']);
    fireEvent.click(within(document.getElementById('detail-field-shelf_life_days')!).getByText('14'));
    expect(screen.getByRole('spinbutton')).toBeInTheDocument();
  });

  it('leaves other Sheet-less fields as read-only stubs', () => {
    renderTaskFields(['quality.hil_sertifikaty']);
    expect(screen.getByText('Fill on the shipment page')).toBeInTheDocument();
  });

  // 2026-10-02: the hint is a link straight to that field on the shipment page.
  it('links the stub to its field on the shipment page', () => {
    renderTaskFields(['quality.hil_sertifikaty']);
    expect(screen.getByRole('link', { name: 'Fill on the shipment page' }))
      .toHaveAttribute('href', `/shipments/${MOCK_SHIPMENT_DETAIL.id}#detail-field-quality.hil_sertifikaty`);
  });
});

const TRANSIT_ROW: IRowConfig = {
  row_number: 26, field_key: 'transit_days_temp', default_who_key: 'sheet.who.quality',
  label_key: 'sheet.row.transit_temp', input_type: 'text', style: 'base',
};
const TRANSIT_SETTING = { can_current_user_edit: true } as ISheetRowSettingForUser;

function renderWithTransitRow(props: { fields?: string[]; excludeFields?: string[] }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <SelfBoardShipmentFieldList
          shipmentId={MOCK_SHIPMENT_DETAIL.id}
          sheetItem={{ id: MOCK_SHIPMENT_DETAIL.id, transit_days: 5, transport_temp_c: 4 } as IShipmentSheetItem}
          rows={[TRANSIT_ROW]}
          rowSettings={{ transit_days_temp: TRANSIT_SETTING }}
          {...props}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

// 2026-10-02: the task targets transit_days + transport_temp_c, but the Sheet
// has only the combined R26 row «Ýol gün we temp» — so the task list showed
// two dead stubs and the editor sat lower, under «Shipment fields».
describe('SelfBoardShipmentFieldList — transit days & temperature', () => {
  it('edits both task fields through the one combined Sheet row', () => {
    renderWithTransitRow({ fields: ['transit_days', 'transport_temp_c'] });
    expect(screen.getAllByRole('button', { name: 'Transit Days & Temp' })).toHaveLength(1);
    expect(screen.queryByText('Fill on the shipment page')).not.toBeInTheDocument();
  });

  it('drops the combined row from «Shipment fields» when the task owns it', () => {
    renderWithTransitRow({ excludeFields: ['transit_days', 'transport_temp_c'] });
    expect(screen.queryByRole('button', { name: 'Transit Days & Temp' })).not.toBeInTheDocument();
  });
});
