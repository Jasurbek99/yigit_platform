import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Card, Empty, Flex, Skeleton, Tag, Typography } from 'antd';
import type { EChartsOption } from 'echarts';
import { EChart } from '@/components/EChart';
import {
  useClientsReport,
  type IClientsReportRow,
  type IClientsReportBreakdown,
} from '@/hooks/useClientsReport';
import { ClientsMatrixTable } from './ClientsMatrixTable';

const { Title, Text } = Typography;

const PALETTE = [
  '#1677ff', '#52c41a', '#fa8c16', '#722ed1', '#13c2c2', '#eb2f96',
  '#faad14', '#2f54eb', '#a0d911', '#fa541c', '#1890ff', '#9254de',
];

function pieOption(items: { name: string; value: number }[], title: string): EChartsOption {
  return {
    color: PALETTE,
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { type: 'scroll', orient: 'horizontal', bottom: 0, textStyle: { fontSize: 11 } },
    series: [
      {
        name: title,
        type: 'pie',
        radius: ['38%', '68%'],
        center: ['50%', '44%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: '#fff', borderWidth: 1 },
        label: { show: false },
        data: items,
      },
    ],
  };
}

/** Doughnut data — trucks per customer, aggregated across countries. */
function customerTrucks(rows: IClientsReportRow[]): { name: string; value: number }[] {
  const byName = new Map<string, number>();
  for (const r of rows) {
    byName.set(r.customer_name, (byName.get(r.customer_name) ?? 0) + r.total_trucks);
  }
  return [...byName.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

const toPie = (rows: IClientsReportBreakdown[]) =>
  rows.map((r) => ({ name: r.name, value: r.trucks }));

export default function ClientsReport() {
  const { t } = useTranslation();
  const query = useClientsReport();
  const data = query.data;

  const clientPie = useMemo(() => (data ? customerTrucks(data.clients) : []), [data]);
  const countryPie = useMemo(() => (data ? toPie(data.by_country) : []), [data]);
  const cityPie = useMemo(() => (data ? toPie(data.by_city) : []), [data]);

  const cardStyle = { borderRadius: 8, border: '1px solid #f0f0f0' } as const;

  return (
    <div>
      <Flex justify="space-between" align="flex-start" wrap="wrap" gap={12} style={{ marginBottom: 20 }}>
        <div>
          <Title level={4} style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
            {t('clients_report.title')}
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {t('clients_report.subtitle')}
          </Text>
        </div>
        {data?.season && <Tag color="blue">{data.season.name}</Tag>}
      </Flex>

      {query.isError ? (
        <Alert type="error" showIcon message={t('common.error')} />
      ) : query.isLoading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : !data?.season ? (
        <Empty description={t('clients_report.no_season')} />
      ) : (
          <Flex vertical gap={16}>
            {/* Matrix table */}
            <Card
              size="small"
              title={<Text strong style={{ fontSize: 14 }}>{t('clients_report.matrix_title')}</Text>}
              style={cardStyle}
              styles={{ body: { padding: 0 } }}
            >
              <ClientsMatrixTable rows={data.clients} months={data.months} totals={data.totals} />
            </Card>

            {/* Charts row */}
            <div
              style={{
                display: 'grid',
                gap: 16,
                gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              }}
            >
              <ChartCard title={t('clients_report.chart_by_client')} loading={query.isLoading}
                option={pieOption(clientPie, t('clients_report.chart_by_client'))} />
              <ChartCard title={t('clients_report.chart_by_country')} loading={query.isLoading}
                option={pieOption(countryPie, t('clients_report.chart_by_country'))} />
              <ChartCard title={t('clients_report.chart_by_city')} loading={query.isLoading}
                option={pieOption(cityPie, t('clients_report.chart_by_city'))} />
            </div>
          </Flex>
      )}
    </div>
  );
}

interface IChartCardProps {
  title: string;
  option: EChartsOption;
  loading: boolean;
}

function ChartCard({ title, option, loading }: IChartCardProps) {
  return (
    <Card
      size="small"
      title={<Text strong style={{ fontSize: 14 }}>{title}</Text>}
      style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}
    >
      {loading ? <Skeleton active paragraph={{ rows: 5 }} /> : <EChart option={option} height={300} ariaLabel={title} />}
    </Card>
  );
}
