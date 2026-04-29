import { useTranslation } from 'react-i18next';
import { Card, Skeleton, Table, Tooltip, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { BossPeriod, IBossRouteRow } from '@/hooks/useBossDashboard';
import { useBossRoutePnl } from '@/hooks/useBossDashboard';

const { Text } = Typography;

function MarginBar({ pct }: { pct: number }) {
  const color = pct >= 20 ? '#52c41a' : pct >= 10 ? '#faad14' : '#ff4d4f';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, background: '#f0f0f0', borderRadius: 2, height: 6 }}>
        <div style={{ width: `${Math.min(pct, 100)}%`, background: color, height: 6, borderRadius: 2 }} />
      </div>
      <Text style={{ fontSize: 12, color, minWidth: 36, textAlign: 'right' }}>{pct.toFixed(1)}%</Text>
    </div>
  );
}

interface IRoutePnlTableProps {
  period: BossPeriod;
}

export function RoutePnlTable({ period }: IRoutePnlTableProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isLoading } = useBossRoutePnl(period);

  const columns = [
    {
      title: t('boss_dashboard.route_pnl.col_route'),
      dataIndex: 'city',
      key: 'city',
      render: (_: string, row: IBossRouteRow) => (
        <Text style={{ fontSize: 13 }}>
          {row.city ? `${row.country_name} — ${row.city}` : row.country_name}
        </Text>
      ),
    },
    {
      title: t('boss_dashboard.route_pnl.col_trucks'),
      dataIndex: 'trucks',
      key: 'trucks',
      align: 'right' as const,
      render: (v: number) => <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{v}</Text>,
    },
    {
      title: t('boss_dashboard.route_pnl.col_revenue'),
      dataIndex: 'revenue_usd',
      key: 'revenue_usd',
      align: 'right' as const,
      render: (v: number) => (
        <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>${(v / 1000).toFixed(0)}k</Text>
      ),
    },
    {
      title: t('boss_dashboard.route_pnl.col_margin_pct'),
      dataIndex: 'margin_pct',
      key: 'margin_pct',
      width: 120,
      render: (v: number) => <MarginBar pct={v} />,
    },
  ];

  return (
    <Card
      size="small"
      title={<Text strong style={{ fontSize: 14 }}>{t('boss_dashboard.section.route_pnl')}</Text>}
      style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}
    >
      {isLoading ? (
        <Skeleton active paragraph={{ rows: 5 }} />
      ) : (
        <Tooltip title={t('boss_dashboard.route_pnl.click_hint')}>
          <Table
            dataSource={data?.rows ?? []}
            columns={columns}
            rowKey={(r) => `${r.country_id ?? 'x'}_${r.city_id ?? r.city}`}
            size="small"
            pagination={false}
            scroll={{ x: 'max-content', y: 220 }}
            onRow={(row) => ({
              onClick: () => {
                if (row.country_id == null) return;
                const params = new URLSearchParams({ country: String(row.country_id) });
                if (row.city) params.set('city', row.city);
                navigate(`/export/shipments?${params.toString()}`);
              },
              style: { cursor: row.country_id == null ? 'default' : 'pointer' },
            })}
          />
        </Tooltip>
      )}
    </Card>
  );
}
