import { describe, it, expect } from 'vitest';
import {
  fmtK,
  hbarOption,
  monthLabel,
  monthOption,
  namedRows,
  paletteColor,
  sharePct,
} from './HasabatTab.charts';

describe('HasabatTab.charts', () => {
  it('formats compact numbers the way the source app does', () => {
    expect(fmtK(950)).toBe('950');
    expect(fmtK(18_400)).toBe('18K');
    expect(fmtK(1_250_000)).toBe('1.3M');
  });

  it('returns a 0% share when the panel total is 0 instead of NaN', () => {
    expect(sharePct(0, 0)).toBe(0);
    expect(sharePct(8_000, 38_000)).toBe(21);
  });

  it('labels months as MM/YY', () => {
    expect(monthLabel('2026-02')).toBe('02/26');
  });

  it('relabels the no-value group and honours the limit', () => {
    const group = {
      rows: [
        { name: 'Kazakhstan', trucks: 2, kg: 30_000 },
        { name: null, trucks: 1, kg: 0 },
        { name: 'Russia', trucks: 1, kg: 0 },
      ],
      total_kg: 30_000,
    };
    expect(namedRows(group, 'Unknown', 2).map((r) => r.name)).toEqual(['Kazakhstan', 'Unknown']);
  });

  it('puts the heaviest bar on top and keeps each bar its own palette colour', () => {
    const rows = [
      { name: 'A', trucks: 2, kg: 30_000 },
      { name: 'B', trucks: 1, kg: 10_000 },
    ];
    const option = hbarOption(rows, true) as unknown as {
      yAxis: { data: string[] };
      series: { data: { name: string; itemStyle: { color: string } }[] }[];
    };
    // ECharts draws a category axis bottom-up, so the heaviest row goes last.
    expect(option.yAxis.data).toEqual(['B', 'A']);
    expect(option.series[0].data.map((d) => d.itemStyle.color)).toEqual([paletteColor(1), paletteColor(0)]);
  });

  it('draws one kg bar per month and writes the truck count on it', () => {
    const byMonth = [
      { month: '2026-08', trucks: 1, kg: 100_000 },
      { month: '2026-09', trucks: 3, kg: 54_300 },
    ];
    const option = monthOption(byMonth, {
      kg: 'Total kg',
      bar: (m) => `${fmtK(m.kg)} · ${m.trucks}`,
    }) as unknown as {
      yAxis: { type: string };
      series: { data: number[]; label: { formatter: (p: { dataIndex: number }) => string } }[];
    };
    // A single kg scale — a truck-count scale beside it read as the same quantity.
    expect(option.yAxis.type).toBe('value');
    expect(option.series).toHaveLength(1);
    expect(option.series[0].data).toEqual([100_000, 54_300]);
    expect(option.series[0].label.formatter({ dataIndex: 1 })).toBe('54K · 3');
  });
});
