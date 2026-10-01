import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { SelfBoardShipmentFieldList } from './SelfBoardShipmentFieldList';
import { MOCK_SHIPMENT_DETAIL } from '@/mock/shipmentDetail';
import type { IShipmentSheetItem } from '@/types';

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
    expect(screen.queryByText('Edit in shipment detail')).not.toBeInTheDocument();
  });

  it('opens a number editor on click', () => {
    renderTaskFields(['shelf_life_days']);
    fireEvent.click(within(document.getElementById('detail-field-shelf_life_days')!).getByText('14'));
    expect(screen.getByRole('spinbutton')).toBeInTheDocument();
  });

  it('leaves other Sheet-less fields as read-only stubs', () => {
    renderTaskFields(['quality.hil_sertifikaty']);
    expect(screen.getByText('Edit in shipment detail')).toBeInTheDocument();
  });
});
