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
} from 'antd';
import type { TableColumnsType } from 'antd';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import { useHarvestPlans, useUpsertHarvestPlan } from '@/hooks/usePlanning';
import { useAuth } from '@/hooks/useAuth';
import type { IWeeklyHarvestPlan } from '@/types';

dayjs.extend(isoWeek);
dayjs.extend(weekOfYear);

const { Title, Text } = Typography;

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
type Day = typeof DAYS[number];

function fmtKg(val: number | null | undefined): string {
  if (val == null) return '—';
  return Number(val).toLocaleString();
}

// ─── Sub-components ──────────────────────────────────────────────────────────

interface PlanCellProps {
  day: Day;
  row: IWeeklyHarvestPlan;
  editingId: number | null;
  editValues: Record<string, number>;
  onEditValuesChange: (values: Record<string, number>) => void;
}

function PlanCell({ day, row, editingId, editValues, onEditValuesChange }: PlanCellProps) {
  const field = `${day}_plan_kg` as keyof IWeeklyHarvestPlan;
  if (row.id === editingId) {
    return (
      <InputNumber
        min={0}
        step={100}
        value={editValues[field] ?? (row[field] as number)}
        onChange={(v) => onEditValuesChange({ ...editValues, [field]: v ?? 0 })}
        size="small"
        style={{ width: 84 }}
      />
    );
  }
  return <span>{fmtKg(row[field] as number | null)}</span>;
}

interface ActualCellProps {
  plan: number;
  actual: number | null;
}

function ActualCell({ plan, actual }: ActualCellProps) {
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
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<Record<string, number>>({});

  const weekNumber = selectedWeek?.isoWeek();
  const year = selectedWeek?.isoWeekYear();

  const { data, isLoading, isError } = useHarvestPlans({ year, week: weekNumber });
  const upsert = useUpsertHarvestPlan();
  const plans: IWeeklyHarvestPlan[] = data?.results ?? [];

  // ─── Permission check ──────────────────────────────────────────────────────

  function canEdit(row: IWeeklyHarvestPlan): boolean {
    if (!user) return false;
    if (user.role === 'director' || user.role === 'export_manager') return true;
    if (user.role === 'greenhouse_manager') return user.managed_block_ids.includes(row.block);
    return false;
  }

  // ─── Handlers ─────────────────────────────────────────────────────────────

  function handleEdit(row: IWeeklyHarvestPlan) {
    const initial: Record<string, number> = {};
    DAYS.forEach((d) => {
      const field = `${d}_plan_kg` as keyof IWeeklyHarvestPlan;
      initial[field] = (row[field] as number) ?? 0;
    });
    setEditingId(row.id);
    setEditValues(initial);
  }

  function handleCancel() {
    setEditingId(null);
    setEditValues({});
  }

  function handleSave(row: IWeeklyHarvestPlan) {
    upsert
      .mutate(
        {
          id: row.id,
          season: row.season,
          block: row.block,
          week_number: weekNumber,
          year,
          ...editValues,
        },
      );
    // optimistically reset edit state; invalidateQueries handles refresh
    handleCancel();
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
            editingId={editingId}
            editValues={editValues}
            onEditValuesChange={setEditValues}
          />
        ),
      },
      {
        title: <span style={{ color: '#52c41a', fontSize: 11 }}>{t('plan.actual')}</span>,
        key: `${day}_actual`,
        width: 90,
        render: (_: unknown, row: IWeeklyHarvestPlan) => (
          <ActualCell
            plan={row[`${day}_plan_kg` as keyof IWeeklyHarvestPlan] as number}
            actual={row[`${day}_actual_kg` as keyof IWeeklyHarvestPlan] as number | null}
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
      width: 140,
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
      title: '',
      key: 'actions',
      width: 70,
      render: (_: unknown, row: IWeeklyHarvestPlan) => {
        if (!canEdit(row)) return null;
        if (row.id === editingId) {
          return (
            <Space size={4} direction="vertical">
              <Button
                size="small"
                type="primary"
                loading={upsert.isPending}
                onClick={() => handleSave(row)}
              >
                {t('common.save')}
              </Button>
              <Button size="small" onClick={handleCancel}>
                {t('common.cancel')}
              </Button>
            </Space>
          );
        }
        return (
          <Button size="small" onClick={() => handleEdit(row)}>
            {t('common.edit')}
          </Button>
        );
      },
    },
  ];

  // ─── Summary row ──────────────────────────────────────────────────────────

  function renderSummary() {
    return (
      <Table.Summary.Row style={{ fontWeight: 600 }}>
        <Table.Summary.Cell index={0}>{t('plan.total')}</Table.Summary.Cell>
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
            {fmtKg(plans.reduce((s, r) => s + (r.total_plan_kg ?? 0), 0))}
          </div>
          <div style={{ color: '#52c41a', fontSize: 11 }}>
            {fmtKg(plans.reduce((s, r) => s + (r.total_actual_kg ?? 0), 0) || null)}
          </div>
        </Table.Summary.Cell>
        <Table.Summary.Cell index={14} />
      </Table.Summary.Row>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div>
      <Flex justify="space-between" align="flex-start" style={{ marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            {t('plan.title')}
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {t('plan.week')} {weekNumber} · {year} · {plans.length} {t('plan.blocks')}
          </Text>
        </div>
        <DatePicker
          picker="week"
          value={selectedWeek}
          onChange={(d) => setSelectedWeek(d)}
          allowClear={false}
          style={{ width: 180 }}
        />
      </Flex>

      {isError && (
        <Alert
          type="error"
          message={t('plan.error_load')}
          style={{ marginBottom: 16 }}
        />
      )}

      {isLoading ? (
        <Skeleton active />
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
        />
      )}
    </div>
  );
}
