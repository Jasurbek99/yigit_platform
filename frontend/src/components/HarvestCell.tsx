import { useState } from 'react';
import { InputNumber, Tooltip } from 'antd';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { handleCellKeyDown } from '@/utils/tableNavigation';
import { AdminOverrideReasonModal } from '@/components/AdminOverrideReasonModal';
import type { IHarvestDayEntry, IGreenhouseConfig, ForecastWindow } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type DisplayMode =
  | 'past_actual'
  | 'today_actual'
  | 'tomorrow_forecast_input'
  | 'tomorrow_forecast_locked'
  | 'future_plan';

export interface IHarvestCellProps {
  entry: IHarvestDayEntry;
  config: IGreenhouseConfig | undefined;
  canEditPlan: boolean;
  canEditForecast: boolean;
  canEditActual: boolean;
  onSave: (
    entryId: number,
    field: 'plan_value' | 'forecast_value' | 'actual_value',
    value: number | null,
    reason?: string,
  ) => void;
  onCellClick: (entryId: number) => void;
  isAdmin: boolean;
  savingKey: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Safely parse a Decimal string like "18000.00" to number. Returns 0 for null. */
export function num(val: string | number | null | undefined): number {
  if (val == null) return 0;
  const n = Number(val);
  return Number.isNaN(n) ? 0 : n;
}

/** Format kg value. Null/undefined → em-dash string. */
export function fmtKg(val: string | number | null | undefined): string {
  if (val == null) return '—';
  const n = Number(val);
  if (Number.isNaN(n)) return '—';
  return n.toLocaleString();
}

/**
 * Parse HH:MM:SS time string and return [hours, minutes, seconds].
 */
function parseTime(timeStr: string): [number, number, number] {
  const parts = timeStr.split(':').map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/**
 * Return the forecast window given current time and config.
 * `entryDate` is the target day being forecast.
 */
export function getCurrentForecastWindow(
  now: dayjs.Dayjs,
  entryDate: dayjs.Dayjs,
  config: IGreenhouseConfig,
): ForecastWindow | null {
  const today = now.startOf('day');
  const tomorrow = today.add(1, 'day');
  const isForTomorrow = entryDate.isSame(tomorrow, 'day');
  const isForToday = entryDate.isSame(today, 'day');

  if (!isForTomorrow && !isForToday) return null;

  const [ph, pm] = parseTime(config.forecast_primary_open);
  const [ch, cm] = parseTime(config.forecast_primary_close);
  const [fh, fm] = parseTime(config.forecast_fallback_close);
  const [sh, sm] = parseTime(config.forecast_same_day_close);

  const nowMinutes = now.hour() * 60 + now.minute();
  const primaryOpenMins = ph * 60 + pm;
  const primaryCloseMins = ch * 60 + cm;
  const fallbackCloseMins = fh * 60 + fm;
  const sameDayCloseMins = sh * 60 + sm;

  if (isForTomorrow) {
    if (nowMinutes >= primaryOpenMins && nowMinutes < primaryCloseMins) return 'primary';
    if (nowMinutes >= primaryCloseMins && nowMinutes < fallbackCloseMins) return 'fallback';
    // After fallback close, same-day escalation — still allow entry until same_day_close
    if (nowMinutes < sameDayCloseMins) return 'same_day_red_flag';
    return null;
  }

  if (isForToday) {
    if (nowMinutes < sameDayCloseMins) return 'same_day_red_flag';
    return null;
  }

  return null;
}

function computeDisplayMode(
  entry: IHarvestDayEntry,
  today: dayjs.Dayjs,
  now: dayjs.Dayjs,
  config: IGreenhouseConfig | undefined,
): DisplayMode {
  const entryDate = dayjs(entry.entry_date);

  if (entryDate.isBefore(today, 'day')) return 'past_actual';

  if (entryDate.isSame(today, 'day')) return 'today_actual';

  if (entryDate.isSame(today.add(1, 'day'), 'day')) {
    if (entry.forecast_submitted_at) return 'tomorrow_forecast_locked';
    if (config) {
      const window = getCurrentForecastWindow(now, entryDate, config);
      if (window) return 'tomorrow_forecast_input';
    }
    return 'future_plan';
  }

  return 'future_plan';
}

// ─── Sub-renders ──────────────────────────────────────────────────────────────

interface IEmptyProps {
  valueStr: string | null;
  submittedAt: string | null;
  color?: string;
}

function ValueOrEmpty({ valueStr, submittedAt, color }: IEmptyProps) {
  const { t } = useTranslation();
  if (valueStr == null) {
    return <span style={{ color: '#bfbfbf' }}>—</span>;
  }
  const n = Number(valueStr);
  if (n === 0 && submittedAt) {
    return (
      <Tooltip title={t('plan.empty_explicit_zero')}>
        <span style={{ fontStyle: 'italic', color: color ?? '#8c8c8c' }}>0 ✓</span>
      </Tooltip>
    );
  }
  return <span style={{ color: color ?? 'inherit' }}>{Number(valueStr).toLocaleString()}</span>;
}

// ─── Main component ───────────────────────────────────────────────────────────

interface IPendingOverride {
  field: 'plan_value' | 'forecast_value' | 'actual_value';
  value: number | null;
  oldValue: number | null;
}

export function HarvestCell({
  entry,
  config,
  canEditPlan,
  canEditForecast,
  canEditActual,
  onSave,
  onCellClick,
  isAdmin,
  savingKey,
}: IHarvestCellProps): React.ReactElement {
  const { t } = useTranslation();
  const today = dayjs().startOf('day');
  const now = dayjs();

  const [editingPlan, setEditingPlan] = useState(false);
  const [editingForecast, setEditingForecast] = useState(false);
  const [editingActual, setEditingActual] = useState(false);
  const [pendingOverride, setPendingOverride] = useState<IPendingOverride | null>(null);

  const mode = computeDisplayMode(entry, today, now, config);
  const isSaving = savingKey === String(entry.id);

  // ── Admin override gate ────────────────────────────────────────────────────

  /**
   * When isAdmin is true and the new value differs from old, intercept
   * the save and ask for a reason before committing.
   */
  function handleValueBlur(
    field: 'plan_value' | 'forecast_value' | 'actual_value',
    currentFieldValue: string | null,
    newVal: number | null,
    setEditing: (v: boolean) => void,
  ) {
    setEditing(false);
    const oldNum = currentFieldValue != null ? Number(currentFieldValue) : null;
    if (isAdmin && newVal !== oldNum) {
      setPendingOverride({ field, value: newVal, oldValue: oldNum });
      return; // do not call onSave yet — wait for reason modal
    }
    onSave(entry.id, field, newVal);
  }

  // ── past_actual ────────────────────────────────────────────────────────────
  if (mode === 'past_actual') {
    return (
      <div
        onClick={() => onCellClick(entry.id)}
        style={{ cursor: 'pointer', minHeight: 24, padding: '2px 0' }}
        title={t('plan.click_for_history')}
      >
        <ValueOrEmpty
          valueStr={entry.actual_value}
          submittedAt={entry.actual_finalized_at}
          color="#52c41a"
        />
        {entry.plan_value && (
          <div style={{ fontSize: 10, color: '#bfbfbf' }}>
            {t('plan.cell_plan_hint', { value: Number(entry.plan_value).toLocaleString() })}
          </div>
        )}
      </div>
    );
  }

  // ── today_actual ──────────────────────────────────────────────────────────
  if (mode === 'today_actual') {
    const actualNum = entry.actual_value != null ? Number(entry.actual_value) : null;
    if (canEditActual && editingActual) {
      return (
        <>
          <div style={{ minHeight: 24 }}>
            <InputNumber
              autoFocus
              min={0}
              step={100}
              keyboard={false}
              defaultValue={actualNum ?? undefined}
              placeholder="—"
              disabled={isSaving}
              onBlur={(e) => {
                const raw = e.target.value.replace(/,/g, '');
                const v = raw === '' ? null : Number(raw) || 0;
                handleValueBlur('actual_value', entry.actual_value, v, setEditingActual);
              }}
              onKeyDown={handleCellKeyDown}
              size="small"
              style={{ width: 84 }}
            />
            {entry.forecast_value && (
              <div style={{ fontSize: 10, color: '#faad14', marginTop: 2 }}>
                {t('plan.forecast')}: {Number(entry.forecast_value).toLocaleString()}
              </div>
            )}
          </div>
          <AdminOverrideReasonModal
            open={pendingOverride !== null}
            oldValue={pendingOverride?.oldValue ?? null}
            newValue={pendingOverride?.value ?? null}
            onConfirm={(reason) => {
              if (pendingOverride) {
                onSave(entry.id, pendingOverride.field, pendingOverride.value, reason);
              }
              setPendingOverride(null);
            }}
            onCancel={() => setPendingOverride(null)}
          />
        </>
      );
    }
    return (
      <div
        onClick={() => { if (canEditActual) setEditingActual(true); else onCellClick(entry.id); }}
        style={{ cursor: canEditActual ? 'text' : 'pointer', minHeight: 24, padding: '2px 0' }}
      >
        <ValueOrEmpty
          valueStr={entry.actual_value}
          submittedAt={entry.actual_finalized_at}
          color="#52c41a"
        />
        {entry.forecast_value && (
          <div style={{ fontSize: 10, color: '#faad14', marginTop: 2 }}>
            {t('plan.forecast')}: {Number(entry.forecast_value).toLocaleString()}
          </div>
        )}
      </div>
    );
  }

  // ── tomorrow_forecast_input ────────────────────────────────────────────────
  if (mode === 'tomorrow_forecast_input') {
    const planNum = entry.plan_value != null ? Number(entry.plan_value) : undefined;
    if (canEditForecast && editingForecast) {
      return (
        <>
          <div style={{ minHeight: 24 }}>
            <InputNumber
              autoFocus
              min={0}
              step={100}
              keyboard={false}
              defaultValue={planNum}
              disabled={isSaving}
              onBlur={(e) => {
                const raw = e.target.value.replace(/,/g, '');
                const v = raw === '' ? null : Number(raw) || 0;
                handleValueBlur('forecast_value', entry.forecast_value, v, setEditingForecast);
              }}
              onKeyDown={handleCellKeyDown}
              size="small"
              style={{ width: 84 }}
            />
            {entry.plan_value && (
              <div style={{ fontSize: 10, color: '#1677ff', marginTop: 2 }}>
                {t('plan.cell_plan_hint', { value: Number(entry.plan_value).toLocaleString() })}
              </div>
            )}
          </div>
          <AdminOverrideReasonModal
            open={pendingOverride !== null}
            oldValue={pendingOverride?.oldValue ?? null}
            newValue={pendingOverride?.value ?? null}
            onConfirm={(reason) => {
              if (pendingOverride) {
                onSave(entry.id, pendingOverride.field, pendingOverride.value, reason);
              }
              setPendingOverride(null);
            }}
            onCancel={() => setPendingOverride(null)}
          />
        </>
      );
    }
    return (
      <div
        onClick={() => { if (canEditForecast) setEditingForecast(true); else onCellClick(entry.id); }}
        style={{ cursor: canEditForecast ? 'text' : 'pointer', minHeight: 24, padding: '2px 0', backgroundColor: '#fff7e6' }}
      >
        <ValueOrEmpty
          valueStr={entry.forecast_value ?? entry.plan_value}
          submittedAt={entry.forecast_submitted_at ?? entry.plan_submitted_at}
          color="#fa8c16"
        />
        {entry.plan_value && (
          <div style={{ fontSize: 10, color: '#1677ff', marginTop: 2 }}>
            {t('plan.cell_plan_hint', { value: Number(entry.plan_value).toLocaleString() })}
          </div>
        )}
      </div>
    );
  }

  // ── tomorrow_forecast_locked ───────────────────────────────────────────────
  if (mode === 'tomorrow_forecast_locked') {
    return (
      <div
        onClick={() => onCellClick(entry.id)}
        style={{ cursor: 'pointer', minHeight: 24, padding: '2px 0', backgroundColor: '#fffbe6' }}
      >
        <ValueOrEmpty
          valueStr={entry.forecast_value}
          submittedAt={entry.forecast_submitted_at}
          color='#faad14'
        />
        {entry.plan_value && (
          <div style={{ fontSize: 10, color: '#1677ff', marginTop: 2 }}>
            {t('plan.cell_plan_hint', { value: Number(entry.plan_value).toLocaleString() })}
          </div>
        )}
      </div>
    );
  }

  // ── future_plan (default) ─────────────────────────────────────────────────
  const planNum = entry.plan_value != null ? Number(entry.plan_value) : undefined;
  if (canEditPlan && editingPlan) {
    return (
      <>
        <div style={{ minHeight: 24 }}>
          <InputNumber
            autoFocus
            min={0}
            step={100}
            keyboard={false}
            defaultValue={planNum}
            disabled={isSaving}
            onBlur={(e) => {
              const raw = e.target.value.replace(/,/g, '');
              const v = raw === '' ? null : Number(raw) || 0;
              handleValueBlur('plan_value', entry.plan_value, v, setEditingPlan);
            }}
            onKeyDown={handleCellKeyDown}
            size="small"
            style={{ width: 84 }}
          />
        </div>
        <AdminOverrideReasonModal
          open={pendingOverride !== null}
          oldValue={pendingOverride?.oldValue ?? null}
          newValue={pendingOverride?.value ?? null}
          onConfirm={(reason) => {
            if (pendingOverride) {
              onSave(entry.id, pendingOverride.field, pendingOverride.value, reason);
            }
            setPendingOverride(null);
          }}
          onCancel={() => setPendingOverride(null)}
        />
      </>
    );
  }
  return (
    <div
      onClick={() => { if (canEditPlan) setEditingPlan(true); else onCellClick(entry.id); }}
      style={{ cursor: canEditPlan ? 'text' : 'pointer', minHeight: 24, padding: '2px 0' }}
    >
      <ValueOrEmpty
        valueStr={entry.plan_value}
        submittedAt={entry.plan_submitted_at}
        color="#1677ff"
      />
    </div>
  );
}
