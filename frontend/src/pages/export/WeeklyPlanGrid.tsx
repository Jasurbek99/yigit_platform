import { useState } from 'react';
import {
  Table,
  DatePicker,
  Tag,
  Skeleton,
  Alert,
  Flex,
  Typography,
  InputNumber,
  Button,
  Space,
  Modal,
  Input,
  Tooltip,
  Card,
  Collapse,
  Statistic,
  message,
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  EditOutlined,
  LeftOutlined,
  RightOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import {
  useHarvestPlans,
  useUpsertHarvestPlan,
  useInitializeWeek,
  useBulkSubmitHarvestPlans,
  useBulkApproveHarvestPlans,
  useBulkRejectHarvestPlans,
  useTruckAllocations,
  useTruckDestinations,
  useUpsertTruckAllocation,
  useSetTruckSplits,
} from '@/hooks/usePlanning';
import { useSeasons } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import type { IWeeklyHarvestPlan, IWeeklyTruckAllocation, PlanStatus } from '@/types';

dayjs.extend(isoWeek);
dayjs.extend(weekOfYear);

const { Title, Text } = Typography;
const { TextArea } = Input;

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
type Day = (typeof DAYS)[number];

const DAY_INDEX: Record<Day, number> = {
  monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

const STATUS_TAG: Record<PlanStatus, { color: string; icon: React.ReactNode }> = {
  draft: { color: 'default', icon: <EditOutlined /> },
  submitted: { color: 'processing', icon: <ClockCircleOutlined /> },
  approved: { color: 'success', icon: <CheckCircleOutlined /> },
  rejected: { color: 'error', icon: <CloseCircleOutlined /> },
};

const ROW_BG: Record<PlanStatus, string> = {
  draft: '',
  submitted: '#e6f4ff',
  approved: '#f6ffed',
  rejected: '#fff2f0',
};

/** Safely convert DecimalField strings ("18000.00") to number. */
function num(val: unknown): number {
  if (val == null) return 0;
  const n = Number(val);
  return Number.isNaN(n) ? 0 : n;
}

function fmtKg(val: number | string | null | undefined): string {
  if (val == null) return '—';
  return Number(val).toLocaleString();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function findNextInput(
  cell: Element,
  dir: 'up' | 'down' | 'left' | 'right',
): HTMLInputElement | null {
  const row = cell.closest('tr');
  if (!row) return null;
  const cellIndex = Array.from(row.children).indexOf(cell);

  if (dir === 'up' || dir === 'down') {
    const sibling = dir === 'down' ? row.nextElementSibling : row.previousElementSibling;
    if (!sibling) return null;
    const target = sibling.children[cellIndex] as HTMLElement | undefined;
    return target?.querySelector<HTMLInputElement>('input') ?? null;
  }

  // Left/Right: skip cells without inputs
  const step = dir === 'right' ? 1 : -1;
  let idx = cellIndex + step;
  while (idx >= 0 && idx < row.children.length) {
    const target = row.children[idx] as HTMLElement;
    const input = target.querySelector<HTMLInputElement>('input');
    if (input) return input;
    idx += step;
  }
  return null;
}

function handleCellKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
  const key = e.key;
  const el = e.target as HTMLInputElement;
  const cell = el.closest('td');
  if (!cell) return;

  let input: HTMLInputElement | null = null;

  if (key === 'Enter' || key === 'ArrowDown') {
    input = findNextInput(cell, 'down');
  } else if (key === 'ArrowUp') {
    input = findNextInput(cell, 'up');
  } else if (key === 'ArrowRight') {
    input = findNextInput(cell, 'right');
  } else if (key === 'ArrowLeft') {
    input = findNextInput(cell, 'left');
  } else if (key === 'Escape') {
    el.blur();
    return;
  } else {
    return; // let all other keys (Tab, digits, etc.) behave normally
  }

  if (!input) return;
  e.preventDefault();
  e.stopPropagation();
  if (key === 'Enter') el.blur();
  const delay = key === 'Enter' ? 50 : 0;
  setTimeout(() => { input!.focus(); input!.select(); }, delay);
}

// ─── Sub-components ──────────────────────────────────────────────────────────

interface PlanCellProps {
  day: Day;
  row: IWeeklyHarvestPlan;
  editable: boolean;
  onSave: (row: IWeeklyHarvestPlan, day: Day, value: number) => void;
}

function PlanCell({ day, row, editable, onSave }: PlanCellProps) {
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

interface ActualCellProps {
  day: Day;
  row: IWeeklyHarvestPlan;
  canEditActual: boolean;
  onActualSave: (row: IWeeklyHarvestPlan, day: Day, value: number | null) => void;
  savingKey: string | null;
}

function ActualCell({ day, row, canEditActual, onActualSave, savingKey }: ActualCellProps) {
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

// ─── Main component ───────────────────────────────────────────────────────────

export default function WeeklyPlanGrid() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const [selectedWeek, setSelectedWeek] = useState<Dayjs | null>(dayjs());
  const [transposed, setTransposed] = useState(() => localStorage.getItem('plan_pivot') === '1');
  const [rejectModalPlan, setRejectModalPlan] = useState<IWeeklyHarvestPlan | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [savingActualKey, setSavingActualKey] = useState<string | null>(null);

  const weekNumber = selectedWeek?.isoWeek();
  const year = selectedWeek?.isoWeekYear();

  const { data: seasonsData } = useSeasons();
  const activeSeason = seasonsData?.find((s) => s.is_active);

  const { data, isLoading, isError } = useHarvestPlans({ year, week: weekNumber });
  const upsert = useUpsertHarvestPlan();
  const initWeek = useInitializeWeek();
  const bulkSubmit = useBulkSubmitHarvestPlans();
  const bulkApprove = useBulkApproveHarvestPlans();
  const bulkReject = useBulkRejectHarvestPlans();
  const { data: truckData } = useTruckAllocations({
    season: activeSeason?.id, year, week_number: weekNumber,
  });
  const { data: destinations = [] } = useTruckDestinations();
  const upsertTruck = useUpsertTruckAllocation();
  const setTruckSplits = useSetTruckSplits();
  const truckAllocations: IWeeklyTruckAllocation[] = truckData?.results ?? [];

  const myBlockIds = new Set(user?.managed_block_ids ?? []);
  const isBlockManager = user?.role === 'greenhouse_manager' && myBlockIds.size > 0;

  // Sort: greenhouse_manager's blocks first, then the rest
  const plans: IWeeklyHarvestPlan[] = (() => {
    const raw = data?.results ?? [];
    if (!isBlockManager) return raw;
    const mine = raw.filter((p) => myBlockIds.has(p.block));
    const rest = raw.filter((p) => !myBlockIds.has(p.block));
    return [...mine, ...rest];
  })();

  const todayWeekday = dayjs().isoWeekday(); // 1=Mon .. 7=Sun
  const currentIsoWeek = dayjs().isoWeek();
  const currentIsoYear = dayjs().isoWeekYear();
  const isCurrentOrFutureWeek = (year ?? 0) > currentIsoYear ||
    ((year ?? 0) === currentIsoYear && (weekNumber ?? 0) >= currentIsoWeek);

  // ─── Derived state ────────────────────────────────────────────────────────

  const statusCounts = plans.reduce(
    (acc, p) => {
      acc[p.status] = (acc[p.status] || 0) + 1;
      return acc;
    },
    {} as Record<PlanStatus, number>,
  );

  const allDraftIds = plans
    .filter((p) => (p.status === 'draft' || p.status === 'rejected') && hasBlockPermission(p))
    .map((p) => p.id);
  const allSubmittedIds = plans
    .filter((p) => p.status === 'submitted')
    .map((p) => p.id);

  const isManager = user && (user.role === 'director' || user.role === 'export_manager');

  // ─── Summary stats ────────────────────────────────────────────────────────

  const totalPlanKg = plans.reduce((s, r) => s + num(r.total_plan_kg), 0);
  const totalActualKg = plans.reduce((s, r) => s + num(r.total_actual_kg), 0);
  const deficitKg = totalActualKg - totalPlanKg;
  const truckCount = totalPlanKg > 0 ? (totalPlanKg / 18500).toFixed(1) : '0';

  // ─── Permission checks ────────────────────────────────────────────────────

  function hasBlockPermission(row: IWeeklyHarvestPlan): boolean {
    if (!user) return false;
    if (user.role === 'director' || user.role === 'export_manager') return true;
    if (user.role === 'greenhouse_manager') return user.managed_block_ids.includes(row.block);
    return false;
  }

  function canEditPlan(row: IWeeklyHarvestPlan): boolean {
    return (row.status === 'draft' || row.status === 'rejected') && hasBlockPermission(row);
  }

  function canEditActualForDay(row: IWeeklyHarvestPlan, day: Day): boolean {
    if (row.status !== 'approved') return false;
    if (!hasBlockPermission(row)) return false;
    return DAY_INDEX[day] <= todayWeekday;
  }

  // ─── Handlers ─────────────────────────────────────────────────────────────

  function handlePlanSave(row: IWeeklyHarvestPlan, day: Day, value: number) {
    const field = `${day}_plan_kg`;
    upsert.mutate({ id: row.id, [field]: value });
  }

  function handleActualSave(row: IWeeklyHarvestPlan, day: Day, value: number | null) {
    const key = `${row.id}_${day}`;
    setSavingActualKey(key);
    const field = `${day}_actual_kg`;
    upsert.mutate(
      { id: row.id, [field]: value },
      {
        onSuccess: () => {
          message.success(t('plan.toast_actual_saved'));
          setSavingActualKey(null);
        },
        onError: () => setSavingActualKey(null),
      },
    );
  }

  function handleBulkSubmit() {
    if (!allDraftIds.length) return;
    bulkSubmit.mutate(allDraftIds, {
      onSuccess: (result) => {
        message.success(`${result.submitted.length} ${t('plan.toast_submitted')}`);
      },
    });
  }

  function handleBulkApprove() {
    if (!allSubmittedIds.length) return;
    bulkApprove.mutate(allSubmittedIds, {
      onSuccess: (result) => {
        message.success(`${result.approved.length} ${t('plan.toast_approved')}`);
      },
    });
  }

  function handleBulkReject() {
    if (!allSubmittedIds.length) return;
    setRejectModalPlan(plans.find((p) => p.status === 'submitted') ?? null);
    setRejectNote('');
  }

  function handleRejectConfirm() {
    if (!rejectNote.trim() || !allSubmittedIds.length) return;
    bulkReject.mutate(
      { ids: allSubmittedIds, rejection_note: rejectNote.trim() },
      {
        onSuccess: (result) => {
          message.success(`${result.rejected.length} ${t('plan.toast_rejected')}`);
          setRejectModalPlan(null);
          setRejectNote('');
        },
      },
    );
  }

  function handleInitializeWeek() {
    if (!activeSeason || !weekNumber || !year) return;
    initWeek.mutate(
      { season: activeSeason.id, week_number: weekNumber, year },
      { onSuccess: () => message.success(t('plan.toast_initialized')) },
    );
  }

  // ─── Column definitions ────────────────────────────────────────────────────

  // Monday of the selected week
  const weekMonday = selectedWeek ? selectedWeek.isoWeekday(1) : dayjs().isoWeekday(1);

  const dayColumns = DAYS.map((day, di) => ({
    title: (
      <div style={{ textAlign: 'center', lineHeight: '16px' }}>
        <div>{t(`plan.${day}`)}</div>
        <div style={{ fontSize: 10, color: '#8c8c8c', fontWeight: 400 }}>
          {weekMonday.add(di, 'day').format('DD.MM')}
        </div>
      </div>
    ),
    children: [
      {
        title: <span style={{ color: '#1677ff', fontSize: 11 }}>{t('plan.plan')}</span>,
        key: `${day}_plan`,
        width: 90,
        render: (_: unknown, row: IWeeklyHarvestPlan) => (
          <PlanCell
            day={day}
            row={row}
            editable={canEditPlan(row)}
            onSave={handlePlanSave}
          />
        ),
      },
      {
        title: <span style={{ color: '#52c41a', fontSize: 11 }}>{t('plan.actual')}</span>,
        key: `${day}_actual`,
        width: 90,
        render: (_: unknown, row: IWeeklyHarvestPlan) => (
          <ActualCell
            day={day}
            row={row}
            canEditActual={canEditActualForDay(row, day)}
            onActualSave={handleActualSave}
            savingKey={savingActualKey}
          />
        ),
      },
    ],
  }));

  const columns: TableColumnsType<IWeeklyHarvestPlan> = [
    {
      title: t('plan.block'),
      key: 'block',
      fixed: 'left',
      width: 120,
      render: (_: unknown, row: IWeeklyHarvestPlan) => (
        <div>
          <Tag color="blue">{row.block_code}</Tag>
          <div style={{ color: '#8c8c8c', fontSize: 11, marginTop: 2 }}>{row.block_name}</div>
        </div>
      ),
    },
    ...dayColumns,
    {
      title: t('plan.total'),
      key: 'total',
      width: 110,
      render: (_: unknown, row: IWeeklyHarvestPlan) => (
        <div>
          <div style={{ color: '#1677ff', fontSize: 13 }}>{fmtKg(row.total_plan_kg)}</div>
          {row.total_actual_kg != null && (
            <div style={{ color: '#52c41a', fontSize: 13 }}>{fmtKg(row.total_actual_kg)}</div>
          )}
        </div>
      ),
    },
    ...(isCurrentOrFutureWeek ? [{
      title: t('plan.status'),
      key: 'status',
      fixed: 'right' as const,
      width: 100,
      render: (_: unknown, row: IWeeklyHarvestPlan) => {
        const cfg = STATUS_TAG[row.status];
        const tag = (
          <Tag color={cfg.color} icon={cfg.icon}>
            {t(`plan.status_${row.status}`)}
          </Tag>
        );
        if (row.status === 'rejected' && row.rejection_note) {
          return (
            <Tooltip title={row.rejection_note} color="#ff4d4f">
              {tag}
            </Tooltip>
          );
        }
        return tag;
      },
    }] : []),
  ];

  // ─── Transposed view (days = rows, blocks = columns) ────────────────────

  interface ITransposedRow {
    key: string;
    day: Day;
    dayLabel: string;
    [blockField: string]: string | number | null | Day;
  }

  const transposedData: ITransposedRow[] = DAYS.map((day, di) => {
    const dateStr = weekMonday.add(di, 'day').format('DD.MM');
    const row: ITransposedRow = { key: day, day, dayLabel: `${t(`plan.${day}`)} ${dateStr}` };
    plans.forEach((p) => {
      row[`${p.block_code}_plan`] = num(p[`${day}_plan_kg` as keyof IWeeklyHarvestPlan]);
      row[`${p.block_code}_actual`] = p[`${day}_actual_kg` as keyof IWeeklyHarvestPlan] != null
        ? num(p[`${day}_actual_kg` as keyof IWeeklyHarvestPlan]) : null;
    });
    // Day totals
    row._totalPlan = plans.reduce(
      (s, p) => s + num(p[`${day}_plan_kg` as keyof IWeeklyHarvestPlan]), 0,
    );
    row._totalActual = plans.reduce(
      (s, p) => s + num(p[`${day}_actual_kg` as keyof IWeeklyHarvestPlan]), 0,
    );
    return row;
  });

  const transposedColumns: TableColumnsType<ITransposedRow> = [
    {
      title: '',
      dataIndex: 'dayLabel',
      key: 'day',
      fixed: 'left',
      width: 70,
      render: (text: string) => <strong>{text}</strong>,
    },
    {
      title: '',
      key: 'label',
      fixed: 'left',
      width: 55,
      render: () => (
        <div style={{ lineHeight: '22px', fontSize: 11, fontWeight: 500 }}>
          <div style={{ color: '#1677ff' }}>{t('plan.plan')}</div>
          <div style={{ borderTop: '1px dashed #f0f0f0', marginTop: 2, paddingTop: 2, color: '#52c41a' }}>
            {t('plan.actual')}
          </div>
        </div>
      ),
    },
    ...plans.map((p) => {
      const isMine = isBlockManager && myBlockIds.has(p.block);
      return {
      title: (
        <div style={{ textAlign: 'center' as const }}>
          <Tag color={isMine ? 'gold' : 'blue'}>{p.block_code}</Tag>
        </div>
      ),
      key: p.block_code,
      width: 100,
      onCell: () => ({
        style: isMine ? { backgroundColor: '#fffbe6' } : undefined,
      }),
      onHeaderCell: () => ({
        style: isMine ? { backgroundColor: '#fffbe6' } : undefined,
      }),
      render: (_: unknown, row: ITransposedRow) => {
        const planVal = row[`${p.block_code}_plan`] as number;
        const actual = row[`${p.block_code}_actual`] as number | null;
        const isPlanEditable = canEditPlan(p);
        const isActualEditable = canEditActualForDay(p, row.day);

        const planEl = isPlanEditable ? (
          <InputNumber
            min={0}
            step={100}
            keyboard={false}
            defaultValue={planVal}
            onBlur={(e) => {
              const v = Number(e.target.value) || 0;
              if (v !== planVal) handlePlanSave(p, row.day, v);
            }}
            onKeyDown={handleCellKeyDown}
            size="small"
            style={{ width: 84 }}
          />
        ) : (
          <span style={{ color: '#1677ff' }}>{fmtKg(planVal)}</span>
        );

        const actualEl = isActualEditable ? (
          <InputNumber
            min={0}
            step={100}
            keyboard={false}
            defaultValue={actual ?? undefined}
            placeholder="—"
            onBlur={(e) => {
              const raw = e.target.value;
              const v = raw === '' ? null : Number(raw) || 0;
              if (v !== actual) handleActualSave(p, row.day, v);
            }}
            onKeyDown={handleCellKeyDown}
            size="small"
            style={{ width: 84 }}
          />
        ) : actual != null ? (
          <span style={{ color: '#52c41a' }}>{fmtKg(actual)}</span>
        ) : (
          <span style={{ color: '#bfbfbf' }}>—</span>
        );

        return (
          <div style={{ lineHeight: '22px' }}>
            <div>{planEl}</div>
            <div style={{ borderTop: '1px dashed #f0f0f0', marginTop: 2, paddingTop: 2 }}>
              {actualEl}
            </div>
          </div>
        );
      },
    };}),
  ];

  function renderTransposedSummary() {
    return (
      <>
        <Table.Summary.Row style={{ fontWeight: 600 }}>
          <Table.Summary.Cell index={0} colSpan={2}>
            <span style={{ color: '#1677ff' }}>{t('plan.total')} {t('plan.plan')}</span>
          </Table.Summary.Cell>
          {plans.map((p, i) => (
            <Table.Summary.Cell key={`tp_${p.id}`} index={2 + i}>
              <span style={{ color: '#1677ff' }}>{fmtKg(p.total_plan_kg)}</span>
            </Table.Summary.Cell>
          ))}
        </Table.Summary.Row>
        <Table.Summary.Row style={{ fontWeight: 600 }}>
          <Table.Summary.Cell index={0} colSpan={2}>
            <span style={{ color: '#52c41a' }}>{t('plan.total')} {t('plan.actual')}</span>
          </Table.Summary.Cell>
          {plans.map((p, i) => (
            <Table.Summary.Cell key={`ta_${p.id}`} index={2 + i}>
              <span style={{ color: '#52c41a' }}>{fmtKg(p.total_actual_kg)}</span>
            </Table.Summary.Cell>
          ))}
        </Table.Summary.Row>
      </>
    );
  }

  // ─── Summary row ──────────────────────────────────────────────────────────

  function renderSummary() {
    return (
      <Table.Summary.Row style={{ fontWeight: 600 }}>
        <Table.Summary.Cell index={0}>{t('plan.total')}</Table.Summary.Cell>
        {DAYS.flatMap((day, di) => {
          const planTotal = plans.reduce(
            (s, r) => s + num(r[`${day}_plan_kg` as keyof IWeeklyHarvestPlan]),
            0,
          );
          const actualTotal = plans.reduce(
            (s, r) => s + num(r[`${day}_actual_kg` as keyof IWeeklyHarvestPlan]),
            0,
          );
          return [
            <Table.Summary.Cell key={`sp_${di}`} index={1 + di * 2}>
              <span style={{ color: '#1677ff' }}>{fmtKg(planTotal)}</span>
            </Table.Summary.Cell>,
            <Table.Summary.Cell key={`sa_${di}`} index={2 + di * 2}>
              <span style={{ color: '#52c41a' }}>{fmtKg(actualTotal || null)}</span>
            </Table.Summary.Cell>,
          ];
        })}
        <Table.Summary.Cell index={13}>
          <div style={{ color: '#1677ff' }}>
            {fmtKg(plans.reduce((s, r) => s + num(r.total_plan_kg), 0))}
          </div>
          <div style={{ color: '#52c41a' }}>
            {fmtKg(plans.reduce((s, r) => s + num(r.total_actual_kg), 0) || null)}
          </div>
        </Table.Summary.Cell>
        <Table.Summary.Cell index={14} />
      </Table.Summary.Row>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const showInitialize = plans.length === 0 && !isLoading && isManager && activeSeason;

  return (
    <div>
      <Flex justify="space-between" align="flex-start" style={{ marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            {t('plan.title')}
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {t('plan.week')} {weekNumber} · {year} · {plans.length} {t('plan.blocks')}
            {activeSeason && <span> · {activeSeason.name}</span>}
          </Text>
        </div>
        <Space>
          <Button
            icon={<LeftOutlined />}
            onClick={() => setSelectedWeek((w) => (w ?? dayjs()).subtract(1, 'week'))}
          />
          <DatePicker
            picker="week"
            value={selectedWeek}
            onChange={(d) => setSelectedWeek(d)}
            allowClear={false}
            style={{ width: 180 }}
          />
          <Button
            icon={<RightOutlined />}
            onClick={() => setSelectedWeek((w) => (w ?? dayjs()).add(1, 'week'))}
          />
          {plans.length > 0 && (
            <Button
              icon={<SwapOutlined />}
              onClick={() => setTransposed((v) => { const next = !v; localStorage.setItem('plan_pivot', next ? '1' : '0'); return next; })}
              type={transposed ? 'primary' : 'default'}
            >
              {t('plan.pivot')}
            </Button>
          )}
          {showInitialize && (
            <Button type="primary" loading={initWeek.isPending} onClick={handleInitializeWeek}>
              {t('plan.initialize_week')}
            </Button>
          )}
        </Space>
      </Flex>

      {/* Stat cards */}
      {plans.length > 0 && (
        <Flex gap={12} style={{ marginBottom: 16 }}>
          <Card size="small" style={{ flex: 1 }}>
            <Statistic
              title={t('plan.total_plan')}
              value={totalPlanKg}
              suffix="kg"
              valueStyle={{ color: '#1677ff', fontSize: 20 }}
              formatter={(v) => Number(v).toLocaleString()}
            />
          </Card>
          <Card size="small" style={{ flex: 1 }}>
            <Statistic
              title={t('plan.total_actual')}
              value={totalActualKg}
              suffix="kg"
              valueStyle={{ color: '#52c41a', fontSize: 20 }}
              formatter={(v) => Number(v).toLocaleString()}
            />
          </Card>
          <Card size="small" style={{ flex: 1 }}>
            <Statistic
              title={t('plan.deficit')}
              value={deficitKg}
              suffix="kg"
              valueStyle={{ color: deficitKg >= 0 ? '#52c41a' : '#ff4d4f', fontSize: 20 }}
              prefix={deficitKg >= 0 ? '+' : ''}
              formatter={(v) => Number(v).toLocaleString()}
            />
          </Card>
          <Card size="small" style={{ flex: 1 }}>
            <Statistic
              title={t('plan.est_trucks')}
              value={truckCount}
              valueStyle={{ color: '#722ed1', fontSize: 20 }}
              suffix={t('plan.trucks_suffix')}
            />
          </Card>
        </Flex>
      )}

      {/* Status summary + toolbar — only for current/future weeks */}
      {isCurrentOrFutureWeek && (
        <Flex justify="space-between" align="center" style={{ marginBottom: 12 }}>
          <Flex gap={8}>
            {(['approved', 'submitted', 'draft', 'rejected'] as PlanStatus[]).map((s) =>
              statusCounts[s] ? (
                <Tag key={s} color={STATUS_TAG[s].color} icon={STATUS_TAG[s].icon}>
                  {statusCounts[s]} {t(`plan.status_${s}`)}
                </Tag>
              ) : null,
            )}
          </Flex>
          <Space>
            {allDraftIds.length > 0 && (
              <Button type="primary" ghost loading={bulkSubmit.isPending} onClick={handleBulkSubmit}>
                {t('plan.submit')} ({allDraftIds.length})
              </Button>
            )}
            {isManager && allSubmittedIds.length > 0 && (
              <Button type="primary" loading={bulkApprove.isPending} onClick={handleBulkApprove}>
                {t('plan.bulk_approve')} ({allSubmittedIds.length})
              </Button>
            )}
            {isManager && allSubmittedIds.length > 0 && (
              <Button danger loading={bulkReject.isPending} onClick={handleBulkReject}>
                {t('plan.reject')} ({allSubmittedIds.length})
              </Button>
            )}
          </Space>
        </Flex>
      )}

      {isError && (
        <Alert type="error" message={t('plan.error_load')} style={{ marginBottom: 16 }} />
      )}

      {isLoading ? (
        <Skeleton active />
      ) : plans.length === 0 && !showInitialize ? (
        <Alert type="info" message={t('plan.empty_week')} style={{ marginBottom: 16 }} />
      ) : transposed ? (
        <Table<ITransposedRow>
          columns={transposedColumns}
          dataSource={transposedData}
          rowKey="key"
          bordered
          size="small"
          scroll={{ x: 'max-content' }}
          pagination={false}
          summary={renderTransposedSummary}
        />
      ) : (
        <Table<IWeeklyHarvestPlan>
          columns={columns}
          dataSource={plans}
          rowKey="id"
          bordered
          size="small"
          scroll={{ x: 'max-content' }}
          pagination={false}
          summary={renderSummary}
          onRow={(row) => ({
            style: {
              backgroundColor: isBlockManager && myBlockIds.has(row.block)
                ? '#fffbe6'
                : ROW_BG[row.status] || undefined,
              boxShadow: isBlockManager && myBlockIds.has(row.block)
                ? 'inset 3px 0 0 #faad14'
                : undefined,
            },
          })}
        />
      )}

      {/* Truck allocation section */}
      {plans.length > 0 && destinations.length > 0 && (
        <Collapse
          defaultActiveKey={['trucks']}
          style={{ marginTop: 16 }}
          items={[{
            key: 'trucks',
            label: <strong>{t('plan.truck_allocation')}</strong>,
            children: (() => {
              // Build truck data per day
              const truckByDay = new Map(truckAllocations.map((a) => [a.day_of_week, a]));

              const truckRows = [
                // Total KG row
                { key: 'total_kg', label: t('plan.total_kg'), type: 'computed' as const },
                // Total Trucks row
                { key: 'total_trucks', label: t('plan.total_trucks_label'), type: 'computed' as const },
                // Dynamic destination rows
                ...destinations.map((d) => ({
                  key: `dest_${d.id}`,
                  label: d.name,
                  type: 'editable' as const,
                  destId: d.id,
                })),
              ];

              const handleTruckSave = (dayOfWeek: number, destId: number, value: number) => {
                const allocation = truckByDay.get(dayOfWeek);
                if (allocation) {
                  setTruckSplits.mutate({
                    allocationId: allocation.id,
                    splits: [{ destination_id: destId, truck_count: value }],
                  });
                } else if (activeSeason) {
                  // Create allocation first, then set split
                  upsertTruck.mutate(
                    { season: activeSeason.id, week_number: weekNumber!, year: year!, day_of_week: dayOfWeek, total_planned_kg: null },
                    {
                      onSuccess: (newAlloc) => {
                        setTruckSplits.mutate({
                          allocationId: newAlloc.id,
                          splits: [{ destination_id: destId, truck_count: value }],
                        });
                      },
                    },
                  );
                }
              };

              const truckColumns = [
                {
                  title: '',
                  dataIndex: 'label',
                  key: 'label',
                  width: 120,
                  fixed: 'left' as const,
                  render: (text: string) => <strong>{text}</strong>,
                },
                ...DAYS.map((day, di) => ({
                  title: (
                    <div style={{ textAlign: 'center', lineHeight: '16px' }}>
                      <div>{t(`plan.${day}`)}</div>
                      <div style={{ fontSize: 10, color: '#8c8c8c', fontWeight: 400 }}>
                        {weekMonday.add(di, 'day').format('DD.MM')}
                      </div>
                    </div>
                  ),
                  key: day,
                  width: 90,
                  render: (_: unknown, row: (typeof truckRows)[number]) => {
                    const dayOfWeek = di + 1;
                    const allocation = truckByDay.get(dayOfWeek);

                    if (row.type === 'computed') {
                      if (row.key === 'total_kg') {
                        const dayTotal = plans.reduce(
                          (s, p) => s + num(p[`${day}_plan_kg` as keyof IWeeklyHarvestPlan]), 0,
                        );
                        return <strong style={{ color: '#1677ff' }}>{fmtKg(dayTotal)}</strong>;
                      }
                      // total_trucks
                      const dayTotal = plans.reduce(
                        (s, p) => s + num(p[`${day}_plan_kg` as keyof IWeeklyHarvestPlan]), 0,
                      );
                      const trucks = dayTotal > 0 ? Math.round(dayTotal / 18500) : 0;
                      return <strong>{trucks}</strong>;
                    }

                    // Editable destination row
                    const destId = (row as { destId: number }).destId;
                    const split = allocation?.destination_splits?.find((s) => s.destination === destId);
                    const currentVal = split?.truck_count ?? 0;

                    if (isManager) {
                      return (
                        <InputNumber
                          min={0}
                          keyboard={false}
                          defaultValue={currentVal}
                          onBlur={(e) => {
                            const v = Number(e.target.value.replace(/,/g, '')) || 0;
                            if (v !== currentVal) handleTruckSave(dayOfWeek, destId, v);
                          }}
                          onKeyDown={handleCellKeyDown}
                          size="small"
                          style={{ width: 70 }}
                        />
                      );
                    }
                    return currentVal > 0 ? currentVal : <span style={{ color: '#bfbfbf' }}>—</span>;
                  },
                })),
                {
                  title: t('plan.total'),
                  key: 'row_total',
                  width: 80,
                  render: (_: unknown, row: (typeof truckRows)[number]) => {
                    if (row.key === 'total_kg') {
                      return <strong style={{ color: '#1677ff' }}>{fmtKg(totalPlanKg)}</strong>;
                    }
                    if (row.key === 'total_trucks') {
                      return <strong>{totalPlanKg > 0 ? Math.round(totalPlanKg / 18500) : 0}</strong>;
                    }
                    const destId = (row as { destId: number }).destId;
                    const total = truckAllocations.reduce((s, a) => {
                      const split = a.destination_splits?.find((sp) => sp.destination === destId);
                      return s + (split?.truck_count ?? 0);
                    }, 0);
                    return <strong>{total}</strong>;
                  },
                },
              ];

              return (
                <Table
                  columns={truckColumns}
                  dataSource={truckRows}
                  rowKey="key"
                  bordered
                  size="small"
                  pagination={false}
                  scroll={{ x: 'max-content' }}
                  rowClassName={(row) =>
                    row.type === 'computed' ? '' : ''
                  }
                  onRow={(row) => ({
                    style: row.type === 'editable'
                      ? { backgroundColor: '#fff7e6' }
                      : { backgroundColor: '#fafafa' },
                  })}
                />
              );
            })(),
          }]}
        />
      )}

      {/* Reject modal */}
      <Modal
        title={t('plan.reject_modal_title')}
        open={!!rejectModalPlan}
        onCancel={() => {
          setRejectModalPlan(null);
          setRejectNote('');
        }}
        onOk={handleRejectConfirm}
        okText={t('plan.reject')}
        okButtonProps={{
          danger: true,
          disabled: !rejectNote.trim(),
          loading: bulkReject.isPending,
        }}
        destroyOnClose
      >
        <div style={{ marginBottom: 12 }}>
          <Text>{allSubmittedIds.length} {t('plan.blocks')}</Text>
        </div>
        <div style={{ marginBottom: 4 }}>
          <Text strong>{t('plan.reject_note_label')}</Text>
        </div>
        <TextArea
          rows={3}
          value={rejectNote}
          onChange={(e) => setRejectNote(e.target.value)}
          placeholder={t('plan.reject_note_required')}
        />
      </Modal>
    </div>
  );
}
