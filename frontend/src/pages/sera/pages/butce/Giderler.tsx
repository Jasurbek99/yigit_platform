import { useState } from 'react';
import type { ReactNode } from 'react';
import { IconReceipt2, IconChevronDown, IconChevronUp, IconMessageCircle } from '@tabler/icons-react';
import { SeraPageHeader } from '../../components/SeraPageHeader';
import { SeraCard } from '../../components/SeraCard';
import { SeraBlockSelector } from '../../components/SeraChipSelector';
import { SeraMatrixTable, type MatrixRow } from '../../components/SeraMatrixTable';
import { SERA, fmtUsd } from '../../seraTheme';
import { SERA_BLOCKS, MONTHS_TR } from '../../mock/seraData';
import {
  R710, R710_TOTAL,
  R720, R720_TOTAL,
  G730_ENERGY, G730_REPAIR, G730_OTHER, R730_TOTAL,
  R760, R760_TOTAL,
  R770_TOP_TOTAL, G770_DOLANDYRYS, G770_OFIS,
  type ExpenseRow, type ExpenseGroup,
} from '../../mock/giderler';

const HEADERS_TOPLAM = ['Kalem', ...MONTHS_TR, 'Toplam'];
const HEADERS_TOPLAM_KOD = ['Kod', ...MONTHS_TR, 'Toplam'];
const HEADERS_YILLIK_GRUP = ['Grup', ...MONTHS_TR, 'Yıllık'];
const HEADERS_YILLIK_PAY = ['Seçili Bloklar Payı', ...MONTHS_TR, 'Yıllık'];

function monthCells(row: ExpenseRow): ReactNode[] {
  return row.months.map((m) => (m === null ? '—' : fmtUsd(m)));
}

function toRow(row: ExpenseRow): MatrixRow {
  return {
    label: row.label,
    bold: row.bold,
    indent: row.indent,
    cells: [...monthCells(row), <b>{fmtUsd(row.total)}</b>],
  };
}

function toFooter(row: ExpenseRow): MatrixRow {
  return { label: row.label, cells: [...monthCells(row), fmtUsd(row.total)] };
}

interface GroupBlockProps {
  readonly group: ExpenseGroup;
  readonly headers: readonly string[];
}

/** One 730/770 sub-group: title + amount, then its own matrix table with a "Grup Toplamı" footer. */
function GroupBlock({ group, headers }: GroupBlockProps) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <span style={{ fontWeight: 600, color: SERA.ink }}>{group.title}</span>
        <span style={{ fontWeight: 700, color: SERA.ink }}>{fmtUsd(group.total)}</span>
      </div>
      <SeraMatrixTable headers={headers} rows={group.rows.map(toRow)} footer={toFooter(group.groupTotal)} minWidth={1300} />
    </div>
  );
}

interface AutoHeaderProps {
  readonly note: ReactNode;
  readonly total: number;
}
function AutoHeaderExtra({ note, total }: AutoHeaderProps) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontSize: 12, color: SERA.blue }}>{note}</div>
      <div style={{ fontWeight: 700, fontSize: 16, color: SERA.ink }}>{fmtUsd(total)}</div>
    </div>
  );
}

