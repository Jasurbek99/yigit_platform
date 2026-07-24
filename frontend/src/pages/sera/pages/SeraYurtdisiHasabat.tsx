import { useState } from 'react';
import { Collapse } from 'antd';
import type { CollapseProps } from 'antd';
import { IconFileText, IconMessageCircle, IconChevronDown } from '@tabler/icons-react';
import { SeraPageHeader } from '../components/SeraPageHeader';
import { SeraCard } from '../components/SeraCard';
import { SeraStatCard } from '../components/SeraStatCard';
import { SeraMatrixTable, type MatrixRow } from '../components/SeraMatrixTable';
import { SERA, fmtNum, fmtKg, fmtUsd } from '../seraTheme';
import {
  YURTDISI_STATS, FIRM_SHARES, OPEN_CONTRACTS, COMPANY_SUMMARY, COMPANY_SUMMARY_TOTAL,
  CONTRACTS_TABLE, CONTRACTS_TOTAL, PAYMENT_TRACKING,
} from '../mock/yurtdisiHasabat';

const ACCENT = '#3730a3';
const ACCENT_DARK = '#1e1b4b';
const COMPANY_FILTERS = ['Hemmesi', 'Pasport', 'Bezpasport'] as const;

function SectionTitle({ color, label }: { readonly color: string; readonly label: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 4, height: 16, borderRadius: 2, background: color, flexShrink: 0 }} />
      {label}
    </span>
  );
}

function MiniStat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div style={{ background: SERA.bg, borderRadius: 8, padding: '8px 10px' }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: SERA.sub, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: SERA.ink }}>{value}</div>
    </div>
  );
}

