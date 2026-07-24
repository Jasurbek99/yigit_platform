import { useState } from 'react';
import { Button, Select } from 'antd';
import {
  IconBuildingStore, IconRefresh, IconChevronDown, IconMessageCircle2,
} from '@tabler/icons-react';
import { SeraPageHeader } from '../components/SeraPageHeader';
import { SeraCard } from '../components/SeraCard';
import { SeraStatCard } from '../components/SeraStatCard';
import { SeraBlockSelector } from '../components/SeraChipSelector';
import { SeraMatrixTable, type MatrixRow } from '../components/SeraMatrixTable';
import { SERA, fmtNum, fmtPct } from '../seraTheme';
import { SERA_BLOCKS, MONTHS_TR } from '../mock/seraData';
import { POMIDOR_BLOCK_ROWS } from '../mock/pomidor';

const PERIOD_TABS_A = ['Aýlyk', 'Möwsümleýin'] as const;
const PERIOD_TABS_B = ['Aý babatynda', 'Günlük'] as const;
const AREA_BY_ID = new Map(SERA_BLOCKS.map((b) => [b.id, b.areaGa]));

function TabBtn({ label, active, color, onClick }: { label: string; active: boolean; color: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '6px 14px',
        borderRadius: 8,
        border: `1px solid ${active ? color : SERA.line}`,
        background: active ? color : SERA.card,
        color: active ? '#fff' : SERA.ink,
        fontSize: 13,
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function BarCell({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 160 }}>
      <div style={{ flex: 1, height: 8, borderRadius: 4, background: SERA.line, overflow: 'hidden' }}>
        <div style={{ width: `${clamped}%`, height: '100%', background: SERA.pos, borderRadius: 4 }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color: SERA.ink, minWidth: 30, textAlign: 'right' }}>
        {fmtPct(Math.round(pct))}
      </span>
    </div>
  );
}

