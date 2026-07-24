import { useState } from 'react';
import type { EChartsOption } from 'echarts';
import { Progress } from 'antd';
import { IconLayoutDashboard, IconEye, IconEyeOff } from '@tabler/icons-react';
import { EChart } from '@/components/EChart';
import { SeraPageHeader } from '../components/SeraPageHeader';
import { SeraCard } from '../components/SeraCard';
import { SeraStatCard } from '../components/SeraStatCard';
import { SeraMatrixTable, type MatrixRow } from '../components/SeraMatrixTable';
import { SERA, fmtNum, fmtUsd } from '../seraTheme';
import { SERA_TOTALS, SERA_YEAR, MONTHS_SHORT, MONTHLY_TREND, SALES_QTY_TOTAL } from '../mock/seraData';
import { PRODUCTION_MONTHLY, EXPORT_GAPY_MONTHLY, DOMESTIC_MONTHLY } from '../mock/anaDashboard';

const INDIGO = '#6366f1';

function fmtTon(value: number): string {
  return `${fmtNum(value, value % 1 === 0 ? 0 : 1)} t`;
}

interface TopKpiCardProps {
  readonly label: string;
  readonly value: string;
  readonly plan: string;
  readonly accent: string;
  readonly tint: string;
}

/** Primary KPI tile: label + %100 badge + big value + plan line + progress bar. */
function TopKpiCard({ label, value, plan, accent, tint }: TopKpiCardProps) {
  return (
    <div style={{ background: SERA.card, border: `1px solid ${SERA.line}`, borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: SERA.sub, textTransform: 'uppercase', letterSpacing: 0.4 }}>
          {label}
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: accent, background: tint, padding: '2px 8px', borderRadius: 999 }}>
          %100
        </span>
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: accent, marginBottom: 2 }}>{value}</div>
      <div style={{ fontSize: 12, color: SERA.sub, marginBottom: 10 }}>Plan: {plan}</div>
      <Progress percent={100} showInfo={false} strokeColor={accent} size={['100%', 6]} />
    </div>
  );
}

function LegendDot({ color, label }: { readonly color: string; readonly label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: SERA.sub }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
      {label}
    </span>
  );
}

