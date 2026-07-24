import { useState } from 'react';
import { IconUsers, IconMessageCircle, IconChevronDown } from '@tabler/icons-react';
import { SeraPageHeader } from '../../components/SeraPageHeader';
import { SeraCard } from '../../components/SeraCard';
import { SeraMatrixTable, type MatrixRow } from '../../components/SeraMatrixTable';
import { SERA, fmtNum } from '../../seraTheme';
import { SERA_BLOCKS_BY_GROUP, MONTHS_TR, type SeraBlock } from '../../mock/seraData';
import { ADMIN_BLOCK, MONTHLY_STAFF_COST_ROWS, FOREIGN_STAFF } from '../../mock/personel';

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
