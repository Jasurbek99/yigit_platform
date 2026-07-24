import { useState } from 'react';
import { Button, Input, InputNumber } from 'antd';
import {
  IconFlask, IconMessageCircle, IconChevronDown, IconTrash, IconPlus,
} from '@tabler/icons-react';
import { SeraPageHeader } from '../../components/SeraPageHeader';
import { SeraCard } from '../../components/SeraCard';
import { SeraStatCard } from '../../components/SeraStatCard';
import { SeraBlockSelector, SeraMonthSelector } from '../../components/SeraChipSelector';
import { SeraMatrixTable, type MatrixRow } from '../../components/SeraMatrixTable';
import { SERA, fmtNum, fmtUsd } from '../../seraTheme';
import { SERA_BLOCKS_BY_GROUP, MONTHS_TR } from '../../mock/seraData';
import {
  GUBRE_PRODUCT_TYPES, GUBRE_MATERIALS, GUBRE_RATE_COOLED, GUBRE_RATE_UNCOOLED,
  GUBRE_KG_COOLED, GUBRE_KG_UNCOOLED, GUBRE_AMT_COOLED, GUBRE_AMT_UNCOOLED,
  type GubreMaterial,
} from '../../mock/gubre';

const ALL_BLOCK_IDS = SERA_BLOCKS_BY_GROUP.flatMap((g) => g.blocks.map((b) => b.id));
const ZERO_12 = Array(12).fill(0) as readonly number[];
const NULL_12 = Array(12).fill(null) as readonly (number | null)[];

interface Derived {
  readonly stoktanKarsilanan: number;
  readonly satinAlinacak: number;
  readonly kalanStok: number;
  readonly satinAlmaMaliyeti: number;
}

function computeDerived(m: GubreMaterial): Derived {
  const stoktanKarsilanan = Math.min(m.ihtiyacKap, m.depoStokKap);
  const satinAlinacak = Math.max(m.ihtiyacKap - m.depoStokKap, 0);
  const kalanStok = m.depoStokKap - stoktanKarsilanan;
  const satinAlmaMaliyeti = satinAlinacak * m.birimFiyatUsd;
  return { stoktanKarsilanan, satinAlinacak, kalanStok, satinAlmaMaliyeti };
}

function sumNonNull(values: readonly (number | null)[]): number {
  return values.reduce<number>((acc, v) => acc + (v ?? 0), 0);
}

function ModeToggle({ cooled, onChange }: { readonly cooled: boolean; readonly onChange: (c: boolean) => void }) {
  const btn = (active: boolean): React.CSSProperties => ({
    padding: '4px 12px',
    borderRadius: 8,
    border: 'none',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    background: active ? SERA.green : SERA.line,
    color: active ? '#fff' : SERA.sub,
  });
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <button type="button" style={btn(cooled)} onClick={() => onChange(true)}>Soğutmalı</button>
      <button type="button" style={btn(!cooled)} onClick={() => onChange(false)}>Soğutmasız</button>
    </div>
  );
}

const th: React.CSSProperties = {
  padding: '8px 12px', textAlign: 'left', color: SERA.sub, fontWeight: 600, fontSize: 12,
  textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: `2px solid ${SERA.line}`, whiteSpace: 'nowrap',
};
const td: React.CSSProperties = {
  padding: '8px 12px', borderBottom: `1px solid ${SERA.line}`, whiteSpace: 'nowrap', fontSize: 13, color: SERA.ink,
};

