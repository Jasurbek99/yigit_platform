import { useState } from 'react';
import type { EChartsOption } from 'echarts';
import { IconLayoutGrid } from '@tabler/icons-react';
import { EChart } from '@/components/EChart';
import { SeraPageHeader } from '../../components/SeraPageHeader';
import { SeraCard } from '../../components/SeraCard';
import { SeraStatCard } from '../../components/SeraStatCard';
import { SeraBlockSelector, SeraMonthSelector } from '../../components/SeraChipSelector';
import { SeraMatrixTable, type MatrixRow } from '../../components/SeraMatrixTable';
import { SERA, fmtNum, fmtKg, fmtUsd, fmtDtm, fmtPct } from '../../seraTheme';
import {
  SERA_BLOCKS, SERA_BLOCKS_BY_GROUP, SERA_TOTALS, MONTHS_TR, MONTHS_SHORT,
  SALES_QTY_BY_CHANNEL, SALES_QTY_TOTAL, SALES_AMT_BY_CHANNEL, SALES_AMT_USD_TOTAL,
  PRODUCTION_DIST, MONTHLY_TREND,
} from '../../mock/seraData';

const YEARS = [2023, 2024, 2025, 2026, 2027, 2028, 2029];

export default function ButceDashboard() {
  const [year, setYear] = useState(2026);
  const [blocks, setBlocks] = useState<string[]>(SERA_BLOCKS.map((b) => b.id));
  const [months, setMonths] = useState<number[]>(MONTHS_TR.map((_, i) => i));

  // ─── Sales quantity table ──────────────────────────────────────────────
  const qtyRows: MatrixRow[] = SALES_QTY_BY_CHANNEL.map((r) => ({
    label: r.channel,
    cells: [...r.months.map((m) => fmtNum(m)), <b>{fmtNum(r.total)}</b>],
  }));
  const qtyFooter: MatrixRow = {
    label: 'Toplam',
    cells: [...SALES_QTY_TOTAL.map((m) => fmtNum(m)), fmtNum(SERA_TOTALS.productionKg)],
  };

  // ─── Sales amount table ────────────────────────────────────────────────
  const amtRows: MatrixRow[] = SALES_AMT_BY_CHANNEL.map((r) => {
    const dtm = r.channel.includes('DTM');
    return {
      label: r.channel,
      cells: [
        ...r.months.map((m) => (m === 0 ? '—' : dtm ? fmtDtm(m) : fmtUsd(m))),
        <b>{dtm ? fmtDtm(r.total) : fmtUsd(r.total)}</b>,
      ],
    };
  });
  const amtFooter: MatrixRow = {
    label: 'Toplam USD',
    cells: [...SALES_AMT_USD_TOTAL.map((m) => (m === 0 ? '—' : fmtUsd(m))), fmtUsd(SERA_TOTALS.revenueUsd)],
  };

  // ─── Production distribution ───────────────────────────────────────────
  const distRows: MatrixRow[] = PRODUCTION_DIST.map((r) => ({
    label: r.label,
    indent: r.indent,
    bold: r.qtyPct === 100 && r.label === 'Jemi Öndürilen',
    cells: [
      fmtKg(r.qtyKg),
      fmtPct(r.qtyPct, r.qtyPct % 1 === 0 ? 0 : 1),
      r.revenuePct === null ? fmtDtm(r.revenue) : fmtUsd(r.revenue),
      r.revenuePct === null ? 'DTM' : fmtPct(r.revenuePct, r.revenuePct % 1 === 0 ? 0 : 1),
    ],
  }));

  // ─── Block summary ─────────────────────────────────────────────────────
  const blockRows: MatrixRow[] = [];
  SERA_BLOCKS_BY_GROUP.forEach((g) => {
    blockRows.push({ label: g.group, cells: [], groupHeader: true });
    g.blocks.forEach((b) => {
      blockRows.push({
        label: b.name,
        cells: [
          `${b.areaGa} GA`,
          fmtKg(b.productionKg),
          fmtUsd(b.revenueUsd),
          fmtUsd(b.expenseUsd),
          <span style={{ color: b.profitUsd < 0 ? SERA.neg : SERA.ink, fontWeight: 600 }}>{fmtUsd(b.profitUsd)}</span>,
        ],
      });
    });
  });

  // ─── Trend chart ───────────────────────────────────────────────────────
  const trendOption: EChartsOption = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['Girdeji', 'Çykdajy', 'Peýda'], bottom: 0 },
    grid: { left: 60, right: 20, top: 20, bottom: 40 },
    xAxis: { type: 'category', data: [...MONTHS_TR] },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => fmtNum(v) } },
    series: [
      { name: 'Girdeji', type: 'line', smooth: true, data: [...MONTHLY_TREND.revenue], itemStyle: { color: SERA.green } },
      { name: 'Çykdajy', type: 'line', smooth: true, data: [...MONTHLY_TREND.expense], itemStyle: { color: SERA.amber } },
      { name: 'Peýda', type: 'line', smooth: true, data: [...MONTHLY_TREND.profit], itemStyle: { color: SERA.purple } },
    ],
  };

  const monthHeaders = ['Kanal', ...MONTHS_SHORT, 'Toplam'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SeraPageHeader
        icon={<IconLayoutGrid size={22} />}
        title="Sera Býujet Dolandyryşy"
        subtitle={`${year} — Blok we aý saýlap birleşik jemi`}
        year={year}
      />

      {/* Year selection */}
      <SeraCard title="Ýyl Saýlawy">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {YEARS.map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => setYear(y)}
              style={{
                padding: '6px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 600,
                border: `1px solid ${y === year ? SERA.green : SERA.line}`,
                background: y === year ? SERA.green : SERA.card,
                color: y === year ? '#fff' : SERA.ink,
              }}
            >
              {y}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 12, color: SERA.sub, marginTop: 10 }}>
          Her ýylyň maglumaty aýry saklanýar. Täze ýyl saýlananda, ol ýyl üçin boş maglumat toplumy awtomatiki döredilýär.
        </div>
      </SeraCard>

      <SeraBlockSelector selected={blocks} onChange={setBlocks} title="Blok Saýlawy" />
      <SeraMonthSelector selected={months} onChange={setMonths} />

      {/* Area summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <SeraStatCard label="Saýlanan Jemi Meýdan" value={`${SERA_TOTALS.areaGa} GA`} tint={SERA.greenSoft} accent={SERA.green} />
        <SeraStatCard label="Sowadyjyly" value={`${SERA_TOTALS.areaCooledGa} GA`} />
        <SeraStatCard label="Sowadyjysyz" value={`${SERA_TOTALS.areaUncooledGa} GA`} />
      </div>

      {/* Financial summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <SeraStatCard label="Birleşik Önümçilik" value={fmtKg(SERA_TOTALS.productionKg)} accent={SERA.green} />
        <SeraStatCard label="Jemi Girdeji" value={fmtUsd(SERA_TOTALS.revenueUsd)} accent={SERA.blue} />
        <SeraStatCard label="Jemi Çykdajy" value={fmtUsd(SERA_TOTALS.expenseUsd)} accent={SERA.amber} />
        <SeraStatCard label="Peýda / Zyýan" value={fmtUsd(SERA_TOTALS.profitUsd)} sub={`Marj: ${fmtPct(SERA_TOTALS.marginPct, 1)}`} accent={SERA.purple} />
      </div>

      <SeraCard>
        <div style={{ fontSize: 13, color: SERA.sub }}>Içerki Bazar Girdejisi (DTM, aýry)</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: SERA.ink, margin: '4px 0' }}>{fmtDtm(SERA_TOTALS.domesticRevenueDtm)}</div>
        <div style={{ fontSize: 12, color: SERA.sub }}>USD jemine goşulmaýar — ýerli pul hökmünde aýry hasaplanýar.</div>
      </SeraCard>

      {/* Sales distribution — quantity */}
      <SeraCard title="Satyş Paýlanyşy — MUKDAR (kg)">
        <SeraMatrixTable headers={monthHeaders} rows={qtyRows} footer={qtyFooter} minWidth={1000} />
      </SeraCard>

      {/* Sales distribution — amount */}
      <SeraCard title="Satyş Paýlanyşy — MUKDAR (USD / DTM)">
        <SeraMatrixTable headers={monthHeaders} rows={amtRows} footer={amtFooter} minWidth={1100} />
      </SeraCard>

      {/* Production distribution */}
      <SeraCard title="Önümçilik Paýlanyşy (kg)">
        <SeraMatrixTable
          headers={['Kanal', 'Mukdar (kg)', 'Paý (%)', 'Girdeji', 'Girdeji %']}
          rows={distRows}
          minWidth={640}
        />
      </SeraCard>

      {/* Block summary */}
      <SeraCard title="Saýlanan Bloklar — Birleşik Jemi">
        <SeraMatrixTable
          headers={['Blok', 'Meýdan', 'Önümçilik', 'Girdeji', 'Çykdajy', 'Peýda/Zyýan']}
          rows={blockRows}
          minWidth={760}
        />
      </SeraCard>

      {/* Trend */}
      <SeraCard title="Aýlyk Girdeji / Çykdajy / Peýda Tendensiýasy">
        <EChart option={trendOption} height={320} ariaLabel="Aýlyk girdeji, çykdajy we peýda tendensiýasy" />
      </SeraCard>
    </div>
  );
}
