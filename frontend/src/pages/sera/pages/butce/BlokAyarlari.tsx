import { useState } from 'react';
import { Input, InputNumber } from 'antd';
import { IconAdjustmentsAlt, IconMessageCircle, IconChevronDown, IconCheck, IconCalendar } from '@tabler/icons-react';
import { SeraPageHeader } from '../../components/SeraPageHeader';
import { SeraCard } from '../../components/SeraCard';
import { SERA, fmtNum } from '../../seraTheme';
import { SERA_BLOCKS_BY_GROUP, SERA_YEAR, type SeraBlock } from '../../mock/seraData';
import { BLOCK_OPENING_MAP, GROUP_LABELS_TK } from '../../mock/blokAyarlari';

const FIELD_LABEL: React.CSSProperties = { fontSize: 12, color: SERA.sub, marginBottom: 4, fontWeight: 600 };

function BlockConfigCard({ block }: { readonly block: SeraBlock }) {
  const openingDate = BLOCK_OPENING_MAP[block.id] ?? null;
  const cooledGa = block.cooled ? block.areaGa : 0;
  const uncooledGa = block.cooled ? 0 : block.areaGa;

  return (
    <SeraCard padding={16}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
        <div>
          <div style={FIELD_LABEL}>Blok Ady</div>
          <Input defaultValue={block.name} />
        </div>
        <div>
          <div style={FIELD_LABEL}>Jemi Meýdan (GA)</div>
          <InputNumber defaultValue={block.areaGa} min={0} style={{ width: '100%' }} />
        </div>
        <div>
          <div style={FIELD_LABEL}>Sowadyjyly (GA)</div>
          <InputNumber defaultValue={cooledGa} min={0} style={{ width: '100%' }} />
        </div>
        <div>
          <div style={FIELD_LABEL}>Sowadyjysyz (GA)</div>
          <InputNumber defaultValue={uncooledGa} min={0} disabled style={{ width: '100%' }} />
        </div>
        <div>
          <div style={{ ...FIELD_LABEL, display: 'flex', alignItems: 'center', gap: 4 }}>
            Açylyş Senesi
            {openingDate && <IconCheck size={13} color={SERA.pos} />}
          </div>
          <Input
            defaultValue={openingDate ?? undefined}
            placeholder="ýyl-aý-gün"
            suffix={<IconCalendar size={14} color={SERA.sub} />}
          />
          {openingDate && (
            <div style={{ fontSize: 11, color: SERA.pos, marginTop: 4 }}>
              {openingDate.slice(0, 7)} senesinden başlap çykdajylar hasaba alynýar
            </div>
          )}
        </div>
      </div>

      <div style={{ fontSize: 12, color: SERA.sub, marginTop: 12 }}>
        Jemi: {fmtNum(block.areaGa)} GA | Sowadyjyly: {fmtNum(cooledGa)} GA | Sowadyjysyz: {fmtNum(uncooledGa)} GA
        {openingDate && <> | Açylyş: {openingDate}</>}
      </div>
      <div style={{ fontSize: 11, color: SERA.sub, fontStyle: 'italic', marginTop: 6, lineHeight: 1.5 }}>
        Dökün sarp ediş normalary indi <b>Dökün</b> sahypasyndan (GA Başyna Standart Sarp Ediş Ölçegi) girizilýär;
        şu ýerdäki sowadyjyly/sowadyjysyz meýdan bahalary şol hasaplamany iýmitlendirýär.
      </div>
    </SeraCard>
  );
}

export default function BlokAyarlari() {
  const [askOpen, setAskOpen] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SeraPageHeader
        icon={<IconAdjustmentsAlt size={22} />}
        title="Blok Sazlamalary"
        subtitle="Blok atlaryny, meýdanlaryny we sowadyjy görnüşlerini üýtgediň"
        accent={SERA.slate}
        accentDark="#1e293b"
        year={SERA_YEAR}
      />

      {/* Ask bar (decorative) */}
      <div
        onClick={() => setAskOpen((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderRadius: 12, background: SERA.card, border: `1px solid ${SERA.line}`,
          color: SERA.green, fontWeight: 500, cursor: 'pointer',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <IconMessageCircle size={18} /> Blok Ayarları hakkında soru sor — nasıl hesaplanıyor, veriler nereden geliyor?
        </span>
        <IconChevronDown size={18} style={{ transform: askOpen ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }} />
      </div>
      {askOpen && (
        <SeraCard>
          <div style={{ fontSize: 13, color: SERA.sub, lineHeight: 1.6 }}>
            Bu sahypadaky meýdan (GA) we sowadyjy paýlanyşy bahalary <b>Blok Saýlawy</b>-nda ulanylýan meýdan
            jeminiň esasyny düzýär. Açylyş senesi bellenen bolsa, şol senä çenli çykdajylar hasaba alynmaýar —
            görkezilen aýdan başlap girizilýär.
          </div>
        </SeraCard>
      )}

      {SERA_BLOCKS_BY_GROUP.map((g) => (
        <div key={g.group}>
          <div style={{ fontWeight: 700, fontSize: 16, color: SERA.ink, marginBottom: 10 }}>
            {GROUP_LABELS_TK[g.group]} Bölümi
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {g.blocks.map((b) => (
              <BlockConfigCard key={b.id} block={b} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
