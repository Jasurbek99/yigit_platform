import { Alert, Card, Col, Row, Space, Typography } from 'antd';
import { ProTable, type ProColumns } from '@ant-design/pro-components';
import { IconShoppingCart } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { useDomesticSales } from '@/hooks/usePlanning';
import type { IDomesticSale } from '@/types';

const { Text } = Typography;

function fmtKg(val: number): string {
  return Number(val).toLocaleString();
}

function StatCard({ title, value, color }: { title: string; value: string | number; color?: string }) {
  return (
    <Card size="small">
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>{title}</Text>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
    </Card>
  );
}

export default function DomesticSales() {
  const { t } = useTranslation();

  const { data, isLoading, isError } = useDomesticSales({});
  const rows = data?.results ?? [];

  const totalWeight = rows.reduce((s, r) => s + r.weight_kg, 0);
  const uniqueBuyers = new Set(rows.map((r) => r.buyer)).size;

  const columns: ProColumns<IDomesticSale>[] = [
    {
      title: t('domestic_sales.date'),
      dataIndex: 'date',
      width: 110,
      search: false,
      sorter: (a, b) => a.date.localeCompare(b.date),
      defaultSortOrder: 'descend',
    },
    {
      title: t('domestic_sales.buyer'),
      dataIndex: 'buyer_name',
      width: 120,
      search: false,
      sorter: (a, b) => (a.buyer_name ?? '').localeCompare(b.buyer_name ?? ''),
    },
    {
      title: t('domestic_sales.block'),
      dataIndex: 'block_code',
      width: 80,
      search: false,
      responsive: ['md'],
      sorter: (a, b) => (a.block_code ?? '').localeCompare(b.block_code ?? ''),
    },
    {
      title: t('domestic_sales.variety'),
      dataIndex: 'variety',
      width: 110,
      search: false,
      responsive: ['md'],
      render: (_, record) =>
        record.variety
          ? String(record.variety)
          : <span style={{ color: '#bfbfbf' }}>—</span>,
    },
    {
      title: t('domestic_sales.weight_kg'),
      dataIndex: 'weight_kg',
      width: 120,
      search: false,
      sorter: (a, b) => a.weight_kg - b.weight_kg,
      render: (_, record) => fmtKg(record.weight_kg),
    },
    {
      title: t('domestic_sales.price_per_kg'),
      dataIndex: 'price_per_kg',
      width: 100,
      search: false,
      responsive: ['md'],
      sorter: (a, b) => Number(a.price_per_kg ?? 0) - Number(b.price_per_kg ?? 0),
      render: (_, record) =>
        record.price_per_kg != null
          ? `$${Number(record.price_per_kg).toFixed(2)}`
          : <span style={{ color: '#bfbfbf' }}>—</span>,
    },
    {
      title: t('domestic_sales.tabel_no'),
      dataIndex: 'tabel_no',
      width: 100,
      search: false,
      responsive: ['md'],
      render: (_, record) =>
        record.tabel_no
          ? String(record.tabel_no)
          : <span style={{ color: '#bfbfbf' }}>—</span>,
    },
    {
      title: t('domestic_sales.firm'),
      dataIndex: 'export_firm_name',
      search: false,
      responsive: ['md'],
      sorter: (a, b) => (a.export_firm_name ?? '').localeCompare(b.export_firm_name ?? ''),
      render: (_, record) =>
        record.export_firm_name
          ? String(record.export_firm_name)
          : <span style={{ color: '#bfbfbf' }}>—</span>,
    },
  ];

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', color: '#1f1f1f', lineHeight: '1.3', display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconShoppingCart size={18} color="#1677ff" />
            {t('domestic_sales.title')}
          </div>
          <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 2 }}>
            {t('domestic_sales.subtitle')}
          </div>
        </div>
      </Space>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={8}>
          <StatCard
            title={t('domestic_sales.total_sales')}
            value={rows.length}
            color="#1677ff"
          />
        </Col>
        <Col xs={24} sm={8}>
          <StatCard
            title={t('domestic_sales.total_weight')}
            value={fmtKg(totalWeight)}
          />
        </Col>
        <Col xs={24} sm={8}>
          <StatCard
            title={t('domestic_sales.unique_buyers')}
            value={uniqueBuyers}
          />
        </Col>
      </Row>

      {isError && (
        <Alert type="error" message={t('domestic_sales.error_load')} showIcon style={{ marginBottom: 16 }} />
      )}

      <ProTable<IDomesticSale>
        rowKey="id"
        dataSource={rows}
        columns={columns}
        loading={isLoading}
        search={false}
        options={false}
        size="small"
        pagination={{ pageSize: 50, showSizeChanger: false }}
        locale={{ emptyText: t('domestic_sales.empty') }}
      />
    </div>
  );
}
