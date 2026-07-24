import { useState } from 'react';
import { Select } from 'antd';
import {
  IconFileInvoice, IconMessageCircle, IconChevronDown, IconAlertTriangle,
  IconPencil, IconArrowUp, IconArrowDown, IconTrash, IconPlus,
} from '@tabler/icons-react';
import { SeraPageHeader } from '../../components/SeraPageHeader';
import { SeraCard } from '../../components/SeraCard';
import { SeraMatrixTable, type MatrixRow } from '../../components/SeraMatrixTable';
import { SERA, fmtUsd, fmtKg } from '../../seraTheme';
import { SERA_BLOCKS, SERA_TOTALS, MONTHS_TR } from '../../mock/seraData';
import {
  ADMIN_ITEM_LABELS, OFFICE_ITEM_LABELS, PERSONEL_BY_BLOCK, MINI_EXPENSE_STRIPS,
  type MiniExpenseStripData,
} from '../../mock/genelYonetimGiderleri';

// ─── Local types + helpers ─────────────────────────────────────────────────
interface GroupRow {
  readonly id: string;
  readonly label: string;
  readonly values: number[]; // 12 months
}

function makeRows(labels: readonly string[], prefix: string): GroupRow[] {
  return labels.map((label, i) => ({ id: `${prefix}-${i}`, label, values: Array(12).fill(0) }));
}
function rowTotal(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
function groupTotal(rows: readonly GroupRow[]): number {
  return rows.reduce((a, r) => a + rowTotal(r.values), 0);
}
function monthTotals(rows: readonly GroupRow[]): number[] {
  return Array.from({ length: 12 }, (_, m) => rows.reduce((a, r) => a + r.values[m], 0));
}
/** Aggregated monthly cells render as a dash when zero; totals always show the $ figure. */
function dashUsd(v: number): string {
  return v === 0 ? '—' : fmtUsd(v);
}

const cellInputStyle: React.CSSProperties = {
  width: 48,
  padding: '4px 4px',
  borderRadius: 6,
  border: `1px solid ${SERA.line}`,
  textAlign: 'right',
  fontSize: 12,
  color: SERA.ink,
};

function iconBtnStyle(disabled: boolean, danger = false): React.CSSProperties {
  return {
    width: 24,
    height: 24,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    border: `1px solid ${SERA.line}`,
    background: disabled ? '#f3f4f6' : SERA.card,
    color: disabled ? SERA.line : danger ? SERA.neg : SERA.ink,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}

// ─── Editable expense group (Dolandyryş / Ofis) ────────────────────────────
interface ExpenseGroupSectionProps {
  readonly title: string;
  readonly rows: GroupRow[];
  readonly onRowsChange: (rows: GroupRow[]) => void;
}

function ExpenseGroupSection({ title, rows, onRowsChange }: ExpenseGroupSectionProps) {
  const [newLabel, setNewLabel] = useState('');

  const updateCell = (rowId: string, month: number, value: number) => {
    onRowsChange(rows.map((r) => (r.id === rowId ? { ...r, values: r.values.map((v, i) => (i === month ? value : v)) } : r)));
  };
  const moveRow = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    onRowsChange(next);
  };
  const deleteRow = (rowId: string) => onRowsChange(rows.filter((r) => r.id !== rowId));
  const addRow = () => {
    const label = newLabel.trim();
    if (!label) return;
    onRowsChange([...rows, { id: `new-${Date.now()}`, label, values: Array(12).fill(0) }]);
    setNewLabel('');
  };

  const total = groupTotal(rows);
  const monthly = monthTotals(rows);

  const tableRows: MatrixRow[] = rows.map((r, i) => ({
    label: (
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <IconPencil size={13} style={{ color: SERA.sub, flexShrink: 0 }} />
        {r.label}
      </span>
    ),
    cells: [
      ...r.values.map((v, m) => (
        <input
          key={m}
          type="number"
          value={v}
          onChange={(e) => updateCell(r.id, m, Number(e.target.value) || 0)}
          style={cellInputStyle}
        />
      )),
      fmtUsd(rowTotal(r.values)),
      <span style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
        <button type="button" disabled={i === 0} onClick={() => moveRow(i, -1)} title="Yukarı taşı" style={iconBtnStyle(i === 0)}>
          <IconArrowUp size={13} />
        </button>
        <button
          type="button"
          disabled={i === rows.length - 1}
          onClick={() => moveRow(i, 1)}
          title="Aşağı taşı"
          style={iconBtnStyle(i === rows.length - 1)}
        >
          <IconArrowDown size={13} />
        </button>
        <button type="button" onClick={() => deleteRow(r.id)} title="Kalemi sil" style={iconBtnStyle(false, true)}>
          <IconTrash size={13} />
        </button>
      </span>,
    ],
  }));

  const footer: MatrixRow = {
    label: 'Grup Toplamı',
    bold: true,
    cells: [...monthly.map((v) => dashUsd(v)), fmtUsd(total), ''],
  };

  return (
    <SeraCard title={title} extra={<b style={{ color: SERA.ink, fontSize: 15 }}>{fmtUsd(total)}</b>}>
      <SeraMatrixTable headers={['Kalem', ...MONTHS_TR, 'Toplam', '']} rows={tableRows} footer={footer} minWidth={1450} />
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Yeni kalem adı..."
          style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: `1px solid ${SERA.line}`, fontSize: 13, color: SERA.ink }}
        />
        <button
          type="button"
          onClick={addRow}
          style={{
            padding: '8px 16px', borderRadius: 8, border: 'none', background: SERA.green, color: '#fff',
            fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
          }}
        >
          <IconPlus size={14} /> Ekle
        </button>
      </div>
    </SeraCard>
  );
}