export default function SeraAnaDashboard() {
  const [amountsHidden, setAmountsHidden] = useState(true);

  /** Amounts (money) are hidden behind "Tutarlar gizli" — quantities (kg/t/trucks) are always shown. */
  const mask = (value: string): string => (amountsHidden ? '•••' : value);

  const productionValue = fmtTon(SERA_TOTALS.productionPlanKg);
  const exportGapyPlan = fmtTon(SERA_TOTALS.exportGapyPlanKg);
  const domesticPlan = fmtTon(SERA_TOTALS.domesticPlanKg);

  const trendOption: EChartsOption = {
    tooltip: { trigger: 'axis' },
    legend: { show: false },
    grid: { left: 60, right: 20, top: 20, bottom: 30 },
    xAxis: { type: 'category', data: [...MONTHS_SHORT] },
    yAxis: {
      type: 'value',
      axisLabel: { formatter: (v: number) => (amountsHidden ? '•••' : fmtNum(v)) },
    },
    series: [
      {
        name: 'Girdeji',
        type: 'line',
        smooth: true,
        data: [...MONTHLY_TREND.revenue],
        itemStyle: { color: INDIGO },
        areaStyle: { color: `${INDIGO}22` },
      },
      {
        name: 'Çykdajy',
        type: 'line',
        smooth: true,
        data: [...MONTHLY_TREND.expense],
        itemStyle: { color: SERA.amber },
      },
    ],
  };

  const productionOption: EChartsOption = {
    tooltip: { trigger: 'axis' },
    grid: { left: 60, right: 20, top: 20, bottom: 30 },
    xAxis: { type: 'category', data: [...MONTHS_SHORT] },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => fmtNum(v) } },
    series: [
      { name: 'Aýlyk Önümçilik', type: 'bar', data: [...SALES_QTY_TOTAL], itemStyle: { color: INDIGO, borderRadius: [4, 4, 0, 0] } },
    ],
  };

  const monthHeaders = ['Aý', 'Önümçilik', 'Girdeji', 'Çykdajy', 'Peýda', 'Eksport+Gapy', 'Içerki'];
  const monthRows: MatrixRow[] = MONTHS_SHORT.map((m, i) => {
    const hasData = PRODUCTION_MONTHLY[i] > 0;
    return {
      label: hasData ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: INDIGO }} />
          {m}
        </span>
      ) : (
        m
      ),
      cells: [
        fmtTon(PRODUCTION_MONTHLY[i]),
        mask(fmtUsd(MONTHLY_TREND.revenue[i])),
        mask(fmtUsd(MONTHLY_TREND.expense[i])),
        mask(fmtUsd(MONTHLY_TREND.profit[i])),
        fmtTon(EXPORT_GAPY_MONTHLY[i]),
        fmtTon(DOMESTIC_MONTHLY[i]),
      ],
    };
  });

  const monthFooter: MatrixRow = {
    label: 'Jemi',
    cells: [
      fmtTon(SERA_TOTALS.productionPlanKg),
      mask(fmtUsd(SERA_TOTALS.revenueUsd)),
      mask(fmtUsd(SERA_TOTALS.expenseUsd)),
      mask(fmtUsd(SERA_TOTALS.profitUsd)),
      fmtTon(SERA_TOTALS.exportGapyPlanKg),
      fmtTon(SERA_TOTALS.domesticPlanKg),
    ],
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SeraPageHeader
        icon={<IconLayoutDashboard size={22} />}
        title="Esasy Dashboard"
        subtitle={`${SERA_YEAR} ýylyň jemi analitikasy`}
        year={SERA_YEAR}
        extra={
          <button
            type="button"
            onClick={() => setAmountsHidden((v) => !v)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 8,
              background: 'rgba(255,255,255,0.16)',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {amountsHidden ? <IconEyeOff size={15} /> : <IconEye size={15} />}
            {amountsHidden ? 'Tutarlar gizli' : 'Tutarlar görkezilýär'}
          </button>
        }
      />

      {/* Primary KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <TopKpiCard label="Önümçilik" value={productionValue} plan={productionValue} accent={INDIGO} tint="#eef0ff" />
        <TopKpiCard
          label="Girdeji"
          value={mask(fmtUsd(SERA_TOTALS.revenueUsd))}
          plan={mask(fmtUsd(SERA_TOTALS.revenuePlanUsd))}
          accent={SERA.green}
          tint={SERA.greenLight}
        />
        <TopKpiCard
          label="Çykdajy"
          value={mask(fmtUsd(SERA_TOTALS.expenseUsd))}
          plan={mask(fmtUsd(SERA_TOTALS.expensePlanUsd))}
          accent={SERA.amber}
          tint="#fff4e0"
        />
        <TopKpiCard
          label="Peýda"
          value={mask(fmtUsd(SERA_TOTALS.profitUsd))}
          plan={mask(fmtUsd(SERA_TOTALS.profitPlanUsd))}
          accent={SERA.blue}
          tint="#e6f0ff"
        />
      </div>

      {/* Secondary KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <SeraStatCard label="Eksport+Gapy" value="0 kg" sub={`Plan: ${exportGapyPlan}`} accent={INDIGO} />
        <SeraStatCard label="Içerki bazar" value="—" sub={`Plan: ${domesticPlan}`} accent={SERA.ink} />
        <SeraStatCard
          label="Eksport tutar"
          value={mask(fmtUsd(SERA_TOTALS.revenueUsd))}
          sub={`Plan: ${mask(fmtUsd(SERA_TOTALS.revenuePlanUsd))}`}
          accent={SERA.green}
        />
        <SeraStatCard
          label="Aktif Tırlar"
          value={`${SERA_TOTALS.activeTrucks} açyk`}
          sub={`Plan: ${SERA_TOTALS.activeTrucks} sany`}
          accent={SERA.purple}
        />
      </div>

      {/* Charts */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 480px', minWidth: 320 }}>
          <SeraCard
            title="Girdeji & Çykdajy Trendleri"
            extra={
              <span style={{ display: 'flex', gap: 14 }}>
                <LegendDot color={INDIGO} label="Girdeji" />
                <LegendDot color={SERA.amber} label="Çykdajy" />
              </span>
            }
          >
            <EChart option={trendOption} height={280} ariaLabel="Aýlyk girdeji we çykdajy tendensiýasy" />
          </SeraCard>
        </div>
        <div style={{ flex: '1 1 380px', minWidth: 300 }}>
          <SeraCard title="Aýlyk Önümçilik">
            <EChart option={productionOption} height={280} ariaLabel="Aýlyk önümçilik mukdary" />
          </SeraCard>
        </div>
      </div>

      {/* Monthly detail table */}
      <SeraCard title="Aýlyk Jikme-jik Hasabat" extra={SERA_YEAR}>
        <SeraMatrixTable headers={monthHeaders} rows={monthRows} footer={monthFooter} minWidth={860} />
      </SeraCard>
    </div>
  );
}
