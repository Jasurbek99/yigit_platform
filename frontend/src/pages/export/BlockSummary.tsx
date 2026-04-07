import { useState } from 'react';
import { Alert, Badge, Card, Group, Progress, SimpleGrid, Skeleton, Text } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { IconChartBar } from '@tabler/icons-react';
import { DataTable } from 'mantine-datatable';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import { useBlockSummary } from '@/hooks/usePlanning';
import type { IBlockSummary } from '@/types';

dayjs.extend(isoWeek);
dayjs.extend(weekOfYear);

function fmtKg(val: number | null | undefined): string {
  if (val == null) return '—';
  return Number(val).toLocaleString();
}

function StatCard({ title, value, color }: { title: string; value: string | number; color?: string }) {
  return (
    <Card padding="md">
      <Text size="xs" c="dimmed" mb={4}>{title}</Text>
      <Text fw={700} size="xl" c={color}>{value}</Text>
    </Card>
  );
}

export default function BlockSummary() {
  const { t } = useTranslation();
  const now = dayjs();
  const [selectedWeek, setSelectedWeek] = useState<Date | null>(now.toDate());

  const dayjsWeek = selectedWeek ? dayjs(selectedWeek) : now;
  const weekNumber = dayjsWeek.isoWeek();
  const year = dayjsWeek.isoWeekYear();

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

  const columns = [
    {
      accessor: 'block_code' as keyof IBlockSummary,
      title: t('block_summary.block_code'),
      width: 80,
      render: (record: IBlockSummary) => (
        <Badge variant="light" color="blue">{record.block_code}</Badge>
      ),
    },
    {
      accessor: 'block_name' as keyof IBlockSummary,
      title: t('block_summary.block_name'),
    },
    {
      accessor: 'total_plan_kg' as keyof IBlockSummary,
      title: t('block_summary.plan'),
      width: 130,
      render: (record: IBlockSummary) => (
        <span style={{ color: '#1677ff' }}>{fmtKg(record.total_plan_kg)}</span>
      ),
    },
    {
      accessor: 'total_actual_kg' as keyof IBlockSummary,
      title: t('block_summary.actual'),
      width: 130,
      render: (record: IBlockSummary) =>
        record.total_actual_kg != null ? (
          <span style={{ color: '#52c41a' }}>{fmtKg(record.total_actual_kg)}</span>
        ) : (
          <span style={{ color: '#bfbfbf' }}>—</span>
        ),
    },
    {
      accessor: 'deficit_kg' as keyof IBlockSummary,
      title: t('block_summary.deficit'),
      width: 130,
      render: (record: IBlockSummary) => {
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
      accessor: 'block_id' as keyof IBlockSummary,
      title: t('block_summary.completion'),
      width: 160,
      render: (record: IBlockSummary) => {
        if (record.total_actual_kg == null) {
          return <span style={{ color: '#bfbfbf' }}>—</span>;
        }
        const pct =
          record.total_plan_kg > 0
            ? Math.min(100, Math.round((record.total_actual_kg / record.total_plan_kg) * 100))
            : 0;
        const color = pct >= 100 ? 'green' : pct < 80 ? 'red' : 'blue';
        return <Progress value={pct} color={color} size="sm" />;
      },
    },
  ];

  return (
    <div>
      {/* Page Header */}
      <Group justify="space-between" align="flex-start" mb="lg">
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', color: '#1f1f1f', lineHeight: '1.3', display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconChartBar size={18} color="#1677ff" />
            {t('block_summary.title')}
          </div>
          <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 2 }}>
            {t('block_summary.subtitle')}
          </div>
        </div>
        <DatePickerInput
          value={selectedWeek}
          onChange={(val) => setSelectedWeek(val as Date | null)}
          valueFormat="DD.MM.YYYY"
          placeholder={`${t('block_summary.week')} ${weekNumber}, ${year}`}
          style={{ width: 220 }}
        />
      </Group>

      <SimpleGrid cols={{ base: 2, sm: 4 }} mb="md">
        <StatCard
          title={t('block_summary.total_plan')}
          value={fmtKg(totalPlan)}
          color="blue"
        />
        <StatCard
          title={t('block_summary.total_actual')}
          value={totalActual != null ? fmtKg(totalActual) : '—'}
          color="green"
        />
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
                ? 'green'
                : 'red'
          }
        />
        <StatCard
          title={t('block_summary.completion')}
          value={completionPct != null ? `${completionPct}%` : '—'}
          color={
            completionPct == null
              ? undefined
              : completionPct >= 95
                ? 'green'
                : completionPct < 80
                  ? 'red'
                  : 'yellow'
          }
        />
      </SimpleGrid>

      {isError && (
        <Alert color="red" mb="md">{t('block_summary.error_load')}</Alert>
      )}

      {isLoading ? (
        <Skeleton height={300} />
      ) : (
        <DataTable
          idAccessor="block_id"
          records={rows}
          columns={columns}
          noRecordsText={t('block_summary.empty') ?? 'Maglumat ýok'}
          verticalSpacing="xs"
          styles={{ header: { backgroundColor: '#f5f5f5', fontSize: 13 } }}
        />
      )}
    </div>
  );
}
