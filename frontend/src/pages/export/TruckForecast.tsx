import { useMemo, useState } from 'react';
import { Alert, Card, DatePicker, Row, Col, Space, Typography } from 'antd';
import { ProTable, type ProColumns } from '@ant-design/pro-components';
import { IconTruck } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import dayjs, { type Dayjs } from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import { useTruckAllocations, useTruckDestinations } from '@/hooks/usePlanning';
import type { IWeeklyTruckAllocation } from '@/types';

dayjs.extend(isoWeek);
dayjs.extend(weekOfYear);

const { Text } = Typography;

const DAY_KEYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

function fmtKg(val: number | null | undefined): string {
  if (val == null) return '—';
  return Number(val).toLocaleString();
}

function fmtTrucks(val: number | null | undefined): string {
  if (val == null) return '—';
  return val.toFixed(1);
}

function StatCard({ title, value, color }: { title: string; value: string | number; color?: string }) {
  return (
    <Card size="small">
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>{title}</Text>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
    </Card>
  );
}

function getSplitCount(record: IWeeklyTruckAllocation, destId: number): number {
  return record.destination_splits?.find((s) => s.destination === destId)?.truck_count ?? 0;
}

export default function TruckForecast() {
  const { t } = useTranslation();
  const now = dayjs();
  const [selectedWeek, setSelectedWeek] = useState<Dayjs>(now);

  const weekNumber = selectedWeek.isoWeek();
  const year = selectedWeek.isoWeekYear();

  const { data, isLoading, isError } = useTruckAllocations({ year, week_number: weekNumber });
  const { data: destinations = [] } = useTruckDestinations();
  const rows = useMemo(() => data?.results ?? [], [data?.results]);

  const totalTrucks = rows.reduce((s, r) => s + (r.total_trucks_calc ?? 0), 0);

  const destTotals = destinations.map((d) => ({
    id: d.id,
    name: d.name,
    total: rows.reduce((s, r) => s + getSplitCount(r, d.id), 0),
  }));

  const columns: ProColumns<IWeeklyTruckAllocation>[] = [
    {
      title: t('truck.day'),
      dataIndex: 'day_of_week',
      width: 80,
      search: false,
      render: (_, record) => {
        const key = DAY_KEYS[record.day_of_week - 1];
        return key ? t(`truck.${key}`) : String(record.day_of_week);
      },
    },
    {
      title: t('truck.planned_kg'),
      dataIndex: 'total_planned_kg',
      width: 140,
      search: false,
      render: (_, record) => fmtKg(record.total_planned_kg),
    },
    {
      title: t('truck.trucks_calc'),
      dataIndex: 'total_trucks_calc',
      width: 100,
      search: false,
      render: (_, record) => (
        <span style={{ fontWeight: 600 }}>{fmtTrucks(record.total_trucks_calc)}</span>
      ),
    },
    ...destinations.map<ProColumns<IWeeklyTruckAllocation>>((dest) => ({
      title: dest.name,
      key: `dest_${dest.id}`,
      width: 110,
      search: false,
      render: (_, record) => {
        const count = getSplitCount(record, dest.id);
        return count > 0 ? count : <span style={{ color: '#bfbfbf' }}>—</span>;
      },
    })),
    {
      title: t('truck.decided_by'),
      dataIndex: 'decided_by_name',
      search: false,
      render: (_, record) =>
        record.decided_by_name
          ? record.decided_by_name
          : <span style={{ color: '#bfbfbf' }}>—</span>,
    },
  ];

  const colCount = 2 + destinations.length;
  const colSpan = Math.max(4, Math.floor(24 / colCount));

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', color: '#1f1f1f', lineHeight: '1.3', display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconTruck size={18} color="#1677ff" />
            {t('truck.title')}
          </div>
          <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 2 }}>
            {t('truck.subtitle')}
          </div>
        </div>
        <DatePicker
          picker="week"
          value={selectedWeek}
          onChange={(d) => { if (d) setSelectedWeek(d); }}
          allowClear={false}
          style={{ width: 220 }}
          placeholder={`${t('truck.week')} ${weekNumber}, ${year}`}
        />
      </Space>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={colSpan}>
          <StatCard title={t('truck.total_trucks')} value={totalTrucks.toFixed(1)} color="#1677ff" />
        </Col>
        {destTotals.map((d) => (
          <Col key={d.id} xs={12} sm={colSpan}>
            <StatCard title={d.name} value={d.total} />
          </Col>
        ))}
      </Row>

      {isError && (
        <Alert type="error" message={t('truck.error_load')} style={{ marginBottom: 16 }} showIcon />
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
        locale={{ emptyText: t('truck.empty') }}
      />
    </div>
  );
}
