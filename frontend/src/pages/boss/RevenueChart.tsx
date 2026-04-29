import { useTranslation } from 'react-i18next';
import { Card, Skeleton, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { EChartsOption } from 'echarts';
import { EChart } from '@/components/EChart';
import type { BossPeriod } from '@/hooks/useBossDashboard';
import { useBossRevenue } from '@/hooks/useBossDashboard';

const { Text } = Typography;

interface IRevenueChartProps {
  period: BossPeriod;
}

export function RevenueChart({ period }: IRevenueChartProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isLoading } = useBossRevenue(period);

  const handleClick = (params: unknown) => {
    const p = params as { name?: string };
    if (p?.name) {
      navigate(`/export/shipments?from=${p.name}`);
    }
  };

  const option: EChartsOption = data
    ? {
        tooltip: {
          trigger: 'axis',
        },
        legend: {
          data: [t('boss_dashboard.section.revenue'), t('boss_dashboard.prev_season')],
          bottom: 0,
          textStyle: { fontSize: 12 },
        },
        grid: { left: 48, right: 12, top: 12, bottom: 36 },
        xAxis: {
          type: 'category',
          data: data.current_season.map((p) => p.week_start),
          axisLabel: { fontSize: 11 },
          boundaryGap: false,
        },
        yAxis: {
          type: 'value',
          axisLabel: {
            fontSize: 11,
            formatter: (v: number) => `$${(v / 1000).toFixed(0)}k`,
          },
          splitLine: { lineStyle: { color: '#f0f0f0' } },
        },
        series: [
          {
            name: t('boss_dashboard.section.revenue'),
            type: 'line',
            data: data.current_season.map((p) => p.total_usd),
            smooth: true,
            symbol: 'circle',
            symbolSize: 4,
            lineStyle: { color: '#1677ff', width: 2.5 },
            areaStyle: {
              color: {
                type: 'linear',
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [
                  { offset: 0, color: 'rgba(22,119,255,0.2)' },
                  { offset: 1, color: 'rgba(22,119,255,0.01)' },
                ],
              },
            },
          },
          {
            name: t('boss_dashboard.prev_season'),
            type: 'line',
            data: data.previous_season.map((p) => p.total_usd),
            smooth: true,
            symbol: 'none',
            lineStyle: { color: '#8c8c8c', width: 1.5, type: 'dashed' },
          },
        ],
      }
    : {};

  return (
    <Card
      size="small"
      title={<Text strong style={{ fontSize: 14 }}>{t('boss_dashboard.section.revenue')}</Text>}
      style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}
    >
      {isLoading ? (
        <Skeleton active paragraph={{ rows: 5 }} />
      ) : (
        <EChart
          option={option}
          height={240}
          onEvents={{ click: handleClick }}
        />
      )}
    </Card>
  );
}
