import { useState } from 'react';
import {
  Typography,
  DatePicker,
  Row,
  Col,
  Statistic,
  Alert,
  Card,
} from 'antd';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { TruckOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs, { type Dayjs } from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import { useTruckAllocations } from '@/hooks/usePlanning';
import type { IWeeklyTruckAllocation } from '@/types';

dayjs.extend(isoWeek);
dayjs.extend(weekOfYear);

const DAY_KEYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

function fmtKg(val: number | null | undefined): string {
  if (val == null) return '—';
  return Number(val).toLocaleString();
}

function fmtTrucks(val: number | null | undefined): string {
  if (val == null) return '—';
  return val.toFixed(1);
}

export default function TruckForecast() {
  const { t } = useTranslation();
  const now = dayjs();
  const [selectedWeek, setSelectedWeek] = useState<Dayjs>(now);

  const weekNumber = selectedWeek.isoWeek();
  const year = selectedWeek.isoWeekYear();

  const { data, isLoading, isError } = useTruckAllocations({ year, week_number: weekNumber });
  const rows = data?.results ?? [];

  const totalTrucks = rows.reduce((s, r) => s + (r.total_trucks_calc ?? 0), 0);
  const totalRussia = rows.reduce((s, r) => s + r.russia_trucks, 0);
  const totalKazakhstan = rows.reduce((s, r) => s + r.kazakhstan_trucks, 0);
  const totalGapy = rows.reduce((s, r) => s + r.gapy_satys_trucks, 0);

  const columns: ProColumns<IWeeklyTruckAllocation>[] = [
    {
      title: t('truck.day'),
      dataIndex: 'day_of_week',
      width: 80,
      render: (_, record) => t(`truck.${DAY_KEYS[record.day_of_week - 1]}`),
    },
    {
      title: t('truck.planned_kg'),
      dataIndex: 'total_planned_kg',
      width: 140,
      render: (_, record) => fmtKg(record.total_planned_kg),
    },
    {
      title: t('truck.trucks_calc'),
      dataIndex: 'total_trucks_calc',
      width: 100,
      render: (_, record) => (
        <span style={{ fontWeight: 600 }}>{fmtTrucks(record.total_trucks_calc)}</span>
      ),
    },
    {
      title: t('truck.russia_trucks'),
      dataIndex: 'russia_trucks',
      width: 90,
      responsive: ['md'],
      render: (_, record) =>
        record.russia_trucks > 0 ? record.russia_trucks : <span style={{ color: '#bfbfbf' }}>—</span>,
    },
    {
      title: t('truck.kazakhstan_trucks'),
      dataIndex: 'kazakhstan_trucks',
      width: 110,
      responsive: ['md'],
      render: (_, record) =>
        record.kazakhstan_trucks > 0 ? record.kazakhstan_trucks : <span style={{ color: '#bfbfbf' }}>—</span>,
    },
    {
      title: t('truck.gapy_trucks'),
      dataIndex: 'gapy_satys_trucks',
      width: 110,
      responsive: ['md'],
      render: (_, record) =>
        record.gapy_satys_trucks > 0 ? record.gapy_satys_trucks : <span style={{ color: '#bfbfbf' }}>—</span>,
    },
    {
      title: t('truck.decided_by'),
      dataIndex: 'decided_by_name',
      responsive: ['lg'],
      render: (_, record) =>
        record.decided_by_name ? record.decided_by_name : <span style={{ color: '#bfbfbf' }}>—</span>,
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
          <TruckOutlined style={{ marginRight: 8 }} />
          {t('truck.title')}
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
              title={t('truck.total_trucks')}
              value={totalTrucks.toFixed(1)}
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic title={t('truck.russia_trucks')} value={totalRussia} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic title={t('truck.kazakhstan_trucks')} value={totalKazakhstan} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic title={t('truck.gapy_trucks')} value={totalGapy} />
          </Card>
        </Col>
      </Row>

      {isError && (
        <Alert type="error" message={t('truck.error_load')} style={{ marginBottom: 16 }} />
      )}

      <ProTable<IWeeklyTruckAllocation>
        rowKey="id"
        dataSource={rows}
        columns={columns}
        loading={isLoading}
        search={false}
        options={false}
        pagination={false}
        size="small"
        cardBordered
        locale={{ emptyText: t('truck.empty') }}
      />
    </div>
  );
}
