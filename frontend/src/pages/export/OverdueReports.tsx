import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, Anchor, Card, Group, SegmentedControl, SimpleGrid, Text } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { DataTable } from 'mantine-datatable';
import { useOverdueShipments } from '@/hooks/useOverdueShipments';
import { StatusTag } from '@/components/StatusTag';
import type { IOverdueShipment } from '@/types';

const THRESHOLD_OPTIONS = [5, 7, 10, 14] as const;
type ThresholdValue = (typeof THRESHOLD_OPTIONS)[number];

function daysOverdueColor(days: number): string {
  if (days > 14) return '#ff4d4f';
  if (days >= 10) return '#fa8c16';
  return '#52c41a';
}

function StatCard({ title, value, color }: { title: string; value: string | number; color?: string }) {
  return (
    <Card padding="md">
      <Text size="xs" c="dimmed" mb={4}>{title}</Text>
      <Text fw={700} size="xl" c={color}>{value}</Text>
    </Card>
  );
}

export default function OverdueReports() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // ── State ──────────────────────────────────────────────────────────────────
  const [threshold, setThreshold] = useState<ThresholdValue>(7);

  // ── Server data ────────────────────────────────────────────────────────────
  const { data, isLoading, isError } = useOverdueShipments(threshold);

  // ── Derived ────────────────────────────────────────────────────────────────
  const shipments = useMemo(() => data?.results ?? [], [data?.results]);

  const totalOverdue = data?.count ?? 0;

  const avgDays = useMemo(() => {
    if (shipments.length === 0) return 0;
    const sum = shipments.reduce((acc, s) => acc + s.days_overdue, 0);
    return Math.round(sum / shipments.length);
  }, [shipments]);

  const criticalCount = useMemo(
    () => shipments.filter((s) => s.days_overdue > 14).length,
    [shipments],
  );

  // ── Handlers ───────────────────────────────────────────────────────────────
  function handleThresholdChange(value: string) {
    setThreshold(Number(value) as ThresholdValue);
  }

  // ── Columns ────────────────────────────────────────────────────────────────
  const columns = [
    {
      accessor: 'cargo_code' as keyof IOverdueShipment,
      title: t('overdue.cargo_code'),
      width: 140,
      render: (record: IOverdueShipment) => (
        <Anchor
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/shipments/${record.id}`);
          }}
        >
          {record.cargo_code}
        </Anchor>
      ),
    },
    {
      accessor: 'status_display' as keyof IOverdueShipment,
      title: t('overdue.status'),
      width: 130,
      render: (record: IOverdueShipment) => <StatusTag statusDisplay={record.status_display} />,
    },
    {
      accessor: 'country_name' as keyof IOverdueShipment,
      title: t('overdue.country'),
      width: 120,
      render: (record: IOverdueShipment) => record.country_name ?? '—',
    },
    {
      accessor: 'customer_name' as keyof IOverdueShipment,
      title: t('overdue.customer'),
      width: 160,
      render: (record: IOverdueShipment) => record.customer_name ?? '—',
    },
    {
      accessor: 'weight_net' as keyof IOverdueShipment,
      title: t('overdue.weight_net'),
      width: 110,
      render: (record: IOverdueShipment) =>
        record.weight_net != null
          ? record.weight_net.toLocaleString()
          : '—',
    },
    {
      accessor: 'days_overdue' as keyof IOverdueShipment,
      title: t('overdue.days_overdue'),
      width: 130,
      render: (record: IOverdueShipment) => (
        <Text fw={600} style={{ color: daysOverdueColor(record.days_overdue) }}>
          {t('overdue.days', { count: record.days_overdue })}
        </Text>
      ),
    },
    {
      accessor: 'has_sales_report' as keyof IOverdueShipment,
      title: t('overdue.has_report'),
      width: 90,
      render: (record: IOverdueShipment) =>
        record.has_sales_report ? (
          <Text c="green" fw={600} size="sm">{t('overdue.yes')}</Text>
        ) : (
          <Text c="red" fw={600} size="sm">{t('overdue.no')}</Text>
        ),
    },
  ];

  // ── Early returns ──────────────────────────────────────────────────────────
  if (isError) {
    return (
      <Alert color="red" m="md">{t('overdue.error_load')}</Alert>
    );
  }

  // ── JSX ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '0 4px' }}>
      {/* Page Header */}
      <Group justify="space-between" align="flex-start" mb="lg">
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', color: '#1f1f1f', lineHeight: '1.3', display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconAlertTriangle style={{ color: '#ff4d4f', fontSize: 18 }} />
            {t('overdue.title')}
          </div>
          <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 2 }}>
            Satyldy emma hasabat iberilmedik ýükler
          </div>
        </div>
      </Group>

      {/* Summary cards */}
      <SimpleGrid cols={{ base: 1, sm: 3 }} mb="md">
        <StatCard
          title={t('overdue.total_overdue')}
          value={totalOverdue}
          color={totalOverdue > 0 ? 'red' : undefined}
        />
        <StatCard
          title={t('overdue.avg_days')}
          value={`${avgDays} ${t('overdue.days_unit')}`}
        />
        <StatCard
          title={t('overdue.critical')}
          value={criticalCount}
          color={criticalCount > 0 ? 'red' : undefined}
        />
      </SimpleGrid>

      {/* Threshold selector */}
      <Group mb="md" align="center" gap="xs">
        <Text c="dimmed" size="sm">{t('overdue.threshold')}:</Text>
        <SegmentedControl
          value={String(threshold)}
          data={THRESHOLD_OPTIONS.map((d) => ({
            label: t('overdue.days', { count: d }),
            value: String(d),
          }))}
          onChange={handleThresholdChange}
        />
      </Group>

      {/* Table */}
      <DataTable
        idAccessor="id"
        records={shipments}
        columns={columns}
        fetching={isLoading}
        onRowClick={({ record }) => navigate(`/shipments/${record.id}`)}
        noRecordsText={t('overdue.empty') ?? 'Maglumat ýok'}
        verticalSpacing="xs"
        styles={{ header: { backgroundColor: '#f5f5f5', fontSize: 13 } }}
      />
    </div>
  );
}
