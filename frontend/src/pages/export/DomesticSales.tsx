import { Alert, Card, SimpleGrid, Text } from '@mantine/core';
import { IconShoppingCart } from '@tabler/icons-react';
import { DataTable } from 'mantine-datatable';
import { useTranslation } from 'react-i18next';
import { useDomesticSales } from '@/hooks/usePlanning';
import type { IDomesticSale } from '@/types';

function fmtKg(val: number): string {
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

export default function DomesticSales() {
  const { t } = useTranslation();

  const { data, isLoading, isError } = useDomesticSales({});
  const rows = data?.results ?? [];

  const totalWeight = rows.reduce((s, r) => s + r.weight_kg, 0);
  const uniqueBuyers = new Set(rows.map((r) => r.buyer)).size;

  const columns = [
    {
      accessor: 'date' as keyof IDomesticSale,
      title: t('domestic_sales.date'),
      width: 110,
    },
    {
      accessor: 'buyer_name' as keyof IDomesticSale,
      title: t('domestic_sales.buyer'),
      width: 120,
    },
    {
      accessor: 'block_code' as keyof IDomesticSale,
      title: t('domestic_sales.block'),
      width: 80,
      render: (record: IDomesticSale) => record.block_code,
    },
    {
      accessor: 'variety' as keyof IDomesticSale,
      title: t('domestic_sales.variety'),
      width: 110,
      render: (record: IDomesticSale) =>
        record.variety
          ? String(record.variety)
          : <span style={{ color: '#bfbfbf' }}>—</span>,
    },
    {
      accessor: 'weight_kg' as keyof IDomesticSale,
      title: t('domestic_sales.weight_kg'),
      width: 120,
      render: (record: IDomesticSale) => fmtKg(record.weight_kg),
    },
    {
      accessor: 'price_per_kg' as keyof IDomesticSale,
      title: t('domestic_sales.price_per_kg'),
      width: 100,
      render: (record: IDomesticSale) =>
        record.price_per_kg != null
          ? `$${Number(record.price_per_kg).toFixed(2)}`
          : <span style={{ color: '#bfbfbf' }}>—</span>,
    },
    {
      accessor: 'tabel_no' as keyof IDomesticSale,
      title: t('domestic_sales.tabel_no'),
      width: 100,
      render: (record: IDomesticSale) =>
        record.tabel_no
          ? String(record.tabel_no)
          : <span style={{ color: '#bfbfbf' }}>—</span>,
    },
    {
      accessor: 'export_firm_name' as keyof IDomesticSale,
      title: t('domestic_sales.firm'),
      render: (record: IDomesticSale) =>
        record.export_firm_name
          ? String(record.export_firm_name)
          : <span style={{ color: '#bfbfbf' }}>—</span>,
    },
  ];

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', color: '#1f1f1f', lineHeight: '1.3', display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconShoppingCart size={18} color="#1677ff" />
            {t('domestic_sales.title')}
          </div>
          <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 2 }}>
            {t('domestic_sales.subtitle')}
          </div>
        </div>
      </div>

      <SimpleGrid cols={{ base: 1, sm: 3 }} mb="md">
        <StatCard
          title={t('domestic_sales.total_sales')}
          value={rows.length}
          color="blue"
        />
        <StatCard
          title={t('domestic_sales.total_weight')}
          value={fmtKg(totalWeight)}
        />
        <StatCard
          title={t('domestic_sales.unique_buyers')}
          value={uniqueBuyers}
        />
      </SimpleGrid>

      {isError && (
        <Alert color="red" mb="md">{t('domestic_sales.error_load')}</Alert>
      )}

      <DataTable
        idAccessor="id"
        records={rows}
        columns={columns}
        fetching={isLoading}
        noRecordsText={t('domestic_sales.empty') ?? 'Maglumat ýok'}
        verticalSpacing="xs"
        styles={{ header: { backgroundColor: '#f5f5f5', fontSize: 13 } }}
      />
    </div>
  );
}
