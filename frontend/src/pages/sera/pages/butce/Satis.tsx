import { useState } from 'react';
import { Button, Select, Input } from 'antd';
import {
  IconShoppingCart, IconChevronDown, IconPencil, IconTrash, IconPlus, IconSearch,
} from '@tabler/icons-react';
import { SeraPageHeader } from '../../components/SeraPageHeader';
import { SeraCard } from '../../components/SeraCard';
import { SeraMatrixTable, type MatrixRow } from '../../components/SeraMatrixTable';
import { SERA, fmtPct } from '../../seraTheme';
import { SERA_BLOCKS_BY_GROUP, MONTHS_TR } from '../../mock/seraData';
import {
  PRODUCT_TYPES, DEFAULT_BLOCK_ROTATIONS, PRICES_DOMATES, SALES_DIST_DOMATES,
  FIRE_ORANI, DEFAULT_EXPORT_CHANNELS, type BlockRotation,
} from '../../mock/satis';

const monthOptions = MONTHS_TR.map((m) => ({ value: m, label: m }));

export default function Satis() {
  const [askOpen, setAskOpen] = useState(false);
  const [productTypes, setProductTypes] = useState<readonly string[]>(PRODUCT_TYPES);
  const [activeProduct, setActiveProduct] = useState('Domates');
  const [blockProducts, setBlockProducts] = useState<Record<string, string>>(
    () => Object.fromEntries(SERA_BLOCKS_BY_GROUP.flatMap((g) => g.blocks.map((b) => [b.id, 'Domates']))),
  );
  const [blockRotations, setBlockRotations] = useState<Record<string, BlockRotation | undefined>>(
    () => ({ ...DEFAULT_BLOCK_ROTATIONS }),
  );
  const [exportChannels, setExportChannels] = useState<readonly string[]>(DEFAULT_EXPORT_CHANNELS);
  const [newChannel, setNewChannel] = useState('');

  const productOptions = productTypes.map((p) => ({ value: p, label: p }));

  const removeProductType = (name: string) => setProductTypes((prev) => prev.filter((p) => p !== name));
  const addExportChannel = () => {
    const name = newChannel.trim();
    if (name && !exportChannels.includes(name)) setExportChannels((prev) => [...prev, name]);
    setNewChannel('');
  };

  // ─── Fiyatlar table ─────────────────────────────────────────────────
  const priceRows: MatrixRow[] = PRICES_DOMATES.map((r) => ({
    label: r.month,
    cells: [
      <InputCell value={r.icPazarDtmKg} />,
      <InputCell value={r.kapiSatisiUsdKg} />,
      <InputCell value={r.kazakistanUsdKg} />,
      <InputCell value={r.rusyaUsdKg} />,
      <InputCell value={r.usdKuruDtm} />,
    ],
  }));

  // ─── Satış Dağılımı table ───────────────────────────────────────────
  const distRows: MatrixRow[] = SALES_DIST_DOMATES.map((r) => {
    const disTotal = r.kapiSatisiPct + r.kazakistanPct + r.rusyaPct;
    return {
      label: r.month,
      cells: [
        <InputCell value={r.icPazarPct} />,
        <InputCell value={r.kapiSatisiPct} />,
        <InputCell value={r.kazakistanPct} />,
        <InputCell value={r.rusyaPct} />,
        <div>
          <div style={{ fontWeight: 700, color: SERA.pos }}>%100</div>
          <div style={{ fontSize: 11, color: disTotal === 100 ? SERA.pos : SERA.neg }}>dış: {fmtPct(disTotal)}</div>
        </div>,
      ],
    };
  });

  // ─── Nakliye Firesi table ───────────────────────────────────────────
  const fireRows: MatrixRow[] = FIRE_ORANI.map((r) => ({
    label: r.month,
    cells: [<InputCell value={r.kazakistanPct} />, <InputCell value={r.rusyaPct} />],
  }));

  // ─── Atama Özeti ─────────────────────────────────────────────────────
  const allBlocks = SERA_BLOCKS_BY_GROUP.flatMap((g) => g.blocks);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SeraPageHeader
        icon={<IconShoppingCart size={22} />}
        title="Satış &amp; Ürün Fiyatları"
        subtitle="Farklı ürün türleri (örn. Domates, Salatalık vb.) kendi satış fiyatlarına sahip olur; her bloğa hangi ürünü ürettiğini siz atarsınız."
        accent="#b45309"
        accentDark="#78350f"
      />

      {/* Ask question collapsible bar */}
      <div
        style={{ background: SERA.card, border: `1px solid ${SERA.line}`, borderRadius: 12, padding: '10px 16px', cursor: 'pointer' }}
        onClick={() => setAskOpen((v) => !v)}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, color: SERA.sub, fontSize: 13 }}>
            <IconSearch size={16} /> Satış hakkında soru sor — nasıl hesaplanıyor, veriler nereden geliyor?
          </span>
          <IconChevronDown size={16} color={SERA.sub} style={{ transform: askOpen ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }} />
        </div>
        {askOpen && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${SERA.line}`, fontSize: 13, color: SERA.ink }}>
            Aý boýunça bahalar we satyş paýlanyşy diňe saýlanan önüm türine (mysal üçin Domates) degişlidir. Içerki
            bazar bahasy DTM/kg, eksport bahalary bolsa USD/kg bilen görkezilýär. Her blok haýsy önümi
            öndürýändigine görä ýokardaky &quot;Blok Ürün Ataması&quot; bölüminde bellenilýär — öndürijilik mukdary
            üýtgemeýär, diňe girdejini hasaplanylanda haýsy önümiň bahasynyň ulanyljakdygy şoňa görä kesgitlenýär.
          </div>
        )}
      </div>

      {/* Ürün Türleri */}
      <SeraCard
        title="Ürün Türleri"
        extra={<Button type="primary" style={{ background: SERA.green, borderColor: SERA.green }} icon={<IconPlus size={15} />}>Ürün Ekle</Button>}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {productTypes.map((p) => (
            <div
              key={p}
              onClick={() => setActiveProduct(p)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                padding: '5px 12px', borderRadius: 8,
                border: `1px solid ${p === activeProduct ? SERA.green : SERA.line}`,
                background: p === activeProduct ? SERA.green : SERA.card,
                color: p === activeProduct ? '#fff' : SERA.ink,
                fontSize: 13, fontWeight: 600,
              }}
            >
              {p}
              {p !== 'Domates' && (
                <span style={{ display: 'flex', gap: 4, marginLeft: 2 }}>
                  <IconPencil size={13} onClick={(e) => e.stopPropagation()} />
                  <IconTrash size={13} onClick={(e) => { e.stopPropagation(); removeProductType(p); }} />
                </span>
              )}
            </div>
          ))}
        </div>
      </SeraCard>

      {/* Blok Ürün Ataması */}
      <SeraCard
        title="Blok Ürün Ataması"
        extra={<span style={{ fontWeight: 400 }}>Her bloğun hangi ürünü yetiştirdiğini seçin. Üretim aynı kalır; gelir o ürünün fiyatlarına göre hesaplanır.</span>}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {SERA_BLOCKS_BY_GROUP.map((g) => (
            <div key={g.group}>
              <div style={{ fontWeight: 700, color: SERA.ink, marginBottom: 8 }}>{g.group}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10 }}>
                {g.blocks.map((b) => {
                  const rotation = blockRotations[b.id];
                  return (
                    <div key={b.id} style={{ border: `1px solid ${SERA.line}`, borderRadius: 10, padding: 10 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: SERA.ink, marginBottom: 6 }}>{b.name}</div>
                      <Select
                        size="small"
                        style={{ width: '100%' }}
                        value={blockProducts[b.id]}
                        options={productOptions}
                        onChange={(v) => setBlockProducts((prev) => ({ ...prev, [b.id]: v }))}
                      />
                      {rotation ? (
                        <div style={{ marginTop: 8, background: '#fff7e6', borderRadius: 8, padding: 6 }}>
                          <div style={{ fontSize: 11, color: SERA.amber, fontWeight: 600, marginBottom: 4 }}>{rotation.fromMonth} →</div>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                            <Select
                              size="small"
                              style={{ width: 76 }}
                              value={rotation.toProduct}
                              options={productOptions}
                              onChange={(v) => setBlockRotations((prev) => ({ ...prev, [b.id]: { ...rotation, toProduct: v } }))}
                            />
                            <Select
                              size="small"
                              style={{ width: 76 }}
                              value={rotation.fromMonth}
                              options={monthOptions}
                              onChange={(v) => setBlockRotations((prev) => ({ ...prev, [b.id]: { ...rotation, fromMonth: v } }))}
                            />
                            <IconTrash
                              size={14}
                              color={SERA.neg}
                              style={{ cursor: 'pointer' }}
                              onClick={() => setBlockRotations((prev) => ({ ...prev, [b.id]: undefined }))}
                            />
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setBlockRotations((prev) => ({ ...prev, [b.id]: { fromMonth: 'Temmuz', toProduct: productTypes.find((p) => p !== 'Domates') ?? 'Domates' } }))}
                          style={{
                            marginTop: 8, width: '100%', border: `1px dashed ${SERA.line}`, borderRadius: 8,
                            background: 'none', color: SERA.sub, fontSize: 11, padding: '4px 6px', cursor: 'pointer',
                          }}
                        >
                          + Ürün rotasyonu ekle
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </SeraCard>

      {/* Fiyatlar */}
      <SeraCard
        title={`Fiyatlar — ${activeProduct}`}
        extra={(
          <div style={{ display: 'flex', gap: 8 }}>
            <Button size="small">Tüm Yıl</Button>
            <Button size="small">Temizle</Button>
          </div>
        )}
      >
        <div style={{ fontSize: 12, color: SERA.sub, marginBottom: 10, marginTop: -6 }}>
          Her ayın kendi fiyatları olur. Bu fiyatlar yalnızca {activeProduct} ürününe uygulanır.
        </div>
        <SeraMatrixTable
          headers={['Ay', 'İç Pazar (DTM/kg)', 'Kapı Satışı (USD/kg)', 'Kazakistan (USD/kg)', 'Rusya (USD/kg)', 'USD Kuru (DTM)']}
          rows={priceRows}
          minWidth={800}
        />
      </SeraCard>

      {/* Satış Dağılımı */}
      <SeraCard
        title={`Satış Dağılımı (%) — ${activeProduct}`}
        extra={(
          <div style={{ display: 'flex', gap: 8 }}>
            <Button size="small">Tüm Yıl</Button>
            <Button size="small">Temizle</Button>
          </div>
        )}
      >
        <div style={{ fontSize: 12, color: SERA.sub, marginBottom: 10, marginTop: -6 }}>
          Üretilen miktar bu yüzdelere göre kanallara dağıtılır: önce İç Pazar ve Kapı Satışı, kalan yurt dışı kanallara gider. Her ay toplamı %100 olmalı.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: SERA.sub }}>Export kanalları:</span>
          {exportChannels.map((c) => (
            <span key={c} style={{ padding: '4px 10px', borderRadius: 8, border: `1px solid ${SERA.line}`, fontSize: 12, fontWeight: 600, color: SERA.ink }}>{c}</span>
          ))}
          <Input
            size="small"
            placeholder="Yeni yurt..."
            value={newChannel}
            onChange={(e) => setNewChannel(e.target.value)}
            style={{ width: 110 }}
            onPressEnter={addExportChannel}
          />
          <Button size="small" icon={<IconPlus size={13} />} onClick={addExportChannel}>Ekle</Button>
        </div>
        <SeraMatrixTable
          headers={['Ay', 'İç Pazar (mutlak %)', 'Kapı Satışı (dış %)', 'Kazakistan (dış %)', 'Rusya (dış %)', 'L1 Toplam']}
          rows={distRows}
          minWidth={800}
        />
      </SeraCard>

      {/* Nakliye Firesi */}
      <SeraCard title="Nakliye Firesi (%) — Ýol Ýitgisi">
        <div style={{ fontSize: 12, color: SERA.sub, marginBottom: 10, marginTop: -6 }}>
          Yüklemedeki kg ile varıştaki kg arasındaki fark — örn. 100 kg yüklenirse %3 fire ile 97 kg teslim edilir. Net gelir bu orana göre hesaplanır.
        </div>
        <SeraMatrixTable
          headers={['Ay', 'Kazakistan fire %', 'Rusya fire %']}
          rows={fireRows}
          minWidth={420}
        />
      </SeraCard>

      {/* Atama Özeti */}
      <SeraCard title="Atama Özeti">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
          {productTypes.map((p) => {
            const names = allBlocks.filter((b) => blockProducts[b.id] === p).map((b) => b.name);
            return (
              <div key={p}>
                <b style={{ color: SERA.ink }}>{p}:</b>{' '}
                <span style={{ color: SERA.sub }}>{names.length > 0 ? names.join(', ') : '(atanmış blok yok)'}</span>
              </div>
            );
          })}
        </div>
      </SeraCard>
    </div>
  );
}

function InputCell({ value }: { readonly value: number }) {
  return (
    <input
      type="number"
      defaultValue={value}
      style={{
        width: '100%', minWidth: 60, border: `1px solid ${SERA.line}`, borderRadius: 6,
        padding: '4px 8px', fontSize: 13, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
        background: '#fafafa', color: SERA.ink,
      }}
    />
  );
}
