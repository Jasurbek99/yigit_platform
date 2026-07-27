import { describe, it, expect } from 'vitest';
import { deriveSaveState } from './DetailFieldRow.helpers';

// The row must never silently return to "no feedback" after a successful
// save — "Saved" persists until the user edits again. NN/g: display the word
// Saved beside each field so the user knows no further action is required.
describe('deriveSaveState', () => {
  it('is idle before anything happens', () => {
    expect(deriveSaveState({ isPending: false, isError: false, hasSavedOnce: false }))
      .toBe('idle');
  });

  it('is pending while the request is in flight', () => {
    expect(deriveSaveState({ isPending: true, isError: false, hasSavedOnce: false }))
      .toBe('pending');
  });

  it('stays saved after a successful save', () => {
    expect(deriveSaveState({ isPending: false, isError: false, hasSavedOnce: true }))
      .toBe('saved');
  });

  it('reports error even when a previous save succeeded', () => {
    expect(deriveSaveState({ isPending: false, isError: true, hasSavedOnce: true }))
      .toBe('error');
  });

  it('pending wins over a stale error', () => {
    expect(deriveSaveState({ isPending: true, isError: true, hasSavedOnce: false }))
      .toBe('pending');
  });
});

import { shouldAutoOpenEditor, resolveReadDisplay } from './DetailFieldRow.helpers';
import { MOCK_SHIPMENT_DETAIL } from '@/mock/shipmentDetail';

// Booleans must never enter an "editing" state — a checkbox click IS the
// edit. Selects and dates should open their popup on the same click that
// enters edit mode, so the user does not have to click twice.
describe('shouldAutoOpenEditor', () => {
  it('auto-opens pickers', () => {
    expect(shouldAutoOpenEditor('select')).toBe(true);
    expect(shouldAutoOpenEditor('option_select')).toBe(true);
    expect(shouldAutoOpenEditor('date')).toBe(true);
    expect(shouldAutoOpenEditor('datetime')).toBe(true);
  });

  it('does not auto-open free-text inputs', () => {
    expect(shouldAutoOpenEditor('text')).toBe(false);
    expect(shouldAutoOpenEditor('textarea')).toBe(false);
    expect(shouldAutoOpenEditor('number')).toBe(false);
  });

  it('does not auto-open booleans', () => {
    expect(shouldAutoOpenEditor('boolean')).toBe(false);
  });
});

// The read-mode bug this guards: an FK field's `persisted` value is the raw
// id (e.g. country=1), but read mode must show the human-readable sibling
// the API already returns (country_name='Kazakhstan') — not the id.
describe('resolveReadDisplay', () => {
  const translateWeekday = (day: string) => `weekday:${day}`;

  it('returns the _name sibling for an FK field, not the raw id', () => {
    expect(
      resolveReadDisplay('country', MOCK_SHIPMENT_DETAIL, MOCK_SHIPMENT_DETAIL.country, translateWeekday),
    ).toBe('Kazakhstan');
  });

  it('returns the _display sibling for vehicle_responsible', () => {
    const shipment = { ...MOCK_SHIPMENT_DETAIL, vehicle_responsible_display: 'Warehouse Chief' };
    expect(
      resolveReadDisplay('vehicle_responsible', shipment, shipment.vehicle_responsible, translateWeekday),
    ).toBe('Warehouse Chief');
  });

  it('falls back to the raw id when the display sibling is null but the id is set', () => {
    const shipment = { ...MOCK_SHIPMENT_DETAIL, import_firm: 25, import_firm_name: null };
    expect(
      resolveReadDisplay('import_firm', shipment, shipment.import_firm, translateWeekday),
    ).toBe('25');
  });

  it('returns undefined when both the id and its display sibling are null', () => {
    expect(
      resolveReadDisplay('import_firm', MOCK_SHIPMENT_DETAIL, null, translateWeekday),
    ).toBeUndefined();
  });

  it('translates the weekday code for customs_clearance_planned_day', () => {
    expect(
      resolveReadDisplay('customs_clearance_planned_day', MOCK_SHIPMENT_DETAIL, 'wed', translateWeekday),
    ).toBe('weekday:wed');
  });

  it('returns undefined for fields with no display sibling (unaffected fields)', () => {
    expect(
      resolveReadDisplay('truck_plate', MOCK_SHIPMENT_DETAIL, MOCK_SHIPMENT_DETAIL.truck_plate, translateWeekday),
    ).toBeUndefined();
  });
});
