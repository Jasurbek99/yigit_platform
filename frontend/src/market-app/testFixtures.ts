// Test data shared by the market screen tests (not imported by app code).
import type { IExpense, ILot, ILotDetail, ISale, ISpoilage } from './types';

/** An ISO time on a local calendar day of October 2026, so day grouping works in any TZ. */
export function oct(day: number, hour: number, minute = 0): string {
  return new Date(2026, 9, day, hour, minute).toISOString();
}

export function saleFixture(over: Partial<ISale>): ISale {
  return {
    id: 1, unit: 'box', qty: 12, boxes: 12, gross_kg: '86.00', tare_g: 450, net_kg: '80.50', price_kg: '45.00',
    calc_total: '3622.50', total: '3622.50', paid_on_spot: true, buyer: null, sold_at: oct(8, 14, 35), created_by: 3,
    ...over,
  };
}

export function spoilageFixture(over: Partial<ISpoilage>): ISpoilage {
  return { id: 1, boxes: 3, gross_kg: '31.35', tare_g: 450, net_kg: '30.00', recorded_at: oct(8, 16), created_by: 7, ...over };
}

export function expenseFixture(over: Partial<IExpense>): IExpense {
  return {
    id: 1, category_id: 3, category_code: 'INTERES', label: '', amount: '1000.00', recorded_at: oct(8, 15), created_by: 3,
    ...over,
  };
}

/** Truck 26-0101 / EX-17: 100 boxes, 32 sold over 8 and 7 October, one 1 000 ₸ expense. */
export function lotFixture(over: Partial<ILot> = {}): ILot {
  return {
    id: 5,
    shipment: { id: 9, code: '26-0101', export_code: 'EX-17', status_code: 'satylyar', product: { code: 'tomato', name_ru: 'Помидоры' } },
    seller: { id: 7, name: 'Айдос' },
    boxes_received: 100, boxes_per_pallet: 50, tare_g: 450, default_price_kg: null, currency: 'KZT',
    opened_at: oct(7, 9), closed_at: null, needs_receipt: false, on_the_road: false,
    totals: {
      sold_boxes: 32, sold_kg: '210.50', spoiled_boxes: 0, spoiled_kg: '0.00', used: 32, left: 68,
      sales_total: '8622.50', paid_total: '3622.50', debt_total: '5000.00', expenses_total: '1000.00',
      after_expenses: '7622.50', avg_price_kg: '40.96',
    },
    ...over,
  };
}

export function lotDetailFixture(): ILotDetail {
  return {
    ...lotFixture(),
    sales: [
      saleFixture({}),
      saleFixture({
        id: 2, qty: 20, boxes: 20, gross_kg: '139.00', net_kg: '130.00', price_kg: '40.00', calc_total: '5200.00',
        total: '5000.00', paid_on_spot: false, buyer: { id: 4, name: 'Рустам' }, sold_at: oct(7, 10),
      }),
    ],
    spoilage: [],
    expenses: [expenseFixture({})],
  };
}

export function page<T>(results: T[]): { data: { count: number; next: null; previous: null; results: T[] } } {
  return { data: { count: results.length, next: null, previous: null, results } };
}
