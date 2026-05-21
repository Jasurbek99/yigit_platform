import { Card, Button, Space, Tag } from 'antd';
import { ProTable, type ProColumns } from '@ant-design/pro-components';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { COLORS } from '@/constants/styles';
import type { IDashboardActiveShipment } from '@/hooks/useDashboardSummary';

interface IDashboardActiveShipmentsProps {
  shipments: IDashboardActiveShipment[];
}

// Phase codes from the API contract: PREP / DOCS / LOAD / TRANSIT / DEST / CLOSE
const PHASE_COLORS: Record<string, string> = {
  PREP: 'default',
  DOCS: 'purple',
  LOAD: 'blue',
  TRANSIT: 'cyan',
  DEST: 'orange',
  CLOSE: 'green',
};

function formatDeparted(value: string | null): string {
  if (!value) return '—';
  return dayjs(value).format('DD.MM HH:mm');
}

export function DashboardActiveShipments({ shipments }: IDashboardActiveShipmentsProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const columns: ProColumns<IDashboardActiveShipment>[] = [
    {
      title: t('dashboard.col_code'),
      dataIndex: 'cargo_code',
      search: false,
      sorter: (a, b) => a.cargo_code.localeCompare(b.cargo_code),
      render: (_, r) => (
        <span style={{ color: COLORS.primary, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
          {r.cargo_code}
        </span>
      ),
    },
    {
      title: t('dashboard.col_customer'),
      dataIndex: 'customer_name',
      search: false,
      responsive: ['md'],
      sorter: (a, b) => a.customer_name.localeCompare(b.customer_name),
    },
    {
      title: t('dashboard.col_route'),
      dataIndex: 'country_name',
      search: false,
      responsive: ['md'],
      sorter: (a, b) =>
        `${a.country_name} ${a.city_name}`.localeCompare(`${b.country_name} ${b.city_name}`),
      render: (_, r) => `${r.country_name}${r.city_name ? ` · ${r.city_name}` : ''}`,
    },
    {
      title: t('dashboard.col_status'),
      dataIndex: 'status_display',
      search: false,
      render: (_, r) => (
        <Tag color={PHASE_COLORS[r.phase] ?? 'default'}>{r.status_display}</Tag>
      ),
    },
    {
      title: t('dashboard.col_weight'),
      dataIndex: 'weight_net',
      search: false,
      responsive: ['md'],
      render: (_, r) => (
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {r.weight_net != null ? r.weight_net.toLocaleString() : '—'}
        </span>
      ),
    },
    {
      title: t('dashboard.col_departed'),
      dataIndex: 'departed_at',
      search: false,
      responsive: ['md'],
      render: (_, r) => (
        <span style={{ fontVariantNumeric: 'tabular-nums', color: COLORS.textSecondary }}>
          {formatDeparted(r.departed_at)}
        </span>
      ),
    },
    {
      title: t('dashboard.col_location'),
      dataIndex: 'location',
      search: false,
      render: (_, r) => r.location ?? '—',
    },
  ];

  return (
    <Card style={{ borderRadius: 12 }} styles={{ body: { padding: 0 } }}>
      <Space style={{ width: '100%', justifyContent: 'space-between', padding: '12px 16px' }}>
        <span style={{ fontWeight: 600 }}>🚛 {t('dashboard.active_shipments')}</span>
        <Button size="small" type="link" onClick={() => navigate('/export/shipments')}>
          {t('dashboard.view_all')}
        </Button>
      </Space>
      <ProTable<IDashboardActiveShipment>
        rowKey="id"
        dataSource={shipments}
        columns={columns}
        search={false}
        options={false}
        pagination={false}
        size="small"
        onRow={(r) => ({
          onClick: () => navigate(`/shipments/${r.id}`),
          style: { cursor: 'pointer' },
        })}
        locale={{ emptyText: t('dashboard.no_data') }}
      />
    </Card>
  );
}