export default function SeraPomidor() {
  const [blocks, setBlocks] = useState<string[]>(SERA_BLOCKS.map((b) => b.id));
  const [periodA, setPeriodA] = useState<(typeof PERIOD_TABS_A)[number]>('Aýlyk');
  const [periodB, setPeriodB] = useState<(typeof PERIOD_TABS_B)[number]>('Aý babatynda');
  const [month, setMonth] = useState(0);
  const [askOpen, setAskOpen] = useState(false);

  const selectedSet = new Set(blocks);
  const rows = POMIDOR_BLOCK_ROWS.filter((r) => selectedSet.has(r.id));

  const planTotal = rows.reduce((s, r) => s + r.planKg, 0);
  const actualTotal = rows.reduce((s, r) => s + r.actualKg, 0);
  const overallPct = planTotal > 0 ? (actualTotal / planTotal) * 100 : 0;

  const domesticPlanTotal = rows.reduce((s, r) => s + r.domesticPlanKg, 0);
  const domesticActualTotal = rows.reduce((s, r) => s + r.domesticActualKg, 0);
  const exportPlanTotal = rows.reduce((s, r) => s + r.exportPlanKg, 0);
  const exportActualTotal = rows.reduce((s, r) => s + r.exportActualKg, 0);

  const mainRows: MatrixRow[] = rows.map((r) => {
    const areaGa = AREA_BY_ID.get(r.id) ?? 0;
    const hakykyPerGa = areaGa > 0 ? r.actualKg / areaGa : 0;
    const rowPct = r.planKg > 0 ? (r.actualKg / r.planKg) * 100 : 0;
    return {
      label: r.name,
      cells: [fmtNum(r.planKg), fmtNum(r.actualKg), fmtNum(Math.round(hakykyPerGa)), <BarCell key="bar" pct={rowPct} />],
    };
  });
  const mainFooter: MatrixRow = {
    label: 'JEMI',
    cells: [fmtNum(planTotal), fmtNum(actualTotal), fmtNum(0), <BarCell key="bar" pct={overallPct} />],
  };

  const marketRows: MatrixRow[] = rows.map((r) => ({
    label: r.name,
    cells: [fmtNum(r.domesticPlanKg), fmtNum(r.domesticActualKg), fmtNum(r.exportPlanKg), fmtNum(r.exportActualKg)],
  }));
  const marketFooter: MatrixRow = {
    label: 'JEMI',
    cells: [fmtNum(domesticPlanTotal), fmtNum(domesticActualTotal), fmtNum(exportPlanTotal), fmtNum(exportActualTotal)],
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SeraPageHeader
        icon={<IconBuildingStore size={22} />}
        title="Pomidor Dükany"
        subtitle="Meýilleşdirilen (Önümçilik Plany) we Ýerine Ýetirilen (Logo Tiger) deňeşdirme"
        accent={SERA.red}
        accentDark={SERA.redDark}
        extra={
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, opacity: 0.85 }}>Jemi Ýerine Ýetiriş</div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{fmtPct(Math.round(overallPct))}</div>
          </div>
        }
      />

      {/* Decorative "ask" bar */}
      <div
        onClick={() => setAskOpen((v) => !v)}
        style={{
          background: SERA.card, border: `1px solid ${SERA.line}`, borderRadius: 12,
          padding: '10px 16px', display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', cursor: 'pointer',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: SERA.sub, fontSize: 13 }}>
          <IconMessageCircle2 size={16} /> Pomidor Dükany hakynda soru sor — nähili hasaplanýar, maglumatlar nireden gelýär?
        </span>
        <IconChevronDown size={16} style={{ transform: askOpen ? 'rotate(180deg)' : undefined, transition: 'transform .15s ease' }} />
      </div>

      {/* Period tabs + month select */}
      <SeraCard>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              {PERIOD_TABS_A.map((p) => (
                <TabBtn key={p} label={p} active={periodA === p} color={SERA.green} onClick={() => setPeriodA(p)} />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {PERIOD_TABS_B.map((p) => (
                <TabBtn key={p} label={p} active={periodB === p} color={SERA.blue} onClick={() => setPeriodB(p)} />
              ))}
              <Select
                value={month}
                onChange={setMonth}
                style={{ width: 120 }}
                options={MONTHS_TR.map((m, i) => ({ value: i, label: m }))}
              />
            </div>
          </div>
          <div style={{ fontSize: 12, color: SERA.sub, textAlign: 'right', maxWidth: 280 }}>
            Meýilleşdirilen = Üretim Plany&apos;ndan otomatik. Ýerine Ýetirilen = Logo Tiger&apos;dan.
          </div>
        </div>
      </SeraCard>

      {/* Logo Tiger sync banner */}
      <SeraCard>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: SERA.amber, display: 'inline-block', flexShrink: 0 }} />
            <span style={{ fontWeight: 600, color: SERA.ink, fontSize: 13 }}>Logo Tiger — Mysal görnüşi (entek birikmedi)</span>
            <span style={{ color: SERA.sub, fontSize: 12 }}>— häzirki maglumatlar nusgalykdyr, hakyky birikme soň ediler</span>
          </div>
          <Button icon={<IconRefresh size={15} />} type="primary" style={{ background: SERA.green, borderColor: SERA.green }}>
            Logo&apos;dan Çek
          </Button>
        </div>
      </SeraCard>

      <SeraBlockSelector selected={blocks} onChange={setBlocks} />

      {/* Stat summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <SeraStatCard label="Meýilleşdirilen (kg)" value={fmtNum(planTotal)} accent={SERA.blue} />
        <SeraStatCard label="Ýerine Ýetirilen (kg)" value={fmtNum(actualTotal)} />
        <SeraStatCard label="Ýerine Ýetiriş (%)" value={fmtPct(Math.round(overallPct))} accent={SERA.amber} tint="#fffbe6" />
      </div>

      {/* Per-block monthly comparison */}
      <SeraCard title={`Aýlyk Deňeşdirme — ${MONTHS_TR[month]}`}>
        <SeraMatrixTable
          headers={['Ýyladyşhana', 'Meýilleşdirilen-KG', 'Ýerine Ýetirilen-KG', 'Hakyky kg/GA', 'Grafik babatynda']}
          rows={mainRows}
          footer={mainFooter}
          minWidth={800}
        />
      </SeraCard>

      {/* Domestic / export market split */}
      <SeraCard
        title="Içerki / Daşarky Bazar Deňeşdirmesi"
        extra="Daşarky = Export + Gapy Satuwy. Içerki = Içerki Bazar. Hakyky paýlanyş, Satuw sahypasyndaky göterimlere görä hasaplanýar."
      >
        <SeraMatrixTable
          headers={['Ýyladyşhana', 'Içerki Meýil.', 'Içerki Hakyky', 'Daşarky Meýil.', 'Daşarky Hakyky']}
          rows={marketRows}
          footer={marketFooter}
          minWidth={760}
        />
      </SeraCard>
    </div>
  );
}
