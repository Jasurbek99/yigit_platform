import { InputNumber } from 'antd';
import { handleCellKeyDown } from '@/utils/tableNavigation';
import type { IWeeklyHarvestPlan } from '@/types';

type Day = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday';

/** Safely convert DecimalField strings ("18000.00") to number. */
export function num(val: unknown): number {
  if (val == null) return 0;
  const n = Number(val);
  return Number.isNaN(n) ? 0 : n;
}

export function fmtKg(val: number | string | null | undefined): string {
  if (val == null) return '—';
  return Number(val).toLocaleString();
}

// ─── PlanCell ───────────────────────────────────────────────────────────────

interface IPlanCellProps {
  day: Day;
  row: IWeeklyHarvestPlan;
  editable: boolean;
  onSave: (row: IWeeklyHarvestPlan, day: Day, value: number) => void;
}

export function PlanCell({ day, row, editable, onSave }: IPlanCellProps) {
  const field = `${day}_plan_kg` as keyof IWeeklyHarvestPlan;
  const value = num(row[field]);

  if (editable) {
    return (
      <InputNumber
        min={0}
        step={100}
        keyboard={false}
        defaultValue={value}
        onBlur={(e) => {
          const v = Number(e.target.value.replace(/,/g, '')) || 0;
          if (v !== value) onSave(row, day, v);
        }}
        onKeyDown={handleCellKeyDown}
        size="small"
        style={{ width: 84 }}
      />
    );
  }
  return <span>{fmtKg(value)}</span>;
}

// ─── ActualCell ─────────────────────────────────────────────────────────────

interface IActualCellProps {
  day: Day;
  row: IWeeklyHarvestPlan;
  canEditActual: boolean;
  onActualSave: (row: IWeeklyHarvestPlan, day: Day, value: number | null) => void;
  savingKey: string | null;
}

export function ActualCell({ day, row, canEditActual, onActualSave, savingKey }: IActualCellProps) {
  const planField = `${day}_plan_kg` as keyof IWeeklyHarvestPlan;
  const actualField = `${day}_actual_kg` as keyof IWeeklyHarvestPlan;
  const plan = num(row[planField]);
  const actual = row[actualField] != null ? num(row[actualField]) : null;
  const isSaving = savingKey === `${row.id}_${day}`;

  if (canEditActual) {
    return (
      <InputNumber
        min={0}
        step={100}
        keyboard={false}
        defaultValue={actual ?? undefined}
        placeholder="—"
        onBlur={(e) => {
          const raw = e.target.value;
          const v = raw === '' ? null : Number(raw) || 0;
          if (v !== actual) onActualSave(row, day, v);
        }}
        onKeyDown={handleCellKeyDown}
        size="small"
        style={{ width: 84 }}
        disabled={isSaving}
      />
    );
  }

  if (actual == null) return <span style={{ color: '#bfbfbf' }}>—</span>;
  const diff = actual - plan;
  const diffColor = diff >= 0 ? '#52c41a' : '#ff4d4f';
  return (
    <span>
      <span>{fmtKg(actual)}</span>
      <span style={{ color: diffColor, fontSize: 11, marginLeft: 4 }}>
        {diff >= 0 ? '+' : ''}
        {fmtKg(diff)}
      </span>
    </span>
  );
}