export default function Gubre() {
  const [productTypes, setProductTypes] = useState<string[]>([...GUBRE_PRODUCT_TYPES]);
  const [activeProduct, setActiveProduct] = useState('Domates');
  const [newProductType, setNewProductType] = useState('');

  const [blocks, setBlocks] = useState<string[]>(ALL_BLOCK_IDS);
  const [months, setMonths] = useState<number[]>([0]);

  const [materials, setMaterials] = useState<GubreMaterial[]>(GUBRE_MATERIALS.map((m) => ({ ...m })));
  const [newMaterialName, setNewMaterialName] = useState('');

  const [cooled, setCooled] = useState(true);
  const [rateCooled, setRateCooled] = useState<Record<string, readonly number[]>>({ ...GUBRE_RATE_COOLED });
  const [rateUncooled, setRateUncooled] = useState<Record<string, readonly number[]>>({ ...GUBRE_RATE_UNCOOLED });

  const rates = cooled ? rateCooled : rateUncooled;
  const setRates = cooled ? setRateCooled : setRateUncooled;
  const kgData = cooled ? GUBRE_KG_COOLED : GUBRE_KG_UNCOOLED;
  const amtData = cooled ? GUBRE_AMT_COOLED : GUBRE_AMT_UNCOOLED;

  const handleAddProductType = (): void => {
    const name = newProductType.trim();
    if (!name || productTypes.includes(name)) return;
    setProductTypes((prev) => [...prev, name]);
    setNewProductType('');
  };

  const handleAddMaterial = (): void => {
    const name = newMaterialName.trim();
    if (!name || materials.some((m) => m.name === name)) return;
    setMaterials((prev) => [...prev, { name, isNew: true, ihtiyacKap: 0, depoStokKap: 0, birimFiyatUsd: 0 }]);
    setNewMaterialName('');
  };

  const handleDeleteMaterial = (name: string): void => {
    setMaterials((prev) => prev.filter((m) => m.name !== name));
  };

  const updateMaterial = (name: string, patch: Partial<GubreMaterial>): void => {
    setMaterials((prev) => prev.map((m) => (m.name === name ? { ...m, ...patch } : m)));
  };

  const updateRate = (name: string, monthIdx: number, value: number): void => {
    setRates((prev) => {
      const current = prev[name] ?? ZERO_12;
      const next = [...current];
      next[monthIdx] = value;
      return { ...prev, [name]: next };
    });
  };

  const totalIhtiyacMaliyeti = materials.reduce((acc, m) => acc + m.ihtiyacKap * m.birimFiyatUsd, 0);
  const totalSatinAlmaMaliyeti = materials.reduce((acc, m) => acc + computeDerived(m).satinAlmaMaliyeti, 0);

  // ─── Monthly purchase (stock-deducted) table ────────────────────────────
  const monthHeaders = months.map((i) => MONTHS_TR[i]);
  const monthlyPurchaseRows: MatrixRow[] = materials.map((m) => ({
    label: m.name,
    cells: months.map(() => fmtNum(0)),
  }));
  const monthlyPurchaseFooter: MatrixRow = {
    label: 'Aylık Satın Alma Maliyeti',
    cells: months.map(() => fmtUsd(0)),
  };

  // ─── Gübre Sarfı (kg) table ──────────────────────────────────────────────
  const kgRows: MatrixRow[] = materials.map((m) => {
    const values = kgData[m.name] ?? NULL_12;
    return {
      label: m.name,
      cells: [...values.map((v) => (v === null ? '—' : fmtNum(v))), <b>{fmtNum(sumNonNull(values))}</b>],
    };
  });

  // ─── Gübre Sarfı (Tutar) table ───────────────────────────────────────────
  const amtRows: MatrixRow[] = materials.map((m) => {
    const values = amtData[m.name] ?? NULL_12;
    return {
      label: m.name,
      cells: [...values.map((v) => (v === null ? '—' : fmtUsd(v))), <b>{fmtUsd(sumNonNull(values))}</b>],
    };
  });
  const monthlyAmtTotals = MONTHS_TR.map((_, i) =>
    materials.reduce((acc, m) => acc + ((amtData[m.name] ?? NULL_12)[i] ?? 0), 0),
  );
  const amtFooter: MatrixRow = {
    label: 'Aylık Toplam Tutar',
    cells: [
      ...monthlyAmtTotals.map((v) => (v === 0 ? '—' : fmtUsd(v))),
      fmtUsd(monthlyAmtTotals.reduce((a, b) => a + b, 0)),
    ],
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SeraPageHeader
        icon={<IconFlask size={22} />}
        title="Gübre"
        subtitle="İhtiyaç, stok ve satın alma planlaması"
        accent="#65a30d"
        accentDark="#3f6212"
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
          <IconMessageCircle size={18} /> Gübre hakkında soru sor — nasıl hesaplanıyor, veriler nereden geliyor?
        </span>
        <IconChevronDown size={18} />
      </div>

      {/* Ürün Türü */}
      <SeraCard title="Ürün Türü">
        <div style={{ fontSize: 12, color: SERA.sub, marginTop: -8, marginBottom: 12 }}>
          Birim fiyat her ürün türü için ayrı tutulur. Silme/yeniden adlandırma için Satış sayfasını kullanın.
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {productTypes.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setActiveProduct(p)}
              style={{
                padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13,
                border: `1px solid ${p === activeProduct ? SERA.green : SERA.line}`,
                background: p === activeProduct ? SERA.green : SERA.card,
                color: p === activeProduct ? '#fff' : SERA.ink,
              }}
            >
              {p}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input
            placeholder="Yeni ürün türü (ör. Salatalık)"
            value={newProductType}
            onChange={(e) => setNewProductType(e.target.value)}
            onPressEnter={handleAddProductType}
            style={{ maxWidth: 260 }}
          />
          <Button type="primary" icon={<IconPlus size={14} />} style={{ background: SERA.green, borderColor: SERA.green }} onClick={handleAddProductType}>
            Ekle
          </Button>
        </div>
      </SeraCard>

      <SeraBlockSelector selected={blocks} onChange={setBlocks} title="Blok Seçimi (birden fazla)" />
      <SeraMonthSelector selected={months} onChange={setMonths} title="Ay Seçimi (birleştirilebilir)" />

      {/* Gübre / Malzeme Ekle */}
      <SeraCard title="Gübre / Malzeme Ekle">
        <div style={{ fontSize: 12, color: SERA.sub, marginTop: -8, marginBottom: 12 }}>
          Listede olmayan bir gübreyi ekleyin. Yeni gübrenin blok/ay oranlarını Blok Ayarları sayfasından girebilirsiniz.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input
            placeholder="Yeni gübre adı (ör. Üre)"
            value={newMaterialName}
            onChange={(e) => setNewMaterialName(e.target.value)}
            onPressEnter={handleAddMaterial}
            style={{ maxWidth: 260 }}
          />
          <Button type="primary" icon={<IconPlus size={14} />} style={{ background: SERA.green, borderColor: SERA.green }} onClick={handleAddMaterial}>
            Ekle
          </Button>
        </div>
      </SeraCard>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <SeraStatCard label="Seçili Blok" value={blocks.length} />
        <SeraStatCard label="Seçili Ay" value={months.length} accent={SERA.blue} />
        <SeraStatCard label={`Toplam İhtiyaç Maliyeti — ${activeProduct}`} value={fmtUsd(totalIhtiyacMaliyeti)} accent={SERA.amber} />
        <SeraStatCard label="Satın Alınacak (Bütçe)" value={fmtUsd(totalSatinAlmaMaliyeti)} accent={SERA.green} tint={SERA.greenSoft} />
      </div>

      {/* Main need/stock/purchase table */}
      <SeraCard title={`Gübre Sarfı, Stok & Satın Alma — Fiyat: ${activeProduct}`}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 920, borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={th}>Malzeme</th>
                <th style={{ ...th, textAlign: 'right' }}>İhtiyaç (kap)</th>
                <th style={{ ...th, textAlign: 'right' }}>Depo Stok (kap)</th>
                <th style={{ ...th, textAlign: 'right' }}>Stoktan Karşılanan</th>
                <th style={{ ...th, textAlign: 'right' }}>Satın Alınacak</th>
                <th style={{ ...th, textAlign: 'right' }}>Kalan Stok</th>
                <th style={{ ...th, textAlign: 'right' }}>Birim Fiyat ($)</th>
                <th style={{ ...th, textAlign: 'right' }}>Satın Alma Maliyeti</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {materials.map((m) => {
                const d = computeDerived(m);
                return (
                  <tr key={m.name}>
                    <td style={td}>
                      {m.name}
                      {m.isNew && (
                        <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 600, color: SERA.green, background: SERA.greenSoft, padding: '2px 6px', borderRadius: 6 }}>
                          yeni
                        </span>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>{fmtNum(m.ihtiyacKap)}</td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <InputNumber
                        size="small"
                        min={0}
                        value={m.depoStokKap}
                        onChange={(v) => updateMaterial(m.name, { depoStokKap: v ?? 0 })}
                        style={{ width: 90 }}
                      />
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>{fmtNum(d.stoktanKarsilanan)}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{fmtNum(d.satinAlinacak)}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{fmtNum(d.kalanStok)}</td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <InputNumber
                        size="small"
                        min={0}
                        value={m.birimFiyatUsd}
                        onChange={(v) => updateMaterial(m.name, { birimFiyatUsd: v ?? 0 })}
                        style={{ width: 70 }}
                      />
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>{fmtUsd(d.satinAlmaMaliyeti)}</td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      <button
                        type="button"
                        onClick={() => handleDeleteMaterial(m.name)}
                        style={{ border: 'none', background: 'none', color: SERA.neg, cursor: 'pointer', display: 'flex' }}
                        aria-label="Sil"
                      >
                        <IconTrash size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: SERA.slate, color: '#fff' }}>
                <td style={{ ...td, borderBottom: 'none', color: '#fff', fontWeight: 700 }}>TOPLAM SATIN ALMA MALİYETİ (BÜTÇE)</td>
                <td colSpan={6} />
                <td style={{ ...td, borderBottom: 'none', color: '#fff', fontWeight: 700, textAlign: 'right' }}>{fmtUsd(totalSatinAlmaMaliyeti)}</td>
                <td style={{ ...td, borderBottom: 'none' }} />
              </tr>
              <tr>
                <td style={{ ...td, borderBottom: 'none', color: SERA.sub }}>Stoksuz toplam ihtiyaç maliyeti (referans)</td>
                <td colSpan={6} />
                <td style={{ ...td, borderBottom: 'none', color: SERA.sub, textAlign: 'right' }}>{fmtUsd(totalIhtiyacMaliyeti)}</td>
                <td style={{ ...td, borderBottom: 'none' }} />
              </tr>
            </tfoot>
          </table>
        </div>
        <div style={{ fontSize: 12, color: SERA.sub, marginTop: 12 }}>
          Açıklama: İhtiyaç = seçili blok/ay için gerekli toplam miktar; depo stoğu tüm ürün türleri arasında paylaşılan
          ortak bir havuzdur, bu yüzden ürün türünden bağımsızdır. Birim fiyat ise her ürün türü için ayrı tutulur —
          yukarıdan ürün türünü değiştirdiğinizde Birim Fiyat ve buna bağlı maliyet sütunları {activeProduct} için güncellenir.
        </div>
      </SeraCard>

      {/* Monthly purchase (stock-deducted) */}
      <SeraCard title={`Ay Bazında Satın Alma (Stok Düşülmüş) — Fiyat: ${activeProduct}`}>
        <div style={{ fontSize: 12, color: SERA.sub, marginTop: -8, marginBottom: 12 }}>
          Depo stoğu, seçili ayların sırasına göre önce tüketilir; her ay için gerçekte satın alınması gereken miktar (kap) ve maliyet gösterilir.
        </div>
        <SeraMatrixTable
          headers={['Malzeme', ...monthHeaders]}
          rows={monthlyPurchaseRows}
          footer={monthlyPurchaseFooter}
          minWidth={monthHeaders.length > 4 ? 900 : 420}
        />
      </SeraCard>

      {/* Gerçek Gübre Sarfı heading */}
      <div>
        <div style={{ fontSize: 16, fontWeight: 700, color: SERA.ink }}>Gerçek Gübre Sarfı (kg)</div>
        <div style={{ fontSize: 13, color: SERA.sub, marginTop: 4 }}>
          Aşağıdaki "GA Başına Standart Sarf Oranı" tablosuna girdiğiniz değerler, seçili blokların soğutmalı/soğutmasız
          alanıyla çarpılarak otomatik kg ve tutar hesaplanır. Bu sayfanın üstündeki "Blok Seçimi" hangi blokları
          kapsadığını belirler. Soğutmalı/Soğutmasız arasında sekmelerle geçiş yapabilirsiniz.
        </div>
      </div>

      {/* GA Başına Standart Sarf Oranı */}
      <SeraCard title="GA Başına Standart Sarf Oranı (kg/GA/ay)" extra={<ModeToggle cooled={cooled} onChange={setCooled} />}>
        <div style={{ fontSize: 12, color: SERA.sub, marginTop: -8, marginBottom: 12 }}>
          Her malzeme için, 1 GA başına aylık kullanılan kg miktarını girin. Bu oran, aşağıdaki "Gübre Sarfı (kg)" tablosunu
          ve Giderler sayfasındaki 710 tutarını otomatik besler.
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 1100, borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={th}>Gübre</th>
                {MONTHS_TR.map((mo) => (
                  <th key={mo} style={{ ...th, textAlign: 'right' }}>{mo}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {materials.map((m) => {
                const row = rates[m.name] ?? ZERO_12;
                return (
                  <tr key={m.name}>
                    <td style={td}>{m.name}</td>
                    {row.map((v, i) => (
                      <td key={i} style={{ ...td, textAlign: 'right' }}>
                        <InputNumber
                          size="small"
                          min={0}
                          value={v}
                          onChange={(val) => updateRate(m.name, i, val ?? 0)}
                          style={{ width: 56 }}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SeraCard>

      {/* Gübre Sarfı (kg) */}
      <SeraCard title="Gübre Sarfı (kg)" extra={<ModeToggle cooled={cooled} onChange={setCooled} />}>
        <div style={{ fontSize: 12, color: SERA.sub, marginTop: -8, marginBottom: 12 }}>
          "GA Başına Standart Sarf Oranı" tablosundaki {cooled ? 'soğutmalı' : 'soğutmasız'} oran, seçili blokların toplam{' '}
          {cooled ? 'soğutmalı' : 'soğutmasız'} alanıyla (GA) çarpılarak otomatik hesaplanır. Salt okunur.
        </div>
        <SeraMatrixTable headers={['Gübre', ...MONTHS_TR, 'Toplam']} rows={kgRows} minWidth={1200} />
      </SeraCard>

      {/* Gübre Sarfı (Tutar) */}
      <SeraCard title="Gübre Sarfı (Tutar)" extra={<ModeToggle cooled={cooled} onChange={setCooled} />}>
        <div style={{ fontSize: 12, color: SERA.sub, marginTop: -8, marginBottom: 12 }}>
          Yukarıdaki kg değerlerinin, malzemenin birim fiyatıyla (Birim Fiyatlar tablosundaki {activeProduct} fiyatı)
          çarpılmış tutar karşılığı. Salt okunur.
        </div>
        <SeraMatrixTable headers={['Gübre', ...MONTHS_TR, 'Toplam']} rows={amtRows} footer={amtFooter} minWidth={1200} />
      </SeraCard>
    </div>
  );
}
