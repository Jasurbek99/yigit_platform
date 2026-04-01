import { Card, Row, Col, Table, Tag, Progress, Alert, Button, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';

const { Title, Text } = Typography;

interface StatItem {
  icon: string;
  color: string;
  iconColor: string;
  value: string;
  label: string;
  trend: string;
  trendUp: boolean | null;
  onClick?: () => void;
}

interface ShipmentRow {
  code: string;
  customer: string;
  route: string;
  status: string;
  statusText: string;
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
  border: 'purple',
  selling: 'orange',
  loading: 'blue',
  completed: 'green',
};

export default function DashboardPage() {
  const navigate = useNavigate();

  const stats: StatItem[] = [
    {
      icon: '📦',
      color: '#e6f4ff',
      iconColor: '#1677ff',
      value: '983',
      label: 'Jemi ýükler',
      trend: '↑ 47 bu hepde',
      trendUp: true,
      onClick: () => navigate('/export/shipments'),
    },
    {
      icon: '🚛',
      color: '#e6fffb',
      iconColor: '#13c2c2',
      value: '296',
      label: 'Ýolda',
      trend: 'häzir hereket edýär',
      trendUp: null,
    },
    {
      icon: '🛒',
      color: '#fffbe6',
      iconColor: '#faad14',
      value: '9',
      label: 'Satylýar',
      trend: 'bazarda',
      trendUp: null,
    },
    {
      icon: '✅',
      color: '#f6ffed',
      iconColor: '#52c41a',
      value: '173',
      label: 'Satylyp gutardy',
      trend: '↑ 12 bu hepde',
      trendUp: true,
    },
    {
      icon: '⚠️',
      color: '#fff2f0',
      iconColor: '#ff4d4f',
      value: '90',
      label: 'Hasabat gelmedi',
      trend: 'garaşylýar',
      trendUp: false,
    },
    {
      icon: '📐',
      color: '#f9f0ff',
      iconColor: '#722ed1',
      value: '16',
      label: 'Eksport firmalar',
      trend: 'kwota yzarlaýar',
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
      statusText: 'Ýolda',
      weight: '18,400',
      departed: '25.02 14:30',
      location: 'Farap Postta',
    },
    {
      code: '26FV048/25',
      customer: 'Berik',
      route: '🇰🇿 Astana',
      status: 'transit',
      statusText: 'Ýolda',
      weight: '19,200',
      departed: '25.02 16:10',
      location: 'Özbegistanda',
    },
    {
      code: '25FV040/25',
      customer: 'YGT Gapy Satyş',
      route: '🇷🇺 Moskwa',
      status: 'border',
      statusText: 'Serhetde',
      weight: '17,800',
      departed: '24.02 09:20',
      location: 'Garabogaz',
    },
    {
      code: '25FV039/25',
      customer: 'Eldar',
      route: '🇷🇺 Moskwa',
      status: 'selling',
      statusText: 'Satylýar',
      weight: '18,900',
      departed: '20.02 10:00',
      location: 'Moskwada',
    },
    {
      code: '26FV046/25',
      customer: 'Begjan',
      route: '🇰🇿 Karaganda',
      status: 'loading',
      statusText: 'Ýüklenýär',
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
      <div
        style={{
          marginBottom: 24,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}
      >
        <div>
          <Title
            level={4}
            style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}
          >
            Dashboard
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            Tomato eksport operasiýalarynyň umumy görnüşi — 2025/2026 möwsüm
          </Text>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button>📥 Excel eksport</Button>
          <Button type="primary" onClick={() => navigate('/export/shipments')}>
            ➕ Täze ýük
          </Button>
        </div>
      </div>

      {/* Stat Cards */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {stats.map((stat, i) => (
          <Col key={i} xs={12} sm={8} xl={4}>
            <Card
              hoverable={!!stat.onClick}
              onClick={stat.onClick}
              style={{ borderRadius: 12, cursor: stat.onClick ? 'pointer' : 'default' }}
              styles={{ body: { padding: 20 } }}
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
                  <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 2 }}>{stat.label}</div>
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
                    {stat.trend}
                  </div>
                </div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      {/* Alerts + Routes */}
      <Row gutter={[24, 24]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={12}>
          <Card
            title={<span>⚡ Möhüm bildirişler</span>}
            extra={<Tag color="red">4</Tag>}
            style={{ borderRadius: 12 }}
            styles={{ body: { display: 'flex', flexDirection: 'column', gap: 8 } }}
          >
            <Alert
              type="error"
              showIcon
              message={
                <span>
                  <strong>90 hasabat gelmedi</strong> — satyldy emma hasabat iberilmedi. Arap bilen
                  habarlaşyň.
                </span>
              }
            />
            <Alert
              type="warning"
              showIcon
              message={
                <span>
                  <strong>Kwota aşdy</strong> — Yigit H.J: Döwür 3 = -2,603,000 kg. Düzetme zerur.
                </span>
              }
            />
            <Alert
              type="warning"
              showIcon
              message={
                <span>
                  <strong>Dokument möhlet</strong> — 13:00 çenli 8 ýük üçin dokument taýýar bolmaly.
                </span>
              }
            />
            <Alert
              type="info"
              showIcon
              message={
                <span>
                  <strong>Hepdäniň meýilnamasy</strong> — 22-nji hepde: meýilleşdirilen 340 tonna,
                  15 blok.
                </span>
              }
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="📊 Ugurlar boýunça" style={{ borderRadius: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {routes.map((r, i) => (
                <div key={i}>
                  <div
                    style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: 500 }}>
                      {r.flag} {r.name}
                    </Text>
                    <Text style={{ fontSize: 13, fontWeight: 600 }}>{r.count} ýük</Text>
                  </div>
                  <Progress percent={r.percent} strokeColor={r.color} showInfo={false} size="small" />
                  {r.sub && (
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {r.sub}
                    </Text>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </Col>
      </Row>

      {/* Active Shipments Table */}
      <Card
        title="🚛 Häzirki hereket edýän ýükler"
        extra={
          <Button size="small" onClick={() => navigate('/export/shipments')}>
            Hemmesini gör →
          </Button>
        }
        style={{ borderRadius: 12 }}
        styles={{ body: { padding: 0 } }}
      >
        <Table<ShipmentRow>
          dataSource={activeShipments}
          rowKey="code"
          size="small"
          pagination={false}
          onRow={() => ({
            onClick: () => navigate('/export/shipments'),
            style: { cursor: 'pointer' },
          })}
          columns={[
            {
              title: 'Kod',
              dataIndex: 'code',
              render: (v: string) => (
                <span
                  style={{
                    fontFamily: 'var(--font-mono, monospace)',
                    color: '#1677ff',
                    fontWeight: 600,
                  }}
                >
                  {v}
                </span>
              ),
            },
            { title: 'Müşderi', dataIndex: 'customer' },
            { title: 'Ugur', dataIndex: 'route' },
            {
              title: 'Status',
              dataIndex: 'statusText',
              render: (v: string, r: ShipmentRow) => (
                <Tag color={STATUS_COLORS[r.status]}>{v}</Tag>
              ),
            },
            {
              title: 'Agram (kg)',
              dataIndex: 'weight',
              render: (v: string) => (
                <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>{v}</span>
              ),
            },
            {
              title: 'Ýola çykdy',
              dataIndex: 'departed',
              render: (v: string) => (
                <span style={{ fontFamily: 'var(--font-mono, monospace)', color: '#8c8c8c' }}>
                  {v}
                </span>
              ),
            },
            { title: 'Ýerleşýän ýeri', dataIndex: 'location' },
          ]}
        />
      </Card>
    </div>
  );
}
