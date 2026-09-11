import { describe, it, expect } from 'vitest';
import { TRUCK_CAPACITY_KG, deriveContractPlan } from './contractPlan';

/**
 * The contract .docx prints its quantity, price and total from these four
 * fields, so they have to agree. Both the create modal and the detail page's
 * edit modal apply this one rule; a second copy would compute different totals
 * for the same contract.
 */
describe('deriveContractPlan', () => {
  it('fills quantity from trucks', () => {
    const patch = deriveContractPlan({ planned_trucks: 2 }, 'planned_trucks');

    expect(patch.planned_quantity_kg).toBe(2 * TRUCK_CAPACITY_KG);
  });

  it('rounds trucks up from a quantity that does not divide evenly', () => {
    const patch = deriveContractPlan(
      { planned_quantity_kg: TRUCK_CAPACITY_KG + 1 },
      'planned_quantity_kg',
    );

    expect(patch.planned_trucks).toBe(2);
  });

  it('computes the amount as quantity times price, to cents', () => {
    const patch = deriveContractPlan(
      { planned_quantity_kg: 9000, price_per_kg: 0.9 },
      'price_per_kg',
    );

    expect(patch.planned_amount_usd).toBe(8100);
  });

  it('rounds a fractional product to two decimals', () => {
    const patch = deriveContractPlan(
      { planned_quantity_kg: 9000, price_per_kg: 0.8888 },
      'price_per_kg',
    );

    expect(patch.planned_amount_usd).toBe(7999.2);
  });

  it('leaves the amount alone when the operator types it', () => {
    const patch = deriveContractPlan(
      { planned_quantity_kg: 9000, price_per_kg: 0.9, planned_amount_usd: 8000 },
      'planned_amount_usd',
    );

    expect(patch).toEqual({});
  });

  it('clears the amount when an input is missing rather than guessing', () => {
    const patch = deriveContractPlan({ planned_quantity_kg: 9000 }, 'planned_quantity_kg');

    expect(patch.planned_amount_usd).toBeUndefined();
  });

  it('does not touch trucks when the price is the field edited', () => {
    const patch = deriveContractPlan(
      { planned_trucks: 3, planned_quantity_kg: 9000, price_per_kg: 1 },
      'price_per_kg',
    );

    expect(patch).not.toHaveProperty('planned_trucks');
    expect(patch).not.toHaveProperty('planned_quantity_kg');
  });
});

/**
 * A one-time contract covers one export firm's share of a single truck
 * (ADR-023), so its weight is that firm's split — often ~9 000 kg, not a
 * multiple of a truckload. Converting there would overwrite an agreed weight
 * with a truck count the operator never meant.
 */
describe('deriveContractPlan — one-time (linkTrucks: false)', () => {
  it('does not derive a truck count from the weight', () => {
    const patch = deriveContractPlan(
      { planned_quantity_kg: 9000 },
      'planned_quantity_kg',
      { linkTrucks: false },
    );

    expect(patch).not.toHaveProperty('planned_trucks');
  });

  it('still computes the value as weight times price', () => {
    const patch = deriveContractPlan(
      { planned_quantity_kg: 9000, price_per_kg: 0.9 },
      'price_per_kg',
      { linkTrucks: false },
    );

    expect(patch.planned_amount_usd).toBe(8100);
  });

  it('leaves the weight alone even if a truck count is present', () => {
    const patch = deriveContractPlan(
      { planned_trucks: 1, planned_quantity_kg: 9000, price_per_kg: 1 },
      'planned_trucks',
      { linkTrucks: false },
    );

    expect(patch).not.toHaveProperty('planned_quantity_kg');
    expect(patch.planned_amount_usd).toBe(9000);
  });
});
