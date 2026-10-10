// Shapes of GET /market/debts/ (backend/apps/market/serializers/payments.py). Re-exported from ./types.
import type { IMarketPerson, SaleUnit } from './types';

/** One unpaid sale of a buyer; `due` is what is still owed on it. */
export interface IDebtSale {
  id: number;
  lot_id: number;
  shipment_code: string;
  sold_at: string;
  unit: SaleUnit;
  boxes: number;
  net_kg: string;
  total: string;
  due: string;
}

/** One of the buyer's latest payments, newest first; `amount` is the part that went to the caller's sales. */
export interface IDebtPayment {
  id: number;
  amount: string;
  paid_at: string;
  created_by: IMarketPerson;
}

/**
 * What one buyer owes in one currency: sales oldest first, the latest 10 payments.
 * Paid off by a payment in the last 30 days: `due` '0.00', `since` null, no sales (kept for the undo).
 */
export interface IBuyerDebt {
  buyer: IMarketPerson;
  currency: string;
  due: string;
  since: string | null;
  sales: IDebtSale[];
  payments: IDebtPayment[];
}

/** `totals` per currency, without currencies nobody owes in (`{}` when nothing is owed). */
export interface IDebts {
  totals: Record<string, string>;
  buyers: IBuyerDebt[];
}
