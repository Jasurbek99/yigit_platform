import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { InputNumber } from 'antd';
import {
  IconTruck, IconMessageCircle, IconChevronDown,
} from '@tabler/icons-react';
import { SeraPageHeader } from '../components/SeraPageHeader';
import { SeraCard } from '../components/SeraCard';
import { SeraBlockSelector } from '../components/SeraChipSelector';
import { SeraMatrixTable, type MatrixRow } from '../components/SeraMatrixTable';
import { SERA, fmtNum } from '../seraTheme';
import { SERA_BLOCKS } from '../mock/seraData';
import { TIR_WEEKLY_KG_BY_BLOCK, TIR_TRUCK_CAPACITY_KG } from '../mock/tirTakip';

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
        <SeraCard>
          <div style={{ padding: 24, textAlign: 'center', color: SERA.sub }}>
            {tab} — bu bölüm heniz taýýarlanýar…
          </div>
        </SeraCard>
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
