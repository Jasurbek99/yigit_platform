import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { InputNumber, Select } from 'antd';
import type { EChartsOption } from 'echarts';
import {
  IconTruck, IconMessageCircle, IconChevronDown,
} from '@tabler/icons-react';
import { EChart } from '@/components/EChart';
import { SeraPageHeader } from '../components/SeraPageHeader';
import { SeraCard } from '../components/SeraCard';
import { SeraStatCard } from '../components/SeraStatCard';
import { SeraBlockSelector } from '../components/SeraChipSelector';
import { SeraMatrixTable, type MatrixRow } from '../components/SeraMatrixTable';
import { SERA, fmtNum, fmtKg, fmtPct } from '../seraTheme';
import { SERA_BLOCKS, MONTHS_SHORT } from '../mock/seraData';
import { TIR_WEEKLY_KG_BY_BLOCK, TIR_TRUCK_CAPACITY_KG } from '../mock/tirTakip';
import {
  GAPLAMA_WEEKLY_KG_BY_BLOCK, GAPLAMA_TRUCK_USED_KG_BY_BLOCK, GAPLAMA_OPENED_TRUCKS,
  TIR_TRUCKS, TIR_TRUCK_FIRMS, TIR_SECTIONS, GUMRUK_SECTIONS,
  EXPORT_RAPORU_STATS, EXPORT_RAPORU_COUNTRIES, EXPORT_RAPORU_GELEN_COUNT, EXPORT_RAPORU_GELMEDIK_COUNT,
  HASABAT_STATS, HASABAT_MONTHLY, HASABAT_COUNTRIES_PIE, HASABAT_FIRMS_PIE, HASABAT_CUSTOMERS_BAR, HASABAT_BLOCKS_BAR,
  HASABAT_COUNTRIES_TABLE, HASABAT_FIRMS_TABLE, HASABAT_CUSTOMERS_TABLE, HASABAT_VARIETY_TABLE,
  KWOTA_FIRMS, KWOTA_KPIS, KWOTA_FIRM_CARDS, KWOTA_CYKAN_ROWS, KWOTA_ISLENEN_ROWS, KWOTA_ISLENEN_TOTALS, KWOTA_MASYN_SANY,
  SERTNAMA_COMPANIES, SERTNAMA_TOTAL, SERTNAMA_ZDELKA, SERTNAMA_ROWS,
  DATALAR_ROWS, type DatalarTag,
} from '../mock/tirTakipTabs';
import {
  INVOICE_ROWS, INVOICE_EXPORT_FIRMS, INVOICE_IMPORT_FIRMS,
  ALYJY_FIRMS, ALYJY_FIELD_DEFS,
} from '../mock/tirSertnama';

const TIR_ACCENT = '#8a5a2b';
const TIR_ACCENT_DARK = '#5f3d18';

const TABS = [
  'Önümçilik', 'Gaplama', 'Tırlar', 'Export Rapory', 'Hasabat',
  'Gümrük Ewraklary', 'Kwota Takyby', 'Daşary Sertnamalary', 'Datalar',
] as const;
type TirTab = typeof TABS[number];

function addDays(base: Date, days: number): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + days);
  return d;
}
function fmtDM(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function fmtDMY(d: Date): string {
  return `${fmtDM(d)}.${d.getFullYear()}`;
}
/** Truck count from kg — 2-decimal, trailing zeros trimmed ("0,8" not "0,80"); "—" when 0. */
function fmtTruckCount(kg: number): string {
  if (kg <= 0) return '—';
  return (kg / TIR_TRUCK_CAPACITY_KG).toLocaleString('tr-TR', { maximumFractionDigits: 2 });
}
/** Turkmen weekday abbreviation, indexed by JS Date#getDay() (0=Ýekşenbe). */
const WEEKDAY_TK_SHORT = ['Ýek', 'Dş', 'Sş', 'Çş', 'Pş', 'Ann', 'Şb'] as const;
function fmtWeekdayShortTk(d: Date): string {
  return WEEKDAY_TK_SHORT[d.getDay()];
}
/** Readable text colour (black/white) for an arbitrary tag background hex. */
function pickTextColor(hex: string): string {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? SERA.ink : '#ffffff';
}

function Pill({ label, color = SERA.green, bg = SERA.greenSoft }: { readonly label: ReactNode; readonly color?: string; readonly bg?: string }) {
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, color, background: bg, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  );
}

function TabButton({ label, active, onClick }: { readonly label: string; readonly active: boolean; readonly onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '10px 4px',
        marginRight: 22,
        border: 'none',
        borderBottom: active ? `2px solid ${SERA.green}` : '2px solid transparent',
        background: 'none',
        color: active ? SERA.ink : SERA.sub,
        fontWeight: active ? 700 : 500,
        fontSize: 14,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

function WeekNavButton({ label, active, onClick }: { readonly label: string; readonly active: boolean; readonly onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '6px 14px',
        borderRadius: 8,
        cursor: 'pointer',
        fontWeight: 600,
        fontSize: 13,
        border: `1px solid ${active ? SERA.green : SERA.line}`,
        background: active ? SERA.green : SERA.card,
        color: active ? '#fff' : SERA.ink,
      }}
    >
      {label}
    </button>
  );
}

