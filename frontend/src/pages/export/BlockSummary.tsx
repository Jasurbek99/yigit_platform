import { useState } from 'react';
import {
  Typography,
  DatePicker,
  Row,
  Col,
  Statistic,
  Table,
  Alert,
  Skeleton,
  Card,
  Progress,
  Tag,
} from 'antd';
import { BarChartOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs, { type Dayjs } from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import { useBlockSummary } from '@/hooks/usePlanning';
import type { IBlockSummary } from '@/types';
import type { ColumnsType } from 'antd/es/table';

dayjs.extend(isoWeek);
dayjs.extend(weekOfYear);

function fmtKg(val: number): string {
  return Number(val).toLocaleString();
}

export default function BlockSummary() {
  const { t } = useTranslation();
  const now = dayjs();
  const [selectedWeek, setSelectedWeek] = useState<Dayjs>(now);

  const weekNumber = selectedWeek.isoWeek();
  const year = selectedWeek.isoWeekYear();

  const { data: rows = [], isLoading, isError } = useBlockSummary({ year, week_number: weekNumber });

  const totalPlan = rows.reduce((s, r) => s + r.total_plan_kg, 0);
  const totalActual = rows.reduce((s, r) => s + r.total_actual_kg, 0);
  const totalDeficit = totalActual - totalPlan;
  const completionPct = totalPlan > 0 ? Math.round((totalActual / totalPlan) * 100) : 0;

  const columns: ColumnsType<IBlockSummary> = [
    {
      title: t('block_summary.block_code'),
      dataIndex: 'block_code',
      width: 80,
      render: (code: string) => <Tag color="blue">{code}</Tag>,
    },
    {
      title: t('block_summary.block_name'),
      dataIndex: 'block_name',
    },
    {
      title: t('block_summary.plan'),
      dataIndex: 'total_plan_kg',
      align: 'right',
      width: 130,
      render: (val: number) => (
        <span style={{ color: '#1677ff' }}>{fmtKg(val)}</span>
      ),
    },
    {
      title: t('block_summary.actual'),
      dataIndex: 'total_actual_kg',
      align: 'right',
      width: 130,
      render: (val: number) => (
        <span style={{ color: '#52c41a' }}>{fmtKg(val)}</span>
      ),
    },
    {
      title: t('block_summary.deficit'),
      dataIndex: 'deficit_kg',
      align: 'right',
      width: 130,
      render: (val: number) => (
        <span style={{ color: val >= 0 ? '#52c41a' : '#ff4d4f', fontWeight: 500 }}>
          {val >= 0 ? '+' : ''}{fmtKg(val)}
        </span>
      ),
    },
    {
      title: t('block_summary.completion'),
      key: 'completion',
      width: 160,
      render: (_: unknown, record: IBlockSummary) => {
        const pct = record.total_plan_kg > 0
          ? Math.min(100, Math.round((record.total_actual_kg / record.total_plan_kg) * 100))
          : 0;
        return (
          <Progress
            percent={pct}
            size="small"
            status={pct >= 100 ? 'success' : pct < 80 ? 'exception' : 'normal'}
            style={{ marginBottom: 0 }}
          />
        );
      },
    },
  ];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        <Typography.Title level={4} style={{ margin: 0 }}>
          <BarChartOutlined style={{ marginRight: 8 }} />
          {t('block_summary.title')}
        </Typography.Title>
        <DatePicker
          picker="week"
          value={selectedWeek}
          onChange={(val) => val && setSelectedWeek(val)}
          format={(d) => `${t('truck.week')} ${d.isoWeek()}, ${d.isoWeekYear()}`}
        />
        <Typography.Text type="secondary">
          {t('truck.week')} {weekNumber} · {year}
        </Typography.Text>
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic
              title={t('block_summary.total_plan')}
              value={fmtKg(totalPlan)}
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic
              title={t('block_summary.total_actual')}
              value={fmtKg(totalActual)}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic
              title={t('block_summary.total_deficit')}
              value={`${totalDeficit >= 0 ? '+' : ''}${fmtKg(totalDeficit)}`}
              valueStyle={{ color: totalDeficit >= 0 ? '#52c41a' : '#ff4d4f' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic
              title={t('block_summary.completion')}
              value={completionPct}
              suffix="%"
              valueStyle={{ color: completionPct >= 95 ? '#52c41a' : completionPct < 80 ? '#ff4d4f' : '#faad14' }}
            />
          </Card>
        </Col>
      </Row>

      {isError && (
        <Alert
          type="error"
          message={t('block_summary.error_load')}
          style={{ marginBottom: 16 }}
        />
      )}

      {isLoading ? (
        <Skeleton active />
      ) : (
        <Table<IBlockSummary>
          rowKey="block_id"
          dataSource={rows}
          columns={columns}
          pagination={false}
          size="small"
          bordered
          locale={{ emptyText: t('block_summary.empty') }}
        />
      )}
    </div>
  );
}
