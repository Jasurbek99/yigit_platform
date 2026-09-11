import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import type { IShipmentSheetItem } from '@/types';
import { SheetFleetWarning } from './SheetFleetWarning';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

let canEditFleet = true;
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'transport', is_superuser: false, page_permissions: {} },
  }),
}));
vi.mock('@/utils/permissions', () => ({ canSeePage: () => canEditFleet }));

vi.mock('@/hooks/useFleet', () => ({
  useDrivers: () => ({
    data: [
      { id: 5, name: 'DOLY', missing_details: [] },
      { id: 7, name: 'PASPORT YOK', missing_details: ['passport_serial', 'passport_scan'] },
      { id: 8, name: 'SKAN YOK', missing_details: ['passport_scan'] },
    ],
  }),
  useTruckHeads: () => ({
    data: [
      { id: 1, plate_number: '01ABC', missing_details: [] },
      { id: 2, plate_number: '02DEF', missing_details: ['truck_model'] },
    ],
  }),
}));

function ship(fields: Partial<IShipmentSheetItem>): IShipmentSheetItem {
  return {
    truck_head_id: null, truck_head_2_id: null, driver_id: null, driver_2_id: null, ...fields,
  } as IShipmentSheetItem;
}

const marker = () => screen.queryByTestId('sheet-fleet-warning');

describe('SheetFleetWarning', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
    canEditFleet = true;
  });

  it('stays silent when the fleet record is complete', () => {
    render(<SheetFleetWarning shipment={ship({ driver_id: 5 })} fieldKey="driver_name" />);
    expect(marker()).toBeNull();
  });

  it('stays silent when nothing is linked yet', () => {
    render(<SheetFleetWarning shipment={ship({})} fieldKey="driver_name" />);
    expect(marker()).toBeNull();
  });

  it('warns when the linked driver has an incomplete passport', () => {
    render(<SheetFleetWarning shipment={ship({ driver_id: 7 })} fieldKey="driver_name" />);
    expect(marker()).toBeInTheDocument();
  });

  it('names each missing piece, and the driver it belongs to', () => {
    render(<SheetFleetWarning shipment={ship({ driver_id: 7 })} fieldKey="driver_name" />);
    const title = marker()?.getAttribute('title') ?? '';
    expect(title).toContain('PASPORT YOK');
    expect(title).toContain('Passport serial');
    expect(title).toContain('Passport scan');
  });

  it('warns for the second driver even when the first is complete', () => {
    render(
      <SheetFleetWarning shipment={ship({ driver_id: 5, driver_2_id: 8 })} fieldKey="driver_name" />,
    );
    const title = marker()?.getAttribute('title') ?? '';
    expect(title).toContain('SKAN YOK');
    expect(title).not.toContain('DOLY');
  });

  it('warns on the plate cell for a truck head with no model', () => {
    render(<SheetFleetWarning shipment={ship({ truck_head_id: 2 })} fieldKey="truck_plate" />);
    expect(marker()?.getAttribute('title')).toContain('Truck model');
  });

  it('checks the second head too', () => {
    render(
      <SheetFleetWarning
        shipment={ship({ truck_head_id: 1, truck_head_2_id: 2 })}
        fieldKey="truck_plate"
      />,
    );
    expect(marker()?.getAttribute('title')).toContain('02DEF');
  });

  // An inactive driver is filtered out of the picker list, so its record cannot
  // be judged. Staying silent beats inventing a warning about a row we cannot see.
  it('stays silent for a link the fleet list does not carry', () => {
    render(<SheetFleetWarning shipment={ship({ driver_id: 999 })} fieldKey="driver_name" />);
    expect(marker()).toBeNull();
  });

  it('opens Fleet Management on the right tab, without opening the cell editor', async () => {
    const onCellClick = vi.fn();
    render(
      <div onClick={onCellClick}>
        <SheetFleetWarning shipment={ship({ driver_id: 7 })} fieldKey="driver_name" />
      </div>,
    );
    await userEvent.click(marker()!);
    expect(navigate).toHaveBeenCalledWith('/admin/fleet?tab=drivers');
    expect(onCellClick).not.toHaveBeenCalled();
  });

  it('sends the plate cell to the trucks tab', async () => {
    navigate.mockClear();
    render(<SheetFleetWarning shipment={ship({ truck_head_id: 2 })} fieldKey="truck_plate" />);
    await userEvent.click(marker()!);
    expect(navigate).toHaveBeenCalledWith('/admin/fleet?tab=trucks');
  });

  it('still shows the warning to a role that cannot open Fleet Management', async () => {
    canEditFleet = false;
    navigate.mockClear();
    render(<SheetFleetWarning shipment={ship({ driver_id: 7 })} fieldKey="driver_name" />);
    expect(marker()).toBeInTheDocument();
    await userEvent.click(marker()!);
    expect(navigate).not.toHaveBeenCalled();
    canEditFleet = true;
  });
});
