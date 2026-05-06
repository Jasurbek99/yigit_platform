import { useState } from 'react';
import { Alert, Card, Group, SimpleGrid, Text } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { IconTruck } from '@tabler/icons-react';
import { DataTable } from 'mantine-datatable';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import { useTruckAllocations, useTruckDestinations } from '@/hooks/usePlanning';
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
    <Card padding="md">
      <Text size="xs" c="dimmed" mb={4}>{title}</Text>
      <Text fw={700} size="xl" c={color}>{value}</Text>
    </Card>
  );
}

function getSplitCount(record: IWeeklyTruckAllocation, destId: number): number {
  return record.destination_splits?.find((s) => s.destination === destId)?.truck_count ?? 0;
}

export default function TruckForecast() {
  const { t } = useTranslation();
  const now = dayjs();
  const [selectedWeek, setSelectedWeek] = useState<Date | null>(now.toDate());

  const dayjsWeek = selectedWeek ? dayjs(selectedWeek) : now;
  const weekNumber = dayjsWeek.isoWeek();
  const year = dayjsWeek.isoWeekYear();

  const { data, isLoading, isError } = useTruckAllocations({ year, week_number: weekNumber });
  const { data: destinations = [] } = useTruckDestinations();
  const rows = data?.results ?? [];

  const totalTrucks = rows.reduce((s, r) => s + (r.total_trucks_calc ?? 0), 0);

  // Dynamic totals per destination
  const destTotals = destinations.map((d) => ({
    id: d.id,
    name: d.name,
    total: rows.reduce((s, r) => s + getSplitCount(r, d.id), 0),
  }));

  const columns = [
    {
      accessor: 'day_of_week' as keyof IWeeklyTruckAllocation,
      title: t('truck.day'),
      width: 80,
      render: (record: IWeeklyTruckAllocation) => {
        const key = DAY_KEYS[record.day_of_week - 1];
        return key ? t(`truck.${key}`) : String(record.day_of_week);
      },
    },
    {
      accessor: 'total_planned_kg' as keyof IWeeklyTruckAllocation,
      title: t('truck.planned_kg'),
      width: 140,
      render: (record: IWeeklyTruckAllocation) => fmtKg(record.total_planned_kg),
    },
    {
      accessor: 'total_trucks_calc' as keyof IWeeklyTruckAllocation,
      title: t('truck.trucks_calc'),
      width: 100,
      render: (record: IWeeklyTruckAllocation) => (
        <span style={{ fontWeight: 600 }}>{fmtTrucks(record.total_trucks_calc)}</span>
      ),
    },
    ...destinations.map((dest) => ({
      accessor: `dest_${dest.id}` as keyof IWeeklyTruckAllocation,
      title: dest.name,
      width: 110,
      render: (record: IWeeklyTruckAllocation) => {
        const count = getSplitCount(record, dest.id);
        return count > 0 ? count : <span style={{ color: '#bfbfbf' }}>—</span>;
      },
    })),
    {
      accessor: 'decided_by_name' as keyof IWeeklyTruckAllocation,
      title: t('truck.decided_by'),
      render: (record: IWeeklyTruckAllocation) =>
        record.decided_by_name
          ? record.decided_by_name
          : <span style={{ color: '#bfbfbf' }}>—</span>,
    },
  ];

  return (
    <div>
      {/* Page Header */}
      <Group justify="space-between" align="flex-start" mb="lg">
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', color: '#1f1f1f', lineHeight: '1.3', display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconTruck size={18} color="#1677ff" />
            {t('truck.title')}
          </div>
          <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 2 }}>
            {t('truck.subtitle')}
          </div>
        </div>
        <DatePickerInput
          value={selectedWeek}
          onChange={(val) => setSelectedWeek(val as Date | null)}
          valueFormat="DD.MM.YYYY"
          placeholder={`${t('truck.week')} ${weekNumber}, ${year}`}
          style={{ width: 220 }}
        />
      </Group>

      <SimpleGrid cols={{ base: 2, sm: 2 + destinations.length }} mb="md">
        <StatCard title={t('truck.total_trucks')} value={totalTrucks.toFixed(1)} color="blue" />
        {destTotals.map((d) => (
          <StatCard key={d.id} title={d.name} value={d.total} />
        ))}
      </SimpleGrid>

      {isError && (
        <Alert color="red" mb="md">{t('truck.error_load')}</Alert>
      )}

      <DataTable
        idAccessor="id"
        records={rows}
        columns={columns}
        fetching={isLoading}
        noRecordsText={t('truck.empty') ?? 'Maglumat ýok'}
        verticalSpacing="xs"
        styles={{ header: { backgroundColor: '#f5f5f5', fontSize: 13 } }}
      />
    </div>
  );
}
