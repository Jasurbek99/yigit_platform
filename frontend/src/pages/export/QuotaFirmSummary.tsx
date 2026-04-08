import { Alert, Badge, Card, Group, Progress, SimpleGrid, Skeleton, Text } from '@mantine/core';
import { DataTable } from 'mantine-datatable';
import { useTranslation } from 'react-i18next';
import { useQuotaFirmSummary } from '@/hooks/usePlanning';
import type { IQuotaFirmSummary } from '@/types';

function fmtKg(val: number | null | undefined): string {
  if (val == null) return '—';
  return `${Number(val).toLocaleString()} kg`;
}

function StatCard({ title, value, color }: { title: string; value: string | number; color?: string }) {
  return (
    <Card padding="md">
      <Text size="xs" c="dimmed" mb={4}>{title}</Text>
      <Text fw={700} size="xl" c={color}>{value}</Text>
    </Card>
  );
}

interface IQuotaFirmSummaryTabProps {
  onFirmClick: (firmId: number) => void;
}

export function QuotaFirmSummaryTab({ onFirmClick }: IQuotaFirmSummaryTabProps) {
  const { t } = useTranslation();
  const { data: firms, isLoading, isError } = useQuotaFirmSummary();

  const totalFirms = firms?.length ?? 0;
  const totalGranted = firms?.reduce((s, f) => s + Number(f.total_granted_kg), 0) ?? 0;
  const totalUsed = firms?.reduce((s, f) => s + Number(f.total_used_kg), 0) ?? 0;
  const atRisk = firms?.filter((f) => f.utilization_pct >= 80).length ?? 0;

  const columns = [
    {
      accessor: 'export_firm_name' as keyof IQuotaFirmSummary,
      title: t('quota_firms.firm'),
      width: 180,
      render: (r: IQuotaFirmSummary) => (
        <Text fw={500} style={{ cursor: 'pointer', color: '#1677ff' }}>
          {r.export_firm_name || r.export_firm_code}
        </Text>
      ),
    },
    {
      accessor: 'quota_count' as keyof IQuotaFirmSummary,
      title: t('quota_firms.quotas'),
      width: 150,
      render: (r: IQuotaFirmSummary) => (
        <Group gap={4}>
          <Badge size="sm" variant="light" color="green">{r.active_count}</Badge>
          {r.expired_count > 0 && <Badge size="sm" variant="light" color="gray">{r.expired_count}</Badge>}
          {r.exhausted_count > 0 && <Badge size="sm" variant="light" color="red">{r.exhausted_count}</Badge>}
        </Group>
      ),
    },
    {
      accessor: 'total_domestic_sale_kg' as keyof IQuotaFirmSummary,
      title: t('quota_firms.domestic_sales'),
      width: 130,
      render: (r: IQuotaFirmSummary) => fmtKg(r.total_domestic_sale_kg),
    },
    {
      accessor: 'total_expected_kg' as keyof IQuotaFirmSummary,
      title: t('quota_firms.expected'),
      width: 130,
      render: (r: IQuotaFirmSummary) => fmtKg(r.total_expected_kg),
    },
    {
      accessor: 'total_granted_kg' as keyof IQuotaFirmSummary,
      title: t('quota_firms.granted'),
      width: 130,
      render: (r: IQuotaFirmSummary) => fmtKg(r.total_granted_kg),
    },
    {
      accessor: 'total_difference_kg' as keyof IQuotaFirmSummary,
      title: t('quota_firms.difference'),
      width: 120,
      render: (r: IQuotaFirmSummary) => {
        const diff = Number(r.total_difference_kg);
        const color = diff < 0 ? '#ff4d4f' : diff > 0 ? '#52c41a' : undefined;
        return <span style={{ color }}>{diff > 0 ? '+' : ''}{fmtKg(diff)}</span>;
      },
    },
    {
      accessor: 'total_used_kg' as keyof IQuotaFirmSummary,
      title: t('quota_firms.used'),
      width: 120,
      render: (r: IQuotaFirmSummary) => fmtKg(r.total_used_kg),
    },
    {
      accessor: 'total_remaining_kg' as keyof IQuotaFirmSummary,
      title: t('quota_firms.remaining'),
      width: 120,
      render: (r: IQuotaFirmSummary) => (
        <span style={{ color: r.total_remaining_kg <= 0 ? '#ff4d4f' : r.total_remaining_kg < 5000 ? '#fa8c16' : '#52c41a' }}>
          {fmtKg(r.total_remaining_kg)}
        </span>
      ),
    },
    {
      accessor: 'utilization_pct' as keyof IQuotaFirmSummary,
      title: t('quota_firms.utilization'),
      width: 150,
      render: (r: IQuotaFirmSummary) => (
        <Progress
          value={Math.min(r.utilization_pct, 100)}
          color={r.utilization_pct >= 95 ? 'red' : r.utilization_pct >= 80 ? 'orange' : 'green'}
          size="sm"
        />
      ),
    },
    {
      accessor: 'earliest_expiry' as keyof IQuotaFirmSummary,
      title: t('quota_firms.next_expiry'),
      width: 120,
      render: (r: IQuotaFirmSummary) => r.earliest_expiry ?? '—',
    },
  ];

  return (
    <div>
      {isError && <Alert color="red" mb="md">{t('quota.error_load')}</Alert>}

      <SimpleGrid cols={{ base: 2, sm: 4 }} mb="md">
        <StatCard title={t('quota_firms.total_firms')} value={totalFirms} />
        <StatCard title={t('quota_firms.total_granted')} value={`${totalGranted.toLocaleString()} kg`} />
        <StatCard title={t('quota_firms.total_used')} value={`${totalUsed.toLocaleString()} kg`} color="blue" />
        <StatCard title={t('quota_firms.at_risk')} value={atRisk} color="red" />
      </SimpleGrid>

      {isLoading ? (
        <Skeleton height={300} />
      ) : (
        <DataTable
          idAccessor="export_firm"
          records={firms ?? []}
          columns={columns}
          noRecordsText={t('quota.empty')}
          verticalSpacing="xs"
          styles={{ header: { backgroundColor: '#f5f5f5', fontSize: 13 } }}
          onRowClick={({ record }) => onFirmClick(record.export_firm)}
          rowStyle={() => ({ cursor: 'pointer' })}
        />
      )}
    </div>
  );
}
