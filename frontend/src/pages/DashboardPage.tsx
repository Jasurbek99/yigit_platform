import { Alert, Badge, Button, Card, Group, Progress, SimpleGrid, Text, Title } from '@mantine/core';
import { DataTable } from 'mantine-datatable';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

interface StatItem {
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

interface ShipmentRow {
  code: string;
  customer: string;
  route: string;
  status: string;
  statusKey: string;
  weight: string;
  departed: string;
  location: string;
}

interface RouteRow {
  flag: string;
  name: string;
  count: number;
  percent: number;
  color: string;
  sub: string;
}

const STATUS_COLORS: Record<string, string> = {
  transit: 'cyan',
  border: 'violet',
  selling: 'orange',
  loading: 'blue',
  completed: 'green',
};

export default function DashboardPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const stats: StatItem[] = [
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

  const activeShipments: ShipmentRow[] = [
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

  const routes: RouteRow[] = [
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

  return (
    <div style={{ fontFamily: 'var(--font, "DM Sans", sans-serif)' }}>
      {/* Page Header */}
      <Group justify="space-between" align="flex-start" mb="lg">
        <div>
          <Title order={4} style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}>
            {t('dashboard.title')}
          </Title>
          <Text c="dimmed" size="sm">
            {t('dashboard.subtitle')}
          </Text>
        </div>
        <Group gap="xs">
          <Button variant="default">{t('dashboard.btn_export_excel')}</Button>
          <Button onClick={() => navigate('/export/shipments')}>
            {t('dashboard.btn_new_shipment')}
          </Button>
        </Group>
      </Group>

      {/* Stat Cards */}
      <SimpleGrid cols={{ base: 2, sm: 3, xl: 6 }} mb="lg">
        {stats.map((stat, i) => (
          <Card
            key={i}
            style={{
              borderRadius: 12,
              cursor: stat.onClick ? 'pointer' : 'default',
            }}
            padding="md"
            onClick={stat.onClick}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
              <div
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
        ))}
      </SimpleGrid>

      {/* Alerts + Routes */}
      <SimpleGrid cols={{ base: 1, lg: 2 }} mb="lg">
        <Card style={{ borderRadius: 12 }} padding="md">
          <Group justify="space-between" mb="sm">
            <Text fw={600}>⚡ {t('dashboard.alerts_title')}</Text>
            <Badge color="red">4</Badge>
          </Group>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Alert color="red">
              <strong>{t('dashboard.alert_no_report', { count: 90 })}</strong>
            </Alert>
            <Alert color="yellow">
              <strong>{t('dashboard.alert_quota_exceeded')}</strong>
            </Alert>
            <Alert color="yellow">
              <strong>{t('dashboard.alert_doc_deadline', { count: 8 })}</strong>
            </Alert>
            <Alert color="blue">
              <strong>{t('dashboard.alert_weekly_plan', { week: 22, tons: 340, blocks: 15 })}</strong>
            </Alert>
          </div>
        </Card>

        <Card style={{ borderRadius: 12 }} padding="md">
          <Text fw={600} mb="md">📊 {t('dashboard.routes_title')}</Text>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {routes.map((r, i) => (
              <div key={i}>
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}
                >
                  <Text size="sm" fw={500}>
                    {r.flag} {r.name}
                  </Text>
                  <Text size="sm" fw={600}>{r.count} {t('dashboard.shipment_suffix')}</Text>
                </div>
                <Progress value={r.percent} color={r.color} size="sm" />
                {r.sub && (
                  <Text c="dimmed" size="xs">
                    {r.sub}
                  </Text>
                )}
              </div>
            ))}
          </div>
        </Card>
      </SimpleGrid>

      {/* Active Shipments Table */}
      <Card style={{ borderRadius: 12 }} padding={0}>
        <Group justify="space-between" px="md" py="sm">
          <Text fw={600}>🚛 {t('dashboard.active_shipments')}</Text>
          <Button size="xs" variant="subtle" onClick={() => navigate('/export/shipments')}>
            {t('dashboard.view_all')}
          </Button>
        </Group>
        <DataTable
          idAccessor="code"
          records={activeShipments}
          columns={[
            {
              accessor: 'code',
              title: t('dashboard.col_code'),
              render: (r) => (
                <span
                  style={{
                    fontFamily: 'var(--font-mono, monospace)',
                    color: '#1677ff',
                    fontWeight: 600,
                  }}
                >
                  {r.code}
                </span>
              ),
            },
            { accessor: 'customer', title: t('dashboard.col_customer') },
            { accessor: 'route', title: t('dashboard.col_route') },
            {
              accessor: 'statusKey',
              title: t('dashboard.col_status'),
              render: (r) => (
                <Badge variant="light" color={STATUS_COLORS[r.status] ?? 'gray'}>
                  {t(r.statusKey)}
                </Badge>
              ),
            },
            {
              accessor: 'weight',
              title: t('dashboard.col_weight'),
              render: (r) => (
                <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>{r.weight}</span>
              ),
            },
            {
              accessor: 'departed',
              title: t('dashboard.col_departed'),
              render: (r) => (
                <span style={{ fontFamily: 'var(--font-mono, monospace)', color: '#8c8c8c' }}>
                  {r.departed}
                </span>
              ),
            },
            { accessor: 'location', title: t('dashboard.col_location') },
          ]}
          onRowClick={() => navigate('/export/shipments')}
          noRecordsText={t('dashboard.no_data')}
          verticalSpacing="xs"
          styles={{ header: { backgroundColor: '#f5f5f5', fontSize: 13 } }}
        />
      </Card>
    </div>
  );
}
