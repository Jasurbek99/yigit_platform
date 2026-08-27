/**
 * Per-cell edit rule for the Local Sell Plan grid.
 *
 * The grid autosaves on blur and has no Send button (2026-08-23, owner
 * request), so "may I type here?" is decided per cell rather than per row.
 * This module is the frontend half of a rule the backend enforces in
 * `WeeklyLocalSellPlan.locked_day_fields()` and
 * `WeeklyLocalSellPlanViewSet.perform_update`.
 *
 * The two halves must not drift. `value > 0` here is the same predicate as
 * `getattr(self, f) > 0` there — if this file is ever more permissive, a cell
 * renders as an editable input and then 409s the moment the user tabs out of
 * it, which reads as a broken grid rather than a locked one. The truth table in
 * `LocalSellPlanGrid.cells.test.ts` pins it.
 *
 * EMPTY means 0, not null: the six `*_plan_kg` columns are `default=0` NOT NULL
 * on the model, so 0 is the only way the DB can say "not filled in yet". A
 * deliberate "zero kg on Wednesday" is therefore indistinguishable from an
 * untouched day and stays editable until approval.
 */
import type { PlanStatus } from '@/types';

export type CellMode =
  /** A plain input. Blur saves. */
  | 'edit'
  /** Read-only. `lockReasonKey` says why, and who to ask. */
  | 'locked'
  /** Read-only until double-clicked — the approver's override on a sent week. */
  | 'unlockable';

export interface ICellState {
  status: PlanStatus;
  /** The day's kg value. 0 means the day was never filled in. */
  value: number;
  /** Role may write local sell plans at all, and the season is open. */
  canEdit: boolean;
  /** LOCAL_SELL_APPROVE role — admin / export_manager / director. */
  isApprover: boolean;
}

export function cellMode({ status, value, canEdit, isApprover }: ICellState): CellMode {
  // Approved beats every role, approvers and admin included (idea #3). Checked
  // first so it also wins over the override path below.
  if (status === 'approved') return 'locked';
  if (!canEdit) return 'locked';

  if (status === 'submitted') {
    // Fill-empties (idea #4): the week is out for approval, but a day nobody
    // ever filled can still be filled. A day that already holds a value is the
    // approver's to change.
    if (value > 0) return isApprover ? 'unlockable' : 'locked';
    return 'edit';
  }

  // draft | rejected — nothing is locked yet.
  return 'edit';
}

/**
 * i18n key naming why a `locked` cell is locked AND who can unlock it.
 *
 * "Locked" without a named owner is what makes a screen feel broken, so every
 * branch points at a person.
 */
export function lockReasonKey({ status, canEdit }: Pick<ICellState, 'status' | 'canEdit'>): string {
  if (status === 'approved') return 'local_sell.locked_approved';
  if (!canEdit) return 'local_sell.locked_no_edit';
  if (status === 'submitted') return 'local_sell.locked_after_submit';
  return 'local_sell.locked_no_edit';
}

/**
 * Maps a PATCH 409 body to the toast key that names the real reason.
 *
 * Three different guards answer 409 on this endpoint — the closed-season freeze
 * (`season_closed`, raised by core before the view runs) and the two locks
 * here. Telling a seller on a closed season "Approved — ask an admin" sends
 * them to the wrong person, so discriminate on `error` and fall back to the
 * generic save failure for anything unrecognised.
 */
export function saveErrorKey(body: unknown): string {
  const code =
    typeof body === 'object' && body !== null && 'error' in body
      ? (body as { error: unknown }).error
      : undefined;
  if (code === 'plan_approved_locked') return 'local_sell.locked_approved';
  if (code === 'cell_locked_after_submit') return 'local_sell.locked_after_submit';
  if (code === 'season_closed') return 'local_sell.save_season_closed';
  return 'local_sell.save_error';
}
