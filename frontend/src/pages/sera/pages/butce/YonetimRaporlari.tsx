import { useState } from 'react';
import { IconReportAnalytics, IconMessageCircle, IconChevronDown } from '@tabler/icons-react';
import { SeraPageHeader } from '../../components/SeraPageHeader';
import { SeraCard } from '../../components/SeraCard';
import { SeraBlockSelector } from '../../components/SeraChipSelector';
import { SeraMatrixTable, type MatrixRow } from '../../components/SeraMatrixTable';
import { SERA, fmtNum, fmtUsd, fmtDtm } from '../../seraTheme';
import {
  SERA_BLOCKS_BY_GROUP, MONTHS_TR, MONTHS_SHORT,
  SALES_QTY_BY_CHANNEL, SALES_QTY_TOTAL, SALES_AMT_BY_CHANNEL, SALES_AMT_USD_TOTAL,
} from '../../mock/seraData';

const ALL_BLOCK_IDS = SERA_BLOCKS_BY_GROUP.flatMap((g) => g.blocks.map((b) => b.id));

interface MonthChipsRowProps {
  readonly selected: ReadonlySet<number>;
  readonly onToggle: (index: number) => void;
  readonly accent: string;
}

/** Decorative per-table month toggle chips (visual only — table always shows full data). */
function MonthChipsRow({ selected, onToggle, accent }: MonthChipsRowProps) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {MONTHS_TR.map((m, i) => {
        const active = selected.has(i);
        return (
          <button
            key={m}
            type="button"
            onClick={() => onToggle(i)}
            style={{
              padding: '4px 10px',
              borderRadius: 7,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              border: `1px solid ${active ? accent : SERA.line}`,
              background: active ? accent : SERA.card,
              color: active ? '#fff' : SERA.ink,
            }}
          >
            {m}
          </button>
        );
      })}
    </div>
  );
}

export default function YonetimRaporlari() {
  const [blocks, setBlocks] = useState<string[]>(ALL_BLOCK_IDS);
  const [qtyMonths, setQtyMonths] = useState<Set<number>>(new Set(MONTHS_TR.map((_, i) => i)));
  const [amtMonths, setAmtMonths] = useState<Set<number>>(new Set([0, 1, 2, 3, 4, 5]));

  const toggleQtyMonth = (i: number) => {
    setQtyMonths((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };
  const toggleAmtMonth = (i: number) => {
    setAmtMonths((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  // ─── Quantity table ──────────────────────────────────────────────────────
  const qtyRows: MatrixRow[] = SALES_QTY_BY_CHANNEL.map((r) => ({
    label: r.channel,
    cells: [...r.months.map((m) => fmtNum(m)), <b>{fmtNum(r.total)}</b>],
  }));
  const qtyFooter: MatrixRow = {
    label: 'Jemi',
    cells: [...SALES_QTY_TOTAL.map((m) => fmtNum(m)), <b>{fmtNum(SALES_QTY_TOTAL.reduce((a, b) => a + b, 0))}</b>],
  };

  // ─── Amount table ────────────────────────────────────────────────────────
  const amtRows: MatrixRow[] = SALES_AMT_BY_CHANNEL.map((r) => {
    const isDtm = r.channel.includes('DTM');
    return {
      label: r.channel,
      cells: [
        ...r.months.map((m) => (m === 0 ? '—' : isDtm ? fmtDtm(m) : fmtUsd(m))),
        <b>{isDtm ? fmtDtm(r.total) : fmtUsd(r.total)}</b>,
      ],
    };
  });
  const amtFooter: MatrixRow = {
    label: 'Jemi USD',
    cells: [
      ...SALES_AMT_USD_TOTAL.map((m) => (m === 0 ? '—' : fmtUsd(m))),
      <b>{fmtUsd(SALES_AMT_USD_TOTAL.reduce((a, b) => a + b, 0))}</b>,
    ],
  };

  const monthHeaders = ['Kanal', ...MONTHS_SHORT, 'Jemi'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SeraPageHeader
        icon={<IconReportAnalytics size={22} />}
        title="Dolandyryş Hasabatlary"
        subtitle="Satyş Paýlanyşy — Mukdar & Tutar"
        accent="#16a34a"
        accentDark="#15803d"
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
          <IconMessageCircle size={18} /> Dolandyryş Hasabatlary hakynda sorag ber — nähili hasaplanýar, maglumatlar nireden gelýär?
        </span>
        <IconChevronDown size={18} />
      </div>

      {/* Block selection */}
      <SeraBlockSelector selected={blocks} onChange={setBlocks} />

      {/* Sales distribution — quantity */}
      <SeraCard
        title="Satyş Paýlanyşy — MUKDAR (kg)"
        extra={<MonthChipsRow selected={qtyMonths} onToggle={toggleQtyMonth} accent={SERA.amber} />}
      >
        <SeraMatrixTable headers={monthHeaders} rows={qtyRows} footer={qtyFooter} minWidth={1000} />
      </SeraCard>

      {/* Sales distribution — amount */}
      <SeraCard
        title="Satyş Paýlanyşy — TUTAR (USD / DTM)"
        extra={<MonthChipsRow selected={amtMonths} onToggle={toggleAmtMonth} accent={SERA.green} />}
      >
        <SeraMatrixTable headers={monthHeaders} rows={amtRows} footer={amtFooter} minWidth={1100} />
      </SeraCard>
    </div>
  );
}
