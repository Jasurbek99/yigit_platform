import { Alert, Badge, Card, Progress, SimpleGrid, Skeleton, Text } from '@mantine/core';
import { DataTable } from 'mantine-datatable';
import { useTranslation } from 'react-i18next';
import { useQuotaDashboard } from '@/hooks/usePlanning';
import type { IQuotaDashboardItem } from '@/types';

function pctColor(pct: number): string {
  if (pct >= 95) return 'red';
  if (pct >= 80) return 'orange';
  return 'green';
}

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

export default function QuotaDashboard() {
  const { t } = useTranslation();
  const { data: quotas, isLoading, isError } = useQuotaDashboard();

  const totalGranted = quotas?.reduce((s, q) => s + Number(q.granted_kg), 0) ?? 0;
  const totalUsed = quotas?.reduce((s, q) => s + Number(q.used_kg), 0) ?? 0;
  const overLimit = quotas?.filter((q) => q.used_pct >= 95).length ?? 0;
  const warning = quotas?.filter((q) => q.used_pct >= 80 && q.used_pct < 95).length ?? 0;

  const columns = [
    {
      accessor: 'export_firm_name' as keyof IQuotaDashboardItem,
      title: t('quota.firm'),
      width: 180,
      render: (record: IQuotaDashboardItem) => record.export_firm_name ?? '—',
    },
    {
      accessor: 'granted_kg' as keyof IQuotaDashboardItem,
      title: t('quota.granted'),
      width: 130,
      render: (record: IQuotaDashboardItem) => fmtKg(record.granted_kg),
    },
    {
      accessor: 'used_kg' as keyof IQuotaDashboardItem,
      title: t('quota.used'),
      width: 130,
      render: (record: IQuotaDashboardItem) => fmtKg(record.used_kg),
    },
    {
      accessor: 'remaining_kg' as keyof IQuotaDashboardItem,
      title: t('quota.remaining'),
      width: 130,
      render: (record: IQuotaDashboardItem) => (
        <span
          style={{
            color:
              record.remaining_kg <= 0
                ? '#ff4d4f'
                : record.remaining_kg < 50000
                  ? '#fa8c16'
                  : '#52c41a',
          }}
        >
          {fmtKg(record.remaining_kg)}
        </span>
      ),
    },
    {
      accessor: 'used_pct' as keyof IQuotaDashboardItem,
      title: t('quota.used_pct'),
      width: 200,
      render: (record: IQuotaDashboardItem) => (
        <Progress
          value={Math.min(record.used_pct, 100)}
          color={pctColor(record.used_pct)}
          size="sm"
        />
      ),
    },
    {
      accessor: 'id' as keyof IQuotaDashboardItem,
      title: t('quota.alerts'),
      width: 120,
      render: (record: IQuotaDashboardItem) => {
        if (record.used_pct >= 95) return <Badge variant="light" color="red">&ge;95%</Badge>;
        if (record.used_pct >= 90) return <Badge variant="light" color="orange">&ge;90%</Badge>;
        if (record.used_pct >= 80) return <Badge variant="light" color="yellow">&ge;80%</Badge>;
        return <Badge variant="light" color="green">OK</Badge>;
      },
    },
  ];

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', color: '#1f1f1f', lineHeight: '1.3' }}>
            {t('quota.title')}
          </div>
          <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 2 }}>
            Eksport kwotasy — 2025/2026 möwsüm
          </div>
        </div>
      </div>

      {isError && <Alert color="red" mb="md">{t('quota.error_load')}</Alert>}

      {/* Summary cards */}
      <SimpleGrid cols={{ base: 2, sm: 4 }} mb="md">
        <StatCard title={t('quota.total_granted')} value={`${Number(totalGranted).toLocaleString()} kg`} />
        <StatCard title={t('quota.total_used')} value={`${Number(totalUsed).toLocaleString()} kg`} color="blue" />
        <StatCard title={t('quota.warning_firms')} value={warning} color="orange" />
        <StatCard title={t('quota.critical_firms')} value={overLimit} color="red" />
      </SimpleGrid>

      {isLoading ? (
        <Skeleton height={300} />
      ) : (
        <DataTable
          idAccessor="id"
          records={quotas ?? []}
          columns={columns}
          noRecordsText={t('quota.empty') ?? 'Maglumat ýok'}
          verticalSpacing="xs"
          styles={{ header: { backgroundColor: '#f5f5f5', fontSize: 13 } }}
        />
      )}
    </div>
  );
}
