import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { SelfBoardShipmentFieldList } from './SelfBoardShipmentFieldList';
import { SelfBoardActiveTaskPanel } from './SelfBoardActiveTaskPanel';
import { usePackingTemplates } from '@/hooks/usePackingTemplates';
import { useSetShipmentPacking, useShipmentPacking } from '@/hooks/useShipmentPacking';
import { useStartTask, useCompleteTask } from '@/hooks/useTaskActions';
import type { IRowConfig, IShipmentDetail, IShipmentSheetItem, ITaskListItem } from '@/types';

vi.mock('@/hooks/usePackingTemplates', () => ({ usePackingTemplates: vi.fn() }));
vi.mock('@/hooks/useShipmentPacking', () => ({ useShipmentPacking: vi.fn(), useSetShipmentPacking: vi.fn() }));
vi.mock('@/hooks/useTaskActions', () => ({ useStartTask: vi.fn(), useCompleteTask: vi.fn() }));
vi.mock('@/components/sheet/ShipmentFirmContractsPanel', () => ({
  ShipmentFirmContractsPanel: ({ shipmentId }: { shipmentId: number }) => <div>CONTRACTS_PANEL {shipmentId}</div>,
}));

const apply = vi.fn();
const sheetItem = { id: 7, truck_plate: 'AG 1234', driver_name: null } as unknown as IShipmentSheetItem;

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
  apply.mockReset();
  vi.mocked(usePackingTemplates).mockReturnValue(
    { data: [{ id: 3, name: 'Tir 18t' }, { id: 4, name: 'Tir 20t' }], isLoading: false } as unknown as ReturnType<typeof usePackingTemplates>,
  );
  vi.mocked(useShipmentPacking).mockReturnValue(
    { data: { whole_truck: { packing_template: null, packing_template_name: null } } } as unknown as ReturnType<typeof useShipmentPacking>,
  );
  vi.mocked(useSetShipmentPacking).mockReturnValue(
    { mutate: apply, isPending: false } as unknown as ReturnType<typeof useSetShipmentPacking>,
  );
  vi.mocked(useStartTask).mockReturnValue({ mutate: vi.fn() } as unknown as ReturnType<typeof useStartTask>);
  vi.mocked(useCompleteTask).mockReturnValue(
    { mutate: vi.fn(), isPending: false } as unknown as ReturnType<typeof useCompleteTask>,
  );
});

describe('task card inline editors (2026-09-30)', () => {
  it('«Brutto/netto» picks the packing template right on the card', async () => {
    render(
      <SelfBoardShipmentFieldList shipmentId={7} sheetItem={sheetItem} rows={[]} rowSettings={{}}
        fields={['packing_template']} />,
    );
    expect(screen.queryByText('Edit in shipment detail')).toBeNull();
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByText('Tir 20t'));
    expect(apply).toHaveBeenCalledWith(
      { shipment: 7, scope: 'template', packing_template: 4 }, expect.anything(),
    );
  });

  it('«Kontrakt» shows the Sheet contracts panel on the card', () => {
    const task = {
      id: 5, shipment: 7, shipment_code: 'SH-7', kind: 'shipment', title_key: 'tasks.prepare_contract',
      assignee_role: 'document_team', target_fields_list: [], completion_rule: 'confirm', state: 'open',
      step: 'gumruk_girish', phase: 'DOCS', deadline: null, is_overdue: false,
    } as unknown as ITaskListItem;
    render(
      <MemoryRouter>
        <SelfBoardActiveTaskPanel task={task} shipment={{ id: 7, block_sources: [] } as unknown as IShipmentDetail}
          onComplete={vi.fn()} sheetItem={sheetItem} rows={[]} rowSettings={{}} isSheetLoading={false} />
      </MemoryRouter>,
    );
    expect(screen.getByText('CONTRACTS_PANEL 7')).toBeInTheDocument();
  });

  it('the other fields list shows the filled ones first', () => {
    const rows = [
      { field_key: 'driver_name', label_key: 'ROW_DRIVER', input_type: 'text' },
      { field_key: 'truck_plate', label_key: 'ROW_PLATE', input_type: 'text' },
    ] as unknown as IRowConfig[];
    const settings = {
      driver_name: { can_current_user_edit: true }, truck_plate: { can_current_user_edit: true },
    } as unknown as Record<string, never>;
    const { container } = render(
      <SelfBoardShipmentFieldList shipmentId={7} sheetItem={sheetItem} rows={rows} rowSettings={settings}
        excludeFields={[]} />,
    );
    const text = within(container).getByText('ROW_PLATE').compareDocumentPosition(
      within(container).getByText('ROW_DRIVER'),
    );
    expect(text & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();   // plate (filled) before driver (empty)
  });
});
