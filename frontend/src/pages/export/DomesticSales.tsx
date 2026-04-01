import { Row, Col, Statistic, Alert, Card } from 'antd';
import { ShopOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import { useDomesticSales } from '@/hooks/usePlanning';
import type { IDomesticSale } from '@/types';

function fmtKg(val: number): string {
  return Number(val).toLocaleString();
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
      valueType: 'date',
    },
    {
      title: t('domestic_sales.buyer'),
      dataIndex: 'buyer_name',
      width: 120,
    },
    {
      title: t('domestic_sales.block'),
      dataIndex: 'block_code',
      width: 80,
      render: (_, record) => record.block_code,
    },
    {
      title: t('domestic_sales.variety'),
      dataIndex: 'variety',
      width: 110,
      render: (val: unknown) =>
        val ? String(val) : <span style={{ color: '#bfbfbf' }}>—</span>,
    },
    {
      title: t('domestic_sales.weight_kg'),
      dataIndex: 'weight_kg',
      align: 'right',
      width: 120,
      render: (val: unknown) => fmtKg(val as number),
    },
    {
      title: t('domestic_sales.price_per_kg'),
      dataIndex: 'price_per_kg',
      align: 'right',
      width: 100,
      render: (val: unknown) =>
        val != null ? `$${Number(val).toFixed(2)}` : <span style={{ color: '#bfbfbf' }}>—</span>,
    },
    {
      title: t('domestic_sales.tabel_no'),
      dataIndex: 'tabel_no',
      width: 100,
      render: (val: unknown) =>
        val ? String(val) : <span style={{ color: '#bfbfbf' }}>—</span>,
    },
    {
      title: t('domestic_sales.firm'),
      dataIndex: 'export_firm_name',
      render: (val: unknown) =>
        val ? String(val) : <span style={{ color: '#bfbfbf' }}>—</span>,
    },
  ];

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', color: '#1f1f1f', lineHeight: '1.3', display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShopOutlined style={{ fontSize: 18, color: '#1677ff' }} />
            {t('domestic_sales.title')}
          </div>
          <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 2 }}>
            Içerki bazar satyw hasabaty
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {/* action buttons */}
        </div>
      </div>

      <Row gutter={[16, 12]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic
              title={t('domestic_sales.total_sales')}
              value={rows.length}
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8}>
          <Card size="small">
            <Statistic
              title={t('domestic_sales.total_weight')}
              value={fmtKg(totalWeight)}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8}>
          <Card size="small">
            <Statistic
              title={t('domestic_sales.unique_buyers')}
              value={uniqueBuyers}
            />
          </Card>
        </Col>
      </Row>

      {isError && (
        <Alert
          type="error"
          message={t('domestic_sales.error_load')}
          style={{ marginBottom: 16 }}
        />
      )}

      <ProTable<IDomesticSale>
        rowKey="id"
        dataSource={rows}
        columns={columns}
        loading={isLoading}
        search={false}
        options={false}
        pagination={{ pageSize: 50, showSizeChanger: true }}
        size="small"
        scroll={{ x: 700 }}
        locale={{ emptyText: t('domestic_sales.empty') }}
        headerTitle={false}
      />
    </div>
  );
}
