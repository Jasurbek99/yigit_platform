import { useState } from 'react';
import { IconPlant2, IconMessageCircle, IconChevronDown } from '@tabler/icons-react';
import { SeraPageHeader } from '../../components/SeraPageHeader';
import { SeraCard } from '../../components/SeraCard';
import { SeraStatCard } from '../../components/SeraStatCard';
import { SeraBlockSelector, SeraMonthSelector } from '../../components/SeraChipSelector';
import { SeraMatrixTable, type MatrixRow } from '../../components/SeraMatrixTable';
import { SERA, fmtNum, fmtKg } from '../../seraTheme';
import { SERA_BLOCKS, MONTHS_TR } from '../../mock/seraData';
import { MONTHLY_PRODUCTION_BY_BLOCK } from '../../mock/uretim';

export default function Uretim() {
  const [year] = useState(2026);
  const [blocks, setBlocks] = useState<string[]>(['DUS-A']);
  const [months, setMonths] = useState<number[]>([0]);

  const selectedBlocks = SERA_BLOCKS.filter((b) => blocks.includes(b.id));

  // ─── Production matrix ──────────────────────────────────────────────────
  const rows: MatrixRow[] = selectedBlocks.map((b) => {
    const monthly = MONTHLY_PRODUCTION_BY_BLOCK[b.id] ?? [];
    const rowTotal = months.reduce((sum, m) => sum + (monthly[m] ?? 0), 0);
    return {
      label: b.name,
      cells: [
        ...months.map((m) => fmtNum(monthly[m] ?? 0)),
        <span style={{ color: SERA.amber, fontWeight: 700 }}>{fmtKg(rowTotal)}</span>,
      ],
    };
  });

  const monthTotals = months.map((m) =>
    selectedBlocks.reduce((sum, b) => sum + (MONTHLY_PRODUCTION_BY_BLOCK[b.id]?.[m] ?? 0), 0),
  );
  const grandTotal = monthTotals.reduce((sum, v) => sum + v, 0);

  const footer: MatrixRow = {
    label: 'Ay Toplamı',
    cells: [...monthTotals.map((t) => fmtKg(t)), fmtKg(grandTotal)],
  };

  const headers = ['Blok', ...months.map((m) => MONTHS_TR[m]), 'Blok Toplamı'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SeraPageHeader
        icon={<IconPlant2 size={22} />}
        title="Aylık Üretim"
        subtitle="Bu değerler artık Üretim Planı sayfasındaki haftalık girişlerden otomatik hesaplanır; burada düzenlenemez."
        year={year}
      />

      {/* Help / FAQ bar */}
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderRadius: 12, background: SERA.card, border: `1px solid ${SERA.line}`,
          color: SERA.green, fontWeight: 500, cursor: 'pointer',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <IconMessageCircle size={18} /> Üretim hakkında soru sor — nasıl hesaplanıyor, veriler nereden geliyor?
        </span>
        <IconChevronDown size={18} />
      </div>

      <SeraBlockSelector selected={blocks} onChange={setBlocks} title="Blok Seçimi" />
      <SeraMonthSelector selected={months} onChange={setMonths} title="Ay Seçimi (birleştirilebilir)" />

      {/* Selection summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <SeraStatCard label="Seçili Blok" value={blocks.length} accent={SERA.green} />
        <SeraStatCard label="Seçili Ay" value={months.length} accent={SERA.blue} tint="#e6f0ff" />
        <SeraStatCard label="Birleşik Toplam Üretim" value={fmtKg(grandTotal)} accent={SERA.amber} tint="#fff4e0" />
      </div>

      {/* Production matrix */}
      <SeraCard title="Üretim Matrisi (kg) — Üretim Planı'ndan, salt okunur">
        <SeraMatrixTable headers={headers} rows={rows} footer={footer} minWidth={640} />
        <div style={{ fontSize: 12, color: SERA.sub, marginTop: 12 }}>
          Bu tablodaki sayıları değiştirmek için Üretim Planı sayfasındaki haftalık girişleri güncelleyin; aylık toplam buradan otomatik gelir.
        </div>
      </SeraCard>
    </div>
  );
}
