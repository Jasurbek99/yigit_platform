import { describe, it, expect } from 'vitest';
import { progressFieldKeys } from './TaskCardEditor.helpers';

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
