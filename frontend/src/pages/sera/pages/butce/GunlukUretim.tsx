import { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import {
  IconCalendarStats, IconChevronLeft, IconChevronRight, IconMessageCircle, IconChevronDown,
} from '@tabler/icons-react';
import { SeraPageHeader } from '../../components/SeraPageHeader';
import { SeraCard } from '../../components/SeraCard';
import { SeraMatrixTable, type MatrixRow } from '../../components/SeraMatrixTable';
import { SERA } from '../../seraTheme';
import { SERA_BLOCKS_BY_GROUP } from '../../mock/seraData';

const DAY_NAMES_TR = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const MONTHS_TR_FULL = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

const ALL_BLOCKS = SERA_BLOCKS_BY_GROUP.flatMap((g) => g.blocks);

const navBtnStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 8,
  border: `1px solid ${SERA.line}`,
  background: SERA.card,
  color: SERA.ink,
  cursor: 'pointer',
};

export default function GunlukUretim() {
  const [date, setDate] = useState('2026-07-23');
  const [actuals, setActuals] = useState<Record<string, number>>(() =>
    Object.fromEntries(ALL_BLOCKS.map((b) => [b.id, 0])),
  );

  const d = useMemo(() => dayjs(date), [date]);
  const dateLabel = `${d.date()} ${MONTHS_TR_FULL[d.month()]} ${d.year()} ${DAY_NAMES_TR[d.day()]}`;

  const shiftDate = (days: number) => setDate(d.add(days, 'day').format('YYYY-MM-DD'));

  const rows: MatrixRow[] = ALL_BLOCKS.map((b) => ({
    label: b.name,
    cells: [
      '—',
      <input
        key={b.id}
        type="number"
        value={actuals[b.id] ?? 0}
        onChange={(e) => {
          const next = Number(e.target.value);
          setActuals((prev) => ({ ...prev, [b.id]: Number.isNaN(next) ? 0 : next }));
        }}
        style={{
          width: 90,
          padding: '6px 8px',
          borderRadius: 8,
          border: `1px solid ${SERA.line}`,
          textAlign: 'right',
          fontSize: 13,
          color: SERA.ink,
        }}
      />,
      '—',
    ],
  }));

  const footer: MatrixRow = { label: 'Jemi', cells: ['—', '—', '—'], bold: true };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SeraPageHeader
        icon={<IconCalendarStats size={22} />}
        title="Günlük Üretim Girişi"
        subtitle="Günlük Önümçilik Girizme"
        year={2026}
      />

      {/* Ask bar (decorative) */}
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderRadius: 12, background: SERA.card, border: `1px solid ${SERA.line}`,
          color: SERA.green, fontWeight: 500, cursor: 'pointer',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <IconMessageCircle size={18} /> Günlük Üretim Girişi hakkında soru sor — nasıl hesaplanıyor, veriler nereden geliyor?
        </span>
        <IconChevronDown size={18} />
      </div>

      {/* Date navigator */}
      <SeraCard>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button type="button" onClick={() => shiftDate(-1)} style={navBtnStyle} aria-label="Öňki gün">
            <IconChevronLeft size={16} />
          </button>
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: `1px solid ${SERA.line}`, fontSize: 14, color: SERA.ink }}
          />
          <button type="button" onClick={() => shiftDate(1)} style={navBtnStyle} aria-label="Indiki gün">
            <IconChevronRight size={16} />
          </button>
          <button
            type="button"
            onClick={() => setDate(dayjs().format('YYYY-MM-DD'))}
            style={{
              padding: '8px 18px', borderRadius: 8, border: `1px solid ${SERA.green}`,
              background: SERA.greenSoft, color: SERA.green, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            Bugün
          </button>
        </div>
        <div style={{ textAlign: 'center', marginTop: 12, color: SERA.sub, fontSize: 13 }}>{dateLabel}</div>
      </SeraCard>

      {/* Daily entry table */}
      <SeraCard>
        <SeraMatrixTable
          headers={['Blok', 'Meýilnama (kg)', 'Hakyky (kg)', 'Tapawut']}
          rows={rows}
          footer={footer}
          minWidth={560}
        />
        <div style={{ marginTop: 10, fontSize: 12, color: SERA.sub }}>Girişler otomatik ýatda saklanýar.</div>
      </SeraCard>
    </div>
  );
}