export default function SeraYurtdisiHasabat() {
  const [companyFilter, setCompanyFilter] = useState<(typeof COMPANY_FILTERS)[number]>('Hemmesi');

  // ─── Şirket boýunça özet ────────────────────────────────────────────────
  const companyRows: MatrixRow[] = COMPANY_SUMMARY.map((c) => ({
    label: c.name,
    cells: [
      c.count,
      fmtUsd(c.totalUsd),
      fmtUsd(c.receivedUsd),
      <span style={{ color: SERA.neg, fontWeight: 600 }}>{fmtUsd(c.remainingUsd)}</span>,
      c.deadlineNote ? (
        <span style={{ background: '#fee2e2', color: SERA.neg, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>
          {c.deadlineNote}
        </span>
      ) : '—',
    ],
  }));
  const companyFooter: MatrixRow = {
    label: 'Jemi',
    cells: [
      '',
      fmtUsd(COMPANY_SUMMARY_TOTAL.totalUsd),
      fmtUsd(COMPANY_SUMMARY_TOTAL.receivedUsd),
      <span style={{ color: '#fecaca', fontWeight: 700 }}>{fmtUsd(COMPANY_SUMMARY_TOTAL.remainingUsd)}</span>,
      '',
    ],
  };

  // ─── Sertname jemi tablasy ──────────────────────────────────────────────
  const contractRows: MatrixRow[] = CONTRACTS_TABLE.map((c) => ({
    label: c.no,
    cells: [
      c.code ?? '—',
      c.exporter ?? '—',
      c.importer ?? '—',
      fmtKg(c.totalKg),
      fmtUsd(c.totalUsd),
      fmtKg(c.shippedKg),
      fmtKg(c.remainingKg),
      fmtUsd(c.receivedUsd),
      <span style={{ color: SERA.neg, fontWeight: 600 }}>{fmtUsd(c.remainingUsd)}</span>,
      c.deadline ?? '—',
      c.daysLeft ? (
        <span style={{ color: c.daysLeft.startsWith('-') ? SERA.neg : SERA.ink, fontWeight: 600 }}>{c.daysLeft}</span>
      ) : '—',
    ],
  }));
  const contractFooter: MatrixRow = {
    label: 'Jemi',
    cells: [
      '', '', '',
      fmtKg(CONTRACTS_TOTAL.totalKg),
      fmtUsd(CONTRACTS_TOTAL.totalUsd),
      fmtKg(CONTRACTS_TOTAL.shippedKg),
      fmtKg(CONTRACTS_TOTAL.remainingKg),
      fmtUsd(CONTRACTS_TOTAL.receivedUsd),
      <span style={{ color: '#fecaca', fontWeight: 700 }}>{fmtUsd(CONTRACTS_TOTAL.remainingUsd)}</span>,
      '', '',
    ],
  };

  // ─── Sertname töleg yzarlamasy (accordion) ─────────────────────────────
  const paymentItems: CollapseProps['items'] = PAYMENT_TRACKING.map((p, i) => ({
    key: String(i),
    label: (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', flexWrap: 'wrap', gap: 8 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: ACCENT,
              background: '#eef2ff', padding: '2px 8px', borderRadius: 6,
            }}
          >
            {p.code ?? '—'}
          </span>
          <span style={{ color: SERA.sub, fontSize: 13 }}>{p.exporter ?? '—'}</span>
        </span>
        <span style={{ color: SERA.sub, fontSize: 13, fontWeight: 600, marginRight: 8 }}>
          {fmtUsd(p.receivedUsd)} / {fmtUsd(p.remainingUsd)} USD
        </span>
      </div>
    ),
    children: <div style={{ fontSize: 13, color: SERA.sub }}>Bu sertnama üçin töleg ýazgysy ýok.</div>,
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SeraPageHeader
        icon={<IconFileText size={22} />}
        title="Daşary Ýurt Hasabaty"
        subtitle="Eksport firmalar we sertnama tölegleri"
        accent={ACCENT}
        accentDark={ACCENT_DARK}
      />

      {/* Ask bar (decorative) */}
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderRadius: 12, background: SERA.card, border: `1px solid ${SERA.line}`,
          color: SERA.green, fontWeight: 500, cursor: 'pointer', flexWrap: 'wrap', gap: 8,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <IconMessageCircle size={18} /> Ýurtdaşy Sertnamalarynyň Hasabaty hakynda soraş — nähili hasaplanýar, maglumatlar nireden gelýär?
        </span>
        <IconChevronDown size={18} />
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <SeraStatCard label="Jemi Eksport" value={fmtNum(YURTDISI_STATS.totalExportKg)} sub="kg" />
        <SeraStatCard label="Jemi Tutar" value={fmtNum(YURTDISI_STATS.totalContractUsd)} sub="USD" />
        <SeraStatCard label="Gelen Töleg" value={fmtNum(YURTDISI_STATS.receivedUsd)} sub="USD" accent={SERA.pos} />
        <SeraStatCard label="Garaşylýan Töleg" value={fmtNum(YURTDISI_STATS.pendingUsd)} sub="USD" accent="#b45309" tint="#fffbeb" />
      </div>

      {/* Firma boýunça eksport */}
      <SeraCard title={<SectionTitle color={SERA.blue} label="Firma boýunça eksport" />}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {FIRM_SHARES.map((f) => (
            <div key={f.code} style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <span
                style={{
                  width: 38, height: 38, borderRadius: '50%', background: f.color, color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, flexShrink: 0,
                }}
              >
                {f.code}
              </span>
              <div style={{ flex: 1, minWidth: 160 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontWeight: 600, color: SERA.ink }}>{f.name}</span>
                  <span style={{ fontWeight: 700, color: f.color }}>%{f.pct}</span>
                </div>
                <div style={{ background: SERA.line, borderRadius: 999, height: 8, overflow: 'hidden' }}>
                  <div style={{ width: `${f.pct}%`, height: '100%', background: f.color, borderRadius: 999 }} />
                </div>
              </div>
              <div style={{ textAlign: 'right', minWidth: 90 }}>
                <div style={{ fontWeight: 700, color: SERA.ink }}>{fmtKg(f.kg)}</div>
                <div style={{ fontSize: 12, color: SERA.sub }}>{fmtUsd(f.usd)}</div>
              </div>
            </div>
          ))}
        </div>
      </SeraCard>

      {/* Açyk Sertnamalar */}
      <SeraCard
        title={<SectionTitle color={SERA.amber} label="Açyk Sertnamalar" />}
        extra={
          <span style={{ background: '#fff4e0', color: SERA.amber, padding: '3px 10px', borderRadius: 999, fontWeight: 600, fontSize: 12 }}>
            {OPEN_CONTRACTS.length} sertname
          </span>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
          {OPEN_CONTRACTS.map((c) => (
            <div key={c.code} style={{ border: `1px solid ${SERA.line}`, borderRadius: 12, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
                <div>
                  <span
                    style={{
                      fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: ACCENT,
                      background: '#eef2ff', padding: '2px 8px', borderRadius: 6,
                    }}
                  >
                    {c.code}
                  </span>
                  <div style={{ fontSize: 13, color: SERA.sub, marginTop: 4 }}>{c.exporter}</div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: SERA.amber }}>
                  Galýan: {fmtKg(c.totalKg - (c.shippedKg ?? 0))}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
                <MiniStat label="Kg" value={fmtKg(c.totalKg)} />
                <MiniStat label="Iberilen (kg)" value={fmtKg(c.shippedKg)} />
                <MiniStat label="Baha" value={`${fmtNum(c.priceUsd, 2)} $`} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: SERA.sub, marginBottom: 4 }}>
                <span>Iberilen: %{c.shippedPct}</span>
                <span>{fmtKg(c.shippedKg)} / {fmtKg(c.totalKg)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: SERA.sub }}>
                <span>Töleg: %{c.paymentPct}</span>
                <span style={{ color: SERA.amber, fontWeight: 600 }}>Galýan: {fmtUsd(c.remainingUsd)}</span>
              </div>
            </div>
          ))}
        </div>
      </SeraCard>

      {/* Şirket boýunça özet */}
      <SeraCard
        title={<SectionTitle color={SERA.purple} label="Şirket boýunça özet" />}
        extra={
          <div style={{ display: 'flex', gap: 6 }}>
            {COMPANY_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setCompanyFilter(f)}
                style={{
                  padding: '5px 14px', borderRadius: 999, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  background: companyFilter === f ? SERA.purple : SERA.line,
                  color: companyFilter === f ? '#fff' : SERA.sub,
                }}
              >
                {f}
              </button>
            ))}
          </div>
        }
      >
        <SeraMatrixTable
          headers={['Importçy (Alyjy)', 'Sany', 'Jemi Ylalaşyk ($)', 'Gelen Töleg ($)', 'Galýan Töleg ($)', 'Möhleti çaklaşýan']}
          rows={companyRows}
          footer={companyFooter}
          minWidth={820}
        />
      </SeraCard>

      {/* Sertname jemi tablasy */}
      <SeraCard title={<SectionTitle color={SERA.green} label="Sertname jemi tablasy" />} extra={`${CONTRACTS_TABLE.length} sertname`}>
        <SeraMatrixTable
          headers={[
            '#', 'Sertname', 'Eksportçy', 'Importçy (Alyjy)', 'Jemi Ylalaşyk (kg)', 'Jemi Ylalaşyk ($)',
            'Çykan Ýük (kg)', 'Galýan (kg)', 'Gelen Töleg ($)', 'Galýan Töleg ($)', 'Möhleti', 'Galan gün',
          ]}
          rows={contractRows}
          footer={contractFooter}
          minWidth={1400}
        />
      </SeraCard>

      {/* Sertname töleg yzarlamasy */}
      <SeraCard title={<SectionTitle color={SERA.green} label="Sertname töleg yzarlamasy" />} extra={`${PAYMENT_TRACKING.length} sertname`}>
        <Collapse items={paymentItems} ghost expandIconPosition="end" />
      </SeraCard>
    </div>
  );
}
