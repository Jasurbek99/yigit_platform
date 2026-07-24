import { useState } from 'react';
import type { EChartsOption } from 'echarts';
import { Button } from 'antd';
import {
  IconReportAnalytics, IconDownload, IconMessageCircle2, IconChevronDown, IconChevronRight,
} from '@tabler/icons-react';
import { EChart } from '@/components/EChart';
import { SeraPageHeader } from '../../components/SeraPageHeader';
import { SeraCard } from '../../components/SeraCard';
import { SeraStatCard } from '../../components/SeraStatCard';
import { SeraMatrixTable, type MatrixRow } from '../../components/SeraMatrixTable';
import { SERA, fmtUsd, fmtDtm, fmtPct } from '../../seraTheme';
import { SERA_YEAR, SERA_TOTALS, SERA_BLOCKS, MONTHS_TR } from '../../mock/seraData';
import { DEPARTMENT_SUMMARY, MONTHLY_SUMMARY, CHANNEL_DISTRIBUTION, marginPct } from '../../mock/raporlar';

// Colours sampled from the source app's own charts (not part of the shared
// SERA palette — this screen uses its own income/expense/channel colours).
const CHART_GREEN = '#1f5f4f';
const CHART_ORANGE = '#c1440e';
const CHART_BLUE = '#3b82f6';
const CHART_GRAY = '#78716c';

function ProfitCell({ value }: { readonly value: number }) {
  return <span style={{ color: value < 0 ? SERA.neg : SERA.pos, fontWeight: 600 }}>{fmtUsd(value)}</span>;
}

function MarginCell({ revenueUsd, profitUsd }: { readonly revenueUsd: number; readonly profitUsd: number }) {
  const { value, decimals } = marginPct(revenueUsd, profitUsd);
  return <span style={{ color: value < 0 ? SERA.neg : SERA.pos }}>{fmtPct(value, decimals)}</span>;
}

