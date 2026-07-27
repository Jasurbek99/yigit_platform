// Horizontal ranking bar chart — single metric (completed) across users.
// Single hue (magnitude), no legend, direct value labels — per dataviz rules.

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

export function TeamRankingChart({ rows, max = DEFAULT_MAX }: ITeamRankingChartProps) {
  const { t } = useTranslation();
  // rows arrive sorted desc by completed; take the top `max`, then reverse
  // so the biggest bar sits at the TOP of a horizontal ECharts category axis.
  const top = useMemo(() => rows.slice(0, max).filter((r) => r.completed > 0), [rows, max]);
  const option = useMemo<EChartsOption>(() => {
    const data = [...top].reverse();
    return {
      grid: { left: 8, right: 40, top: 8, bottom: 8, containLabel: true },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: COLORS.border } },
        axisLabel: { color: COLORS.textSecondary },
      },
      yAxis: {
        type: 'category',
        data: data.map((r) => r.user_name),
        axisLine: { lineStyle: { color: COLORS.border } },
        axisLabel: { color: COLORS.textSecondary },
      },
      series: [{
        type: 'bar',
        data: data.map((r) => r.completed),
        itemStyle: { color: COLORS.primary, borderRadius: [0, 4, 4, 0] },
        barMaxWidth: 18,
        label: { show: true, position: 'right', color: COLORS.textSecondary },
      }],
    };
  }, [top]);

  return <EChart option={option} height={Math.max(120, top.length * 34)} ariaLabel={t('team_kpi.ranking_title')} />;
}
