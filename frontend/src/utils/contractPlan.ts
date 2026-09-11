/**
 * The contract's planned block: trucks ⇄ quantity ⇄ price ⇄ amount.
 *
 * These four numbers are what the contract .docx prints as its quantity, price
 * and total (and the total spelled out in words), so they have to agree with
 * each other or the document contradicts itself. The rule lives here because
 * two forms apply it — the create modal and the edit modal on the detail page —
 * and a drift between them would produce different totals for the same inputs.
 */

/** Net kg one truck carries — planned trucks ⇄ planned quantity convert through this. */
export const TRUCK_CAPACITY_KG = 18100;

/**
 * `undefined` rather than `null` for an empty field: this shape is what both
 * forms hold, and Ant Design clears a number input to `undefined`. The PATCH
 * payload converts an empty field to `null` at submit, where the API wants it.
 */
export interface IContractPlan {
  planned_trucks?: number;
  planned_quantity_kg?: number;
  price_per_kg?: number;
  planned_amount_usd?: number;
}

/** Which of the four the user just edited. Only its dependents are recomputed. */
export type ContractPlanField = keyof IContractPlan;

export interface IDeriveOptions {
  /**
   * Whether trucks and quantity are two views of one number.
   *
   * True for a framework contract, which is planned in truckloads over a season.
   * FALSE for a one-time contract: it covers one export firm's share of a single
   * truck (ADR-023), so its quantity is that firm's split weight — often around
   * 9 000 kg, not a multiple of a truckload. Converting there would overwrite the
   * agreed weight with a truck count the operator never meant. Defaults to true.
   */
  linkTrucks?: boolean;
}

/**
 * Recompute the fields that depend on the one just edited.
 *
 * The amount is always quantity × price, to cents. Editing the amount itself
 * derives nothing: an operator typing a total is stating the agreed figure, and
 * overwriting it from a rounded price would fight them.
 *
 * @param values the form's current values.
 * @param edited the field the user changed.
 * @param options see IDeriveOptions.
 * @returns only the fields to write back, so an untouched value stays untouched.
 */
export function deriveContractPlan(
  values: IContractPlan,
  edited: ContractPlanField,
  options: IDeriveOptions = {},
): Partial<IContractPlan> {
  if (edited === 'planned_amount_usd') return {};
  const linkTrucks = options.linkTrucks ?? true;

  const patch: Partial<IContractPlan> = {};
  let quantity = values.planned_quantity_kg;

  if (linkTrucks && edited === 'planned_trucks') {
    quantity = values.planned_trucks ? values.planned_trucks * TRUCK_CAPACITY_KG : undefined;
    patch.planned_quantity_kg = quantity;
  } else if (linkTrucks && edited === 'planned_quantity_kg') {
    patch.planned_trucks = quantity ? Math.ceil(quantity / TRUCK_CAPACITY_KG) : undefined;
  }

  const price = values.price_per_kg;
  patch.planned_amount_usd =
    quantity && price ? Number((quantity * price).toFixed(2)) : undefined;

  return patch;
}
