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
  Statistic,
  message,
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  EditOutlined,
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
  useSubmitHarvestPlan,
  useRejectHarvestPlan,
  useBulkApproveHarvestPlans,
} from '@/hooks/usePlanning';
import { useSeasons } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import type { IWeeklyHarvestPlan, PlanStatus } from '@/types';

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

function fmtKg(val: number | null | undefined): string {
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
  const value = row[field] as number;

  if (editable) {
    return (
      <InputNumber
        min={0}
        step={100}
        keyboard={false}
        defaultValue={value}
        onBlur={(e) => {
          const v = Number(e.target.value) || 0;
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
  const plan = row[planField] as number;
  const actual = row[actualField] as number | null;
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
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
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
  const submitPlan = useSubmitHarvestPlan();
  const rejectPlan = useRejectHarvestPlan();
  const bulkApprove = useBulkApproveHarvestPlans();

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

  // ─── Derived state ────────────────────────────────────────────────────────

  const statusCounts = plans.reduce(
    (acc, p) => {
      acc[p.status] = (acc[p.status] || 0) + 1;
      return acc;
    },
    {} as Record<PlanStatus, number>,
  );

  const selectedPlans = plans.filter((p) => selectedRowKeys.includes(p.id));
  const selectedDraftIds = selectedPlans
    .filter((p) => p.status === 'draft' || p.status === 'rejected')
    .map((p) => p.id);
  const selectedSubmittedIds = selectedPlans
    .filter((p) => p.status === 'submitted')
    .map((p) => p.id);

  const isManager = user && (user.role === 'director' || user.role === 'export_manager');

  // ─── Summary stats ────────────────────────────────────────────────────────

  const totalPlanKg = plans.reduce((s, r) => s + (r.total_plan_kg ?? 0), 0);
  const totalActualKg = plans.reduce((s, r) => s + (r.total_actual_kg ?? 0), 0);
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
    upsert.mutate({
      id: row.id, season: row.season, block: row.block,
      week_number: weekNumber, year, [field]: value,
    });
  }

  function handleActualSave(row: IWeeklyHarvestPlan, day: Day, value: number | null) {
    const key = `${row.id}_${day}`;
    setSavingActualKey(key);
    const field = `${day}_actual_kg`;
    upsert.mutate(
      { id: row.id, season: row.season, block: row.block, week_number: weekNumber, year, [field]: value },
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
    if (!selectedDraftIds.length) return;
    let completed = 0;
    selectedDraftIds.forEach((id) => {
      submitPlan.mutate(id, {
        onSuccess: () => {
          completed += 1;
          if (completed === selectedDraftIds.length) {
            message.success(`${completed} ${t('plan.toast_submitted')}`);
            setSelectedRowKeys([]);
          }
        },
      });
    });
  }

  function handleBulkApprove() {
    const ids = selectedSubmittedIds.length > 0 ? selectedSubmittedIds
      : plans.filter((p) => p.status === 'submitted').map((p) => p.id);
    if (!ids.length) return;
    bulkApprove.mutate(ids, {
      onSuccess: (result) => {
        message.success(`${result.approved.length} ${t('plan.toast_approved')}`);
        setSelectedRowKeys([]);
      },
    });
  }

  function handleBulkReject() {
    if (selectedSubmittedIds.length === 1) {
      // Single selection — open modal for that plan
      const plan = plans.find((p) => p.id === selectedSubmittedIds[0]);
      if (plan) {
        setRejectModalPlan(plan);
        setRejectNote('');
      }
    } else if (selectedSubmittedIds.length > 1) {
      // Multiple — open modal, rejection note applies to all
      const plan = plans.find((p) => p.id === selectedSubmittedIds[0]);
      if (plan) {
        setRejectModalPlan(plan);
        setRejectNote('');
      }
    }
  }

  function handleRejectConfirm() {
    if (!rejectNote.trim()) return;
    const ids = selectedSubmittedIds.length > 0 ? selectedSubmittedIds
      : rejectModalPlan ? [rejectModalPlan.id] : [];
    let completed = 0;
    ids.forEach((id) => {
      rejectPlan.mutate(
        { id, rejection_note: rejectNote.trim() },
        {
          onSuccess: () => {
            completed += 1;
            if (completed === ids.length) {
              message.success(`${completed} ${t('plan.toast_rejected')}`);
              setRejectModalPlan(null);
              setRejectNote('');
              setSelectedRowKeys([]);
            }
          },
        },
      );
    });
  }

  function handleInitializeWeek() {
    if (!activeSeason || !weekNumber || !year) return;
    initWeek.mutate(
      { season: activeSeason.id, week_number: weekNumber, year },
      { onSuccess: () => message.success(t('plan.toast_initialized')) },
    );
  }

  // ─── Column definitions ────────────────────────────────────────────────────

  const dayColumns = DAYS.map((day) => ({
    title: t(`plan.${day}`),
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
            <div style={{ color: '#52c41a', fontSize: 11 }}>{fmtKg(row.total_actual_kg)}</div>
          )}
        </div>
      ),
    },
    {
      title: t('plan.status'),
      key: 'status',
      fixed: 'right',
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
    },
  ];

  // ─── Transposed view (days = rows, blocks = columns) ────────────────────

  interface ITransposedRow {
    key: string;
    day: Day;
    dayLabel: string;
    [blockField: string]: string | number | null | Day;
  }

  const transposedData: ITransposedRow[] = DAYS.map((day) => {
    const row: ITransposedRow = { key: day, day, dayLabel: t(`plan.${day}`) };
    plans.forEach((p) => {
      row[`${p.block_code}_plan`] = p[`${day}_plan_kg` as keyof IWeeklyHarvestPlan] as number;
      row[`${p.block_code}_actual`] = p[`${day}_actual_kg` as keyof IWeeklyHarvestPlan] as number | null;
    });
    // Day totals
    row._totalPlan = plans.reduce(
      (s, p) => s + ((p[`${day}_plan_kg` as keyof IWeeklyHarvestPlan] as number) ?? 0), 0,
    );
    row._totalActual = plans.reduce(
      (s, p) => s + ((p[`${day}_actual_kg` as keyof IWeeklyHarvestPlan] as number) ?? 0), 0,
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
        <Table.Summary.Cell index={0} />
        <Table.Summary.Cell index={1}>{t('plan.total')}</Table.Summary.Cell>
        {DAYS.flatMap((day, di) => {
          const planTotal = plans.reduce(
            (s, r) => s + ((r[`${day}_plan_kg` as keyof IWeeklyHarvestPlan] as number) ?? 0),
            0,
          );
          const actualTotal = plans.reduce(
            (s, r) => s + ((r[`${day}_actual_kg` as keyof IWeeklyHarvestPlan] as number) ?? 0),
            0,
          );
          return [
            <Table.Summary.Cell key={`sp_${di}`} index={2 + di * 2}>
              <span style={{ color: '#1677ff' }}>{fmtKg(planTotal)}</span>
            </Table.Summary.Cell>,
            <Table.Summary.Cell key={`sa_${di}`} index={3 + di * 2}>
              <span style={{ color: '#52c41a' }}>{fmtKg(actualTotal || null)}</span>
            </Table.Summary.Cell>,
          ];
        })}
        <Table.Summary.Cell index={14}>
          <div style={{ color: '#1677ff' }}>
            {fmtKg(plans.reduce((s, r) => s + (r.total_plan_kg ?? 0), 0))}
          </div>
          <div style={{ color: '#52c41a', fontSize: 11 }}>
            {fmtKg(plans.reduce((s, r) => s + (r.total_actual_kg ?? 0), 0) || null)}
          </div>
        </Table.Summary.Cell>
        <Table.Summary.Cell index={15} />
      </Table.Summary.Row>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const showInitialize = plans.length === 0 && !isLoading && isManager && activeSeason;
  const allSubmittedIds = plans.filter((p) => p.status === 'submitted').map((p) => p.id);

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
          <DatePicker
            picker="week"
            value={selectedWeek}
            onChange={(d) => setSelectedWeek(d)}
            allowClear={false}
            style={{ width: 180 }}
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

      {/* Status summary + toolbar */}
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
          {selectedDraftIds.length > 0 && (
            <Button type="primary" ghost loading={submitPlan.isPending} onClick={handleBulkSubmit}>
              {t('plan.submit')} ({selectedDraftIds.length})
            </Button>
          )}
          {isManager && (selectedSubmittedIds.length > 0 || allSubmittedIds.length > 0) && (
            <Button
              type="primary"
              loading={bulkApprove.isPending}
              onClick={handleBulkApprove}
            >
              {t('plan.bulk_approve')} ({selectedSubmittedIds.length || allSubmittedIds.length})
            </Button>
          )}
          {isManager && selectedSubmittedIds.length > 0 && (
            <Button danger onClick={handleBulkReject}>
              {t('plan.reject')} ({selectedSubmittedIds.length})
            </Button>
          )}
        </Space>
      </Flex>

      {isError && (
        <Alert type="error" message={t('plan.error_load')} style={{ marginBottom: 16 }} />
      )}

      {isLoading ? (
        <Skeleton active />
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
          rowSelection={{
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys),
          }}
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
          loading: rejectPlan.isPending,
        }}
        destroyOnClose
      >
        {rejectModalPlan && (
          <div style={{ marginBottom: 12 }}>
            {selectedSubmittedIds.length > 1 ? (
              <Text>{selectedSubmittedIds.length} {t('plan.blocks')}</Text>
            ) : (
              <>
                <Tag color="blue">{rejectModalPlan.block_code}</Tag>
                <Text>
                  {t('plan.week')} {rejectModalPlan.week_number} / {rejectModalPlan.year}
                </Text>
              </>
            )}
          </div>
        )}
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
