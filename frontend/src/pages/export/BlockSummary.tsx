import { useState } from 'react';
import { Alert, Card, DatePicker, Progress, Row, Col, Space, Tag, Typography } from 'antd';
import { ProTable, type ProColumns } from '@ant-design/pro-components';
import { IconChartBar } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import dayjs, { type Dayjs } from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import { useBlockSummary } from '@/hooks/usePlanning';
import type { IBlockSummary } from '@/types';

dayjs.extend(isoWeek);
dayjs.extend(weekOfYear);

const { Text } = Typography;

function fmtKg(val: number | null | undefined): string {
  if (val == null) return '—';
  return Number(val).toLocaleString();
}

function StatCard({ title, value, color }: { title: string; value: string | number; color?: string }) {
  return (
    <Card size="small">
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>{title}</Text>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
    </Card>
  );
}

export default function BlockSummary() {
  const { t } = useTranslation();
  const now = dayjs();
  const [selectedWeek, setSelectedWeek] = useState<Dayjs>(now);

  const weekNumber = selectedWeek.isoWeek();
  const year = selectedWeek.isoWeekYear();

  const { data: rows = [], isLoading, isError } = useBlockSummary({ year, week_number: weekNumber });

  const totalPlan = rows.reduce((s, r) => s + r.total_plan_kg, 0);
  const hasAnyActual = rows.some((r) => r.total_actual_kg != null);
  const totalActual = hasAnyActual
    ? rows.reduce((s, r) => s + (r.total_actual_kg ?? 0), 0)
    : null;
  const totalDeficit = totalActual != null ? totalActual - totalPlan : null;
  const completionPct =
    totalActual != null && totalPlan > 0
      ? Math.round((totalActual / totalPlan) * 100)
      : null;

  const columns: ProColumns<IBlockSummary>[] = [
    {
      title: t('block_summary.block_code'),
      dataIndex: 'block_code',
      width: 80,
      search: false,
      sorter: (a, b) => a.block_code.localeCompare(b.block_code),
      defaultSortOrder: 'ascend',
      render: (_, record) => <Tag color="blue">{record.block_code}</Tag>,
    },
    {
      title: t('block_summary.block_name'),
      dataIndex: 'block_name',
      search: false,
      sorter: (a, b) => a.block_name.localeCompare(b.block_name),
    },
    {
      title: t('block_summary.plan'),
      dataIndex: 'total_plan_kg',
      width: 130,
      search: false,
      sorter: (a, b) => a.total_plan_kg - b.total_plan_kg,
      render: (_, record) => (
        <span style={{ color: '#1677ff' }}>{fmtKg(record.total_plan_kg)}</span>
      ),
    },
    {
      title: t('block_summary.actual'),
      dataIndex: 'total_actual_kg',
      width: 130,
      search: false,
      sorter: (a, b) => (a.total_actual_kg ?? 0) - (b.total_actual_kg ?? 0),
      render: (_, record) =>
        record.total_actual_kg != null ? (
          <span style={{ color: '#52c41a' }}>{fmtKg(record.total_actual_kg)}</span>
        ) : (
          <span style={{ color: '#bfbfbf' }}>—</span>
        ),
    },
    {
      title: t('block_summary.deficit'),
      dataIndex: 'deficit_kg',
      width: 130,
      search: false,
      sorter: (a, b) => (a.deficit_kg ?? 0) - (b.deficit_kg ?? 0),
      render: (_, record) => {
        const val = record.deficit_kg;
        if (val == null) return <span style={{ color: '#bfbfbf' }}>—</span>;
        return (
          <span style={{ color: val >= 0 ? '#52c41a' : '#ff4d4f', fontWeight: 500 }}>
            {val >= 0 ? '+' : ''}{fmtKg(val)}
          </span>
        );
      },
    },
    {
      title: t('block_summary.completion'),
      key: 'completion',
      width: 160,
      search: false,
      render: (_, record) => {
        if (record.total_actual_kg == null) {
          return <span style={{ color: '#bfbfbf' }}>—</span>;
        }
        const pct =
          record.total_plan_kg > 0
            ? Math.min(100, Math.round((record.total_actual_kg / record.total_plan_kg) * 100))
            : 0;
        const strokeColor = pct >= 100 ? '#52c41a' : pct < 80 ? '#ff4d4f' : '#1677ff';
        return <Progress percent={pct} size="small" strokeColor={strokeColor} />;
      },
    },
  ];

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', color: '#1f1f1f', lineHeight: '1.3', display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconChartBar size={18} color="#1677ff" />
            {t('block_summary.title')}
          </div>
          <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 2 }}>
            {t('block_summary.subtitle')}
          </div>
        </div>
        <DatePicker
          picker="week"
          value={selectedWeek}
          onChange={(d) => { if (d) setSelectedWeek(d); }}
          allowClear={false}
          style={{ width: 220 }}
          placeholder={`${t('block_summary.week')} ${weekNumber}, ${year}`}
        />
      </Space>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}>
          <StatCard
            title={t('block_summary.total_plan')}
            value={fmtKg(totalPlan)}
            color="#1677ff"
          />
        </Col>
        <Col xs={12} sm={6}>
          <StatCard
            title={t('block_summary.total_actual')}
            value={totalActual != null ? fmtKg(totalActual) : '—'}
            color="#52c41a"
          />
        </Col>
        <Col xs={12} sm={6}>
          <StatCard
            title={t('block_summary.total_deficit')}
            value={
              totalDeficit != null
                ? `${totalDeficit >= 0 ? '+' : ''}${fmtKg(totalDeficit)}`
                : '—'
            }
            color={
              totalDeficit == null
                ? undefined
                : totalDeficit >= 0
                  ? '#52c41a'
                  : '#ff4d4f'
            }
          />
        </Col>
        <Col xs={12} sm={6}>
          <StatCard
            title={t('block_summary.completion')}
            value={completionPct != null ? `${completionPct}%` : '—'}
            color={
              completionPct == null
                ? undefined
                : completionPct >= 95
                  ? '#52c41a'
                  : completionPct < 80
                    ? '#ff4d4f'
                    : '#faad14'
            }
          />
        </Col>
      </Row>

      {isError && (
        <Alert type="error" message={t('block_summary.error_load')} style={{ marginBottom: 16 }} showIcon />
      )}

      <ProTable<IBlockSummary>
        rowKey="block_id"
        dataSource={rows}
        columns={columns}
        loading={isLoading}
        search={false}
        options={false}
        pagination={false}
        size="small"
        locale={{ emptyText: t('block_summary.empty') }}
      />
    </div>
  );
}
