// Shapes of the /market/ lots API (backend/apps/market/serializers/{lots,entries}.py).
// Money and kg are strings with two decimals, exactly as the API sends them.

export type LotState = 'open' | 'closed';
export type SaleUnit = 'box' | 'pallet' | 'truck';
/** What `useDeleteEntry` removes; also the URL segment's singular. */
export type EntryKind = 'sale' | 'spoilage' | 'expense';

export interface IMarketProduct {
  code: string;
  name_ru: string;
}

export interface IMarketPerson {
  id: number;
  name: string;
}

export interface ILotShipment {
  id: number;
  code: string;
  export_code: string | null;
  status_code: string | null;
  product: IMarketProduct | null;
}

/** services/totals.py::lot_totals — box counts are ints, kg / money strings. */
export interface ILotTotals {
  sold_boxes: number;
  sold_kg: string;
  spoiled_boxes: number;
  spoiled_kg: string;
  used: number;
  left: number;
  sales_total: string;
  paid_total: string;
  debt_total: string;
  expenses_total: string;
  after_expenses: string;
  /** null while nothing is sold. */
  avg_price_kg: string | null;
}

/** A lot as the list, open, PATCH and every entry write return it. */
export interface ILot {
  id: number;
  shipment: ILotShipment;
  seller: IMarketPerson | null;
  boxes_received: number;
  boxes_per_pallet: number;
  tare_g: number;
  default_price_kg: string | null;
  currency: string;
  opened_at: string;
  /** Set when nothing is left. */
  closed_at: string | null;
  /** The agent still has to confirm the receipt (box count or boxes per pallet). */
  needs_receipt: boolean;
  /** Not past destination customs yet: no sale or write-off (expenses are fine). */
  on_the_road: boolean;
  totals: ILotTotals;
}

export interface ISale {
  id: number;
  unit: SaleUnit;
  qty: number;
  boxes: number;
  gross_kg: string;
  tare_g: number;
  net_kg: string;
  price_kg: string;
  calc_total: string;
  total: string;
  paid_on_spot: boolean;
  buyer: IMarketPerson | null;
  /** Money received: the total when paid on the spot, else the payments allocated to it. */
  paid_amount: string;
  /** Money still owed (0 when paid on the spot); derived on the server. */
  due: string;
  sold_at: string;
  created_by: number;
}

export interface ISpoilage {
  id: number;
  boxes: number;
  gross_kg: string | null;
  tare_g: number;
  net_kg: string;
  recorded_at: string;
  created_by: number;
}

export interface IExpense {
  id: number;
  category_id: number;
  category_code: string;
  label: string;
  amount: string;
  recorded_at: string;
  created_by: number;
}

/** GET /market/lots/{id}/ — entries newest first. */
export interface ILotDetail extends ILot {
  sales: ISale[];
  spoilage: ISpoilage[];
  expenses: IExpense[];
}

/** GET /market/shipments/ — a truck the agent may open; `lot_id` once opened. */
export interface IMarketShipment {
  id: number;
  code: string;
  export_code: string | null;
  status_code: string | null;
  box_count: number | null;
  pallet_count: number | null;
  product: IMarketProduct | null;
  lot_id: number | null;
}

export interface IExpenseCategory {
  id: number;
  code: string;
  label: string;
}

export interface IBuyer {
  id: number;
  name: string;
  phone: string;
}

export type {
  IBuyerInput, IEntryWrite, IExpenseRowInput, IExpensesWrite, ILotUpdateInput, ILotWrite, IPayment, IPaymentInput,
  IMarkPaidWrite, IPaymentWrite, ISaleInput, ISpoilageInput,
} from './writeTypes';
export type { IBuyerDebt, IDebtPayment, IDebtSale, IDebts } from './debtTypes';
