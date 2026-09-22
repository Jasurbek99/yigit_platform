import type { EChartsOption } from 'echarts';
import { CHART_PALETTE, COLORS } from '@/constants/styles';
import type { ITirHasabatGroup, ITirHasabatResponse } from '@/hooks/useTirHasabat';

/**
 * Pure helpers for `HasabatTab`. The panel layout is the sera-butce-web one
 * (App.jsx:15319); the chart styling is the platform's own — the palette the
 * Clients Report uses and the axis treatment of `TeamRankingChart`.
 */

export interface INamedRow {
  name: string;
  trucks: number;
  kg: number;
}

/** The source app's compact number (App.jsx:15384): 1.2M, 18K, 950. */
export function fmtK(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return String(Math.round(v));
}

/** Whole-percent share of `total`; 0 when there is no total to share. */
export function sharePct(kg: number, total: number): number {
  return total > 0 ? Math.round((kg / total) * 100) : 0;
}

/** 'YYYY-MM' → 'MM/YY', the source's axis label. */
export function monthLabel(key: string): string {
  const [year, month] = key.split('-');
  return `${month}/${year.slice(2)}`;
}

/** The first `limit` rows, with the no-value group relabelled. */
export function namedRows(group: ITirHasabatGroup, unknownLabel: string, limit = Infinity): INamedRow[] {
  return group.rows.slice(0, limit).map((r) => ({ ...r, name: r.name ?? unknownLabel }));
}

export const paletteColor = (i: number): string => CHART_PALETTE[i % CHART_PALETTE.length];

const kgText = (v: unknown): string => `${Math.round(Number(v)).toLocaleString('ru-RU')} kg`;

const valueAxisStyle = {
  splitLine: { lineStyle: { color: COLORS.border } },
  axisLabel: { color: COLORS.textSecondary, formatter: (v: number) => fmtK(v) },
};

const categoryAxisStyle = {
  axisLine: { lineStyle: { color: COLORS.borderLight } },
  axisTick: { show: false },
  axisLabel: { color: COLORS.textSecondary },
};

/**
 * One kg bar per month, labelled with kg and truck count ("100K · 1 tır").
 * Not the source's two bars on one kg scale (a count of 40 next to 700 000 kg
 * never leaves the baseline), and not a second right-hand scale either — tried
 * first, and one truck's bar then stood as tall as 100 000 kg, which read as
 * the same quantity.
 */
export function monthOption(
  byMonth: ITirHasabatResponse['by_month'],
  labels: { kg: string; bar: (month: ITirHasabatResponse['by_month'][number]) => string },
): EChartsOption {
  return {
    color: [paletteColor(1)],
    grid: { left: 8, right: 8, top: 28, bottom: 8 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: kgText },
    xAxis: { type: 'category', data: byMonth.map((m) => monthLabel(m.month)), ...categoryAxisStyle },
    yAxis: { type: 'value', ...valueAxisStyle },
    series: [
      {
        name: labels.kg,
        type: 'bar',
        data: byMonth.map((m) => m.kg),
        barMaxWidth: 36,
        itemStyle: { borderRadius: [4, 4, 0, 0] },
        label: {
          show: true,
          position: 'top',
          color: COLORS.textTertiary,
          formatter: (p: { dataIndex: number }) => labels.bar(byMonth[p.dataIndex]),
        },
      },
    ],
  };
}

/**
 * Doughnut with no built-in legend — the panel renders the source app's side
 * legend (swatch · name · %) next to it, coloured with `paletteColor(i)`.
 */
export function donutOption(rows: INamedRow[]): EChartsOption {
  return {
    color: [...CHART_PALETTE],
    tooltip: { trigger: 'item', valueFormatter: kgText },
    series: [
      {
        type: 'pie',
        radius: ['45%', '80%'],
        itemStyle: { borderColor: '#fff', borderWidth: 1 },
        label: { show: false },
        data: rows.map((r) => ({ name: r.name, value: r.kg })),
      },
    ],
  };
}

/** Chart height for `n` horizontal bars — the source's fixed 220px leaves two bars adrift. */
export const hbarHeight = (n: number): number => Math.max(140, n * 32 + 48);

/**
 * Horizontal ranking bars, heaviest on top. `multicolor` gives each bar its
 * own palette colour (the source's customer chart); otherwise one hue.
 */
export function hbarOption(rows: INamedRow[], multicolor: boolean): EChartsOption {
  const bars = rows.map((r, i) => ({
    name: r.name,
    value: r.kg,
    itemStyle: { color: multicolor ? paletteColor(i) : paletteColor(1) },
  }));
  bars.reverse();
  return {
    grid: { left: 8, right: 48, top: 8, bottom: 8 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: kgText },
    xAxis: { type: 'value', ...valueAxisStyle },
    yAxis: {
      type: 'category',
      data: bars.map((b) => b.name),
      ...categoryAxisStyle,
      axisLabel: { ...categoryAxisStyle.axisLabel, width: 110, overflow: 'truncate' },
    },
    series: [
      {
        type: 'bar',
        data: bars,
        barMaxWidth: 18,
        itemStyle: { borderRadius: [0, 4, 4, 0] },
        label: {
          show: true,
          position: 'right',
          color: COLORS.textSecondary,
          formatter: (p: { value?: unknown }) => fmtK(Number(p.value)),
        },
      },
    ],
  };
}
