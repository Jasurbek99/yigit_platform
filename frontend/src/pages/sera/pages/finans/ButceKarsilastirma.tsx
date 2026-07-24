import { useState } from 'react';
import { Button } from 'antd';
import {
  IconChartArrows, IconSearch, IconChevronDown, IconChevronRight, IconRefresh,
} from '@tabler/icons-react';
import { SeraPageHeader } from '../../components/SeraPageHeader';
import { SeraCard } from '../../components/SeraCard';
import { SeraStatCard } from '../../components/SeraStatCard';
import { SeraBlockSelector } from '../../components/SeraChipSelector';
import { SeraMatrixTable, type MatrixRow } from '../../components/SeraMatrixTable';
import { SERA, fmtNum, fmtPct } from '../../seraTheme';
import { SERA_BLOCKS_BY_GROUP, MONTHS_TR } from '../../mock/seraData';
import {
  COUNTRY_COMPARE_OCAK, COUNTRY_PLAN_REVENUE_USD, BLOCK_COMPARE_OCAK,
} from '../../mock/butceKarsilastirma';

function fmtSigned(value: number): string {
  return `${value >= 0 ? '+' : ''}${fmtNum(value)} $`;
}

function DiffCell({ value }: { readonly value: number }) {
  return (
    <span style={{ color: value < 0 ? SERA.neg : SERA.pos, fontWeight: 600 }}>{fmtSigned(value)}</span>
  );
}

function MiniBar({ pct }: { readonly pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
      <div style={{ width: 60, height: 7, borderRadius: 4, background: SERA.line, overflow: 'hidden' }}>
        <div style={{ width: `${clamped}%`, height: '100%', background: SERA.green }} />
      </div>
      <span>{fmtPct(pct)}</span>
    </div>
  );
}