export default function Raporlar() {
  const [faqOpen, setFaqOpen] = useState(false);

  // ─── Bölüm Bazında Özet ────────────────────────────────────────────────
  const deptRows: MatrixRow[] = DEPARTMENT_SUMMARY.map((d) => ({
    label: d.department,
    cells: [
      fmtUsd(d.revenueUsd),
      fmtUsd(d.expenseUsd),
      <ProfitCell value={d.profitUsd} />,
      <MarginCell revenueUsd={d.revenueUsd} profitUsd={d.profitUsd} />,
    ],
  }));

  // ─── Blok Bazında Detay ────────────────────────────────────────────────
  const blockRows: MatrixRow[] = SERA_BLOCKS.map((b) => ({
    label: (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
        <IconChevronRight size={14} color={SERA.sub} />
        {b.name}
      </span>
    ),
    cells: [
      b.group,
      fmtUsd(b.revenueUsd),
      fmtUsd(b.expenseUsd),
      <ProfitCell value={b.profitUsd} />,
      <MarginCell revenueUsd={b.revenueUsd} profitUsd={b.profitUsd} />,
    ],
  }));

  // ─── Aylık Özet (Tüm Bloklar Toplamı) ──────────────────────────────────
  const monthlyRows: MatrixRow[] = MONTHLY_SUMMARY.map((m) => ({
    label: m.month,
    cells: [fmtUsd(m.revenueUsd), fmtUsd(m.expenseUsd), <ProfitCell value={m.revenueUsd - m.expenseUsd} />],
  }));

  const monthlyRevenue = MONTHLY_SUMMARY.map((m) => m.revenueUsd);
  const monthlyExpense = MONTHLY_SUMMARY.map((m) => m.expenseUsd);
  const monthlyProfit = MONTHLY_SUMMARY.map((m) => m.revenueUsd - m.expenseUsd);
  const zeros = MONTHLY_SUMMARY.map(() => 0);

  // ─── Aylık Gelir / Gider / Kar Trendi ───────────────────────────────────
  const trendOption: EChartsOption = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['Gelir', 'Gider', 'Kar'], bottom: 0 },
    grid: { left: 70, right: 20, top: 20, bottom: 40 },
    xAxis: { type: 'category', data: [...MONTHS_TR] },
    yAxis: { type: 'value' },
    series: [
      { name: 'Gelir', type: 'bar', data: monthlyRevenue, itemStyle: { color: CHART_GREEN } },
      { name: 'Gider', type: 'bar', data: monthlyExpense, itemStyle: { color: CHART_ORANGE } },
      { name: 'Kar', type: 'line', smooth: true, data: monthlyProfit, itemStyle: { color: CHART_BLUE }, symbol: 'circle' },
    ],
  };

  // ─── Aylık Gider Kırılımı (710 Gübre / 720 Personel / Genel) ───────────
  const expenseBreakdownOption: EChartsOption = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['710 Gübre', '720 Personel', 'Genel'], bottom: 0 },
    grid: { left: 70, right: 20, top: 20, bottom: 40 },
    xAxis: { type: 'category', data: [...MONTHS_TR] },
    yAxis: { type: 'value' },
    series: [
      { name: '710 Gübre', type: 'bar', stack: 'expense', data: zeros, itemStyle: { color: CHART_ORANGE } },
      { name: '720 Personel', type: 'bar', stack: 'expense', data: zeros, itemStyle: { color: CHART_BLUE } },
      { name: 'Genel', type: 'bar', stack: 'expense', data: monthlyExpense, itemStyle: { color: CHART_GRAY } },
    ],
  };

  // ─── Satış Kanalı Dağılımı (USD Gelir) ─────────────────────────────────
  const pieColors = [CHART_GREEN, CHART_ORANGE, CHART_BLUE];
  const pieOption: EChartsOption = {
    tooltip: { trigger: 'item' },
    series: [
      {
        type: 'pie',
        radius: '68%',
        label: { formatter: '{b}' },
        data: CHANNEL_DISTRIBUTION.map((c, i) => ({ name: c.name, value: c.value, itemStyle: { color: pieColors[i] } })),
      },
    ],
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SeraPageHeader
        icon={<IconReportAnalytics size={22} />}
        title="Raporlar"
        subtitle={`${SERA_YEAR} yıllık özet`}
        accent="#16a34a"
        accentDark="#15803d"
        year={SERA_YEAR}
        extra={
          <Button
            icon={<IconDownload size={15} />}
            style={{ background: 'rgba(255,255,255,0.16)', color: '#fff', border: 'none' }}
          >
            CSV İndir
          </Button>
        }
      />

      {/* FAQ / methodology disclosure */}
      <div style={{ border: `1px solid ${SERA.line}`, borderRadius: 10, background: SERA.greenSoft }}>
        <button
          type="button"
          onClick={() => setFaqOpen((v) => !v)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 16px', background: 'transparent', border: 'none', cursor: 'pointer',
            fontWeight: 600, color: SERA.greenDark, fontSize: 13, textAlign: 'left',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconMessageCircle2 size={16} />
            Raporlar hakkında soru sor — nasıl hesaplanıyor, veriler nereden geliyor?
          </span>
          <IconChevronDown size={16} style={{ transform: faqOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }} />
        </button>
        {faqOpen && (
          <div style={{ padding: '0 16px 14px 42px', fontSize: 13, color: SERA.sub, lineHeight: 1.6 }}>
            Gelir ve gider rakamları her bloğun aylık satış ve gider kayıtlarından toplanır.
            Kar/Zarar = Gelir − Gider; Kar Marjı (%) = Kar/Zarar ÷ Gelir × 100 olarak hesaplanır.
            İç Pazar (yurt içi) satışları ayrı bir para birimi (DTM) olduğu için USD toplamına dahil edilmez.
            770 kodu genel giderleri, seçili dağıtım moduna göre tüm bloklara paylaştırılır.
          </div>
        )}
      </div>

      {/* Top KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <SeraStatCard label="Toplam Gelir" value={fmtUsd(SERA_TOTALS.revenueUsd)} />
        <SeraStatCard label="Toplam Gider" value={fmtUsd(SERA_TOTALS.expensePlanUsd)} />
        <SeraStatCard label="Kar/Zarar (USD)" value={fmtUsd(SERA_TOTALS.profitPlanUsd)} accent={SERA.pos} tint={SERA.greenSoft} />
        <SeraStatCard label="Kar Marjı (%)" value={fmtPct(SERA_TOTALS.marginPct, 1)} accent={SERA.pos} tint={SERA.greenSoft} />
      </div>
      <div style={{ fontSize: 13, color: SERA.sub }}>
        İç Pazar (yurt içi) gelir: <b style={{ color: SERA.ink }}>{fmtDtm(SERA_TOTALS.domesticRevenueDtm)}</b>
      </div>

      {/* Bölüm Bazında Özet */}
      <SeraCard title="Bölüm Bazında Özet">
        <SeraMatrixTable
          headers={['Bölüm', 'Gelir (USD)', 'Gider (USD)', 'Kar/Zarar (USD)', 'Kar Marjı (%)']}
          rows={deptRows}
          minWidth={640}
        />
      </SeraCard>

      {/* Blok Bazında Detay */}
      <SeraCard>
        <div style={{ fontWeight: 700, color: SERA.ink }}>Blok Bazında Detay</div>
        <div style={{ fontSize: 12, color: SERA.sub, marginTop: 2, marginBottom: 14 }}>
          Detaylı kaynak kırılımını görmek için bir bloğa tıklayın.
        </div>
        <SeraMatrixTable
          headers={['Blok', 'Bölüm', 'Gelir (USD)', 'Gider (USD)', 'Kar/Zarar (USD)', 'Kar Marjı (%)']}
          rows={blockRows}
          minWidth={760}
        />
      </SeraCard>

      {/* Aylık Gelir / Gider / Kar Trendi */}
      <SeraCard title="Aylık Gelir / Gider / Kar Trendi">
        <EChart option={trendOption} height={320} ariaLabel="Aylık gelir, gider ve kar trendi" />
      </SeraCard>

      {/* Aylık Gider Kırılımı */}
      <SeraCard title="Aylık Gider Kırılımı (710 Gübre / 720 Personel / Genel)">
        <EChart option={expenseBreakdownOption} height={320} ariaLabel="Aylık gider kırılımı" />
      </SeraCard>

      {/* 770 Kodu — Umumy Gider Dağıtımı */}
      <SeraCard title="770 Kodu — Umumy Gider Dağıtımı">
        <div style={{ fontSize: 13, color: SERA.sub, marginBottom: 14 }}>
          770 genel gideri, seçili dağıtım moduna göre tüm bloklara paylaştırılır.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <SeraStatCard label="Yıllık Toplam Havuz" value={fmtUsd(0)} accent={SERA.green} />
          <SeraStatCard label="Aylık Ortalama" value={fmtUsd(0)} accent={SERA.green} />
          <SeraStatCard label="Blok Başına Pay (yıllık)" value={fmtUsd(0)} accent={SERA.green} />
        </div>
        <div style={{ fontSize: 12, color: SERA.sub, marginTop: 10 }}>
          Dağıtım modu: <b style={{ color: SERA.ink }}>Eşit (blok sayısına böl)</b> — Blok Ayarları sayfasından değiştirilebilir.
        </div>
      </SeraCard>

      {/* Aylık Özet */}
      <SeraCard title="Aylık Özet (Tüm Bloklar Toplamı)">
        <SeraMatrixTable headers={['Ay', 'Gelir (USD)', 'Gider (USD)', 'Kar/Zarar (USD)']} rows={monthlyRows} minWidth={560} />
      </SeraCard>

      {/* Satış Kanalı Dağılımı */}
      <SeraCard title="Satış Kanalı Dağılımı (USD Gelir)">
        <EChart option={pieOption} height={320} ariaLabel="Satış kanalı dağılımı (USD gelir)" />
      </SeraCard>
    </div>
  );
}
