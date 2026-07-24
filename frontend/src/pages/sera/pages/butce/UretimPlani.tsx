import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Input } from 'antd';
import {
  IconCalendarEvent, IconMessageCircle, IconChevronDown, IconPlus, IconTrash, IconClipboard,
} from '@tabler/icons-react';
import { SeraPageHeader } from '../../components/SeraPageHeader';
import { SeraCard } from '../../components/SeraCard';
import { SeraMatrixTable, type MatrixRow } from '../../components/SeraMatrixTable';
import { SERA, fmtNum } from '../../seraTheme';
import { SERA_BLOCKS, SERA_BLOCKS_BY_GROUP, MONTHS_TR } from '../../mock/seraData';
import {
  UP_WEEKS, UP_WEEKLY_PLAN_BY_BLOCK, UP_DEFAULT_IZIN_GUNLERI, UP_YEAR, type IzinGunu, type UpWeek,
} from '../../mock/uretimPlani';

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function toDMY(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}
function workDayCount(week: UpWeek, holidays: Set<string>): number {
  return week.days.filter((d) => !d.isSunday && !holidays.has(isoDate(d.date))).length;
}
function fmtDaily(v: number): string {
  const rounded = Math.round(v * 10) / 10;
  return Number.isInteger(rounded) ? fmtNum(rounded, 0) : fmtNum(rounded, 1);
}

// ─── Small local UI helpers ────────────────────────────────────────────────
function TinyButton({ label, onClick }: { readonly label: string; readonly onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ padding: '4px 10px', borderRadius: 8, border: `1px solid ${SERA.line}`, background: SERA.greenSoft, color: SERA.green, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
    >
      {label}
    </button>
  );
}
function Chip({ label, active, onClick, accent = SERA.green }: {
  readonly label: string; readonly active: boolean; readonly onClick: () => void; readonly accent?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '5px 12px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer',
        border: `1px solid ${active ? accent : SERA.line}`, background: active ? accent : SERA.card,
        color: active ? '#fff' : SERA.ink,
      }}
    >
      {active && '✓ '}{label}
    </button>
  );
}

