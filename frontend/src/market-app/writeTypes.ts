// Request bodies and write answers of the /market/ lots API (backend/apps/market/serializers/entries.py,
// views/entries.py). Re-exported from ./types — import from there.
import type { IExpense, ILot, IMarketPerson, SaleUnit } from './types';

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

/** POST /market/payments/ — `amount` is capped at the buyer's due by the server. */
export interface IPaymentInput {
  buyer_id: number;
  currency: string;
  amount: string;
}

/** A recorded payment. */
export interface IPayment {
  id: number;
  buyer: IMarketPerson;
  currency: string;
  amount: string;
  paid_at: string;
}

/** POST /market/payments/ answer: the payment and the caller's debts per currency after it. */
export interface IPaymentWrite {
  payment: IPayment;
  debts_total: Record<string, string>;
}

/** POST /market/sales/{id}/mark-paid/ answer: the payment of the sale's whole due and the lot after it. */
export interface IMarkPaidWrite {
  payment: IPayment;
  lot: ILot;
}