export default function Giderler() {
  const [askOpen, setAskOpen] = useState(false);
  const [blocks, setBlocks] = useState<string[]>(SERA_BLOCKS.map((b) => b.id));

  const row710 = R710.map(toRow);
  const row720 = R720.map(toRow);
  const row760 = R760.map(toRow);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SeraPageHeader
        icon={<IconReceipt2 size={22} />}
        title="Genel Giderler"
        subtitle="Seçili bloklarda Gübre ve Sarf Malzemeleri sayfalarındaki fiyatlardan otomatik hesaplanan 710 gideri."
        accent="#0284c7"
        accentDark="#075985"
        year={2026}
      />

      {/* Ask-about-this-page collapsible */}
      <div style={{ background: SERA.card, border: `1px solid ${SERA.line}`, borderRadius: 12 }}>
        <button
          type="button"
          onClick={() => setAskOpen((o) => !o)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: SERA.ink, fontWeight: 500, fontSize: 14 }}>
            <IconMessageCircle size={16} />
            Giderler hakkında soru sor — nasıl hesaplanıyor, veriler nereden geliyor?
          </span>
          {askOpen ? <IconChevronUp size={16} color={SERA.sub} /> : <IconChevronDown size={16} color={SERA.sub} />}
        </button>
        {askOpen && (
          <div style={{ padding: '0 16px 16px', fontSize: 13, color: SERA.sub, borderTop: `1px solid ${SERA.line}`, paddingTop: 12 }}>
            Bu sayfadaki tüm rakamlar; Gübre, Sarf Malzemeleri, Personel, Genel Üretim Gideri, Pazarlama &amp; Gaplama
            ve Genel Yönetim Giderleri sayfalarındaki verilerden otomatik hesaplanır. Aşağıdaki blok seçimini
            değiştirdiğinizde bu sayfadaki tüm toplamlar yeniden hesaplanır.
          </div>
        )}
      </div>

      {/* Block selector */}
      <SeraBlockSelector selected={blocks} onChange={setBlocks} title="Blok Seçimi (sayfadaki tüm hesaplamalar için, birden fazla)" />

      {/* 710 — İlk Madde ve Malzeme (Gübre) */}
      <SeraCard title="710 — İlk Madde ve Malzeme (Gübre)">
        <div style={{ fontSize: 12, color: SERA.sub, marginBottom: 12 }}>
          Seçili blokların toplamı; Gübre sayfasındaki birim fiyatlar ve Sarf Malzemeleri sayfasındaki standart
          oran/birim fiyatlardan otomatik hesaplanır.
        </div>
        <SeraMatrixTable headers={HEADERS_TOPLAM} rows={row710} footer={toFooter(R710_TOTAL)} minWidth={1300} />
      </SeraCard>

      {/* 720 — İşçilik Maliyetleri */}
      <SeraCard title="720 — İşçilik Maliyetleri">
        <div style={{ fontSize: 12, color: SERA.sub, marginBottom: 12 }}>
          Seçili blokların toplamı; Personel sayfasındaki sayı × maaştan otomatik hesaplanır. 770 satırı, Genel
          Yönetim Giderleri havuzunun bu bloklara düşen payını içerir.
        </div>
        <SeraMatrixTable headers={HEADERS_TOPLAM_KOD} rows={row720} footer={toFooter(R720_TOTAL)} minWidth={1400} />
        <div style={{ fontSize: 12, color: SERA.sub, marginTop: 10 }}>
          Blok Seçimi&apos;ne göre Personel sayfasındaki sayı × maaştan hesaplanır.
        </div>
      </SeraCard>

      {/* 730 — Genel Üretim Giderleri */}
      <SeraCard
        title="730 — Genel Üretim Giderleri"
        extra={<AutoHeaderExtra note={'Otomatik — "Genel Üretim Gideri" sayfasından, blok alanına (GA) göre'} total={R730_TOTAL} />}
      >
        <div style={{ fontSize: 12, color: SERA.sub, marginBottom: 16 }}>
          Her bloğun kendi ürün türü ve alanına göre, &quot;Genel Üretim Gideri&quot; sayfasındaki 10 GA standart
          tutarından oranlanarak hesaplanır.
        </div>
        <GroupBlock group={G730_ENERGY} headers={HEADERS_TOPLAM} />
        <GroupBlock group={G730_REPAIR} headers={HEADERS_TOPLAM} />
        <GroupBlock group={G730_OTHER} headers={HEADERS_TOPLAM} />
        <div
          style={{
            display: 'flex', justifyContent: 'space-between', paddingTop: 12,
            borderTop: `2px solid ${SERA.line}`, fontWeight: 700, color: SERA.ink,
          }}
        >
          <span>TOPLAM (730)</span>
          <span>{fmtUsd(R730_TOTAL)}</span>
        </div>
      </SeraCard>

      {/* 760 — Pazarlama, Satış ve Dağıtım */}
      <SeraCard
        title="760 — Pazarlama, Satış ve Dağıtım"
        extra={<AutoHeaderExtra note={'Otomatik — "Pazarlama & Gaplama" sayfasından'} total={R760_TOTAL.total} />}
      >
        <div style={{ fontSize: 12, color: SERA.sub, marginBottom: 12 }}>
          Her bloğun kendi ürün türü ve ihracat kanalı (TIR/kg, yurt bazlı fiyat) bazında, &quot;Pazarlama &amp;
          Gaplama&quot; sayfasındaki gruplardan otomatik hesaplanır. Her grubun altında kalem/yurt bazlı kırılım da
          gösterilir.
        </div>
        <SeraMatrixTable headers={HEADERS_YILLIK_GRUP} rows={row760} footer={toFooter(R760_TOTAL)} minWidth={1400} />
      </SeraCard>

      {/* 770 — Genel Yönetim (Havuz) */}
      <SeraCard
        title="770 — Genel Yönetim (Havuz)"
        extra={<AutoHeaderExtra note={'Otomatik — "Genel Yönetim Giderleri" havuzundan, üretime göre dağıtımıyla'} total={R770_TOP_TOTAL.total} />}
      >
        <div style={{ fontSize: 12, color: SERA.sub, marginBottom: 12 }}>
          Seçili bloklara, mevcut dağıtım moduna göre düşen pay. Dağıtım modu Genel Yönetim Giderleri sayfasından
          değiştirilir.
        </div>
        <SeraMatrixTable headers={HEADERS_YILLIK_PAY} rows={[]} footer={toFooter(R770_TOP_TOTAL)} minWidth={1400} />

        <div style={{ fontSize: 12, color: SERA.sub, margin: '16px 0 12px' }}>
          &quot;Havuzun kaynağı — Genel Yönetim Giderleri kalemleri (şirket geneli, bloklara bağlı değil; yıllık
          toplam {fmtUsd(0)}):&quot;
        </div>
        <GroupBlock group={G770_DOLANDYRYS} headers={HEADERS_TOPLAM} />
        <GroupBlock group={G770_OFIS} headers={HEADERS_TOPLAM} />
      </SeraCard>
    </div>
  );
}
