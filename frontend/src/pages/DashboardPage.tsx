import { Alert, Badge, Button, Card, Group, Progress, SimpleGrid, Text, Title } from '@mantine/core';
import { DataTable } from 'mantine-datatable';
import { useNavigate } from 'react-router-dom';

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
  border: 'violet',
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
      <Group justify="space-between" align="flex-start" mb="lg">
        <div>
          <Title order={4} style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}>
            Dashboard
          </Title>
          <Text c="dimmed" size="sm">
            Tomato eksport operasiýalarynyň umumy görnüşi — 2025/2026 möwsüm
          </Text>
        </div>
        <Group gap="xs">
          <Button variant="default">📥 Excel eksport</Button>
          <Button onClick={() => navigate('/export/shipments')}>
            ➕ Täze ýük
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
        ))}
      </SimpleGrid>

      {/* Alerts + Routes */}
      <SimpleGrid cols={{ base: 1, lg: 2 }} mb="lg">
        <Card style={{ borderRadius: 12 }} padding="md">
          <Group justify="space-between" mb="sm">
            <Text fw={600}>⚡ Möhüm bildirişler</Text>
            <Badge color="red">4</Badge>
          </Group>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Alert color="red">
              <strong>90 hasabat gelmedi</strong> — satyldy emma hasabat iberilmedi. Arap bilen
              habarlaşyň.
            </Alert>
            <Alert color="yellow">
              <strong>Kwota aşdy</strong> — Yigit H.J: Döwür 3 = -2,603,000 kg. Düzetme zerur.
            </Alert>
            <Alert color="yellow">
              <strong>Dokument möhlet</strong> — 13:00 çenli 8 ýük üçin dokument taýýar bolmaly.
            </Alert>
            <Alert color="blue">
              <strong>Hepdäniň meýilnamasy</strong> — 22-nji hepde: meýilleşdirilen 340 tonna,
              15 blok.
            </Alert>
          </div>
        </Card>

        <Card style={{ borderRadius: 12 }} padding="md">
          <Text fw={600} mb="md">📊 Ugurlar boýunça</Text>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {routes.map((r, i) => (
              <div key={i}>
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}
                >
                  <Text size="sm" fw={500}>
                    {r.flag} {r.name}
                  </Text>
                  <Text size="sm" fw={600}>{r.count} ýük</Text>
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
          <Text fw={600}>🚛 Häzirki hereket edýän ýükler</Text>
          <Button size="xs" variant="subtle" onClick={() => navigate('/export/shipments')}>
            Hemmesini gör →
          </Button>
        </Group>
        <DataTable
          idAccessor="code"
          records={activeShipments}
          columns={[
            {
              accessor: 'code',
              title: 'Kod',
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
            { accessor: 'customer', title: 'Müşderi' },
            { accessor: 'route', title: 'Ugur' },
            {
              accessor: 'statusText',
              title: 'Status',
              render: (r) => (
                <Badge variant="light" color={STATUS_COLORS[r.status] ?? 'gray'}>
                  {r.statusText}
                </Badge>
              ),
            },
            {
              accessor: 'weight',
              title: 'Agram (kg)',
              render: (r) => (
                <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>{r.weight}</span>
              ),
            },
            {
              accessor: 'departed',
              title: 'Ýola çykdy',
              render: (r) => (
                <span style={{ fontFamily: 'var(--font-mono, monospace)', color: '#8c8c8c' }}>
                  {r.departed}
                </span>
              ),
            },
            { accessor: 'location', title: 'Ýerleşýän ýeri' },
          ]}
          onRowClick={() => navigate('/export/shipments')}
          noRecordsText="Maglumat ýok"
          verticalSpacing="xs"
          styles={{ header: { backgroundColor: '#f5f5f5', fontSize: 13 } }}
        />
      </Card>
    </div>
  );
}
