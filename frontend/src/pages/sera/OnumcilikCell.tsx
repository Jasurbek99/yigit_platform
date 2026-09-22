import { useState } from 'react';
import { InputNumber, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import { handleCellKeyDown } from '@/utils/tableNavigation';
import { AdminOverrideReasonModal } from '@/components/AdminOverrideReasonModal';
import type { IHarvestDayEntry } from '@/types';

/** What `OnumcilikCell` hands back to the tab on blur — enough to either PATCH
 * an existing row (`entryId` set) or create one via write-cell (`entryId`
 * absent, `block` + `entryDate` used instead). */
export interface IOnumcilikCellSavePayload {
  entryId?: number;
  block: number;
  entryDate: string;
  value: number | null;
  reason?: string;
}

export interface IOnumcilikCellProps {
  /** `null`/`undefined` when this block+day has no row yet — the week was
   * never written to, so there is nothing to key a PATCH off. */
  entry?: IHarvestDayEntry | null;
  /** The cell's block. Read off `entry.block` when a row exists, but still
   * needed when it doesn't — it is what create-on-write addresses the new
   * row by. */
  block: number;
  /** `YYYY-MM-DD`. Same reasoning as `block`. */
  entryDate: string;
  /** Already resolved by the grid: role, block ownership and the week cutoff. */
  canEdit: boolean;
  onSave: (payload: IOnumcilikCellSavePayload) => void;
  /** Read-only cells with a row fall back to this — the history modal. A
   * read-only cell with no row has no history to open (see `entry` above). */
  onCellClick: (entryId: number) => void;
  /** Admin-like roles must supply a reason before overwriting a filled value. */
  isAdmin: boolean;
  savingKey: string | null;
}

/**
 * One cell of the Önümçilik grid — a single always-visible number box.
 *
 * Ported from the sera app's `NumInput` inside the Önümçilik table
 * (`App.jsx:13438`), where every cell is a bordered input you type straight
 * into. That is the whole difference from `HarvestCell`, which this replaces on
 * this tab only: `HarvestCell` is click-to-edit and, for an admin on today's or
 * a past day, stacks two values — the actual (large) over a small "Plan: …"
 * line. Sera's cell holds exactly one number, so "look like sera" forced a
 * choice about which one. It is the **plan**: this is a planning grid, and both
 * `greenhouse_manager` and `boss` already saw plan-only here.
 *
 * What that drops on this tab, for admin and director only: overriding an
 * `actual_value` from inside a cell, and the rollup/override source badge.
 * `/export/plan` keeps both — it still renders `HarvestCell` — and the backend
 * is untouched, so the capability is not gone, only absent from this screen.
 * Owner decision, 2026-09-16: "Actual don't need, remove it".
 *
 * A cell the user may not edit renders as plain text, not a disabled box. Sera
 * has no read-only state to copy because it has no permissions; showing an
 * input nobody can use would promise an edit the backend would refuse.
 *
 * `entry` is optional (create-on-write, 2026-09-16): a block's week may not
 * have a row for this day yet, and the grid now shows every active block
 * regardless. A missing + editable cell is still an input — it just creates
 * its row on first save instead of PATCHing one. A missing + read-only cell
 * has neither a value nor a history to show, so it renders the same em-dash
 * with no click handler (there is no id to open history for).
 */
export function OnumcilikCell({
  entry,
  block,
  entryDate,
  canEdit,
  onSave,
  onCellClick,
  isAdmin,
  savingKey,
}: IOnumcilikCellProps) {
  const { t } = useTranslation();
  const [pendingOverride, setPendingOverride] = useState<{
    value: number | null;
    oldValue: number | null;
  } | null>(null);

  const savingKeyForThisCell = entry ? String(entry.id) : `${block}-${entryDate}`;
  const isSaving = savingKey === savingKeyForThisCell;
  const planNum = entry?.plan_value != null ? Number(entry.plan_value) : null;

  if (!canEdit) {
    if (!entry) {
      // No row and no permission to create one — nothing to show or click.
      // Keeps the wrapper (not a bare span) so this cell matches the 36px
      // height of every editable/read-only cell around it in the same row.
      return (
        <div className="sera-cell sera-cell--readonly">
          <span className="sera-cell-empty">—</span>
        </div>
      );
    }
    return (
      <div
        className="sera-cell sera-cell--readonly"
        onClick={() => onCellClick(entry.id)}
        title={t('plan.click_for_history')}
      >
        {planNum == null ? (
          <span className="sera-cell-empty">—</span>
        ) : planNum === 0 && entry.plan_submitted_at ? (
          // An explicit confirmed zero, not an untouched cell — the distinction
          // the grid draws everywhere else, kept here so the two agree.
          <Tooltip title={t('plan.empty_explicit_zero')}>
            <span className="sera-cell-zero">0 ✓</span>
          </Tooltip>
        ) : (
          planNum.toLocaleString()
        )}
      </div>
    );
  }

  /**
   * Blur is the only save trigger, as in `HarvestCell`. An admin overwriting a
   * value that was already there routes through the reason modal first: the
   * backend demands a reason from admin-like roles and would otherwise 400.
   * An admin filling an EMPTY cell — including one with no row yet — is an
   * entry, not an override, so it saves straight through.
   */
  function commit(raw: string) {
    const cleaned = raw.replace(/,/g, '');
    const next = cleaned === '' ? null : Number(cleaned) || 0;
    if (next === planNum) return;
    if (isAdmin && planNum !== null) {
      setPendingOverride({ value: next, oldValue: planNum });
      return;
    }
    onSave({ entryId: entry?.id, block, entryDate, value: next });
  }

  return (
    <>
      <InputNumber
        className="sera-cell-input"
        min={0}
        step={100}
        keyboard={false}
        controls={false}
        // Uncontrolled, keyed on the value the server last gave us: typing must
        // not re-render the grid on every keystroke, but a value that changed
        // underneath (another user's save, a week switch, or this exact cell's
        // row being created by the save below) has to reach the box.
        key={entry ? (entry.plan_value ?? 'empty') : 'new'}
        defaultValue={planNum ?? undefined}
        placeholder="—"
        disabled={isSaving}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={handleCellKeyDown}
        size="small"
      />
      <AdminOverrideReasonModal
        open={pendingOverride !== null}
        oldValue={pendingOverride?.oldValue ?? null}
        newValue={pendingOverride?.value ?? null}
        onConfirm={(reason) => {
          if (pendingOverride) {
            onSave({ entryId: entry?.id, block, entryDate, value: pendingOverride.value, reason });
          }
          setPendingOverride(null);
        }}
        onCancel={() => setPendingOverride(null)}
      />
    </>
  );
}