// ─── Gaplama (packaging) tab ────────────────────────────────────────────
function GaplamaTab() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [blocks, setBlocks] = useState<string[]>(['DUS-A']);
  const [dayValues, setDayValues] = useState<Record<string, number[]>>(
    () => Object.fromEntries(Object.entries(GAPLAMA_WEEKLY_KG_BY_BLOCK).map(([k, v]) => [k, [...v]])),
  );

  const weekStart = useMemo(() => addDays(new Date(), weekOffset * 7), [weekOffset]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const handleDayChange = (blockId: string, dayIdx: number, value: number): void => {
    setDayValues((prev) => {
      const next = { ...prev, [blockId]: [...(prev[blockId] ?? [0, 0, 0, 0, 0, 0, 0])] };
      next[blockId][dayIdx] = value;
      return next;
    });
  };

  const selectedBlocks = SERA_BLOCKS.filter((b) => blocks.includes(b.id));
  const dayHeaders = weekDays.map((d, i) => `${fmtDM(d)} ${fmtWeekdayShortTk(d)}${weekOffset === 0 && i === 0 ? '●' : ''}`);
  const headers = ['Blok', ...dayHeaders, 'JEMI'];

  const blockRows: MatrixRow[] = selectedBlocks.map((b) => {
    const values = dayValues[b.id] ?? [0, 0, 0, 0, 0, 0, 0];
    const total = values.reduce((s, v) => s + v, 0);
    const cells: ReactNode[] = values.map((v, i) => (
      <InputNumber
        key={i}
        value={v}
        min={0}
        step={500}
        controls={false}
        size="small"
        style={{ width: 100 }}
        onChange={(val) => handleDayChange(b.id, i, Number(val ?? 0))}
      />
    ));
    cells.push(<b>{fmtNum(total)}</b>);
    return { label: b.name, cells };
  });

  const dayTotals = Array.from({ length: 7 }, (_, i) => selectedBlocks.reduce((s, b) => s + (dayValues[b.id]?.[i] ?? 0), 0));
  const weekTotal = dayTotals.reduce((s, v) => s + v, 0);
  const openedTrucksTotalKg = GAPLAMA_OPENED_TRUCKS.reduce((s, t) => s + t.kg, 0);
  const bakiyeJemi = weekTotal - openedTrucksTotalKg;

  const jemiRow: MatrixRow = {
    label: 'JEMI kg',
    bold: true,
    cells: [
      ...dayTotals.map((v, i) => (v > 0 ? <span key={i} style={{ color: SERA.green, fontWeight: 700 }}>{fmtNum(v)}</span> : <span key={i}>—</span>)),
      <span style={{ color: SERA.green, fontWeight: 700 }}>{fmtNum(weekTotal)}</span>,
    ],
  };
  const truckRow: MatrixRow = {
    label: (
      <span>
        Tır sany — Domates{' '}
        <span style={{ fontWeight: 400, color: SERA.sub, fontSize: 12 }}>(÷20.000 kg)</span>
      </span>
    ),
    cells: [...dayTotals.map((v, i) => <span key={i} style={{ color: SERA.amber, fontWeight: 600 }}>{fmtTruckCount(v)}</span>), <b style={{ color: SERA.amber }}>{fmtTruckCount(weekTotal)}</b>],
  };
  const openedRow: MatrixRow = {
    label: '📦 Açylan tırlar',
    cells: [...dayTotals.map((_, i) => <span key={i}>—</span>), <b>0 tır</b>],
  };
  const bakiyeRow: MatrixRow = {
    label: 'Bakiye',
    cells: [
      ...dayTotals.map((v, i) => <span key={i}>{v > 0 ? `${fmtNum(v)} kg` : '—'}</span>),
      <span style={{ color: bakiyeJemi < 0 ? SERA.neg : SERA.ink, fontWeight: 700 }}>{fmtNum(bakiyeJemi)} kg</span>,
    ],
  };
  const rows: MatrixRow[] = [...blockRows, jemiRow, truckRow, openedRow, bakiyeRow];

  const dailyBalanceHeaders = ['Blok', ...weekDays.map((d) => fmtDM(d)), 'Hepde'];
  const dailyBalanceRows: MatrixRow[] = selectedBlocks.map((b) => {
    const values = dayValues[b.id] ?? [0, 0, 0, 0, 0, 0, 0];
    const total = values.reduce((s, v) => s + v, 0);
    return { label: `▶${b.name}`, cells: [...values.map((v) => (v > 0 ? fmtNum(v) : '—')), fmtNum(total)] };
  });
  const dailyBalanceFooter: MatrixRow = {
    label: 'JEMI', bold: true,
    cells: [...dayTotals.map((v) => (v > 0 ? fmtNum(v) : '—')), `${fmtNum(weekTotal)} kg`],
  };

  const weeklySummaryHeaders = ['Blok', 'Gaplama kg', 'Tıra giden', 'Bakiye'];
  const weeklySummaryRows: MatrixRow[] = selectedBlocks.map((b) => {
    const total = (dayValues[b.id] ?? [0, 0, 0, 0, 0, 0, 0]).reduce((s, v) => s + v, 0);
    const used = GAPLAMA_TRUCK_USED_KG_BY_BLOCK[b.id] ?? 0;
    return { label: b.name, cells: [fmtKg(total), `−${fmtKg(used)}`, fmtKg(total - used)] };
  });
  const weeklySummaryTotalKg = selectedBlocks.reduce((s, b) => s + (dayValues[b.id] ?? []).reduce((a, v) => a + v, 0), 0);
  const weeklySummaryTotalUsed = selectedBlocks.reduce((s, b) => s + (GAPLAMA_TRUCK_USED_KG_BY_BLOCK[b.id] ?? 0), 0);
  const weeklySummaryFooter: MatrixRow = {
    label: 'JEMI', bold: true,
    cells: [fmtKg(weeklySummaryTotalKg), `−${fmtKg(weeklySummaryTotalUsed)}`, fmtKg(weeklySummaryTotalKg - weeklySummaryTotalUsed)],
  };

  const openedHeaders = ['Kod', 'Blok(lar)', 'Kg', 'Ýagdaýy', 'Senesi'];
  const openedRows: MatrixRow[] = GAPLAMA_OPENED_TRUCKS.map((t) => ({
    label: t.code,
    cells: [t.blocksLabel, fmtKg(t.kg), <Pill label={t.status} />, t.openedAt],
  }));

  return (
    <>
      <SeraCard>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 6 }}>
          <span style={{ fontWeight: 700, color: SERA.ink }}>Gaplama — Günlük Kg Ýazgysy</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <WeekNavButton label="◀ Öňki hepde" active={false} onClick={() => setWeekOffset((o) => o - 1)} />
            <WeekNavButton label="Şu hepde" active={weekOffset === 0} onClick={() => setWeekOffset(0)} />
            <WeekNavButton label="Indiki hepde ▶" active={false} onClick={() => setWeekOffset((o) => o + 1)} />
          </div>
        </div>
        <div style={{ fontSize: 13, color: SERA.ink, fontWeight: 600, marginBottom: 4 }}>
          {fmtDMY(weekDays[0])} — {fmtDMY(weekDays[6])}
        </div>
        <div style={{ fontSize: 12, color: SERA.sub }}>Her gün üçin müdiriň gaplama kg-syny el bilen ýazýar.</div>
      </SeraCard>

      <SeraBlockSelector selected={blocks} onChange={setBlocks} />

      <SeraCard title="Blok boýunça hepdelik gaplama ýazgysy">
        {selectedBlocks.length === 0 ? (
          <div style={{ fontSize: 13, color: SERA.sub }}>Görkezmek üçin azyndan bir blok saýlaň.</div>
        ) : (
          <SeraMatrixTable headers={headers} rows={rows} minWidth={1080} />
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
          <button type="button" style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: SERA.green, color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
            + Tır Aç
          </button>
          <span style={{ fontSize: 12, color: SERA.sub }}>Ýeni Gaplama tıry açmak üçin basyň.</span>
        </div>
      </SeraCard>

      <SeraCard title="Blok Bakiyesi — Günlük">
        <SeraMatrixTable headers={dailyBalanceHeaders} rows={dailyBalanceRows} footer={dailyBalanceFooter} minWidth={860} />
      </SeraCard>
      <SeraCard title="Blok Bakiyesi — Haftalık Özet">
        <SeraMatrixTable headers={weeklySummaryHeaders} rows={weeklySummaryRows} footer={weeklySummaryFooter} minWidth={560} />
      </SeraCard>
      <SeraCard title="Açylan Gaplama Tırları">
        <SeraMatrixTable headers={openedHeaders} rows={openedRows} numeric={false} minWidth={760} />
      </SeraCard>
    </>
  );
}

