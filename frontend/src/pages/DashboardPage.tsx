import { Alert, Button, Card, Col, Progress, Row, Space, Tag, Typography } from 'antd';
import { ProTable, type ProColumns } from '@ant-design/pro-components';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const { Text, Title } = Typography;

interface IStatItem {
  icon: string;
  color: string;
  iconColor: string;
  value: string;
  labelKey: string;
  trendKey: string;
  trendParams?: Record<string, string | number>;
  trendUp: boolean | null;
  onClick?: () => void;
}

interface IShipmentRow {
  code: string;
  customer: string;
  route: string;
  status: string;
  statusKey: string;
  weight: string;
  departed: string;
  location: string;
}

interface IRouteRow {
  flag: string;
  name: string;
  count: number;
  percent: number;
  color: string;
  sub: string;
}

const STATUS_COLORS: Record<string, string> = {
  transit: 'cyan',
  border: 'purple',
  selling: 'orange',
  loading: 'blue',
  completed: 'green',
};

export default function DashboardPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const stats: IStatItem[] = [
    {
      icon: '📦',
      color: '#e6f4ff',
      iconColor: '#1677ff',
      value: '983',
      labelKey: 'dashboard.stat_total',
      trendKey: 'dashboard.trend_this_week',
      trendParams: { count: 47 },
      trendUp: true,
      onClick: () => navigate('/export/shipments'),
    },
    {
      icon: '🚛',
      color: '#e6fffb',
      iconColor: '#13c2c2',
      value: '296',
      labelKey: 'dashboard.stat_transit',
      trendKey: 'dashboard.trend_moving',
      trendUp: null,
    },
    {
      icon: '🛒',
      color: '#fffbe6',
      iconColor: '#faad14',
      value: '9',
      labelKey: 'dashboard.stat_selling',
      trendKey: 'dashboard.trend_at_market',
      trendUp: null,
    },
    {
      icon: '✅',
      color: '#f6ffed',
      iconColor: '#52c41a',
      value: '173',
      labelKey: 'dashboard.stat_sold',
      trendKey: 'dashboard.trend_this_week',
      trendParams: { count: 12 },
      trendUp: true,
    },
    {
      icon: '⚠️',
      color: '#fff2f0',
      iconColor: '#ff4d4f',
      value: '90',
      labelKey: 'dashboard.stat_no_report',
      trendKey: 'dashboard.trend_awaiting',
      trendUp: false,
    },
    {
      icon: '📐',
      color: '#f9f0ff',
      iconColor: '#722ed1',
      value: '16',
      labelKey: 'dashboard.stat_firms',
      trendKey: 'dashboard.trend_tracking_quota',
      trendUp: null,
      onClick: () => navigate('/export/quota'),
    },
  ];

  const activeShipments: IShipmentRow[] = [
    {
      code: '26FV047/25',
      customer: 'Begjan',
      route: '🇰🇿 Şimkent',
      status: 'transit',
      statusKey: 'dashboard.status_transit',
      weight: '18,400',
      departed: '25.02 14:30',
      location: 'Farap Postta',
    },
    {
      code: '26FV048/25',
      customer: 'Berik',
      route: '🇰🇿 Astana',
      status: 'transit',
      statusKey: 'dashboard.status_transit',
      weight: '19,200',
      departed: '25.02 16:10',
      location: 'Özbegistanda',
    },
    {
      code: '25FV040/25',
      customer: 'YGT Gapy Satyş',
      route: '🇷🇺 Moskwa',
      status: 'border',
      statusKey: 'dashboard.status_border',
      weight: '17,800',
      departed: '24.02 09:20',
      location: 'Garabogaz',
    },
    {
      code: '25FV039/25',
      customer: 'Eldar',
      route: '🇷🇺 Moskwa',
      status: 'selling',
      statusKey: 'dashboard.status_selling',
      weight: '18,900',
      departed: '20.02 10:00',
      location: 'Moskwada',
    },
    {
      code: '26FV046/25',
      customer: 'Begjan',
      route: '🇰🇿 Karaganda',
      status: 'loading',
      statusKey: 'dashboard.status_loading',
      weight: '—',
      departed: '—',
      location: 'Teplisa',
    },
  ];

  const routes: IRouteRow[] = [
    {
      flag: '🇰🇿',
      name: 'Gazagystan',
      count: 474,
      percent: 48,
      color: '#1677ff',
      sub: 'Şimkent: 166 · Astana: 117 · Almaty: 96 · Karaganda: 95',
    },
    {
      flag: '🇷🇺',
      name: 'Rossiya',
      count: 371,
      percent: 38,
      color: '#52c41a',
      sub: 'Gapy Satyş: 225 · Moskwa: 84 · Nowosibirsk: 62',
    },
    { flag: '🇺🇿', name: 'Özbegistan', count: 26, percent: 3, color: '#faad14', sub: '' },
    { flag: '🇧🇾', name: 'Belarusiya', count: 3, percent: 1, color: '#ff4d4f', sub: '' },
  ];

  const shipmentColumns: ProColumns<IShipmentRow>[] = [
    {
      title: t('dashboard.col_code'),
      dataIndex: 'code',
      search: false,
      sorter: (a, b) => a.code.localeCompare(b.code),
      render: (_, r) => (
        <span style={{ color: '#1677ff', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
          {r.code}
        </span>
      ),
    },
    {
      title: t('dashboard.col_customer'),
      dataIndex: 'customer',
      search: false,
      responsive: ['md'],
      sorter: (a, b) => a.customer.localeCompare(b.customer),
    },
    {
      title: t('dashboard.col_route'),
      dataIndex: 'route',
      search: false,
      responsive: ['md'],
      sorter: (a, b) => a.route.localeCompare(b.route),
    },
    {
      title: t('dashboard.col_status'),
      dataIndex: 'statusKey',
      search: false,
      render: (_, r) => (
        <Tag color={STATUS_COLORS[r.status] ?? 'default'}>
          {t(r.statusKey)}
        </Tag>
      ),
    },
    {
      title: t('dashboard.col_weight'),
      dataIndex: 'weight',
      search: false,
      responsive: ['md'],
      render: (_, r) => (
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.weight}</span>
      ),
    },
    {
      title: t('dashboard.col_departed'),
      dataIndex: 'departed',
      search: false,
      responsive: ['md'],
      render: (_, r) => (
        <span style={{ fontVariantNumeric: 'tabular-nums', color: '#8c8c8c' }}>
          {r.departed}
        </span>
      ),
    },
    {
      title: t('dashboard.col_location'),
      dataIndex: 'location',
      search: false,
    },
  ];

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <Title level={4} style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}>
            {t('dashboard.title')}
          </Title>
          <Text type="secondary">{t('dashboard.subtitle')}</Text>
        </div>
        <Space size="small">
          <Button>{t('dashboard.btn_export_excel')}</Button>
          <Button type="primary" onClick={() => navigate('/export/shipments')}>
            {t('dashboard.btn_new_shipment')}
          </Button>
        </Space>
      </Space>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {stats.map((stat, i) => (
          <Col key={i} xs={12} sm={8} xl={4}>
            <Card
              style={{
                borderRadius: 12,
                cursor: stat.onClick ? 'pointer' : 'default',
                height: '100%',
              }}
              bodyStyle={{ padding: 16 }}
              onClick={stat.onClick}
              hoverable={!!stat.onClick}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                <div
                  aria-hidden="true"
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    background: stat.color,
                    color: stat.iconColor,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 20,
                    flexShrink: 0,
                  }}
                >
                  {stat.icon}
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 28,
                      fontWeight: 700,
                      lineHeight: 1.2,
                      letterSpacing: '-0.02em',
                      color: stat.trendUp === false ? '#ff4d4f' : undefined,
                    }}
                  >
                    {stat.value}
                  </div>
                  <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 2 }}>
                    {t(stat.labelKey)}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      marginTop: 4,
                      color:
                        stat.trendUp === true
                          ? '#52c41a'
                          : stat.trendUp === false
                            ? '#ff4d4f'
                            : '#8c8c8c',
                    }}
                  >
                    {t(stat.trendKey, stat.trendParams)}
                  </div>
                </div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={12}>
          <Card style={{ borderRadius: 12, height: '100%' }} bodyStyle={{ padding: 16 }}>
            <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }}>
              <Text strong>⚡ {t('dashboard.alerts_title')}</Text>
              <Tag color="red">4</Tag>
            </Space>
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Alert type="error" message={<strong>{t('dashboard.alert_no_report', { count: 90 })}</strong>} />
              <Alert type="warning" message={<strong>{t('dashboard.alert_quota_exceeded')}</strong>} />
              <Alert type="warning" message={<strong>{t('dashboard.alert_doc_deadline', { count: 8 })}</strong>} />
              <Alert type="info" message={<strong>{t('dashboard.alert_weekly_plan', { week: 22, tons: 340, blocks: 15 })}</strong>} />
            </Space>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card style={{ borderRadius: 12, height: '100%' }} bodyStyle={{ padding: 16 }}>
            <Text strong style={{ display: 'block', marginBottom: 16 }}>📊 {t('dashboard.routes_title')}</Text>
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              {routes.map((r, i) => (
                <div key={i}>
                  <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text style={{ fontSize: 13, fontWeight: 500 }}>
                      {r.flag} {r.name}
                    </Text>
                    <Text style={{ fontSize: 13, fontWeight: 600 }}>{r.count} {t('dashboard.shipment_suffix')}</Text>
                  </Space>
                  <Progress percent={r.percent} size="small" strokeColor={r.color} showInfo={false} />
                  {r.sub && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {r.sub}
                    </Text>
                  )}
                </div>
              ))}
            </Space>
          </Card>
        </Col>
      </Row>

      <Card style={{ borderRadius: 12 }} bodyStyle={{ padding: 0 }}>
        <Space style={{ width: '100%', justifyContent: 'space-between', padding: '12px 16px' }}>
          <Text strong>🚛 {t('dashboard.active_shipments')}</Text>
          <Button size="small" type="link" onClick={() => navigate('/export/shipments')}>
            {t('dashboard.view_all')}
          </Button>
        </Space>
        <ProTable<IShipmentRow>
          rowKey="code"
          dataSource={activeShipments}
          columns={shipmentColumns}
          search={false}
          options={false}
          pagination={false}
          size="small"
          onRow={() => ({
            onClick: () => navigate('/export/shipments'),
            style: { cursor: 'pointer' },
          })}
          locale={{ emptyText: t('dashboard.no_data') }}
        />
      </Card>
    </div>
  );
}
