import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { InputNumber, Tooltip } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { handleCellKeyDown } from '@/utils/tableNavigation';
import { AdminOverrideReasonModal } from '@/components/AdminOverrideReasonModal';
import type { IHarvestDayEntry, IGreenhouseConfig } from '@/types';
import { getCurrentForecastWindow } from './HarvestCell.helpers';
import { COLORS } from '@/constants/styles';

type InputNumberRef = ComponentRef<typeof InputNumber>;

// ─── Types ────────────────────────────────────────────────────────────────────

type DisplayMode =
  | 'past_actual'
  | 'today_actual'
  | 'today_forecast_input'
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

function computeDisplayMode(
  entry: IHarvestDayEntry,
  today: dayjs.Dayjs,
  now: dayjs.Dayjs,
  config: IGreenhouseConfig | undefined,
  canEditForecast: boolean,
  canEditActual: boolean,
): DisplayMode {
  const entryDate = dayjs(entry.entry_date);

  if (entryDate.isBefore(today, 'day')) return 'past_actual';

  if (entryDate.isSame(today, 'day')) {
    // loading_dept_head edits forecast on today's cell (until 12:00 local).
    // Admin keeps the actual-edit surface — they primarily override the
    // computed actual_value, not the forecast. Distinguish by canEditActual.
    if (canEditForecast && !canEditActual && entry.actual_value == null) {
      return 'today_forecast_input';
    }
    return 'today_actual';
  }

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
    return <span style={{ color: COLORS.textMuted }}>—</span>;
  }
  const n = Number(valueStr);
  if (n === 0 && submittedAt) {
    return (
      <Tooltip title={t('plan.empty_explicit_zero')}>
        <span style={{ fontStyle: 'italic', color: color ?? COLORS.textSecondary }}>0 ✓</span>
      </Tooltip>
    );
  }
  return <span style={{ color: color ?? 'inherit' }}>{Number(valueStr).toLocaleString()}</span>;
}

function ActualSourceBadge({ source }: { source: IHarvestDayEntry['actual_source'] }) {
  const { t } = useTranslation();
  if (source !== 'admin_override' && source !== 'shipment_rollup') return null;
  const cfg =
    source === 'admin_override'
      ? { color: '#fa541c', bg: '#fff2e8', label: t('plan.source_admin_override') }
      : { color: COLORS.textSecondary, bg: COLORS.bgLight, label: t('plan.source_shipment_rollup') };
  return (
    <Tooltip title={cfg.label}>
      <span
        style={{
          marginLeft: 4,
          fontSize: 9,
          color: cfg.color,
          background: cfg.bg,
          borderRadius: 3,
          padding: '0 4px',
          verticalAlign: 'middle',
          textTransform: 'uppercase',
          letterSpacing: 0.3,
        }}
      >
        {source === 'admin_override' ? 'OR' : 'AUTO'}
      </span>
    </Tooltip>
  );
}

