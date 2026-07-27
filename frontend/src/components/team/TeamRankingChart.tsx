// Circular (radial) ranking chart — single metric (completed) across users.
// Bars radiate from a center hub, ordered clockwise from #1 at the top.
// Single hue (magnitude), no legend, direct value labels — per dataviz rules.
// Note: a radial layout trades some magnitude-comparison accuracy for shape;
// the on-bar value labels keep the exact counts unambiguous.

import { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import { useTranslation } from 'react-i18next';
import { EChart } from '@/components/EChart';
import { COLORS } from '@/constants/styles';
import type { ITeamKpiRow } from '@/types/teamKpi';

interface ITeamRankingChartProps {
  readonly rows: readonly ITeamKpiRow[];
  readonly max?: number;
}

const DEFAULT_MAX = 10;
const CHART_HEIGHT = 340;

export function TeamRankingChart({ rows, max = DEFAULT_MAX }: ITeamRankingChartProps) {
  const { t } = useTranslation();
  // rows arrive sorted desc by completed; take the top `max`. Keep that order so
  // the chart reads clockwise from #1 at the top (startAngle 90, clockwise).
  const top = useMemo(() => rows.slice(0, max).filter((r) => r.completed > 0), [rows, max]);

  const option = useMemo<EChartsOption>(() => ({
    tooltip: { trigger: 'item' },
    angleAxis: {
      type: 'category',
      data: top.map((r) => r.user_name),
      startAngle: 90,
      clockwise: true,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: COLORS.textSecondary, fontSize: 11 },
      z: 10,
    },
    radiusAxis: {
      type: 'value',
      min: 0,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
      splitLine: { lineStyle: { color: COLORS.border } },
    },
    polar: { center: ['50%', '50%'], radius: [24, '72%'] },
    series: [{
      type: 'bar',
      coordinateSystem: 'polar',
      data: top.map((r) => r.completed),
      itemStyle: { color: COLORS.primary, borderRadius: 4 },
      label: { show: true, position: 'middle', color: '#fff', fontSize: 11, fontWeight: 600 },
    }],
  }), [top]);

  return <EChart option={option} height={CHART_HEIGHT} ariaLabel={t('team_kpi.ranking_title')} />;
}
