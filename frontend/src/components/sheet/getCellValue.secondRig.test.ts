import { describe, it, expect } from 'vitest';
import { getCellValue } from './getCellValue';
import type { IShipmentSheetItem, IRowConfig } from '@/types';

/**
 * The second rig has no Sheet row of its own — the plate, driver and phone
 * cells each render both values. These pin the joining, including the cases
 * where only one half is filled, because a stray separator on a cell an
 * operator reads at a glance is worse than a blank.
 */
function ship(fields: Partial<IShipmentSheetItem>): IShipmentSheetItem {
  return {
    truck_plate: null,
    truck_plate_2: null,
    driver_name: null,
    driver_2_name: null,
    driver_phone: null,
    driver_2_phone: null,
    ...fields,
  } as IShipmentSheetItem;
}

const row = (field_key: string) => ({ field_key }) as IRowConfig;

describe('getCellValue — second rig', () => {
  it('joins both plates with a comma', () => {
    const value = getCellValue(
      ship({ truck_plate: '2189AHF/1485TAG', truck_plate_2: '2596AHF' }),
      row('truck_plate'),
    );
    expect(value).toBe('2189AHF/1485TAG, 2596AHF');
  });

  it('joins both driver names and both phones', () => {
    expect(
      getCellValue(ship({ driver_name: 'Ahmet A.', driver_2_name: 'Bayram B.' }), row('driver_name')),
    ).toBe('Ahmet A., Bayram B.');
    expect(
      getCellValue(ship({ driver_phone: '+99365111', driver_2_phone: '+99365222' }), row('driver_phone')),
    ).toBe('+99365111, +99365222');
  });

  it('shows a single value with no trailing separator', () => {
    expect(getCellValue(ship({ truck_plate: '2189AHF/1485TAG' }), row('truck_plate')))
      .toBe('2189AHF/1485TAG');
    expect(getCellValue(ship({ driver_name: 'Ahmet A.' }), row('driver_name')))
      .toBe('Ahmet A.');
  });

  it('shows the second value alone when the first was never filled', () => {
    expect(getCellValue(ship({ truck_plate_2: '2596AHF' }), row('truck_plate')))
      .toBe('2596AHF');
    expect(getCellValue(ship({ driver_2_name: 'Bayram B.' }), row('driver_name')))
      .toBe('Bayram B.');
  });

  // Regression: the three rig cases were spliced into the middle of the
  // free-text fallthrough group, so `vehicle_live_status` and its neighbours
  // silently started rendering the truck plate.
  it('leaves the neighbouring free-text cells reading their own field', () => {
    const s = ship({
      truck_plate: '2189AHF/1485TAG',
      vehicle_live_status: 'Ammarda',
      document_note: 'Bellik',
      vehicle_condition_note: 'Sowuk',
      additional_notes_arap: 'Arap',
    } as Partial<IShipmentSheetItem>);
    expect(getCellValue(s, row('vehicle_live_status'))).toBe('Ammarda');
    expect(getCellValue(s, row('document_note'))).toBe('Bellik');
    expect(getCellValue(s, row('vehicle_condition_note'))).toBe('Sowuk');
    expect(getCellValue(s, row('additional_notes_arap'))).toBe('Arap');
  });

  it('falls back to the em dash when both halves are empty', () => {
    expect(getCellValue(ship({}), row('truck_plate'))).toBe('—');
    expect(getCellValue(ship({ driver_name: '', driver_2_name: '  ' }), row('driver_name'))).toBe('—');
  });
});
