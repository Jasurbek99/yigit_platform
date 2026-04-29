import { useTranslation } from 'react-i18next';
import { Card, Skeleton, Table, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { BossPeriod, IBossCustomerRow } from '@/hooks/useBossDashboard';
import { useBossTopCustomers } from '@/hooks/useBossDashboard';

const { Text } = Typography;

interface ITopCustomersProps {
  period: BossPeriod;
}

export function TopCustomers({ period }: ITopCustomersProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isLoading } = useBossTopCustomers(period);

  // Combine top customers + a synthetic "rest" row aggregating the long tail.
  const top = data?.top ?? [];
  const restAgg = data?.rest;
  const rows: IBossCustomerRow[] = [
    ...top,
    ...(restAgg && restAgg.customer_count > 0
      ? [{
          customer_id: -1,
          customer_name: t('boss_dashboard.top_customers.rest', { n: restAgg.customer_count }),
          country_name: '',
          trucks: restAgg.trucks,
          revenue_usd: restAgg.revenue_usd,
          yoy_pct: null,
          is_rest: true,
        }]
      : []),
  ];

  const columns = [
    {
      title: t('boss_dashboard.top_customers.col_customer'),
      dataIndex: 'customer_name',
      key: 'customer_name',
      render: (_: string, row: IBossCustomerRow) => (
        <Text style={{ fontSize: 13, fontWeight: row.is_rest ? 400 : 500, color: row.is_rest ? '#8c8c8c' : undefined }}>
          {row.customer_name}
          {row.country_name && !row.is_rest && (
            <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>· {row.country_name}</Text>
          )}
        </Text>
      ),
    },
    {
      title: t('boss_dashboard.top_customers.col_trucks'),
      dataIndex: 'trucks',
      key: 'trucks',
      align: 'right' as const,
      render: (v: number) => <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{v}</Text>,
    },
    {
      title: t('boss_dashboard.top_customers.col_revenue'),
      dataIndex: 'revenue_usd',
      key: 'revenue_usd',
      align: 'right' as const,
      render: (v: number) => (
        <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>${(v / 1000).toFixed(0)}k</Text>
      ),
    },
    {
      title: t('boss_dashboard.top_customers.col_yoy'),
      dataIndex: 'yoy_pct',
      key: 'yoy_pct',
      align: 'right' as const,
      render: (v: number | null) => {
        if (v === null) return <Text type="secondary">—</Text>;
        const color = v >= 0 ? '#52c41a' : '#ff4d4f';
        const prefix = v >= 0 ? '+' : '';
        return <Text style={{ fontSize: 12, color }}>{prefix}{v.toFixed(1)}%</Text>;
      },
    },
  ];

  return (
    <Card
      size="small"
      title={<Text strong style={{ fontSize: 14 }}>{t('boss_dashboard.section.top_customers')}</Text>}
      style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}
    >
      {isLoading ? (
        <Skeleton active paragraph={{ rows: 5 }} />
      ) : (
        <Table
          dataSource={rows}
          columns={columns}
          rowKey={(r) => String(r.customer_id)}
          size="small"
          pagination={false}
          scroll={{ y: 240 }}
          onRow={(row) => ({
            onClick: row.is_rest
              ? undefined
              : () => navigate(`/export/shipments?customer=${row.customer_id}`),
            style: { cursor: row.is_rest ? 'default' : 'pointer' },
          })}
        />
      )}
    </Card>
  );
}
