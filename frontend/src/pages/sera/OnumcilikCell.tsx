import { useState } from 'react';
import { InputNumber, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import { handleCellKeyDown } from '@/utils/tableNavigation';
import { AdminOverrideReasonModal } from '@/components/AdminOverrideReasonModal';
import type { IHarvestDayEntry } from '@/types';

export interface IOnumcilikCellProps {
  entry: IHarvestDayEntry;
  /** Already resolved by the grid: role, block ownership and the week cutoff. */
  canEdit: boolean;
  onSave: (
    entryId: number,
    field: 'plan_value',
    value: number | null,
    reason?: string,
  ) => void;
  /** Read-only cells fall back to this — the history modal. */
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
 */
export function OnumcilikCell({
  entry,
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

  const isSaving = savingKey === String(entry.id);
  const planNum = entry.plan_value != null ? Number(entry.plan_value) : null;

  if (!canEdit) {
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
   * An admin filling an EMPTY cell is an entry, not an override, so it saves
   * straight through.
   */
  function commit(raw: string) {
    const cleaned = raw.replace(/,/g, '');
    const next = cleaned === '' ? null : Number(cleaned) || 0;
    if (next === planNum) return;
    if (isAdmin && planNum !== null) {
      setPendingOverride({ value: next, oldValue: planNum });
      return;
    }
    onSave(entry.id, 'plan_value', next);
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
        // underneath (another user's save, a week switch) has to reach the box.
        key={entry.plan_value ?? 'empty'}
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
            onSave(entry.id, 'plan_value', pendingOverride.value, reason);
          }
          setPendingOverride(null);
        }}
        onCancel={() => setPendingOverride(null)}
      />
    </>
  );
}