// ─── Read-only related cost-center strip (760.0x) ──────────────────────────
function MiniExpenseStrip({ data }: { data: MiniExpenseStripData }) {
  return (
    <div style={{ background: SERA.card, border: `1px solid ${SERA.line}`, borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', background: data.bg }}>
        <span style={{ fontWeight: 700, color: data.color }}>{data.code} — {data.title}</span>
        <span style={{ fontWeight: 700, color: data.color }}>{fmtUsd(data.total)}</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 900, borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {[...MONTHS_TR, 'Toplam'].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: '8px 12px', textAlign: 'right', color: SERA.sub, fontWeight: 600, fontSize: 12,
                    textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: `2px solid ${SERA.line}`, whiteSpace: 'nowrap',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {data.months.map((m, i) => (
                <td key={i} style={{ padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: SERA.ink }}>
                  {dashUsd(m)}
                </td>
              ))}
              <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: data.color }}>
                {fmtUsd(data.total)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────
const DIST_MODE_OPTIONS = [
  { value: 'esit', label: 'Eşit (blok sayısına böl)' },
  { value: 'alan', label: 'm² alana göre' },
  { value: 'uretim', label: 'üretime göre' },
  { value: 'personel', label: 'personel sayısına göre' },
];

export default function GenelYonetimGiderleri() {
  const [year] = useState(2026);
  const [distMode, setDistMode] = useState('uretim');
  const [adminRows, setAdminRows] = useState<GroupRow[]>(() => makeRows(ADMIN_ITEM_LABELS, 'adm'));
  const [officeRows, setOfficeRows] = useState<GroupRow[]>(() => makeRows(OFFICE_ITEM_LABELS, 'ofc'));

  const adminTotal = groupTotal(adminRows);
  const officeTotal = groupTotal(officeRows);
  const adminMonthly = monthTotals(adminRows);
  const officeMonthly = monthTotals(officeRows);
  const grandTotal = adminTotal + officeTotal;
  const grandMonthly = adminMonthly.map((v, i) => v + officeMonthly[i]);

  const totalPersonel = SERA_BLOCKS.reduce((a, b) => a + (PERSONEL_BY_BLOCK[b.id] ?? 0), 0);

  // ─── Bloklara Dağılım — distribution preview stays static (no gider entered yet) ───
  const blockRows: MatrixRow[] = SERA_BLOCKS.map((b) => ({
    label: b.name,
    cells: [
      String(b.areaGa),
      <span style={{ color: SERA.green, fontWeight: 600 }}>{fmtKg(b.productionKg)}</span>,
      String(PERSONEL_BY_BLOCK[b.id] ?? 0),
      '%0',
      '0 $',
    ],
  }));
  const blockFooter: MatrixRow = {
    label: 'Toplam',
    bold: true,
    cells: [
      String(SERA_TOTALS.areaGa),
      <span style={{ color: SERA.green, fontWeight: 700 }}>{fmtKg(SERA_TOTALS.productionKg)}</span>,
      String(totalPersonel),
      '%100',
      '0 $',
    ],
  };

  // ─── Aylık Toplam Özeti ─────────────────────────────────────────────────
  const summaryRows: MatrixRow[] = [
    { label: 'Dolandyryş Çykdajylary', cells: [...adminMonthly.map(dashUsd), fmtUsd(adminTotal)] },
    { label: 'Ofis Çykdajylary', cells: [...officeMonthly.map(dashUsd), fmtUsd(officeTotal)] },
  ];
  const summaryFooter: MatrixRow = {
    label: '770 Genel Toplam',
    bold: true,
    cells: [...grandMonthly.map(dashUsd), fmtUsd(grandTotal)],
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SeraPageHeader
        icon={<IconFileInvoice size={22} />}
        title="Genel Yönetim Giderleri"
        subtitle="770 — Dolandyryş ve Ofis giderleri. Tüm kalemler elle, aylık bazda girilir. Bloklara bağlı değildir."
        accent={SERA.blue}
        accentDark="#1e40af"
        year={year}
        extra={
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, opacity: 0.85 }}>Yıllık Toplam</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{fmtUsd(grandTotal)}</div>
          </div>
        }
      />

      {/* Ask bar (decorative) */}
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderRadius: 12, background: SERA.card, border: `1px solid ${SERA.line}`,
          color: SERA.blue, fontWeight: 500, cursor: 'pointer',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <IconMessageCircle size={18} /> Genel Yönetim Giderleri (770) hakkında soru sor — nasıl hesaplanıyor, veriler nereden geliyor?
        </span>
        <IconChevronDown size={18} />
      </div>

      {/* Bloklara Dağılım */}
      <SeraCard
        title="Bloklara Dağılım"
        extra={
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            Dağıtım modu:
            <Select
              value={distMode}
              onChange={setDistMode}
              options={DIST_MODE_OPTIONS}
              size="small"
              style={{ width: 210 }}
            />
          </span>
        }
      >
        <div style={{ fontSize: 12, color: SERA.sub, marginBottom: 12 }}>
          Toplam gider, her bloğun yıllık ürettiği miktar (kg) oranında dağıtılır. Hiç üretim yoksa alana göre dağıtılır.
        </div>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 8,
            background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', fontSize: 12, marginBottom: 14,
          }}
        >
          <IconAlertTriangle size={16} style={{ flexShrink: 0, color: SERA.amber }} />
          Henüz hiçbir kaleme tutar girilmedi. Tutar sütunu, aşağıdaki kalemlere değer girince dolacaktır.
        </div>
        <SeraMatrixTable
          headers={['Blok', 'Alan (GA)', 'Üretim (yıllık, kg) ●', 'Personel (12 ay ort.)', 'Pay %', 'Tutar']}
          rows={blockRows}
          footer={blockFooter}
          minWidth={720}
        />
      </SeraCard>

      {/* Dolandyryş Çykdajylary */}
      <ExpenseGroupSection title="Dolandyryş Çykdajylary" rows={adminRows} onRowsChange={setAdminRows} />

      {/* Ofis Çykdajylary */}
      <ExpenseGroupSection title="Ofis Çykdajylary" rows={officeRows} onRowsChange={setOfficeRows} />

      {/* Aylık Toplam Özeti */}
      <SeraCard title="Aylık Toplam Özeti">
        <SeraMatrixTable headers={['Grup', ...MONTHS_TR, 'Toplam']} rows={summaryRows} footer={summaryFooter} minWidth={1200} />
      </SeraCard>

      {/* Related cost centers (760.0x — not part of 770) */}
      {MINI_EXPENSE_STRIPS.map((s) => (
        <MiniExpenseStrip key={s.code} data={s} />
      ))}
    </div>
  );
}
