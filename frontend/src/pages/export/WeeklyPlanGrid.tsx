import { useState } from 'react';
import { Alert, Badge, Group, Skeleton, Table, Text } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import { useHarvestPlans } from '@/hooks/usePlanning';
import type { IWeeklyHarvestPlan } from '@/types';

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
  const [selectedWeek, setSelectedWeek] = useState<Date | null>(now.toDate());

  const dayjsWeek = selectedWeek ? dayjs(selectedWeek) : now;
  const weekNumber = dayjsWeek.isoWeek();
  const year = dayjsWeek.isoWeekYear();

  const { data, isLoading, isError } = useHarvestPlans({ year, week: weekNumber });
  const plans: IWeeklyHarvestPlan[] = data?.results ?? [];

  const totalPlan = plans.reduce((s, r) => s + (r.total_plan_kg ?? 0), 0);
  const totalActual = plans.reduce((s, r) => s + (r.total_actual_kg ?? 0), 0);

  return (
    <div>
      {/* Page Header */}
      <Group justify="space-between" align="flex-start" mb="lg">
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', color: '#1f1f1f', lineHeight: '1.3' }}>
            {t('plan.title')}
          </div>
          <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 2 }}>
            {t('plan.week')} {weekNumber} · {year} · {plans.length} {t('plan.blocks')}
          </div>
        </div>
        <DatePickerInput
          value={selectedWeek}
          onChange={(val) => setSelectedWeek(val as Date | null)}
          valueFormat="DD.MM.YYYY"
          placeholder={`${t('plan.week')} ${weekNumber}, ${year}`}
          style={{ width: 220 }}
        />
      </Group>

      {isError && <Alert color="red" mb="md">{t('plan.error_load')}</Alert>}

      {isLoading ? (
        <Skeleton height={300} />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <Table striped highlightOnHover withColumnBorders withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th rowSpan={2}>{t('plan.block')}</Table.Th>
                {DAYS.map((d) => (
                  <Table.Th key={d} colSpan={2} style={{ textAlign: 'center' }}>
                    {t(`plan.${d}`)}
                  </Table.Th>
                ))}
                <Table.Th rowSpan={2}>{t('plan.total')}</Table.Th>
              </Table.Tr>
              <Table.Tr>
                {DAYS.flatMap((d) => [
                  <Table.Th key={`${d}_plan`} style={{ color: '#1677ff', fontSize: 11 }}>
                    {t('plan.plan')}
                  </Table.Th>,
                  <Table.Th key={`${d}_actual`} style={{ color: '#52c41a', fontSize: 11 }}>
                    {t('plan.actual')}
                  </Table.Th>,
                ])}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {plans.map((row) => (
                <Table.Tr key={row.id}>
                  <Table.Td>
                    <Badge variant="light" color="blue">{row.block_code}</Badge>
                    <Text size="xs" c="dimmed">{row.block_name}</Text>
                  </Table.Td>
                  {DAYS.flatMap((day) => [
                    <Table.Td key={`${day}_plan`}>{fmtKg(row[`${day}_plan_kg`])}</Table.Td>,
                    <Table.Td key={`${day}_actual`}>
                      <ActualCell plan={row[`${day}_plan_kg`]} actual={row[`${day}_actual_kg`]} />
                    </Table.Td>,
                  ])}
                  <Table.Td>
                    <Text size="sm" c="blue">{fmtKg(row.total_plan_kg)}</Text>
                    {row.total_actual_kg != null && (
                      <Text size="xs" c="green">{fmtKg(row.total_actual_kg)}</Text>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
              {/* Summary row */}
              <Table.Tr style={{ fontWeight: 600 }}>
                <Table.Td>{t('plan.total')}</Table.Td>
                {DAYS.flatMap((_, i) => [
                  <Table.Td key={`sum_plan_${i}`} />,
                  <Table.Td key={`sum_actual_${i}`} />,
                ])}
                <Table.Td>
                  <Text size="sm" c="blue">{fmtKg(totalPlan)}</Text>
                  {totalActual > 0 && <Text size="xs" c="green">{fmtKg(totalActual)}</Text>}
                </Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>
        </div>
      )}
    </div>
  );
}