export default function UretimPlani() {
  const [askOpen, setAskOpen] = useState(false);
  const [izinGunleri, setIzinGunleri] = useState<IzinGunu[]>([...UP_DEFAULT_IZIN_GUNLERI]);
  const [newDate, setNewDate] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [blocks, setBlocks] = useState<string[]>(['DUS-A']);
  const [months, setMonths] = useState<number[]>([0]);
  const [singleBlock, setSingleBlock] = useState('DUS-A');
  const [weeklyPlan, setWeeklyPlan] = useState<Record<string, number[]>>(
    () => Object.fromEntries(Object.entries(UP_WEEKLY_PLAN_BY_BLOCK).map(([k, v]) => [k, [...v]])),
  );

  const holidaySet = useMemo(() => new Set(izinGunleri.map((g) => g.date)), [izinGunleri]);
  const visibleWeeks = useMemo(
    () => UP_WEEKS.filter((w) => months.length > 0 && w.days.some((d) => months.includes(d.month))),
    [months],
  );

  const handleAddIzin = (): void => {
    if (!newDate) return;
    setIzinGunleri((prev) => [...prev, { date: newDate, label: newLabel || '—' }]);
    setNewDate('');
    setNewLabel('');
  };
  const handleDeleteIzin = (idx: number): void => {
    setIzinGunleri((prev) => prev.filter((_, i) => i !== idx));
  };
  const toggleBlock = (id: string): void => {
    setBlocks((prev) => (prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]));
  };
  const toggleGroupBlocks = (ids: string[]): void => {
    const allOn = ids.every((id) => blocks.includes(id));
    setBlocks((prev) => {
      const set = new Set(prev);
      ids.forEach((id) => (allOn ? set.delete(id) : set.add(id)));
      return [...set];
    });
  };
  const toggleMonth = (m: number): void => {
    setMonths((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m].sort((a, b) => a - b)));
  };
  const handleWeekChange = (blockId: string, weekIdx: number, value: number): void => {
    setWeeklyPlan((prev) => {
      const next = { ...prev, [blockId]: [...(prev[blockId] ?? [])] };
      next[blockId][weekIdx] = value;
      return next;
    });
  };

  // ─── Haftalık Üretim Planı table ─────────────────────────────────────────
  const weekHeaders = ['Hafta', ...blocks.map((id) => SERA_BLOCKS.find((b) => b.id === id)?.name ?? id), 'Toplam'];
  const weekRows: MatrixRow[] = visibleWeeks.map((w) => {
    const cells: ReactNode[] = blocks.map((bid) => (
      <input
        key={bid}
        type="number"
        value={weeklyPlan[bid]?.[w.weekNumber - 1] ?? 0}
        onChange={(e) => handleWeekChange(bid, w.weekNumber - 1, Number(e.target.value))}
        style={{ width: 110, textAlign: 'right', padding: '4px 8px', border: `1px solid ${SERA.line}`, borderRadius: 6, fontSize: 13 }}
      />
    ));
    const total = blocks.reduce((s, bid) => s + (weeklyPlan[bid]?.[w.weekNumber - 1] ?? 0), 0);
    cells.push(fmtNum(total));
    return { label: `Hafta ${w.weekNumber}`, cells };
  });

  // ─── Günlük Dağılım (single block) table ─────────────────────────────────
  const dailyHeaders = ['Hafta', 'Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
  const dailyRows: MatrixRow[] = visibleWeeks.map((w) => {
    const total = weeklyPlan[singleBlock]?.[w.weekNumber - 1] ?? 0;
    const wd = workDayCount(w, holidaySet);
    const perDay = wd > 0 ? total / wd : 0;
    const cells: ReactNode[] = w.days.map((d) => {
      const iso = isoDate(d.date);
      const isHoliday = !d.isSunday && holidaySet.has(iso);
      let valueNode: ReactNode;
      if (d.isSunday) valueNode = <span style={{ color: SERA.sub }}>—</span>;
      else if (isHoliday) valueNode = <span style={{ color: SERA.amber, fontWeight: 600 }}>İzin</span>;
      else valueNode = fmtDaily(perDay);
      return (
        <div key={iso} style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: d.isSunday ? SERA.red : SERA.sub }}>{d.day}</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: SERA.ink }}>{valueNode}</div>
        </div>
      );
    });
    return { label: `Hafta ${w.weekNumber}`, cells };
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SeraPageHeader
        icon={<IconCalendarEvent size={22} />}
        title="Üretim Planı"
        subtitle="Danışmanın verdiği haftalık tonajları girin — Pazar ve izin günlerinde üretim gösterilmez"
        year={UP_YEAR}
      />

      {/* Help / FAQ bar */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setAskOpen((o) => !o)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderRadius: 12, background: SERA.card, border: `1px solid ${SERA.line}`, color: SERA.green, fontWeight: 500, cursor: 'pointer' }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <IconMessageCircle size={18} /> Üretim Planı hakkında soru sor — nasıl hesaplanıyor, veriler nereden geliyor?
        </span>
        <IconChevronDown size={18} style={{ transform: askOpen ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s ease' }} />
      </div>
      {askOpen && (
        <SeraCard>
          <div style={{ fontSize: 13, color: SERA.sub }}>
            Haftalık tonajlar bu sayfada girilýär; her hafta awtomatiki suratda Pazar we goşan izin günleriňizden başga galan iş günlerine deň bölünýär. Aýlyk we ýyllyk hasabatlar (Aylık Üretim, Bütçe Dashboard) şu ýerdäki maglumatlardan hasaplanýar.
          </div>
        </SeraCard>
      )}

      {/* Yıllık İzin Günleri */}
      <SeraCard title="Yıllık İzin Günleri">
        <div style={{ fontSize: 13, color: SERA.sub, marginBottom: 12 }}>
          Eklediğiniz tarihler haftalık dağıtımda Pazar günü gibi kabul edilir; o günlerde üretim gösterilmez ve haftalık toplam kalan çalışma günlerine bölünür.
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            style={{ padding: '6px 10px', border: `1px solid ${SERA.line}`, borderRadius: 8, fontSize: 13 }}
          />
          <Input
            placeholder="Açıklama (ör. Bayram tatili)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            style={{ maxWidth: 240 }}
          />
          <Button type="primary" icon={<IconPlus size={15} />} style={{ background: SERA.green, borderColor: SERA.green }} onClick={handleAddIzin}>
            Ekle
          </Button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {izinGunleri.length === 0 && <div style={{ fontSize: 13, color: SERA.sub }}>Entäk goşulan gün ýok.</div>}
          {izinGunleri.map((g, idx) => (
            <div key={`${g.date}-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 14px', background: SERA.greenSoft, borderRadius: 8 }}>
              <span style={{ fontSize: 13, color: SERA.ink }}>
                {toDMY(g.date)} <span style={{ color: SERA.sub }}>— {g.label}</span>
              </span>
              <button type="button" onClick={() => handleDeleteIzin(idx)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: SERA.sub, display: 'flex' }}>
                <IconTrash size={16} />
              </button>
            </div>
          ))}
        </div>
      </SeraCard>

      {/* Blok Seçimi */}
      <SeraCard title="Blok Seçimi (birden fazla)">
        <div style={{ fontSize: 13, color: SERA.sub, marginBottom: 12 }}>
          Tabloda uzun sayıların sığması için bir kerede az sayıda blok seçmeniz önerilir.
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <TinyButton label="Tümünü Seç" onClick={() => setBlocks(SERA_BLOCKS.map((b) => b.id))} />
          <TinyButton label="Temizle" onClick={() => setBlocks([])} />
        </div>
        {SERA_BLOCKS_BY_GROUP.map((g) => {
          const ids = g.blocks.map((b) => b.id);
          return (
            <div key={g.group} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: SERA.sub, marginBottom: 6 }}>
                {g.group}{' '}
                <button type="button" onClick={() => toggleGroupBlocks(ids)} style={{ border: 'none', background: 'none', color: SERA.green, fontSize: 12, cursor: 'pointer' }}>
                  (tümünü seç/kaldır)
                </button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {g.blocks.map((b) => (
                  <Chip key={b.id} label={b.name} active={blocks.includes(b.id)} onClick={() => toggleBlock(b.id)} />
                ))}
              </div>
            </div>
          );
        })}
      </SeraCard>

      {/* Ay Seçimi */}
      <SeraCard title="Ay Seçimi (birden fazla)">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <TinyButton label="Tüm Yıl" onClick={() => setMonths(MONTHS_TR.map((_, i) => i))} />
          <TinyButton label="Temizle" onClick={() => setMonths([])} />
          {MONTHS_TR.map((m, i) => (
            <Chip key={m} label={m} active={months.includes(i)} onClick={() => toggleMonth(i)} accent={SERA.blue} />
          ))}
        </div>
      </SeraCard>

      {/* Haftalık Üretim Planı */}
      <SeraCard
        title="Haftalık Üretim Planı"
        extra={<Button icon={<IconClipboard size={15} />}>Excel'den Yapıştır</Button>}
      >
        <div style={{ fontSize: 13, color: SERA.sub, marginBottom: 12 }}>
          Danışmanın verdiği haftalık tonaj değerlerini blok başına girin; her hafta otomatik olarak çalışma günlerine (Pazar ve izin günleri hariç) eşit bölünür.
        </div>
        {blocks.length === 0 || visibleWeeks.length === 0 ? (
          <div style={{ fontSize: 13, color: SERA.sub }}>Görkezmek üçin azyndan bir blok we bir aý saýlaň.</div>
        ) : (
          <SeraMatrixTable headers={weekHeaders} rows={weekRows} minWidth={200 + blocks.length * 140} />
        )}
      </SeraCard>

      {/* Günlük Dağılım (Tek Blok) */}
      <SeraCard title="Günlük Dağılım (Tek Blok)">
        <div style={{ fontSize: 13, color: SERA.sub, marginBottom: 12 }}>
          Seçili bloğun haftalık tonajının güne göre nasıl bölündüğünü gösterir. Ay seçimi yukarıdaki "Ay Seçimi" ile ortaktır.
        </div>
        <select
          value={singleBlock}
          onChange={(e) => setSingleBlock(e.target.value)}
          style={{ padding: '6px 10px', border: `1px solid ${SERA.line}`, borderRadius: 8, fontSize: 13, marginBottom: 14 }}
        >
          {SERA_BLOCKS.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        {visibleWeeks.length === 0 ? (
          <div style={{ fontSize: 13, color: SERA.sub }}>Görkezmek üçin azyndan bir aý saýlaň.</div>
        ) : (
          <SeraMatrixTable headers={dailyHeaders} rows={dailyRows} minWidth={760} />
        )}
        <div style={{ fontSize: 12, color: SERA.sub, marginTop: 10 }}>
          Pazar günleri ("—") ve izin günleri ("İzin") üretim göstermez; haftalık toplam, kalan çalışma günlerine eşit bölünür.
        </div>
      </SeraCard>
    </div>
  );
}
