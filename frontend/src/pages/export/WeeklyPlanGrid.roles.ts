import { isExportManagerLike } from '@/constants/roles';

/**
 * Role → capability mapping for the Weekly Plan grid.
 *
 * These five predicates used to live inline in `WeeklyPlanGrid.tsx` (913 lines,
 * ~10 hooks), which made them untestable without a full render harness. They are
 * pure: role in, booleans out. Extracted verbatim — this file changes no
 * behaviour, it only makes the behaviour assertable.
 *
 * NOT extracted: `hasBlockPermission(blockId)`. It reads
 * `user.managed_block_ids` per block and is the one rule that depends on data
 * rather than role, so it stays in the component next to the block list it
 * filters. The boundary is deliberate: everything here answers "what may this
 * role do at all", the component answers "on which blocks".
 *
 * Two asymmetries a reader will trip on, both intentional and both pinned by
 * tests in `WeeklyPlanGrid.roles.test.ts`:
 *
 *   1. `director` may edit the harvest grid but NOT an actual value —
 *      `canEditHarvest` unions `isAdmin` (admin+director) with `isAdminLike`
 *      (admin+boss), while `canEditActual` uses only the latter.
 *   2. `canEditActual` currently reduces to `false` for every role, because
 *      `planOnlyCells` is now unconditionally true (2026-09-16). The two-term
 *      form `isAdminLike && !planOnlyCells` is kept on purpose — it states the
 *      rule ("admin-like, minus whoever sees a plan-only cell") rather than its
 *      current arithmetic result, so restoring the commented-out
 *      `role === 'boss'` line below brings the admin actual-override straight
 *      back with no other edit.
 */

export interface IPlanGridUser {
  /** `user.role`, or null/undefined when unauthenticated. */
  role: string | null | undefined;
  /** From `useSeasonReadOnly()` — a closed season beats every role. */
  isReadOnly: boolean;
}

export interface IPlanGridCapabilities {
  /** admin + director. Feeds truck editing, whose backend gate (TRUCK_WRITE) has no boss. */
  isAdmin: boolean;
  /** Mirrors backend `ADMIN_LIKE`: admin + boss. Override-with-reason and late-edit controls. */
  isAdminLike: boolean;
  /**
   * Harvest grid + Initialize Week: admin, director (legacy), boss.
   *
   * NOT a write gate on its own — unlike `canEditTrucks` / `canEditActual` this one does
   * NOT fold in `isReadOnly`, because the component applies the closed-season check inside
   * `canEditPlanForEntry` together with the per-block rule. Never use it alone to decide
   * whether a write may happen.
   */
  canEditHarvest: boolean;
  /**
   * The cell shows only the plan — the auto-computed actual is removed, not hidden.
   * True for every role since 2026-09-16 (was boss-only).
   * Season-blind by design: a closed season is still browsed with a plan-only cell.
   */
  planOnlyCells: boolean;
  /** Truck allocation — export_manager too, and dead over a closed season. */
  canEditTrucks: boolean;
  /** Generate plan tasks — a supervisor action. */
  canGenerateTasks: boolean;
  /** Overwriting the rollup-computed actual by hand. Dead over a closed season. */
  canEditActual: boolean;
  /**
   * Approve / reject a manager's in-week plan revision (ADR-024): export_manager,
   * admin, boss. Deliberately NOT `isExportManagerLike` — document_team shares
   * export-manager parity elsewhere, but the owner named the export manager only.
   * Mirrors backend `can_decide_plan_change`. Dead over a closed season.
   */
  canDecidePlanChanges: boolean;
}

export function planGridCapabilities({ role, isReadOnly }: IPlanGridUser): IPlanGridCapabilities {
  const isAdmin = role === 'admin' || role === 'director';
  const isAdminLike = role === 'admin' || role === 'boss';
  const canEditHarvest = isAdmin || isAdminLike;
  // 2026-09-16 — the weekly plan grid is plan-only for EVERY role, by owner
  // request: the actual column was an entry trap (see `HarvestCell.planOnly`).
  // Original rule kept commented so it can be restored in one line:
  //   const planOnlyCells = role === 'boss';
  const planOnlyCells = true;

  return {
    isAdmin,
    isAdminLike,
    canEditHarvest,
    planOnlyCells,
    canEditTrucks: (isAdmin || isExportManagerLike(role)) && !isReadOnly,
    canGenerateTasks:
      role === 'admin' ||
      role === 'director' ||
      role === 'boss' ||
      isExportManagerLike(role),
    canEditActual: !isReadOnly && isAdminLike && !planOnlyCells,
    canDecidePlanChanges: !isReadOnly && (isAdminLike || role === 'export_manager'),
  };
}
