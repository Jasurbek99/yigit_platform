import type { IGreenhouseBlock, IWeeklyHarvestPlan } from '@/types';

/**
 * One row of a weekly-plan grid: a plannable block, whether or not its week has
 * been initialised yet.
 *
 * The grids used to list `useHarvestPlans()` directly, so a week nobody had
 * initialised rendered no rows at all and needed the "Initialize Week" button.
 * With create-on-write (`POST /greenhouse/day-entries/write-cell/`) the first
 * value typed creates the week, so the grid has to show a row for every block
 * up front — the block list is the row source, and the plan is optional.
 *
 * Shared by `/export/plan` and the Önümçilik tab: it is logic both designs agree
 * on, like `WeeklyPlanGrid.roles.ts` beside it. The two views stay separate.
 */
export interface IPlanGridRow {
  /** Stable row key — the block, not the plan, since the plan may not exist. */
  key: string;
  block: number;
  block_code: string;
  block_name: string;
  location: number | null;
  location_name: string | null;
  /** `null` until the first write creates this block's week. */
  plan: IWeeklyHarvestPlan | null;
  /**
   * From the plan serializer, which reads the active `BlockManagerAssignment`s.
   * Empty for a block whose week does not exist yet: the block list carries only
   * the legacy single `manager` FK, which is a different source and can disagree,
   * so it is deliberately not used as a fallback. The names appear as soon as the
   * first write creates the plan.
   */
  block_manager_names: string[];
  late_edit_active: boolean;
  /** Block's product (tomato/pepper); null = no variety set. */
  product_code?: string | null;
}

/**
 * Build the grid's rows from the block list, attaching each block's plan when
 * the week has one.
 *
 * - **Top-level blocks only.** Sub-blocks (F1/F2) are not plannable: plans are
 *   keyed on the parent, and `write-cell` refuses a sub-block with an error that
 *   would read like a bug if a row offered one.
 * - **Inactive blocks are dropped** unless the week already holds a plan for
 *   one — a block retired mid-season must not make its recorded plan vanish.
 * - **Order is `sort_order`, then `code`** — `GreenhouseBlock.Meta.ordering`, the
 *   admin-defined order. A plan whose block is missing from the list entirely
 *   is kept and sorted last, for the same reason as the inactive case.
 */
export function buildPlanGridRows(
  blocks: IGreenhouseBlock[],
  plans: IWeeklyHarvestPlan[],
): IPlanGridRow[] {
  const planByBlock = new Map(plans.map((p) => [p.block, p]));
  const seen = new Set<number>();
  const rows: Array<IPlanGridRow & { sortOrder: number }> = [];

  for (const b of blocks) {
    if (b.parent != null) continue;
    const plan = planByBlock.get(b.id) ?? null;
    if (!b.is_active && !plan) continue;
    seen.add(b.id);
    rows.push({
      key: `block-${b.id}`,
      block: b.id,
      block_code: b.code,
      block_name: b.name || b.code,
      location: b.location ?? null,
      location_name: b.location_name ?? null,
      plan,
      block_manager_names: plan?.block_manager_names ?? [],
      late_edit_active: plan?.late_edit_active ?? false,
      product_code: b.product_type_code ?? null,
      sortOrder: b.sort_order ?? 0,
    });
  }

  for (const p of plans) {
    if (seen.has(p.block)) continue;
    rows.push({
      key: `block-${p.block}`,
      block: p.block,
      block_code: p.block_code,
      block_name: p.block_name || p.block_code,
      location: null,
      location_name: null,
      plan: p,
      block_manager_names: p.block_manager_names,
      late_edit_active: p.late_edit_active,
      product_code: null,
      sortOrder: Number.POSITIVE_INFINITY,
    });
  }

  rows.sort((a, b) => a.sortOrder - b.sortOrder || a.block_code.localeCompare(b.block_code));
  return rows.map(({ sortOrder: _sortOrder, ...row }) => row);
}

/**
 * Sum `valueOf` per product, ordered tomato, pepper, then any others.
 * A row with no product reads as tomato.
 */
export function productTotals(
  rows: IPlanGridRow[],
  valueOf: (row: IPlanGridRow) => number,
): { code: string; total: number }[] {
  const totals = new Map<string, number>();
  for (const r of rows) {
    const code = r.product_code ?? 'tomato';
    totals.set(code, (totals.get(code) ?? 0) + valueOf(r));
  }
  const rank = (c: string) => (c === 'tomato' ? 0 : c === 'pepper' ? 1 : 2);
  return [...totals.entries()]
    .map(([code, total]) => ({ code, total }))
    .sort((a, b) => rank(a.code) - rank(b.code));
}