function PlanStateDot({ state }: { state: IHarvestDayEntry['plan_state'] }) {
  const { t } = useTranslation();
  if (state !== 'late' && state !== 'critical_late') return null;
  const cfg = state === 'critical_late'
    ? { color: COLORS.danger, label: t('plan.state_critical_late') }
    : { color: COLORS.warning, label: t('plan.state_late') };
  return (
    <Tooltip title={cfg.label}>
      <span
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: 4,
          background: cfg.color,
          marginLeft: 6,
          verticalAlign: 'middle',
        }}
      />
    </Tooltip>
  );
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

  const planInputRef = useRef<InputNumberRef>(null);
  const forecastInputRef = useRef<InputNumberRef>(null);
  const actualInputRef = useRef<InputNumberRef>(null);

  // Single-click focus: AntD's `autoFocus` is unreliable inside virtualised
  // Table cells (the input mounts inside a parent that has just received the
  // synthetic click). Drive focus imperatively from a layout effect instead.
  useEffect(() => {
    if (editingPlan) planInputRef.current?.focus({ cursor: 'all' });
  }, [editingPlan]);
  useEffect(() => {
    if (editingForecast) forecastInputRef.current?.focus({ cursor: 'all' });
  }, [editingForecast]);
  useEffect(() => {
    if (editingActual) actualInputRef.current?.focus({ cursor: 'all' });
  }, [editingActual]);

  const mode = computeDisplayMode(entry, today, now, config, canEditForecast, canEditActual);
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
    const oldNum = currentFieldValue != null ? Number(currentFieldValue) : null;
    if (newVal === oldNum) {
      setEditing(false);
      return;
    }
    if (isAdmin && oldNum !== null) {
      // Real override of a prior value — collect a reason before saving.
      // Defer setEditing(false): the AdminOverrideReasonModal lives inside the
      // editing branch, so unmounting it now would race-eat the modal before paint.
      // closeOverride() handles the toggle once the user confirms or cancels.
      setPendingOverride({ field, value: newVal, oldValue: oldNum });
      return;
    }
    setEditing(false);
    onSave(entry.id, field, newVal);
  }

  function closeOverride() {
    setPendingOverride(null);
    setEditingPlan(false);
    setEditingForecast(false);
    setEditingActual(false);
  }

  // ── past_actual ────────────────────────────────────────────────────────────
  if (mode === 'past_actual') {
    // Admin override: edit actual_value (most common past-day fix)
    if (isAdmin && editingActual) {
      const actualNum = entry.actual_value != null ? Number(entry.actual_value) : null;
      return (
        <>
          <div style={{ minHeight: 24 }}>
            <InputNumber
              ref={actualInputRef}
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
          </div>
          <AdminOverrideReasonModal
            open={pendingOverride !== null}
            oldValue={pendingOverride?.oldValue ?? null}
            newValue={pendingOverride?.value ?? null}
            onConfirm={(reason) => {
              if (pendingOverride) {
                onSave(entry.id, pendingOverride.field, pendingOverride.value, reason);
              }
              closeOverride();
            }}
            onCancel={closeOverride}
          />
        </>
      );
    }
    // Admin override: edit plan_value retroactively
    if (isAdmin && editingPlan) {
      const planNum = entry.plan_value != null ? Number(entry.plan_value) : undefined;
      return (
        <>
          <div style={{ minHeight: 24 }}>
            <InputNumber
              ref={planInputRef}
              min={0}
              step={100}
              keyboard={false}
              defaultValue={planNum}
              placeholder="—"
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
              closeOverride();
            }}
            onCancel={closeOverride}
          />
        </>
      );
    }
    // Admin override: edit forecast_value retroactively
    if (isAdmin && editingForecast) {
      const fcNum = entry.forecast_value != null ? Number(entry.forecast_value) : undefined;
      return (
        <>
          <div style={{ minHeight: 24 }}>
            <InputNumber
              ref={forecastInputRef}
              min={0}
              step={100}
              keyboard={false}
              defaultValue={fcNum}
              placeholder="—"
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
          </div>
          <AdminOverrideReasonModal
            open={pendingOverride !== null}
            oldValue={pendingOverride?.oldValue ?? null}
            newValue={pendingOverride?.value ?? null}
            onConfirm={(reason) => {
              if (pendingOverride) {
                onSave(entry.id, pendingOverride.field, pendingOverride.value, reason);
              }
              closeOverride();
            }}
            onCancel={closeOverride}
          />
        </>
      );
    }
    // Display: admins click the actual area to override; small edit icons let
    // them retroactively override plan / forecast values too. Non-admins get
    // the read-only history modal.
    return (
      <div
        data-edit-cell={isAdmin ? 'true' : undefined}
        onClick={() => { if (isAdmin) setEditingActual(true); else onCellClick(entry.id); }}
        style={{ cursor: 'pointer', minHeight: 24, padding: '2px 0' }}
        title={isAdmin ? t('plan.admin_click_edit_actual') : t('plan.click_for_history')}
      >
        <ValueOrEmpty
          valueStr={entry.actual_value}
          submittedAt={entry.actual_finalized_at}
          color={COLORS.success}
        />
        <ActualSourceBadge source={entry.actual_source} />
        {(entry.plan_value || isAdmin) && (
          <div
            onClick={isAdmin ? (e) => { e.stopPropagation(); setEditingPlan(true); } : undefined}
            style={{
              fontSize: 10,
              color: COLORS.textMuted,
              cursor: isAdmin ? 'pointer' : 'inherit',
              marginTop: 2,
            }}
            title={isAdmin ? t('plan.admin_click_edit_plan') : undefined}
          >
            {entry.plan_value
              ? t('plan.cell_plan_hint', { value: Number(entry.plan_value).toLocaleString() })
              : `${t('plan.plan')}: —`}
            {isAdmin && <EditOutlined style={{ marginLeft: 4, fontSize: 10 }} />}
          </div>
        )}
        {(entry.forecast_value || isAdmin) && (
          <div
            onClick={isAdmin ? (e) => { e.stopPropagation(); setEditingForecast(true); } : undefined}
            style={{
              fontSize: 10,
              color: COLORS.warning,
              cursor: isAdmin ? 'pointer' : 'inherit',
              marginTop: 2,
            }}
            title={isAdmin ? t('plan.admin_click_edit_forecast') : undefined}
          >
            {entry.forecast_value
              ? `${t('plan.forecast')}: ${Number(entry.forecast_value).toLocaleString()}`
              : `${t('plan.forecast')}: —`}
            {isAdmin && <EditOutlined style={{ marginLeft: 4, fontSize: 10 }} />}
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
              ref={actualInputRef}
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
              <div style={{ fontSize: 10, color: COLORS.warning, marginTop: 2 }}>
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
              closeOverride();
            }}
            onCancel={closeOverride}
          />
        </>
      );
    }
    return (
      <div
        data-edit-cell={canEditActual ? 'true' : undefined}
        onClick={() => { if (canEditActual) setEditingActual(true); else onCellClick(entry.id); }}
        style={{ cursor: canEditActual ? 'text' : 'pointer', minHeight: 24, padding: '2px 0' }}
      >
        <ValueOrEmpty
          valueStr={entry.actual_value}
          submittedAt={entry.actual_finalized_at}
          color={COLORS.success}
        />
        <ActualSourceBadge source={entry.actual_source} />
        {entry.forecast_value && (
          <div style={{ fontSize: 10, color: COLORS.warning, marginTop: 2 }}>
            {t('plan.forecast')}: {Number(entry.forecast_value).toLocaleString()}
          </div>
        )}
      </div>
    );
  }

  // ── tomorrow_forecast_input / today_forecast_input ─────────────────────────
  // Both render an editable forecast cell (yellow background) with a plan hint.
  // today_forecast_input is loading_dept_head's day-of slot before 12:00 local.
  if (mode === 'tomorrow_forecast_input' || mode === 'today_forecast_input') {
    const planNum = entry.plan_value != null ? Number(entry.plan_value) : undefined;
    if (canEditForecast && editingForecast) {
      return (
        <>
          <div style={{ minHeight: 24 }}>
            <InputNumber
              ref={forecastInputRef}
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
              <div style={{ fontSize: 10, color: COLORS.primary, marginTop: 2 }}>
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
              closeOverride();
            }}
            onCancel={closeOverride}
          />
        </>
      );
    }
    return (
      <div
        data-edit-cell={canEditForecast ? 'true' : undefined}
        onClick={() => { if (canEditForecast) setEditingForecast(true); else onCellClick(entry.id); }}
        style={{ cursor: canEditForecast ? 'text' : 'pointer', minHeight: 24, padding: '2px 0', backgroundColor: COLORS.bgOrange }}
      >
        <ValueOrEmpty
          valueStr={entry.forecast_value ?? entry.plan_value}
          submittedAt={entry.forecast_submitted_at ?? entry.plan_submitted_at}
          color={COLORS.orange}
        />
        {entry.plan_value && (
          <div style={{ fontSize: 10, color: COLORS.primary, marginTop: 2 }}>
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
        style={{ cursor: 'pointer', minHeight: 24, padding: '2px 0', backgroundColor: COLORS.bgYellow }}
      >
        <ValueOrEmpty
          valueStr={entry.forecast_value}
          submittedAt={entry.forecast_submitted_at}
          color={COLORS.warning}
        />
        {entry.plan_value && (
          <div style={{ fontSize: 10, color: COLORS.primary, marginTop: 2 }}>
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
            ref={planInputRef}
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
            closeOverride();
          }}
          onCancel={closeOverride}
        />
      </>
    );
  }
  return (
    <div
      data-edit-cell={canEditPlan ? 'true' : undefined}
      onClick={() => { if (canEditPlan) setEditingPlan(true); else onCellClick(entry.id); }}
      style={{ cursor: canEditPlan ? 'text' : 'pointer', minHeight: 24, padding: '2px 0' }}
    >
      <ValueOrEmpty
        valueStr={entry.plan_value}
        submittedAt={entry.plan_submitted_at}
        color={COLORS.primary}
      />
      <PlanStateDot state={entry.plan_state} />
    </div>
  );
}