function MonthChip({ label, active, onClick }: { readonly label: string; readonly active: boolean; readonly onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '5px 12px',
        borderRadius: 8,
        border: `1px solid ${active ? SERA.green : SERA.line}`,
        background: active ? SERA.green : SERA.card,
        color: active ? '#fff' : SERA.ink,
        fontSize: 13,
        fontWeight: 500,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function TinyLink({ label, onClick }: { readonly label: string; readonly onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '4px 10px',
        borderRadius: 8,
        border: `1px solid ${SERA.line}`,
        background: SERA.greenSoft,
        color: SERA.green,
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

export default function ButceKarsilastirma() {
  const [askOpen, setAskOpen] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(0); // 0 = Ocak
  const [blocks, setBlocks] = useState<string[]>(SERA_BLOCKS_BY_GROUP.flatMap((g) => g.blocks.map((b) => b.id)));

  // ─── Country / channel comparison (Ocak) ────────────────────────────────
  const totalPlanRevenue = Object.values(COUNTRY_PLAN_REVENUE_USD).reduce((s, v) => s + v, 0);
  const totalActualRevenue = 0;
  const totalPlanKg = COUNTRY_COMPARE_OCAK.reduce((s, r) => s + r.planKg, 0);
  const totalActualKg = 0;
  const totalKgSebapli = totalActualRevenue - totalPlanRevenue;
  const totalBahaSebapli = 0;
  const totalJemiTapawut = totalKgSebapli + totalBahaSebapli;
  const girdejiYerineYetirisPct = totalPlanRevenue !== 0 ? (totalActualRevenue / totalPlanRevenue) * 100 : 0;

  const countryRows: MatrixRow[] = COUNTRY_COMPARE_OCAK.map((r) => {
    const planRevenue = COUNTRY_PLAN_REVENUE_USD[r.channel] ?? 0;
    const actualRevenue = r.actualKg * r.actualPriceUsd;
    const kgSebapli = actualRevenue - planRevenue;
    const bahaSebapli = (r.actualPriceUsd - r.planPriceUsd) * r.actualKg;
    const jemiTapawut = kgSebapli + bahaSebapli;
    const kgPct = r.planKg !== 0 ? (r.actualKg / r.planKg) * 100 : 0;
    const pricePct = r.planPriceUsd !== 0 ? (r.actualPriceUsd / r.planPriceUsd) * 100 : 0;
    const girdejiPct = planRevenue !== 0 ? (actualRevenue / planRevenue) * 100 : 0;
    return {
      label: r.channel,
      cells: [
        fmtNum(r.planKg), fmtNum(r.actualKg), fmtPct(kgPct),
        fmtNum(r.planPriceUsd, 2), fmtNum(r.actualPriceUsd, 0), fmtPct(pricePct),
        <DiffCell value={kgSebapli} />, <DiffCell value={bahaSebapli} />, <DiffCell value={jemiTapawut} />,
        <MiniBar pct={girdejiPct} />,
      ],
    };
  });

  const countryTotalRow: MatrixRow = {
    label: 'JEMI',
    bold: true,
    cells: [
      fmtNum(totalPlanKg), fmtNum(totalActualKg), fmtPct(totalPlanKg !== 0 ? (totalActualKg / totalPlanKg) * 100 : 0),
      '', '', '',
      <DiffCell value={totalKgSebapli} />, <DiffCell value={totalBahaSebapli} />, <DiffCell value={totalJemiTapawut} />,
      <MiniBar pct={girdejiYerineYetirisPct} />,
    ],
  };

  // ─── Block-level comparison (Ocak) ──────────────────────────────────────
  const blockRows: MatrixRow[] = BLOCK_COMPARE_OCAK.map((b) => {
    const tapawut = b.actualRevenueUsd - b.planRevenueUsd;
    const girdejiPct = b.planRevenueUsd !== 0 ? (b.actualRevenueUsd / b.planRevenueUsd) * 100 : 0;
    return {
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <IconChevronRight size={13} color={SERA.sub} /> {b.name}
        </span>
      ),
      cells: [
        fmtNum(b.planKg), fmtNum(b.actualKg),
        `${fmtNum(b.planRevenueUsd)} $`, `${fmtNum(b.actualRevenueUsd)} $`,
        <DiffCell value={tapawut} />, <MiniBar pct={girdejiPct} />,
      ],
    };
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SeraPageHeader
        icon={<IconChartArrows size={22} />}
        title="Býudjet Deňeşdirme — Girdeji"
        subtitle="Meýilleşdirilen (Satuw sahypasyndan) we Hakyky (Logo Tiger'dan) girdeji deňeşdirmesi — ýurt, kg we birlik baha boýunça"
        accent="#0e7490"
        accentDark="#0a5866"
        extra={(
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, opacity: 0.85 }}>Girdeji Ýerine Ýetiriş</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{fmtPct(girdejiYerineYetirisPct)}</div>
          </div>
        )}
      />

      {/* Ask question collapsible bar */}
      <div
        style={{ background: SERA.card, border: `1px solid ${SERA.line}`, borderRadius: 12, padding: '10px 16px', cursor: 'pointer' }}
        onClick={() => setAskOpen((v) => !v)}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, color: SERA.sub, fontSize: 13 }}>
            <IconSearch size={16} /> Býudjet Deňeşdirme — Girdeji hakkında soru sor — nasıl hesaplanıyor, veriler nereden geliyor?
          </span>
          <IconChevronDown size={16} color={SERA.sub} style={{ transform: askOpen ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }} />
        </div>
        {askOpen && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${SERA.line}`, fontSize: 13, color: SERA.ink }}>
            &quot;Meýil.&quot; (planlaşdyrylan) sütünler Satuw sahypasyndaky aýlyk satyş meýilnamasyndan gelýär; &quot;Hakyky&quot;
            sütünler bolsa Logo Tiger buhgalteriýa ulgamyndan sinhronlanýar. Kg Sebäpli Tapawut = (Hakyky Kg − Meýil.
            Kg) × Meýil. Baha — diňe satylan mukdaryň meýilnamadan näçe çykandygyny görkezýär. Baha Sebäpli Tapawut =
            (Hakyky Baha − Meýil. Baha) × Hakyky Kg — diňe bahanyň meýilnamadan näçe çykandygyny görkezýär. Häzirki
            wagtda saýlanan aý üçin Logo Tiger&apos;dan hiç hili hakyky maglumat sinhronlanmandyr, şoňa görä ähli
            tapawut Kg Sebäpli hökmünde görkezilýär.
          </div>
        )}
      </div>

      {/* Month selection */}
      <SeraCard
        title={(
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ color: SERA.sub, fontWeight: 600, fontSize: 13 }}>Aý saýlawy:</span>
            <TinyLink label="Ähli ýyl" onClick={() => undefined} />
            <TinyLink label="Arassala" onClick={() => undefined} />
          </span>
        )}
        extra={(
          <Button
            icon={<IconRefresh size={15} />}
            type="primary"
            style={{ background: SERA.green, borderColor: SERA.green }}
          >
            Logo&apos;dan Çek
          </Button>
        )}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {MONTHS_TR.map((m, i) => (
            <MonthChip key={m} label={m} active={selectedMonth === i} onClick={() => setSelectedMonth(i)} />
          ))}
        </div>
      </SeraCard>

      <SeraBlockSelector selected={blocks} onChange={setBlocks} title="Blok Saýlawy" />

      {/* Top KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <SeraStatCard label="Jemi Girdeji Tapawudy" value={`${fmtNum(totalJemiTapawut)} $`} accent={SERA.neg} tint="#fdecea" />
        <SeraStatCard label="Kg Sebäpli Tapawut" value={`${fmtNum(totalKgSebapli)} $`} accent={SERA.neg} tint="#fdecea" />
        <SeraStatCard label="Baha Sebäpli Tapawut" value={`${fmtNum(totalBahaSebapli)} $`} accent={SERA.pos} tint={SERA.greenSoft} />
      </div>

      {/* Country / channel comparison */}
      <SeraCard title={`Ýurt Bazynda Deňeşdirme — ${MONTHS_TR[selectedMonth]}`}>
        <div style={{ fontSize: 12, color: SERA.sub, marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span>Kg Sebäpli Tapawut = (Hakyky Kg − Meýil. Kg) × Meýil. Baha — diňe satylan mukdaryň meýilnamadan näçe çykandygyny görkezýär.</span>
          <span>Baha Sebäpli Tapawut = (Hakyky Baha − Meýil. Baha) × Hakyky Kg — diňe bahanyň meýilnamadan näçe çykandygyny görkezýär.</span>
        </div>
        <SeraMatrixTable
          headers={['Ýurt / Kanal', 'Meýil. Kg', 'Hakyky Kg', 'Kg %', 'Meýil. Baha', 'Hakyky Baha', 'Baha %', 'Kg Sebäpli', 'Baha Sebäpli', 'Jemi Tapawut', 'Girdeji %']}
          rows={[...countryRows, countryTotalRow]}
          minWidth={1180}
        />
      </SeraCard>

      {/* Block comparison */}
      <SeraCard
        title={(
          <span>
            Blok Bazynda Jeminiň Deňeşdirmesi{' '}
            <span style={{ fontWeight: 400, color: SERA.sub, fontSize: 12 }}>
              — blogyň adyna basyň: kanal jikme-jikligini açyň
            </span>
          </span>
        )}
      >
        <SeraMatrixTable
          headers={['Ýyladyşhana', 'Meýil. Kg', 'Hakyky Kg', 'Meýil. Girdeji', 'Hakyky Girdeji', 'Tapawut', 'Girdeji %']}
          rows={blockRows}
          minWidth={860}
        />
      </SeraCard>
    </div>
  );
}
