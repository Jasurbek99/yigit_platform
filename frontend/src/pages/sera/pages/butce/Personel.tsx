import { useState } from 'react';
import type { CSSProperties } from 'react';
import { IconUsers, IconMessageCircle, IconChevronDown, IconTrash } from '@tabler/icons-react';
import { SeraPageHeader } from '../../components/SeraPageHeader';
import { SeraCard } from '../../components/SeraCard';
import { SeraMatrixTable, type MatrixRow } from '../../components/SeraMatrixTable';
import { SERA, fmtNum } from '../../seraTheme';
import { SERA_BLOCKS_BY_GROUP, MONTHS_TR, type SeraBlock } from '../../mock/seraData';
import {
  ADMIN_BLOCK, MONTHLY_STAFF_COST_ROWS, FOREIGN_STAFF, SALARY_CATEGORIES,
  type SalaryCurrency, type SalaryPositionRow,
} from '../../mock/personel';

type TabKey = 'sayisi' | 'maas';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'sayisi', label: 'Personel Sayısı (Müdürler)' },
  { key: 'maas', label: 'Maaş Tablosu (Muhasebe)' },
];

const GROUP_TITLES: Record<SeraBlock['group'], string> = {
  Dusak: 'Dusak Bölümü',
  Kaka: 'Kaka Bölümü',
  Owadandepe: 'Owadandepe Bölümü',
};

interface PersonnelRowProps {
  readonly label: string;
  readonly sub?: string;
  readonly buttonLabel?: string;
  readonly last?: boolean;
}

function PersonnelRow({ label, sub, buttonLabel = 'Personel Gir', last }: PersonnelRowProps) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        padding: '14px 16px',
        borderBottom: last ? 'none' : `1px solid ${SERA.line}`,
      }}
    >
      <div>
        <div style={{ fontWeight: 600, color: SERA.ink, fontSize: 14 }}>{label}</div>
        {sub && <div style={{ fontSize: 12, color: SERA.sub, marginTop: 2 }}>{sub}</div>}
      </div>
      <button
        type="button"
        style={{
          padding: '6px 14px',
          borderRadius: 8,
          border: `1px solid ${SERA.line}`,
          background: SERA.card,
          color: SERA.ink,
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {buttonLabel}
      </button>
    </div>
  );
}

interface GroupBoxProps {
  readonly title: string;
  readonly children: React.ReactNode;
}

/** Bold section title above a bordered, divided list of rows. */
function GroupBox({ title, children }: GroupBoxProps) {
  return (
    <div>
      <div style={{ fontWeight: 700, color: SERA.ink, fontSize: 15, marginBottom: 10 }}>{title}</div>
      <div style={{ background: SERA.card, border: `1px solid ${SERA.line}`, borderRadius: 12, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  );
}

interface BlockGroupSectionProps {
  readonly title: string;
  readonly blocks: readonly SeraBlock[];
}

function BlockGroupSection({ title, blocks }: BlockGroupSectionProps) {
  return (
    <GroupBox title={title}>
      {blocks.map((b, i) => (
        <PersonnelRow key={b.id} label={b.name} sub={`${b.areaGa} GA`} last={i === blocks.length - 1} />
      ))}
    </GroupBox>
  );
}

// ─── Maaş Tablosu — per-position salary rows, grouped by cost code ───────
const th: CSSProperties = { padding: '8px 12px', textAlign: 'left', color: SERA.sub, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: `1px solid ${SERA.line}`, whiteSpace: 'nowrap' };
const thCenter: CSSProperties = { ...th, textAlign: 'center' };
const thRight: CSSProperties = { ...th, textAlign: 'right' };
const td: CSSProperties = { padding: '8px 12px', fontSize: 13, color: SERA.ink, borderBottom: `1px solid ${SERA.line}` };
const tdCenter: CSSProperties = { ...td, textAlign: 'center' };
const tdRight: CSSProperties = { ...td, textAlign: 'right' };

interface CurrencyBadgeProps {
  readonly currency: SalaryCurrency;
}

/** Two-way DTM/USD pill — display-only (matches the source app's toggle look). */
function CurrencyBadge({ currency }: CurrencyBadgeProps) {
  const pill = (label: SalaryCurrency): CSSProperties => ({
    padding: '3px 10px',
    fontSize: 11,
    fontWeight: 700,
    background: currency === label ? SERA.green : SERA.card,
    color: currency === label ? '#fff' : SERA.sub,
  });
  return (
    <span style={{ display: 'inline-flex', borderRadius: 6, overflow: 'hidden', border: `1px solid ${SERA.line}` }}>
      <span style={pill('DTM')}>DTM</span>
      <span style={pill('USD')}>USD</span>
    </span>
  );
}

interface SalaryValueBoxProps {
  readonly value: number;
  readonly currency: SalaryCurrency;
}

/** Input-styled read-out box: "500  DTM". */
function SalaryValueBox({ value, currency }: SalaryValueBoxProps) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        minWidth: 92, border: `1px solid ${SERA.line}`, borderRadius: 8, padding: '4px 10px', background: SERA.card,
      }}
    >
      <span style={{ fontSize: 13, color: SERA.ink, fontVariantNumeric: 'tabular-nums' }}>{fmtNum(value)}</span>
      <span style={{ fontSize: 11, color: SERA.sub }}>{currency}</span>
    </span>
  );
}

interface SalaryCategoryTableProps {
  readonly title: string;
  readonly positions: readonly SalaryPositionRow[];
  readonly last?: boolean;
}

