import { describe, it, expect } from 'vitest';
import { isFieldFilled, progressFieldKeys } from './TaskCardEditor.helpers';
import { MOCK_SHIPMENT_DETAIL } from '@/mock/shipmentDetail';

// Review A6: tasks.give_advance's only target, has_current_advance, is a
// backend-only Shipment @property that never reaches IShipmentDetail.
// Counting it as "unfilled" pins the progress bar at 0% forever — it must be
// excluded from the denominator instead.
describe('progressFieldKeys', () => {
  it('drops has_current_advance from the progress calculation', () => {
    expect(progressFieldKeys(['has_current_advance'])).toEqual([]);
  });

  it('keeps evaluable fields alongside an unevaluable one', () => {
    expect(progressFieldKeys(['driver_name', 'has_current_advance', 'truck_plate']))
      .toEqual(['driver_name', 'truck_plate']);
  });

  it('is a no-op when nothing is unevaluable', () => {
    expect(progressFieldKeys(['driver_name', 'truck_plate']))
      .toEqual(['driver_name', 'truck_plate']);
  });
});

// E2E 2026-10-01: after the first certificate upload the quality task read
// "7 of 7 fields filled" with three scans still missing — a quality flag is
// `false` exactly when its scan is missing, and that false counted as filled.
describe('isFieldFilled', () => {
  const shipment = {
    ...MOCK_SHIPMENT_DETAIL,
    has_peregruz: false,
    quality: {
      ...MOCK_SHIPMENT_DETAIL.quality!,
      azyk_maglumatnama: true,
      hil_sertifikaty: false,
    },
  };

  it('counts a quality flag with a scan as filled', () => {
    expect(isFieldFilled(shipment, 'quality.azyk_maglumatnama')).toBe(true);
  });

  it('counts a quality flag without a scan as not filled', () => {
    expect(isFieldFilled(shipment, 'quality.hil_sertifikaty')).toBe(false);
  });

  it('still counts a yes/no answer of "No" as filled', () => {
    expect(isFieldFilled(shipment, 'has_peregruz')).toBe(true);
  });
});