// ─── Tırlar tab ──────────────────────────────────────────────────────────
function TirlarTab() {
  const headers = ['Kategoriýa / Açyklama', ...TIR_TRUCKS.map((t) => t.code)];

  const routeRow: MatrixRow = {
    label: 'Bloklar',
    bold: true,
    cells: TIR_TRUCKS.map((t, i) => <span key={i}>{t.route}</span>),
  };
  const statusRow: MatrixRow = {
    label: 'Ýagdaýy',
    cells: TIR_TRUCKS.map((t, i) => (
      <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
        <Pill label={t.status} />
        <span style={{ fontSize: 11, color: SERA.sub }}>{t.category === 'Gaplama' ? '📦 Gaplama' : '📋 Export Bölüm'}</span>
        <span style={{ fontSize: 11, color: SERA.green, cursor: 'pointer' }}>{t.category === 'Gaplama' ? '✂ Ayır' : '↗ Aktar'}</span>
        <span style={{ fontSize: 11, color: SERA.neg, cursor: 'pointer' }}>Tiri poz</span>
      </div>
    )),
  };
  const firmRow: MatrixRow = {
    label: 'Eksport eden Firmalar',
    cells: TIR_TRUCK_FIRMS.map((firms, i) => (
      <div key={i}>
        {firms ? (
          firms.map((f) => (
            <div key={f.name} style={{ fontSize: 12 }}>
              <b>{f.name}</b> · {fmtNum(f.kg)} kg
            </div>
          ))
        ) : (
          <span style={{ color: SERA.sub, fontSize: 12 }}>+ Firma goş</span>
        )}
      </div>
    )),
  };

  const rows: MatrixRow[] = [routeRow, statusRow];
  TIR_SECTIONS.forEach((section) => {
    rows.push({ label: section.title, cells: [], groupHeader: true });
    if (section.title === 'YÜK & GÜMRÜK MAGLUMATLARY') rows.push(firmRow);
    section.rows.forEach((r) => {
      rows.push({ label: r.label, cells: r.values.map((v, i) => <span key={i}>{v}</span>) });
    });
  });

  return (
    <SeraCard title={<>Tırlar <Pill label={`${TIR_TRUCKS.length} sany`} /></>}>
      <SeraMatrixTable headers={headers} rows={rows} numeric={false} minWidth={1500} />
    </SeraCard>
  );
}

// ─── Gümrük Ewraklary tab ────────────────────────────────────────────────
function GumrukTab() {
  const [blocks, setBlocks] = useState<string[]>(SERA_BLOCKS.map((b) => b.id));
  const headers = ['', ...TIR_TRUCKS.map((t) => t.code)];

  const headerRow: MatrixRow = {
    label: '',
    cells: TIR_TRUCKS.map((t, i) => (
      <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
        <span style={{ fontWeight: 700 }}>{t.code}</span>
        <span style={{ fontSize: 11, color: SERA.sub }}>{t.route}</span>
        <button
          type="button"
          style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, border: 'none', background: SERA.green, color: '#fff', cursor: 'pointer' }}
        >
          🖨️ Ýazdyr / PDF
        </button>
      </div>
    )),
  };

  const rows: MatrixRow[] = [headerRow];
  GUMRUK_SECTIONS.forEach((section) => {
    rows.push({ label: section.title, cells: [], groupHeader: true });
    section.rows.forEach((r) => {
      rows.push({ label: r.label, cells: r.values.map((v, i) => <span key={i} style={{ color: SERA.sub }}>{v}</span>) });
    });
  });

  return (
    <>
      <SeraBlockSelector selected={blocks} onChange={setBlocks} title="Blok Saýlawy (görkezmek üçin)" />
      <SeraCard
        title={`Gümrük Ewraklary — ${TIR_TRUCKS.length} tır`}
        extra="Deklarasiýa, CMR, Inwoýs, Sertifikat (CT-1) we Fitosanitar sertifikat maglumatlary — her tır üçin aýratyn."
      >
        <SeraMatrixTable headers={headers} rows={rows} numeric={false} minWidth={1500} />
      </SeraCard>
    </>
  );
}

