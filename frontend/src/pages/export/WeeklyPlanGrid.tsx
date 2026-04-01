import { useState } from 'react';
import { DatePicker, Skeleton, Alert, Table, Tag, Space } from 'antd';
import { useTranslation } from 'react-i18next';
import dayjs, { type Dayjs } from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import { useHarvestPlans } from '@/hooks/usePlanning';
import type { IWeeklyHarvestPlan } from '@/types';
import type { ColumnsType } from 'antd/es/table';

dayjs.extend(isoWeek);
dayjs.extend(weekOfYear);

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

function fmtKg(val: number | null | undefined): string {
  if (val == null) return '—';
  return Number(val).toLocaleString();
}

function ActualCell({ plan, actual }: { plan: number; actual: number | null }) {
  if (actual == null) return <span style={{ color: '#bfbfbf' }}>—</span>;
  const diff = actual - plan;
  const color = diff >= 0 ? '#52c41a' : '#ff4d4f';
  return (
    <span>
      <span>{fmtKg(actual)}</span>
      <span style={{ color, fontSize: 11, marginLeft: 4 }}>
        {diff >= 0 ? '+' : ''}{fmtKg(diff)}
      </span>
    </span>
  );
}

export default function WeeklyPlanGrid() {
  const { t } = useTranslation();
  const now = dayjs();
  const [selectedWeek, setSelectedWeek] = useState<Dayjs>(now);

  const weekNumber = selectedWeek.isoWeek();
  const year = selectedWeek.isoWeekYear();

  const { data, isLoading, isError } = useHarvestPlans({ year, week: weekNumber });
  const plans = data?.results ?? [];

  const columns: ColumnsType<IWeeklyHarvestPlan> = [
    {
      title: t('plan.block'),
      dataIndex: 'block_code',
      fixed: 'left',
      width: 80,
      render: (code: string, row) => (
        <Space direction="vertical" size={0}>
          <Tag color="blue">{code}</Tag>
          <span style={{ fontSize: 11, color: '#8c8c8c' }}>{row.block_name}</span>
        </Space>
      ),
    },
    ...DAYS.map((day) => ({
      title: t(`plan.${day}`),
      width: 130,
      children: [
        {
          title: <span style={{ color: '#1677ff', fontSize: 11 }}>{t('plan.plan')}</span>,
          key: `${day}_plan`,
          width: 65,
          render: (_: unknown, row: IWeeklyHarvestPlan) => fmtKg(row[`${day}_plan_kg`]),
        },
        {
          title: <span style={{ color: '#52c41a', fontSize: 11 }}>{t('plan.actual')}</span>,
          key: `${day}_actual`,
          width: 65,
          render: (_: unknown, row: IWeeklyHarvestPlan) => (
            <ActualCell plan={row[`${day}_plan_kg`]} actual={row[`${day}_actual_kg`]} />
          ),
        },
      ],
    })),
    {
      title: t('plan.total'),
      fixed: 'right',
      width: 120,
      render: (_: unknown, row: IWeeklyHarvestPlan) => (
        <Space direction="vertical" size={0}>
          <span style={{ color: '#1677ff' }}>{fmtKg(row.total_plan_kg)}</span>
          {row.total_actual_kg != null && (
            <span style={{ color: '#52c41a', fontSize: 11 }}>{fmtKg(row.total_actual_kg)}</span>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', color: '#1f1f1f', lineHeight: '1.3' }}>
            {t('plan.title')}
          </div>
          <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 2 }}>
            {t('plan.week')} {weekNumber} · {year} · {plans.length} {t('plan.blocks')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <DatePicker
            picker="week"
            value={selectedWeek}
            onChange={(val) => val && setSelectedWeek(val)}
            format={(d) => `${t('plan.week')} ${d.isoWeek()}, ${d.isoWeekYear()}`}
            style={{ width: 220 }}
          />
        </div>
      </div>

      {isError && <Alert type="error" message={t('plan.error_load')} style={{ marginBottom: 16 }} />}

      {isLoading ? (
        <Skeleton active />
      ) : (
        <Table<IWeeklyHarvestPlan>
          rowKey="id"
          dataSource={plans}
          columns={columns}
          pagination={false}
          scroll={{ x: 1400 }}
          size="small"
          bordered
          summary={(rows) => {
            const totalPlan = rows.reduce((s, r) => s + (r.total_plan_kg ?? 0), 0);
            const totalActual = rows.reduce((s, r) => s + (r.total_actual_kg ?? 0), 0);
            return (
              <Table.Summary.Row style={{ fontWeight: 600, background: '#fafafa' }}>
                <Table.Summary.Cell index={0}>{t('plan.total')}</Table.Summary.Cell>
                {DAYS.map((_, i) => (
                  <Table.Summary.Cell key={i} index={i + 1} colSpan={2} />
                ))}
                <Table.Summary.Cell index={DAYS.length + 1}>
                  <Space direction="vertical" size={0}>
                    <span style={{ color: '#1677ff' }}>{fmtKg(totalPlan)}</span>
                    {totalActual > 0 && (
                      <span style={{ color: '#52c41a', fontSize: 11 }}>{fmtKg(totalActual)}</span>
                    )}
                  </Space>
                </Table.Summary.Cell>
              </Table.Summary.Row>
            );
          }}
        />
      )}
    </div>
  );
}