function SalaryCategoryTable({ title, positions, last }: SalaryCategoryTableProps) {
  return (
    <div style={{ borderBottom: last ? 'none' : `1px solid ${SERA.line}` }}>
      <div style={{ background: SERA.greenSoft, padding: '10px 16px', fontWeight: 700, color: SERA.ink, fontSize: 14 }}>{title}</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Vazife</th>
              <th style={thCenter}>Para Birimi</th>
              <th style={thRight}>İşgär Aylygı</th>
              <th style={thRight}>Resmi Aylygı</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <tr key={p.vazife}>
                <td style={{ ...td, fontWeight: 500 }}>{p.vazife}</td>
                <td style={tdCenter}><CurrencyBadge currency={p.currency} /></td>
                <td style={tdRight}><SalaryValueBox value={p.isgarAylygy} currency={p.currency} /></td>
                <td style={tdRight}><SalaryValueBox value={p.resmiAylygy} currency={p.currency} /></td>
                <td style={tdCenter}><IconTrash size={15} color={SERA.sub} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Personel() {
  const [activeTab, setActiveTab] = useState<TabKey>('sayisi');
  const [askOpen, setAskOpen] = useState(false);

  const costRows: MatrixRow[] = MONTHLY_STAFF_COST_ROWS.map((r) => ({
    label: r.label,
    cells: r.months.map((m) => fmtNum(m)),
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SeraPageHeader
        icon={<IconUsers size={22} />}
        title="Personel & Maaşlar"
        subtitle="Bölüm müdürleri personel sayısını girer; maaşları muhasebe girer."
        accent="#db2777"
        accentDark="#9d174d"
        year={2026}
      />

      {/* Ask-a-question bar */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setAskOpen((o) => !o)}
        style={{
          background: SERA.card,
          border: `1px solid ${SERA.line}`,
          borderRadius: 12,
          padding: '12px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: SERA.sub, fontSize: 13 }}>
          <IconMessageCircle size={16} color={SERA.green} />
          Personel hakkında soru sor — nasıl hesaplanıyor, veriler nereden geliyor?
        </span>
        <IconChevronDown
          size={16}
          color={SERA.sub}
          style={{ transform: askOpen ? 'rotate(180deg)' : undefined, transition: 'transform .15s ease' }}
        />
      </div>
      {askOpen && (
        <div style={{ fontSize: 13, color: SERA.sub, padding: '0 4px' }}>
          Personel sayısı bölüm müdürleri tarafından, maaş bilgileri ise muhasebe tarafından bu sayfadan girilir.
          Kişi başına aylık çıkdajı ve yabancı işgär maaşları Giderler sayfasındaki hesaplamalarda kullanılır.
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 24, borderBottom: `1px solid ${SERA.line}` }}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            style={{
              background: 'none',
              border: 'none',
              padding: '10px 2px',
              marginBottom: -1,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              color: activeTab === tab.key ? SERA.green : SERA.sub,
              borderBottom: activeTab === tab.key ? `2px solid ${SERA.green}` : '2px solid transparent',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'sayisi' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {SERA_BLOCKS_BY_GROUP.map((g) => (
            <BlockGroupSection key={g.group} title={GROUP_TITLES[g.group]} blocks={g.blocks} />
          ))}

          <GroupBox title="Dolandyryş Bölümü">
            <PersonnelRow label={ADMIN_BLOCK.name} sub={ADMIN_BLOCK.note} last />
          </GroupBox>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: SERA.card, border: `1px solid ${SERA.line}`, borderRadius: 12, overflow: 'hidden' }}>
            {SALARY_CATEGORIES.map((cat, i) => (
              <SalaryCategoryTable
                key={cat.code}
                title={cat.title}
                positions={cat.positions}
                last={i === SALARY_CATEGORIES.length - 1}
              />
            ))}
          </div>

          <SeraCard
            title={
              <div>
                <div>Adam Başına Aylık Çykdajy</div>
                <div style={{ fontWeight: 400, fontSize: 12, color: SERA.sub, marginTop: 2 }}>
                  Her ay için kişi başına tutar girin. Giderler sayfasında seçili bloklardaki toplam kişi sayısıyla
                  çarpılarak hesaplanır.
                </div>
              </div>
            }
          >
            <SeraMatrixTable headers={['Kalem', ...MONTHS_TR]} rows={costRows} minWidth={1000} />
          </SeraCard>

          <SeraCard
            title={
              <div>
                <div>Daşary Ýurt Işgärleri</div>
                <div style={{ fontWeight: 400, fontSize: 12, color: SERA.sub, marginTop: 2 }}>
                  Her yurt için işçi sayısı ve ortalama maaş girin.
                </div>
              </div>
            }
            extra={<span style={{ color: SERA.green, fontWeight: 700 }}>{fmtNum(FOREIGN_STAFF[0].annualSalaryUsd)} $ yıllık</span>}
          >
            <div style={{ border: `1px solid ${SERA.line}`, borderRadius: 12, overflow: 'hidden' }}>
              {FOREIGN_STAFF.map((f, i) => (
                <PersonnelRow
                  key={f.country}
                  label={f.country}
                  sub={`${fmtNum(f.annualSalaryUsd)} $ yıllık`}
                  buttonLabel="İşçi Gir"
                  last={i === FOREIGN_STAFF.length - 1}
                />
              ))}
            </div>
          </SeraCard>
        </div>
      )}
    </div>
  );
}