// ─── Export Raporu tab ───────────────────────────────────────────────────
function ExportRaporuTab() {
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
        {EXPORT_RAPORU_STATS.map((s) => (
          <SeraStatCard key={s.label} label={s.label} value={s.value} accent={s.label === 'Hasabat gelmedi' ? SERA.neg : s.label === 'Hasabat gelen' ? SERA.green : SERA.ink} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
        {EXPORT_RAPORU_COUNTRIES.map((c) => (
          <SeraCard key={c.name} title={c.name} extra={`${c.truckCount} tır`}>
            <div style={{ fontSize: 11, color: SERA.sub, textTransform: 'uppercase', marginBottom: 8, letterSpacing: 0.3 }}>Ýagdaý</div>
            {c.stages.map((st) => (
              <div key={st.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 }}>
                <span style={{ fontSize: 12, color: SERA.sub, minWidth: 150 }}>{st.label}</span>
                <div style={{ flex: 1, height: 6, background: SERA.line, borderRadius: 4 }} />
                <span style={{ fontSize: 12, fontWeight: 600, minWidth: 16, textAlign: 'right' }}>{st.value}</span>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <div style={{ flex: 1, background: SERA.greenSoft, borderRadius: 8, padding: 10, textAlign: 'center' }}>
                <div style={{ fontWeight: 700, color: SERA.green }}>{c.reportGelen}</div>
                <div style={{ fontSize: 11, color: SERA.sub }}>Hasabat gelen</div>
              </div>
              <div style={{ flex: 1, background: '#fde8e8', borderRadius: 8, padding: 10, textAlign: 'center' }}>
                <div style={{ fontWeight: 700, color: SERA.neg }}>{c.reportGelmedi}</div>
                <div style={{ fontSize: 11, color: SERA.sub }}>Hasabat gelmedi</div>
              </div>
            </div>
          </SeraCard>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
        <SeraCard title={<>✅ Hasabat GELEN <Pill label={EXPORT_RAPORU_GELEN_COUNT} /></>}>
          {EXPORT_RAPORU_GELEN_COUNT === 0 && <div style={{ textAlign: 'center', color: SERA.sub, padding: 24 }}>Hasabat gelen tır ýok</div>}
        </SeraCard>
        <SeraCard title={<>❌ Hasabat GELMEDIK <Pill label={EXPORT_RAPORU_GELMEDIK_COUNT} color={SERA.neg} bg="#fde8e8" /></>}>
          {EXPORT_RAPORU_GELMEDIK_COUNT === 0 && <div style={{ textAlign: 'center', color: SERA.sub, padding: 24 }}>Ähli tırdan hasabat geldi ✓</div>}
        </SeraCard>
      </div>
    </>
  );
}

// ─── Hasabat tab ─────────────────────────────────────────────────────────
function HasabatTab() {
  const monthOption: EChartsOption = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['kg', 'tır'], bottom: 0 },
    grid: { left: 60, right: 20, top: 20, bottom: 40 },
    xAxis: { type: 'category', data: [...HASABAT_MONTHLY.months] },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => fmtNum(v) } },
    series: [
      { name: 'kg', type: 'bar', data: [...HASABAT_MONTHLY.kg], itemStyle: { color: SERA.green } },
      { name: 'tır', type: 'bar', data: [...HASABAT_MONTHLY.tir], itemStyle: { color: SERA.blue } },
    ],
  };
  const countryPieOption: EChartsOption = {
    tooltip: { trigger: 'item' },
    legend: { orient: 'vertical', right: 10, top: 'center' },
    series: [{
      type: 'pie', radius: ['55%', '80%'],
      data: HASABAT_COUNTRIES_PIE.map((c) => ({ name: c.name, value: c.pct })),
      itemStyle: { borderWidth: 2, borderColor: '#fff' },
      label: { show: false },
    }],
  };
  const firmPieOption: EChartsOption = {
    tooltip: { trigger: 'item' },
    legend: { orient: 'vertical', right: 10, top: 'center' },
    series: [{
      type: 'pie', radius: ['55%', '80%'],
      data: HASABAT_FIRMS_PIE.map((f) => ({ name: f.name, value: f.pct })),
      itemStyle: { borderWidth: 2, borderColor: '#fff' },
      label: { show: false },
    }],
  };
  const customersBarOption: EChartsOption = {
    tooltip: { trigger: 'axis' },
    grid: { left: 90, right: 20, top: 10, bottom: 20 },
    xAxis: { type: 'value', axisLabel: { formatter: (v: number) => fmtNum(v) } },
    yAxis: { type: 'category', data: HASABAT_CUSTOMERS_BAR.map((c) => c.name).reverse() },
    series: [{ type: 'bar', data: HASABAT_CUSTOMERS_BAR.map((c) => c.kg).reverse(), itemStyle: { color: SERA.green } }],
  };
  const blocksBarOption: EChartsOption = {
    tooltip: { trigger: 'axis' },
    grid: { left: 90, right: 20, top: 10, bottom: 20 },
    xAxis: { type: 'value', axisLabel: { formatter: (v: number) => fmtNum(v) } },
    yAxis: { type: 'category', data: HASABAT_BLOCKS_BAR.map((b) => b.name).reverse() },
    series: [{ type: 'bar', data: HASABAT_BLOCKS_BAR.map((b) => b.kg).reverse(), itemStyle: { color: SERA.green } }],
  };

  const detailRows = (list: readonly { readonly name: string; readonly count: number; readonly kg: number; readonly pct: number }[]): MatrixRow[] =>
    list.map((r) => ({ label: r.name, cells: [fmtNum(r.count), fmtNum(r.kg), fmtPct(r.pct)] }));

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <SeraStatCard label="Jemi Tır" value={HASABAT_STATS.jemiTir} />
        <SeraStatCard label="Jemi Kg" value={HASABAT_STATS.jemiKg} sub={HASABAT_STATS.jemiKgSub} accent={SERA.blue} />
        <SeraStatCard label="Ortaça Kg / Tır" value={HASABAT_STATS.ortacaKg} accent={SERA.purple} />
        <SeraStatCard label="Açyk Tırlar" value={HASABAT_STATS.acykTirlar} sub="tamamlanmadı" accent={SERA.amber} />
        <SeraStatCard label="Tamamlanan" value={HASABAT_STATS.tamamlanan} accent={SERA.green} />
      </div>
      <SeraCard title="📅 Aýlar boyunça kg we tır sany">
        <EChart option={monthOption} height={300} ariaLabel="Aýlar boýunça kg we tır sany" />
      </SeraCard>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
        <SeraCard title="🌍 Ýurtlar boyunça kg paýy">
          <EChart option={countryPieOption} height={260} ariaLabel="Ýurtlar boýunça kg paýy" />
        </SeraCard>
        <SeraCard title="🏢 Eksport firmalar boyunça kg paýy">
          <EChart option={firmPieOption} height={260} ariaLabel="Eksport firmalar boýunça kg paýy" />
        </SeraCard>
      </div>
      <SeraCard title="👤 Müşderiler boyunça kg">
        <EChart option={customersBarOption} height={200} ariaLabel="Müşderiler boýunça kg" />
      </SeraCard>
      <SeraCard title="🌿 Bloklar boyunça kg">
        <EChart option={blocksBarOption} height={260} ariaLabel="Bloklar boýunça kg" />
      </SeraCard>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
        <SeraCard title="🌍 Ýurtlar — detaýly">
          <SeraMatrixTable headers={['Ýurt', 'Sany', 'Jemi kg', 'Paý %']} rows={detailRows(HASABAT_COUNTRIES_TABLE)} minWidth={420} />
        </SeraCard>
        <SeraCard title="🏢 Eksport firmalar — detaýly">
          <SeraMatrixTable headers={['Firma', 'Sany', 'Jemi kg', 'Paý %']} rows={detailRows(HASABAT_FIRMS_TABLE)} minWidth={420} />
        </SeraCard>
        <SeraCard title="👤 Müşderiler — detaýly">
          <SeraMatrixTable headers={['Müşderi', 'Sany', 'Jemi kg', 'Paý %']} rows={detailRows(HASABAT_CUSTOMERS_TABLE)} minWidth={420} />
        </SeraCard>
        <SeraCard title="🍅 Pomidor görnüşi boyunça">
          <SeraMatrixTable headers={['Görnüş', 'Sany', 'Jemi kg', 'Paý %']} rows={detailRows(HASABAT_VARIETY_TABLE)} minWidth={420} />
        </SeraCard>
      </div>
    </>
  );
}

// ─── Kwota Takibi tab ────────────────────────────────────────────────────
function KwotaTab() {
  const [month, setMonth] = useState('Hemmesi');

  const cykanHeaders = ['Senesi', ...KWOTA_FIRMS, 'Jemi kg', 'Maşyn'];
  const cykanRows: MatrixRow[] = KWOTA_CYKAN_ROWS.map((r) => {
    const total = r.perFirm.reduce((s, v) => s + v, 0);
    return { label: r.date ?? 'mm/dd/yyyy', cells: [...r.perFirm.map((v) => fmtNum(v)), total > 0 ? fmtNum(total) : '—', '—'] };
  });
  const cykanFooter: MatrixRow = {
    label: 'JEMI', bold: true,
    cells: [
      ...KWOTA_FIRMS.map((_, i) => fmtNum(KWOTA_CYKAN_ROWS.reduce((s, r) => s + r.perFirm[i], 0))),
      fmtNum(KWOTA_KPIS.cykan), String(KWOTA_KPIS.masynSany),
    ],
  };

  const islenenHeaders = ['Senesi', 'Export Kody', ...KWOTA_FIRMS, 'Jemi kg'];
  const islenenRows: MatrixRow[] = KWOTA_ISLENEN_ROWS.map((r) => ({
    label: r.date,
    cells: [r.exportCode ?? '—', ...r.perFirm.map((v) => (v === null ? '—' : fmtNum(v))), fmtNum(r.total)],
  }));
  const islenenFooter: MatrixRow = {
    label: 'JEMI', bold: true,
    cells: ['', ...KWOTA_ISLENEN_TOTALS.map((v) => fmtNum(v)), fmtNum(KWOTA_KPIS.islenen)],
  };

  const astatokHeaders = ['', ...KWOTA_FIRMS, 'Jemi'];
  const astatokRows: MatrixRow[] = [
    {
      label: 'Astatok (Bakiye)', bold: true,
      cells: [
        ...KWOTA_FIRM_CARDS.map((f) => <span key={f.name} style={{ color: f.astatok < 0 ? SERA.neg : SERA.ink }}>{fmtNum(f.astatok)}</span>),
        <b>{fmtKg(KWOTA_KPIS.astatok)}</b>,
      ],
    },
    { label: 'Maşyn Sany', cells: [...KWOTA_MASYN_SANY.map((v) => fmtNum(v)), `${KWOTA_KPIS.masynSany} maşyn`] },
  ];

  return (
    <>
      <SeraCard title="Kwota Takibi" extra="Şirket ady goş / Setir goş">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {['Hemmesi', ...MONTHS_SHORT].map((m) => (
            <WeekNavButton key={m} label={m} active={m === month} onClick={() => setMonth(m)} />
          ))}
        </div>
      </SeraCard>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <SeraStatCard label="Çykan Kwota" value={fmtKg(KWOTA_KPIS.cykan)} />
        <SeraStatCard label="İslenen Kwota" value={fmtKg(KWOTA_KPIS.islenen)} accent={SERA.purple} />
        <SeraStatCard label="Astatok (Bakiye)" value={fmtKg(KWOTA_KPIS.astatok)} accent={SERA.amber} />
        <SeraStatCard label="Maşyn Sany" value={`${KWOTA_KPIS.masynSany} tır`} accent={SERA.purple} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        {KWOTA_FIRM_CARDS.map((f) => (
          <SeraCard key={f.name} title={f.name}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: SERA.sub }}>
              <span>İslenen</span><span>{fmtKg(f.islenen)}</span>
            </div>
            <div style={{ height: 6, background: SERA.line, borderRadius: 4, margin: '8px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ color: SERA.sub }}>Astatok</span>
              <b style={{ color: f.astatok < 0 ? SERA.neg : SERA.ink }}>{fmtNum(f.astatok)}</b>
            </div>
          </SeraCard>
        ))}
      </div>
      <SeraCard title="Çykan Kwota" extra="— el bilen girizilýär">
        <SeraMatrixTable headers={cykanHeaders} rows={cykanRows} footer={cykanFooter} minWidth={760} />
      </SeraCard>
      <SeraCard title="İslenen Kwota" extra="— Tırlar bölüminden awtomatik">
        <SeraMatrixTable headers={islenenHeaders} rows={islenenRows} footer={islenenFooter} minWidth={760} />
      </SeraCard>
      <SeraCard>
        <SeraMatrixTable headers={astatokHeaders} rows={astatokRows} minWidth={640} />
      </SeraCard>
    </>
  );
}

// ─── Yurtdışı Sertnamaları → Invoice sub-tab ─────────────────────────────
function InvoiceTab() {
  const [exportFirm, setExportFirm] = useState('');
  const [importFirm, setImportFirm] = useState('');

  const filteredRows = INVOICE_ROWS.filter((r) => {
    if (exportFirm && r.exportFirm !== exportFirm) return false;
    if (importFirm && r.importFirm !== importFirm) return false;
    return true;
  });

  const headers = ['Eksport Kody', 'Senesi', 'Invoice №', 'Eksport Firma', 'Import Firma', 'Mesta Sany', 'Brutto kg', 'Netto kg', 'Birlik Baha', 'Tutary USD', ''];
  const rows: MatrixRow[] = filteredRows.map((r) => ({
    label: r.exportCode ? <span style={{ color: SERA.green, fontWeight: 600 }}>{r.exportCode}</span> : <span style={{ color: SERA.sub }}>—</span>,
    cells: [
      r.date,
      r.invoiceNo ?? '—',
      r.exportFirm,
      r.importFirm ?? '—',
      fmtNum(r.mestaSany),
      fmtNum(r.bruttoKg),
      fmtNum(r.nettoKg),
      r.unitPrice !== null ? r.unitPrice.toFixed(2) : '—',
      r.tutaryUsd !== null ? fmtNum(r.tutaryUsd, 2) : '—',
      <button
        key="print"
        type="button"
        style={{ fontSize: 12, padding: '2px 8px', borderRadius: 6, border: 'none', background: SERA.green, color: '#fff', cursor: 'pointer' }}
      >
        🖨️
      </button>,
    ],
  }));

  const footer: MatrixRow = {
    label: `Jemi — ${filteredRows.length} setir`,
    bold: true,
    cells: [
      '', '', '', '',
      fmtNum(filteredRows.reduce((s, r) => s + r.mestaSany, 0)),
      fmtNum(filteredRows.reduce((s, r) => s + r.bruttoKg, 0)),
      fmtNum(filteredRows.reduce((s, r) => s + r.nettoKg, 0)),
      '', '—', '',
    ],
  };

  return (
    <SeraCard title="Invoice Arhiwi" extra={`${filteredRows.length} setir`}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        <Select
          style={{ width: 180 }}
          value={exportFirm}
          onChange={setExportFirm}
          options={[{ value: '', label: '— Eksport firma —' }, ...INVOICE_EXPORT_FIRMS.map((f) => ({ value: f, label: f }))]}
        />
        <Select
          style={{ width: 180 }}
          value={importFirm}
          onChange={setImportFirm}
          options={[{ value: '', label: '— Import firma —' }, ...INVOICE_IMPORT_FIRMS.map((f) => ({ value: f, label: f }))]}
        />
      </div>
      <SeraMatrixTable headers={headers} rows={rows} footer={footer} minWidth={1200} />
    </SeraCard>
  );
}

// ─── Yurtdışı Sertnamaları → Alyjylar sub-tab ────────────────────────────
function AlyjylarTab() {
  return (
    <SeraCard
      title={
        <div>
          <div style={{ fontWeight: 700, color: SERA.ink }}>Alyjy firmalar</div>
          <div style={{ fontWeight: 400, fontSize: 12, color: SERA.sub, marginTop: 2 }}>
            Her alyjy firmanyň doly maglumatlary — şertnamada awtomatik ulanylýar
          </div>
        </div>
      }
      extra={
        <button type="button" style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: SERA.green, color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
          + Alyjy goş
        </button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {ALYJY_FIRMS.map((f) => (
          <div key={f.name} style={{ border: `1px solid ${SERA.line}`, borderRadius: 12, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontWeight: 700, color: SERA.ink, fontSize: 14 }}>{f.name}</span>
              <span style={{ fontSize: 12, color: SERA.neg, cursor: 'pointer' }}>🗑 Sil</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px 18px' }}>
              {ALYJY_FIELD_DEFS.map(({ label, key }) => (
                <div key={label}>
                  <div style={{ fontSize: 10, color: SERA.sub, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 12.5, color: SERA.ink, wordBreak: 'break-word' }}>{f[key] ?? '—'}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </SeraCard>
  );
}

// ─── Yurtdışı Sertnamaları tab ───────────────────────────────────────────
function SertnamaTab() {
  const [subTab, setSubTab] = useState<'Sertnamalar' | 'Invoice' | 'Alyjylar'>('Sertnamalar');
  const [company, setCompany] = useState('Hemmesi');
  const [zdelka, setZdelka] = useState<'Hemmesi' | 'Pasport' | 'Bezpasport'>('Hemmesi');

  const filteredRows = SERTNAMA_ROWS.filter((r) => {
    if (zdelka !== 'Hemmesi' && r.zdelka !== zdelka) return false;
    if (company !== 'Hemmesi' && r.exportFirm !== company) return false;
    return true;
  });

  const headers = [
    '#', 'Eksport eden Firma', 'Import eden Firma', 'Sertname ady', 'Zdelka görnüşi', 'Ýurt', 'Kg',
    'Birlik bahasy', 'Jemi bahasy', 'Ulanylan kg', 'Galan kg', 'Galan jemi baha', 'Tır num (Plaka)',
    'Berlen senesi', 'Möhleti', 'Ýagdaýy',
  ];
  const rows: MatrixRow[] = filteredRows.map((r) => ({
    label: r.no,
    cells: [
      r.exportFirm, r.importFirm,
      r.code ? <span style={{ color: SERA.green, fontWeight: 600 }}>{r.code}</span> : <span style={{ color: SERA.sub }}>Firma saýlaň</span>,
      <Pill label={r.zdelka} bg={r.zdelka === 'Bezpasport' ? '#ede9fe' : SERA.greenSoft} color={r.zdelka === 'Bezpasport' ? SERA.purple : SERA.green} />,
      r.country ?? '— saýlaň —',
      r.kg !== null ? fmtNum(r.kg) : '—',
      r.unitPrice !== null ? r.unitPrice.toFixed(2) : '—',
      r.totalPrice !== null ? fmtNum(r.totalPrice, 2) : '—',
      r.usedKg !== null ? <span style={{ color: SERA.amber, fontWeight: 600 }}>{fmtNum(r.usedKg)}</span> : '—',
      r.remainingKg !== null ? fmtNum(r.remainingKg) : '—',
      r.remainingTotal !== null ? fmtNum(r.remainingTotal, 2) : '—',
      r.truckPlate ?? '—',
      r.issuedAt ?? '—',
      r.expiresAt ?? '—',
      r.status.includes('geçdi') ? <span style={{ color: SERA.neg }}>{r.status}</span> : r.status,
    ],
  }));

  return (
    <>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
        {(['Sertnamalar', 'Invoice', 'Alyjylar'] as const).map((t) => (
          <TabButton key={t} label={t} active={t === subTab} onClick={() => setSubTab(t)} />
        ))}
      </div>
      {subTab === 'Invoice' && <InvoiceTab />}
      {subTab === 'Alyjylar' && <AlyjylarTab />}
      {subTab === 'Sertnamalar' && (
        <SeraCard title="Yurtdışı Sertnamaları" extra="Fitosanitariya, Saglyk, Gelip çykyş we beýleki halkara şahadatnamalary">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            <WeekNavButton active={company === 'Hemmesi'} onClick={() => setCompany('Hemmesi')} label={`Hemmesi (${SERTNAMA_TOTAL})`} />
            {SERTNAMA_COMPANIES.map((c) => (
              <WeekNavButton key={c.name} active={company === c.name} onClick={() => setCompany(c.name)} label={`${c.name} (${c.count})`} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <WeekNavButton active={zdelka === 'Hemmesi'} onClick={() => setZdelka('Hemmesi')} label={`Hemmesi (${SERTNAMA_ZDELKA.total})`} />
            <WeekNavButton active={zdelka === 'Pasport'} onClick={() => setZdelka('Pasport')} label={`Pasport (${SERTNAMA_ZDELKA.pasport})`} />
            <WeekNavButton active={zdelka === 'Bezpasport'} onClick={() => setZdelka('Bezpasport')} label={`Bezpasport (${SERTNAMA_ZDELKA.bezpasport})`} />
          </div>
          <SeraMatrixTable headers={headers} rows={rows} numeric={false} minWidth={1700} />
        </SeraCard>
      )}
    </>
  );
}

// ─── Datalar tab ─────────────────────────────────────────────────────────
function DatalarTab() {
  const headers = [
    '#', 'Resminamalar', 'Eksport eden Firma', 'Şirket adı kısalt.', 'Kontrokt nom', 'Invoice nom',
    'Export kg (Resmi)', 'Eksport ýurdy', 'Müşderi ady', 'Müşderi tel.', 'TM çykan nokady', 'Şäheri',
    'Ýygym ýagdaýy', 'Peregruz ýagdaýy', 'Import Firma', 'Pomidor görnüşi', 'Plaka',
  ];
  const tagCell = (tag: DatalarTag | null): ReactNode =>
    tag ? <Pill label={tag.text} bg={tag.color} color={pickTextColor(tag.color)} /> : '—';

  const rows: MatrixRow[] = DATALAR_ROWS.map((r) => ({
    label: r.no,
    cells: [
      tagCell(r.resminamalar), r.exportFirm, r.shortCode, r.kontroktNom, r.invoiceNom, '—',
      tagCell(r.eksportYurdy), r.musderiAdy ?? '—', r.musderiTel ?? '—', tagCell(r.tmCykanNokady), r.saheri ?? '—',
      tagCell(r.yygymYagdayy), tagCell(r.peregruzYagdayy), r.importFirma ?? '—', r.pomidorGornusi ?? '—', r.plaka ?? '—',
    ],
  }));

  return (
    <SeraCard title="Datalar" extra="Bu tablodaky maglumatlar Tırlar sahypasynda saýlaw hökmünde çykar.">
      <SeraMatrixTable headers={headers} rows={rows} numeric={false} minWidth={1900} />
    </SeraCard>
  );
}

function renderTirTab(tab: TirTab): ReactNode {
  switch (tab) {
    case 'Gaplama': return <GaplamaTab />;
    case 'Tırlar': return <TirlarTab />;
    case 'Export Rapory': return <ExportRaporuTab />;
    case 'Hasabat': return <HasabatTab />;
    case 'Gümrük Ewraklary': return <GumrukTab />;
    case 'Kwota Takyby': return <KwotaTab />;
    case 'Daşary Sertnamalary': return <SertnamaTab />;
    case 'Datalar': return <DatalarTab />;
    case 'Önümçilik': return null;
    default: return null;
  }
}

export default function SeraTirTakip() {
  const [tab, setTab] = useState<TirTab>('Önümçilik');
  const [askOpen, setAskOpen] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [blocks, setBlocks] = useState<string[]>(['DUS-A']);
  const [dayValues, setDayValues] = useState<Record<string, number[]>>(
    () => Object.fromEntries(Object.entries(TIR_WEEKLY_KG_BY_BLOCK).map(([k, v]) => [k, [...v]])),
  );

  const weekStart = useMemo(() => addDays(new Date(), weekOffset * 7), [weekOffset]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const handleDayChange = (blockId: string, dayIdx: number, value: number): void => {
    setDayValues((prev) => {
      const next = { ...prev, [blockId]: [...(prev[blockId] ?? [0, 0, 0, 0, 0, 0, 0])] };
      next[blockId][dayIdx] = value;
      return next;
    });
  };

  const selectedBlocks = SERA_BLOCKS.filter((b) => blocks.includes(b.id));

  const dayHeaders = weekDays.map((d, i) => (weekOffset === 0 && i === 0 ? `${fmtDM(d)} · şu gün` : fmtDM(d)));
  const headers = ['Blok', ...dayHeaders, 'JEMI'];

  const blockRows: MatrixRow[] = selectedBlocks.map((b) => {
    const values = dayValues[b.id] ?? [0, 0, 0, 0, 0, 0, 0];
    const total = values.reduce((s, v) => s + v, 0);
    const cells: ReactNode[] = values.map((v, i) => (
      <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
        <InputNumber
          value={v}
          min={0}
          step={500}
          controls={false}
          size="small"
          style={{ width: 110 }}
          onChange={(val) => handleDayChange(b.id, i, Number(val ?? 0))}
        />
        <span style={{ fontSize: 11, color: SERA.sub }}>Export+Gapy: 0</span>
      </div>
    ));
    cells.push(<b>{fmtNum(total)}</b>);
    return { label: b.name, cells };
  });

  const dayTotals = Array.from({ length: 7 }, (_, i) => selectedBlocks.reduce((s, b) => s + (dayValues[b.id]?.[i] ?? 0), 0));
  const weekTotal = dayTotals.reduce((s, v) => s + v, 0);

  const jemiRow: MatrixRow = {
    label: 'JEMI (gün)',
    bold: true,
    cells: [
      ...dayTotals.map((v, i) => <span key={i} style={{ color: SERA.green, fontWeight: 700 }}>{fmtNum(v)}</span>),
      <span style={{ color: SERA.green, fontWeight: 700 }}>{fmtNum(weekTotal)}</span>,
    ],
  };
  const truckRow: MatrixRow = {
    label: (
      <span>
        Tır sany — Domates{' '}
        <span style={{ fontWeight: 400, color: SERA.sub, fontSize: 12 }}>(÷20.000 kg)</span>
      </span>
    ),
    cells: [
      ...dayTotals.map((v, i) => <span key={i} style={{ color: SERA.amber, fontWeight: 600 }}>{fmtTruckCount(v)}</span>),
      <span style={{ color: SERA.amber, fontWeight: 700 }}>{fmtTruckCount(weekTotal)}</span>,
    ],
  };

  const rows: MatrixRow[] = [...blockRows, jemiRow, truckRow];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SeraPageHeader
        icon={<IconTruck size={22} />}
        title="Maşyn Yzarlama (Tır Takip)"
        subtitle="Önümçilik meýilnamasyndan awtomatiki tır teklipleri, QR ýagdaýly yzarlama"
        accent={TIR_ACCENT}
        accentDark={TIR_ACCENT_DARK}
      />

      {/* Help / FAQ bar */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setAskOpen((o) => !o)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderRadius: 12, background: SERA.card, border: `1px solid ${SERA.line}`, color: SERA.green, fontWeight: 500, cursor: 'pointer' }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <IconMessageCircle size={18} /> Maşyn Yzarlamasy hakynda soru sor — nähili hasaplanýar, maglumatlar nireden gelýär?
        </span>
        <IconChevronDown size={18} style={{ transform: askOpen ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s ease' }} />
      </div>
      {askOpen && (
        <SeraCard>
          <div style={{ fontSize: 13, color: SERA.sub }}>
            Tır teklipleri Önümçilik — Haftalyk Meýilnama tablisasyndaky kg-lardan awtomatiki hasaplanýar: her günüň jemi kg-sy 20.000 kg-a bölünýär. Blok saýlawyny üýtgedip, diňe gerekli bloklaryň hataryny görkezip bilersiňiz.
          </div>
        </SeraCard>
      )}

      {/* Tab row */}
      <div style={{ display: 'flex', overflowX: 'auto', borderBottom: `1px solid ${SERA.line}`, background: SERA.card, borderRadius: 12, padding: '0 12px' }}>
        {TABS.map((t) => (
          <TabButton key={t} label={t} active={t === tab} onClick={() => setTab(t)} />
        ))}
      </div>

      {tab !== 'Önümçilik' ? (
        renderTirTab(tab)
      ) : (
        <>
          {/* Week navigator */}
          <SeraCard>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 6 }}>
              <span style={{ fontWeight: 700, color: SERA.ink }}>Önümçilik — Haftalyk Meýilnama</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <WeekNavButton label="◀ Öňki hepde" active={false} onClick={() => setWeekOffset((o) => o - 1)} />
                <WeekNavButton label="Şu hepde" active={weekOffset === 0} onClick={() => setWeekOffset(0)} />
                <WeekNavButton label="Indiki hepde ▶" active={false} onClick={() => setWeekOffset((o) => o + 1)} />
              </div>
            </div>
            <div style={{ fontSize: 13, color: SERA.ink, fontWeight: 600, marginBottom: 4 }}>
              {fmtDMY(weekDays[0])} — {fmtDMY(weekDays[6])}
            </div>
            <div style={{ fontSize: 12, color: SERA.sub }}>
              Her gün üçin Üretim Plany&apos;ndan gelen kg (mawy, salt okalýar) we müdiriň ýazan hakyky kg-sy (ýaşyl, el bilen).
            </div>
          </SeraCard>

          {/* Block selector */}
          <SeraBlockSelector selected={blocks} onChange={setBlocks} title="Blok Saýlawy" />

          {/* Weekly grid */}
          <SeraCard title="Blok boýunça hepdelik tır meýilnamasy">
            {selectedBlocks.length === 0 ? (
              <div style={{ fontSize: 13, color: SERA.sub }}>Görkezmek üçin azyndan bir blok saýlaň.</div>
            ) : (
              <SeraMatrixTable headers={headers} rows={rows} minWidth={1080} />
            )}
          </SeraCard>
        </>
      )}
    </div>
  );
}
