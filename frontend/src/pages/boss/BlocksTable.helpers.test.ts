import { describe, it, expect } from 'vitest';
import { GRID_TEMPLATE, mergeBlockRows, sumTotals } from './BlocksTable.helpers';
import type { IBossProductionRow, IBossExportMarketRow } from '@/hooks/useBossDashboard';

function production(
  code: string,
  overrides: Partial<IBossProductionRow> = {},
): IBossProductionRow {
  return {
    block_code: code,
    block_name: `Block ${code}`,
    plan_kg: 0,
    actual_kg: 0,
    pct: 0,
    monthly_plan_kg: 0,
    monthly_actual_kg: 0,
    monthly_pct: 0,
    ...overrides,
  };
}

function exportRow(code: string, kg: number, pct: number): IBossExportMarketRow {
  return { block_code: code, export_kg: kg, export_pct: pct };
}

describe('GRID_TEMPLATE', () => {
  it('declares ten columns', () => {
    expect(GRID_TEMPLATE.match(/minmax/g)).toHaveLength(10);
  });

  it('gives every track a zero base size, never a bare fr', () => {
    // A bare `Nfr` means `minmax(auto, Nfr)`, so a track floors at its own
    // content's min-content width. The header, data and total rows are four
    // SEPARATE grid containers — with `auto` bases each would size from its own
    // content and the columns would drift apart. happy-dom computes no layout,
    // so this property is the only thing standing between us and that bug.
    const bareFr = GRID_TEMPLATE.split(' ').filter((token) => /^[\d.]+fr$/.test(token));
    expect(bareFr).toEqual([]);
  });
});

describe('mergeBlockRows', () => {
  it('aligns daily, monthly, seasonal and export figures onto one row per block', () => {
    const daily = [production('A1', { plan_kg: 3000, actual_kg: 2800, monthly_plan_kg: 62000, monthly_actual_kg: 58000 })];
    const seasonal = [production('A1', { plan_kg: 210000, actual_kg: 198000, pct: 94.3 })];
    const market = [exportRow('A1', 185400, 12.1)];

    const [row] = mergeBlockRows(daily, seasonal, market);

    expect(row).toEqual({
      block_code: 'A1',
      block_name: 'Block A1',
      daily_plan_kg: 3000,
      daily_actual_kg: 2800,
      monthly_plan_kg: 62000,
      monthly_actual_kg: 58000,
      seasonal_plan_kg: 210000,
      seasonal_actual_kg: 198000,
      seasonal_pct: 94.3,
      export_kg: 185400,
      export_pct: 12.1,
    });
  });

  it('zero-fills a block missing from the export response instead of dropping it', () => {
    const daily = [production('A1', { plan_kg: 3000 }), production('B2', { plan_kg: 1000 })];
    const seasonal = [production('A1'), production('B2')];
    const market = [exportRow('A1', 185400, 100)];

    const rows = mergeBlockRows(daily, seasonal, market);

    expect(rows.map((r) => r.block_code)).toEqual(['A1', 'B2']);
    expect(rows[1].export_kg).toBe(0);
    expect(rows[1].export_pct).toBe(0);
  });

  it('zero-fills a block missing from the seasonal response', () => {
    const rows = mergeBlockRows([production('A1', { plan_kg: 3000 })], [], []);

    expect(rows).toHaveLength(1);
    expect(rows[0].seasonal_plan_kg).toBe(0);
    expect(rows[0].seasonal_actual_kg).toBe(0);
    expect(rows[0].seasonal_pct).toBe(0);
  });

  it('drops an export row whose block is absent from production rather than appending a nameless row', () => {
    const rows = mergeBlockRows([production('A1')], [production('A1')], [
      exportRow('A1', 100, 50),
      exportRow('GHOST', 900, 50),
    ]);

    expect(rows.map((r) => r.block_code)).toEqual(['A1']);
  });

  it('returns an empty list for empty input', () => {
    expect(mergeBlockRows([], [], [])).toEqual([]);
  });
});

describe('sumTotals', () => {
  const ROWS = mergeBlockRows(
    [
      production('A1', { plan_kg: 3000, actual_kg: 2800, monthly_plan_kg: 62000, monthly_actual_kg: 58000 }),
      production('A2', { plan_kg: 2500, actual_kg: 2900, monthly_plan_kg: 55000, monthly_actual_kg: 60000 }),
    ],
    [
      production('A1', { plan_kg: 210000, actual_kg: 198000, pct: 94.3 }),
      production('A2', { plan_kg: 180000, actual_kg: 191000, pct: 106.1 }),
    ],
    [exportRow('A1', 185400, 51.3), exportRow('A2', 176200, 48.7)],
  );

  it('sums every numeric column', () => {
    expect(sumTotals(ROWS)).toMatchObject({
      daily_plan_kg: 5500,
      daily_actual_kg: 5700,
      monthly_plan_kg: 117000,
      monthly_actual_kg: 118000,
      seasonal_plan_kg: 390000,
      seasonal_actual_kg: 389000,
      export_kg: 361600,
    });
  });

  it('derives the total export share instead of summing the rounded per-block shares', () => {
    // The backend rounds each block's share to one decimal
    // (`_aggregate_export_market`). Fifteen equal blocks each carry 6.7, and
    // 15 × 6.7 = 100.5 — which the footer rendered as 101. Every block's share
    // of the total is by definition the whole of it.
    const fifteen = Array.from({ length: 15 }, (_, i) => `B${i + 1}`);
    const rows = mergeBlockRows(
      fifteen.map((c) => production(c, { plan_kg: 100, actual_kg: 100 })),
      fifteen.map((c) => production(c, { plan_kg: 100, actual_kg: 100, pct: 100 })),
      fifteen.map((c) => exportRow(c, 1000, 6.7)),
    );

    expect(sumTotals(rows).export_pct).toBe(100);
  });

  it('reports a zero export share when no block exported anything', () => {
    const rows = mergeBlockRows(
      [production('A1', { plan_kg: 100, actual_kg: 90 })],
      [production('A1', { plan_kg: 100, actual_kg: 90, pct: 90 })],
      [exportRow('A1', 0, 0)],
    );

    expect(sumTotals(rows).export_pct).toBe(0);
  });

  it('recomputes the seasonal % from the summed plan and actual, never by averaging the row percentages', () => {
    // Averaging 94.3 and 106.1 gives 100.2 — the weighted truth is 389000/390000.
    expect(sumTotals(ROWS).seasonal_pct).toBeCloseTo(99.7, 1);
  });

  it('returns zeros without dividing by zero on empty input', () => {
    expect(sumTotals([])).toEqual({
      daily_plan_kg: 0,
      daily_actual_kg: 0,
      monthly_plan_kg: 0,
      monthly_actual_kg: 0,
      seasonal_plan_kg: 0,
      seasonal_actual_kg: 0,
      seasonal_pct: 0,
      export_kg: 0,
      export_pct: 0,
    });
  });

  it('reports 0% for a block set with actuals but no plan', () => {
    const rows = mergeBlockRows([production('A1')], [production('A1', { actual_kg: 5000 })], []);
    expect(sumTotals(rows).seasonal_pct).toBe(0);
  });
});
