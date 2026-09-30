import { describe, expect, it } from 'vitest';
import { isCellEditable, isTripLockedCell } from './sheetPermissions';
import type { IRowConfig } from '@/types';

describe('isTripLockedCell', () => {
  it('locks transport cells of a regular shipment with a trip', () => {
    expect(isTripLockedCell({ trip_id: 3, is_gapy_satys: false }, 'driver_name')).toBe(true);
    expect(isTripLockedCell({ trip_id: 3, is_gapy_satys: false }, 'border_point')).toBe(false);
  });

  it('never locks gapy or trip-less shipments', () => {
    expect(isTripLockedCell({ trip_id: 3, is_gapy_satys: true }, 'driver_name')).toBe(false);
    expect(isTripLockedCell({ trip_id: null }, 'driver_name')).toBe(false);
  });
});

describe('isCellEditable with a trip-linked shipment', () => {
  const superuser = { is_superuser: true } as any;
  const row = { field_key: 'truck_plate', input_type: 'text' } as IRowConfig;

  it('refuses the cell even for a superuser when the shipment carries a trip', () => {
    expect(isCellEditable(row, {}, superuser, false, { trip_id: 1, is_gapy_satys: false })).toBe(false);
  });

  it('is unchanged when no shipment is passed', () => {
    expect(isCellEditable(row, { truck_plate: { can_current_user_edit: true } as any }, superuser, false)).toBe(true);
  });
});
