// Request bodies and write answers of the /market/ lots API (backend/apps/market/serializers/entries.py,
// views/entries.py). Re-exported from ./types — import from there.
import type { IExpense, ILot, SaleUnit } from './types';

/** PATCH /market/lots/{id}/ (agent). */
export interface ILotUpdateInput {
  seller_id?: number | null;
  boxes_received?: number;
  boxes_per_pallet?: number;
  tare_g?: number;
  default_price_kg?: string | null;
}

export interface ISaleInput {
  unit: SaleUnit;
  qty: number;
  gross_kg: string;
  price_kg: string;
  /** Only when the seller corrected the calculated total. */
  total?: string;
  paid_on_spot: boolean;
  buyer_id?: number;
}

export interface ISpoilageInput {
  boxes: number;
  /** null for "no weight" — 0 is read as a weight. */
  gross_kg: string | null;
}

export interface IExpenseRowInput {
  category_id: number;
  amount: string;
  label?: string;
}

export interface IBuyerInput {
  name: string;
  phone?: string;
}

/** POST sales / spoilage answer. */
export interface IEntryWrite<T> {
  entry: T;
  lot: ILot;
}

/** POST expenses answer — one sheet may hold several rows. */
export interface IExpensesWrite {
  entries: IExpense[];
  lot: ILot;
}

/** DELETE entry answer. */
export interface ILotWrite {
  lot: ILot;
}
